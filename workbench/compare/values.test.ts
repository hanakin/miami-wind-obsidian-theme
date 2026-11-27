import { expect, test } from "vitest";
import { componentDiffs, styleDiff } from "./model";

function diff(before: string, after: string, property = "--font-mermaid") {
	return styleDiff(
		[{ element: "node", props: { [property]: before } }],
		[{ element: "node", props: { [property]: after } }],
	);
}
test.each([
	['"Liberation Sans", serif', "'Liberation Sans', serif"],
	[String.raw`"fl\61 me"`, "'flame'"],
	[String.raw`"a\"b"`, `'a"b'`],
	[String.raw`"\1f600 "`, "'😀'"],
	[String.raw`"\0 "`, "'�'"],
	[String.raw`"\d800 "`, "'�'"],
	[String.raw`"\110000 "`, "'�'"],
	['"line\\\nbreak"', "'linebreak'"],
	['var(--x, "A")', "var(--x, 'A')"],
	['url("font.woff2")', "url('font.woff2')"],
])("compares CSS string token values: %s", (before, after) =>
	expect(diff(before, after)).toEqual([]),
);

test.each([
	['"Liberation Sans"', "'Liberation Serif'"],
	['"A"', "'a'"],
	["#b3b3b3", "#f472b6"],
	["1", "1.0"],
	['"A", serif', "'A',serif"],
	['/* "A" */ "B"', "/* 'A' */ 'B'"],
	['"A"', "A"],
])("retains every other custom-value difference: %s", (before, after) =>
	expect(diff(before, after)).toHaveLength(1),
);

test("keeps standard property comparisons exact", () => {
	expect(diff('"A"', "'A'", "content")).toHaveLength(1);
});
test("component modes use the same CSS string semantics", () => {
	const rows = [
		'"Liberation Sans"',
		"'Liberation Sans'",
		'"Liberation Serif"',
	].map((value, i) => ({
		component: "button",
		surface: String(i),
		state: "default",
		props: { "--font-mermaid": value },
	}));
	expect(componentDiffs(rows)).toEqual({
		button: {
			"0": { same: true, props: [] },
			"1": { same: true, props: [] },
			"2": { same: false, props: ["--font-mermaid"] },
		},
	});
});

test("retains the status-bar runtime color change", () => {
	expect(diff("#b3b3b3", "#f472b6", "--status-bar-text-color")).toHaveLength(1);
});
