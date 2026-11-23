import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { checkCss } from "../scripts/checker";
import { formatCss } from "../scripts/formatter";

async function check(css: string) {
	return postcss([checkCss()]).process(css, { from: "src/code.css" });
}

describe("theme rules", () => {
	[
		".x { color: red !important }",
		".x:has(.y) { color: red }",
		"div.x { color: red }",
		"#x { color: red }",
		".a .b .c .d { color: red }",
		".a.b.c.d:hover { color: red }",
		"@layer theme { .a { color: red } }",
		".a { all: unset }",
		".a:is(div.x) { color: red }",
	].forEach((css) => {
		it(`rejects ${css}`, async () => {
			await expect(check(css)).rejects.toThrow();
		});
	});
	it("accepts shallow selectors and zero-specificity scoping", async () => {
		await expect(
			check(":where(.a) .b:is(:hover, :focus) { color: red }"),
		).resolves.toBeDefined();
	});
});

it("formats with tabs, ordered properties, section banners and stable output", async () => {
	const input =
		"/* @section code.css */ .x{color:red;display:block;background:blue} @media (hover: hover){.y{color:green}}";
	const result = await postcss([formatCss()]).process(input, {
		from: undefined,
	});
	expect(result.css).toContain("/* === code.css === */");
	expect(result.css).toContain("\t display".replace(" ", ""));
	expect(result.css.indexOf("display:")).toBeLessThan(
		result.css.indexOf("color:"),
	);
	expect(
		(await postcss([formatCss()]).process(result.css, { from: undefined })).css,
	).toBe(result.css);
});
