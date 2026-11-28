import { expect, it } from "vitest";
import {
	bySurface,
	itemName,
	kinds,
	plainProperty,
	plainReason,
	plainValue,
	stateName,
	surfaceName,
} from "./words.ts";

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
	expect(plainReason("background image content is not reconstructed")).toBe(
		"contains a background image the tool cannot load",
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

it("says states in plain words and drops Obsidian's font placeholders", () => {
	expect(stateName("expanded-after-click")).toBe("expanded after click");
	expect(plainValue('"??", "Liberation Sans", "??", ui-sans-serif')).toBe(
		'"Liberation Sans", ui-sans-serif',
	);
	expect(plainValue("'??', Inter")).toBe("Inter");
	expect(plainValue("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
	expect(plainValue(null)).toBeNull();
});

it("names the compare tool's stand-in for a theme value", () => {
	expect(itemName("probe:--canvas-color-1")).toBe("the theme value --canvas-color-1");
	expect(itemName("body.theme-dark.mod-linux")).toBe("the whole window");
});
