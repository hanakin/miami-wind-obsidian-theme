import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
	changedElsewhere,
	changes,
	combine,
	compareStates,
	itemCode,
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
				{ id: "e", status: "something-new", same: true },
			],
		}),
	).toEqual({
		a: { status: "different" },
		b: { status: "same" },
		c: { status: "not-proven", reasons: ["canvas content"] },
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

it("never calls a group the same unless every capture is proven the same", () => {
	expect(combine([same, same])).toEqual(same);
	expect(combine([same, unproven])).toEqual(unproven);
	expect(combine([same, unproven, different])).toEqual(different);
	expect(combine([])).toEqual({ status: "not-proven", reasons: ["not checked with these sides"] });
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

const elsewhere = { status: "not-proven", reasons: [changedElsewhere("button")] };

it("judges a row from the data alone, whatever order the captures come in", () => {
	for (const list of [fixtures, fixtures.toReversed()]) {
		// One same capture and one whose change is on the button itself: differs, never same.
		expect(rowState("button", "settings", list, compare, { "own-b": ["button"] })).toEqual({
			state: different,
			inside: false,
			captures: 2,
			reasons: [],
		});
		// No capture there contains the component at all.
		expect(rowState("button", "canvas", list, compare)).toBeUndefined();
	}
	// No result for a capture is not proven, with or without a compare run.
	const notCompared = { status: "not-proven", reasons: ["not checked with these sides"] };
	expect(rowState("button", "mobile-phone", fixtures, compare)?.state).toEqual(notCompared);
	expect(rowState("button", "settings", fixtures, null)?.state).toEqual(notCompared);
});

it("uses one rule for own and larger captures: a change counts only on the component itself", () => {
	for (const list of [fixtures, fixtures.toReversed()]) {
		for (const [place, id] of [
			["settings", "own-b"],
			["modal", "around-2"],
		] as const) {
			// The capture differs, but not on the button's own elements: not proven, with the reason.
			expect(rowState("button", place, list, compare)?.state).toEqual(elsewhere);
			expect(rowState("button", place, list, compare, { [id]: ["menu"] })?.state).toEqual(
				elsewhere,
			);
			// The change lands on the button's own elements.
			expect(rowState("button", place, list, compare, { [id]: ["button"] })?.state).toEqual(
				different,
			);
			// Every capture proven the same; then one of them not proven.
			const allSame = { ...compare, [id]: same };
			expect(rowState("button", place, list, allSame)?.state).toEqual(same);
			const other = place === "settings" ? "own-a" : "around-1";
			expect(rowState("button", place, list, { ...allSame, [other]: unproven })?.state).toEqual(
				unproven,
			);
		}
	}
	expect(rowState("button", "modal", fixtures, compare)).toEqual({
		state: elsewhere,
		inside: true,
		captures: 2,
		reasons: [[changedElsewhere("button"), 1]],
	});
});

it("counts a page's places, and its dot is the worst of them", () => {
	const surfaces = ["settings", "modal", "mobile-phone", "canvas"];
	expect(pageSummary("button", surfaces, fixtures, compare, { "own-b": ["button"] })).toEqual({
		same: 0,
		different: 1,
		"not-proven": 2,
		noCapture: 1,
		worst: "different",
	});
	expect(pageSummary("button", ["canvas"], fixtures, compare).worst).toBeUndefined();
});

const d = (element: string, property: string, before: string, after: string) => ({
	element,
	property,
	before,
	after,
});

it("boils a capture's differences down to distinct changes, most common first", () => {
	const found = changes(
		[
			// One text color change on something next to the tag: borders and outline follow it.
			d("86:span.cm-underline", "color", "blue", "green"),
			d("86:span.cm-underline", "border-top-color", "blue", "green"),
			d("86:span.cm-underline", "outline-color", "blue", "green"),
			d("86:span.cm-underline::before", "color", "blue", "green"),
			// A logical twin of border-top-color says nothing new.
			d("86:span.cm-underline", "border-block-start-color", "blue", "green"),
			d("4:a.tag", "padding-left", "4px", "6px"),
			d("5:a.tag", "padding-left", "4px", "6px"),
			// The same change on a dropdown and on an item no component owns: kept apart.
			d("9:select", "color", "red", "black"),
			d("7:div.unknown-thing", "color", "red", "black"),
			// An input the report cannot identify as the checkbox or not.
			d("2:input.task-list-item-checkbox", "width", "1px", "2px"),
		],
		{ tag: "a.tag, .cm-hashtag", dropdown: "select", checkbox: "input[type=checkbox]" },
	);
	expect(found.total).toBe(5);
	expect(found.list.map((c) => [c.what, c.items, c.components, c.maybe, c.count])).toEqual([
		["Text color", "link", [], [], 4],
		["Padding left", "tag", ["tag"], [], 2],
		["Text color", "dropdown", ["dropdown"], [], 1],
		["Text color", "div.unknown-thing", [], [], 1],
		["Width", "input field", [], ["checkbox"], 1],
	]);
	expect(found.list[0]?.properties).toEqual(["color", "border-top-color", "outline-color"]);
	expect(found.list[0]?.code).toEqual(["span.cm-underline"]);
});

it("returns every change, however many there are", () => {
	const many = Array.from({ length: 31 }, (_, i) =>
		d(`${i}:div.unowned`, "width", "1px", `${i + 2}px`),
	);
	const found = changes(many, { button: "button" });
	expect(found.total).toBe(31);
	expect(found.list).toHaveLength(31);
	expect(found.list.every((c) => c.components.length === 0)).toBe(true);
});

it("keeps an unowned item's change apart from a component's identical change", () => {
	const found = changes(
		[d("1:button", "color", "red", "blue"), d("2:div.unowned", "color", "red", "blue")],
		{ button: "button" },
	);
	// Same values, different owners: two changes, so the unowned one still reaches the untied list.
	expect(found.list.map((c) => [c.items, c.components])).toEqual([
		["button", ["button"]],
		["div.unowned", []],
	]);
});

it("drops a logical property only when its physical twin is recorded too", () => {
	const lone = changes([d("1:p", "margin-inline-start", "0px", "4px")]);
	expect(lone.list.map((c) => c.properties)).toEqual([["margin-inline-start"]]);
	const twins = changes([
		d("1:p", "margin-inline-start", "0px", "4px"),
		d("1:p", "margin-left", "0px", "4px"),
		// The same logical change on another item, with no physical twin there, stays.
		d("2:p", "margin-inline-start", "0px", "4px"),
	]);
	expect(twins.list.flatMap((c) => c.properties).sort()).toEqual([
		"margin-inline-start",
		"margin-left",
	]);
	expect(twins.list.reduce((n, c) => n + c.count, 0)).toBe(2);
});

/** True when a recorded difference shows up in the boiled-down list, itself or as its physical twin. */
function covered(
	list: ReturnType<typeof changes>["list"],
	x: { element: string; property: string; before: string | null; after: string | null },
): boolean {
	const logical: Record<string, string> = {
		"block-start": "top",
		"block-end": "bottom",
		"inline-start": "left",
		"inline-end": "right",
		"block-size": "height",
		"inline-size": "width",
	};
	const twin = Object.entries(logical).reduce((p, [from, to]) => p.replace(from, to), x.property);
	return list.some(
		(c) =>
			c.before === x.before &&
			c.after === x.after &&
			c.code.includes(itemCode(x.element)) &&
			(c.properties.includes(x.property) || c.properties.includes(twin)),
	);
}

it("loses no difference: every one appears in some change", () => {
	// Made-up differences across owners, values, pseudo-elements and logical twins.
	const elements = ["1:button", "2:div.unowned", "3:a.tag", "3:a.tag::before", "4:input.x"];
	const properties = ["color", "margin-inline-start", "margin-left", "width", "inline-size"];
	const made = elements.flatMap((element, i) =>
		properties.flatMap((property, j) =>
			(i + j) % 3 === 0 ? [] : [d(element, property, `${j}px`, `${(i * j) % 4}px`)],
		),
	);
	const found = changes(made, { button: "button", tag: "a.tag" });
	for (const x of made) expect(covered(found.list, x), JSON.stringify(x)).toBe(true);
});

const REPORT = "workbench/out/compare.json";
it.skipIf(!existsSync(REPORT))(
	"loses no difference in the compare report on disk",
	() => {
		const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
			fixtures?: { id: string; differences?: Parameters<typeof covered>[1][] }[];
		};
		let checked = 0;
		for (const f of report.fixtures ?? []) {
			const found = changes(f.differences ?? [], {
				button: "button",
				tag: "a.tag, .cm-hashtag",
			});
			for (const x of f.differences ?? []) {
				if (!covered(found.list, x)) throw new Error(`${f.id}: lost ${JSON.stringify(x)}`);
				checked++;
			}
		}
		console.log(`checked ${checked} differences`);
	},
	60_000,
);

it("counts each not-proven reason over the captures a place rests on", () => {
	const video: CompareState = { status: "not-proven", reasons: ["video", "audio"] };
	const audio: CompareState = { status: "not-proven", reasons: ["audio"] };
	const place = rowState(
		"embed",
		"canvas",
		["a", "b", "c"].map((id) => ({ id, component: "embed", surface: "canvas" })),
		{ a: video, b: audio, c: same },
	);
	expect(place?.captures).toBe(3);
	expect(place?.reasons).toEqual([
		["audio", 2],
		["video", 1],
	]);
});

it("never reads same when reasons are unresolved or the status is unknown", () => {
	const read = (fixture: object) =>
		(
			compareStates({ schemaVersion: 1, fixtures: [{ id: "x", ...fixture }] }) as Record<
				string,
				CompareState
			>
		).x;
	expect(read({ status: "same", notProvenReasons: ["canvas content"] })).toEqual({
		status: "not-proven",
		reasons: ["canvas content"],
	});
	// A status the workbench does not know (the retired "accepted" among them) is not proven.
	for (const status of ["new-unknown-status", "accepted"]) {
		expect(read({ status, comparisonStatus: "same" })).toEqual({
			status: "not-proven",
			reasons: [`unknown status "${status}"`],
		});
	}
	// A proven difference stays a difference even with coverage limits.
	expect(read({ status: "different", notProvenReasons: ["canvas content"] })).toEqual(different);
});

it("does not read a checkbox as same when a change sits on an input the key cannot identify", () => {
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
		rowState("checkbox", "editor-reading-view", captures, { around: different }, touched)?.state,
	).toEqual({ status: "not-proven", reasons: [changedElsewhere("checkbox")] });
});
