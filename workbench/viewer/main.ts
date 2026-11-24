import { combine } from "./compare-states.ts";
import type { CompareState, Fixture, Theme, ViewerData } from "./types.ts";

type Mode = Theme | "both";
type Child = Node | string | false | null | undefined;
type Rect = [number, number, number, number];

const MODES: [Mode, string][] = [
	["current", "Current theme"],
	["new", "New build"],
	["both", "Side by side"],
];
// The desktop window size the fixtures were captured at (capture/scripts/obsidian.ts).
const DESKTOP: [number, number] = [1600, 1000];
const SURFACE_LABELS: Record<string, string> = {
	"mobile-phone": "Phone (emulated)",
	"mobile-tablet": "Tablet (emulated)",
};
const surfaceLabel = (surface: string) => SURFACE_LABELS[surface] ?? surface;
const PAD = 8;
const GAP = 8;
// How many captures to try when looking for one that really shows a component.
const MAX_TRIES = 6;
// Properties listed per row before the rest fold into "+N more" (full list in its tooltip).
const MAX_PROPS = 8;

function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	el.append(...children.filter((c): c is Node | string => Boolean(c)));
	return el;
}

function must(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`#${id} missing`);
	return el;
}

const nav = must("nav");
const main = must("main");
const data = (await (await fetch("/api/data")).json()) as ViewerData;
const fixtures = new Map(data.fixtures.map((f) => [f.id, f]));
const usage = new Map(data.usage.map((u) => [u.component, u]));
const names = Object.keys(data.components).sort();
const shared = names.filter((n) => data.components[n]?.multiSurface);
// Shared components the build knows that no capture is tagged with still get a page.
const buildOnly = [...usage.keys()].filter((n) => !data.components[n]).sort();

function stored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
let mode: Mode = MODES.find(([m]) => m === stored("mw-viewer-mode"))?.[0] ?? "new";

// --- Navigation ---------------------------------------------------------------------------

/** Current theme against new build, over the component's own captures. */
function status(component: string): CompareState | undefined {
	if (!data.compare) return undefined;
	const own = data.fixtures.filter((f) => f.component === component);
	return combine(own.map((f) => data.compare?.[f.id]));
}

const DOT_TITLES = {
	same: "Same in the new build",
	different: "Differs in the new build",
	"not-proven": "Not proven the same",
};

function navLink(name: string, count?: number): HTMLElement {
	const s = status(name);
	return h(
		"a",
		{ href: `#${name}`, "data-name": name },
		h("span", { class: "nav-name" }, name),
		s && h("span", { class: `dot ${s.status}`, title: DOT_TITLES[s.status] }),
		count !== undefined && h("span", { class: "nav-count" }, String(count)),
	);
}

function renderNav(): void {
	const bySurface = new Map<string, string[]>();
	for (const n of names) {
		const c = data.components[n];
		if (!c || c.multiSurface) continue;
		const surface = c.surfaces[0] ?? "other";
		bySurface.set(surface, [...(bySurface.get(surface) ?? []), n]);
	}
	const filter = h("input", {
		type: "search",
		placeholder: "Filter components",
		"aria-label": "Filter components",
		spellcheck: "false",
	}) as HTMLInputElement;
	filter.addEventListener("input", () => {
		const q = filter.value.trim().toLowerCase();
		// Groups left with no visible link hide themselves (style.css).
		for (const a of nav.querySelectorAll("a")) a.hidden = !a.dataset.name?.includes(q);
	});
	nav.replaceChildren(
		h("div", { class: "nav-top" }, h("div", { class: "brand" }, "Miami Wind components"), filter),
		h(
			"div",
			{ class: "group" },
			h("h2", {}, "Components", h("span", {}, String(shared.length + buildOnly.length))),
			...shared.map((n) => navLink(n, data.components[n]?.surfaces.length)),
			...buildOnly.map((n) => navLink(n)),
		),
		h(
			"div",
			{ class: "group" },
			h("h2", {}, "Surface-only", h("span", {}, String(names.length - shared.length))),
			...[...bySurface.keys()]
				.sort()
				.map((s) =>
					h(
						"div",
						{ class: "group" },
						h("h3", {}, surfaceLabel(s)),
						...(bySurface.get(s) ?? []).map((n) => navLink(n)),
					),
				),
		),
	);
}

// --- Fixture frames -----------------------------------------------------------------------

const lazy = new IntersectionObserver(
	(entries) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			const frame = e.target.querySelector("iframe");
			if (frame?.dataset.src) frame.src = frame.dataset.src;
			lazy.unobserve(e.target);
		}
	},
	{ rootMargin: "600px" },
);

/** One fixture under one theme, cropped to the shown element once the frame reports it. */
function shot(f: Fixture, theme: Theme, label: boolean, focus?: string): HTMLElement {
	const frame = h("iframe", {
		"data-src": `/frame/${theme}/${encodeURIComponent(f.id)}${focus ? `?focus=${encodeURIComponent(focus)}` : ""}`,
		title: `${f.id} (${theme})`,
		// Captured markup is untrusted: no same-origin access, only the viewer's own measuring script.
		sandbox: "allow-scripts",
		width: String((f.viewport ?? DESKTOP)[0]),
		height: String((f.viewport ?? DESKTOP)[1]),
		tabindex: "-1",
	});
	const crop = h("div", { class: "crop" }, frame);
	lazy.observe(crop);
	return h(
		"div",
		{ class: "shot" },
		label && h("span", { class: "shot-label" }, theme === "current" ? "Current" : "New"),
		crop,
	);
}

/** Per crop: the box the frame reported. Per figure: what to do when its component is not found. */
const rects = new WeakMap<Element, Rect>();
const onMissing = new WeakMap<Element, () => void>();

/** Sizes a figure's crops. Side by side, captures wider than half the row stack at full size. */
function layout(figure: Element): void {
	const room = figure.closest(".captures")?.clientWidth ?? DESKTOP[0];
	const boxes = [...figure.querySelectorAll(".crop")].flatMap((crop) => {
		const r = rects.get(crop);
		const frame = crop.querySelector("iframe");
		if (!r || !frame) return [];
		const left = Math.max(0, r[0] - PAD);
		const top = Math.max(0, r[1] - PAD);
		const width = Math.min(Number(frame.width), r[0] + r[2] + PAD) - left;
		const height = Math.min(Number(frame.height), r[1] + r[3] + PAD) - top;
		return [{ crop: crop as HTMLElement, left, top, width, height }];
	});
	const half = (room - GAP) / 2 - 2;
	const stacked = mode === "both" && boxes.some((b) => b.width > half);
	figure.querySelector(".shots")?.classList.toggle("stacked", stacked);
	for (const b of boxes) {
		const scale = Math.min(1, (mode === "both" && !stacked ? half : room - 2) / b.width);
		b.crop.style.width = `${b.width * scale}px`;
		b.crop.style.height = `${b.height * scale}px`;
		const frame = b.crop.querySelector("iframe");
		if (frame) frame.style.transform = `scale(${scale}) translate(${-b.left}px, ${-b.top}px)`;
		b.crop.classList.add("ready");
	}
}

/** A row whose captures all turned out hidden has shown nothing, so it cannot claim "Same". */
function settle(row: Element | null): void {
	if (!row) return;
	const crops = [...row.querySelectorAll(".crop")];
	if (crops.some((c) => !c.classList.contains("hidden"))) return;
	const badge = row.querySelector(".badge.same");
	if (badge) badge.replaceWith(h("span", { class: "badge" }, "Nothing visible"));
}

addEventListener("message", (e: MessageEvent<{ mwRect?: unknown }>) => {
	if (typeof e.data !== "object" || e.data === null || !("mwRect" in e.data)) return;
	const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
	const crop = frame?.parentElement;
	const figure = crop?.closest("figure");
	if (!crop || !figure) return;
	const row = figure.closest(".surface");
	const r = e.data.mwRect;
	if (Array.isArray(r) && r.length === 4 && r.every((n) => Number.isFinite(n) && n >= 0)) {
		rects.set(crop, r as Rect);
		layout(figure);
		return;
	}
	// Not found or not visible. The first theme decides whether to try another capture.
	const retry = onMissing.get(figure);
	if (retry && crop === figure.querySelector(".crop")) return retry();
	crop.replaceChildren("Hidden in this capture");
	crop.classList.add("hidden");
	settle(row);
});

/** `focus` names the component to crop to when the fixture captured something larger around it. */
function capture(f: Fixture, focus?: string): HTMLElement {
	const themes: Theme[] = mode === "both" ? ["current", "new"] : [mode];
	const verdict = mode === "current" ? undefined : data.compare?.[f.id];
	return h(
		"figure",
		{ class: "capture" },
		h("div", { class: "shots" }, ...themes.map((t) => shot(f, t, mode === "both", focus))),
		h(
			"figcaption",
			f.note ? { title: f.note } : {},
			h("span", { class: f.state === "default" ? "state" : "state forced" }, f.state),
			h("code", {}, f.id),
			focus && f.component !== focus && h("span", { class: "aside" }, `in ${f.component}`),
			verdict?.status === "different" && h("span", { class: "changed" }, "Differs"),
			verdict?.status === "not-proven" &&
				h("span", { class: "unproven" }, `Not proven (${verdict.reasons.join("; ")})`),
		),
	);
}

/**
 * The first of `candidates` in which the component is really found and visible, tried one at a
 * time as the frames report back. When none qualifies, `none()` takes its place.
 */
function firstShowing(
	candidates: Fixture[],
	focus: string,
	none: () => Node,
	trying?: (f: Fixture | undefined) => void,
): Node {
	const [f, ...rest] = candidates;
	trying?.(f);
	if (!f) return none();
	const figure = capture(f, focus);
	onMissing.set(figure, () => {
		const row = figure.closest(".surface");
		const section = figure.closest("section");
		figure.replaceWith(firstShowing(rest, focus, none, trying));
		settle(row);
		// A "Shared look" left with nothing to show goes away.
		if (section?.classList.contains("shared") && !section.querySelector("figure")) section.remove();
	});
	return figure;
}

// --- Component page -----------------------------------------------------------------------

const bySize = (a: Fixture, b: Fixture) => a.size - b.size;

/** Current theme against new build: "Differs", "Same" or "Not proven (reason)", three distinct states. */
function badge(verdict: CompareState | undefined): HTMLElement {
	if (!verdict) return h("span", { class: "badge" }, "Not compared yet");
	if (verdict.status === "different") return h("span", { class: "badge differs" }, "Differs");
	if (verdict.status === "same") return h("span", { class: "badge same" }, "Same");
	const [first, ...more] = verdict.reasons;
	return h(
		"span",
		{ class: "badge unproven", title: verdict.reasons.join("\n") },
		`Not proven (${first ?? "no reason given"}${more.length ? `, +${more.length}` : ""})`,
	);
}

/** The verdict for a surface row: over the component's own captures there, when it has any. */
function rowVerdict(component: string, surface: string, all: Fixture[]): CompareState | undefined {
	const own = all.filter((f) => f.surface === surface && f.component === component);
	return data.compare ? combine(own.map((f) => data.compare?.[f.id])) : undefined;
}

function surfaceRow(component: string, surface: string, all: Fixture[]): HTMLElement {
	const here = all.filter((f) => f.surface === surface);
	const own = here.filter((f) => f.component === component);
	// From component-diffs.json: how this surface departs from the component's shared look.
	const props = data.diffs?.[component]?.[surface]?.props ?? [];
	const verdict = h("div", {}, badge(rowVerdict(component, surface, all)));
	const none = () =>
		h("p", { class: "none" }, "No capture of this component on this surface.") as Node;
	// Without a capture of its own, the row is judged by the larger capture it ends up showing.
	const trying = (f: Fixture | undefined) =>
		verdict.replaceChildren(badge(f ? data.compare?.[f.id] : undefined));
	const row = h(
		"section",
		{ class: "surface" },
		h(
			"header",
			{},
			h("h3", {}, surfaceLabel(surface)),
			verdict,
			props.length > 0 &&
				h(
					"ul",
					{ class: "props" },
					h("li", { class: "props-title" }, "Off the shared look"),
					...props.slice(0, MAX_PROPS).map((p) => h("li", {}, p)),
					props.length > MAX_PROPS &&
						h(
							"li",
							{ class: "props-title", title: props.slice(MAX_PROPS).join("\n") },
							`+${props.length - MAX_PROPS} more`,
						),
				),
		),
		h(
			"div",
			{ class: "captures" },
			// Captures of the component itself; failing that, one larger capture that visibly has it.
			...(own.length
				? own.map((f) => capture(f))
				: [firstShowing(here.toSorted(bySize).slice(0, MAX_TRIES), component, none, trying)]),
		),
	);
	settle(row);
	return row;
}

/** One capture per state: the smallest capture of the component itself, default first. */
function sharedLook(component: string, own: Fixture[]): HTMLElement | false {
	const states = Map.groupBy(own.toSorted(bySize), (f) => f.state);
	if (states.size === 0) return false;
	const order = [...states.keys()].sort(
		(a, b) => Number(b === "default") - Number(a === "default"),
	);
	return h(
		"section",
		{ class: "shared" },
		h("h2", {}, "Shared look"),
		h(
			"div",
			{ class: "captures" },
			...order.map((s) =>
				firstShowing((states.get(s) ?? []).slice(0, MAX_TRIES), component, () =>
					document.createComment(`no clean capture of ${s}`),
				),
			),
		),
	);
}

function usageTable(component: string): HTMLElement | false {
	const u = usage.get(component);
	if (!u) return false;
	return h(
		"section",
		{},
		h("h2", {}, "Build usage"),
		h(
			"table",
			{},
			h(
				"thead",
				{},
				h("tr", {}, h("th", {}, "Source"), h("th", {}, "Selector"), h("th", {}, "Sets")),
			),
			h(
				"tbody",
				{},
				...u.usages.map((x) =>
					h(
						"tr",
						{},
						h("td", {}, x.surface),
						h("td", {}, h("code", {}, x.selector)),
						h(
							"td",
							{},
							...Object.entries(x.properties).map(([k, v]) =>
								h("code", { class: "decl" }, `${k}: ${v}`),
							),
						),
					),
				),
			),
		),
	);
}

function modeSwitch(): HTMLElement {
	return h(
		"div",
		{ class: "switch", role: "group", "aria-label": "Theme" },
		...MODES.map(([m, label]) => {
			const b = h("button", { type: "button", "aria-pressed": String(m === mode) }, label);
			b.addEventListener("click", () => {
				mode = m;
				try {
					localStorage.setItem("mw-viewer-mode", m);
				} catch {
					// Private windows: the choice just doesn't persist.
				}
				renderPage();
			});
			return b;
		}),
	);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function renderPage(): void {
	const name = decodeURIComponent(location.hash.slice(1)) || shared[0] || names[0] || "";
	for (const a of nav.querySelectorAll("a")) {
		if (a.dataset.name === name) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	}
	const entry = data.components[name];
	const all = (entry?.fixtures ?? []).flatMap((id) => fixtures.get(id) ?? []);
	const own = all.filter((f) => f.component === name);
	const verdicts = new Map(
		(entry?.surfaces ?? []).map((x) => [x, rowVerdict(name, x, all)?.status]),
	);
	const differs = (x: string) => verdicts.get(x) === "different";
	// Differing surfaces first; the sort is stable, so each group stays alphabetical.
	const surfaces = (entry?.surfaces ?? []).toSorted(
		(a, b) => Number(differs(b)) - Number(differs(a)),
	);
	const compared = surfaces.filter((x) => verdicts.get(x)).length;
	const meta = entry
		? [
				plural(surfaces.length, "surface"),
				plural(all.length, "capture"),
				compared > 0 && `${surfaces.filter(differs).length} of ${compared} differ`,
			]
				.filter(Boolean)
				.join(" · ")
		: "Build component with no captures";
	const ready = data.appCss && data.cmCss;

	const parts: Child[] = [
		h("header", { class: "top" }, h("div", {}, h("h1", {}, name), h("p", {}, meta)), modeSwitch()),
		!data.appCss &&
			h(
				"p",
				{ class: "message" },
				"Obsidian's app CSS is not extracted yet, so captures cannot render. Run ",
				h("code", {}, "bun run capture:extract-app-css"),
				" and this page reloads.",
			),
		data.appCss &&
			!data.cmCss &&
			h(
				"p",
				{ class: "message" },
				"Obsidian's editor rules are not extracted yet, so captures cannot render. Run ",
				h("code", {}, "bun run compare"),
				" and this page reloads.",
			),
		data.compareError &&
			h("p", { class: "message" }, `Per-capture results are off. ${data.compareError}`),
		ready && entry?.multiSurface && sharedLook(name, own),
		ready &&
			surfaces.length > 0 &&
			h(
				"section",
				{},
				h("h2", {}, entry?.multiSurface ? "By surface" : "Captures"),
				...surfaces.map((s) => surfaceRow(name, s, all)),
			),
		usageTable(name),
	];
	main.replaceChildren(...parts.filter((c): c is Node | string => Boolean(c)));
	main.scrollTop = 0;
}

renderNav();
renderPage();
nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "center" });
addEventListener("hashchange", renderPage);
