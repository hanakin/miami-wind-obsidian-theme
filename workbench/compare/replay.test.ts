import { existsSync, readFileSync } from "node:fs";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FixtureEntry } from "../../capture/scripts/types";
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
async function setup() {
	const page = await browser.newPage();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	return { page, cdp };
}
const base = {
	id: "test",
	component: "button",
	surface: "test",
	state: "default",
	runtimeStyles: ["theme", "app"],
	viewport: [300, 200] as [number, number],
};
test("uses recorded stylesheet order, viewport, quirks and field selection through capture replay", async () => {
	const { page, cdp } = await setup();
	await render(
		page,
		cdp,
		'<body><button data-capture-target>Button</button><input value="captured" data-capture-input-selection="1 4 forward"></body>',
		{ app: "button{color:blue}", cm: "", theme: "button{color:red}" },
		{ ...base, quirks: true } as FixtureEntry,
	);
	expect(
		await page.evaluate(() => ({
			mode: document.compatMode,
			width: innerWidth,
			height: innerHeight,
			color: getComputedStyle(document.querySelector("button")!).color,
			selection: [
				document.querySelector("input")!.selectionStart,
				document.querySelector("input")!.selectionEnd,
			],
		})),
	).toEqual({
		mode: "BackCompat",
		width: 300,
		height: 200,
		color: "rgb(0, 0, 255)",
		selection: [1, 4],
	});
	await page.close();
});
test("compares computed styles inside restored frames, including nonvisual declarations", async () => {
	const { page, cdp } = await setup();
	const html =
		'<div data-capture-target><iframe data-capture-frame-styles="theme" srcdoc="&lt;html&gt;&lt;head&gt;&lt;/head&gt;&lt;body&gt;&lt;button&gt;Frame&lt;/button&gt;&lt;/body&gt;&lt;/html&gt;"></iframe></div>';
	const a = await render(
		page,
		cdp,
		html,
		{ app: "", cm: "", theme: "button{transition:color 1s}" },
		base,
	);
	const b = await render(
		page,
		cdp,
		html,
		{ app: "", cm: "", theme: "button{transition:color 2s}" },
		base,
	);
	expect(a.unsupported).not.toContain("iframe");
	expect(
		styleDiff(a.styles, b.styles).some(
			(d) =>
				d.element.startsWith("frame:") && d.property === "transition-duration",
		),
	).toBe(true);
	await page.close();
});
test
	.skipIf(!existsSync("capture/.app/runtime"))
	.each([
		"md.code-html.source",
		"graph.view",
		"qc.selection.layer",
		"command.app:open-vault",
		"qc.print.export-window",
	])(
	"replays formerly unproven %s using recorded capture data",
	async (id) => {
		const { page, cdp } = await setup();
		const registry = JSON.parse(
			readFileSync("capture/fixtures.json", "utf8"),
		) as { fixtures: FixtureEntry[] };
		const f = registry.fixtures.find((f) => f.id === id)!;
		const r = await render(
			page,
			cdp,
			readFileSync(`capture/fixtures/${f.file}`, "utf8"),
			{
				app: readFileSync("capture/.app/app.css", "utf8"),
				cm: "",
				theme: readFileSync("theme.css", "utf8"),
			},
			f,
		);
		expect(r.invisibleTarget).toBe(false);
		expect(r.replayIssues).toEqual([]);
		if (id === "graph.view") {
			expect(await page.locator("canvas[data-replay-pixels]").count()).toBe(1);
			// The fixture also contains an iframe canvas without captured pixels.
			expect(r.unsupported).toEqual(["canvas"]);
		} else expect(r.unsupported).not.toContain("canvas");
		expect(r.unsupported).not.toContain("iframe");
		if (id === "qc.selection.layer")
			expect(
				await page.evaluate(() => getSelection()?.toString().length),
			).toBeGreaterThan(0);
		await page.close();
	},
	30000,
);
