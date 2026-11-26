import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { acceptanceScope, acceptedOutcome } from "./accepted";
import { BROWSER_OPTIONS } from "./browser";
import { componentDiffs, outcome, styleDiff } from "./model";
import { repeatedPixels } from "./pixels";
import { render } from "./render";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch(BROWSER_OPTIONS);
});
afterAll(async () => {
	await browser.close();
});
async function setup() {
	const page = await browser.newPage();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	return { page, cdp };
}
const changed = (differences: number) =>
	outcome({
		differences,
		pixels: 0,
		noise: false,
		invisible: false,
		unsupported: [],
		replayIssues: [],
	});
const fixture = { component: "test", surface: "test", state: "default" };

test("loads XHTML without HTML parser repairs and injects working styles", async () => {
	const { page, cdp } = await setup();
	const html =
		'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p><div data-capture-target="">Nested block</div></p></body></html>';
	const f = { ...fixture, format: "xhtml" as const };
	const css = { cm: "p > div {color:blue}", app: "", theme: "" };
	const a = await render(page, cdp, html, css, f);
	expect(await page.evaluate(() => document.contentType)).toBe(
		"application/xhtml+xml",
	);
	expect(await page.locator("p > div").count()).toBe(1);
	expect(a.styles.find((s) => s.element.endsWith(":div"))?.props.color).toBe(
		"rgb(0, 0, 255)",
	);
	const repeat = await render(
		page,
		cdp,
		html,
		{ ...css, theme: "/* swap */" },
		f,
	);
	expect(styleDiff(a.styles, repeat.styles)).toEqual([]);
	expect(a.png.equals(repeat.png)).toBe(true);
	const b = await render(
		page,
		cdp,
		html,
		{ ...css, theme: "p > div {color:red}" },
		f,
	);
	expect(
		styleDiff(a.styles, b.styles).some((d) => d.property === "color"),
	).toBe(true);
	await render(page, cdp, "<p><div>HTML</div></p>", css, fixture);
	expect(await page.evaluate(() => document.contentType)).toBe("text/html");
	expect(await page.locator("p > div").count()).toBe(0);
	await page.close();
});

test("rejects malformed XHTML rather than proving a parser error page", async () => {
	const { page, cdp } = await setup();
	await expect(
		render(
			page,
			cdp,
			'<html xmlns="http://www.w3.org/1999/xhtml"><body><p></body></html>',
			{ cm: "", app: "", theme: "" },
			{ ...fixture, format: "xhtml" as const },
		),
	).rejects.toThrow(/XHTML/);
	await page.close();
});

test("capture stand-ins never contribute styles, pseudos, samples, pixels or missing content", async () => {
	const { page, cdp } = await setup();
	const html =
		'<body><button data-capture-target>Real</button><div class="stub tooltip" data-capture-placeholder data-capture-pseudo data-capture-state="hover"><canvas></canvas><iframe src="missing"></iframe><img src="missing"><span>Stand-in child</span></div></body>';
	const a = await render(
		page,
		cdp,
		html,
		{ cm: "", app: "", theme: "" },
		fixture,
	);
	expect(
		a.styles.some(
			(s) =>
				!s.element.startsWith("probe:") &&
				/stub|canvas|iframe|img|span/.test(s.element),
		),
	).toBe(false);
	expect(a.samples.some((s) => s.component === "tooltip")).toBe(false);
	expect(a.unsupported).toEqual([]);
	expect(
		await page.locator(".stub").getAttribute("data-compare-force"),
	).toBeNull();
	const b = await render(
		page,
		cdp,
		html,
		{
			cm: "",
			app: "",
			theme:
				"body .stub {display:block!important;color:red;background:red;width:500px;height:500px}",
		},
		fixture,
	);
	expect(styleDiff(a.styles, b.styles)).toEqual([]);
	expect(a.png.equals(b.png)).toBe(true);
	const c = await render(
		page,
		cdp,
		html.replace(/<div class="stub[\s\S]*<\/div>/, ""),
		{ cm: "", app: "", theme: "" },
		fixture,
	);
	expect(styleDiff(a.styles, c.styles)).toEqual([]);
	await page.close();
});

test("CodeMirror tooltip contributes to the shared tooltip component", async () => {
	const { page, cdp } = await setup();
	const css = { cm: "", app: "", theme: ".tooltip,.cm-tooltip {color:red}" };
	const a = await render(
		page,
		cdp,
		'<div class="tooltip" data-capture-target>Tip</div>',
		css,
		fixture,
	);
	const b = await render(
		page,
		cdp,
		'<div class="cm-tooltip" data-capture-target>Tip</div>',
		css,
		{ ...fixture, surface: "editor" },
	);
	expect(componentDiffs([...a.samples, ...b.samples]).tooltip).toEqual({
		test: { same: true, props: [] },
		editor: { same: true, props: [] },
	});
	await page.close();
});

test("attributes the inline PDF select decision without accepting a sibling popup", async () => {
	const { page, cdp } = await setup();
	const html = `<body><div class="annotationLayer"><div class="choiceWidgetAnnotation">
		<select style="color:rgb(0,0,0);background-color:transparent" data-capture-target><option>PDF</option></select>
		<select style="color:rgb(0,0,0);background-color:magenta"></select>
		<div style="color:rgb(0,0,0);background-color:transparent"></div>
	</div><div class="popup">Annotation popup</div></div>
	<select style="color:rgb(0,0,0);background-color:transparent"></select></body>`;
	const css = {
		cm: "",
		app: "option {color:black;background:white}",
		theme:
			"select[data-capture-target] {color:magenta!important;background:magenta!important}",
	};
	const a = await render(page, cdp, html, css, fixture);
	const b = await render(page, cdp, html, { ...css, theme: "" }, fixture);
	expect(a.acceptanceMatches).toHaveLength(1);
	expect(a.acceptanceMatches[0]?.element).toMatch(/:select$/);
	const scope = acceptanceScope([
		a.acceptanceMatches,
		a.acceptanceMatches,
		b.acceptanceMatches,
		b.acceptanceMatches,
	]);
	const differences = styleDiff(a.styles, b.styles);
	const pixel = repeatedPixels([a.png, a.png], [b.png, b.png], scope.rects);
	expect(pixel.count).toBeGreaterThan(0);
	expect(pixel.outsideAcceptance).toBe(0);
	expect(differences.length).toBeGreaterThan(0);
	expect(
		acceptedOutcome(changed(differences.length), {
			scope,
			differences,
			outsidePixels: pixel.outsideAcceptance,
			noise: false,
		}).status,
	).toBe("accepted");
	const sibling = await render(
		page,
		cdp,
		html,
		{ ...css, theme: ".popup {color:cyan}" },
		fixture,
	);
	const siblingDifferences = styleDiff(b.styles, sibling.styles);
	expect(siblingDifferences.some((d) => d.element.includes(".popup"))).toBe(
		true,
	);
	expect(
		acceptedOutcome(changed(differences.length + siblingDifferences.length), {
			scope,
			differences: [...differences, ...siblingDifferences],
			outsidePixels: 0,
			noise: false,
		}).status,
	).toBe("different");
	const wrongInline = await render(
		page,
		cdp,
		html.replace(
			'color:rgb(0,0,0);background-color:transparent" data-capture-target',
			'color:red;background-color:transparent" data-capture-target',
		),
		css,
		fixture,
	);
	expect(wrongInline.acceptanceMatches).toEqual([]);
	await page.close();
});
