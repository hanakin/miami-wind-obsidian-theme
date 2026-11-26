// Drives a running Obsidian: reaches each scene, forces states and records DOM + screenshots.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Page } from "playwright";
import { normSelector } from "./css.ts";
import { INPAGE } from "./inpage.ts";
import { type Session, WORK } from "./obsidian.ts";
import type { Ctx, Evidence, FixtureEntry, ItemDef, Mode, Scene, Target } from "./types.ts";

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

/** DevTools node id for a JS expression that evaluates to an element in this page. */
async function nodeOf(cdp: CDPSession, expression: string): Promise<number> {
	await cdp.send("DOM.getDocument", { depth: 0 });
	const { result } = await cdp.send("Runtime.evaluate", { expression });
	if (!result.objectId) throw new Error(`no element for ${expression}`);
	const { nodeId } = await cdp.send("DOM.requestNode", { objectId: result.objectId });
	return nodeId;
}

/**
 * Author rules whose matching selector uses each pseudo-class, as Chromium matched them for the
 * node. This is the painted state: inside popout windows Element.matches() misses forced states
 * that the style engine applies.
 */
async function stateRules(
	cdp: CDPSession,
	nodeId: number,
	pseudo: string[],
): Promise<Record<string, number>> {
	const r = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
	const out: Record<string, number> = {};
	for (const p of pseudo) {
		const re = new RegExp(`:${p}(?![\\w-])`);
		out[p] = 0;
		for (const m of r.matchedCSSRules ?? []) {
			if (m.rule.origin !== "regular") continue;
			for (const i of m.matchingSelectors) {
				if (re.test(m.rule.selectorList.selectors[i]?.text ?? "")) out[p] = (out[p] ?? 0) + 1;
			}
		}
	}
	return out;
}

/**
 * Asks DevTools which author selectors match each candidate node (window.__cap.cands) and stores
 * them, normalized, in window.__cap.cdp for the live check in cap.snapshot().
 */
async function matchedOnCandidates(page: Page, cdp: CDPSession): Promise<void> {
	// No DOM.getDocument here: it resets DevTools' node bindings, which drops the forced state.
	// captureItem already requested the document when it forced the state.
	const { result } = await cdp.send("Runtime.evaluate", { expression: "cap.candidates()" });
	if (!result.objectId) return;
	const { result: props } = await cdp.send("Runtime.getProperties", {
		objectId: result.objectId,
		ownProperties: true,
	});
	const out: string[][] = [];
	for (const pr of props) {
		const i = Number(pr.name);
		if (!Number.isInteger(i) || !pr.value?.objectId) continue;
		try {
			const { nodeId } = await cdp.send("DOM.requestNode", { objectId: pr.value.objectId });
			const r = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
			const texts = new Set<string>();
			const rules = [
				...(r.matchedCSSRules ?? []),
				// Scrollbar pseudo-elements are reported for any element; they are proven by the
				// scrollbar-hover mark instead.
				...(r.pseudoElements ?? [])
					.filter((pe) => !pe.pseudoType.startsWith("scrollbar"))
					.flatMap((pe) => pe.matches),
			];
			for (const m of rules) {
				if (m.rule.origin !== "regular") continue;
				for (const k of m.matchingSelectors) {
					const t = m.rule.selectorList.selectors[k]?.text;
					if (t) texts.add(normSelector(t));
				}
			}
			out[i] = [...texts];
		} catch {}
	}
	await page.evaluate(`window.__cap.cdp = ${JSON.stringify(out)}`);
}

/** Media emulation for one item; fails unless the page's matchMedia reports every feature. */
async function emulateMedia(
	page: Page,
	cdp: CDPSession,
	media: { media?: string; features?: { name: string; value: string }[] },
): Promise<string | null> {
	await cdp.send("Emulation.setEmulatedMedia", {
		media: media.media ?? "",
		features: media.features ?? [],
	});
	for (const f of media.features ?? []) {
		const ok = (await page.evaluate(
			`matchMedia(${JSON.stringify(`(${f.name}: ${f.value})`)}).matches`,
		)) as boolean;
		if (!ok) return `media emulation not applied: (${f.name}: ${f.value})`;
	}
	return null;
}

/** ImageMagick with its temporary files under the work folder (/tmp may be out of quota); throws on failure. */
function magick(args: string[]): string {
	const tmp = join(WORK, "tmp");
	mkdirSync(tmp, { recursive: true });
	const r = Bun.spawnSync(["magick", ...args], {
		env: { ...process.env, MAGICK_TEMPORARY_PATH: tmp, TMPDIR: tmp },
	});
	if (r.exitCode !== 0)
		throw new Error(`magick ${args[0]} failed: ${r.stderr.toString().slice(0, 200)}`);
	return r.stdout.toString();
}

/**
 * Screenshot pixels showing each 0xrrggbb color. Opaque colors count exact matches; a color drawn
 * with alpha < 1 counts pixels within 3 per channel of that color blended over the background (the
 * screenshot's most common color).
 */
export function pixelCounts(
	png: string,
	colors: Record<string, number>,
	alphas: Record<string, number> = {},
): Record<string, number> {
	const hist = magick([png, "-alpha", "off", "-format", "%c", "histogram:info:-"]);
	if (!hist.trim()) throw new Error(`empty ImageMagick histogram for ${png}`);
	const entries: [number, number, number, number][] = [];
	for (const m of hist.matchAll(/^\s*(\d+):.*?#([0-9A-Fa-f]{6})/gm)) {
		const v = Number.parseInt(m[2] ?? "0", 16);
		entries.push([Number(m[1]), (v >> 16) & 255, (v >> 8) & 255, v & 255]);
	}
	const bg = entries.reduce((a, e) => (e[0] > a[0] ? e : a), [0, 0, 0, 0]);
	const out: Record<string, number> = {};
	for (const [k, rgb] of Object.entries(colors)) {
		const a = alphas[k] ?? 1;
		const c = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
		const want = c.map((v, i) => Math.round(a * v + (1 - a) * (bg[i + 1] ?? 0)));
		const tol = a < 1 ? 3 : 0;
		out[k] = entries
			.filter((e) => want.every((w, i) => Math.abs((e[i + 1] ?? 0) - w) <= tol))
			.reduce((n, e) => n + e[0], 0);
	}
	return out;
}

/** A theme.css selector in fixture form (states as data-capture-state marks). */
export interface LiveSelector {
	id: string;
	/** The selector with real pseudo-classes, for Element.matches on the live page. */
	live: string;
	needs?: string;
	/** Normalized source text, compared with DevTools' matched selectors. */
	norm: string;
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
	const out = magick(["identify", "-format", "%w %h %k", path]);
	const [w, h, k] = out.trim().split(" ").map(Number);
	return { width: w ?? 0, height: h ?? 0, colors: k ?? 0 };
}

interface Vis {
	visible: boolean;
	reason?: string;
	box: number[];
	inView?: number[];
	unobscured?: number;
	blockers?: string[];
}

interface Snap {
	lost?: boolean;
	html: string;
	format: "html" | "xhtml";
	live: string[];
	domOnly: string[];
	trimmed: { selector: string; kept: number; of: number } | null;
	contains: string[];
	seen: number;
	imageSizes: { index: number; width: number; height: number }[];
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
	if (item.media) {
		const bad = await emulateMedia(page, cdp, item.media);
		if (bad) return { id: item.id, error: bad };
	}
	// A text selection left by an earlier item would repaint text with ::selection colors; drop it
	// unless it sits in an editor or field (contexts and items that select text on purpose).
	await page.evaluate(
		"(() => { const s = getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return; const n = s.getRangeAt(0).commonAncestorContainer; const e = n.nodeType === 1 ? n : n.parentElement; if (!e?.closest('[contenteditable=true], input, textarea')) s.removeAllRanges(); })()",
	);
	// Park the real pointer on the empty middle of the top edge, so whatever the last item hovered
	// does not stay hovered; items that click or hover move it from there.
	// Items without a before() keep the previous item's pointer (they capture what it opened).
	if (item.before) {
		const mid = (await page.evaluate("Math.round(innerWidth / 2)")) as number;
		await page.mouse.move(mid, 1);
	}
	if (item.before) await item.before(ctx);
	const target: Target = item.target;
	const found = (await page.evaluate(
		`(async () => { const el = await cap.locate(${JSON.stringify(target)}, ${!!item.pointer}); if (!el) return false; window.__cap.target = el; await cap.reveal(el); if (${!item.pointer} && !el.closest(".menu, .popover, .prompt, .suggestion-container")) el.scrollIntoView({ block: "center", inline: "nearest" }); return true; })()`,
	)) as boolean;
	if (!found) return { id: item.id, error: `target not found: ${JSON.stringify(target)}` };
	const pseudo = item.pseudo ?? [];
	const state = item.state ?? (pseudo.length ? pseudo.join("+") : "default");
	const via = item.pointer ? "pointer" : "devtools";
	let forcedNode = 0;
	try {
		let painted: Record<string, number> = {};
		let styleChanged: number | null = null;
		let styleProps: string[] = [];
		let verified: string[] = [];
		let unverified: string[] = [];
		if (pseudo.length) {
			const on = JSON.stringify(item.pseudoOn ?? target);
			const ok = (await page.evaluate(
				`(() => { const el = cap.find(${on}) ?? window.__cap.target; if (!el) return false; window.__cap.pseudo = el; window.__cap.forced = ${JSON.stringify(pseudo)}; return true; })()`,
			)) as boolean;
			if (!ok) return { id: item.id, error: "pseudo target not found" };
			const node = await nodeOf(cdp, "window.__cap.pseudo");
			if (!item.pointer) {
				await sleep(150);
				await page.evaluate("cap.styleBefore()");
				await cdp.send("CSS.forcePseudoState", { nodeId: node, forcedPseudoClasses: pseudo });
				forcedNode = node;
			} else {
				// The real pointer was placed by before(); nudge it so hover is re-evaluated.
				const at = (await page.evaluate("window.__capPointer ?? null")) as [number, number] | null;
				if (at) {
					await page.mouse.move(at[0] + 1, at[1]);
					await page.mouse.move(at[0], at[1]);
				}
			}
			await sleep(200 + (item.settle ?? 0));
			const d = item.pointer
				? null
				: ((await page.evaluate("cap.styleChanges()")) as { n: number; props: string[] } | null);
			if (d) {
				styleChanged = d.n;
				styleProps = d.props;
			}
			painted = await stateRules(cdp, node, pseudo);
			// A claimed state is verified when the live page reports it (Element.matches) or DevTools
			// matched an author rule for it on this node. Unverified states are not marked.
			const liveStates = (await page.evaluate(
				`window.__cap.forced.filter((p) => { try { return window.__cap.pseudo.matches(":" + p); } catch { return false; } })`,
			)) as string[];
			verified = pseudo.filter((p) => liveStates.includes(p) || (painted[p] ?? 0) > 0);
			unverified = pseudo.filter((p) => !verified.includes(p));
			await page.evaluate(`window.__cap.verified = ${JSON.stringify(verified)}`);
			if (item.pointer) {
				const real = (await page.evaluate(
					`${JSON.stringify(pseudo)}.every((s) => window.__cap.pseudo.matches(":" + s))`,
				)) as boolean;
				if (!real)
					return { id: item.id, error: `the real pointer did not produce ${pseudo.join("+")}` };
			}
		} else await sleep(200);
		const probe = (await page.evaluate(
			`(() => {
				let el = window.__cap.target;
				if (!el.isConnected) { el = cap.find(${JSON.stringify(target)}); if (!el) return { lost: true }; window.__cap.target = el; el.scrollIntoView({ block: "center" }); }
				const vis = cap.visibility(el);
				const p = window.__capPointer;
				const flags = { selection: cap.hasSelection(el), "scrollbar-hover": !!p && cap.overScrollbar(el, p[0], p[1]) };
				window.__cap.flags = flags;
				const expect = ${JSON.stringify(item.expect ?? null)};
				let expectOk = true;
				try { expectOk = !expect || el.matches(expect); } catch { expectOk = false; }
				const marks = cap.markStates(el, { selection: flags.selection ? el : null, "scrollbar-hover": flags["scrollbar-hover"] ? el : null, visited: window.__cap.forced.includes("visited") ? window.__cap.pseudo : null });
				return { vis, expectOk, marks };
			})()`,
		)) as { lost?: boolean; vis: Vis; expectOk: boolean; marks: Record<string, number> };
		if (probe.lost) return { id: item.id, error: "target vanished before the snapshot" };
		const { vis } = probe;
		if (!vis.visible) {
			return { id: item.id, error: `target not visible: ${vis.reason} (box ${vis.box.join(",")})` };
		}
		if ((vis.unobscured ?? 0) < (item.minUnobscured ?? 0.6)) {
			return {
				id: item.id,
				error: `target covered (${vis.unobscured} shown) by ${vis.blockers?.join(", ")}`,
			};
		}
		if (!probe.expectOk)
			return { id: item.id, error: `state not shown: target does not match ${item.expect}` };
		const vp = (await page.evaluate(
			"({ width: innerWidth, height: innerHeight, hover: matchMedia('(hover: hover)').matches, finePointer: matchMedia('(pointer: fine)').matches })",
		)) as { width: number; height: number; hover: boolean; finePointer: boolean };
		const [x = 0, y = 0, w = 0, h = 0] = vis.inView ?? [];
		const pad = 8;
		const x0 = Math.max(0, x - pad);
		const y0 = Math.max(0, y - pad);
		const clip = item.full
			? { x: 0, y: 0, width: vp.width, height: vp.height }
			: {
					x: x0,
					y: y0,
					width: Math.min(vp.width, x + w + pad) - x0,
					height: Math.min(vp.height, y + h + pad) - y0,
				};
		const shot = join(out.screenshotsDir, `${item.id}.png`);
		const clipArr = JSON.stringify([clip.x, clip.y, clip.width, clip.height]);
		let scroll: { positions: number[]; scrollHeight: number; clientHeight: number } | undefined;
		if (item.scroll) {
			// Long pages: screenshot every scroll position of the container and stack them.
			const sc = JSON.stringify(item.scroll);
			const dims = (await page.evaluate(
				`(() => { const s = cap.find(${sc}); if (!s) return null; s.scrollTop = 0; return [s.scrollHeight, s.clientHeight]; })()`,
			)) as [number, number] | null;
			if (!dims) return { id: item.id, error: `scroll container not found: ${item.scroll}` };
			const [sh, ch] = dims;
			const positions: number[] = [];
			const parts: string[] = [];
			for (let top = 0, i = 0; i < 40; i++) {
				const at = (await page.evaluate(
					`(async () => { const s = cap.find(${sc}); s.scrollTop = ${top}; await cap.sleep(250); cap.witness(window.__cap.target, ${clipArr}); return s.scrollTop; })()`,
				)) as number;
				positions.push(at);
				const part = join(out.screenshotsDir, `.${item.id}.${i}.png`);
				await page.screenshot({ path: part, clip });
				parts.push(part);
				if (at + ch >= sh - 2) break;
				top = at + Math.floor(ch * 0.85);
			}
			const end = positions.at(-1) ?? 0;
			if (end + ch < sh - 2)
				return { id: item.id, error: `could not scroll to the end (${end}+${ch} of ${sh})` };
			magick([...parts, "-append", shot]);
			for (const p of parts) rmSync(p, { force: true });
			scroll = { positions, scrollHeight: sh, clientHeight: ch };
		} else {
			await page.evaluate(`cap.witness(window.__cap.target, ${clipArr})`);
			await page.screenshot({ path: shot, clip });
		}
		let record: Evidence["record"];
		if (item.record) {
			record = (await page.evaluate(`(async () => { ${item.record} })()`)) as typeof record;
			if (record?.graphColors)
				record.graphPixels = pixelCounts(
					shot,
					record.graphColors,
					(record.graphAlpha as Record<string, number> | undefined) ?? {},
				);
		}
		const stats = pngStats(shot);
		if (stats.colors < 2) return { id: item.id, error: "screenshot is blank (one color)" };
		const sha256 = new Bun.CryptoHasher("sha256")
			.update(await Bun.file(shot).arrayBuffer())
			.digest("hex");
		// DevTools matched selectors on the nodes that can carry the forced state (still forced here).
		if (pseudo.length) await matchedOnCandidates(page, cdp);
		const snap = (await page.evaluate(
			`cap.snapshot(${JSON.stringify({
				sels: out.live,
				components: COMPONENTS,
				trim: item.trim ?? null,
				label: item.state && item.state !== "default" ? item.state : null,
				synthetic: item.synthetic ?? null,
			})})`,
		)) as Snap;
		if (snap.lost) return { id: item.id, error: "target vanished before the snapshot" };
		const unseen = snap.seen
			? null
			: ((await page.evaluate("cap.stackAt(window.__cap.target)")) as string[]);
		const file = `${item.id}.${snap.format}`;
		writeFileSync(join(out.fixturesDir, file), snap.html);
		const entry: FixtureEntry = {
			id: item.id,
			file,
			...(snap.format === "xhtml" ? { format: "xhtml" as const } : {}),
			screenshot: `screenshots/${item.id}.png`,
			component: item.component,
			surface: item.surface ?? scene.surface,
			state,
			covers: [item.id],
			obsidianVersion: out.version,
			contains: snap.contains,
			...(snap.imageSizes.length ? { imageSizes: snap.imageSizes } : {}),
			...(item.note ? { note: item.note } : {}),
			...(item.synthetic ? { synthetic: item.synthetic } : {}),
			...(snap.trimmed
				? {
						trimmed: `kept ${snap.trimmed.kept} of ${snap.trimmed.of} ${snap.trimmed.selector} elements (the first ${item.trim?.keep} plus one per distinct state matching ${item.trim?.keepAlso}); the screenshot shows the untrimmed window`,
					}
				: {}),
			evidence: {
				box: vis.box,
				inView: vis.inView ?? [],
				unobscured: vis.unobscured ?? 0,
				marks: probe.marks,
				forced: pseudo,
				...(pseudo.length
					? {
							via,
							painted,
							verified,
							...(unverified.length ? { unverified } : {}),
							...(styleChanged === null ? {} : { styleChanged, styleProps }),
						}
					: {}),
				...(item.expect ? { expect: item.expect } : {}),
				live: snap.live,
				domOnly: snap.domOnly,
				seen: snap.seen,
				...(unseen ? { stackAtCenter: unseen } : {}),
				clip: [clip.x, clip.y, clip.width, clip.height].map((v) => Math.round(v)),
				...(scroll ? { scroll } : {}),
				...(item.media ? { media: JSON.stringify(item.media) } : {}),
				inputMedia: { hover: vp.hover, finePointer: vp.finePointer },
				screenshot: { sha256, ...stats },
				...(record ? { record } : {}),
			},
		};
		return { id: item.id, entry };
	} finally {
		if (forcedNode)
			await cdp
				.send("CSS.forcePseudoState", { nodeId: forcedNode, forcedPseudoClasses: [] })
				.catch(() => undefined);
		if (item.media)
			await cdp
				.send("Emulation.setEmulatedMedia", { media: "", features: [] })
				.catch(() => undefined);
		await page.evaluate("cap.clean()").catch(() => undefined);
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

/** Obsidian's runtime <style> and adopted stylesheets, for rendering fixtures locally (gitignored). */
export async function saveRuntimeStyles(page: Page): Promise<void> {
	const css = (await page.evaluate(`(() => {
		const parts = [];
		for (const s of document.head.querySelectorAll("style")) {
			if (s === app.customCss.styleEl) continue;
			parts.push("/* <style" + (s.id ? " id=" + s.id : "") + "> */\\n" + s.textContent);
		}
		for (const sheet of document.adoptedStyleSheets) parts.push("/* adopted */\\n" + [...sheet.cssRules].map((r) => r.cssText).join("\\n"));
		return parts.join("\\n\\n");
	})()`)) as string;
	if (!css.trim()) throw new Error("no runtime styles found (open an editor first)");
	const dir = new URL("../.app/", import.meta.url).pathname;
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}runtime-styles.css`, css);
}
