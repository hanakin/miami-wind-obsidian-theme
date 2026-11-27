// Groups the workbench's items the way the theme's source is laid out: which src/ file styles
// which item, found by testing the files' own selectors against the captures (match.ts). Nothing
// here is a hand-made list, so the grouping follows the files as they change.
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

/** One selector from a source file, ready to test against a capture's markup. */
export interface Probe {
	/** Index of the source file in the list handed to the matcher. */
	file: number;
	/** The whole selector, rewritten so states match the marks a capture carries. */
	full: string;
	/** What the selector's last part is written with: the names a rule calls its element by. */
	last: Compound;
	/**
	 * The selector cut before each of its later parts: `.a .b > .c` gives `.a` and `.a .b`. A rule
	 * that styles something inside an item reaches the item when one of these is the item.
	 */
	prefixes: string[];
}

/** The tag, classes and attribute tests written on one element of a selector. */
export interface Compound {
	tag?: string;
	classes: string[];
	attributes: string[];
}

/** The last compound of a selector, or of each alternative in a selector list. */
export function lastCompounds(selectorList: string): Compound[] {
	const out: Compound[] = [];
	selectorParser((root) => {
		for (const selector of root.nodes) {
			let last: Compound = { classes: [], attributes: [] };
			for (const node of selector.nodes) {
				if (node.type === "combinator") last = { classes: [], attributes: [] };
				else if (node.type === "tag") last.tag = node.value.toLowerCase();
				else if (node.type === "class") last.classes.push(node.value);
				else if (node.type === "attribute") last.attributes.push(node.toString().trim());
			}
			out.push(last);
		}
	}).processSync(selectorList);
	return out;
}

// Classes that say what state or setting an element is in, not what it is. A last compound made
// only of these names no item.
const STATE_OR_CONTEXT = /^(is-|mod-|has-|theme-|show-|hide-)/;

/** The rules the check follows, in plain words. Printed with its result. */
export const RULES = [
	"An item is a component named by its own class or element: the last part of a selector.",
	"A rule counts for an item only when it selects the item's own element in a capture and names it by the item's own class or element. A section's own class on that element (.xfaSelect on a select) is the section's, not the item's.",
	"States (is-*, mod-*, has-*, :hover and the like) and context (.theme-dark, body and platform classes) are not items and never cause an overlap.",
	"Rules that only set variables (--name) belong to the file they are in and never cause an overlap.",
	"An overlap is one item styled from two top-level places: global, markdown, or one app section (sections/<x>). The fix is always to move its rules into global/.",
];

/** True when a selector's last compound names something: a tag, or a class that is not a state. */
function namesSomething(selector: selectorParser.Selector): boolean {
	const last: selectorParser.Node[] = [];
	for (const node of selector.nodes) {
		if (node.type === "combinator") last.length = 0;
		else last.push(node);
	}
	return last.some(
		(node) =>
			(node.type === "tag" && !/^(body|html)$/i.test(node.value)) ||
			(node.type === "class" && !STATE_OR_CONTEXT.test(node.value)) ||
			node.type === "id",
	);
}

/** Every selector in the source files that can own an item (see RULES). */
export function probes(
	files: { path: string; css: string }[],
	rewrite: (selector: string) => string,
): Probe[] {
	const out: Probe[] = [];
	files.forEach(({ css }, file) => {
		postcss.parse(css).walkRules((rule) => {
			// Mixin bodies and keyframe steps are not rules on elements.
			for (
				let p = rule.parent as postcss.Node | undefined;
				p;
				p = p.parent as postcss.Node | undefined
			) {
				if (p.type === "atrule" && /^(define-mixin|keyframes)$/.test((p as postcss.AtRule).name)) {
					return;
				}
			}
			// A rule that only sets variables styles nothing by itself.
			const declarations = rule.nodes.filter((n) => n.type === "decl");
			if (declarations.length > 0 && declarations.every((d) => d.prop.startsWith("--"))) return;
			selectorParser((root) => {
				for (const selector of root.nodes) {
					const text = selector.toString().trim();
					// `.view ::selection` styles selected text anywhere inside: it names no item.
					if (/(^|[\s>+~])::[\w-]+$/.test(text) || !namesSomething(selector)) continue;
					const prefixes: string[] = [];
					let sofar = "";
					for (const node of selector.nodes) {
						if (node.type === "combinator" && sofar.trim()) prefixes.push(sofar.trim());
						sofar += node.toString();
					}
					try {
						out.push({
							file,
							full: rewrite(text),
							last: lastCompounds(text)[0] as Compound,
							prefixes: prefixes.map(rewrite),
						});
					} catch {
						// A selector the rewrite cannot read names nothing we can test.
					}
				}
			}).processSync(rule.selector);
		});
	});
	return out;
}

/** "sections/pdf-forms.css" → "sections/pdf" when another file shares the "pdf-" start; else by file. */
function placeOf(path: string, all: string[]): string {
	const [folder = "", file = ""] = path.split("/");
	if (folder !== "sections") return folder;
	const name = file.replace(/\.css$/, "");
	const start = name.split("-")[0] ?? name;
	const shared = all.filter((p) => p.startsWith(`sections/${start}-`)).length > 1;
	return `sections/${shared ? start : name}`;
}

export interface Group {
	/** The source file the items are listed under: the one with most of their rules. */
	file: string;
	items: string[];
}

export interface Section {
	/** "global", "markdown", "sections/canvas", "other". */
	id: string;
	groups: Group[];
}

export interface Organization {
	sections: Section[];
	/** Items styled from more than one place, with every file that styles them. */
	overlaps: { item: string; files: string[] }[];
}

/**
 * One place for every item. `named` lists, per item, the files with a rule that names the item
 * itself; `selected` the files with any rule that selects its element.
 *
 * An item named from more than one place is an overlap: it is listed under Global, where its
 * rules belong. Otherwise it sits in the place that names it, or failing that the place whose
 * rules select it (Global first when several do). An item no file reaches goes under "other".
 */
export function organize(
	styled: { selected: Record<string, string[]>; named: Record<string, string[]> },
	items: string[],
	paths: string[],
): Organization {
	// Only folders whose files style elements own items; settings and components hold no rules of their own.
	const owning = (list: string[] | undefined) =>
		(list ?? []).filter((path) => /^(global|markdown|sections)\//.test(path)).sort();
	const placesOf = (files: string[]) => [...new Set(files.map((f) => placeOf(f, paths)))];
	const overlaps: Organization["overlaps"] = [];
	const placed = new Map<string, Map<string, string[]>>();
	for (const item of [...items].sort()) {
		const named = owning(styled.named[item]);
		const selected = owning(styled.selected[item]);
		const overlap = placesOf(named).length > 1;
		if (overlap) overlaps.push({ item, files: named });
		const files = named.length ? named : selected;
		const places = placesOf(files);
		const section =
			places.length === 0
				? "other"
				: overlap || places.includes("global")
					? "global"
					: (places[0] as string);
		// Listed under a file of its own section.
		const file = files.find((f) => placeOf(f, paths) === section) ?? files[0] ?? "";
		const groups = placed.get(section) ?? new Map<string, string[]>();
		placed.set(section, groups);
		groups.set(file, [...(groups.get(file) ?? []), item]);
	}
	const order = (id: string) => ["global", "markdown"].indexOf(id) + (id === "other" ? 99 : 0);
	const rank = (id: string) => (order(id) === -1 ? 50 : order(id));
	return {
		sections: [...placed]
			.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
			.map(([id, groups]) => ({
				id,
				groups: [...groups]
					.sort((a, b) => a[0].localeCompare(b[0]))
					.map(([file, list]) => ({ file, items: list })),
			})),
		overlaps,
	};
}
