// The workbench's own record of compare results: one per capture, kept together with the two
// theme hashes it was made with. A re-check of one component adds or replaces only its own
// captures; a result is shown only for the pair of sides it was made with.
import type { Change } from "./compare-states.ts";
import type { CompareState, Diffs } from "./types.ts";

/** What one compare run found for one capture. */
export interface FixtureResult {
	state: CompareState;
	/** Components with a recorded difference on their own elements. */
	touched: string[];
	changes?: { total: number; list: Change[] };
	/** True when the run saved a picture of the changed pixels for it. */
	diffImage: boolean;
	/** When the run that produced it finished (ISO). */
	generated: string;
}

/** Everything known about one pair of sides. */
export interface PairResults {
	/** When the latest run for this pair finished (ISO). */
	generated: string;
	fixtures: Record<string, FixtureResult>;
	/** How each component's places sit against its shared look, from the runs so far. */
	diffs: Diffs;
}

export interface Store {
	pairs: Record<string, PairResults>;
}

/** Names a pair of sides by the hashes of their CSS. */
export const pairKey = (before: string, after: string) => `${before}:${after}`;

/**
 * Adds one compare run to the store. Only the captures and components in the run are added or
 * replaced, and only under the pair of hashes the run was made with; everything else stays. The
 * oldest pairs are dropped beyond `maxPairs`.
 */
export function mergeRun(
	store: Store,
	key: string,
	generated: string,
	fixtures: Record<string, Omit<FixtureResult, "generated">>,
	diffs: Diffs = {},
	maxPairs = 6,
): Store {
	const had = store.pairs[key];
	const pair: PairResults = {
		generated,
		fixtures: {
			...had?.fixtures,
			...Object.fromEntries(Object.entries(fixtures).map(([id, f]) => [id, { ...f, generated }])),
		},
		diffs: { ...had?.diffs, ...diffs },
	};
	const pairs = Object.entries({ ...store.pairs, [key]: pair })
		.sort((a, b) => b[1].generated.localeCompare(a[1].generated))
		.slice(0, maxPairs);
	return { pairs: Object.fromEntries(pairs) };
}

/** A pair's results in the shape the page reads; null when the pair was never checked. */
export function resultsFor(store: Store, key: string) {
	const pair = store.pairs[key];
	if (!pair) return null;
	const entries = Object.entries(pair.fixtures);
	return {
		generated: pair.generated,
		compare: Object.fromEntries(entries.map(([id, f]) => [id, f.state])),
		touched: Object.fromEntries(entries.map(([id, f]) => [id, f.touched])),
		changes: Object.fromEntries(
			entries.flatMap(([id, f]) =>
				f.changes ? [[id, { ...f.changes, diffImage: f.diffImage }]] : [],
			),
		),
		diffs: pair.diffs,
	};
}

export type Results = NonNullable<ReturnType<typeof resultsFor>>;
