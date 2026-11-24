import { expect, it } from "vitest";
import { combine, compareStates } from "./compare-states.ts";
import type { CompareState } from "./types.ts";

it("reads the three statuses and keeps not-proven reasons", () => {
	expect(
		compareStates({
			schemaVersion: 1,
			fixtures: [
				{ id: "a", status: "different", same: false },
				{ id: "b", status: "same", same: true },
				{ id: "c", status: "not-proven", same: false, notProvenReasons: ["canvas content"] },
			],
		}),
	).toEqual({
		a: { status: "different" },
		b: { status: "same" },
		c: { status: "not-proven", reasons: ["canvas content"] },
	});
});

it("rejects other schemas, error reports and reports without statuses", () => {
	expect(compareStates({ schemaVersion: 2, fixtures: [] })).toBe(
		"compare.json is not schemaVersion 1.",
	);
	expect(compareStates({ status: "error", error: "SANITY FAILED" })).toBe(
		"The last compare run failed: SANITY FAILED",
	);
	expect(compareStates({ schemaVersion: 1, fixtures: [{ id: "a", same: true }] })).toContain(
		"no status for a",
	);
});

it("never calls a group the same unless every capture is proven the same", () => {
	const same: CompareState = { status: "same" };
	const unproven: CompareState = { status: "not-proven", reasons: ["hidden target"] };
	expect(combine([same, same])).toEqual(same);
	expect(combine([same, unproven])).toEqual(unproven);
	expect(combine([same, undefined])).toEqual({ status: "not-proven", reasons: ["not compared"] });
	expect(combine([same, unproven, { status: "different" }])).toEqual({ status: "different" });
	expect(combine([undefined])).toBeUndefined();
});
