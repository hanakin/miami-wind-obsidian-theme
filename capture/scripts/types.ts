// Shared shapes for the checklist, scenes and fixtures.
import type { Page } from "playwright";

/** Pseudo-classes we force through the DevTools protocol (CSS.forcePseudoState). */
export type Pseudo = "hover" | "active" | "focus" | "focus-visible" | "focus-within" | "visited";

/**
 * A target element. A plain string is a CSS selector. The object form also matches on text,
 * steps to a sibling, or picks the nth match. `in` limits the search to a root (the last modal,
 * the active leaf, ...): see `ROOTS` in inpage.ts.
 */
export type Target =
	| string
	| { sel: string; text?: string; next?: number; nth?: number; closest?: string; in?: string };

export interface Ctx {
	page: Page;
	/** Evaluate a function body in the main window. `app`, `sleep` and `cap` are in scope. */
	js<T = unknown>(body: string, arg?: unknown): Promise<T>;
	open(file: string, mode: Mode, opts?: { newLeaf?: boolean }): Promise<void>;
	command(id: string): Promise<boolean>;
	press(key: string): Promise<void>;
	sleep(ms: number): Promise<void>;
}

export type Mode = "live" | "source" | "reading";

export interface ItemDef {
	id: string;
	component: string;
	target: Target;
	/** Defaults to "default". Also the CSS state the fixture is marked with. */
	state?: string;
	/** Pseudo-classes to force on `pseudoOn` (default: the target). */
	pseudo?: Pseudo[];
	/** The state comes from the real pointer placed by `before` (not forced); only verified. */
	pointer?: boolean;
	pseudoOn?: Target;
	/** Runs before the element is looked up, after the scene setup and previous items. */
	before?: (ctx: Ctx) => Promise<void>;
	/** "document": keep the whole window in the fixture (overlays that show the page under them). */
	context?: "document";
	/** Screenshot the whole window instead of the element. */
	full?: boolean;
	/** Overrides the scene surface. */
	surface?: string;
	note?: string;
	/** Selector the target must match, proving an app-driven state (".is-active", ...). */
	expect?: string;
	/** Set when the state is scripted rather than reached through the UI: says how. */
	synthetic?: string;
	/** Lowest share of sample points where the target must be topmost (default 0.6). */
	minUnobscured?: number;
	/** Scroll this container top to bottom, screenshot every position and stack the shots. */
	scroll?: Target;
	/**
	 * JS body run in the page after the screenshot; its JSON result is stored as evidence.record.
	 * A `graphColors` map ({ "color-fill": 0xrrggbb, ... }) also gets exact-pixel counts from the
	 * screenshot (evidence.record.graphPixels).
	 */
	record?: string;
	/** Extra milliseconds to wait after forcing the state (CSS transitions with a delay). */
	settle?: number;
	/** Huge lists: keep `keep` matches of `sel` plus any matching `keepAlso`, and record the trim. */
	trim?: { sel: string; keep: number; keepAlso: string };
	/** CDP media emulation for this item (print, forced-colors, hover: none). */
	media?: { media?: string; features?: { name: string; value: string }[] };
}

export interface Scene {
	id: string;
	surface: string;
	/** Where the scene comes from: "app:<enumeration>" or "catalog:<group>". */
	source: string;
	setup: (ctx: Ctx) => Promise<void>;
	items: ItemDef[];
	/** Which window to snapshot: the main window (default), a popout, or the vault chooser. */
	window?: "main" | "popout" | "starter";
	/** For popout/starter scenes: runs in the main window and must open the new window. */
	opener?: (main: Ctx) => Promise<void>;
	/** Needs a real window on the desktop (full screen, maximized); captured by --windowed runs. */
	windowed?: boolean;
	/** Needs a desktop without a mouse ((hover: none)); captured by --no-pointer runs. */
	noPointer?: boolean;
	/** Emulated mobile app (Obsidian's app.emulateMobile) at phone or tablet size; captured by --mobile runs. */
	mobile?: "phone" | "tablet";
	/** Run in the main window after the scene, before extra windows close (release held work). */
	teardown?: (main: Ctx) => Promise<void>;
}

export interface ChecklistItem {
	id: string;
	scene: string;
	surface: string;
	component: string;
	state: string;
	source: string;
	target: Target;
	note?: string;
	/** Set when the item can never be captured, with the reason. */
	excluded?: string;
	/** What the fixture must prove: forced pseudo-classes, a state selector, a scripted state. */
	pseudo?: string[];
	expect?: string;
	synthetic?: string;
	minUnobscured?: number;
}

/**
 * One saved fixture. Its file is the target with its ancestors; marks in the markup:
 * - data-capture-target: the captured element; data-capture-state / -label / -pseudo / -visited:
 *   the states it was captured in (pseudo-classes are rewritten to these marks for replay).
 * - data-capture-placeholder: an empty stand-in for a sibling of an ancestor. It keeps element
 *   order and, with data-capture-size="W H" (border-box CSS px), data-capture-display and
 *   data-capture-margin="TOP BOTTOM" (margins of its children that collapsed through it), the
 *   layout around the target. Viewers give it that size, display and margins, and hide it and
 *   its content with visibility: hidden (not display: none). Small inline-level stand-ins keep
 *   their content (for their text baseline), without painted or state marks.
 * - data-capture-size on img (shown size of an image that does not load offline), video, audio,
 *   iframe, object, embed and webview: their live border-box size.
 * - data-capture-scroll="TOP LEFT": scroll offsets to restore after layout.
 * - data-capture-box="X Y W H": live box (CSS px, window coordinates) of the target, each
 *   ancestor and their direct children, and the first 300 elements inside the target, to check
 *   a replay part by part.
 * - data-capture-sel-anchor / data-capture-sel-focus="CHILD OFFSET": the native text selection,
 *   on the nearest element (CHILD -1: OFFSET counts that element's children).
 * - data-capture-input-selection="START END DIRECTION" on the focused field: its selected text.
 * - data-capture-cm-selection: CodeMirror's own selection ranges (reference only; the editor
 *   draws them as .cm-selectionBackground boxes, which are in the markup).
 * - data-capture-viewport / data-capture-styles on <html>: as viewport and styles below.
 * - <style data-capture-runtime="mathjax"> in <head>: MathJax's rule for each character in the
 *   fixture (MathJax keeps them only while the character is on screen). Viewers apply it.
 * capture/scripts/replay.ts replays a fixture this way; the coverage check compares the result
 * with the live screenshot.
 */
export interface FixtureEntry {
	id: string;
	file: string;
	/** Relative to ~/Work/miami-wind-obsidian-capture; empty for synthetic variants. */
	screenshot: string;
	component: string;
	surface: string;
	state: string;
	covers: string[];
	obsidianVersion: string;
	/** Components found inside the fixture (for showing one component across surfaces). */
	contains: string[];
	/** Set on synthetic platform variants: the Linux fixture they were made from. */
	variantOf?: string;
	platform?: "macos" | "windows";
	note?: string;
	synthetic?: string;
	/** Set when repeated children were dropped from the fixture (see ItemDef.trim). */
	trimmed?: string;
	evidence?: Evidence;
	/**
	 * Intrinsic size (naturalWidth/naturalHeight) of each image whose source does not load offline
	 * (app:, https:, file:), by zero-based index in the saved fixture's document.images order.
	 */
	imageSizes?: { index: number; width: number; height: number }[];
	/** "xhtml" when the tree cannot be written as HTML text (e.g. a <div> inside a <p>); parse it as application/xhtml+xml. */
	format?: "xhtml";
	/**
	 * Pixels of each painted <canvas>, by zero-based index in the saved fixture's canvas order:
	 * a PNG under capture/fixtures/ to draw into it. source "canvas" is the canvas's own pixels;
	 * "screen" is a crop of the window (WebGL canvases read back empty), so it also holds anything
	 * drawn over the canvas.
	 */
	canvasPixels?: { index: number; file: string; source: "canvas" | "screen" }[];
	/** Size in CSS pixels of the window the target lived in (also data-capture-viewport on <html>). */
	viewport?: [number, number];
	/**
	 * Stylesheets that window applied, in order (also data-capture-styles on <html>): "app"
	 * (Obsidian's app.css), "runtime" (styles Obsidian adds at run time, e.g. CodeMirror's, saved
	 * as capture/.app/runtime-styles.css), "theme" (theme.css). A starter window has no theme.
	 */
	styles?: string[];
	/**
	 * Every stylesheet the window applied, in document order: "app" (app.css), "theme"
	 * (theme.css), or the content hash of a runtime stylesheet saved as
	 * capture/.app/runtime/<hash>.css (local only, like app.css). Runtime sheets (CodeMirror,
	 * MathJax glyphs, slides) can exist only while their view shows, so each fixture names its own.
	 */
	runtimeStyles?: string[];
	/**
	 * "document": the whole window was kept, not just the target's branch: overlays that show the
	 * page under them (set on the item, or found: a positioned target without a solid background).
	 */
	context?: "document";
}

/** What the capture proved about one fixture, checked again by the coverage script. */
export interface Evidence {
	/** Target box and its part inside the window, in CSS pixels. */
	box: number[];
	inView: number[];
	/** Share of 9 sample points where the target (or its subtree) is the topmost element. */
	unobscured: number;
	/** Element counts per mark written from Element.matches() (hover, focus, ...) and our own marks. */
	marks: Record<string, number>;
	/** Pseudo-classes held during the snapshot (Chromium confirmed each through matches()). */
	forced: string[];
	/** How they were held: DevTools CSS.forcePseudoState or the real pointer. */
	via?: "devtools" | "pointer";
	/** Selector the target matched to prove the app state, if the item has one. */
	expect?: string;
	/** theme.css selector ids that hit a seen element in the off-page copy of the live document. */
	live: string[];
	/** Selector ids that only hit elements in the scope that were not visibly painted. */
	domOnly?: string[];
	/** Number of elements recorded as visibly painted inside the screenshot clip. */
	seen?: number;
	/** Screenshot clip in CSS pixels. */
	clip?: number[];
	/** Author rules per forced pseudo-class that Chromium matched on the forced element. */
	painted?: Record<string, number>;
	/** Result of the item's record script (see ItemDef.record). */
	record?: {
		graphColors?: Record<string, number>;
		graphPixels?: Record<string, number>;
		[k: string]: unknown;
	};
	/** Claimed states proven live (Element.matches) or by a DevTools-matched author rule. */
	verified?: string[];
	/** Claimed states nothing proved; they are not marked in the fixture. */
	unverified?: string[];
	/** Element boxes (with ::before/::after) whose painted style changed when the state was forced. */
	styleChanged?: number;
	/** When nothing of the target was recorded as painted: the hit stack at its center (top first). */
	stackAtCenter?: string[];
	/** Which boxes and properties changed (first 12). */
	styleProps?: string[];
	scroll?: { positions: number[]; scrollHeight: number; clientHeight: number };
	media?: string;
	/** The window's input media at capture: (hover: hover) and (pointer: fine). */
	/** dark: (prefers-color-scheme: dark); canvas: the system color Canvas (forced colors' palette). */
	inputMedia?: { hover: boolean; finePointer: boolean; dark?: boolean; canvas?: string };
	screenshot?: { sha256: string; width: number; height: number; colors: number };
}
