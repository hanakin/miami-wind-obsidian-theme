// Replays one saved fixture alone and compares it with its live screenshot. Shared by the
// coverage check and its mutation self-test (replay-selftest.ts), so both judge the same way.
//
// A fixture passes when the target sits where it sat live (within 4 px) and, inside the target:
// - the mean color of each ~16 px block matches (within 24 of 255 per channel) in at least 97% of
//   the blocks: layout, colors and fills;
// - no block loses or gains detail: every edge in the live shot (a luminance step of more than
//   EDGE) has an edge within 1 px in the replay, and the other way round (allowing a few pixels):
//   icons, borders, text.
// Pixels whose content cannot be replayed offline (images, media, frames without their styles,
// canvases without saved pixels, floating stand-ins) are left out, but only where they are
// visible: the check paints those elements in two flat colors and skips the pixels that change.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { Browser, CDPSession, Page } from "playwright";
import { replayCss } from "./css.ts";
import { APP_CSS_MARK, RUNTIME_DIR } from "./engine.ts";
import { INPAGE } from "./inpage.ts";
import { SCREENSHOTS, WORK } from "./obsidian.ts";
import { CAPTURE } from "./plan.ts";
import { replayFixture } from "./replay.ts";
import type { FixtureEntry } from "./types.ts";

/** Share of blocks whose mean color must match. */
export const REPLAY_MIN_MATCH = 0.97;
/** Local contrast (luminance range over 3x3 pixels, of 255) that counts as a detail. */
const EDGE = 40;
/** How much of a detail's contrast may be missing on the other side (within 2 px) before it counts as lost. */
const EDGE_LOSS = 32;

const ASSETS = "https://obsidian-app.invalid/";
const runtimePath = `${CAPTURE}.app/runtime-styles.css`;
const sheetPath: Record<string, string> = {
	app: `${CAPTURE}.app/app.css`,
	runtime: runtimePath,
	theme: `${CAPTURE}../theme.css`,
};
const fonts = (css: string) =>
	css
		.replaceAll('url("./public/', `url("${ASSETS}public/`)
		.replaceAll('url("/lib/', `url("${ASSETS}lib/`);
// Stand-ins keep their box but paint nothing. No animations or transitions: the markup is one
// moment, shown in its resting style (parts that were animating live are masked).
const HIDE_STANDINS =
	"\n[data-capture-placeholder], [data-capture-placeholder] * { visibility: hidden !important; }" +
	"\n*, *::before, *::after { animation: none !important; transition: none !important; }";
const read = (tok: string) =>
	readFileSync(
		tok === "app" || tok === "theme" ? (sheetPath[tok] as string) : `${RUNTIME_DIR}${tok}.css`,
		"utf8",
	);

export interface Result {
	/** "ok": compared and matched; "limit": nothing could be compared; "fail": rejected. */
	status: "ok" | "limit" | "fail";
	why?: string;
	/** Share of compared blocks with a matching mean color. */
	share?: number;
	blocks?: number;
	detailBad?: number;
	replayShot?: string;
}

interface Stage {
	page: Page;
	cdp: CDPSession;
	cssKey: string;
	mediaNow: string;
	behindBlack: boolean;
}

export interface Env {
	stages: { standards: Stage; quirks: Stage };
	cmp: Page;
	css: Map<string, string>;
	glyphRules: Set<string>;
	sheetText: (t: string) => string;
	close: () => Promise<void>;
}

/** Replay pages (standards and quirks mode) and a page to compare images in. */
export async function makeEnv(browser: Browser): Promise<Env> {
	if (!existsSync(`${CAPTURE}.app/assets/public`))
		throw new Error("Obsidian's fonts are not extracted: run `bun run capture:extract-app-css`.");
	if (!existsSync(runtimePath) || !readFileSync(runtimePath, "utf8").trim())
		throw new Error(
			"capture/.app/runtime-styles.css is missing or empty: run `bun run capture:extract-runtime-css`.",
		);
	const stage = async (quirks: boolean): Promise<Stage> => {
		const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
		// Nothing loads from the network; Obsidian's bundled fonts and images come from capture/.app.
		await page.route("**", (r) => {
			const url = r.request().url();
			const file = `${CAPTURE}.app/assets/${url.slice(ASSETS.length).split("?")[0]}`;
			// Fonts load across origins only with CORS (a sandboxed frame has an opaque origin).
			if (url.startsWith(ASSETS) && existsSync(file))
				return r.fulfill({ path: file, headers: { "Access-Control-Allow-Origin": "*" } });
			return r.abort();
		});
		// Quirks mode for fixtures from a window without a doctype (the print window).
		await page.setContent(
			`${quirks ? "" : "<!doctype html>"}<html><head><style id="replay"></style><style id="replay-mask"></style></head><body></body></html>`,
		);
		await page.evaluate(INPAGE);
		const cdp = await page.context().newCDPSession(page);
		return { page, cdp, cssKey: "", mediaNow: "-", behindBlack: false };
	};
	const stages = { standards: await stage(false), quirks: await stage(true) };
	const cmp = await browser.newPage();
	const texts = new Map<string, string>();
	const sheetText = (t: string) => {
		let v = texts.get(t);
		if (v === undefined) {
			v = existsSync(`${RUNTIME_DIR}${t}.css`)
				? readFileSync(`${RUNTIME_DIR}${t}.css`, "utf8")
				: "";
			texts.set(t, v);
		}
		return v;
	};
	mkdirSync(`${WORK}/replay`, { recursive: true });
	return {
		stages,
		cmp,
		css: new Map(),
		glyphRules: new Set(
			[...readFileSync(runtimePath, "utf8").matchAll(/mjx-c\.(mjx-c[0-9A-F]+)/g)].map(
				(m) => m[1] ?? "",
			),
		),
		sheetText,
		close: async () => {
			for (const s of Object.values(stages)) await s.page.close();
			await cmp.close();
		},
	};
}

/** The window's stylesheets in document order (runtimeStyles), or the shared set for old fixtures. */
function windowCss(env: Env, f: FixtureEntry, touch: boolean): string {
	const own = f.runtimeStyles;
	const styles = f.styles ?? Object.keys(sheetPath);
	const key = `${own ? `own ${own.join(" ")}` : styles.join(" ")}|${touch}`;
	let css = env.css.get(key);
	if (css === undefined) {
		if (own) css = own.map((t) => replayCss(read(t), touch)).join("\n");
		else {
			// Old fixtures: runtime styles before the app.css marker, app.css, the rest, theme.css.
			const runtime = styles.includes("runtime") ? replayCss(read("runtime"), touch) : "";
			const at = runtime.indexOf(APP_CSS_MARK);
			const [before, after] = at < 0 ? ["", runtime] : [runtime.slice(0, at), runtime.slice(at)];
			css = [
				before,
				styles.includes("app") ? replayCss(read("app"), touch) : "",
				after,
				styles.includes("theme") ? replayCss(read("theme"), touch) : "",
			].join("\n");
		}
		css = fonts(css) + HIDE_STANDINS;
		env.css.set(key, css);
	}
	return css;
}

/** A frame's own stylesheets (data-capture-frame-styles), as they were. */
function frameCss(env: Env, tokens: string): string {
	const key = `frame ${tokens}`;
	let css = env.css.get(key);
	if (css === undefined) {
		css = fonts(
			tokens
				.split(" ")
				.filter(Boolean)
				.map((t) => (t === "app" || t === "theme" ? read(t) : env.sheetText(t)))
				.join("\n"),
		);
		env.css.set(key, css);
	}
	return css;
}

/** A change to apply after the replay (mutation self-test only). */
export interface Mutation {
	css?: string;
	js?: string;
}

export async function checkFixture(env: Env, f: FixtureEntry, mutate?: Mutation): Promise<Result> {
	const st = f.quirks ? env.stages.quirks : env.stages.standards;
	const { page, cdp } = st;
	const touch = f.id.startsWith("mobile.");
	const lost = (f.runtimeStyles ?? []).filter(
		(t) => t !== "app" && t !== "theme" && !existsSync(`${RUNTIME_DIR}${t}.css`),
	);
	if (lost.length)
		return {
			status: "fail",
			why: `runtime stylesheet missing from capture/.app/runtime: ${lost.join(" ")}`,
		};
	const css = windowCss(env, f, touch);
	if (css !== st.cssKey) {
		await page.evaluate((c) => {
			(document.getElementById("replay") as HTMLStyleElement).textContent = c;
		}, css);
		st.cssKey = css;
	}
	const size =
		f.viewport ??
		(f.id.startsWith("mobile.phone.")
			? [390, 844]
			: f.id.startsWith("mobile.tablet.")
				? [1024, 768]
				: [1600, 1000]);
	await page.setViewportSize({ width: size[0] ?? 1600, height: size[1] ?? 1000 });
	// The media the item was captured under (print, forced colors) and the window's color scheme
	// (forced colors take their palette from it: match the recorded Canvas color).
	const im = f.evidence?.inputMedia;
	const media = `${f.evidence?.media ?? ""}|${im?.dark ?? true}|${im?.canvas ?? ""}`;
	if (media !== st.mediaNow) {
		const m = (f.evidence?.media ? JSON.parse(f.evidence.media) : {}) as {
			media?: string;
			features?: { name: string; value: string }[];
		};
		const canvas = (im?.canvas ?? "").match(/\d+/g)?.map(Number);
		const forced = (m.features ?? []).some((x) => x.name === "forced-colors");
		const scheme =
			forced && canvas
				? (canvas[0] ?? 0) + (canvas[1] ?? 0) + (canvas[2] ?? 0) < 384
					? "dark"
					: "light"
				: im?.dark === false
					? "light"
					: "dark";
		await cdp.send("Emulation.setEmulatedMedia", {
			media: m.media ?? "",
			features: [...(m.features ?? []), { name: "prefers-color-scheme", value: scheme }],
		});
		st.mediaNow = media;
	}
	// Root-relative app files (pdf.js annotation icons) load from the local extract.
	const html = readFileSync(`${CAPTURE}fixtures/${f.file}`, "utf8").replaceAll(
		'src="/lib/',
		`src="${ASSETS}lib/`,
	);
	// MathJax draws each character through its own CSS rule, kept only while it is on screen:
	// every character needs one (fixture <head>, its runtime sheets, or the shared ones).
	const noGlyph = [
		...new Set([...html.matchAll(/class="(mjx-c[0-9A-F]+)"/g)].map((m) => m[1] ?? "")),
	].filter(
		(c) =>
			!env.glyphRules.has(c) &&
			!html.includes(`mjx-c.${c}`) &&
			!(f.runtimeStyles ?? []).some(
				(t) => t !== "app" && t !== "theme" && env.sheetText(t).includes(`mjx-c.${c}`),
			),
	);
	if (noGlyph.length)
		return {
			status: "fail",
			why: `MathJax glyph rules missing (fixture <head> and runtime styles): ${noGlyph.join(" ")}`,
		};
	// A translucent window (body.is-translucent) shows what is behind it: the capture saw black.
	const translucent = /<body[^>]*class="[^"]*\bis-translucent\b/.test(html);
	if (translucent !== st.behindBlack) {
		await cdp.send(
			"Emulation.setDefaultBackgroundColorOverride",
			translucent ? { color: { r: 0, g: 0, b: 0, a: 1 } } : {},
		);
		st.behindBlack = translucent;
	}
	const pixels = (f.canvasPixels ?? []).map((c) => ({
		index: c.index,
		b64: readFileSync(`${CAPTURE}fixtures/${c.file}`).toString("base64"),
	}));
	const frames: Record<string, string> = {};
	for (const m of html.matchAll(/data-capture-frame-styles="([^"]*)"/g))
		frames[m[1] ?? ""] = frameCss(env, m[1] ?? "");
	await page.evaluate(() => {
		(document.getElementById("replay-mask") as HTMLStyleElement).textContent = "";
	});
	const got = await replayFixture(
		page,
		html,
		f.imageSizes ?? [],
		pixels,
		frames,
		f.trimSelector ?? null,
	);
	if (got.why) return { status: "fail", why: `does not render alone: ${got.why}` };
	if (mutate?.css)
		await page.evaluate((c) => {
			const e = document.createElement("style");
			e.setAttribute("data-mutation", "");
			e.textContent = c;
			document.head.appendChild(e);
		}, mutate.css);
	if (mutate?.js) await page.evaluate(mutate.js);
	if (process.env.REPLAY_DEBUG_JS) console.log(await page.evaluate(process.env.REPLAY_DEBUG_JS));
	const ev = f.evidence;
	const shot = `${SCREENSHOTS}/${f.id}.png`;
	if (!ev?.clip || !existsSync(shot))
		return { status: "limit", why: "live screenshot not on this machine" };
	const [cx = 0, cy = 0, , ch = 0] = ev.clip;
	// A scrolled capture stacks every scroll position; the snapshot is of the last one, at the bottom.
	const liveDy = (ev.screenshot?.height ?? ch) - ch;
	const regions: number[][] = [];
	if (f.trimmed) {
		// Trimmed lists: each kept entry, compared by its own live and replayed box.
		if (process.env.REPLAY_DEBUG)
			for (const e of (got.entries ?? []).slice(0, 4))
				console.log(
					"entry live",
					e.live.map(Math.round).join(","),
					"now",
					e.now.map(Math.round).join(","),
				);
		for (const e of got.entries ?? []) {
			const [lx = 0, ly = 0, w = 0, h = 0] = e.live;
			const [rx = 0, ry = 0] = e.now;
			regions.push([lx - cx, ly - cy + liveDy, rx, ry, w, h]);
		}
		if (!regions.length)
			return { status: "limit", why: "trimmed fixture: no kept entry to compare" };
	} else {
		const [lx = 0, ly = 0, lw = 0, lh = 0] = ev.inView;
		const [rx = 0, ry = 0, rw = 0, rh = 0] = got.inView ?? [];
		if (Math.max(Math.abs(lx - rx), Math.abs(ly - ry), Math.abs(lw - rw), Math.abs(lh - rh)) > 4)
			return {
				status: "fail",
				why: `replay layout differs: target at ${[lx, ly, lw, lh].map(Math.round).join(",")} live, ${[rx, ry, rw, rh].map(Math.round).join(",")} replayed alone${got.moved ? `; first moved: ${got.moved}` : ""}`,
			};
		// A thin target (a slider track) is padded on its thinner side like the screenshot, so a
		// pixel of drift does not decide alone.
		const padX = lw < 16 && lw <= lh ? 8 : 0;
		const padY = lh < 16 && lh < lw ? 8 : 0;
		regions.push([
			lx - cx - padX,
			ly - cy + liveDy - padY,
			rx - padX,
			ry - padY,
			lw + 2 * padX,
			lh + 2 * padY,
		]);
	}
	const replayShot = `${WORK}/replay/${f.id}.png`;
	const full = await page.screenshot({ path: replayShot });
	let maskA: Buffer | null = null;
	let maskB: Buffer | null = null;
	if (got.masked) {
		const paint = async (fill: string, filter: string) => {
			await page.evaluate(
				([fill, filter]) => {
					(document.getElementById("replay-mask") as HTMLStyleElement).textContent =
						`[data-replay-mask] { background: ${fill} !important; filter: ${filter} !important; } [data-replay-mask="overlay"] { visibility: visible !important; }`;
				},
				[fill, filter] as const,
			);
			return page.screenshot();
		};
		maskA = await paint("#000", "brightness(0)");
		maskB = await paint("#fff", "brightness(0) invert(1)");
		await page.evaluate(() => {
			(document.getElementById("replay-mask") as HTMLStyleElement).textContent = "";
		});
	}
	await page.evaluate(() => {
		for (const e of document.querySelectorAll("[data-mutation]")) e.remove();
	});
	const res = (await env.cmp.evaluate(compare, [
		readFileSync(shot).toString("base64"),
		full.toString("base64"),
		maskA?.toString("base64") ?? null,
		maskB?.toString("base64") ?? null,
		regions,
		EDGE,
		EDGE_LOSS,
		!!process.env.REPLAY_DEBUG,
	] as const)) as {
		blocks: number;
		bad: number;
		detailBad: number;
		detailGone: number;
		where: string[];
		detail: string[];
	};
	if (!res.blocks)
		return {
			status: "limit",
			why: "nothing to compare: the target is all images, media or frames without their stylesheets",
		};
	const share = 1 - res.bad / res.blocks;
	const base = { share, blocks: res.blocks, detailBad: res.detailBad, replayShot };
	if (share < REPLAY_MIN_MATCH)
		return {
			...base,
			status: "fail",
			why: `replay differs from the live screenshot in ${Math.round((100 * res.bad) / res.blocks)}% of the target (16 px blocks; first at ${res.where.join(" ")} in ${replayShot})`,
		};
	// Forced colors take their palette from the browser build (Electron's and the replay's differ
	// in border shades): detail is not judged there, and that is labeled.
	if ((res.detailBad >= 3 || res.detailGone) && (f.evidence?.media ?? "").includes("forced-colors"))
		return {
			...base,
			status: "limit",
			why: "forced colors: the system palette differs between Electron's Chromium and the replay's, so only block colors are judged",
		};
	if (res.detailBad >= 3 || res.detailGone)
		return {
			...base,
			status: "fail",
			why: `replay loses or adds detail (edges) in ${res.detailBad} block(s) of the target (first at ${res.detail.join(" ")} in ${replayShot})`,
		};
	return { ...base, status: "ok" };
}

/** Runs in the compare page: block colors and edges per region, masked pixels left out. */
async function compare([live, replay, maskA, maskB, regions, EDGE, EDGE_LOSS, DEBUG]: readonly [
	string,
	string,
	string | null,
	string | null,
	number[][],
	number,
	number,
	boolean,
]) {
	const data = async (b64: string) => {
		const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
		const c = new OffscreenCanvas(bmp.width, bmp.height);
		const x = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
		x.drawImage(bmp, 0, 0);
		return x.getImageData(0, 0, bmp.width, bmp.height);
	};
	const a = await data(live);
	const b = await data(replay);
	const m1 = maskA ? await data(maskA) : null;
	const m2 = maskB ? await data(maskB) : null;
	const W = b.width;
	const H = b.height;
	// Masked replay pixels (where a masked element shows), grown by 1 px.
	const raw = new Uint8Array(W * H);
	if (m1 && m2)
		for (let i = 0; i < W * H; i++) {
			const p = i * 4;
			if (
				Math.abs((m1.data[p] ?? 0) - (m2.data[p] ?? 0)) +
					Math.abs((m1.data[p + 1] ?? 0) - (m2.data[p + 1] ?? 0)) +
					Math.abs((m1.data[p + 2] ?? 0) - (m2.data[p + 2] ?? 0)) >
				96
			)
				raw[i] = 1;
		}
	const masked = new Uint8Array(W * H);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			let hit = 0;
			for (let j = -1; j <= 1 && !hit; j++)
				for (let i = -1; i <= 1 && !hit; i++) {
					const xx = x + i;
					const yy = y + j;
					if (xx >= 0 && yy >= 0 && xx < W && yy < H && raw[yy * W + xx]) hit = 1;
				}
			masked[y * W + x] = hit;
		}
	// Local contrast: the luminance range over each pixel's 3x3 neighborhood (r3) and 5x5 (r5). A
	// detail (an icon stroke, a 1 px border, text) shows as contrast; a sub-pixel shift between
	// Chromium builds stays inside the larger window on the other side.
	const ranges = (d: ImageData) => {
		const w = d.width;
		const h = d.height;
		const L = new Float32Array(w * h);
		for (let i = 0; i < w * h; i++)
			L[i] =
				0.299 * (d.data[i * 4] ?? 0) +
				0.587 * (d.data[i * 4 + 1] ?? 0) +
				0.114 * (d.data[i * 4 + 2] ?? 0);
		const range = (rad: number) => {
			// Separable max/min filters.
			const mxH = new Float32Array(w * h);
			const mnH = new Float32Array(w * h);
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) {
					let mx = -1;
					let mn = 256;
					for (let k = -rad; k <= rad; k++) {
						const xx = Math.min(w - 1, Math.max(0, x + k));
						const v = L[y * w + xx] ?? 0;
						if (v > mx) mx = v;
						if (v < mn) mn = v;
					}
					mxH[y * w + x] = mx;
					mnH[y * w + x] = mn;
				}
			const r = new Float32Array(w * h);
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) {
					let mx = -1;
					let mn = 256;
					for (let k = -rad; k <= rad; k++) {
						const yy = Math.min(h - 1, Math.max(0, y + k));
						const a1 = mxH[yy * w + x] ?? 0;
						const b1 = mnH[yy * w + x] ?? 0;
						if (a1 > mx) mx = a1;
						if (b1 < mn) mn = b1;
					}
					r[y * w + x] = mx - mn;
				}
			return r;
		};
		return { r3: range(1), r5: range(2) };
	};
	const ea = ranges(a);
	const eb = ranges(b);
	const B = 16;
	let blocks = 0;
	let bad = 0;
	let detailBad = 0;
	let detailGone = 0;
	const where: string[] = [];
	const detail: string[] = [];
	// Even cuts of about B px, so no sliver of a block at the edge decides alone.
	const cuts = (n0: number) => {
		const n = Math.max(1, Math.round(n0 / B));
		return Array.from({ length: n }, (_, k) => [
			Math.round((n0 * k) / n),
			Math.round((n0 * (k + 1)) / n),
		]);
	};
	for (const [lx00 = 0, ly00 = 0, rx00 = 0, ry00 = 0, w00 = 0, h00 = 0] of regions) {
		// 2 px in from each side (when there is room): a neighbor's border on the target's edge (the
		// vault bar under the file explorer) belongs to the neighbor.
		const ix = w00 > 12 ? 2 : 0;
		const iy = h00 > 12 ? 2 : 0;
		const [lx0, ly0, rx0, ry0, w0, h0] = [
			lx00 + ix,
			ly00 + iy,
			rx00 + ix,
			ry00 + iy,
			w00 - 2 * ix,
			h00 - 2 * iy,
		];
		// Inside both images.
		const lx = Math.round(lx0);
		const ly = Math.round(ly0);
		const rx = Math.round(rx0);
		const ry = Math.round(ry0);
		const sx = Math.max(0, -lx, -rx);
		const sy = Math.max(0, -ly, -ry);
		const w = Math.min(Math.round(w0), a.width - lx, W - rx);
		const h = Math.min(Math.round(h0), a.height - ly, H - ry);
		if (w - sx < 1 || h - sy < 1) continue;
		for (const [by0 = 0, by1 = 0] of cuts(h - sy))
			for (const [bx0 = 0, bx1 = 0] of cuts(w - sx)) {
				const sa = [0, 0, 0];
				const sb = [0, 0, 0];
				let n = 0;
				let liveEdges = 0;
				let missing = 0;
				let replayEdges = 0;
				let extra = 0;
				for (let j = sy + by0; j < sy + by1; j++)
					for (let i = sx + bx0; i < sx + bx1; i++) {
						const X = rx + i;
						const Y = ry + j;
						if (masked[Y * W + X]) continue;
						const pa = ((ly + j) * a.width + lx + i) * 4;
						const pb = (Y * W + X) * 4;
						for (let k = 0; k < 3; k++) {
							sa[k] = (sa[k] ?? 0) + (a.data[pa + k] ?? 0);
							sb[k] = (sb[k] ?? 0) + (b.data[pb + k] ?? 0);
						}
						n++;
						const ia = (ly + j) * a.width + lx + i;
						const ib = Y * W + X;
						const ca = ea.r3[ia] ?? 0;
						const cb = eb.r3[ib] ?? 0;
						if (ca > EDGE) {
							liveEdges++;
							if (ca - (eb.r5[ib] ?? 0) > EDGE_LOSS) missing++;
						}
						if (cb > EDGE) {
							replayEdges++;
							if (cb - (ea.r5[ia] ?? 0) > EDGE_LOSS) extra++;
						}
					}
				const area = (by1 - by0) * (bx1 - bx0);
				if (n < area / 2) continue;
				blocks++;
				const diff = Math.max(...sa.map((v, k) => Math.abs(v - (sb[k] ?? 0)) / n));
				if (diff > 24) {
					bad++;
					if (where.length < 3) where.push(`${lx + sx + bx0},${ly + sy + by0}`);
				}
				// A block that lost or gained detail: more than a few pixels of contrast with no
				// counterpart within 2 px. One or two such blocks can be glyph rendering between Chromium
				// builds (small or italic text a pixel off); they fail only when at least half a block's
				// detail is gone or new (a hidden icon, a vanished part, a missing border). Three or more
				// always fail.
				if (missing > Math.max(3, 0.2 * liveEdges) || extra > Math.max(3, 0.2 * replayEdges)) {
					detailBad++;
					if (missing >= Math.max(6, 0.5 * liveEdges) || extra >= Math.max(6, 0.5 * replayEdges))
						detailGone++;
					if (detail.length < (DEBUG ? 80 : 3))
						detail.push(
							`${lx + sx + bx0},${ly + sy + by0}${DEBUG ? `[miss ${missing}/${liveEdges} extra ${extra}/${replayEdges}]` : ""}`,
						);
				}
			}
	}
	return { blocks, bad, detailBad, detailGone, where, detail };
}
