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
		new URL("fixtures/phone-controls-rivals.css", import.meta.url),
		"utf8",
	);
});
afterAll(async () => {
	await browser.close();
});

async function compareStates(html: string, legacy: string, touch = false) {
	const page = await browser.newPage({ isMobile: touch, hasTouch: touch });
	try {
		const results = [];
		for (const css of [theme + legacy, theme]) {
			await page.setContent(
				`<body class="theme-dark is-mobile is-phone">${html}</body>`,
			);
			await page.addStyleTag({
				content: `${rivals}\n${css}\n* { transition: none !important; }`,
			});
			const cdp = await page.context().newCDPSession(page);
			await cdp.send("DOM.enable");
			await cdp.send("CSS.enable");
			const { root } = await cdp.send("DOM.getDocument");
			const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
				nodeId: root.nodeId,
				selector: "[data-target]",
			});
			const states = [];
			for (const forcedPseudoClasses of [
				[],
				["hover"],
				["focus"],
				["active"],
				["focus", "hover"],
				["focus-visible", "focus"],
			]) {
				for (const nodeId of nodeIds)
					await cdp.send("CSS.forcePseudoState", {
						nodeId,
						forcedPseudoClasses,
					});
				states.push(
					await page
						.locator("[data-target], [data-target] *")
						.evaluateAll((nodes) =>
							nodes.map((node) => {
								const s = getComputedStyle(node);
								return {
									color: s.color,
									background: s.backgroundColor,
									stroke: s.stroke,
									cursor: s.cursor,
								};
							}),
						),
				);
			}
			await cdp.detach();
			results.push(states);
		}
		expect(results[1]).toEqual(results[0]);
	} finally {
		await page.close();
	}
}

// The reference restores the inherited faint value to detect variable fan-out into SVG paint.
it("preserves phone Bases filter fills without changing icon paint", async () => {
	for (const container of ["menu mod-sheet", "drag-reorder-ghost mod-sheet"]) {
		await compareStates(
			`<div class="${container}"><div class="bases-filter-page"><div class="filter-row"><div class="filter-row-actions"><button class="clickable-icon" data-target><svg class="svg-icon" fill="none" stroke="currentColor" width="24" height="24"><path d="M0 0h8" /></svg></button></div></div></div></div>`,
			`
			.filter-row-actions .clickable-icon { --text-faint: #888 !important; background-color: transparent !important; }
			.filter-row-actions .clickable-icon:hover { color: var(--magenta); background-color: var(--magenta-transparent) !important; }
		`,
		);
	}
});

it("preserves phone menu states including disabled focus and active", async () => {
	await compareStates(
		`<div class="menu"><div class="menu-item" data-target>Normal</div><div class="menu-item mobile-tap" data-target>Tap</div><div class="menu-item is-disabled" data-target>Disabled</div><div class="menu-item is-disabled mobile-tap" data-target>Disabled tap</div><div class="menu-item is-disabled selected" data-target>Disabled selected</div></div>`,
		`
		.menu-item:hover, .menu-item:focus, .menu-item:active, .menu-item.selected { background-color: var(--cyan-transparent) !important; color: var(--magenta); cursor: pointer; }
		.menu-item.is-disabled:hover { background-color: transparent !important; color: var(--text-disabled); cursor: default; }
	`,
	);
});

it("preserves PDF form and mobile onboarding select fills", async () => {
	await compareStates(
		`<div class="annotationLayer"><div class="choiceWidgetAnnotation"><select data-target><option>PDF</option></select><select disabled data-target><option>Disabled PDF</option></select></div></div><div class="mobile-onboarding"><div class="language-dropdown"><select data-target><option>Language</option></select></div></div>`,
		`
		select, select:hover, select:focus, select:focus-visible, select:focus-within, select:active { background-color: var(--magenta) !important; }
	`,
	);
});

it("preserves both phone Bases menu row shapes without changing descendant paint", async () => {
	for (const shape of [
		"bases-toolbar-menu-action tappable",
		"suggestion-item",
	]) {
		const rows = [
			"",
			"selected",
			"is-selected",
			"mobile-tap",
			"is-disabled",
			"mod-hidden",
			"mod-hidden selected",
			"mod-hidden mobile-tap",
		]
			.map(
				(state) =>
					`<div class="bases-toolbar-menu-item ${shape} ${state}" tabindex="0" data-target><span class="bases-toolbar-menu-item-info"><span class="bases-toolbar-menu-item-name">Name</span></span><span class="clickable-icon bases-toolbar-menu-item-icon"><svg class="svg-icon" fill="none" stroke="currentColor" width="24" height="24"><path d="M0 0h8" /></svg></span></div>`,
			)
			.join("");
		await compareStates(
			`<div class="menu mod-sheet">${shape === "suggestion-item" ? `<div class="suggestion-group">${rows}</div>` : rows}</div>`,
			`
			.bases-toolbar-menu-item { --interactive-normal: #444 !important; --interactive-hover: #555 !important; }
			.bases-toolbar-menu-item:hover, .bases-toolbar-menu-item:focus, .bases-toolbar-menu-item:active, .bases-toolbar-menu-item.selected { background-color: var(--cyan-transparent) !important; color: var(--magenta); cursor: pointer; }
			.bases-toolbar-menu-item.mod-hidden:hover { background-color: transparent !important; color: var(--text-disabled); cursor: default; }
		`,
		);
	}
});

const disabledPaintReference = `
 .clickable-icon { --text-faint: #888 !important; --text-on-accent: #fff !important; }
 .clickable-icon[aria-disabled='true'] { color: var(--text-disabled) !important; background-color: transparent !important; }
 .filter-row-actions .clickable-icon { background-color: transparent !important; }
 .filter-row-actions .clickable-icon:hover { background-color: var(--magenta-transparent) !important; }
 .menu .bases-toolbar-menu-item:hover .clickable-icon,
 .menu .bases-toolbar-menu-item.is-selected .clickable-icon { color: var(--magenta) !important; }
`;

it("preserves disabled community-sidebar icon text", async () => {
	await compareStates(
		`<div class="modal mod-community-modal"><div class="modal-sidebar"><button class="clickable-icon" aria-disabled="true" data-target><svg stroke="currentColor"><path d="M0 0h8" /></svg></button></div></div>`,
		disabledPaintReference,
	);
});

it("preserves disabled sheet group-header action paint", async () => {
	for (const container of ["menu mod-sheet", "drag-reorder-ghost mod-sheet"]) {
		await compareStates(
			`<div class="${container}"><div class="bases-filter-page"><div class="filter-row"><div class="filter-group-header-actions"><button class="clickable-icon" aria-disabled="true" data-target><svg stroke="currentColor"><path d="M0 0h8" /></svg></button></div></div></div></div>`,
			disabledPaintReference,
		);
	}
});

it("preserves disabled filter-action hover fills", async () => {
	for (const container of [
		"menu mod-sheet",
		"drag-reorder-ghost mod-sheet",
		"menu",
	]) {
		await compareStates(
			`<div class="${container}"><div class="bases-filter-page"><div class="filter-row"><div class="filter-row-actions"><button class="clickable-icon" aria-disabled="true" data-target><svg stroke="currentColor"><path d="M0 0h8" /></svg></button></div></div></div></div>`,
			disabledPaintReference,
		);
	}
});

it("preserves hovered and selected menu-parent icon color in sheet actions", async () => {
	for (const actions of ["filter-row-actions", "filter-group-header-actions"]) {
		for (const parentState of ["", "is-selected"]) {
			await compareStates(
				`<div class="menu mod-sheet"><div class="bases-filter-page"><div class="bases-toolbar-menu-item ${parentState}" data-target><div class="filter-row"><div class="${actions}"><button class="clickable-icon" data-target><svg stroke="currentColor"><path d="M0 0h8" /></svg></button><button class="clickable-icon" aria-disabled="true" data-target><svg stroke="currentColor"><path d="M0 0h8" /></svg></button></div></div></div></div></div>`,
				disabledPaintReference,
			);
		}
	}
});

it("preserves sidebar tab hover paint with and without a mouse", async () => {
	for (const touch of [false, true]) {
		for (const side of [
			"mod-primary-split mod-left-split",
			"mod-secondary-split mod-right-split",
		]) {
			await compareStates(
				`<div class="${side}"><div class="workspace-tab-header-container"><div class="workspace-tab-header" data-target>Tab</div><div class="workspace-tab-header is-active" data-target>Active</div><div class="workspace-tab-header has-active-menu" data-target>Menu</div></div></div>`,
				`
				.mod-left-split .workspace-tab-header:hover, .mod-right-split .workspace-tab-header:hover { background-color: var(--icon-background-hover); }
				.mod-left-split .workspace-tab-header.is-active, .mod-left-split .workspace-tab-header.is-active:hover, .mod-right-split .workspace-tab-header.is-active, .mod-right-split .workspace-tab-header.is-active:hover { background-color: var(--icon-background-active); }
			`,
				touch,
			);
		}
	}
});

it("preserves XFA select color and fill through focus", async () => {
	await compareStates(
		`<div class="xfaLayer" style="color: rgb(0, 0, 255)"><select class="xfaSelect" data-target><option>Choice</option></select><select class="xfaSelect" disabled data-target><option>Disabled</option></select></div>`,
		`select { color: var(--black) !important; background-color: var(--magenta) !important; }`,
	);
});

it("keeps the approved inline PDF select appearance at rest and focus", async () => {
	const page = await browser.newPage();
	try {
		for (const mode of ["theme-dark", "theme-light"]) {
			await page.setContent(
				`<body class="${mode}"><div class="annotationLayer"><div class="choiceWidgetAnnotation"><select style="color: rgb(0, 0, 0); background-color: transparent"><option>PDF choice</option></select></div></div></body>`,
			);
			await page.addStyleTag({ content: rivals + theme });
			for (const focused of [false, true]) {
				if (focused) await page.locator("select").focus();
				expect(
					await page.locator("select").evaluate((select) => {
						const style = getComputedStyle(select);
						return { color: style.color, background: style.backgroundColor };
					}),
				).toEqual({ color: "rgb(0, 0, 0)", background: "rgba(0, 0, 0, 0)" });
			}
		}
	} finally {
		await page.close();
	}
});
