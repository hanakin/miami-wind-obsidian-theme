import { expect, it } from "vitest";
import { compareStates } from "./compare-states.ts";

it("keeps hidden and unsupported fixtures apart from changed ones", () => {
	expect(
		compareStates({
			schemaVersion: 1,
			fixtures: [
				{ id: "a", same: false, invisibleTarget: false, unsupported: [] },
				{ id: "b", same: true, invisibleTarget: false, unsupported: [] },
				{ id: "c", same: false, invisibleTarget: true, unsupported: [] },
				{ id: "d", same: false, invisibleTarget: false, unsupported: ["canvas", "canvas"] },
			],
		}),
	).toEqual({
		a: { kind: "changed" },
		b: { kind: "same" },
		c: { kind: "hidden" },
		d: { kind: "unsupported", what: ["canvas"] },
	});
});

it("rejects other schemas and error reports", () => {
	expect(compareStates({ schemaVersion: 2, fixtures: [] })).toBe(
		"compare.json is not schemaVersion 1.",
	);
	expect(compareStates({ status: "error", error: "SANITY FAILED" })).toBe(
		"The last compare run failed: SANITY FAILED",
	);
});
