// Mutation self-test of the replay check: real fixtures, replayed with a deliberate change, must
// fail (and unchanged, must pass). Needs the live screenshots (this machine).
// Usage: bun run capture:replay-selftest            all cases
//        bun run capture:replay-selftest -- <id>... check those fixtures as they are (debugging)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { CAPTURE } from "./plan.ts";
import { checkFixture, type Mutation, makeEnv } from "./replay-check.ts";
import type { FixtureEntry } from "./types.ts";

const fixtures = (
	JSON.parse(readFileSync(`${CAPTURE}fixtures.json`, "utf8")) as { fixtures: FixtureEntry[] }
).fixtures;
const byId = new Map(fixtures.map((f) => [f.id, f]));

/** Hides the first element inside the target with a visible 1 px border, by making the border transparent. */
const DROP_ONE_BORDER = `(() => {
	const t = document.querySelector("[data-capture-target]");
	for (const e of [t, ...t.querySelectorAll("*")]) {
		const cs = getComputedStyle(e);
		const r = e.getBoundingClientRect();
		if (r.width < 40 || r.height < 12) continue;
		const sides = ["Top", "Right", "Bottom", "Left"].filter((k) => cs["border" + k + "Width"] === "1px" && cs["border" + k + "Style"] !== "none" && !/rgba\\(.*, 0\\)$/.test(cs["border" + k + "Color"]));
		if (sides.length < 4) continue;
		e.style.setProperty("border-color", "transparent", "important");
		return e.className;
	}
	return null;
})()`;

/** Clears every canvas inside the document's frames. */
const CLEAR_FRAME_CANVASES =
	"for (const f of document.querySelectorAll('iframe')) for (const c of f.contentDocument?.querySelectorAll('canvas') ?? []) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);";

const CASES: { id: string; name: string; mutate?: Mutation; pass: boolean }[] = [
	{ id: "command.app:open-vault", name: "unchanged", pass: true },
	{
		id: "command.app:open-vault",
		name: "icons hidden",
		mutate: { css: "svg.svg-icon { opacity: 0 !important; }" },
		pass: false,
	},
	{
		id: "command.app:open-vault",
		name: "one icon hidden",
		mutate: {
			js: "(() => { const i = [...document.querySelectorAll('[data-capture-target] svg.svg-icon')].find((e) => e.getBoundingClientRect().width > 8); if (i) i.style.setProperty('opacity', '0', 'important'); return !!i; })()",
		},
		pass: false,
	},
	{
		id: "command.app:open-vault",
		name: "every svg hidden (logo too)",
		mutate: { css: "svg { opacity: 0 !important; }" },
		pass: false,
	},
	{ id: "qc.dialog.rename", name: "unchanged", pass: true },
	{
		id: "qc.dialog.rename",
		name: "one 1 px border removed",
		mutate: { js: DROP_ONE_BORDER },
		pass: false,
	},
	{ id: "graph.controls", name: "unchanged", pass: true },
	{
		id: "graph.controls",
		name: "control colors changed",
		mutate: {
			css: "[data-capture-target] { background: red !important; color: lime !important; }",
		},
		pass: false,
	},
	{ id: "qc.bases.group-menu", name: "unchanged", pass: true },
	{
		id: "qc.bases.group-menu",
		name: "control colors changed",
		mutate: {
			css: "[data-capture-target] { background: red !important; color: lime !important; }",
		},
		pass: false,
	},
	// QC round 6: small icon and label changes, focus rings, sparse regions, forced colors.
	{
		id: "command.app:open-vault",
		name: "one icon #666 to #878787",
		mutate: {
			js: "document.querySelector('[data-capture-target] svg.svg-icon').style.setProperty('color', '#878787', 'important')",
		},
		pass: false,
	},
	{
		id: "command.app:open-vault",
		name: "one icon shifted 2 px",
		mutate: {
			js: "document.querySelector('[data-capture-target] svg.svg-icon').style.setProperty('transform', 'translateX(2px)', 'important')",
		},
		pass: false,
	},
	{
		id: "command.app:open-vault",
		name: "version label pink",
		mutate: { css: ".splash-brand-version { color: #c586f7 !important; }" },
		pass: false,
	},
	{
		id: "command.app:open-vault",
		name: "one control shifted 2 px",
		mutate: {
			js: "[...document.querySelectorAll('[data-capture-target] button')].find((x) => x.getBoundingClientRect().width > 8).style.setProperty('transform', 'translateX(2px)', 'important')",
		},
		pass: false,
	},
	{ id: "chrome.sidebar-tab.hover", name: "unchanged", pass: true },
	{
		id: "chrome.sidebar-tab.hover",
		name: "cyan icon to purple",
		mutate: { css: "[data-capture-target] svg { color: #c586f7 !important; }" },
		pass: false,
	},
	{ id: "modal.toggle.focus-visible", name: "unchanged", pass: true },
	{
		id: "modal.toggle.focus-visible",
		name: "focus ring 1 px",
		mutate: { css: "[data-capture-target] { outline-width: 1px !important; }" },
		pass: false,
	},
	{
		id: "modal.toggle.focus-visible",
		name: "focus ring removed",
		mutate: { css: "[data-capture-target] { outline: none !important; }" },
		pass: false,
	},
	{ id: "md.embed-audio.reading", name: "unchanged", pass: true },
	{
		id: "md.embed-audio.reading",
		name: "background around the player changed",
		mutate: { css: "[data-capture-target] { background-color: #c586f7 !important; }" },
		pass: false,
	},
	{ id: "canvas.node-image", name: "unchanged", pass: true },
	{
		id: "canvas.node-image",
		name: "node border color changed",
		mutate: {
			css: "[data-capture-target], [data-capture-target] .canvas-node-container { border-color: #c586f7 !important; }",
		},
		pass: false,
	},
	{ id: "qc.canvas.node-placeholder", name: "unchanged", pass: true },
	{
		id: "qc.canvas.node-placeholder",
		name: "placeholder color changed",
		mutate: {
			css: "[data-capture-target] { background-color: #c586f7 !important; }",
		},
		pass: false,
	},
	{ id: "qc.media.forced-colors", name: "unchanged", pass: true },
	{
		id: "qc.media.forced-colors",
		name: "every svg hidden",
		mutate: { css: "svg { opacity: 0 !important; }" },
		pass: false,
	},
	{
		id: "qc.media.forced-colors",
		name: "icons shifted 2 px",
		mutate: { css: "svg { transform: translateX(2px) !important; }" },
		pass: false,
	},
	{
		id: "qc.media.forced-colors",
		name: "paragraphs italic",
		mutate: { css: ".markdown-rendered p { font-style: italic !important; }" },
		pass: false,
	},
	{
		id: "command.app:open-vault",
		name: "button labels italic",
		mutate: { css: "button { font-style: italic !important; }" },
		pass: false,
	},
	// The graph draws in a canvas inside its frame, with its own saved pixels.
	{ id: "graph.view", name: "unchanged", pass: true },
	{
		id: "graph.view",
		name: "frame canvas cleared",
		mutate: { js: `${CLEAR_FRAME_CANVASES}` },
		pass: false,
	},
	// QC round 7: recolors where raster differences are allowed, forced colors, graph colors.
	{ id: "qc.gap.canvas-readonly", name: "unchanged", pass: true },
	{
		id: "qc.gap.canvas-readonly",
		name: "scaled card border #555555",
		mutate: { css: ".canvas-node-container { border-color: #555555 !important; }" },
		pass: false,
	},
	{ id: "mobile.tablet.settings", name: "unchanged", pass: true },
	{
		id: "mobile.tablet.settings",
		name: "search icon (image mask) purple",
		mutate: { css: ".search-input-container::before { background-color: #c586f7 !important; }" },
		pass: false,
	},
	// A Bases card cover (a vault image as an inline background) is drawn and compared.
	{ id: "qc.gap.bases-cards-cover", name: "unchanged", pass: true },
	{
		id: "qc.gap.bases-cards-cover",
		name: "cover image hue-rotated",
		mutate: { css: ".bases-cards-cover { filter: hue-rotate(90deg) !important; }" },
		pass: false,
	},
	// QC round 8: the icon darkened without a color change.
	{
		id: "mobile.tablet.settings",
		name: "search icon (image mask) at half opacity",
		mutate: { css: ".search-input-container::before { opacity: 0.5 !important; }" },
		pass: false,
	},
	{
		id: "mobile.tablet.settings",
		name: "search icon (image mask) at half brightness",
		mutate: { css: ".search-input-container::before { filter: brightness(0.5) !important; }" },
		pass: false,
	},
	{
		id: "qc.media.forced-colors",
		name: "table borders red (forced-color-adjust none)",
		mutate: {
			css: ".markdown-rendered th, .markdown-rendered td { forced-color-adjust: none !important; border-color: red !important; color: CanvasText !important; background-color: Canvas !important; }",
		},
		pass: false,
	},
	{
		id: "qc.graph.all-node-kinds",
		name: "graph node colors lime",
		mutate: {
			css: "body { --graph-node: lime !important; --graph-node-tag: lime !important; --graph-node-attachment: lime !important; --graph-node-unresolved: lime !important; }",
		},
		pass: false,
	},
	{ id: "qc.graph.all-node-kinds", name: "unchanged", pass: true },
	{
		id: "qc.graph.all-node-kinds",
		name: "saved graph pixels blanked",
		mutate: {
			js: `for (const c of document.querySelectorAll('canvas')) c.getContext('2d')?.clearRect(0, 0, c.width, c.height); ${CLEAR_FRAME_CANVASES}`,
		},
		pass: false,
	},
];

const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
const env = await makeEnv(browser);
let failed = 0;
if (ids.length) {
	for (const id of ids) {
		const f = byId.get(id);
		if (!f) {
			console.log(`?    ${id}: no such fixture`);
			continue;
		}
		const r = await checkFixture(env, f);
		console.log(
			`${r.status.padEnd(5)} ${id}: share ${r.share?.toFixed(3)} blocks ${r.blocks} detail ${r.detailBad}${r.why ? ` — ${r.why}` : ""}`,
		);
	}
} else {
	for (const c of CASES) {
		const f = byId.get(c.id);
		if (!f) {
			failed++;
			console.log(`FAIL ${c.id} (${c.name}): no such fixture`);
			continue;
		}
		const r = await checkFixture(env, f, c.mutate);
		const ok = (r.status === "ok") === c.pass && r.status !== "limit";
		if (!ok) failed++;
		console.log(
			`${ok ? "ok  " : "FAIL"} ${c.id} (${c.name}): ${r.status}, share ${r.share?.toFixed(3)}, ${r.blocks} blocks, ${r.detailBad} with lost detail${r.why ? ` — ${r.why.slice(0, 120)}` : ""}`,
		);
	}
}
await env.close();
await browser.close();
if (failed) {
	console.error(`${failed} replay self-test case(s) failed`);
	process.exit(1);
}
