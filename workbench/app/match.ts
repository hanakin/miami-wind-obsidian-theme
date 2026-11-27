// Finds which source file styles which item by testing every source selector against every
// capture's markup in a headless browser. Slow enough (tens of seconds) to be cached on disk,
// keyed by everything it depends on.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { matchable } from "../../capture/scripts/css.ts";
import { COMPONENTS } from "../../capture/scripts/engine.ts";
import { type Compound, lastCompounds, type Probe, probes, type RuleHit } from "./organization.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CACHE = `${ROOT}workbench/out/organization.json`;

interface Capture {
	file: string;
	component: string;
	contains: string[];
}

/** Runs in the browser: the (item, source file) pairs one batch of captures gives. */
function hits(args: {
	captures: { html: string; xml: boolean; component: string; contains: string[] }[];
	probes: Probe[];
	selectors: Record<string, string>;
	/** Each item's own selector, as the names of each of its alternatives. */
	names: Record<string, Compound[]>;
}): string[] {
	const found = new Set<string>();
	for (const capture of args.captures) {
		const doc = new DOMParser().parseFromString(
			capture.html,
			capture.xml ? "application/xhtml+xml" : "text/html",
		);
		// The elements that are an item here: what the capture targets, and what each item's own
		// selector finds. A whole-window target would claim everything, so it claims nothing.
		const owners = new Map<Element, string[]>();
		const own = (el: Element, item: string) => owners.set(el, [...(owners.get(el) ?? []), item]);
		const target = doc.querySelector("[data-capture-target]");
		if (
			target &&
			target !== doc.body &&
			target !== doc.documentElement &&
			!args.selectors[capture.component]
		) {
			own(target, capture.component);
		}
		for (const item of new Set([capture.component, ...capture.contains])) {
			const selector = args.selectors[item];
			if (selector) for (const el of doc.querySelectorAll(selector)) own(el, item);
		}
		if (owners.size === 0) continue;
		for (const [index, probe] of args.probes.entries()) {
			let matched: Element[];
			try {
				matched = Array.from(doc.querySelectorAll(probe.full)).slice(0, 40);
			} catch {
				continue;
			}
			// The rule counts for an item only when it selects the item's own element and calls it
			// by the item's own name. An item with no selector of its own is its captured element.
			const calls = (item: string) => {
				const own = args.names[item];
				return (
					!own ||
					own.some(
						(name) =>
							(name.tag !== undefined || name.classes.length + name.attributes.length > 0) &&
							(!name.tag || name.tag === probe.last.tag) &&
							name.classes.every((c) => probe.last.classes.includes(c)) &&
							name.attributes.every((a) => probe.last.attributes.includes(a)),
					)
				);
			};
			// The rule reaches an item only when it selects the item's own element; it names the
			// item when its last part also carries the item's own class or element.
			for (const el of matched) {
				for (const item of owners.get(el) ?? []) {
					found.add(`${item}\n${index}\n${calls(item) ? "named" : "selected"}`);
				}
			}
		}
	}
	return [...found];
}

/**
 * Every source rule that reaches an item, found by testing the rules against the captures.
 * `files` are the source files as "folder/file.css" with their text.
 */
export async function styledBy(files: { path: string; css: string }[]): Promise<RuleHit[]> {
	const index = readFileSync(`${ROOT}capture/fixtures.json`, "utf8");
	const list = probes(files, matchable);
	// Everything the answer depends on: the selectors tested, the captures, and how they are matched.
	const key = createHash("sha256")
		.update(JSON.stringify([files.map((f) => f.path), list, index, COMPONENTS, hits.toString()]))
		.digest("hex");
	if (existsSync(CACHE)) {
		const cached = JSON.parse(readFileSync(CACHE, "utf8")) as {
			key: string;
			styled: RuleHit[];
		};
		if (cached.key === key) return cached.styled;
	}
	const names = Object.fromEntries(
		Object.entries(COMPONENTS).map(([item, selector]) => [item, lastCompounds(selector)]),
	);
	const captures = (JSON.parse(index) as { fixtures: Capture[] }).fixtures;
	const browser = await chromium.launch();
	const pairs = new Set<string>();
	try {
		const page = await browser.newPage();
		// Batches keep each hand-off to the browser to a few megabytes.
		let batch: Parameters<typeof hits>[0]["captures"] = [];
		let size = 0;
		const flush = async () => {
			if (batch.length === 0) return;
			for (const pair of await page.evaluate(hits, {
				captures: batch,
				probes: list,
				selectors: COMPONENTS,
				names,
			})) {
				pairs.add(pair);
			}
			batch = [];
			size = 0;
		};
		for (const c of captures) {
			const html = readFileSync(`${ROOT}capture/fixtures/${c.file}`, "utf8");
			batch.push({
				html,
				xml: html.startsWith("<?xml"),
				component: c.component,
				contains: c.contains,
			});
			size += html.length;
			if (size > 3_000_000) await flush();
		}
		await flush();
	} finally {
		await browser.close();
	}
	// One entry per item and rule; a rule that names the item wins over one that only selects it.
	const byRule = new Map<string, RuleHit>();
	for (const pair of pairs) {
		const [item = "", index = "0", how = ""] = pair.split("\n");
		const probe = list[Number(index)];
		if (!probe) continue;
		const file = files[probe.file]?.path ?? "";
		const key = `${item}\n${file}\n${probe.line}\n${probe.selector}`;
		const named = how === "named" || byRule.get(key)?.named === true;
		byRule.set(key, {
			item,
			file,
			line: probe.line,
			selector: probe.selector,
			named,
			adjustment: probe.adjustment,
		});
	}
	const styled = [...byRule.values()];
	mkdirSync(`${ROOT}workbench/out`, { recursive: true });
	writeFileSync(CACHE, JSON.stringify({ key, styled }));
	return styled;
}
