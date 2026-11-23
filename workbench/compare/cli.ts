import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import type { FixtureEntry } from "../../capture/scripts/types";
import {
	componentDiffs,
	filterFixtures,
	outcome,
	type Sample,
	styleDiff,
} from "./model";
import { render } from "./render";
import { runtimeCss } from "./runtime";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		before: { type: "string" },
		after: { type: "string" },
		id: { type: "string" },
		component: { type: "string" },
		surface: { type: "string" },
		help: { type: "boolean" },
	},
});
if (values.help) {
	console.log(
		"bun run compare [--before path] [--after path] [--id substring] [--component name] [--surface name]\nDefaults: b478dc8:theme.css vs freshly built theme.css. Outputs: workbench/out/{compare.json,compare.md,component-diffs.json,diffs/}.",
	);
	process.exit(0);
}
const started = performance.now();
const out = "workbench/out";
for (const file of ["compare.json", "compare.md", "component-diffs.json"])
	rmSync(`${out}/${file}`, { force: true });
rmSync(`${out}/diffs`, { recursive: true, force: true });
mkdirSync(`${out}/diffs`, { recursive: true });
const registry = (await Bun.file("capture/fixtures.json").json()) as {
	obsidianVersion: string;
	fixtures: FixtureEntry[];
};
const fixtures = filterFixtures(registry.fixtures, values);
if (!fixtures.length)
	throw new Error("No fixtures match the requested filters");
if (!values.after) execFileSync("bun", ["run", "build"], { stdio: "inherit" });
const before = values.before
	? await Bun.file(values.before).text()
	: execFileSync("git", ["show", "b478dc8:theme.css"], { encoding: "utf8" });
const after = await Bun.file(values.after ?? "theme.css").text();
if (!(await Bun.file("capture/.app/app.css").exists()))
	throw new Error("Missing app CSS: run bun run capture:extract-app-css first");
const appVersion = (
	(await Bun.file("capture/.app/package.json").json()) as { version: string }
).version;
if (appVersion !== registry.obsidianVersion)
	throw new Error(
		`App CSS ${appVersion} does not match fixtures ${registry.obsidianVersion}`,
	);
const app = await Bun.file("capture/.app/app.css").text();
const cm = await runtimeCss();
const browser = await chromium.launch({
	headless: true,
	args: ["--disable-gpu", "--num-raster-threads=1"],
	ignoreDefaultArgs: ["--hide-scrollbars"],
});
const context = await browser.newContext({
	viewport: { width: 1600, height: 1000 },
	deviceScaleFactor: 1,
	colorScheme: "dark",
	reducedMotion: "reduce",
});
await context.route("**/*", (route) => route.abort());
function pixels(a: Buffer, b: Buffer) {
	const x = PNG.sync.read(a),
		y = PNG.sync.read(b);
	if (x.width !== y.width || x.height !== y.height)
		throw new Error("Screenshot size changed");
	const diff = new PNG({ width: x.width, height: x.height });
	const count = pixelmatch(x.data, y.data, diff.data, x.width, x.height, {
		threshold: 0,
		includeAA: true,
	});
	return { count, png: count ? PNG.sync.write(diff) : null };
}
type Result = {
	id: string;
	component: string;
	surface: string;
	state: string;
	same: boolean;
	status: string;
	notProvenReasons: string[];
	noise: { styles: number; pixels: number };
	pixelDiff: number;
	differences: ReturnType<typeof styleDiff>;
	images?: { before: string; after: string; diff: string };
	invisibleTarget: boolean;
	unsupported: string[];
};
const results: Result[] = [];
const samples = new Map<string, Sample[]>();
let next = 0;
try {
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			const page = await context.newPage();
			const cdp = await context.newCDPSession(page);
			await cdp.send("DOM.enable");
			await cdp.send("CSS.enable");
			while (next < fixtures.length) {
				const f = fixtures[next++];
				if (!f) break;
				const html = await Bun.file(`capture/fixtures/${f.file}`).text();
				const a = await render(page, cdp, html, { cm, app, theme: before }, f);
				const sanity = await render(
					page,
					cdp,
					html,
					{
						cm,
						app,
						theme: `${before}\n/* compare sanity: identical declarations */`,
					},
					f,
				);
				const sanityStyles = styleDiff(a.styles, sanity.styles);
				const sanityPixels = pixels(a.png, sanity.png).count;
				if (sanityStyles.length || sanityPixels) {
					await Bun.write(`${out}/diffs/${f.id}.sanity-before.png`, a.png);
					await Bun.write(`${out}/diffs/${f.id}.sanity-repeat.png`, sanity.png);
					await Bun.write(
						`${out}/diffs/${f.id}.sanity-styles.json`,
						JSON.stringify(sanityStyles, null, 2),
					);
					console.error(
						`SANITY NOISE ${f.id}: before-vs-before has ${sanityStyles.length} style and ${sanityPixels} pixel differences`,
					);
				}
				const b = await render(page, cdp, html, { cm, app, theme: after }, f);
				const differences = styleDiff(a.styles, b.styles),
					pixel = pixels(a.png, b.png);
				const verdict = outcome({
					differences: differences.length,
					pixels: pixel.count,
					noise: !!(sanityStyles.length || sanityPixels),
					invisible: b.invisibleTarget,
					unsupported: b.unsupported,
					replayIssues: b.replayIssues,
				});
				const result: Result = {
					id: f.id,
					component: f.component,
					surface: f.surface,
					state: f.state,
					...verdict,
					noise: { styles: sanityStyles.length, pixels: sanityPixels },
					pixelDiff: pixel.count,
					differences,
					invisibleTarget: b.invisibleTarget,
					unsupported: b.unsupported,
				};
				if (verdict.status === "different") {
					const prefix = `diffs/${f.id}`;
					result.images = {
						before: `${prefix}.before.png`,
						after: `${prefix}.after.png`,
						diff: `${prefix}.diff.png`,
					};
					await Bun.write(`${out}/${result.images.before}`, a.png);
					await Bun.write(`${out}/${result.images.after}`, b.png);
					await Bun.write(
						`${out}/${result.images.diff}`,
						pixel.png ?? PNG.sync.write(new PNG({ width: 1600, height: 1000 })),
					);
				}
				results.push(result);
				samples.set(f.id, b.samples);
				if (results.length % 50 === 0)
					console.log(`${results.length}/${fixtures.length} checked`);
			}
		}),
	);
} catch (error) {
	await Bun.write(
		`${out}/compare.json`,
		JSON.stringify(
			{ status: "error", error: String(error), checked: results.length },
			null,
			2,
		),
	);
	await Bun.write(`${out}/compare.md`, `${String(error)}\n`);
	rmSync(`${out}/component-diffs.json`, { force: true });
	throw error;
} finally {
	await browser.close();
}
results.sort((a, b) => a.id.localeCompare(b.id));
const changed = results.filter((r) => r.status === "different").length;
const notProven = results
	.filter((r) => r.status === "not-proven" || r.notProvenReasons.length)
	.map((r) => ({ id: r.id, reasons: r.notProvenReasons }));
const noise = results
	.filter((r) => r.noise.styles || r.noise.pixels)
	.map((r) => ({ id: r.id, ...r.noise }));
const seconds = Number(((performance.now() - started) / 1000).toFixed(2));
const counts = new Map<string, number>();
for (const r of results.filter((r) => r.status === "different"))
	for (const d of r.differences) {
		const key = `${d.element} / ${d.property}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
const topDifferences = [...counts]
	.sort((a, b) => b[1] - a[1])
	.slice(0, 20)
	.map(([elementProperty, count]) => ({ elementProperty, count }));
const summary = {
	checked: results.length,
	changed,
	unchanged: results.filter((r) => r.status === "same").length,
	notProven: notProven.length,
	notProvenOnly: results.filter((r) => r.status === "not-proven").length,
	noise: noise.length,
	seconds,
	sanity: noise.length
		? `failed (${noise.length} noisy fixtures)`
		: "passed (every fixture)",
	invisibleTargets: results.filter((r) => r.invisibleTarget).length,
};
const limitations = [
	"Serialized DOM only: canvas pixels, media playback/native controls, iframe contents and Obsidian runtime behavior are not reconstructed.",
	"Fonts and external images are unavailable; remote requests are blocked. Platform fixtures use host Linux fonts.",
	"Computed standard properties and applicable selection, placeholder, scrollbar, marker, generated-content and file-button pseudos are compared. Runtime graph/canvas/PDF colors are probed. Animation declarations are read without suppression; suppression is enabled only for screenshots.",
	"Invisible targets remain in style comparisons; screenshots show the 1600×1000 viewport and may not paint them.",
	"Component diffs describe after-theme surface consistency, not before/after parity; filtered runs only cover selected uses.",
];
await Bun.write(
	`${out}/compare.json`,
	JSON.stringify(
		{
			schemaVersion: 1,
			status: changed ? "different" : notProven.length ? "not-proven" : "same",
			notProven,
			noise,
			engine: `Playwright Chromium ${browser.version()}`,
			obsidianVersion: registry.obsidianVersion,
			filters: values,
			summary,
			topDifferences,
			limitations,
			fixtures: results,
		},
		null,
		2,
	),
);
await Bun.write(
	`${out}/component-diffs.json`,
	JSON.stringify(
		componentDiffs(fixtures.flatMap((f) => samples.get(f.id) ?? [])),
		null,
		2,
	),
);
const text = `${summary.checked} fixtures checked; ${changed} with differences; ${summary.unchanged} same; ${summary.notProven} not proven (${summary.notProvenOnly} without a proven difference); ${seconds}s.\nEngine: Playwright Chromium ${browser.version()}. Before-vs-before stylesheet swap: ${summary.sanity}.\nInvisible targets: ${summary.invisibleTargets}.\n\nNot proven:\n${notProven.map((r) => `- ${r.id}: ${r.reasons.join("; ")}`).join("\n")}\n\nTop element/property differences:\n${topDifferences.map((d) => `- ${d.count}: ${d.elementProperty}`).join("\n")}\n\nLimits:\n${limitations.map((l) => `- ${l}`).join("\n")}\n`;
await Bun.write(`${out}/compare.md`, text);
console.log(text);
process.exitCode = changed ? 1 : notProven.length ? 2 : 0;
