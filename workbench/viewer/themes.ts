// Decides which theme text each side of a comparison is drawn with, and whether that is provably
// the text the compare report describes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { sep } from "node:path";

/** What a compare report records about one of the two themes it compared. */
export interface ReportTheme {
	sha256?: string;
	source?: string;
	/** The theme text the report compared, saved beside it (relative to the out directory). */
	file?: string;
}

export const sha256 = (text: string | Uint8Array) =>
	createHash("sha256").update(text).digest("hex");

/**
 * The text of the saved theme a report points at, only when it can be trusted: a plain name under
 * `<outDir>/themes`, a regular file that really lives there (no symlink out of it), whose content
 * has the hash the report recorded. Anything else gives null.
 *
 * It returns the bytes it verified, not the path: a caller that kept the path and read it again
 * later could be handed a different file.
 */
export function verifiedTheme(outDir: string, theme: ReportTheme | undefined): string | null {
	if (!theme?.file || !theme.sha256 || !/^themes\/[\w.-]+\.css$/.test(theme.file)) return null;
	const path = `${outDir}/${theme.file}`;
	if (!existsSync(path)) return null;
	const real = realpathSync(path);
	if (!real.startsWith(realpathSync(`${outDir}/themes`) + sep) || !statSync(real).isFile()) {
		return null;
	}
	const bytes = readFileSync(real);
	return sha256(bytes) === theme.sha256 ? bytes.toString("utf8") : null;
}

/**
 * How one side is drawn: with the report's saved theme text when it is verified, otherwise with
 * `fallback` (the viewer's own copy of that theme). `matches` is true only when the text drawn is
 * provably the text the report compared.
 */
export function side(
	outDir: string,
	theme: ReportTheme | undefined,
	fallback: string,
): { css: string; matches: boolean } {
	const saved = verifiedTheme(outDir, theme);
	return {
		css: saved ?? fallback,
		matches: saved !== null || (!!theme?.sha256 && sha256(fallback) === theme.sha256),
	};
}
