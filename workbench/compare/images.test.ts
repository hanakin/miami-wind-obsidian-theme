import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BROWSER_OPTIONS } from "./browser";
import { outcome, styleDiff } from "./model";
import { render } from "./render";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch(BROWSER_OPTIONS);
});
afterAll(async () => {
	await browser.close();
});
async function setup() {
	const page = await browser.newPage({ viewport: { width: 500, height: 300 } });
	await page.route("**/*", (r) => r.abort());
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	return { page, cdp };
}
const css = { cm: "", app: "", theme: "" };
const fixture = { component: "image", surface: "test", state: "default" };
test("CodeMirror spacers and source-less images do not create unsupported coverage", async () => {
	const { page, cdp } = await setup();
	const r = await render(
		page,
		cdp,
		'<div data-capture-target>Text<img class="cm-widgetBuffer" aria-hidden="true" src="app://spacer"><img><img src=""></div>',
		css,
		fixture,
	);
	expect(r.unsupported).toEqual([]);
	expect(
		outcome({
			differences: 0,
			pixels: 0,
			noise: false,
			invisible: r.invisibleTarget,
			unsupported: r.unsupported,
			replayIssues: r.replayIssues,
		}).status,
	).toBe("same");
	await page.close();
});
test("loaded data images are rebuilt while missing images stay unsupported", async () => {
	const { page, cdp } = await setup();
	const src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="white"/></svg>')}`;
	const loaded = await render(
		page,
		cdp,
		`<img data-capture-target src="${src}">`,
		css,
		fixture,
	);
	expect(loaded.unsupported).toEqual([]);
	expect(
		await page.locator("img").evaluate((img: HTMLImageElement) => ({
			complete: img.complete,
			width: img.naturalWidth,
		})),
	).toEqual({ complete: true, width: 24 });
	const missing = await render(
		page,
		cdp,
		'<img data-capture-target src="app://missing.png">',
		css,
		fixture,
	);
	expect(missing.unsupported).toEqual(["img"]);
	await page.close();
});
test("source-less empty iframes are rebuilt, but sourced and srcdoc frames are not", async () => {
	const { page, cdp } = await setup();
	const r = await render(
		page,
		cdp,
		'<div data-capture-target><iframe></iframe><iframe src=""></iframe><iframe class="embed-iframe is-controlled"></iframe><iframe src="about:blank"></iframe><iframe srcdoc=""></iframe></div>',
		css,
		fixture,
	);
	expect(r.unsupported).toEqual(["iframe", "iframe", "iframe"]);
	await page.close();
});
test("recorded intrinsic image dimensions preserve layout and permit theme size comparisons", async () => {
	const { page, cdp } = await setup();
	const f = { ...fixture, imageSizes: [{ index: 1, width: 120, height: 80 }] };
	const html =
		'<div data-capture-target><img class="cm-widgetBuffer" aria-hidden="true"><img class="asset" src="app://missing.png"></div>';
	const a = await render(page, cdp, html, css, f);
	expect(a.unsupported).toEqual([]);
	expect(
		await page.locator("img.asset").evaluate((img: HTMLImageElement) => ({
			width: img.naturalWidth,
			height: img.naturalHeight,
			rendered: img.getBoundingClientRect().width,
		})),
	).toEqual({ width: 120, height: 80, rendered: 120 });
	const b = await render(
		page,
		cdp,
		html,
		{ ...css, theme: "img.asset {width:60px}" },
		f,
	);
	expect(
		styleDiff(a.styles, b.styles).some(
			(d) =>
				d.property === "width" && d.before === "120px" && d.after === "60px",
		),
	).toBe(true);
	const reload = await render(page, cdp, html, css, {
		...fixture,
		imageSizes: [{ index: 1, width: 90, height: 60 }],
	});
	expect(reload.unsupported).toEqual([]);
	expect(
		await page
			.locator("img.asset")
			.evaluate((img: HTMLImageElement) => img.naturalWidth),
	).toBe(90);
	await page.close();
});
