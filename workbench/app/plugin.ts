// The workbench's local server side, as a Vite plugin: the data for the page, the fixtures drawn
// with Obsidian's CSS plus one theme, and a reload when the built theme or the compare result changes.
//
// Nothing here sets or reads a cookie. The page and the fixture frames sit on two ports of one
// host, which keeps their DOM and storage apart but not host cookies, so no decision in this file
// may ever depend on one: requests are judged by their Origin, Host and content only.
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	statSync,
	unwatchFile,
	watch,
	watchFile,
	writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import Specificity from "@bramus/specificity";
import type { Plugin } from "vite";
import { replayCss } from "../../capture/scripts/css.ts";
import { COMPONENTS } from "../../capture/scripts/engine.ts";
import { type Addresses, addresses } from "./address.ts";
import { changes, compareStates } from "./compare-states.ts";
import { touchedComponents } from "./elements.ts";
import { type Focus, frameCsp, frameDocument, replayCall } from "./frame.ts";
import { type Valid, validator } from "./inputs.ts";
import { type FixtureResult, mergeRun, pairKey, resultsFor, type Store } from "./results.ts";
import { parseChoice, resolveSide, type Side, sha256 } from "./sides.ts";
import { componentItems, organization } from "./source.ts";
import type { CompareState, Diffs, ViewerData } from "./types.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

const paths = {
	app: `${ROOT}capture/.app/app.css`,
	diffs: `${ROOT}workbench/out/component-diffs.json`,
	compare: `${ROOT}workbench/out/compare.json`,
	fixtures: `${ROOT}capture/fixtures.json`,
	usage: `${ROOT}workbench/component-usage.json`,
};

// The highest specificity in a component's selector list.
const top = (selector: string) =>
	Specificity.calculate(selector).reduce((max, s) => (Specificity.compare(s, max) > 0 ? s : max));

/**
 * Selectors of more specific components. An element matching one of these belongs to that
 * component (a `button.clickable-icon` is a clickable icon), so it does not stand in for this one.
 */
function moreSpecific(component: string): string[] {
	const own = COMPONENTS[component];
	if (!own) return [];
	return Object.entries(COMPONENTS)
		.filter(([name, sel]) => name !== component && Specificity.compare(top(sel), top(own)) > 0)
		.map(([, sel]) => sel);
}

const json = (path: string): unknown =>
	existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;

/** What a compare.json says about itself. Older reports record none of this. */
export interface ReportMeta {
	generated?: string;
	themes?: { before?: { sha256?: string }; after?: { sha256?: string } };
	fixtures?: ReportFixture[];
}

const OUT = `${ROOT}workbench/out`;

// Every side resolved so far, by the hash of its CSS: the text to draw (states forced) and the
// text as it was read. Frames and re-checks work from these bytes, never from a path again.
const sheets = new Map<string, { raw: string }>();
const MAX_SHEETS = 24;
function remember(side: Side): void {
	if (!sheets.has(side.sha256)) {
		sheets.set(side.sha256, { raw: side.css });
		for (const old of [...sheets.keys()].slice(0, Math.max(0, sheets.size - MAX_SHEETS))) {
			sheets.delete(old);
		}
	}
}

/** The body of a small JSON request from the page. */
function body(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let text = "";
		req.on("data", (chunk: Buffer) => {
			text += chunk;
			if (text.length > 10_000) reject(new Error("Request too large."));
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(text));
			} catch {
				reject(new Error("Not JSON."));
			}
		});
		req.on("error", reject);
	});
}

// The one compare run this viewer may have going, started by the Re-check button.
let recheck: { proc: ChildProcess; log: string; done: boolean; code: number | null } | undefined;

/** The parts of a compare.json fixture the viewer shows beyond its verdict. */
interface ReportFixture {
	id: string;
	differences?: {
		element: string;
		property: string;
		before: string | null;
		after: string | null;
	}[];
	images?: { diff?: string };
	/** Every file the compare tool read for this capture, with the SHA-256 of the bytes it read. */
	inputs?: unknown;
}

export type FixtureIndex = Pick<ViewerData, "components"> & {
	fixtures: (ViewerData["fixtures"][number] & {
		/** File name under capture/fixtures; ".xhtml" for trees HTML text cannot hold. */
		file: string;
		/** Components found inside the capture. */
		contains: string[];
		format?: "xhtml";
		/** The rest is what capture's replay reads (see capture/scripts/types.ts). */
		viewport?: [number, number];
		quirks?: boolean;
		styles?: string[];
		runtimeStyles?: string[];
		trimSelector?: string;
		imageSizes?: { index: number; width: number; height: number; file?: string }[];
		/** Saved images that inline styles use, by the exact address written in the capture. */
		styleImages?: Record<string, string>;
		canvasPixels?: { index: number; frame?: string | null; file: string }[];
		evidence?: { box?: unknown };
	})[];
};

/**
 * What a compare report found for each of its captures, in the form the workbench keeps. A
 * capture is taken only with the inputs the compare tool recorded for it at read time, and only
 * when those files still have those bytes (`valid`): a report without them, a file changed since
 * it was read, or a file since deleted gives no result.
 */
export function entries(
	report: ReportMeta,
	index: FixtureIndex,
	states: Record<string, CompareState>,
	valid: Valid,
) {
	const byId = new Map(index.fixtures.map((f) => [f.id, f]));
	const contains = new Map(index.fixtures.map((f) => [f.id, [f.component, ...f.contains]]));
	// A component with no selector of its own (a whole view, the gutter) is its capture: every
	// change in that capture is a change to it.
	const ownWhole = (id: string) => {
		const component = byId.get(id)?.component;
		return component && !COMPONENTS[component] ? [component] : [];
	};
	const out: Record<string, Omit<FixtureResult, "generated">> = {};
	for (const f of report.fixtures ?? []) {
		const state = states[f.id];
		if (!state || !byId.has(f.id) || !valid(f.inputs)) continue;
		const differences = f.differences ?? [];
		// A component with no selector of its own is still told apart from the rest of its capture
		// where it can be: an element or class with the component's own name (hr, .gutter).
		const selectors = Object.fromEntries(
			(contains.get(f.id) ?? []).map((c) => [c, COMPONENTS[c] ?? `${c}, .${c}`]),
		);
		const found = differences.length ? changes(differences, selectors) : undefined;
		out[f.id] = {
			inputs: f.inputs as Record<string, string>,
			state,
			touched: differences.length
				? [
						...touchedComponents(differences, contains.get(f.id) ?? [], COMPONENTS),
						...ownWhole(f.id),
					]
				: [],
			changes: found && {
				...found,
				list: found.list.map((c) => ({
					...c,
					own: c.components,
					components: [...new Set([...c.components, ...ownWhole(f.id)])],
				})),
			},
			diffImage: Boolean(f.images?.diff) && existsSync(`${OUT}/diffs/${f.id}.diff.png`),
		};
	}
	return out;
}

const STORE = `${OUT}/results.json`;
/** Where a pair's saved diff pictures live: named by the start of both hashes. */
const pictures = (before: string, after: string) =>
	`${OUT}/results/${before.slice(0, 16)}-${after.slice(0, 16)}`;

let store: Store = (json(STORE) as Store | null) ?? { pairs: {} };
let ingested = 0;
let reportError: string | undefined;
/**
 * Takes the compare tool's latest report into the workbench's own record, once per report. The
 * report names the two themes it compared by hash; its results are filed under that pair and its
 * diff pictures are copied beside them, because the next run clears the compare tool's own.
 */
function ingest(index: FixtureIndex): void {
	if (!existsSync(paths.compare)) return;
	const mtime = statSync(paths.compare).mtimeMs;
	if (mtime === ingested) return;
	ingested = mtime;
	const report = json(paths.compare) as ReportMeta;
	const states = compareStates(report);
	const before = report.themes?.before?.sha256;
	const after = report.themes?.after?.sha256;
	reportError = typeof states === "string" ? states : undefined;
	// A report that does not say which themes it compared cannot be filed under any pair.
	if (typeof states === "string" || !before || !after) return;
	const valid = validator(ROOT);
	const found = entries(report, index, states, valid);
	const dir = pictures(before, after);
	mkdirSync(dir, { recursive: true });
	for (const [id, f] of Object.entries(found)) {
		if (f.diffImage) copyFileSync(`${OUT}/diffs/${id}.diff.png`, `${dir}/${id}.diff.png`);
	}
	store = mergeRun(
		store,
		pairKey(before, after),
		report.generated ?? new Date(mtime).toISOString(),
		found,
		valid,
		(json(paths.diffs) as Diffs | null) ?? {},
	);
	writeFileSync(STORE, JSON.stringify(store));
}

async function data(index: FixtureIndex, frameOrigin: string): Promise<ViewerData> {
	ingest(index);
	const usage = (json(paths.usage) as ViewerData["usage"] | null) ?? [];
	return {
		frameOrigin,
		organization: await organization(),
		componentItems: await componentItems(usage),
		appCss: existsSync(paths.app),
		cmCss: existsSync(`${ROOT}capture/.app/runtime`),
		fixtures: index.fixtures.map(
			({ id, file, component, surface, state, note, viewport, evidence }) => {
				const box = evidence?.box;
				return {
					id,
					component,
					surface,
					state,
					note,
					size: statSync(`${ROOT}capture/fixtures/${file}`).size,
					viewport,
					box:
						Array.isArray(box) && box.length === 4 && box.every((n) => Number.isFinite(n))
							? (box as [number, number, number, number])
							: undefined,
				};
			},
		),
		components: index.components,
		usage,
		compareError: reportError,
	};
}

// --- Replay inputs: what the compare tool hands capture's replay, built the same way -----------

const APP = `${ROOT}capture/.app`;
const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	avif: "image/avif",
	bmp: "image/bmp",
};

// Stylesheets rewritten for replay by capture's replayCss, kept by what they were made from.
const transformed = new Map<string, string>();
function replaySheet(key: string, text: () => string, touch: boolean): string {
	const id = `${key}:${touch}`;
	let css = transformed.get(id);
	if (css === undefined) {
		css = replayCss(text(), touch);
		transformed.set(id, css);
		for (const old of [...transformed.keys()].slice(0, Math.max(0, transformed.size - 200))) {
			transformed.delete(old);
		}
	}
	return css;
}

/** One stylesheet of a fixture's recorded list: the app's, the side's theme, or a runtime sheet. */
function styleFor(token: string, side: string, touch: boolean): string {
	if (token === "theme")
		return replaySheet(`theme:${side}`, () => sheets.get(side)?.raw ?? "", touch);
	if (token === "app") {
		const mtime = statSync(paths.app).mtimeMs;
		return replaySheet(`app:${mtime}`, () => readFileSync(paths.app, "utf8"), touch);
	}
	// Runtime sheets are named by a hash of their content.
	if (!/^[0-9a-f]+$/.test(token) || !existsSync(`${APP}/runtime/${token}.css`)) return "";
	return replaySheet(
		`runtime:${token}`,
		() => readFileSync(`${APP}/runtime/${token}.css`, "utf8"),
		touch,
	);
}

/** A fixture's stylesheets in their recorded order, with app asset URLs pointed at the workbench. */
function stylesheets(tokens: string[], side: string, touch: boolean, origin: string): string {
	return tokens
		.map((t) => styleFor(t, side, touch))
		.join("\n")
		.replaceAll('url("./public/', `url("${origin}/assets/public/`)
		.replaceAll('url("/lib/', `url("${origin}/assets/lib/`);
}

// The stylesheet each frame links, by the hash of its text: a frame can only ask for text the
// workbench itself put together.
const replaySheets = new Map<string, string>();
function publish(css: string): string {
	const hash = sha256(css);
	replaySheets.set(hash, css);
	for (const old of [...replaySheets.keys()].slice(0, Math.max(0, replaySheets.size - 60))) {
		replaySheets.delete(old);
	}
	return hash;
}

type Captured = FixtureIndex["fixtures"][number];

/** Everything capture's replay needs to draw one fixture with one side's theme. */
function replayInput(fixture: Captured, side: string, origin: string) {
	const touch = fixture.id.startsWith("mobile.");
	const tokens = fixture.runtimeStyles ?? fixture.styles ?? ["app", "runtime", "theme"];
	const data = (file: string) => readFileSync(`${ROOT}capture/fixtures/${file}`).toString("base64");
	const imageUrl = (file: string) =>
		`data:${IMAGE_TYPES[file.split(".").pop() ?? ""] ?? "image/png"};base64,${data(file)}`;
	// Images that inline styles point at (a Bases card cover) were saved with the capture: each
	// takes the place of its recorded address, as in the compare tool.
	const html = Object.entries(fixture.styleImages ?? {})
		.reduce(
			(text, [url, file]) => text.split(url).join(imageUrl(file)),
			readFileSync(`${ROOT}capture/fixtures/${fixture.file}`, "utf8"),
		)
		.replaceAll('url("./public/', `url("${origin}/assets/public/`)
		.replaceAll('url("/lib/', `url("${origin}/assets/lib/`)
		.replaceAll('src="/lib/', `src="${origin}/assets/lib/`);
	// Each nested frame's own stylesheets, by the list recorded on it.
	const frames: Record<string, string> = {};
	for (const match of html.matchAll(/data-capture-frame-styles=(?:"|(?:&amp;)*&quot;)([^"&]*)/g)) {
		const key = match[1] ?? "";
		frames[key] = stylesheets(key.split(" ").filter(Boolean), side, touch, origin);
	}
	return {
		stylesheet: publish(
			`${stylesheets(tokens, side, touch, origin)}\n[data-capture-placeholder], [data-capture-placeholder] * {visibility:hidden!important}`,
		),
		input: {
			html,
			sizes: (fixture.imageSizes ?? []).map((im) => ({
				index: im.index,
				width: im.width,
				height: im.height,
				// An image the capture saved is drawn as it was; others get a same-size stand-in.
				url: im.file ? imageUrl(im.file) : null,
			})),
			canvases: (fixture.canvasPixels ?? []).map((c) => ({
				index: c.index,
				frame: c.frame ?? null,
				b64: data(c.file),
			})),
			frames,
			trimSelector: fixture.trimSelector ?? null,
			// The side's own sizes and overflow show, as in the compare tool.
			options: { forceRecordedGeometry: false },
		},
	};
}

function send(res: ServerResponse, status: number, type: string, body: string | Uint8Array): void {
	res.statusCode = status;
	res.setHeader("Content-Type", type);
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.end(body);
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Keeps a handler's own failures inside it: an address that cannot be read (a broken %-escape, a
 * malformed URL) answers 400, anything else 500. Nothing thrown here reaches the process.
 */
function guarded(handle: Handler): Handler {
	return (req, res) => {
		try {
			handle(req, res);
		} catch (e) {
			if (res.headersSent) return void res.end();
			const bad = e instanceof URIError || e instanceof TypeError;
			send(res, bad ? 400 : 500, "text/plain", bad ? "Bad request" : "Server error");
		}
	};
}

/**
 * Answers the fixture frames' own address (the port after the workbench's, or the frames' public
 * origin when a proxy stands in front): a frame's document,
 * the stylesheet it links, and Obsidian's own fonts and images. GET only, this host only.
 */
export function frameHandler(at: Addresses, byId: Map<string, Captured>): Handler {
	const pageOrigin = at.page;
	const origin = at.frames;
	// Asked for by one of the frames' own two names only: the local one, or the public one.
	const hosts = [new URL(at.local.frames).host, new URL(at.frames).host];
	return guarded((req, res) => {
		if (!hosts.includes(req.headers.host ?? "") || req.method !== "GET") {
			return void send(res, 404, "text/plain", "Not found");
		}
		const url = new URL(req.url ?? "/", origin);
		const [, area, a, b] = url.pathname.split("/").map(decodeURIComponent);
		if (area === "frame" && a && sheets.has(a) && b && byId.has(b)) {
			const fixture = byId.get(b) as Captured;
			const nonce = randomUUID();
			const component = url.searchParams.get("focus") ?? "";
			const selector = COMPONENTS[component];
			const focus: Focus | null = selector ? { is: selector, not: moreSpecific(component) } : null;
			const { stylesheet, input } = replayInput(fixture, a, origin);
			replayCall(input)
				.then((call) => {
					res.setHeader("Content-Security-Policy", frameCsp(origin, pageOrigin, nonce));
					res.setHeader("Cache-Control", "no-store");
					send(
						res,
						200,
						"text/html; charset=utf-8",
						frameDocument({
							call,
							stylesheet: `${origin}/css/replay/${stylesheet}.css`,
							focus,
							nonce,
							quirks: Boolean(fixture.quirks),
						}),
					);
				})
				.catch((e) => send(res, 500, "text/plain", String(e)));
			return;
		}
		if (area === "css" && a === "replay" && b) {
			// A frame's stylesheet, named by the hash of its text: only text the workbench built.
			const css = replaySheets.get(b.replace(/\.css$/, ""));
			if (css === undefined) return void send(res, 404, "text/plain", "Not found");
			res.setHeader("Cache-Control", "max-age=31536000, immutable");
			return send(res, 200, "text/css; charset=utf-8", css);
		}
		if (url.pathname.startsWith("/assets/")) {
			// The app's own fonts and images, from the files extracted beside app.css. The real
			// path must be a file inside that folder.
			const root = `${APP}/assets`;
			if (!existsSync(root)) return void send(res, 404, "text/plain", "Not found");
			const path = resolve(root, decodeURIComponent(url.pathname.slice("/assets/".length)));
			if (!existsSync(path)) return void send(res, 404, "text/plain", "Not found");
			const real = realpathSync(path);
			if (!real.startsWith(realpathSync(root) + sep) || !statSync(real).isFile()) {
				return void send(res, 404, "text/plain", "Not found");
			}
			// Frames are sandboxed (origin "null"), and fonts are fetched with CORS.
			res.setHeader("Access-Control-Allow-Origin", "null");
			res.setHeader("Cache-Control", "max-age=31536000, immutable");
			const type =
				{ svg: "image/svg+xml", woff2: "font/woff2", ttf: "font/ttf", png: "image/png" }[
					real.split(".").pop() ?? ""
				] ?? "application/octet-stream";
			return send(res, 200, type, readFileSync(real));
		}
		send(res, 404, "text/plain", "Not found");
	});
}

export function viewer(): Plugin {
	return {
		name: "miami-wind-workbench",
		configureServer(server) {
			const index = json(paths.fixtures) as FixtureIndex;
			const byId = new Map(index.fixtures.map((f) => [f.id, f]));
			// Each component's own captures, by id.
			const ownCaptures: Record<string, string[]> = {};
			for (const f of index.fixtures) {
				ownCaptures[f.component] = [...(ownCaptures[f.component] ?? []), f.id];
			}
			// The compare tool's font embedding reads paths relative to the repository root.
			process.chdir(ROOT);
			// Everything watched here is let go when this server closes (Vite restarts itself when the
			// plugin's files change), so no old watcher keeps talking to a closed server.
			const watching = new Map<string, () => void>();
			const watchPath = (path: string, changed: () => void) => {
				watching.set(path, changed);
				watchFile(path, { interval: 300 }, changed);
			};
			for (const path of [paths.diffs, paths.compare, paths.app]) {
				watchPath(path, () => server.ws.send({ type: "full-reload" }));
			}
			// The sidebar is built from src/: a change there rebuilds it.
			let pending: ReturnType<typeof setTimeout> | undefined;
			const source = watch(`${ROOT}src`, { recursive: true }, () => {
				clearTimeout(pending);
				pending = setTimeout(() => server.ws.send({ type: "full-reload" }), 300);
			});
			// Theme files a side points at. A change tells the page to redraw that side, no reload.
			const watched = new Set<string>();
			const watchSide = (path: string | undefined) => {
				if (!path || watched.has(path)) return;
				watched.add(path);
				watchPath(path, () => server.ws.send({ type: "custom", event: "mw:side-changed" }));
			};
			// Requests that act on the machine must come from the workbench's own page: its origin as
			// the browser sees it, or its local one. Nothing else, whatever Host the request names.
			const at = addresses();
			const fromPage = (req: IncomingMessage) =>
				req.method === "POST" &&
				[at.page, at.local.page].includes(req.headers.origin ?? "") &&
				(req.headers["content-type"] ?? "").startsWith("application/json");

			// Fixture frames live at an address of their own: the next port. They never share the
			// workbench's origin, so nothing in a frame can read the workbench or call its API, while
			// the replay can still reach the frames nested inside its own document.
			const port = at.port;
			const origin = at.frames;
			const frames = createServer(frameHandler(at, byId));
			// Vite restarts itself when this plugin's files change: the frame server it had must be
			// gone before the new one takes the port, so wait for the old one and retry if needed.
			const held = globalThis as { mwFrames?: ReturnType<typeof createServer> };
			const previous = held.mwFrames;
			held.mwFrames = frames;
			let tries = 0;
			frames.on("error", (e: NodeJS.ErrnoException) => {
				if (e.code !== "EADDRINUSE" || ++tries > 20) throw e;
				setTimeout(() => frames.listen(port + 1, "127.0.0.1"), 250);
			});
			const listen = () => frames.listen(port + 1, "127.0.0.1");
			if (previous?.listening) previous.close(listen);
			else listen();
			server.httpServer?.on("close", () => {
				frames.close();
				source.close();
				clearTimeout(pending);
				for (const [path, changed] of watching) unwatchFile(path, changed);
			});

			const api: Handler = (req, res) => {
				const url = new URL(req.url ?? "/", "http://viewer");
				const [, area] = url.pathname.split("/").map(decodeURIComponent);
				if (url.pathname === "/api/sides") {
					// Resolve what each side points at. The page gets a label and a hash, never the text.
					if (!fromPage(req)) return send(res, 403, "text/plain", "Forbidden");
					body(req)
						.then((sent) => {
							const out: Record<string, unknown> = {};
							for (const which of ["left", "right"] as const) {
								try {
									const side = resolveSide(
										ROOT,
										parseChoice((sent as Record<string, unknown>)[which]),
									);
									remember(side);
									watchSide(side.watch);
									out[which] = { label: side.label, sha256: side.sha256 };
								} catch (e) {
									out[which] = { error: e instanceof Error ? e.message : String(e) };
								}
							}
							send(res, 200, "application/json", JSON.stringify(out));
						})
						.catch(() => send(res, 400, "text/plain", "Bad request"));
					return;
				}
				if (url.pathname === "/api/recheck" && req.method === "GET") {
					return send(
						res,
						200,
						"application/json",
						JSON.stringify(
							recheck
								? { running: !recheck.done, code: recheck.code, log: recheck.log.slice(-400) }
								: { running: false, code: null, log: "" },
						),
					);
				}
				if (url.pathname === "/api/recheck") {
					// Run the compare tool on the two sides now shown, for one component or for everything.
					if (!fromPage(req)) return send(res, 403, "text/plain", "Forbidden");
					body(req)
						.then((sent) => {
							const { left, right, component } = sent as Record<string, unknown>;
							const before = sheets.get(String(left));
							const after = sheets.get(String(right));
							const named = typeof component === "string" && component in index.components;
							if (!before || !after || (component !== undefined && !named)) {
								return send(res, 400, "text/plain", "Unknown side or component");
							}
							if (recheck && !recheck.done) return send(res, 409, "text/plain", "Already running");
							// The compare tool reads files: hand it exactly the bytes the pictures are drawn from.
							mkdirSync(`${OUT}/sides`, { recursive: true });
							const files = [left, right].map((sha) => `${OUT}/sides/${sha}.css`);
							writeFileSync(files[0] as string, before.raw);
							writeFileSync(files[1] as string, after.raw);
							const args = ["workbench/compare/cli.ts", "--before", files[0], "--after", files[1]];
							const proc = spawn(
								"bun",
								[...args, ...(named ? ["--component", component as string] : [])] as string[],
								{ cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
							);
							const run = { proc, log: "", done: false, code: null as number | null };
							recheck = run;
							const keep = (chunk: Buffer) => {
								run.log = (run.log + chunk).slice(-4000);
							};
							proc.stdout?.on("data", keep);
							proc.stderr?.on("data", keep);
							proc.on("close", (code) => {
								run.done = true;
								run.code = code;
							});
							send(res, 200, "application/json", JSON.stringify({ running: true }));
						})
						.catch(() => send(res, 400, "text/plain", "Bad request"));
					return;
				}
				if (url.pathname === "/api/results") {
					// What is on record for one pair of sides, named by the hashes of their CSS.
					ingest(index);
					const key = pairKey(
						url.searchParams.get("before") ?? "",
						url.searchParams.get("after") ?? "",
					);
					const shown = resultsFor(store, key, validator(ROOT), ownCaptures);
					return send(res, 200, "application/json", JSON.stringify(shown));
				}
				if (url.pathname === "/api/data") {
					data(index, origin)
						.then((all) => send(res, 200, "application/json", JSON.stringify(all)))
						.catch((e) => send(res, 500, "text/plain", String(e)));
					return;
				}
				const picture = /^\/diff\/([0-9a-f]{64})\/([0-9a-f]{64})\/(.+)$/.exec(url.pathname);
				if (picture) {
					// A saved diff picture: the pair by its two hashes, the capture by a known id.
					const [, before = "", after = "", raw = ""] = picture;
					const id = decodeURIComponent(raw);
					const file = `${pictures(before, after)}/${id}.diff.png`;
					if (!byId.has(id) || !existsSync(file)) return send(res, 404, "text/plain", "Not found");
					res.setHeader("Cache-Control", "no-store");
					return send(res, 200, "image/png", readFileSync(file));
				}
				if (["frame", "css", "diff", "lib", "assets"].includes(area ?? "")) {
					return send(res, 404, "text/plain", "Not found");
				}
				passed.add(req);
			};
			// A request the workbench does not answer itself goes on to Vite.
			const passed = new WeakSet<IncomingMessage>();
			const safeApi = guarded(api);
			server.middlewares.use((req, res, next) => {
				safeApi(req, res);
				if (passed.has(req)) next();
			});
		},
	};
}
