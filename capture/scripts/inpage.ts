// Helpers installed into each Obsidian window as `window.cap`. Plain JS on purpose: it runs
// inside Obsidian through Runtime.evaluate, which Obsidian's CSP does not block.
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
	function syncForm(src, dst) {
		const a = [src, ...src.querySelectorAll("input, textarea, select")];
		const b = [dst, ...dst.querySelectorAll("input, textarea, select")];
		a.forEach((s, i) => {
			const d = b[i];
			if (!d || !(s instanceof HTMLElement) || s.tagName !== d.tagName) return;
			if (s instanceof HTMLInputElement) {
				if (s.type === "checkbox" || s.type === "radio") {
					if (s.checked) d.setAttribute("checked", ""); else d.removeAttribute("checked");
					if (s.indeterminate) d.setAttribute("data-capture-indeterminate", "");
				} else d.setAttribute("value", s.value);
			} else if (s instanceof HTMLTextAreaElement) d.textContent = s.value;
			else if (s instanceof HTMLSelectElement) {
				[...d.options].forEach((o, j) => { if (s.options[j]?.selected) o.setAttribute("selected", ""); else o.removeAttribute("selected"); });
			}
		});
	}
	const esc = (v) => v.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
	const attrs = (e) => [...e.attributes].map((a) => " " + a.name + '="' + esc(a.value) + '"').join("");
	/** Keep the first cards plus one card per special state (classes + badge text); drop the rest. */
	function applyTrim(clone, trim) {
		window.__capTrimmed = null;
		if (!trim) return;
		const all = [...clone.querySelectorAll(trim.sel)];
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
		window.__capTrimmed = { selector: trim.sel, kept: kept.length, of: all.length };
	}
	/** The element's DOM plus its ancestor wrappers (attributes only) and the html/body classes. */
	function serialize(el, trim) {
		const doc = el.ownerDocument;
		let html;
		if (el === doc.body || el === doc.documentElement) {
			const clone = doc.body.cloneNode(true);
			syncForm(doc.body, clone);
			applyTrim(clone, trim);
			html = clone.innerHTML;
		} else {
			const clone = el.cloneNode(true);
			syncForm(el, clone);
			applyTrim(clone, trim);
			html = clone.outerHTML;
			for (let a = el.parentElement; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) {
				const outer = a.cloneNode(false).outerHTML;
				const close = "</" + a.localName + ">";
				html = outer.slice(0, outer.length - close.length) + html + close;
			}
		}
		return "<!doctype html>\n<html" + attrs(doc.documentElement) + '>\n<head><meta charset="utf-8"></head>\n<body' + attrs(doc.body) + ">\n" + html + "\n</body>\n</html>\n";
	}
	function components(el, defs) {
		const scope = el === document.documentElement ? document.body : el;
		return Object.entries(defs).filter(([, sel]) => scope.matches?.(sel) || scope.querySelector(sel)).map(([k]) => k);
	}
	async function open(file, mode, newLeaf) {
		const leaf = app.workspace.getLeaf(newLeaf ? "tab" : false);
		const state = mode === "reading" ? { file, mode: "preview" } : { file, mode: "source", source: mode === "source" };
		const type = file.endsWith(".md") ? "markdown" : app.viewRegistry.getTypeByExtension(file.split(".").pop());
		await leaf.setViewState({ type, state, active: true });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		await sleep(600);
		return leaf;
	}
	const overlays = () => document.querySelectorAll(".modal-container, .menu, .suggestion-container, .popover, .prompt").length;
	/** Clears capture marks and tooltips. Escape presses (resetUi) close modals and menus. */
	function clean() {
		document.querySelectorAll(".tooltip").forEach((e) => e.remove());
		window.__capPointer = null;
		for (const a of ["data-capture-state", "data-capture-target", "data-capture-pseudo", "data-capture-visited", "data-capture-label", "data-capture-synthetic"]) {
			document.querySelectorAll("[" + a + "]").forEach((e) => e.removeAttribute(a));
		}
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
	/** Proof that el is drawn: nonzero box inside the window, not hidden, and topmost at most sample points. */
	function visibility(el) {
		const doc = el.ownerDocument;
		const win = doc.defaultView;
		const r = el.getBoundingClientRect();
		const box = [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
		for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
			const cs = win.getComputedStyle(a);
			if (cs.display === "none") return { visible: false, reason: "display: none on " + describe(a), box };
			if (cs.visibility === "hidden" || cs.visibility === "collapse") return { visible: false, reason: "visibility: hidden on " + describe(a), box };
			if (parseFloat(cs.opacity) === 0) return { visible: false, reason: "opacity: 0 on " + describe(a), box };
		}
		if (r.width < 1 || r.height < 1) return { visible: false, reason: "zero size", box };
		const ix = Math.max(0, r.x), iy = Math.max(0, r.y);
		const iw = Math.min(win.innerWidth, r.right) - ix, ih = Math.min(win.innerHeight, r.bottom) - iy;
		if (iw < 1 || ih < 1) return { visible: false, reason: "outside the window", box };
		// Overlays (active cell, selection box, drag ghost) skip hit testing; make the target
		// hit-testable for the check so paint order alone decides what is on top.
		const pe = doc.createElement("style");
		pe.textContent = "[data-capture-target], [data-capture-target] * { pointer-events: auto !important; }";
		doc.head.appendChild(pe);
		let ok = 0, n = 0;
		const blockers = new Set();
		for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.25, 0.5, 0.75]) {
			const hit = doc.elementFromPoint(ix + iw * fx, iy + ih * fy);
			n++;
			if (!hit || hit === el || el.contains(hit) || hit.contains(el)) ok++;
			else blockers.add(describe(hit));
		}
		pe.remove();
		return { visible: true, box, inView: [ix, iy, iw, ih].map((v) => Math.round(v)), unobscured: Math.round((ok / n) * 100) / 100, blockers: [...blockers].slice(0, 3) };
	}
	const PSEUDO = ["hover", "active", "focus", "focus-visible", "focus-within"];
	/** Marks every element of the fixture scope with the dynamic pseudo-classes Chromium says it matches. */
	function markStates(el, extra) {
		const scope = [el, ...el.querySelectorAll("*")];
		for (let a = el.parentElement; a; a = a.parentElement) scope.push(a);
		const counts = {};
		for (const e of scope) {
			const st = PSEUDO.filter((p) => { try { return e.matches(":" + p); } catch { return false; } });
			for (const [mark, on] of Object.entries(extra)) if (on === e) st.push(mark);
			if (st.length) {
				e.setAttribute("data-capture-state", st.join(" "));
				for (const x of st) counts[x] = (counts[x] ?? 0) + 1;
			}
		}
		return counts;
	}
	/** Ids of selectors that Chromium matches on el, its subtree or its ancestors in the live page. */
	function liveMatches(el, sels, flags) {
		const doc = el.ownerDocument;
		const out = [];
		for (const s of sels) {
			if (s.needs && !flags[s.needs]) continue;
			let list;
			try { list = doc.querySelectorAll(s.sel); } catch { continue; }
			for (const e of list) if (e === el || el.contains(e) || e.contains(el)) { out.push(s.id); break; }
		}
		return out;
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
	window.cap = { sleep, find, locate, serialize, components, open, clean, overlays, last, ROOTS, clearSettingsSearch, reveal, visibility, markStates, liveMatches, hasSelection, overScrollbar };
})();
`;
