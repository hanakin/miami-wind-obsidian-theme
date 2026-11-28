// Runs the built frame document in a real browser, under its real policy: what the string tests
// cannot show.
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { frameCsp, frameDocument, replayCall } from "./frame.ts";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser.close();
});

const origin = "http://127.0.0.1:59999";
const attr = (html: string) => html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Serves one fixture through the workbench's frame, and lists every other request it makes. */
async function open(page: Page, fixture: string, css = ""): Promise<string[]> {
	const requested: string[] = [];
	const call = await replayCall({
		html: fixture,
		sizes: [],
		canvases: [],
		frames: {},
		trimSelector: null,
		options: { forceRecordedGeometry: false },
	});
	await page.route("**/*", (route) => {
		const url = route.request().url();
		if (url === `${origin}/frame`) {
			return route.fulfill({
				contentType: "text/html",
				headers: { "Content-Security-Policy": frameCsp(origin, "http://127.0.0.1:59998", "N1") },
				body: frameDocument({
					call,
					stylesheet: `${origin}/css/replay/x.css`,
					focus: null,
					nonce: "N1",
					quirks: false,
				}),
			});
		}
		requested.push(url);
		if (url === `${origin}/css/replay/x.css`)
			return route.fulfill({ contentType: "text/css", body: css });
		return route.abort();
	});
	await page.goto(`${origin}/frame`);
	await page.waitForSelector("[data-capture-target]");
	return requested;
}

it("draws the fixture through the shared replay, and runs no script from the fixture", async () => {
	const page = await browser.newPage();
	const inner =
		'<html><head></head><body><p>inner</p><script>parent.postMessage("evil-inner","*")</script></body></html>';
	const requested = await open(
		page,
		[
			'<!doctype html><html class="theme-dark"><head><meta charset="utf-8">',
			'<style data-capture-runtime="mathjax">.kept { color: rgb(1, 2, 3); }</style></head>',
			'<body class="from-fixture"><div data-capture-target="" class="kept" onclick="window.evil = 1">shown</div>',
			"<script>window.evil = 2</script>",
			'<img src="/beacon"><img src="https://example.com/x.png">',
			`<iframe srcdoc="${attr(inner)}"></iframe>`,
			"</body></html>",
		].join(""),
	);
	// The replay rebuilt the fixture: its body classes, its content, and its own runtime rules.
	expect(await page.evaluate(() => document.body.className)).toBe("from-fixture");
	expect(await page.locator("[data-capture-target]").textContent()).toBe("shown");
	expect(
		await page.evaluate(() => getComputedStyle(document.querySelector(".kept") as Element).color),
	).toBe("rgb(1, 2, 3)");
	// Nothing from the fixture ran, in the page or in its nested frame, and no handler survived.
	await page.locator("[data-capture-target]").click();
	expect(await page.evaluate(() => (window as { evil?: number }).evil)).toBeUndefined();
	expect(await page.locator("script").count()).toBe(1);
	// The replay can reach the frame nested in its own document, where recorded pixels are drawn…
	expect(
		await page.evaluate(() => document.querySelector("iframe")?.contentDocument !== null),
	).toBe(true);
	// …and the fixture's script in that nested frame still never ran.
	const messages = await page.evaluate(
		() =>
			new Promise<number>((done) => {
				let n = 0;
				addEventListener("message", () => n++);
				setTimeout(() => done(n), 300);
			}),
	);
	expect(messages).toBe(0);
	// The only request beyond the document is the workbench's stylesheet.
	expect(requested).toEqual([`${origin}/css/replay/x.css`]);
	await page.close();
});

it("applies the fixture's stylesheet, with capture stand-ins kept out of sight", async () => {
	const page = await browser.newPage();
	await open(
		page,
		'<!doctype html><html><head></head><body><div data-capture-placeholder="">stand-in</div><p data-capture-target="">shown</p></body></html>',
		"[data-capture-placeholder] { visibility: hidden !important } p { color: rgb(9, 9, 9) }",
	);
	const seen = await page.evaluate(() => [
		getComputedStyle(document.querySelector("[data-capture-placeholder]") as Element).visibility,
		getComputedStyle(document.querySelector("p") as Element).color,
	]);
	expect(seen).toEqual(["hidden", "rgb(9, 9, 9)"]);
	await page.close();
});
