import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FixtureEntry } from "../../capture/scripts/types";
import { BROWSER_OPTIONS } from "./browser";
import { outcome, styleDiff } from "./model";
import { render } from "./render";
import { JS_READ_PROPERTIES } from "./variables";

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
test("retains coverage limits for visible webview and remote background interiors", async () => {
	const { page, cdp } = await setup();
	const result = await render(
		page,
		cdp,
		'<div data-capture-target><webview data-capture-size="100 40" src="https://obsidian.md/"></webview><div style="width:100px;height:40px;background-image:url(https://obsidian.md/missing.png)"></div></div>',
		{ app: "", cm: "", theme: "" },
		base,
	);
	expect(result.unsupported).toEqual(["webview", "background image"]);
	expect(
		outcome({
			differences: 0,
			pixels: 0,
			noise: false,
			invisible: false,
			unsupported: result.unsupported,
			replayIssues: [],
		}).notProvenReasons,
	).toEqual([
		"webview content is not reconstructed",
		"background image content is not reconstructed",
	]);
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
		}
		expect(r.unsupported).not.toContain("canvas");
		expect(r.unsupported).not.toContain("iframe");
		if (id === "qc.selection.layer")
			expect(
				await page.evaluate(() => getSelection()?.toString().length),
			).toBeGreaterThan(0);
		await page.close();
	},
	30000,
);

test
	.skipIf(!existsSync("capture/.app/runtime"))
	.each(["qc.pdf.annotations", "qc.pdf.annotation-popup"])(
	"keeps %s used margins stable and still catches a margin change",
	async (id) => {
		const page = await browser.newPage({
			viewport: { width: 1600, height: 1000 },
		});
		const cdp = await page.context().newCDPSession(page);
		const registry = JSON.parse(
			readFileSync("capture/fixtures.json", "utf8"),
		) as { fixtures: FixtureEntry[] };
		const f = registry.fixtures.find((f) => f.id === id)!;
		const html = readFileSync(`capture/fixtures/${f.file}`, "utf8");
		const theme = execFileSync("git", ["show", "b478dc8:theme.css"], {
			encoding: "utf8",
		});
		const css = {
			app: readFileSync("capture/.app/app.css", "utf8"),
			cm: "",
			theme,
		};
		const a = await render(page, cdp, html, css, f);
		const repeat = await render(
			page,
			cdp,
			html,
			{ ...css, theme: theme + "\n/* same */" },
			f,
		);
		expect(styleDiff(a.styles, repeat.styles)).toEqual([]);
		expect(a.png.equals(repeat.png)).toBe(true);
		const changed = await render(
			page,
			cdp,
			html,
			{ ...css, theme: theme + "\n.pdfViewer .page {margin-left:13px}" },
			f,
		);
		expect(
			styleDiff(a.styles, changed.styles).some(
				(d) => d.property === "margin-left" && d.after === "13px",
			),
		).toBe(true);
		await page.close();
	},
	30000,
);

test.skipIf(!existsSync("capture/.app/runtime")).each([
	[
		"extra.property-value-suggest-item.hover",
		".suggestion-container {width:420px}",
		"width",
		"420px",
	],
	["command.bases:add-view", ".menu {width:300px}", "width", "300px"],
	[
		"md.callout-abstract.reading",
		".callout[data-callout=abstract] {--callout-icon:lucide-flame}",
		"--callout-icon",
		"lucide-flame",
	],
	[
		"qc.pdf.themed",
		".pdf-container {--pdf-page-background:red}",
		"--pdf-page-background",
		"red",
	],
])(
	"QC regression: %s exposes %s",
	async (id, mutation, property, value) => {
		const { page, cdp } = await setup();
		const f = (
			JSON.parse(readFileSync("capture/fixtures.json", "utf8")) as {
				fixtures: FixtureEntry[];
			}
		).fixtures.find((f) => f.id === id)!;
		const html = readFileSync(`capture/fixtures/${f.file}`, "utf8");
		const css = {
			app: readFileSync("capture/.app/app.css", "utf8"),
			cm: "",
			theme: execFileSync("git", ["show", "b478dc8:theme.css"], {
				encoding: "utf8",
			}),
		};
		const a = await render(page, cdp, html, css, f);
		if (id === "md.callout-abstract.reading") {
			const noOp = await render(
				page,
				cdp,
				html,
				{
					...css,
					theme: css.theme + "\n.callout{--callout-icon:lucide-flame}",
				},
				f,
			);
			expect(styleDiff(a.styles, noOp.styles)).toEqual([]);
		}
		const b = await render(
			page,
			cdp,
			html,
			{ ...css, theme: css.theme + "\n" + mutation },
			f,
		);
		expect(
			styleDiff(a.styles, b.styles).some(
				(d) => d.property === property && d.after?.trim() === value,
			),
		).toBe(true);
		await page.close();
	},
	30000,
);

test("QC regression: resolves PDF page color in its app-created themed container", async () => {
	const { page, cdp } = await setup();
	const css = {
		app: "",
		cm: "",
		theme: ".pdf-container{--pdf-page-background:blue}",
	};
	const a = await render(
		page,
		cdp,
		"<button data-capture-target>Test</button>",
		css,
		base,
	);
	const b = await render(
		page,
		cdp,
		"<button data-capture-target>Test</button>",
		{ ...css, theme: ".pdf-container{--pdf-page-background:red}" },
		base,
	);
	expect(
		styleDiff(a.styles, b.styles).some(
			(d) =>
				d.element === "probe:pdf-container.mod-themed" &&
				d.property === "color" &&
				d.after === "rgb(255, 0, 0)",
		),
	).toBe(true);
	await page.close();
});

test("compares every audited JavaScript-read custom property on each element", async () => {
	const { page, cdp } = await setup();
	const theme = (value: string) =>
		`body {${JS_READ_PROPERTIES.map((p) => `${p}:${value}`).join(";")}}`;
	const a = await render(
		page,
		cdp,
		"<button data-capture-target>Test</button>",
		{ app: "", cm: "", theme: theme("before") },
		base,
	);
	const b = await render(
		page,
		cdp,
		"<button data-capture-target>Test</button>",
		{ app: "", cm: "", theme: theme("after") },
		base,
	);
	const button = b.styles.find((s) => s.element.endsWith(":button"))!;
	for (const name of JS_READ_PROPERTIES)
		expect(button.props[name]).toBe("after");
	expect(
		new Set(
			styleDiff(a.styles, b.styles)
				.filter(
					(d) => d.element.endsWith(":button") && d.property.startsWith("--"),
				)
				.map((d) => d.property),
		),
	).toEqual(new Set(JS_READ_PROPERTIES));
	await page.close();
});

test("restored frames keep theme sizing even when their capture records a size", async () => {
	const { page, cdp } = await setup();
	const html =
		'<div data-capture-target><iframe data-capture-size="100 50" data-capture-frame-styles="" srcdoc="&lt;body&gt;Frame&lt;/body&gt;"></iframe></div>';
	const a = await render(
		page,
		cdp,
		html,
		{ app: "", cm: "", theme: "iframe{width:100px;height:50px}" },
		base,
	);
	const b = await render(
		page,
		cdp,
		html,
		{ app: "", cm: "", theme: "iframe{width:200px;height:50px}" },
		base,
	);
	expect(
		styleDiff(a.styles, b.styles).some(
			(d) =>
				d.element.endsWith(":iframe") &&
				d.property === "width" &&
				d.after === "200px",
		),
	).toBe(true);
	await page.close();
});

test("does not prove a drag ghost with a frozen JavaScript variable map", async () => {
	const { page, cdp } = await setup();
	const html =
		'<div data-capture-target class="drag-reorder-ghost"><div class="mod-dragged-item" style="--paint:blue;background:var(--paint);width:30px;height:30px"></div></div>';
	const r = await render(
		page,
		cdp,
		html,
		{ app: "", cm: "", theme: ".source{--paint:red}" },
		base,
	);
	expect(
		outcome({
			differences: 0,
			pixels: 0,
			noise: false,
			invisible: r.invisibleTarget,
			unsupported: r.unsupported,
			replayIssues: r.replayIssues,
		}).status,
	).toBe("not-proven");
	expect(r.replayIssues).toContain(
		"drag ghost JavaScript variable copy is not reconstructed",
	);
	await page.close();
});

test("does not force a recorded scrollbar over the theme's overflow", async () => {
	const { page, cdp } = await setup();
	const html =
		'<div data-capture-target class="scroll-box" data-capture-scrollbar="y" style="width:100px;height:40px"><span>Item</span></div>';
	const a = await render(
		page,
		cdp,
		html,
		{ app: "", cm: "", theme: ".scroll-box{overflow-y:auto}" },
		base,
	);
	const b = await render(
		page,
		cdp,
		html,
		{ app: "", cm: "", theme: ".scroll-box{overflow-y:hidden}" },
		base,
	);
	expect(
		styleDiff(a.styles, b.styles).some(
			(d) =>
				d.property === "overflow-y" &&
				d.before === "auto" &&
				d.after === "hidden",
		),
	).toBe(true);
	await page.close();
});
