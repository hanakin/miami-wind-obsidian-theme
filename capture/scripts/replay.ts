// Replays a saved fixture alone in a page prepared with the replay stylesheet and INPAGE: what
// the coverage check renders and compares with the live screenshot. A viewer can follow the same
// steps: images sized from imageSizes, canvas pixels drawn, stand-ins sized, scroll restored.
import type { Page } from "playwright";

export interface Replayed {
	why: string;
	inView?: number[] | null;
	masks?: number[][];
	/** The first part around the target (outermost first) that is not where it was live. */
	moved?: string | null;
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
			// The fixture's own runtime rules (MathJax glyphs) go with it.
			for (const st of document.head.querySelectorAll("style[data-capture-runtime]")) st.remove();
			for (const st of d.querySelectorAll("head style[data-capture-runtime]"))
				document.head.appendChild(document.importNode(st, true));
			document.body.replaceChildren(
				...[...d.body.childNodes].map((n) => document.importNode(n, true)),
			);
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
			// What replay cannot reproduce offline: images, media, iframes (their stylesheets are not
			// kept), canvases without recorded pixels.
			const masks: number[][] = [];
			for (const e of document.querySelectorAll(
				"img, video, audio, iframe, object, embed, webview, canvas:not([data-replay-pixels])",
			)) {
				if (
					e.localName === "img" &&
					(e.getAttribute("src") ?? "").startsWith("data:") &&
					!e.hasAttribute("data-replay-standin")
				)
					continue;
				for (const r of e.getClientRects()) masks.push([r.x, r.y, r.width, r.height]);
			}
			// Positioned stand-ins (the status bar, other floating parts) painted over the target
			// live; replayed, they are hidden.
			for (const e of document.querySelectorAll("[data-capture-placeholder]")) {
				if (!/^(absolute|fixed|sticky)$/.test(getComputedStyle(e).position)) continue;
				for (const r of e.getClientRects()) masks.push([r.x, r.y, r.width, r.height]);
			}
			// Background images from app: / https: files do not load offline either.
			for (const e of document.querySelectorAll("[style*='url(']")) {
				if (!/url\(\s*["']?(?!data:)/.test(getComputedStyle(e).backgroundImage)) continue;
				for (const r of e.getClientRects()) masks.push([r.x, r.y, r.width, r.height]);
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
			return { why: "", inView: cap.visibleRect(t), masks, moved };
		},
		[html, sizes, canvases] as const,
	)) as Replayed;
}
