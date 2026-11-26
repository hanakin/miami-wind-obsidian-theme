import { expect, it } from "vitest";
import {
	CHANGED_ELSEWHERE,
	changes,
	combine,
	compareStates,
	pageSummary,
	rowState,
} from "./compare-states.ts";
import { touchedComponents } from "./elements.ts";
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

const same: CompareState = { status: "same" };
const different: CompareState = { status: "different" };
const unproven: CompareState = { status: "not-proven", reasons: ["hidden target"] };
const accepted: CompareState = { status: "accepted", reason: "intentional" };

it("never calls a group the same unless every capture is proven the same", () => {
	expect(combine([same, same])).toEqual(same);
	expect(combine([same, unproven])).toEqual(unproven);
	expect(combine([same, unproven, different])).toEqual(different);
	expect(combine([same, accepted])).toEqual(accepted);
	expect(combine([accepted, unproven])).toEqual(unproven);
	expect(combine([])).toEqual({ status: "not-proven", reasons: ["not compared yet"] });
});

const fixtures = [
	{ id: "own-a", component: "button", surface: "settings" },
	{ id: "own-b", component: "button", surface: "settings" },
	{ id: "around-1", component: "menu", surface: "modal" },
	{ id: "around-2", component: "window", surface: "modal" },
	{ id: "phone", component: "button", surface: "mobile-phone" },
];
const compare: Record<string, CompareState> = {
	"own-a": same,
	"own-b": different,
	"around-1": same,
	"around-2": different,
};

it("judges a row from the data alone, whatever order the captures come in", () => {
	for (const list of [fixtures, fixtures.toReversed()]) {
		// One same and one different capture of the component itself: never "same".
		expect(rowState("button", "settings", list, compare)).toEqual({
			state: different,
			inside: false,
		});
		// No capture there contains the component at all.
		expect(rowState("button", "canvas", list, compare)).toBeUndefined();
	}
	// No result for a capture is not proven, with or without a compare run.
	const notCompared = { status: "not-proven", reasons: ["not compared yet"] };
	expect(rowState("button", "mobile-phone", fixtures, compare)?.state).toEqual(notCompared);
	expect(rowState("button", "settings", fixtures, null)?.state).toEqual(notCompared);
});

it("judges a place seen only inside larger captures by every one of them", () => {
	const elsewhere = { status: "not-proven", reasons: [CHANGED_ELSEWHERE] };
	for (const list of [fixtures, fixtures.toReversed()]) {
		// A larger capture differs, but not on the button itself: cannot be ruled out.
		expect(rowState("button", "modal", list, compare)).toEqual({ state: elsewhere, inside: true });
		// The difference lands on the button's own elements.
		expect(rowState("button", "modal", list, compare, { "around-2": ["button"] })?.state).toEqual(
			different,
		);
		// Every larger capture is proven the same.
		const allSame = { ...compare, "around-2": same };
		expect(rowState("button", "modal", list, allSame)?.state).toEqual(same);
		// One of them is not proven.
		const oneUnproven = { ...compare, "around-2": same, "around-1": unproven };
		expect(rowState("button", "modal", list, oneUnproven)?.state).toEqual(unproven);
		// An accepted change counts for the component only when it is surely on the component.
		// Elsewhere (a sibling, or an element the key cannot identify) it proves nothing.
		const oneAccepted = { ...compare, "around-2": accepted };
		expect(rowState("button", "modal", list, oneAccepted)?.state).toEqual(elsewhere);
		expect(rowState("button", "modal", list, oneAccepted, { "around-2": ["menu"] })?.state).toEqual(
			elsewhere,
		);
		expect(
			rowState("button", "modal", list, oneAccepted, { "around-2": ["button"] })?.state,
		).toEqual(accepted);
	}
});

it("counts a page's places, and its dot is the worst of them", () => {
	const surfaces = ["settings", "modal", "mobile-phone", "canvas"];
	expect(pageSummary("button", surfaces, fixtures, compare)).toEqual({
		same: 0,
		different: 1,
		"not-proven": 2,
		accepted: 0,
		noCapture: 1,
		worst: "different",
	});
	expect(pageSummary("button", ["mobile-phone"], fixtures, { phone: accepted }).worst).toBe(
		"accepted",
	);
	expect(pageSummary("button", ["canvas"], fixtures, compare).worst).toBeUndefined();
});

it("boils a capture's differences down to distinct changes, most common first", () => {
	const d = (element: string, property: string, before: string, after: string) => ({
		element,
		property,
		before,
		after,
	});
	expect(
		changes(
			[
				d("1:a", "color", "red", "blue"),
				d("2:p", "border-top-color", "grey", "black"),
				d("3:p", "border-top-color", "grey", "black"),
				d("3:p", "border-bottom-color", "grey", "black"),
				// A logical twin of border-top-color says nothing new.
				d("3:p", "border-block-start-color", "grey", "black"),
				// The accepted element and its pseudo-element, apart from the same change elsewhere.
				d("9:select", "color", "red", "blue"),
				d("9:select::before", "color", "red", "blue"),
			],
			["9:select"],
		),
	).toEqual({
		total: 3,
		list: [
			{
				properties: ["border-top-color", "border-bottom-color"],
				before: "grey",
				after: "black",
				count: 3,
				accepted: false,
			},
			{ properties: ["color"], before: "red", after: "blue", count: 2, accepted: true },
			{ properties: ["color"], before: "red", after: "blue", count: 1, accepted: false },
		],
	});
});

it("never reads accepted or same when reasons are unresolved or the status is unknown", () => {
	const read = (fixture: object) =>
		(
			compareStates({ schemaVersion: 1, fixtures: [{ id: "x", ...fixture }] }) as Record<
				string,
				CompareState
			>
		).x;
	// Accepted with an unresolved reason is not proven (the compare tool exits 2 for it).
	expect(read({ status: "accepted", notProvenReasons: ["canvas content"] })).toEqual({
		status: "not-proven",
		reasons: ["canvas content"],
	});
	expect(read({ status: "same", notProvenReasons: ["canvas content"] })?.status).toBe("not-proven");
	// `status` is authoritative: another field saying accepted changes nothing.
	expect(read({ status: "new-unknown-status", comparisonStatus: "accepted" })).toEqual({
		status: "not-proven",
		reasons: ['unknown status "new-unknown-status"'],
	});
	// A proven difference stays a difference even with coverage limits.
	expect(read({ status: "different", notProvenReasons: ["canvas content"] })).toEqual(different);
	expect(read({ status: "accepted", acceptanceReason: "intentional" })).toEqual(accepted);
});

it("does not read a checkbox as same when an accepted change sits on an input the key cannot identify", () => {
	const captures = [{ id: "around", component: "task", surface: "editor-reading-view" }];
	const touched = {
		around: touchedComponents(
			[{ element: "2:input.task-list-item-checkbox" }],
			["checkbox", "task"],
			{ checkbox: "input[type=checkbox]", task: ".task-list-item" },
		),
	};
	expect(touched.around).toEqual([]);
	expect(
		rowState("checkbox", "editor-reading-view", captures, { around: accepted }, touched)?.state,
	).toEqual({ status: "not-proven", reasons: [CHANGED_ELSEWHERE] });
});
