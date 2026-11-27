import { expect, it } from "vitest";
import { mergeRun, pairKey, resultsFor, type Store } from "./results.ts";

const same = { state: { status: "same" as const }, touched: [], diffImage: false };
const differs = { state: { status: "different" as const }, touched: ["kbd"], diffImage: true };
const ab = pairKey("a", "b");

it("adds or replaces only the captures a run covered", () => {
	let store: Store = { pairs: {} };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: same, two: same, three: same });
	// A re-check of one component: only its captures change.
	store = mergeRun(store, ab, "2026-11-26T02:00:00Z", { two: differs });
	const pair = store.pairs[ab];
	expect(Object.keys(pair?.fixtures ?? {}).sort()).toEqual(["one", "three", "two"]);
	expect(pair?.fixtures.two).toEqual({ ...differs, generated: "2026-11-26T02:00:00Z" });
	expect(pair?.fixtures.one).toEqual({ ...same, generated: "2026-11-26T01:00:00Z" });
	expect(pair?.generated).toBe("2026-11-26T02:00:00Z");
});

it("keeps results apart by the pair of sides they were made with", () => {
	let store: Store = { pairs: {} };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: same });
	store = mergeRun(store, pairKey("a", "c"), "2026-11-26T02:00:00Z", { one: differs });
	expect(resultsFor(store, ab)?.compare).toEqual({ one: { status: "same" } });
	expect(resultsFor(store, pairKey("a", "c"))?.compare).toEqual({ one: { status: "different" } });
	// The same two themes the other way round are a different pair: nothing to show.
	expect(resultsFor(store, pairKey("b", "a"))).toBeNull();
});

it("drops the oldest pairs beyond the limit", () => {
	let store: Store = { pairs: {} };
	for (const [i, after] of ["b", "c", "d"].entries()) {
		store = mergeRun(store, pairKey("a", after), `2026-11-26T0${i}:00:00Z`, { one: same }, {}, 2);
	}
	expect(Object.keys(store.pairs).sort()).toEqual([pairKey("a", "c"), pairKey("a", "d")]);
});

it("merges shared-look results by component", () => {
	let store: Store = { pairs: {} };
	const look = (same: boolean) => ({ modal: { same, props: [] } });
	store = mergeRun(
		store,
		ab,
		"2026-11-26T01:00:00Z",
		{ one: same },
		{ kbd: look(true), tag: look(true) },
	);
	store = mergeRun(store, ab, "2026-11-26T02:00:00Z", { one: same }, { kbd: look(false) });
	expect(resultsFor(store, ab)?.diffs).toEqual({ kbd: look(false), tag: look(true) });
});
