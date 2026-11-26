import { type Change, pageSummary, rowState } from "./compare-states.ts";
import type { CompareState, Fixture, Theme, ViewerData } from "./types.ts";
import { bySurface, kinds, plainProperty, plainReason, surfaceName } from "./words.ts";

type Mode = Theme | "both";
type Status = CompareState["status"];
type Child = Node | string | false | null | undefined;
type Rect = [number, number, number, number];

const MODES: [Mode, string][] = [
	["current", "1.x theme"],
	["new", "2.0 build"],
	["both", "Side by side"],
];
// The four states a place or capture can be in, worst first, in plain words.
const STATES: [Status, string][] = [
	["different", "Differs"],
	["not-proven", "Not proven"],
	["accepted", "Accepted"],
	["same", "Same"],
];
const LABEL = Object.fromEntries(STATES) as Record<Status, string>;
// The desktop window size the fixtures were captured at (capture/scripts/obsidian.ts).
const DESKTOP: [number, number] = [1600, 1000];
// Room around the shown element, and the least a crop shows, so small things keep some context.
const PAD = 16;
const MIN_W = 320;
const MIN_H = 96;
const GAP = 8;
// How many captures to try when looking for one that shows a state for the shared look.
const MAX_TRIES = 6;
// Changes listed under a capture before the rest fold behind a click.
const MAX_CHANGES = 3;

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

/** Every capture the component appears in, its own and larger ones around it. */
const capturesOf = (name: string) =>
	(data.components[name]?.fixtures ?? []).flatMap((id) => fixtures.get(id) ?? []);
/** A component's places counted by verdict: the page header and the sidebar dot both use this. */
const summaryOf = (name: string) =>
	pageSummary(name, data.components[name]?.surfaces ?? [], capturesOf(name), data.compare);
const summaries = new Map(names.map((n) => [n, summaryOf(n)]));

function stored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
let mode: Mode = MODES.find(([m]) => m === stored("mw-viewer-view"))?.[0] ?? "both";

// --- Navigation ---------------------------------------------------------------------------

function navLink(name: string, count?: number): HTMLElement {
	const worst = summaries.get(name)?.worst;
	return h(
		"a",
		{ href: `#${name}`, "data-name": name },
		h("span", { class: "nav-name" }, name),
		worst && h("span", { class: `dot ${worst}`, title: LABEL[worst] }),
		count !== undefined && h("span", { class: "nav-count" }, String(count)),
	);
}

/** What the dots mean, with how many components sit in each state. */
function legend(): HTMLElement {
	return h(
		"ul",
		{ class: "legend", "aria-label": "1.x vs 2.0, by component" },
		...STATES.toReversed().map(([status, label]) =>
			h(
				"li",
				{},
				h("span", { class: `dot ${status}` }),
				`${[...summaries.values()].filter((s) => s.worst === status).length} ${status === "different" ? "differ" : label.toLowerCase()}`,
			),
		),
	);
}

function renderNav(): void {
	const bySurfaceName = new Map<string, string[]>();
	for (const n of names) {
		const c = data.components[n];
		if (!c || c.multiSurface) continue;
		const surface = c.surfaces[0] ?? "other";
		bySurfaceName.set(surface, [...(bySurfaceName.get(surface) ?? []), n]);
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
		h(
			"div",
			{ class: "nav-top" },
			h("div", { class: "brand" }, "Miami Wind components"),
			filter,
			legend(),
		),
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
			h("h2", {}, "Used in one place", h("span", {}, String(names.length - shared.length))),
			...[...bySurfaceName.keys()]
				.sort(bySurface)
				.map((s) =>
					h(
						"div",
						{ class: "group" },
						h("h3", {}, surfaceName(s)),
						...(bySurfaceName.get(s) ?? []).map((n) => navLink(n)),
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
		title: `${f.id} (${theme === "current" ? "1.x" : "2.0"})`,
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
		label && h("span", { class: "shot-label" }, theme === "current" ? "1.x" : "2.0"),
		crop,
	);
}

/** Per crop: the box the frame reported. Per figure: what to do when its component is not found. */
const rects = new WeakMap<Element, Rect>();
const onMissing = new WeakMap<Element, () => void>();

/** A span of at least `min` around [start, start + size], kept inside [0, limit]. */
function span(start: number, size: number, min: number, limit: number): [number, number] {
	const length = Math.min(limit, Math.max(size + 2 * PAD, min));
	const from = Math.min(Math.max(0, start + size / 2 - length / 2), limit - length);
	return [from, length];
}

/** Sizes a figure's crops. Side by side, captures wider than half the row stack at full size. */
function layout(figure: Element): void {
	const room = figure.closest(".captures")?.clientWidth ?? DESKTOP[0];
	const boxes = [...figure.querySelectorAll(".crop")].flatMap((crop) => {
		const r = rects.get(crop);
		const frame = crop.querySelector("iframe");
		if (!r || !frame) return [];
		const [left, width] = span(r[0], r[2], MIN_W, Number(frame.width));
		const [top, height] = span(r[1], r[3], MIN_H, Number(frame.height));
		return [{ crop: crop as HTMLElement, frame, left, top, width, height }];
	});
	const half = (room - GAP) / 2 - 2;
	const stacked = mode === "both" && boxes.some((b) => b.width > half);
	figure.querySelector(".shots")?.classList.toggle("stacked", stacked);
	for (const b of boxes) {
		const scale = Math.min(1, (mode === "both" && !stacked ? half : room - 2) / b.width);
		b.crop.style.width = `${b.width * scale}px`;
		b.crop.style.height = `${b.height * scale}px`;
		b.frame.style.transform = `scale(${scale}) translate(${-b.left}px, ${-b.top}px)`;
		b.crop.classList.add("ready");
	}
}

addEventListener("message", (e: MessageEvent<{ mwRect?: unknown }>) => {
	if (typeof e.data !== "object" || e.data === null || !("mwRect" in e.data)) return;
	const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
	const crop = frame?.parentElement;
	const figure = crop?.closest("figure");
	if (!crop || !figure) return;
	const r = e.data.mwRect;
	if (Array.isArray(r) && r.length === 4 && r.every((n) => Number.isFinite(n) && n >= 0)) {
		rects.set(crop, r as Rect);
		layout(figure);
		return;
	}
	// Not found or not visible. For the shared look, the first theme decides whether to try another.
	const retry = onMissing.get(figure);
	if (retry && crop === figure.querySelector(".crop")) return retry();
	// No empty box: the caption stays and says why there is no picture. Verdicts never depend on this.
	crop.parentElement?.remove();
	if (!figure.querySelector(".shot") && !figure.querySelector(".unseen")) {
		figure
			.querySelector("figcaption")
			?.append(h("span", { class: "aside unseen" }, "not visible in this capture"));
	}
});

/** A CSS value, with a swatch when it is a color. */
function value(v: string | null): HTMLElement {
	const out = h("code", {}, v ?? "none");
	if (v && CSS.supports("color", v)) {
		const swatch = h("span", { class: "swatch" });
		swatch.style.background = v;
		out.prepend(swatch);
	}
	return out;
}

// Property names listed per change before they are summed up by kind.
const MAX_NAMES = 3;

function changeLine(c: Change): HTMLElement {
	// A few properties are named; a long list is summed up by the kinds of thing it changes.
	const what =
		c.properties.length > MAX_NAMES
			? `${kinds(c.properties)} (${c.properties.length} properties)`
			: c.properties.map(plainProperty).join(", ");
	return h(
		"li",
		{ title: c.properties.join("\n") },
		`${what}: `,
		value(c.before),
		" → ",
		value(c.after),
		c.accepted && h("span", { class: "verdict accepted" }, " accepted (intentional)"),
	);
}

/** What differs in a capture, in plain words: the first few changes, the rest behind a click. */
function whatDiffers(f: Fixture): HTMLElement | false {
	const found = data.changes[f.id];
	if (!found) return false;
	const more = found.list.slice(MAX_CHANGES);
	const picture =
		found.diffImage && h("img", { alt: `Changed pixels in ${f.id}`, loading: "lazy" });
	const details = (more.length > 0 || picture) && h("details", {});
	if (details) {
		const hidden = found.total - MAX_CHANGES;
		details.append(
			h(
				"summary",
				{},
				[
					hidden > 0 && `${hidden} more ${hidden === 1 ? "change" : "changes"}`,
					picture && "picture of the changed pixels",
				]
					.filter(Boolean)
					.join(" and "),
			),
		);
		if (more.length) details.append(h("ul", {}, ...more.map(changeLine)));
		if (found.total > found.list.length) {
			details.append(h("p", {}, `…and ${found.total - found.list.length} rarer ones.`));
		}
		if (picture) {
			details.append(picture);
			// Fetched only when opened: these are full-window pictures.
			details.addEventListener(
				"toggle",
				() => picture.setAttribute("src", `/diff/${encodeURIComponent(f.id)}`),
				{ once: true },
			);
		}
	}
	return h(
		"div",
		{ class: "differs" },
		h("ul", {}, ...found.list.slice(0, MAX_CHANGES).map(changeLine)),
		details,
	);
}

/** A verdict's reason in plain words, when it has one. */
function reasonOf(verdict: CompareState): string {
	if (verdict.status === "not-proven") return verdict.reasons.map(plainReason).join("; ");
	return verdict.status === "accepted" ? `intentional: ${verdict.reason}` : "";
}

/** `focus` names the component to crop to when the fixture captured something larger around it. */
function capture(f: Fixture, focus?: string): HTMLElement {
	const themes: Theme[] = mode === "both" ? ["current", "new"] : [mode];
	const verdict = rowState(f.component, f.surface, [f], data.compare);
	const reason = verdict && reasonOf(verdict);
	return h(
		"figure",
		{ class: "capture" },
		h("div", { class: "shots" }, ...themes.map((t) => shot(f, t, mode === "both", focus))),
		h(
			"figcaption",
			f.note ? { title: f.note } : {},
			h("span", { class: f.state === "default" ? "state" : "state forced" }, f.state),
			h("code", {}, f.id),
			verdict &&
				verdict.status !== "same" &&
				h(
					"span",
					{ class: `verdict ${verdict.status}` },
					`${LABEL[verdict.status]}${reason ? `: ${reason}` : ""}`,
				),
		),
		verdict?.status !== "same" && whatDiffers(f),
	);
}

/**
 * The first of `candidates` in which the component is really found and visible, tried one at a
 * time as the frames report back. When none qualifies, the tile goes away.
 */
function firstShowing(candidates: Fixture[], focus: string): Node {
	const [f, ...rest] = candidates;
	if (!f) return document.createComment("no capture shows this state");
	const figure = capture(f, focus);
	onMissing.set(figure, () => {
		const section = figure.closest("section");
		figure.replaceWith(firstShowing(rest, focus));
		// A "Shared look" left with nothing to show goes away.
		if (section && !section.querySelector("figure")) section.remove();
	});
	return figure;
}

// --- Component page -----------------------------------------------------------------------

const bySize = (a: Fixture, b: Fixture) => a.size - b.size;

/** A list that stays folded until asked for. */
function fold(summary: string, ...content: Child[]): HTMLElement {
	return h("details", {}, h("summary", {}, summary), ...content);
}

/** How this place departs from the component's shared look (component-diffs.json), in one line. */
function sharedLookLine(component: string, surface: string): HTMLElement | false {
	const d = data.diffs?.[component]?.[surface];
	if (!d) return false;
	if (d.same) return h("p", { class: "look" }, "Shared look: matches");
	return h(
		"div",
		{ class: "look" },
		h("p", {}, `Shared look: differs here (${kinds(d.props)})`),
		fold(
			`All ${d.props.length} properties`,
			h("ul", { class: "props" }, ...d.props.map((p) => h("li", {}, p))),
		),
	);
}

function surfaceRow(component: string, surface: string, own: Fixture[]): HTMLElement {
	const verdict = rowState(component, surface, own, data.compare);
	const reason = verdict && reasonOf(verdict);
	return h(
		"section",
		{ class: "surface" },
		h(
			"header",
			{},
			h("h3", {}, surfaceName(surface)),
			verdict &&
				h("span", { class: `badge ${verdict.status}` }, `1.x vs 2.0: ${LABEL[verdict.status]}`),
			reason && h("p", { class: "reason" }, reason),
			sharedLookLine(component, surface),
		),
		h("div", { class: "captures" }, ...own.map((f) => capture(f))),
	);
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
			...order.map((s) => firstShowing((states.get(s) ?? []).slice(0, MAX_TRIES), component)),
		),
	);
}

function usageTable(component: string): HTMLElement | false {
	const u = usage.get(component);
	if (!u) return false;
	return h(
		"section",
		{},
		fold(
			`Build details (${u.usages.length} ${u.usages.length === 1 ? "rule" : "rules"})`,
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
					localStorage.setItem("mw-viewer-view", m);
				} catch {
					// Private windows: the choice just doesn't persist.
				}
				renderPage();
			});
			return b;
		}),
	);
}

/** "21 places: 14 same, 0 differ, 4 not proven, 3 no capture". */
function counts(name: string, places: number): string {
	const s = summaries.get(name);
	if (!s) return "Build component with no captures";
	const parts = [
		`${s.same} same`,
		`${s.different} differ`,
		`${s["not-proven"]} not proven`,
		s.accepted > 0 && `${s.accepted} accepted`,
		s.noCapture > 0 && `${s.noCapture} no capture`,
	];
	return `${places} ${places === 1 ? "place" : "places"}: ${parts.filter(Boolean).join(", ")}`;
}

function renderPage(): void {
	const name = decodeURIComponent(location.hash.slice(1)) || shared[0] || names[0] || "";
	for (const a of nav.querySelectorAll("a")) {
		if (a.dataset.name === name) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	}
	const entry = data.components[name];
	const own = capturesOf(name).filter((f) => f.component === name);
	const ownOn = (surface: string) => own.filter((f) => f.surface === surface);
	const status = (surface: string) => rowState(name, surface, own, data.compare)?.status;
	const places = (entry?.surfaces ?? []).toSorted(bySurface);
	// Places that differ come first; the sort is stable, so the rest keep their order.
	const rows = places
		.filter((s) => ownOn(s).length > 0)
		.toSorted((a, b) => Number(status(b) === "different") - Number(status(a) === "different"));
	const bare = places.filter((s) => ownOn(s).length === 0);
	const ready = data.appCss && data.cmCss;

	const parts: Child[] = [
		h(
			"header",
			{ class: "top" },
			h("div", {}, h("h1", {}, name), h("p", {}, counts(name, places.length))),
			modeSwitch(),
		),
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
				h("code", {}, "bun run capture:extract-runtime-css"),
				" and this page reloads.",
			),
		!data.compare &&
			h(
				"p",
				{ class: "message" },
				data.compareError ?? "1.x and 2.0 have not been compared yet. Run ",
				!data.compareError && h("code", {}, "bun run compare"),
				!data.compareError && " and this page reloads.",
			),
		ready && entry?.multiSurface && sharedLook(name, own),
		ready &&
			rows.length > 0 &&
			h(
				"section",
				{},
				h("h2", {}, entry?.multiSurface ? "By place" : "Captures"),
				...rows.map((s) => surfaceRow(name, s, ownOn(s))),
			),
		bare.length > 0 &&
			h(
				"p",
				{ class: "also" },
				`Also used in: ${bare.map(surfaceName).join(", ")}. No capture of its own there yet.`,
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
