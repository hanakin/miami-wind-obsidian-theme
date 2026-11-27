import { matchesElement, mayMatchElement } from "./elements.ts";
import type { CompareState } from "./types.ts";
import { itemName, kinds, plainProperty } from "./words.ts";

interface CompareFixture {
	id: string;
	status?: unknown;
	notProvenReasons?: unknown;
}

/**
 * Per-fixture verdicts from the compare tool's compare.json. Only schemaVersion 1 with a
 * per-fixture `status` is understood; anything else (an error report, another schema) gives an
 * error string instead.
 */
export function compareStates(json: unknown): Record<string, CompareState> | string {
	const report = json as { schemaVersion?: unknown; fixtures?: unknown; error?: unknown };
	if (report?.schemaVersion !== 1 || !Array.isArray(report.fixtures)) {
		return typeof report?.error === "string"
			? `The last compare run failed: ${report.error}`
			: "compare.json is not schemaVersion 1.";
	}
	const out: Record<string, CompareState> = {};
	for (const f of report.fixtures as CompareFixture[]) {
		const reasons = Array.isArray(f.notProvenReasons) ? f.notProvenReasons.map(String) : [];
		// `status` alone decides. An unresolved reason outranks everything but a proven difference:
		// a capture with one is never same.
		if (f.status === "different") out[f.id] = { status: "different" };
		else if (reasons.length || f.status === "not-proven") {
			out[f.id] = { status: "not-proven", reasons };
		} else if (f.status === "same") out[f.id] = { status: "same" };
		else if (typeof f.status === "string") {
			// A status this viewer does not know yet is never read as "same".
			out[f.id] = { status: "not-proven", reasons: [`unknown status "${f.status}"`] };
		} else return `compare.json has no status for ${f.id}; rerun bun run compare.`;
	}
	return out;
}

type Place = { id: string; component: string; surface: string };

/** A place's verdict, and whether it rests on larger captures around the component. */
export interface PlaceVerdict {
	state: CompareState;
	/** True when the place has no capture of the component itself. */
	inside: boolean;
	/** How many captures the verdict rests on. */
	captures: number;
	/** Each not-proven reason with the number of captures it applies to, most common first. */
	reasons: [reason: string, captures: number][];
}

/** Counts each not-proven reason over a set of capture verdicts. */
function tally(states: CompareState[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const s of states) {
		for (const r of s.status === "not-proven" ? new Set(s.reasons) : []) {
			counts.set(r, (counts.get(r) ?? 0) + 1);
		}
	}
	return [...counts].sort((a, b) => b[1] - a[1]);
}

const NOT_COMPARED: CompareState = {
	status: "not-proven",
	reasons: ["not checked with these sides"],
};
/** Said when a capture differs, but not on an element that is surely the component's. */
export const changedElsewhere = (component: string) =>
	`a change in this capture, not on the ${component} itself`;

/** One capture's verdict. A capture the compare tool has no result for is not proven. */
export const captureState = (compare: Record<string, CompareState> | null, id: string) =>
	compare?.[id] ?? NOT_COMPARED;

/**
 * The verdict for one component in one place, from the data alone. `fixtures` are the captures
 * the component appears in; `touched` lists, per capture, the components with a recorded
 * difference on their own elements.
 *
 * The component's own captures there decide, or, when it has none, every larger capture that
 * contains it. One rule for both: a capture counts as differing for this component
 * only when its change lands on the component's own elements. A change elsewhere in the capture
 * is not proven, never same. Undefined only when no capture contains the component there.
 */
export function rowState(
	component: string,
	surface: string,
	fixtures: Place[],
	compare: Record<string, CompareState> | null,
	touched: Record<string, string[]> = {},
): PlaceVerdict | undefined {
	const here = fixtures.filter((f) => f.surface === surface);
	if (here.length === 0) return undefined;
	const own = here.filter((f) => f.component === component);
	// The component's own captures, or every capture that contains it when it has none. Either
	// way, a larger capture with a difference on this component's own elements is counted too:
	// a real change to the component is never left out because it was seen inside something else.
	const judged = own.length
		? [...own, ...here.filter((f) => changedIn(component, f, compare, touched))]
		: here;
	const states = [...new Set(judged)].map((f) => stateFor(component, f.id, compare, touched));
	return {
		state: combine(states),
		inside: own.length === 0,
		captures: states.length,
		reasons: tally(states),
	};
}

/** True for a larger capture that differs on this component's own elements. */
export function changedIn(
	component: string,
	capture: Place,
	compare: Record<string, CompareState> | null,
	touched: Record<string, string[]>,
): boolean {
	return (
		capture.component !== component &&
		compare?.[capture.id]?.status === "different" &&
		(touched[capture.id]?.includes(component) ?? false)
	);
}

/** What one capture says about one component: its change counts only when it is on the component. */
export function stateFor(
	component: string,
	id: string,
	compare: Record<string, CompareState> | null,
	touched: Record<string, string[]>,
): CompareState {
	const state = captureState(compare, id);
	if (state.status === "same" || state.status === "not-proven") return state;
	if (touched[id]?.includes(component)) return state;
	return { status: "not-proven", reasons: [changedElsewhere(component)] };
}

// Worst first: what a page's dot and a group of captures report.
const SEVERITY = ["different", "not-proven", "same"] as const;

export interface PageSummary {
	same: number;
	different: number;
	"not-proven": number;
	/** Places no capture contains the component in. */
	noCapture: number;
	/** The worst verdict among the places that have one. */
	worst: CompareState["status"] | undefined;
}

/** Counts a component's places by verdict. The page header and the sidebar dot both read this. */
export function pageSummary(
	component: string,
	surfaces: string[],
	fixtures: Place[],
	compare: Record<string, CompareState> | null,
	touched: Record<string, string[]> = {},
): PageSummary {
	const out: PageSummary = {
		same: 0,
		different: 0,
		"not-proven": 0,
		noCapture: 0,
		worst: undefined,
	};
	for (const surface of surfaces) {
		const place = rowState(component, surface, fixtures, compare, touched);
		if (place) out[place.state.status]++;
		else out.noCapture++;
	}
	out.worst = SEVERITY.find((s) => out[s] > 0);
	return out;
}

/**
 * One verdict for several captures: any proven difference wins, then anything not proven. Only
 * when every capture is proven the same is the group the same.
 */
export function combine(states: CompareState[]): CompareState {
	if (states.some((s) => s.status === "different")) return { status: "different" };
	const reasons = [...new Set(states.flatMap((s) => (s.status === "not-proven" ? s.reasons : [])))];
	if (states.some((s) => s.status === "not-proven") || states.length === 0) {
		return {
			status: "not-proven",
			reasons: reasons.length ? reasons : ["not checked with these sides"],
		};
	}
	return { status: "same" };
}

interface Difference {
	/** The compare tool's element key, with "::pseudo" appended for pseudo-elements. */
	element?: string;
	property: string;
	before: string | null;
	after: string | null;
}

/** One kind of change in a capture: properties going from one value to the same other value. */
export interface Change {
	/** What changed, in plain words: "Text color", "Padding left". */
	what: string;
	/** The items it is on, in plain words: "link brackets and 1 other item". */
	items: string;
	/** The same items by their code names, for looking them up. */
	code: string[];
	/** Components with one of these items surely among their own elements. */
	components: string[];
	/** Components one of these items might belong to; the report cannot tell (no attributes). */
	maybe: string[];
	/** Every property that changes this way, most common first. */
	properties: string[];
	before: string | null;
	after: string | null;
	/** How many element properties change this way. */
	count: number;
}

// A logical property and the physical one it stands for in the captures' left-to-right pages.
const PHYSICAL: [RegExp, string][] = [
	[/block-start/, "top"],
	[/block-end/, "bottom"],
	[/inline-start/, "left"],
	[/inline-end/, "right"],
	[/block-size/, "height"],
	[/inline-size/, "width"],
];

/** "border-block-end-color" → "border-bottom-color"; undefined for a physical property. */
function physicalOf(property: string): string | undefined {
	const twin = PHYSICAL.find(([re]) => re.test(property));
	return twin && property.replace(twin[0], twin[1]);
}

/** "86:span.cm-underline.cm-link.x" → "span.cm-underline.cm-link": an item's code name. */
export const itemCode = (key: string) =>
	(key.split("::")[0] ?? "").replace(/^\d+:/, "").split(".").slice(0, 3).join(".");

/**
 * Names a group of properties that all go from one value to the same other value. A text color
 * change drags borders, outlines and decorations along with it (they follow the text color), so
 * a group that includes `color` is one text color change, not twelve.
 */
function nameOf(properties: string[]): string {
	if (properties.includes("color")) return "Text color";
	const [only] = properties;
	const plain =
		properties.length === 1 && only
			? plainProperty(only)
			: `${kinds(properties)} (${properties.length} properties)`;
	return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/**
 * A capture's style differences boiled down to distinct changes, most common first: every one of
 * them, however many. The compare tool lists every element and property; most repeat the same
 * change of value. Differences are grouped only when they also sit on items with the same owners,
 * so a change on an item no component owns is never folded into a component's change.
 *
 * `selectors` maps the components found in the capture to their
 * selector lists, to say which component each change is on.
 */
export function changes(
	differences: Difference[],
	selectors: Record<string, string> = {},
): { total: number; list: Change[] } {
	type Group = Pick<Change, "before" | "after" | "count" | "components" | "maybe"> & {
		seen: Map<string, number>;
		on: Set<string>;
	};
	const names = Object.keys(selectors);
	// What was recorded for each item, to tell a logical property that only repeats a physical one.
	const recorded = new Set(
		differences.map((d) => `${d.element}\n${d.property}\n${d.before}\n${d.after}`),
	);
	const byChange = new Map<string, Group>();
	for (const { element, property, before, after } of differences) {
		const twin = physicalOf(property);
		if (twin && recorded.has(`${element}\n${twin}\n${before}\n${after}`)) continue;
		const item = element?.split("::")[0] ?? "";
		const components = names.filter((c) => matchesElement(selectors[c] ?? "", item));
		const maybe = names.filter(
			(c) => !components.includes(c) && mayMatchElement(selectors[c] ?? "", item),
		);
		const key = [before, after, components, maybe].join("\n");
		const change = byChange.get(key) ?? {
			before,
			after,
			count: 0,
			components,
			maybe,
			seen: new Map(),
			on: new Set(),
		};
		change.count++;
		change.seen.set(property, (change.seen.get(property) ?? 0) + 1);
		change.on.add(item);
		byChange.set(key, change);
	}
	const list = [...byChange.values()]
		.sort((a, b) => b.count - a.count)
		.map(({ seen, on, ...change }): Change => {
			const properties = [...seen].sort((a, b) => b[1] - a[1]).map(([property]) => property);
			const code = [...new Set([...on].map(itemCode))];
			const plain = [...new Set(code.map(itemName))];
			const others = plain.length - 1;
			return {
				what: nameOf(properties),
				items: `${plain[0]}${others > 0 ? ` and ${others} other ${others === 1 ? "item" : "items"}` : ""}`,
				code,
				...change,
				properties,
			};
		});
	return { total: list.length, list };
}
