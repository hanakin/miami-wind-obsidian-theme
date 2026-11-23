// The hand-written part of the checklist: markdown features in every editor mode, workspace
// chrome, menus, popovers and interactive states. The app-enumerated part (commands, settings
// tabs, views) lives in discover.ts.
import type { Ctx, ItemDef, Mode, Pseudo, Scene, Target } from "./types.ts";

const MODES: Mode[] = ["live", "source", "reading"];

interface Feature {
	id: string;
	component: string;
	note: string;
	reading?: Target;
	live?: Target;
	source?: Target;
	/** Applies to live and source when both use the same target. */
	editor?: Target;
}

const line = (text: string): Target => ({ sel: ".cm-line", text });
const H = (n: number): Feature => ({
	id: `heading-h${n}`,
	component: "heading",
	note: "Markdown/Headings.md",
	reading: `.markdown-rendered h${n}`,
	editor: `.HyperMD-header-${n}`,
});

const TASKS: [string, string][] = [
	[" ", "open"],
	["x", "done"],
	["X", "done-capital"],
	["-", "cancelled"],
	["/", "in-progress"],
	["!", "important"],
	["?", "question"],
	["*", "star"],
	["q", "quote"],
	[">", "forwarded"],
];

/** Text of each task line in Lists and tasks.md (source mode has no data-task). */
const TASK_TEXT: Record<string, string> = {
	open: "Open task",
	done: "Done task",
	"done-capital": "Done with capital X",
	cancelled: "Cancelled task",
	"in-progress": "In progress task",
	important: "Important task",
	question: "Question task",
	star: "Star task",
	quote: "Quote task",
	forwarded: "Forwarded task",
};

const CALLOUTS = [
	"note",
	"abstract",
	"summary",
	"tldr",
	"info",
	"todo",
	"tip",
	"hint",
	"important",
	"success",
	"check",
	"done",
	"question",
	"help",
	"faq",
	"warning",
	"caution",
	"attention",
	"failure",
	"fail",
	"missing",
	"danger",
	"error",
	"bug",
	"example",
	"quote",
	"cite",
];

/** [language id, text on its first code line] */
const CODE: [string, string][] = [
	["js", "// JavaScript"],
	["ts", "interface Palette"],
	["python", "import math"],
	["rust", "#[derive(Debug)]"],
	["go", "package main"],
	["bash", "#!/usr/bin/env bash"],
	["json", '"name": "Miami Wind"'],
	["yaml", "colors: [pink, cyan]"],
	["css", ".theme-dark { --accent"],
	["html", "<!doctype html>"],
	["sql", "SELECT id, name"],
	["diff", "- removed line"],
	["java", "public class Main"],
	["c", "#include <stdio.h>"],
	["cpp", "template <typename T>"],
	["csharp", "public record Point"],
	["ruby", "def hello(name)"],
	["php", '<?php echo "Hello'],
	["lua", "local t = { 1, 2, 3 }"],
	["swift", "let colors ="],
	["kotlin", "data class User"],
	["toml", "[theme]"],
	["xml", "<?xml version"],
	["c-char", "char c = 'a'"],
	["css-url", ".bg { background: url"],
	["ruby-symbol", "status = :active"],
	["markdown", "# Markdown in code"],
];

const PROPERTIES = [
	"title",
	"description",
	"count",
	"ratio",
	"done",
	"not-done",
	"created",
	"due",
	"list",
	"tags",
	"aliases",
	"cssclasses",
	"link",
	"links",
	"url",
	"empty",
];

const FEATURES: Feature[] = [
	H(1),
	H(2),
	H(3),
	H(4),
	H(5),
	H(6),
	{
		id: "heading-setext",
		component: "heading",
		note: "Markdown/Headings.md",
		reading: { sel: "h1", text: "Setext heading 1" },
		editor: line("Setext heading 1"),
	},
	{
		id: "paragraph",
		component: "paragraph",
		note: "Markdown/Headings.md",
		reading: { sel: "p", text: "Paragraph under heading one" },
		editor: line("Paragraph under heading one"),
	},
	{
		id: "bold",
		component: "inline-mark",
		note: "Markdown/Inline.md",
		reading: "strong",
		editor: ".cm-strong",
	},
	{
		id: "italic",
		component: "inline-mark",
		note: "Markdown/Inline.md",
		reading: "em",
		editor: ".cm-em",
	},
	{
		id: "bold-italic",
		component: "inline-mark",
		note: "Markdown/Inline.md",
		reading: "em strong, strong em",
		editor: ".cm-strong.cm-em",
	},
	{
		id: "strikethrough",
		component: "inline-mark",
		note: "Markdown/Inline.md",
		reading: "del",
		editor: ".cm-strikethrough",
	},
	{
		id: "highlight",
		component: "inline-mark",
		note: "Markdown/Inline.md",
		reading: "p > mark",
		editor: ".cm-highlight",
	},
	...["red", "orange", "yellow", "green", "blue", "purple"].map(
		(color): Feature => ({
			id: `highlight-${color}`,
			component: "inline-mark",
			note: "Markdown/Inline.md",
			reading: `mark[data-highlight="${color}"]`,
			live: `.cm-highlight-${color}`,
			source: `.cm-highlight-${color}, .cm-highlight-color-widget[data-highlight="${color}"]`,
		}),
	),
	{
		id: "tab-character",
		component: "paragraph",
		note: "Markdown/Inline.md",
		reading: { sel: "p", text: "tab character" },
		editor: line("tab character"),
	},
	{
		id: "inline-code",
		component: "inline-code",
		note: "Markdown/Inline.md",
		reading: "p > code",
		editor: ".cm-inline-code",
	},
	{
		id: "inline-html",
		component: "inline-html",
		note: "Markdown/Inline.md",
		reading: { sel: "p", text: "HTML inline" },
		editor: line("HTML inline"),
	},
	{
		id: "kbd",
		component: "kbd",
		note: "Markdown/Inline.md",
		reading: "kbd",
	},
	{
		id: "inline-comment",
		component: "comment",
		note: "Markdown/Inline.md",
		editor: ".cm-comment",
	},
	{
		id: "escaped-characters",
		component: "paragraph",
		note: "Markdown/Inline.md",
		reading: { sel: "p", text: "Escaped characters" },
		editor: line("Escaped characters"),
	},
	{
		id: "hard-break",
		component: "paragraph",
		note: "Markdown/Inline.md",
		reading: { sel: "p", text: "hard break" },
		editor: line("hard break"),
	},
	{
		id: "bare-url",
		component: "external-link",
		note: "Markdown/Inline.md",
		reading: "a.external-link",
		editor: ".cm-url",
	},
	{
		id: "list-bullet",
		component: "list",
		note: "Markdown/Lists and tasks.md",
		reading: "ul",
		editor: ".HyperMD-list-line-1",
	},
	{
		id: "list-nested",
		component: "list",
		note: "Markdown/Lists and tasks.md",
		reading: "ul ul",
		editor: ".HyperMD-list-line-2",
	},
	{
		id: "list-deep",
		component: "list",
		note: "Markdown/Lists and tasks.md",
		reading: "ul ul ul",
		editor: ".HyperMD-list-line-3",
	},
	{
		id: "list-ordered",
		component: "list",
		note: "Markdown/Lists and tasks.md",
		reading: "ol",
		editor: line("Ordered one"),
	},
	{
		id: "list-ordered-task",
		component: "task",
		note: "Markdown/Lists and tasks.md",
		reading: { sel: "ol li.task-list-item" },
		editor: line("Ordered task"),
	},
	...TASKS.map(
		([c, name]): Feature => ({
			id: `task-${name}`,
			component: "task",
			note: "Markdown/Lists and tasks.md",
			reading: `li.task-list-item[data-task="${c === " " ? "" : c}"]`,
			live: `.HyperMD-task-line[data-task="${c}"]`,
			source: line(TASK_TEXT[name] ?? name),
		}),
	),
	{
		id: "list-collapse-indicator",
		component: "collapse-icon",
		note: "Markdown/Lists and tasks.md",
		reading: { sel: "li", text: "Parent item that folds" },
		live: { sel: ".cm-line", text: "Parent item that folds" },
	},
	...CALLOUTS.map(
		(t): Feature => ({
			id: `callout-${t}`,
			component: "callout",
			note: "Markdown/Callouts.md",
			reading: `.callout[data-callout="${t}"]`,
			live: `.cm-callout .callout[data-callout="${t}"]`,
			source: { sel: ".HyperMD-callout", text: `[!${t}]` },
		}),
	),
	{
		id: "callout-custom-title",
		component: "callout",
		note: "Markdown/Callouts.md",
		reading: { sel: ".callout", text: "Custom title" },
		live: { sel: ".cm-callout .callout", text: "Custom title" },
	},
	{
		id: "callout-folded",
		component: "callout",
		note: "Markdown/Callouts.md",
		reading: ".callout.is-collapsed",
		live: ".cm-callout .callout.is-collapsed",
	},
	{
		id: "callout-foldable-open",
		component: "callout",
		note: "Markdown/Callouts.md",
		reading: { sel: ".callout.is-collapsible", text: "Expanded foldable" },
		live: { sel: ".cm-callout .callout.is-collapsible", text: "Expanded foldable" },
	},
	{
		id: "callout-nested",
		component: "callout",
		note: "Markdown/Callouts.md",
		reading: ".callout .callout",
		live: ".cm-callout .callout .callout",
	},
	{
		id: "callout-unknown-type",
		component: "callout",
		note: "Markdown/Callouts.md",
		reading: '.callout[data-callout="unknown-type"]',
		live: '.cm-callout .callout[data-callout="unknown-type"]',
	},
	{
		id: "callout-metadata",
		component: "callout",
		note: "Markdown/Callouts.md",
		reading: ".callout[data-callout-metadata]",
		live: ".cm-callout .callout[data-callout-metadata]",
	},
	{
		id: "table",
		component: "table",
		note: "Markdown/Tables.md",
		reading: "table",
		live: ".cm-table-widget",
		source: ".HyperMD-table-row",
	},
	{
		id: "table-header-cell",
		component: "table",
		note: "Markdown/Tables.md",
		reading: "th",
		live: ".cm-table-widget th",
	},
	{
		id: "table-cell",
		component: "table",
		note: "Markdown/Tables.md",
		reading: "td",
		live: ".cm-table-widget td",
	},
	{
		id: "table-wide",
		component: "table",
		note: "Markdown/Tables.md",
		reading: { sel: "table", text: "C12" },
		live: { sel: ".cm-table-widget", text: "C12" },
	},
	...CODE.map(
		([lang, text]): Feature => ({
			id: `code-${lang}`,
			component: "code-block",
			note: "Markdown/Code.md",
			reading: { sel: "pre", text },
			editor: { sel: ".HyperMD-codeblock", text },
		}),
	),
	{
		id: "code-plain",
		component: "code-block",
		note: "Markdown/Code.md",
		reading: { sel: "pre", text: "Plain code block" },
		editor: { sel: ".HyperMD-codeblock", text: "Plain code block" },
	},
	{
		id: "code-indented",
		component: "code-block",
		note: "Markdown/Code.md",
		reading: { sel: "pre", text: "Indented code block" },
		editor: line("Indented code block"),
	},
	{
		id: "code-block-language-flair",
		component: "code-block",
		note: "Markdown/Code.md",
		live: ".code-block-flair",
		source: ".HyperMD-codeblock-begin",
	},
	{
		id: "link-internal",
		component: "internal-link",
		note: "Markdown/Links.md",
		reading: "a.internal-link:not(.is-unresolved)",
		editor: ".cm-hmd-internal-link",
	},
	{
		id: "link-alias",
		component: "internal-link",
		note: "Markdown/Links.md",
		reading: { sel: "a.internal-link", text: "inline marks" },
		editor: { sel: ".cm-line", text: "Wiki link with alias" },
	},
	{
		id: "link-unresolved",
		component: "internal-link",
		note: "Markdown/Links.md",
		reading: "a.internal-link.is-unresolved",
		live: ".cm-hmd-internal-link .is-unresolved",
		source: line("This note does not exist"),
	},
	{
		id: "link-markdown",
		component: "internal-link",
		note: "Markdown/Links.md",
		reading: { sel: "a.internal-link", text: "Inline marks" },
		editor: { sel: ".cm-line", text: "Markdown link" },
	},
	{
		id: "link-external",
		component: "external-link",
		note: "Markdown/Links.md",
		reading: { sel: "a.external-link", text: "Obsidian" },
		editor: { sel: ".cm-line", text: "External link" },
	},
	{
		id: "link-block-id",
		component: "block-id",
		note: "Markdown/Links.md",
		reading: { sel: "p", text: "A paragraph with a block id" },
		editor: { sel: ".cm-line", text: "A paragraph with a block id" },
	},
	{
		id: "embed-note",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: { sel: ".markdown-embed", text: "Heading 1" },
		live: { sel: ".markdown-embed", text: "Heading 1" },
		source: line("![[Headings]]"),
	},
	{
		id: "embed-heading",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: { sel: ".markdown-embed", text: "Task states" },
		live: { sel: ".markdown-embed", text: "Task states" },
	},
	{
		id: "embed-block",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: { sel: ".markdown-embed", text: "A paragraph with a block id" },
		live: { sel: ".markdown-embed", text: "A paragraph with a block id" },
	},
	{
		id: "embed-image",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".image-embed",
		live: ".image-embed",
		source: line("![[sample-image.png]]"),
	},
	{
		id: "embed-image-resized",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: '.image-embed[width="200"], .image-embed img[width="200"]',
		live: '.image-embed img[width="200"]',
	},
	{
		id: "embed-image-markdown",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: 'img[alt="remote"]',
		live: 'img[alt="remote"]',
	},
	{
		id: "embed-pdf",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".pdf-embed",
		live: ".pdf-embed",
	},
	{
		id: "embed-audio",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".audio-embed",
		live: ".audio-embed",
	},
	{
		id: "embed-video",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".video-embed",
		live: ".video-embed",
	},
	{
		id: "embed-canvas",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".canvas-embed",
		live: ".canvas-embed",
	},
	{
		id: "embed-base",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".bases-embed",
		live: ".bases-embed",
	},
	{
		id: "embed-base-codeblock",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".block-language-base",
		live: ".block-language-base",
	},
	{
		id: "embed-missing",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: { sel: ".internal-embed", text: "Missing note" },
		live: { sel: ".internal-embed", text: "Missing note" },
	},
	{
		id: "embed-query",
		component: "embed",
		note: "Markdown/Embeds.md",
		reading: ".internal-query",
		live: ".internal-query",
	},
	{
		id: "tag",
		component: "tag",
		note: "Markdown/Tags.md",
		reading: "a.tag",
		editor: ".cm-hashtag",
	},
	{
		id: "tag-nested",
		component: "tag",
		note: "Markdown/Tags.md",
		reading: 'a.tag[href="#sample/nested"]',
		editor: { sel: ".cm-hashtag", text: "sample/nested" },
	},
	{
		id: "properties",
		component: "metadata-container",
		note: "Markdown/Properties.md",
		live: ".metadata-container",
		reading: ".metadata-container",
		source: ".cm-hmd-frontmatter",
	},
	...PROPERTIES.map(
		(k): Feature => ({
			id: `property-${k}`,
			component: "metadata-property",
			note: "Markdown/Properties.md",
			live: `.metadata-property[data-property-key="${k}"]`,
			reading: `.metadata-property[data-property-key="${k}"]`,
			source: { sel: ".cm-line", text: `${k}:` },
		}),
	),
	{
		id: "footnote-ref",
		component: "footnote",
		note: "Markdown/Footnotes.md",
		reading: ".footnote-ref, sup[data-footnote-id]",
		editor: ".cm-footref",
	},
	{
		id: "footnote-inline",
		component: "footnote",
		note: "Markdown/Footnotes.md",
		reading: { sel: "p", text: "inline one" },
		editor: { sel: ".cm-line", text: "Inline footnote" },
	},
	{
		id: "footnote-section",
		component: "footnote",
		note: "Markdown/Footnotes.md",
		reading: "section.footnotes",
		editor: ".HyperMD-footnote",
	},
	{
		id: "math-inline",
		component: "math",
		note: "Markdown/Math.md",
		reading: ".math-inline",
		live: ".math-inline, .math:not(.math-block)",
		source: line("Inline math"),
	},
	{
		id: "math-block",
		component: "math",
		note: "Markdown/Math.md",
		reading: ".math-block",
		live: ".math-block",
		source: ".HyperMD-math-block, .cm-math",
	},
	{
		id: "math-error",
		component: "math",
		note: "Markdown/Math.md",
		reading: { sel: "p", text: "Broken math" },
		live: { sel: ".cm-line", text: "Broken math" },
	},
	...["flowchart", "sequence", "pie", "gantt", "class", "state", "er"].map(
		(kind, i): Feature => ({
			id: `mermaid-${kind}`,
			component: "mermaid",
			note: "Markdown/Mermaid.md",
			reading: { sel: ".mermaid", nth: i },
			live: { sel: ".mermaid", nth: i },
		}),
	),
	{
		id: "mermaid-error",
		component: "mermaid",
		note: "Markdown/Mermaid.md",
		reading: { sel: ".mermaid", text: "No diagram type" },
		live: { sel: ".mermaid", text: "No diagram type" },
		source: line("this is not valid mermaid"),
	},
	{
		id: "blockquote",
		component: "blockquote",
		note: "Markdown/Blocks.md",
		reading: "blockquote",
		editor: ".HyperMD-quote",
	},
	{
		id: "blockquote-nested",
		component: "blockquote",
		note: "Markdown/Blocks.md",
		reading: "blockquote blockquote",
		editor: ".HyperMD-quote-2",
	},
	{
		id: "horizontal-rule",
		component: "hr",
		note: "Markdown/Blocks.md",
		reading: "hr",
		editor: ".hr, .HyperMD-hr",
	},
	{
		id: "html-block",
		component: "html",
		note: "Markdown/Blocks.md",
		reading: ".custom-html",
		live: ".cm-html-embed",
		source: line('<div class="custom-html">'),
	},
	{
		id: "html-details",
		component: "html",
		note: "Markdown/Blocks.md",
		reading: "details",
		live: ".cm-html-embed details",
	},
	{
		id: "html-iframe",
		component: "html",
		note: "Markdown/Blocks.md",
		reading: "iframe",
		live: ".cm-html-embed iframe, iframe",
	},
	{
		id: "comment-block",
		component: "comment",
		note: "Markdown/Blocks.md",
		editor: { sel: ".cm-line", text: "Block comment" },
	},
	{
		id: "inline-title",
		component: "inline-title",
		note: "Markdown/Kitchen sink.md",
		reading: ".inline-title",
		live: ".inline-title",
		source: ".inline-title",
	},
	{
		id: "embedded-backlinks",
		component: "backlinks",
		note: "Markdown/Headings.md",
		reading: ".embedded-backlinks",
		live: ".embedded-backlinks",
	},
];

async function allowMermaid(ctx: Ctx): Promise<void> {
	await ctx.js(
		"const b = document.querySelector('.mermaid-guard-actions button'); if (b) { b.click(); await sleep(2500); }",
	);
}

function viewRoot(mode: Mode): string {
	return mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view";
}

/** One scene per note and mode; one item per feature on that note. */
function markdownScenes(): Scene[] {
	const notes = [...new Set(FEATURES.map((f) => f.note))];
	const scenes: Scene[] = [];
	for (const note of notes) {
		for (const mode of MODES) {
			const slug = note
				.replace(/^Markdown\//, "")
				.replace(/\.md$/, "")
				.toLowerCase()
				.replaceAll(" ", "-");
			const items: ItemDef[] = [
				{
					id: `md.${slug}.${mode}.view`,
					component: "markdown-view",
					target: { sel: ".workspace-leaf-content", in: "leaf" },
					full: true,
				},
			];
			for (const f of FEATURES.filter((x) => x.note === note)) {
				const t = mode === "reading" ? f.reading : (f[mode] ?? f.editor);
				if (!t) continue;
				const base = typeof t === "string" ? { sel: t } : t;
				// Scope every lookup to the visible view of the active leaf.
				const sel = base.sel
					.split(",")
					.map((s) => `${viewRoot(mode)} ${s.trim()}`)
					.join(", ");
				items.push({
					id: `md.${f.id}.${mode}`,
					component: f.component,
					target: { ...base, sel, in: "leaf" },
					...(f.component === "mermaid" ? { before: allowMermaid } : {}),
				});
			}
			scenes.push({
				id: `md.${slug}.${mode}`,
				surface: `editor-${mode === "live" ? "live-preview" : mode === "source" ? "source-mode" : "reading-view"}`,
				source: `catalog:markdown:${note}`,
				setup: (ctx) => ctx.open(note, mode),
				items,
			});
		}
	}
	return scenes;
}

const pseudoItem = (
	id: string,
	component: string,
	target: Target,
	pseudo: Pseudo[],
	extra: Partial<ItemDef> = {},
): ItemDef => ({ id, component, target, pseudo, state: pseudo.join("+"), ...extra });

async function rightClick(ctx: Ctx, target: Target): Promise<void> {
	const box = await ctx.js<[number, number] | null>(
		"const el = cap.find(arg); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.x + Math.min(20, r.width / 2), r.y + r.height / 2];",
		target,
	);
	if (!box) throw new Error(`no element for right click: ${JSON.stringify(target)}`);
	await ctx.page.mouse.click(box[0], box[1], { button: "right" });
	await ctx.sleep(400);
}

async function click(ctx: Ctx, target: Target): Promise<void> {
	const box = await ctx.js<[number, number] | null>(
		"const el = cap.find(arg); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
		target,
	);
	if (!box) throw new Error(`no element to click: ${JSON.stringify(target)}`);
	await ctx.page.mouse.click(box[0], box[1]);
	await ctx.sleep(400);
}

async function baseLayout(ctx: Ctx): Promise<void> {
	await ctx.js(`
		app.workspace.leftSplit.expand(); app.workspace.rightSplit.expand();
		document.body.classList.add("show-ribbon");
		const fe = app.workspace.getLeavesOfType("file-explorer")[0];
		if (fe) app.workspace.revealLeaf(fe);
	`);
	await ctx.open("Markdown/Kitchen sink.md", "live");
}

/** Workspace chrome around a note: window, tabs, sidebars, ribbon, status bar. */
const chrome: Scene = {
	id: "chrome",
	surface: "workspace",
	source: "catalog:chrome",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Headings.md", "live", { newLeaf: true });
		await ctx.open("Markdown/Kitchen sink.md", "live", { newLeaf: true });
		await ctx.js(`
			const fe = app.workspace.getLeavesOfType("file-explorer")[0];
			fe.view.revealInFolder(app.vault.getAbstractFileByPath("Markdown/Kitchen sink.md"));
			const bl = app.workspace.getLeavesOfType("backlink")[0] ?? app.workspace.getRightLeaf(false);
			await bl.setViewState({ type: "backlink", state: { file: "Markdown/Kitchen sink.md" } });
			app.workspace.revealLeaf(bl);
			app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("markdown").at(-1), { focus: true });
			await sleep(500);
		`);
	},
	items: [
		{ id: "chrome.window", component: "workspace", target: ".app-container", full: true },
		{ id: "chrome.titlebar", component: "titlebar", target: ".titlebar" },
		pseudoItem("chrome.titlebar-button.hover", "titlebar-button", ".titlebar-button.mod-close", [
			"hover",
		]),
		{ id: "chrome.ribbon", component: "ribbon", target: ".workspace-ribbon" },
		pseudoItem(
			"chrome.ribbon-icon.hover",
			"clickable-icon",
			".workspace-ribbon .clickable-icon",
			["hover"],
			{ surface: "ribbon" },
		),
		pseudoItem(
			"chrome.ribbon-icon.active",
			"clickable-icon",
			".workspace-ribbon .clickable-icon",
			["active"],
			{ surface: "ribbon" },
		),
		{ id: "chrome.left-split", component: "sidebar", target: ".workspace-split.mod-left-split" },
		{ id: "chrome.right-split", component: "sidebar", target: ".workspace-split.mod-right-split" },
		{ id: "chrome.root-split", component: "workspace", target: ".workspace-split.mod-root" },
		{
			id: "chrome.tab-header-container",
			component: "tab-header",
			target: ".mod-root .workspace-tab-header-container",
		},
		{
			id: "chrome.tab-header.active",
			component: "tab-header",
			target: ".mod-root .workspace-tab-header.is-active",
			state: "active-tab",
		},
		{
			id: "chrome.tab-header.inactive",
			component: "tab-header",
			target: ".mod-root .workspace-tab-header:not(.is-active)",
		},
		pseudoItem(
			"chrome.tab-header.inactive.hover",
			"tab-header",
			".mod-root .workspace-tab-header:not(.is-active)",
			["hover"],
		),
		pseudoItem(
			"chrome.tab-header.active.hover",
			"tab-header",
			".mod-root .workspace-tab-header.is-active",
			["hover"],
		),
		pseudoItem(
			"chrome.tab-close.hover",
			"clickable-icon",
			".mod-root .workspace-tab-header.is-active .workspace-tab-header-inner-close-button",
			["hover"],
		),
		pseudoItem(
			"chrome.tab-new.hover",
			"clickable-icon",
			".mod-root .workspace-tab-header-new-tab .clickable-icon",
			["hover"],
		),
		pseudoItem(
			"chrome.tab-list.hover",
			"clickable-icon",
			".mod-root .workspace-tab-header-tab-list .clickable-icon",
			["hover"],
		),
		{
			id: "chrome.sidebar-tab.active",
			component: "tab-header",
			target: ".mod-right-split .workspace-tab-header.is-active",
			surface: "right-sidebar",
		},
		{
			id: "chrome.sidebar-tab.inactive",
			component: "tab-header",
			target: ".mod-right-split .workspace-tab-header:not(.is-active)",
			surface: "right-sidebar",
		},
		pseudoItem(
			"chrome.sidebar-tab.hover",
			"tab-header",
			".mod-right-split .workspace-tab-header:not(.is-active)",
			["hover"],
			{ surface: "right-sidebar" },
		),
		pseudoItem(
			"chrome.sidebar-tab.active.hover",
			"tab-header",
			".mod-right-split .workspace-tab-header.is-active",
			["hover"],
			{ surface: "right-sidebar" },
		),
		{
			id: "chrome.left-sidebar-tab.active",
			component: "tab-header",
			target: ".mod-left-split .workspace-tab-header.is-active",
			surface: "left-sidebar",
		},
		pseudoItem(
			"chrome.sidebar-toggle.hover",
			"clickable-icon",
			".sidebar-toggle-button.mod-right .clickable-icon",
			["hover"],
		),
		pseudoItem(
			"chrome.workspace-tabs-icon.hover",
			"clickable-icon",
			".mod-left-split .workspace-tabs .clickable-icon",
			["hover"],
			{ surface: "left-sidebar" },
		),
		{
			id: "chrome.workspace-tabs-icon.is-active",
			component: "clickable-icon",
			target: ".workspace-tabs .clickable-icon.is-active",
			state: "is-active",
			before: async (ctx) => {
				await ctx.js(
					"const l = app.workspace.getLeavesOfType('search')[0]; app.workspace.revealLeaf(l); await sleep(300); l.view.containerEl.querySelector('.clickable-icon[aria-label=\"Search settings\"]')?.click(); await sleep(300);",
				);
			},
			surface: "left-sidebar",
		},
		{
			id: "chrome.vault-profile",
			component: "vault-profile",
			target: ".workspace-sidedock-vault-profile",
			surface: "left-sidebar",
		},
		pseudoItem(
			"chrome.vault-profile-switcher.hover",
			"vault-profile",
			".workspace-drawer-vault-switcher",
			["hover"],
			{ surface: "left-sidebar" },
		),
		pseudoItem(
			"chrome.vault-actions-icon.hover",
			"clickable-icon",
			".workspace-drawer-vault-actions .clickable-icon",
			["hover"],
			{ surface: "left-sidebar" },
		),
		{
			id: "chrome.view-header",
			component: "view-header",
			target: { sel: ".view-header", in: "leaf" },
		},
		{
			id: "chrome.view-header-nav.disabled",
			component: "clickable-icon",
			target: { sel: ".view-header-nav-buttons .clickable-icon[aria-disabled='true']", in: "leaf" },
			state: "disabled",
		},
		pseudoItem(
			"chrome.view-action.hover",
			"clickable-icon",
			{ sel: ".view-actions .clickable-icon", in: "leaf" },
			["hover"],
		),
		pseudoItem(
			"chrome.view-header-title.hover",
			"view-header",
			{ sel: ".view-header-title", in: "leaf" },
			["hover"],
		),
		{ id: "chrome.status-bar", component: "status-bar", target: ".status-bar" },
		{
			id: "chrome.status-bar-item.clickable",
			component: "status-bar-item",
			target: ".status-bar-item.mod-clickable",
		},
		pseudoItem(
			"chrome.status-bar-item.hover",
			"status-bar-item",
			".status-bar-item.mod-clickable",
			["hover"],
		),
		{
			id: "chrome.resize-handle",
			component: "resize-handle",
			target: ".workspace-split.mod-left-split > .workspace-leaf-resize-handle",
		},
		pseudoItem(
			"chrome.resize-handle.hover",
			"resize-handle",
			".workspace-split.mod-left-split > .workspace-leaf-resize-handle",
			["hover"],
		),
		{
			id: "chrome.file-explorer",
			component: "file-explorer",
			target: '.workspace-leaf-content[data-type="file-explorer"]',
			surface: "left-sidebar",
		},
		{
			id: "chrome.nav-buttons",
			component: "clickable-icon",
			target: ".nav-buttons-container",
			surface: "left-sidebar",
		},
		pseudoItem(
			"chrome.nav-button.hover",
			"clickable-icon",
			".nav-buttons-container .clickable-icon",
			["hover"],
			{ surface: "left-sidebar" },
		),
		{
			id: "chrome.nav-folder.collapsed",
			component: "tree-item",
			target: ".nav-folder.is-collapsed",
			state: "collapsed",
			surface: "left-sidebar",
		},
		{
			id: "chrome.nav-folder.expanded",
			component: "tree-item",
			target: ".nav-folder:not(.is-collapsed):not(.mod-root)",
			state: "expanded",
			surface: "left-sidebar",
		},
		{
			id: "chrome.nav-file.active",
			component: "nav-file",
			target: ".nav-file-title.is-active",
			state: "is-active",
			surface: "left-sidebar",
		},
		pseudoItem("chrome.nav-file.hover", "nav-file", ".nav-file-title:not(.is-active)", ["hover"], {
			surface: "left-sidebar",
		}),
		pseudoItem("chrome.nav-file.active.hover", "nav-file", ".nav-file-title.is-active", ["hover"], {
			surface: "left-sidebar",
		}),
		{
			id: "chrome.nav-file-tag",
			component: "nav-file",
			target: ".nav-file-tag",
			surface: "left-sidebar",
		},
		{
			id: "chrome.backlinks-pane",
			component: "backlinks",
			target: '.workspace-leaf-content[data-type="backlink"]',
			surface: "right-sidebar",
		},
		{
			id: "chrome.scrollbar",
			component: "scrollbar",
			target: { sel: ".cm-scroller", in: "leaf" },
			state: "scrollbar-hover",
			before: async (ctx) => {
				const p = await ctx.js<[number, number] | null>(
					"const s = cap.ROOTS.leaf().querySelector('.cm-scroller'); if (!s) return null; const r = s.getBoundingClientRect(); return [r.right - 4, r.top + 40];",
				);
				if (p) await ctx.page.mouse.move(p[0], p[1]);
				await ctx.sleep(200);
			},
			note: "Real pointer over the scrollbar thumb; ::-webkit-scrollbar-thumb:hover.",
		},
	],
};

const editorStates: Scene = {
	id: "editor-states",
	surface: "editor-live-preview",
	source: "catalog:editor-states",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Kitchen sink.md", "live");
	},
	items: [
		{
			id: "editor.active-line",
			component: "editor-line",
			target: { sel: ".cm-line.cm-active", in: "leaf" },
			state: "active-line",
			before: async (ctx) => {
				await ctx.js(
					"app.workspace.activeEditor.editor.setCursor({ line: 7, ch: 3 }); app.workspace.activeEditor.editor.focus();",
				);
			},
		},
		{
			id: "editor.selection",
			component: "editor-line",
			target: { sel: ".cm-content", in: "leaf" },
			state: "selection",
			before: async (ctx) => {
				await ctx.js(
					"const e = app.workspace.activeEditor.editor; e.focus(); e.setSelection({ line: 7, ch: 0 }, { line: 7, ch: 40 });",
				);
			},
			note: "Native selection in the editor: ::selection and .cm-selectionBackground.",
		},
		{
			id: "editor.reading-selection",
			component: "paragraph",
			surface: "editor-reading-view",
			target: { sel: ".markdown-reading-view .markdown-rendered", in: "leaf" },
			state: "selection",
			before: async (ctx) => {
				await ctx.open("Markdown/Kitchen sink.md", "reading");
				await ctx.js(
					"const p = cap.ROOTS.leaf().querySelector('.markdown-reading-view p'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r);",
				);
			},
		},
		pseudoItem(
			"editor.link.hover",
			"internal-link",
			{ sel: ".markdown-reading-view a.internal-link", in: "leaf" },
			["hover"],
			{ surface: "editor-reading-view" },
		),
		pseudoItem(
			"editor.link.focus",
			"internal-link",
			{ sel: ".markdown-reading-view a.internal-link", in: "leaf" },
			["focus"],
			{ surface: "editor-reading-view" },
		),
		pseudoItem(
			"editor.link.hover-focus",
			"internal-link",
			{ sel: ".markdown-reading-view a.internal-link", in: "leaf" },
			["hover", "focus"],
			{ surface: "editor-reading-view" },
		),
		pseudoItem(
			"editor.external-link.hover",
			"external-link",
			{ sel: ".markdown-reading-view a.external-link", in: "leaf" },
			["hover"],
			{
				surface: "editor-reading-view",
				before: (ctx) => ctx.open("Markdown/Links.md", "reading"),
			},
		),
		pseudoItem(
			"editor.tag.hover",
			"tag",
			{ sel: ".markdown-reading-view a.tag", in: "leaf" },
			["hover"],
			{ surface: "editor-reading-view", before: (ctx) => ctx.open("Markdown/Tags.md", "reading") },
		),
		{
			id: "editor.hashtag.hover",
			component: "tag",
			target: { sel: ".markdown-source-view .cm-line", text: "Inline tags", in: "leaf" },
			pseudo: ["hover"],
			pseudoOn: { sel: ".markdown-source-view .cm-hashtag-end", in: "leaf" },
			state: "hover",
			before: async (ctx) => {
				await ctx.open("Markdown/Tags.md", "live");
				await ctx.js("app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });");
			},
		},
		{
			id: "editor.edit-block-button",
			component: "clickable-icon",
			target: { sel: ".cm-embed-block", text: "Note", in: "leaf" },
			pseudo: ["hover"],
			pseudoOn: { sel: ".cm-embed-block", text: "Note", in: "leaf" },
			state: "block-hover",
			before: async (ctx) => {
				await ctx.open("Markdown/Kitchen sink.md", "live");
			},
		},
		pseudoItem(
			"editor.edit-block-button.hover",
			"clickable-icon",
			{ sel: ".cm-embed-block .edit-block-button", in: "leaf" },
			["hover"],
		),
		pseudoItem(
			"editor.task-checkbox.hover",
			"checkbox",
			{ sel: ".markdown-source-view .task-list-item-checkbox", in: "leaf" },
			["hover"],
			{ before: (ctx) => ctx.open("Markdown/Lists and tasks.md", "live") },
		),
		pseudoItem(
			"editor.copy-code-button.hover",
			"clickable-icon",
			{ sel: ".markdown-reading-view pre .copy-code-button", in: "leaf" },
			["hover"],
			{ surface: "editor-reading-view", before: (ctx) => ctx.open("Markdown/Code.md", "reading") },
		),
		{
			id: "editor.code-block.hover",
			component: "code-block",
			target: { sel: ".markdown-reading-view pre", in: "leaf" },
			pseudo: ["hover"],
			surface: "editor-reading-view",
		},
		{
			id: "editor.callout-collapsed-expanded",
			component: "callout",
			target: { sel: ".markdown-reading-view .callout.is-collapsible", in: "leaf" },
			state: "expanded-after-click",
			surface: "editor-reading-view",
			before: async (ctx) => {
				await ctx.open("Markdown/Callouts.md", "reading");
				await ctx.js(
					"const c = cap.ROOTS.leaf().querySelector('.markdown-reading-view .callout.is-collapsed .callout-title'); c?.click(); await sleep(300);",
				);
			},
		},
		{
			id: "editor.heading-collapsed",
			component: "heading",
			target: { sel: ".markdown-reading-view .is-collapsed", in: "leaf" },
			state: "collapsed",
			surface: "editor-reading-view",
			before: async (ctx) => {
				await ctx.open("Markdown/Headings.md", "reading");
				await ctx.js(
					"const h = cap.ROOTS.leaf().querySelector('.markdown-reading-view .heading-collapse-indicator'); h?.click(); await sleep(300);",
				);
			},
		},
		{
			id: "editor.list-collapsed",
			component: "list",
			target: { sel: ".markdown-source-view .cm-line", text: "Parent item that folds", in: "leaf" },
			state: "folded",
			before: async (ctx) => {
				await ctx.open("Markdown/Lists and tasks.md", "live");
				await ctx.js(
					"const ed = app.workspace.activeEditor.editor; const n = ed.getValue().split('\\n').findIndex((l) => l.includes('Parent item that folds')); ed.setCursor({ line: n, ch: 2 }); app.commands.executeCommandById('editor:toggle-fold'); await sleep(300); ed.setCursor({ line: 0, ch: 0 });",
				);
			},
		},
		{
			id: "editor.folded-heading-live",
			component: "heading",
			target: { sel: ".markdown-source-view .cm-line.HyperMD-header", in: "leaf" },
			state: "folded",
			before: async (ctx) => {
				await ctx.open("Markdown/Headings.md", "live");
				await ctx.js(
					"const ed = app.workspace.activeEditor.editor; ed.setCursor({ line: 0, ch: 1 }); app.commands.executeCommandById('editor:toggle-fold'); await sleep(300);",
				);
			},
		},
		{
			id: "editor.line-numbers",
			component: "gutter",
			target: { sel: ".cm-gutters", in: "leaf" },
			before: async (ctx) => {
				await ctx.open("Markdown/Kitchen sink.md", "source");
				await ctx.js("app.vault.setConfig('showLineNumber', true); await sleep(400);");
			},
		},
		{
			id: "editor.readable-line-length-off",
			component: "markdown-view",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			state: "readable-line-length-off",
			full: true,
			before: async (ctx) => {
				await ctx.js(
					"app.vault.setConfig('showLineNumber', false); app.vault.setConfig('readableLineLength', false); await sleep(400);",
				);
			},
		},
		{
			id: "editor.document-search",
			component: "search-input",
			target: { sel: ".document-search-container", in: "leaf" },
			before: async (ctx) => {
				await ctx.js("app.vault.setConfig('readableLineLength', true);");
				await ctx.open("Markdown/Kitchen sink.md", "live");
				await ctx.command("editor:open-search");
				await ctx.page.keyboard.type("task");
				await ctx.sleep(400);
			},
		},
		{
			id: "editor.document-search-match",
			component: "editor-line",
			target: { sel: ".cm-searchMatch, .cm-line", in: "leaf" },
			state: "search-match",
		},
		{
			id: "editor.document-replace",
			component: "search-input",
			target: {
				sel: ".document-search-container.mod-replace-mode, .document-search-container",
				in: "leaf",
			},
			state: "replace-mode",
			before: async (ctx) => {
				await ctx.command("editor:open-search-replace");
				await ctx.sleep(300);
			},
		},
		pseudoItem(
			"editor.inline-title.focus",
			"inline-title",
			{ sel: ".markdown-source-view .inline-title", in: "leaf" },
			["focus"],
			{
				before: async (ctx) => {
					await ctx.page.keyboard.press("Escape");
					await ctx.open("Markdown/Kitchen sink.md", "live");
				},
			},
		),
	],
};

const propertyStates: Scene = {
	id: "properties",
	surface: "properties",
	source: "catalog:properties",
	setup: (ctx) => ctx.open("Markdown/Properties.md", "live"),
	items: [
		{
			id: "properties.tag-pill",
			component: "multi-select-pill",
			target: {
				sel: '.metadata-property[data-property-key="tags"] .multi-select-pill',
				in: "leaf",
			},
		},
		pseudoItem(
			"properties.tag-pill.hover",
			"multi-select-pill",
			{ sel: '.metadata-property[data-property-key="tags"] .multi-select-pill', in: "leaf" },
			["hover"],
		),
		pseudoItem(
			"properties.pill-remove.hover",
			"clickable-icon",
			{ sel: ".multi-select-pill-remove-button", in: "leaf" },
			["hover"],
		),
		{
			id: "properties.list-pill",
			component: "multi-select-pill",
			target: {
				sel: '.metadata-property[data-property-key="list"] .multi-select-pill',
				in: "leaf",
			},
		},
		{
			id: "properties.add-button",
			component: "button",
			target: { sel: ".metadata-container .metadata-add-button", in: "leaf" },
		},
		pseudoItem(
			"properties.add-button.hover",
			"button",
			{ sel: ".metadata-container .metadata-add-button", in: "leaf" },
			["hover"],
		),
		pseudoItem(
			"properties.key-input.focus",
			"text-input",
			{ sel: "input.metadata-property-key-input", in: "leaf" },
			["focus"],
		),
		pseudoItem(
			"properties.value.focus",
			"text-input",
			{ sel: '.metadata-property[data-property-key="title"] .metadata-property-value', in: "leaf" },
			["focus-within"],
		),
		pseudoItem(
			"properties.title.hover",
			"metadata-container",
			{ sel: ".metadata-properties-title", in: "leaf" },
			["hover"],
		),
		{
			id: "properties.collapsed",
			component: "metadata-container",
			target: { sel: ".metadata-container", in: "leaf" },
			state: "collapsed",
			before: async (ctx) => {
				await ctx.command("editor:toggle-fold-properties");
				await ctx.sleep(300);
			},
		},
		{
			id: "properties.key-suggest",
			component: "suggestion",
			target: ".suggestion-container.mod-property-key",
			surface: "suggestion-popup",
			before: async (ctx) => {
				await ctx.command("editor:toggle-fold-properties");
				await ctx.sleep(300);
				await click(ctx, { sel: ".metadata-add-button", in: "leaf" });
				await ctx.sleep(400);
			},
		},
		{
			id: "properties.key-suggest-item",
			component: "suggestion",
			target: ".suggestion-container.mod-property-key .suggestion-item",
			surface: "suggestion-popup",
		},
		pseudoItem(
			"properties.key-suggest-item.hover",
			"suggestion",
			".suggestion-container.mod-property-key .suggestion-item.mod-complex",
			["hover"],
			{ surface: "suggestion-popup" },
		),
		{
			id: "properties.key-suggest-item.selected",
			component: "suggestion",
			target: ".suggestion-container.mod-property-key .suggestion-item.is-selected",
			state: "is-selected",
			surface: "suggestion-popup",
			before: async (ctx) => {
				await ctx.page.keyboard.press("ArrowDown");
				await ctx.sleep(200);
			},
		},
		{
			id: "properties.type-menu",
			component: "menu",
			target: ".menu",
			surface: "menu",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.sleep(200);
				await click(ctx, {
					sel: '.metadata-property[data-property-key="count"] .metadata-property-icon',
					in: "leaf",
				});
			},
		},
		{
			id: "properties.date-input",
			component: "text-input",
			target: { sel: '.metadata-property[data-property-key="created"] input', in: "leaf" },
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.sleep(200);
			},
		},
		{
			id: "properties.checkbox-checked",
			component: "checkbox",
			target: {
				sel: '.metadata-property[data-property-key="done"] input[type=checkbox]',
				in: "leaf",
			},
			state: "checked",
		},
		{
			id: "properties.reading-view",
			component: "metadata-container",
			surface: "editor-reading-view",
			target: { sel: ".markdown-reading-view .metadata-container", in: "leaf" },
			before: (ctx) => ctx.open("Markdown/Properties.md", "reading"),
		},
	],
};

/** Opens a context menu and records it plus its item states. */
function menuScene(
	id: string,
	surface: string,
	open: (ctx: Ctx) => Promise<void>,
	extra: ItemDef[] = [],
): Scene {
	return {
		id: `menu.${id}`,
		surface: "menu",
		source: `catalog:menu:${surface}`,
		setup: async (ctx) => {
			await baseLayout(ctx);
			await open(ctx);
		},
		items: [
			{ id: `menu.${id}`, component: "menu", target: ".menu", note: `Opened from ${surface}` },
			pseudoItem(`menu.${id}.item.hover`, "menu-item", ".menu .menu-item:not(.is-disabled)", [
				"hover",
			]),
			...extra,
		],
	};
}

const menus: Scene[] = [
	menuScene("file", "file explorer file", (ctx) => rightClick(ctx, ".nav-file-title.is-active"), [
		{ id: "menu.file.separator", component: "menu", target: ".menu .menu-separator" },
		{ id: "menu.file.item-icon", component: "menu-item", target: ".menu .menu-item-icon" },
		{
			id: "menu.file.warning-item",
			component: "menu-item",
			target: ".menu .menu-item.is-warning",
			state: "is-warning",
		},
		{
			id: "menu.file.submenu",
			component: "menu",
			target: { sel: ".menu", nth: 1 },
			state: "submenu-open",
			before: async (ctx) => {
				await ctx.js(
					"const it = [...document.querySelectorAll('.menu .menu-item')].find((e) => e.querySelector('.menu-item-icon.mod-submenu')); it?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); it?.click(); await sleep(500);",
				);
			},
		},
	]),
	menuScene("folder", "file explorer folder", (ctx) => rightClick(ctx, ".nav-folder-title")),
	menuScene("editor", "editor", async (ctx) => {
		await ctx.open("Markdown/Kitchen sink.md", "live");
		await rightClick(ctx, { sel: ".cm-line", text: "Text with", in: "leaf" });
	}),
	menuScene("editor-link", "editor link", async (ctx) => {
		await ctx.open("Markdown/Links.md", "reading");
		await rightClick(ctx, { sel: ".markdown-reading-view a.internal-link", in: "leaf" });
	}),
	menuScene("tab", "tab header", (ctx) =>
		rightClick(ctx, ".mod-root .workspace-tab-header.is-active"),
	),
	menuScene("tab-list", "tab list dropdown", (ctx) =>
		click(ctx, ".mod-root .workspace-tab-header-tab-list .clickable-icon"),
	),
	menuScene("more-options", "view header more options", (ctx) =>
		click(ctx, { sel: '.view-actions .clickable-icon[aria-label="More options"]', in: "leaf" }),
	),
	menuScene("ribbon", "ribbon", (ctx) => rightClick(ctx, ".workspace-ribbon")),
	menuScene("vault-switcher", "vault profile", (ctx) =>
		click(ctx, ".workspace-drawer-vault-switcher"),
	),
	menuScene("sort", "file explorer sort button", (ctx) =>
		click(ctx, '.nav-buttons-container .clickable-icon[aria-label="Change sort order"]'),
	),
];

/** In-editor suggestion popups. */
async function typeIn(ctx: Ctx, text: string): Promise<void> {
	await ctx.open("Folder/Note in folder.md", "live");
	await ctx.js(
		"const e = app.workspace.activeEditor.editor; e.focus(); e.setCursor({ line: e.lastLine(), ch: e.getLine(e.lastLine()).length }); e.replaceSelection('\\n');",
	);
	await ctx.page.keyboard.type(text, { delay: 30 });
	await ctx.sleep(600);
}

const suggestions: Scene[] = [
	["link", "[[Head"],
	["heading", "[[Headings#"],
	["block", "[[Links#^"],
	["tag", "#the"],
	["slash", "/head"],
	["embed", "![[sample"],
].map(
	([id, text]): Scene => ({
		id: `suggest.${id}`,
		surface: "suggestion-popup",
		source: "catalog:suggest",
		setup: (ctx) => typeIn(ctx, text as string),
		items: [
			{ id: `suggest.${id}`, component: "suggestion", target: ".suggestion-container" },
			{
				id: `suggest.${id}.selected`,
				component: "suggestion",
				target: ".suggestion-container .suggestion-item.is-selected",
				state: "is-selected",
			},
			pseudoItem(
				`suggest.${id}.item.hover`,
				"suggestion",
				".suggestion-container .suggestion-item:not(.is-selected)",
				["hover"],
			),
		],
	}),
);

const popovers: Scene = {
	id: "popover",
	surface: "popover",
	source: "catalog:popover",
	setup: async (ctx) => {
		await ctx.open("Markdown/Links.md", "reading");
		const box = await ctx.js<[number, number]>(
			"const a = cap.ROOTS.leaf().querySelector('.markdown-reading-view a.internal-link'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
		);
		await ctx.page.mouse.move(box[0], box[1] - 30);
		await ctx.page.keyboard.down("Control");
		await ctx.page.mouse.move(box[0], box[1], { steps: 4 });
		await ctx.sleep(1500);
		await ctx.page.keyboard.up("Control");
	},
	items: [
		{ id: "popover.page-preview", component: "popover", target: ".popover.hover-popover" },
		{
			id: "popover.footnote",
			component: "popover",
			target: ".popover.hover-popover",
			state: "footnote",
			before: async (ctx) => {
				await ctx.js("document.querySelectorAll('.popover').forEach((p) => p.remove());");
				await ctx.open("Markdown/Footnotes.md", "reading");
				const box = await ctx.js<[number, number] | null>(
					"const a = cap.ROOTS.leaf().querySelector('.markdown-reading-view .footnote-link, .markdown-reading-view sup a'); if (!a) return null; const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
				);
				if (box) {
					await ctx.page.mouse.move(box[0], box[1]);
					await ctx.sleep(1500);
				}
			},
		},
		{
			id: "popover.tooltip",
			component: "tooltip",
			target: ".tooltip",
			before: async (ctx) => {
				await ctx.page.mouse.move(5, 5);
				const box = await ctx.js<[number, number] | null>(
					"const a = document.querySelector('.workspace-ribbon .clickable-icon'); const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];",
				);
				if (box) {
					await ctx.page.mouse.move(box[0], box[1]);
					await ctx.sleep(1600);
				}
			},
		},
		{
			id: "popover.notice",
			component: "notice",
			target: ".notice",
			before: async (ctx) => {
				await ctx.page.mouse.move(800, 500);
				await ctx.command("workspace:copy-path");
				await ctx.sleep(300);
			},
		},
	],
};

/** Prompt-style modals opened by commands, with their inner states. */
const prompts: Scene = {
	id: "prompt.command-palette",
	surface: "modal",
	source: "catalog:prompt",
	setup: async (ctx) => {
		await ctx.open("Markdown/Kitchen sink.md", "live");
		await ctx.command("command-palette:open");
		await ctx.sleep(400);
		await ctx.page.keyboard.type("toggle", { delay: 20 });
		await ctx.sleep(400);
	},
	items: [
		{ id: "prompt.command-palette", component: "prompt", target: ".prompt" },
		{
			id: "prompt.item.selected",
			component: "suggestion",
			target: ".prompt .suggestion-item.is-selected",
			state: "is-selected",
		},
		pseudoItem("prompt.item.hover", "suggestion", ".prompt .suggestion-item:not(.is-selected)", [
			"hover",
		]),
		{ id: "prompt.hotkey", component: "kbd", target: ".prompt .suggestion-hotkey, .prompt kbd" },
		pseudoItem("prompt.input.focus-visible", "text-input", "input.prompt-input", ["focus-visible"]),
		pseudoItem(
			"prompt.clear-button.hover",
			"clickable-icon",
			".prompt .search-input-clear-button",
			["hover"],
		),
		{
			id: "prompt.clear-button",
			component: "clickable-icon",
			target: ".prompt .search-input-clear-button",
		},
		{
			id: "prompt.quick-switcher",
			component: "prompt",
			target: ".prompt",
			state: "quick-switcher",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.command("switcher:open");
				await ctx.sleep(300);
				await ctx.page.keyboard.type("no", { delay: 20 });
				await ctx.sleep(400);
			},
		},
		{
			id: "prompt.quick-switcher-highlight",
			component: "suggestion",
			target: ".prompt .suggestion-highlight",
		},
		{
			id: "prompt.instructions",
			component: "prompt",
			target: ".prompt-instructions",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.command("file-explorer:move-file");
				await ctx.sleep(400);
			},
			note: "The command palette shows no instructions in 1.15.1; the move-file prompt does.",
		},
		{
			id: "prompt.instruction-command",
			component: "prompt",
			target: ".prompt-instruction-command",
		},
	],
};

const modalControls: Scene = {
	id: "modal.controls",
	surface: "settings",
	source: "catalog:modal-controls",
	window: "popout",
	opener: settingsWindow("editor"),
	setup: async (ctx) => {
		await ctx.js("cap.clearSettingsSearch(); app.setting.openTabById('editor'); await sleep(500);");
	},
	items: [
		{
			id: "modal.shell",
			component: "modal",
			target: "body",
			state: "settings-window",
			full: true,
			note: "Settings open in their own popout window (body.is-popout-modal) in Obsidian 1.14.",
		},
		{
			id: "modal.header-button",
			component: "clickable-icon",
			target: ".modal .modal-header-button",
		},
		pseudoItem("modal.header-button.hover", "clickable-icon", ".modal .modal-header-button", [
			"hover",
		]),
		{
			id: "modal.vertical-tab-group-title",
			component: "vertical-tab",
			target: ".modal .vertical-tab-header-group-title",
		},
		pseudoItem(
			"modal.vertical-tab.hover",
			"vertical-tab",
			".modal .vertical-tab-nav-item:not(.is-active)",
			["hover"],
		),
		pseudoItem(
			"modal.vertical-tab.active.hover",
			"vertical-tab",
			".modal .vertical-tab-nav-item.is-active",
			["hover"],
		),
		{
			id: "modal.vertical-tab.active",
			component: "vertical-tab",
			target: ".modal .vertical-tab-nav-item.is-active",
			state: "is-active",
		},
		{
			id: "modal.toggle.on",
			component: "toggle",
			target: ".modal .checkbox-container.is-enabled",
			state: "on",
		},
		{
			id: "modal.toggle.off",
			component: "toggle",
			target: ".modal .checkbox-container:not(.is-enabled)",
			state: "off",
		},
		pseudoItem("modal.toggle.focus-visible", "toggle", ".modal .checkbox-container", [
			"focus-visible",
		]),
		{ id: "modal.dropdown", component: "dropdown", target: ".modal select.dropdown" },
		pseudoItem("modal.dropdown.hover", "dropdown", ".modal select.dropdown", ["hover"]),
		pseudoItem("modal.dropdown.active", "dropdown", ".modal select.dropdown", ["active"]),
		pseudoItem("modal.dropdown.focus", "dropdown", ".modal select.dropdown", ["focus"]),
		{
			id: "modal.dropdown-option.checked",
			component: "dropdown",
			target: ".modal select.dropdown option:checked",
			state: "checked",
		},
		{ id: "modal.slider", component: "slider", target: ".modal input[type=range]" },
		pseudoItem("modal.slider.hover", "slider", ".modal input[type=range]", ["hover"]),
		{ id: "modal.setting-item", component: "setting-item", target: ".modal .setting-item" },
		{
			id: "modal.setting-heading",
			component: "setting-item",
			target: ".modal .setting-item-heading",
		},
		{
			id: "modal.button",
			component: "button",
			target: ".modal button:not(.mod-cta)",
			before: async (ctx) => {
				await ctx.js("app.setting.openTabById('about'); await sleep(400);");
			},
		},
		pseudoItem("modal.button.hover", "button", ".modal button:not(.mod-cta)", ["hover"]),
		{ id: "modal.button-cta", component: "button-cta", target: ".modal button.mod-cta" },
		pseudoItem("modal.button-cta.hover", "button-cta", ".modal button.mod-cta", ["hover"]),
		{
			id: "modal.text-input",
			component: "text-input",
			target: ".modal input[type=text], .modal input:not([type])",
			before: async (ctx) => {
				await ctx.js("app.setting.openTabById('file'); await sleep(400);");
			},
		},
		pseudoItem(
			"modal.text-input.hover",
			"text-input",
			".modal input[type=text], .modal input:not([type])",
			["hover"],
		),
		pseudoItem(
			"modal.text-input.focus",
			"text-input",
			".modal input[type=text], .modal input:not([type])",
			["focus"],
		),
		pseudoItem("modal.clickable-icon.hover", "clickable-icon", ".modal .clickable-icon", ["hover"]),
		{
			id: "modal.hotkey",
			component: "hotkey",
			target: ".modal .setting-hotkey",
			before: async (ctx) => {
				await ctx.js("app.setting.openTabById('hotkeys'); await sleep(600);");
			},
		},
		pseudoItem("modal.hotkey.hover", "hotkey", ".modal .setting-hotkey", ["hover"]),
		{
			id: "modal.hotkey.recording",
			component: "hotkey",
			target: ".modal .setting-item",
			state: "recording",
			before: async (ctx) => {
				await ctx.js(
					"const b = document.querySelector('.modal .setting-command-hotkeys .clickable-icon[aria-label=\"Customize this command\"]'); b?.click(); await sleep(300);",
				);
			},
		},
		{
			id: "modal.search-setting",
			component: "search-input",
			target: ".modal .search-input-container",
			before: async (ctx) => {
				await ctx.js("app.setting.openTabById('hotkeys'); await sleep(400);");
				await click(ctx, ".modal .search-input-container input");
				await ctx.page.keyboard.type("bold", { delay: 20 });
				await ctx.sleep(300);
			},
		},
		pseudoItem("modal.search-clear.hover", "clickable-icon", ".modal .search-input-clear-button", [
			"hover",
		]),
		{
			id: "modal.appearance",
			component: "setting-item",
			target: ".modal.mod-settings",
			state: "appearance",
			before: async (ctx) => {
				await ctx.js(
					"cap.clearSettingsSearch(); app.setting.openTabById('appearance'); await sleep(600);",
				);
			},
		},
	],
};

const lightMode: Scene = {
	id: "light-mode",
	surface: "workspace",
	source: "catalog:light-mode",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.js(
			"app.changeTheme?.('moonstone') ?? app.setTheme?.('moonstone'); await sleep(600);",
		);
	},
	items: [
		{
			id: "light-mode.window",
			component: "workspace",
			target: ".app-container",
			state: "theme-light",
			full: true,
			note: "Base color scheme set to light; Miami Wind's .theme-light block applies the same palette.",
		},
		{
			id: "light-mode.restore",
			component: "workspace",
			target: ".app-container",
			state: "theme-dark",
			full: true,
			before: async (ctx) => {
				await ctx.js("app.changeTheme?.('system') ?? app.setTheme?.('system'); await sleep(600);");
			},
		},
	],
};

const canvas: Scene = {
	id: "canvas",
	surface: "canvas",
	source: "catalog:canvas",
	setup: async (ctx) => {
		await ctx.open("Canvas.canvas", "live");
		await ctx.js("app.workspace.activeLeaf.view.canvas?.zoomToFit?.(); await sleep(800);");
	},
	items: [
		{
			id: "canvas.view",
			component: "canvas",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
		},
		{ id: "canvas.controls", component: "canvas-controls", target: ".canvas-controls" },
		{ id: "canvas.control-group", component: "canvas-controls", target: ".canvas-control-group" },
		{ id: "canvas.control-item", component: "clickable-icon", target: ".canvas-control-item" },
		pseudoItem("canvas.control-item.hover", "clickable-icon", ".canvas-control-item", ["hover"]),
		{
			id: "canvas.node-text",
			component: "canvas-node",
			target: { sel: ".canvas-node", text: "Canvas text card" },
		},
		...[1, 2, 3, 4, 5, 6].map(
			(n): ItemDef => ({
				id: `canvas.node-color-${n}`,
				component: "canvas-node",
				target: `.canvas-node.mod-canvas-color-${n}`,
			}),
		),
		{
			id: "canvas.node-color-custom",
			component: "canvas-node",
			target: ".canvas-node.mod-canvas-color-custom",
		},
		{
			id: "canvas.node-file",
			component: "canvas-node",
			target: { sel: ".canvas-node", text: "Kitchen sink" },
		},
		{
			id: "canvas.node-image",
			component: "canvas-node",
			target: { sel: ".canvas-node .image-embed, .canvas-node img", closest: ".canvas-node" },
		},
		{
			id: "canvas.node-missing-file",
			component: "canvas-node",
			target: { sel: ".canvas-node", text: "Missing on purpose" },
		},
		{
			id: "canvas.node-link",
			component: "canvas-node",
			target: ".canvas-node.is-themed, .canvas-node:has(.canvas-link)",
		},
		{ id: "canvas.group", component: "canvas-node", target: ".canvas-node.canvas-node-group" },
		{ id: "canvas.edge", component: "canvas-edge", target: ".canvas-edges" },
		{
			id: "canvas.edge-label",
			component: "canvas-edge",
			target: ".canvas-path-label-wrapper, .canvas-path-label",
		},
		{
			id: "canvas.node-selected",
			component: "canvas-node",
			target: ".canvas-node.is-focused, .canvas-node.is-selected",
			state: "selected",
			before: async (ctx) => {
				await ctx.js(
					"const c = app.workspace.activeLeaf.view.canvas; const n = [...c.nodes.values()].find((x) => x.text?.includes('Colored card 1')); c.selectOnly(n); await sleep(400);",
				);
			},
		},
		{ id: "canvas.card-menu", component: "canvas-card-menu", target: ".canvas-card-menu" },
		{
			id: "canvas.card-menu-button",
			component: "clickable-icon",
			target: ".canvas-card-menu .canvas-card-menu-button",
		},
		pseudoItem(
			"canvas.card-menu-button.hover",
			"clickable-icon",
			".canvas-card-menu .canvas-card-menu-button",
			["hover"],
		),
		{ id: "canvas.selection-menu", component: "canvas-menu", target: ".canvas-menu" },
		pseudoItem("canvas.selection-menu.hover", "clickable-icon", ".canvas-menu .clickable-icon", [
			"hover",
		]),
		{
			id: "canvas.color-menu",
			component: "canvas-menu",
			target: ".canvas-submenu, .canvas-menu",
			state: "color-picker",
			before: async (ctx) => {
				await ctx.js(
					"const b = document.querySelector('.canvas-menu .clickable-icon[aria-label=\"Set color\"]'); b?.click(); await sleep(400);",
				);
			},
		},
		{
			id: "canvas.node-editing",
			component: "canvas-node",
			target: ".canvas-node.is-editing",
			state: "editing",
			before: async (ctx) => {
				await ctx.js(
					"const c = app.workspace.activeLeaf.view.canvas; const n = [...c.nodes.values()].find((x) => x.text?.includes('Canvas text card')); c.selectOnly(n); n.startEditing?.(); await sleep(800);",
				);
			},
		},
		{
			id: "canvas.context-menu",
			component: "menu",
			target: ".menu",
			surface: "menu",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.js("app.workspace.activeLeaf.view.canvas.deselectAll(); await sleep(200);");
				const box = await ctx.js<[number, number]>(
					"const r = cap.ROOTS.leaf().querySelector('.canvas-wrapper').getBoundingClientRect(); return [r.x + 40, r.bottom - 60];",
				);
				await ctx.page.mouse.click(box[0], box[1], { button: "right" });
				await ctx.sleep(400);
			},
		},
	],
};

const bases: Scene = {
	id: "bases",
	surface: "bases",
	source: "catalog:bases",
	setup: (ctx) => ctx.open("Base.base", "live"),
	items: [
		{
			id: "bases.view",
			component: "bases",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
		},
		{
			id: "bases.toolbar",
			component: "bases-toolbar",
			target: { sel: ".bases-toolbar", in: "leaf" },
		},
		{
			id: "bases.table",
			component: "bases-table",
			target: { sel: ".bases-table-container, .bases-view", in: "leaf" },
		},
		{
			id: "bases.table-header",
			component: "bases-table",
			target: { sel: ".bases-thead", in: "leaf" },
		},
		{
			id: "bases.table-row",
			component: "bases-table",
			target: { sel: ".bases-tbody .bases-tr, .bases-tr", in: "leaf" },
		},
		{
			id: "bases.table-footer",
			component: "bases-table",
			target: { sel: ".bases-table-footer", in: "leaf" },
		},
		pseudoItem("bases.table-cell.hover", "bases-table", { sel: ".bases-td", in: "leaf" }, [
			"hover",
		]),
		{
			id: "bases.views-menu",
			component: "menu",
			target: ".menu",
			surface: "menu",
			before: (ctx) => click(ctx, { sel: ".bases-toolbar-views-menu", in: "leaf" }),
		},
		pseudoItem(
			"bases.views-menu.item.hover",
			"menu-item",
			".menu .bases-toolbar-menu-item, .menu .menu-item",
			["hover"],
			{
				surface: "menu",
			},
		),
		{
			id: "bases.sort-menu",
			component: "menu",
			target: ".menu",
			surface: "menu",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await click(ctx, { sel: ".bases-toolbar-sort-menu", in: "leaf" });
			},
		},
		{
			id: "bases.properties-menu",
			component: "menu",
			target: ".menu",
			surface: "menu",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await click(ctx, { sel: ".bases-toolbar-properties-menu", in: "leaf" });
			},
		},
		{
			id: "bases.properties-menu.icon",
			component: "clickable-icon",
			target: ".menu .clickable-icon.bases-toolbar-menu-item-icon",
			surface: "menu",
		},
		pseudoItem(
			"bases.properties-menu.icon.hover",
			"clickable-icon",
			".menu .clickable-icon.bases-toolbar-menu-item-icon",
			["hover"],
			{
				surface: "menu",
			},
		),
		{
			id: "bases.properties-menu.hidden-item.hover",
			component: "menu-item",
			target: ".bases-toolbar-menu-item.mod-hidden",
			pseudo: ["hover"],
			surface: "menu",
		},
		{
			id: "bases.properties-menu.selected-icon",
			component: "clickable-icon",
			target: ".menu .bases-toolbar-menu-item.is-selected .clickable-icon",
			state: "is-selected",
			surface: "menu",
			before: async (ctx) => {
				await ctx.page.keyboard.press("ArrowDown");
				await ctx.sleep(200);
			},
		},
		{
			id: "bases.properties-menu.back-button",
			component: "clickable-icon",
			target: ".menu .back-button",
			surface: "menu",
			before: async (ctx) => {
				await ctx.js(
					"const add = [...document.querySelectorAll('.menu .bases-toolbar-menu-item, .menu .menu-item')].find((e) => /formula|add/i.test(e.textContent ?? '')); add?.click(); await sleep(400);",
				);
			},
		},
		pseudoItem(
			"bases.properties-menu.back-button.hover",
			"clickable-icon",
			".menu .back-button",
			["hover"],
			{
				surface: "menu",
			},
		),
		{
			id: "bases.properties-menu.back-icon.hover",
			component: "clickable-icon",
			target: ".menu .back-button .back-icon",
			pseudo: ["hover"],
			pseudoOn: ".menu .back-button",
			surface: "menu",
		},
		{
			id: "bases.filter-menu",
			component: "menu",
			target: ".menu, .popover",
			surface: "menu",
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await click(ctx, { sel: ".bases-toolbar-filter-menu", in: "leaf" });
			},
		},
		{
			id: "bases.filter-add-button",
			component: "button",
			target: ".bases-toolbar-section-content .text-icon-button",
			surface: "menu",
		},
		pseudoItem(
			"bases.filter-add-button.hover",
			"button",
			".bases-toolbar-section-content .text-icon-button",
			["hover"],
			{ surface: "menu" },
		),
		{ id: "bases.filter-row", component: "filter-row", target: ".filter-row", surface: "menu" },
		{
			id: "bases.filter-row-actions",
			component: "clickable-icon",
			target: ".filter-row-actions .clickable-icon",
			surface: "menu",
		},
		pseudoItem(
			"bases.filter-row-actions.hover",
			"clickable-icon",
			".filter-row-actions .clickable-icon",
			["hover"],
			{
				surface: "menu",
			},
		),
		{ id: "bases.combobox", component: "combobox", target: ".combobox-button", surface: "menu" },
		pseudoItem("bases.combobox.focus-within", "combobox", ".combobox-button", ["focus-within"], {
			surface: "menu",
		}),
		pseudoItem("bases.combobox.hover", "combobox", ".combobox-button", ["hover"], {
			surface: "menu",
		}),
		{
			id: "bases.cards",
			component: "bases-cards",
			target: { sel: ".bases-view", in: "leaf" },
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.keyboard.press("Escape");
				await ctx.js(
					"app.workspace.activeLeaf.view.controller?.selectView?.('Cards view') ?? app.commands.executeCommandById('bases:change-view'); await sleep(600);",
				);
				await ctx.js(
					"const items = [...document.querySelectorAll('.suggestion-item')]; items.find((e) => e.textContent.includes('Cards'))?.click(); await sleep(600);",
				);
			},
		},
		{
			id: "bases.list",
			component: "bases-list",
			target: { sel: ".bases-view", in: "leaf" },
			before: async (ctx) => {
				await ctx.command("bases:change-view");
				await ctx.sleep(400);
				await ctx.js(
					"[...document.querySelectorAll('.suggestion-item')].find((e) => e.textContent.includes('List'))?.click(); await sleep(600);",
				);
			},
		},
		{
			id: "bases.grouped",
			component: "bases-table",
			target: { sel: ".bases-view", in: "leaf" },
			before: async (ctx) => {
				await ctx.command("bases:change-view");
				await ctx.sleep(400);
				await ctx.js(
					"[...document.querySelectorAll('.suggestion-item')].find((e) => e.textContent.includes('Grouped'))?.click(); await sleep(600);",
				);
			},
		},
	],
};

const graph: Scene = {
	id: "graph",
	surface: "graph",
	source: "catalog:graph",
	setup: async (ctx) => {
		await ctx.command("graph:open");
		await ctx.sleep(2500);
	},
	items: [
		{
			id: "graph.view",
			component: "graph",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
			note: "Graph is drawn on a canvas; the fixture holds the DOM, the screenshot holds the pixels.",
		},
		{
			id: "graph.controls",
			component: "graph-controls",
			target: ".graph-controls",
			before: async (ctx) => {
				await ctx.js(
					"document.querySelectorAll('.graph-controls .tree-item.is-collapsed .tree-item-self, .graph-controls.is-close .clickable-icon').forEach((e) => e.click()); await sleep(500);",
				);
			},
		},
		pseudoItem("graph.controls-section.hover", "tree-item", ".graph-controls .tree-item-self", [
			"hover",
		]),
		{
			id: "graph.local",
			component: "graph",
			surface: "right-sidebar",
			target: '.workspace-leaf-content[data-type="localgraph"]',
			before: async (ctx) => {
				await ctx.open("Markdown/Links.md", "live");
				await ctx.command("graph:open-local");
				await ctx.sleep(2000);
			},
		},
	],
};

const pdf: Scene = {
	id: "pdf",
	surface: "pdf",
	source: "catalog:pdf",
	setup: async (ctx) => {
		await ctx.open("Attachments/sample.pdf", "live");
		await ctx.sleep(1500);
	},
	items: [
		{
			id: "pdf.view",
			component: "pdf",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
		},
		{ id: "pdf.toolbar", component: "pdf-toolbar", target: { sel: ".pdf-toolbar", in: "leaf" } },
		pseudoItem(
			"pdf.toolbar-button.hover",
			"clickable-icon",
			{ sel: ".pdf-toolbar .clickable-icon, .pdf-toolbar-button", in: "leaf" },
			["hover"],
		),
		{ id: "pdf.page", component: "pdf", target: { sel: ".pdfViewer .page", in: "leaf" } },
		{
			id: "pdf.sidebar",
			component: "pdf",
			target: { sel: ".pdf-sidebar-container", in: "leaf" },
			before: async (ctx) => {
				await ctx.js(
					"const b = cap.ROOTS.leaf().querySelector('.pdf-toolbar .clickable-icon[aria-label*=\"sidebar\" i]'); b?.click(); await sleep(1200);",
				);
			},
		},
		{
			id: "pdf.findbar",
			component: "search-input",
			target: { sel: ".pdf-findbar", in: "leaf" },
			before: async (ctx) => {
				await ctx.js("cap.ROOTS.leaf().querySelector('.pdf-viewer-container')?.focus();");
				await ctx.page.keyboard.press("Control+f");
				await ctx.page.keyboard.type("Lorem", { delay: 20 });
				await ctx.page.keyboard.press("Enter");
				await ctx.sleep(800);
			},
		},
		{
			id: "pdf.highlight",
			component: "pdf",
			target: { sel: ".textLayer .highlight", in: "leaf" },
			state: "search-highlight",
		},
	],
};

const mediaAndOther: Scene = {
	id: "media",
	surface: "file-view",
	source: "catalog:media",
	setup: async () => {},
	items: [
		{
			id: "view.image",
			component: "image-view",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
			before: (ctx) => ctx.open("Attachments/sample-image.png", "live"),
		},
		{
			id: "view.audio",
			component: "audio-view",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
			before: (ctx) => ctx.open("Attachments/sample-audio.wav", "live"),
		},
		{
			id: "view.video",
			component: "video-view",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
			before: (ctx) => ctx.open("Attachments/sample-video.mp4", "live"),
		},
		{
			id: "view.empty",
			component: "empty-state",
			target: { sel: ".workspace-leaf-content", in: "leaf" },
			full: true,
			before: async (ctx) => {
				await ctx.command("workspace:new-tab");
				await ctx.sleep(400);
			},
		},
		pseudoItem(
			"view.empty.action.hover",
			"empty-state",
			{ sel: ".empty-state-action", in: "leaf" },
			["hover"],
		),
		{
			id: "view.stacked-tabs",
			component: "tab-header",
			target: ".mod-root .workspace-tabs.mod-stacked",
			state: "stacked",
			full: true,
			before: async (ctx) => {
				await ctx.open("Markdown/Headings.md", "live", { newLeaf: true });
				await ctx.command("workspace:toggle-stacked-tabs");
				await ctx.sleep(600);
			},
		},
		{
			id: "view.split",
			component: "workspace",
			target: ".workspace-split.mod-root",
			state: "split-vertical",
			full: true,
			before: async (ctx) => {
				await ctx.command("workspace:toggle-stacked-tabs");
				await ctx.command("workspace:split-vertical");
				await ctx.sleep(600);
			},
		},
		{
			id: "view.pinned-tab",
			component: "tab-header",
			target: ".mod-root .workspace-tab-header.is-active",
			state: "pinned",
			before: async (ctx) => {
				await ctx.command("workspace:toggle-pin");
				await ctx.sleep(300);
			},
		},
		{
			id: "view.window-unfocused",
			component: "workspace",
			target: ".app-container",
			state: "unfocused",
			full: true,
			before: async (ctx) => {
				await ctx.command("workspace:toggle-pin");
				await ctx.js("document.body.classList.remove('is-focused'); await sleep(300);");
			},
			note: "is-focused removed by script: the headless window never loses OS focus.",
		},
		{
			id: "view.ribbon-hidden",
			component: "workspace",
			target: ".app-container",
			state: "ribbon-hidden",
			full: true,
			before: async (ctx) => {
				await ctx.js("document.body.classList.add('is-focused');");
				await ctx.command("app:toggle-ribbon");
				await ctx.sleep(300);
			},
		},
		{
			id: "view.sidebars-collapsed",
			component: "workspace",
			target: ".app-container",
			state: "sidebars-collapsed",
			full: true,
			before: async (ctx) => {
				await ctx.command("app:toggle-ribbon");
				await ctx.command("app:toggle-left-sidebar");
				await ctx.command("app:toggle-right-sidebar");
				await ctx.sleep(500);
			},
		},
		{
			id: "view.drag-ghost",
			component: "drag-ghost",
			target: ".drag-ghost",
			before: async (ctx) => {
				await ctx.command("app:toggle-left-sidebar");
				await ctx.command("app:toggle-right-sidebar");
				await ctx.sleep(400);
				const box = await ctx.js<[number, number]>(
					"const r = document.querySelector('.nav-folder-title, .nav-file-title').getBoundingClientRect(); return [r.x + 30, r.y + r.height / 2];",
				);
				await ctx.page.mouse.move(box[0], box[1]);
				await ctx.page.mouse.down();
				await ctx.page.mouse.move(box[0] + 60, box[1] + 40, { steps: 6 });
				await ctx.page.mouse.move(box[0] + 400, box[1] + 200, { steps: 10 });
				await ctx.sleep(300);
			},
		},
		{
			id: "view.drop-overlay",
			component: "drag-ghost",
			target: ".workspace-drop-overlay, .app-container",
			state: "dragging",
			full: true,
			before: async (ctx) => {
				await ctx.page.mouse.move(900, 500, { steps: 5 });
				await ctx.sleep(300);
			},
		},
		{
			id: "view.drag-end",
			component: "workspace",
			target: ".app-container",
			state: "after-drag",
			full: true,
			before: async (ctx) => {
				await ctx.page.keyboard.press("Escape");
				await ctx.page.mouse.up();
				await ctx.sleep(400);
			},
		},
	],
};

const sidebarViews: Scene = {
	id: "sidebar-views",
	surface: "right-sidebar",
	source: "catalog:sidebar-views",
	setup: async (ctx) => {
		await baseLayout(ctx);
		await ctx.open("Markdown/Links.md", "live");
	},
	items: [
		{
			id: "sidebar.search-results",
			component: "search-result",
			surface: "left-sidebar",
			target: '.workspace-leaf-content[data-type="search"]',
			before: async (ctx) => {
				await ctx.js(
					"const l = app.workspace.getLeavesOfType('search')[0]; app.workspace.revealLeaf(l); l.view.setQuery('windsurf OR heading'); await sleep(1500);",
				);
			},
		},
		{
			id: "sidebar.search-match",
			component: "search-result",
			surface: "left-sidebar",
			target: ".search-result-file-matched-text",
		},
		pseudoItem(
			"sidebar.search-result.hover",
			"search-result",
			".search-result-file-title",
			["hover"],
			{
				surface: "left-sidebar",
			},
		),
		{
			id: "sidebar.search-options",
			component: "search-input",
			surface: "left-sidebar",
			target:
				'.workspace-leaf-content[data-type="search"] .search-params, .workspace-leaf-content[data-type="search"] .search-row',
			before: async (ctx) => {
				await ctx.js(
					'const b = document.querySelector(\'.workspace-leaf-content[data-type="search"] .clickable-icon[aria-label="Search settings"]\'); b?.click(); await sleep(400);',
				);
			},
		},
		{
			id: "sidebar.bookmarks",
			component: "tree-item",
			surface: "left-sidebar",
			target: '.workspace-leaf-content[data-type="bookmarks"]',
			before: async (ctx) => {
				await ctx.js(
					"const l = app.workspace.getLeavesOfType('bookmarks')[0]; app.workspace.revealLeaf(l); await sleep(400); document.querySelectorAll('.workspace-leaf-content[data-type=\"bookmarks\"] .tree-item.is-collapsed > .tree-item-self').forEach((e) => e.click()); await sleep(300);",
				);
			},
		},
		...(
			[
				["backlink", "backlinks"],
				["outgoing-link", "outgoing-links"],
				["tag", "tags"],
				["outline", "outline"],
				["all-properties", "all-properties"],
				["file-properties", "file-properties"],
				["footnotes", "footnotes"],
			] as const
		).map(
			([type, slug]): ItemDef => ({
				id: `sidebar.${slug}`,
				component: slug,
				target: `.workspace-leaf-content[data-type="${type}"]`,
				before: async (ctx) => {
					const note = type === "footnotes" ? "Markdown/Footnotes.md" : "Markdown/Links.md";
					await ctx.open(note, "live");
					await ctx.js(
						`let l = app.workspace.getLeavesOfType(${JSON.stringify(type)})[0]; if (!l) { l = app.workspace.getRightLeaf(false); await l.setViewState({ type: ${JSON.stringify(type)} }); } app.workspace.revealLeaf(l); await sleep(800); document.querySelectorAll('.workspace-leaf-content[data-type=${JSON.stringify(type)}] .tree-item.is-collapsed > .tree-item-self').forEach((e) => e.click()); await sleep(300);`,
					);
				},
			}),
		),
		{
			id: "sidebar.backlinks-unlinked",
			component: "backlinks",
			target: '.workspace-leaf-content[data-type="backlink"]',
			state: "unlinked-expanded",
			before: async (ctx) => {
				await ctx.open("Markdown/Headings.md", "live");
				await ctx.js(
					"const l = app.workspace.getLeavesOfType('backlink')[0]; app.workspace.revealLeaf(l); await sleep(500); document.querySelectorAll('.workspace-leaf-content[data-type=\"backlink\"] .tree-item-self.is-clickable, .workspace-leaf-content[data-type=\"backlink\"] .tree-item.is-collapsed > .tree-item-self').forEach((e) => e.click()); await sleep(800);",
				);
			},
		},
		pseudoItem("sidebar.tree-item.hover", "tree-item", ".mod-right-split .tree-item-self", [
			"hover",
		]),
		{
			id: "sidebar.outline-active",
			component: "tree-item",
			target:
				'.workspace-leaf-content[data-type="outline"] .tree-item-self.is-active, .workspace-leaf-content[data-type="outline"]',
			state: "is-active",
			before: async (ctx) => {
				await ctx.open("Markdown/Headings.md", "live");
				await ctx.js(
					"const l = app.workspace.getLeavesOfType('outline')[0]; app.workspace.revealLeaf(l); await sleep(600);",
				);
			},
		},
		{
			id: "sidebar.file-explorer.multi-select",
			component: "nav-file",
			surface: "left-sidebar",
			target: ".nav-file-title.is-selected",
			state: "is-selected",
			before: async (ctx) => {
				await ctx.js(
					"const fe = app.workspace.getLeavesOfType('file-explorer')[0]; app.workspace.revealLeaf(fe); fe.view.revealInFolder(app.vault.getAbstractFileByPath('Markdown/Headings.md')); await sleep(400);",
				);
				await ctx.js(
					"const fe = app.workspace.getLeavesOfType('file-explorer')[0].view; for (const p of ['Markdown/Headings.md', 'Markdown/Inline.md']) fe.tree.selectItem(fe.fileItems[p]); await sleep(300);",
				);
			},
		},
		{
			id: "sidebar.file-explorer.rename",
			component: "text-input",
			surface: "left-sidebar",
			target:
				".nav-file-title .nav-file-title-content[contenteditable], .nav-file-title.is-being-renamed, .is-being-renamed",
			state: "renaming",
			before: async (ctx) => {
				await ctx.js(
					"const fe = app.workspace.getLeavesOfType('file-explorer')[0]; const f = app.vault.getAbstractFileByPath('Markdown/Headings.md'); fe.view.tree.clearSelectedDoms?.(); await fe.view.startRenameFile?.(f); await sleep(500);",
				);
			},
		},
	],
};

export function catalogScenes(): Scene[] {
	return [
		chrome,
		...markdownScenes(),
		editorStates,
		propertyStates,
		...menus,
		...suggestions,
		popovers,
		prompts,
		modalControls,
		canvas,
		bases,
		graph,
		pdf,
		sidebarViews,
		mediaAndOther,
		lightMode,
	];
}

/** Opens Settings (a popout window in Obsidian 1.14) on a tab; used as a scene opener. */
export function settingsWindow(tab: string): (main: Ctx) => Promise<void> {
	return async (main) => {
		await main.js(
			`app.setting.open(); app.setting.openTabById(${JSON.stringify(tab)}); await sleep(300);`,
		);
	};
}

export { baseLayout, click, rightClick };
