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
	{ id: "qc.graph.all-node-kinds", name: "unchanged", pass: true },
	{
		id: "qc.graph.all-node-kinds",
		name: "saved graph pixels blanked",
		mutate: {
			js: "for (const c of document.querySelectorAll('canvas')) c.getContext('2d')?.clearRect(0, 0, c.width, c.height)",
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
