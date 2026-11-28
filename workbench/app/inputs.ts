// Checks a saved result against the files it was made from. The compare tool records, for every
// capture, each file it read and the SHA-256 of the bytes it read (compare.json, `inputs`). A
// result counts only while every one of those files still has exactly those bytes, so a changed
// or deleted input never keeps an old "Same". Nothing is hashed at import time and no modified
// time is trusted: only the recorded hashes against the bytes on disk now.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// The hash of a file's bytes as they are now: read every time, never remembered by size or date.
function fileHash(path: string): string | undefined {
	try {
		return statSync(path).isFile() ? sha(readFileSync(path)) : undefined;
	} catch {
		return undefined;
	}
}

/** The content hash of each capture's own file, by id: what the organization cache depends on. */
export function fixtureHashes(root: string, fixtures: { id: string; file: string }[]): string[] {
	return fixtures.map(
		(f) => `${f.id}:${fileHash(`${root}capture/fixtures/${f.file}`) ?? "missing"}`,
	);
}

/** Says whether a result's recorded inputs are still what is on disk. */
export type Valid = (inputs: unknown) => boolean;

/**
 * A check for one pass over many results. `inputs` maps each file the compare tool read (a path
 * from the repository root, or an absolute path outside it) to the SHA-256 of the bytes it read.
 * True only when there is at least one recorded input and every one is a file with those bytes
 * now. Missing inputs, a missing file, or other bytes: false. `root` ends with a slash.
 */
export function validator(root: string): Valid {
	// Within one pass each file is looked at once.
	const now = new Map<string, string | undefined>();
	const current = (path: string) => {
		if (!now.has(path)) now.set(path, fileHash(isAbsolute(path) ? path : `${root}${path}`));
		return now.get(path);
	};
	return (inputs) => {
		if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) return false;
		const recorded = Object.entries(inputs as Record<string, unknown>);
		return (
			recorded.length > 0 &&
			recorded.every(([path, hash]) => typeof hash === "string" && current(path) === hash)
		);
	};
}
