import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { styleDiff } from "./model";
import { render } from "./render";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
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
