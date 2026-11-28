import { expect, it } from "vitest";
import { frameCsp, frameDocument, replayCall, sanitize } from "./frame.ts";

it("strips scripts and inline handlers from captured markup", () => {
	expect(sanitize('<p onclick="x()" class="a">hi</p><script>alert(1)</script>')).toBe(
		'<p class="a">hi</p>',
	);
	expect(sanitize("<SCRIPT src=x></SCRIPT><img src=a onerror=alert(1)>")).toBe("<img src=a>");
	expect(sanitize("<script>unclosed")).toBe("unclosed");
	expect(sanitize('<div style="left: 4px">on = off</div>')).toBe(
		'<div style="left: 4px">on = off</div>',
	);
});

const input = (html: string) => ({
	html,
	sizes: [],
	canvases: [],
	frames: {},
	trimSelector: null,
	options: { forceRecordedGeometry: false },
});

it("takes the shared replay's own page step, with the fixture cleaned first", async () => {
	const call = await replayCall(
		input('<html><body onload="evil()"><b>x</b><script>evil()</script></body></html>'),
	);
	// The function capture's replayFixture runs in a page, not a copy of it.
	expect(call.source).toContain("DOMParser");
	expect(call.source).toContain("data-capture-runtime");
	const [html, , , , , force] = call.args as [string, unknown, unknown, unknown, unknown, boolean];
	expect(html).toBe("<html><body><b>x</b></body></html>");
	expect(force).toBe(false);
});

it("puts one script in the frame, behind the nonce, and nothing can close it early", async () => {
	const call = await replayCall(
		input("<html><body><p>a </script><script>evil()</script> <!-- b</p></body></html>"),
	);
	const doc = frameDocument({
		call,
		stylesheet: "/css/replay/abc.css",
		focus: { is: "button", not: [".clickable-icon"] },
		nonce: "N1",
		quirks: false,
	});
	expect(doc.startsWith("<!doctype html>")).toBe(true);
	expect(doc.match(/<script/g)).toHaveLength(1);
	expect(doc.match(/<\/script/g)).toHaveLength(1);
	expect(doc).toContain('<script nonce="N1">');
	expect(doc).not.toContain("<!--");
	expect(doc).toContain('<link id="replay" rel="stylesheet" href="/css/replay/abc.css">');
	// A fixture captured in quirks mode is replayed without a doctype.
	expect(
		frameDocument({
			call,
			stylesheet: "/s.css",
			focus: null,
			nonce: "N1",
			quirks: true,
		}).startsWith("<html>"),
	).toBe(true);
});

it("allows only the nonce'd script and the frame address's own paths", () => {
	const csp = frameCsp("http://127.0.0.1:5176", "http://127.0.0.1:5175", "N1");
	expect(csp).toContain("script-src 'nonce-N1'");
	expect(csp).not.toContain("unsafe-eval");
	expect(csp).toContain("default-src 'none'");
	expect(csp).toContain("connect-src data:;");
	expect(csp).toContain("img-src http://127.0.0.1:5176/assets/ data: blob:");
	// Nothing in it names the workbench's own address except who may show the frame.
	expect(csp.split("5175")).toHaveLength(2);
	expect(csp).toContain("frame-ancestors http://127.0.0.1:5175");
});
