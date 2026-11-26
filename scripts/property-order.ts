import data from "mdn-data/css/properties.json";
import type { ChildNode, Declaration } from "postcss";
import reference from "../config/base-l-stylelint.json";

const properties = data as Record<string, { initial: string | string[] }>;
const order = reference.config.rules["order/properties-order"][0] as string[];
const plain = (name: string) =>
	name.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, "");
// MDN's initial/longhand lists do not encode these legacy aliases.
const aliases: Record<string, string> = {
	"word-wrap": "overflow-wrap",
	"font-width": "font-stretch",
	"grid-gap": "gap",
	"grid-row-gap": "row-gap",
	"grid-column-gap": "column-gap",
	"page-break-before": "break-before",
	"page-break-after": "break-after",
	"page-break-inside": "break-inside",
};
const family = (name: string) => {
	if (name.startsWith("border-") && name.endsWith("radius"))
		return "border-radius";
	if (/^(font(?:-|$)|line-height$)/.test(name)) return "font";
	if (/^(top|right|bottom|left|inset(?:-|$))/.test(name)) return "inset";
	if (/^(min-|max-)?(width|height|inline-size|block-size)$/.test(name))
		return "size";
	return (
		name.match(
			/^(scroll-margin|scroll-padding|overscroll-behavior|contain-intrinsic|border|background|margin|padding|overflow|animation|transition|mask|text-decoration)(?:-|$)/,
		)?.[1] ?? name
	);
};

function leaves(name: string): string[] {
	name = aliases[name] ?? name;
	const initial = properties[name]?.initial;
	return Array.isArray(initial) ? initial.flatMap(leaves) : [name];
}

export function orderRisk(declarations: Declaration[]): string | undefined {
	const names = declarations
		.map((decl) => aliases[plain(decl.prop)] ?? plain(decl.prop))
		.filter((name) => !name.startsWith("--"));
	if (names.includes("all") && declarations.length > 1)
		return "all resets other declarations";
	const wrapping = new Set([
		"white-space",
		"white-space-collapse",
		"text-wrap",
		"text-wrap-mode",
		"text-wrap-style",
	]);
	if (names.filter((name) => wrapping.has(name)).length > 1)
		return "overlapping text wrapping declarations";
	if (new Set(names).size !== names.length)
		return "duplicate or vendor-alias declarations";
	if (names.some((name) => !properties[name]))
		return "property absent from the pinned MDN overlap data";
	for (let i = 0; i < names.length; i++) {
		const a = names[i];
		if (!a) continue;
		for (const b of names.slice(i + 1)) {
			if (leaves(a).some((leaf) => leaves(b).includes(leaf)))
				return `overlap: ${a} / ${b}`;
			if (family(a) !== family(b)) continue;
			// Shorthands can reset more than their listed longhands (font, border-image, animation-range).
			if (
				Array.isArray(properties[a]?.initial) ||
				Array.isArray(properties[b]?.initial)
			)
				return `shorthand family: ${a} / ${b}`;
			if (
				[a, b].some((name) =>
					/(?:^|-)(inline|block|start|end)(?:-|$)/.test(name),
				)
			)
				return `logical/physical family: ${a} / ${b}`;
		}
	}
}

export function ordered(nodes: ChildNode[]): ChildNode[] {
	if (nodes.some((node) => node.type !== "decl" && node.type !== "comment"))
		return nodes;
	const declarations = nodes.filter(
		(node): node is Declaration => node.type === "decl",
	);
	if (orderRisk(declarations)) return nodes;
	const groups: {
		prefix: ChildNode[];
		declaration: Declaration;
		suffix: ChildNode[];
	}[] = [];
	let prefix: ChildNode[] = [];
	for (const node of nodes) {
		if (node.type === "comment") {
			const previous = groups.at(-1);
			if (previous && !node.raws.before?.includes("\n"))
				previous.suffix.push(node);
			else prefix.push(node);
		} else if (node.type === "decl") {
			groups.push({ prefix, declaration: node, suffix: [] });
			prefix = [];
		}
	}
	const rank = (name: string) =>
		name.startsWith("--")
			? -1
			: order.indexOf(plain(name)) < 0
				? order.length
				: order.indexOf(plain(name));
	groups.sort((a, b) => {
		const first = a.declaration.prop,
			second = b.declaration.prop;
		const difference = rank(first) - rank(second);
		if (difference || rank(first) !== order.length) return difference;
		return first.localeCompare(second, "en");
	});
	return [
		...groups.flatMap((group) => [
			...group.prefix,
			group.declaration,
			...group.suffix,
		]),
		...prefix,
	];
}
