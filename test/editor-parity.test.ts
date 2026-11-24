import { readFile } from "node:fs/promises";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compile } from "../scripts/pipeline";

let browser: Browser;
let after: string;
let before: string;
let rivals: string;
beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
	after = (await compile()).css;
	before = `${await readFile("src/tokens.css", "utf8")} ${await readFile("test/fixtures/editor-before.css", "utf8")}`;
	rivals = await readFile("test/fixtures/editor-rivals.css", "utf8");
});
afterAll(async () => {
	await browser.close();
});

async function compare(
	html: string,
	options: { touch?: boolean; print?: boolean; classes?: string } = {},
) {
	const context = await browser.newContext({
		hasTouch: options.touch ?? false,
		isMobile: options.touch ?? false,
	});
	const page = await context.newPage();
	try {
		await page.emulateMedia({ media: options.print ? "print" : "screen" });
		await page.setContent(
			`<body dir="${options.classes?.includes("rtl") ? "rtl" : "ltr"}" class="theme-dark ${options.classes ?? ""}">${html}</body>`,
		);
		await page.addStyleTag({ content: rivals });
		const style = await page.addStyleTag({ content: before });
		const cdp = await context.newCDPSession(page);
		await cdp.send("DOM.enable");
		await cdp.send("CSS.enable");
		const { root } = await cdp.send("DOM.getDocument");
		const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
			nodeId: root.nodeId,
			selector: "[data-hover]",
		});
		for (const nodeId of nodeIds)
			await cdp.send("CSS.forcePseudoState", {
				nodeId,
				forcedPseudoClasses: ["hover"],
			});
		const sample = () =>
			page.locator("[data-probe]").evaluateAll((nodes) =>
				nodes.map((node) => {
					const s = getComputedStyle(node);
					return {
						color: s.color,
						background: s.backgroundColor,
						decoration: s.textDecoration,
						padding: [
							s.paddingTop,
							s.paddingRight,
							s.paddingBottom,
							s.paddingLeft,
						],
					};
				}),
			);
		const expected = await sample();
		await style.evaluate((node, css) => {
			node.textContent = css;
		}, after);
		expect(await sample()).toEqual(expected);
		return {
			hover: await page.evaluate(() => matchMedia("(hover: hover)").matches),
			expected,
		};
	} finally {
		await context.close();
	}
}

it.each([false, true])(
	"preserves invalid tag pills and hover with touch=%s",
	async (touch) => {
		const html = `<div class="metadata-property metadata-property-value" data-property-key="tags" data-property-type="tags"><div class="multi-select-container">${["bad tag", "123", "duplicate"].map((text) => `<div class="multi-select-pill is-invalid" data-probe>${text}</div><div class="multi-select-pill is-invalid" data-probe data-hover>${text}</div>`).join("")}</div></div>`;
		const result = await compare(html, {
			touch,
			classes: touch ? "is-mobile is-phone" : "",
		});
		expect(result.hover).toBe(!touch);
		expect(result.expected[0]).toMatchObject({
			color: "rgb(24, 24, 37)",
			background: "rgb(192, 132, 252)",
		});
		expect(result.expected[1]).toMatchObject({
			color: "rgb(24, 24, 37)",
			background: "rgb(244, 114, 182)",
		});
	},
);

it("preserves PDF export highlight text", async () => {
	const result = await compare(
		'<div class="markdown-preview-view markdown-rendered"><mark data-probe>highlight</mark></div>',
		{ print: true, classes: "print" },
	);
	expect(result.expected[0]?.color).toBe("rgb(30, 30, 46)");
});

it("preserves combined editor highlight tokens and their hover states", async () => {
	const tokens = [
		"cm-inline-code",
		"cm-hmd-internal-link",
		"cm-hmd-internal-link is-unresolved",
		"cm-formatting-link cm-url",
		"cm-footref cm-hmd-barelink cm-formatting",
		"cm-hmd-footnote cm-formatting",
		"cm-hmd-footnote-url-title",
		"cm-hashtag cm-hmd-escape-backslash",
		"obsidian-search-match-highlight",
	];
	await compare(
		`<div class="markdown-source-view mod-cm6 cm-s-obsidian"><div class="cm-line HyperMD-footnote">${tokens.map((token) => `<span class="cm-highlight ${token}" data-probe>${token}</span><span class="cm-highlight ${token}" data-probe data-hover>${token}</span>`).join("")}</div></div>`,
	);
});

it.each([
	"",
	"is-mobile is-phone",
	"is-mobile is-tablet",
	"mod-rtl",
	"mod-macos",
	"mod-windows",
	"mod-linux",
	"mod-sheet",
	"print",
])("preserves task text and quote padding under %s", async (classes) => {
	await compare(
		`<div class="markdown-source-view mod-cm6 cm-s-obsidian">${["-", "/", "!", "?", "x", " ", "*", "q", ">"].map((state) => `<div class="cm-line HyperMD-task-line" data-task="${state}" data-probe>task</div>`).join("")}</div><div class="markdown-rendered markdown-preview-view"><blockquote data-probe>quote</blockquote></div>`,
		{
			classes,
			print: classes === "print",
			touch: classes.includes("is-mobile"),
		},
	);
});

it("preserves highlighted flashing search ranges, including colored highlights", async () => {
	await compare(
		`<div class="markdown-rendered"><mark class="is-flashing" data-probe>flash</mark><mark class="is-flashing" data-highlight="red" data-probe>red flash</mark></div><div class="markdown-source-view mod-cm6 cm-s-obsidian"><span class="cm-highlight cm-highlight-red is-flashing" data-probe>editor flash</span></div>`,
	);
});
