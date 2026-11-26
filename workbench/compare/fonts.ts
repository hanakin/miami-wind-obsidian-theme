import { readFileSync } from "node:fs";
import { extractFile } from "@electron/asar";
import { appAsar } from "../../capture/scripts/obsidian";

export function embedMathjaxFonts(css: string): string {
	const urls = /url\((["']?)(\/lib\/mathjax\/[^"'()\s]+\.woff2)\1\)/g;
	if (!urls.test(css)) return css;
	const archive = appAsar() ?? "/usr/lib/obsidian/obsidian.asar";
	const expected = JSON.parse(
		readFileSync("capture/.app/package.json", "utf8"),
	).version;
	const actual = JSON.parse(
		extractFile(archive, "package.json").toString("utf8"),
	).version;
	if (actual !== expected)
		throw new Error(
			`MathJax font archive ${actual} does not match extracted app CSS ${expected}`,
		);
	// Replay pages have no app:// origin. Embed only shipped MathJax fonts; external requests stay blocked.
	return css.replace(urls, (_url, _quote, path: string) => {
		const bytes = extractFile(archive, path.slice(1));
		return `url("data:font/woff2;base64,${bytes.toString("base64")}")`;
	});
}
