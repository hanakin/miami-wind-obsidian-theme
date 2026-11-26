import { existsSync } from "node:fs";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FixtureEntry } from "../../capture/scripts/types";
import { BROWSER_OPTIONS } from "./browser";
import { outcome } from "./model";
import { render } from "./render";
import { runtimeCss } from "./runtime";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch(BROWSER_OPTIONS);
});
afterAll(async () => {
	await browser.close();
});
async function setup() {
	const page = await browser.newPage({
		viewport: { width: 1600, height: 1000 },
	});
	await page.route("**/*", (route) => route.abort());
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	return { page, cdp };
}

test("failed MathJax font loading prevents a proven same replay", async () => {
	const { page, cdp } = await setup();
	const r = await render(
		page,
		cdp,
		"<span data-capture-target>Math</span>",
		{
			app: "",
			cm: "@font-face {font-family:MJX-broken;src:url(data:font/woff2;base64,aW52YWxpZA==)} span {font-family:MJX-broken}",
			theme: "",
		},
		{ component: "math", state: "default", surface: "test" },
	);
	expect(r.replayIssues.some((issue) => issue.includes("MJX-broken"))).toBe(
		true,
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
	await page.close();
});

test("missing captured MathJax glyph metrics prevents a proven same replay", async () => {
	const { page, cdp } = await setup();
	const r = await render(
		page,
		cdp,
		'<span data-capture-target>Equation: <mjx-c class="mjx-c1D452">𝑒</mjx-c></span>',
		{ app: "", cm: "mjx-c {display:inline-block;width:0}", theme: "" },
		{ component: "math", state: "default", surface: "test" },
	);
	expect(r.replayIssues.some((issue) => issue.includes("mjx-c1D452"))).toBe(
		true,
	);
	expect(r.invisibleTarget).toBe(false);
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
	await page.close();
});

test
	.skipIf(!existsSync("capture/.app/runtime-styles.css"))
	.each(["md.math-inline.reading", "md.math-inline.live"])(
	"loads local MathJax glyph fonts for %s with external requests blocked",
	async (id) => {
		const { page, cdp } = await setup();
		const { readFile } = await import("node:fs/promises");
		const registry = JSON.parse(
			await readFile("capture/fixtures.json", "utf8"),
		) as { fixtures: FixtureEntry[] };
		const f = registry.fixtures.find((f) => f.id === id);
		if (!f) throw new Error(`Missing ${id}`);
		const cm = await runtimeCss();
		expect(cm).toContain("data:font/woff2;base64,");
		const r = await render(
			page,
			cdp,
			await readFile(`capture/fixtures/${f.file}`, "utf8"),
			{
				cm,
				app: await readFile("capture/.app/app.css", "utf8"),
				theme: await readFile("theme.css", "utf8"),
			},
			f,
		);
		expect(r.replayIssues.filter((issue) => issue.includes("font"))).toEqual(
			[],
		);
		const faces = await page.evaluate(() =>
			Array.from(document.fonts)
				.filter((f) => f.family.includes("MJX-"))
				.map((f) => f.status),
		);
		expect(faces).toContain("loaded");
		expect(faces).not.toContain("error");
		expect(
			(await page.locator("mjx-c.mjx-c32").first().boundingBox())?.width,
		).toBeGreaterThan(0);
		await page.close();
	},
	15000,
);
