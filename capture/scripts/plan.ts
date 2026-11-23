// Turns the app inventory and the catalog into the full scene list and the checklist items.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import selectorParser from "postcss-selector-parser";
import { classesOf, keyClassesOf, type SelectorEntry, selectors } from "./css.ts";
import {
	type AppInventory,
	type CommandResult,
	commandScenes,
	settingsScenes,
	viewScenes,
} from "./discover.ts";
import { catalogScenes } from "./scenes.ts";
import { extraScenes } from "./scenes-extra.ts";
import { qcScenes } from "./scenes-qc.ts";
import type { ChecklistItem, Scene, Target } from "./types.ts";

export const ROOT = new URL("../../", import.meta.url).pathname;
export const CAPTURE = `${ROOT}capture/`;

export interface Exclusions {
	/** Body/html classes that only exist outside desktop dark Linux, with the reason. */
	appClassGates: Record<string, string>;
	/** At-rule contexts we do not render (print, forced colors), with the reason. */
	appContexts: Record<string, string>;
	/** Individual app classes, with the reason. */
	appClasses: Record<string, string>;
	/** App classes matching a regular expression, with the reason. */
	appClassPatterns: Record<string, string>;
	/** theme.css selectors that can never match, with the reason. */
	themeSelectors: Record<string, string>;
	/** Platform-only app.css selectors a class-swapped variant cannot reach, with the reason. */
	platformSelectors: Record<string, string>;
}

/** Every class seen on any element while the capture ran (runtime DOM census, capture.ts). */
let shippedText: string | undefined;
/**
 * True when Obsidian's shipped code holds a string that could build the class: the whole name, or
 * a quoted prefix ("mod-) or suffix (-item") that a template could join with something else.
 */
export function constructible(name: string): boolean {
	if (shippedText === undefined) {
		const dir = `${CAPTURE}.app/js/`;
		const parts: string[] = [];
		for (const f of readdirSync(dir, { recursive: true }).map(String)) {
			if (/\.(m?js|html)$/.test(f)) parts.push(readFileSync(`${dir}${f}`, "utf8"));
		}
		shippedText = parts.join("\n");
	}
	const text = shippedText;
	if (new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, "\\-")}([^\\w-]|$)`).test(text)) return true;
	const bits = name.split("-");
	for (let k = 1; k < bits.length; k++) {
		// Only a standalone fragment can be joined: "head-" / `head-${…}` or "-tail" / ${…}-tail.
		const head = `${bits.slice(0, k).join("-")}-`;
		const tail = `-${bits.slice(k).join("-")}`;
		for (const q of ['"', "'", "`"]) {
			if (text.includes(`${q}${head}${q}`) || text.includes(`${q}${tail}${q}`)) return true;
		}
		if (text.includes(`\`${head}\${`) || text.includes(`}${tail}`)) return true;
	}
	return false;
}

export const UNSEEN =
	"dead CSS: never seen in the runtime class census of the full capture (headless and windowed runs), and Obsidian's shipped code holds no string that could build it (not the name, nor a quoted prefix or suffix a template could join)";

export function census(): Set<string> {
	const path = `${CAPTURE}class-census.json`;
	if (!existsSync(path)) return new Set();
	return new Set(JSON.parse(readFileSync(path, "utf8")) as string[]);
}

export function loadExclusions(): Exclusions {
	return JSON.parse(readFileSync(`${CAPTURE}exclusions.json`, "utf8")) as Exclusions;
}

export function allScenes(
	inv: AppInventory,
	cmds: CommandResult[],
	layout: () => unknown,
): Scene[] {
	return [
		...catalogScenes(),
		...extraScenes(),
		...qcScenes(),
		...viewScenes(inv),
		...settingsScenes(inv),
		...commandScenes(cmds, layout),
	];
}

export function checklistItems(scenes: Scene[]): ChecklistItem[] {
	const seen = new Set<string>();
	const items: ChecklistItem[] = [];
	for (const s of scenes) {
		for (const i of s.items) {
			if (seen.has(i.id)) throw new Error(`duplicate item id ${i.id}`);
			seen.add(i.id);
			items.push({
				id: i.id,
				scene: s.id,
				surface: i.surface ?? s.surface,
				component: i.component,
				state: i.state ?? (i.pseudo ? i.pseudo.join("+") : "default"),
				source: s.source,
				target: i.target,
				...(i.note ? { note: i.note } : {}),
				...(i.pseudo?.length ? { pseudo: i.pseudo } : {}),
				...(i.expect ? { expect: i.expect } : {}),
				...(i.synthetic ? { synthetic: i.synthetic } : {}),
				...(i.minUnobscured !== undefined ? { minUnobscured: i.minUnobscured } : {}),
			});
		}
	}
	return items;
}

/** Classes outside any :not(), the only ones that gate a rule to a context. */
export function positiveClassesOf(selector: string): string[] {
	const found = new Set<string>();
	selectorParser((root) => {
		root.walkClasses((c) => {
			for (let p = c.parent; p; p = p.parent) {
				if (p.type === "pseudo" && (p as { value: string }).value === ":not") return;
			}
			found.add(c.value);
		});
	}).processSync(selector);
	return [...found];
}

export interface AppClassStatus {
	name: string;
	/** Reason when every rule using the class is gated to a context we exclude. */
	excluded?: string;
}

export function appClassStatuses(app: SelectorEntry[], ex: Exclusions): AppClassStatus[] {
	const byClass = new Map<string, SelectorEntry[]>();
	for (const s of app) {
		for (const c of classesOf(s.selector)) {
			const list = byClass.get(c) ?? [];
			list.push(s);
			byClass.set(c, list);
		}
	}
	const gateOf = (s: SelectorEntry): string | undefined => {
		for (const [ctx, why] of Object.entries(ex.appContexts))
			if (s.context.includes(ctx)) return why;
		for (const c of positiveClassesOf(s.selector))
			if (ex.appClassGates[c]) return ex.appClassGates[c];
		return undefined;
	};
	const seen = census();
	return [...byClass.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, list]) => {
			if (ex.appClasses[name]) return { name, excluded: ex.appClasses[name] };
			for (const [re, why] of Object.entries(ex.appClassPatterns)) {
				if (new RegExp(re).test(name)) return { name, excluded: why };
			}
			if (ex.appClassGates[name]) return { name, excluded: ex.appClassGates[name] };
			const gates = list.map(gateOf);
			if (!seen.has(name) && !constructible(name)) return { name, excluded: UNSEEN };
			if (gates.every((g) => g !== undefined))
				return { name, excluded: [...new Set(gates)].join("; ") };
			return { name };
		});
}

function targetText(t: Target): string {
	return typeof t === "string" ? t : t.sel;
}

/** Planned items per theme selector: items whose target names one of the selector's key classes. */
export function plannedCoverage(
	theme: SelectorEntry[],
	items: ChecklistItem[],
): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const s of theme) {
		const keys = keyClassesOf(s.selector);
		const all = classesOf(s.selector);
		const wantState = /:(hover|active|focus)/.test(s.selector);
		const hits = items.filter((i) => {
			const t = targetText(i.target);
			const named = (keys.length ? keys : all).some((k) => new RegExp(`\\.${k}(?![\\w-])`).test(t));
			if (!named) return false;
			return !wantState || /hover|active|focus/.test(i.state);
		});
		out.set(
			s.id,
			hits.slice(0, 6).map((i) => i.id),
		);
	}
	return out;
}

export function themeSelectors(): SelectorEntry[] {
	return selectors(readFileSync(`${ROOT}theme.css`, "utf8"));
}

export function appSelectors(): SelectorEntry[] {
	return selectors(readFileSync(`${CAPTURE}.app/app.css`, "utf8"));
}

/** Reason a theme.css selector can never match, from exclusions.json. */
export function themeExclusion(selector: string, ex: Exclusions): string | undefined {
	return ex.themeSelectors[selector];
}

export interface PlatformItem {
	id: string;
	platform: "macos" | "windows";
	selector: string;
	line: number;
	excluded?: string;
}

/** app.css selectors that only apply with mod-macos / mod-windows on <body>, one item each. */
export function platformItems(): PlatformItem[] {
	const ex = loadExclusions();
	const out: PlatformItem[] = [];
	for (const [n, s] of appSelectors().entries()) {
		if (Object.keys(ex.appContexts).some((c) => s.context.includes(c))) continue;
		const pos = positiveClassesOf(s.selector);
		if (pos.some((c) => ex.appClassGates[c])) continue;
		for (const platform of ["macos", "windows"] as const) {
			if (pos.includes(`mod-${platform}`)) {
				out.push({
					// app.css is minified onto one line, so number by position in the file.
					id: `platform.${platform}.${n}`,
					platform,
					selector: s.selector,
					line: s.line,
					excluded: platformExclusion(s.selector, ex),
				});
			}
		}
	}
	return out;
}

export function platformChecklistItems(): ChecklistItem[] {
	return platformItems().map((p) => ({
		id: p.id,
		scene: "platform-variants",
		surface: `platform-${p.platform}`,
		component: "platform-variant",
		state: p.platform,
		source: `app:app.css:${p.line}`,
		target: p.selector,
		note: `A fixture with body.mod-${p.platform} must match this app.css selector (synthetic variant of a Linux capture).`,
		synthetic: `body.mod-linux swapped for mod-${p.platform} on a Linux capture`,
		...(p.excluded ? { excluded: p.excluded } : {}),
	}));
}

function platformExclusion(selector: string, ex: Exclusions): string | undefined {
	return ex.platformSelectors[selector];
}
