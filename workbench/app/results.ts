// The workbench's own record of compare results: one per capture, kept together with the two
// theme hashes it was made with and a fingerprint of everything else its picture is drawn from
// (inputs.ts). A re-check of one component adds or replaces only its own captures; a result is
// shown only for the pair of sides it was made with, and only while its fingerprint still matches.
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
	/** The fingerprint of the capture's other inputs when the run was made. */
	inputs: string;
}

/** Everything known about one pair of sides. */
export interface PairResults {
	/** When the latest run for this pair finished (ISO). */
	generated: string;
	fixtures: Record<string, FixtureResult>;
	/** How each component's places sit against its shared look, from the runs so far. */
	diffs: Diffs;
	/** The fingerprint of each component's captures when its shared-look result was made. */
	diffInputs?: Record<string, string>;
}

export interface Store {
	pairs: Record<string, PairResults>;
}

/** The fingerprints of the inputs as they are now: per capture and per component. */
export interface Current {
	fixtures: Record<string, string>;
	components: Record<string, string>;
}

/** Names a pair of sides by the hashes of their CSS. */
export const pairKey = (before: string, after: string) => `${before}:${after}`;

/**
 * Adds one compare run to the store. Only the captures and components in the run are added or
 * replaced, and only under the pair of hashes the run was made with. Of what the pair already
 * held, only results whose fingerprints still match the inputs stay; the rest are out of date and
 * go. The oldest pairs are dropped beyond `maxPairs`.
 */
export function mergeRun(
	store: Store,
	key: string,
	generated: string,
	fixtures: Record<string, Omit<FixtureResult, "generated">>,
	current: Current,
	diffs: Diffs = {},
	maxPairs = 6,
): Store {
	const had = store.pairs[key];
	const keptDiffs = Object.entries(had?.diffs ?? {}).filter(
		([component]) => had?.diffInputs?.[component] === current.components[component],
	);
	const pair: PairResults = {
		generated,
		fixtures: {
			...Object.fromEntries(
				Object.entries(had?.fixtures ?? {}).filter(
					([id, f]) => f.inputs !== undefined && f.inputs === current.fixtures[id],
				),
			),
			...Object.fromEntries(Object.entries(fixtures).map(([id, f]) => [id, { ...f, generated }])),
		},
		diffs: { ...Object.fromEntries(keptDiffs), ...diffs },
		diffInputs: {
			...Object.fromEntries(keptDiffs.map(([c]) => [c, current.components[c] ?? ""])),
			...Object.fromEntries(Object.keys(diffs).map((c) => [c, current.components[c] ?? ""])),
		},
	};
	const pairs = Object.entries({ ...store.pairs, [key]: pair })
		.sort((a, b) => b[1].generated.localeCompare(a[1].generated))
		.slice(0, maxPairs);
	return { pairs: Object.fromEntries(pairs) };
}

/**
 * A pair's results in the shape the page reads; null when the pair was never checked. A result
 * made with other inputs than the ones on disk now (`current`) is left out: not checked.
 */
export function resultsFor(store: Store, key: string, current: Current) {
	const pair = store.pairs[key];
	if (!pair) return null;
	const entries = Object.entries(pair.fixtures).filter(
		([id, f]) => f.inputs !== undefined && f.inputs === current.fixtures[id],
	);
	if (entries.length === 0) return null;
	return {
		generated: pair.generated,
		compare: Object.fromEntries(entries.map(([id, f]) => [id, f.state])),
		touched: Object.fromEntries(entries.map(([id, f]) => [id, f.touched])),
		changes: Object.fromEntries(
			entries.flatMap(([id, f]) =>
				f.changes ? [[id, { ...f.changes, diffImage: f.diffImage }]] : [],
			),
		),
		diffs: Object.fromEntries(
			Object.entries(pair.diffs).filter(
				([component]) =>
					pair.diffInputs?.[component] !== undefined &&
					pair.diffInputs[component] === current.components[component],
			),
		),
	};
}

export type Results = NonNullable<ReturnType<typeof resultsFor>>;
