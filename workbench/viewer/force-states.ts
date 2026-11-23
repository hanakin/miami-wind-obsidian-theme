// Lets a static fixture show the state it was captured in. The capture marks the element it
// forced into :hover/:focus/... with data-capture-state; here every such pseudo-class also
// matches that mark, so the fixture renders as captured without a real pointer.
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const mark = (s: string) => `[data-capture-state~="${s}"]`;
// :hover and :active also match the ancestors of the forced element, like the real thing.
const withAncestors = (s: string) => `${mark(s)}, :has(${mark(s)})`;

const FORCED: Record<string, string> = {
	":hover": withAncestors("hover"),
	":active": withAncestors("active"),
	":focus": `${mark("focus")}, ${mark("focus-visible")}`,
	":focus-visible": mark("focus-visible"),
	":focus-within": `${mark("focus-within")}, ${withAncestors("focus")}, ${withAncestors("focus-visible")}`,
	":visited": mark("visited"),
};
const ANY = /:(hover|active|focus|visited)/;

const rewrite = selectorParser((root) => {
	root.walkPseudos((p) => {
		const forced = FORCED[p.value.toLowerCase()];
		if (!forced) return;
		// A pseudo-class after a pseudo-element (scrollbar-thumb:hover) describes the pseudo-element.
		for (let prev = p.prev(); prev && prev.type !== "combinator"; prev = prev.prev()) {
			if (prev.type === "pseudo" && prev.value.startsWith("::")) return;
		}
		p.replaceWith(selectorParser.string({ value: `:is(${p.value}, ${forced})` }));
	});
});

export function forceStateSelector(selector: string): string {
	return ANY.test(selector) ? rewrite.processSync(selector) : selector;
}

export function forceStates(css: string): string {
	const root = postcss.parse(css);
	root.walkRules(ANY, (rule) => {
		rule.selector = forceStateSelector(rule.selector);
	});
	return root.toString();
}
