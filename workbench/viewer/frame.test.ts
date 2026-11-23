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
