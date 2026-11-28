import path from "node:path";
import Specificity from "@bramus/specificity";
import type { Plugin } from "postcss";
import selectorParser from "postcss-selector-parser";

const tagHoverSelector = ".cm-hashtag-begin:has(+ .cm-hashtag-end:hover)";

// Multi-token spans also match Obsidian's .cm-s-obsidian span.cm-formatting-math
// and span.cm-url / span.cm-formatting-link-string (0,2,1), not just .cm-keyword.
const paritySpanSelectors = new Set([
	".cm-s-obsidian span.cm-keyword",
	".cm-s-obsidian span.cm-string",
]);
// Footnote refs: .cm-s-obsidian span.cm-footref.cm-hmd-barelink.cm-formatting (0,4,1).
// Footnote labels: .cm-s-obsidian .cm-line.HyperMD-footnote span.cm-hmd-footnote (0,4,1).
paritySpanSelectors.add(
	".markdown-source-view.mod-cm6 span.cm-inline-code.cm-footref",
);
paritySpanSelectors.add(
	".markdown-source-view.mod-cm6 span.cm-inline-code.cm-hmd-footnote",
);

// Highlights must tie Obsidian 1.15.1's span rivals, including search matches.
// Direct colors preserve magenta even when colored highlights shadow the variable.
const highlightSpanSelectors = new Set([
	".cm-s-obsidian span.cm-highlight",
	".cm-s-obsidian span.cm-highlight.obsidian-search-match-highlight",
	"span.cm-hashtag.cm-hmd-escape-backslash.cm-highlight",
	"span.cm-formatting-link.cm-url.cm-highlight",
	"span.cm-formatting-link.cm-url.cm-highlight:hover",
	".markdown-source-view.mod-cm6 span.cm-highlight.cm-footref",
	".markdown-source-view.mod-cm6 span.cm-highlight.cm-hmd-footnote",
	".cm-line.HyperMD-footnote span.cm-hmd-footnote.cm-formatting.cm-highlight",
]);

function compoundDepth(selector: selectorParser.Selector): number {
	const direct =
		1 + selector.nodes.filter((node) => node.type === "combinator").length;
	let nested = 0;
	for (const node of selector.nodes) {
		if (node.type !== "pseudo" || !node.nodes) continue;
		for (const argument of node.nodes) {
			if (argument.type === "selector")
				nested = Math.max(nested, compoundDepth(argument) - 1);
		}
	}
	return direct + nested;
}

export function checkCss(): Plugin {
	return {
		postcssPlugin: "miami-wind-check",
		OnceExit(root) {
			root.walkDecls((decl) => {
				if (
					["src/settings/tokens.css", "src/settings/palette.css"].some(
						(file) => decl.source?.input.file === path.resolve(file),
					)
				) {
					const previous = decl.prev();
					if (
						previous?.type === "decl" &&
						previous.prop.startsWith("--") &&
						decl.prop.startsWith("--")
					) {
						const changed =
							previous.prop.slice(2).split("-")[0] !==
							decl.prop.slice(2).split("-")[0];
						const blank = /\n[\t ]*\n/.test(decl.raws.before ?? "");
						if (changed !== blank)
							throw decl.error(
								"Separate variable families with one blank line; keep each family together",
							);
					}
				}

				if (decl.important || decl.prop === "all")
					throw decl.error("No !important or all declarations");
			});
			root.walkAtRules((rule) => {
				if (["layer", "scope"].includes(rule.name))
					throw rule.error("No @layer or @scope");
			});
			root.walkRules((rule) => {
				const ast = selectorParser().astSync(rule.selector);
				ast.each((selector) => {
					const fail = (message: string) => {
						throw rule.error(`${message}: ${selector}`);
					};
					selector.walkIds(() => {
						fail("No IDs");
					});
					selector.walkPseudos((pseudo) => {
						if (
							pseudo.value === ":has" &&
							!(
								selector.toString() === tagHoverSelector &&
								rule.source?.input.file?.endsWith("/tag-hover.css")
							)
						)
							fail("No :has outside tag-hover.css");
					});
					// Inspect every compound, including selector lists inside functional pseudos.
					selector.walkTags((tag) => {
						if (
							rule.source?.input.file ===
								path.resolve("src/markdown/code.css") &&
							paritySpanSelectors.has(selector.toString().trim())
						)
							return;

						if (
							rule.source?.input.file ===
								path.resolve("src/markdown/inline-marks.css") &&
							highlightSpanSelectors.has(selector.toString().trim())
						)
							return;

						// Obsidian 1.15.1 button.mod-destructive.mod-cta(:hover) uses
						// 0,2,1 / 0,3,1 reading --background-modifier-error/-hover; ties preserve CTA fills.
						if (
							rule.source?.input.file ===
								path.resolve("src/global/modals.css") &&
							[".modal button.mod-cta", ".modal button.mod-cta:hover"].includes(
								selector.toString().trim(),
							)
						)
							return;

						// Obsidian 1.15.1's community sidebar button.clickable-icon reads
						// --text-normal at 0,3,1; omitting its sidebar ancestor keeps that tie.
						if (
							rule.source?.input.file ===
								path.resolve("src/sections/community-browser.css") &&
							selector.toString().trim() ===
								".mod-community-modal button.clickable-icon[aria-disabled='true']"
						)
							return;

						const siblings = tag.parent?.nodes ?? [];
						const index = siblings.indexOf(tag);
						const before = siblings
							.slice(0, index)
							.reverse()
							.findIndex((n) => n.type === "combinator");
						const after = siblings
							.slice(index + 1)
							.findIndex((n) => n.type === "combinator");
						const compound = siblings.slice(
							before < 0 ? 0 : index - before,
							after < 0 ? siblings.length : index + after + 1,
						);
						if (
							compound.some(
								(node) => node.type === "class" || node.type === "id",
							)
						)
							fail("No type-qualified classes");
					});
					if (compoundDepth(selector) > 3) fail("Maximum depth is 3 compounds");
					// Sheet filters have literal app backgrounds at 0,5,0. Keep that tie
					// in three compounds, using the actual combobox class instead of an ancestor.
					if (
						rule.source?.input.file ===
							path.resolve("src/sections/bases.css") &&
						[
							".menu.mod-sheet .filter-row .filter-property-select.combobox-button",
							".menu.mod-sheet .filter-row .filter-operator.combobox-button",
						].includes(selector.toString().trim())
					)
						return;
					// Obsidian's Vim command input paints transparent at 0,6,1.
					// Its exact three-compound selector needs the same weight to keep the 1.x fill.
					if (
						rule.source?.input.file === path.resolve("src/global/inputs.css") &&
						selector.toString().trim() ===
							".markdown-source-view.mod-cm6 .cm-panels.cm-panels-bottom input[type='text']:focus"
					)
						return;
					const specificity = Specificity.calculate(selector.toString())[0];
					if (
						!specificity ||
						(Specificity.compare(specificity, { a: 0, b: 4, c: 1 }) > 0 &&
							!(
								rule.source?.input.file ===
									path.resolve("src/markdown/inline-marks.css") &&
								selector.toString().trim() ===
									".cm-line.HyperMD-footnote span.cm-hmd-footnote.cm-formatting.cm-highlight"
							))
					)
						fail("Maximum specificity is 0,4,1");
				});
			});
		},
	};
}
