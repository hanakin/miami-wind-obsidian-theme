// macOS and Windows variants: Obsidian adds mod-macos / mod-windows to <body> instead of
// mod-linux, and app.css reacts to those classes. The capture runs on Linux, so each variant is
// the Linux fixture with the platform class swapped (synthetic, no screenshot). Only fixtures
// that newly match a platform selector are written, greedily, until every matchable platform
// selector has one.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { matchable } from "./css.ts";
import { CAPTURE, type PlatformItem, platformItems } from "./plan.ts";
import type { FixtureEntry } from "./types.ts";

export const PLATFORMS = ["macos", "windows"] as const;

function swap(html: string, os: string): string {
	// Only the <html>/<body> class lists carry the platform class.
	return html.replace(/(<(?:html|body)\b[^>]*\bclass="[^"]*)\bmod-linux\b/g, `$1mod-${os}`);
}

export async function platformVariants(fixtures: FixtureEntry[]): Promise<FixtureEntry[]> {
	const items = platformItems();
	const base = fixtures.filter((f) => !f.variantOf);
	const browser = await chromium.launch();
	const page = await browser.newPage();
	await page.route("**", (r) => r.abort());
	const out: FixtureEntry[] = [];
	for (const os of PLATFORMS) {
		const wanted = items.filter((i) => i.platform === os);
		const rewritten = wanted.map((i) => matchable(i.selector));
		const hitsByFixture = new Map<string, PlatformItem[]>();
		for (const f of base) {
			const html = swap(readFileSync(`${CAPTURE}fixtures/${f.file}`, "utf8"), os);
			const hits = (await page.evaluate(
				([html, sels]) => {
					const doc = new DOMParser().parseFromString(html, "text/html");
					return sels.flatMap((s, i) => {
						try {
							return doc.querySelector(s) ? [i] : [];
						} catch {
							return [];
						}
					});
				},
				[html, rewritten] as [string, string[]],
			)) as number[];
			if (hits.length)
				hitsByFixture.set(
					f.id,
					hits.map((i) => wanted[i] as PlatformItem),
				);
		}
		// Greedy set cover: fewest fixtures that hit every reachable platform selector.
		const left = new Set(wanted.map((i) => i.id));
		while (left.size) {
			let best: [string, PlatformItem[]] | undefined;
			for (const [id, hits] of hitsByFixture) {
				const fresh = hits.filter((h) => left.has(h.id));
				if (fresh.length && (!best || fresh.length > best[1].length)) best = [id, fresh];
			}
			if (!best) break;
			const [id] = best;
			const f = base.find((x) => x.id === id) as FixtureEntry;
			const all = (hitsByFixture.get(id) ?? []).map((h) => h.id);
			for (const h of all) left.delete(h);
			const vid = `${f.id}.${os}`;
			writeFileSync(
				`${CAPTURE}fixtures/${vid}.html`,
				swap(readFileSync(`${CAPTURE}fixtures/${f.file}`, "utf8"), os),
			);
			out.push({
				...f,
				id: vid,
				file: `${vid}.html`,
				screenshot: "",
				surface: f.surface,
				state: `${f.state}+${os}`,
				covers: all,
				variantOf: f.id,
				platform: os,
				note: `Synthetic: the Linux capture with body class mod-${os} instead of mod-linux. Covers the ${os} rules in app.css; OS-drawn parts (traffic lights, native menus, window frame) are not reproduced. No screenshot.`,
			});
		}
	}
	await browser.close();
	return out;
}

if (import.meta.main) {
	// Standalone: bun run capture:variants (rewrites the variant entries in fixtures.json).
	const path = `${CAPTURE}fixtures.json`;
	const file = JSON.parse(readFileSync(path, "utf8")) as { fixtures: FixtureEntry[] };
	const variants = await platformVariants(file.fixtures);
	file.fixtures = [...file.fixtures.filter((f) => !f.variantOf), ...variants].sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	writeFileSync(path, `${JSON.stringify(file, null, "\t")}\n`);
	console.log(`${variants.length} platform variant fixtures`);
}
