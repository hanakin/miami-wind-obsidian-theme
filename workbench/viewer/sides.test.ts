import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { parseChoice, resolveSide, sha256 } from "./sides.ts";

const root = mkdtempSync(join(tmpdir(), "mw-viewer-sides-"));
afterAll(() => rmSync(root, { recursive: true }));
const css = ".a { color: red; }";
mkdirSync(join(root, "my-theme"));
writeFileSync(join(root, "my-theme", "theme.css"), css);
writeFileSync(join(root, "theme.css"), ".build { color: blue; }");
writeFileSync(join(root, "notes.txt"), "secret");

it("reads a theme folder or a .css file, and names it by its folder", () => {
	const fromFolder = resolveSide(root, { kind: "path", path: join(root, "my-theme") });
	expect(fromFolder).toEqual({
		label: "my-theme/theme.css",
		css,
		sha256: sha256(css),
		watch: join(root, "my-theme", "theme.css"),
	});
	expect(resolveSide(root, { kind: "path", path: join(root, "my-theme", "theme.css") }).css).toBe(
		css,
	);
	expect(resolveSide(root, { kind: "build" })).toMatchObject({
		label: "Current build",
		css: ".build { color: blue; }",
	});
});

it("gives Default Obsidian an empty theme", () => {
	expect(resolveSide(root, { kind: "default" })).toEqual({
		label: "Default Obsidian",
		css: "",
		sha256: sha256(""),
		watch: undefined,
	});
});

it("serves nothing but .css files", () => {
	const read = (path: string) => () => resolveSide(root, { kind: "path", path });
	expect(read(join(root, "notes.txt"))).toThrow("Only .css files");
	expect(read("relative/theme.css")).toThrow("full path");
	expect(read(join(root, "missing"))).toThrow("Nothing is at that path");
	mkdirSync(join(root, "empty"));
	expect(read(join(root, "empty"))).toThrow("no theme.css");
	// A .css name that is really a link to something else is judged by what it points at.
	symlinkSync(join(root, "notes.txt"), join(root, "sneaky.css"));
	expect(read(join(root, "sneaky.css"))).toThrow("Only .css files");
});

it("reads a git version, and refuses anything that is not a version name", () => {
	const repo = join(root, "repo");
	mkdirSync(repo);
	const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	run("init", "-q");
	writeFileSync(join(repo, "theme.css"), ".v1 {}");
	run("add", "theme.css");
	run("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "v1");
	run("tag", "v1.0.0");
	expect(resolveSide(repo, { kind: "git", ref: "v1.0.0" })).toMatchObject({
		label: "Miami Wind v1.0.0",
		css: ".v1 {}",
	});
	for (const ref of ["--output=/tmp/x", "v1.0.0:../secret", "a b", "HEAD..x", ""]) {
		expect(() => resolveSide(repo, { kind: "git", ref })).toThrow("not a version name");
	}
	expect(() => resolveSide(repo, { kind: "git", ref: "no-such-tag" })).toThrow("no version");
});

it("accepts only the known kinds of side from the page", () => {
	expect(parseChoice({ kind: "git", ref: "v1" })).toEqual({ kind: "git", ref: "v1" });
	expect(parseChoice({ kind: "path", path: "/x", extra: 1 })).toEqual({ kind: "path", path: "/x" });
	for (const bad of [null, {}, { kind: "git" }, { kind: "path", path: 3 }, { kind: "file" }]) {
		expect(() => parseChoice(bad)).toThrow("Unknown kind");
	}
});
