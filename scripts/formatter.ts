import postcss, {
	type ChildNode,
	type Container,
	type Declaration,
	type Plugin,
} from "postcss";
import stylelint from "stylelint";
import { formatConfig as config } from "./format-config";
import { ordered, orderRisk } from "./property-order";
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
function section(file: string): string {
	const continued = file.endsWith(" (continued)");
	const source = file.replace(/ \(continued\)$/, "");
	const name = source.split("/").at(-1) ?? source;
	const settings = config.sections[name];
	const label = name
		.replace(/\.css$/, "")
		.replaceAll("-", " ")
		.toUpperCase();
	return (
		banner(
			`@${settings?.layer ?? (source.includes("/components/") ? "objects" : "components")}: ${label.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}${continued ? " (continued)" : ""}`,
			[
				`@source: ${source.startsWith("src/") ? source : `src/${source}`}`,
				"@description:",
				"",
				settings?.description ?? `Obsidian ${label.toLowerCase()} surface.`,
				"",
			],
		) +
		"\n\n" +
		`/* ${name === "tokens.css" ? "#tokens" : "#rules"} */`
	);
}
function comment(text: string, depth: number): string {
	const component = text.match(/^(?:Component:|@component:)\s*(.+)$/s);
	if (component) return block([`@component: ${component[1]}`], depth);
	// Our generated banners already contain their metadata and spacing.
	if (text.startsWith("---") && /@source:/.test(text)) return `/* ${text} */`;
	const clean = text
		.split("\n")
		.map((line) => line.replace(/^\s*\* ?/, "").trim())
		.filter((line) => line && !/^-+$/.test(line))
		.join(" ");
	if (["#css", "#settings", "#rules", "#tokens"].includes(clean))
		return `${config.indent.repeat(depth)}/* ${clean} */`;
	if (/^[A-Za-z][A-Za-z0-9 /_-]{1,60}$/.test(clean))
		return block(
			[clean, config.rule.slice(0, config.rule.length - depth * 4)],
			depth,
		);
	const lines: string[] = [];
	for (const word of clean.split(/\s+/)) {
		const last = lines.at(-1);
		if (
			last &&
			last.length + word.length + 1 <= config.commentWidth - depth * 4 - 3
		)
			lines[lines.length - 1] = `${last} ${word}`;
		else lines.push(word);
	}
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

function contents(root: Container): string {
	const files: string[] = [];
	for (const node of root.nodes ?? []) {
		if (node.type !== "comment") continue;
		const file =
			node.text.match(/^@section (.+)$/)?.[1] ??
			node.text.match(/@source: (src\/\S+\.css)/)?.[1];
		if (!file) continue;
		const source = file.replace(/ \(continued\)$/, "");
		const name = source.split("/").at(-1) ?? source;
		if (files.includes(source)) continue;
		files.push(source);
	}
	if (!files.length) return "";
	return block([
		"CONTENTS",
		"",
		...files.map((file, index) => {
			const name = file.split("/").at(-1) ?? file;
			const title = `${index + 1}. ${config.sections[name]?.layer ?? (file.includes("/components/") ? "objects" : "components")}: ${name.replace(/\.css$/, "").replaceAll("-", " ")}`;
			return `${title}${".".repeat(Math.max(2, 38 - title.length))}${file.startsWith("src/") ? file : `src/${file}`}`;
		}),
	]);
}

function render(
	container: Container,
	depth = 0,
	protectedComments: string[] = [],
): string {
	const indent = config.indent.repeat(depth);
	const source = container.nodes ?? [];
	const nodes = ordered(source);
	const output: { text: string; major: boolean; comment: boolean }[] = [];
	let activeSection = "";
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
				output.push({ text: marker, major: false, comment: true });
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

			if (
				node.text === config.header ||
				node.text.includes(config.title) ||
				/CONTENTS/.test(node.text)
			)
				continue;
			const marker = node.text.match(/^@section (.+)$/);
			if (marker) {
				activeSection = marker[1] ?? "";
				// Mixin definitions disappear; their comments remain next to each use.
				if (
					nodes[index + 1]?.type === "comment" &&
					(nodes[index + 1] as ChildNode & { text: string }).text.startsWith(
						"@section",
					)
				)
					continue;
				output.push({
					text: section(activeSection),
					major: true,
					comment: true,
				});
				continue;
			}
			if (
				node.text.toLowerCase() ===
				(activeSection.split("/").at(-1) ?? activeSection)
					.replace(/\.css.*$/, "")
					.replaceAll("-", " ")
					.toLowerCase()
			)
				continue;
			output.push({
				text: comment(node.text, depth),
				major: node.text.startsWith("---") && /@source:/.test(node.text),
				comment: true,
			});
			continue;
		}
		if (node.type === "decl") {
			output.push({
				text: `${indent}${node.prop}: ${numericBoxValue(node.prop, node.value)}${node.important ? " !important" : ""};`,
				major: false,
				comment: false,
			});
			continue;
		}
		const heading =
			node.type === "rule"
				? node.selectors.join(`,\n${indent}`)
				: `@${node.name}${node.params ? ` ${node.params}` : ""}`;
		output.push({
			text: node.nodes
				? `${indent}${heading} {\n${render(node, depth + 1, protectedComments)}\n${indent}}`
				: `${indent}${heading};`,
			major: false,
			comment: false,
		});
	}
	return output
		.map((item, index) => {
			if (!index) return item.text;
			const previous = output[index - 1];
			const separator = item.major
				? "\n\n\n"
				: container.type === "rule" && !item.comment
					? "\n"
					: "\n\n";
			return `${previous ? separator : ""}${item.text}`;
		})
		.join("");
}

export function formatCss(): Plugin {
	return {
		postcssPlugin: "miami-wind-format",
		async OnceExit(root, { result }) {
			root.walkRules((rule) => {
				const reason = orderRisk(
					rule.nodes.filter(
						(node): node is Declaration => node.type === "decl",
					),
				);
				if (reason)
					result.messages.push({
						type: "order-preserved",
						plugin: "miami-wind-format",
						selector: rule.selector,
						file: rule.source?.input.file,
						reason,
					});
			});
			const header = banner(config.title, [
				`@author: ${config.author}`,
				`@version: ${config.version}`,
				"",
				"Generated by bun run build. Edit src/; do not edit this file.",
				"",
			]);
			const protectedComments: string[] = [];
			const table = contents(root);
			const css = `${header}\n\n\n${table ? `${table}\n\n\n` : ""}${render(root, 0, protectedComments)}\n`;
			const formatted = await stylelint.lint({
				code: css,
				config: syntaxFormatConfig,
				fix: true,
			});
			const output = postcss.parse(formatted.code ?? css);
			// Quote normalization can expose exact duplicate selector-list entries. Removing a repeated entry is cascade-neutral.
			output.walkRules((rule) => {
				const unique = [
					...new Set(rule.selectors.map((selector) => selector.trim())),
				];
				if (unique.length === rule.selectors.length) return;
				let depth = 0;
				let parent = rule.parent;
				while (parent && parent.type !== "root") {
					depth++;
					parent = parent.parent;
				}
				rule.selector = unique.join(`,\n${config.indent.repeat(depth)}`);
			});
			let final = output.toString();
			for (const [index, original] of protectedComments.entries())
				final = final.replace(`/* @mw-preserve-${index} */`, original);
			result.opts.stringifier = (_node, builder) => builder(final);
		},
	};
}
