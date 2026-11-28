import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, expect, it } from "vitest";
import { fixtureHashes, validator } from "./inputs.ts";
import { cacheKey } from "./match.ts";

const root = `${mkdtempSync(`${tmpdir()}/mw-inputs-`)}/`;
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(`${root}capture/fixtures`, { recursive: true });
const write = (path: string, text: string) => writeFileSync(`${root}${path}`, text);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

it("accepts recorded inputs only while every file still has the recorded bytes", () => {
	write("capture/fixtures/a.html", "<p>a</p>");
	write("app.css", "body{}");
	const outside = `${root}outside-theme.css`;
	writeFileSync(outside, "theme");
	// As the compare tool records them: paths from the repository root, absolute outside it.
	const inputs = {
		"capture/fixtures/a.html": sha("<p>a</p>"),
		"app.css": sha("body{}"),
		[outside]: sha("theme"),
	};
	expect(validator(root)(inputs)).toBe(true);
	// Same size, other bytes: no size or date shortcut hides it.
	write("app.css", "html{}");
	expect(validator(root)(inputs)).toBe(false);
	write("app.css", "body{}");
	expect(validator(root)(inputs)).toBe(true);
	// A deleted input.
	rmSync(`${root}capture/fixtures/a.html`);
	expect(validator(root)(inputs)).toBe(false);
});

it("rejects a result with no recorded inputs, or with anything that is not a map of hashes", () => {
	const valid = validator(root);
	for (const inputs of [undefined, null, {}, "abc", ["app.css"], { "app.css": 1 }]) {
		expect(valid(inputs), JSON.stringify(inputs)).toBe(false);
	}
	// A folder is not a file with those bytes.
	expect(valid({ capture: sha("") })).toBe(false);
});

it("changes the organization cache key when a capture's markup changes", () => {
	const list = [{ id: "a", file: "a.html" }];
	write("capture/fixtures/a.html", "<p>a</p>");
	const key = () => cacheKey(["same selectors", "same list", fixtureHashes(root, list)]);
	const before = key();
	expect(key()).toBe(before);
	write("capture/fixtures/a.html", "<p>b</p>");
	expect(key()).not.toBe(before);
});
