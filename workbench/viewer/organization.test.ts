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
	const o = organize(
		{
			tag: ["markdown/tags.css"],
			menu: ["global/menus.css"],
			// Styled from Global and from an app section: an overlap.
			"text-input": ["global/inputs.css", "sections/canvas.css"],
			// Styled from two places, neither of them Global: still belongs in Global.
			checkbox: ["markdown/tags.css", "sections/pdf-forms.css"],
			// Two files of the same app section are one place.
			pdf: ["sections/pdf-forms.css", "sections/pdf-xfa.css"],
			// Shared mixins and variables own no item.
			button: ["components/action-button.css", "settings/tokens.css", "global/menus.css"],
		},
		["tag", "menu", "text-input", "checkbox", "pdf", "button", "gutter"],
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
	});
	expect(o.sections.map((s) => s.id)).toEqual(["global", "markdown", "sections/pdf", "other"]);
	expect(o.overlaps).toEqual([
		{ item: "checkbox", files: ["markdown/tags.css", "sections/pdf-forms.css"] },
		{ item: "text-input", files: ["global/inputs.css", "sections/canvas.css"] },
	]);
});

it("reads every selector from the source files, with the parts that lead to it", () => {
	const found = probes(
		[
			{
				path: "sections/canvas.css",
				css: ".canvas-control-item:hover .svg-icon, hr { color: red } @define-mixin x { .in-mixin { color: red } } ::selection { color: red }",
			},
		],
		(s) => s.replace(":hover", "[data-hover]"),
	);
	expect(found).toEqual([
		{
			file: 0,
			full: ".canvas-control-item[data-hover] .svg-icon",
			prefixes: [".canvas-control-item[data-hover]"],
		},
		{ file: 0, full: "hr", prefixes: [] },
	]);
});
