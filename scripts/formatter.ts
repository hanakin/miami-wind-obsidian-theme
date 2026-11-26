import postcss, { type Container, type Plugin } from "postcss";
import stylelint from "stylelint";
import { formatConfig as config } from "./format-config";
import { ordered } from "./property-order";
import { syntaxFormatConfig } from "./stylelint-config";

function block(lines: string[], depth = 0): string {
	const indent = config.indent.repeat(depth);
	return [
		`${indent}/*`,
		...lines.map((line) => `${indent} *${line ? ` ${line}` : ""}`),
		`${indent} */`,
	].join("\n");
}
function banner(title: string, lines: string[]): string {
	return `/* ${config.rule}\n * ${title}\n * ${config.rule}\n${lines.map((line) => ` *${line ? ` ${line}` : ""}`).join("\n")}\n * ${config.closingRule} */`;
}
function fileInfo(file: string) {
	const source = file.replace(/ \(continued\)$/, "");
	const name = source.split("/").at(-1) ?? source;
	return {
		source: source.startsWith("src/") ? source : `src/${source}`,
		name,
		label: name.replace(/\.css$/, "").replaceAll("-", " "),
		layer:
			config.sections[name]?.layer ??
			(source.includes("/components/") ? "object" : "component"),
	};
}
function sectionBanner(file: string, continued: boolean): string {
	const { source, name, label, layer } = fileInfo(file);
	return banner(
		`@${layer}: ${label.replace(/\b\w/g, (letter) => letter.toUpperCase())}${continued ? " (continued)" : ""}`,
		[
			`@source: ${source}`,
			"@description:",
			"",
			config.sections[name]?.description ?? `Obsidian ${label} surface.`,
			"",
		],
	);
}
function contents(files: string[]): string {
	return files.length
		? block([
				"CONTENTS",
				"",
				...files.map((file, index) => {
					const { source, label, layer } = fileInfo(file);
					const title = `${index + 1}. ${layer}: ${label}`;
					return `${title}${".".repeat(Math.max(2, 38 - title.length))}${source}`;
				}),
			])
		: "";
}
const commentText = (css: string) =>
	(postcss.parse(css).first as postcss.Comment).text;
const cleanLines = (text: string) =>
	text.split("\n").map((line) => line.replace(/^\s*\* ?/, "").trim());
function heading(text: string, depth: number): string | undefined {
	const explicit = text.match(/^@heading\s+(.+)$/)?.[1];
	if (explicit) return explicit;
	const lines = cleanLines(text).filter(Boolean);
	const title = lines[0];
	// Recognize only our exact generated heading; plain short notes stay descriptions.
	if (
		title &&
		text ===
			commentText(
				block(
					[title, config.rule.slice(0, config.rule.length - depth * 4)],
					depth,
				),
			)
	)
		return title;
}
function comment(text: string, depth: number): string {
	const component = text.match(/^(?:Component:|@component:)\s*(.+)$/s);
	if (component) return block([`@component: ${component[1]}`], depth);
	const title = heading(text, depth);
	if (title)
		return block(
			[title, config.rule.slice(0, config.rule.length - depth * 4)],
			depth,
		);
	const paragraphs: { text: string; hanging: number }[] = [];
	for (const line of cleanLines(text)) {
		const previous = paragraphs.at(-1);
		const item = line.match(/^(?:\d+\.|-)\s+/);
		if (!line) {
			if (previous?.text) paragraphs.push({ text: "", hanging: 0 });
		} else if (item || !previous?.text) {
			paragraphs.push({ text: line, hanging: item?.[0].length ?? 0 });
		} else if (previous.hanging) {
			previous.text += `\n${" ".repeat(previous.hanging)}${line}`;
		} else previous.text += ` ${line}`;
	}
	const lines: string[] = [];
	for (const { text: paragraph, hanging } of paragraphs) {
		if (!paragraph) {
			lines.push("");
			continue;
		}
		if (hanging) {
			lines.push(...paragraph.split("\n"));
			continue;
		}
		const wrapped: string[] = [];
		for (const word of paragraph.split(/\s+/)) {
			const last = wrapped.at(-1);
			if (
				last &&
				last.length + word.length + 1 <= config.commentWidth - depth * 4 - 3
			)
				wrapped[wrapped.length - 1] = `${last} ${word}`;
			else wrapped.push(word);
		}
		lines.push(...wrapped);
	}
	while (lines.at(-1) === "") lines.pop();
	return block(lines, depth);
}
function numericBoxValue(property: string, value: string): string {
	if (
		!["margin", "padding", "border-width", "border-radius"].includes(property)
	)
		return value;
	const parts = value.trim().split(/\s+/);
	if (
		parts.length > 4 ||
		!parts.every((part) => /^-?(?:\d*\.)?\d+(?:[a-z]+|%)?$/.test(part))
	)
		return value;
	if (parts.length === 4 && parts[1] === parts[3]) parts.pop();
	if (parts.length === 3 && parts[0] === parts[2]) parts.pop();
	if (parts.length === 2 && parts[0] === parts[1]) parts.pop();
	return parts.join(" ");
}
function render(
	container: Container,
	depth: number,
	protectedComments: string[],
	files: string[],
): string {
	const indent = config.indent.repeat(depth);
	const nodes = ordered(container.nodes ?? []);
	const output: {
		text: string;
		major: boolean;
		comment: boolean;
		title: boolean;
	}[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];
		if (!node) continue;
		if (node.type === "comment") {
			if (
				/^@settings\b/.test(node.text.trim()) ||
				/@license|copyright|permission is hereby granted|SPDX-License-Identifier/i.test(
					node.text,
				)
			) {
				const marker = `/* @mw-preserve-${protectedComments.length} */`;
				protectedComments.push(node.toString());
				output.push({
					text: marker,
					major: false,
					comment: true,
					title: false,
				});
				continue;
			}
			const previous = output.at(-1);
			if (
				container.type === "rule" &&
				previous &&
				!previous.comment &&
				!node.raws.before?.includes("\n")
			) {
				previous.text += ` /* ${node.text.trim()} */`;
				continue;
			}
			const marker = node.text.match(/^@section (.+)$/);
			if (marker?.[1]) {
				// Only sections containing output rules receive banners and contents entries.
				let end = index + 1;
				while (
					end < nodes.length &&
					!(
						nodes[end]?.type === "comment" &&
						/^@section /.test((nodes[end] as postcss.Comment).text)
					)
				)
					end++;
				if (
					!nodes.slice(index + 1, end).some((item) => item.type !== "comment")
				)
					continue;
				const { source, name } = fileInfo(marker[1]);
				const continued = seen.has(source);
				seen.add(source);
				if (!files.includes(source)) files.push(source);
				output.push({
					text: `${sectionBanner(source, continued)}\n\n/* ${name === "tokens.css" ? "#settings" : "#css"} */`,
					major: true,
					comment: true,
					title: true,
				});
				continue;
			}
			const description = comment(node.text, depth);
			if (
				previous?.comment &&
				!previous.title &&
				!heading(node.text, depth) &&
				previous.text.startsWith(`${indent}/*\n`)
			) {
				// Consecutive source notes become paragraphs in one description, directly above its rule.
				previous.text = `${previous.text.slice(0, -`${indent} */`.length)}${indent} *\n${description.split("\n").slice(1).join("\n")}`;
				continue;
			}
			output.push({
				text: description,
				major: false,
				comment: true,
				title: !!heading(node.text, depth),
			});
			continue;
		}
		if (node.type === "decl") {
			output.push({
				text: `${indent}${node.prop}: ${numericBoxValue(node.prop, node.value)}${node.important ? " !important" : ""};`,
				major: false,
				comment: false,
				title: false,
			});
			continue;
		}
		const selector =
			node.type === "rule"
				? node.selectors.join(`,\n${indent}`)
				: `@${node.name}${node.params ? ` ${node.params}` : ""}`;
		output.push({
			text: node.nodes
				? `${indent}${selector} {\n${render(node, depth + 1, protectedComments, files)}\n${indent}}`
				: `${indent}${selector};`,
			major: false,
			comment: false,
			title: false,
		});
	}
	return output
		.map((item, index) => {
			if (!index) return item.text;
			const previous = output[index - 1];
			const separator = item.major
				? "\n\n\n"
				: previous?.title
					? "\n\n"
					: previous?.comment || (container.type === "rule" && !item.comment)
						? "\n"
						: "\n\n";
			return `${separator}${item.text}`;
		})
		.join("");
}
export function formatCss(): Plugin {
	return {
		postcssPlugin: "miami-wind-format",
		async OnceExit(root, { result }) {
			const header = banner(config.title, [
				`@author: ${config.author}`,
				`@version: ${config.version}`,
				"",
				"Generated by bun run build. Edit src/; do not edit this file.",
				"",
			]);
			for (const node of [...root.nodes]) {
				if (node.type !== "comment") continue;
				if (node.text === config.header || node.text === commentText(header)) {
					node.remove();
					continue;
				}
				const file = node.text.match(/@source: (src\/\S+\.css)/)?.[1];
				if (
					file &&
					[false, true].some(
						(continued) =>
							node.text === commentText(sectionBanner(file, continued)),
					)
				) {
					const next = node.next();
					if (
						next?.type === "comment" &&
						["#css", "#settings"].includes(next.text)
					)
						next.remove();
					node.text = `@section ${file}`;
					continue;
				}
				const files = cleanLines(node.text).flatMap(
					(line) =>
						line.match(/^\d+\. [\w ]+: .+\.{2,}(src\/\S+\.css)$/)?.[1] ?? [],
				);
				if (files.length && node.text === commentText(contents(files)))
					node.remove();
			}
			const protectedComments: string[] = [],
				files: string[] = [];
			const body = render(root, 0, protectedComments, files);
			const table = contents(files);
			const css = `${header}\n\n\n${table ? `${table}\n\n\n` : ""}${body}\n`;
			const formatted = await stylelint.lint({
				code: css,
				config: syntaxFormatConfig,
				fix: true,
			});
			let final = formatted.code ?? css;
			for (const [index, original] of protectedComments.entries())
				final = final.replace(`/* @mw-preserve-${index} */`, () => original);
			result.opts.stringifier = (_node, builder) => builder(final);
		},
	};
}
