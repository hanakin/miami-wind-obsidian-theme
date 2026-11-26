import { expect, it } from "vitest";
import { bySurface, kinds, plainProperty, plainReason, surfaceName } from "./words.ts";

it("names surfaces plainly and puts phone and tablet last", () => {
	expect(surfaceName("editor-live-preview")).toBe("Live preview");
	expect(surfaceName("left-sidebar")).toBe("Left sidebar");
	expect(
		["mobile-tablet", "settings", "mobile-phone", "canvas", "editor-reading-view"].sort(bySurface),
	).toEqual(["canvas", "editor-reading-view", "settings", "mobile-phone", "mobile-tablet"]);
});

it("says not-proven reasons in plain words", () => {
	expect(plainReason("canvas content is not reconstructed")).toBe(
		"contains a drawing the tool cannot redraw",
	);
	expect(plainReason("target has no visible box")).toBe("the item was not visible in the capture");
	expect(plainReason("embed content is not reconstructed")).toBe(
		"contains embed content the tool cannot rebuild",
	);
	expect(plainReason("something new")).toBe("something new");
});

it("sums up property lists as kinds of change", () => {
	expect(kinds(["border-top-color", "color", "padding-left", "-webkit-text-stroke-color"])).toBe(
		"borders, colors, spacing",
	);
	expect(kinds(["display"])).toBe("layout");
	expect(plainProperty("-webkit-text-fill-color")).toBe("text fill color");
});
