// The component viewer: `bun run viewer`. Serves the page, the fixtures wrapped with Obsidian's
// app CSS plus one theme, and a reload event when the built theme or the compare result changes.
import { existsSync, statSync, watchFile } from "node:fs";
import { extractFile } from "@electron/asar";
import { COMPONENTS } from "../../capture/scripts/engine.ts";
import { appAsar } from "../../capture/scripts/obsidian.ts";
import { forceStates } from "./force-states.ts";
import index from "./index.html";
import type { Theme, ViewerData } from "./types.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CURRENT_REF = "b478dc8";
const PORT = Number(process.env.PORT ?? 5175);

const paths = {
	app: `${ROOT}capture/.app/app.css`,
	new: `${ROOT}theme.css`,
	diffs: `${ROOT}workbench/out/component-diffs.json`,
	compare: `${ROOT}workbench/out/compare.json`,
	fixtures: `${ROOT}capture/fixtures.json`,
	usage: `${ROOT}component-usage.json`,
};

const git = Bun.spawnSync(["git", "show", `${CURRENT_REF}:theme.css`], { cwd: ROOT });
if (git.exitCode !== 0) throw new Error(`git show ${CURRENT_REF}:theme.css failed: ${git.stderr}`);
const currentCss = forceStates(git.stdout.toString());

const index_ = (await Bun.file(paths.fixtures).json()) as Pick<
	ViewerData,
	"fixtures" | "components"
>;
const fixtureIds = new Set(index_.fixtures.map((f) => f.id));

const json = async (path: string) => (existsSync(path) ? await Bun.file(path).json() : null);

async function data(): Promise<ViewerData> {
	const compare = (await json(paths.compare)) as {
		fixtures: { id: string; same: boolean }[];
	} | null;
	return {
		appCss: existsSync(paths.app),
		fixtures: index_.fixtures.map(({ id, component, surface, state, note }) => ({
			id,
			component,
			surface,
			state,
			note,
			size: statSync(`${ROOT}capture/fixtures/${id}.html`).size,
		})),
		components: index_.components,
		usage: (await json(paths.usage)) ?? [],
		diffs: await json(paths.diffs),
		changed: compare ? compare.fixtures.filter((f) => !f.same).map((f) => f.id) : null,
	};
}

// Rewritten stylesheets, kept until the file changes.
const cssCache = new Map<string, { mtime: number; css: string }>();
async function css(name: "app" | "new"): Promise<string | null> {
	const path = paths[name];
	if (!existsSync(path)) return null;
	const mtime = statSync(path).mtimeMs;
	const hit = cssCache.get(name);
	if (hit?.mtime === mtime) return hit.css;
	const out = forceStates(await Bun.file(path).text());
	cssCache.set(name, { mtime, css: out });
	return out;
}

// Bumped on every change so frames fetch fresh CSS while unchanged CSS stays cached.
let version = Date.now();
const clients = new Set<ReadableStreamDefaultController<string>>();
for (const path of [paths.new, paths.diffs, paths.compare, paths.app]) {
	watchFile(path, { interval: 300 }, () => {
		version = Date.now();
		for (const c of clients) c.enqueue("data: reload\n\n");
	});
}

// Runs inside each fixture frame: reports where the captured element sits so the page can crop to
// it. With a focus selector it reports the first visible match inside the captured element instead.
const frameScript = (focus: string | undefined) => `
addEventListener("click", (e) => e.preventDefault(), true);
addEventListener("load", async () => {
	await document.fonts.ready;
	const target = document.querySelector("[data-capture-target]") ?? document.body;
	const focus = ${JSON.stringify(focus ?? null)};
	const inside = focus && (target.matches(focus) ? target : [...target.querySelectorAll(focus)].find((e) => e.getClientRects().length));
	const el = inside || target;
	// Bring an element below the fold into view. Not scrollIntoView: it would scroll the viewer too.
	let r = el.getBoundingClientRect();
	for (let a = el.parentElement; a && (r.bottom > innerHeight || r.top < 0); a = a.parentElement) {
		a.scrollTop += r.top - a.getBoundingClientRect().top - (a.clientHeight - r.height) / 2;
		r = el.getBoundingClientRect();
	}
	parent.postMessage({ mwRect: [r.x, r.y, r.width, r.height] }, "*");
});`;

async function frame(theme: string, id: string, focus: string | null): Promise<Response> {
	if ((theme !== "current" && theme !== "new") || !fixtureIds.has(id)) {
		return new Response("Unknown fixture", { status: 404 });
	}
	const html = await Bun.file(`${ROOT}capture/fixtures/${id}.html`).text();
	const head = `<head><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css?v=${version}"><link rel="stylesheet" href="/css/${theme satisfies Theme}.css?v=${version}"><link rel="stylesheet" href="/css/cm-base.css?v=${version}"><script>${frameScript(focus ? COMPONENTS[focus] : undefined)}</script></head>`;
	return new Response(html.replace('<head><meta charset="utf-8"></head>', head), {
		headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
	});
}

const cssResponse = (body: string | null) =>
	body === null
		? new Response("Not found", { status: 404 })
		: new Response(body, {
				headers: {
					"Content-Type": "text/css; charset=utf-8",
					"Cache-Control": "max-age=31536000, immutable",
				},
			});

const server = Bun.serve({
	port: PORT,
	development: true,
	idleTimeout: 0,
	routes: {
		"/": index,
		"/api/data": async () => Response.json(await data()),
		"/frame/:theme/:id": (req) =>
			frame(req.params.theme, req.params.id, new URL(req.url).searchParams.get("focus")),
		"/css/app.css": async () => cssResponse(await css("app")),
		"/css/new.css": async () => cssResponse(await css("new")),
		"/css/current.css": () => cssResponse(currentCss),
		// Last, like the real one: CodeMirror's injected sheet comes after app.css and the theme.
		"/css/cm-base.css": async () =>
			cssResponse(await Bun.file(new URL("./cm-base.css", import.meta.url)).text()),
		// Fonts and images app.css points at; read straight from the local Obsidian install.
		"/css/public/:file": (req) => {
			try {
				const asar = appAsar() ?? "/usr/lib/obsidian/obsidian.asar";
				return new Response(extractFile(asar, `public/${req.params.file}`), {
					headers: { "Cache-Control": "max-age=31536000, immutable" },
				});
			} catch {
				return new Response("Not found", { status: 404 });
			}
		},
		"/events": () => {
			let me: ReadableStreamDefaultController<string>;
			return new Response(
				new ReadableStream<string>({
					start(c) {
						me = c;
						clients.add(c);
						c.enqueue(": connected\n\n");
					},
					cancel() {
						clients.delete(me);
					},
				}),
				{ headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } },
			);
		},
	},
});

console.log(`Miami Wind component viewer: ${server.url}`);
