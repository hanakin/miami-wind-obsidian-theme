import { readFile } from "node:fs/promises";
import postcss from "postcss";
import mixins from "postcss-mixins";
import nested from "postcss-nested";
import { describe, expect, it } from "vitest";
import { checkCss } from "../scripts/checker";
import { formatCss } from "../scripts/formatter";

async function check(css: string) {
	return postcss([checkCss()]).process(css, { from: "src/markdown/code.css" });
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

it("formats with tabs, safe property order, section banners and stable output", async () => {
	const input =
		"/* @section src/markdown/code.css */ .x{color:red;display:block;background:blue} @media (hover: hover){.y{color:green}}";
	const result = await postcss([formatCss()]).process(input, {
		from: undefined,
	});
	expect(result.css).toContain(" * @markdown: Code");
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
		postcss([checkCss()]).process(css, { from: "src/markdown/tag-hover.css" }),
	).resolves.toBeDefined();
	await expect(check(css)).rejects.toThrow();
});

it("checks selectors and declarations after nesting and component expansion", async () => {
	await expect(
		postcss([nested(), checkCss()]).process(".a .b { & .c .d { color:red } }", {
			from: "src/global/tabs.css",
		}),
	).rejects.toThrow();
	await expect(
		postcss([mixins(), checkCss()]).process(
			"@define-mixin bad { color:red!important } .a { @mixin bad }",
			{ from: "src/components/bad.css" },
		),
	).rejects.toThrow();
});

it.each([
	"line-height: 2; font: 12px serif",
	"top: 1px; inset: 0",
	"white-space: nowrap; text-wrap: balance",
	"all: unset; color: red",
])("keeps declaration order for %s", async (declarations) => {
	const result = await postcss([formatCss()]).process(
		`.x { ${declarations} }`,
		{ from: undefined },
	);
	expect(result.css).toContain(
		`.x {\n\t${declarations.split("; ").join(";\n\t")};\n}\n`,
	);
});

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
			postcss([checkCss()]).process(css, { from: "src/global/tabs.css" }),
		).rejects.toThrow();
		await expect(check(css.replace("span.", "div."))).rejects.toThrow();
	},
);

it.each(["cm-footref", "cm-hmd-footnote"])(
	"allows the exact inline-code %s rival only in code.css",
	async (state) => {
		const css = `.markdown-source-view.mod-cm6 span.cm-inline-code.${state} { color: var(--code-foreground) }`;
		await expect(check(css)).resolves.toBeDefined();
		await expect(
			postcss([checkCss()]).process(css, { from: "src/global/tabs.css" }),
		).rejects.toThrow();
		await expect(check(css.replace(state, "cm-link"))).rejects.toThrow();
	},
);

it("generates base-l file, section, subsection and component comments", async () => {
	const input =
		"/* @section src/markdown/code.css */ /* @heading Syntax highlighting */ .x { /* Component: surface-background */ background-color: black; }";
	const result = await postcss([formatCss()]).process(input, {
		from: undefined,
	});
	expect(result.css).toContain(
		"/* -----------------------------------------------------------------------------\n * Miami Wind: Obsidian theme\n * -----------------------------------------------------------------------------",
	);
	expect(result.css).toContain(" * @markdown: Code\n");
	expect(result.css).toContain(" * @source: src/markdown/code.css\n");
	expect(result.css).toContain(
		"/*\n * Syntax highlighting\n * -----------------------------------------------------------------------------\n */",
	);
	expect(result.css).toContain(
		"\t/*\n\t * @component: surface-background\n\t */",
	);
});

it("uses base-l property order for independent declarations", async () => {
	const result = await postcss([formatCss()]).process(
		".x { display: block; color: red; font-size: 12px; }",
		{ from: undefined },
	);
	expect(result.css.indexOf("font-size:")).toBeLessThan(
		result.css.indexOf("color:"),
	);
	expect(result.css.indexOf("color:")).toBeLessThan(
		result.css.indexOf("display:"),
	);
});

it.each([
	"margin-left: 1px; margin-inline-start: 2px",
	"width: 10px; inline-size: 20px",
	"font-size-adjust: 1; font: 12px serif",
])("keeps possibly overlapping declarations: %s", async (declarations) => {
	const result = await postcss([formatCss()]).process(
		`.x { ${declarations} }`,
		{ from: undefined },
	);
	const [first, second] = declarations.split("; ");
	expect(result.css.indexOf(first ?? "")).toBeLessThan(
		result.css.indexOf(second ?? ""),
	);
});

it("keeps reverse footnotes attached when safely sorting declarations", async () => {
	const result = await postcss([formatCss()]).process(
		".x { display: block; /* [1] */ color: red; }",
		{ from: undefined },
	);
	expect(result.css).toContain("display: block; /* [1] */");
});

it("preserves license and Style Settings comment contents verbatim", async () => {
	const license = "/*! Copyright Example\n * SPDX-License-Identifier: MIT\n */";
	const settings =
		"/* @settings\nname: Test\nsettings:\n  - id: test\n    title: Test\n*/";
	const result = await postcss([formatCss()]).process(
		`${license}\n${settings}\n.x { color: red }`,
		{ from: undefined },
	);
	expect(result.css).toContain(license);
	expect(result.css).toContain(settings);
});

it("does not shorten a shorthand whose variables can expand into multiple values", async () => {
	const result = await postcss([formatCss()]).process(
		".x { padding: var(--p) var(--p) var(--p) var(--p); }",
		{ from: undefined },
	);
	expect(result.css).toContain("padding: var(--p) var(--p) var(--p) var(--p);");
});

it.each([
	".cm-s-obsidian span.cm-highlight",
	".cm-s-obsidian span.cm-highlight.obsidian-search-match-highlight",
	".cm-s-obsidian span.is-flashing:where(.cm-highlight)",
	".cm-s-obsidian span.cm-hashtag.cm-hmd-escape-backslash:where(.cm-highlight)",
	".cm-s-obsidian span.cm-formatting-link.cm-url:where(.cm-highlight)",
	".cm-s-obsidian span.cm-formatting-link.cm-url:where(.cm-highlight):hover",
	".markdown-source-view.mod-cm6 span.cm-highlight.cm-footref",
	".markdown-source-view.mod-cm6 span.cm-highlight.cm-hmd-footnote",
	".cm-s-obsidian .cm-line.HyperMD-footnote span.cm-hmd-footnote.cm-formatting:where(.cm-highlight)",
])(
	"limits the highlight exception to its exact surface: %s",
	async (selector) => {
		const css = `${selector} { background-color: var(--highlight) }`;
		await expect(
			postcss([checkCss()]).process(css, {
				from: "src/markdown/inline-marks.css",
			}),
		).resolves.toBeDefined();
		await expect(check(css)).rejects.toThrow();
		await expect(
			postcss([checkCss()]).process(css.replace("span.", "div."), {
				from: "src/markdown/inline-marks.css",
			}),
		).rejects.toThrow();
	},
);

it.each([".modal button.mod-cta", ".modal button.mod-cta:hover"])(
	"allows only the exact modal CTA rival %s",
	async (selector) => {
		const css = `${selector} { background-color: var(--cyan) }`;
		await expect(
			postcss([checkCss()]).process(css, { from: "src/global/modals.css" }),
		).resolves.toBeDefined();
		await expect(check(css)).rejects.toThrow();
		await expect(
			postcss([checkCss()]).process(css.replace("button.", "div."), {
				from: "src/global/modals.css",
			}),
		).rejects.toThrow();
	},
);

it.each([
	"overflow-wrap: break-word; word-wrap: normal",
	"gap: 2px; grid-gap: 1px",
	"break-before: page; page-break-before: avoid",
])(
	"keeps legacy alias declarations in source order: %s",
	async (declarations) => {
		const result = await postcss([formatCss()]).process(
			`.x { ${declarations} }`,
			{ from: undefined },
		);
		const [first, second] = declarations.split("; ");
		expect(result.css.indexOf(first ?? "")).toBeLessThan(
			result.css.indexOf(second ?? ""),
		);
	},
);
it("allows only the exact disabled community-sidebar rival in overrides.css", async () => {
	const css =
		".mod-community-modal .modal-sidebar button.clickable-icon:where([aria-disabled='true']) { color: var(--text-disabled) }";
	await expect(
		postcss([checkCss()]).process(css, {
			from: "src/sections/community-browser.css",
		}),
	).resolves.toBeDefined();
	await expect(check(css)).rejects.toThrow();
	await expect(
		postcss([checkCss()]).process(css.replace("button.", "div."), {
			from: "src/sections/community-browser.css",
		}),
	).rejects.toThrow();
});

it("preserves comment lists, descriptions, explicit headings and literal replacement codes", async () => {
	const license = "/*! Copyright $& $' */";
	const result = await postcss([formatCss()]).process(
		`${license}
/* 1. First item
2. Second item
- Last item */
.x { color: red; }
/* Hover state */
.y { color: blue; }
/* @heading States */
.z { color: green; }`,
		{ from: undefined },
	);
	expect(result.css).toContain(license);
	expect(result.css).toContain(
		" * 1. First item\n * 2. Second item\n * - Last item",
	);
	expect(result.css).toContain(" * Hover state\n */\n.y");
	expect(result.css).toContain(
		" * States\n * -----------------------------------------------------------------------------\n */\n\n.z",
	);
});

it("lists only emitted sections, counts continuations after the first banner, and reformats idempotently", async () => {
	const input =
		"/* @section src/components/empty.css */ /* @section src/settings/legacy.css (continued) */ .x { color:red; } /* @section src/markdown/code.css */ .y { color:blue; } /* @section src/settings/legacy.css (continued) */ .z { color:green; }";
	const once = await postcss([formatCss()]).process(input, { from: undefined });
	expect(once.css).not.toContain("empty.css");
	expect(
		once.css.match(/@pending legacy port: Legacy \(continued\)/g),
	).toHaveLength(1);
	const twice = await postcss([formatCss()]).process(once.css, {
		from: undefined,
	});
	expect(twice.css).toBe(once.css);
});

it("keeps user comments that mention generated header words and repeated selectors", async () => {
	const result = await postcss([formatCss()]).process(
		"/* CONTENTS of this example mention Miami Wind: Obsidian theme */ .x, .x { color: red; }",
		{ from: undefined },
	);
	expect(result.css).toContain(
		"CONTENTS of this example mention Miami Wind: Obsidian theme",
	);
	expect(
		postcss
			.parse(result.css)
			.nodes.find((node) => node.type === "rule")
			?.toString(),
	).toContain(".x,\n.x");
});

it("keeps consecutive source notes as paragraphs directly above their rule", async () => {
	const result = await postcss([formatCss()]).process(
		"/* Background note. */\n/* Callouts */\n.x { color: red; }",
		{ from: undefined },
	);
	expect(result.css).toContain(" * Background note.\n *\n * Callouts\n */\n.x");
	const twice = await postcss([formatCss()]).process(result.css, {
		from: undefined,
	});
	expect(twice.css).toBe(result.css);
});

it("prints the actual tokens-block headings with their rule lines", async () => {
	const tokens = await readFile("src/settings/tokens.css", "utf8");
	const result = await postcss([formatCss()]).process(tokens, {
		from: undefined,
	});
	expect(result.css).toContain(
		`\t/*\n\t * Application backgrounds\n\t * ${"-".repeat(73)}\n\t */`,
	);
});

it("keeps generated banner rule lines within 80 characters", async () => {
	const result = await postcss([formatCss()]).process(
		"/* @section src/markdown/code.css */ .x { color: red; }",
		{ from: undefined },
	);
	for (const line of result.css
		.split("\n")
		.filter((line) => /^[/ *]+-{3,}/.test(line)))
		expect(line.length).toBeLessThanOrEqual(80);
});

it("keeps hanging indents on wrapped numbered and dashed list items", async () => {
	const result = await postcss([formatCss()]).process(
		"/* 1. Numbered item\n   continues on this line.\n- Dashed item\n  continues on this line. */ .x { color: red; }",
		{ from: undefined },
	);
	expect(result.css).toContain(
		" * 1. Numbered item\n *    continues on this line.\n * - Dashed item\n *   continues on this line.",
	);
	const twice = await postcss([formatCss()]).process(result.css, {
		from: undefined,
	});
	expect(twice.css).toBe(result.css);
});

it("uses real section descriptions and requires them for new surfaces", async () => {
	const result = await postcss([formatCss()]).process(
		"/* @source: src/unmapped.css */ /* @section src/markdown/code.css */ .x { color: red; }",
		{ from: undefined },
	);
	expect(result.css).toContain("@source: src/unmapped.css");
	expect(result.css).toContain(
		"Inline code, fenced code and editor syntax tokens: colors and backgrounds.",
	);
	expect(result.css).not.toContain("Obsidian code surface.");
	await expect(
		postcss([formatCss()]).process(
			"/* @section src/unknown.css */ .x { color: red; }",
			{ from: undefined },
		),
	).rejects.toThrow("Missing section description for src/unknown.css");
});

it("requires blank lines exactly between settings variable families", async () => {
	for (const [css, valid] of [
		[
			".theme-dark { --icon-color: red;\n --icon-color-hover: blue;\n\n --tab-color: red; }",
			true,
		],
		[".theme-dark { --icon-color: red;\n --tab-color: blue; }", false],
		[".theme-dark { --icon-color: red;\n\n --icon-color-hover: blue; }", false],
	] as const) {
		const result = postcss([checkCss()]).process(css, {
			from: "src/settings/tokens.css",
		});
		if (valid) await expect(result).resolves.toBeDefined();
		else await expect(result).rejects.toThrow("Separate variable families");
	}
});
