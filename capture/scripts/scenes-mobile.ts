// Emulated mobile app: Obsidian's own app.emulateMobile(true) in the isolated profile, at phone
// (390x844, is-phone) and tablet (1024x768, is-tablet) size, without a mouse. Captured by
// `capture:run --mobile phone` and `--mobile tablet`. Real devices are out of scope.
import { click } from "./scenes.ts";
import type { Ctx, ItemDef, Scene } from "./types.ts";

const EMULATED =
	"Emulated mobile (app.emulateMobile in desktop Obsidian 1.15.1), not a real device.";

async function closeAll(ctx: Ctx): Promise<void> {
	for (let i = 0; i < 6; i++) {
		const open = await ctx.js<number>(
			"return cap.overlays() + (document.querySelector('.mobile-tab-switcher')?.isConnected && app.mobileTabSwitcher?.isVisible ? 1 : 0);",
		);
		if (!open) break;
		await ctx.js("app.mobileTabSwitcher?.isVisible && app.mobileTabSwitcher.hide();");
		await ctx.page.keyboard.press("Escape");
		await ctx.sleep(200);
	}
	await ctx.js(
		"app.workspace.leftSplit.collapse?.(); app.workspace.rightSplit.collapse?.(); document.activeElement?.blur?.(); await sleep(400);",
	);
}

const openNote = (file: string, mode: "live" | "reading") => async (ctx: Ctx) => {
	await closeAll(ctx);
	await ctx.open(file, mode);
	await ctx.sleep(500);
};

/** Opens a Bases toolbar menu: its own toolbar button, or on a phone the gear sheet's entry. */
async function basesMenu(ctx: Ctx, name: "Filter" | "Properties", button: string): Promise<void> {
	const own = await ctx.js<boolean>(
		`return !![...document.querySelectorAll(${JSON.stringify(button)})].find((e) => e.getClientRects().length);`,
	);
	if (own) {
		await click(ctx, { sel: button, in: "leaf" });
	} else {
		await click(ctx, { sel: ".bases-toolbar-display-menu", in: "leaf" });
		await ctx.sleep(700);
		const at = await ctx.js<[number, number] | null>(
			`const it = [...document.querySelectorAll('.menu .bases-toolbar-menu-item, .menu .menu-item')].find((i) => i.textContent.trim().startsWith(${JSON.stringify(name)})); if (!it) return null; const r = it.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];`,
		);
		if (!at) throw new Error(`no ${name} entry in the Bases menu`);
		await ctx.page.mouse.click(at[0], at[1]);
	}
	await ctx.sleep(900);
}

/** Items shared by phone and tablet; ids are prefixed with the size. */
function items(size: "phone" | "tablet"): ItemDef[] {
	const id = (s: string) => `mobile.${size}.${s}`;
	const surface = `mobile-${size}`;
	const note = (extra?: string) => (extra ? `${EMULATED} ${extra}` : EMULATED);
	return [
		{
			id: id("workspace"),
			component: "workspace",
			surface,
			target: ".app-container",
			full: true,
			expect: ".app-container",
			before: openNote("Markdown/Kitchen sink.md", "reading"),
			note: note("Reading view with the mobile navigation bar."),
		},
		{
			id: id("navbar"),
			component: "mobile-navbar",
			surface,
			target: ".mobile-navbar",
			expect: ":has(.mobile-navbar-actions)",
			note: note(),
		},
		{
			id: id("editor-toolbar"),
			component: "mobile-toolbar",
			surface,
			target: ".mobile-toolbar",
			expect: ":has(.mobile-toolbar-option)",
			before: async (ctx) => {
				await openNote("Markdown/Kitchen sink.md", "live")(ctx);
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; e.focus(); e.setCursor({ line: 6, ch: 2 }); await sleep(700);",
				);
			},
			note: note("Editing shows the mobile editing toolbar."),
		},
		{
			id: id("left-drawer"),
			component: "workspace-drawer",
			surface,
			target: ".workspace-drawer.mod-left",
			expect: ":has(.workspace-drawer-inner)",
			full: true,
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.js("app.workspace.leftSplit.expand(); await sleep(900);");
			},
			note: note("The left sidebar as a drawer (vault switcher, tabs, file explorer)."),
		},
		{
			id: id("drawer-tab-list"),
			component: "workspace-drawer",
			surface,
			target: ".workspace-drawer.mod-left .workspace-drawer-tab-options:not(.is-collapsed)",
			expect: ":has(.workspace-drawer-tab-options-list .workspace-tab-header)",
			before: async (ctx) => {
				const at = await ctx.js<[number, number] | null>(
					"const c = [...document.querySelectorAll('.workspace-drawer.mod-left .workspace-tab-header-inner-chevron')].find((e) => e.getClientRects().length); if (!c) return null; const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
				);
				if (!at) throw new Error("no tab chooser in the drawer");
				await ctx.page.mouse.click(at[0], at[1]);
				await ctx.sleep(700);
			},
			note: note("The drawer's tab chooser opened (list of sidebar tabs)."),
		},
		{
			id: id("right-drawer"),
			component: "workspace-drawer",
			surface,
			target: ".workspace-drawer.mod-right",
			expect: ":has(.workspace-drawer-inner)",
			full: true,
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.js("app.workspace.rightSplit.expand(); await sleep(900);");
			},
			note: note(),
		},
		{
			id: id("tab-switcher"),
			component: "mobile-tab-switcher",
			surface,
			target: ".mobile-tab-switcher",
			expect: ":has(.mobile-tab)",
			full: true,
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.js(
					"app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.setPinned(true); await sleep(200); app.mobileTabSwitcher.show(); await sleep(1500);",
				);
			},
			note: note("The active tab is pinned first, so its card shows the pin."),
		},
		{
			id: id("menu"),
			component: "menu",
			surface,
			target: ".menu",
			expect: size === "phone" ? ".menu.mod-sheet" : ".menu",
			full: size === "phone",
			before: async (ctx) => {
				await ctx.js(
					"app.mobileTabSwitcher?.hide?.(); app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.setPinned(false); await sleep(300);",
				);
				await openNote("Markdown/Kitchen sink.md", "reading")(ctx);
				const at = await ctx.js<[number, number] | null>(
					"const b = [...document.querySelectorAll('.workspace-leaf.mod-active .view-header .view-actions > .view-action')].filter((e) => e.getClientRects().length).at(-1); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
				);
				if (!at) throw new Error("no menu button");
				await ctx.page.mouse.click(at[0], at[1]);
				await ctx.sleep(900);
			},
			note: note(
				size === "phone" ? "On a phone, menus open as bottom sheets (.menu.mod-sheet)." : undefined,
			),
		},
		{
			id: id("file-menu"),
			component: "menu",
			surface,
			target: ".menu",
			expect:
				size === "phone"
					? ".menu.mod-sheet:has(.menu-item.is-warning)"
					: ":has(.menu-item.is-warning)",
			full: size === "phone",
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.js("app.workspace.leftSplit.expand(); await sleep(900);");
				const at = await ctx.js<[number, number] | null>(
					"const e = [...document.querySelectorAll('.workspace-drawer .nav-file-title')].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
				);
				if (!at) throw new Error("no file in the drawer");
				await ctx.page.mouse.click(at[0], at[1], { button: "right" });
				await ctx.sleep(900);
			},
			note: note(
				"A file's context menu from the file explorer drawer, with the destructive Delete item.",
			),
		},
		{
			id: id("command-palette"),
			component: "prompt",
			surface,
			target: ".prompt",
			expect: ":has(.suggestion-item)",
			full: size === "phone",
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.command("command-palette:open");
				await ctx.sleep(900);
			},
			note: note(),
		},
		{
			id: id("quick-switcher"),
			component: "prompt",
			surface,
			target: ".prompt",
			expect: ":has(.suggestion-item)",
			full: size === "phone",
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.command("switcher:open");
				await ctx.sleep(600);
				await ctx.page.keyboard.type("Kit", { delay: 40 });
				await ctx.sleep(600);
			},
			note: note(),
		},
		{
			id: id("link-suggest"),
			component: "suggestion",
			surface,
			target: ".suggestion-container",
			expect: ":has(.suggestion-item)",
			full: size === "phone",
			before: async (ctx) => {
				await openNote("Markdown/Gaps.md", "live")(ctx);
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; e.focus(); const n = e.lineCount() - 1; e.setCursor({ line: n, ch: 0 }); await sleep(300);",
				);
				await ctx.page.keyboard.type("[[Kit", { delay: 40 });
				await ctx.sleep(900);
			},
			note: note("Link suggestions while typing [[ in the editor."),
		},
		{
			id: id("confirm-modal"),
			component: "modal",
			surface,
			target: ".modal",
			expect: ":has(.modal-button-container)",
			full: size === "phone",
			before: async (ctx) => {
				await ctx.js("app.workspace.activeEditor?.editor?.undo?.(); await sleep(100);");
				await closeAll(ctx);
				await ctx.js(
					"app.fileManager.promptForDeletion(app.vault.getAbstractFileByPath('Markdown/Gaps.md')); await sleep(900);",
				);
			},
			note: note("The delete confirmation; it is cancelled, nothing is deleted."),
		},
		{
			id: id("settings"),
			component: "modal",
			surface,
			target: ".modal.mod-settings",
			expect: ".mod-settings:has(.vertical-tab-nav-item)",
			full: true,
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.js("app.setting.open(); await sleep(1200);");
			},
			note: note(size === "phone" ? "On a phone, Settings opens as a list of pages." : undefined),
		},
		{
			id: id("settings-page"),
			component: "modal",
			surface,
			target: ".modal.mod-settings",
			expect: ".mod-settings:has(.vertical-tab-content .setting-item)",
			full: true,
			before: async (ctx) => {
				const at = await ctx.js<[number, number] | null>(
					"const it = [...document.querySelectorAll('.modal.mod-settings .vertical-tab-nav-item')].find((e) => e.getClientRects().length && /^Editor$/.test(e.textContent.trim())); if (!it) return null; it.scrollIntoView({ block: 'center' }); await sleep(200); const r = it.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
				);
				if (at) await ctx.page.mouse.click(at[0], at[1]);
				else await ctx.js("app.setting.openTabById('editor');");
				await ctx.sleep(1000);
			},
			note: note(
				"A Settings page (Editor), opened by tapping its entry; on a phone it slides in with a back button.",
			),
		},
		{
			id: id("bases"),
			component: "bases-view",
			surface,
			target: ".app-container",
			full: true,
			expect: ".app-container:has(.bases-view)",
			before: async (ctx) => {
				await closeAll(ctx);
				await ctx.js(
					"const ws = app.workspace; const l = ws.getMostRecentLeaf(ws.rootSplit); await l.setViewState({ type: 'bases', state: { file: 'Base.base', viewName: 'Table view' }, active: true }); ws.setActiveLeaf(l, { focus: true }); await sleep(1500);",
				);
			},
			note: note(),
		},
		{
			id: id("bases-settings-menu"),
			component: "menu",
			surface,
			target: ".menu",
			expect: ":has(.bases-toolbar-menu-item)",
			full: true,
			before: async (ctx) => {
				await click(ctx, { sel: ".bases-toolbar-display-menu", in: "leaf" });
				await ctx.sleep(900);
			},
			note: note(
				"The Bases view settings menu (on a phone it also holds Filter, Sort, Group and Properties).",
			),
		},
		{
			id: id("bases-filter"),
			component: "filter-row",
			surface,
			target: ".menu",
			expect:
				size === "phone"
					? ".menu.mod-sheet:has(.bases-filter-page .filter-row)"
					: ":has(.filter-row)",
			full: true,
			before: async (ctx) => {
				await closeAll(ctx);
				await basesMenu(ctx, "Filter", ".bases-toolbar-filter-menu");
			},
			note: note(
				size === "phone" ? "The Bases filter editor as a sheet with its filter rows." : undefined,
			),
		},
		{
			id: id("bases-properties"),
			component: "menu",
			surface,
			target: ".menu",
			expect: ":has(.bases-toolbar-menu-item)",
			full: true,
			before: async (ctx) => {
				await closeAll(ctx);
				await basesMenu(ctx, "Properties", ".bases-toolbar-properties-menu");
			},
			note: note("The Bases properties menu (menu item icons)."),
		},
	];
}

/** Phone-only surfaces: the bottom navigation bar and the Bases settings sheet (tablets show the full toolbar). */
const PHONE_ONLY = new Set(["navbar", "bases-settings-menu"]);

function scene(size: "phone" | "tablet"): Scene {
	return {
		id: `mobile.${size}`,
		surface: `mobile-${size}`,
		source: `catalog:emulated-${size}`,
		mobile: size,
		setup: async (ctx) => {
			await ctx.sleep(500);
		},
		items: items(size).filter(
			(i) => size === "phone" || !PHONE_ONLY.has(i.id.split(".").at(-1) ?? ""),
		),
	};
}

export function mobileScenes(): Scene[] {
	return [scene("phone"), scene("tablet")];
}
