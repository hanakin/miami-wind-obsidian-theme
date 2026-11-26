import {
	type Change,
	captureState,
	type PlaceVerdict,
	pageSummary,
	rowState,
} from "./compare-states.ts";
import type { CompareState, Fixture, Theme, ViewerData } from "./types.ts";
import { bySurface, kinds, plainReason, surfaceName } from "./words.ts";

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
	pageSummary(
		name,
		data.components[name]?.surfaces ?? [],
		capturesOf(name),
		data.compare,
		data.touched,
	);
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
		h("li", { class: "legend-title" }, `${names.length} components:`),
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
/** Per crop: the left edge and width of the line or block around a small element. */
const arounds = new WeakMap<Element, [number, number]>();
// A surrounding line is shown whole when it is no wider than this; wider ones are cut around the item.
const MAX_AROUND = 760;
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
		// A small item is shown with the whole line around it, so no word is cut in half.
		const a = arounds.get(crop);
		const whole = a && a[1] <= MAX_AROUND && a[0] <= r[0] && a[0] + a[1] >= r[0] + r[2];
		const [left, width] = whole
			? span(a[0], a[1], MIN_W, Number(frame.width))
			: span(r[0], r[2], MIN_W, Number(frame.width));
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

addEventListener("message", (e: MessageEvent<{ mwRect?: unknown; mwAround?: unknown }>) => {
	if (typeof e.data !== "object" || e.data === null || !("mwRect" in e.data)) return;
	const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
	const crop = frame?.parentElement;
	const figure = crop?.closest("figure");
	if (!crop || !figure) return;
	const r = e.data.mwRect;
	if (Array.isArray(r) && r.length === 4 && r.every((n) => Number.isFinite(n) && n >= 0)) {
		rects.set(crop, r as Rect);
		const a = e.data.mwAround;
		if (Array.isArray(a) && a.length === 2 && a.every((n) => Number.isFinite(n))) {
			arounds.set(crop, [Math.max(0, a[0]), a[1]]);
		}
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
			?.append(
				h(
					"span",
					{ class: "aside unseen" },
					"No picture: the item is hidden when this capture is replayed.",
				),
			);
	}
});

// Crops are sized for the room they have; a resized window gives them a different room.
addEventListener("resize", () => {
	for (const figure of document.querySelectorAll("figure")) layout(figure);
});

/** A CSS value: a swatch for a color (the value itself on hover), the plain value otherwise. */
function value(v: string | null): HTMLElement {
	if (v && CSS.supports("color", v)) {
		const swatch = h("span", { class: "swatch", title: v, role: "img", "aria-label": v });
		swatch.style.background = v;
		return swatch;
	}
	return h("code", {}, v ?? "none");
}

/** One change in plain words: what changed, from what to what, and on which item. */
function changeLine(c: Change): HTMLElement {
	return h(
		"li",
		{ title: `${c.properties.join(", ")}\n${c.before} → ${c.after}` },
		`${c.what}: `,
		value(c.before),
		" → ",
		value(c.after),
		` on ${c.where}`,
		c.accepted && h("span", { class: "verdict accepted" }, ", accepted (intentional)"),
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
	// A larger capture previewed for another component: its own verdict is not that component's.
	const around = focus !== undefined && f.component !== focus;
	const verdict = around ? undefined : captureState(data.compare, f.id);
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
			around && h("span", { class: "aside" }, `in ${f.component}`),
			verdict &&
				verdict.status !== "same" &&
				h(
					"span",
					{ class: `verdict ${verdict.status}` },
					`${LABEL[verdict.status]}${reason ? `: ${reason}` : ""}`,
				),
		),
		verdict && verdict.status !== "same" && whatDiffers(f),
	);
}

/**
 * The first of `candidates` in which the component is really found and visible, tried one at a
 * time as the frames report back. When none qualifies, `none()` takes its place. This picks a
 * picture only; verdicts never depend on it.
 */
function firstShowing(candidates: Fixture[], focus: string, none?: () => Node): Node {
	const [f, ...rest] = candidates;
	if (!f) return none?.() ?? document.createComment("no capture shows this state");
	const figure = capture(f, focus);
	onMissing.set(figure, () => {
		const section = figure.closest("section");
		figure.replaceWith(firstShowing(rest, focus, none));
		// A "Shared look" left with nothing to show goes away.
		if (section?.classList.contains("shared") && !section.querySelector("figure")) section.remove();
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
	// Nothing to say when it matches. This is about the component across places, not 1.x vs 2.0.
	if (!d || d.same) return false;
	return h(
		"div",
		{ class: "look" },
		fold(
			`Styled differently here than the standard ${component}`,
			h("p", {}, `In: ${kinds(d.props)}.`),
			h("ul", { class: "props" }, ...d.props.map((p) => h("li", {}, p))),
		),
	);
}

/** Each not-proven reason on its own line, with how many of the place's captures it applies to. */
function reasonLines(place: PlaceVerdict): HTMLElement | false {
	if (place.state.status === "accepted") {
		return h("p", { class: "reason" }, `Intentional: ${place.state.reason}`);
	}
	if (place.state.status !== "not-proven") return false;
	return h(
		"ul",
		{ class: "reason" },
		...place.reasons.map(([reason, n]) =>
			h(
				"li",
				{},
				place.captures === 1
					? plainReason(reason)
					: `${n} of ${place.captures} captures: ${plainReason(reason)}`,
			),
		),
	);
}

/** One place: its verdict from the data, and the captures (or one close-up) that show it. */
function surfaceRow(component: string, surface: string, all: Fixture[]): HTMLElement {
	const here = all.filter((f) => f.surface === surface);
	const place = rowState(component, surface, all, data.compare, data.touched);
	const status = place?.state.status ?? "not-proven";
	const captures = h("div", { class: "captures" });
	const row = h(
		"section",
		{ class: "surface" },
		h(
			"header",
			{},
			h("h3", {}, surfaceName(surface)),
			h("span", { class: `badge ${status}` }, `1.x vs 2.0: ${LABEL[status]}`),
			place?.inside &&
				h(
					"p",
					{ class: "reason" },
					`Seen inside ${here.length === 1 ? "a larger capture" : `${here.length} larger captures`}.`,
				),
			place && reasonLines(place),
			sharedLookLine(component, surface),
		),
		captures,
	);
	// The component's own captures; failing that, one close-up from a larger capture. With no
	// close-up to show, the row shrinks to a single line.
	captures.append(
		...(place?.inside
			? [
					firstShowing(here.toSorted(bySize).slice(0, MAX_TRIES), component, () => {
						row.classList.add("bare");
						return h("p", { class: "reason" }, "No close-up to show.");
					}),
				]
			: here.filter((f) => f.component === component).map((f) => capture(f))),
	);
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
	if (!s) return "Used by the build only. There are no captures of it yet.";
	const parts = [
		`${s.same} same`,
		`${s.different} differ`,
		`${s["not-proven"]} not proven`,
		s.accepted > 0 && `${s.accepted} accepted`,
		s.noCapture > 0 && `${s.noCapture} no capture`,
	];
	return `${places} ${places === 1 ? "place" : "places"}: ${parts.filter(Boolean).join(", ")}`;
}

/** "Compared 1.x with 2.0 build 3f9c2ab, Nov 25, 2026." Which build the results describe. */
function reportLine(): string | false {
	const r = data.report;
	if (!r) return false;
	const date = new Date(r.generated).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	return r.after
		? `Compared 1.x with 2.0 build ${r.after.sha256.slice(0, 7)}, ${date}.`
		: `Compared 1.x with a 2.0 build on ${date}. The report does not record which build.`;
}

/** A warning when the pictures may not show the build the results describe. */
function reportNotice(): HTMLElement | false {
	const r = data.report;
	if (!r) return false;
	const older = r.stale ? "This report is older than the current build. " : "";
	if (r.exact) {
		// Both sides verified against the report's hashes: only an old report is worth a note.
		return older
			? h("p", { class: "message warn" }, older, "The pictures show the build it compared.")
			: false;
	}
	// Either side unverified is enough: a matching 2.0 theme does not vouch for the 1.x side.
	return h(
		"p",
		{ class: "message warn" },
		older,
		"The pictures could not be checked against the theme files this report compared, so they can differ from what the results say.",
	);
}

function renderPage(): void {
	const name = decodeURIComponent(location.hash.slice(1)) || shared[0] || names[0] || "";
	for (const a of nav.querySelectorAll("a")) {
		if (a.dataset.name === name) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	}
	const entry = data.components[name];
	const all = capturesOf(name);
	const own = all.filter((f) => f.component === name);
	const status = (surface: string) =>
		rowState(name, surface, all, data.compare, data.touched)?.state.status;
	const places = (entry?.surfaces ?? []).toSorted(bySurface);
	// Places that differ come first; the sort is stable, so the rest keep their order.
	const rows = places
		.filter((s) => status(s) !== undefined)
		.toSorted((a, b) => Number(status(b) === "different") - Number(status(a) === "different"));
	const bare = places.filter((s) => status(s) === undefined);
	const ready = data.appCss && data.cmCss;

	const parts: Child[] = [
		h(
			"header",
			{ class: "top" },
			h(
				"div",
				{},
				h("h1", {}, name),
				h("p", {}, counts(name, places.length)),
				h("p", { class: "report" }, reportLine()),
			),
			modeSwitch(),
		),
		reportNotice(),
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
				...rows.map((s) => surfaceRow(name, s, all)),
			),
		bare.length > 0 &&
			h(
				"p",
				{ class: "also" },
				`Also used in: ${bare.map(surfaceName).join(", ")}. No capture there yet.`,
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
