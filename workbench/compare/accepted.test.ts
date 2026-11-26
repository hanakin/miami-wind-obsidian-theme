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
};
const scope = acceptanceScope([[match], [match], [match], [match]]);
const difference = (element = match.element): Difference => ({
	element,
	property: "color",
	before: "magenta",
	after: "black",
});
const evidence = {
	scope,
	differences: [difference()],
	outsidePixels: 0,
	noise: false,
};

test("pins exactly one element-scoped intentional PDF form decision", () => {
	expect(entries).toEqual([
		{
			selector: ".annotationLayer .choiceWidgetAnnotation select",
			inlineStyles: {
				color: "rgb(0, 0, 0)",
				"background-color": "transparent",
			},
			reason:
				"intentional 2.0 change, Mike decision 2026-11-25, inline pdf.js styles beat non-!important rules",
		},
	]);
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
	});
	expect(
		acceptedOutcome(verdict(), {
			...evidence,
			scope: { elements: [], rects: [] },
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
	const scope = acceptanceScope(
		Array(4).fill([{ element: match.element, rect }]),
	);
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
