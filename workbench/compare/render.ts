import type { CDPSession, Page } from "playwright";
import { COMPONENTS } from "../../capture/scripts/engine";
import type { ElementStyle, Sample } from "./model";
export interface Rendered {
	styles: ElementStyle[];
	samples: Sample[];
	png: Buffer;
	invisibleTarget: boolean;
	unsupported: string[];
	replayIssues: string[];
}
const documents = new WeakMap<
	Page,
	{ html: string; cm: string; app: string; theme: string }
>();
export async function render(
	page: Page,
	cdp: CDPSession,
	html: string,
	css: { cm: string; app: string; theme: string },
	fixture: { component: string; surface: string; state: string },
): Promise<Rendered> {
	const previous = documents.get(page);
	if (
		!previous ||
		previous.html !== html ||
		previous.cm !== css.cm ||
		previous.app !== css.app
	) {
		await page.setContent(html, { waitUntil: "domcontentloaded" });
		for (const content of [css.cm, css.app])
			if (content) await page.addStyleTag({ content });
		await page.evaluate(() => {
			for (const name of ["theme", "suppression"]) {
				const style = document.createElement("style");
				style.dataset[
					name === "theme" ? "compareTheme" : "compareSuppression"
				] = "";
				document.head.append(style);
			}
			const suppression = document.querySelector<HTMLStyleElement>(
				"style[data-compare-suppression]",
			);
			if (suppression)
				suppression.textContent =
					"*,*::before,*::after,*::-webkit-slider-thumb,*::-webkit-slider-runnable-track,*::-webkit-progress-bar,*::-webkit-progress-value,*::-webkit-scrollbar-thumb { animation: none !important; transition: none !important; }";
			const media = document.createElement("style");
			media.textContent =
				"video::-webkit-media-controls,audio::-webkit-media-controls { visibility:hidden !important }";
			document.head.append(media);
		});
		documents.set(page, { html, ...css });
	}
	// Every capture exercises an actual stylesheet swap through the same empty-theme state.
	await page.locator("style[data-compare-theme]").evaluate((style, theme) => {
		style.textContent = "";
		void document.body.offsetHeight;
		style.textContent = theme;
		void document.body.offsetHeight;
	}, css.theme);
	const replayIssues: string[] = [];
	await cdp.send("Animation.enable");
	await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
	await page.mouse.move(-1, -1);
	await page.evaluate(() => {
		document
			.querySelectorAll("[data-compare-force]")
			.forEach((el) => el.removeAttribute("data-compare-force"));
		const marks = new Map<Element, Set<string>>();
		const add = (el: Element, state: string) => {
			const states = marks.get(el) ?? new Set<string>();
			states.add(state);
			marks.set(el, states);
		};
		for (const el of document.querySelectorAll("[data-capture-pseudo]")) {
			const states = (el.getAttribute("data-capture-state") ?? "")
				.split(/\s+/)
				.filter(Boolean);
			if (states.includes("focus-visible")) states.push("focus");
			for (const state of states) add(el, state);
			for (
				let ancestor: Element | null = el;
				ancestor;
				ancestor = ancestor.parentElement
			) {
				for (const state of states)
					if (state === "hover" || state === "active") add(ancestor, state);
				if (states.includes("focus")) add(ancestor, "focus-within");
			}
		}
		for (const [el, states] of marks)
			el.setAttribute("data-compare-force", [...states].join(" "));
	});
	const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
	const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
		nodeId: root.nodeId,
		selector: "[data-compare-force]",
	});
	const states = await page
		.locator("[data-compare-force]")
		.evaluateAll((els) =>
			els.map((e) =>
				(e.getAttribute("data-compare-force") ?? "")
					.split(/\s+/)
					.filter(Boolean),
			),
		);
	for (let i = 0; i < nodeIds.length; i++)
		await cdp.send("CSS.forcePseudoState", {
			nodeId: nodeIds[i],
			forcedPseudoClasses: states[i],
		});
	if (fixture.state === "selection") {
		const selected = await page.evaluate(() => {
			const target = document.querySelector("[data-capture-target]");
			if (!target) return false;
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement
			) {
				try {
					target.focus();
					target.setSelectionRange(0, target.value.length);
					return target.selectionEnd !== target.selectionStart;
				} catch {
					return false;
				}
			}
			const range = document.createRange();
			range.selectNodeContents(target);
			const selection = getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			return !!selection?.toString();
		});
		if (!selected) replayIssues.push("native selection could not be restored");
	}
	if (fixture.state === "scrollbar-hover") {
		const point = await page.evaluate(() => {
			const target = document.querySelector("[data-capture-target]");
			const candidates = target
				? [target, ...target.querySelectorAll("*")]
				: [];
			const scroller = candidates.find(
				(el) =>
					el.scrollHeight > el.clientHeight &&
					/(auto|scroll)/.test(getComputedStyle(el).overflowY),
			);
			if (!scroller) return null;
			const r = scroller.getBoundingClientRect();
			if (!r.width || !r.height) return null;
			scroller.scrollTop = 0;
			return { x: r.right - 3, y: r.top + Math.min(10, r.height / 2) };
		});
		if (point) await page.mouse.move(point.x, point.y);
		else replayIssues.push("scrollbar hover could not be restored");
	}
	// A bounded paint interval also works in background worker tabs, whose RAF can be paused.
	await page.waitForTimeout(120);
	await page.locator("style[data-compare-suppression]").evaluate((el) => {
		(el as HTMLStyleElement).disabled = true;
	});
	const data = await page.evaluate(
		({ fixture, components }) => {
			const styles: ElementStyle[] = [],
				samples: Sample[] = [];
			// Standard property names are engine-wide; avoid enumerating thousands of inherited custom names per node.
			const names = Array.from(
				getComputedStyle(document.documentElement),
			).filter((p) => !p.startsWith("--"));
			const pool = new Map<string, Record<string, string>>();
			const read = (el: Element, pseudo?: string) => {
				const computed = getComputedStyle(el, pseudo);
				const values = names.map((p) => computed.getPropertyValue(p));
				const key = JSON.stringify(values);
				const known = pool.get(key);
				if (known) return known;
				const props = Object.fromEntries(
					names.map((p, i) => [p, values[i] as string]),
				);
				pool.set(key, props);
				return props;
			};
			const elements = Array.from(
				document.querySelectorAll("html, body, body *"),
			);
			for (const [i, el] of elements.entries()) {
				const element = `${i}:${el.localName}${el.getAttribute("class") ? `.${el.getAttribute("class")?.trim().replace(/\s+/g, ".")}` : ""}`;
				const props = read(el);
				styles.push({ element, props });
				const pseudos = ["::before", "::after", "::marker"];
				if (
					Array.from(el.childNodes).some(
						(n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
					) ||
					el.matches("input,textarea")
				)
					pseudos.push("::selection");
				if (el.matches("input,textarea")) pseudos.push("::placeholder");
				if (el.matches('input[type="file"]'))
					pseudos.push("::file-selector-button");
				if (
					el === document.documentElement ||
					el === document.body ||
					/(auto|scroll)/.test(`${props["overflow-x"]} ${props["overflow-y"]}`)
				)
					pseudos.push(
						"::-webkit-scrollbar",
						"::-webkit-scrollbar-thumb",
						"::-webkit-scrollbar-track",
						"::-webkit-scrollbar-corner",
					);
				for (const pseudo of pseudos)
					styles.push({ element: element + pseudo, props: read(el, pseudo) });
				for (const [component, selector] of Object.entries(components))
					if (el.matches(selector))
						samples.push({
							component,
							surface: fixture.surface,
							state: el.hasAttribute("data-capture-state")
								? (el.getAttribute("data-capture-state") ?? fixture.state)
								: "default",
							props,
						});
				if (
					el.hasAttribute("data-capture-target") &&
					!(fixture.component in components)
				)
					samples.push({ ...fixture, props });
			}
			const probe = document.createElement("span");
			probe.style.cssText =
				"position:fixed;left:-10000px;top:0;visibility:hidden";
			document.body.append(probe);
			for (const variable of [
				"--graph-node",
				"--graph-node-focused",
				"--graph-node-tag",
				"--graph-node-attachment",
				"--graph-node-unresolved",
				"--graph-line",
				"--graph-text",
				"--canvas-background",
				"--canvas-dot-pattern",
				"--canvas-card-label-color",
				"--canvas-color",
				...Array.from({ length: 6 }, (_, i) => `--canvas-color-${i + 1}`),
				"--pdf-page-background",
			]) {
				probe.style.color = `var(${variable})`;
				styles.push({
					element: `probe:${variable}`,
					props: { color: getComputedStyle(probe).color },
				});
			}
			for (const name of [
				"fill",
				"fill-focused",
				"fill-tag",
				"fill-attachment",
				"fill-unresolved",
				"fill-highlight",
				"line",
				"line-highlight",
				"text",
				"arrow",
				"circle",
				...Array.from({ length: 6 }, (_, i) => `fill-${i + 1}`),
			]) {
				probe.className = `graph-view color-${name}`;
				probe.style.removeProperty("color");
				const computed = getComputedStyle(probe);
				styles.push({
					element: `probe:graph-view.color-${name}`,
					props: { color: computed.color, opacity: computed.opacity },
				});
			}
			probe.remove();
			const target = document.querySelector("[data-capture-target]");
			const r = target?.getBoundingClientRect();
			const table: Record<string, string>[] = [];
			const ids = new Map<Record<string, string>, number>();
			const intern = (props: Record<string, string>) => {
				const known = ids.get(props);
				if (known !== undefined) return known;
				const id = table.length;
				table.push(props);
				ids.set(props, id);
				return id;
			};
			// Repeated computed styles cross the browser protocol once, with no property filtering.
			return {
				table,
				styles: styles.map(({ element, props }) => ({
					element,
					style: intern(props),
				})),
				samples: samples.map(({ props, ...sample }) => ({
					...sample,
					style: intern(props),
				})),
				invisibleTarget:
					!r ||
					r.width === 0 ||
					r.height === 0 ||
					r.bottom <= 0 ||
					r.right <= 0 ||
					r.top >= innerHeight ||
					r.left >= innerWidth ||
					!target?.checkVisibility({
						checkOpacity: true,
						checkVisibilityCSS: true,
					}),
				unsupported: Array.from(
					document.querySelectorAll(
						"canvas,video,audio,iframe,img,embed,object",
					),
				).map((e) => e.localName),
			};
		},
		{ fixture, components: COMPONENTS },
	);
	await page.locator("style[data-compare-suppression]").evaluate((el) => {
		(el as HTMLStyleElement).disabled = false;
	});
	await page.waitForTimeout(120);
	// CDP avoids Playwright screenshot's extra animation/font waits; the harness has no external resources.
	const shot = await cdp.send("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: false,
	});
	return {
		styles: data.styles.map(({ element, style }) => ({
			element,
			props: data.table[style] as Record<string, string>,
		})),
		samples: data.samples.map(({ style, ...sample }) => ({
			...sample,
			props: data.table[style] as Record<string, string>,
		})),
		invisibleTarget: data.invisibleTarget,
		unsupported: data.unsupported,
		replayIssues,
		png: Buffer.from(shot.data, "base64"),
	};
}
