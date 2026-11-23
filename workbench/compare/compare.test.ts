import { expect, test } from "vitest";
import { componentDiffs, filterFixtures, styleDiff } from "./model";

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
