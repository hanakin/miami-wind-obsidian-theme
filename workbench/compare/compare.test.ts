import { expect, test } from "vitest";
import {
	comparisonExitCode,
	componentDiffs,
	filterFixtures,
	styleDiff,
} from "./model";

test("only same, different and not-proven determine exit status", () => {
	expect(comparisonExitCode([{ status: "same" }])).toBe(0);
	expect(
		comparisonExitCode([{ status: "same" }, { status: "not-proven" }]),
	).toBe(2);
	expect(
		comparisonExitCode([{ status: "different" }, { status: "not-proven" }]),
	).toBe(1);
});

test("ID lists select exact fixtures rather than expanding each ID as a substring", () => {
	const fixtures = ["one", "two", "one.extra"].map((id) => ({
		id,
		component: "button",
		contains: [],
		surface: "test",
	}));
	expect(filterFixtures(fixtures, { id: ["one", "two"] })).toEqual(
		fixtures.slice(0, 2),
	);
	expect(filterFixtures(fixtures, { id: [] })).toEqual([]);
});

test("finds longhand differences and missing elements", () => {
	expect(
		styleDiff(
			[{ element: "button", props: { color: "red" } }],
			[{ element: "button", props: { color: "blue" } }],
		),
	).toEqual([
		{ element: "button", property: "color", before: "red", after: "blue" },
	]);
	expect(
		styleDiff([{ element: "button", props: { color: "red" } }], []),
	).toHaveLength(1);
});
test("retains every element when computed-style vectors are shared", () => {
	const old = { color: "red" },
		next = { color: "blue" };
	expect(
		styleDiff(
			[
				{ element: "a", props: old },
				{ element: "b", props: old },
				{ element: "c", props: old },
			],
			[
				{ element: "a", props: next },
				{ element: "b", props: next },
			],
		),
	).toEqual([
		{ element: "a", property: "color", before: "red", after: "blue" },
		{ element: "b", property: "color", before: "red", after: "blue" },
		{ element: "c", property: "color", before: "red", after: null },
	]);
});
test("component shared look uses modal value and retains surface exceptions", () => {
	const samples = ["a", "b", "c"].map((surface, i) => ({
		component: "button",
		surface,
		state: "default",
		props: { color: i === 2 ? "blue" : "red" },
	}));
	expect(componentDiffs(samples)).toEqual({
		button: {
			a: { same: true, props: [] },
			b: { same: true, props: [] },
			c: { same: false, props: ["color"] },
		},
	});
});
test("component filters include nested uses and combine with surface and id", () => {
	const f = {
		id: "one",
		component: "menu",
		contains: ["button"],
		surface: "settings",
	};
	expect(
		filterFixtures([f], { component: "button", surface: "settings", id: "on" }),
	).toEqual([f]);
	expect(filterFixtures([f], { surface: "editor" })).toEqual([]);
});

test("shared look compares matching states and reports all exceptional properties", () => {
	const samples = [
		{
			component: "button",
			surface: "a",
			state: "default",
			props: { color: "red", width: "20px" },
		},
		{
			component: "button",
			surface: "b",
			state: "default",
			props: { color: "red", width: "20px" },
		},
		{
			component: "button",
			surface: "c",
			state: "default",
			props: { color: "blue", width: "30px" },
		},
		{
			component: "button",
			surface: "a",
			state: "hover",
			props: { color: "pink", width: "20px" },
		},
		{
			component: "button",
			surface: "b",
			state: "hover",
			props: { color: "pink", width: "20px" },
		},
	];
	expect(componentDiffs(samples).button).toEqual({
		a: { same: true, props: [] },
		b: { same: true, props: [] },
		c: { same: false, props: ["color"] },
	});
});

test("style differences remain different despite noisy pixels", async () => {
	const { outcome } = await import("./model");
	const common = {
		noise: true,
		invisible: false,
		unsupported: [],
		replayIssues: [],
	};
	const styled = outcome({ ...common, differences: 1, pixels: 50 });
	expect(styled.status).toBe("different");
	expect(styled.same).toBe(false);
	expect(styled.notProvenReasons).toContain("same-CSS repeat noise");
	expect(outcome({ ...common, differences: 0, pixels: 50 }).status).toBe(
		"not-proven",
	);
});
