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
	/**
	 * The selector cut before each of its later parts: `.a .b > .c` gives `.a` and `.a .b`. A rule
	 * that styles something inside an item counts for the item only when one of these is the item.
	 */
	prefixes: string[];
}

/** Every selector of every rule in the source files, with its prefixes. */
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
			selectorParser((root) => {
				for (const selector of root.nodes) {
					const prefixes: string[] = [];
					let sofar = "";
					for (const node of selector.nodes) {
						if (node.type === "combinator" && sofar.trim()) prefixes.push(sofar.trim());
						sofar += node.toString();
					}
					// `.view ::selection` styles selected text anywhere inside: it names no item.
					if (/(^|[\s>+~])::[\w-]+$/.test(sofar.trim())) continue;
					try {
						out.push({ file, full: rewrite(sofar.trim()), prefixes: prefixes.map(rewrite) });
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
 * One place for every item. An item styled from a single place sits there. An item styled from
 * more than one place is an overlap: it is listed under Global, where its rules belong. An item
 * no source file styles on its own goes under "other".
 */
export function organize(
	styled: Record<string, string[]>,
	items: string[],
	paths: string[],
): Organization {
	// Only folders whose files style elements own items; settings and components hold no rules of their own.
	const owning = paths.filter((p) => /^(global|markdown|sections)\//.test(p));
	const overlaps: Organization["overlaps"] = [];
	const placed = new Map<string, Map<string, string[]>>();
	for (const item of [...items].sort()) {
		const files = (styled[item] ?? []).filter((path) => owning.includes(path)).sort();
		const places = [...new Set(files.map((f) => placeOf(f, paths)))];
		if (places.length > 1) overlaps.push({ item, files });
		const section =
			places.length === 0 ? "other" : places.length > 1 ? "global" : (places[0] as string);
		// Under Global, an overlap is listed by its global file when it has one.
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
