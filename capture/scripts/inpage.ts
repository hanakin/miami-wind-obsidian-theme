// Helpers installed into each Obsidian window as `window.cap`. Plain JS on purpose: it runs
// inside Obsidian through Runtime.evaluate, which Obsidian's CSP does not block.
//
// The live page is never marked: CodeMirror redraws lines whose attributes change, which drops
// held states. Target, states and "seen" witnesses live in JS (window.__cap) and are written onto
// an off-page copy of the whole document, which also serves the live selector checks.
export const INPAGE = String.raw`
(() => {
	// Popout windows (settings, popout tabs) reach the app through their opener.
	if (!window.app && window.opener?.app) window.app = window.opener.app;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	// Runtime class census: every class any element carries while the capture runs, including
	// elements that are created and removed at once (MutationObserver keeps the added node).
	if (!window.__capCensus) {
		const seen = (window.__capCensus = new Set());
		const add = (el) => { if (el.classList) for (const c of el.classList) seen.add(c); };
		const scan = (root) => { add(root); root.querySelectorAll?.("[class]").forEach(add); };
		scan(document.documentElement);
		new MutationObserver((ms) => {
			for (const m of ms) {
				if (m.type === "attributes") add(m.target);
				else m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); });
			}
		}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
	}
	const last = (sel) => { const all = document.querySelectorAll(sel); return all[all.length - 1] ?? null; };
	const ROOTS = {
		doc: () => document,
		modal: () => last(".modal-container .modal"),
		container: () => last(".modal-container"),
		menu: () => last(".menu"),
		prompt: () => last(".prompt"),
		popover: () => last(".popover"),
		// The most recent leaf in the main area (sidebar leaves can hold the active flag).
		leaf: () => app.workspace.getMostRecentLeaf?.(app.workspace.rootSplit)?.containerEl ?? document.querySelector(".mod-root .workspace-leaf.mod-active") ?? document.querySelector(".mod-root .workspace-leaf"),
		root: () => document.querySelector(".workspace-split.mod-root"),
		left: () => document.querySelector(".workspace-split.mod-left-split"),
		right: () => document.querySelector(".workspace-split.mod-right-split"),
	};
	function find(t) {
		if (typeof t === "string") t = { sel: t };
		const root = ROOTS[t.in ?? "doc"]?.();
		if (!root) return null;
		let list = [...root.querySelectorAll(t.sel)];
		if (root !== document && root.matches?.(t.sel)) list.unshift(root);
		if (t.text !== undefined) list = list.filter((e) => (e.textContent ?? "").includes(t.text));
		// Without nth, prefer the first match that is actually rendered.
		const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
		let el = t.nth === undefined ? (list.find(shown) ?? list[0] ?? null) : (list[t.nth] ?? null);
		for (let i = 0; el && i < (t.next ?? 0); i++) el = el.nextElementSibling;
		if (el && t.closest) el = el.closest(t.closest);
		return el;
	}
	function scrollers() {
		const leaf = ROOTS.leaf();
		if (!leaf) return [];
		return [...leaf.querySelectorAll(".cm-scroller, .markdown-preview-view, .view-content")].filter(
			(e) => e.scrollHeight > e.clientHeight + 4 && e.offsetParent !== null,
		);
	}
	/** Finds the target, scrolling the active view to render virtualized content when needed. */
	async function locate(t, noScroll) {
		let el = find(t);
		if (!el) {
			for (const s of scrollers()) {
				s.scrollTop = 0;
				await sleep(120);
				for (let i = 0; i < 80 && !el; i++) {
					el = find(t);
					if (el) break;
					if (s.scrollTop + s.clientHeight >= s.scrollHeight - 2) break;
					s.scrollTop += s.clientHeight * 0.8;
					await sleep(150);
				}
				if (el) break;
			}
		}
		if (el && !noScroll && el.scrollIntoView && !el.closest(".menu, .popover, .prompt, .suggestion-container")) {
			el.scrollIntoView({ block: "center", inline: "nearest" });
			await sleep(250);
			el = find(t) ?? el;
		}
		return el;
	}
	async function open(file, mode, newLeaf) {
		// Always open in the main window's root split: an earlier scene can leave a leaf in a
		// popout window, which getLeaf(false) would otherwise reuse.
		const ws = app.workspace;
		let leaf = ws.getMostRecentLeaf(ws.rootSplit);
		if (leaf) ws.setActiveLeaf(leaf, { focus: false });
		if (!leaf || newLeaf || leaf.pinned) leaf = ws.getLeaf("tab");
		const state = mode === "reading" ? { file, mode: "preview" } : { file, mode: "source", source: mode === "source" };
		const type = file.endsWith(".md") ? "markdown" : app.viewRegistry.getTypeByExtension(file.split(".").pop());
		await leaf.setViewState({ type, state, active: true });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		await sleep(600);
		return leaf;
	}
	const overlays = () => document.querySelectorAll(".modal-container, .menu, .suggestion-container, .popover, .prompt").length;
	/** Per-item capture state, kept in JS so the live page is never marked. */
	function reset() {
		window.__cap = { target: null, pseudo: null, forced: [], verified: [], states: new Map(), seen: new Set(), flags: {}, cands: [], cdp: null };
	}
	reset();
	/** Clears capture state and tooltips. Escape presses (resetUi) close modals and menus. */
	function clean() {
		document.querySelectorAll(".tooltip").forEach((e) => e.remove());
		window.__capPointer = null;
		reset();
	}
	/** Settings keep their search text between openings; clear it so the tab content shows. */
	function clearSettingsSearch() {
		const input = document.querySelector(".modal.mod-settings .setting-search-container input");
		if (input && input.value) {
			input.value = "";
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}
	}
	/** Shows the sidebar leaf (and sidebar) that holds el when el is not rendered. */
	async function reveal(el) {
		const r = el.getBoundingClientRect();
		if (r.width > 0 && r.height > 0) return;
		const leafEl = el.closest(".workspace-leaf");
		if (!leafEl) return;
		let leaf = null;
		app.workspace.iterateAllLeaves((l) => { if (l.containerEl === leafEl) leaf = l; });
		if (leaf) { await app.workspace.revealLeaf(leaf); await sleep(300); }
	}
	const describe = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
	const related = (a, b) => a === b || a.contains(b) || b.contains(a);
	const inter = (a, b) => {
		const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
		const r = Math.min(a[0] + a[2], b[0] + b[2]), btm = Math.min(a[1] + a[3], b[1] + b[3]);
		return r > x && btm > y ? [x, y, r - x, btm - y] : null;
	};
	const box = (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
	/**
	 * Overlays that skip hit testing (drop overlay, selection box, drag ghost) would read as covered.
	 * Outside CodeMirror the target subtree is made hit-testable while checking; inside CodeMirror
	 * we never touch the DOM (CodeMirror would redraw), its text is hit-testable anyway.
	 */
	/**
	 * Runs fn while every element of el's document takes hits (one injected stylesheet), so layers
	 * that ignore the pointer but paint (pointer-events: none overlays) are seen by elementsFromPoint.
	 * No element is touched, so CodeMirror does not redraw.
	 */
	function withHitTesting(el, fn) {
		const doc = el.ownerDocument;
		const st = doc.createElement("style");
		st.setAttribute("data-capture-hit", "");
		st.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
		(doc.head ?? doc.documentElement).appendChild(st);
		try { return fn(); } finally { st.remove(); }
	}
	/** Alpha (0..1) of any CSS color (rgb, hsl, hwb, lab, lch, oklab, oklch, color()), read through a 1px canvas. */
	const alphaCache = new Map();
	function alphaOf(c) {
		if (!c || c === "transparent") return 0;
		if (alphaCache.has(c)) return alphaCache.get(c);
		const cv = alphaOf.cv ?? (alphaOf.cv = document.createElement("canvas"));
		cv.width = cv.height = 1;
		const g = cv.getContext("2d", { willReadFrequently: true });
		g.clearRect(0, 0, 1, 1);
		g.fillStyle = "rgba(0,0,0,0)";
		g.fillStyle = c;
		g.fillRect(0, 0, 1, 1);
		const a = g.getImageData(0, 0, 1, 1).data[3] / 255;
		alphaCache.set(c, a);
		return a;
	}
	/** Proof that el is drawn: nonzero box inside the window, not hidden, and topmost at most sample points. */
	function visibility(el) {
		const doc = el.ownerDocument;
		const win = doc.defaultView;
		const b = box(el).map((v) => Math.round(v));
		for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
			const cs = win.getComputedStyle(a);
			if (cs.display === "none") return { visible: false, reason: "display: none on " + describe(a), box: b };
			// visibility is inherited but a child can set it back to visible: only el's own value counts.
			if (a === el && (cs.visibility === "hidden" || cs.visibility === "collapse")) return { visible: false, reason: "visibility: hidden on " + describe(a), box: b };
			if (parseFloat(cs.opacity) === 0) return { visible: false, reason: "opacity: 0 on " + describe(a), box: b };
		}
		const v = visibleRect(el);
		if (!v) return { visible: false, reason: b[2] < 1 || b[3] < 1 ? "zero size" : "outside the window or clipped", box: b };
		return withHitTesting(el, () => {
			let ok = 0, n = 0;
			const blockers = new Set();
			for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.25, 0.5, 0.75]) {
				const x = v[0] + v[2] * fx, y = v[1] + v[3] * fy;
				n++;
				if (topmost(doc, win, x, y, el)) ok++;
				else { const hit = doc.elementFromPoint(x, y); if (hit) blockers.add(describe(hit)); }
			}
			return { visible: true, box: b, inView: v.map((x) => Math.round(x)), unobscured: Math.round((ok / n) * 100) / 100, blockers: [...blockers].slice(0, 3) };
		});
	}
	/** The part of el inside the window and inside every clipping ancestor, or null. */
	/**
	 * r clipped by el's ancestors that clip overflow. A position: fixed box escapes them, up to an
	 * ancestor that becomes its containing block (transform, filter, perspective, contain).
	 */
	function ancestorClip(el, r) {
		const win = el.ownerDocument.defaultView;
		let fixed = false;
		for (let a = el; r && a && a !== el.ownerDocument.documentElement; a = a.parentElement) {
			const cs = win.getComputedStyle(a);
			if (a !== el) {
				if (fixed && (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" || /paint|layout|strict|content/.test(cs.contain))) fixed = false;
				if (!fixed && (cs.overflowX !== "visible" || cs.overflowY !== "visible")) r = inter(r, box(a));
			}
			if (cs.position === "fixed") fixed = true;
		}
		return r;
	}
	function visibleRect(el) {
		const win = el.ownerDocument.defaultView;
		return ancestorClip(el, inter(box(el), [0, 0, win.innerWidth, win.innerHeight]));
	}
	/**
	 * Records which elements of the fixture scope are visibly painted inside the screenshot clip:
	 * rendered, not transparent, inside the clip and every clipping ancestor, and topmost (or under
	 * their own ancestor) at the middle of that visible part. Ancestors of the target count when the
	 * target itself is seen. Calls accumulate (scrolled screenshots).
	 */
	/** A layer that paints nothing: no background, border, shadow, outline or own text. */
	function clear(win, e, tints = false) {
		const cs = win.getComputedStyle(e);
		// Fully transparent or hidden layers paint nothing (e.g. an opacity: 0 native <select> laid
		// over a label to catch taps).
		if (parseFloat(cs.opacity) === 0 || cs.visibility !== "visible") return true;
		// A background under 50% alpha only tints what lies below (e.g. a canvas group's fill): it
		// hides nothing, though it paints (tints true: a diff line's tint is still paint).
		if (alphaOf(cs.backgroundColor) >= (tints ? 0.01 : 0.5) || cs.backgroundImage !== "none" || cs.boxShadow !== "none") return false;
		if (["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(cs["border" + k + "Width"]) > 0 && alphaOf(cs["border" + k + "Color"]) > 0)) return false;
		if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) return false;
		for (const pe of ["::before", "::after"]) { const p = win.getComputedStyle(e, pe); if (p.content !== "none" && p.content !== "normal") return false; }
		// <svg>/<g> paint nothing themselves (their shapes do, and are hit where they paint).
		if (e.namespaceURI === "http://www.w3.org/2000/svg" && !["svg", "g", "defs", "symbol"].includes(e.localName)) return false;
		return ![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && !["img", "canvas", "video", "iframe", "input", "textarea", "select"].includes(e.localName);
	}
	/**
	 * Font properties of each element inside e with visible text of its own, counted by signature:
	 * what draws the glyphs (the replay's text allowance holds only while these are the same as
	 * live). Counted per element, not per text node: saved markup merges adjacent text nodes.
	 */
	function textStyles(e) {
		const out = {};
		const d = e.ownerDocument;
		const win = d.defaultView;
		const walk = d.createTreeWalker(e, NodeFilter.SHOW_TEXT);
		const range = d.createRange();
		const done = new Set();
		let n = 0;
		while (walk.nextNode() && n < 6000) {
			const t = walk.currentNode;
			const p = t.parentElement;
			if (!p || done.has(p) || !t.data.trim() || ["script", "style", "title"].includes(p.localName)) continue;
			range.selectNodeContents(t);
			if (!range.getClientRects().length) continue;
			const cs = win.getComputedStyle(p);
			if (cs.visibility !== "visible") continue;
			const sig = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.fontStretch, cs.fontVariant, cs.fontFeatureSettings, cs.fontVariationSettings, cs.letterSpacing, cs.wordSpacing, cs.textTransform, cs.textDecorationLine, cs.webkitTextStrokeWidth, cs.textShadow === "none" ? "" : "shadow"].join("|");
			out[sig] = (out[sig] ?? 0) + 1;
			done.add(p);
			n++;
		}
		return out;
	}
	/**
	 * Waits until every shown canvas (in this document and its same-origin frames, at any depth)
	 * has kept the same pixels for 400 ms, or the timeout passes. Returns whether they settled.
	 */
	async function canvasesStill(timeout) {
		const all = (d) => {
			const out = [...d.querySelectorAll("canvas")].filter((c) => c.width && c.height && c.getClientRects().length);
			for (const f of d.querySelectorAll("iframe")) { let fd = null; try { fd = f.contentDocument; } catch {} if (fd) out.push(...all(fd)); }
			return out;
		};
		const sig = () => all(document).map((c) => { try { const u = c.toDataURL("image/png"); let h = 0; for (let i = 0; i < u.length; i += 3) h = (h * 31 + u.charCodeAt(i)) | 0; return h; } catch { return 0; } }).join(",");
		if (!all(document).length) return true;
		const t0 = performance.now();
		let last = sig();
		let since = performance.now();
		while (performance.now() - t0 < timeout) {
			await sleep(100);
			const now = sig();
			if (now !== last) { last = now; since = performance.now(); }
			else if (performance.now() - since >= 400) return true;
		}
		return false;
	}
	/**
	 * The colors e paints with (text, background, the four borders, and a shown ::before/::after's
	 * background, text and image), as one string: recorded live where the replay check allows
	 * raster differences, so a recolor there still fails.
	 */
	function paintOf(e) {
		const win = e.ownerDocument.defaultView;
		const cs = win.getComputedStyle(e);
		const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
		const out = [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
		for (const pe of ["::before", "::after"]) {
			const p = win.getComputedStyle(e, pe);
			if (p.content === "none" || p.content === "normal") continue;
			out.push(pe, p.color, p.backgroundColor, hash(p.getPropertyValue("-webkit-mask-image") + " " + p.maskImage + " " + p.backgroundImage));
		}
		return out.join(" ");
	}
	/**
	 * What else changes how e's paint comes out: opacity, filter and blend mode of e, of its shown
	 * ::before/::after, and of every ancestor that sets one (recorded next to paintOf).
	 */
	function paintFx(e) {
		const win = e.ownerDocument.defaultView;
		const fx = (c) => [c.opacity, c.filter, c.mixBlendMode].join("/");
		const out = [fx(win.getComputedStyle(e))];
		for (const pe of ["::before", "::after"]) {
			const p = win.getComputedStyle(e, pe);
			if (p.content !== "none" && p.content !== "normal") out.push(pe + fx(p));
		}
		for (let a = e.parentElement; a; a = a.parentElement) {
			const c = win.getComputedStyle(a);
			if (c.opacity !== "1" || c.filter !== "none" || c.mixBlendMode !== "normal") out.push(a.localName + ":" + fx(c));
		}
		return out.join(" ");
	}
	/** True when h paints a background (color with alpha, or an image) over its area. */
	function paintsBackground(win, h) {
		const cs = win.getComputedStyle(h);
		return alphaOf(cs.backgroundColor) > 0 || cs.backgroundImage !== "none";
	}
	/** True when a positioned ::before/::after of h paints an opaque background over h's content. */
	function overlayCovers(win, h) {
		for (const pe of ["::before", "::after"]) {
			const cs = win.getComputedStyle(h, pe);
			if (cs.content === "none" || cs.content === "normal" || cs.position === "static") continue;
			if (alphaOf(cs.backgroundColor) >= 0.5 || cs.backgroundImage !== "none") return true;
		}
		return false;
	}
	/** True when e (or its subtree) is the topmost painted thing at x,y: layers above it must be clear. */
	function topmost(doc, win, x, y, e, seeThrough = null) {
		for (const h of doc.elementsFromPoint(x, y)) {
			if (h === e || e.contains(h)) return true;
			if (h.contains(e)) {
				// The first hit is e's own ancestor h. With a negative z-index between them, e is
				// painted under h's own box. Otherwise e paints above h's box and the hit came through
				// h's ::before/::after overlay (or e ignores hits): covered only by an opaque overlay.
				let under = false;
				for (let a = e; a && a !== h; a = a.parentElement) {
					const cs = win.getComputedStyle(a);
					if (cs.position !== "static" && parseInt(cs.zIndex, 10) < 0) under = true;
				}
				if (under) {
					// e lies under h's own box: covered only where h paints a background (or an
					// opaque overlay); borders, text and empty pseudo-elements do not cover it.
					if (paintsBackground(win, h) || overlayCovers(win, h)) return false;
					continue;
				}
				if (overlayCovers(win, h)) return false;
				if (win.getComputedStyle(e).pointerEvents === "none") return true;
				continue;
			}
			// Anything else above e (an ancestor included: a child with a negative z-index paints
			// under its parent) hides it unless it paints nothing.
			if (!clear(win, h) && !frameOnlyAt(win, h, x, y) && !seeThrough?.(h)) return false;
		}
		return false;
	}
	/**
	 * A layer that only dims what lies below it (a modal's backdrop): translucent (opacity or
	 * background alpha under 1), no image, text, border, shadow or pseudo-element, and not the
	 * target, inside it or around it.
	 */
	function dimmer(win, target, h) {
		if (h === target || target.contains(h) || h.contains(target)) return false;
		const cs = win.getComputedStyle(h);
		if (cs.backgroundImage !== "none" || cs.boxShadow !== "none") return false;
		if (!(parseFloat(cs.opacity) < 1 || alphaOf(cs.backgroundColor) < 1)) return false;
		if (["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(cs["border" + k + "Width"]) > 0 && alphaOf(cs["border" + k + "Color"]) > 0)) return false;
		for (const pe of ["::before", "::after"]) { const p = win.getComputedStyle(h, pe); if (p.content !== "none" && p.content !== "normal") return false; }
		return !h.children.length && !h.textContent.trim() && !["img", "svg", "canvas", "video", "iframe", "input", "textarea", "select"].includes(h.localName);
	}
	/** True when h paints only a border/outline (no fill, shadow, pseudo-element or text) and x,y lies inside that frame. */
	function frameOnlyAt(win, h, x, y) {
		if (h.namespaceURI === "http://www.w3.org/2000/svg") return false;
		const cs = win.getComputedStyle(h);
		if (alphaOf(cs.backgroundColor) >= 0.5 || cs.backgroundImage !== "none" || cs.boxShadow !== "none") return false;
		for (const pe of ["::before", "::after"]) { const p = win.getComputedStyle(h, pe); if (p.content !== "none" && p.content !== "normal") return false; }
		if ([...h.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) || ["img", "svg", "canvas", "video", "iframe", "input", "textarea", "select"].includes(h.localName)) return false;
		const r = h.getBoundingClientRect();
		const bw = (k) => parseFloat(cs["border" + k + "Width"]) || 0;
		return x > r.left + bw("Left") && x < r.right - bw("Right") && y > r.top + bw("Top") && y < r.bottom - bw("Bottom");
	}
	/** Center and quadrant centers of e's own boxes (line fragments for inline elements) inside r: a partly covered element still shows where any of them is on top. */
	function samplePoints(e, r) {
		const pts = [];
		let n = 0;
		for (const q of e.getClientRects()) {
			const v = inter([q.left, q.top, q.width, q.height], r);
			if (!v) continue;
			for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) pts.push([v[0] + v[2] * fx, v[1] + v[3] * fy]);
			if (++n >= 4) break;
		}
		return pts;
	}
	function witness(el, clip) {
		const st = window.__cap;
		const doc = el.ownerDocument;
		const win = doc.defaultView;
		const view = inter(clip, [0, 0, win.innerWidth, win.innerHeight]);
		const start = view && ancestorClip(el, view);
		if (!start) return 0;
		let n = 0;
		withHitTesting(el, () => {
			const walk = (e, cl, opaque) => {
				const cs = win.getComputedStyle(e);
				if (cs.display === "none") return;
				const op = opaque && parseFloat(cs.opacity) > 0;
				if (!op) return;
				const b = box(e);
				const v = cs.display === "contents" ? null : inter(b, cl);
				if (v && cs.visibility === "visible") {
					if (samplePoints(e, v).some(([x, y]) => topmost(doc, win, x, y, e))) { st.seen.add(e); n++; }
				}
				let next = cl;
				if (cs.overflowX !== "visible" || cs.overflowY !== "visible") next = inter(cl, b);
				if (!next) return;
				// Fixed children escape this clip unless e is their containing block.
				const holds = cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" || /paint|layout|strict|content/.test(cs.contain);
				for (const c of e.children) walk(c, !holds && win.getComputedStyle(c).position === "fixed" ? view : next, op);
			};
			walk(el, start, true);
		});
		if (st.seen.has(el)) for (let a = el.parentElement; a; a = a.parentElement) st.seen.add(a);
		// A wrapper with no area of its own (absolutely placed children, e.g. .search-highlight)
		// is shown when a painted child of it is.
		const zero = (e) => { const r = e.getBoundingClientRect(); return r.width < 1 || r.height < 1; };
		const all = [el, ...el.querySelectorAll("*")];
		const below = new Set();
		for (let i = all.length - 1; i >= 0; i--) {
			const e = all[i];
			const has = [...e.children].some((c) => st.seen.has(c) || below.has(c));
			if (has) below.add(e);
			if (has && !st.seen.has(e) && zero(e) && win.getComputedStyle(e).display !== "none") st.seen.add(e);
		}
		return n;
	}
	const PSEUDO = ["hover", "active", "focus", "focus-visible", "focus-within"];
	/**
	 * States of every element in the fixture scope as Chromium's matches() reports them, plus the
	 * states held on the forced element (confirmed through DevTools by the driver, because
	 * matches() does not see forced states inside popout windows).
	 */
	function markStates(el, extra) {
		const st = window.__cap;
		const scope = [el, ...el.querySelectorAll("*")];
		for (let a = el.parentElement; a; a = a.parentElement) scope.push(a);
		// Real focus and pointer on other elements (a focused search field beside the target) show
		// in the shot too: their states are recorded as well.
		for (const e of el.ownerDocument.querySelectorAll(":hover, :focus, :focus-within, :active")) if (!scope.includes(e)) scope.push(e);
		const counts = {};
		const add = (e, s) => {
			const list = st.states.get(e) ?? [];
			if (!list.includes(s)) list.push(s);
			st.states.set(e, list);
			counts[s] = (counts[s] ?? 0) + 1;
		};
		for (const e of scope) for (const p of PSEUDO) { try { if (e.matches(":" + p)) add(e, p); } catch {} }
		// Forced states are marked only when verified (matches() in the live page, or DevTools
		// matched an author rule for that state on the node); see captureItem.
		if (st.pseudo) for (const p of st.verified ?? []) if (!(st.states.get(st.pseudo) ?? []).includes(p)) add(st.pseudo, p);
		for (const [mark, on] of Object.entries(extra)) if (on) add(on, mark);
		return counts;
	}
	/** Copies live control state (value, checked, selected) onto the clone; no instanceof (popouts). */
	function syncControl(s, d) {
		switch (s.localName) {
			case "input":
				if (s.type === "checkbox" || s.type === "radio") {
					if (s.checked) d.setAttribute("checked", ""); else d.removeAttribute("checked");
					if (s.indeterminate) d.setAttribute("data-capture-indeterminate", "");
				} else d.setAttribute("value", s.value);
				break;
			case "textarea":
				d.textContent = s.value;
				break;
			case "option":
				if (s.selected) d.setAttribute("selected", ""); else d.removeAttribute("selected");
				break;
			case "select":
				// Nothing chosen shows a blank box; parsed markup would show the first option.
				if (s.selectedIndex === -1) d.setAttribute("data-capture-select-none", "");
				break;
		}
	}
	/** Keeps the first cards plus one card per special state (classes + badge text); drops the rest. */
	function applyTrim(root, trim) {
		if (!trim) return null;
		const all = [...root.querySelectorAll(trim.sel)];
		const keyOf = (c) => {
			const hit = c.matches(trim.keepAlso) ? c : c.querySelector(trim.keepAlso);
			return hit ? c.className + "|" + [...c.querySelectorAll(trim.keepAlso)].map((b) => b.className + ":" + b.textContent).join(",") : null;
		};
		const seen = new Set();
		const kept = all.filter((c, i) => {
			if (i < trim.keep) return true;
			const k = keyOf(c);
			if (!k || seen.has(k)) return false;
			seen.add(k);
			return true;
		});
		for (const c of all) if (!kept.includes(c)) c.remove();
		return { selector: trim.sel, kept: kept.length, of: all.length };
	}
	const esc = (v) => v.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
	const attrs = (e) => [...e.attributes].map((a) => " " + a.name + '="' + esc(a.value) + '"').join("");
	/**
	 * Copies the whole live document off page, writes the capture marks onto the copy, checks the
	 * theme selectors there (real siblings and ancestors, marks for states, seen elements only) and
	 * returns the fixture: the target with its ancestor wrappers and the html/body attributes.
	 */
	/**
	 * Layout border-box size in CSS px: unrounded (a 0.1 px spacer must not become 0, or margins
	 * collapse through it) and before any transform of it or its ancestors (a scaled PDF form).
	 */
	function layoutSize(win, o) {
		const cs = win.getComputedStyle(o);
		const extra = (a, b) => cs.boxSizing === "border-box" ? 0 : ["padding" + a, "padding" + b, "border" + a + "Width", "border" + b + "Width"].reduce((n, k) => n + (parseFloat(cs[k]) || 0), 0);
		let w = parseFloat(cs.width) + extra("Left", "Right");
		let h = parseFloat(cs.height) + extra("Top", "Bottom");
		if (!Number.isFinite(w)) w = o.offsetWidth ?? o.getBoundingClientRect().width;
		if (!Number.isFinite(h)) h = o.offsetHeight ?? o.getBoundingClientRect().height;
		return Math.round(w * 1000) / 1000 + " " + Math.round(h * 1000) / 1000;
	}
	/**
	 * Every stylesheet of a document, in order: app.css, the theme, and the texts of the runtime
	 * ones (CodeMirror, MathJax, the slides' linked reveal.js sheet...), which can exist only while
	 * their view shows.
	 */
	function collectSheets(d) {
		const sheets = [];
		for (const sh of d.querySelectorAll("link[rel=stylesheet], style")) {
			if (sh.localName === "link" && /(^|\/)app\.css$/.test(sh.getAttribute("href") ?? "")) { sheets.push({ kind: "app" }); continue; }
			if (sh.localName === "style" && sh.textContent.startsWith("/* Miami Wind Theme")) { sheets.push({ kind: "theme" }); continue; }
			let text = sh.textContent;
			try { text = [...sh.sheet.cssRules].map((r) => r.cssText).join("\n"); } catch {}
			if (text.trim()) sheets.push({ kind: "runtime", text });
		}
		for (const sh of d.adoptedStyleSheets ?? []) { const text = [...sh.cssRules].map((r) => r.cssText).join("\n"); if (text.trim()) sheets.push({ kind: "runtime", text }); }
		return sheets;
	}
	/** The margin on one side of e after margins of its first / last children collapse through it. */
	function escMargin(win, e, side) {
		const cs = win.getComputedStyle(e);
		const own = parseFloat(cs["margin" + side]) || 0;
		const shut = (parseFloat(cs["padding" + side]) || 0) + (parseFloat(cs["border" + side + "Width"]) || 0);
		if (shut || cs.display !== "block" || cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.float !== "none" || /absolute|fixed/.test(cs.position)) return own;
		const kids = [...e.childNodes].filter((n) => {
			if (n.nodeType === 3) return n.data.trim() !== "";
			if (n.nodeType !== 1) return false;
			const k = win.getComputedStyle(n);
			return k.display !== "none" && k.float === "none" && !/absolute|fixed/.test(k.position);
		});
		const k = side === "Top" ? kids[0] : kids[kids.length - 1];
		if (!k || k.nodeType !== 1) return own;
		return Math.max(own, escMargin(win, k, side));
	}
	function snapshot(opts) {
		const st = window.__cap;
		const el = st.target;
		const doc = el.ownerDocument;
		const copy = doc.implementation.createHTMLDocument("");
		const root = copy.importNode(doc.documentElement, true);
		copy.replaceChild(root, copy.documentElement);
		const origs = [doc.documentElement, ...doc.documentElement.querySelectorAll("*")];
		const clones = [root, ...root.querySelectorAll("*")];
		const twin = new Map();
		origs.forEach((o, i) => { const c = clones[i]; if (c && c.localName === o.localName) twin.set(o, c); });
		for (const [o, c] of twin) {
			syncControl(o, c);
			const s = st.states.get(o);
			if (s) c.setAttribute("data-capture-state", s.join(" "));
			// Text selected inside a field is not a document selection: keep its range.
			if (o === doc.activeElement && typeof o.selectionStart === "number" && o.selectionStart !== o.selectionEnd) c.setAttribute("data-capture-input-selection", o.selectionStart + " " + o.selectionEnd + " " + (o.selectionDirection ?? "none"));
			// A scrollbar shown live (its content overflowed): kept even when a trimmed list no longer
			// overflows, so the layout keeps its width.
			if (o.offsetWidth && o.clientWidth) {
				const ocs = doc.defaultView.getComputedStyle(o);
				const bw = (parseFloat(ocs.borderLeftWidth) || 0) + (parseFloat(ocs.borderRightWidth) || 0);
				const bh = (parseFloat(ocs.borderTopWidth) || 0) + (parseFloat(ocs.borderBottomWidth) || 0);
				const bars = (o.offsetWidth - o.clientWidth - bw > 0 && /auto|scroll/.test(ocs.overflowY) ? "y" : "") + (o.offsetHeight - o.clientHeight - bh > 0 && /auto|scroll/.test(ocs.overflowX) ? "x" : "");
				if (bars) c.setAttribute("data-capture-scrollbar", bars);
			}
			// Scroll offsets are not part of the markup; a viewer restores them from this mark.
			if (o.scrollTop || o.scrollLeft) c.setAttribute("data-capture-scroll", o.scrollTop + " " + o.scrollLeft);
			// Media and frames get their size from content that does not load offline.
			if (/^(video|audio|iframe|object|embed|webview)$/.test(o.localName) && o.getClientRects().length) c.setAttribute("data-capture-size", layoutSize(doc.defaultView, o));
			if (st.seen.has(o)) c.setAttribute("data-capture-seen", "");
		}
		const t = twin.get(el);
		if (!t) return { lost: true };
		// The native text selection, as child index + offset on the nearest element (child index -1:
		// the offset counts that element's children). A viewer restores it with setBaseAndExtent.
		const sel = doc.getSelection();
		if (sel && sel.rangeCount && !sel.isCollapsed) {
			for (const [node, offset, name] of [[sel.anchorNode, sel.anchorOffset, "anchor"], [sel.focusNode, sel.focusOffset, "focus"]]) {
				const host = node?.nodeType === 1 ? node : node?.parentElement;
				const c = host && twin.get(host);
				if (c) c.setAttribute("data-capture-sel-" + name, (node === host ? -1 : [...host.childNodes].indexOf(node)) + " " + offset);
			}
		}
		// CodeMirror's own selection (anchor/head per range) on each markdown editor, for reference:
		// the editor draws it as .cm-selectionBackground boxes, which the fixture already holds.
		const views = typeof app !== "undefined" ? app.workspace.getLeavesOfType("markdown").map((l) => l.view?.editor?.cm).filter(Boolean) : [];
		for (const v of views) {
			const c = twin.get(v.dom);
			if (c) c.setAttribute("data-capture-cm-selection", JSON.stringify({ main: v.state.selection.mainIndex, ranges: v.state.selection.ranges.map((r) => [r.anchor, r.head]) }));
		}
		t.setAttribute("data-capture-target", "");
		if (opts.label) t.setAttribute("data-capture-label", opts.label);
		if (opts.synthetic) t.setAttribute("data-capture-synthetic", opts.synthetic);
		const p = st.pseudo ? twin.get(st.pseudo) : null;
		if (p) {
			p.setAttribute("data-capture-pseudo", "");
			if (st.verified.includes("visited")) p.setAttribute("data-capture-visited", "");
		}
		// Live check, independent of the marks above: each theme selector is tested on the LIVE
		// document with its real pseudo-classes (Element.matches), or credited from DevTools'
		// matched-rule list for that exact node (forced states in popouts, :visited). It must hit
		// an element of the fixture scope that the witness recorded as painted.
		const live = [];
		const domOnly = [];
		const inScope = (e) => el.contains(e) || e.contains(el);
		const cdpSets = new Map();
		(st.cands ?? []).forEach((c, i) => { const l = st.cdp?.[i]; if (l?.length) cdpSets.set(c, new Set(l)); });
		const fl = st.flags ?? {};
		for (const s of opts.sels) {
			const hits = new Set();
			if (s.live) {
				let list = [];
				try { list = doc.querySelectorAll(s.live); } catch {}
				for (const e of list) {
					if (!inScope(e)) continue;
					if (s.needs === "selection" && !hasSelection(e)) continue;
					if (s.needs === "scrollbar-hover" && !(e === el && fl["scrollbar-hover"])) continue;
					hits.add(e);
				}
			}
			for (const [e, set] of cdpSets) if (set.has(s.norm) && inScope(e)) hits.add(e);
			if (!hits.size) continue;
			if ([...hits].some((e) => st.seen.has(e))) live.push(s.id); else domOnly.push(s.id);
		}
		// Live boxes of the target, its ancestors and their direct children (the parts the layout
		// around the target is made of), so a replay can name the first part that moved.
		const boxOf = (o) => { const r = o.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(" "); };
		for (let a = el; a && a !== doc.documentElement; a = a.parentElement) {
			for (const o of a.parentElement && a !== doc.body ? a.parentElement.children : [a]) {
				const c = twin.get(o);
				if (c && !c.hasAttribute("data-capture-box")) c.setAttribute("data-capture-box", boxOf(o));
			}
		}
		// And inside the target (the first 300 elements), to find a part that grew or shrank.
		for (const o of [...el.querySelectorAll("*")].slice(0, 300)) {
			const c = twin.get(o);
			if (c && !c.hasAttribute("data-capture-box")) c.setAttribute("data-capture-box", boxOf(o));
		}
		// A reorder drag's ghost holds a copy of the dragged element, with its custom properties
		// frozen inline. Pair the copy with its live source (the one .is-being-dragged element of the
		// same tag and classes, state classes aside) by the source's live path, written on both, so a
		// comparison can recompute the source's values; "unknown" when the source is not certain.
		const livePath = (e) => {
			const parts = [];
			for (let x = e; x && x !== doc.documentElement; x = x.parentElement) parts.unshift(x.localName + ":nth-child(" + ([...x.parentElement.children].indexOf(x) + 1) + ")");
			return parts.join(" > ");
		};
		const shape = (e) => e.localName + "." + [...e.classList].filter((c) => !/^(is|mod|has)-/.test(c)).sort().join(".");
		for (const g of doc.querySelectorAll(".drag-reorder-ghost > .mod-dragged-item")) {
			const src = [...doc.querySelectorAll(".is-being-dragged")].filter((x) => !g.contains(x) && !x.closest(".drag-reorder-ghost") && shape(x) === shape(g));
			if (src.length !== 1) { twin.get(g)?.setAttribute("data-capture-ghost-of", "unknown"); continue; }
			const path = livePath(src[0]);
			twin.get(g)?.setAttribute("data-capture-ghost-of", path);
			twin.get(src[0])?.setAttribute("data-capture-drag-source", path);
		}
		// Where the replay check allows raster differences between builds, it needs the live paint
		// colors: borders under a scale transform, image-mask icons on pseudo-elements, rounded
		// inline backgrounds (see replay.ts, soft bands).
		{
			const dv = doc.defaultView;
			const paint = new Set();
			const all = [...doc.body.querySelectorAll("*")];
			for (const e of all) {
				const cs = dv.getComputedStyle(e);
				const m = cs.transform.match(/^matrix\(([^,]+),\s*([^,]+)/);
				if (m && Math.abs(Math.hypot(Number(m[1]), Number(m[2])) - 1) > 0.01)
					for (const d of [e, ...e.querySelectorAll("*")].slice(0, 2000)) { const dc = dv.getComputedStyle(d); if (["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(dc["border" + k + "Width"]) > 0)) paint.add(d); }
				if (cs.position !== "static")
					for (const pe of ["::before", "::after"]) { const p = dv.getComputedStyle(e, pe); if (p.content !== "none" && p.content !== "normal" && p.position === "absolute" && (p.getPropertyValue("-webkit-mask-image") + p.maskImage + p.backgroundImage).includes("url(")) paint.add(e); }
				if (/^(span|mark|code|a|em|strong)$/.test(e.localName) && cs.display.startsWith("inline") && cs.borderRadius !== "0px" && (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none")) paint.add(e);
			}
			for (const e of paint) {
				twin.get(e)?.setAttribute("data-capture-paint", paintOf(e));
				twin.get(e)?.setAttribute("data-capture-paint-fx", paintFx(e));
			}
		}
		const trimmed = applyTrim(t, opts.trim);
		const back = new Map();
		for (const [o, c] of twin) back.set(c, o);
		// Same-origin iframes Obsidian fills by script (no src/srcdoc, e.g. a canvas card being
		// edited): their live document goes into srcdoc. Stylesheets are not copied (Obsidian's CSS
		// is proprietary); their origins are listed in data-capture-iframe-styles instead.
		// Frames: their markup goes into srcdoc without stylesheets (Obsidian's are not committed);
		// the stylesheets are returned like the window's own (frameSheets, by data-capture-frame)
		// so a replay can restore them. A frame that showed nothing is marked as such.
		const frameSheets = [];
		const canvases = [];
		// Canvas pixels are not part of the markup either: keep each painted canvas as a PNG. One that
		// cannot be read (tainted) is taken from the screen instead (rect in window coordinates). A canvas inside a frame is named by its frame path (the index of each
		// frame in its document's iframe order, outermost first) and its index in that frame.
		function keepCanvas(cc, co, ox, oy, path) {
			if (!co || !co.width || !co.height || !co.getClientRects().length) return;
			let url = null;
			try {
				url = co.toDataURL("image/png");
				const empty = co.ownerDocument.createElement("canvas");
				empty.width = co.width;
				empty.height = co.height;
				// Blank (the graph keeps an unused canvas over its frame): replayed transparent, as it
				// showed. Were it a WebGL canvas that reads back blank, the replay would show the
				// difference.
				if (url === empty.toDataURL("image/png")) { cc.setAttribute("data-capture-canvas-blank", ""); return; }
			} catch {}
			const r = co.getBoundingClientRect();
			cc.setAttribute("data-capture-canvas", String(canvases.length));
			canvases.push({ url, rect: [r.x + ox, r.y + oy, r.width, r.height], frame: path });
		}
		/** One frame: its live document into srcdoc, its canvases and frames handled, at any depth. */
		function keepFrame(fc, fo, ox, oy, path) {
			let idoc = null;
			try { idoc = fo?.contentDocument; } catch {}
			// A sandboxed frame with no src and no srcdoc (Obsidian strips an HTML block's srcdoc)
			// shows the blank document, though its document cannot be read.
			const blank = !idoc && fo && !fc.getAttribute("src") && !fc.hasAttribute("srcdoc");
			if (blank || (idoc?.body && ![...idoc.body.querySelectorAll("*")].some((e) => e.getClientRects().length) && !idoc.body.innerText?.trim())) {
				fc.setAttribute("data-capture-frame-empty", "");
				return;
			}
			const own = fc.hasAttribute("srcdoc");
			const scripted = !own && idoc?.documentElement && !(fc.getAttribute("src") && fc.getAttribute("src") !== "about:blank");
			if (!idoc?.documentElement || !(own || scripted)) return;
			// The live frame document, with whatever scripts changed after it loaded (the startup
			// screen hides the status bar and adds its loading item).
			const ir = idoc.documentElement.cloneNode(true);
			const pairs = new Map();
			const os = [...idoc.documentElement.querySelectorAll("*")];
			[...ir.querySelectorAll("*")].forEach((c, i) => pairs.set(c, os[i]));
			// Frame content is offset by the frame's box, border and padding.
			const fr = fo.getBoundingClientRect();
			const fs = getComputedStyle(fo);
			const fx = ox + fr.x + fo.clientLeft + parseFloat(fs.paddingLeft);
			const fy = oy + fr.y + fo.clientTop + parseFloat(fs.paddingTop);
			[...ir.querySelectorAll("canvas")].forEach((cc) => keepCanvas(cc, pairs.get(cc), fx, fy, path));
			[...ir.querySelectorAll("iframe")].forEach((c, i) => keepFrame(c, pairs.get(c), fx, fy, path + (path ? "/" : "") + i));
			const dropped = [];
			for (const st of ir.querySelectorAll("style, link[rel=stylesheet]")) {
				dropped.push(st.localName === "link" ? "link " + st.getAttribute("href") : "style" + (st.id ? "#" + st.id : "") + " (" + st.textContent.length + " chars)");
				st.remove();
			}
			fc.setAttribute("srcdoc", "<!doctype html>" + ir.outerHTML);
			fc.setAttribute("data-capture-iframe-styles", dropped.join("; "));
			fc.setAttribute("data-capture-frame", String(frameSheets.length));
			frameSheets.push(collectSheets(idoc));
		}
		// Frame paths are finished on the saved fixture (its iframe order); mark them here.
		for (const fc of copy.querySelectorAll("iframe")) {
			const k = String(canvases.length);
			fc.setAttribute("data-capture-frame-canvas", k);
			keepFrame(fc, back.get(fc), 0, 0, "@" + k);
		}
		for (const cc of copy.querySelectorAll("canvas")) keepCanvas(cc, back.get(cc), 0, 0, null);
		// Intrinsic sizes of images that will not load offline (app:, https:, file:), by index in
		// the fixture's document.images order, so a viewer can stand in same-size placeholders.
		// Tag every image of the copy with its live size, so indexes can be taken on the final document.
		const sizes = [];
		for (const ic of copy.querySelectorAll("img")) {
			const io = back.get(ic);
			const src = ic.getAttribute("src") ?? "";
			if (!io || !/^(app|https?|file):/i.test(src) || !(io.naturalWidth > 0 && io.naturalHeight > 0)) continue;
			ic.setAttribute("data-capture-img", String(sizes.length));
			// Its shown size too: a broken stand-in does not lay out like the loaded image.
			if (io.getClientRects().length) ic.setAttribute("data-capture-size", layoutSize(doc.defaultView, io));
			sizes.push([io.naturalWidth, io.naturalHeight]);
		}
		// Build the fixture as a DOM tree: the target with its ancestors. The parent keeps all its
		// children (when small), so rules like :first-child/:last-child and neighbor layout still
		// apply; higher levels keep empty stand-ins (data-capture-placeholder, to be hidden) so
		// element order still counts.
		const out = document.implementation.createHTMLDocument("");
		for (const [from, to] of [[root, out.documentElement], [copy.body, out.body]]) for (const x of [...from.attributes]) to.setAttribute(x.name, x.value);
		// Which stylesheets this window really applies, and its size: a starter or print window has
		// no theme; popouts and emulated phones have their own size.
		const styles = [];
		for (const sh of doc.querySelectorAll("link[rel=stylesheet], style")) {
			const href = sh.getAttribute("href") ?? "";
			const text = sh.localName === "style" ? sh.textContent : "";
			const kind = /(^|\/)app\.css$/.test(href) ? "app" : text.startsWith("/* Miami Wind Theme") ? "theme" : text.trim() || href ? "runtime" : "";
			if (kind && !styles.includes(kind)) styles.push(kind);
		}
		// Every stylesheet of the window, in document order: app.css, the theme, and the texts of the
		// runtime ones (CodeMirror, MathJax, the slides' linked reveal.js sheet...), which can exist
		// only while their view shows.
		const sheets = collectSheets(doc);
		const win = doc.defaultView;
		const viewport = [win.innerWidth, win.innerHeight];
		out.documentElement.setAttribute("data-capture-viewport", viewport.join(" "));
		// What a replay cannot show as it was: animated parts (spinners, progress, blinking
		// cursors: their state at the shot is not in the markup) and the native text caret.
		const box = (r, pad = 0) => [r.x - pad, r.y, r.width + 2 * pad, r.height].map((v) => Math.round(v * 10) / 10).join(",");
		const moving = new Set();
		const movingWhat = [];
		// The window's animations and those of its same-origin frames (the startup screen's
		// loading bar), in window coordinates.
		const anims = doc.getAnimations().map((an) => [an, 0, 0]);
		for (const fr of doc.querySelectorAll("iframe")) {
			let fd = null;
			try { fd = fr.contentDocument; } catch {}
			if (!fd) continue;
			const fr0 = fr.getBoundingClientRect();
			for (const an of fd.getAnimations()) anims.push([an, fr0.x + fr.clientLeft, fr0.y + fr.clientTop]);
		}
		for (const [an, ox, oy] of anims) {
			if (!/running|paused/.test(an.playState)) continue;
			// Near-instant ones are hooks, not motion (Obsidian's node-insert-event detects insertion).
			const tm = an.effect?.getComputedTiming?.();
			if (tm && Number.isFinite(tm.endTime) && tm.endTime < 50) continue;
			let e = an.effect?.target;
			if (!e?.getBoundingClientRect) continue;
			// A part sliding inside a clipped track (an indeterminate progress bar): the whole track.
			const ew = e.ownerDocument.defaultView;
			for (let a = e.parentElement, k = 0; a && k < 3; a = a.parentElement, k++) {
				const cs = ew.getComputedStyle(a);
				const ar = a.getBoundingClientRect();
				if ((cs.overflowX !== "visible" || cs.overflowY !== "visible") && ar.width * ar.height < 0.25 * ew.innerWidth * ew.innerHeight) { e = a; break; }
			}
			// A caret-color transition changes nothing but the text caret (masked on its own).
			if (an.transitionProperty === "caret-color") continue;
			// An animation nobody can see (a hidden loading icon's ::after) hides nothing.
			const pseudo = an.effect?.pseudoElement ?? null;
			const pcs = e.ownerDocument.defaultView.getComputedStyle(e, pseudo);
			if (pcs.display === "none" || pcs.visibility !== "visible" || parseFloat(pcs.opacity) === 0 || (pseudo && /^(none|normal)$/.test(pcs.content))) continue;
			const shift = (r) => ({ x: r.x + ox, y: r.y + oy, width: r.width, height: r.height });
			const r = shift(e.getBoundingClientRect());
			if (r.width * r.height >= 1) {
				if (moving.size < 60 && !moving.has(box(r, 1))) { moving.add(box(r, 1)); movingWhat.push(e.localName + "." + [...e.classList].slice(0, 2).join(".") + (pseudo ?? "") + " " + (an.animationName ?? an.transitionProperty ?? "animation")); }
				continue;
			}
			// A zero-size layer (CodeMirror's cursor layer blinking its cursors): its children.
			for (const c of [...e.children].slice(0, 20)) {
				const cr = shift(c.getBoundingClientRect());
				if (cr.width * cr.height >= 1 && moving.size < 60) moving.add(box(cr, 1));
			}
		}
		// Native resize grips (text areas, and any resizable box in the target, e.g. Bases' formula
		// editor): Chromium draws them itself, differently per build.
		const resizable = new Set(doc.querySelectorAll("textarea"));
		const tgt = window.__cap?.target;
		if (tgt?.ownerDocument === doc) for (const e of [tgt, ...tgt.querySelectorAll("*")].slice(0, 3000)) { const rc = win.getComputedStyle(e); if (rc.resize !== "none" && rc.overflow !== "visible") resizable.add(e); }
		for (const ta of resizable) {
			const r = ta.getBoundingClientRect();
			if (r.width < 1 || win.getComputedStyle(ta).resize === "none" || moving.size >= 60) continue;
			moving.add([r.right - 18, r.bottom - 18, 18, 18].map((v) => Math.round(v * 10) / 10).join(","));
		}
		const ae = doc.activeElement;
		const dsel = doc.getSelection();
		if (ae?.isContentEditable && dsel?.rangeCount && dsel.isCollapsed) {
			const r = dsel.getRangeAt(0).getBoundingClientRect();
			if (r.height > 0) moving.add(box(r, 2));
		} else if (ae && /^(input|textarea)$/.test(ae.localName) && typeof ae.selectionStart === "number" && ae.selectionStart === ae.selectionEnd) {
			// The caret's x from the text before it, measured in the field's font.
			const cs = win.getComputedStyle(ae);
			const m = doc.createElement("canvas").getContext("2d");
			m.font = cs.font;
			const r = ae.getBoundingClientRect();
			const x = r.x + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + m.measureText(ae.value.slice(0, ae.selectionStart)).width - ae.scrollLeft;
			moving.add([x - 2, r.y, 4, r.height].map((v) => Math.round(v * 10) / 10).join(","));
		}
		if (moving.size) out.documentElement.setAttribute("data-capture-animated", [...moving].join(" "));
		if (movingWhat.length) out.documentElement.setAttribute("data-capture-animated-what", movingWhat.join("; "));
		out.documentElement.setAttribute("data-capture-styles", styles.join(" "));
		// A see-through overlay shows the page under it: keep the whole window. That is a target in
		// a positioned layer (a modal backdrop, a PDF highlight, a canvas handle, a code block's
		// edit button) with no solid background between it and that layer.
		// It is also see-through when something between them is faded or blended (a PDF text
		// layer at 20% opacity over the page canvas).
		let layer = false;
		let solid = false;
		let veiled = false;
		for (let a = el; a && a !== doc.body; a = a.parentElement) {
			const cs = win.getComputedStyle(a);
			if (!layer && (alphaOf(cs.backgroundColor) >= 0.99 || cs.backgroundImage !== "none")) solid = true;
			// A fade at or above the solid part composites it over what is behind (a faded row
			// below its menu's own background does not).
			if (solid && (parseFloat(cs.opacity) < 1 || cs.mixBlendMode !== "normal")) veiled = true;
			if (/^(absolute|fixed)$/.test(cs.position)) layer = true;
		}
		const seeThrough = layer && (!solid || veiled);
		const whole = opts.context === "document" || seeThrough;
		if (el === doc.body || el === doc.documentElement || whole) {
			for (const c of copy.body.childNodes) out.body.appendChild(out.importNode(c, true));
		} else {
			let node = out.importNode(t, true);
			let child = t;
			for (let a = t.parentElement; a && a !== copy.documentElement; a = a.parentElement) {
				// Inline children sit in their parent's line flow: keep the whole paragraph around them.
				const co = back.get(child);
				const inline = !!co && /^(inline|contents)/.test(win.getComputedStyle(co).display);
				const deep = (a === t.parentElement || inline) && a.querySelectorAll("*").length <= 800;
				const box = a === copy.body ? out.body : out.importNode(a, false);
				for (const c of a.childNodes) {
					if (c === child) box.appendChild(node);
					// Text is kept at every level: it makes the line boxes the branch sits after.
					else if (c.nodeType === 3) box.appendChild(out.createTextNode(c.data));
					else if (c.nodeType === 1) {
						if (deep) box.appendChild(out.importNode(c, true));
						else {
							const o = back.get(c);
							const disp = o ? win.getComputedStyle(o).display : "none";
							// An inline-level box sits on a text line by its baseline, which comes from its
							// content: a small one keeps its content (hidden, and not counted as painted).
							const keep = /^inline-/.test(disp) && c.querySelectorAll("*").length <= 60;
							const ph = out.importNode(c, keep);
							if (keep) for (const d of ph.querySelectorAll("*")) { d.removeAttribute("data-capture-seen"); d.removeAttribute("data-capture-state"); }
							ph.setAttribute("data-capture-placeholder", "");
							// Shown live (visible, not transparent, with a box): a floating one painted over things.
							if (o) {
								const cs = win.getComputedStyle(o);
								const r = o.getBoundingClientRect();
								// (A box of its own is not needed for its parts: an empty container can hold a
								// fixed tooltip, like CodeMirror's tooltip root on <body>.)
								if (cs.visibility === "visible" && parseFloat(cs.opacity) > 0 && cs.display !== "none") {
									if (r.width * r.height > 0) ph.setAttribute("data-capture-shown", "");
									// Parts of it painted over the target (the titlebar's buttons, the status bar
									// above a drag preview): keep exactly the cells, inside the target's box, where
									// a hit test finds one of its painting elements on top, so a replay leaves those
									// out (a popover under a menu hides nothing of the menu).
									const tb = el.getBoundingClientRect();
									// The compared ring is 8 px; 2 px more, so a pixel at its edge has a sampled neighbor (hit
									// tests reach about 1 px past a box's top and left edges; the check grows masks by 1 px).
									const zone = { x: tb.x - 10, y: tb.y - 10, right: tb.right + 10, bottom: tb.bottom + 10 };
									{
										// Cell key -> [x0, y0, x1, y1]: the 8 px cell clipped to the painting part's box (a
										// neighbor's corner must not cover a tiny target), widened when several parts paint it.
										const cells = new Map();
										// The page shows through a modal's backdrop: a dimming layer above it hides nothing.
										const dim = (h) => dimmer(win, el, h);
										withHitTesting(o, () => {
											let n = 0;
											const done = new Set();
											for (const e0 of [o, ...o.querySelectorAll("*")]) {
												if (n >= 400) break;
												// An icon paints with thin strokes a grid point can miss: its whole <svg> box counts.
												const svg = e0.namespaceURI === "http://www.w3.org/2000/svg";
												const e = svg ? (e0.localName === "svg" ? e0 : e0.ownerSVGElement) : e0;
												if (!e || done.has(e)) continue;
												if (svg && e === e0) continue; // the <svg> itself counts once one of its shapes paints
												done.add(e);
												const er0 = e.getBoundingClientRect();
												const er = { x: Math.max(er0.x, zone.x), y: Math.max(er0.y, zone.y), right: Math.min(er0.right, zone.right), bottom: Math.min(er0.bottom, zone.bottom) };
												if (er.right - er.x < 1 || er.bottom - er.y < 1 || (!svg && clear(win, e, true))) continue;
												n++;
												// Its box shadow and outline paint outside its box, where no hit test finds it: the
												// parts of them in the ring around the target count too, and over the target as well
												// when the part itself is drawn over the target (a popup's shadow).
												const shadowOver = [];
												let hitAny = false;
												if (!svg) {
													const scs = win.getComputedStyle(e);
													const ext = [0, 0, 0, 0]; // top, right, bottom, left
													if (scs.boxShadow !== "none")
														for (const sh of scs.boxShadow.split(/,(?![^(]*\))/)) {
															if (/\binset\b/.test(sh)) continue;
															const [sx = 0, sy = 0, blur = 0, spread = 0] = (sh.replace(/rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+\([^)]*\)/gi, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
															// Visible to about half the blur radius past the box (a Gaussian; beyond it
															// the shadow is faint).
															const r = blur / 2 + spread;
															ext[0] = Math.max(ext[0], r - sy); ext[1] = Math.max(ext[1], r + sx); ext[2] = Math.max(ext[2], r + sy); ext[3] = Math.max(ext[3], r - sx);
														}
													if (scs.outlineStyle !== "none" && parseFloat(scs.outlineWidth) > 0) {
														const o = parseFloat(scs.outlineWidth) + (parseFloat(scs.outlineOffset) || 0);
														for (let k = 0; k < 4; k++) ext[k] = Math.max(ext[k], o);
													}
													const [et, eri, eb, el2] = ext.map((v) => Math.ceil(Math.max(0, v)));
													if (et || eri || eb || el2) {
														const bands = [
															[er0.left - el2, er0.top - et, er0.right + eri, er0.top],
															[er0.left - el2, er0.bottom, er0.right + eri, er0.bottom + eb],
															[er0.left - el2, er0.top, er0.left, er0.bottom],
															[er0.right, er0.top, er0.right + eri, er0.bottom],
														];
														for (const [bx0, by0, bx1, by1] of bands) {
															// Clipped to the ring, the target's own box left out (pieces around it).
															const c = [Math.max(bx0, zone.x), Math.max(by0, zone.y), Math.min(bx1, zone.right), Math.min(by1, zone.bottom)];
															if (c[2] - c[0] <= 0 || c[3] - c[1] <= 0) continue;
															shadowOver.push(c);
															const pieces = [
																[c[0], c[1], c[2], Math.min(c[3], tb.top)],
																[c[0], Math.max(c[1], tb.bottom), c[2], c[3]],
																[c[0], Math.max(c[1], tb.top), Math.min(c[2], tb.left), Math.min(c[3], tb.bottom)],
																[Math.max(c[0], tb.right), Math.max(c[1], tb.top), c[2], Math.min(c[3], tb.bottom)],
															];
															for (const q of pieces) if (q[2] - q[0] > 0 && q[3] - q[1] > 0) cells.set("band:" + q.join(","), q);
														}
													}
												}
												// A border-only frame (XFA field borders) paints just its border bands: sample along
												// them (a grid point seldom lands on a 1 px line).
												if (!svg && frameOnlyAt(win, e, (er0.left + er0.right) / 2, (er0.top + er0.bottom) / 2)) {
													const fcs = win.getComputedStyle(e);
													const bw = (k) => parseFloat(fcs["border" + k + "Width"]) || 0;
													// Widened by 1 px on each side: a thin border under a scale (a PDF layer) draws wider
													// than its computed width.
													const bands = [
														[er0.left, er0.top - 1, er0.width, bw("Top") + 2],
														[er0.left, er0.bottom - bw("Bottom") - 1, er0.width, bw("Bottom") + 2],
														[er0.left - 1, er0.top, bw("Left") + 2, er0.height],
														[er0.right - bw("Right") - 1, er0.top, bw("Right") + 2, er0.height],
													].filter((b) => b[2] > 2 && b[3] > 2);
													for (const [bx, by, bwid, bhei] of bands) {
														if (bwid <= 0 || bhei <= 0) continue;
														const horiz = bwid >= bhei;
														for (let t = 0; t < (horiz ? bwid : bhei); t += 8) {
															const x0 = horiz ? bx + t : bx;
															const y0 = horiz ? by : by + t;
															const w0 = horiz ? Math.min(8, bwid - t) : bwid;
															const h0 = horiz ? bhei : Math.min(8, bhei - t);
															const c0 = [Math.max(x0, zone.x), Math.max(y0, zone.y), Math.min(x0 + w0, zone.right), Math.min(y0 + h0, zone.bottom)];
															if (c0[2] - c0[0] <= 0 || c0[3] - c0[1] <= 0) continue;
															const px = (c0[0] + c0[2]) / 2;
															const py = (c0[1] + c0[3]) / 2;
															if (px >= 0 && py >= 0 && px < win.innerWidth && py < win.innerHeight && topmost(doc, win, px, py, e, dim))
																cells.set("band:" + c0.join(","), c0);
														}
													}
													continue;
												}
												for (let y = Math.floor(er.y / 8) * 8; y < er.bottom && cells.size < 20000; y += 8)
													for (let x = Math.floor(er.x / 8) * 8; x < er.right; x += 8) {
														// Cells outside the target or across its edge are sampled at 2 px: a menu's
														// 8 px margin of page around it is narrower than a cell.
														// So are cells in the target's corners (16 px): outside a rounded corner the page
														// shows.
														const nearX = x < tb.left + 16 || x + 8 > tb.right - 16;
														const nearY = y < tb.top + 16 || y + 8 > tb.bottom - 16;
														const inside = x >= tb.left && x + 8 <= tb.right && y >= tb.top && y + 8 <= tb.bottom && !(nearX && nearY);
														const step = inside ? 8 : 2;
														for (let sy = y; sy < y + 8; sy += step)
															for (let sx = x; sx < x + 8; sx += step) {
																const k = inside ? x + "," + y : "sub:" + sx + "," + sy;
																const c0 = [Math.max(sx, er.x), Math.max(sy, er.y), Math.min(sx + step, er.right), Math.min(sy + step, er.bottom)];
																if (c0[2] - c0[0] <= 0 || c0[3] - c0[1] <= 0) continue;
																const had = cells.get(k);
																if (had && had[0] <= c0[0] && had[1] <= c0[1] && had[2] >= c0[2] && had[3] >= c0[3]) continue;
																// The center, and for a 2 px cell its corners too: a box edge at a fractional
																// pixel leaves the page behind showing through part of the edge pixel.
																const pts = [[(c0[0] + c0[2]) / 2, (c0[1] + c0[3]) / 2]];
																if (!inside) for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pts.push([fx ? c0[2] - 0.25 : c0[0] + 0.25, fy ? c0[3] - 0.25 : c0[1] + 0.25]);
																const hit = pts.some(([px, py]) =>
																	// Inside a border-only frame (XFA field borders) it paints nothing.
																	!(!svg && frameOnlyAt(win, e, px, py)) && px >= 0 && py >= 0 && px < win.innerWidth && py < win.innerHeight && topmost(doc, win, px, py, e, dim));
																if (hit) { hitAny = true; cells.set(k, had ? [Math.min(had[0], c0[0]), Math.min(had[1], c0[1]), Math.max(had[2], c0[2]), Math.max(had[3], c0[3])] : c0); }
															}
													}
												if (hitAny) for (const c of shadowOver) cells.set("band:" + c.join(","), c);
											}
										});
										// Full cells merged into runs along each row; clipped cells kept as they are.
										const runs = [];
										const byRow = new Map();
										const byRow2 = new Map();
										const fmt = (v) => Math.round(v * 10) / 10;
										for (const [k, c] of cells) {
											if (k.startsWith("sub:")) {
												const [x2, y2] = k.slice(4).split(",").map(Number);
												if (c[0] === x2 && c[1] === y2 && c[2] === x2 + 2 && c[3] === y2 + 2) { if (!byRow2.has(y2)) byRow2.set(y2, []); byRow2.get(y2).push(x2); continue; }
											}
											if (k.startsWith("band:") || k.startsWith("sub:")) { runs.push([c[0], c[1], c[2] - c[0], c[3] - c[1]].map(fmt).join(",")); continue; }
											const [x, y] = k.split(",").map(Number);
											if (c[0] === x && c[1] === y && c[2] === x + 8 && c[3] === y + 8) { if (!byRow.has(y)) byRow.set(y, []); byRow.get(y).push(x); }
											else runs.push([c[0], c[1], c[2] - c[0], c[3] - c[1]].map(fmt).join(","));
										}
										for (const [rows, size] of [[byRow, 8], [byRow2, 2]])
											for (const [y, xs] of rows) {
												xs.sort((a, b) => a - b);
												let start = xs[0], prev = xs[0];
												for (const x of [...xs.slice(1), Infinity]) {
													if (x === prev + size) { prev = x; continue; }
													runs.push([start, y, prev + size - start, size].join(","));
													start = x; prev = x;
												}
											}
										if (runs.length) ph.setAttribute("data-capture-paints", runs.slice(0, 6000).join(" "));
									}
								}
							}
							// The stand-in is empty, so keep its live border-box size for the layout around it.
							if (o && disp !== "inline" && disp !== "contents" && disp !== "none") {
								ph.setAttribute("data-capture-size", layoutSize(win, o));
								// Rules like :empty would change an empty stand-in's display.
								ph.setAttribute("data-capture-display", disp);
								// Children's margins that collapsed through it into the flow are gone with them.
								const pd = o.parentElement ? win.getComputedStyle(o.parentElement).display : "";
								if (/^(block|flow-root|list-item)$/.test(pd)) {
									const cs = win.getComputedStyle(o);
									const mt = escMargin(win, o, "Top");
									const mb = escMargin(win, o, "Bottom");
									if (mt !== parseFloat(cs.marginTop) || mb !== parseFloat(cs.marginBottom)) ph.setAttribute("data-capture-margin", mt + " " + mb);
								}
							}
							box.appendChild(ph);
						}
					}
				}
				if (a === copy.body) break;
				node = box;
				child = a;
			}
		}
		const canvasPixels = [];
		[...out.querySelectorAll("canvas")].forEach((cv, index) => {
			const k = cv.getAttribute("data-capture-canvas");
			if (k !== null) { canvasPixels.push({ index, url: canvases[+k].url, rect: canvases[+k].rect }); cv.removeAttribute("data-capture-canvas"); }
		});
		// Canvases inside frames: the outermost frame's index in the saved fixture replaces its mark;
		// inside the frame, the index of that canvas among its frame document's canvases.
		const topFrame = new Map();
		[...out.querySelectorAll("iframe")].forEach((fr, i) => {
			const k = fr.getAttribute("data-capture-frame-canvas");
			if (k !== null) topFrame.set("@" + k, String(i));
			fr.removeAttribute("data-capture-frame-canvas");
		});
		const frameDocs = new Map();
		const docAt = (path) => {
			if (!frameDocs.has(path)) {
				let d = null;
				const parts = path.split("/");
				let html = [...out.querySelectorAll("iframe")][+parts[0]]?.getAttribute("srcdoc");
				for (let i = 0; html != null; i++) {
					d = new DOMParser().parseFromString(html, "text/html");
					if (i + 1 >= parts.length) break;
					html = [...d.querySelectorAll("iframe")][+parts[i + 1]]?.getAttribute("srcdoc");
					if (html == null) d = null;
				}
				frameDocs.set(path, d);
			}
			return frameDocs.get(path);
		};
		canvases.forEach((c, k) => {
			if (c.frame === null) return;
			const [mark, ...rest] = c.frame.split("/");
			const top = topFrame.get(mark);
			if (top === undefined) return;
			const path = [top, ...rest].join("/");
			const d = docAt(path);
			const index = d ? [...d.querySelectorAll("canvas")].findIndex((e) => e.getAttribute("data-capture-canvas") === String(k)) : -1;
			if (index >= 0) canvasPixels.push({ index, frame: path, url: c.url, rect: c.rect });
		});
		// Intrinsic sizes of images that will not load offline, by index in document.images order.
		const imageSizes = [];
		[...out.images].forEach((im, index) => {
			const k = im.getAttribute("data-capture-img");
			if (k !== null) { imageSizes.push({ index, width: sizes[+k][0], height: sizes[+k][1], src: im.getAttribute("src") }); im.removeAttribute("data-capture-img"); }
		});
		// MathJax keeps a CSS rule per character, only for what is on screen now (it drops the rest
		// on the next render). Keep the fixture's own glyph rules in its <head>.
		const glyphs = new Set([...out.querySelectorAll("mjx-c")].flatMap((e) => [...e.classList].filter((c) => /^mjx-c[0-9A-F]+$/.test(c))));
		let mathCss = "";
		if (glyphs.size) {
			const rules = [];
			for (const sh of [...doc.styleSheets, ...(doc.adoptedStyleSheets ?? [])]) {
				let rs = [];
				try { rs = [...sh.cssRules]; } catch {}
				for (const r of rs) {
					const sel = r.selectorText ?? "";
					if (sel.includes("mjx-c.mjx-c") && sel.split(",").some((x) => [...glyphs].some((g) => new RegExp("\\." + g + "(?![0-9A-F])").test(x)))) rules.push(r.cssText);
				}
			}
			mathCss = [...new Set(rules)].join("\n");
			const st = out.createElement("style");
			st.setAttribute("data-capture-runtime", "mathjax");
			st.textContent = mathCss;
			out.head.appendChild(st);
		}
		const headExtra = mathCss ? '<style data-capture-runtime="mathjax">' + mathCss.replace(/<\/style/gi, "<\\/style") + "</style>" : "";
		// HTML text cannot hold every tree Obsidian builds (a <div> inside a <p>, as in reading-view
		// embeds): the parser would close the <p> early. Save as HTML when it parses back to the same
		// tree, else as XHTML, whose XML parser keeps the tree exactly.
		const body = out.body.innerHTML;
		const back2 = new DOMParser().parseFromString("<!doctype html><html><head></head><body>" + body + "</body></html>", "text/html");
		const same = back2.body.querySelectorAll("*").length === out.body.querySelectorAll("*").length && back2.querySelector("[data-capture-target]")?.querySelectorAll("*").length === out.querySelector("[data-capture-target]")?.querySelectorAll("*").length;
		const format = same ? "html" : "xhtml";
		const contains = Object.entries(opts.components).filter(([, sel]) => t.matches?.(sel) || t.querySelector(sel)).map(([k]) => k);
		const fixture = same
			? (doc.compatMode === "BackCompat" ? "" : "<!doctype html>\n") + "<html" + attrs(out.documentElement) + '>\n<head><meta charset="utf-8">' + headExtra + "</head>\n<body" + attrs(out.body) + ">\n" + body + "\n</body>\n</html>\n"
			: '<?xml version="1.0" encoding="utf-8"?>\n' + new XMLSerializer().serializeToString(out) + "\n";
		return { html: fixture, textStyles: textStyles(el), format, live, domOnly, trimmed, contains, seen: st.seen.size, imageSizes, canvasPixels, viewport, styles, sheets, frameSheets, quirks: doc.compatMode === "BackCompat", whole: whole && opts.context !== "document" ? "see-through" : null };
	}
	/** Painted style of the target and pseudo subtrees (colors, borders, shadows, decorations, ::before/::after), for a before/after state diff. */
	const PAINT = ["color", "background-color", "background-image", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "outline-style", "outline-width", "box-shadow", "text-decoration-line", "text-decoration-color", "opacity", "filter", "transform", "visibility", "fill", "stroke"];
	function styleSnap() {
		const out = [];
		const roots = [window.__cap.target, window.__cap.pseudo].filter(Boolean);
		for (const r of roots) {
			const view = r.ownerDocument.defaultView;
			const all = [r, ...r.querySelectorAll("*")].slice(0, 400);
			for (const e of all)
				for (const pe of [null, "::before", "::after"]) {
					const cs = view.getComputedStyle(e, pe);
					// Boxes that paint nothing: empty pseudo-elements, undisplayed or hidden elements.
					const blank = (pe && (cs.content === "none" || cs.content === "normal")) || cs.display === "none" || (!pe && !e.getClientRects().length);
					out.push({ who: (e.localName + "." + [...e.classList].join(".")).slice(0, 60) + (pe ?? ""), v: blank ? null : PAINT.map((k) => cs.getPropertyValue(k)) });
				}
		}
		return out;
	}
	function styleBefore() { window.__cap.styleBefore = styleSnap(); }
	/** Painted boxes (incl. ::before/::after) whose painted style changed since styleBefore(), with the changed properties. */
	function styleChanges() {
		const a = window.__cap.styleBefore;
		if (!a) return null;
		const b = styleSnap();
		const props = new Set();
		let n = 0;
		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			const x = a[i].v, y = b[i].v;
			if (!x && !y) continue;
			if (!x || !y) { n++; props.add(b[i].who + " shown/hidden"); continue; }
			const d = PAINT.filter((_, k) => x[k] !== y[k]);
			if (d.length) { n++; props.add(b[i].who + " " + d.join(",")); }
		}
		return { n, props: [...props].slice(0, 12) };
	}
	/** Nodes whose DevTools matched rules can prove a forced state: the forced node, its ancestors and its painted descendants. */
	function candidates() {
		const st = window.__cap;
		const p = st.pseudo;
		if (!p) return (st.cands = []);
		const list = [p];
		for (let a = p.parentElement; a; a = a.parentElement) list.push(a);
		for (const d of p.querySelectorAll("*")) { if (list.length >= 250) break; if (st.seen.has(d)) list.push(d); }
		return (st.cands = list);
	}
	/** What lies at the center of el, top first (diagnostics when nothing of el is recorded as painted). */
	function stackAt(el) {
		const v = visibleRect(el);
		if (!v) return [];
		const win = el.ownerDocument.defaultView;
		return withHitTesting(el, () => el.ownerDocument.elementsFromPoint(v[0] + v[2] / 2, v[1] + v[3] / 2).slice(0, 6).map((h) => {
			const cs = win.getComputedStyle(h);
			return (h === el ? "TARGET " : el.contains(h) ? "child " : h.contains(el) ? "ancestor " : "") + h.localName + "." + String(h.className?.baseVal ?? h.className).split(" ").slice(0, 3).join(".") + " bg=" + cs.backgroundColor + " pe=" + cs.pointerEvents + " z=" + cs.zIndex + " clear=" + clear(win, h);
		}));
	}
	/** True when a non-collapsed text selection touches el. */
	function hasSelection(el) {
		const sel = el.ownerDocument.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
		const r = sel.getRangeAt(0);
		return el.contains(r.commonAncestorContainer) || r.intersectsNode(el);
	}
	/** True when the point is over the vertical scrollbar of scroller (outside its client area). */
	function overScrollbar(scroller, x, y) {
		const r = scroller.getBoundingClientRect();
		return scroller.scrollHeight > scroller.clientHeight && x > r.left + scroller.clientLeft + scroller.clientWidth && x < r.right && y > r.top && y < r.bottom;
	}
	window.cap = { clear, textStyles, canvasesStill, paintOf, paintFx, sleep, find, locate, open, clean, overlays, last, ROOTS, clearSettingsSearch, reveal, visibility, visibleRect, witness, markStates, snapshot, hasSelection, overScrollbar, styleBefore, styleChanges, candidates, stackAt };
})();
`;
