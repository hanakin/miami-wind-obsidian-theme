// The viewer's local asset handling, as a Vite plugin: the data for the page, the fixtures wrapped
// with Obsidian's CSS plus one theme, and a reload when the built theme or the compare result changes.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, watchFile } from "node:fs";
import type { ServerResponse } from "node:http";
import Specificity from "@bramus/specificity";
import { extractFile } from "@electron/asar";
import type { Plugin } from "vite";
import { COMPONENTS } from "../../capture/scripts/engine.ts";
import { appAsar } from "../../capture/scripts/obsidian.ts";
import { changes, compareStates } from "./compare-states.ts";
import { touchedComponents } from "./elements.ts";
import { forceStates } from "./force-states.ts";
import { frameCsp, frameDocument, type ImageSize } from "./frame.ts";
import type { ViewerData } from "./types.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CURRENT_REF = "b478dc8";

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

interface ReportTheme {
	sha256?: string;
	source?: string;
	/** The theme text the report compared, saved beside it (relative to workbench/out). */
	file?: string;
}

/** What a compare.json says about itself. Older reports record none of this. */
interface ReportMeta {
	generated?: string;
	themes?: { before?: ReportTheme; after?: ReportTheme };
	fixtures?: ReportFixture[];
}

/** The saved theme file a report points at, when it is a plain name under workbench/out/themes. */
function savedTheme(theme: ReportTheme | undefined): string | null {
	if (!theme?.file || !/^themes\/[\w.-]+\.css$/.test(theme.file)) return null;
	const path = `${ROOT}workbench/out/${theme.file}`;
	return existsSync(path) ? path : null;
}

function reportInfo(report: ReportMeta): ViewerData["report"] {
	const current = createHash("sha256").update(readFileSync(paths.new)).digest("hex");
	const after = report.themes?.after;
	return {
		generated: report.generated ?? statSync(paths.compare).mtime.toISOString(),
		after: after?.sha256 ? { sha256: after.sha256, source: after.source } : undefined,
		stale: after?.sha256 ? after.sha256 !== current : null,
		exact: Boolean(savedTheme(report.themes?.before) && savedTheme(after)),
	};
}

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
	/** Elements whose change was accepted as intentional. */
	acceptanceScope?: { elements?: string[] };
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

function data(index: FixtureIndex): ViewerData {
	const report = json(paths.compare) as ReportMeta | null;
	const byId = new Map(index.fixtures.map((f) => [f.id, f]));
	const compare = report === null ? null : compareStates(report);
	const differing = typeof compare === "string" ? [] : (report?.fixtures ?? []);
	const contains = new Map(index.fixtures.map((f) => [f.id, [f.component, ...f.contains]]));
	return {
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
		diffs: json(paths.diffs) as ViewerData["diffs"],
		compare: typeof compare === "string" ? null : compare,
		report: report && typeof compare !== "string" ? reportInfo(report) : null,
		touched: Object.fromEntries(
			differing
				.filter((f) => f.differences?.length)
				.map((f) => [
					f.id,
					touchedComponents(f.differences ?? [], contains.get(f.id) ?? [], COMPONENTS),
				]),
		),
		changes: Object.fromEntries(
			differing
				.filter((f) => f.differences?.length)
				.map((f) => [
					f.id,
					{
						...changes(f.differences ?? [], f.acceptanceScope?.elements, {
							name: byId.get(f.id)?.component ?? "",
							selector: COMPONENTS[byId.get(f.id)?.component ?? ""],
						}),
						diffImage: Boolean(f.images?.diff),
					},
				]),
		),
		compareError: typeof compare === "string" ? compare : undefined,
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

// The theme files the last report compared, when it saved them; kept until the report changes.
let saved: { mtime: number; before: string | null; after: string | null } | undefined;
function savedThemes(): { before: string | null; after: string | null } {
	if (!existsSync(paths.compare)) return { before: null, after: null };
	const mtime = statSync(paths.compare).mtimeMs;
	if (saved?.mtime !== mtime) {
		const themes = (json(paths.compare) as ReportMeta | null)?.themes;
		saved = { mtime, before: savedTheme(themes?.before), after: savedTheme(themes?.after) };
	}
	return saved;
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
			const currentCss = forceStates(
				execFileSync("git", ["show", `${CURRENT_REF}:theme.css`], { cwd: ROOT, encoding: "utf8" }),
			);
			// Bumped on every change so frames fetch fresh CSS while unchanged CSS stays cached.
			let version = Date.now();
			for (const path of [paths.new, paths.diffs, paths.compare, paths.app, paths.cm]) {
				watchFile(path, { interval: 300 }, () => {
					version = Date.now();
					server.ws.send({ type: "full-reload" });
				});
			}

			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url ?? "/", "http://viewer");
				const [, area, a, b] = url.pathname.split("/").map(decodeURIComponent);
				// Frames have no origin of their own (sandbox), so every URL they load is spelled out.
				const origin = `http://${req.headers.host}`;

				if (url.pathname === "/api/data") {
					return send(res, 200, "application/json", JSON.stringify(data(index)));
				}
				if (area === "frame" && (a === "current" || a === "new") && b && byId.has(b)) {
					const nonce = randomUUID();
					const component = url.searchParams.get("focus") ?? "";
					const selector = COMPONENTS[component];
					const focus = selector ? { is: selector, not: moreSpecific(component) } : null;
					const styles = ["cm", "app", a].map((n) => `${origin}/css/${n}.css?v=${version}`);
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
				if (area === "css" && a && !b) {
					const name = a.replace(/\.css$/, "");
					// Each side is drawn with the theme file the report compared, when it saved one, so
					// the pictures and the results describe the same CSS.
					const themes = savedThemes();
					const body =
						name === "current"
							? themes.before
								? sheet(themes.before)
								: currentCss
							: name === "new"
								? sheet(themes.after ?? paths.new)
								: name === "app" || name === "cm"
									? sheet(paths[name])
									: null;
					if (body === null) return send(res, 404, "text/plain", "Not found");
					res.setHeader("Cache-Control", "max-age=31536000, immutable");
					return send(res, 200, "text/css; charset=utf-8", body);
				}
				if (area === "diff" && a && !b && byId.has(a)) {
					// The compare tool's diff picture for one fixture; the id is a known fixture's.
					const file = `${ROOT}workbench/out/diffs/${a}.diff.png`;
					if (!existsSync(file)) return send(res, 404, "text/plain", "Not found");
					res.setHeader("Cache-Control", "no-store");
					return send(res, 200, "image/png", readFileSync(file));
				}
				if (["frame", "css", "diff"].includes(area ?? "")) {
					return send(res, 404, "text/plain", "Not found");
				}
				next();
			});
		},
	};
}
