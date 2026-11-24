// Builds the document one fixture frame shows. The captured markup is untrusted: it is stripped
// of scripts and inline handlers here, and the response headers (plugin.ts) forbid the rest.

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

/** Intrinsic size of one image, by its index in document.images (the compare tool's imageSizes). */
export interface ImageSize {
	index: number;
	width: number;
	height: number;
}

// Runs inside the frame: tells the viewer where the element to show sits, or null when it is
// missing or not visible. With a focus selector it looks for that component in the capture.
const measure = (focus: Focus | null, images: ImageSize[]) => `
addEventListener("click", (e) => e.preventDefault(), true);
addEventListener("DOMContentLoaded", () => {
	// Captured images cannot load here. A grey image of the recorded size keeps the layout, the same
	// way the compare tool does it.
	const all = Array.from(document.images);
	for (const { index, width, height } of ${JSON.stringify(images)}) {
		const image = all[index];
		if (!image || image.matches(".cm-widgetBuffer") || !image.getAttribute("src")?.trim()) continue;
		image.removeAttribute("srcset");
		image.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '"><rect width="100%" height="100%" fill="gray"/></svg>');
	}
});
addEventListener("load", async () => {
	await document.fonts.ready;
	const focus = ${JSON.stringify(focus)};
	const visible = (e) => e.getClientRects().length > 0 && e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
	const target = document.querySelector("[data-capture-target]") ?? document.body;
	const mine = (e) => e.matches(focus.is) && !focus.not.some((s) => e.matches(s)) && visible(e);
	const el = focus ? [target, ...target.querySelectorAll(focus.is)].find(mine) : visible(target) && target;
	if (!el) return parent.postMessage({ mwRect: null }, "*");
	// Bring an element below the fold into view. Not scrollIntoView: it would scroll the viewer too.
	let r = el.getBoundingClientRect();
	for (let a = el.parentElement; a && (r.bottom > innerHeight || r.top < 0); a = a.parentElement) {
		a.scrollTop += r.top - a.getBoundingClientRect().top - (a.clientHeight - r.height) / 2;
		r = el.getBoundingClientRect();
	}
	const shown = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
	parent.postMessage({ mwRect: shown ? [r.x, r.y, r.width, r.height] : null }, "*");
});`;

const decode = (attr: string) =>
	attr
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, "\u00a0")
		.replace(/&amp;/g, "&");
const encode = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Iframes Obsidian fills by script were captured as srcdoc without their stylesheets. Each gets
 * the same stylesheets as the outer frame and an empty sandbox: it only has to draw.
 */
function innerFrames(html: string, links: string): string {
	// Quoted attribute values may hold ">" (the srcdoc does), so the tag is matched around them.
	return html.replace(/<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
		const open = tag
			.replace(/\ssandbox(="[^"]*")?/gi, "")
			.replace(/^<iframe/i, '<iframe sandbox=""');
		return open.replace(/\ssrcdoc="([^"]*)"/i, (_, doc: string) => {
			const inner = sanitize(decode(doc)).replace(/<base\b[^>]*>/gi, "");
			const styled = /<head[^>]*>/i.test(inner)
				? inner.replace(/<head[^>]*>/i, (head) => head + links)
				: links + inner;
			return ` srcdoc="${encode(styled)}"`;
		});
	});
}

/**
 * The fixture with its stylesheets in the compare tool's order (CodeMirror runtime rules, app
 * CSS, theme) and the measuring script. `styles` are stylesheet URLs; `nonce` matches the CSP.
 */
export function frameDocument(
	html: string,
	styles: string[],
	focus: Focus | null,
	nonce: string,
	images: ImageSize[] = [],
): string {
	const links = styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("");
	const head = `<head><meta charset="utf-8">${links}<script nonce="${nonce}">${measure(focus, images)}</script></head>`;
	return innerFrames(sanitize(html), links).replace(/<head>[\s\S]*?<\/head>/i, head);
}

/** What a frame may load: our stylesheets and fonts, inline styles, and the one nonce'd script. */
export function frameCsp(origin: string, nonce: string): string {
	return [
		"sandbox allow-scripts",
		"default-src 'none'",
		`style-src ${origin} 'unsafe-inline'`,
		`font-src ${origin}`,
		`img-src ${origin} data:`,
		`script-src 'nonce-${nonce}'`,
		// Captured srcdoc iframes only; they inherit this policy.
		"frame-src about:",
		"base-uri 'none'",
		"form-action 'none'",
		`frame-ancestors ${origin}`,
	].join("; ");
}
