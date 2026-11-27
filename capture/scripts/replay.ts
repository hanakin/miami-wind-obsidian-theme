// Replays a saved fixture alone in a page prepared with the replay stylesheet and INPAGE: what
// the coverage check renders and compares with the live screenshot. A viewer can follow the same
// steps: images sized from imageSizes, canvas pixels drawn, stand-ins sized, scroll restored.
import type { Page } from "playwright";

export interface Replayed {
	why: string;
	inView?: number[] | null;
	/** Elements whose content cannot be replayed are marked data-replay-mask (see replay-check.ts). */
	masked?: number;
	/** Trimmed fixtures: each kept entry's live box and replayed box. */
	entries?: { live: number[]; now: number[] }[];
	/** The first part around the target (outermost first) that is not where it was live. */
	moved?: string | null;
}

export async function replayFixture(
	page: Page,
	html: string,
	sizes: { index: number; width: number; height: number }[],
	canvases: { index: number; b64: string }[],
	frames: Record<string, string> = {},
	trimSelector: string | null = null,
): Promise<Replayed> {
	return (await page.evaluate(
		async ([html, sizes, canvases, frames, trimSelector]) => {
			const d = new DOMParser().parseFromString(
				html,
				html.startsWith("<?xml") ? "application/xhtml+xml" : "text/html",
			);
			for (const [from, to] of [
				[d.documentElement, document.documentElement],
				[d.body, document.body],
			] as const) {
				for (const a of [...to.attributes]) to.removeAttribute(a.name);
				for (const a of [...from.attributes]) to.setAttribute(a.name, a.value);
			}
			// The fixture's own runtime rules (MathJax glyphs) go with it.
			for (const st of document.head.querySelectorAll("style[data-capture-runtime]")) st.remove();
			for (const st of d.querySelectorAll("head style[data-capture-runtime]"))
				document.head.appendChild(document.importNode(st, true));
			document.body.replaceChildren(
				...[...d.body.childNodes].map((n) => document.importNode(n, true)),
			);
			// Frames get their own stylesheets back (data-capture-frame-styles), then load.
			const loads: Promise<unknown>[] = [];
			for (const fr of document.querySelectorAll<HTMLIFrameElement>(
				"iframe[data-capture-frame-styles]",
			)) {
				const css = frames[fr.getAttribute("data-capture-frame-styles") ?? ""];
				if (css === undefined) continue;
				const sd = fr.getAttribute("srcdoc") ?? "";
				loads.push(new Promise((ok) => fr.addEventListener("load", ok, { once: true })));
				fr.setAttribute("data-replay-frame", "");
				// Its Content-Security-Policy allowed the app's own font origin; the replay serves the
				// same files from another one, so the policy is left out.
				fr.srcdoc = sd
					.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy[^>]*>/gi, "")
					.replace(
						/<head([^>]*)>/i,
						(m) => `${m}<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
					);
			}
			await Promise.race([Promise.all(loads), new Promise((ok) => setTimeout(ok, 3000))]);
			// Offline images get same-size stand-ins from the recorded imageSizes.
			for (const { index, width, height } of sizes) {
				const im = document.images[index];
				if (im) {
					im.width = width;
					im.height = height;
					// A broken image ignores its size; a transparent stand-in of that size does not.
					im.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
					im.setAttribute("data-replay-standin", "");
				}
			}
			// Recorded canvas pixels, then recorded scroll offsets (after layout).
			const cvs = document.querySelectorAll("canvas");
			for (const { index, b64 } of canvases) {
				const cv = cvs[index];
				if (!cv) continue;
				const bmp = await createImageBitmap(
					await (await fetch(`data:image/png;base64,${b64}`)).blob(),
				);
				cv.getContext("2d")?.drawImage(bmp, 0, 0, cv.width, cv.height);
				cv.setAttribute("data-replay-pixels", "");
			}
			// Empty stand-ins take their recorded live size.
			for (const e of document.querySelectorAll<HTMLElement>("[data-capture-size]")) {
				const [w = 0, h = 0] = (e.getAttribute("data-capture-size") ?? "").split(" ").map(Number);
				// Unknown outside Electron (<webview>) or empty and inline: a size needs a box.
				const disp =
					e.getAttribute("data-capture-display") ??
					(getComputedStyle(e).display === "inline" ? "inline-block" : null);
				const [mt, mb] = (e.getAttribute("data-capture-margin") ?? "").split(" ");
				for (const [k, v] of [
					...(disp ? [["display", disp]] : []),
					...(mt && mb
						? [
								["margin-top", `${mt}px`],
								["margin-bottom", `${mb}px`],
							]
						: []),
					["box-sizing", "border-box"],
					["width", `${w}px`],
					["height", `${h}px`],
					["min-width", "0"],
					["min-height", "0"],
					["max-width", "none"],
					["max-height", "none"],
					["flex", "none"],
				])
					e.style.setProperty(k as string, v as string, "important");
			}
			// A scrollbar shown live but missing here (a trimmed list no longer overflows) is forced
			// back; one already shown is left alone.
			for (const e of document.querySelectorAll<HTMLElement>("[data-capture-scrollbar]")) {
				const bars = e.getAttribute("data-capture-scrollbar") ?? "";
				const cs = getComputedStyle(e);
				const bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
				const bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
				if (bars.includes("y") && e.offsetWidth - e.clientWidth - bw <= 0)
					e.style.setProperty("overflow-y", "scroll", "important");
				if (bars.includes("x") && e.offsetHeight - e.clientHeight - bh <= 0)
					e.style.setProperty("overflow-x", "scroll", "important");
			}
			// Controls whose state is not in the markup.
			for (const e of document.querySelectorAll<HTMLSelectElement>(
				"select[data-capture-select-none]",
			))
				e.selectedIndex = -1;
			for (const e of document.querySelectorAll<HTMLInputElement>(
				"input[data-capture-indeterminate]",
			))
				e.indeterminate = true;
			// Absolutely placed ancestors of the target take their recorded live size when the replay
			// differs (a PDF viewer sized by state the markup does not hold). The surroundings, not
			// the target, so the target is still judged.
			{
				const tgt = document.querySelector("[data-capture-target]");
				for (let a = tgt?.parentElement ?? null; a && a !== document.body; a = a.parentElement) {
					const want = a.getAttribute("data-capture-box")?.split(" ").map(Number);
					if (!want || !/^(absolute|fixed)$/.test(getComputedStyle(a).position)) continue;
					const r = a.getBoundingClientRect();
					if (Math.abs(r.width - (want[2] ?? 0)) > 1 || Math.abs(r.height - (want[3] ?? 0)) > 1) {
						(a as HTMLElement).style.setProperty("box-sizing", "border-box", "important");
						(a as HTMLElement).style.setProperty("width", `${want[2]}px`, "important");
						(a as HTMLElement).style.setProperty("height", `${want[3]}px`, "important");
					}
				}
			}
			// The recorded native text selection.
			const end = (name: string): [Node, number] | null => {
				const e = document.querySelector(`[data-capture-sel-${name}]`);
				const [i = -1, off = 0] = (e?.getAttribute(`data-capture-sel-${name}`) ?? "")
					.split(" ")
					.map(Number);
				const n = e && (i < 0 ? e : e.childNodes[i]);
				return n ? [n, off] : null;
			};
			const a = end("anchor");
			const z = end("focus");
			if (a && z)
				try {
					getSelection()?.setBaseAndExtent(a[0], a[1], z[0], z[1]);
				} catch {}
			// Text selected inside a field (it shows only while the field has focus).
			const field = document.querySelector<HTMLInputElement>("[data-capture-input-selection]");
			if (field) {
				const [from = "0", to = "0", dir = "none"] = (
					field.getAttribute("data-capture-input-selection") ?? ""
				).split(" ");
				try {
					field.focus();
					field.setSelectionRange(Number(from), Number(to), dir as "none");
				} catch {}
			}
			// Scroll offsets once fonts have loaded (the content has its final height).
			await document.fonts.ready;
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			for (const e of document.querySelectorAll("[data-capture-scroll]")) {
				const [top = 0, left = 0] = (e.getAttribute("data-capture-scroll") ?? "")
					.split(" ")
					.map(Number);
				e.scrollTop = top;
				e.scrollLeft = left;
			}
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			const t = document.querySelector("[data-capture-target]");
			if (!t) return { why: "no target" };
			for (let a: Element | null = t; a; a = a.parentElement) {
				const cs = getComputedStyle(a);
				if (cs.display === "none")
					return { why: `display: none on ${a.localName}.${[...a.classList].join(".")}` };
				if (a === t && cs.visibility === "hidden")
					return { why: `visibility: hidden on ${a.localName}.${[...a.classList].join(".")}` };
			}
			const area = (e: Element) =>
				[...e.getClientRects()].reduce((s, r) => s + r.width * r.height, 0);
			let boxed = area(t) > 0;
			if (!boxed)
				for (const d2 of t.querySelectorAll("*"))
					if (area(d2) > 0 && getComputedStyle(d2).visibility !== "hidden") {
						boxed = true;
						break;
					}
			if (!boxed) return { why: "renders with no box" };
			// What replay cannot reproduce offline is marked data-replay-mask; the check paints those
			// elements in two flat colors and leaves out only the pixels that change, so anything
			// drawn above them (controls over the graph) is still compared. Frames that showed
			// nothing, or got their stylesheets back, hide nothing.
			let masked = 0;
			const mark = (e: Element, how = "") => {
				e.setAttribute("data-replay-mask", how);
				masked++;
			};
			for (const e of document.querySelectorAll(
				"img, video, audio, iframe, object, embed, webview, canvas:not([data-replay-pixels])",
			)) {
				// A loaded image (data:, or an app icon from the local extract) is replayed as it was.
				const im = e as HTMLImageElement;
				if (
					e.localName === "img" &&
					im.complete &&
					im.naturalWidth > 0 &&
					!e.hasAttribute("data-replay-standin")
				)
					continue;
				if (
					e.localName === "iframe" &&
					(e.hasAttribute("data-capture-frame-empty") || e.hasAttribute("data-replay-frame"))
				)
					continue;
				mark(e);
			}
			// Floating stand-ins (the titlebar's buttons, the status bar) painted these boxes over the
			// window live; replayed they are hidden. Animated parts and the text caret changed with
			// time. Those boxes are left out (topmost overlays, invisible except while the check
			// paints its masks).
			for (const e of document.querySelectorAll("[data-capture-paints], [data-capture-animated]")) {
				const list =
					e.getAttribute("data-capture-paints") ?? e.getAttribute("data-capture-animated");
				for (const box of (list ?? "").split(" ").filter(Boolean)) {
					const [x = 0, y = 0, w = 0, h = 0] = box.split(",").map(Number);
					const o = document.createElement("div");
					o.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:2147483647;visibility:hidden;pointer-events:none`;
					document.body.appendChild(o);
					mark(o, "overlay");
				}
			}
			// Background images from app: / https: files do not load offline either.
			for (const e of document.querySelectorAll("[style*='url(']")) {
				if (!/url\(\s*["']?(?!data:)/.test(getComputedStyle(e).backgroundImage)) continue;
				mark(e);
			}
			// Trimmed lists: each kept entry, live box and replayed box.
			const entries: { live: number[]; now: number[] }[] = [];
			if (trimSelector)
				for (const e of t.querySelectorAll(trimSelector)) {
					const want = e.getAttribute("data-capture-box")?.split(" ").map(Number);
					const r = e.getBoundingClientRect();
					if (want && r.width >= 1 && r.height >= 1)
						entries.push({ live: want, now: [r.x, r.y, r.width, r.height] });
				}
			const cap = (window as unknown as { cap: { visibleRect(e: Element): number[] | null } }).cap;
			// The first recorded part (outermost first) that is not where it was live.
			let moved: string | null = null;
			const chain: Element[] = [];
			for (let a: Element | null = t; a && a !== document.documentElement; a = a.parentElement)
				chain.unshift(a);
			for (const a of chain) {
				// Parts before the branch (and the branch itself); later ones move with its content.
				const kids = a.parentElement ? [...a.parentElement.children] : [a];
				for (const e of kids.slice(0, kids.indexOf(a) + 1)) {
					const want = e.getAttribute("data-capture-box")?.split(" ").map(Number);
					if (!want || moved) continue;
					const r = e.getBoundingClientRect();
					const got = [r.x, r.y, r.width, r.height];
					// Ancestors by position (their size follows their content); other parts by box.
					const n = chain.includes(e) ? 2 : 4;
					if (want.slice(0, n).some((v, k) => Math.abs(v - (got[k] ?? 0)) > 2))
						moved = `${e.localName}.${[...e.classList].slice(0, 2).join(".")}${e.hasAttribute("data-capture-placeholder") ? " (stand-in)" : ""} at ${got.map(Math.round).join(",")}, live ${want.map(Math.round).join(",")}`;
				}
				if (moved) break;
			}
			// Else the first part inside the target that is not where it was.
			// (Position first: a container grows because a part inside it moved or grew.)
			for (const n of [2, 4]) {
				if (moved) break;
				for (const e of t.querySelectorAll("[data-capture-box]")) {
					const want = (e.getAttribute("data-capture-box") ?? "").split(" ").map(Number);
					const r = e.getBoundingClientRect();
					const got = [r.x, r.y, r.width, r.height];
					if (want.slice(0, n).some((v, k) => Math.abs(v - (got[k] ?? 0)) > 2)) {
						moved = `${e.localName}.${[...e.classList].slice(0, 2).join(".")} inside the target at ${got.map(Math.round).join(",")}, live ${want.map(Math.round).join(",")}`;
						break;
					}
				}
			}
			return { why: "", inView: cap.visibleRect(t), masked, entries, moved };
		},
		[html, sizes, canvases, frames, trimSelector] as const,
	)) as Replayed;
}
