import type { CompareState } from "./types.ts";

interface CompareFixture {
	id: string;
	same: boolean;
	invisibleTarget?: boolean;
	unsupported?: string[];
}

/**
 * Per-fixture verdicts from the compare tool's compare.json. Only schemaVersion 1 is understood;
 * anything else (an error report, a newer schema) gives an error string instead.
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
		// A hidden target or content the replay cannot draw is not evidence either way.
		if (f.invisibleTarget) out[f.id] = { kind: "hidden" };
		else if (f.unsupported?.length) {
			out[f.id] = { kind: "unsupported", what: [...new Set(f.unsupported)] };
		} else out[f.id] = { kind: f.same ? "same" : "changed" };
	}
	return out;
}
