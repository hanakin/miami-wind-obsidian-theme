import { expect, it } from "vitest";
import { mergeRun, pairKey, resultsFor, type Store } from "./results.ts";

const same = { state: { status: "same" as const }, touched: [], diffImage: false, inputs: "i1" };
const differs = {
	state: { status: "different" as const },
	touched: ["kbd"],
	diffImage: true,
	inputs: "i1",
};
// The inputs on disk now: every capture and component at fingerprint "i1".
const all = (print: string) => new Proxy({}, { get: () => print }) as Record<string, string>;
const now = { fixtures: all("i1"), components: all("i1") };
const ab = pairKey("a", "b");

it("adds or replaces only the captures a run covered", () => {
	let store: Store = { pairs: {} };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: same, two: same, three: same }, now);
	// A re-check of one component: only its captures change.
	store = mergeRun(store, ab, "2026-11-26T02:00:00Z", { two: differs }, now);
	const pair = store.pairs[ab];
	expect(Object.keys(pair?.fixtures ?? {}).sort()).toEqual(["one", "three", "two"]);
	expect(pair?.fixtures.two).toEqual({ ...differs, generated: "2026-11-26T02:00:00Z" });
	expect(pair?.fixtures.one).toEqual({ ...same, generated: "2026-11-26T01:00:00Z" });
	expect(pair?.generated).toBe("2026-11-26T02:00:00Z");
});

it("keeps results apart by the pair of sides they were made with", () => {
	let store: Store = { pairs: {} };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: same }, now);
	store = mergeRun(store, pairKey("a", "c"), "2026-11-26T02:00:00Z", { one: differs }, now);
	expect(resultsFor(store, ab, now)?.compare).toEqual({ one: { status: "same" } });
	expect(resultsFor(store, pairKey("a", "c"), now)?.compare).toEqual({
		one: { status: "different" },
	});
	// The same two themes the other way round are a different pair: nothing to show.
	expect(resultsFor(store, pairKey("b", "a"), now)).toBeNull();
});

it("drops the oldest pairs beyond the limit", () => {
	let store: Store = { pairs: {} };
	for (const [i, after] of ["b", "c", "d"].entries()) {
		store = mergeRun(
			store,
			pairKey("a", after),
			`2026-11-26T0${i}:00:00Z`,
			{ one: same },
			now,
			{},
			2,
		);
	}
	expect(Object.keys(store.pairs).sort()).toEqual([pairKey("a", "c"), pairKey("a", "d")]);
});

it("merges shared-look results by component", () => {
	let store: Store = { pairs: {} };
	const look = (same: boolean) => ({ modal: { same, props: [] } });
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: same }, now, {
		kbd: look(true),
		tag: look(true),
	});
	store = mergeRun(store, ab, "2026-11-26T02:00:00Z", { one: same }, now, { kbd: look(false) });
	expect(resultsFor(store, ab, now)?.diffs).toEqual({ kbd: look(false), tag: look(true) });
});

it("stops showing a result once the inputs it was made with have changed", () => {
	let store: Store = { pairs: {} };
	const look = { modal: { same: true, props: [] } };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: same, two: same }, now, {
		kbd: look,
		tag: look,
	});
	// Obsidian's CSS or the capture "one" changed: its fingerprint is no longer "i1".
	const changed = {
		fixtures: { one: "i2", two: "i1" },
		components: { kbd: "i2", tag: "i1" },
	};
	const shown = resultsFor(store, ab, changed);
	expect(shown?.compare).toEqual({ two: { status: "same" } });
	expect(shown?.diffs).toEqual({ tag: look });
	// With every input changed, the pair counts as never checked.
	expect(resultsFor(store, ab, { fixtures: all("i2"), components: all("i2") })).toBeNull();
	// A result saved before fingerprints existed is never shown.
	const { inputs: _, ...unmarked } = same;
	const old = {
		pairs: {
			[ab]: { generated: "x", fixtures: { one: { ...unmarked, generated: "x" } }, diffs: {} },
		},
	} as unknown as Store;
	expect(resultsFor(old, ab, { fixtures: {}, components: {} })).toBeNull();
});

it("a partial run keeps only earlier results whose inputs still match", () => {
	let store: Store = { pairs: {} };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: same, two: same, three: same }, now);
	// "one" changed on disk, then only "two" is re-checked.
	const changed = { fixtures: { one: "i2", two: "i1", three: "i1" }, components: {} };
	store = mergeRun(store, ab, "2026-11-26T02:00:00Z", { two: differs }, changed);
	expect(Object.keys(store.pairs[ab]?.fixtures ?? {}).sort()).toEqual(["three", "two"]);
});
