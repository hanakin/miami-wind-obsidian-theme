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
const DYNAMIC = new Set([
	":hover",
	":active",
	":focus",
	":focus-visible",
	":focus-within",
	":visited",
]);

/** Extra evidence a selector needs beyond matching an element (pseudo-elements we cannot query). */
export type Needs = "selection" | "scrollbar-hover" | undefined;

function rewrite(selector: string, mode: "fixture" | "live"): { sel: string; needs: Needs } {
	let needs: Needs;
	const sel = selectorParser((root) => {
		root.walkPseudos((p) => {
			const v = p.value.toLowerCase();
			const isElement = v.startsWith("::") || LEGACY_PSEUDO_ELEMENTS.has(v);
			if (isElement) {
				// Pseudo-classes after a pseudo-element describe the pseudo-element (thumb:hover).
				let next = p.next();
				const trailing: string[] = [];
				while (next && next.type === "pseudo") {
					trailing.push(next.value.toLowerCase());
					const n = next.next();
					next.remove();
					next = n;
				}
				if (v === "::selection") needs = "selection";
				if (v.startsWith("::-webkit-scrollbar") && trailing.includes(":hover"))
					needs = "scrollbar-hover";
				if (mode === "fixture" && v === "::selection") {
					p.replaceWith(
						selectorParser.string({ value: `:is(${state("selection")}, ${state("selection")} *)` }),
					);
				} else if (
					mode === "fixture" &&
					needs === "scrollbar-hover" &&
					v.startsWith("::-webkit-scrollbar")
				) {
					p.replaceWith(selectorParser.string({ value: state("scrollbar-hover") }));
				} else p.remove();
				return;
			}
			if (SCROLLBAR_PSEUDO_CLASSES.has(v)) {
				p.remove();
				return;
			}
			if (!DYNAMIC.has(v)) return;
			// Fixtures carry the states Chromium reported through matches() at capture time.
			if (mode === "fixture") p.replaceWith(selectorParser.string({ value: state(v.slice(1)) }));
			// Chromium hides :visited from matches() for privacy; the capture marks the forced link.
			else if (v === ":visited")
				p.replaceWith(selectorParser.string({ value: "[data-capture-visited]" }));
		});
		// A compound emptied by the rewrite (a lone ::selection, say) matches any element.
		root.each((s) => {
			if (s.nodes.length === 0) s.append(selectorParser.universal());
			const last = s.nodes[s.nodes.length - 1];
			if (last?.type === "combinator") s.append(selectorParser.universal());
		});
	}).processSync(selector);
	return { sel, needs };
}

/**
 * Rewrites a selector so it can be matched against a static fixture. Each dynamic pseudo-class
 * becomes the data-capture-state mark that the capture wrote on every element for which Chromium's
 * Element.matches() returned true while the state was forced; pseudo-elements are dropped (they
 * render on the element that remains), except ::selection and scrollbar-thumb hover, which need
 * their own evidence marks.
 */
export function matchable(selector: string): string {
	return rewrite(selector, "fixture").sel;
}

/** The selector Chromium can evaluate in the live app (pseudo-elements stripped) plus its needs. */
export function liveSelector(selector: string): { sel: string; needs: Needs } {
	return rewrite(selector, "live");
}

if (import.meta.main) {
	// Self-check: bun capture/scripts/css.ts
	const cases: [string, string][] = [
		[".a:hover .b", '.a[data-capture-state~="hover"] .b'],
		["::selection", ':is([data-capture-state~="selection"], [data-capture-state~="selection"] *)'],
		["::-webkit-scrollbar-thumb:hover", '[data-capture-state~="scrollbar-hover"]'],
		["select::-webkit-scrollbar-thumb", "select"],
		[".x::before", ".x"],
		["input.prompt-input:focus-visible", 'input.prompt-input[data-capture-state~="focus-visible"]'],
		["a:focus", 'a[data-capture-state~="focus"]'],
	];
	for (const [input, want] of cases) {
		const got = matchable(input);
		if (got !== want) throw new Error(`matchable(${input}) = ${got}, want ${want}`);
	}
	const live: [string, string, Needs][] = [
		[".a:hover .b::after", ".a:hover .b", undefined],
		["a:hover:visited", "a:hover[data-capture-visited]", undefined],
		["::-webkit-scrollbar-thumb:hover", "*", "scrollbar-hover"],
		["::selection", "*", "selection"],
	];
	for (const [input, want, needs] of live) {
		const got = liveSelector(input);
		if (got.sel !== want || got.needs !== needs)
			throw new Error(`liveSelector(${input}) = ${JSON.stringify(got)}`);
	}
	if (keyClassesOf(".a .b.c:hover").join() !== "c,b") throw new Error("keyClassesOf");
	console.log("css.ts self-check passed");
}

/** Selector text with whitespace normalized, to compare theme.css text with DevTools' text. */
export function normSelector(t: string): string {
	return t
		.replace(/\s+/g, " ")
		.replace(/\s*([>+~,])\s*/g, "$1")
		.replace(/\(\s+/g, "(")
		.replace(/\s+\)/g, ")")
		.trim();
}

/**
 * App classes the theme can change: theme.css names the class in a selector, or an app.css rule
 * whose selector names the class reads a custom property that theme.css sets.
 */
export function themeAffectedClasses(appCss: string, themeCss: string): Set<string> {
	const out = new Set<string>();
	const themeVars = new Set<string>();
	const theme = postcss.parse(themeCss);
	theme.walkDecls((d) => {
		if (d.prop.startsWith("--")) themeVars.add(d.prop);
	});
	theme.walkRules((r: Rule) => {
		for (const s of r.selectors) for (const c of classesOf(s)) out.add(c);
	});
	// App custom properties defined from theme-set ones change with the theme too (transitively).
	const app = postcss.parse(appCss);
	const defs: [string, string][] = [];
	app.walkDecls((d) => {
		if (d.prop.startsWith("--")) defs.push([d.prop, d.value]);
	});
	for (let grew = true; grew; ) {
		grew = false;
		for (const [prop, value] of defs) {
			if (themeVars.has(prop)) continue;
			for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g))
				if (themeVars.has(m[1] ?? "")) {
					themeVars.add(prop);
					grew = true;
					break;
				}
		}
	}
	app.walkRules((r: Rule) => {
		let reads = false;
		r.walkDecls((d) => {
			for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g))
				if (themeVars.has(m[1] ?? "")) reads = true;
		});
		if (!reads) return;
		for (const s of r.selectors) {
			try {
				for (const c of classesOf(s)) out.add(c);
			} catch {}
		}
	});
	return out;
}
