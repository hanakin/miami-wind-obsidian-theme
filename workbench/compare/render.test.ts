import { existsSync } from "node:fs";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { styleDiff } from "./model";
import { render } from "./render";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu", "--num-raster-threads=1"],
		ignoreDefaultArgs: ["--hide-scrollbars"],
	});
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
		"extra.canvas.after-select",
		"md.embed-video.live",
		"command.app:open-vault",
		"command.bases:add-view",
		"settings.webviewer",
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
		let html = await readFile(`capture/fixtures/${fixtureId}.html`, "utf8");
		if (fixtureId.includes("plugin-browser")) {
			await page.setContent(html);
			await page
				.locator(".community-item")
				.evaluateAll((els) => els.slice(31).forEach((el) => el.remove()));
			html = await page.content();
		}
		const app = await readFile("capture/.app/app.css", "utf8");
		const theme = await readFile("theme.css", "utf8");
		const f = { component: "modal", surface: "test", state: "default" };
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
