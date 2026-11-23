import type { Fixture, Theme, ViewerData } from "./types.ts";

type Mode = Theme | "both";
type Child = Node | string | false | null | undefined;

const MODES: [Mode, string][] = [
	["current", "Current theme"],
	["new", "New build"],
	["both", "Side by side"],
];
// The window size the fixtures were captured at (capture/scripts/obsidian.ts).
const FRAME_W = 1600;
const FRAME_H = 1000;
const PAD = 8;

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
const changed = data.changed && new Set(data.changed);
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

/** "differs" when any surface differs, "same" when all match, undefined when not compared. */
function status(component: string): "same" | "differs" | undefined {
	const d = data.diffs?.[component];
	if (!d) return undefined;
	return Object.values(d).some((s) => !s.same) ? "differs" : "same";
}

function navLink(name: string, count?: number): HTMLElement {
	const s = status(name);
	return h(
		"a",
		{ href: `#${name}`, "data-name": name },
		h("span", { class: "nav-name" }, name),
		s &&
			h("span", { class: `dot ${s}`, title: s === "same" ? "Same on every surface" : "Differs" }),
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
	nav.replaceChildren(
		h("div", { class: "brand" }, "Miami Wind", h("span", {}, "Obsidian components")),
		h("h2", {}, "Components", h("span", {}, String(shared.length + buildOnly.length))),
		...shared.map((n) => navLink(n, data.components[n]?.surfaces.length)),
		...buildOnly.map((n) => navLink(n)),
		h("h2", {}, "Surface-only", h("span", {}, String(names.length - shared.length))),
		...[...bySurface.keys()]
			.sort()
			.flatMap((s) => [h("h3", {}, s), ...(bySurface.get(s) ?? []).map((n) => navLink(n))]),
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

/** One fixture under one theme, cropped to the captured element once the frame reports it. */
function shot(f: Fixture, theme: Theme, label: boolean, focus?: string): HTMLElement {
	const frame = h("iframe", {
		"data-src": `/frame/${theme}/${encodeURIComponent(f.id)}${focus ? `?focus=${encodeURIComponent(focus)}` : ""}`,
		title: `${f.id} (${theme})`,
		width: String(FRAME_W),
		height: String(FRAME_H),
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

addEventListener("message", (e: MessageEvent<{ mwRect?: [number, number, number, number] }>) => {
	const rect = e.data?.mwRect;
	if (!rect) return;
	const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
	const crop = frame?.parentElement;
	if (!frame || !crop) return;
	const [x, y, w, h_] = rect;
	if (w === 0 || h_ === 0) {
		// The theme (or Obsidian itself) hides the captured element in this fixture.
		crop.replaceChildren("Hidden in this capture");
		crop.classList.add("hidden");
		return;
	}
	const left = Math.max(0, x - PAD);
	const top = Math.max(0, y - PAD);
	const width = Math.min(FRAME_W, x + w + PAD) - left;
	const height = Math.min(FRAME_H, y + h_ + PAD) - top;
	const room = crop.closest(".captures")?.clientWidth ?? width;
	const scale = Math.min(1, (mode === "both" ? room / 2 - 24 : room - 26) / width);
	crop.style.width = `${width * scale}px`;
	crop.style.height = `${height * scale}px`;
	frame.style.transform = `scale(${scale}) translate(${-left}px, ${-top}px)`;
	crop.classList.add("ready");
});

/** `inside` names the component to crop to when the fixture captured something larger around it. */
function capture(f: Fixture, inside?: string): HTMLElement {
	const themes: Theme[] = mode === "both" ? ["current", "new"] : [mode];
	return h(
		"figure",
		{ class: "capture" },
		h("div", { class: "shots" }, ...themes.map((t) => shot(f, t, mode === "both", inside))),
		h(
			"figcaption",
			f.note ? { title: f.note } : {},
			h("span", { class: f.state === "default" ? "state" : "state forced" }, f.state),
			h("code", {}, f.id),
			inside && h("span", { class: "inside" }, `in ${f.component}`),
			mode !== "current" && changed?.has(f.id) && h("span", { class: "changed" }, "Changed"),
		),
	);
}

// --- Component page -----------------------------------------------------------------------

function badge(component: string, surface: string): HTMLElement {
	const d = data.diffs?.[component]?.[surface];
	if (!d) return h("span", { class: "badge" }, "Not compared yet");
	return d.same
		? h("span", { class: "badge same" }, "Same")
		: h("span", { class: "badge differs" }, "Differs");
}

function surfaceRow(component: string, surface: string, all: Fixture[]): HTMLElement {
	const here = all.filter((f) => f.surface === surface);
	const own = here.filter((f) => f.component === component);
	// No capture of the component itself on this surface: show it inside what was captured there.
	const shown = own.length ? own : here.toSorted((a, b) => a.size - b.size).slice(0, 3);
	const props = data.diffs?.[component]?.[surface]?.props ?? [];
	return h(
		"section",
		{ class: "surface" },
		h(
			"header",
			{},
			h("h3", {}, surface),
			badge(component, surface),
			props.length > 0 && h("ul", { class: "props" }, ...props.map((p) => h("li", {}, p))),
		),
		h(
			"div",
			{ class: "captures" },
			...shown.map((f) => capture(f, own.length ? undefined : component)),
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

function renderPage(): void {
	const name = decodeURIComponent(location.hash.slice(1)) || shared[0] || names[0] || "";
	for (const a of nav.querySelectorAll("a")) {
		if (a.dataset.name === name) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	}
	const entry = data.components[name];
	const all = (entry?.fixtures ?? []).flatMap((id) => fixtures.get(id) ?? []);
	const own = all.filter((f) => f.component === name);
	// One capture per state, default first.
	const states = [...new Map(own.map((f) => [f.state, f])).values()].sort(
		(a, b) => Number(b.state === "default") - Number(a.state === "default"),
	);
	const surfaces = entry?.surfaces ?? [];
	const meta = entry
		? `${surfaces.length} ${surfaces.length === 1 ? "surface" : "surfaces"} · ${all.length} ${all.length === 1 ? "capture" : "captures"}`
		: "Build component with no captures";

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
			entry?.multiSurface &&
			states.length > 0 &&
			h(
				"section",
				{},
				h("h2", {}, "Shared look"),
				h("div", { class: "captures" }, ...states.map((f) => capture(f))),
			),
		data.appCss &&
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
// The server says when the built theme, app CSS or compare result changed.
new EventSource("/events").addEventListener("message", () => location.reload());
