import entries from "./accepted-differences.json";
import type { Difference, outcome } from "./model";
import type { PixelRect } from "./pixels";

// One intentional decision, pinned in accepted.test.ts. Match it in the DOM,
// not by fixture name or by inferring selectors from computed-style keys.
export const acceptanceRule = entries[0];
export interface AcceptanceMatch {
	element: string;
	rect: PixelRect;
	color: string;
	backgroundColor: string;
}
export function acceptanceScope(
	captures: readonly (readonly AcceptanceMatch[])[],
) {
	if (captures.length !== 4) return { elements: [], rects: [] };
	const elements = (captures[0] ?? [])
		.map((match) => match.element)
		.filter((element) =>
			captures.every((capture, index) =>
				capture.some(
					(match) =>
						match.element === element &&
						// Both after captures must actually show the inline colors, even if one color did not change.
						(index < 2 ||
							(match.color === acceptanceRule.inlineStyles.color &&
								match.backgroundColor === "rgba(0, 0, 0, 0)")),
				),
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
		evidence.differences.every((difference) => {
			const [element, pseudo] = difference.element.split("::");
			return (
				evidence.scope.elements.includes(element!) &&
				(!pseudo || ["before", "after", "marker"].includes(pseudo)) &&
				acceptanceRule.properties.includes(difference.property) &&
				// Only pseudo borders follow currentColor here; the select's own border is not an inline color decision.
				(!difference.property.startsWith("border-") || !!pseudo) &&
				(difference.property !== "background-color" || !pseudo) &&
				difference.after ===
					(difference.property === "background-color"
						? "rgba(0, 0, 0, 0)"
						: acceptanceRule.inlineStyles.color)
			);
		});
	return accepted
		? { ...result, status: "accepted", acceptanceReason: acceptanceRule.reason }
		: result;
}

export function comparisonExitCode(
	results: readonly { status: string; notProvenReasons?: readonly string[] }[],
) {
	if (results.some((result) => result.status === "different")) return 1;
	return results.some(
		(result) =>
			result.status === "not-proven" ||
			(result.status === "accepted" && !!result.notProvenReasons?.length),
	)
		? 2
		: 0;
}
