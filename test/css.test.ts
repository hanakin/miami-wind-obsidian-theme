import postcss from "postcss";
import mixins from "postcss-mixins";
import nested from "postcss-nested";
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

it("formats with tabs, source property order, section banners and stable output", async () => {
	const input =
		"/* @section code.css */ .x{color:red;display:block;background:blue} @media (hover: hover){.y{color:green}}";
	const result = await postcss([formatCss()]).process(input, {
		from: undefined,
	});
	expect(result.css).toContain("/* === code.css === */");
	expect(result.css).toContain("\t display".replace(" ", ""));
	expect(result.css.indexOf("color:")).toBeLessThan(
		result.css.indexOf("display:"),
	);
	expect(
		(await postcss([formatCss()]).process(result.css, { from: undefined })).css,
	).toBe(result.css);
});

it("rejects depth hidden inside functional selectors", async () => {
	await expect(check(".a :is(.b .c .d) { color: red }")).rejects.toThrow();
});

it("keeps border shorthand and longhand cascade order", async () => {
	const result = await postcss([formatCss()]).process(
		".x {border-color:red; border-top:1px solid blue}",
		{ from: undefined },
	);
	expect(result.css.indexOf("border-color:")).toBeLessThan(
		result.css.indexOf("border-top:"),
	);
});

it("allows exactly the isolated tag hover exception", async () => {
	const css =
		".cm-hashtag-begin:has(+ .cm-hashtag-end:hover) { background-color: var(--magenta) }";
	await expect(
		postcss([checkCss()]).process(css, { from: "src/tag-hover.css" }),
	).resolves.toBeDefined();
	await expect(check(css)).rejects.toThrow();
});

it("checks selectors and declarations after nesting and component expansion", async () => {
	await expect(
		postcss([nested(), checkCss()]).process(".a .b { & .c .d { color:red } }", {
			from: "src/tabs.css",
		}),
	).rejects.toThrow();
	await expect(
		postcss([mixins(), checkCss()]).process(
			"@define-mixin bad { color:red!important } .a { @mixin bad }",
			{ from: "src/components/bad.css" },
		),
	).rejects.toThrow();
});

it.each(["line-height: 2; font: 12px serif", "top: 1px; inset: 0"])(
	"keeps declaration order for %s",
	async (declarations) => {
		const result = await postcss([formatCss()]).process(
			`.x { ${declarations} }`,
			{ from: undefined },
		);
		expect(result.css).toBe(
			`.x {\n\t${declarations.split("; ").join(";\n\t")};\n}\n`,
		);
	},
);

it.each([
	"keyword",
	"string",
	"number",
	"comment",
	"operator",
	"variable",
	"def",
])(
	"allows the exact legacy span.cm-%s syntax selector only in code.css",
	async (token) => {
		const css = `.cm-s-obsidian span.cm-${token} { color: var(--${token}) }`;
		await expect(check(css)).resolves.toBeDefined();
		await expect(
			postcss([checkCss()]).process(css, { from: "src/tabs.css" }),
		).rejects.toThrow();
		await expect(check(css.replace("span.", "div."))).rejects.toThrow();
	},
);
