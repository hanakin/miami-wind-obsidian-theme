// Scenes added after the first coverage run: states theme.css styles that the first catalog did
// not reach, and app surfaces that only appear after a specific action.
import { baseLayout, click, rightClick, settingsWindow } from "./scenes.ts";
import type { Ctx, ItemDef, Pseudo, Scene, Target } from "./types.ts";

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
		{
			id: "extra.settings-search-empty",
			component: "search-input",
			target: ".modal.mod-settings",
			state: "search-no-results",
			before: async (ctx) => {
				await click(ctx, ".modal .setting-search-container input");
				await ctx.page.keyboard.type("zzqx", { delay: 20 });
				await ctx.sleep(400);
			},
		},
		{
			id: "extra.settings-search-results",
			component: "search-input",
			target: ".modal.mod-settings",
			state: "search-results",
			before: async (ctx) => {
				await ctx.js("cap.clearSettingsSearch();");
				await click(ctx, ".modal .setting-search-container input");
				await ctx.page.keyboard.type("font", { delay: 20 });
				await ctx.sleep(400);
			},
		},
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
			id: "extra.modal.header-button",
			component: "clickable-icon",
			target: ".modal .modal-header-button",
		},
		p("extra.modal.header-button.hover", "clickable-icon", ".modal .modal-header-button", [
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
			surface: "editor-reading-view",
			target: leaf(".markdown-reading-view .metadata-container.mod-error"),
			before: (ctx) => ctx.open("Markdown/Broken properties.md", "reading"),
			note: "app.css hides the error box in the editor; Reading view shows it.",
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
			expect: ".cm-editor:has(.cm-vimMode)",
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
			expect: ".cm-panels",
			component: "editor-line",
			target: leaf(".cm-panels, .cm-vim-panel"),
			state: "vim-command",
			before: async (ctx) => {
				await ctx.page.keyboard.type(":");
				await ctx.sleep(300);
			},
		},
		{
			id: "extra.image-lightbox",
			component: "lightbox",
			surface: "modal",
			target: ".lightbox",
			full: true,
			before: async (ctx) => {
				await ctx.open("Markdown/Embeds.md", "reading");
				await ctx.js(
					"for (let i = 0; i < 5 && !document.querySelector('.lightbox'); i++) { cap.ROOTS.leaf().querySelector('.markdown-reading-view .image-embed img')?.click(); await sleep(600); }",
				);
			},
		},
		{
			id: "extra.modal.close-button",
			component: "clickable-icon",
			surface: "modal",
			target: ".lightbox .modal-close-button",
			note: "In 1.15.1 only the image lightbox still uses .modal-close-button; other modals use .modal-header-button.",
		},
		p(
			"extra.modal.close-button.hover",
			"clickable-icon",
			".lightbox .modal-close-button.clickable-icon",
			["hover"],
			{
				surface: "modal",
			},
		),
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
		{
			id: "extra.bases.kanban",
			component: "bases-kanban",
			target: leaf(".bases-view"),
			before: async (ctx) => {
				await ctx.command("bases:change-view");
				await ctx.sleep(400);
				await ctx.js(
					"[...document.querySelectorAll('.suggestion-item')].find((e) => e.textContent.includes('Board'))?.click(); await sleep(1200);",
				);
			},
		},
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
			target: ".menu .bases-toolbar-menu-item.is-selected",
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

/** Opens a community browser (its own popout window) from a settings tab's button. */
function communityOpener(tab: string, button: RegExp): (main: Ctx) => Promise<void> {
	return async (main) => {
		await main.js(
			`app.setting.open(); app.setting.openTabById(${JSON.stringify(tab)}); await sleep(800); const doc = app.setting.modalEl?.ownerDocument ?? document; [...doc.querySelectorAll(".modal.mod-settings button")].find((e) => /exit restricted/i.test(e.textContent ?? ""))?.click(); await sleep(800); const b = [...doc.querySelectorAll('.modal.mod-settings button')].find((e) => ${button}.test(e.textContent ?? '')); b?.click(); await sleep(500);`,
		);
	};
}

const pluginBrowser: Scene = {
	id: "extra.community-plugins-browser",
	surface: "community-browser",
	source: "catalog:community-browser",
	window: "popout",
	opener: communityOpener("community-plugins", /browse/i),
	setup: async (ctx) => {
		await ctx.sleep(5000);
	},
	items: [
		{
			id: "extra.community.plugin-browser",
			component: "community-browser",
			target: "body",
			trim: {
				sel: ".community-item",
				keep: 6,
				keepAlso: ".is-selected, .community-item-badge, .mod-unavailable, [data-capture-state]",
			},
			full: true,
			note: "Loads the community plugin list over the network; opens in its own popout window.",
		},
		{
			id: "extra.community.plugin-details",
			expect: ":has(.community-modal-details)",
			component: "community-browser",
			target: "body",
			state: "details",
			trim: {
				sel: ".community-item",
				keep: 6,
				keepAlso: ".is-selected, .community-item-badge, .mod-unavailable, [data-capture-state]",
			},
			full: true,
			before: async (ctx) => {
				await ctx.js("document.querySelector('.community-item')?.click(); await sleep(5000);");
			},
		},
	],
};

const themeBrowser: Scene = {
	id: "extra.community-themes-browser",
	surface: "community-browser",
	source: "catalog:community-browser",
	window: "popout",
	opener: communityOpener("appearance", /manage/i),
	setup: async (ctx) => {
		await ctx.sleep(5000);
	},
	items: [
		{
			id: "extra.community.theme-browser",
			expect: ":has(.community-item)",
			component: "community-browser",
			target: "body",
			state: "themes",
			trim: {
				sel: ".community-item",
				keep: 6,
				keepAlso: ".is-selected, .community-item-badge, .mod-unavailable, [data-capture-state]",
			},
			full: true,
		},
	],
};

const more: Scene = {
	id: "extra.more",
	surface: "workspace",
	source: "catalog:more-surfaces",
	setup: (ctx) => baseLayout(ctx),
	items: [
		{
			id: "extra.search-suggest",
			component: "suggestion",
			surface: "suggestion-popup",
			target: ".suggestion-container.mod-search-suggestion",
			before: async (ctx) => {
				await ctx.js(
					"const l = app.workspace.getLeavesOfType('search')[0]; app.workspace.revealLeaf(l); l.view.setQuery(''); await sleep(300);",
				);
				await click(
					ctx,
					'.workspace-leaf-content[data-type="search"] .search-input-container input',
				);
				await ctx.sleep(500);
			},
		},
		{
			id: "extra.search-explain",
			component: "search-result",
			surface: "left-sidebar",
			target: '.workspace-leaf-content[data-type="search"]',
			state: "explain-search",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.js(
					"const l = app.workspace.getLeavesOfType('search')[0]; l.view.setExplainSearch?.(true); l.view.setQuery('heading -windsurf'); await sleep(1200);",
				);
			},
		},
		{
			id: "extra.graph-color-group",
			expect: ":has(.graph-color-group)",
			component: "graph-controls",
			surface: "graph",
			target: ".graph-controls",
			state: "color-group",
			before: async (ctx) => {
				await ctx.command("graph:open");
				await ctx.sleep(1500);
				await ctx.js(
					"document.querySelectorAll('.graph-controls .tree-item.is-collapsed .tree-item-self').forEach((e) => e.click()); await sleep(300); [...document.querySelectorAll('.graph-controls button')].find((b) => /new group/i.test(b.textContent ?? ''))?.click(); await sleep(600);",
				);
			},
		},
		{
			id: "extra.slides",
			component: "slides",
			surface: "slides",
			target: ".slides-container",
			full: true,
			before: async (ctx) => {
				await ctx.open("Markdown/Kitchen sink.md", "live");
				await ctx.command("slides:start");
				await ctx.sleep(1500);
			},
		},
	],
};

const settingsPage: Scene = {
	id: "extra.settings-page",
	surface: "settings",
	source: "catalog:settings-subpage",
	window: "popout",
	opener: settingsWindow("interface"),
	setup: async (ctx) => {
		await ctx.js(
			"cap.clearSettingsSearch(); for (const t of app.setting.settingTabs) { app.setting.openTabById(t.id); await sleep(200); const nav = document.querySelector('.modal.mod-settings .setting-item.mod-navigable'); if (nav) { nav.click(); await sleep(600); break; } }",
		);
	},
	items: [
		{
			id: "extra.settings-subpage",
			component: "settings-page",
			target: ".modal.mod-settings",
			state: "sub-page",
			note: "A navigable setting row (chevron) opens a sub-page inside the settings window.",
		},
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
		more,
		settingsPage,
		pluginBrowser,
		themeBrowser,
	];
}
