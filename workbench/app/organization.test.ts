import { expect, it } from "vitest";
import { lastCompounds, organize, probes } from "./organization.ts";

const paths = [
	"components/action-button.css",
	"global/inputs.css",
	"global/menus.css",
	"markdown/callouts.css",
	"markdown/tags.css",
	"sections/canvas.css",
	"sections/pdf.css",
	"sections/pdf-xfa.css",
	"settings/tokens.css",
];

const hit = (
	item: string,
	file: string,
	how: "named" | "through" | "selected" | "adjustment" = "named",
	line = 1,
) => ({
	item,
	file,
	line,
	selector: `.${item}`,
	how: how === "adjustment" ? ("named" as const) : how,
	adjustment: how === "adjustment",
});

it("gives every item one place, and sends overlaps to Global", () => {
	const o = organize(
		[
			hit("tag", "markdown/tags.css"),
			hit("menu", "global/menus.css"),
			// Several files inside one place are fine.
			hit("button", "global/menus.css"),
			hit("button", "global/inputs.css"),
			// Shared mixins and variables own no item.
			hit("button", "components/action-button.css"),
			hit("button", "settings/tokens.css"),
			// Named from Global and from an app section: the base styling is split.
			hit("text-input", "global/inputs.css", "named", 4),
			hit("text-input", "sections/canvas.css", "named", 9),
			// Named from two places, neither of them Global: still belongs in Global.
			hit("checkbox", "markdown/tags.css"),
			hit("checkbox", "sections/pdf.css"),
			// pdf.css and pdf-xfa.css are one place.
			hit("pdf", "sections/pdf.css"),
			hit("pdf", "sections/pdf-xfa.css"),
			// A section's labeled, scoped adjustment of a shared item: allowed, and noted.
			hit("clickable-icon", "global/menus.css"),
			hit("clickable-icon", "sections/canvas.css", "adjustment"),
			// Selected from two places that do not name it (.xfaSelect on a select): no overlap.
			// It is listed with the file that has more rules for it.
			hit("dropdown", "global/inputs.css", "selected", 1),
			hit("dropdown", "global/inputs.css", "selected", 2),
			hit("dropdown", "sections/pdf-xfa.css", "selected"),
			// A rule that passes through the item beats one that only selects its element, and a
			// file named after the item beats one with more rules.
			hit("callout", "markdown/callouts.css", "through"),
			hit("callout", "markdown/tags.css", "through", 1),
			hit("callout", "markdown/tags.css", "through", 2),
			hit("callout", "global/menus.css", "selected"),
		],
		[
			"tag",
			"menu",
			"text-input",
			"checkbox",
			"pdf",
			"button",
			"gutter",
			"dropdown",
			"callout",
			"clickable-icon",
		],
		paths,
	);
	const where = Object.fromEntries(
		o.sections.flatMap((s) =>
			s.groups.flatMap((g) => g.items.map((i) => [i, `${s.id} ${g.file}`])),
		),
	);
	expect(where).toEqual({
		tag: "markdown markdown/tags.css",
		menu: "global global/menus.css",
		button: "global global/inputs.css",
		"clickable-icon": "global global/menus.css",
		"text-input": "global global/inputs.css",
		checkbox: "global markdown/tags.css",
		pdf: "sections/pdf sections/pdf.css",
		gutter: "other ",
		dropdown: "global global/inputs.css",
		callout: "markdown markdown/callouts.css",
	});
	expect(o.sections.map((s) => s.id)).toEqual(["global", "markdown", "sections/pdf", "other"]);
	expect(o.overlaps).toEqual([
		{
			item: "checkbox",
			files: ["markdown/tags.css", "sections/pdf.css"],
			rules: ["src/markdown/tags.css:1  .checkbox", "src/sections/pdf.css:1  .checkbox"],
		},
		{
			item: "text-input",
			files: ["global/inputs.css", "sections/canvas.css"],
			rules: ["src/global/inputs.css:4  .text-input", "src/sections/canvas.css:9  .text-input"],
		},
	]);
	expect(o.adjusted).toEqual({ "clickable-icon": ["sections/canvas.css"] });
});

it("reads the selectors that can own an item, and leaves out states, context and variables", () => {
	const found = probes(
		[
			{
				path: "sections/canvas.css",
				css: [
					".canvas-control-item:hover .svg-icon, hr { color: red }",
					// A mixin body, bare selected text, a state, a context carrier, a variables-only rule.
					"@define-mixin x { .in-mixin { color: red } }",
					"::selection { color: red }",
					".workspace-leaf.mod-active .is-active { color: red }",
					".theme-dark, body.is-mobile { color: red }",
					".canvas-wrapper { --canvas-dot-pattern: red }",
					"/* Shared component adjustments: icons in Canvas. */",
					".canvas-wrapper .clickable-icon { color: red }",
					".clickable-icon { color: red }",
					"/* Canvas cards. */",
					".canvas-wrapper .tree-item.is-active { color: red }",
				].join("\n"),
			},
		],
		(s) => s.replace(":hover", "[data-hover]"),
	);
	expect(found.map((p) => [p.selector, p.line, p.adjustment, p.full])).toEqual([
		[
			".canvas-control-item:hover .svg-icon",
			1,
			false,
			".canvas-control-item[data-hover] .svg-icon",
		],
		["hr", 1, false, "hr"],
		// Under the label and scoped to a container: an adjustment. Unscoped: not one.
		[".canvas-wrapper .clickable-icon", 8, true, ".canvas-wrapper .clickable-icon"],
		[".clickable-icon", 9, false, ".clickable-icon"],
		// The next comment ends the label.
		[".canvas-wrapper .tree-item.is-active", 11, false, ".canvas-wrapper .tree-item.is-active"],
	]);
	expect(found[4]?.last).toEqual({ classes: ["tree-item", "is-active"], attributes: [] });
	expect(found[0]?.prefixes).toEqual([".canvas-control-item[data-hover]"]);
	// An attribute test alone can select an item; it never names one.
	const [weak] = probes(
		[{ path: "markdown/callouts.css", css: ".cm-callout [data-callout='note'] { color: red }" }],
		(s) => s,
	);
	expect(weak?.weak).toBe(true);
});

it("reads an item named inside :is() or :where() as if written out", () => {
	const names = (css: string) =>
		probes([{ path: "sections/canvas.css", css }], (s) => s).map(
			(p) => `${p.last.tag ?? ""}${p.last.classes.map((c) => `.${c}`).join("")}`,
		);
	// The review's case: `button {}` in global/ and `:is(button) {}` in a section must both name button.
	expect(names(":is(button) { color: red }")).toEqual(["button"]);
	expect(names(".canvas :where(button, .tag).big { color: red }")).toEqual([
		"button.big",
		".tag.big",
	]);
	// Nested, and with a complex alternative: the alternative's own last part is the name.
	expect(names(":is(:where(.menu .menu-item), kbd) { color: red }")).toEqual([".menu-item", "kbd"]);
	// Only states inside: still names nothing. :not() is not a name.
	expect(names(":is(.is-active, .mod-cta) { color: red }")).toEqual([]);
	expect(names(".tag:not(button) { color: red }")).toEqual([".tag"]);
	expect(lastCompounds(":is(button, .x)").map((c) => c.tag ?? c.classes[0])).toEqual([
		"button",
		"x",
	]);
});

it("reports an overlap made through :is()", () => {
	const [inner] = probes(
		[{ path: "sections/canvas.css", css: ":is(button) { color: red }" }],
		(s) => s,
	);
	// The matcher calls a rule "named" when its last part carries the item's own name.
	const named = (item: string, file: string, selector: string) => ({
		item,
		file,
		line: 1,
		selector,
		how: "named" as const,
		adjustment: false,
	});
	expect(inner?.last.tag).toBe("button");
	const out = organize(
		[
			named("button", "global/inputs.css", "button"),
			named("button", "sections/canvas.css", ":is(button)"),
		],
		["button"],
		paths,
	);
	expect(out.overlaps.map((o) => o.item)).toEqual(["button"]);
});
