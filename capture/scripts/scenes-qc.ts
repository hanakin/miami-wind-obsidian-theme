// Scenes added after QC: states the first capture excluded as "not reached" although the app
// can show them, plus window states, media emulation and interacting markdown.
import { INPAGE } from "./inpage.ts";
import { WORK } from "./obsidian.ts";
import { baseLayout, click, settingsWindow } from "./scenes.ts";
import type { Ctx, ItemDef, Pseudo, Scene, Target } from "./types.ts";

const p = (
	id: string,
	component: string,
	target: Target,
	pseudo: Pseudo[],
	extra: Partial<ItemDef> = {},
): ItemDef => ({ id, component, target, pseudo, state: pseudo.join("+"), ...extra });

const leaf = (sel: string, text?: string): Target => ({
	sel,
	in: "leaf",
	...(text ? { text } : {}),
});

async function center(ctx: Ctx, t: Target): Promise<[number, number]> {
	const b = await ctx.js<[number, number] | null>(
		"const el = cap.find(arg); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
		t,
	);
	if (!b) throw new Error(`nothing at ${JSON.stringify(t)}`);
	return b;
}

/** Starts a drag with Playwright's drag support (it drives Chromium's drag interception). */
async function dragTo(ctx: Ctx, from: Target, to: Target, fx = 0.5): Promise<void> {
	await ctx.page.mouse.up().catch(() => undefined);
	const a = await center(ctx, from);
	await ctx.page.mouse.move(a[0], a[1]);
	await ctx.page.mouse.down();
	await ctx.page.mouse.move(a[0] + 15, a[1] + 5, { steps: 3 });
	const r = await ctx.js<[number, number, number, number]>(
		"const r = cap.find(arg).getBoundingClientRect(); return [r.x, r.y, r.width, r.height];",
		to,
	);
	await ctx.page.mouse.move(r[0] + r[2] * fx, r[1] + r[3] / 2, { steps: 8 });
	await ctx.sleep(500);
}

async function endDrag(ctx: Ctx): Promise<void> {
	await ctx.page.keyboard.press("Escape");
	await ctx.page.mouse.up();
	await ctx.sleep(400);
}

/** Interacting markdown: links holding code, code and tags in headings, code inside highlights. */
const comboStates: Scene = {
	id: "qc.combo-states",
	surface: "editor-reading-view",
	source: "catalog:markdown-combinations",
	setup: (ctx) => ctx.open("Markdown/Combinations.md", "reading"),
	items: [
		p(
			"qc.combo.external-code-link.hover",
			"external-link",
			leaf(".markdown-reading-view a.external-link:has(code)"),
			["hover"],
		),
		p(
			"qc.combo.external-code-link.focus",
			"external-link",
			leaf(".markdown-reading-view a.external-link:has(code)"),
			["focus"],
		),
		p(
			"qc.combo.internal-code-link.hover",
			"internal-link",
			leaf(".markdown-reading-view a.internal-link:not(.is-unresolved):has(code)"),
			["hover"],
		),
		p(
			"qc.combo.internal-code-link.focus",
			"internal-link",
			leaf(".markdown-reading-view a.internal-link:not(.is-unresolved):has(code)"),
			["focus"],
		),
		p(
			"qc.combo.unresolved-code-link.hover",
			"internal-link",
			leaf(".markdown-reading-view a.internal-link.is-unresolved:has(code)"),
			["hover"],
		),
		p(
			"qc.combo.heading-link.hover",
			"internal-link",
			leaf(".markdown-reading-view h2 a.internal-link"),
			["hover"],
		),
		p("qc.combo.heading-tag.hover", "tag", leaf(".markdown-reading-view h1 a.tag"), ["hover"]),
		p(
			"qc.combo.live.external-code-link.hover",
			"external-link",
			leaf(".markdown-source-view .cm-line .cm-underline", "code in link"),
			["hover"],
			{
				surface: "editor-live-preview",
				before: (ctx) => ctx.open("Markdown/Combinations.md", "live"),
			},
		),
		p(
			"qc.combo.live.internal-code-link.hover",
			"internal-link",
			leaf(".markdown-source-view .cm-line .cm-underline", "code alias"),
			["hover"],
			{
				surface: "editor-live-preview",
			},
		),
		p(
			"qc.combo.live.internal-code-link.focus",
			"internal-link",
			leaf(".markdown-source-view .cm-line .cm-underline", "code alias"),
			["focus"],
			{
				surface: "editor-live-preview",
			},
		),
		p(
			"qc.combo.live.heading-tag.hover",
			"tag",
			leaf(".markdown-source-view .HyperMD-header-1 .cm-hashtag-end"),
			["hover"],
			{
				surface: "editor-live-preview",
			},
		),
	],
};

/** Find in file, the selection layer and other editor states the first pass missed. */
const editorQc: Scene = {
	id: "qc.editor",
	surface: "editor-live-preview",
	source: "catalog:editor-qc",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Kitchen sink.md", "live");
	},
	items: [
		{
			id: "qc.find.bar",
			component: "search-input",
			target: leaf(".document-search-container"),
			before: async (ctx) => {
				await ctx.js("app.workspace.activeEditor.editor.focus(); await sleep(200);");
				await ctx.command("editor:open-search");
				await ctx.sleep(300);
				await ctx.page.keyboard.type("task", { delay: 30 });
				await ctx.sleep(500);
			},
		},
		{
			id: "qc.find.match",
			component: "editor-line",
			target: leaf(".obsidian-search-match-highlight"),
			note: "Obsidian marks find-in-file matches with .obsidian-search-match-highlight.",
		},
		{
			id: "qc.find.replace",
			component: "search-input",
			target: leaf(".document-search-container.mod-replace-mode"),
			expect: ".mod-replace-mode",
			before: async (ctx) => {
				await ctx.command("editor:open-search-replace");
				await ctx.sleep(400);
			},
		},
		{
			id: "qc.selection.layer",
			component: "editor-line",
			target: leaf(".markdown-source-view .cm-editor"),
			state: "selection",
			expect: ".cm-editor:has(.cm-selectionLayer)",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; e.focus(); const n = e.getValue().split('\\n').findIndex((l) => l.startsWith('Text with')); e.setSelection({ line: n, ch: 0 }, { line: n + 3, ch: 10 }); await sleep(300);",
				);
			},
			note: "Target is .cm-editor so the fixture holds .cm-selectionLayer (sibling of .cm-content) as well as the native selection.",
		},
		{
			id: "qc.editor.active-indent",
			component: "list",
			target: leaf(".markdown-source-view .cm-line:has(.cm-active-indent)"),
			state: "active-indent",
			expect: ":has(.cm-indent.cm-active-indent)",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.open("Markdown/Lists and tasks.md", "live");
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; const n = e.getValue().split('\\n').findIndex((l) => l.trim() === '- Nested bullet'); e.focus(); e.setCursor({ line: n, ch: e.getLine(n).length }); await sleep(400);",
				);
			},
			note: "With the cursor in a nested list item, the indent guide of its parent level gets .cm-active-indent.",
		},
		{
			id: "qc.highlight-color-widget",
			component: "inline-mark",
			target: leaf(".markdown-source-view .cm-line:has(.cm-highlight-color-widget)"),
			before: async (ctx) => {
				await ctx.open("Markdown/Inline.md", "live");
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; const n = e.getValue().split('\\n').findIndex((l) => l.startsWith('Colored highlights')); e.focus(); e.setCursor({ line: n, ch: 22 }); await sleep(400);",
				);
			},
			note: "Live Preview shows the color swatch widget while the cursor is inside a colored highlight.",
		},
		{
			id: "qc.flash",
			component: "heading",
			surface: "editor-reading-view",
			target: leaf(".markdown-reading-view .is-flashing"),
			expect: ".is-flashing",
			before: async (ctx) => {
				// The folded-heading item leaves Headings.md folded (Obsidian saves folds); unfold it.
				await ctx.open("Markdown/Headings.md", "reading");
				await ctx.js(
					"for (const i of cap.ROOTS.leaf().querySelectorAll('.markdown-reading-view .is-collapsed > .heading-collapse-indicator, .markdown-reading-view .heading-collapse-indicator.is-collapsed')) { i.click(); await sleep(200); }",
				);
				for (let i = 0; i < 3; i++) {
					await ctx.open("Markdown/Links.md", "reading", { newLeaf: i > 0 });
					const r = await ctx.js<string>(
						"app.workspace.openLinkText('Headings#Heading 3', 'Markdown/Links.md', false); for (let i = 0; i < 40 && !document.querySelector('.is-flashing'); i++) await sleep(50); const l = app.workspace.activeLeaf; return document.querySelector('.is-flashing') ? 'ok' : JSON.stringify({ active: l?.view?.getViewType?.(), file: l?.view?.file?.path, mode: l?.view?.getMode?.() });",
					);
					if (r === "ok") break;
					console.error(`\nqc.flash try ${i}: ${r}`);
				}
			},
			note: "Opening a link to a heading flashes the heading for about a second.",
		},
		{
			id: "qc.rtl",
			component: "markdown-view",
			target: leaf(".workspace-leaf-content"),
			state: "right-to-left",
			expect: ".workspace-leaf-content:has(.rtl, .is-rtl)",
			full: true,
			before: async (ctx) => {
				await ctx.js("app.vault.setConfig('rightToLeft', true); await sleep(300);");
				await ctx.open("Markdown/Kitchen sink.md", "live");
				await ctx.sleep(500);
			},
		},
		{
			id: "qc.rtl-reading",
			component: "markdown-view",
			surface: "editor-reading-view",
			target: leaf(".workspace-leaf-content"),
			state: "right-to-left",
			expect: ".workspace-leaf-content:has(.rtl)",
			full: true,
			before: async (ctx) => {
				await ctx.open("Markdown/Kitchen sink.md", "reading");
				await ctx.sleep(500);
			},
		},
		{
			id: "qc.rtl-off",
			component: "markdown-view",
			target: leaf(".workspace-leaf-content"),
			state: "default",
			full: true,
			before: async (ctx) => {
				await ctx.js("app.vault.setConfig('rightToLeft', false); await sleep(300);");
				await ctx.open("Markdown/Kitchen sink.md", "live");
			},
		},
	],
};

const tabsQc: Scene = {
	id: "qc.tabs",
	surface: "workspace",
	source: "catalog:tab-states",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Headings.md", "live", { newLeaf: true });
	},
	items: [
		{
			id: "qc.tab.pinned",
			component: "tab-header",
			target:
				".mod-root .workspace-tab-header.is-active .workspace-tab-header-status-icon.mod-pinned",
			before: async (ctx) => {
				await ctx.js(
					"cap.ROOTS.leaf(); app.workspace.getMostRecentLeaf(app.workspace.rootSplit).setPinned(true); await sleep(300);",
				);
			},
		},
		{
			id: "qc.tab.pinned-header",
			component: "tab-header",
			target: ".mod-root .workspace-tab-header.is-active",
			expect: ":has(.mod-pinned)",
		},
		{
			id: "qc.tab.linked",
			component: "tab-header",
			target: ".mod-root .workspace-tab-header-status-icon.mod-linked",
			before: async (ctx) => {
				await ctx.js(
					"const a = app.workspace.getMostRecentLeaf(app.workspace.rootSplit); a.setPinned(false); const b = app.workspace.getLeaf('split'); await b.setViewState({ type: 'markdown', state: { file: 'Markdown/Kitchen sink.md' } }); a.setGroup('capture-link'); b.setGroup('capture-link'); await sleep(500);",
				);
			},
		},
	],
};

const dragQc: Scene = {
	id: "qc.drag",
	surface: "workspace",
	source: "catalog:drag",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Kitchen sink.md", "live");
	},
	items: [
		{
			id: "qc.drag.over-folder",
			component: "tree-item",
			surface: "left-sidebar",
			target: ".nav-folder.is-being-dragged-over",
			expect: ".is-being-dragged-over",
			before: (ctx) => dragTo(ctx, ".nav-file-title", ".nav-folder-title"),
		},
		{ id: "qc.drag.ghost", component: "drag-ghost", target: ".drag-ghost", minUnobscured: 0.3 },
		{
			id: "qc.drag.dragged-item",
			component: "nav-file",
			surface: "left-sidebar",
			target: ".nav-file-title.is-being-dragged",
			expect: ".is-being-dragged",
		},
		{
			id: "qc.drag.drop-overlay",
			component: "drag-ghost",
			target: ".workspace-drop-overlay",
			before: async (ctx) => {
				await ctx.page.mouse.move(
					...(await center(ctx, ".mod-root .workspace-tab-header-container")),
					{ steps: 8 },
				);
				await ctx.sleep(300);
				await ctx.page.mouse.move(...(await center(ctx, ".mod-root .view-content")), { steps: 8 });
				await ctx.sleep(500);
			},
			minUnobscured: 0.3,
		},
		{
			id: "qc.drag.kanban-column",
			component: "bases-kanban",
			surface: "bases",
			target: leaf(".bases-kanban-container"),
			state: "column-dragged",
			expect: ":has(> .bases-kanban-column.is-being-dragged)",
			full: true,
			before: async (ctx) => {
				await endDrag(ctx);
				await ctx.js(
					"const l = app.workspace.getMostRecentLeaf(app.workspace.rootSplit) ?? app.workspace.getLeaf('tab'); await l.setViewState({ type: 'bases', state: { file: 'Base.base', viewName: 'Board' }, active: true }); app.workspace.setActiveLeaf(l, { focus: true }); await sleep(1500);",
				);
				const [x, y] = await center(ctx, leaf(".bases-kanban-card"));
				await ctx.page.mouse.move(x, y);
				await ctx.page.mouse.down();
				await ctx.page.mouse.move(x + 10, y + 10, { steps: 3 });
				await ctx.page.mouse.move(x + 60, y + 90, { steps: 10 });
				await ctx.sleep(400);
			},
			note: "A kanban column held mid-drag with the real mouse (pressing on a card starts a column reorder): the column gets .is-being-dragged and a .drag-reorder-ghost copy follows the pointer.",
		},
		{
			id: "qc.drag.kanban-ghost",
			component: "drag-ghost",
			surface: "bases",
			target: ".drag-reorder-ghost",
			expect: ":has(> .bases-kanban-column.mod-dragged-item)",
			minUnobscured: 0.3,
		},
		{
			id: "qc.drag.done",
			component: "workspace",
			target: ".app-container",
			state: "default",
			full: true,
			before: endDrag,
		},
	],
};

const basesQc: Scene = {
	id: "qc.bases",
	surface: "bases",
	source: "catalog:bases-qc",
	setup: (ctx) => ctx.open("Base.base", "live"),
	items: [
		{
			id: "qc.bases.active-cell",
			component: "bases-table",
			target: leaf(".bases-table-active-cell"),
			before: async (ctx) => {
				await click(ctx, leaf(".bases-tbody .bases-td", undefined));
				await ctx.page.keyboard.press("ArrowRight");
				await ctx.sleep(300);
			},
		},
		{
			id: "qc.bases.selection",
			component: "bases-table",
			target: leaf(".bases-table-selection"),
			before: async (ctx) => {
				// A pointer drag across cells selects a range (the table gets .has-selection).
				const a = await center(ctx, { sel: ".bases-tbody .bases-td", nth: 1, in: "leaf" });
				const b = await center(ctx, { sel: ".bases-tbody .bases-td", nth: 9, in: "leaf" });
				await ctx.page.mouse.move(a[0], a[1]);
				await ctx.page.mouse.down();
				await ctx.page.mouse.move(b[0], b[1], { steps: 8 });
				await ctx.page.mouse.up();
				await ctx.sleep(300);
			},
		},
		{
			id: "qc.bases.formula-error",
			component: "bases-table",
			target: leaf(".bases-td[data-property='formula.broken']"),
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
			},
		},
		{
			id: "qc.bases.summary-menu",
			component: "suggestion",
			surface: "menu",
			target: ".bases-summary-menu-item",
			before: async (ctx) => {
				await click(ctx, leaf(".bases-table-footer .bases-td"));
			},
		},
		p(
			"qc.bases.summary-menu.hover",
			"suggestion",
			".bases-summary-menu-item:not(.is-selected)",
			["hover"],
			{
				surface: "menu",
			},
		),
		{
			id: "qc.bases.new-item",
			component: "popover",
			surface: "popover",
			target: ".bases-new-item-popover",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-new-item-menu"));
				await ctx.sleep(600);
			},
		},
		{
			id: "qc.bases.group-menu",
			component: "menu",
			surface: "menu",
			target: { sel: ".bases-groupby-container", closest: ".menu" },
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-group-menu"));
			},
		},
		{
			id: "qc.bases.results-page",
			component: "menu",
			surface: "menu",
			target: { sel: ".bases-results-page", closest: ".menu" },
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-results-menu"));
			},
		},
		{
			id: "qc.bases.properties-page",
			component: "menu",
			surface: "menu",
			target: { sel: ".bases-properties-page", closest: ".menu" },
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-properties-menu"));
				await click(ctx, { sel: ".menu .bases-toolbar-menu-item.mod-formula" });
			},
		},
		{
			id: "qc.bases.filter-group",
			component: "filter-row",
			surface: "menu",
			target: { sel: ".input-group-container, .filter-group", closest: ".menu" },
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-filter-menu"));
				await ctx.js(
					"[...document.querySelectorAll('.menu .text-icon-button')].find((b) => /add filter group/i.test(b.textContent ?? ''))?.click(); await sleep(500);",
				);
			},
		},
		{
			id: "qc.bases.formula-editor",
			component: "formula-editor",
			surface: "menu",
			target: { sel: ".formula-editor", closest: ".bases-toolbar-section-content, .menu" },
			before: async (ctx) => {
				await ctx.js(
					"[...document.querySelectorAll('.menu .clickable-icon')].find((b) => b.getAttribute('aria-label') === 'Advanced filter' && b.getBoundingClientRect().width > 0)?.click(); await sleep(600);",
				);
			},
		},
		{
			id: "qc.bases.autocomplete",
			component: "suggestion",
			surface: "suggestion-popup",
			target: ".cm-tooltip-autocomplete",
			before: async (ctx) => {
				const b = await center(ctx, { sel: ".menu .formula-editor .cm-content" });
				await ctx.page.mouse.click(b[0], b[1]);
				await ctx.page.keyboard.press("End");
				await ctx.page.keyboard.type(" && file.na", { delay: 60 });
				await ctx.sleep(800);
			},
		},
		{
			id: "qc.bases.docstring",
			component: "tooltip",
			surface: "suggestion-popup",
			target: ".cm-tooltip-docstring",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Enter");
				await ctx.page.keyboard.type(".contains(", { delay: 60 });
				await ctx.sleep(800);
			},
		},
		{
			id: "qc.bases.matching-bracket",
			component: "formula-editor",
			surface: "menu",
			target: { sel: ".formula-editor .cm-editor", closest: ".menu" },
			state: "matching-bracket",
			expect: ":has(.formula-editor .cm-editor.cm-focused .cm-matchingBracket)",
			minUnobscured: 0.3,
			before: async (ctx) => {
				const b = await center(ctx, { sel: ".menu .formula-editor .cm-content" });
				await ctx.page.mouse.click(b[0], b[1]);
				await ctx.page.keyboard.press("End");
				await ctx.page.keyboard.press("ArrowLeft");
				await ctx.sleep(400);
			},
			note: "Typing .contains( auto-closes the bracket; with the cursor between them the formula editor marks both with .cm-matchingBracket.",
		},
		{
			id: "qc.bases.list-view",
			component: "bases-list",
			target: leaf(".bases-view:has(.bases-list-separator)"),
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.command("bases:change-view");
				await ctx.sleep(400);
				await ctx.js(
					"[...document.querySelectorAll('.suggestion-item')].find((e) => e.textContent.includes('List view'))?.click(); await sleep(800);",
				);
			},
		},
		{
			id: "qc.bases.grouped-summary",
			component: "bases-table",
			target: leaf(".bases-table-group-summary-row"),
			before: async (ctx) => {
				await ctx.command("bases:change-view");
				await ctx.sleep(400);
				await ctx.js(
					"[...document.querySelectorAll('.suggestion-item')].find((e) => e.textContent.includes('Grouped'))?.click(); await sleep(800);",
				);
			},
		},
	],
};

const canvasQc: Scene = {
	id: "qc.canvas",
	surface: "canvas",
	source: "catalog:canvas-qc",
	setup: async (ctx) => {
		await ctx.open("Canvas.canvas", "live");
		await ctx.js("app.workspace.activeLeaf.view.canvas.zoomToFit(); await sleep(700);");
	},
	items: [
		{
			id: "qc.canvas.interaction-layer",
			component: "canvas-node",
			target: ".canvas-node-interaction-layer",
			minUnobscured: 0.3,
			before: async (ctx) => {
				const b = await center(ctx, { sel: ".canvas-node", text: "Colored card 2" });
				await ctx.page.mouse.click(b[0], b[1]);
				await ctx.page.mouse.move(b[0] + 3, b[1] + 3, { steps: 2 });
				await ctx.sleep(400);
			},
			note: "Node resizers and connection points of the selected node live in this layer.",
		},
		{
			id: "qc.canvas.resizer",
			component: "canvas-node",
			target: ".canvas-node-interaction-layer .canvas-node-resizer",
			minUnobscured: 0.3,
		},
		{
			id: "qc.canvas.connection-point",
			component: "canvas-node",
			target: ".canvas-node-interaction-layer .canvas-node-connection-point",
			minUnobscured: 0.3,
		},
		{
			id: "qc.canvas.connecting",
			component: "canvas-edge",
			target: ".canvas-wrapper",
			state: "connecting",
			expect: ":has(.is-connecting), .canvas-wrapper:has(.canvas.is-connecting)",
			full: true,
			before: async (ctx) => {
				const b = await center(
					ctx,
					".canvas-node-interaction-layer .canvas-node-connection-point[data-side='right']",
				);
				await ctx.page.mouse.move(b[0], b[1]);
				await ctx.page.mouse.down();
				await ctx.page.mouse.move(b[0] + 80, b[1] + 60, { steps: 8 });
				await ctx.sleep(400);
			},
		},
		{
			id: "qc.canvas.selection-box",
			component: "canvas",
			target: ".canvas-selection",
			minUnobscured: 0.3,
			note: "The selection box is drawn under the cards it crosses, so part of it is hidden by design.",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.mouse.up();
				await ctx.js("app.workspace.activeLeaf.view.canvas.deselectAll(); await sleep(200);");
				const r = await ctx.js<[number, number]>(
					"const r = cap.ROOTS.leaf().querySelector('.canvas-wrapper').getBoundingClientRect(); return [r.x + 30, r.bottom - 40];",
				);
				await ctx.page.mouse.move(r[0], r[1]);
				await ctx.page.mouse.down();
				await ctx.page.mouse.move(r[0] + 260, r[1] - 220, { steps: 10 });
				await ctx.sleep(300);
			},
		},
		{
			id: "qc.canvas.snaps",
			component: "canvas",
			target: ".canvas-wrapper",
			state: "dragging-node",
			full: true,
			expect: ":has(.canvas-snaps)",
			before: async (ctx) => {
				await ctx.page.mouse.up();
				await ctx.js("app.workspace.activeLeaf.view.canvas.deselectAll(); await sleep(200);");
				const b = await center(ctx, { sel: ".canvas-node", text: "Colored card 3" });
				await ctx.page.mouse.move(b[0], b[1]);
				await ctx.page.mouse.down();
				await ctx.page.mouse.move(b[0] - 240, b[1] + 2, { steps: 12 });
				await ctx.sleep(400);
			},
		},
		{
			id: "qc.canvas.zoomed-out",
			component: "canvas",
			target: ".canvas-wrapper.mod-zoomed-out",
			full: true,
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.mouse.up();
				await ctx.js("app.workspace.activeLeaf.view.canvas.zoomBy(-6); await sleep(900);");
			},
		},
		{
			id: "qc.canvas.node-placeholder",
			component: "canvas-node",
			target: ".canvas-node-placeholder",
		},
	],
};

const pdfQc: Scene = {
	id: "qc.pdf",
	surface: "pdf",
	source: "catalog:pdf-qc",
	setup: async (ctx) => {
		await ctx.open("Attachments/sample.pdf", "live");
		await ctx.sleep(1500);
	},
	items: [
		{
			id: "qc.pdf.find-settings",
			component: "pdf",
			target: leaf(".pdf-findbar-settings"),
			before: async (ctx) => {
				await ctx.js("cap.ROOTS.leaf().querySelector('.pdf-viewer-container')?.focus();");
				await ctx.page.keyboard.press("Control+f");
				await ctx.page.keyboard.type("Lorem", { delay: 20 });
				await ctx.sleep(500);
				await click(ctx, leaf(".pdf-findbar-settings-btn"));
			},
		},
		{
			id: "qc.pdf.spread",
			component: "pdf",
			target: leaf(".pdfViewer .spread"),
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.js(
					"const v = app.workspace.getMostRecentLeaf(app.workspace.rootSplit).view; const pv = v.viewer?.child?.pdfViewer?.pdfViewer; pv.spreadMode = 1; await sleep(800);",
				);
			},
		},
		{
			id: "qc.pdf.wrapped",
			component: "pdf",
			target: leaf(".pdfViewer.scrollWrapped"),
			before: async (ctx) => {
				await ctx.js(
					"const pv = app.workspace.getMostRecentLeaf(app.workspace.rootSplit).view.viewer.child.pdfViewer.pdfViewer; pv.spreadMode = 0; pv.scrollMode = 2; await sleep(800);",
				);
			},
		},
		{
			id: "qc.pdf.horizontal",
			component: "pdf",
			target: leaf(".pdfViewer.scrollHorizontal"),
			before: async (ctx) => {
				await ctx.js(
					"const pv = app.workspace.getMostRecentLeaf(app.workspace.rootSplit).view.viewer.child.pdfViewer.pdfViewer; pv.scrollMode = 1; await sleep(800);",
				);
			},
		},
		{
			id: "qc.pdf.themed",
			component: "pdf",
			target: leaf(".pdf-container.mod-themed"),
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"const pv = app.workspace.getMostRecentLeaf(app.workspace.rootSplit).view.viewer.child.pdfViewer.pdfViewer; pv.scrollMode = 0; app.saveLocalStorage('pdfjs-is-themed', 'true'); await sleep(200);",
				);
				await ctx.open("Attachments/sample.pdf", "live", { newLeaf: true });
				await ctx.sleep(1500);
			},
			note: 'PDF toolbar menu "Adapt to theme" (stored as pdfjs-is-themed).',
		},
		{
			id: "qc.pdf.password",
			component: "pdf",
			target: leaf(".pdf-password-dialog"),
			before: async (ctx) => {
				await ctx.js("app.saveLocalStorage('pdfjs-is-themed', null);");
				await ctx.open("Attachments/locked.pdf", "live");
				await ctx.sleep(1500);
			},
			note: "locked.pdf is sample.pdf encrypted with qpdf (password capture-user).",
		},
		{
			id: "qc.pdf.forms",
			component: "pdf",
			target: leaf(".annotationLayer"),
			before: async (ctx) => {
				await ctx.open("Attachments/forms.pdf", "live");
				await ctx.sleep(2000);
			},
			note: "forms.pdf is a hand-written sample with AcroForm fields and annotations.",
		},
		p(
			"qc.pdf.text-field.focus",
			"text-input",
			leaf(".annotationLayer .textWidgetAnnotation input"),
			["focus"],
		),
		{
			id: "qc.pdf.annotation-popup",
			component: "pdf",
			target: leaf(".annotationLayer .popupWrapper"),
			state: "popup-open",
			expect: ".popupWrapper:not([hidden]):has(.popup:not([hidden]) .popupContent)",
			before: async (ctx) => {
				await ctx.open("Attachments/forms.pdf", "live");
				await ctx.sleep(2000);
				const b = await center(ctx, leaf(".annotationLayer .textAnnotation"));
				await ctx.page.mouse.click(b[0], b[1]);
				await ctx.sleep(600);
			},
			note: "Clicking the sticky-note (Text) annotation opens its pdf.js comment popup.",
		},
		{
			id: "qc.pdf.xfa",
			component: "pdf",
			target: leaf(".xfaLayer"),
			expect:
				".xfaLayer:has(.xfaPage .xfaTextfield):has(.xfaCheckbox):has(.xfaSelect):has(.xfaButton)",
			before: async (ctx) => {
				await ctx.open("Attachments/xfa-form.pdf", "live");
				await ctx.sleep(2500);
			},
			note: "xfa-form.pdf is a hand-written pure XFA form (template packet only); Obsidian's pdf.js has enableXfa on and draws it with its XFA layer.",
		},
		p("qc.pdf.xfa-text.focus", "text-input", leaf(".xfaLayer .xfaTextfield"), ["focus"]),
	],
};

const recoveryQc: Scene = {
	id: "qc.file-recovery",
	surface: "modal",
	source: "catalog:file-recovery",
	setup: async (ctx) => {
		await ctx.js(
			"const fr = app.internalPlugins.plugins['file-recovery'].instance; const f = app.vault.getAbstractFileByPath('Markdown/Kitchen sink.md'); const now = await app.vault.read(f); await fr.forceAdd(f.path, now.replace('Kitchen sink', 'Kitchen sink (older)').replace('A callout.', 'A changed callout.') + '\\nAn older line.'); await sleep(300);",
		);
		await ctx.open("Markdown/Kitchen sink.md", "live");
		await ctx.command("file-recovery:open");
		await ctx.sleep(800);
	},
	items: [
		{
			id: "qc.file-recovery.diff",
			component: "diff",
			target: ".modal .diff-view",
			before: async (ctx) => {
				await ctx.js(
					"const m = cap.last('.modal-container'); m.querySelector('.file-recovery-list-item-header')?.click(); await sleep(400); const t = m.querySelector('.modal-setting-titlebar-toggle'); (t.querySelector('input') ?? t).click(); await sleep(800);",
				);
			},
		},
		{
			id: "qc.file-recovery.diff-changed",
			component: "diff",
			target: ".modal .diff-view .diff-changed",
		},
	],
};

const searchQc: Scene = {
	id: "qc.search",
	surface: "modal",
	source: "catalog:copy-search-results",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.js(
			"const l = app.workspace.getLeavesOfType('search')[0]; app.workspace.revealLeaf(l); l.view.setQuery('heading'); await sleep(1200); l.view.onCopyResultsClick(new MouseEvent('click')); await sleep(600);",
		);
	},
	items: [
		{
			id: "qc.search.copy-results",
			component: "modal",
			target: ".modal:has(.copy-search-result-container)",
		},
		p(
			"qc.search.copy-results.textarea.focus",
			"textarea",
			".copy-search-result-textarea",
			["focus"],
			{},
		),
	],
};

const hotkeysQc: Scene = {
	id: "qc.hotkeys",
	surface: "settings",
	source: "catalog:hotkeys-qc",
	window: "popout",
	opener: async (main) => {
		// Two commands on the same keys make a conflict; a custom key adds the restore button.
		await main.js(
			"app.hotkeyManager.setHotkeys('editor:toggle-italics', [{ modifiers: ['Mod'], key: 'B' }]); await sleep(200);",
		);
		await settingsWindow("hotkeys")(main);
	},
	setup: async (ctx) => {
		await ctx.js(
			"cap.clearSettingsSearch(); app.setting.openTabById('hotkeys'); await sleep(600);",
		);
		await click(ctx, ".modal .search-input-container.mod-hotkey input");
		await ctx.page.keyboard.type("Toggle italic", { delay: 20 });
		await ctx.sleep(500);
	},
	items: [
		{
			id: "qc.hotkeys.conflict",
			component: "hotkey",
			target: ".modal .setting-hotkey.has-conflict",
		},
		{
			id: "qc.hotkeys.restore",
			component: "clickable-icon",
			target: ".modal .setting-restore-hotkey-button",
		},
		{
			id: "qc.hotkeys.filter",
			component: "search-input",
			target: ".modal .mod-active-hotkey-filter",
			before: async (ctx) => {
				await ctx.js(
					"const i = document.querySelector('.modal .search-input-container.mod-hotkey input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.modal .search-input-container.mod-hotkey .input-right-decorator').click(); await sleep(300);",
				);
				await ctx.page.keyboard.press("Control+b");
				await ctx.sleep(400);
			},
		},
	],
};

const spellQc: Scene = {
	id: "qc.spellcheck",
	surface: "settings",
	source: "catalog:spellcheck-dictionary",
	window: "popout",
	opener: async (main) => {
		await main.js(
			"const s = electron.remote.getCurrentWebContents().session; for (const w of ['miamiwind', 'obsidianish', 'hanakin']) s.addWordToSpellCheckerDictionary(w); await sleep(300);",
		);
		await settingsWindow("editor")(main);
	},
	setup: async (ctx) => {
		await ctx.js(
			"cap.clearSettingsSearch(); app.setting.openTabById('editor'); await sleep(500); const row = [...document.querySelectorAll('.modal.mod-settings .setting-item')].find((e) => /spell ?check/i.test(e.querySelector('.setting-item-name')?.textContent ?? '')); row?.querySelector('.clickable-icon')?.click(); await sleep(800);",
		);
	},
	items: [
		{
			id: "qc.spellcheck.dictionary",
			component: "list",
			target: ".spellchecker-dictionary-container",
		},
	],
};

const graphQc: Scene = {
	id: "qc.graph",
	surface: "graph",
	source: "catalog:graph-qc",
	setup: async (ctx) => {
		await ctx.command("graph:open");
		await ctx.sleep(1500);
		await ctx.js(
			"const v = app.workspace.getMostRecentLeaf(app.workspace.rootSplit).view; const o = v.dataEngine.getOptions(); v.dataEngine.setOptions({ ...o, showTags: true, showAttachments: true, hideUnresolved: false, showOrphans: true, colorGroups: [{ query: 'path:Markdown', color: { a: 1, rgb: 16068278 } }] }); await sleep(2500);",
		);
	},
	items: [
		{
			id: "qc.graph.all-node-kinds",
			component: "graph",
			target: leaf(".workspace-leaf-content"),
			full: true,
			note: "Tags, attachments, orphans, unresolved links and a color group are on; Pixi draws them on a canvas with the colors Obsidian reads from .graph-view.color-* probes. evidence.record holds the colors the renderer read from each probe class and how many screenshot pixels have exactly that color.",
			record:
				"const v = app.workspace.getLeavesOfType('graph')[0]?.view; const c = v?.renderer?.colors ?? {}; const map = { fill: 'color-fill', fillFocused: 'color-fill-focused', fillTag: 'color-fill-tag', fillUnresolved: 'color-fill-unresolved', fillAttachment: 'color-fill-attachment', arrow: 'color-arrow', circle: 'color-circle', line: 'color-line', text: 'color-text', fillHighlight: 'color-fill-highlight', lineHighlight: 'color-line-highlight' }; const graphColors = {}; const graphAlpha = {}; for (const [k, cls] of Object.entries(map)) if (c[k]) { graphColors[cls] = c[k].rgb; graphAlpha[cls] = c[k].a; } return { graphColors, graphAlpha };",
		},
		{
			id: "qc.graph.color-probes",
			component: "graph",
			target: leaf(".workspace-leaf-content"),
			full: true,
			synthetic:
				"probe elements re-created exactly as GraphRenderer.testCSS() creates them (document.body.createDiv({ cls: 'graph-view ' + name })) and moved into the graph leaf for the snapshot; Obsidian reads their color and detaches them at once",
			before: async (ctx) => {
				await ctx.js(
					"const host = cap.ROOTS.leaf().querySelector('.workspace-leaf-content'); for (const c of ['color-fill', 'color-fill-focused', 'color-fill-tag', 'color-fill-unresolved', 'color-fill-attachment', 'color-arrow', 'color-circle', 'color-line', 'color-text', 'color-fill-highlight', 'color-line-highlight']) { const d = document.body.createDiv({ cls: 'graph-view ' + c }); d.setAttribute('data-capture-probe', ''); d.style.cssText = 'position:absolute;width:0;height:0'; host.appendChild(d); }",
				);
			},
		},
	],
};

const mediaQc: Scene = {
	id: "qc.media",
	surface: "workspace",
	source: "catalog:media-emulation",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Kitchen sink.md", "reading");
	},
	items: [
		{
			id: "qc.media.print",
			component: "markdown-view",
			surface: "editor-reading-view",
			target: "body > .print",
			full: true,
			media: { media: "print" },
			before: async (ctx) => {
				await ctx.open("Markdown/Kitchen sink.md", "live");
				await ctx.js(
					"let p = Object.getPrototypeOf(app.setting); let base = null; while (p && p !== Object.prototype) { if (Object.hasOwn(p, 'open')) base = p; p = Object.getPrototypeOf(p); } const open = base.open; base.open = function () { window.__capModal = this; return open.apply(this, arguments); }; app.commands.executeCommandById('workspace:export-pdf'); await sleep(600); base.open = open; const m = window.__capModal; m.close(); await m.testPrint(); await sleep(1200);",
				);
			},
			note: "Obsidian's export modal testPrint() renders the print layout (body > .print) into the window; @media print emulated through Emulation.setEmulatedMedia.",
		},
		{
			id: "qc.media.forced-colors",
			component: "workspace",
			target: ".app-container",
			full: true,
			media: { features: [{ name: "forced-colors", value: "active" }] },
		},
		{
			id: "qc.translucent",
			component: "workspace",
			target: ".app-container",
			full: true,
			state: "is-translucent",
			synthetic:
				"body.is-translucent added by script: Obsidian only enables translucency on macOS (app.js enableTranslucency runs when process.platform === 'darwin')",
			before: async (ctx) => {
				await ctx.js("document.body.addClass('is-translucent'); await sleep(300);");
			},
		},
		{
			id: "qc.translucent-off",
			component: "workspace",
			target: ".app-container",
			full: true,
			state: "default",
			before: async (ctx) => {
				await ctx.js("document.body.removeClass('is-translucent'); await sleep(200);");
			},
		},
	],
};

/** Needs a real window: Hyprland applies full screen and maximize, headless Chromium cannot. */
const windowQc: Scene = {
	id: "qc.window",
	surface: "workspace",
	source: "catalog:window-states",
	windowed: true,
	setup: async (ctx) => {
		await baseLayout(ctx);
	},
	items: [
		{
			id: "qc.window.fullscreen",
			component: "workspace",
			target: ".app-container",
			state: "is-fullscreen",
			expect: "body.is-fullscreen .app-container",
			full: true,
			before: async (ctx) => {
				await ctx.js("electronWindow.setFullScreen(true); await sleep(1500);");
			},
		},
		{
			id: "qc.window.maximized",
			component: "workspace",
			target: ".app-container",
			state: "is-maximized",
			expect: "body.is-maximized .app-container",
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"electronWindow.setFullScreen(false); await sleep(1500); electronWindow.maximize(); await sleep(1500);",
				);
			},
		},
		{
			id: "qc.window.titlebar-maximized",
			component: "titlebar",
			target: ".titlebar",
			state: "is-maximized",
			expect: "body.is-maximized .titlebar",
		},
	],
};

/** Buttons that only show while their block is hovered: the real pointer hovers block and button. */
const hoverReveal: Scene = {
	id: "qc.hover-reveal",
	surface: "editor-reading-view",
	source: "catalog:hover-revealed-buttons",
	setup: (ctx) => ctx.open("Markdown/Code.md", "reading"),
	items: [
		{
			id: "qc.copy-code-button.hover",
			component: "clickable-icon",
			target: leaf(".markdown-reading-view pre .copy-code-button"),
			pseudo: ["hover"],
			pointer: true,
			state: "hover",
			before: async (ctx) => {
				const pre = await center(ctx, leaf(".markdown-reading-view pre"));
				await ctx.page.mouse.move(pre[0], pre[1], { steps: 3 });
				await ctx.sleep(300);
				await ctx.page.mouse.move(
					...(await center(ctx, leaf(".markdown-reading-view pre .copy-code-button"))),
					{ steps: 3 },
				);
				await ctx.sleep(300);
			},
		},
		{
			id: "qc.embedded-backlinks.live",
			component: "backlinks",
			surface: "editor-live-preview",
			target: leaf(".markdown-source-view .embedded-backlinks"),
			before: async (ctx) => {
				await ctx.page.mouse.move(5, 500);
				await ctx.open("Markdown/Headings.md", "live");
				await ctx.command("backlink:toggle-backlinks-in-document");
				await ctx.sleep(800);
			},
			note: '"Backlinks in document" is off by default; the scene turns it on, then off again.',
		},
		{
			id: "qc.embedded-backlinks.reading",
			component: "backlinks",
			target: leaf(".markdown-reading-view .embedded-backlinks"),
			before: async (ctx) => {
				await ctx.open("Markdown/Headings.md", "reading");
				await ctx.sleep(600);
			},
		},
		{
			id: "qc.embedded-backlinks.off",
			component: "markdown-view",
			target: leaf(".workspace-leaf-content"),
			full: true,
			state: "default",
			before: async (ctx) => {
				await ctx.command("backlink:toggle-backlinks-in-document");
				await ctx.sleep(500);
			},
		},
	],
};

const IN_WINDOW =
	"Extra coverage: Settings opened inside the main window (settingsPopoutWindow off). Obsidian styles the in-window Settings modal differently (border, rounding, shadow, size limit, header controls), so these complement the popout captures and do not replace them";
const POPOUT =
	"In the real Settings popout. The state is held through DevTools and verified with CSS.getMatchedStylesForNode (Element.matches() does not report forced states inside popout windows)";

const tab = (id: string) => async (ctx: Ctx) => {
	await ctx.js(
		`cap.clearSettingsSearch(); app.setting.openTabById(${JSON.stringify(id)}); await sleep(500);`,
	);
};

/** Hover and active states of Settings controls; `prefix` keeps the in-window copies apart. */
function settingsHoverItems(prefix: string, note: string): ItemDef[] {
	return [
		p(
			`${prefix}modal.vertical-tab.hover`,
			"vertical-tab",
			".modal .vertical-tab-nav-item:not(.is-active)",
			["hover"],
			{ note },
		),
		p(
			`${prefix}modal.vertical-tab.active.hover`,
			"vertical-tab",
			".modal .vertical-tab-nav-item.is-active",
			["hover"],
			{ note },
		),
		p(`${prefix}modal.dropdown.hover`, "dropdown", ".modal select.dropdown", ["hover"], { note }),
		p(`${prefix}modal.dropdown.active`, "dropdown", ".modal select.dropdown", ["active"], {
			note,
		}),
		p(`${prefix}modal.slider.hover`, "slider", ".modal input[type=range]", ["hover"], { note }),
		p(
			`${prefix}extra.select-option.hover`,
			"dropdown",
			".modal select.dropdown option",
			["hover"],
			{
				note,
				synthetic:
					"size=6 set on the <select> so Chromium draws its options in the page (the real dropdown list is a native popup outside the page)",
				before: async (ctx) => {
					await ctx.js(
						"document.querySelector('.modal select.dropdown').setAttribute('size', '6'); await sleep(200);",
					);
				},
			},
		),
		p(
			`${prefix}extra.select-option.checked.hover`,
			"dropdown",
			".modal select.dropdown option:checked",
			["hover"],
			{
				note,
				synthetic: "size=6 set on the <select> so Chromium draws its options in the page",
			},
		),
		p(
			`${prefix}modal.button.hover`,
			"button",
			".modal .vertical-tab-content button:not(.mod-cta)",
			["hover"],
			{
				note,
				before: async (ctx) => {
					await ctx.js(
						"document.querySelector('.modal select.dropdown[size]')?.removeAttribute('size');",
					);
					await tab("about")(ctx);
				},
			},
		),
		p(`${prefix}modal.button-cta.hover`, "button-cta", ".modal button.mod-cta", ["hover"], {
			note,
			before: tab("sync"),
		}),
		p(
			`${prefix}modal.text-input.hover`,
			"text-input",
			".modal .vertical-tab-content input[type=text]",
			["hover"],
			{
				note,
				before: tab("file"),
			},
		),
		p(
			`${prefix}modal.clickable-icon.hover`,
			"clickable-icon",
			".modal .vertical-tab-content .clickable-icon",
			["hover"],
			{
				note,
				before: tab("hotkeys"),
			},
		),
		p(`${prefix}modal.hotkey.hover`, "hotkey", ".modal .setting-hotkey", ["hover"], { note }),
		p(
			`${prefix}modal.search-clear.hover`,
			"clickable-icon",
			".modal .search-input-container.mod-hotkey .search-input-clear-button",
			["hover"],
			{
				note,
				before: async (ctx) => {
					await click(ctx, ".modal .search-input-container.mod-hotkey input");
					await ctx.page.keyboard.type("bold", { delay: 20 });
					await ctx.sleep(300);
				},
			},
		),
	];
}

/** The real popout Settings window. */
const settingsPopoutHover: Scene = {
	id: "qc.settings-popout-hover",
	surface: "settings",
	source: "catalog:settings-hover-states",
	window: "popout",
	opener: settingsWindow("editor"),
	setup: async (ctx) => {
		await ctx.js("cap.clearSettingsSearch(); app.setting.openTabById('editor'); await sleep(700);");
	},
	items: settingsHoverItems("", POPOUT),
};

/** Extra: the same states with Settings inside the main window. */
const settingsInWindow: Scene = {
	id: "qc.settings-in-window",
	surface: "settings",
	source: "catalog:settings-hover-states-in-window",
	setup: async (ctx) => {
		await ctx.js(
			"app.vault.setConfig('settingsPopoutWindow', false); await sleep(200); app.setting.open(); app.setting.openTabById('editor'); await sleep(700);",
		);
	},
	items: [
		...settingsHoverItems("inwindow.", IN_WINDOW),
		{
			id: "qc.settings-in-window.restore",
			component: "workspace",
			target: ".app-container",
			full: true,
			state: "default",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.js(
					"app.setting.close(); app.vault.setConfig('settingsPopoutWindow', true); await sleep(300);",
				);
			},
		},
	],
};

/** A desktop without a mouse: Blink's own (hover: none), from a headless app with no pointer device. */
const noPointerQc: Scene = {
	id: "qc.no-pointer",
	surface: "workspace",
	source: "catalog:media-emulation",
	noPointer: true,
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Kitchen sink.md", "reading");
	},
	items: [
		{
			id: "qc.media.hover-none",
			component: "workspace",
			target: ".app-container",
			full: true,
			expect: ".app-container",
			before: async (ctx) => {
				const none = await ctx.js<boolean>("return matchMedia('(hover: none)').matches;");
				if (!none) throw new Error("this run has a pointer: (hover: none) is false");
			},
			note: "Captured by `capture:run --no-pointer`: the app runs headless without the mouse setting, so Blink itself reports (hover: none) and (pointer: none). DevTools media emulation cannot change hover or pointer in this Chromium.",
		},
	],
};

/** Dialogs no command opens directly: rename, unlinked attachments on delete, PDF export progress. */
const dialogsQc: Scene = {
	id: "qc.dialogs",
	surface: "modal",
	source: "catalog:dialogs",
	setup: async (ctx) => {
		await baseLayout(ctx);
		// Deleted notes go to the vault's own .trash folder, never the system trash.
		await ctx.js(
			"app.vault.setConfig('trashOption', 'local'); app.vault.setConfig('promptDelete', false); app.vault.setConfig('deleteUnlinkedAttachments', 'ask'); await sleep(200);",
		);
	},
	items: [
		{
			id: "qc.dialog.rename",
			component: "modal",
			target: ".modal.mod-file-rename",
			expect: ".mod-file-rename:has(textarea.rename-textarea)",
			before: async (ctx) => {
				await ctx.js(
					"app.fileManager.promptForFileRename(app.vault.getAbstractFileByPath('Attachments/sample-image.png')); await sleep(500);",
				);
			},
			note: "The rename dialog Obsidian shows for files without an inline title (FileManager.promptForFileRename).",
		},
		{
			id: "qc.dialog.unlinked-attachments",
			component: "modal",
			target: ".modal.mod-file-browser",
			expect: ".mod-file-browser:has(.file-tree-item-checkbox)",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.js(
					"const v = app.vault; if (!v.getAbstractFileByPath('Scratch')) await v.createFolder('Scratch'); for (const n of ['Scratch/unlinked-one.png', 'Scratch/unlinked-two.jpg']) if (!v.getAbstractFileByPath(n)) await v.copy(v.getAbstractFileByPath(n.endsWith('png') ? 'Attachments/sample-image.png' : 'Attachments/small-square.jpg'), n); const note = v.getAbstractFileByPath('Scratch/Note with attachments.md') ?? await v.create('Scratch/Note with attachments.md', 'Only this note links them.\\n\\n![[unlinked-one.png]]\\n![[unlinked-two.jpg]]\\n'); for (let i = 0; i < 40 && !Object.keys(app.metadataCache.resolvedLinks[note.path] ?? {}).length; i++) await sleep(100); app.fileManager.promptForDeletion(note); for (let i = 0; i < 40 && !document.querySelector('.modal.mod-file-browser'); i++) await sleep(100); await sleep(300);",
				);
			},
			note: "Deleting a note whose attachments nothing else links asks which ones to delete too ('Delete unlinked attachments: ask'). The note is a throwaway in Scratch/ and goes to the vault's .trash.",
		},
		{
			id: "qc.dialog.unlinked-attachments.gallery",
			component: "modal",
			target: ".modal.mod-file-browser",
			state: "gallery-view",
			expect: ".mod-file-browser:has(.attachments-gallery:not([style*='none']))",
			before: async (ctx) => {
				await click(ctx, {
					sel: ".modal.mod-file-browser .modal-view-option[aria-label='Gallery']",
				});
				await ctx.js(
					"for (let i = 0; i < 20 && !document.querySelector('.attachments-gallery')?.getClientRects().length; i++) await sleep(100); await sleep(400);",
				);
			},
			note: "The same dialog switched to its gallery view.",
		},
		{
			id: "qc.dialog.export-progress",
			component: "progress-bar",
			surface: "notice",
			target: ".progress-bar-container",
			expect: ":has(.progress-bar .progress-bar-message)",
			minUnobscured: 0.3,
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.open("Markdown/Kitchen sink.md", "reading");
				await ctx.js(
					`let p = Object.getPrototypeOf(app.setting); let base = null; while (p && p !== Object.prototype) { if (Object.hasOwn(p, 'open')) base = p; p = Object.getPrototypeOf(p); } const open = base.open; base.open = function () { window.__capModal = this; return open.apply(this, arguments); }; app.commands.executeCommandById('workspace:export-pdf'); await sleep(600); base.open = open; const m = window.__capModal; m.close(); const sl = window.sleep; window.__capHold = new Promise((r) => { window.__capRelease = r; }); window.sleep = async (ms) => { window.sleep = sl; await window.__capHold; return sl(ms); }; window.__capPdf = m.printToPdf({ includeName: true, pageSize: 'Letter', landscape: false, marginsType: 0, scale: 1, open: false, filepath: ${JSON.stringify(`${WORK}/export-test.pdf`)} }); for (let i = 0; i < 40 && !document.querySelector('.progress-bar-container'); i++) await sleep(25); await sleep(300);`,
				);
			},
			note: "Export to PDF shows Obsidian's progress bar while it prints. The export is started directly (no save dialog) into the capture work folder with open: false, and its first internal sleep() is held until the shot is taken, so the bar stays up; it is released in qc.dialogs.restore.",
		},
		{
			id: "qc.dialogs.restore",
			component: "workspace",
			target: ".app-container",
			full: true,
			state: "default",
			before: async (ctx) => {
				await ctx.js(
					"window.__capRelease?.(); await window.__capPdf?.catch(() => null); app.vault.setConfig('deleteUnlinkedAttachments', 'never'); app.vault.setConfig('promptDelete', true); await sleep(300);",
				);
			},
		},
	],
};

/** Debug dialogs reached from the Settings popout: startup time and keychain encryption. */
const settingsDialogs: Scene = {
	id: "qc.settings-dialogs",
	surface: "modal",
	source: "catalog:settings-dialogs",
	window: "popout",
	opener: settingsWindow("about"),
	setup: async (ctx) => {
		await ctx.js("cap.clearSettingsSearch(); app.setting.openTabById('about'); await sleep(700);");
	},
	items: [
		{
			id: "qc.dialog.startup-time",
			component: "modal",
			target: ".modal.mod-plugin-debug",
			expect: ".mod-plugin-debug.mod-scrollable-content",
			before: async (ctx) => {
				await ctx.js(
					"const b = [...document.querySelectorAll('.extra-setting-button')].find((e) => e.querySelector('.lucide-timer')); b.scrollIntoView({ block: 'center' }); b.click(); for (let i = 0; i < 40 && !document.querySelector('.modal.mod-plugin-debug'); i++) await sleep(100); await sleep(400);",
				);
			},
			note: "Settings > About > Check startup time: the startup timing breakdown.",
		},
		{
			id: "qc.dialog.encryption-unavailable",
			component: "modal",
			target: ".modal.mod-plugin-debug",
			expect: ".mod-plugin-debug.mod-scrollable-content",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.js(
					"app.setting.openTabById('keychain'); await sleep(600); const a = [...document.querySelectorAll('.vertical-tab-content a, .vertical-tab-content .clickable-icon.mod-warning')].find((e) => e.getClientRects().length); a?.click(); for (let i = 0; i < 40 && !document.querySelector('.modal.mod-plugin-debug'); i++) await sleep(100); await sleep(400);",
				);
			},
			note: "Settings > Keychain shows a warning when the OS keyring is missing (the isolated session has none); its link opens this explanation.",
		},
	],
};

/** Real Escape presses until no menu, modal, popover or suggestion is open. */
async function closeOverlays(ctx: Ctx): Promise<void> {
	for (let i = 0; i < 8; i++) {
		if (!(await ctx.js<number>("return cap.overlays();"))) return;
		await ctx.page.keyboard.press("Escape");
		await ctx.sleep(150);
	}
}
const openBase = (view: string) => async (ctx: Ctx) => {
	await closeOverlays(ctx);
	await ctx.js(
		`const ws = app.workspace; const l = ws.getMostRecentLeaf(ws.rootSplit); await l.setViewState({ type: 'bases', state: { file: 'Base.base', viewName: ${JSON.stringify(view)} }, active: true }); ws.setActiveLeaf(l, { focus: true }); await sleep(1500);`,
	);
};
const revealSide = (type: string, file: string) => async (ctx: Ctx) => {
	await ctx.page.keyboard.press("Escape");
	await ctx.open(file, "live");
	await ctx.js(
		`const l = app.workspace.getLeavesOfType(${JSON.stringify(type)})[0]; await app.workspace.revealLeaf(l); await sleep(400); const p = l.view.backlink ?? l.view.outgoingLink; if (p?.unlinkedCollapsed) p.toggleUnlinkedCollapsed(); await sleep(1500);`,
	);
};

/**
 * Classes the theme can change that no earlier scene showed: property edge cases, unlinked
 * mentions, find states, Bases covers, errors and menus, read-only canvas, PDF outline and zoom.
 * Sample content: Markdown/Gaps.md, Base.base (cover image, empty board), Unknown.base, Broken.base,
 * Attachments/outline.pdf and archive.zip.
 */
const gapsQc: Scene = {
	id: "qc.gaps",
	surface: "editor-live-preview",
	source: "catalog:theme-affected-gaps",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Gaps.md", "live");
	},
	items: [
		{
			id: "qc.gap.property-type-warning",
			component: "property",
			surface: "properties",
			target: leaf(".metadata-property[data-property-key='mismatch']"),
			expect: ":has(.metadata-property-warning-icon)",
			note: "Gaps.md sets mismatch: 'not a number' while .obsidian/types.json types it as number.",
		},
		{
			id: "qc.gap.property-unknown-type",
			component: "property",
			surface: "properties",
			target: leaf(".metadata-property:has(.metadata-property-value-item.mod-unknown)"),
			expect: ":has(.metadata-property-value-item.mod-unknown)",
			note: "An object value (nested:) has no property type.",
		},
		{
			id: "qc.gap.property-empty-date",
			component: "property",
			surface: "properties",
			target: leaf(".metadata-property:has(input.is-empty)"),
			expect: ":has(input.is-empty)",
		},
		{
			id: "qc.gap.property-link-flair",
			component: "property",
			surface: "properties",
			target: leaf(".metadata-property[data-property-key='cover']"),
			expect: ":has(.metadata-link .metadata-link-flair)",
			pseudo: ["hover"],
			pseudoOn: leaf(".metadata-property[data-property-key='cover'] .metadata-link"),
			state: "hover",
			minUnobscured: 0.5,
		},
		{
			id: "qc.gap.generic-file-embed",
			component: "embed",
			target: leaf(".markdown-source-view .file-embed.mod-generic"),
			expect: ".file-embed.mod-generic",
			note: "![[archive.zip]]: a file type Obsidian cannot show inline.",
		},
		{
			id: "qc.gap.yaml-error-marker",
			component: "editor-line",
			target: leaf(".markdown-source-view .cm-line:has(.error-marker)"),
			expect: ":has(.error-marker)",
			before: async (ctx) => {
				await ctx.open("Markdown/Broken properties.md", "live");
			},
			note: "Invalid YAML front matter: Live Preview marks the position of the YAML error.",
		},
		{
			id: "qc.gap.js-property-access",
			component: "code-block",
			surface: "editor-reading-view",
			target: leaf(".markdown-reading-view pre:has(.token.property-access)"),
			expect: ":has(.token.property-access)",
			before: async (ctx) => {
				await ctx.open("Markdown/Code.md", "reading");
			},
		},
		{
			id: "qc.gap.find-no-match",
			component: "search-input",
			target: leaf(".document-search-container"),
			state: "no-match",
			expect: ":has(.mod-no-match)",
			before: async (ctx) => {
				await ctx.open("Markdown/Kitchen sink.md", "live");
				await ctx.js("app.workspace.activeEditor.editor.focus(); await sleep(200);");
				await ctx.command("editor:open-search");
				await ctx.sleep(300);
				await ctx.page.keyboard.type("zzqqxxnothing", { delay: 20 });
				await ctx.sleep(500);
			},
		},
		{
			id: "qc.gap.reading-find-highlight",
			component: "search-highlight",
			surface: "editor-reading-view",
			target: leaf(".markdown-reading-view :has(> .search-highlight)"),
			expect: ":has(> .search-highlight)",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.open("Markdown/Kitchen sink.md", "reading");
				await ctx.command("editor:open-search");
				await ctx.sleep(300);
				await ctx.page.keyboard.type("text", { delay: 20 });
				await ctx.sleep(600);
			},
			note: "Find in Reading view draws .search-highlight boxes over matches.",
		},
		{
			id: "qc.gap.unlinked-mention",
			component: "search-result",
			surface: "right-sidebar",
			target:
				".workspace-leaf-content[data-type='backlink'] .search-result-file-match:has(.search-result-file-match-replace-button)",
			expect: ":has(.search-result-file-match-replace-button)",
			before: revealSide("backlink", "Markdown/Kitchen sink.md"),
			note: "Backlinks > Unlinked mentions: Gaps.md names 'Kitchen sink' without a link, so the match has a Link button.",
		},
		{
			id: "qc.gap.unlinked-mention-button.hover",
			component: "button",
			surface: "right-sidebar",
			target:
				".workspace-leaf-content[data-type='backlink'] .search-result-file-match-replace-button",
			pseudo: ["hover"],
			pointer: true,
			state: "hover",
			before: async (ctx) => {
				const row =
					".workspace-leaf-content[data-type='backlink'] .search-result-file-match:has(.search-result-file-match-replace-button)";
				await ctx.page.mouse.move(...(await center(ctx, row)), { steps: 3 });
				await ctx.sleep(300);
				const b = await center(
					ctx,
					".workspace-leaf-content[data-type='backlink'] .search-result-file-match-replace-button",
				);
				await ctx.page.mouse.move(b[0], b[1], { steps: 3 });
				await ctx.js("window.__capPointer = arg;", b);
				await ctx.sleep(300);
			},
			note: "The Link button only shows while its match row is hovered; the real pointer hovers the row, then the button.",
		},
		{
			id: "qc.gap.outgoing-unlinked",
			component: "search-result",
			surface: "right-sidebar",
			target:
				".workspace-leaf-content[data-type='outgoing-link'] .search-result-file-match:has(.search-result-file-match-destination-file)",
			expect: ":has(.search-result-file-match-destination-file)",
			before: revealSide("outgoing-link", "Markdown/Gaps.md"),
			note: "Outgoing links > Unlinked mentions lists the note each plain-text mention could link to.",
		},
		{
			id: "qc.gap.switcher-create",
			component: "suggestion",
			surface: "suggestion-popup",
			target: ".prompt .suggestion-item:has(.suggestion-action)",
			expect: ":has(.suggestion-action)",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.command("switcher:open");
				await ctx.sleep(400);
				await ctx.page.keyboard.type("A note that does not exist", { delay: 15 });
				await ctx.sleep(500);
			},
		},
		{
			id: "qc.gap.graph-controls-closed",
			component: "graph",
			surface: "graph",
			target: leaf(".graph-controls.is-close"),
			expect: ".is-close",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.command("graph:open");
				await ctx.sleep(1500);
				await click(ctx, leaf(".graph-controls .graph-controls-button.mod-close"));
				await ctx.sleep(300);
			},
		},
		{
			id: "qc.gap.manage-workspaces",
			component: "modal",
			surface: "modal",
			target: ".modal:has(.list-container.mod-manage-workspaces)",
			expect: ":has(.list-container.mod-manage-workspaces .list-item)",
			before: async (ctx) => {
				await click(ctx, leaf(".graph-controls .graph-controls-button.mod-open"));
				await ctx.js(
					"app.internalPlugins.plugins.workspaces.instance.saveWorkspace('Capture layout'); await sleep(300);",
				);
				await ctx.command("workspaces:open-modal");
				await ctx.sleep(700);
			},
		},
		{
			id: "qc.gap.canvas-readonly",
			component: "canvas",
			surface: "canvas",
			target: leaf(".canvas-wrapper.mod-readonly"),
			expect: ".mod-readonly",
			full: true,
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.open("Canvas.canvas", "live");
				await ctx.sleep(800);
				await click(ctx, leaf(".canvas-controls .canvas-control-item"));
				await ctx.js(
					"[...document.querySelectorAll('.menu .menu-item')].find((e) => /read-only/i.test(e.textContent))?.click(); await sleep(500);",
				);
			},
			note: "Canvas quick settings > Read-only.",
		},
		{
			id: "qc.gap.pdf-zoom-min",
			component: "pdf",
			surface: "pdf",
			target: leaf(".pdf-toolbar"),
			state: "zoom-out-disabled",
			expect: ":has(.clickable-icon.mod-disabled)",
			before: async (ctx) => {
				await ctx.js(
					"app.workspace.activeLeaf.view.canvas?.setReadonly?.(false); await sleep(200);",
				);
				await ctx.open("Attachments/sample.pdf", "live");
				await ctx.sleep(1500);
				for (let i = 0; i < 30; i++) {
					const done = await ctx.js<boolean>(
						"const b = cap.ROOTS.leaf().querySelector('[aria-label=\"Zoom out\"]'); if (!b || b.classList.contains('mod-disabled')) return true; b.click(); await sleep(120); return false;",
					);
					if (done) break;
				}
				await ctx.sleep(400);
			},
			note: "Zoomed out to the minimum, the Zoom out button is disabled.",
		},
		{
			id: "qc.gap.pdf-outline",
			component: "pdf",
			surface: "pdf",
			target: leaf(".pdf-outline-view"),
			expect: ".pdf-outline-view:not(.hidden):has(.tree-item)",
			before: async (ctx) => {
				await ctx.js(
					"const l = cap.ROOTS.leaf(); for (let i = 0; i < 30; i++) { const b = l.querySelector('[aria-label=\"Zoom in\"]'); if (!b || b.classList.contains('mod-disabled')) break; b.click(); await sleep(60); } l.querySelector('[aria-label=\"Zoom in\"]') && app.workspace.activeLeaf.view.viewer?.child?.pdfViewer?.pdfViewer && (app.workspace.activeLeaf.view.viewer.child.pdfViewer.pdfViewer.currentScaleValue = 'auto'); await sleep(300);",
				);
				await ctx.open("Attachments/outline.pdf", "live");
				await ctx.sleep(1500);
				await click(ctx, leaf("[aria-label='Toggle sidebar']"));
				await click(ctx, leaf("[aria-label='Sidebar options']"));
				await ctx.js(
					"[...document.querySelectorAll('.menu .menu-item')].find((e) => /table of contents/i.test(e.textContent) && !/reveal/i.test(e.textContent))?.click(); await sleep(800);",
				);
			},
			note: "outline.pdf is a hand-written three-page PDF with a document outline, shown in the PDF sidebar's table of contents.",
		},
		{
			id: "qc.gap.bases-cards-cover",
			component: "bases-cards",
			surface: "bases",
			target: leaf(
				".bases-cards-item:has(.bases-cards-cover img), .bases-cards-item:has(.bases-cards-cover[style*='background'])",
			),
			expect: ":has(.bases-cards-cover)",
			before: async (ctx) => {
				await click(ctx, leaf("[aria-label='Toggle sidebar']"));
				await openBase("Cards view")(ctx);
			},
			note: "The Cards view uses note.cover as its image property; Gaps.md has a cover.",
		},
		{
			id: "qc.gap.kanban-card-cover",
			component: "bases-kanban",
			surface: "bases",
			target: leaf(
				".bases-kanban-card:has(.bases-kanban-card-cover img), .bases-kanban-card:has(.bases-kanban-card-cover[style*='background'])",
			),
			expect: ":has(.bases-kanban-card-cover)",
			before: openBase("Board"),
		},
		{
			id: "qc.gap.kanban-empty",
			component: "bases-kanban",
			surface: "bases",
			target: leaf(".bases-kanban-placeholder"),
			expect: ":has(.bases-kanban-placeholder-title)",
			before: openBase("Empty board"),
			note: "A kanban view with no group-by property shows its placeholder.",
		},
		{
			id: "qc.gap.bases-search",
			component: "search-input",
			surface: "bases",
			target: leaf(".bases-search-row"),
			before: async (ctx) => {
				await openBase("Table view")(ctx);
				await click(ctx, leaf(".bases-toolbar-search"));
				await ctx.sleep(400);
			},
		},
		{
			id: "qc.gap.bases-combobox",
			component: "suggestion",
			surface: "suggestion-popup",
			target: ".suggestion-container.combobox",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-sort-menu"));
				await click(ctx, { sel: ".menu .combobox-button" });
				await ctx.sleep(400);
			},
		},
		{
			id: "qc.gap.formula-status",
			component: "formula-editor",
			surface: "menu",
			target: { sel: ".formula-editor-container", closest: ".menu" },
			expect: ":has(.formula-editor-status)",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-properties-menu"));
				await ctx.js(
					"const it = [...document.querySelectorAll('.menu .bases-toolbar-menu-item')].find((e) => /name_length/.test(e.textContent)); (it?.querySelector('.clickable-icon:not(.grip-handle)') ?? it)?.click(); await sleep(700);",
				);
			},
			note: "The formula property's settings show its formula editor with the Valid/Invalid status line.",
		},
		{
			id: "qc.gap.filter-row-error",
			component: "filter-row",
			surface: "menu",
			target: {
				sel: ".menu .filter-row-error:not([style*='none'])",
				closest: ":has(> .filter-row-error)",
			},
			expect: ":has(> .filter-row-error:not([style*='none']))",
			before: async (ctx) => {
				await openBase("Table view")(ctx);
				await click(ctx, leaf(".bases-toolbar-filter-menu"));
				if (!(await ctx.js<number>("return document.querySelectorAll('.menu').length;")))
					throw new Error("the filter menu did not open");
				await ctx.js(
					"[...document.querySelectorAll('.menu .clickable-icon')].find((b) => b.getAttribute('aria-label') === 'Advanced filter' && b.getBoundingClientRect().width > 0)?.click(); await sleep(600);",
				);
				const b = await center(ctx, { sel: ".menu .formula-editor .cm-content" });
				await ctx.page.mouse.click(b[0], b[1]);
				await ctx.page.keyboard.press("End");
				await ctx.page.keyboard.type(" ))(", { delay: 50 });
				await ctx.sleep(400);
				await ctx.page.keyboard.press("Tab");
				const why = await ctx.js<string>(
					"for (let i = 0; i < 40 && ![...document.querySelectorAll('.menu .filter-row-error')].some((e) => e.getClientRects().length && e.textContent); i++) await sleep(100); if ([...document.querySelectorAll('.menu .filter-row-error')].some((e) => e.getClientRects().length && e.textContent)) return ''; return JSON.stringify({ menus: document.querySelectorAll('.menu').length, errs: [...document.querySelectorAll('.menu .filter-row-error')].map((e) => e.outerHTML.slice(0, 120)), editors: [...document.querySelectorAll('.menu .formula-editor')].map((e) => e.textContent), active: document.activeElement?.className });",
				);
				if (why) throw new Error(`no filter error shown: ${why}`);
			},
			note: "An unparsable advanced filter shows the row's error message.",
		},
		{
			id: "qc.gap.editor-caret",
			component: "editor-line",
			target: leaf(".markdown-source-view .cm-editor > .cm-scroller"),
			state: "caret-visible",
			expect: ":has(> .cm-cursorLayer .cm-cursor)",
			before: async (ctx) => {
				for (let i = 0; i < 3; i++) await ctx.page.keyboard.press("Escape");
				await ctx.open("Markdown/Kitchen sink.md", "live");
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; e.focus(); const n = e.getValue().split('\\n').findIndex((l) => l.startsWith('Text with')); e.setSelection({ line: n, ch: 0 }, { line: n, ch: 4 }); await sleep(300); const layer = cap.ROOTS.leaf().querySelector('.markdown-source-view .cm-editor > .cm-scroller > .cm-cursorLayer'); for (let i = 0; i < 60 && layer && getComputedStyle(layer).opacity !== '1'; i++) await sleep(25); for (const a of layer?.getAnimations?.() ?? []) a.pause();",
				);
			},
			note: "Obsidian draws a CodeMirror caret (.cm-cursor) at the head of a text selection (the empty main cursor uses the native caret); its blink animation is paused in the visible phase for the shot.",
		},
		{
			id: "qc.gap.unknown-view-base",
			component: "bases-view",
			surface: "bases",
			target: leaf(".bases-error"),
			expect: ".bases-error",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.open("Unknown.base", "live");
				await ctx.sleep(800);
			},
			note: "Unknown.base names a view type that does not exist: the base shows its error line.",
		},
	],
};

/** The Help window (help.html), opened by app:open-help in its own window. */
const helpWindow: Scene = {
	id: "qc.help-window",
	surface: "window",
	source: "catalog:help-window",
	window: "popout",
	opener: async (main) => {
		await main.command("app:open-help");
	},
	setup: async (ctx) => {
		await ctx.sleep(800);
	},
	items: [
		{
			id: "qc.help.options",
			component: "setting-item",
			target: ".setting-item:has(.setting-icon)",
			expect: ":has(> .setting-icon)",
			note: "Help window: each help link row starts with a .setting-icon.",
		},
	],
};

/** Hotkeys with a conflict: the 'Show conflicts' filter and its count badge. */
const hotkeyConflict: Scene = {
	id: "qc.hotkey-conflict",
	surface: "settings",
	source: "catalog:hotkey-conflict",
	window: "popout",
	opener: async (main) => {
		await main.js(
			"app.hotkeyManager.setHotkeys('editor:toggle-italics', [{ modifiers: ['Mod'], key: 'B' }]); await sleep(200);",
		);
		await settingsWindow("hotkeys")(main);
	},
	setup: async (ctx) => {
		await ctx.js(
			"cap.clearSettingsSearch(); (window.app ?? window.opener.app).setting.openTabById('hotkeys'); await sleep(900);",
		);
	},
	items: [
		{
			id: "qc.gap.hotkey-conflict-badge",
			component: "setting-item",
			target: {
				sel: ".setting-group-filter-badge",
				closest: ":has(> .setting-group-filter-badge)",
			},
			expect: ":has(> .setting-group-filter-badge)",
			note: "Italic is given Ctrl/Cmd+B, which Bold already uses; the conflict filter shows a count.",
		},
		{
			id: "qc.hotkey-conflict.restore",
			component: "modal",
			target: ".modal.mod-settings",
			state: "default",
			before: async (ctx) => {
				await ctx.js(
					"(window.app ?? window.opener.app).hotkeyManager.removeHotkeys('editor:toggle-italics'); await sleep(300);",
				);
			},
		},
	],
};

/** app:migrate-frontmatter on disposable legacy notes (Migration/): result counters. */
const migrationQc: Scene = {
	id: "qc.migration",
	surface: "modal",
	source: "catalog:frontmatter-migration",
	setup: async (ctx) => {
		await ctx.command("app:migrate-frontmatter");
		await ctx.sleep(600);
	},
	items: [
		{
			id: "qc.migration.modal",
			component: "modal",
			target: { sel: ".modal-container", in: "container" },
			full: true,
		},
		{
			id: "qc.migration.results",
			component: "modal",
			target: ".modal:has(.changelog-item)",
			expect: ":has(.changelog-item.mod-success):has(.changelog-item.mod-highlighted)",
			before: async (ctx) => {
				await ctx.js(
					"cap.last('.modal-container .modal button.mod-cta')?.click(); for (let i = 0; i < 50 && !document.querySelector('.changelog-item'); i++) await sleep(100); await sleep(1500);",
				);
			},
			note: "Counts of processed, modified and failed notes after Start conversion; the sample notes are disposable copies in the throwaway vault.",
		},
	],
};

/** The interface in a right-to-left language (Hebrew): body.mod-rtl and mirrored chrome. */
const rtlLanguage: Scene = {
	id: "qc.rtl-language",
	surface: "workspace",
	source: "catalog:rtl-interface-language",
	setup: async (ctx) => {
		await ctx.js("localStorage.setItem('language', 'he');");
		await ctx.page.reload();
		await ctx.page.waitForFunction("window.app?.workspace?.layoutReady === true", null, {
			timeout: 30000,
		});
		await ctx.page.evaluate(INPAGE);
		await baseLayout(ctx);
		await ctx.sleep(500);
	},
	items: [
		{
			id: "qc.rtl-language.window",
			component: "workspace",
			target: ".app-container",
			state: "mod-rtl",
			expect: "body.mod-rtl .app-container",
			full: true,
			note: "Interface language set to Hebrew (localStorage.language = he) and the window reloaded.",
		},
		{
			id: "qc.rtl-language.restore",
			component: "workspace",
			target: ".app-container",
			state: "default",
			full: true,
			before: async (ctx) => {
				await ctx.js("localStorage.removeItem('language');");
				await ctx.page.reload();
				await ctx.page.waitForFunction("window.app?.workspace?.layoutReady === true", null, {
					timeout: 30000,
				});
				await ctx.page.evaluate(INPAGE);
				await ctx.sleep(500);
			},
		},
	],
};

/** The code-block edit button only shows while its block is hovered: real pointer, real window. */
const editButtonWindowed: Scene = {
	id: "qc.edit-block-windowed",
	surface: "editor-live-preview",
	source: "catalog:hover-revealed-buttons",
	windowed: true,
	setup: (ctx) => ctx.open("Markdown/Kitchen sink.md", "live"),
	items: [
		{
			id: "qc.edit-block-button.hover",
			component: "clickable-icon",
			target: leaf(".markdown-source-view .cm-embed-block.cm-callout .edit-block-button"),
			pseudo: ["hover"],
			pointer: true,
			state: "hover",
			before: async (ctx) => {
				await ctx.js(
					"cap.ROOTS.leaf().querySelector('.markdown-source-view .cm-embed-block.cm-callout').scrollIntoView({ block: 'center' }); await sleep(300);",
				);
				const block = await center(ctx, leaf(".markdown-source-view .cm-embed-block.cm-callout"));
				await ctx.page.mouse.move(block[0], block[1], { steps: 4 });
				await ctx.sleep(400);
				const btn = await center(
					ctx,
					leaf(".markdown-source-view .cm-embed-block.cm-callout .edit-block-button"),
				);
				await ctx.page.mouse.move(btn[0], btn[1], { steps: 4 });
				await ctx.js("window.__capPointer = arg;", btn);
				await ctx.sleep(400);
			},
			note: "Real pointer in a real window: over the callout block, then onto its edit button.",
		},
	],
};

export function qcScenes(): Scene[] {
	return [
		hoverReveal,
		comboStates,
		editorQc,
		tabsQc,
		dragQc,
		basesQc,
		canvasQc,
		pdfQc,
		recoveryQc,
		searchQc,
		hotkeysQc,
		spellQc,
		graphQc,
		mediaQc,
		windowQc,
		settingsPopoutHover,
		migrationQc,
		gapsQc,
		noPointerQc,
		hotkeyConflict,
		helpWindow,
		dialogsQc,
		settingsDialogs,
		rtlLanguage,
		editButtonWindowed,
		settingsInWindow,
	];
}
