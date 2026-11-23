import type { CDPSession, Page } from "playwright";
import { COMPONENTS } from "../../capture/scripts/engine";
import type { ElementStyle, Sample } from "./model";
export interface Rendered {
	styles: ElementStyle[];
	samples: Sample[];
	png: Buffer;
	invisibleTarget: boolean;
	unsupported: string[];
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
		await page.evaluate((theme) => {
			const style = document.createElement("style");
			style.dataset.compareTheme = "";
			style.textContent = theme;
			document.head.append(style);
		}, css.theme);
		await page.addStyleTag({
			content:
				"*,*::before,*::after,*::-webkit-slider-thumb,*::-webkit-slider-runnable-track,*::-webkit-progress-bar,*::-webkit-progress-value,*::-webkit-scrollbar-thumb { animation: none !important; transition: none !important; } video::-webkit-media-controls,audio::-webkit-media-controls { visibility: hidden !important; }",
		});
		documents.set(page, { html, ...css });
	} else if (previous.theme !== css.theme) {
		// Swap only theme CSS: document recreation introduces unrelated raster rounding differences.
		await page.locator("style[data-compare-theme]").evaluate((style, theme) => {
			style.textContent = theme;
		}, css.theme);
		previous.theme = css.theme;
	}
	const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
	const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
		nodeId: root.nodeId,
		selector: "[data-capture-pseudo]",
	});
	const states = await page
		.locator("[data-capture-pseudo]")
		.evaluateAll((els) =>
			els.map((e) =>
				(e.getAttribute("data-capture-state") ?? "")
					.split(/\s+/)
					.filter(Boolean),
			),
		);
	for (let i = 0; i < nodeIds.length; i++)
		await cdp.send("CSS.forcePseudoState", {
			nodeId: nodeIds[i],
			forcedPseudoClasses: states[i],
		});
	// A bounded paint interval also works in background worker tabs, whose RAF can be paused.
	await page.waitForTimeout(120);
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
				for (const pseudo of ["::before", "::after", "::marker"])
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
				invisibleTarget: !r || r.width === 0 || r.height === 0,
				unsupported: Array.from(
					document.querySelectorAll("canvas,video,audio,iframe,img"),
				).map((e) => e.localName),
			};
		},
		{ fixture, components: COMPONENTS },
	);
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
		png: Buffer.from(shot.data, "base64"),
	};
}
