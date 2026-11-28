// Builds the document one fixture frame shows. The picture is drawn by capture's own replay code
// (capture/scripts/replay.ts): the same steps the coverage check and the compare tool run, so a
// picture here is what they judged. There is no second copy of those steps.
//
// The captured markup is untrusted. It is stripped of scripts and inline handlers here, the frame
// is sandboxed, and the response headers (frameCsp) let only this file's one script run.
import type { Page } from "playwright";
import { INPAGE } from "../../capture/scripts/inpage.ts";
import { type ReplayOptions, replayFixture } from "../../capture/scripts/replay.ts";

/** Removes script elements and inline event handlers from captured HTML. */
export function sanitize(html: string): string {
	return html
		.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
		.replace(/<\/?script\b[^>]*>/gi, "")
		.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** The component to look for in a capture: its selector, and selectors that claim an element first. */
export interface Focus {
	is: string;
	not: string[];
}

/** What the shared replay needs for one fixture: the same arguments the compare tool hands it. */
export interface ReplayInput {
	html: string;
	sizes: Parameters<typeof replayFixture>[2];
	canvases: Parameters<typeof replayFixture>[3];
	frames: Parameters<typeof replayFixture>[4];
	trimSelector: string | null;
	options: ReplayOptions;
}

/**
 * The shared replay as text to run in the frame: the very function replayFixture would run in a
 * page, and the arguments it would pass. Taken by calling replayFixture with a stand-in page that
 * records them instead of running them.
 */
export async function replayCall(input: ReplayInput): Promise<{ source: string; args: unknown }> {
	let call: { source: string; args: unknown } | undefined;
	const page = {
		evaluate: async (fn: unknown, args: unknown) => {
			call = { source: String(fn), args };
			return { why: "" };
		},
	} as unknown as Page;
	await replayFixture(
		page,
		sanitize(input.html),
		input.sizes,
		input.canvases,
		input.frames,
		input.trimSelector,
		input.options,
	);
	if (!call) throw new Error("The shared replay did not run its page step.");
	return call;
}

// Text placed inside a <script>: nothing in it may close the element or open a comment.
const inScript = (text: string) =>
	text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const asData = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

// Runs after the replay: tells the workbench where the element to show sits, or null when it is
// missing or not visible. With a focus selector it looks for that component in the capture.
const measure = (focus: Focus | null) => `
	const focus = ${asData(focus)};
	const visible = (e) => e.getClientRects().length > 0 && e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
	const target = document.querySelector("[data-capture-target]") ?? document.body;
	// Really showing: the point at its middle is the element, not something over it.
	const onTop = (e) => {
		const r = e.getBoundingClientRect();
		const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
		return hit !== null && (e.contains(hit) || hit.contains(e));
	};
	const mine = (e) => e.matches(focus.is) && !focus.not.some((s) => e.matches(s)) && visible(e) && onTop(e);
	const el = focus ? [target, ...target.querySelectorAll(focus.is)].find(mine) : visible(target) && target;
	if (!el) return parent.postMessage({ mwRect: null }, "*");
	const r = el.getBoundingClientRect();
	const shown = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
	// The line or block around a small element, so the crop can show whole words beside it.
	let around = el;
	while (around.parentElement && around.getBoundingClientRect().width < 240) around = around.parentElement;
	const c = around.getBoundingClientRect();
	parent.postMessage({ mwRect: shown ? [r.x, r.y, r.width, r.height] : null, mwAround: [c.x, c.width] }, "*");`;

/**
 * The frame's document: an empty page with the replay stylesheet, and one script that installs
 * capture's page helpers, runs the shared replay on the fixture, then reports where it landed.
 * `stylesheet` is the URL of the fixture's stylesheets in their recorded order; `quirks` replays a
 * fixture captured in quirks mode without a doctype, as it was.
 */
export function frameDocument(o: {
	call: { source: string; args: unknown };
	stylesheet: string;
	focus: Focus | null;
	nonce: string;
	quirks: boolean;
}): string {
	const script = `
addEventListener("click", (e) => e.preventDefault(), true);
addEventListener("load", async () => {
	${INPAGE}
	try {
		await (${o.call.source})(${asData(o.call.args)});
	} catch (e) {
		// A step the sandbox does not allow (reaching into a nested frame) ends the replay early;
		// what was drawn so far is still shown.
		console.warn("replay stopped:", e);
	}
	await document.fonts.ready;
	${measure(o.focus)}
});`;
	return `${o.quirks ? "" : "<!doctype html>"}<html><head><meta charset="utf-8"><link id="replay" rel="stylesheet" href="${o.stylesheet}"><script nonce="${o.nonce}">${inScript(script)}</script></head><body></body></html>`;
}

/**
 * What a frame may do. It is sandboxed at its own address (`origin`, never the workbench's): its
 * one nonce'd script may run and reach the frames nested in its own document, and nothing else
 * may run. It may load the stylesheets, fonts and images served at that same address, inline
 * styles, and data: content the replay writes. No other network. Only the workbench page
 * (`page`) may show it.
 */
export function frameCsp(origin: string, page: string, nonce: string): string {
	return [
		"sandbox allow-scripts allow-same-origin",
		"default-src 'none'",
		`style-src ${origin}/css/ 'unsafe-inline'`,
		`font-src ${origin}/assets/ data:`,
		// Images: the app's own icons, the PDF viewer's, and pictures the replay writes as data:.
		`img-src ${origin}/assets/public/ ${origin}/assets/lib/pdfjs/images/ data:`,
		// The replay reads recorded canvas pixels from data: URLs.
		"connect-src data:",
		`script-src 'nonce-${nonce}'`,
		// Captured srcdoc iframes only; they inherit this policy.
		"frame-src about:",
		"base-uri 'none'",
		"form-action 'none'",
		`frame-ancestors ${page}`,
	].join("; ");
}
