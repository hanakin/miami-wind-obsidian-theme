// Reads the theme's source tree and the capture list from disk and builds the sidebar from them.
import { readdirSync, readFileSync } from "node:fs";
import { styledBy } from "./match.ts";
import { type Organization, organize } from "./organization.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

/** Every .css file in a folder under src/, as "folder/file.css". */
export function sourceFiles(): { path: string; css: string }[] {
	return readdirSync(`${ROOT}src`, { recursive: true, encoding: "utf8" })
		.filter((p) => p.endsWith(".css") && p.includes("/"))
		.sort()
		.map((path) => ({ path, css: readFileSync(`${ROOT}src/${path}`, "utf8") }));
}

/** The workbench's sidebar, built from src/ and the captures as they are now. */
export async function organization(): Promise<Organization> {
	const files = sourceFiles();
	const items = Object.keys(
		(JSON.parse(readFileSync(`${ROOT}capture/fixtures.json`, "utf8")) as { components: object })
			.components,
	);
	const styled = await styledBy(files);
	return organize(
		styled,
		items,
		files.map((f) => f.path),
	);
}
