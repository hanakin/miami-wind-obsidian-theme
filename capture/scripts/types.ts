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
	pseudoOn?: Target;
	/** Runs before the element is looked up, after the scene setup and previous items. */
	before?: (ctx: Ctx) => Promise<void>;
	/** Screenshot the whole window instead of the element. */
	full?: boolean;
	/** Overrides the scene surface. */
	surface?: string;
	note?: string;
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
}

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
}
