import { expect, test } from "vitest";
import { acceptedOutcome, comparisonExitCode } from "./accepted";
import entries from "./accepted-differences.json";
import { outcome } from "./model";

const verdict = (differences = 1) =>
	outcome({
		differences,
		pixels: 0,
		noise: false,
		invisible: false,
		unsupported: [],
		replayIssues: [],
	});

test("pins the sole intentional PDF form difference", () => {
	expect(entries).toEqual([
		{
			id: "qc.pdf.forms",
			reason:
				"intentional 2.0 change, Mike decision 2026-11-25, inline pdf.js styles beat non-!important rules",
		},
	]);
});
test("accepts only exact fixture ID differences and never calls them same", () => {
	expect(acceptedOutcome("qc.pdf.forms", verdict())).toMatchObject({
		status: "accepted",
		same: false,
		comparisonStatus: "different",
		acceptanceReason: entries[0]?.reason,
	});
	expect(acceptedOutcome("qc.pdf.forms.other", verdict()).status).toBe(
		"different",
	);
	expect(acceptedOutcome("qc.pdf", verdict()).status).toBe("different");
});
test("does not accept same or not-proven observations", () => {
	expect(acceptedOutcome("qc.pdf.forms", verdict(0)).status).toBe("same");
	expect(
		acceptedOutcome("qc.pdf.forms", {
			...verdict(0),
			status: "not-proven",
			same: false,
		}).status,
	).toBe("not-proven");
});
test("retains coverage limits when a real difference is accepted", () => {
	expect(
		acceptedOutcome("qc.pdf.forms", {
			...verdict(),
			notProvenReasons: ["canvas content is not reconstructed"],
		}).notProvenReasons,
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
