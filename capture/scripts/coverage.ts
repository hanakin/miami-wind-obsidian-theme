// Proves coverage from the files alone: checklist items, theme.css selectors matched against the
// fixtures in a real Chromium, and Obsidian's app classes found in the fixtures.
// Usage: bun run capture:coverage    (exit code 1 while any gap is neither covered nor excluded)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright";
import { matchable } from "./css.ts";
import {
	appClassStatuses,
	appSelectors,
	CAPTURE,
	loadExclusions,
	themeExclusion,
	themeSelectors,
} from "./plan.ts";
import type { ChecklistItem, FixtureEntry } from "./types.ts";

if (!existsSync(`${CAPTURE}.app/app.css`))
	throw new Error("Run `bun run capture:extract-app-css` first.");

const checklist = JSON.parse(readFileSync(`${CAPTURE}checklist.json`, "utf8")) as {
	items: ChecklistItem[];
	obsidianVersion: string;
};
const fx = JSON.parse(readFileSync(`${CAPTURE}fixtures.json`, "utf8")) as {
	fixtures: FixtureEntry[];
	failed: { id: string; error: string }[];
};
const ex = loadExclusions();
const fixtures = fx.fixtures.filter((f) => existsSync(`${CAPTURE}fixtures/${f.file}`));

// 1. Checklist items.
const coveredItems = new Set(fixtures.flatMap((f) => f.covers));
const missingItems = checklist.items.filter((i) => !coveredItems.has(i.id));

// 2. theme.css selectors, matched in Chromium's own selector engine via DOMParser (no scripts run).
const theme = themeSelectors();
const rewritten = theme.map((s) => matchable(s.selector));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("**", (r) => r.abort());
const matches = new Map<string, string[]>(theme.map((s) => [s.id, []]));
const invalid = new Map<string, string>();
const classesSeen = new Map<string, string>();
for (const f of fixtures) {
	const html = readFileSync(`${CAPTURE}fixtures/${f.file}`, "utf8");
	const r = (await page.evaluate(
		([html, sels]) => {
			const doc = new DOMParser().parseFromString(html, "text/html");
			const hit: number[] = [];
			const bad: [number, string][] = [];
			sels.forEach((s, i) => {
				try {
					if (doc.querySelector(s)) hit.push(i);
				} catch (e) {
					bad.push([i, String(e)]);
				}
			});
			const classes = new Set<string>();
			for (const el of doc.querySelectorAll("[class]"))
				for (const c of el.classList) classes.add(c);
			return { hit, bad, classes: [...classes] };
		},
		[html, rewritten] as [string, string[]],
	)) as { hit: number[]; bad: [number, string][]; classes: string[] };
	for (const i of r.hit) matches.get(theme[i]?.id ?? "")?.push(f.id);
	for (const [i, e] of r.bad) invalid.set(theme[i]?.id ?? "", e);
	for (const c of r.classes) if (!classesSeen.has(c)) classesSeen.set(c, f.id);
}
await browser.close();

const themeRows = theme.map((s) => {
	const hits = matches.get(s.id) ?? [];
	const excluded = themeExclusion(s.selector, ex);
	return {
		...s,
		matchable: matchable(s.selector),
		fixtures: hits,
		excluded,
		invalid: invalid.get(s.id),
	};
});
const themeMatched = themeRows.filter((r) => r.fixtures.length > 0);
const themeExcluded = themeRows.filter((r) => !r.fixtures.length && r.excluded);
const themeMissing = themeRows.filter((r) => !r.fixtures.length && !r.excluded);

// 3. App classes.
const app = appClassStatuses(appSelectors(), ex).map((c) => ({
	...c,
	fixture: classesSeen.get(c.name),
}));
const appCovered = app.filter((c) => c.fixture);
const appExcluded = app.filter((c) => !c.fixture && c.excluded);
const appMissing = app.filter((c) => !c.fixture && !c.excluded);

// 4. Cross-check with the theming expert's vault pages (read only; skipped when absent).
const EXPERT = `${homedir()}/Holocron/Other/Obsidian/LLM/wiki/concepts/obsidian-theming/`;
const crossCheck: string[] = [];
const appStatus = new Map(app.map((c) => [c.name, c]));
if (existsSync(`${EXPERT}rule-map.md`)) {
	const known = new Set(theme.map((s) => `${s.line}|${s.selector.replace(/\s+/g, " ")}`));
	const rows = [
		...readFileSync(`${EXPERT}rule-map.md`, "utf8").matchAll(/^\| (\d+) \| `(.+?)` \|/gm),
	];
	const unknown = rows.filter(
		(r) => !known.has(`${r[1]}|${(r[2] ?? "").replaceAll("\\|", "|").replace(/\s+/g, " ")}`),
	);
	crossCheck.push(
		`rule-map.md: ${rows.length} rows; ${rows.length - unknown.length} name a theme.css selector this checklist tracks${unknown.length ? `; not found: ${unknown.map((r) => `${r[1]} ${r[2]}`).join(", ")}` : ""}`,
	);
}
if (existsSync(`${EXPERT}surfaces.md`)) {
	const named = new Set(
		[...readFileSync(`${EXPERT}surfaces.md`, "utf8").matchAll(/`([^`]+)`/g)].flatMap((m) =>
			[...(m[1] ?? "").matchAll(/\.?(-?[a-zA-Z][\w-]*)/g)].map((x) => x[1] ?? ""),
		),
	);
	const inApp = [...named].filter((n) => appStatus.has(n));
	const open = inApp.filter((n) => !appStatus.get(n)?.fixture && !appStatus.get(n)?.excluded);
	crossCheck.push(
		`surfaces.md: ${inApp.length} Obsidian classes named; ${inApp.length - open.length} covered or excluded${open.length ? `; open: ${open.join(" ")}` : ""}`,
	);
}

const pct = (n: number, d: number) => `${d ? ((100 * n) / d).toFixed(1) : "100.0"}%`;
const lines = [
	`Obsidian ${checklist.obsidianVersion} · ${fixtures.length} fixtures (${fixtures.filter((f) => f.variantOf).length} synthetic macOS/Windows variants)`,
	`Checklist items covered: ${checklist.items.length - missingItems.length}/${checklist.items.length} (${pct(checklist.items.length - missingItems.length, checklist.items.length)})`,
	`theme.css selectors matched: ${themeMatched.length}/${theme.length} (${pct(themeMatched.length, theme.length)}); excluded with reason: ${themeExcluded.length}; missing: ${themeMissing.length}`,
	`App CSS classes: covered ${appCovered.length}, excluded ${appExcluded.length}, missing ${appMissing.length} of ${app.length} (${pct(appCovered.length + appExcluded.length, app.length)} accounted for)`,
	...crossCheck.map((c) => `Expert cross-check, ${c}`),
];
console.log(lines.join("\n"));
if (missingItems.length)
	console.log(`\nMissing items:\n${missingItems.map((i) => `  ${i.id}`).join("\n")}`);
if (themeMissing.length)
	console.log(
		`\nUnmatched theme selectors:\n${themeMissing.map((r) => `  ${r.id} ${r.selector}${r.invalid ? ` (invalid: ${r.invalid})` : ""}`).join("\n")}`,
	);
if (appMissing.length)
	console.log(
		`\nApp classes neither captured nor excluded (${appMissing.length}):\n  ${appMissing.map((c) => c.name).join(" ")}`,
	);

writeFileSync(
	`${CAPTURE}coverage.json`,
	`${JSON.stringify(
		{
			obsidianVersion: checklist.obsidianVersion,
			summary: lines,
			missingItems: missingItems.map((i) => i.id),
			themeSelectors: themeRows,
			appClasses: app,
		},
		null,
		"\t",
	)}\n`,
);
writeFileSync(`${CAPTURE}COVERAGE.md`, report());

const complete = !missingItems.length && !themeMissing.length && !appMissing.length;
process.exit(complete ? 0 : 1);

function report(): string {
	const out = [
		"# Capture coverage",
		"",
		"Generated by `bun run capture:coverage`. Do not edit by hand.",
		"",
		...lines.map((l) => `- ${l}`),
		"",
	];
	out.push(
		"## theme.css selectors",
		"",
		"| Line | Selector | Matching fixtures |",
		"| --- | --- | --- |",
	);
	for (const r of themeRows) {
		const cell = r.fixtures.length
			? `${r.fixtures
					.slice(0, 5)
					.map((f) => `\`${f}\``)
					.join(", ")}${r.fixtures.length > 5 ? ` and ${r.fixtures.length - 5} more` : ""}`
			: r.excluded
				? `excluded: ${r.excluded}`
				: "**missing**";
		out.push(`| ${r.id} | \`${r.selector.replaceAll("|", "\\|")}\` | ${cell} |`);
	}
	out.push("", "## App classes not in any fixture", "");
	const reasons = new Map<string, string[]>();
	for (const c of [...appExcluded, ...appMissing]) {
		const why = c.excluded ?? "**missing**";
		reasons.set(why, [...(reasons.get(why) ?? []), c.name]);
	}
	for (const [why, names] of [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		out.push(`- ${why} (${names.length}): ${names.map((n) => `\`${n}\``).join(" ")}`);
	}
	if (fx.failed.length) {
		out.push("", "## Capture failures", "", ...fx.failed.map((f) => `- \`${f.id}\`: ${f.error}`));
	}
	out.push("");
	return out.join("\n");
}
