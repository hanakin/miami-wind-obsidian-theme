import type { CompareState } from "./types.ts";

interface CompareFixture {
	id: string;
	status?: unknown;
	notProvenReasons?: unknown;
	/** The verdict before acceptance was applied. */
	comparisonStatus?: unknown;
	acceptanceReason?: unknown;
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
		if (f.status === "same" || f.status === "different") out[f.id] = { status: f.status };
		else if (f.status === "not-proven") {
			const reasons = Array.isArray(f.notProvenReasons) ? f.notProvenReasons.map(String) : [];
			out[f.id] = { status: "not-proven", reasons };
		} else if (f.status === "accepted" || f.comparisonStatus === "accepted") {
			const reason = typeof f.acceptanceReason === "string" ? f.acceptanceReason : "";
			out[f.id] = { status: "accepted", reason: reason || "no reason recorded" };
		} else if (typeof f.status === "string") {
			// A status this viewer does not know yet is never read as "same".
			out[f.id] = { status: "not-proven", reasons: [`unknown status "${f.status}"`] };
		} else return `compare.json has no status for ${f.id}; rerun bun run compare.`;
	}
	return out;
}

type Place = { id: string; component: string; surface: string };

/**
 * The verdict for one component in one place, from the data alone: over its own captures there.
 * Undefined when the place has no capture of the component itself. A capture the compare tool has
 * no result for counts as not proven, never as same.
 */
export function rowState(
	component: string,
	surface: string,
	fixtures: Place[],
	compare: Record<string, CompareState> | null,
): CompareState | undefined {
	const own = fixtures.filter((f) => f.surface === surface && f.component === component);
	if (own.length === 0) return undefined;
	return combine(own.map((f) => compare?.[f.id] ?? NOT_COMPARED));
}

const NOT_COMPARED: CompareState = { status: "not-proven", reasons: ["not compared yet"] };
// Worst first: what a page's dot and a group of captures report.
const SEVERITY = ["different", "not-proven", "accepted", "same"] as const;

export interface PageSummary {
	same: number;
	different: number;
	"not-proven": number;
	accepted: number;
	/** Places the component is used in that have no capture of the component itself. */
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
): PageSummary {
	const out: PageSummary = {
		same: 0,
		different: 0,
		"not-proven": 0,
		accepted: 0,
		noCapture: 0,
		worst: undefined,
	};
	for (const surface of surfaces) {
		const state = rowState(component, surface, fixtures, compare);
		if (state) out[state.status]++;
		else out.noCapture++;
	}
	out.worst = SEVERITY.find((s) => out[s] > 0);
	return out;
}

/**
 * One verdict for several captures: any proven difference wins, then anything not proven, then an
 * accepted change. Only when every capture is proven the same is the group the same.
 */
export function combine(states: CompareState[]): CompareState {
	if (states.some((s) => s.status === "different")) return { status: "different" };
	const reasons = [...new Set(states.flatMap((s) => (s.status === "not-proven" ? s.reasons : [])))];
	if (states.some((s) => s.status === "not-proven") || states.length === 0) {
		return { status: "not-proven", reasons: reasons.length ? reasons : ["not compared yet"] };
	}
	const accepted = states.filter((s) => s.status === "accepted");
	if (accepted.length) {
		return { status: "accepted", reason: [...new Set(accepted.map((s) => s.reason))].join("; ") };
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
	/** Every property that changes this way, most common first. */
	properties: string[];
	before: string | null;
	after: string | null;
	/** How many element properties change this way. */
	count: number;
	/** True when it is on an element whose change was accepted as intentional. */
	accepted: boolean;
}

// Logical twins (border-block-end-color) repeat what the physical property already says.
const LOGICAL = /-(block|inline)(-|$)/;

/**
 * A capture's style differences boiled down to distinct changes, most common first. The compare
 * tool lists every element and property; most repeat the same change of value. `acceptedElements`
 * are the element keys the compare tool accepted (its acceptanceScope), pseudo-elements included.
 */
export function changes(
	differences: Difference[],
	acceptedElements: string[] = [],
	limit = 30,
): { total: number; list: Change[] } {
	const byChange = new Map<string, Change & { seen: Map<string, number> }>();
	for (const { element, property, before, after } of differences) {
		if (LOGICAL.test(property)) continue;
		const accepted = acceptedElements.includes(element?.split("::")[0] ?? "");
		const key = `${before}\n${after}\n${accepted}`;
		const change = byChange.get(key) ?? {
			properties: [],
			before,
			after,
			count: 0,
			accepted,
			seen: new Map(),
		};
		change.count++;
		change.seen.set(property, (change.seen.get(property) ?? 0) + 1);
		byChange.set(key, change);
	}
	const list = [...byChange.values()]
		.sort((a, b) => b.count - a.count)
		.map(({ seen, ...change }) => ({
			...change,
			properties: [...seen].sort((a, b) => b[1] - a[1]).map(([property]) => property),
		}));
	return { total: list.length, list: list.slice(0, limit) };
}
