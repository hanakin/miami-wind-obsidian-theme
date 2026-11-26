import entries from "./accepted-differences.json";
import type { Difference, outcome } from "./model";
import type { PixelRect } from "./pixels";

// One intentional decision, pinned in accepted.test.ts. Match it in the DOM,
// not by fixture name or by inferring selectors from computed-style keys.
export const acceptanceRule = entries[0];
export interface AcceptanceMatch {
	element: string;
	rect: PixelRect;
}
export function acceptanceScope(
	captures: readonly (readonly AcceptanceMatch[])[],
) {
	if (captures.length !== 4) return { elements: [], rects: [] };
	const elements = (captures[0] ?? [])
		.map((match) => match.element)
		.filter((element) =>
			captures.every((capture) =>
				capture.some((match) => match.element === element),
			),
		);
	return {
		elements,
		rects: captures.flatMap((capture) =>
			capture
				.filter((match) => elements.includes(match.element))
				.map((match) => match.rect),
		),
	};
}
export function acceptedOutcome(
	verdict: ReturnType<typeof outcome>,
	evidence: {
		scope: ReturnType<typeof acceptanceScope>;
		differences: readonly Difference[];
		outsidePixels: number;
		noise: boolean;
	},
) {
	const result = { ...verdict, comparisonStatus: verdict.status };
	const accepted =
		verdict.status === "different" &&
		!evidence.noise &&
		evidence.outsidePixels === 0 &&
		evidence.differences.length > 0 &&
		evidence.differences.every((difference) =>
			// Select pseudos inherit its color. Descendants and siblings are excluded.
			evidence.scope.elements.includes(difference.element.split("::")[0]!),
		);
	return accepted
		? { ...result, status: "accepted", acceptanceReason: acceptanceRule.reason }
		: result;
}

export function comparisonExitCode(results: readonly { status: string }[]) {
	if (results.some((result) => result.status === "different")) return 1;
	return results.some((result) => result.status === "not-proven") ? 2 : 0;
}
