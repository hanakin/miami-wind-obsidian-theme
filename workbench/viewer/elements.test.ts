import { expect, it } from "vitest";
import { matchesElement, touchedComponents } from "./elements.ts";

it("matches an element key against tag and class selectors", () => {
	expect(matchesElement("button", "12:button.mod-cta")).toBe(true);
	expect(matchesElement("button.mod-cta", "12:button.mod-cta::before")).toBe(true);
	expect(matchesElement("button.mod-cta", "12:button")).toBe(false);
	expect(matchesElement("a.tag, .cm-hashtag", "3:span.cm-hashtag.cm-meta")).toBe(true);
	expect(matchesElement(".menu", "3:div.menu-item")).toBe(false);
	// The key has no attributes, so this is never a sure match.
	expect(matchesElement("input[type=checkbox]", "5:input.task-list-item-checkbox")).toBe(false);
});

it("lists the components a capture's differences land on", () => {
	const selectors = { button: "button", tag: "a.tag, .cm-hashtag", menu: ".menu" };
	expect(
		touchedComponents(
			[{ element: "4:a.tag" }, { element: "4:a.tag::after" }, { element: "9:div.setting-item" }],
			["button", "tag", "menu", "unknown"],
			selectors,
		),
	).toEqual(["tag"]);
});
