// Proves coverage from the files alone. An item counts only when its fixture holds the target and
// its claimed state and the capture recorded a visible, unobscured, non-blank screenshot. A
// theme.css selector counts only when it matches a valid fixture AND Chromium matched it in the
// live app at capture time. App classes count when a valid fixture contains them.
// Usage: bun run capture:coverage    (exit code 1 while any gap is neither covered nor excluded)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright";
import { matchable } from "./css.ts";
import { pngStats } from "./engine.ts";
import { SCREENSHOTS } from "./obsidian.ts";
import {
	appClassStatuses,
	appSelectors,
	CAPTURE,
	census,
	loadExclusions,
	themeExclusion,
	themeSelectors,
} from "./plan.ts";
import type { ChecklistItem, FixtureEntry, Target } from "./types.ts";

if (!existsSync(`${CAPTURE}.app/app.css`)) {
	throw new Error("Run `bun run capture:extract-app-css` first.");
}

const checklist = JSON.parse(readFileSync(`${CAPTURE}checklist.json`, "utf8")) as {
	items: ChecklistItem[];
	obsidianVersion: string;
};
const fx = JSON.parse(readFileSync(`${CAPTURE}fixtures.json`, "utf8")) as {
	fixtures: FixtureEntry[];
	failed: { id: string; error: string }[];
};
const ex = loadExclusions();
const itemById = new Map(checklist.items.map((i) => [i.id, i]));
const byId = new Map(fx.fixtures.map((f) => [f.id, f]));
const theme = themeSelectors();
const rewritten = theme.map((s) => matchable(s.selector));
const screenshotsHere = existsSync(SCREENSHOTS);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("**", (r) => r.abort());

interface Check {
	ok: boolean;
	why: string[];
	hits: number[];
	classes: string[];
}

/** Checks one fixture file in Chromium (DOMParser, no scripts) against its claims. */
async function inspect(f: FixtureEntry, claim: ChecklistItem | undefined): Promise<Check> {
	const why: string[] = [];
	const path = `${CAPTURE}fixtures/${f.file}`;
	if (!existsSync(path)) return { ok: false, why: ["fixture file missing"], hits: [], classes: [] };
	const html = readFileSync(path, "utf8");
	const forced = (claim?.pseudo ?? []).filter((p) => p !== "visited");
	const r = (await page.evaluate(
		([html, sels, expect, forced]) => {
			const doc = new DOMParser().parseFromString(html, "text/html");
			const target = doc.querySelector("[data-capture-target]");
			const pel = doc.querySelector("[data-capture-pseudo]") ?? target;
			const marks = (pel?.getAttribute("data-capture-state") ?? "").split(" ");
			const hit: number[] = [];
			sels.forEach((s, i) => {
				try {
					if (doc.querySelector(s)) hit.push(i);
				} catch {}
			});
			const classes = new Set<string>();
			for (const el of doc.querySelectorAll("[class]"))
				for (const c of el.classList) classes.add(c);
			let expectOk = true;
			try {
				expectOk = !expect || !!target?.matches(expect);
			} catch {
				expectOk = false;
			}
			return {
				hasTarget: !!target,
				stateOk: forced.every((p) => marks.includes(p)),
				expectOk,
				hit,
				classes: [...classes],
			};
		},
		[html, rewritten, claim?.expect ?? null, forced] as [string, string[], string | null, string[]],
	)) as {
		hasTarget: boolean;
		stateOk: boolean;
		expectOk: boolean;
		hit: number[];
		classes: string[];
	};
	if (!r.hasTarget) why.push("no [data-capture-target] in the fixture");
	if (!r.stateOk) why.push(`forced state ${forced.join("+")} not marked on the forced element`);
	if (!r.expectOk) why.push(`target does not match ${claim?.expect}`);
	if (f.variantOf) {
		// Synthetic platform variant: its base fixture carries the screenshot evidence.
		const base = byId.get(f.variantOf);
		if (!base?.evidence) why.push("base fixture has no evidence");
		return { ok: why.length === 0, why, hits: r.hit, classes: r.classes };
	}
	const ev = f.evidence;
	if (!ev) why.push("no capture evidence recorded");
	else {
		const [, , w, h] = ev.box;
		if (!w || !h || w < 1 || h < 1) why.push("target box is empty");
		if (ev.unobscured < (claim?.minUnobscured ?? 0.6))
			why.push(`target only ${ev.unobscured} unobscured`);
		if (!ev.screenshot || ev.screenshot.colors < 2) why.push("screenshot blank or missing");
		if (forced.length && !forced.every((p) => (ev.marks[p] ?? 0) > 0))
			why.push("Chromium did not confirm the forced state");
		if (claim?.pseudo?.includes("visited") && !ev.marks.visited) why.push("visited not forced");
		if (claim?.state === "selection" && !ev.marks.selection)
			why.push("no text selection on the target");
		if (claim?.state === "scrollbar-hover" && !ev.marks["scrollbar-hover"])
			why.push("pointer was not over the scrollbar");
		if (screenshotsHere && ev.screenshot) {
			const shot = `${SCREENSHOTS}/${f.id}.png`;
			if (!existsSync(shot)) why.push("screenshot file missing");
			else {
				const sha = new Bun.CryptoHasher("sha256")
					.update(await Bun.file(shot).arrayBuffer())
					.digest("hex");
				if (sha !== ev.screenshot.sha256) why.push("screenshot file differs from the recorded one");
				else if (pngStats(shot).colors < 2) why.push("screenshot is blank");
			}
		}
	}
	return { ok: why.length === 0, why, hits: r.hit, classes: r.classes };
}

/** A state needs proof unless the target selector itself names it. */
function stateUnproven(i: ChecklistItem): boolean {
	if (i.state === "default" || i.pseudo?.length || i.expect || i.synthetic) return false;
	// Proven by marks checked in inspect(): a live text selection or the pointer over a scrollbar.
	if (i.state === "selection" || i.state === "scrollbar-hover") return false;
	const sel = typeof i.target === "string" ? i.target : (i.target as Exclude<Target, string>).sel;
	return !/\.(is|mod|has)-|\[|:checked|:has\(|\.cm-active|\.selected|\.collapsed/.test(sel);
}

const valid = new Map<string, Check>();
const invalid = new Map<string, string[]>();
for (const f of fx.fixtures) {
	const c = await inspect(f, itemById.get(f.covers[0] ?? f.id));
	if (c.ok) valid.set(f.id, c);
	else invalid.set(f.id, c.why);
}

// 1. Checklist items.
const coveredBy = new Map<string, string>();
for (const [id] of valid) for (const c of byId.get(id)?.covers ?? []) coveredBy.set(c, id);
const unproven = checklist.items.filter((i) => coveredBy.has(i.id) && stateUnproven(i));
const covered = checklist.items.filter((i) => coveredBy.has(i.id) && !stateUnproven(i));
const excludedItems = checklist.items.filter((i) => !coveredBy.has(i.id) && i.excluded);
const missingItems = checklist.items.filter((i) => !covered.includes(i) && !i.excluded);
const syntheticItems = covered.filter(
	(i) => i.synthetic || byId.get(coveredBy.get(i.id) ?? "")?.variantOf,
);

// 2. theme.css selectors: fixture match AND live match at capture time.
const fixtureHits = new Map<string, string[]>(theme.map((s) => [s.id, []]));
const liveHits = new Map<string, string[]>(theme.map((s) => [s.id, []]));
for (const [id, c] of valid) {
	const f = byId.get(id) as FixtureEntry;
	// Synthetic platform variants have no live page; they only cover platform items.
	if (f.variantOf) continue;
	const live = new Set(f.evidence?.live ?? []);
	for (const i of c.hits) fixtureHits.get(theme[i]?.id ?? "")?.push(id);
	for (const l of live) liveHits.get(l)?.push(id);
}
const themeRows = theme.map((s) => {
	const fix = fixtureHits.get(s.id) ?? [];
	const live = liveHits.get(s.id) ?? [];
	const both = fix.filter((f) => live.includes(f));
	return {
		...s,
		matchable: matchable(s.selector),
		fixtures: both,
		fixtureOnly: fix.filter((f) => !live.includes(f)),
		liveOnly: live.filter((f) => !fix.includes(f)),
		excluded: themeExclusion(s.selector, ex),
	};
});
const themeMatched = themeRows.filter((r) => r.fixtures.length > 0);
const themeExcluded = themeRows.filter((r) => !r.fixtures.length && r.excluded);
const themeMissing = themeRows.filter((r) => !r.fixtures.length && !r.excluded);
const disagreements = themeRows.filter((r) => r.fixtureOnly.length || r.liveOnly.length);

// 3. App classes.
const classIn = new Map<string, string>();
for (const [id, c] of valid) for (const k of c.classes) if (!classIn.has(k)) classIn.set(k, id);
const seen = census();
const app = appClassStatuses(appSelectors(), ex).map((c) => ({
	...c,
	fixture: classIn.get(c.name),
	census: seen.has(c.name),
}));
const appCovered = app.filter((c) => c.fixture);
const appExcluded = app.filter((c) => !c.fixture && c.excluded);
const appMissing = app.filter((c) => !c.fixture && !c.excluded);
const appCensusOnly = appMissing.filter((c) => c.census);
await browser.close();

// 4. Identical screenshots of different items (a sign of an overlay covering the window).
const bySha = new Map<string, string[]>();
for (const f of fx.fixtures) {
	if (f.variantOf) continue;
	const sha = f.evidence?.screenshot?.sha256;
	if (sha) bySha.set(sha, [...(bySha.get(sha) ?? []), f.id]);
}
const dupes = [...bySha.values()].filter((v) => v.length > 1);

// 5. Cross-check with the theming expert's vault pages (read only; skipped when absent).
const EXPERT = `${homedir()}/Holocron/Other/Obsidian/LLM/wiki/concepts/obsidian-theming/`;
const crossCheck: string[] = [];
const appStatus = new Map(app.map((c) => [c.name, c]));
if (existsSync(`${EXPERT}rule-map.md`)) {
	const norm = (x: string) => x.replaceAll("\\|", "|").replace(/\s+/g, " ");
	const rows = [
		...readFileSync(`${EXPERT}rule-map.md`, "utf8").matchAll(/^\| (\d+) \| `(.+?)` \|/gm),
	];
	// The expert's table cuts long selectors; a row matches a tracked selector it starts.
	const unknown = rows.filter(
		(r) =>
			!theme.some((s) => String(s.line) === r[1] && norm(s.selector).startsWith(norm(r[2] ?? ""))),
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
const n = checklist.items.length;
const lines = [
	`Obsidian ${checklist.obsidianVersion} · ${fx.fixtures.length} fixtures, ${valid.size} with valid evidence (${fx.fixtures.filter((f) => f.variantOf).length} synthetic macOS/Windows variants)`,
	`Checklist items shown in their claimed state: ${covered.length}/${n} (${pct(covered.length, n)}); ${syntheticItems.length} of them scripted or synthetic (labeled); excluded with reason: ${excludedItems.length}; missing: ${missingItems.length}`,
	`theme.css selectors matched by fixture and live Chromium: ${themeMatched.length}/${theme.length} (${pct(themeMatched.length, theme.length)}); excluded with reason: ${themeExcluded.length}; missing: ${themeMissing.length}; fixture/live disagreements: ${disagreements.length}`,
	`App CSS classes: in a valid fixture ${appCovered.length}, excluded ${appExcluded.length}, missing ${appMissing.length} (${appCensusOnly.length} of them seen in the runtime census only) of ${app.length} (${pct(appCovered.length + appExcluded.length, app.length)} accounted for)`,
	`Screenshots: ${screenshotsHere ? "files re-checked against recorded hashes" : "files not on this machine; recorded evidence used"}; ${dupes.length} groups of identical screenshots`,
	...crossCheck.map((c) => `Expert cross-check, ${c}`),
];
console.log(lines.join("\n"));
const list = (title: string, xs: string[]) => {
	if (xs.length) console.log(`\n${title} (${xs.length}):\n  ${xs.join("\n  ")}`);
};
list(
	"Missing items",
	missingItems.map(
		(i) =>
			`${i.id}${invalid.has(i.id) ? ` — ${invalid.get(i.id)?.join("; ")}` : unproven.includes(i) ? " — state not proven (add expect)" : ""}`,
	),
);
list(
	"Unmatched theme selectors",
	themeMissing.map(
		(r) =>
			`${r.id} ${r.selector}${r.fixtureOnly.length ? ` (fixture-only: ${r.fixtureOnly.slice(0, 2).join(", ")})` : ""}${r.liveOnly.length ? ` (live-only: ${r.liveOnly.slice(0, 2).join(", ")})` : ""}`,
	),
);
list("App classes neither captured nor excluded", [
	appMissing.map((c) => `${c.name}${c.census ? "*" : ""}`).join(" "),
]);
list(
	"Identical screenshots",
	dupes.map((d) => d.join(" = ")),
);

writeFileSync(
	`${CAPTURE}coverage.json`,
	`${JSON.stringify(
		{
			obsidianVersion: checklist.obsidianVersion,
			summary: lines,
			missingItems: missingItems.map((i) => ({
				id: i.id,
				why: invalid.get(i.id) ?? (unproven.includes(i) ? ["state not proven"] : ["no fixture"]),
			})),
			invalidFixtures: Object.fromEntries(invalid),
			themeSelectors: themeRows,
			appClasses: app,
			identicalScreenshots: dupes,
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
		"## How visibility and state are proven",
		"",
		"- At capture time the target must have a nonzero box inside the window, no `display: none`, `visibility: hidden` or `opacity: 0` on it or an ancestor, and be the topmost element (itself, a child or an ancestor per `elementFromPoint`) at most of 9 sample points. Otherwise the capture fails.",
		"- Forced states (`CSS.forcePseudoState`) are written into the fixture only on elements for which Chromium's `Element.matches()` returned true, so a forced child never credits an ancestor's `:hover`, and `:focus-visible` never credits `:focus`. `:visited` is hidden from scripts by Chromium, so it is marked on the forced link only.",
		"- Each theme.css selector is also matched in the live app at capture time (pseudo-elements stripped). A selector counts only when the fixture match and the live match agree.",
		"- Screenshots must have more than one color; their SHA-256 is recorded and re-checked when the files are present.",
		"- Scripted states (`synthetic`) say exactly what was scripted; macOS/Windows variants swap the body platform class on a Linux capture and carry no screenshot.",
		"",
	];
	out.push("## Missing items", "");
	for (const i of missingItems)
		out.push(
			`- \`${i.id}\`: ${(invalid.get(i.id) ?? (unproven.includes(i) ? ["state not proven"] : ["no fixture"])).join("; ")}`,
		);
	if (excludedItems.length) {
		out.push("", "## Checklist items excluded", "");
		for (const i of excludedItems)
			out.push(
				`- \`${i.id}\` (\`${typeof i.target === "string" ? i.target : i.target.sel}\`): ${i.excluded}`,
			);
	}
	out.push("", "## Scripted or synthetic items", "");
	for (const i of syntheticItems)
		out.push(`- \`${i.id}\`: ${i.synthetic ?? byId.get(coveredBy.get(i.id) ?? "")?.note ?? ""}`);
	out.push(
		"",
		"## theme.css selectors",
		"",
		"| Line | Selector | Fixtures (fixture and live agree) |",
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
	if (disagreements.length) {
		out.push(
			"",
			"## Fixture vs live disagreements",
			"",
			"Fixture-only means the static fixture matched but Chromium did not (not credited). Live-only means Chromium matched but the fixture lacks context (not credited from that fixture).",
			"",
		);
		for (const r of disagreements)
			out.push(
				`- \`${r.selector}\`: fixture-only ${r.fixtureOnly.length}, live-only ${r.liveOnly.length}`,
			);
	}
	out.push("", "## App classes not in any valid fixture", "");
	const reasons = new Map<string, string[]>();
	for (const c of [...appExcluded, ...appMissing]) {
		const why =
			c.excluded ??
			(c.census
				? "**missing** (seen in the runtime census, no fixture)"
				: "**missing** (never seen in the runtime DOM census)");
		reasons.set(why, [...(reasons.get(why) ?? []), c.name]);
	}
	for (const [why, names] of [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		out.push(`- ${why} (${names.length}): ${names.map((x) => `\`${x}\``).join(" ")}`);
	}
	if (dupes.length)
		out.push(
			"",
			"## Identical screenshots",
			"",
			...dupes.map((d) => `- ${d.map((x) => `\`${x}\``).join(" = ")}`),
		);
	if (fx.failed.length)
		out.push("", "## Capture failures", "", ...fx.failed.map((f) => `- \`${f.id}\`: ${f.error}`));
	out.push("");
	return out.join("\n");
}
