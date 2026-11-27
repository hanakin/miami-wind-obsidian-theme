import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compile } from "../scripts/pipeline";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
	await browser.close();
});

it("keeps warning text red while replacing the selected menu fill", async () => {
	const page = await browser.newPage();
	try {
		await page.setContent(
			'<body class="theme-dark"><div class="menu"><div class="menu-item is-warning selected">Delete</div></div></body>',
		);
		// Exact Obsidian 1.15.1 warning and selected-state rivals.
		await page.addStyleTag({
			content: `
			body { --text-error: #f87171; --background-modifier-hover: #313244; }
			.menu-item.is-warning:not(.is-disabled).selected { color: var(--text-error); }
			.menu-item:not(.is-label):not(.is-disabled).selected { background-color: var(--background-modifier-hover); }
			${(await compile()).css}
		`,
		});
		expect(
			await page.locator(".menu-item").evaluate((item) => {
				const style = getComputedStyle(item);
				return { color: style.color, background: style.backgroundColor };
			}),
		).toEqual({
			color: "rgb(248, 113, 113)",
			background: "rgba(34, 211, 238, 0.447)",
		});
	} finally {
		await page.close();
	}
});
