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

/** Closes modals, menus, popovers and Slides with real Escape presses, then clears capture marks. */
export async function resetUi(page: Page): Promise<void> {
	for (let i = 0; i < 6; i++) {
		const n = (await page.evaluate(
			"cap.overlays() + document.querySelectorAll('.slides-container, .lightbox').length",
		)) as number;
		if (!n) break;
		await page.evaluate(
			"document.querySelector('.slides-container .slides-close-btn')?.click(); document.querySelector('.lightbox .modal-close-button')?.click();",
		);
		await page.keyboard.press("Escape");
		await sleep(180);
	}
	await page
		.evaluate(
			"window.electronWindow?.isFullScreen?.() && window.electronWindow.setFullScreen(false)",
		)
		.catch(() => undefined);
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

/** A theme.css selector in the form Chromium can evaluate live. */
export interface LiveSelector {
	id: string;
	sel: string;
	needs?: string;
}

export interface CaptureOut {
	fixturesDir: string;
	screenshotsDir: string;
	version: string;
	live: LiveSelector[];
}

export interface ItemResult {
	id: string;
	entry?: FixtureEntry;
	error?: string;
}

/** Unique colors and size of a PNG, read with ImageMagick. */
export function pngStats(path: string): { width: number; height: number; colors: number } {
	const r = Bun.spawnSync(["magick", "identify", "-format", "%w %h %k", path]);
	const [w, h, k] = r.stdout.toString().trim().split(" ").map(Number);
	return { width: w ?? 0, height: h ?? 0, colors: k ?? 0 };
}

interface Probe {
	vis: {
		visible: boolean;
		reason?: string;
		box: number[];
		inView?: number[];
		unobscured?: number;
		blockers?: string[];
	};
	forcedOk: boolean;
	expectOk: boolean;
	marks: Record<string, number>;
	live: string[];
	html: string;
	trimmed: { selector: string; kept: number; of: number } | null;
	contains: string[];
}

/** Captures one item in the current UI state. Fails unless the target is visibly shown in its state. */
export async function captureItem(
	page: Page,
	cdp: CDPSession,
	scene: Scene,
	item: ItemDef,
	out: CaptureOut,
): Promise<ItemResult> {
	const ctx = makeCtx(page);
	if (item.media) await cdp.send("Emulation.setEmulatedMedia", item.media);
	if (item.before) await item.before(ctx);
	const target: Target = item.target;
	const found = (await page.evaluate(
		`(async () => { const el = await cap.locate(${JSON.stringify(target)}, ${!!item.pointer}); if (!el) return false; el.setAttribute("data-capture-target", ""); await cap.reveal(el); if (${!item.pointer} && !el.closest(".menu, .popover, .prompt, .suggestion-container")) el.scrollIntoView({ block: "center", inline: "nearest" }); return true; })()`,
	)) as boolean;
	if (!found) return { id: item.id, error: `target not found: ${JSON.stringify(target)}` };
	const pseudo = item.pseudo ?? [];
	const state = item.state ?? (pseudo.length ? pseudo.join("+") : "default");
	let via: "devtools" | "pointer" = item.pointer ? "pointer" : "devtools";
	let pressed = false;
	const forcedHolds = async () =>
		(await page.evaluate(
			`(() => { const pel = document.querySelector("[data-capture-pseudo]"); return !!pel && ${JSON.stringify(pseudo)}.every((s) => s === "visited" || pel.matches(":" + s)); })()`,
		)) as boolean;
	/** Real pointer over the state element: hover, plus a held button for :active. */
	const pointAt = async () => {
		const c = (await page.evaluate(
			`(() => { const r = document.querySelector("[data-capture-pseudo]").getBoundingClientRect(); return r.width && r.height ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`,
		)) as [number, number] | null;
		if (!c) return;
		await page.mouse.move(c[0], c[1], { steps: 3 });
		if (pseudo.includes("active")) {
			await page.mouse.down();
			pressed = true;
		}
		via = "pointer";
		await sleep(250);
	};
	try {
		if (pseudo.length) {
			const on = JSON.stringify(item.pseudoOn ?? target);
			const ok = (await page.evaluate(
				`(() => { const el = cap.find(${on}) ?? document.querySelector("[data-capture-target]"); if (!el) return false; el.setAttribute("data-capture-pseudo", ""); if (${pseudo.includes("visited")}) el.setAttribute("data-capture-visited", ""); return true; })()`,
			)) as boolean;
			if (!ok) return { id: item.id, error: "pseudo target not found" };
			if (!item.pointer) {
				await forcePseudo(cdp, pseudo);
				await sleep(150);
				// DevTools forcing does not reach every window (popouts); fall back to the real pointer.
				if (!(await forcedHolds()) && pseudo.every((x) => x === "hover" || x === "active")) {
					await forcePseudo(cdp, []);
					await pointAt();
				}
			}
		}
		if (item.pointer) {
			// Marking the target can make CodeMirror redraw it; nudge the pointer so hover is re-evaluated.
			const at = (await page.evaluate("window.__capPointer ?? null")) as [number, number] | null;
			if (at) {
				await page.mouse.move(at[0] + 1, at[1]);
				await page.mouse.move(at[0], at[1]);
			}
		}
		await sleep(200);
		const probe = (await page.evaluate(
			`(() => {
				// CodeMirror can redraw a line and drop the mark: find the target again.
				let el = document.querySelector("[data-capture-target]");
				if (!el) { el = cap.find(${JSON.stringify(target)}); el?.setAttribute("data-capture-target", ""); el?.scrollIntoView({ block: "center" }); }
				if (!el) return { lost: true };
				const pel = document.querySelector("[data-capture-pseudo]");
				const vis = cap.visibility(el);
				const p = window.__capPointer;
				const flags = { selection: cap.hasSelection(el), "scrollbar-hover": !!p && cap.overScrollbar(el, p[0], p[1]) };
				const extra = {};
				if (flags.selection) extra.selection = el;
				if (flags["scrollbar-hover"]) extra["scrollbar-hover"] = el;
				// :visited is hidden from matches(); the forced link carries the mark (see css.ts).
				if (pel?.hasAttribute("data-capture-visited")) extra.visited = pel;
				const forcedOk = ${JSON.stringify(pseudo)}.every((s) => s === "visited" || (pel && pel.matches(":" + s)));
				const expect = ${JSON.stringify(item.expect ?? null)};
				const expectOk = !expect || el.matches(expect);
				${item.state && item.state !== "default" ? `el.setAttribute("data-capture-label", ${JSON.stringify(item.state)});` : ""}
				${item.synthetic ? `el.setAttribute("data-capture-synthetic", ${JSON.stringify(item.synthetic)});` : ""}
				const marks = cap.markStates(el, extra);
				const live = cap.liveMatches(el, ${JSON.stringify(out.live)}, { ...flags });
				const html = cap.serialize(el, ${JSON.stringify(item.trim ?? null)});
				return { vis, forcedOk, expectOk, marks, live, html, trimmed: window.__capTrimmed, contains: cap.components(el, ${JSON.stringify(COMPONENTS)}) };
			})()`,
		)) as Probe & { lost?: boolean };
		if (probe.lost) return { id: item.id, error: "target vanished before the snapshot" };
		const { vis } = probe;
		if (!vis.visible)
			return { id: item.id, error: `target not visible: ${vis.reason} (box ${vis.box.join(",")})` };
		const minShown = item.minUnobscured ?? 0.6;
		if ((vis.unobscured ?? 0) < minShown) {
			return {
				id: item.id,
				error: `target covered (${vis.unobscured} shown) by ${vis.blockers?.join(", ")}`,
			};
		}
		if (!probe.forcedOk)
			return {
				id: item.id,
				error: `Chromium does not report the forced state ${pseudo.join("+")}`,
			};
		if (!probe.expectOk)
			return { id: item.id, error: `state not shown: target does not match ${item.expect}` };
		const shot = join(out.screenshotsDir, `${item.id}.png`);
		const [x, y, w, h] = vis.inView ?? [0, 0, 0, 0];
		const vp = (await page.evaluate("({ width: innerWidth, height: innerHeight })")) as {
			width: number;
			height: number;
		};
		const pad = 8;
		const x0 = Math.max(0, (x ?? 0) - pad);
		const y0 = Math.max(0, (y ?? 0) - pad);
		const clip = {
			x: x0,
			y: y0,
			width: Math.min(vp.width, (x ?? 0) + (w ?? 0) + pad) - x0,
			height: Math.min(vp.height, (y ?? 0) + (h ?? 0) + pad) - y0,
		};
		await page.screenshot({ path: shot, ...(item.full ? {} : { clip }) });
		const stats = pngStats(shot);
		if (stats.colors < 2) return { id: item.id, error: "screenshot is blank (one color)" };
		const sha256 = new Bun.CryptoHasher("sha256")
			.update(await Bun.file(shot).arrayBuffer())
			.digest("hex");
		const file = `${item.id}.html`;
		writeFileSync(join(out.fixturesDir, file), probe.html);
		const entry: FixtureEntry = {
			id: item.id,
			file,
			screenshot: `screenshots/${item.id}.png`,
			component: item.component,
			surface: item.surface ?? scene.surface,
			state,
			covers: [item.id],
			obsidianVersion: out.version,
			contains: probe.contains,
			...(item.note ? { note: item.note } : {}),
			...(item.synthetic ? { synthetic: item.synthetic } : {}),
			...(probe.trimmed
				? {
						trimmed: `kept ${probe.trimmed.kept} of ${probe.trimmed.of} ${probe.trimmed.selector} elements (the first ${item.trim?.keep} plus one per distinct state matching ${item.trim?.keepAlso}); the screenshot shows the untrimmed window`,
					}
				: {}),
			evidence: {
				box: vis.box,
				inView: vis.inView ?? [],
				unobscured: vis.unobscured ?? 0,
				marks: probe.marks,
				forced: pseudo,
				...(pseudo.length ? { via } : {}),
				...(item.expect ? { expect: item.expect } : {}),
				live: probe.live,
				...(item.media ? { media: JSON.stringify(item.media) } : {}),
				screenshot: { sha256, ...stats },
			},
		};
		return { id: item.id, entry };
	} finally {
		if (pressed) await page.mouse.up().catch(() => undefined);
		if (pseudo.length) await forcePseudo(cdp, []).catch(() => undefined);
		if (item.media)
			await cdp
				.send("Emulation.setEmulatedMedia", { media: "", features: [] })
				.catch(() => undefined);
		await page.evaluate("cap.clean()");
	}
}

export async function runScene(
	session: Session,
	pageFor: (scene: Scene) => Promise<Page>,
	scene: Scene,
	out: CaptureOut,
	only?: Set<string>,
	census?: Set<string>,
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
		if (census) {
			const seen = (await page
				.evaluate("[...(window.__capCensus ?? [])]")
				.catch(() => [])) as string[];
			for (const c of seen) census.add(c);
		}
		await resetUi(page).catch(() => undefined);
		await cdp.detach().catch(() => undefined);
	}
	void session;
	return results;
}

export function ensureDirs(out: CaptureOut): void {
	mkdirSync(out.fixturesDir, { recursive: true });
	mkdirSync(out.screenshotsDir, { recursive: true });
}
