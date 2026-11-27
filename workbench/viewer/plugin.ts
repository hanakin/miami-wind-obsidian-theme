// The viewer's local asset handling, as a Vite plugin: the data for the page, the fixtures wrapped
// with Obsidian's CSS plus one theme, and a reload when the built theme or the compare result changes.
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	watch,
	watchFile,
	writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import Specificity from "@bramus/specificity";
import { extractFile } from "@electron/asar";
import type { Plugin } from "vite";
import { COMPONENTS } from "../../capture/scripts/engine.ts";
import { appAsar } from "../../capture/scripts/obsidian.ts";
import { embedMathjaxFonts } from "../compare/fonts.ts";
import { changes, compareStates } from "./compare-states.ts";
import { touchedComponents } from "./elements.ts";
import { forceStates } from "./force-states.ts";
import { frameCsp, frameDocument, type ImageSize } from "./frame.ts";
import { type FixtureResult, mergeRun, pairKey, resultsFor, type Store } from "./results.ts";
import { parseChoice, resolveSide, type Side } from "./sides.ts";
import { organization } from "./source.ts";
import type { CompareState, Diffs, ViewerData } from "./types.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

const paths = {
	app: `${ROOT}capture/.app/app.css`,
	// Obsidian's runtime stylesheets (CodeMirror's rules among them), which the compare tool also
	// loads first. Extracted locally by `bun run capture:extract-runtime-css`; never committed.
	cm: `${ROOT}capture/.app/runtime-styles.css`,
	new: `${ROOT}theme.css`,
	diffs: `${ROOT}workbench/out/component-diffs.json`,
	compare: `${ROOT}workbench/out/compare.json`,
	fixtures: `${ROOT}capture/fixtures.json`,
	usage: `${ROOT}component-usage.json`,
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
interface ReportMeta {
	generated?: string;
	themes?: { before?: { sha256?: string }; after?: { sha256?: string } };
	fixtures?: ReportFixture[];
}

const OUT = `${ROOT}workbench/out`;

// Every side resolved so far, by the hash of its CSS: the text to draw (states forced) and the
// text as it was read. Frames and re-checks work from these bytes, never from a path again.
const sheets = new Map<string, { forced: string; raw: string }>();
const MAX_SHEETS = 24;
function remember(side: Side): void {
	if (!sheets.has(side.sha256)) {
		sheets.set(side.sha256, { forced: forceStates(side.css), raw: side.css });
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
}

type FixtureIndex = Pick<ViewerData, "components"> & {
	fixtures: (ViewerData["fixtures"][number] & {
		/** File name under capture/fixtures; ".xhtml" for trees HTML text cannot hold. */
		file: string;
		/** Components found inside the capture. */
		contains: string[];
		format?: "xhtml";
		imageSizes?: ImageSize[];
	})[];
};

// The window sizes of the emulated mobile captures (capture/scripts/obsidian.ts).
const VIEWPORTS: Record<string, [number, number]> = {
	"mobile-phone": [390, 844],
	"mobile-tablet": [1024, 768],
};

/** What a compare report found for each of its captures, in the form the workbench keeps. */
function entries(report: ReportMeta, index: FixtureIndex, states: Record<string, CompareState>) {
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
		if (!state || !byId.has(f.id)) continue;
		const differences = f.differences ?? [];
		const selectors = Object.fromEntries(
			(contains.get(f.id) ?? []).flatMap((c) => (COMPONENTS[c] ? [[c, COMPONENTS[c]]] : [])),
		);
		const found = differences.length ? changes(differences, selectors) : undefined;
		out[f.id] = {
			state,
			touched: differences.length
				? [
						...touchedComponents(differences, contains.get(f.id) ?? [], COMPONENTS),
						...ownWhole(f.id),
					]
				: [],
			changes: found && {
				...found,
				list: found.list.map((c) => ({ ...c, components: [...c.components, ...ownWhole(f.id)] })),
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
	const found = entries(report, index, states);
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
		(json(paths.diffs) as Diffs | null) ?? {},
	);
	writeFileSync(STORE, JSON.stringify(store));
}

async function data(index: FixtureIndex): Promise<ViewerData> {
	ingest(index);
	const { sections, overlaps } = await organization();
	return {
		organization: { sections, overlaps },
		appCss: existsSync(paths.app),
		cmCss: existsSync(paths.cm),
		fixtures: index.fixtures.map(({ id, file, component, surface, state, note }) => ({
			id,
			component,
			surface,
			state,
			note,
			size: statSync(`${ROOT}capture/fixtures/${file}`).size,
			viewport: VIEWPORTS[surface],
		})),
		components: index.components,
		usage: (json(paths.usage) as ViewerData["usage"] | null) ?? [],
		compareError: reportError,
	};
}

// Stylesheets with forced states, kept until the file changes.
const cssCache = new Map<string, { mtime: number; css: string }>();
function sheet(path: string): string | null {
	if (!existsSync(path)) return null;
	const mtime = statSync(path).mtimeMs;
	const hit = cssCache.get(path);
	if (hit?.mtime === mtime) return hit.css;
	const out = forceStates(readFileSync(path, "utf8"));
	cssCache.set(path, { mtime, css: out });
	return out;
}

// Obsidian's runtime rules with MathJax's fonts embedded the way the compare tool embeds them, so
// frames ask the server for no font but the app's own.
let runtime: { mtime: number; css: string } | undefined;
function runtimeSheet(): string | null {
	if (!existsSync(paths.cm)) return null;
	const mtime = statSync(paths.cm).mtimeMs;
	if (runtime?.mtime !== mtime) {
		const css = readFileSync(paths.cm, "utf8");
		let embedded = css;
		try {
			embedded = embedMathjaxFonts(css);
		} catch (e) {
			console.warn(`MathJax fonts not embedded: ${e}`);
		}
		runtime = { mtime, css: forceStates(embedded) };
	}
	return runtime.css;
}

function send(res: ServerResponse, status: number, type: string, body: string | Uint8Array): void {
	res.statusCode = status;
	res.setHeader("Content-Type", type);
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.end(body);
}

export function viewer(): Plugin {
	return {
		name: "miami-wind-viewer",
		configureServer(server) {
			const index = json(paths.fixtures) as FixtureIndex;
			const byId = new Map(index.fixtures.map((f) => [f.id, f]));
			// The compare tool's font embedding reads paths relative to the repository root.
			process.chdir(ROOT);
			// Bumped on every change so frames fetch fresh CSS while unchanged CSS stays cached.
			let version = Date.now();
			for (const path of [paths.diffs, paths.compare, paths.app, paths.cm]) {
				watchFile(path, { interval: 300 }, () => {
					version = Date.now();
					server.ws.send({ type: "full-reload" });
				});
			}
			// The sidebar is built from src/: a change there rebuilds it.
			let pending: ReturnType<typeof setTimeout> | undefined;
			watch(`${ROOT}src`, { recursive: true }, () => {
				clearTimeout(pending);
				pending = setTimeout(() => server.ws.send({ type: "full-reload" }), 300);
			});
			// Theme files a side points at. A change tells the page to redraw that side, no reload.
			const watched = new Set<string>();
			const watchSide = (path: string | undefined) => {
				if (!path || watched.has(path)) return;
				watched.add(path);
				watchFile(path, { interval: 300 }, () =>
					server.ws.send({ type: "custom", event: "mw:side-changed" }),
				);
			};
			// Requests that act on the machine must come from the viewer's own page.
			const fromPage = (req: IncomingMessage) =>
				req.method === "POST" &&
				req.headers.origin === `http://${req.headers.host}` &&
				(req.headers["content-type"] ?? "").startsWith("application/json");

			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url ?? "/", "http://viewer");
				const [, area, a, b] = url.pathname.split("/").map(decodeURIComponent);
				// Frames have no origin of their own (sandbox), so every URL they load is spelled out.
				const origin = `http://${req.headers.host}`;

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
					return send(res, 200, "application/json", JSON.stringify(resultsFor(store, key)));
				}
				if (url.pathname === "/api/data") {
					data(index)
						.then((all) => send(res, 200, "application/json", JSON.stringify(all)))
						.catch((e) => send(res, 500, "text/plain", String(e)));
					return;
				}
				if (area === "frame" && a && sheets.has(a) && b && byId.has(b)) {
					const nonce = randomUUID();
					const component = url.searchParams.get("focus") ?? "";
					const selector = COMPONENTS[component];
					const focus = selector ? { is: selector, not: moreSpecific(component) } : null;
					// Runtime rules, app CSS, then the side's theme by its hash: the compare tool's order.
					const styles = [
						`${origin}/css/cm.css?v=${version}`,
						`${origin}/css/app.css?v=${version}`,
						`${origin}/css/theme/${a}.css`,
					];
					const fixture = byId.get(b);
					const html = readFileSync(`${ROOT}capture/fixtures/${fixture?.file}`, "utf8");
					// The content decides: synthetic platform variants keep ".html" names for XHTML text.
					const xhtml = fixture?.format === "xhtml" || html.startsWith("<?xml");
					res.setHeader("Content-Security-Policy", frameCsp(origin, nonce));
					res.setHeader("Cache-Control", "no-store");
					return send(
						res,
						200,
						xhtml ? "application/xhtml+xml; charset=utf-8" : "text/html; charset=utf-8",
						frameDocument(html, styles, focus, nonce, fixture?.imageSizes, xhtml),
					);
				}
				if (area === "css" && a === "public" && b && /^[\w.-]+$/.test(b)) {
					// Fonts and images app.css points at, read straight from the local Obsidian install.
					try {
						const asar = appAsar() ?? "/usr/lib/obsidian/obsidian.asar";
						const file = extractFile(asar, `public/${b}`);
						// Frames are sandboxed (origin "null"), and fonts are fetched with CORS.
						res.setHeader("Access-Control-Allow-Origin", "null");
						res.setHeader("Cache-Control", "max-age=31536000, immutable");
						const type = b.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
						return send(res, 200, type, file);
					} catch {
						return send(res, 404, "text/plain", "Not found");
					}
				}
				if (area === "css" && a === "theme" && b) {
					// A side's theme, named by the hash of its text: only text a side resolved to.
					const theme = sheets.get(b.replace(/\.css$/, ""));
					if (!theme) return send(res, 404, "text/plain", "Not found");
					res.setHeader("Cache-Control", "max-age=31536000, immutable");
					return send(res, 200, "text/css; charset=utf-8", theme.forced);
				}
				if (area === "css" && a && !b) {
					const name = a.replace(/\.css$/, "");
					const body = name === "cm" ? runtimeSheet() : name === "app" ? sheet(paths.app) : null;
					if (body === null) return send(res, 404, "text/plain", "Not found");
					res.setHeader("Cache-Control", "max-age=31536000, immutable");
					return send(res, 200, "text/css; charset=utf-8", body);
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
				if (["frame", "css", "diff", "lib"].includes(area ?? "")) {
					return send(res, 404, "text/plain", "Not found");
				}
				next();
			});
		},
	};
}
