import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { CDPSession, Page } from "playwright";
import { replayCss } from "../../capture/scripts/css";
import { INPAGE } from "../../capture/scripts/inpage";
import { replayFixture } from "../../capture/scripts/replay";
import type { FixtureEntry } from "../../capture/scripts/types";

const origin = "https://obsidian-app.invalid/";
const assetRoot = resolve("capture/.app/assets");
const modes = new WeakMap<Page, boolean>();
const sheets = new Map<string, string>();
const desktopCss = new Map<string, string>();
const touchCss = new Map<string, string>();
function transformed(text: string, touch: boolean): string {
	const cache = touch ? touchCss : desktopCss;
	let value = cache.get(text);
	if (value === undefined) {
		value = replayCss(text, touch);
		cache.set(text, value);
	}
	return value;
}
let limits: Record<string, string> | undefined;
export function loadReplayLimits(): Record<string, string> {
	if (!limits) {
		if (!existsSync("capture/coverage.json"))
			throw new Error("Missing capture coverage: capture/coverage.json");
		limits =
			JSON.parse(readFileSync("capture/coverage.json", "utf8")).replay
				?.limits ?? {};
	}
	return limits!;
}

function sheet(
	token: string,
	css: { app: string; cm: string; theme: string },
	touch: boolean,
): string {
	if (token === "theme") return transformed(css.theme, touch);
	if (token === "app") return transformed(css.app, touch);
	if (token === "runtime") return transformed(css.cm, touch);
	const key = `${token}:${touch}`;
	let value = sheets.get(key);
	if (value === undefined) {
		value = replayCss(
			readFileSync(`capture/.app/runtime/${token}.css`, "utf8"),
			touch,
		);
		sheets.set(key, value);
	}
	return value;
}

/** Capture owns DOM, canvas, frame, geometry, selection and scroll restoration. Only theme substitution is compare-specific. */
export async function prepareReplay(
	page: Page,
	cdp: CDPSession,
	html: string,
	css: { app: string; cm: string; theme: string },
	fixture: FixtureEntry,
) {
	if (modes.get(page) !== !!fixture.quirks) {
		if (!modes.has(page))
			await page.route("**/*", (route) => {
				const url = route.request().url();
				const path = resolve(assetRoot, new URL(url).pathname.slice(1));
				if (
					url.startsWith(origin) &&
					path.startsWith(assetRoot + sep) &&
					existsSync(path)
				)
					return route.fulfill({
						path,
						headers: { "Access-Control-Allow-Origin": "*" },
					});
				return route.abort();
			});
		await page.setContent(
			`${fixture.quirks ? "" : "<!doctype html>"}<html><head><style id="replay"></style><style data-compare-suppression></style></head><body></body></html>`,
		);
		await page.evaluate(INPAGE);
		modes.set(page, !!fixture.quirks);
	}
	const [width, height] = fixture.viewport ?? [1600, 1000];
	await page.setViewportSize({ width, height });
	const media = JSON.parse(fixture.evidence?.media ?? "{}");
	const im = fixture.evidence?.inputMedia;
	const canvas = im?.canvas?.match(/\d+/g)?.map(Number);
	const forced = (media.features ?? []).some(
		(x: { name: string }) => x.name === "forced-colors",
	);
	const dark =
		forced && canvas
			? canvas.reduce((sum, v) => sum + v, 0) < 384
			: im?.dark !== false;
	await cdp.send("Emulation.setEmulatedMedia", {
		media: media.media ?? "",
		features: [
			...(media.features ?? []),
			{ name: "prefers-color-scheme", value: dark ? "dark" : "light" },
		],
	});
	await cdp.send(
		"Emulation.setDefaultBackgroundColorOverride",
		/<body[^>]*class="[^"]*\bis-translucent\b/.test(html)
			? { color: { r: 0, g: 0, b: 0, a: 1 } }
			: {},
	);
	const touch = fixture.id.startsWith("mobile.");
	const rewrite = (value: string) =>
		value
			.replaceAll('url("./public/', `url("${origin}public/`)
			.replaceAll('url("/lib/', `url("${origin}lib/`);
	const styles =
		rewrite(
			(fixture.runtimeStyles ?? fixture.styles ?? ["app", "runtime", "theme"])
				.map((t) => sheet(t, css, touch))
				.join("\n"),
		) +
		"\n[data-capture-placeholder], [data-capture-placeholder] * {visibility:hidden!important}";
	await page.locator("#replay").evaluate((el, value) => {
		el.textContent = "";
		void document.body.offsetHeight;
		el.textContent = value;
		void document.body.offsetHeight;
	}, styles);
	const frames: Record<string, string> = {};
	for (const match of html.matchAll(
		/data-capture-frame-styles=(?:"|(?:&amp;)*&quot;)([^"&]*)/g,
	)) {
		const key = match[1] ?? "";
		frames[key] = rewrite(
			key
				.split(" ")
				.filter(Boolean)
				.map((t) => sheet(t, css, touch))
				.join("\n"),
		);
	}
	const canvases = (fixture.canvasPixels ?? []).map((c) => ({
		index: c.index,
		frame: c.frame ?? null,
		b64: readFileSync(`capture/fixtures/${c.file}`).toString("base64"),
	}));
	const got = await replayFixture(
		page,
		rewrite(html).replaceAll('src="/lib/', `src="${origin}lib/`),
		(fixture.imageSizes ?? []).map((im) => ({
			...im,
			url: im.file
				? `data:${({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" } as Record<string, string>)[im.file.split(".").pop() ?? ""] ?? "image/png"};base64,${readFileSync(`capture/fixtures/${im.file}`).toString("base64")}`
				: null,
		})),
		canvases,
		frames,
		fixture.trimSelector ?? null,
		{ forceRecordedGeometry: false },
	);
	await page.locator("style[data-compare-suppression]").evaluate((el) => {
		el.textContent =
			"*,*::before,*::after {animation:none!important;transition:none!important;caret-color:transparent!important}";
	});
	return {
		got,
		issues: [
			...(got.why ? [got.why] : []),
			...(loadReplayLimits()[fixture.id]
				? [`capture replay limit: ${loadReplayLimits()[fixture.id]}`]
				: []),
		],
	};
}
