// Runs the built frame document in a real browser: what the string tests cannot show.
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { frameCsp, frameDocument } from "./frame.ts";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser.close();
});

const attr = (html: string) => html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const PLACEHOLDER = '<div data-capture-placeholder="">stand-in</div><p>shown</p>';

it("hides capture stand-ins in the fixture and in nested srcdoc frames at any depth", async () => {
	const deepest = `<html><head></head><body>${PLACEHOLDER}</body></html>`;
	const middle = `<html><head></head><body>${PLACEHOLDER}<iframe srcdoc="${attr(deepest)}"></iframe></body></html>`;
	const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>${PLACEHOLDER}<iframe sandbox="allow-scripts allow-same-origin" srcdoc="${attr(middle)}"></iframe></body></html>`;
	const page = await browser.newPage();
	await page.setContent(frameDocument(fixture, [], null, "N1"));
	await expect.poll(() => page.frames().length).toBe(3);
	for (const frame of page.frames()) {
		await frame.waitForSelector("p");
		const display = await frame.evaluate(() => [
			getComputedStyle(document.querySelector("[data-capture-placeholder]") as Element).display,
			getComputedStyle(document.querySelector("p") as Element).display,
		]);
		expect(display).toEqual(["none", "block"]);
	}
	await page.close();
});

it("lets captured markup load no image from the server", async () => {
	const origin = "http://127.0.0.1:59999";
	const requested: string[] = [];
	const page = await browser.newPage();
	await page.route("**/*", (route) => {
		const url = route.request().url();
		if (url !== `${origin}/frame`) {
			requested.push(url);
			return route.abort();
		}
		return route.fulfill({
			contentType: "text/html",
			headers: { "Content-Security-Policy": frameCsp(origin, "N1") },
			body: frameDocument(
				'<!doctype html><html><head><meta charset="utf-8"></head><body><img src="/beacon"><img src="https://example.com/x.png"><p>shown</p></body></html>',
				[`${origin}/css/app.css`],
				null,
				"N1",
			),
		});
	});
	await page.goto(`${origin}/frame`);
	await page.waitForSelector("p");
	expect(requested).toEqual([`${origin}/css/app.css`]);
	await page.close();
});
