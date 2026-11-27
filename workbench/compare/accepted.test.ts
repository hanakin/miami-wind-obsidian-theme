import { PNG } from "pngjs";
import { expect, test } from "vitest";
import {
	acceptanceScope,
	acceptedOutcome,
	comparisonExitCode,
} from "./accepted";
import entries from "./accepted-differences.json";
import { type Difference, outcome } from "./model";
import { repeatedPixels } from "./pixels";

const verdict = (differences = 1, pixels = 0) =>
	outcome({
		differences,
		pixels,
		noise: false,
		invisible: false,
		unsupported: [],
		replayIssues: [],
	});
const match = {
	element: "4:select",
	rect: { x: 10, y: 20, width: 30, height: 40 },
	color: "rgb(0, 0, 0)",
	backgroundColor: "rgba(0, 0, 0, 0)",
	inlineColors: {
		color: "rgb(0, 0, 0)",
		"background-color": "rgba(0, 0, 0, 0)",
	},
	computedColors: {},
};
const beforeMatch = { ...match, color: "magenta", backgroundColor: "magenta" };
const scope = acceptanceScope([[beforeMatch], [beforeMatch], [match], [match]]);
const difference = (element = match.element): Difference => ({
	element,
	property: "color",
	before: "magenta",
	after: "rgb(0, 0, 0)",
});
const evidence = {
	scope,
	differences: [difference()],
	outsidePixels: 0,
	noise: false,
};
test("accepts each widget's own inline colors, not defaults of properties without inline values", () => {
	const white = {
		...match,
		inlineColors: { "background-color": "rgb(255, 255, 255)" },
		backgroundColor: "rgb(255, 255, 255)",
	};
	const localScope = acceptanceScope([[white], [white], [white], [white]]);
	expect(
		acceptedOutcome(verdict(), {
			...evidence,
			scope: localScope,
			differences: [
				{
					...difference(),
					property: "background-color",
					after: "rgb(255, 255, 255)",
				},
			],
		}).status,
	).toBe("accepted");
	expect(
		acceptedOutcome(verdict(), { ...evidence, scope: localScope }).status,
	).toBe("different");
	expect(
		acceptedOutcome(verdict(), {
			...evidence,
			scope: localScope,
			differences: [{ ...difference(), property: "outline-color" }],
		}).status,
	).toBe("different");
});

test("pins exactly one element-scoped intentional PDF form decision", () => {
	expect(entries).toEqual([
		{
			selector:
				".annotationLayer :is(.textWidgetAnnotation, .checkBoxWidgetAnnotation, .radioButtonWidgetAnnotation, .choiceWidgetAnnotation, .buttonWidgetAnnotation.checkBox, .buttonWidgetAnnotation.radioButton) :is(input, select, textarea)",
			properties: [
				"color",
				"background-color",
				"-webkit-text-fill-color",
				"-webkit-text-stroke-color",
				"text-decoration-color",
				"text-emphasis-color",
				"column-rule-color",
				"row-rule-color",
				"outline-color",
				"border-block-end-color",
				"border-block-start-color",
				"border-bottom-color",
				"border-inline-end-color",
				"border-inline-start-color",
				"border-left-color",
				"border-right-color",
				"border-top-color",
			],
			reason:
				"Fillable PDF form fields show the PDF's own inline colors (pdf.js). Mike decision 2026-11-25/26: no !important.",
		},
	]);
});
test.each([
	"font-size",
	"border-top-width",
	"font-weight",
	"position",
	"z-index",
	"transform",
	"display",
	"border-top-color",
])(
	"rejects unapproved select property %s even with zero outside pixels",
	(property) => {
		expect(
			acceptedOutcome(verdict(), {
				...evidence,
				differences: [{ ...difference(), property }],
			}).status,
		).toBe("different");
	},
);
test("requires approved after colors and allows border currentColor only on own pseudos", () => {
	for (const after of ["rgb(255, 0, 0)", "rgba(0, 0, 0, 0)"])
		expect(
			acceptedOutcome(verdict(), {
				...evidence,
				differences: [{ ...difference(), after }],
			}).status,
		).toBe("different");
	expect(
		acceptedOutcome(verdict(), {
			...evidence,
			differences: [
				{
					...difference(),
					property: "background-color",
					after: "rgba(0, 0, 0, 0)",
				},
			],
		}).status,
	).toBe("accepted");
	expect(
		acceptedOutcome(verdict(), {
			...evidence,
			differences: [
				{ ...difference("4:select::before"), property: "border-top-color" },
			],
		}).status,
	).toBe("accepted");
});
test("requires both inline colors to win in both after captures, including unchanged colors", () => {
	for (const wrong of [
		{ ...match, color: "red" },
		{ ...match, backgroundColor: "magenta" },
	]) {
		for (const captures of [
			[[match], [match], [wrong], [match]],
			[[match], [match], [match], [wrong]],
		])
			expect(acceptanceScope(captures).elements).toEqual([]);
	}
	const before = { ...match, color: "magenta", backgroundColor: "magenta" };
	expect(
		acceptanceScope([[before], [before], [match], [match]]).elements,
	).toEqual([match.element]);
});
test("accepts currentColor consequences only when their before value followed the select text", () => {
	for (const property of entries[0]!.properties.filter(
		(p) => p !== "color" && p !== "background-color",
	)) {
		const element = property.startsWith("border-")
			? "4:select::before"
			: "4:select";
		const change = { ...difference(element), property };
		expect(
			acceptedOutcome(verdict(), { ...evidence, differences: [change] }).status,
			property,
		).toBe("accepted");
		expect(
			acceptedOutcome(verdict(), {
				...evidence,
				differences: [{ ...change, before: "rgb(0, 0, 255)" }],
			}).status,
			property,
		).toBe("different");
	}
});
test("accepted differences with coverage limits still fail as not-proven", () => {
	expect(
		comparisonExitCode([
			{
				status: "accepted",
				notProvenReasons: ["canvas content is not reconstructed"],
			},
		]),
	).toBe(2);
	expect(
		comparisonExitCode([{ status: "accepted", notProvenReasons: [] }]),
	).toBe(0);
});
test("accepts matched selects and their own pseudos in any fixture, retaining the raw verdict", () => {
	const result = acceptedOutcome(verdict(), {
		...evidence,
		differences: [difference(), difference("4:select::before")],
	});
	expect(result).toMatchObject({
		status: "accepted",
		same: false,
		comparisonStatus: "different",
		acceptanceReason: entries[0]?.reason,
	});
});
test("requires the same matching element in all four captures and retains their rectangles", () => {
	expect(acceptanceScope([[match], [match], [], [match]]).elements).toEqual([]);
	expect(acceptanceScope([]).elements).toEqual([]);
	expect(acceptanceScope([[match], [match], [match]]).elements).toEqual([]);
	expect(scope).toEqual({
		elements: ["4:select"],
		rects: Array(4).fill(match.rect),
		beforeColors: { "4:select": "magenta" },
		inlineColors: { "4:select": match.inlineColors },
	});
	expect(
		acceptedOutcome(verdict(), {
			...evidence,
			scope: { elements: [], rects: [], beforeColors: {}, inlineColors: {} },
		}).status,
	).toBe("different");
});
test("rejects a sibling style difference in the same fixture and differences on select descendants", () => {
	for (const element of ["5:div.popup", "6:option", "4:select-other"])
		expect(
			acceptedOutcome(verdict(2), {
				...evidence,
				differences: [difference(), difference(element)],
			}).status,
		).toBe("different");
});
test("rejects sibling stable pixel changes and pixel-only changes even inside the select", () => {
	expect(
		acceptedOutcome(verdict(1, 10), { ...evidence, outsidePixels: 1 }).status,
	).toBe("different");
	expect(
		acceptedOutcome(verdict(0, 10), { ...evidence, differences: [] }).status,
	).toBe("different");
});
test("does not accept noise, same or not-proven observations", () => {
	expect(acceptedOutcome(verdict(), { ...evidence, noise: true }).status).toBe(
		"different",
	);
	expect(acceptedOutcome(verdict(0), evidence).status).toBe("same");
	expect(
		acceptedOutcome(
			{ ...verdict(0), status: "not-proven", same: false },
			evidence,
		).status,
	).toBe("not-proven");
});
test("retains coverage limits on accepted differences", () => {
	expect(
		acceptedOutcome(
			{
				...verdict(),
				notProvenReasons: ["canvas content is not reconstructed"],
			},
			evidence,
		).notProvenReasons,
	).toEqual(["canvas content is not reconstructed"]);
});
test("only same and accepted observations succeed", () => {
	expect(comparisonExitCode([{ status: "same" }, { status: "accepted" }])).toBe(
		0,
	);
	expect(
		comparisonExitCode([{ status: "accepted" }, { status: "not-proven" }]),
	).toBe(2);
	expect(
		comparisonExitCode([
			{ status: "accepted" },
			{ status: "not-proven" },
			{ status: "different" },
		]),
	).toBe(1);
});

test("rejects stable sibling pixels even when its computed styles have no difference", () => {
	const before = new PNG({ width: 2, height: 1 });
	const after = new PNG({ width: 2, height: 1 });
	before.data.set([0, 0, 0, 255, 0, 0, 0, 255]);
	after.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
	const a = PNG.sync.write(before),
		b = PNG.sync.write(after);
	const rect = { x: 0, y: 0, width: 1, height: 1 };
	const scope = acceptanceScope(Array(4).fill([{ ...match, rect }]));
	const pixel = repeatedPixels([a, a], [b, b], scope.rects);
	expect(pixel.count).toBe(2);
	expect(pixel.outsideAcceptance).toBe(1);
	expect(
		acceptedOutcome(verdict(1, pixel.count), {
			...evidence,
			scope,
			outsidePixels: pixel.outsideAcceptance,
		}).status,
	).toBe("different");
});
