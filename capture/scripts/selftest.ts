// Regression tests for the in-page witness (what counts as visibly painted).
// Usage: bun run capture:selftest   (plain Chromium page, no Obsidian needed)
import { chromium } from "playwright";
import { INPAGE } from "./inpage.ts";

const CASES: { name: string; html: string; seen: boolean }[] = [
	{
		// An opaque parent paints over a child with a negative z-index: the screenshot is red.
		name: "child under its opaque parent (z-index: -1)",
		html: `<div id="p" style="width:200px;height:100px;background:red"><div id="t" style="position:relative;z-index:-1;width:100px;height:50px;background:blue"></div></div>`,
		seen: false,
	},
	{
		name: "child on top of its opaque parent",
		html: `<div id="p" style="width:200px;height:100px;background:red"><div id="t" style="width:100px;height:50px;background:blue"></div></div>`,
		seen: true,
	},
	{
		// A transparent pointer blocker (like a canvas group overlay) paints nothing.
		name: "element under a layer that paints nothing",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><div style="position:absolute;left:0;top:0;width:300px;height:300px"></div>`,
		seen: true,
	},
	{
		name: "element under an opaque sibling",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><div style="position:absolute;left:0;top:0;width:300px;height:300px;background:green"></div>`,
		seen: false,
	},
	{
		// A child that ignores hits (pointer-events: none) still paints above its parent.
		name: "pointer-events: none child over its parent",
		html: `<div style="width:200px;height:100px;background:red"><div id="t" style="pointer-events:none;width:100px;height:50px;background:blue"></div></div>`,
		seen: true,
	},
	{
		// The parent's positioned ::before overlay paints nothing (like .metadata-properties-heading).
		name: "child under its parent's transparent ::before overlay",
		html: `<style>#p{position:relative;width:200px;height:60px}#p::before{content:"";position:absolute;inset:0}</style><div id="p"><span id="t" style="color:blue">Properties</span></div>`,
		seen: true,
	},
	{
		name: "child under its parent's opaque ::before overlay",
		html: `<style>#p{position:relative;width:200px;height:60px}#p::before{content:"";position:absolute;inset:0;background:red}</style><div id="p"><span id="t" style="color:blue">Properties</span></div>`,
		seen: false,
	},
	{
		// A translucent fill above (like a canvas group) only tints the element below.
		name: "element under a 10% tint",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><div style="position:absolute;left:0;top:0;width:300px;height:300px;background:rgba(255,0,0,0.1)"></div>`,
		seen: true,
	},
	{
		name: "element under a 90% fill",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><div style="position:absolute;left:0;top:0;width:300px;height:300px;background:rgba(255,0,0,0.9)"></div>`,
		seen: false,
	},
	{
		// Half covered by an opaque sibling at its center: the uncovered half still shows.
		name: "element half covered by an opaque sibling",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><div style="position:absolute;left:60px;top:0;width:300px;height:300px;background:green"></div>`,
		seen: true,
	},
	{
		// An opaque layer that ignores the pointer still paints over the element.
		name: "element under an opaque pointer-events: none sibling",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><div style="position:absolute;left:0;top:0;width:300px;height:300px;background:green;pointer-events:none"></div>`,
		seen: false,
	},
	{
		// Modern color syntax: the ancestor's oklch() background covers its negative-z child.
		name: "negative-z child under an opaque oklch() parent",
		html: `<div id="p" style="width:200px;height:100px;background:oklch(0.6 0.2 25)"><div id="t" style="position:relative;z-index:-1;width:100px;height:50px;background:blue"></div></div>`,
		seen: false,
	},
	{
		name: "element under an oklch() 10% tint",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><div style="position:absolute;left:0;top:0;width:300px;height:300px;background:oklch(0.6 0.2 25 / 0.1)"></div>`,
		seen: true,
	},
	{
		// An invisible tap target (opacity: 0 select over a label) paints nothing.
		name: "label under an opacity: 0 select",
		html: `<label style="position:relative;display:inline-block"><span id="t" style="color:blue;font:16px sans-serif">vault</span><select style="position:absolute;inset:0;opacity:0;width:100%"><option>a</option></select></label>`,
		seen: true,
	},
	{
		// A child sets visibility back to visible inside a hidden parent (Obsidian's tab-drag overlay).
		name: "visible child of a visibility: hidden parent",
		html: `<div style="visibility:hidden;width:300px;height:200px;background:red"><div id="t" style="visibility:visible;width:100px;height:50px;background:blue"></div></div>`,
		seen: true,
	},
	{
		// A border-only frame laid over a field (like pdf.js XFA borders) covers only its edges.
		name: "field under a border-only frame",
		html: `<div id="t" style="position:absolute;left:10px;top:10px;width:200px;height:40px;background:blue"></div><div style="position:absolute;left:5px;top:5px;width:210px;height:50px;border:2px solid black"></div>`,
		seen: true,
	},
	{
		// A full-size <svg> layer (canvas edges) paints only where its shapes are.
		name: "element under an empty full-size svg layer",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><svg style="position:absolute;left:0;top:0" width="300" height="300"><path d="M250 250 L260 260" stroke="red"/></svg>`,
		seen: true,
	},
	{
		name: "element under an svg shape",
		html: `<div id="t" style="width:200px;height:100px;background:blue"></div><svg style="position:absolute;left:0;top:0" width="300" height="300"><rect x="0" y="0" width="300" height="300" fill="red"/></svg>`,
		seen: false,
	},
	{
		// A zero-size wrapper of absolutely placed boxes (like .search-highlight) shows through them.
		name: "zero-size wrapper of painted children",
		html: `<div style="position:relative;width:300px;height:200px"><div id="t"><div style="position:absolute;left:10px;top:10px;width:80px;height:20px;background:yellow"></div></div></div>`,
		seen: true,
	},
	{
		// A fixed box inside zero-size, overflow: hidden copies of the layout (Obsidian's tab-drag
		// preview) is not clipped by them.
		name: "fixed box inside a zero-size clipping parent",
		html: `<div style="position:absolute;width:0;height:0;overflow:hidden;visibility:hidden"><div id="t" style="position:fixed;visibility:visible;left:20px;top:20px;width:100px;height:50px;background:blue"></div></div>`,
		seen: true,
	},
	{
		// A transformed parent becomes the fixed box's containing block, and its clip applies.
		name: "fixed box inside a transformed zero-size clipping parent",
		html: `<div style="position:absolute;width:0;height:0;overflow:hidden;transform:translate(0)"><div id="t" style="position:fixed;left:20px;top:20px;width:100px;height:50px;background:blue"></div></div>`,
		seen: false,
	},
	{
		// Inline text wrapping onto two lines: its box center can fall between fragments.
		name: "wrapped inline element",
		html: `<p style="width:120px;font:16px sans-serif">aaaa <span id="t" style="color:blue">bbbbbbb ccccccccc</span> dd</p>`,
		seen: true,
	},
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
let failed = 0;
for (const c of CASES) {
	await page.setContent(`<body style="margin:0">${c.html}</body>`);
	await page.evaluate(INPAGE);
	const r = (await page.evaluate(`(() => {
		const t = document.getElementById("t");
		window.__cap.target = t;
		cap.witness(t, [0, 0, 400, 300]);
		return { seen: window.__cap.seen.has(t), unobscured: cap.visibility(t).unobscured };
	})()`)) as { seen: boolean; unobscured: number };
	// Zero-size elements have no visibility score of their own; only seen is checked for them.
	const ok =
		r.seen === c.seen &&
		(r.unobscured === undefined || (c.seen ? r.unobscured > 0 : r.unobscured === 0));
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: seen=${r.seen} unobscured=${r.unobscured}`);
}
await browser.close();
if (failed) {
	console.error(`${failed} witness test(s) failed`);
	process.exit(1);
}
