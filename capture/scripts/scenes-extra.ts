// Scenes added after the first coverage run: states theme.css styles that the first catalog did
// not reach, and app surfaces that only appear after a specific action.
import { baseLayout, click, rightClick, settingsWindow } from "./scenes.ts";
import type { ItemDef, Pseudo, Scene, Target } from "./types.ts";

const p = (
	id: string,
	component: string,
	target: Target,
	pseudo: Pseudo[],
	extra: Partial<ItemDef> = {},
): ItemDef => ({ id, component, target, pseudo, state: pseudo.join("+"), ...extra });

const leaf = (sel: string): Target => ({ sel, in: "leaf" });

const links: Scene = {
	id: "extra.links",
	surface: "editor-reading-view",
	source: "catalog:link-states",
	setup: (ctx) => ctx.open("Markdown/Links.md", "reading"),
	items: [
		p("extra.link.visited", "internal-link", leaf(".markdown-reading-view a.internal-link"), [
			"visited",
		]),
		p("extra.link.active", "internal-link", leaf(".markdown-reading-view a.internal-link"), [
			"active",
		]),
		p("extra.link.hover-visited", "internal-link", leaf(".markdown-reading-view a.internal-link"), [
			"hover",
			"visited",
		]),
		p("extra.link.hover-active", "internal-link", leaf(".markdown-reading-view a.internal-link"), [
			"hover",
			"active",
		]),
		p(
			"extra.external-link.visited",
			"external-link",
			leaf(".markdown-reading-view a.external-link"),
			["visited"],
		),
	],
};

const sidebarStates: Scene = {
	id: "extra.sidebar",
	surface: "left-sidebar",
	source: "catalog:sidebar-states",
	setup: async (ctx) => {
		await baseLayout(ctx);
	},
	items: [
		p(
			"extra.left-tab.hover",
			"tab-header",
			".mod-left-split .workspace-tab-header:not(.is-active)",
			["hover"],
		),
		p(
			"extra.left-tab.active.hover",
			"tab-header",
			".mod-left-split .workspace-tab-header.is-active",
			["hover"],
		),
		p(
			"extra.sidebar-icon.active",
			"clickable-icon",
			".mod-left-split .workspace-tabs .nav-action-button",
			["active"],
		),
		{
			id: "extra.tab-list.has-active-menu",
			component: "clickable-icon",
			surface: "workspace",
			target: ".workspace-tabs .has-active-menu",
			state: "has-active-menu",
			before: (ctx) => click(ctx, ".mod-root .workspace-tab-header-tab-list .clickable-icon"),
		},
		{
			id: "extra.menu.keyboard-selected",
			component: "menu-item",
			surface: "menu",
			target: ".menu .menu-item.selected",
			state: "selected",
			before: async (ctx) => {
				await ctx.page.keyboard.press("ArrowDown");
				await ctx.page.keyboard.press("ArrowDown");
				await ctx.sleep(200);
			},
		},
		p("extra.menu-item.focus", "menu-item", ".menu .menu-item", ["focus"], { surface: "menu" }),
		p("extra.menu-item.active", "menu-item", ".menu .menu-item", ["active"], { surface: "menu" }),
		{
			id: "extra.menu-item.disabled.hover",
			component: "menu-item",
			surface: "menu",
			target: ".menu .menu-item.is-disabled",
			pseudo: ["hover"],
			state: "disabled+hover",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.open("Markdown/Kitchen sink.md", "live");
				await ctx.js("app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });");
				await rightClick(ctx, leaf(".cm-line"));
			},
			note: "Editor menu with nothing selected: Cut and Copy are disabled.",
		},
	],
};

const selectStates: Scene = {
	id: "extra.select-states",
	surface: "settings",
	source: "catalog:form-control-states",
	window: "popout",
	opener: settingsWindow("editor"),
	setup: async (ctx) => {
		await ctx.js("cap.clearSettingsSearch(); app.setting.openTabById('editor'); await sleep(500);");
	},
	items: [
		p("extra.select.focus-visible", "dropdown", ".modal select.dropdown", ["focus-visible"]),
		p("extra.select.focus-within", "dropdown", ".modal select.dropdown", ["focus-within"]),
		p("extra.select-option.hover", "dropdown", ".modal select.dropdown option", ["hover"]),
		p("extra.select-option.checked.hover", "dropdown", ".modal select.dropdown option:checked", [
			"hover",
		]),
	],
};

const formControls: Scene = {
	id: "extra.form-controls",
	surface: "modal",
	source: "catalog:form-control-states",
	setup: async (ctx) => {
		await ctx.command("app:show-debug-info");
		await ctx.sleep(800);
	},
	items: [
		{ id: "extra.modal.shell", component: "modal", target: ".modal-container", full: true },
		{
			id: "extra.modal.close-button",
			component: "clickable-icon",
			target: ".modal .modal-close-button",
		},
		p("extra.modal.close-button.hover", "clickable-icon", ".modal-close-button.clickable-icon", [
			"hover",
		]),
		p("extra.modal.button.hover", "button", ".modal button", ["hover"]),
		{
			id: "extra.textarea.focus",
			component: "textarea",
			target: ".modal textarea",
			pseudo: ["focus"],
			state: "focus",
		},
		p("extra.textarea.focus-visible", "textarea", ".modal textarea", ["focus-visible"], {
			surface: "modal",
		}),
		p("extra.textarea.focus-within", "textarea", ".modal textarea", ["focus-within"], {
			surface: "modal",
		}),
		{
			id: "extra.prompt-input.hover",
			component: "text-input",
			surface: "modal",
			target: "input.prompt-input",
			pseudo: ["hover"],
			state: "hover",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.command("command-palette:open");
				await ctx.sleep(400);
			},
		},
	],
};

const editorExtras: Scene = {
	id: "extra.editor",
	surface: "editor-live-preview",
	source: "catalog:editor-extras",
	setup: (ctx) => ctx.open("Markdown/Tags.md", "live"),
	items: [
		{
			id: "extra.hashtag-begin.hover",
			component: "tag",
			target: leaf(".markdown-source-view .cm-line .cm-hashtag-begin"),
			pseudo: ["hover"],
			state: "hover",
			before: async (ctx) => {
				await ctx.js("app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });");
			},
		},
		{
			id: "extra.hashtag-begin.hover-line",
			component: "tag",
			target: leaf(".markdown-source-view .cm-line:has(.cm-hashtag-begin)"),
			pseudo: ["hover"],
			pseudoOn: leaf(".markdown-source-view .cm-hashtag-begin"),
			state: "hover",
		},
		p(
			"extra.code-block-flair.hover",
			"code-block",
			leaf(".markdown-source-view .code-block-flair"),
			["hover"],
			{
				before: (ctx) => ctx.open("Markdown/Code.md", "live"),
			},
		),
		{
			id: "extra.properties-invalid",
			component: "metadata-container",
			target: leaf(".markdown-source-view .metadata-container"),
			state: "invalid-yaml",
			before: (ctx) => ctx.open("Markdown/Broken properties.md", "live"),
		},
		p("extra.properties-show-source.hover", "button", leaf(".metadata-show-source-button"), [
			"hover",
		]),
		{
			id: "extra.property-value-suggest",
			component: "suggestion",
			surface: "suggestion-popup",
			target: ".suggestion-container.mod-property-value",
			before: async (ctx) => {
				await ctx.open("Markdown/Properties.md", "live");
				await click(
					ctx,
					leaf('.metadata-property[data-property-key="link"] .metadata-property-value'),
				);
				await ctx.page.keyboard.press("End");
				await ctx.page.keyboard.type("[[He", { delay: 40 });
				await ctx.sleep(600);
			},
		},
		{
			id: "extra.property-value-suggest-item",
			component: "suggestion",
			surface: "suggestion-popup",
			target: ".suggestion-container.mod-property-value .suggestion-item",
		},
		p(
			"extra.property-value-suggest-item.hover",
			"suggestion",
			".suggestion-container.mod-property-value .suggestion-item:not(.is-selected)",
			["hover"],
			{ surface: "suggestion-popup" },
		),
		{
			id: "extra.vim-mode",
			component: "editor-line",
			target: leaf(".markdown-source-view .cm-editor"),
			state: "vim-normal-mode",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.js("app.vault.setConfig('vimMode', true); await sleep(300);");
				await ctx.open("Markdown/Kitchen sink.md", "source");
				await ctx.js(
					"app.workspace.activeEditor.editor.focus(); app.workspace.activeEditor.editor.setCursor({ line: 6, ch: 2 }); await sleep(300);",
				);
			},
		},
		{
			id: "extra.vim-command-panel",
			component: "editor-line",
			target: leaf(".cm-panels, .cm-vim-panel"),
			state: "vim-command",
			before: async (ctx) => {
				await ctx.page.keyboard.type(":");
				await ctx.sleep(300);
			},
		},
		{
			id: "extra.placeholder",
			component: "editor-line",
			target: leaf(".markdown-source-view .cm-placeholder, .markdown-source-view .cm-content"),
			state: "empty-note",
			before: async (ctx) => {
				await ctx.js(
					"if (!app.vault.getAbstractFileByPath('Empty note.md')) await app.vault.create('Empty note.md', ''); await sleep(200);",
				);
				await ctx.open("Empty note.md", "live");
				await ctx.js("app.workspace.activeEditor.editor.focus(); await sleep(300);");
			},
		},
		{
			id: "extra.indentation-guide-active",
			component: "list",
			target: leaf(".markdown-source-view .cm-content"),
			state: "active-indent",
			before: async (ctx) => {
				await ctx.open("Markdown/Lists and tasks.md", "live");
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; const n = e.getValue().split('\\n').findIndex((l) => l.includes('Deep nested bullet')); e.focus(); e.setCursor({ line: n, ch: 6 }); await sleep(300);",
				);
			},
		},
	],
};

const recovery: Scene = {
	id: "extra.file-recovery",
	surface: "modal",
	source: "catalog:file-recovery",
	setup: async (ctx) => {
		await ctx.js(
			"const fr = app.internalPlugins.plugins['file-recovery'].instance; const f = app.vault.getAbstractFileByPath('Markdown/Kitchen sink.md'); const now = await app.vault.read(f); await fr.forceAdd(f.path, now.replace('Kitchen sink', 'Kitchen sink (older)') + '\\nAn older line.'); await sleep(300);",
		);
		await ctx.command("file-recovery:open");
		await ctx.sleep(600);
		await ctx.js(
			"const item = [...document.querySelectorAll('.modal .suggestion-item, .modal .tree-item-self, .modal .file-recovery-list-item, .modal-sidebar-list-item')].find((e) => (e.textContent ?? '').includes('Kitchen sink')); item?.click(); await sleep(800);",
		);
	},
	items: [
		{ id: "extra.file-recovery.modal", component: "modal", target: ".modal-container", full: true },
		{
			id: "extra.file-recovery.diff",
			component: "diff",
			target: ".modal-container",
			state: "diff",
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"const b = [...document.querySelectorAll('.modal button, .modal .clickable-icon')].find((e) => /diff|compare/i.test((e.getAttribute('aria-label') ?? '') + e.textContent)); b?.click(); await sleep(800);",
				);
			},
		},
	],
};

const community: Scene = {
	id: "extra.community",
	surface: "modal",
	source: "catalog:community-browser",
	window: "popout",
	opener: settingsWindow("community-plugins"),
	setup: async (ctx) => {
		await ctx.js(
			"cap.clearSettingsSearch(); app.setting.openTabById('community-plugins'); await sleep(600);",
		);
	},
	items: [
		{
			id: "extra.community.restricted",
			component: "settings-page",
			target: ".modal.mod-settings",
			state: "restricted-mode",
		},
		{
			id: "extra.community.enabled",
			component: "settings-page",
			target: ".modal.mod-settings",
			state: "community-plugins-on",
			before: async (ctx) => {
				await ctx.js(
					"const b = [...document.querySelectorAll('.modal.mod-settings button')].find((e) => /turn on|restricted/i.test(e.textContent ?? '')); b?.click(); await sleep(1200);",
				);
			},
		},
		{
			id: "extra.community.plugin-browser",
			component: "community-browser",
			target: ".modal-container:last-child",
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"const b = [...document.querySelectorAll('.modal.mod-settings button')].find((e) => /browse/i.test(e.textContent ?? '')); b?.click(); await sleep(6000);",
				);
			},
			note: "Loads the community plugin list over the network.",
		},
		{
			id: "extra.community.plugin-details",
			component: "community-browser",
			target: ".modal-container:last-child",
			state: "details",
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"document.querySelector('.modal-container:last-child .community-item')?.click(); await sleep(5000);",
				);
			},
		},
		{
			id: "extra.community.theme-browser",
			component: "community-browser",
			target: ".modal-container:last-child",
			state: "themes",
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"document.querySelectorAll('.modal-container .modal-close-button').forEach((b) => b.click()); await sleep(300); app.setting.openTabById('appearance'); await sleep(500); const b = [...document.querySelectorAll('.modal.mod-settings button')].find((e) => /manage/i.test(e.textContent ?? '')); b?.click(); await sleep(6000);",
				);
			},
		},
	],
};

const canvasExtras: Scene = {
	id: "extra.canvas",
	surface: "canvas",
	source: "catalog:canvas-extras",
	setup: async (ctx) => {
		await ctx.open("Canvas.canvas", "live");
		await ctx.js("app.workspace.activeLeaf.view.canvas?.zoomToFit?.(); await sleep(600);");
	},
	items: [
		{
			id: "extra.canvas.node-hover",
			component: "canvas-node",
			target: { sel: ".canvas-node", text: "Colored card 2" },
			state: "pointer-over",
			before: async (ctx) => {
				const b = await ctx.js<[number, number]>(
					"const n = [...document.querySelectorAll('.canvas-node')].find((e) => e.textContent.includes('Colored card 2')); const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
				);
				await ctx.page.mouse.move(b[0], b[1], { steps: 4 });
				await ctx.sleep(400);
			},
		},
		{
			id: "extra.canvas.selection-box",
			component: "canvas",
			target: ".canvas-wrapper",
			state: "drag-select",
			full: true,
			before: async (ctx) => {
				const b = await ctx.js<[number, number]>(
					"const r = cap.ROOTS.leaf().querySelector('.canvas-wrapper').getBoundingClientRect(); return [r.x + 30, r.bottom - 40];",
				);
				await ctx.page.mouse.move(b[0], b[1]);
				await ctx.page.mouse.down();
				await ctx.page.mouse.move(b[0] + 300, b[1] - 300, { steps: 8 });
				await ctx.sleep(300);
			},
		},
		{
			id: "extra.canvas.after-select",
			component: "canvas",
			target: ".canvas-wrapper",
			state: "multi-selected",
			full: true,
			before: async (ctx) => {
				await ctx.page.mouse.up();
				await ctx.sleep(400);
			},
		},
		{
			id: "extra.canvas.help",
			component: "canvas",
			surface: "modal",
			target: ".modal-container",
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"const b = [...document.querySelectorAll('.canvas-control-item')].find((e) => /help/i.test(e.getAttribute('aria-label') ?? '')); b?.click(); await sleep(600);",
				);
			},
		},
	],
};

const basesExtras: Scene = {
	id: "extra.bases",
	surface: "bases",
	source: "catalog:bases-extras",
	setup: (ctx) => ctx.open("Base.base", "live"),
	items: [
		p("extra.bases.toolbar-button.hover", "button", leaf(".bases-toolbar-item .text-icon-button"), [
			"hover",
		]),
		{
			id: "extra.bases.combobox.focus",
			component: "combobox",
			surface: "menu",
			target: ".combobox-button",
			pseudo: ["focus"],
			state: "focus",
			before: (ctx) => click(ctx, leaf(".bases-toolbar-filter-menu")),
		},
		p("extra.bases.combobox.focus-visible", "combobox", ".combobox-button", ["focus-visible"], {
			surface: "menu",
		}),
		{
			id: "extra.bases.menu.keyboard-selected",
			component: "menu-item",
			surface: "menu",
			target:
				".menu .bases-toolbar-menu-item.selected, .menu .menu-item.selected, .menu .is-selected",
			state: "selected",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await click(ctx, leaf(".bases-toolbar-properties-menu"));
				await ctx.page.keyboard.press("ArrowDown");
				await ctx.page.keyboard.press("ArrowDown");
				await ctx.sleep(200);
			},
		},
		p("extra.bases.menu-item.focus", "menu-item", ".menu .bases-toolbar-menu-item", ["focus"], {
			surface: "menu",
		}),
		p("extra.bases.menu-item.active", "menu-item", ".menu .bases-toolbar-menu-item", ["active"], {
			surface: "menu",
		}),
	],
};

export function extraScenes(): Scene[] {
	return [
		basesExtras,
		selectStates,
		links,
		sidebarStates,
		formControls,
		editorExtras,
		recovery,
		canvasExtras,
		community,
	];
}
