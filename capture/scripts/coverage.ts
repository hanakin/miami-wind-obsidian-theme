// Proves coverage from the files alone. An item counts only when its fixture holds the target and
// its claimed state and the capture recorded a visible, unobscured, non-blank screenshot. A
// theme.css selector counts only when it matches a valid fixture AND Chromium matched it in the
// live app at capture time. App classes count when a valid fixture contains them.
// Usage: bun run capture:coverage    (exit code 1 while any gap is neither covered nor excluded)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright";
import { matchable, selectors, themeAffectedClasses } from "./css.ts";
import { pngStats } from "./engine.ts";
import { SCREENSHOTS, WORK } from "./obsidian.ts";
import {
	appClassStatuses,
	appSelectors,
	CAPTURE,
	census,
	loadExclusions,
	themeExclusion,
	themeSelectors,
} from "./plan.ts";
import { checkFixture, makeEnv, REPLAY_MIN_MATCH } from "./replay-check.ts";
import type { ChecklistItem, FixtureEntry } from "./types.ts";

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
/** Share of 16 px blocks of the target that must match the live screenshot when replayed alone. */

// Scrollbars take layout space in Obsidian; headless Chromium hides them unless told not to.
const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
const page = await browser.newPage();
await page.route("**", (r) => r.abort());

interface Check {
	ok: boolean;
	why: string[];
	/** Selector indexes that hit a visibly painted element / only hidden or clipped elements. */
	hits: number[];
	domHits: number[];
	/** Classes on visibly painted elements / only on elements that were not painted. */
	classes: string[];
	domClasses: string[];
}

/** Checks one fixture file in Chromium (DOMParser, no scripts) against its claims. */
async function inspect(f: FixtureEntry, claim: ChecklistItem | undefined): Promise<Check> {
	const why: string[] = [];
	const path = `${CAPTURE}fixtures/${f.file}`;
	if (!existsSync(path))
		return {
			ok: false,
			why: ["fixture file missing"],
			hits: [],
			domHits: [],
			classes: [],
			domClasses: [],
		};
	const html = readFileSync(path, "utf8");
	// The file extension must say how to parse it: .xhtml for format "xhtml", .html otherwise,
	// and the content must agree.
	const xhtml = f.format === "xhtml";
	if (!f.file.endsWith(xhtml ? ".xhtml" : ".html"))
		why.push(`file extension does not match format ${f.format ?? "html"}: ${f.file}`);
	if (html.startsWith("<?xml") !== xhtml)
		why.push(
			`content is ${html.startsWith("<?xml") ? "XHTML" : "HTML"} but format is ${f.format ?? "html"}`,
		);
	const forced = (claim?.pseudo ?? []).filter((p) => p !== "visited");
	const r = (await page.evaluate(
		([html, sels, expect, forced]) => {
			const doc = new DOMParser().parseFromString(
				html,
				html.startsWith("<?xml") ? "application/xhtml+xml" : "text/html",
			);
			const target = doc.querySelector("[data-capture-target]");
			const pel = doc.querySelector("[data-capture-pseudo]") ?? target;
			const marks = (pel?.getAttribute("data-capture-state") ?? "").split(" ");
			// Visual hits need a visibly painted element (data-capture-seen); DOM hits do not.
			const hit: number[] = [];
			const domHit: number[] = [];
			sels.forEach((s, i) => {
				try {
					const list = [...doc.querySelectorAll(s)];
					if (list.some((e) => e.hasAttribute("data-capture-seen"))) hit.push(i);
					else if (list.length) domHit.push(i);
				} catch {}
			});
			const classes = new Set<string>();
			const domClasses = new Set<string>();
			for (const el of doc.querySelectorAll("[class]"))
				for (const c of el.classList)
					(el.hasAttribute("data-capture-seen") ? classes : domClasses).add(c);
			let expectOk = true;
			try {
				expectOk = !expect || !!target?.matches(expect);
			} catch {
				expectOk = false;
			}
			// Saved hidden: the target or an ancestor carries hidden or an inline display: none.
			let hiddenBy = "";
			for (let a = target; a && !hiddenBy; a = a.parentElement)
				if (a.hasAttribute("hidden") || /display:\s*none/.test(a.getAttribute("style") ?? ""))
					hiddenBy = `${a.localName}.${[...a.classList].join(".")}`;
			// imageSizes indexes must point at offline-only images of the saved document.
			const imgs = [...doc.images].map((i) => i.getAttribute("src") ?? "");
			return {
				hiddenBy,
				imgs,
				hasTarget: !!target,
				stateOk: forced.every((p) => marks.includes(p)),
				expectOk,
				hit,
				domHit,
				classes: [...classes],
				domClasses: [...domClasses].filter((c) => !classes.has(c)),
			};
		},
		[html, rewritten, claim?.expect ?? null, forced] as [string, string[], string | null, string[]],
	)) as {
		hiddenBy: string;
		imgs: string[];
		hasTarget: boolean;
		stateOk: boolean;
		expectOk: boolean;
		hit: number[];
		domHit: number[];
		classes: string[];
		domClasses: string[];
	};
	if (!r.hasTarget) why.push("no [data-capture-target] in the fixture");
	if (r.hiddenBy) why.push(`saved hidden: ${r.hiddenBy} has hidden or display: none`);
	for (const im of f.imageSizes ?? [])
		if (!/^(app|https?|file):/i.test(r.imgs[im.index] ?? ""))
			why.push(`imageSizes index ${im.index} is not an offline-only image of the saved fixture`);
	if (f.evidence?.unverified?.length)
		why.push(
			`state unverified: ${f.evidence.unverified.join("+")} (Element.matches() false and no DevTools-matched author rule for it)`,
		);
	else if (!r.stateOk)
		why.push(`forced state ${forced.join("+")} not marked on the forced element`);
	if (!r.expectOk) why.push(`target does not match ${claim?.expect}`);
	if (f.variantOf) {
		// Synthetic platform variant: its base fixture carries the screenshot evidence.
		const base = byId.get(f.variantOf);
		if (!base?.evidence) why.push("base fixture has no evidence");
		return {
			ok: why.length === 0,
			why,
			hits: r.hit,
			domHits: r.domHit,
			classes: r.classes,
			domClasses: r.domClasses,
		};
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
			why.push("forced state not recorded");
		if (!ev.seen) why.push("no element recorded as visibly painted");
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
	return {
		ok: why.length === 0,
		why,
		hits: r.hit,
		domHits: r.domHit,
		classes: r.classes,
		domClasses: r.domClasses,
	};
}

/**
 * Every non-default state needs an explicit assertion: forced pseudo-classes, an expect selector
 * the target matched, a labeled script, or the selection / scrollbar marks checked in inspect().
 */
function stateUnproven(i: ChecklistItem): boolean {
	if (i.state === "default" || i.pseudo?.length || i.expect || i.synthetic) return false;
	return i.state !== "selection" && i.state !== "scrollbar-hover";
}

const valid = new Map<string, Check>();
const invalid = new Map<string, string[]>();
for (const f of fx.fixtures) {
	const c = await inspect(f, itemById.get(f.covers[0] ?? f.id));
	if (c.ok) valid.set(f.id, c);
	else invalid.set(f.id, c.why);
}

// Each saved fixture must show its target when rendered alone, the way a viewer replays it, and
// look like the live screenshot: see replay-check.ts and the "Replay alone" section of COVERAGE.md.
const env = await makeEnv(browser);
/** Fixtures whose replay cannot be compared with the live screenshot, and why. */
const replayLimits = new Map<string, string>();
/** Per fixture: share of compared 16 px blocks that match the live screenshot. */
const replayMatch = new Map<string, number>();
const replayDir = `${WORK}/replay`;
const renderOrder = [...valid.keys()].filter((id) => !byId.get(id)?.variantOf).sort();
for (const id of renderOrder) {
	const r = await checkFixture(env, byId.get(id) as FixtureEntry);
	if (r.status === "ok" && r.share !== undefined) replayMatch.set(id, r.share);
	if (r.status === "fail") {
		valid.delete(id);
		invalid.set(id, [r.why ?? "replay failed"]);
	} else if (r.status === "limit") replayLimits.set(id, r.why ?? "");
}
await env.close();
writeFileSync(
	`${replayDir}/match.json`,
	JSON.stringify(Object.fromEntries([...replayMatch].sort((x, y) => x[1] - y[1])), null, 1),
);

/** Image entries (imageSizes) drawn from saved files, and those left as stand-ins. */
const imageCounts = {
	kept: fx.fixtures.flatMap((f) => (f.variantOf ? [] : (f.imageSizes ?? []))).filter((i) => i.file)
		.length,
	remote: fx.fixtures
		.flatMap((f) => (f.variantOf ? [] : (f.imageSizes ?? [])))
		.filter((i) => !i.file).length,
};

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
const domOnlyHits = new Map<string, string[]>(theme.map((s) => [s.id, []]));
const syntheticHits = new Map<string, string[]>(theme.map((s) => [s.id, []]));
for (const [id, c] of valid) {
	const f = byId.get(id) as FixtureEntry;
	// Scripted fixtures and platform variants count separately from visual captures.
	if (f.variantOf || f.synthetic) {
		for (const i of c.hits) syntheticHits.get(theme[i]?.id ?? "")?.push(id);
		continue;
	}
	const live = new Set(f.evidence?.live ?? []);
	for (const i of c.hits) fixtureHits.get(theme[i]?.id ?? "")?.push(id);
	for (const i of c.domHits) domOnlyHits.get(theme[i]?.id ?? "")?.push(id);
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
		domOnly: domOnlyHits.get(s.id) ?? [],
		synthetic: syntheticHits.get(s.id) ?? [],
		excluded: themeExclusion(s.selector, ex),
	};
});
const themeMatched = themeRows.filter((r) => r.fixtures.length > 0);
const themeExcluded = themeRows.filter((r) => !r.fixtures.length && r.excluded);
const scriptedLabel = (r: (typeof themeRows)[number]) =>
	r.synthetic.length ? ex.themeSelectorsScripted?.[r.selector] : undefined;
const themeScripted = themeRows.filter(
	(r) => !r.fixtures.length && !r.excluded && scriptedLabel(r),
);
const themeMissing = themeRows.filter(
	(r) => !r.fixtures.length && !r.excluded && !scriptedLabel(r),
);
const themeDomOnly = themeMissing.filter((r) => r.domOnly.length);
const themeSyntheticOnly = themeMissing.filter((r) => !r.domOnly.length && r.synthetic.length);
const disagreements = themeRows.filter((r) => r.fixtureOnly.length || r.liveOnly.length);

// 3. App classes.
const classIn = new Map<string, string>();
const classDom = new Map<string, string>();
const classSynthetic = new Map<string, string>();
for (const [id, c] of valid) {
	const f = byId.get(id) as FixtureEntry;
	const synthetic = !!(f.variantOf || f.synthetic);
	for (const k of c.classes) {
		if (synthetic) {
			if (!classSynthetic.has(k)) classSynthetic.set(k, id);
		} else if (!classIn.has(k)) classIn.set(k, id);
	}
	for (const k of c.domClasses) if (!classDom.has(k)) classDom.set(k, id);
}
const seen = census();
const app = appClassStatuses(appSelectors(), ex).map((c) => ({
	...c,
	fixture: classIn.get(c.name),
	dom: classDom.get(c.name),
	synthetic: classSynthetic.get(c.name),
	census: seen.has(c.name),
}));
// Graph probe classes (.graph-view.color-*) exist only for an instant; they count as painted when
// the graph renderer read a color from them and that exact color is in the graph screenshot.
const graphPainted = new Map<string, string>();
const graphReadOnly = new Map<string, string>();
for (const f of fx.fixtures) {
	const rec = f.evidence?.record;
	if (!rec?.graphColors) continue;
	const needs = (rec.requires ?? {}) as Record<string, boolean>;
	for (const [cls, n] of Object.entries(rec.graphPixels ?? {})) {
		// At least 25 pixels inside the graph canvas (controls masked), and the renderer must really
		// draw that thing (option on, nodes of that type, a hovered or focused node).
		if (n >= 25 && needs[cls] !== false) {
			graphPainted.set(cls, f.id);
			graphPainted.set("graph-view", f.id);
		} else if (!graphPainted.has(cls)) graphReadOnly.set(cls, f.id);
	}
}
const affected = themeAffectedClasses(
	readFileSync(`${CAPTURE}.app/app.css`, "utf8"),
	readFileSync(`${CAPTURE}../theme.css`, "utf8"),
);
const appCovered = app.filter((c) => c.fixture || graphPainted.has(c.name));
const appExcluded = app.filter((c) => !c.fixture && !graphPainted.has(c.name) && c.excluded);
const appOpen = app.filter((c) => !c.fixture && !graphPainted.has(c.name) && !c.excluded);
// Classes no theme.css rule or theme-set variable can change are accepted gaps.
const appNotAffected = appOpen.filter((c) => !affected.has(c.name));
const appOutOfScope = appOpen.filter(
	(c) => affected.has(c.name) && ex.appClassesOutOfScope?.[c.name],
);
const appMissing = appOpen.filter(
	(c) => affected.has(c.name) && !ex.appClassesOutOfScope?.[c.name],
);
const appCensusOnly = appMissing.filter((c) => c.census && !c.dom && !c.synthetic);
const appDomOnly = appMissing.filter((c) => c.dom);
const appSyntheticOnly = appMissing.filter((c) => !c.dom && c.synthetic);

// 4. Identical screenshots of different items. Each group must be explained by its fixtures:
// a claimed state that no stylesheet styles there, one element in different editor modes, or
// two items whose fixtures hold the same DOM. Anything else is listed for review.
const bySha = new Map<string, string[]>();
for (const f of fx.fixtures) {
	if (f.variantOf) continue;
	const sha = f.evidence?.screenshot?.sha256;
	if (sha) bySha.set(sha, [...(bySha.get(sha) ?? []), f.id]);
}
const runtimeCss = `${CAPTURE}.app/runtime-styles.css`;
const stateSelectors = [
	...theme.map((s) => s.selector),
	...appSelectors().map((s) => s.selector),
	...(existsSync(runtimeCss)
		? selectors(readFileSync(runtimeCss, "utf8")).map((s) => s.selector)
		: []),
]
	.map((s) => matchable(s))
	.filter((s) => s.includes("data-capture-state~="));
const MODES = /\.(live|reading|source)$/;
const MODE_ROOT: Record<string, string> = {
	live: ".markdown-source-view.is-live-preview",
	source: ".markdown-source-view:not(.is-live-preview)",
	reading: ".markdown-reading-view",
};
/** What a fixture shows that matters for a dupe: styled states, editor mode, normalized DOM. */
async function dupeFacts(id: string) {
	const f = byId.get(id);
	const html =
		f && existsSync(`${CAPTURE}fixtures/${f.file}`)
			? readFileSync(`${CAPTURE}fixtures/${f.file}`, "utf8")
			: "";
	const mode = MODES.exec(id)?.[1];
	return (await page.evaluate(
		([html, sels, modeSel]) => {
			const doc = new DOMParser().parseFromString(
				html,
				html.startsWith("<?xml") ? "application/xhtml+xml" : "text/html",
			);
			const target = doc.querySelector("[data-capture-target]");
			const styled = sels.filter((s) => {
				try {
					return !!doc.querySelector(s);
				} catch {
					return false;
				}
			});
			for (const e of doc.querySelectorAll("*"))
				for (const a of [...e.attributes])
					if (a.name.startsWith("data-capture") || a.name === "id" || a.name === "style")
						e.removeAttribute(a.name);
			return {
				styled: styled.length,
				modeOk:
					!modeSel ||
					!!target?.closest(modeSel) ||
					!!target?.querySelector(modeSel) ||
					!!target?.matches(modeSel),
				dom: doc.body.innerHTML.replace(/\s+/g, " "),
				target: (target?.outerHTML ?? "").replace(/\s+/g, " "),
			};
		},
		[html, stateSelectors, mode ? (MODE_ROOT[mode] ?? null) : null] as [
			string,
			string[],
			string | null,
		],
	)) as { styled: number; modeOk: boolean; dom: string; target: string };
}
const STATE_WORDS =
	/^(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|selected)(-(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|selected))*$/;
/** The item an id shows without its state, editor mode or Settings window: chrome.x.hover -> chrome.x. */
function baseOf(id: string): string {
	const parts = id
		.replace(/^inwindow\./, "")
		.replace(MODES, "")
		.split(".");
	while (parts.length > 1 && STATE_WORDS.test(parts.at(-1) ?? "")) parts.pop();
	return parts.join(".");
}
const dupes: string[][] = [];
const dupeReasons: { ids: string[]; reason: string }[] = [];
const dupeLimits: { ids: string[]; reason: string }[] = [];
const stateNotVisible = new Set<string>();
for (const ids of [...bySha.values()].filter((v) => v.length > 1)) {
	const facts = await Promise.all(
		ids.map(async (id) => ({ id, claim: itemById.get(id), ...(await dupeFacts(id)) })),
	);
	// Members join when they show the same thing (one DOM, one target element, or one base item in
	// another mode or window). When their claimed states differ, each differing state must paint
	// nothing new: no rule styles it in the fixture, or forcing it changed no painted style, or it
	// is a scripted (synthetic) state.
	const quiet = (x: (typeof facts)[number]) =>
		!(x.claim?.pseudo ?? []).length ||
		!!x.claim?.synthetic ||
		x.styled === 0 ||
		byId.get(x.id)?.evidence?.styleChanged === 0;
	const statesOf = (x: (typeof facts)[number]) => [...(x.claim?.pseudo ?? [])].sort().join("+");
	const parent = facts.map((_, i) => i);
	const root = (i: number): number => (parent[i] === i ? i : root(parent[i] ?? i));
	const why = new Set<string>();
	for (let i = 0; i < facts.length; i++)
		for (let j = i + 1; j < facts.length; j++) {
			const x = facts[i];
			const y = facts[j];
			if (!x || !y) continue;
			const sameState = statesOf(x) === statesOf(y);
			// A state whose rules matched and whose computed changes were recorded, yet whose pixels
			// match the other shot, is applied but not visible at this spot (listed with the change).
			const applied = (z: (typeof facts)[number]) => {
				const ev = byId.get(z.id)?.evidence;
				return ev?.styleChanged !== undefined && Object.values(ev.painted ?? {}).some((n) => n > 0);
			};
			const ok = (z: (typeof facts)[number]) => quiet(z) || applied(z);
			if (!sameState && !(ok(x) && ok(y))) continue;
			let rel = "";
			if (x.dom === y.dom) rel = "identical fixture DOM";
			else if (x.target && x.target === y.target) rel = "the same target element";
			else if (
				JSON.stringify(byId.get(x.id)?.evidence?.box) ===
					JSON.stringify(byId.get(y.id)?.evidence?.box) &&
				JSON.stringify(byId.get(x.id)?.evidence?.clip) ===
					JSON.stringify(byId.get(y.id)?.evidence?.clip)
			)
				rel = "the same element box and screenshot area";
			else if (baseOf(x.id) === baseOf(y.id) && x.modeOk && y.modeOk)
				rel =
					MODES.test(x.id) || MODES.test(y.id)
						? "the same element in another editor mode"
						: x.id.startsWith("inwindow.") !== y.id.startsWith("inwindow.")
							? "the same Settings control in the popout and in the main window"
							: "the same element in another state";
			if (rel) {
				if (!sameState && quiet(x) && quiet(y))
					why.add(
						"the differing states paint nothing new (no rule styles them, or forcing them changed no painted style)",
					);
				const desc = (z: (typeof facts)[number]) =>
					`${Object.entries(byId.get(z.id)?.evidence?.painted ?? {})
						.map(([k, n]) => `${n} :${k} rule${n === 1 ? "" : "s"}`)
						.join(", ")}; changed: ${(byId.get(z.id)?.evidence?.styleProps ?? []).join("; ")}`;
				if (!sameState && !quiet(x) && !quiet(y))
					why.add(
						`${x.id} and ${y.id} paint the same look (${x.id}: ${desc(x)}) (${y.id}: ${desc(y)})`,
					);
				else
					for (const z of [x, y])
						if (!sameState && !quiet(z))
							why.add(
								`${z.id}: the state applies but its changes do not show at this spot (${desc(z)})`,
							);
				why.add(rel);
				parent[root(j)] = root(i);
			}
		}
	const joined = new Set(facts.map((_, i) => root(i))).size === 1;
	const reason = joined ? [...why].join("; ") : "";
	// A state that applies but whose change does not show is a limitation, not visible proof.
	const hidden = [...why].flatMap(
		(w) => /^(\S+): the state applies but its changes do not show/.exec(w)?.[1] ?? [],
	);
	if (reason && hidden.length) {
		dupeLimits.push({ ids, reason });
		for (const h of hidden) stateNotVisible.add(h);
	} else if (reason) dupeReasons.push({ ids, reason });
	else dupes.push(ids);
}
await browser.close();

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

const shown = covered.filter((i) => !stateNotVisible.has(i.id));
const notVisibleItems = covered.filter((i) => stateNotVisible.has(i.id));
const pct = (n: number, d: number) => `${d ? ((100 * n) / d).toFixed(1) : "100.0"}%`;
const n = checklist.items.length;
const lines = [
	`Obsidian ${checklist.obsidianVersion} · ${fx.fixtures.length} fixtures, ${valid.size} with valid evidence (${fx.fixtures.filter((f) => f.variantOf).length} synthetic macOS/Windows variants)`,
	`Checklist items shown in their claimed state: ${shown.length}/${n} (${pct(shown.length, n)}); ${syntheticItems.length} of them scripted or synthetic (labeled); state applied but its change not visible (limitation, listed): ${notVisibleItems.length}; excluded with reason: ${excludedItems.length}; missing: ${missingItems.length}`,
	`theme.css selectors visibly matched (fixture and live agree, on painted elements): ${themeMatched.length}/${theme.length} (${pct(themeMatched.length, theme.length)}); excluded with reason: ${themeExcluded.length}; scripted only (labeled): ${themeScripted.length}; missing: ${themeMissing.length} (${themeDomOnly.length} only on hidden/clipped elements, ${themeSyntheticOnly.length} only in scripted fixtures); fixture/live disagreements: ${disagreements.length}`,
	`App CSS classes visibly captured: ${appCovered.length} (${[...graphPainted.keys()].length} of them classes credited by screenshot pixels (graph probes)), excluded ${appExcluded.length}, not theme-affected (accepted gaps) ${appNotAffected.length}, theme-affected but out of scope (labeled) ${appOutOfScope.length}, theme-affected missing ${appMissing.length}, of ${app.length}; of the theme-affected missing: ${appDomOnly.length} in the DOM but never painted, ${appSyntheticOnly.length} only in scripted fixtures, ${appCensusOnly.length} seen in the runtime census only`,
	`Screenshots: ${screenshotsHere ? "files re-checked against recorded hashes" : "files not on this machine; recorded evidence used"}; ${dupeReasons.length + dupeLimits.length + dupes.length} groups of identical screenshots (${dupeReasons.length} explained by their fixtures, ${dupeLimits.length} where a state applies but does not show (limitation), ${dupes.length} unexplained)`,
	`Replay alone: ${replayMatch.size} fixtures rendered from their own files (recorded window size and stylesheets, canvas pixels, stand-in sizes, scroll offsets) matched their live screenshot block by block (at least ${Math.round(100 * REPLAY_MIN_MATCH)}% of 16 px blocks, lowest ${pct(Math.round(1000 * Math.min(1, ...replayMatch.values())), 1000)}) and pixel by pixel; replay limits (labeled, not compared): ${replayLimits.size}; synthetic variants (no screenshot, not replayed): ${fx.fixtures.filter((f) => f.variantOf).length}`,
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
list(
	"App classes neither captured nor excluded",
	appMissing.length ? [appMissing.map((c) => `${c.name}${c.census ? "*" : ""}`).join(" ")] : [],
);
list(
	"Unexplained identical screenshots",
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
			identicalScreenshots: { unexplained: dupes, explained: dupeReasons, limitation: dupeLimits },
			stateNotVisible: [...stateNotVisible].sort(),
			graph: {
				painted: Object.fromEntries(graphPainted),
				readOnly: Object.fromEntries(graphReadOnly),
			},
			appClassBuckets: {
				notThemeAffected: appNotAffected.map((c) => c.name),
				outOfScope: appOutOfScope.map((c) => c.name),
				missing: appMissing.map((c) => c.name),
			},
			themeScripted: themeScripted.map((r) => r.selector),
			replay: {
				minMatch: REPLAY_MIN_MATCH,
				match: Object.fromEntries(
					[...replayMatch].map(([k, v]) => [k, Math.round(1000 * v) / 1000]),
				),
				limits: Object.fromEntries(replayLimits),
			},
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
	for (const c of [...appExcluded, ...appOutOfScope, ...appNotAffected, ...appMissing]) {
		const why =
			c.excluded ??
			(ex.appClassesOutOfScope?.[c.name] && affected.has(c.name)
				? `out of scope (theme-affected): ${ex.appClassesOutOfScope[c.name]}`
				: undefined) ??
			(ex.appClassGaps?.[c.name] ? `**open gap**: ${ex.appClassGaps[c.name]}` : undefined) ??
			(!affected.has(c.name)
				? "not theme-affected (accepted gap): no theme.css selector names it and no app.css rule for it reads a variable theme.css sets"
				: undefined) ??
			(c.dom
				? "**missing** (in a fixture's DOM, but never visibly painted)"
				: c.synthetic
					? "**missing** (only in scripted or synthetic fixtures)"
					: c.census
						? "**missing** (seen in the runtime census, no fixture)"
						: "**missing** (never seen in the runtime DOM census)");
		reasons.set(why, [...(reasons.get(why) ?? []), c.name]);
	}
	for (const [why, names] of [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		out.push(`- ${why} (${names.length}): ${names.map((x) => `\`${x}\``).join(" ")}`);
	}
	if (graphPainted.size || graphReadOnly.size)
		out.push(
			"",
			"## Classes credited by screenshot pixels",
			"",
			"The graph's short-lived `.graph-view.color-*` probe elements cannot be witnessed through the DOM (Obsidian paints their colors on a canvas). They count as painted when the renderer really draws that kind of node or link (recorded options and node types) and at least 25 pixels inside the graph canvas (controls masked; the circle around the hovered node, the focused color inside the focused node) have their recorded color (`evidence.record.graphPixels`; colors with alpha are matched blended over the background).",
			"",
			...[...graphPainted.entries()].map(([c, id]) => `- \`${c}\`: painted (\`${id}\`)`),
			...[...graphReadOnly.entries()].map(
				([c, id]) =>
					`- \`${c}\`: read by the renderer, no exact pixel (alpha or antialiasing) (\`${id}\`)`,
			),
		);
	out.push(
		"",
		"## Replay alone",
		"",
		`Every fixture is rendered from its own file in a plain Chromium page: app.css, Obsidian's runtime styles and theme.css as its window applied them (\`styles\`), at its window size (\`viewport\`), with canvas pixels drawn (\`canvasPixels\`, canvases inside frames too), images from the capture vault drawn from their saved files (\`imageSizes\` with \`file\`), empty stand-ins given their live size, display and collapsed margins (\`data-capture-size\`, \`data-capture-display\`, \`data-capture-margin\`), and scroll offsets restored (\`data-capture-scroll\`). The target must sit where it sat live (within 4 px) and at least ${Math.round(100 * REPLAY_MIN_MATCH)}% of its 16 px blocks must match the live screenshot (mean color within 24 of 255 per channel). Then every pixel of the target and an 8 px ring around it (its borders, outline, shadow and focus ring) is compared: outside text, a live pixel must match the replay pixel at the same spot within 24 per channel, both ways, with at most 3 unmatched pixels in any 8 px cell. In the ring, what a neighboring element paints is left out pixel by pixel; the target's own paint and its ancestors' stay compared. Inside text boxes the match may come from 1 px away within 64 per channel (glyph anti-aliasing between the capture's Electron and the replay's Chromium), at most 99 such pixels, and only while the font properties of every text run equal those recorded live (\`evidence.textStyles\`); each text run's ink color (the pixel farthest from its background) must agree within 40. Forced colors: a fixed table of substitutions, measured once on qc.media.forced-colors and never learned from the fixture under test, maps live colors the two builds paint differently (table borders: #333333 live, CanvasText white replayed, though both compute white); a pixel matches mapped or as it is, and shapes are compared as above. Masked out pixel by pixel: remote images (${imageCounts.remote} image entries load from https: and stay same-size stand-ins; ${imageCounts.kept} from the capture vault are drawn from their saved files and compared), audio and video players (they draw their own time and state: an audio player shows 0:01 live and 0:00 replayed), webviews and frames that do not replay, parts drawn over the target live by stand-ins, and animated parts. Any surviving region of 16 pixels or more is compared. Where raster differences between the builds are allowed (borders under a scale transform, image-mask icons, rounded inline backgrounds), the paint recorded live must equal the replay's: colors and image (\`data-capture-paint\`), and the opacity, filter and blend mode of the part and its ancestors (\`data-capture-paint-fx\`); a selection highlight's edge rows have no such record and are held to the pixel tolerances only; the graph's color probes must give the colors recorded live (\`evidence.record.graphColors\`), since its pixels are saved.`,
		"",
		...(replayLimits.size
			? [
					"Replay limits (not compared, labeled):",
					"",
					...[...replayLimits.entries()].sort().map(([id, why]) => `- \`${id}\`: ${why}`),
				]
			: ["No replay limits."]),
	);
	if (themeScripted.length)
		out.push(
			"",
			"## theme.css selectors met only in a labeled scripted fixture",
			"",
			...themeScripted.map((r) => `- \`${r.selector}\`: ${scriptedLabel(r)}`),
		);
	if (dupeLimits.length)
		out.push(
			"",
			"## Limitation: a state applies but its change does not show",
			"",
			"These states are proven applied (DevTools matched their rules and computed styles changed), but the screenshot equals another state's; they are not counted as visibly shown.",
			"",
			...dupeLimits.map((d) => `- ${d.ids.map((x) => `\`${x}\``).join(" = ")}: ${d.reason}`),
		);
	if (dupes.length || dupeReasons.length)
		out.push(
			"",
			"## Identical screenshots",
			"",
			...dupes.map((d) => `- unexplained: ${d.map((x) => `\`${x}\``).join(" = ")}`),
			...dupeReasons.map((d) => `- ${d.ids.map((x) => `\`${x}\``).join(" = ")}: ${d.reason}`),
		);
	if (fx.failed.length)
		out.push("", "## Capture failures", "", ...fx.failed.map((f) => `- \`${f.id}\`: ${f.error}`));
	out.push("");
	return out.join("\n");
}
