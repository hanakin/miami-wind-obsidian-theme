import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss, { type Plugin } from "postcss";
import atImport from "postcss-import";
import mixins from "postcss-mixins";
import nested from "postcss-nested";
import stylelint from "stylelint";
import obsidian from "stylelint-config-obsidianmd";
import { checkCss } from "./checker";
import { formatConfig } from "./format-config";
import { formatCss } from "./formatter";
import legacyChecksum from "./legacy-sha256.json";

interface ComponentUsage {
	component: string;
	usages: {
		surface: string;
		selector: string;
		properties: Record<string, string>;
	}[];
}

export async function compile() {
	const legacyPath = path.resolve("src/legacy.css");
	const legacy = await readFile(legacyPath, "utf8");
	if (
		createHash("sha256").update(legacy).digest("hex") !== legacyChecksum.sha256
	) {
		throw new Error(
			"Legacy CSS changed: port the rules into a checked surface; do not refresh the checksum without review.",
		);
	}
	const components: ComponentUsage[] = [];
	const expandPilot: Plugin = {
		postcssPlugin: "miami-wind-pilot",
		async Once(root) {
			// Keep source order: the legacy slots retain the original cascade positions.
			let previous = "";
			for (const node of [...root.nodes]) {
				const file = node.source?.input.file;
				if (file && file !== previous) {
					root.insertBefore(
						node,
						postcss.comment({
							text: `@section ${path.relative(process.cwd(), file)}`,
						}),
					);
					previous = file;
				}
			}
			const slots: postcss.AtRule[] = [];
			root.walkAtRules("pilot", (slot) => {
				slots.push(slot);
			});
			for (const slot of slots) {
				if (!["code", "tabs", "tag-hover"].includes(slot.params))
					throw slot.error("Unknown pilot surface");
				const file = path.resolve(`src/${slot.params}.css`);
				const content = postcss.parse(await readFile(file, "utf8"), {
					from: file,
				});
				slot.replaceWith(
					postcss.comment({ text: `@section src/${slot.params}.css` }),
					...content.nodes,
					postcss.comment({ text: "@section src/legacy.css (continued)" }),
				);
			}
			root.prepend(postcss.comment({ text: formatConfig.header }));
			root.walkAtRules("mixin", (use) => {
				const owner = use.parent;
				if (owner?.type !== "rule")
					throw use.error("Component must be used inside a rule");
				const surface = path.basename(use.source?.input.file ?? "unknown");
				let entry = components.find((item) => item.component === use.params);
				if (!entry) {
					entry = { component: use.params, usages: [] };
					components.push(entry);
				}
				const properties: Record<string, string> = {};
				owner.walkDecls((decl) => {
					if (decl.prop.startsWith("--mw-")) properties[decl.prop] = decl.value;
				});
				entry.usages.push({ surface, selector: owner.selector, properties });
			});
		},
	};
	const input = await readFile("src/index.css", "utf8");
	const result = await postcss([
		atImport(),
		expandPilot,
		mixins(),
		nested(),
		checkCss(legacyPath),
		formatCss(),
	]).process(input, { from: path.resolve("src/index.css"), map: false });
	return {
		css: result.css,
		usage: `${JSON.stringify(components, null, "\t")}\n`,
	};
}

export async function lintPublished(css: string) {
	// Use only Obsidian's published rules, not the inherited standard formatting rules.
	const result = await stylelint.lint({
		code: css,
		codeFilename: "theme.css",
		config: { plugins: obsidian.plugins, rules: obsidian.rules },
	});
	const warnings = result.results.flatMap((file) => file.warnings);
	const errors = warnings.filter((warning) => warning.severity === "error");
	console.log(
		`Obsidian lint: ${errors.length} errors, ${warnings.length - errors.length} published warnings (legacy pilot baseline).`,
	);
	const baseline: Record<string, number> = {
		"declaration-no-important": 61,
		"selector-pseudo-class-disallowed-list": 1,
	};
	const counts: Record<string, number> = {};
	for (const warning of warnings) {
		counts[warning.rule] = (counts[warning.rule] ?? 0) + 1;
		if (counts[warning.rule] > (baseline[warning.rule] ?? 0)) {
			throw new Error(`New Obsidian warning: ${warning.rule}: ${warning.text}`);
		}
	}
	if (result.errored) throw new Error(JSON.stringify(errors, null, 2));
}
