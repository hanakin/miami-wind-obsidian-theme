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
	inlineColors: Record<string, string>;
	computedColors: Record<string, string>;
}
export function acceptanceScope(
	captures: readonly (readonly AcceptanceMatch[])[],
) {
	if (captures.length !== 4)
		return {
			elements: [],
			rects: [],
			beforeColors: {} as Record<string, string>,
			inlineColors: {} as Record<string, Record<string, string>>,
		};
	const elements = (captures[0] ?? [])
		.map((match) => match.element)
		.filter((element) =>
			captures.every((capture, index) =>
				capture.some(
					(match) =>
						match.element === element &&
						Object.keys(match.inlineColors).length > 0 &&
						JSON.stringify(match.inlineColors) ===
							JSON.stringify(
								captures[0]?.find((first) => first.element === element)
									?.inlineColors,
							) &&
						(index < 2 ||
							Object.entries(match.inlineColors).every(
								([property, value]) =>
									(property === "color"
										? match.color
										: property === "background-color"
											? match.backgroundColor
											: match.computedColors[property]) === value,
							)),
				),
			),
		);
	return {
		elements,
		inlineColors: Object.fromEntries(
			(captures[0] ?? [])
				.filter((match) => elements.includes(match.element))
				.map((match) => [match.element, match.inlineColors]),
		),
		beforeColors: Object.fromEntries(
			(captures[0] ?? [])
				.filter((match) => elements.includes(match.element))
				.map((match) => [match.element, match.color]),
		),
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
			const inline = evidence.scope.inlineColors[element!] ?? {};
			const own = !pseudo ? inline[difference.property] : undefined;
			const followsText =
				difference.property !== "background-color" &&
				(!difference.property.startsWith("border-") || !!pseudo) &&
				difference.before === evidence.scope.beforeColors[element!] &&
				inline.color !== undefined;
			return (
				evidence.scope.elements.includes(element!) &&
				(!pseudo || ["before", "after", "marker"].includes(pseudo)) &&
				acceptanceRule.properties.includes(difference.property) &&
				(own !== undefined
					? difference.after === own
					: followsText && difference.after === inline.color)
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
