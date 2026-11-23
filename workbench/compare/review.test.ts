import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { componentDiffs, styleDiff } from "./model";
import { render } from "./render";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu"],
		ignoreDefaultArgs: ["--hide-scrollbars"],
	});
});
afterAll(async () => {
	await browser.close();
});
const cases = [
	{
		name: "selection",
		html: '<p data-capture-target data-capture-state="selection">Select this text</p>',
		state: "selection",
		css: "::selection {background-color:red}",
		pseudo: "::selection",
		property: "background-color",
	},
	{
		name: "scrollbar thumb",
		html: '<div data-capture-target style="width:100px;height:100px;overflow:scroll"><div style="height:400px">Scroll</div></div>',
		state: "scrollbar-hover",
		css: "::-webkit-scrollbar-thumb:hover {background-color:red}",
		pseudo: "::-webkit-scrollbar-thumb",
		property: "background-color",
	},
	{
		name: "parent hover",
		html: '<div class="parent"><button data-capture-target data-capture-pseudo data-capture-state="hover">Hover</button></div>',
		state: "hover",
		css: ".parent:hover button {color:red}",
		pseudo: "",
		property: "color",
	},
	{
		name: "focus-visible implies focus",
		html: '<input data-capture-target data-capture-pseudo data-capture-state="focus-visible">',
		state: "focus-visible",
		css: "input:focus {color:red} body:focus-within {background-color:red}",
		pseudo: "",
		property: "color",
	},
	{
		name: "graph runtime color",
		html: '<div data-capture-target class="graph-view"></div>',
		state: "default",
		css: "body {--graph-node:red}",
		pseudo: "probe:--graph-node",
		property: "color",
	},
	{
		name: "transition declarations",
		html: "<button data-capture-target>Tab</button>",
		state: "default",
		css: "button {transition:color 2s}",
		pseudo: "",
		property: "transition-duration",
	},
];
for (const c of cases)
	test(`catches ${c.name} changes`, async () => {
		const page = await browser.newPage({
			viewport: { width: 400, height: 250 },
		});
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("DOM.enable");
		await cdp.send("CSS.enable");
		const f = { component: "test", surface: "test", state: c.state };
		const a = await render(
			page,
			cdp,
			c.html,
			{ cm: "", app: "", theme: "body{color:black;--graph-node:blue}" },
			f,
		);
		const b = await render(
			page,
			cdp,
			c.html,
			{ cm: "", app: "", theme: `body{color:black;--graph-node:blue}${c.css}` },
			f,
		);
		expect(
			styleDiff(a.styles, b.styles).some(
				(d) => d.element.includes(c.pseudo) && d.property === c.property,
			),
		).toBe(true);
		if (c.state === "selection")
			expect(await page.evaluate(() => getSelection()?.toString())).toBe(
				"Select this text",
			);
		await page.close();
	});
test("comment-only theme swap has zero style and pixel differences", async () => {
	const page = await browser.newPage();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	const html = "<button data-capture-target>Test</button>",
		css = "button{border-radius:5px;background:#333;color:white}",
		f = { component: "button", surface: "test", state: "default" };
	const a = await render(page, cdp, html, { cm: "", app: "", theme: css }, f);
	const b = await render(
		page,
		cdp,
		html,
		{ cm: "", app: "", theme: `${css}\n/* sanity */` },
		f,
	);
	expect(styleDiff(a.styles, b.styles)).toEqual([]);
	expect(a.png.equals(b.png)).toBe(true);
	await page.close();
});
test("component shared look ignores container-driven dimensions", () => {
	expect(
		componentDiffs([
			{
				component: "button",
				surface: "a",
				state: "default",
				props: { color: "red", width: "20px", "transform-origin": "10px 5px" },
			},
			{
				component: "button",
				surface: "b",
				state: "default",
				props: { color: "red", width: "40px", "transform-origin": "20px 5px" },
			},
		]),
	).toEqual({
		button: { a: { same: true, props: [] }, b: { same: true, props: [] } },
	});
});

test("unsupported or hidden replay cannot claim same, while genuine style changes stay different", async () => {
	const { outcome } = await import("./model");
	expect(
		outcome({
			differences: 0,
			pixels: 0,
			noise: false,
			invisible: true,
			unsupported: [],
			replayIssues: [],
		}),
	).toMatchObject({ status: "not-proven", same: false });
	expect(
		outcome({
			differences: 0,
			pixels: 0,
			noise: false,
			invisible: false,
			unsupported: ["canvas"],
			replayIssues: [],
		}),
	).toMatchObject({ status: "not-proven", same: false });
	expect(
		outcome({
			differences: 0,
			pixels: 5,
			noise: true,
			invisible: false,
			unsupported: [],
			replayIssues: [],
		}),
	).toMatchObject({ status: "not-proven", same: false });
	expect(
		outcome({
			differences: 1,
			pixels: 0,
			noise: false,
			invisible: true,
			unsupported: [],
			replayIssues: [],
		}),
	).toMatchObject({ status: "different", same: false });
});

test("failed setup removes stale reports", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } =
		await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join, resolve } = await import("node:path");
	const { spawnSync } = await import("node:child_process");
	const cwd = mkdtempSync(join(tmpdir(), "compare-failure-"));
	try {
		mkdirSync(join(cwd, "workbench/out"), { recursive: true });
		mkdirSync(join(cwd, "capture"));
		for (const name of ["compare.json", "compare.md", "component-diffs.json"])
			writeFileSync(join(cwd, "workbench/out", name), "stale");
		writeFileSync(
			join(cwd, "capture/fixtures.json"),
			JSON.stringify({
				fixtures: [
					{ id: "test", component: "test", surface: "test", contains: [] },
				],
			}),
		);
		const result = spawnSync(
			"bun",
			[
				resolve("workbench/compare/cli.ts"),
				"--after",
				"missing.css",
				"--before",
				"missing.css",
			],
			{ cwd, encoding: "utf8" },
		);
		expect(result.status).not.toBe(0);
		for (const name of ["compare.json", "compare.md", "component-diffs.json"])
			expect(existsSync(join(cwd, "workbench/out", name))).toBe(false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
