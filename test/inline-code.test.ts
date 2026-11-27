import { readFile } from "node:fs/promises";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compile } from "../scripts/pipeline";

let browser: Browser;
let theme: string;
let rivals: string;
beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
	theme = (await compile()).css;
	rivals = await readFile(
		new URL("fixtures/inline-links-rivals.css", import.meta.url),
		"utf8",
	);
});
afterAll(async () => {
	await browser.close();
});

it.each(
	["source", "live"].flatMap((mode) =>
		["dark", "light"].map((color) => ({ mode, color })),
	),
)(
	"preserves outer code and nested link colors in $mode, $color",
	async ({ mode, color }) => {
		const page = await browser.newPage();
		try {
			const html = await readFile(
				new URL(`fixtures/inline-links-${mode}.html`, import.meta.url),
				"utf8",
			);
			await page.setContent(`<body class="theme-${color}">${html}</body>`);
			await page.addStyleTag({
				content: `body {--text-muted: #b3b3b3; --text-faint: #666;} body.theme-light {--text-muted: #5c5c5c; --text-faint: #ababab;} ${rivals} ${theme}`,
			});
			const cdp = await page.context().newCDPSession(page);
			await cdp.send("DOM.enable");
			await cdp.send("CSS.enable");
			const { root } = await cdp.send("DOM.getDocument");
			const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
				nodeId: root.nodeId,
				selector: ".cm-inline-code, .cm-inline-code .cm-underline",
			});
			for (const hover of [false, true]) {
				for (const nodeId of nodeIds)
					await cdp.send("CSS.forcePseudoState", {
						nodeId,
						forcedPseudoClasses: hover ? ["hover"] : [],
					});
				const code = await page
					.locator(".cm-inline-code")
					.evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).color));
				expect(code.length).toBeGreaterThan(0);
				expect(new Set(code)).toEqual(new Set(["rgb(52, 211, 153)"]));
				if (mode === "live") {
					const external = await page
						.locator(
							".cm-inline-code.cm-link:not(.cm-hmd-footnote) .cm-underline",
						)
						.evaluateAll((nodes) =>
							nodes.map((n) => getComputedStyle(n).color),
						);
					expect(external.length).toBeGreaterThan(0);
					expect(new Set(external)).toEqual(
						new Set([hover ? "rgb(244, 114, 182)" : "rgb(56, 189, 248)"]),
					);
					const footnote = await page
						.locator(".cm-inline-code.cm-hmd-footnote .cm-underline")
						.evaluate((n) => getComputedStyle(n).color);
					expect(footnote).toBe(
						color === "dark" ? "rgb(179, 179, 179)" : "rgb(92, 92, 92)",
					);
				}
			}
		} finally {
			await page.close();
		}
	},
	60000,
);
