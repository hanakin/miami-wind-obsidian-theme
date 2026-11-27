import { existsSync } from "node:fs";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BROWSER_OPTIONS } from "./browser";
import { styleDiff } from "./model";
import { render } from "./render";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch(BROWSER_OPTIONS);
});
afterAll(async () => {
	await browser.close();
});
test("replays hover, compares pseudo elements and catches changed theme pixels", async () => {
	const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	const html =
		'<body><button data-capture-target data-capture-pseudo data-capture-state="hover">Test</button></body>';
	const f = { component: "button", surface: "test", state: "hover" };
	const base = {
		cm: "",
		app: 'button:hover { color: rgb(255, 0, 0); } button::before {content:"hi"}',
		theme: "",
	};
	const a = await render(page, cdp, html, base, f);
	const repeat = await render(page, cdp, html, base, f);
	expect(styleDiff(a.styles, repeat.styles)).toEqual([]);
	expect(a.png.equals(repeat.png)).toBe(true);
	expect(a.samples[0]?.props.color).toBe("rgb(255, 0, 0)");
	const b = await render(
		page,
		cdp,
		html,
		{
			...base,
			theme: "button:hover {color:blue} button::before {color:green}",
		},
		f,
	);
	expect(
		styleDiff(a.styles, b.styles).some(
			(d) => d.element.endsWith("::before") && d.property === "color",
		),
	).toBe(true);
	expect(a.png.equals(b.png)).toBe(false);
	await page.close();
});

const hasAppCss = existsSync("capture/.app/app.css");
if (!hasAppCss)
	console.warn(
		"SKIPPED: app-CSS render tests require capture/.app/app.css; run bun run capture:extract-app-css to enable them.",
	);

test
	.skipIf(!hasAppCss)
	.each([
		"command.workspace:export-pdf",
		"extra.community.plugin-browser",
		"qc.canvas.selection-box",
		"md.embed-video.live",
		"command.app:open-vault",
		"command.bases:add-view",
		"settings.webviewer",
		"extra.textarea.focus",
		"chrome.window",
		"qc.window.fullscreen.macos",
		"view.empty.action.hover",
	])(
	"keeps %s pixels stable across identical replays",
	async (fixtureId) => {
		const { readFile } = await import("node:fs/promises");
		const page = await browser.newPage({
			viewport: { width: 1600, height: 1000 },
		});
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("DOM.enable");
		await cdp.send("CSS.enable");
		const registry = JSON.parse(
			await readFile("capture/fixtures.json", "utf8"),
		) as { fixtures: import("../../capture/scripts/types").FixtureEntry[] };
		const f = registry.fixtures.find((f) => f.id === fixtureId);
		if (!f) throw new Error(`Missing test fixture ${fixtureId}`);
		const html = await readFile(`capture/fixtures/${f.file}`, "utf8");
		const app = await readFile("capture/.app/app.css", "utf8");
		const theme = await readFile("theme.css", "utf8");
		const first = await render(page, cdp, html, { cm: "", app, theme }, f);
		for (let i = 0; i < 5; i++) {
			const repeat = await render(
				page,
				cdp,
				html,
				{ cm: "", app, theme: `${theme}\n/* sanity ${i} */` },
				f,
			);
			expect(repeat.png.equals(first.png)).toBe(true);
		}
		await page.close();
	},
	60000,
);

test("renders a background worker tab without waiting for its paused animation frames", async () => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	await render(
		page,
		cdp,
		"<button>Test</button>",
		{ cm: "", app: "", theme: "" },
		{ component: "button", surface: "test", state: "default" },
	);
	await context.close();
}, 3000);

test("hides the focused caret only in screenshots and still compares theme caret colors", async () => {
	const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	const html =
		'<textarea data-capture-target data-capture-pseudo data-capture-state="focus-visible" autofocus>Text caret</textarea>';
	const f = { component: "textarea", surface: "test", state: "focus-visible" };
	const red = { cm: "", app: "", theme: "textarea {caret-color:red}" };
	await render(page, cdp, html, red, f);
	await page.locator("textarea").focus();
	const a = await render(page, cdp, html, red, f);
	expect(
		await page
			.locator("textarea")
			.evaluate((el) => getComputedStyle(el).caretColor),
	).toBe("rgba(0, 0, 0, 0)");
	const b = await render(
		page,
		cdp,
		html,
		{ ...red, theme: "textarea {caret-color:blue}" },
		f,
	);
	expect(
		styleDiff(a.styles, b.styles).some(
			(d) =>
				d.property === "caret-color" &&
				d.before === "rgb(255, 0, 0)" &&
				d.after === "rgb(0, 0, 255)",
		),
	).toBe(true);
	expect(a.png.equals(b.png)).toBe(true);
	await page.close();
});

test("captures four background worker pages concurrently with complete frame surfaces", async () => {
	const context = await browser.newContext({
		viewport: { width: 400, height: 200 },
	});
	await context.route("**/*", (r) => r.abort());
	const pages = await Promise.all(
		Array.from({ length: 4 }, () => context.newPage()),
	);
	await Promise.all(
		pages.map(async (page) => {
			const cdp = await context.newCDPSession(page);
			await cdp.send("DOM.enable");
			await cdp.send("CSS.enable");
			const html =
				'<div data-capture-target style="border:1px solid cyan;border-radius:7px;width:100px;height:50px">Card</div>';
			const f = { component: "card", surface: "test", state: "default" };
			const a = await render(
				page,
				cdp,
				html,
				{ cm: "", app: "", theme: "" },
				f,
			);
			const b = await render(
				page,
				cdp,
				html,
				{ cm: "", app: "", theme: "/* same */" },
				f,
			);
			const { PNG } = await import("pngjs");
			const shot = PNG.sync.read(a.png);
			expect({ width: shot.width, height: shot.height }).toEqual({
				width: 400,
				height: 200,
			});
			expect(a.png.equals(b.png)).toBe(true);
		}),
	);
	await context.close();
}, 15000);
