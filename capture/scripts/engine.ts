// Drives a running Obsidian: reaches each scene, forces states and records DOM + screenshots.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Page } from "playwright";
import { INPAGE } from "./inpage.ts";
import type { Session } from "./obsidian.ts";
import type { Ctx, FixtureEntry, ItemDef, Mode, Pseudo, Scene, Target } from "./types.ts";

/** Components worth showing across surfaces. Key = component tag, value = selector. */
export const COMPONENTS: Record<string, string> = {
	"clickable-icon": ".clickable-icon",
	button: "button",
	"button-cta": "button.mod-cta",
	"button-warning": "button.mod-warning",
	toggle: ".checkbox-container",
	checkbox: "input[type=checkbox]",
	dropdown: "select.dropdown, select",
	combobox: ".combobox-button",
	slider: "input[type=range]",
	"text-input": "input[type=text], input:not([type]), input[type=search], input[type=number]",
	textarea: "textarea",
	"search-input": ".search-input-container",
	"setting-item": ".setting-item",
	"vertical-tab": ".vertical-tab-nav-item",
	menu: ".menu",
	"menu-item": ".menu-item",
	suggestion: ".suggestion-item",
	prompt: ".prompt",
	modal: ".modal",
	"tree-item": ".tree-item",
	"nav-file": ".nav-file-title",
	"tab-header": ".workspace-tab-header",
	"view-header": ".view-header",
	"status-bar-item": ".status-bar-item",
	"multi-select-pill": ".multi-select-pill",
	tag: "a.tag, .cm-hashtag",
	"internal-link": ".internal-link, .cm-hmd-internal-link",
	"external-link": ".external-link, .cm-url",
	callout: ".callout",
	"code-block": "pre, .HyperMD-codeblock",
	"inline-code": "code, .cm-inline-code",
	table: "table",
	heading: "h1, h2, h3, h4, h5, h6, .HyperMD-header",
	task: ".task-list-item, .HyperMD-task-line",
	blockquote: "blockquote, .HyperMD-quote",
	"metadata-container": ".metadata-container",
	"metadata-property": ".metadata-property",
	embed: ".internal-embed, .markdown-embed",
	"search-result": ".search-result-file-title, .search-result-file-match",
	notice: ".notice",
	tooltip: ".tooltip",
	popover: ".popover",
	"canvas-node": ".canvas-node",
	"bases-toolbar": ".bases-toolbar",
	"empty-state": ".empty-state",
	"collapse-icon": ".collapse-icon",
	"progress-bar": ".progress-bar",
};

const sleep = (ms: number) => Bun.sleep(ms);

export async function install(page: Page): Promise<void> {
	await page.evaluate(INPAGE);
}

export function makeCtx(page: Page): Ctx {
	const ctx: Ctx = {
		page,
		js: <T>(body: string, arg?: unknown) =>
			page.evaluate(
				`(async (arg) => { const sleep = cap.sleep; ${body} })(${JSON.stringify(arg ?? null)})`,
			) as Promise<T>,
		open: async (file: string, mode: Mode, opts?: { newLeaf?: boolean }) => {
			await page.evaluate(
				`cap.open(${JSON.stringify(file)}, "${mode}", ${opts?.newLeaf === true}).then(() => null)`,
			);
		},
		command: async (id: string) =>
			(await page.evaluate(`app.commands.executeCommandById(${JSON.stringify(id)})`)) === true,
		press: async (key: string) => {
			await page.keyboard.press(key);
			await sleep(200);
		},
		sleep,
	};
	return ctx;
}

/** Closes modals, menus and popovers with real Escape presses, then clears capture marks. */
export async function resetUi(page: Page): Promise<void> {
	for (let i = 0; i < 6; i++) {
		const n = (await page.evaluate("cap.overlays()")) as number;
		if (!n) break;
		await page.keyboard.press("Escape");
		await sleep(180);
	}
	await page.evaluate("cap.clean()");
}

async function forcePseudo(cdp: CDPSession, pseudo: Pseudo[]): Promise<void> {
	const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
	const { nodeId } = await cdp.send("DOM.querySelector", {
		nodeId: root.nodeId,
		selector: "[data-capture-pseudo]",
	});
	if (!nodeId) throw new Error("pseudo target vanished");
	await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: pseudo });
}

export interface CaptureOut {
	fixturesDir: string;
	screenshotsDir: string;
	version: string;
}

export interface ItemResult {
	id: string;
	entry?: FixtureEntry;
	error?: string;
}

/** Captures one item in the current UI state. */
export async function captureItem(
	page: Page,
	cdp: CDPSession,
	scene: Scene,
	item: ItemDef,
	out: CaptureOut,
): Promise<ItemResult> {
	const ctx = makeCtx(page);
	if (item.before) await item.before(ctx);
	const target: Target = item.target;
	const found = (await page.evaluate(
		`(async () => { const el = await cap.locate(${JSON.stringify(target)}); if (!el) return false; el.setAttribute("data-capture-target", ""); return true; })()`,
	)) as boolean;
	if (!found) return { id: item.id, error: `target not found: ${JSON.stringify(target)}` };
	const state = item.state ?? (item.pseudo ? item.pseudo.join("+") : "default");
	try {
		if (item.pseudo?.length) {
			const on = JSON.stringify(item.pseudoOn ?? target);
			const ok = (await page.evaluate(
				`(() => { const el = cap.find(${on}) ?? document.querySelector("[data-capture-target]"); if (!el) return false; el.setAttribute("data-capture-pseudo", ""); el.setAttribute("data-capture-state", ${JSON.stringify(item.pseudo.join(" "))}); return true; })()`,
			)) as boolean;
			if (!ok) return { id: item.id, error: "pseudo target not found" };
			await forcePseudo(cdp, item.pseudo);
			await sleep(150);
		} else if (item.state && item.state !== "default") {
			// App-driven state (class set by Obsidian): mark it so fixtures stay self-describing.
			await page.evaluate(
				`document.querySelector("[data-capture-target]").setAttribute("data-capture-state", ${JSON.stringify(item.state)})`,
			);
		}
		const { html, rect, contains } = (await page.evaluate(
			`(() => { const el = document.querySelector("[data-capture-target]"); const r = el.getBoundingClientRect(); return { html: cap.serialize(el), rect: [r.x, r.y, r.width, r.height], contains: cap.components(el, ${JSON.stringify(COMPONENTS)}) }; })()`,
		)) as { html: string; rect: [number, number, number, number]; contains: string[] };
		const shot = join(out.screenshotsDir, `${item.id}.png`);
		const vp =
			page.viewportSize() ?? (await page.evaluate("({ width: innerWidth, height: innerHeight })"));
		const { width: vw, height: vh } = vp as { width: number; height: number };
		const [x, y, w, h] = rect;
		const pad = 8;
		const clip = {
			x: Math.max(0, x - pad),
			y: Math.max(0, y - pad),
			width: Math.min(vw, x + w + pad) - Math.max(0, x - pad),
			height: Math.min(vh, y + h + pad) - Math.max(0, y - pad),
		};
		const usable = !item.full && clip.width > 4 && clip.height > 4;
		await page.screenshot({ path: shot, ...(usable ? { clip } : {}) });
		const file = `${item.id}.html`;
		writeFileSync(join(out.fixturesDir, file), html);
		const entry: FixtureEntry = {
			id: item.id,
			file,
			screenshot: `screenshots/${item.id}.png`,
			component: item.component,
			surface: item.surface ?? scene.surface,
			state,
			covers: [item.id],
			obsidianVersion: out.version,
			contains,
			...(usable || item.full
				? {}
				: { note: "element had no visible box; screenshot shows the window" }),
			...(item.note ? { note: item.note } : {}),
		};
		return { id: item.id, entry };
	} finally {
		if (item.pseudo?.length) await forcePseudo(cdp, []).catch(() => undefined);
		await page.evaluate("cap.clean()");
	}
}

export async function runScene(
	session: Session,
	pageFor: (scene: Scene) => Promise<Page>,
	scene: Scene,
	out: CaptureOut,
	only?: Set<string>,
): Promise<ItemResult[]> {
	const page = await pageFor(scene);
	await install(page);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");
	const results: ItemResult[] = [];
	try {
		await resetUi(page);
		await scene.setup(makeCtx(page));
		await sleep(300);
		for (const item of scene.items) {
			if (only && !only.has(item.id)) continue;
			try {
				const r = await captureItem(page, cdp, scene, item, out);
				results.push(r);
			} catch (e) {
				results.push({ id: item.id, error: (e as Error).message.split("\n")[0] });
			}
		}
	} catch (e) {
		const why = `scene setup failed: ${(e as Error).message.split("\n")[0]}`;
		for (const item of scene.items) {
			if ((!only || only.has(item.id)) && !results.some((r) => r.id === item.id))
				results.push({ id: item.id, error: why });
		}
	} finally {
		await cdp.detach().catch(() => undefined);
	}
	void session;
	return results;
}

export function ensureDirs(out: CaptureOut): void {
	mkdirSync(out.fixturesDir, { recursive: true });
	mkdirSync(out.screenshotsDir, { recursive: true });
}
