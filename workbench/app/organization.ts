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
	/** The selector as written, and the line its rule starts on. */
	selector: string;
	line: number;
	/**
	 * True for a section's labeled, scoped adjustment of a shared item: the rule sits under a
	 * "Shared component adjustment" comment and reaches the item through a container.
	 */
	adjustment: boolean;
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
	"An overlap is one item styled from two top-level places: global, markdown, or one app section (sections/<x>, with pdf-*.css counted as PDF). Several files inside one place are fine. The fix is always to move its rules into global/.",
	'A section may adjust a shared item: a rule under a "Shared component adjustment" comment that reaches the item through a container (.bases-view .clickable-icon) is allowed and is not an overlap.',
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

const ADJUSTMENT = /shared component adjustment/i;

/** Every selector in the source files that can own an item (see RULES). */
export function probes(
	files: { path: string; css: string }[],
	rewrite: (selector: string) => string,
): Probe[] {
	const out: Probe[] = [];
	files.forEach(({ css }, file) => {
		// The comment a rule sits under labels it: the last comment before it in the file.
		let label = "";
		postcss.parse(css).walk((node) => {
			if (node.type === "comment") label = node.text;
			if (node.type !== "rule") return;
			const rule = node;
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
					const scoped = selector.nodes.some((n) => n.type === "combinator");
					try {
						out.push({
							file,
							full: rewrite(text),
							last: lastCompounds(text)[0] as Compound,
							selector: text,
							line: rule.source?.start?.line ?? 0,
							adjustment: scoped && ADJUSTMENT.test(label),
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
	// pdf.css and pdf-xfa.css are both the PDF section.
	const family = all.filter(
		(p) => p === `sections/${start}.css` || p.startsWith(`sections/${start}-`),
	);
	return `sections/${family.length > 1 ? start : name}`;
}

/** One source rule that reaches an item. */
export interface RuleHit {
	item: string;
	/** "global/inputs.css" */
	file: string;
	line: number;
	selector: string;
	/** True when the rule's last part names the item itself; false when it only selects its element. */
	named: boolean;
	adjustment: boolean;
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
	/** Items whose own styling is split across top-level places, with the rules that do it. */
	overlaps: { item: string; files: string[]; rules: string[] }[];
	/** Shared items a section adjusts, with the files that adjust them. Allowed; shown on the page. */
	adjusted: Record<string, string[]>;
}

/**
 * One place for every item, from the rules that reach it.
 *
 * An item named from more than one top-level place is an overlap: it is listed under Global,
 * where its rules belong. A section's labeled, scoped adjustment of a shared item is not an
 * overlap; it is noted. Otherwise an item sits in the place that names it, or failing that the
 * place whose rules select its element (Global first when several do). An item no rule reaches
 * goes under "other".
 */
export function organize(hits: RuleHit[], items: string[], paths: string[]): Organization {
	// Only folders whose files style elements own items; settings and components hold no rules of their own.
	const owning = hits.filter((h) => /^(global|markdown|sections)\//.test(h.file));
	const filesOf = (list: RuleHit[]) => [...new Set(list.map((h) => h.file))].sort();
	const placesOf = (files: string[]) => [...new Set(files.map((f) => placeOf(f, paths)))];
	const overlaps: Organization["overlaps"] = [];
	const adjusted: Organization["adjusted"] = {};
	const placed = new Map<string, Map<string, string[]>>();
	for (const item of [...items].sort()) {
		const mine = owning.filter((h) => h.item === item);
		const base = mine.filter((h) => h.named && !h.adjustment);
		const named = filesOf(base);
		const overlap = placesOf(named).length > 1;
		if (overlap) {
			overlaps.push({
				item,
				files: named,
				rules: base
					.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
					.map((h) => `src/${h.file}:${h.line}  ${h.selector}`),
			});
		}
		const adjustments = filesOf(mine.filter((h) => h.named && h.adjustment));
		// Listed by the rules that name it; failing that by any rule that reaches it, and only
		// then by an adjustment (an item with nothing but adjustments still needs a home).
		const reached = filesOf(mine.filter((h) => !h.adjustment));
		const files = named.length ? named : reached.length ? reached : adjustments;
		const places = placesOf(files);
		const section =
			places.length === 0
				? "other"
				: overlap || places.includes("global")
					? "global"
					: (places[0] as string);
		// An adjustment made in the item's own place is just part of its styling.
		const elsewhere = adjustments.filter((f) => placeOf(f, paths) !== section);
		if (elsewhere.length) adjusted[item] = elsewhere;
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
		adjusted,
	};
}
