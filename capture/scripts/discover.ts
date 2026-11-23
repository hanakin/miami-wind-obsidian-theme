// Reads the checklist's app-driven part from the running app: every command (run once to see
// what UI it opens), every settings tab and every registered view type.
import type { Page } from "playwright";
import { install, makeCtx, resetUi } from "./engine.ts";
import type { Session } from "./obsidian.ts";
import type { Ctx, ItemDef, Scene, Target } from "./types.ts";

export interface AppInventory {
	version: string;
	commands: { id: string; name: string }[];
	settingTabs: { id: string; name: string; plugin: boolean }[];
	views: string[];
	corePlugins: { id: string; name: string; enabled: boolean }[];
}

export type Outcome =
	| { kind: "modal" }
	| { kind: "menu" }
	| { kind: "notice" }
	| { kind: "suggest" }
	| { kind: "view"; type: string }
	| { kind: "window"; url: string }
	| { kind: "state"; classes: string[] }
	| { kind: "none" }
	| { kind: "unavailable" }
	| { kind: "skipped"; reason: string };

export interface CommandResult {
	id: string;
	name: string;
	context?: string;
	outcome: Outcome;
}

/** Commands we never run, with the reason. */
export const SKIP: Record<string, string> = {
	"app:reload": "reloads the whole app; same UI as startup",
	"workspace:close-window": "closes the main window and ends the session",
	"open-with-default-app:open": "hands the file to the desktop's default app (outside Obsidian)",
	"open-with-default-app:show": "opens the desktop file manager (outside Obsidian)",
	"app:open-help": "opens the help site in the system browser (outside Obsidian)",
	"publish:open-in-live-site": "opens the system browser (outside Obsidian)",
	"editor:attach-file": "opens the native file picker (outside Obsidian's DOM)",
	"app:open-file": "opens the native file picker (outside Obsidian's DOM)",
	"audio-recorder:start":
		"records from the microphone; the recording status bar item is captured instead",
	"audio-recorder:stop": "only valid while recording",
	"editor:download-attachments": "downloads remote files into the vault; no own UI",
	"app:open-sandbox-vault": "opens a second vault window whose chrome matches the main window",
	"mobile:quick-action": "mobile only",
	"app:delete-file":
		"deletes the active file; the delete confirmation is captured from the file menu instead",
	"graph:animate": "time-lapse animation of the graph view; the graph view is captured directly",
};

/** How to undo commands that toggle global state. */
function undoOf(id: string): string | undefined {
	if (id === "window:zoom-in" || id === "window:zoom-out") return "window:reset-zoom";
	if (id === "app:increase-font-size") return "app:decrease-font-size";
	if (id === "app:decrease-font-size") return "app:increase-font-size";
	if (
		/toggle/.test(id) &&
		!id.startsWith("editor:toggle-") &&
		!id.startsWith("workspace:toggle-pin")
	)
		return id;
	if (id === "editor:toggle-readable-line-length" || id === "editor:toggle-line-numbers") return id;
	if (id === "editor:toggle-spellcheck") return id;
	return undefined;
}

export async function inventory(page: Page): Promise<AppInventory> {
	await install(page);
	return (await page.evaluate(`(() => ({
		version: require("electron").ipcRenderer.sendSync("version"),
		commands: Object.values(app.commands.commands).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.id.localeCompare(b.id)),
		settingTabs: [
			...app.setting.settingTabs.map((t) => ({ id: t.id, name: t.name, plugin: false })),
			...app.setting.pluginTabs.map((t) => ({ id: t.id, name: t.name, plugin: true })),
		],
		views: Object.keys(app.viewRegistry.viewByType).sort(),
		corePlugins: Object.entries(app.internalPlugins.plugins).map(([id, p]) => ({ id, name: p.instance?.name ?? id, enabled: p.enabled })),
	}))()`)) as AppInventory;
}

/** Contexts tried in order until a command accepts. */
const CONTEXTS: { id: string; setup: (ctx: Ctx) => Promise<void> }[] = [
	{
		id: "note",
		setup: async (ctx) => {
			await ctx.open("Markdown/Kitchen sink.md", "live");
			await ctx.js(
				"const e = app.workspace.activeEditor.editor; e.focus(); const n = e.getValue().split('\\n').findIndex((l) => l.startsWith('Text with')); e.setSelection({ line: n, ch: 10 }, { line: n, ch: 14 });",
			);
		},
	},
	{
		id: "table",
		setup: async (ctx) => {
			await ctx.open("Markdown/Tables.md", "source");
			await ctx.js(
				"const e = app.workspace.activeEditor.editor; e.focus(); e.setCursor({ line: 4, ch: 3 });",
			);
		},
	},
	{
		id: "heading",
		setup: async (ctx) => {
			await ctx.open("Markdown/Headings.md", "source");
			await ctx.js(
				"const e = app.workspace.activeEditor.editor; e.focus(); e.setCursor({ line: 4, ch: 4 });",
			);
		},
	},
	{
		id: "canvas",
		setup: async (ctx) => {
			await ctx.open("Canvas.canvas", "live");
			await ctx.js(
				"await sleep(500); const c = app.workspace.activeLeaf.view.canvas; const g = [...c.nodes.values()].find((n) => n.label); c.selectOnly(g); await sleep(200);",
			);
		},
	},
	{
		id: "base",
		setup: (ctx) => ctx.open("Base.base", "live"),
	},
	{
		id: "reading",
		setup: (ctx) => ctx.open("Markdown/Kitchen sink.md", "reading"),
	},
	{
		id: "webviewer",
		setup: async (ctx) => {
			await ctx.js(
				"const l = app.workspace.getLeaf(false); await l.setViewState({ type: 'webviewer', state: { url: 'about:blank' }, active: true }); await sleep(800);",
			);
		},
	},
];

interface Probe {
	containers: number;
	menus: number;
	notices: number;
	suggest: number;
	leaves: string[];
	body: string[];
}

const PROBE = `(() => ({
	containers: document.querySelectorAll(".modal-container").length,
	menus: document.querySelectorAll(".menu").length,
	notices: document.querySelectorAll(".notice").length,
	// Only popups that are on screen: some suggest containers stay attached but hidden.
	suggest: [...document.querySelectorAll(".suggestion-container")].filter((e) => e.getClientRects().length > 0).length,
	leaves: (() => { const out = []; app.workspace.iterateAllLeaves((l) => out.push(l.id + ":" + l.view.getViewType())); return out; })(),
	body: [...document.body.classList],
}))()`;

export async function snapshotLayout(page: Page): Promise<unknown> {
	return page.evaluate("app.workspace.getLayout()");
}

export async function restoreLayout(page: Page, layout: unknown): Promise<void> {
	await resetUi(page);
	await page.evaluate(`(async () => {
		await app.workspace.changeLayout(${JSON.stringify(layout)});
		await new Promise((r) => setTimeout(r, 300));
	})()`);
}

function pagesOf(session: Session): Page[] {
	return session.browser.contexts().flatMap((c) => c.pages());
}

async function closeExtraPages(session: Session, keep: Page): Promise<void> {
	for (const p of pagesOf(session)) {
		if (p !== keep) {
			await p.evaluate("window.close()").catch(() => undefined);
		}
	}
	await Bun.sleep(400);
}

/** Contexts a command family needs before the generic note context. */
function contextsFor(id: string): typeof CONTEXTS {
	const prefer = id.startsWith("canvas:")
		? "canvas"
		: id.startsWith("bases:")
			? "base"
			: id.startsWith("editor:table-")
				? "table"
				: id.startsWith("webviewer:")
					? "webviewer"
					: /heading/.test(id)
						? "heading"
						: undefined;
	const first = CONTEXTS.filter((c) => c.id === prefer);
	return [...first, ...CONTEXTS.filter((c) => c.id !== prefer)];
}

/** A new real window: a popout (is-popout-window) or the vault chooser (starter.html). */
async function newWindow(session: Session, before: Page[]): Promise<Page | undefined> {
	for (const p of pagesOf(session)) {
		if (before.includes(p) || p.isClosed()) continue;
		const real = await p
			.evaluate(
				"document.body?.classList.contains('is-popout-window') || location.href.includes('starter')",
			)
			.catch(() => false);
		if (real) return p;
	}
	return undefined;
}

/** Runs one command in the first context that accepts it and reports what appeared. */
async function runCommand(
	session: Session,
	page: Page,
	id: string,
	layout: unknown,
): Promise<{ context?: string; outcome: Outcome }> {
	const ctx = makeCtx(page);
	let fallback: { context?: string; outcome: Outcome } = { outcome: { kind: "unavailable" } };
	const contexts = contextsFor(id);
	for (const [n, c] of contexts.entries()) {
		// Only a preferred context or an unavailable command earns a second try.
		if (n > 0 && fallback.outcome.kind === "none" && contexts[0]?.id === "note") break;
		await restoreLayout(page, layout);
		await c.setup(ctx);
		await Bun.sleep(250);
		const before = (await page.evaluate(PROBE)) as Probe;
		const pagesBefore = pagesOf(session);
		const ran = await ctx.command(id);
		if (!ran) continue;
		await Bun.sleep(1200);
		const after = (await page.evaluate(PROBE)) as Probe;
		const win = await newWindow(session, pagesBefore);
		let outcome: Outcome = { kind: "none" };
		if (win) outcome = { kind: "window", url: win.url() };
		else if (after.containers > before.containers) outcome = { kind: "modal" };
		else if (after.menus > before.menus) outcome = { kind: "menu" };
		else if (after.suggest > before.suggest) outcome = { kind: "suggest" };
		else if (after.notices > before.notices) outcome = { kind: "notice" };
		else {
			const newLeaf = after.leaves.find((l) => !before.leaves.includes(l));
			const added = after.body.filter((b) => !before.body.includes(b));
			const removed = before.body.filter((b) => !after.body.includes(b)).map((b) => `-${b}`);
			if (newLeaf) outcome = { kind: "view", type: newLeaf.split(":")[1] ?? "" };
			else if (added.length || removed.length)
				outcome = { kind: "state", classes: [...added, ...removed] };
		}
		const undo = undoOf(id);
		if (undo) await ctx.command(undo);
		await closeExtraPages(session, page);
		if (outcome.kind !== "none") return { context: c.id, outcome };
		if (fallback.outcome.kind === "unavailable") fallback = { context: c.id, outcome };
	}
	return fallback;
}

export async function classifyCommands(
	session: Session,
	page: Page,
	inv: AppInventory,
	only?: string[],
): Promise<CommandResult[]> {
	await install(page);
	const layout = await snapshotLayout(page);
	const out: CommandResult[] = [];
	for (const c of inv.commands.filter((x) => !only || only.includes(x.id))) {
		if (SKIP[c.id]) {
			out.push({ ...c, outcome: { kind: "skipped", reason: SKIP[c.id] ?? "" } });
			continue;
		}
		try {
			const timeout = Bun.sleep(45000).then(() => {
				throw new Error("timed out after 45 s");
			});
			const r = await Promise.race([runCommand(session, page, c.id, layout), timeout]);
			out.push({ ...c, ...r });
		} catch (e) {
			// A wedged command (a long render, a stuck modal): reload the throwaway window and go on.
			await page.reload().catch(() => undefined);
			await page
				.waitForFunction("window.app?.workspace?.layoutReady === true", null, { timeout: 30000 })
				.catch(() => undefined);
			out.push({
				...c,
				outcome: {
					kind: "skipped",
					reason: `error while probing: ${(e as Error).message.split("\n")[0]}`,
				},
			});
			await install(page).catch(() => undefined);
		}
		process.stdout.write(`${c.id}: ${out.at(-1)?.outcome.kind}\n`);
	}
	await restoreLayout(page, layout);
	process.stdout.write("\n");
	return out;
}

const SURFACE_OF: Record<string, string> = {
	modal: "modal",
	menu: "menu",
	notice: "notice",
	suggest: "suggestion-popup",
	view: "view",
	window: "window",
	state: "workspace",
};

function targetFor(o: Outcome): Target {
	switch (o.kind) {
		case "modal":
			return { sel: ".modal-container", in: "container" };
		case "menu":
			return ".menu";
		case "notice":
			return ".notice";
		case "suggest":
			return ".suggestion-container";
		case "view":
			return { sel: `.workspace-leaf-content[data-type="${o.type}"]` };
		default:
			return ".app-container";
	}
}

/** One scene per command that opens its own UI. */
export function commandScenes(results: CommandResult[], layout: () => unknown): Scene[] {
	return results
		.filter((r) =>
			["modal", "menu", "notice", "suggest", "view", "window", "state"].includes(r.outcome.kind),
		)
		.map((r): Scene => {
			const context = CONTEXTS.find((c) => c.id === r.context) ?? CONTEXTS[0];
			const o = r.outcome;
			const isWindow = o.kind === "window";
			const item: ItemDef = {
				id: `command.${r.id}`,
				component: o.kind === "view" ? `view-${o.type}` : o.kind,
				target: isWindow ? "body" : targetFor(o),
				full: o.kind === "modal" || o.kind === "state" || o.kind === "view" || isWindow,
				note: `Opened by the command "${r.name}" (${r.id})`,
			};
			return {
				id: `command.${r.id}`,
				surface: SURFACE_OF[o.kind] ?? "workspace",
				source: `app:command:${r.id}`,
				window: isWindow ? (o.url.includes("starter") ? "starter" : "popout") : "main",
				setup: async (ctx) => {
					if (isWindow) {
						await ctx.sleep(1200);
						return;
					}
					await restoreLayout(ctx.page, layout());
					await context?.setup(ctx);
					await Bun.sleep(250);
					await ctx.command(r.id);
					await Bun.sleep(900);
				},
				...(isWindow
					? {
							opener: async (main: Ctx) => {
								await restoreLayout(main.page, layout());
								await context?.setup(main);
								await main.command(r.id);
							},
						}
					: {}),
				items: [item],
			};
		});
}

export { closeExtraPages, pagesOf, undoOf };

/** One scene per settings tab, plus its scrolled end. */
export function settingsScenes(inv: AppInventory): Scene[] {
	return inv.settingTabs.map(
		(t): Scene => ({
			id: `settings.${t.id}`,
			surface: "settings",
			source: `app:setting-tab:${t.id}`,
			window: "popout",
			opener: async (main: Ctx) => {
				await main.js(`app.setting.open(); app.setting.openTabById(${JSON.stringify(t.id)});`);
			},
			setup: async (ctx) => {
				await ctx.js(
					`cap.clearSettingsSearch(); app.setting.openTabById(${JSON.stringify(t.id)}); await sleep(700);`,
				);
			},
			items: [
				{
					id: `settings.${t.id}`,
					component: "settings-page",
					target: ".modal.mod-settings",
					note: `Settings tab "${t.name}"`,
				},
				{
					id: `settings.${t.id}.end`,
					component: "settings-page",
					target: ".modal.mod-settings",
					state: "scrolled-to-end",
					before: async (ctx) => {
						await ctx.js(
							"const c = document.querySelector('.modal.mod-settings .vertical-tab-content-container'); if (c) c.scrollTop = c.scrollHeight; await sleep(300);",
						);
					},
				},
			],
		}),
	);
}

/** One scene per registered view type, opened in the main area. */
export function viewScenes(inv: AppInventory): Scene[] {
	const files: Record<string, string> = {
		markdown: "Markdown/Kitchen sink.md",
		image: "Attachments/sample-image.png",
		audio: "Attachments/sample-audio.wav",
		video: "Attachments/sample-video.mp4",
		pdf: "Attachments/sample.pdf",
		canvas: "Canvas.canvas",
		bases: "Base.base",
	};
	return inv.views.map(
		(type): Scene => ({
			id: `view.type.${type}`,
			surface: "view",
			source: `app:view-type:${type}`,
			setup: async (ctx) => {
				const file = files[type];
				if (file) await ctx.open(file, "live");
				else {
					await ctx.js(
						`const l = app.workspace.getLeaf("tab"); await l.setViewState({ type: ${JSON.stringify(type)}, state: ${type === "webviewer" ? "{ url: 'about:blank' }" : "{ file: 'Markdown/Links.md' }"}, active: true }); app.workspace.setActiveLeaf(l); await sleep(1200);`,
					);
				}
			},
			items: [
				{
					id: `view.type.${type}`,
					component: `view-${type}`,
					target: `.workspace-leaf.mod-active .workspace-leaf-content[data-type="${type}"], .workspace-leaf-content[data-type="${type}"]`,
					full: true,
				},
			],
		}),
	);
}
