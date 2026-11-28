import { expect, it } from "vitest";
import { mergeRun, pairKey, resultsFor, type Store } from "./results.ts";

// Recorded inputs stand in as { file: hash }; `now` says which hash each file has on disk.
const made = (hash = "h1") => ({ "capture/fixtures/x.html": hash });
const same = {
	state: { status: "same" as const },
	touched: [],
	diffImage: false,
	inputs: made(),
};
const differs = {
	state: { status: "different" as const },
	touched: ["kbd"],
	diffImage: true,
	inputs: made(),
};
const on = (hash: string) => (inputs: unknown) =>
	typeof inputs === "object" && inputs !== null && Object.values(inputs).every((h) => h === hash);
const now = on("h1");
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
	const own = { kbd: ["one"], tag: ["one"] };
	expect(resultsFor(store, ab, now, own)?.diffs).toEqual({ kbd: look(false), tag: look(true) });
});

it("stops showing a result once a file it was made from has changed", () => {
	let store: Store = { pairs: {} };
	const look = { modal: { same: true, props: [] } };
	const stale = { ...same, inputs: made("h0") };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", { one: stale, two: same }, now, {
		kbd: look,
		tag: look,
	});
	// "one" was made from bytes that are no longer on disk.
	const own = { kbd: ["one"], tag: ["two"] };
	const shown = resultsFor(store, ab, now, own);
	expect(shown?.compare).toEqual({ two: { status: "same" } });
	// A component's standard-look result stands only while all its own captures do.
	expect(shown?.diffs).toEqual({ tag: look });
	// With every input changed, the pair counts as never checked.
	expect(resultsFor(store, ab, on("h2"), own)).toBeNull();
	// A result saved without recorded inputs is never shown.
	const { inputs: _, ...unmarked } = same;
	const old = {
		pairs: {
			[ab]: { generated: "x", fixtures: { one: { ...unmarked, generated: "x" } }, diffs: {} },
		},
	} as unknown as Store;
	expect(resultsFor(old, ab, (inputs) => inputs !== undefined)).toBeNull();
});

it("a partial run keeps only earlier results whose inputs still match", () => {
	let store: Store = { pairs: {} };
	const first = { one: { ...same, inputs: made("h0") }, two: same, three: same };
	store = mergeRun(store, ab, "2026-11-26T01:00:00Z", first, now);
	// "one" changed on disk since; then only "two" is re-checked.
	store = mergeRun(store, ab, "2026-11-26T02:00:00Z", { two: differs }, now);
	expect(Object.keys(store.pairs[ab]?.fixtures ?? {}).sort()).toEqual(["three", "two"]);
});
