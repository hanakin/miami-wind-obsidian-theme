import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sha256, side, verifiedTheme } from "./themes.ts";

const root = mkdtempSync(join(tmpdir(), "mw-viewer-themes-"));
const out = join(root, "out");
mkdirSync(join(out, "themes"), { recursive: true });
const css = ".a { color: red; }";
writeFileSync(join(out, "themes", "after.css"), css);
afterAll(() => rmSync(root, { recursive: true }));

it("uses a saved theme only when its content has the recorded hash", () => {
	const good = { file: "themes/after.css", sha256: sha256(css) };
	expect(verifiedTheme(out, good)).toBe(join(out, "themes", "after.css"));
	// The file was replaced with different CSS: no longer the theme the report compared.
	expect(verifiedTheme(out, { ...good, sha256: sha256(".a { color: blue; }") })).toBeNull();
	// No recorded hash means nothing to verify against.
	expect(verifiedTheme(out, { file: "themes/after.css" })).toBeNull();
	expect(verifiedTheme(out, { file: "themes/missing.css", sha256: sha256(css) })).toBeNull();
	expect(verifiedTheme(out, { file: "../secret.css", sha256: sha256(css) })).toBeNull();
	expect(verifiedTheme(out, undefined)).toBeNull();
});

it("refuses a saved theme that is a symlink out of the themes folder", () => {
	const outside = join(root, "outside.css");
	writeFileSync(outside, css);
	symlinkSync(outside, join(out, "themes", "escape.css"));
	// Right name, right hash, but the real file lives outside workbench/out/themes.
	expect(verifiedTheme(out, { file: "themes/escape.css", sha256: sha256(css) })).toBeNull();
	// A directory is not a theme file either.
	mkdirSync(join(out, "themes", "dir.css"));
	expect(verifiedTheme(out, { file: "themes/dir.css", sha256: sha256(css) })).toBeNull();
});

it("says a side matches the report only when the text drawn is provably the same", () => {
	const good = { file: "themes/after.css", sha256: sha256(css) };
	expect(side(out, good, "anything")).toEqual({
		path: join(out, "themes", "after.css"),
		matches: true,
	});
	// No usable saved file, but the viewer's own copy has the recorded hash.
	expect(side(out, { sha256: sha256(css) }, css)).toEqual({ path: null, matches: true });
	// A tampered saved file falls back to the viewer's copy, which is not what was compared.
	const tampered = { file: "themes/after.css", sha256: sha256("other") };
	expect(side(out, tampered, "current build")).toEqual({ path: null, matches: false });
	expect(side(out, undefined, css)).toEqual({ path: null, matches: false });
});
