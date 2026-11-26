// Replays a saved fixture alone in a page prepared with the replay stylesheet and INPAGE: what
// the coverage check renders and compares with the live screenshot. A viewer can follow the same
// steps: images sized from imageSizes, canvas pixels drawn, stand-ins sized, scroll restored.
import type { Page } from "playwright";

export interface Replayed {
	why: string;
	inView?: number[] | null;
	masks?: number[][];
}

export async function replayFixture(
	page: Page,
	html: string,
	sizes: { index: number; width: number; height: number }[],
	canvases: { index: number; b64: string }[],
): Promise<Replayed> {
	return (await page.evaluate(
		async ([html, sizes, canvases]) => {
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
			document.body.replaceChildren(
				...[...d.body.childNodes].map((n) => document.importNode(n, true)),
			);
			// Offline images get same-size stand-ins from the recorded imageSizes.
			for (const { index, width, height } of sizes) {
				const im = document.images[index];
				if (im) {
					im.width = width;
					im.height = height;
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
				const disp = e.getAttribute("data-capture-display");
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
			for (const e of document.querySelectorAll("[data-capture-scroll]")) {
				const [top = 0, left = 0] = (e.getAttribute("data-capture-scroll") ?? "")
					.split(" ")
					.map(Number);
				e.scrollTop = top;
				e.scrollLeft = left;
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
			// What replay cannot reproduce offline: images, media, iframes (their stylesheets are not
			// kept), canvases without recorded pixels.
			const masks: number[][] = [];
			for (const e of document.querySelectorAll(
				"img, video, audio, iframe, object, embed, canvas:not([data-replay-pixels])",
			)) {
				if (e.localName === "img" && (e.getAttribute("src") ?? "").startsWith("data:")) continue;
				for (const r of e.getClientRects()) masks.push([r.x, r.y, r.width, r.height]);
			}
			// Background images from app: / https: files do not load offline either.
			for (const e of document.querySelectorAll("[style*='url(']")) {
				if (!/url\(\s*["']?(?!data:)/.test(getComputedStyle(e).backgroundImage)) continue;
				for (const r of e.getClientRects()) masks.push([r.x, r.y, r.width, r.height]);
			}
			const cap = (window as unknown as { cap: { visibleRect(e: Element): number[] | null } }).cap;
			return { why: "", inView: cap.visibleRect(t), masks };
		},
		[html, sizes, canvases] as const,
	)) as Replayed;
}
