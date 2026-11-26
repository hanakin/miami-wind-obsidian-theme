import entries from "./accepted-differences.json";
import type { outcome } from "./model";

export function acceptedOutcome(
	id: string,
	verdict: ReturnType<typeof outcome>,
) {
	const result = { ...verdict, comparisonStatus: verdict.status };
	const reason =
		verdict.status === "different"
			? entries.find((entry) => entry.id === id)?.reason
			: undefined;
	return reason
		? { ...result, status: "accepted", acceptanceReason: reason }
		: result;
}

export function comparisonExitCode(results: readonly { status: string }[]) {
	if (results.some((result) => result.status === "different")) return 1;
	return results.some((result) => result.status === "not-proven") ? 2 : 0;
}
