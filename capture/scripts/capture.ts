// Step 2: captures every checklist item from the real app into capture/fixtures/.
// Usage: bun run capture:run [--windowed] [--only <id prefix>]... [--until <scene id>]
// Headless by default; --windowed runs only the scenes that need a real window on the desktop.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Page } from "playwright";
import { matchable } from "./css.ts";
import type { AppInventory, CommandResult } from "./discover.ts";
import { closeExtraPages, pagesOf, restoreLayout, snapshotLayout } from "./discover.ts";
import { type CaptureOut, ensureDirs, install, makeCtx, runScene } from "./engine.ts";
import { close, launch, SCREENSHOTS, type Session, verifyIsolation } from "./obsidian.ts";
import { allScenes, CAPTURE, themeSelectors } from "./plan.ts";
import type { FixtureEntry, Scene } from "./types.ts";
import { platformVariants } from "./variants.ts";

interface FixturesFile {
	obsidianVersion: string;
	generated: string;
	fixtures: FixtureEntry[];
	failed: { id: string; error: string }[];
	/** Component → every fixture that shows it, and on which surfaces. */
	components: Record<string, { surfaces: string[]; multiSurface: boolean; fixtures: string[] }>;
}

const checklist = JSON.parse(readFileSync(`${CAPTURE}checklist.json`, "utf8")) as {
	inventory: AppInventory;
	commands: CommandResult[];
	obsidianVersion: string;
};
const only = process.argv.flatMap((a, i) => (process.argv[i - 1] === "--only" ? [a] : []));
const windowed = process.argv.includes("--windowed");
// --until <scene id>: stop after that scene (to reproduce order-dependent failures quickly).
const until = process.argv[process.argv.indexOf("--until") + 1];
const wanted = (id: string) => only.length === 0 || only.some((p) => id.startsWith(p));

const FIXTURES = `${CAPTURE}fixtures/`;
const out: CaptureOut = {
	fixturesDir: FIXTURES,
	screenshotsDir: SCREENSHOTS,
	version: checklist.obsidianVersion,
	// Same selector form as the fixtures; evaluated on an off-page copy of the whole live document.
	live: themeSelectors().map((t) => ({ id: t.id, sel: matchable(t.selector) })),
};
ensureDirs(out);

const fixturesPath = `${CAPTURE}fixtures.json`;
// Earlier results are kept for items this run does not attempt (other --only prefixes, and the
// windowed scenes during a headless run or the reverse).
const previous: FixturesFile | undefined = existsSync(fixturesPath)
	? (JSON.parse(readFileSync(fixturesPath, "utf8")) as FixturesFile)
	: undefined;
const censusPath = `${CAPTURE}class-census.json`;
const fullRun = !only.length && !windowed && !process.argv.includes("--until");
const census = new Set<string>(
	!fullRun && existsSync(censusPath)
		? (JSON.parse(readFileSync(censusPath, "utf8")) as string[])
		: [],
);

let scenes: Scene[] = [];
const session = await launch({ windowed });
const entries = new Map<string, FixtureEntry>((previous?.fixtures ?? []).map((f) => [f.id, f]));
const failed = new Map<string, string>((previous?.failed ?? []).map((f) => [f.id, f.error]));
try {
	console.log(verifyIsolation(session.pid, session.windowed).join("\n"));
	const main = session.page;
	await install(main);
	await saveRuntimeStyles(main);
	const layout = await snapshotLayout(main);
	scenes = allScenes(checklist.inventory, checklist.commands, () => layout);
	let done = 0;
	for (const scene of scenes) {
		if (Boolean(scene.windowed) !== windowed) continue;
		const items = scene.items.filter((i) => wanted(i.id));
		if (!items.length) continue;
		await restoreLayout(main, layout).catch(() => undefined);
		const results = await runScene(
			session,
			(s) => pageFor(session, s),
			scene,
			out,
			new Set(items.map((i) => i.id)),
			census,
		);
		for (const i of items) {
			entries.delete(i.id);
			failed.delete(i.id);
		}
		for (const r of results) {
			if (r.entry) entries.set(r.entry.id, r.entry);
			if (r.error) failed.set(r.id, r.error);
		}
		await closeExtraPages(session, main);
		done += items.length;
		process.stdout.write(`\r${done} items, ${failed.size} failed   `);
		if (process.argv.includes("--until") && scene.id === until) break;
	}
	process.stdout.write("\n");
} finally {
	await close(session);
}

// Keep only fixtures for items that still exist (an item can be dropped from the catalog).
const known = new Set(scenes.flatMap((sc) => sc.items.map((i) => i.id)));
const linux = [...entries.values()].filter((f) => !f.variantOf && known.has(f.id));
const fixtures = [...linux, ...(await platformVariants(linux))].sort((a, b) =>
	a.id.localeCompare(b.id),
);
const components: FixturesFile["components"] = {};
for (const f of fixtures) {
	for (const c of new Set([f.component, ...f.contains])) {
		const e = components[c] ?? { surfaces: [], multiSurface: false, fixtures: [] };
		if (!e.surfaces.includes(f.surface)) e.surfaces.push(f.surface);
		e.fixtures.push(f.id);
		components[c] = e;
	}
}
for (const e of Object.values(components)) {
	e.surfaces.sort();
	e.multiSurface = e.surfaces.length > 1;
}
const file: FixturesFile = {
	obsidianVersion: checklist.obsidianVersion,
	generated: new Date().toISOString(),
	fixtures,
	failed: [...failed.entries()]
		.filter(([id]) => known.has(id))
		.map(([id, error]) => ({ id, error }))
		.sort((a, b) => a.id.localeCompare(b.id)),
	components: Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(fixturesPath, `${JSON.stringify(file, null, "\t")}\n`);
writeFileSync(censusPath, `${JSON.stringify([...census].sort(), null, "\t")}\n`);
// Drop fixture files no entry points to (renamed or removed items).
const keep = new Set(fixtures.map((f) => f.file));
for (const name of readdirSync(FIXTURES)) if (!keep.has(name)) rmSync(`${FIXTURES}${name}`);
console.log(`${fixtures.length} fixtures, ${file.failed.length} failed`);
for (const f of file.failed) console.log(`  ✗ ${f.id}: ${f.error}`);

/** The page a scene runs in; popout and starter windows are opened from the main window. */
async function pageFor(s: Session, scene: Scene): Promise<Page> {
	if (!scene.opener) return s.page;
	const before = pagesOf(s).length;
	await install(s.page);
	await scene.opener(makeCtx(s.page));
	// An opener can open more than one window (settings, then a browser from it): take the newest.
	await Bun.sleep(1000);
	for (let i = 0; i < 40; i++) {
		const pages = pagesOf(s);
		if (pages.length > before) {
			const p = pages[pages.length - 1] as Page;
			await p.waitForLoadState("domcontentloaded");
			await Bun.sleep(1500);
			return p;
		}
		await Bun.sleep(250);
	}
	throw new Error(`${scene.id}: no new window opened`);
}

/** Obsidian's runtime <style> and adopted stylesheets, for rendering fixtures locally (gitignored). */
async function saveRuntimeStyles(page: Page): Promise<void> {
	const css = (await page.evaluate(`(() => {
		const parts = [];
		for (const s of document.head.querySelectorAll("style")) {
			if (s === app.customCss.styleEl) continue;
			parts.push("/* <style" + (s.id ? " id=" + s.id : "") + "> */\\n" + s.textContent);
		}
		for (const sheet of document.adoptedStyleSheets) parts.push("/* adopted */\\n" + [...sheet.cssRules].map((r) => r.cssText).join("\\n"));
		return parts.join("\\n\\n");
	})()`)) as string;
	mkdirSync(`${CAPTURE}.app`, { recursive: true });
	writeFileSync(`${CAPTURE}.app/runtime-styles.css`, css);
}
