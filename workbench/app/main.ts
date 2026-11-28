/// <reference types="vite/client" />
import {
	type Change,
	changedIn,
	insidePictures,
	type PageSummary,
	type PlaceVerdict,
	pageSummary,
	rowState,
	stateFor,
	unchecked,
} from "./compare-states.ts";
import { latest } from "./latest.ts";
import type { Results } from "./results.ts";
import type { SideChoice } from "./sides.ts";
import type { CompareState, Fixture, ResolvedSide, ViewerData, Which } from "./types.ts";
import { bySurface, kinds, plainReason, surfaceName } from "./words.ts";

type Mode = Which | "both";
type Status = CompareState["status"];
type Child = Node | string | false | null | undefined;
type Rect = [number, number, number, number];

const MODES: [Mode, string][] = [
	["left", "Left"],
	["right", "Right"],
	["both", "Side by side"],
];
/**
 * What a dot or a badge shows: one of the three verdicts, or "unchecked" when nothing was checked
 * with the two sides on screen. That last one is a way of showing, not a fourth verdict.
 */
type Shown = Status | "unchecked";
// Worst first, in the short words the counts use.
const STATES: [Shown, string][] = [
	["different", "Differs"],
	["not-proven", "Not proven"],
	["unchecked", "Not checked"],
	["same", "Same"],
];
const LABEL: Record<Shown, string> = {
	different: "Differs",
	"not-proven": "Not proven",
	unchecked: "Not checked with these sides",
	same: "Same",
};
// Pictures shown for one place before the rest wait behind "Show all".
const MAX_SHOWN = 4;
// The desktop window size the fixtures were captured at (capture/scripts/obsidian.ts).
const DESKTOP: [number, number] = [1600, 1000];
// Room around the shown element, and the least a crop shows, so small things keep some context.
const PAD = 16;
// Less room above and below, so the crop does not show slices of the neighboring lines.
const PAD_Y = 6;
const MIN_W = 320;
const GAP = 8;
// How many captures to try when looking for one that shows a state for the standard look.
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
// --- The two sides -----------------------------------------------------------------------

function stored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function store(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private windows: the choice just doesn't persist.
	}
}

const WHICH: Which[] = ["left", "right"];
// What each side is pointed at. Out of the box: the released 1.x beside the current build.
const DEFAULT_CHOICES: Record<Which, SideChoice> = {
	left: { kind: "release" },
	right: { kind: "build" },
};
let choices: Record<Which, SideChoice> = DEFAULT_CHOICES;
try {
	const saved = JSON.parse(stored("mw-viewer-sides") ?? "null") as Record<Which, SideChoice> | null;
	if (saved?.left?.kind && saved.right?.kind) choices = saved;
} catch {
	// A broken saved value: start from the defaults.
}

/** Asks the server what each side points at now: a name and the hash of its CSS, or an error. */
async function resolveSides(): Promise<Record<Which, ResolvedSide>> {
	const res = await fetch("/api/sides", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(choices),
	});
	return (await res.json()) as Record<Which, ResolvedSide>;
}
let sides = await resolveSides();
const shaOf = (side: ResolvedSide) => ("sha256" in side ? side.sha256 : undefined);
const hashOf = (which: Which) => shaOf(sides[which]);
const labelOf = (which: Which) => {
	const side = sides[which];
	return "label" in side ? side.label : which === "left" ? "Left" : "Right";
};

/**
 * What is on record for the two sides now shown: each capture's result from a check made with
 * exactly this CSS on both sides. Captures never checked with these sides have no entry.
 */
async function fetchResults(of: Record<Which, ResolvedSide>): Promise<Results | null> {
	const [before, after] = [shaOf(of.left), shaOf(of.right)];
	if (!before || !after) return null;
	return (await (
		await fetch(`/api/results?before=${before}&after=${after}`)
	).json()) as Results | null;
}
const none = { generated: "", compare: null, touched: {}, changes: {}, diffs: {} };
let live: Omit<Results, "compare"> & { compare: Results["compare"] | null } =
	(await fetchResults(sides)) ?? none;

/** A component's places counted by verdict: the page header and the sidebar dot both use this. */
const summaryOf = (name: string) =>
	pageSummary(
		name,
		data.components[name]?.surfaces ?? [],
		capturesOf(name),
		live.compare,
		live.touched,
	);
/**
 * A shared build component (a mixin in src/components/) has no captures of its own: its dot is
 * the worst of the items it is used on.
 */
function summarize(): Map<string, PageSummary> {
	const all = new Map(names.map((n) => [n, summaryOf(n)]));
	for (const name of buildOnly) {
		const used = (data.componentItems[name] ?? []).flatMap((n) => all.get(n)?.worst ?? []);
		all.set(name, {
			same: 0,
			different: 0,
			"not-proven": 0,
			unchecked: 0,
			noCapture: 0,
			worst: STATES.find(([status]) => used.includes(status))?.[0],
		});
	}
	return all;
}
let summaries = summarize();

const newest = latest();
/**
 * Re-reads what each side points at and the results for exactly those two sides, and puts both
 * on the page together. An answer that comes back after a newer request started is dropped whole
 * (null): sides and results on screen always belong to the same request. Otherwise returns what
 * was on screen before.
 */
async function load(): Promise<{ hashes: Record<Which, string | undefined>; had: boolean } | null> {
	const loaded = await newest(async () => {
		const next = await resolveSides();
		return { next, results: await fetchResults(next) };
	});
	if (!loaded) return null;
	const was = {
		hashes: { left: hashOf("left"), right: hashOf("right") },
		had: live.compare !== null,
	};
	sides = loaded.value.next;
	live = loaded.value.results ?? none;
	summaries = summarize();
	return was;
}

/** Why something is not proven, in plain words. */
const why = plainReason;

let mode: Mode = MODES.find(([m]) => m === stored("mw-viewer-view"))?.[0] ?? "both";

// --- Navigation ---------------------------------------------------------------------------

// Items styled from more than one place in src/, with the files: the organization check's list.
const overlapFiles = new Map(data.organization.overlaps.map((o) => [o.item, o.files]));

function navLink(name: string): HTMLElement {
	const worst = summaries.get(name)?.worst;
	const files = overlapFiles.get(name);
	return h(
		"a",
		{ href: `#${name}`, "data-name": name },
		h("span", { class: "nav-name" }, name),
		files &&
			h(
				"span",
				{ class: "overlap", title: `Styled in more than one place:\n${files.join("\n")}` },
				"move",
			),
		worst && h("span", { class: `dot ${worst}`, title: LABEL[worst] }),
	);
}

/** "sections/file-explorer" → "File explorer"; "pdf" → "PDF". */
function sectionName(id: string): string {
	const name = (id.split("/").pop() ?? id).replaceAll("-", " ");
	return name.length <= 3 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
}

/** A collapsed section: its name, its worst state and plain counts, and its content when opened. */
function sectionFold(label: string, items: string[], ...content: Child[]): HTMLElement {
	const all = items.flatMap((n) => summaries.get(n) ?? []);
	const count = (status: Shown) => all.filter((s) => s.worst === status).length;
	const worst = STATES.find(([status]) => count(status) > 0)?.[0];
	const counts = STATES.toReversed()
		.filter(([status]) => count(status) > 0)
		.map(
			([status, name]) =>
				`${count(status)} ${status === "different" ? "differ" : name.toLowerCase()}`,
		)
		.join(", ");
	return h(
		"details",
		{ class: "section" },
		h(
			"summary",
			{},
			// The dot stays beside the name when the counts move to a line of their own.
			h(
				"span",
				{ class: "section-head" },
				h("span", { class: "section-name" }, label),
				worst && h("span", { class: `dot ${worst}`, title: LABEL[worst] }),
			),
			h(
				"span",
				{ class: "section-counts" },
				counts ||
					(items.length === 0
						? "no items yet"
						: `${items.length} ${items.length === 1 ? "item" : "items"}`),
			),
		),
		...content,
	);
}

/** The files of one section, each with the items it styles. */
const groups = (list: { file: string; items: string[] }[]) =>
	list.map((g) =>
		h(
			"div",
			{ class: "group" },
			g.file && h("h3", {}, g.file.split("/").pop() ?? g.file),
			...g.items.map((n) => navLink(n)),
			// The file is in the source tree, and no captured item is styled from it yet.
			g.items.length === 0 && h("p", { class: "empty" }, "no items yet"),
		),
	);

/** What the dots mean, with how many components sit in each state. */
function legend(): HTMLElement {
	return h(
		"ul",
		{ class: "legend", "aria-label": "Left against right, by component" },
		h("li", { class: "legend-title" }, `${names.length} items:`),
		...STATES.toReversed().map(([status, label]) => {
			const n = names.filter((name) => summaries.get(name)?.worst === status).length;
			// "Not checked" is listed only when something is.
			return (
				(status !== "unchecked" || n > 0) &&
				h(
					"li",
					{},
					h("span", { class: `dot ${status}` }),
					`${n} ${status === "different" ? "differ" : label.toLowerCase()}`,
				)
			);
		}),
	);
}

/** Opens the sections that hold a link matching `show`, and closes the rest. */
function openSections(show: (a: HTMLAnchorElement) => boolean): void {
	for (const section of nav.querySelectorAll<HTMLDetailsElement>("details.section")) {
		section.open = [...section.querySelectorAll("a")].some(show);
	}
}

/**
 * The sidebar mirrors the theme's source: one collapsed section per source folder, and inside it
 * the items each file styles. Everything starts closed except the section of the page on screen.
 */
function renderNav(): void {
	const { sections } = data.organization;
	const itemsOf = (list: { items: string[] }[]) => list.flatMap((g) => g.items);
	const top = (id: string) => sections.find((s) => s.id === id)?.groups ?? [];
	const apps = sections.filter((s) => s.id.startsWith("sections/"));
	// Items no source file styles on their own, by where they are used.
	const rest = Map.groupBy(
		itemsOf(top("other")),
		(n) => data.components[n]?.surfaces[0] ?? "other",
	);
	const filter = h("input", {
		type: "search",
		placeholder: "Filter items",
		"aria-label": "Filter items",
		spellcheck: "false",
	}) as HTMLInputElement;
	filter.addEventListener("input", () => {
		const q = filter.value.trim().toLowerCase();
		// While filtering, files and sections with no match are hidden (style.css).
		nav.classList.toggle("filtering", q !== "");
		for (const a of nav.querySelectorAll("a")) a.hidden = !a.dataset.name?.includes(q);
		// A search opens the sections with a match; clearing it closes all but the current one.
		openSections((a) => (q ? !a.hidden : a.getAttribute("aria-current") === "page"));
	});
	const parts: Child[] = [
		h(
			"div",
			{ class: "nav-top" },
			h("div", { class: "brand" }, "Miami Wind workbench"),
			filter,
			legend(),
			untiedCount() > 0 &&
				h(
					"a",
					{ href: `#${UNTIED}`, "data-name": UNTIED, class: "untied" },
					h("span", { class: "nav-name" }, "Changes not tied to a component"),
					h("span", { class: "nav-count" }, String(untiedCount())),
				),
		),
		sectionFold("Global", itemsOf(top("global")), ...groups(top("global"))),
		sectionFold("Markdown", itemsOf(top("markdown")), ...groups(top("markdown"))),
		sectionFold(
			"Sections",
			apps.flatMap((s) => itemsOf(s.groups)),
			...apps.map((s) => sectionFold(sectionName(s.id), itemsOf(s.groups), ...groups(s.groups))),
		),
		buildOnly.length > 0 &&
			sectionFold(
				"Components",
				buildOnly,
				h("div", { class: "group" }, ...buildOnly.map((n) => navLink(n))),
			),
		sectionFold(
			"Obsidian's own (no theme rule)",
			itemsOf(top("other")),
			...[...rest.keys()]
				.sort(bySurface)
				.map((surface) =>
					sectionFold(
						surfaceName(surface),
						rest.get(surface) ?? [],
						h("div", { class: "group" }, ...(rest.get(surface) ?? []).map((n) => navLink(n))),
					),
				),
		),
	];
	nav.replaceChildren(...parts.filter((c): c is Node | string => Boolean(c)));
}

// --- Fixture frames -----------------------------------------------------------------------

// Pictures load a few at a time, and only while they are on screen. Each one is a whole Obsidian
// window; loading hundreds at once locks the page, and one that is off screen never finishes
// drawing (the browser pauses it), so it would only hold the others up.
const MAX_LOADING = 3;
const waiting: HTMLIFrameElement[] = [];
const loading = new Set<HTMLIFrameElement>();
function finished(frame: HTMLIFrameElement): void {
	if (loading.delete(frame)) pump();
}
function pump(): void {
	// A picture taken off the page while loading (another capture is tried in its place) will
	// never answer: its turn is over.
	for (const frame of loading) if (!frame.isConnected) loading.delete(frame);
	while (loading.size < MAX_LOADING) {
		const frame = waiting.shift();
		if (!frame) return;
		const crop = frame.parentElement;
		if (!frame.isConnected || !frame.dataset.src || !crop) continue;
		loading.add(frame);
		lazy.unobserve(crop);
		frame.src = frame.dataset.src;
		// One that never answers must not hold up the rest, and its box says so.
		setTimeout(() => {
			if (!loading.has(frame)) return;
			crop.dataset.note = "No picture: this capture did not finish drawing.";
			finished(frame);
		}, 8000);
	}
}
const lazy = new IntersectionObserver((entries) => {
	for (const e of entries) {
		const frame = e.target.querySelector("iframe");
		if (!frame || frame.getAttribute("src")) continue;
		const at = waiting.indexOf(frame);
		// A picture being tried in place of another goes first: its row is already waiting.
		if (e.isIntersecting && at === -1) {
			if (frame.dataset.first) waiting.unshift(frame);
			else waiting.push(frame);
		}
		if (!e.isIntersecting && at !== -1) waiting.splice(at, 1);
	}
	pump();
});

/** One fixture under one theme, cropped to the shown element once the frame reports it. */
const frameUrl = (sha: string, id: string, focus?: string) =>
	`${data.frameOrigin}/frame/${sha}/${encodeURIComponent(id)}${focus ? `?focus=${encodeURIComponent(focus)}` : ""}`;

function shot(f: Fixture, which: Which, label: boolean, focus?: string): HTMLElement {
	const sha = hashOf(which);
	const name = h("span", { class: "shot-label" }, labelOf(which));
	// A side that cannot be read has no picture; its picker says why.
	if (!sha)
		return h(
			"div",
			{ class: "shot" },
			label && name,
			h("p", { class: "aside" }, "Nothing to show for this side."),
		);
	const frame = h("iframe", {
		"data-src": frameUrl(sha, f.id, focus),
		"data-side": which,
		"data-fixture": f.id,
		"data-focus": focus ?? "",
		title: `${f.id} (${labelOf(which)})`,
		// Captured markup is untrusted. The frame is served from its own address, so "same origin"
		// here means that address, never the workbench's; only the replay script may run in it.
		sandbox: "allow-scripts allow-same-origin",
		width: String((f.viewport ?? DESKTOP)[0]),
		height: String((f.viewport ?? DESKTOP)[1]),
		tabindex: "-1",
	});
	const crop = h("div", { class: "crop", "data-note": "Loading picture…" }, frame);
	lazy.observe(crop);
	return h("div", { class: "shot" }, label && name, crop);
}

/** Per crop: the box the frame reported. Per figure: what to do when its component is not found. */
const rects = new WeakMap<Element, Rect>();
/** Per crop: the left edge and width of the line or block around a small element. */
const arounds = new WeakMap<Element, [number, number]>();
// A surrounding line is shown whole when it is no wider than this; wider ones are cut around the item.
const MAX_AROUND = 760;
const onMissing = new WeakMap<Element, () => void>();

/** A span of at least `min` around [start, start + size], kept inside [0, limit]. */
function span(
	start: number,
	size: number,
	min: number,
	limit: number,
	pad = PAD,
): [number, number] {
	const length = Math.min(limit, Math.max(size + 2 * pad, min));
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
		const [top, height] = span(r[1], r[3], 0, Number(frame.height), PAD_Y);
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
	if (!frame || !crop || !figure) return;
	finished(frame);
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
	// Not found or not visible. For a picture picked from several, the first side decides whether to try another.
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
	// A long value (a font list) is cut short on the page and kept whole on hover.
	const text = v ?? "none";
	return text.length > 48
		? h("code", { title: text }, `${text.slice(0, 46)}…`)
		: h("code", {}, text);
}

/** One change in plain words: what changed, from what to what, and on which item. */
function changeLine(c: Change, component: string): HTMLElement {
	// Which item changed, relative to the component this page is about.
	// A change on the component itself needs no "on the …": the page is about it.
	const where = c.components.includes(component)
		? ""
		: c.maybe.includes(component)
			? ` on ${c.items} (can't tell if this is the ${component})`
			: ` on ${c.items}`;
	return h(
		"li",
		{ title: `${c.code.join(", ")}\n${c.properties.join(", ")}\n${c.before} → ${c.after}` },
		`${c.what}: `,
		value(c.before),
		" → ",
		value(c.after),
		where,
	);
}

/** A change no component can claim: it sits on items that are surely none of them. */
const untied = (c: Change) => c.components.length === 0;
// Those changes get a page of their own, so that judging each component by its own items hides nothing.
const UNTIED = "~untied";
const untiedCaptures = () => data.fixtures.filter((f) => live.changes[f.id]?.list.some(untied));
const untiedCount = () =>
	untiedCaptures().reduce((n, f) => n + (live.changes[f.id]?.list.filter(untied).length ?? 0), 0);

/** What differs in a capture, in plain words: the first few changes, the rest behind a click. */
function whatDiffers(
	f: Fixture,
	component: string,
	only?: (c: Change) => boolean,
): HTMLElement | false {
	const all = live.changes[f.id];
	if (!all) return false;
	const list = only ? all.list.filter(only) : all.list;
	// A filtered list is complete as shown; the full one may have been cut by the server.
	const found = { ...all, list, total: only ? list.length : all.total };
	if (list.length === 0) return false;
	const line = (c: Change) => changeLine(c, component);
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
		if (more.length) details.append(h("ul", {}, ...more.map(line)));
		if (picture) {
			details.append(picture);
			// Fetched only when opened: these are full-window pictures.
			details.addEventListener(
				"toggle",
				() =>
					picture.setAttribute(
						"src",
						`/diff/${hashOf("left")}/${hashOf("right")}/${encodeURIComponent(f.id)}`,
					),
				{ once: true },
			);
		}
	}
	return h(
		"div",
		{ class: "differs" },
		h("ul", {}, ...found.list.slice(0, MAX_CHANGES).map(line)),
		details,
	);
}

/** A capture's verdict under its picture: the state, then each reason on its own line. */
function verdictLines(verdict: CompareState): HTMLElement | false {
	if (verdict.status === "same") return false;
	if (unchecked(verdict)) {
		// With nothing checked at all, the notice at the top says so once; here it would repeat
		// under every picture. With some captures checked, it says which ones are not.
		return (
			live.compare !== null &&
			h("ul", { class: "reasons verdict unchecked" }, h("li", {}, LABEL.unchecked))
		);
	}
	const reasons = verdict.status === "not-proven" ? verdict.reasons.map(why) : [];
	return h(
		"ul",
		{ class: `reasons verdict ${verdict.status}` },
		...(reasons.length ? reasons : [""]).map((r, i) =>
			h("li", {}, i === 0 ? `${LABEL[verdict.status]}${r ? `: ${r}` : ""}` : r),
		),
	);
}

/**
 * One capture with its pictures. `focus` names the component to crop to when the fixture captured
 * something larger around it; the verdict shown is always about that component.
 */
function capture(f: Fixture, focus?: string, only?: (c: Change) => boolean): HTMLElement {
	const themes: Which[] = mode === "both" ? WHICH : [mode];
	const component = focus ?? f.component;
	// A larger capture previewed for another component: the row above already gives the verdict.
	const around = f.component !== component;
	// Unless that larger capture differs on this very component: then it says so.
	const verdict =
		around && !changedIn(component, f, live.compare, live.touched)
			? undefined
			: stateFor(component, f.id, live.compare, live.touched);
	return h(
		"figure",
		{ class: "capture" },
		h("div", { class: "shots" }, ...themes.map((t) => shot(f, t, mode === "both", focus))),
		h(
			"figcaption",
			// The capture's own name is for looking it up, not for reading: it shows on hover.
			{
				title: [`Capture: ${f.id}`, around && `A capture of ${f.component}`, f.note]
					.filter(Boolean)
					.join("\n"),
			},
			h("span", { class: f.state === "default" ? "state" : "state forced" }, f.state),
		),
		verdict && verdictLines(verdict),
		whatDiffers(f, component, only),
	);
}

/**
 * The first of `candidates` in which the component is really found and visible, tried one at a
 * time as the frames report back. When none qualifies, `none()` takes its place. This picks a
 * picture only; verdicts never depend on it.
 */
function firstShowing(
	candidates: Fixture[],
	focus: string,
	none?: () => Node,
	retry = false,
): Node {
	const [f, ...rest] = candidates;
	if (!f) return none?.() ?? document.createComment("no capture shows this state");
	const figure = capture(f, focus);
	// A second try takes the place of a picture the reader is already waiting for: it loads first.
	if (retry) for (const frame of figure.querySelectorAll("iframe")) frame.dataset.first = "1";
	onMissing.set(figure, () => {
		const section = figure.closest("section");
		figure.replaceWith(firstShowing(rest, focus, none, true));
		// A "Standard look" left with nothing to show goes away.
		if (section?.classList.contains("shared") && !section.querySelector("figure")) section.remove();
	});
	return figure;
}

/** The first few of a place's pictures; the rest are made only when asked for. */
function limited(makers: (() => Node)[], max = MAX_SHOWN): Node[] {
	const rest = makers.slice(max);
	const first = makers.slice(0, max).map((make) => make());
	if (rest.length === 0) return first;
	const all = h("button", { type: "button", class: "show-all" }, `Show all ${makers.length}`);
	all.addEventListener("click", () => all.replaceWith(...rest.map((make) => make())));
	return [...first, all];
}

// --- Component page -----------------------------------------------------------------------

const bySize = (a: Fixture, b: Fixture) => a.size - b.size;

/** A list that stays folded until asked for. */
function fold(summary: string, ...content: Child[]): HTMLElement {
	return h("details", {}, h("summary", {}, summary), ...content);
}

/** How this place departs from the component's standard look (component-diffs.json), in one line. */
function sharedLookLine(component: string, surface: string): HTMLElement | false {
	const all = Object.values(live.diffs?.[component] ?? {});
	// Styled differently in every place means there is no standard to differ from: say nothing.
	if (all.length > 1 && all.every((x) => !x.same)) return false;
	const d = live.diffs?.[component]?.[surface];
	// Nothing to say when it matches. This is about the component across places, not left against right.
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
	if (place.state.status !== "not-proven") return false;
	return h(
		"ul",
		{ class: "reason" },
		...place.reasons.map(([reason, n]) =>
			h(
				"li",
				{},
				place.captures === 1 ? why(reason) : `${n} of ${place.captures} captures: ${why(reason)}`,
			),
		),
	);
}

/** One place: its verdict from the data, and the captures (or one close-up) that show it. */
function surfaceRow(component: string, surface: string, all: Fixture[]): HTMLElement {
	const here = all.filter((f) => f.surface === surface);
	const place = rowState(component, surface, all, live.compare, live.touched);
	const status = place?.state.status ?? "not-proven";
	const shownAs: Shown = !place || unchecked(place.state) ? "unchecked" : status;
	const captures = h("div", { class: "captures" });
	const row = h(
		"section",
		{ class: "surface" },
		h(
			"header",
			{},
			h("h3", {}, surfaceName(surface)),
			h(
				"span",
				{ class: `badge ${shownAs}` },
				shownAs === "unchecked" ? LABEL.unchecked : `Left vs right: ${LABEL[status]}`,
			),
			place?.inside &&
				h(
					"p",
					{ class: "reason" },
					`There is no capture of the ${component} alone here. It is checked inside ${here.length === 1 ? "one capture of something larger" : `${here.length} captures of larger things`}.`,
				),
			place && shownAs !== "unchecked" && reasonLines(place),
			sharedLookLine(component, surface),
		),
		captures,
	);
	// The component's own captures; failing that, one close-up from a larger capture. With no
	// close-up to show, the row shrinks to a single line. Either way, every larger capture that
	// differs on this item itself is shown, with only those changes: none is left to a stand-in.
	const { changed, rest } = insidePictures(component, here, live.compare, live.touched);
	const changedPictures = changed.map(
		(f) => () => capture(f, component, (c) => c.components.includes(component)),
	);
	// Captures that differ come first, so "Show all" never hides a change.
	const differsFirst = (a: Fixture, b: Fixture) =>
		Number(live.compare?.[b.id]?.status === "different") -
		Number(live.compare?.[a.id]?.status === "different");
	captures.append(
		...(place?.inside
			? [
					...limited(changedPictures),
					firstShowing(rest.toSorted(bySize).slice(0, MAX_TRIES), component, () => {
						if (changed.length > 0) return document.createComment("the changes are shown");
						row.classList.add("bare");
						return h(
							"p",
							{ class: "reason" },
							`No picture: the ${component} is hidden or covered in these captures.`,
						);
					}),
				]
			: limited([
					...changedPictures,
					...here
						.filter((f) => f.component === component)
						.toSorted(differsFirst)
						.map((f) => () => capture(f)),
				])),
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
		h("h2", {}, "Standard look"),
		h(
			"div",
			{ class: "captures" },
			...limited(
				order.map((s) => () => firstShowing((states.get(s) ?? []).slice(0, MAX_TRIES), component)),
				6,
			),
		),
	);
}

/**
 * Where a shared build component (a mixin in src/components/) is used: the items its rules
 * style, each with its own state, and the source files that include it.
 */
function usedOn(component: string): HTMLElement | false {
	const u = usage.get(component);
	if (!u || data.components[component]) return false;
	const items = data.componentItems[component] ?? [];
	// The build names each file without its folder; the source tree knows where it is.
	const paths = data.organization.sections.flatMap((s) => s.groups.map((g) => g.file));
	const files = [...new Set(u.usages.map((x) => x.surface))]
		.sort()
		.map((file) => `src/${paths.find((p) => p.endsWith(`/${file}`)) ?? file}`);
	return h(
		"section",
		{ class: "used-on" },
		h("h2", {}, "Used on"),
		items.length === 0
			? h("p", { class: "also" }, "No captured item is styled with it yet.")
			: h(
					"ul",
					{ class: "used" },
					...items.map((item) => {
						const worst = summaries.get(item)?.worst;
						return h(
							"li",
							{},
							h(
								"a",
								{ href: `#${item}` },
								worst && h("span", { class: `dot ${worst}`, title: LABEL[worst] }),
								item,
							),
							h(
								"span",
								{ class: "aside" },
								counts(item, data.components[item]?.surfaces.length ?? 0),
							),
						);
					}),
				),
		h("p", { class: "also" }, `Included from: ${files.join(", ")}.`),
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
		{ class: "switch", role: "group", "aria-label": "View" },
		...MODES.map(([m, label]) => {
			const b = h("button", { type: "button", "aria-pressed": String(m === mode) }, label);
			b.addEventListener("click", () => {
				mode = m;
				store("mw-viewer-view", m);
				renderPage();
			});
			return b;
		}),
	);
}

/** "21 places: 14 same, 0 differ, 4 not proven, 3 no capture". */
function counts(name: string, places: number): string {
	const s = summaries.get(name);
	if (!s) return "";
	const count = `${places} ${places === 1 ? "place" : "places"}`;
	// Nothing checked with these sides: say that once, not three zeros.
	if (s.unchecked > 0 && s.same + s.different + s["not-proven"] === 0) {
		return `${count}, not checked with these sides`;
	}
	const parts = [
		`${s.same} same`,
		`${s.different} differ`,
		`${s["not-proven"]} not proven`,
		s.unchecked > 0 && `${s.unchecked} not checked`,
		s.noCapture > 0 && `${s.noCapture} no capture`,
	];
	return `${places} ${places === 1 ? "place" : "places"}: ${parts.filter(Boolean).join(", ")}`;
}

// The kinds of side a picker offers, in plain words.
const KINDS: [SideChoice["kind"], string][] = [
	["default", "Default Obsidian"],
	["release", "Miami Wind 1.x (released)"],
	["build", "Current build (theme.css)"],
	["git", "Miami Wind version…"],
	["path", "Folder or file…"],
];

/** Points both sides at the current choices, then redraws everything that depends on them. */
async function applySides(): Promise<void> {
	store("mw-viewer-sides", JSON.stringify(choices));
	if (!(await load())) return;
	renderNav();
	renderPage();
}

/** One side's picker: what kind of thing it shows, and which version or path when that applies. */
function sidePicker(which: Which): HTMLElement {
	const choice = choices[which];
	const side = sides[which];
	const kind = h(
		"select",
		{ "aria-label": `${which === "left" ? "Left" : "Right"} side` },
		...KINDS.map(([value, label]) =>
			h("option", value === choice.kind ? { value, selected: "" } : { value }, label),
		),
	) as HTMLSelectElement;
	const detail = h("input", {
		type: "text",
		spellcheck: "false",
		"aria-label":
			choice.kind === "git"
				? "Version: a tag or commit"
				: "Full path to a theme folder or .css file",
		placeholder:
			choice.kind === "git"
				? "tag or commit, for example 1.2.1"
				: "/full/path/to/theme folder or .css file",
		value: choice.kind === "git" ? choice.ref : choice.kind === "path" ? choice.path : "",
	}) as HTMLInputElement;
	const set = (next: SideChoice) => {
		choices = { ...choices, [which]: next };
		void applySides();
	};
	kind.addEventListener("change", () => {
		const k = kind.value as SideChoice["kind"];
		// A version or a path still has to be typed: show the box first, apply when it is filled in.
		if (k === "git") choices = { ...choices, [which]: { kind: k, ref: "" } };
		else if (k === "path") choices = { ...choices, [which]: { kind: k, path: "" } };
		else return set({ kind: k });
		renderPage();
		main.querySelector<HTMLInputElement>(`.side.${which} input`)?.focus();
	});
	detail.addEventListener("change", () => {
		const text = detail.value.trim();
		if (choice.kind === "git") set({ kind: "git", ref: text });
		if (choice.kind === "path") set({ kind: "path", path: text });
	});
	const typed = choice.kind === "git" || choice.kind === "path";
	const empty = (choice.kind === "git" && !choice.ref) || (choice.kind === "path" && !choice.path);
	return h(
		"div",
		{ class: `side ${which}` },
		h("span", { class: "side-name" }, which === "left" ? "Left" : "Right"),
		kind,
		typed && detail,
		"error" in side && !empty && h("p", { class: "side-error" }, side.error),
	);
}

/** "Checked Miami Wind 1.x against Current build, Nov 25, 2026." Shown only for a report of these sides. */
function reportLine(): string | false {
	if (!live.compare) return false;
	const date = new Date(live.generated).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	const checked = data.fixtures.filter((f) => live.compare?.[f.id]).length;
	const part =
		checked < data.fixtures.length
			? ` ${checked.toLocaleString("en-US")} of ${data.fixtures.length.toLocaleString("en-US")} captures are checked.`
			: "";
	return `Checked ${labelOf("left")} against ${labelOf("right")}, last on ${date}.${part}`;
}

/** Starts a compare run on the two sides shown, for one component or for everything. */
async function recheck(component?: string): Promise<void> {
	await fetch("/api/recheck", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ left: hashOf("left"), right: hashOf("right"), component }),
	});
	void watchRecheck();
}

// The component page on screen, for the notice to offer a re-check of just that component.
let shown: string | undefined;
// A run in progress, as last heard from the server.
let checking: { running: boolean; code: number | null; log: string } | undefined;
/** Follows a compare run until it ends. A finished run rewrites the report, which reloads the page. */
async function watchRecheck(): Promise<void> {
	checking = (await (await fetch("/api/recheck")).json()) as typeof checking;
	const slot = document.querySelector(".recheck");
	if (slot) slot.replaceWith(recheckNotice(shown) || "");
	if (checking?.running) setTimeout(() => void watchRecheck(), 1500);
}

/**
 * When the results on hand were not made with the CSS now shown: say so, and offer to check again.
 * While a check runs, show how far it is.
 */
function recheckNotice(component?: string): HTMLElement | false {
	if (checking?.running) {
		const progress = checking.log
			.trim()
			.split("\n")
			.findLast((line) => /\d+\/\d+ checked/.test(line));
		return h("p", { class: "message recheck" }, `Checking… ${progress ?? "starting"}`);
	}
	// 0 same, 1 differences, 2 not proven: all normal ends. Anything else is a failed run.
	if (checking && checking.code !== null && checking.code > 2) {
		return h(
			"p",
			{ class: "message warn recheck" },
			`The check failed. ${checking.log.trim().split("\n").slice(-2).join(" ")}`,
		);
	}
	if (!hashOf("left") || !hashOf("right")) return false;
	// Captures on this page with no result made with these two sides.
	const here = component !== undefined && component in data.components ? capturesOf(component) : [];
	const unchecked = here.filter((f) => !live.compare?.[f.id]).length;
	if (live.compare && unchecked === 0) return false;
	const button = (label: string, name?: string) => {
		const b = h("button", { type: "button" }, label);
		b.addEventListener("click", () => void recheck(name));
		return b;
	};
	return h(
		"div",
		{ class: "message warn recheck" },
		h(
			"p",
			{},
			live.compare
				? `${unchecked} of ${here.length} captures here have not been checked with these two sides.`
				: "Not checked with these two sides yet, so no result is shown.",
		),
		h(
			"div",
			{ class: "actions" },
			component !== undefined &&
				component in data.components &&
				button(`Re-check ${component}`, component),
			button("Re-check everything (about 35 minutes)"),
		),
	);
}

/** Every change that sits on no component's own items, each with the capture it is in. */
function renderUntied(): void {
	main.replaceChildren(
		h(
			"header",
			{ class: "top" },
			h(
				"div",
				{},
				h("h1", {}, "Changes not tied to a component"),
				h(
					"p",
					{},
					`${untiedCount()} ${untiedCount() === 1 ? "change" : "changes"} in ${untiedCaptures().length} ${untiedCaptures().length === 1 ? "capture" : "captures"}, on items that belong to no component the workbench knows.`,
				),
				h("p", { class: "report" }, reportLine()),
			),
			modeSwitch(),
		),
		h("div", { class: "sides" }, sidePicker("left"), sidePicker("right")),
		...[recheckNotice()].filter((n): n is HTMLElement => Boolean(n)),
		h(
			"section",
			{},
			...untiedCaptures().map((f) =>
				h(
					"section",
					{ class: "surface" },
					h(
						"header",
						{},
						h("h3", {}, h("a", { href: `#${f.component}` }, f.component)),
						h("p", { class: "reason" }, surfaceName(f.surface)),
					),
					h("div", { class: "captures" }, capture(f, undefined, untied)),
				),
			),
		),
	);
	main.scrollTop = 0;
}

function renderPage(): void {
	const name = decodeURIComponent(location.hash.slice(1)) || shared[0] || names[0] || "";
	for (const a of nav.querySelectorAll("a")) {
		if (a.dataset.name === name) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	}
	// The section holding this page opens; sections opened by hand stay as they are.
	for (
		let up = nav.querySelector('[aria-current="page"]')?.closest("details");
		up;
		up = up.parentElement?.closest("details")
	) {
		up.open = true;
	}
	// Pictures of the page being left no longer wait their turn.
	waiting.length = 0;
	loading.clear();
	if (name === UNTIED) {
		renderUntied();
		return;
	}
	shown = name;
	const entry = data.components[name];
	const all = capturesOf(name);
	const own = all.filter((f) => f.component === name);
	const status = (surface: string) =>
		rowState(name, surface, all, live.compare, live.touched)?.state.status;
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
				h(
					"p",
					{},
					entry
						? counts(name, places.length)
						: `A shared building block (src/components/${name}.css). It has no captures of its own; its state is the worst of the items it is used on${summaries.get(name)?.worst ? `: ${LABEL[summaries.get(name)?.worst ?? "same"]}` : ""}.`,
				),
				h("p", { class: "report" }, reportLine()),
			),
			modeSwitch(),
		),
		h("div", { class: "sides" }, sidePicker("left"), sidePicker("right")),
		overlapFiles.has(name) &&
			h(
				"div",
				{ class: "message warn" },
				h("p", {}, "Styled in more than one place: move to global/"),
				h(
					"ul",
					{ class: "props" },
					...(overlapFiles.get(name) ?? []).map((f) => h("li", {}, `src/${f}`)),
				),
			),
		recheckNotice(name),
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
		data.compareError && h("p", { class: "message warn" }, data.compareError),
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
		usedOn(name),
		usageTable(name),
	];
	main.replaceChildren(...parts.filter((c): c is Node | string => Boolean(c)));
	main.scrollTop = 0;
}

renderNav();
renderPage();
nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "center" });
addEventListener("hashchange", renderPage);
void watchRecheck();

// A theme file one side points at changed on disk: redraw that side's pictures in place.
import.meta.hot?.on("mw:side-changed", async () => {
	const was = await load();
	if (!was) return;
	const { hashes: before, had } = was;
	const changed = WHICH.filter((w) => hashOf(w) !== before[w]);
	if (changed.length === 0) return;
	if (had || live.compare !== null || changed.some((w) => !before[w] || !hashOf(w))) {
		// The results on screen were made with other CSS (or results exist for the new CSS):
		// everything is redrawn.
		renderNav();
		renderPage();
		return;
	}
	// No results either way: only the changed side's pictures need redrawing, in place.
	for (const which of changed) {
		const sha = hashOf(which);
		if (!sha) continue;
		for (const frame of document.querySelectorAll<HTMLIFrameElement>(
			`iframe[data-side="${which}"]`,
		)) {
			const url = frameUrl(sha, frame.dataset.fixture ?? "", frame.dataset.focus || undefined);
			frame.dataset.src = url;
			// Frames not yet scrolled into view pick the new address up when they load.
			if (frame.getAttribute("src")) frame.src = url;
		}
	}
});
