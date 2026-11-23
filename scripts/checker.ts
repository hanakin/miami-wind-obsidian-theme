import path from "node:path";
import Specificity from "@bramus/specificity";
import type { Plugin } from "postcss";
import selectorParser from "postcss-selector-parser";

const tagHoverSelector = ".cm-hashtag-begin:has(+ .cm-hashtag-end:hover)";

// Parity-only exceptions: these exact 1.x selectors need 0,2,1 to tie Obsidian's
// span.cm-url, span.cm-formatting-link-string and span.cm-formatting-math rivals.
const paritySpanSelectors = new Set(
	["keyword", "string", "number", "comment", "operator", "variable", "def"].map(
		(token) => `.cm-s-obsidian span.cm-${token}`,
	),
);
// Footnote refs: .cm-s-obsidian span.cm-footref.cm-hmd-barelink.cm-formatting (0,4,1).
// Footnote labels: .cm-s-obsidian .cm-line.HyperMD-footnote span.cm-hmd-footnote (0,4,1).
paritySpanSelectors.add(
	".markdown-source-view.mod-cm6 span.cm-inline-code.cm-footref",
);
paritySpanSelectors.add(
	".markdown-source-view.mod-cm6 span.cm-inline-code.cm-hmd-footnote",
);

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

// shortcut: untouched 1.x rules are grandfathered only in the checksum-locked legacy file.
export function checkCss(legacyFile?: string): Plugin {
	return {
		postcssPlugin: "miami-wind-check",
		OnceExit(root) {
			const isLegacy = (file?: string) =>
				!!legacyFile && file === path.resolve(legacyFile);
			root.walkDecls((decl) => {
				if (isLegacy(decl.source?.input.file)) return;
				if (decl.important || decl.prop === "all")
					throw decl.error("No !important or all declarations");
			});
			root.walkAtRules((rule) => {
				if (["layer", "scope"].includes(rule.name))
					throw rule.error("No @layer or @scope");
			});
			root.walkRules((rule) => {
				if (isLegacy(rule.source?.input.file)) return;
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
							rule.source?.input.file === path.resolve("src/code.css") &&
							paritySpanSelectors.has(selector.toString().trim())
						)
							return;

						// Obsidian 1.15.1 button.mod-destructive.mod-cta(:hover) uses
						// 0,2,1 / 0,3,1 with literal error colors; ties preserve modal CTA fills.
						if (
							rule.source?.input.file === path.resolve("src/modals.css") &&
							[".modal button.mod-cta", ".modal button.mod-cta:hover"].includes(
								selector.toString().trim(),
							)
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
					const specificity = Specificity.calculate(selector.toString())[0];
					if (
						!specificity ||
						Specificity.compare(specificity, { a: 0, b: 4, c: 1 }) > 0
					)
						fail("Maximum specificity is 0,4,1");
				});
			});
		},
	};
}
