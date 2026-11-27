import { expect, it } from "vitest";
import { organize, probes } from "./organization.ts";

const paths = [
	"components/action-button.css",
	"global/inputs.css",
	"global/menus.css",
	"markdown/tags.css",
	"sections/canvas.css",
	"sections/pdf-forms.css",
	"sections/pdf-xfa.css",
	"settings/tokens.css",
];

it("gives every item one place, and sends overlaps to Global", () => {
	const named = {
		tag: ["markdown/tags.css"],
		menu: ["global/menus.css"],
		// Named from Global and from an app section: an overlap.
		"text-input": ["global/inputs.css", "sections/canvas.css"],
		// Named from two places, neither of them Global: still belongs in Global.
		checkbox: ["markdown/tags.css", "sections/pdf-forms.css"],
		// Two files of the same app section are one place.
		pdf: ["sections/pdf-forms.css", "sections/pdf-xfa.css"],
		// Shared mixins and variables own no item.
		button: ["components/action-button.css", "settings/tokens.css", "global/menus.css"],
	};
	const o = organize(
		{
			named,
			selected: {
				...named,
				// Reached by rules in two places that do not name it (.xfaSelect on a select): no
				// overlap. It is listed under Global because Global is one of them.
				dropdown: ["global/inputs.css", "sections/pdf-xfa.css"],
				// Reached, never named, from one place: listed there.
				callout: ["markdown/tags.css"],
			},
		},
		["tag", "menu", "text-input", "checkbox", "pdf", "button", "gutter", "dropdown", "callout"],
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
		button: "global global/menus.css",
		"text-input": "global global/inputs.css",
		checkbox: "global markdown/tags.css",
		pdf: "sections/pdf sections/pdf-forms.css",
		gutter: "other ",
		dropdown: "global global/inputs.css",
		callout: "markdown markdown/tags.css",
	});
	expect(o.sections.map((s) => s.id)).toEqual(["global", "markdown", "sections/pdf", "other"]);
	expect(o.overlaps).toEqual([
		{ item: "checkbox", files: ["markdown/tags.css", "sections/pdf-forms.css"] },
		{ item: "text-input", files: ["global/inputs.css", "sections/canvas.css"] },
	]);
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
					".tree-item.is-active { color: red }",
				].join("\n"),
			},
		],
		(s) => s.replace(":hover", "[data-hover]"),
	);
	expect(found).toEqual([
		{
			file: 0,
			full: ".canvas-control-item[data-hover] .svg-icon",
			last: { classes: ["svg-icon"], attributes: [] },
			prefixes: [".canvas-control-item[data-hover]"],
		},
		{ file: 0, full: "hr", last: { tag: "hr", classes: [], attributes: [] }, prefixes: [] },
		{
			file: 0,
			full: ".tree-item.is-active",
			last: { classes: ["tree-item", "is-active"], attributes: [] },
			prefixes: [],
		},
	]);
});
