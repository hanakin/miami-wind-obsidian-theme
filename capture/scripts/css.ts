// CSS parsing shared by the checklist and coverage scripts.
import postcss, { type AtRule, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";

export interface SelectorEntry {
	/** Stable id: "<line>:<index within rule>". */
	id: string;
	line: number;
	selector: string;
	/** Enclosing at-rules, for example "@media print". */
	context: string;
}

/** Every complex selector in a stylesheet (comma lists split), skipping @keyframes steps. */
export function selectors(css: string): SelectorEntry[] {
	const out: SelectorEntry[] = [];
	postcss.parse(css).walkRules((rule: Rule) => {
		const ctx: string[] = [];
		for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
			if (p.type === "atrule") ctx.unshift(`@${(p as AtRule).name} ${(p as AtRule).params}`.trim());
		}
		if (ctx.some((c) => /keyframes/.test(c))) return;
		const line = rule.source?.start?.line ?? 0;
		rule.selectors.forEach((selector, i) => {
			out.push({ id: `${line}:${i}`, line, selector: selector.trim(), context: ctx.join(" ") });
		});
	});
	return out;
}

/** Class names used anywhere in a selector, including inside :not()/:is()/:has(). */
export function classesOf(selector: string): string[] {
	const found = new Set<string>();
	selectorParser((root) => {
		root.walkClasses((c) => {
			found.add(c.value);
		});
	}).processSync(selector);
	return [...found];
}

/** Classes in the rightmost compound selector (the element the rule styles). */
export function keyClassesOf(selector: string): string[] {
	const found: string[] = [];
	selectorParser((root) => {
		const sel = root.first;
		if (!sel) return;
		const nodes = sel.nodes;
		let i = nodes.length - 1;
		while (i >= 0 && nodes[i]?.type !== "combinator") {
			const n = nodes[i];
			if (n?.type === "class") found.push(n.value);
			i--;
		}
	}).processSync(selector);
	return found;
}

const state = (s: string) => `[data-capture-state~="${s}"]`;
const self = (s: string) => `:is(${state(s)}, :has(${state(s)}))`;
const SCROLLBAR_PSEUDO_CLASSES = new Set([
	":horizontal",
	":vertical",
	":decrement",
	":increment",
	":start",
	":end",
	":double-button",
	":single-button",
	":no-button",
	":corner-present",
	":window-inactive",
]);
const LEGACY_PSEUDO_ELEMENTS = new Set([":before", ":after", ":first-line", ":first-letter"]);

/**
 * Rewrites a selector so it can be matched against a static fixture. Interactive pseudo-classes
 * become the data-capture-state marks the capture writes on the element it forced into that state;
 * pseudo-elements are dropped (they live on the element that remains). Explained in capture/CHECKLIST.md.
 */
export function matchable(selector: string): string {
	return selectorParser((root) => {
		root.walkPseudos((p) => {
			const v = p.value.toLowerCase();
			const isElement = v.startsWith("::") || LEGACY_PSEUDO_ELEMENTS.has(v);
			if (isElement) {
				const scrollbar = v.startsWith("::-webkit-scrollbar");
				const selection = v === "::selection";
				// Pseudo-classes after a pseudo-element describe the pseudo-element (thumb:hover).
				let next = p.next();
				const trailing: string[] = [];
				while (next && next.type === "pseudo") {
					trailing.push(next.value.toLowerCase());
					const n = next.next();
					next.remove();
					next = n;
				}
				let replacement = "";
				if (selection) replacement = `:is(${state("selection")}, ${state("selection")} *)`;
				if (scrollbar && trailing.includes(":hover")) replacement = state("scrollbar-hover");
				if (scrollbar && trailing.includes(":active")) replacement = state("scrollbar-active");
				if (replacement) p.replaceWith(selectorParser.string({ value: replacement }));
				else p.remove();
				return;
			}
			if (SCROLLBAR_PSEUDO_CLASSES.has(v)) {
				p.remove();
				return;
			}
			const map: Record<string, string> = {
				":hover": self("hover"),
				":active": self("active"),
				":focus": `:is(${state("focus")}, ${state("focus-visible")})`,
				":focus-visible": state("focus-visible"),
				":visited": state("visited"),
				":focus-within": `:is(${state("focus-within")}, ${state("focus")}, ${state("focus-visible")}, :has(${state("focus")}), :has(${state("focus-visible")}))`,
			};
			const m = map[v];
			if (m) p.replaceWith(selectorParser.string({ value: m }));
		});
		// A compound emptied by the rewrite (a lone ::selection, say) matches any element.
		root.each((sel) => {
			if (sel.nodes.length === 0) sel.append(selectorParser.universal());
			const last = sel.nodes[sel.nodes.length - 1];
			if (last?.type === "combinator") sel.append(selectorParser.universal());
		});
	}).processSync(selector);
}

if (import.meta.main) {
	// Self-check: bun capture/scripts/css.ts
	const cases: [string, string][] = [
		[".a:hover .b", '.a:is([data-capture-state~="hover"], :has([data-capture-state~="hover"])) .b'],
		["::selection", ':is([data-capture-state~="selection"], [data-capture-state~="selection"] *)'],
		["::-webkit-scrollbar-thumb:hover", '[data-capture-state~="scrollbar-hover"]'],
		["select::-webkit-scrollbar-thumb", "select"],
		[".x::before", ".x"],
		["input.prompt-input:focus-visible", 'input.prompt-input[data-capture-state~="focus-visible"]'],
	];
	for (const [input, want] of cases) {
		const got = matchable(input);
		if (got !== want) throw new Error(`matchable(${input}) = ${got}, want ${want}`);
	}
	if (keyClassesOf(".a .b.c:hover").join() !== "c,b") throw new Error("keyClassesOf");
	console.log("css.ts self-check passed");
}
