import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import type { FixtureEntry } from "../../capture/scripts/types";
import { compile } from "../../scripts/pipeline";
import {
	acceptanceScope,
	acceptedOutcome,
	comparisonExitCode,
} from "./accepted";
import { BROWSER_OPTIONS } from "./browser";
import {
	componentDiffs,
	filterFixtures,
	outcome,
	type Sample,
	styleDiff,
} from "./model";
import { repeatedPixels } from "./pixels";
import { render } from "./render";
import { runtimeCss } from "./runtime";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		before: { type: "string" },
		out: { type: "string" },
		formatting: { type: "boolean" },
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
if (values.formatting && (values.before || values.after))
	throw new Error("--formatting cannot be combined with --before or --after");
const started = performance.now();
const generated = new Date().toISOString();
const out = values.out ?? "workbench/out";
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
if (values.formatting)
	await Bun.write(
		`${out}/before-format.css`,
		(await compile({ format: false })).css,
	);
if (!values.after) execFileSync("bun", ["run", "build"], { stdio: "inherit" });
const before = values.formatting
	? await Bun.file(`${out}/before-format.css`).text()
	: values.before
		? await Bun.file(values.before).text()
		: execFileSync("git", ["show", "b478dc8:theme.css"], { encoding: "utf8" });
const after = await Bun.file(values.after ?? "theme.css").text();
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
	(await Bun.file("capture/.app/package.json").json()) as { version: string }
).version;
if (appVersion !== registry.obsidianVersion)
	throw new Error(
		`App CSS ${appVersion} does not match fixtures ${registry.obsidianVersion}`,
	);
const app = await Bun.file("capture/.app/app.css").text();
const cm = await runtimeCss();
const browser = await chromium.launch(BROWSER_OPTIONS);
const context = await browser.newContext({
	viewport: { width: 1600, height: 1000 },
	deviceScaleFactor: 1,
	colorScheme: "dark",
	reducedMotion: "reduce",
});
await context.route("**/*", (route) => route.abort());
type Result = {
	id: string;
	component: string;
	surface: string;
	state: string;
	same: boolean;
	status: string;
	comparisonStatus: string;
	acceptanceReason?: string;
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
	pixelsOutsideAcceptance: number;
	acceptanceScope: ReturnType<typeof acceptanceScope>;
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
				const b = await render(page, cdp, html, { cm, app, theme: after }, f);
				const afterRepeat = await render(
					page,
					cdp,
					html,
					{
						cm,
						app,
						theme: `${after}\n/* compare after repeat: identical declarations */`,
					},
					f,
				);
				const afterStyles = styleDiff(b.styles, afterRepeat.styles);
				const scope = acceptanceScope([
					a.acceptanceMatches,
					sanity.acceptanceMatches,
					b.acceptanceMatches,
					afterRepeat.acceptanceMatches,
				]);
				const pixel = repeatedPixels(
					[a.png, sanity.png],
					[b.png, afterRepeat.png],
					scope.rects,
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
				const verdict = acceptedOutcome(
					outcome({
						differences: differences.length,
						pixels: pixel.count,
						noise: !!(styleNoise || pixel.noise.pixels),
						invisible: b.invisibleTarget,
						unsupported: b.unsupported,
						replayIssues: b.replayIssues,
					}),
					{
						scope,
						differences,
						outsidePixels: pixel.outsideAcceptance,
						noise: !!(styleNoise || pixel.noise.pixels),
					},
				);
				const result: Result = {
					id: f.id,
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
					pixelsOutsideAcceptance: pixel.outsideAcceptance,
					acceptanceScope: scope,
					differences,
					invisibleTarget: b.invisibleTarget,
					unsupported: b.unsupported,
				};
				if (verdict.comparisonStatus === "different") {
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
const accepted = results
	.filter((r) => r.status === "accepted")
	.map((r) => ({ id: r.id, reason: r.acceptanceReason }));
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
	accepted: accepted.length,
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
	"MathJax fonts load from the matching local Obsidian archive; other fonts use host fallbacks. External requests remain blocked. Missing MathJax fonts or glyph metrics are not proven.",
	"Computed standard properties and applicable selection, placeholder, scrollbar, marker, generated-content and file-button pseudos are compared. Runtime graph/canvas/PDF colors are probed. Animation declarations are read without suppression; suppression is enabled only for screenshots.",
	"Repeated pixel checks use exact RGBA equality: red marks stable changes, orange marks same-CSS instability. Each fixture records two captures per side.",
	"Invisible targets remain in style comparisons; screenshots show the 1600×1000 viewport and may not paint them.",
	"Component diffs describe after-theme surface consistency, not before/after parity; filtered runs only cover selected uses.",
];
const status =
	exitCode === 1
		? "different"
		: exitCode === 2
			? "not-proven"
			: accepted.length
				? "accepted"
				: "same";
await Bun.write(
	`${out}/compare.json`,
	JSON.stringify(
		{
			schemaVersion: 1,
			generated,
			themes,
			rasterization: {
				flags: BROWSER_OPTIONS.args,
				capture: "Page.captureScreenshot",
			},
			status,
			accepted,
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
const text = `Status: ${status}.\n${summary.checked} fixtures checked; ${changed} with differences; ${summary.unchanged} same; ${summary.notProvenOnly} not proven; ${summary.accepted} accepted (intentional); ${seconds}s.\nCoverage limits: ${summary.notProven} fixtures (can overlap differences or accepted results).\nEngine: Playwright Chromium ${browser.version()}. Independent before/after repeats (2 each): ${summary.sanity}.\nInvisible targets: ${summary.invisibleTargets}.\n\nAccepted (intentional):\n${accepted.map((r) => `- ${r.id}: accepted: ${r.reason}`).join("\n")}\n\nNot proven:\n${notProven.map((r) => `- ${r.id}: ${r.reasons.join("; ")}`).join("\n")}\n\nTop element/property differences:\n${topDifferences.map((d) => `- ${d.count}: ${d.elementProperty}`).join("\n")}\n\nLimits:\n${limitations.map((l) => `- ${l}`).join("\n")}\n`;
await Bun.write(`${out}/compare.md`, text);
console.log(text);
process.exitCode = exitCode;
