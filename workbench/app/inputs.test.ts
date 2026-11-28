import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, expect, it } from "vitest";
import { fingerprints, fixtureHashes } from "./inputs.ts";
import { cacheKey } from "./match.ts";

const root = `${mkdtempSync(`${tmpdir()}/mw-inputs-`)}/`;
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(`${root}capture/fixtures`, { recursive: true });
mkdirSync(`${root}capture/.app/runtime`, { recursive: true });
mkdirSync(`${root}capture/scripts`, { recursive: true });
const write = (path: string, text: string) => writeFileSync(`${root}${path}`, text);
write("capture/.app/app.css", "body{color:red}");
write("capture/fixtures/a.html", "<p>a</p>");
write("capture/fixtures/b.html", "<p>b</p>");
write("capture/fixtures/b.png", "pixels");
const list = [
	{ id: "a", file: "a.html", component: "kbd" },
	{ id: "b", file: "b.html", component: "tag", canvasPixels: [{ file: "b.png" }] },
];

it("changes one capture's fingerprint when its markup or its recorded pixels change", () => {
	const first = fingerprints(root, list);
	write("capture/fixtures/b.png", "other pixels");
	const second = fingerprints(root, list);
	expect(second.fixtures.a).toBe(first.fixtures.a);
	expect(second.fixtures.b).not.toBe(first.fixtures.b);
	expect(second.components.tag).not.toBe(first.components.tag);
	write("capture/fixtures/a.html", "<p>a changed</p>");
	expect(fingerprints(root, list).fixtures.a).not.toBe(first.fixtures.a);
});

it("changes every fingerprint when Obsidian's CSS, a runtime sheet or the replay code changes", () => {
	for (const path of [
		"capture/.app/app.css",
		"capture/.app/runtime/abc.css",
		"capture/scripts/replay.ts",
	]) {
		const before = fingerprints(root, list);
		write(path, `/* ${path} changed */`);
		const after = fingerprints(root, list);
		expect(after.fixtures.a, path).not.toBe(before.fixtures.a);
		expect(after.fixtures.b, path).not.toBe(before.fixtures.b);
	}
});

it("changes the organization cache key when a capture's markup changes", () => {
	const key = () => cacheKey(["same selectors", "same list", fixtureHashes(root, list)]);
	const before = key();
	expect(key()).toBe(before);
	write("capture/fixtures/a.html", "<p>a, with a button inside now</p>");
	expect(key()).not.toBe(before);
});
