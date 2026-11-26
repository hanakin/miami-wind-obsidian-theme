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

/**
 * The verdict for one component on one surface: over its own captures there, or, when it has
 * none, over every capture on that surface that contains it. Which capture the row previews
 * never changes this.
 */
export function rowState(
	component: string,
	surface: string,
	fixtures: { id: string; component: string; surface: string }[],
	compare: Record<string, CompareState> | null,
): CompareState | undefined {
	if (!compare) return undefined;
	const here = fixtures.filter((f) => f.surface === surface);
	const own = here.filter((f) => f.component === component);
	return combine((own.length ? own : here).map((f) => compare[f.id]));
}

/**
 * One verdict for several captures: any proven difference wins, then anything not proven, then an
 * accepted change. Only when every capture is proven the same is the group the same. Undefined when nothing was compared.
 */
export function combine(states: (CompareState | undefined)[]): CompareState | undefined {
	const known = states.filter((s) => s !== undefined);
	if (known.length === 0) return undefined;
	if (known.some((s) => s.status === "different")) return { status: "different" };
	const reasons = [...new Set(known.flatMap((s) => (s.status === "not-proven" ? s.reasons : [])))];
	if (known.some((s) => s.status === "not-proven") || known.length < states.length) {
		return { status: "not-proven", reasons: reasons.length ? reasons : ["not compared"] };
	}
	const accepted = known.filter((s) => s.status === "accepted");
	if (accepted.length) {
		return { status: "accepted", reason: [...new Set(accepted.map((s) => s.reason))].join("; ") };
	}
	return { status: "same" };
}
