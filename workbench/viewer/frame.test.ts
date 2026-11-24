import { expect, it } from "vitest";
import { frameCsp, frameDocument, sanitize } from "./frame.ts";

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

it("puts only the viewer's own script in the frame, behind the nonce", () => {
	const doc = frameDocument(
		'<html><head><meta charset="utf-8"><script>evil()</script></head><body onload="evil()"><b>x</b></body></html>',
		["/css/cm.css", "/css/app.css", "/css/new.css"],
		{ is: "button", not: [".clickable-icon"] },
		"N1",
	);
	expect(doc).not.toContain("evil");
	expect(doc.match(/<script/g)).toHaveLength(1);
	expect(doc).toContain('<script nonce="N1">');
	expect(doc.indexOf("cm.css")).toBeLessThan(doc.indexOf("app.css"));
	expect(doc.indexOf("app.css")).toBeLessThan(doc.indexOf("new.css"));
	const csp = frameCsp("http://127.0.0.1:5175", "N1");
	expect(csp).toContain("script-src 'nonce-N1'");
	expect(csp).toContain("sandbox allow-scripts;");
	expect(csp).not.toContain("allow-same-origin");
});

it("styles captured srcdoc iframes like the outer frame and locks them down", () => {
	const inner =
		'<!doctype html><html><head><base href="app://obsidian.md/index.html"></head><body onload="evil()"><p class="a">A &amp; B</p></body></html>';
	const attr = inner.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
	const doc = frameDocument(
		`<html><head><meta charset="utf-8"></head><body><iframe class="embed-iframe" sandbox="allow-same-origin allow-scripts" srcdoc="${attr}" data-capture-iframe-styles="link app.css"></iframe><img src="app://x/a.png"></body></html>`,
		["/css/app.css", "/css/new.css"],
		null,
		"N1",
		[{ index: 0, width: 480, height: 270 }],
	);
	expect(doc).toContain('<iframe sandbox="" class="embed-iframe"');
	expect(doc).not.toContain("allow-same-origin");
	expect(doc).not.toContain("evil");
	expect(doc).not.toContain("app://obsidian.md");
	// The inner document carries the same stylesheet links, escaped inside the attribute.
	expect(doc).toContain("<head><link rel=&quot;stylesheet&quot; href=&quot;/css/app.css&quot;>");
	expect(doc).toContain("A &amp;amp; B");
	expect(doc).toContain('"width":480,"height":270');
	expect(frameCsp("http://127.0.0.1:5175", "N1")).toContain("frame-src about:");
});
