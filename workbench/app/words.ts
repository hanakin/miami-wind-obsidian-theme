// Plain words for what the tools report in their own terms.

const SURFACES: Record<string, string> = {
	"editor-live-preview": "Live preview",
	"editor-reading-view": "Reading view",
	"editor-source-mode": "Source mode",
	"community-browser": "Community plugins",
	"file-view": "File views",
	"mobile-phone": "Phone (emulated)",
	"mobile-tablet": "Tablet (emulated)",
	pdf: "PDF",
};

/** "editor-live-preview" → "Live preview"; unknown surfaces just lose their hyphens. */
export function surfaceName(surface: string): string {
	const plain = surface.replaceAll("-", " ");
	return SURFACES[surface] ?? plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** Desktop surfaces by name, then phone, then tablet. */
export function bySurface(a: string, b: string): number {
	const mobile = (s: string) => ["mobile-phone", "mobile-tablet"].indexOf(s);
	return mobile(a) - mobile(b) || surfaceName(a).localeCompare(surfaceName(b));
}

const CONTENT: Record<string, string> = {
	canvas: "a drawing the tool cannot redraw",
	video: "a video the tool cannot replay",
	audio: "audio the tool cannot replay",
	iframe: "an embedded page the tool cannot rebuild",
	img: "an image the tool cannot load",
	webview: "an embedded web page the tool cannot rebuild",
	"background image": "a background image the tool cannot load",
};

const REASONS: Record<string, string> = {
	"target has no visible box": "the item was not visible in the capture",
	"native selection could not be restored": "the text selection could not be restored",
	"scrollbar hover could not be restored": "the scrollbar hover could not be restored",
	"same-CSS repeat noise": "the picture changes between identical runs",
};

/** A compare tool not-proven reason, said plainly. Unknown reasons pass through unchanged. */
export function plainReason(reason: string): string {
	const content = /^([\w ]+) content is not reconstructed$/.exec(reason);
	if (content) {
		return `contains ${CONTENT[content[1] ?? ""] ?? `${content[1]} content the tool cannot rebuild`}`;
	}
	return REASONS[reason] ?? reason;
}

// First match wins, so "border-color" is a border and "background-color" a background.
const KINDS: [RegExp, string][] = [
	[/border|outline/, "borders"],
	[/background/, "backgrounds"],
	[/margin|padding|gap|inset/, "spacing"],
	[/color|fill|stroke/, "colors"],
	[/font|text|line|letter|word|white-space|tab-size/, "text"],
	[/width|height|size/, "size"],
	[/shadow|opacity|filter|transition|animation|cursor|pointer|user-select/, "effects"],
];

/** A list of CSS properties as the few kinds of thing they change: "colors, borders, spacing". */
export function kinds(props: string[]): string {
	const found = new Set(props.map((p) => KINDS.find(([re]) => re.test(p))?.[1] ?? "layout"));
	return [...found].join(", ");
}

/** "border-bottom-color" → "border bottom color". */
export function plainProperty(prop: string): string {
	return prop.replace(/^-webkit-/, "").replaceAll("-", " ");
}

// Plain names for the items a change can sit on, by class first, then by tag. First match wins.
const ITEMS: [RegExp, string][] = [
	[/\.cm-formatting-link/, "link brackets"],
	[/\.cm-formatting-math|\.cm-math/, "math"],
	[/\.cm-formatting-code|\.cm-inline-code/, "inline code"],
	[/\.cm-formatting-header|\.cm-header|\.HyperMD-header/, "heading"],
	[/\.cm-formatting/, "formatting marks"],
	[/\.cm-hashtag|\.tag\b/, "tag"],
	[/\.cm-url|\.external-link/, "web link"],
	[/\.cm-hmd-internal-link|\.internal-link|\.cm-underline|\.cm-link/, "link"],
	[/\.cm-line/, "editor line"],
	[/\.clickable-icon/, "icon button"],
	[/^select\b/, "dropdown"],
	[/^button\b/, "button"],
	[/^textarea\b/, "text box"],
	[/^input\b/, "input field"],
	[/^(svg|path)\b/, "icon"],
	[/^a\b/, "link"],
	[/^(code|pre)\b/, "code"],
	[/^h[1-6]\b/, "heading"],
	[/^(li|ul|ol)\b/, "list"],
	[/^(td|th|tr|table)\b/, "table"],
	[/^blockquote\b/, "quote"],
	[/^p\b/, "paragraph"],
];

/** "span.cm-formatting.cm-formatting-link-string" → "link brackets"; unknown items keep their code name. */
export function itemName(code: string): string {
	return ITEMS.find(([re]) => re.test(code))?.[1] ?? code;
}
