import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import type { FixtureEntry } from "../../capture/scripts/types";
import { BROWSER_OPTIONS } from "./browser";
import { Inputs } from "./inputs";
import {
	comparisonExitCode,
	componentDiffs,
	filterFixtures,
	mergedCoverage,
	outcome,
	type Sample,
	styleDiff,
} from "./model";
import { repeatedPixels } from "./pixels";
import { render } from "./render";
import { loadReplayLimits } from "./replay";
import { runtimeCss } from "./runtime";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		before: { type: "string" },
		after: { type: "string" },
		id: { type: "string", multiple: true },
		component: { type: "string" },
		surface: { type: "string" },
		help: { type: "boolean" },
	},
});
if (values.help) {
	console.log(
		"bun run compare [--before path] [--after path] [--id substring|id,id...] [--component name] [--surface name]\nRepeat --id for an exact ID list. Pass an empty CSS file for Default Obsidian. Defaults: b478dc8:theme.css vs freshly built theme.css. Outputs: workbench/out/{compare.json,compare.md,component-diffs.json,diffs/}.",
	);
	process.exit(0);
}
const started = performance.now();
const generated = new Date().toISOString();
const out = "workbench/out";
for (const file of ["compare.json", "compare.md", "component-diffs.json"])
	rmSync(`${out}/${file}`, { force: true });
rmSync(`${out}/diffs`, { recursive: true, force: true });
mkdirSync(`${out}/diffs`, { recursive: true });
for (const side of ["before", "after"] as const)
	if (values[side] !== undefined && !values[side]?.trim())
		throw new Error(
			`Expected non-empty --${side} path; pass an empty CSS file for Default Obsidian.`,
		);
const inputs = new Inputs();
for (const file of ["replay.ts", "css.ts", "inpage.ts"])
	inputs.read(
		fileURLToPath(new URL(`../../capture/scripts/${file}`, import.meta.url)),
	);
loadReplayLimits(inputs);
const registry = JSON.parse(
	inputs.read("capture/fixtures.json").toString("utf8"),
) as {
	obsidianVersion: string;
	fixtures: FixtureEntry[];
};
const ids = values.id
	?.flatMap((value) => value.split(","))
	.map((id) => id.trim())
	.filter(Boolean);
const substring =
	values.id?.length === 1 &&
	!values.id[0]?.includes(",") &&
	ids?.length === 1 &&
	!registry.fixtures.some((fixture) => fixture.id === ids[0]);
const filters = { ...values, id: substring ? ids?.[0] : ids };
if (Array.isArray(filters.id)) {
	const missing = filters.id.filter(
		(id) => !registry.fixtures.some((fixture) => fixture.id === id),
	);
	if (missing.length)
		throw new Error(`Unknown fixture IDs: ${missing.join(", ")}`);
}
const fixtures = filterFixtures(registry.fixtures, filters);
if (!fixtures.length)
	throw new Error("No fixtures match the requested filters");
if (!values.after) execFileSync("bun", ["run", "build"], { stdio: "inherit" });
const before = values.before
	? inputs.read(values.before).toString("utf8")
	: execFileSync("git", ["show", "b478dc8:theme.css"], { encoding: "utf8" });
const after = inputs.read(values.after ?? "theme.css").toString("utf8");
mkdirSync(`${out}/themes`, { recursive: true });
const snapshotTheme = async (
	side: "before" | "after",
	css: string,
	source: string,
) => {
	const file = `themes/${side}.css`;
	await Bun.write(`${out}/${file}`, css);
	return {
		sha256: createHash("sha256").update(css, "utf8").digest("hex"),
		source,
		file,
	};
};
const [beforeTheme, afterTheme] = await Promise.all([
	snapshotTheme("before", before, values.before ?? "b478dc8:theme.css"),
	snapshotTheme("after", after, values.after ?? "theme.css"),
]);
const themes = { before: beforeTheme, after: afterTheme };
if (!(await Bun.file("capture/.app/app.css").exists()))
	throw new Error("Missing app CSS: run bun run capture:extract-app-css first");
const appVersion = (
	JSON.parse(inputs.read("capture/.app/package.json").toString("utf8")) as {
		version: string;
	}
).version;
if (appVersion !== registry.obsidianVersion)
	throw new Error(
		`App CSS ${appVersion} does not match fixtures ${registry.obsidianVersion}`,
	);
const app = inputs.read("capture/.app/app.css").toString("utf8");
const cm = await runtimeCss(inputs);
const sharedInputs = { ...inputs.hashes };
const browser = await chromium.launch(BROWSER_OPTIONS);
type Result = {
	id: string;
	inputs: Record<string, string>;
	component: string;
	surface: string;
	state: string;
	same: boolean;
	status: string;
	notProvenReasons: string[];
	noise: {
		styles: number;
		pixels: number;
		beforePixels: number;
		afterPixels: number;
	};
	repeats: { before: number; after: number };
	pixelDiff: number;
	rawPixelDiff: number;
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
			const page = await browser.newPage({
				viewport: { width: 1600, height: 1000 },
				deviceScaleFactor: 1,
				colorScheme: "dark",
				reducedMotion: "reduce",
			});
			const cdp = await page.context().newCDPSession(page);
			await cdp.send("DOM.enable");
			await cdp.send("CSS.enable");
			while (next < fixtures.length) {
				const f = fixtures[next++];
				if (!f) break;
				const fixtureInputs = inputs.fork(sharedInputs);
				const html = fixtureInputs
					.read(`capture/fixtures/${f.file}`)
					.toString("utf8");
				const a = await render(
					page,
					cdp,
					html,
					{ cm, app, theme: before, inputs: fixtureInputs },
					f,
				);
				const sanity = await render(
					page,
					cdp,
					html,
					{
						cm,
						app,
						inputs: fixtureInputs,
						theme: `${before}\n/* compare sanity: identical declarations */`,
					},
					f,
				);
				const sanityStyles = styleDiff(a.styles, sanity.styles);
				const b = await render(
					page,
					cdp,
					html,
					{ cm, app, theme: after, inputs: fixtureInputs },
					f,
				);
				const afterRepeat = await render(
					page,
					cdp,
					html,
					{
						cm,
						app,
						inputs: fixtureInputs,
						theme: `${after}\n/* compare after repeat: identical declarations */`,
					},
					f,
				);
				const afterStyles = styleDiff(b.styles, afterRepeat.styles);
				const pixel = repeatedPixels(
					[a.png, sanity.png],
					[b.png, afterRepeat.png],
				);
				const sanityPixels = pixel.noise.before;
				const styleNoise = sanityStyles.length + afterStyles.length;
				if (styleNoise || pixel.noise.pixels) {
					await Bun.write(`${out}/diffs/${f.id}.sanity-before.png`, a.png);
					await Bun.write(`${out}/diffs/${f.id}.sanity-repeat.png`, sanity.png);
					await Bun.write(
						`${out}/diffs/${f.id}.after-before-repeat.png`,
						b.png,
					);
					await Bun.write(
						`${out}/diffs/${f.id}.after-repeat.png`,
						afterRepeat.png,
					);
					if (pixel.png)
						await Bun.write(`${out}/diffs/${f.id}.repeat-diff.png`, pixel.png);
					await Bun.write(
						`${out}/diffs/${f.id}.sanity-styles.json`,
						JSON.stringify(
							{ before: sanityStyles, after: afterStyles },
							null,
							2,
						),
					);
					console.error(
						`REPEAT NOISE ${f.id}: ${styleNoise} style differences; before ${sanityPixels} pixels, after ${pixel.noise.after} pixels`,
					);
				}
				const differences = styleDiff(a.styles, b.styles);
				const coverage = mergedCoverage(a, sanity, b, afterRepeat);
				const verdict = outcome({
					differences: differences.length,
					pixels: pixel.count,
					noise: !!(styleNoise || pixel.noise.pixels),
					...coverage,
				});
				const result: Result = {
					id: f.id,
					inputs: fixtureInputs.hashes,
					component: f.component,
					surface: f.surface,
					state: f.state,
					...verdict,
					noise: {
						styles: styleNoise,
						pixels: pixel.noise.pixels,
						beforePixels: pixel.noise.before,
						afterPixels: pixel.noise.after,
					},
					repeats: { before: 2, after: 2 },
					pixelDiff: pixel.count,
					rawPixelDiff: pixel.rawCount,
					differences,
					invisibleTarget: coverage.invisible,
					unsupported: coverage.unsupported,
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
						pixel.png ??
							PNG.sync.write(
								new PNG({
									width: PNG.sync.read(a.png).width,
									height: PNG.sync.read(a.png).height,
								}),
							),
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
			{
				generated,
				themes,
				status: "error",
				error: String(error),
				checked: results.length,
			},
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
const exitCode = comparisonExitCode(results);
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
	"Capture replay restores recorded canvas pixels and frame documents. Missing image/media interiors, unrecorded canvas/frame content and capture-declared limits remain not proven.",
	"MathJax fonts load from the matching local Obsidian archive; other fonts use host fallbacks. External requests remain blocked. Missing MathJax fonts or glyph metrics are not proven.",
	"Computed standard properties and applicable selection, placeholder, scrollbar, marker, generated-content and file-button pseudos are compared. Runtime graph/canvas/PDF colors are probed. Animation declarations are read without suppression; suppression is enabled only for screenshots.",
	"Repeated pixel checks use exact RGBA equality: red marks stable changes, orange marks same-CSS instability. Each fixture records two captures per side.",
	"Screenshots use each fixture’s recorded window size, color scheme, ordered stylesheets, scrolling and selection. Invisible targets remain in style comparisons.",
	"Component diffs describe after-theme surface consistency, not before/after parity; filtered runs only cover selected uses.",
];
const status =
	exitCode === 1 ? "different" : exitCode === 2 ? "not-proven" : "same";
await Bun.write(
	`${out}/compare.json`,
	JSON.stringify(
		{
			schemaVersion: 1,
			generated,
			inputs: inputs.hashes,
			themes,
			rasterization: {
				flags: BROWSER_OPTIONS.args,
				capture: "Page.captureScreenshot",
			},
			status,
			notProven,
			noise,
			engine: `Playwright Chromium ${browser.version()}`,
			obsidianVersion: registry.obsidianVersion,
			filters,
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
const text = `Status: ${status}.\n${summary.checked} fixtures checked; ${changed} with differences; ${summary.unchanged} same; ${summary.notProvenOnly} not proven; ${seconds}s.\nCoverage limits: ${summary.notProven} fixtures (can overlap differences).\nEngine: Playwright Chromium ${browser.version()}. Independent before/after repeats (2 each): ${summary.sanity}.\nInvisible targets: ${summary.invisibleTargets}.\n\nNot proven:\n${notProven.map((r) => `- ${r.id}: ${r.reasons.join("; ")}`).join("\n")}\n\nTop element/property differences:\n${topDifferences.map((d) => `- ${d.count}: ${d.elementProperty}`).join("\n")}\n\nLimits:\n${limitations.map((l) => `- ${l}`).join("\n")}\n`;
await Bun.write(`${out}/compare.md`, text);
console.log(text);
process.exitCode = exitCode;
