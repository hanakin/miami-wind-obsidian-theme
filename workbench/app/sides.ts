// The two sides of the workbench. Each is whatever theme CSS Mike points it at: no theme at all,
// a git version of Miami Wind, or a theme folder or file on disk. A side is resolved to its text
// once; everything after that works from those bytes and their hash, never from the path again.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

/** What a side is pointed at, as chosen in the page. */
export type SideChoice =
	| { kind: "default" }
	| { kind: "release" }
	| { kind: "build" }
	| { kind: "git"; ref: string }
	| { kind: "path"; path: string };

/** A side ready to draw: its CSS text and the hash that names it. */
export interface Side {
	label: string;
	css: string;
	sha256: string;
	/** The file to watch for changes, for sides that live on disk. */
	watch?: string;
}

/** The released 1.x theme. */
export const RELEASE_REF = "b478dc8";
const MAX_BYTES = 5 * 1024 * 1024;

export const sha256 = (text: string | Uint8Array) =>
	createHash("sha256").update(text).digest("hex");

const side = (label: string, css: string, watch?: string): Side => ({
	label,
	css,
	sha256: sha256(css),
	watch,
});

/** A theme file on disk: a regular .css file of sane size, read once. */
function file(path: string, label: string): Side {
	if (!isAbsolute(path)) throw new Error("Give the full path, starting with /.");
	if (!existsSync(path)) throw new Error("Nothing is at that path.");
	// A folder means the theme.css inside it, the way Obsidian's theme folders are laid out.
	const target = statSync(path).isDirectory() ? join(path, "theme.css") : path;
	if (!existsSync(target)) throw new Error("That folder has no theme.css.");
	const real = realpathSync(target);
	if (!real.endsWith(".css")) throw new Error("Only .css files can be shown.");
	const stat = statSync(real);
	if (!stat.isFile()) throw new Error("That is not a file.");
	if (stat.size > MAX_BYTES) throw new Error("That file is too large to be a theme.");
	return side(label, readFileSync(real, "utf8"), real);
}

/** A version of Miami Wind's theme.css from the repository's history. */
function git(root: string, ref: string, label: string): Side {
	// A plain commit, tag or branch name: nothing git could read as an option or a path.
	if (!/^[\w][\w./-]*$/.test(ref) || ref.includes(".."))
		throw new Error("That is not a version name.");
	try {
		return side(
			label,
			execFileSync("git", ["show", `${ref}:theme.css`], {
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				maxBuffer: MAX_BYTES,
			}),
		);
	} catch {
		throw new Error(`Miami Wind has no version "${ref}" with a theme.css.`);
	}
}

/** Reads the CSS a choice points at. Throws a plain sentence when it cannot. */
export function resolveSide(root: string, choice: SideChoice): Side {
	switch (choice.kind) {
		case "default":
			return side("Default Obsidian", "");
		case "release":
			return git(root, RELEASE_REF, "Miami Wind 1.x");
		case "build":
			return file(join(root, "theme.css"), "Current build");
		case "git":
			return git(root, choice.ref, `Miami Wind ${choice.ref}`);
		case "path": {
			const path = choice.path.trim();
			const resolved = file(path, "");
			const real = resolved.watch ?? path;
			// "my-theme/theme.css": enough to tell two folders apart at a glance.
			return { ...resolved, label: `${basename(dirname(real))}/${basename(real)}` };
		}
		default:
			throw new Error("Unknown kind of side.");
	}
}

/** Checks a choice sent by the page before anything acts on it. */
export function parseChoice(value: unknown): SideChoice {
	const v = value as { kind?: unknown; ref?: unknown; path?: unknown };
	if (v?.kind === "default" || v?.kind === "release" || v?.kind === "build")
		return { kind: v.kind };
	if (v?.kind === "git" && typeof v.ref === "string") return { kind: "git", ref: v.ref };
	if (v?.kind === "path" && typeof v.path === "string") return { kind: "path", path: v.path };
	throw new Error("Unknown kind of side.");
}
