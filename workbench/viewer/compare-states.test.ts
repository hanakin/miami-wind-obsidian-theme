import { expect, it } from "vitest";
import { combine, compareStates, rowState } from "./compare-states.ts";
import type { CompareState } from "./types.ts";

it("reads the three statuses and keeps not-proven reasons", () => {
	expect(
		compareStates({
			schemaVersion: 1,
			fixtures: [
				{ id: "a", status: "different", same: false },
				{ id: "b", status: "same", same: true },
				{ id: "c", status: "not-proven", same: false, notProvenReasons: ["canvas content"] },
				{
					id: "d",
					status: "accepted",
					comparisonStatus: "different",
					same: false,
					acceptanceReason: "new form field look",
				},
				{ id: "e", status: "something-new", same: true },
			],
		}),
	).toEqual({
		a: { status: "different" },
		b: { status: "same" },
		c: { status: "not-proven", reasons: ["canvas content"] },
		d: { status: "accepted", reason: "new form field look" },
		e: { status: "not-proven", reasons: ['unknown status "something-new"'] },
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
	const accepted: CompareState = { status: "accepted", reason: "intentional" };
	expect(combine([same, accepted])).toEqual(accepted);
	expect(combine([accepted, unproven])).toEqual(unproven);
});

it("judges a row with no capture of its own by every capture that contains the component", () => {
	const fixtures = [
		{ id: "small", component: "menu", surface: "modal" },
		{ id: "large", component: "window", surface: "modal" },
		{ id: "own", component: "button", surface: "settings" },
		{ id: "around", component: "window", surface: "settings" },
	];
	const compare: Record<string, CompareState> = {
		small: { status: "same" },
		large: { status: "different" },
		own: { status: "same" },
		around: { status: "different" },
	};
	// Two fallback captures, one same and one different: never "same", whichever is previewed.
	expect(rowState("button", "modal", fixtures, compare)).toEqual({ status: "different" });
	expect(rowState("button", "modal", fixtures.toReversed(), compare)).toEqual({
		status: "different",
	});
	// A capture of the component itself decides its own row.
	expect(rowState("button", "settings", fixtures, compare)).toEqual({ status: "same" });
	expect(rowState("button", "modal", fixtures, null)).toBeUndefined();
});
