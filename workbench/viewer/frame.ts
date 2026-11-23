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

// Runs inside the frame: tells the viewer where the element to show sits, or null when it is
// missing or not visible. With a focus selector it looks for that component in the capture.
const measure = (focus: Focus | null) => `
addEventListener("click", (e) => e.preventDefault(), true);
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

/**
 * The fixture with its stylesheets in the compare tool's order (CodeMirror runtime rules, app
 * CSS, theme) and the measuring script. `styles` are stylesheet URLs; `nonce` matches the CSP.
 */
export function frameDocument(
	html: string,
	styles: string[],
	focus: Focus | null,
	nonce: string,
): string {
	const links = styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("");
	const head = `<head><meta charset="utf-8">${links}<script nonce="${nonce}">${measure(focus)}</script></head>`;
	return sanitize(html).replace(/<head>[\s\S]*?<\/head>/i, head);
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
		"base-uri 'none'",
		"form-action 'none'",
		`frame-ancestors ${origin}`,
	].join("; ");
}
