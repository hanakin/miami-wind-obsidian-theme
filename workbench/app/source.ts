// Reads the theme's source tree and the capture list from disk and builds the sidebar from them.
import { readdirSync, readFileSync } from "node:fs";
import { styledBy } from "./match.ts";
import { type Organization, organize } from "./organization.ts";
import type { Usage } from "./types.ts";

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

/**
 * The items each shared build component (a mixin in src/components/) is used on: for every rule
 * that includes it, the items that rule's last part selects in the captures.
 */
export async function componentItems(usage: Usage[]): Promise<Record<string, string[]>> {
	const styled = await styledBy(sourceFiles());
	const plain = (selector: string) => selector.replace(/\s+/g, " ").trim();
	const out: Record<string, string[]> = {};
	for (const { component, usages } of usage) {
		const items = new Set<string>();
		for (const use of usages) {
			const selectors = use.selector.split(",").map(plain);
			for (const hit of styled) {
				if (hit.how === "through" || !hit.file.endsWith(`/${use.surface}`)) continue;
				if (selectors.includes(plain(hit.selector))) items.add(hit.item);
			}
		}
		out[component] = [...items].sort();
	}
	return out;
}
