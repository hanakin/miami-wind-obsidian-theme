// Helpers installed into each Obsidian window as `window.cap`. Plain JS on purpose: it runs
// inside Obsidian through Runtime.evaluate, which Obsidian's CSP does not block.
export const INPAGE = String.raw`
(() => {
	// Popout windows (settings, popout tabs) reach the app through their opener.
	if (!window.app && window.opener?.app) window.app = window.opener.app;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
		let el = list[t.nth ?? 0] ?? null;
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
	async function locate(t) {
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
		if (el && el.scrollIntoView && !el.closest(".modal, .menu, .popover, .prompt")) {
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
	/** The element's DOM plus its ancestor wrappers (attributes only) and the html/body classes. */
	function serialize(el) {
		const doc = el.ownerDocument;
		let html;
		if (el === doc.body || el === doc.documentElement) {
			const clone = doc.body.cloneNode(true);
			syncForm(doc.body, clone);
			html = clone.innerHTML;
		} else {
			const clone = el.cloneNode(true);
			syncForm(el, clone);
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
		for (const a of ["data-capture-state", "data-capture-target", "data-capture-pseudo"]) {
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
	window.cap = { sleep, find, locate, serialize, components, open, clean, overlays, last, ROOTS, clearSettingsSearch };
})();
`;
