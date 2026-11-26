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
	function visibleRect(el) {
		const win = el.ownerDocument.defaultView;
		let r = inter(box(el), [0, 0, win.innerWidth, win.innerHeight]);
		for (let a = el.parentElement; r && a && a !== el.ownerDocument.documentElement; a = a.parentElement) {
			const cs = win.getComputedStyle(a);
			if (cs.overflowX !== "visible" || cs.overflowY !== "visible") r = inter(r, box(a));
		}
		return r;
	}
	/**
	 * Records which elements of the fixture scope are visibly painted inside the screenshot clip:
	 * rendered, not transparent, inside the clip and every clipping ancestor, and topmost (or under
	 * their own ancestor) at the middle of that visible part. Ancestors of the target count when the
	 * target itself is seen. Calls accumulate (scrolled screenshots).
	 */
	/** A layer that paints nothing: no background, border, shadow, outline or own text. */
	function clear(win, e) {
		const cs = win.getComputedStyle(e);
		// Fully transparent or hidden layers paint nothing (e.g. an opacity: 0 native <select> laid
		// over a label to catch taps).
		if (parseFloat(cs.opacity) === 0 || cs.visibility !== "visible") return true;
		// A background under 50% alpha only tints what lies below (e.g. a canvas group's fill).
		if (alphaOf(cs.backgroundColor) >= 0.5 || cs.backgroundImage !== "none" || cs.boxShadow !== "none") return false;
		if (["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(cs["border" + k + "Width"]) > 0 && alphaOf(cs["border" + k + "Color"]) > 0)) return false;
		if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) return false;
		for (const pe of ["::before", "::after"]) { const p = win.getComputedStyle(e, pe); if (p.content !== "none" && p.content !== "normal") return false; }
		// <svg>/<g> paint nothing themselves (their shapes do, and are hit where they paint).
		if (e.namespaceURI === "http://www.w3.org/2000/svg" && !["svg", "g", "defs", "symbol"].includes(e.localName)) return false;
		return ![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && !["img", "canvas", "video", "iframe", "input", "textarea", "select"].includes(e.localName);
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
	function topmost(doc, win, x, y, e) {
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
			if (!clear(win, h) && !frameOnlyAt(win, h, x, y)) return false;
		}
		return false;
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
		let start = inter(clip, [0, 0, win.innerWidth, win.innerHeight]);
		for (let a = el.parentElement; start && a && a !== doc.documentElement; a = a.parentElement) {
			const cs = win.getComputedStyle(a);
			if (cs.overflowX !== "visible" || cs.overflowY !== "visible") start = inter(start, box(a));
		}
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
				for (const c of e.children) walk(c, next, op);
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
			if (st.seen.has(o)) c.setAttribute("data-capture-seen", "");
		}
		const t = twin.get(el);
		if (!t) return { lost: true };
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
		const trimmed = applyTrim(t, opts.trim);
		const back = new Map();
		for (const [o, c] of twin) back.set(c, o);
		// Same-origin iframes Obsidian fills by script (no src/srcdoc, e.g. a canvas card being
		// edited): their live document goes into srcdoc. Stylesheets are not copied (Obsidian's CSS
		// is proprietary); their origins are listed in data-capture-iframe-styles instead.
		for (const fc of t.querySelectorAll("iframe")) {
			const fo = back.get(fc);
			let idoc = null;
			try { idoc = fo?.contentDocument; } catch {}
			if (!idoc?.documentElement || fc.hasAttribute("srcdoc") || (fc.getAttribute("src") && fc.getAttribute("src") !== "about:blank")) continue;
			const ir = idoc.documentElement.cloneNode(true);
			const styles = [];
			for (const st of ir.querySelectorAll("style, link[rel=stylesheet]")) {
				styles.push(st.localName === "link" ? "link " + st.getAttribute("href") : "style" + (st.id ? "#" + st.id : "") + " (" + st.textContent.length + " chars)");
				st.remove();
			}
			const adopted = idoc.adoptedStyleSheets?.length ?? 0;
			if (adopted) styles.push("adopted stylesheets: " + adopted);
			fc.setAttribute("srcdoc", "<!doctype html>" + ir.outerHTML);
			fc.setAttribute("data-capture-iframe-styles", styles.join("; "));
		}
		// Intrinsic sizes of images that will not load offline (app:, https:, file:), by index in
		// the fixture's document.images order, so a viewer can stand in same-size placeholders.
		// Tag every image of the copy with its live size, so indexes can be taken on the final document.
		const sizes = [];
		for (const ic of copy.querySelectorAll("img")) {
			const io = back.get(ic);
			const src = ic.getAttribute("src") ?? "";
			if (!io || !/^(app|https?|file):/i.test(src) || !(io.naturalWidth > 0 && io.naturalHeight > 0)) continue;
			ic.setAttribute("data-capture-img", String(sizes.length));
			sizes.push([io.naturalWidth, io.naturalHeight]);
		}
		// Build the fixture as a DOM tree: the target with its ancestors. The parent keeps all its
		// children (when small), so rules like :first-child/:last-child and neighbor layout still
		// apply; higher levels keep empty stand-ins (data-capture-placeholder, to be hidden) so
		// element order still counts.
		const out = document.implementation.createHTMLDocument("");
		for (const [from, to] of [[root, out.documentElement], [copy.body, out.body]]) for (const x of [...from.attributes]) to.setAttribute(x.name, x.value);
		if (el === doc.body || el === doc.documentElement) {
			for (const c of copy.body.childNodes) out.body.appendChild(out.importNode(c, true));
		} else {
			let node = out.importNode(t, true);
			let child = t;
			for (let a = t.parentElement; a && a !== copy.documentElement; a = a.parentElement) {
				const deep = a === t.parentElement && a.querySelectorAll("*").length <= 800;
				const box = a === copy.body ? out.body : out.importNode(a, false);
				for (const c of a.childNodes) {
					if (c === child) box.appendChild(node);
					else if (c.nodeType === 3) { if (deep) box.appendChild(out.createTextNode(c.data)); }
					else if (c.nodeType === 1) {
						if (deep) box.appendChild(out.importNode(c, true));
						else { const ph = out.importNode(c, false); ph.setAttribute("data-capture-placeholder", ""); box.appendChild(ph); }
					}
				}
				if (a === copy.body) break;
				node = box;
				child = a;
			}
		}
		// Intrinsic sizes of images that will not load offline, by index in document.images order.
		const imageSizes = [];
		[...out.images].forEach((im, index) => {
			const k = im.getAttribute("data-capture-img");
			if (k !== null) { imageSizes.push({ index, width: sizes[+k][0], height: sizes[+k][1] }); im.removeAttribute("data-capture-img"); }
		});
		// HTML text cannot hold every tree Obsidian builds (a <div> inside a <p>, as in reading-view
		// embeds): the parser would close the <p> early. Save as HTML when it parses back to the same
		// tree, else as XHTML, whose XML parser keeps the tree exactly.
		const body = out.body.innerHTML;
		const back2 = new DOMParser().parseFromString("<!doctype html><html><head></head><body>" + body + "</body></html>", "text/html");
		const same = back2.body.querySelectorAll("*").length === out.body.querySelectorAll("*").length && back2.querySelector("[data-capture-target]")?.querySelectorAll("*").length === out.querySelector("[data-capture-target]")?.querySelectorAll("*").length;
		const format = same ? "html" : "xhtml";
		const contains = Object.entries(opts.components).filter(([, sel]) => t.matches?.(sel) || t.querySelector(sel)).map(([k]) => k);
		const fixture = same
			? "<!doctype html>\n<html" + attrs(out.documentElement) + '>\n<head><meta charset="utf-8"></head>\n<body' + attrs(out.body) + ">\n" + body + "\n</body>\n</html>\n"
			: '<?xml version="1.0" encoding="utf-8"?>\n' + new XMLSerializer().serializeToString(out) + "\n";
		return { html: fixture, format, live, domOnly, trimmed, contains, seen: st.seen.size, imageSizes };
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
	window.cap = { sleep, find, locate, open, clean, overlays, last, ROOTS, clearSettingsSearch, reveal, visibility, visibleRect, witness, markStates, snapshot, hasSelection, overScrollbar, styleBefore, styleChanges, candidates, stackAt };
})();
`;
