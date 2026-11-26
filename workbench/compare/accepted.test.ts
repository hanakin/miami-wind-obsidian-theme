import { expect, test } from "vitest";
import { acceptedOutcome, comparisonExitCode } from "./accepted";
import entries from "./accepted-differences.json";
import { outcome } from "./model";

const reason =
	"intentional 2.0 change, Mike decision 2026-11-25, inline pdf.js styles beat non-!important rules";
const input = {
	differences: 1,
	pixels: 20,
	noise: false,
	invisible: false,
	unsupported: [],
	replayIssues: [],
};

test("pins the sole Mike-approved difference with its exact reason", () => {
	expect(entries).toEqual([{ id: "qc.pdf.forms", reason }]);
});

test("marks the approved difference as accepted without claiming it is identical", () => {
	const verdict = acceptedOutcome("qc.pdf.forms", outcome(input));
	expect(verdict).toEqual({
		status: "accepted",
		comparisonStatus: "different",
		same: false,
		notProvenReasons: [],
		acceptanceReason: reason,
	});
});

test("does not accept other fixture IDs or prefix matches", () => {
	for (const id of ["qc.pdf.xfa", "qc.pdf.forms.focus", "other.qc.pdf.forms"]) {
		expect(acceptedOutcome(id, outcome(input))).toMatchObject({
			status: "different",
			comparisonStatus: "different",
			same: false,
		});
	}
});

test("does not turn matching or unproven observations into accepted differences", () => {
	for (const verdict of [
		outcome({ ...input, differences: 0, pixels: 0 }),
		outcome({ ...input, differences: 0, noise: true }),
	]) {
		expect(acceptedOutcome("qc.pdf.forms", verdict)).toEqual({
			...verdict,
			comparisonStatus: verdict.status,
		});
	}
});

test("keeps coverage limits on an accepted observation", () => {
	expect(
		acceptedOutcome(
			"qc.pdf.forms",
			outcome({ ...input, unsupported: ["canvas"] }),
		),
	).toMatchObject({
		status: "accepted",
		notProvenReasons: ["canvas content is not reconstructed"],
	});
});

test("accepted coverage does not fail the run but unlisted limits and differences do", () => {
	const accepted = acceptedOutcome(
		"qc.pdf.forms",
		outcome({ ...input, unsupported: ["canvas"] }),
	);
	expect(comparisonExitCode([accepted])).toBe(0);
	expect(
		comparisonExitCode([
			accepted,
			outcome({ ...input, differences: 0, pixels: 0, invisible: true }),
		]),
	).toBe(2);
	expect(comparisonExitCode([accepted, outcome(input)])).toBe(1);
});
