// Fingerprints of everything a capture's picture is drawn from besides the two themes: the capture
// itself, Obsidian's own CSS, and the replay code. A saved result is shown only while the
// fingerprint it was made with still matches, so a changed input never keeps an old "Same".
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

/** What the fingerprint reads from a capture's entry in capture/fixtures.json. */
export interface Fingerprinted {
	id: string;
	file: string;
	component: string;
	imageSizes?: { file?: string }[];
	canvasPixels?: { file: string }[];
}

const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

// File hashes, re-read only when a file's size or modified time changes.
const seen = new Map<string, { stamp: string; hash: string; mtime: number }>();
function fileHash(path: string): { hash: string; mtime: number } {
	if (!existsSync(path)) return { hash: "missing", mtime: 0 };
	const stat = statSync(path);
	const stamp = `${stat.size}:${stat.mtimeMs}`;
	let had = seen.get(path);
	if (had?.stamp !== stamp) {
		had = { stamp, hash: sha(readFileSync(path)), mtime: stat.mtimeMs };
		seen.set(path, had);
	}
	return had;
}

/** The content hash of each capture's own file, by id: what the organization cache depends on. */
export function fixtureHashes(root: string, fixtures: { id: string; file: string }[]): string[] {
	return fixtures.map((f) => `${f.id}:${fileHash(`${root}capture/fixtures/${f.file}`).hash}`);
}

export interface Fingerprints {
	/** Each capture's fingerprint, by id. */
	fixtures: Record<string, string>;
	/** Each component's fingerprint: all of its own captures together. */
	components: Record<string, string>;
	/** When the newest input of each capture last changed (ms), by id. */
	changed: Record<string, number>;
}

/**
 * The fingerprint of every capture as its inputs are on disk now. `root` is the repository root
 * with a trailing slash.
 */
export function fingerprints(root: string, fixtures: Fingerprinted[]): Fingerprints {
	const app = `${root}capture/.app`;
	const runtime = existsSync(`${app}/runtime`) ? readdirSync(`${app}/runtime`).sort() : [];
	// Shared by every capture: Obsidian's CSS and the code that draws and compares.
	const shared = [
		`${app}/app.css`,
		`${app}/runtime-styles.css`,
		...runtime.map((name) => `${app}/runtime/${name}`),
		`${root}capture/scripts/replay.ts`,
		`${root}capture/scripts/css.ts`,
		`${root}capture/scripts/inpage.ts`,
	].map(fileHash);
	const sharedHash = sha(shared.map((s) => s.hash).join("\n"));
	const sharedTime = Math.max(0, ...shared.map((s) => s.mtime));
	const out: Fingerprints = { fixtures: {}, components: {}, changed: {} };
	const byComponent = new Map<string, string[]>();
	for (const fixture of fixtures) {
		const files = [
			fixture.file,
			...(fixture.imageSizes ?? []).flatMap((im) => (im.file ? [im.file] : [])),
			...(fixture.canvasPixels ?? []).map((c) => c.file),
		].map((file) => fileHash(`${root}capture/fixtures/${file}`));
		const print = sha(
			[sharedHash, JSON.stringify(fixture), ...files.map((f) => f.hash)].join("\n"),
		);
		out.fixtures[fixture.id] = print;
		out.changed[fixture.id] = Math.max(sharedTime, ...files.map((f) => f.mtime));
		byComponent.set(fixture.component, [...(byComponent.get(fixture.component) ?? []), print]);
	}
	for (const [component, prints] of byComponent) out.components[component] = sha(prints.join("\n"));
	return out;
}
