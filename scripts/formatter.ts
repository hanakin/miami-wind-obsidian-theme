import type { ChildNode, Container, Plugin } from "postcss";
import { formatConfig as config } from "./format-config";

function ordered(nodes: ChildNode[]): ChildNode[] {
	// Keep shorthand/longhand dependencies and custom-property/comment groups in source order.
	if (nodes.some((node) => node.type !== "decl" || node.prop.startsWith("--")))
		return nodes;
	const properties = nodes.flatMap((node) =>
		node.type === "decl" ? [node.prop] : [],
	);
	if (
		properties.some((prop) =>
			properties.some((other) => other.startsWith(`${prop}-`)),
		)
	)
		return nodes;
	const rank = (prop: string) => {
		const index = (config.propertyOrder as readonly string[]).indexOf(prop);
		return index === -1 ? config.propertyOrder.length : index;
	};
	return [...nodes].sort((a, b) =>
		a.type === "decl" && b.type === "decl" ? rank(a.prop) - rank(b.prop) : 0,
	);
}

function render(container: Container, depth = 0): string {
	const indent = config.indent.repeat(depth);
	return ordered(container.nodes ?? [])
		.map((node) => {
			if (node.type === "comment") {
				const section = node.text.match(/^@section (.+)$/);
				return `${indent}/* ${section ? `=== ${section[1]} ===` : node.text} */`;
			}
			if (node.type === "decl")
				return `${indent}${node.prop}: ${node.value}${node.important ? " !important" : ""};`;
			const heading =
				node.type === "rule"
					? node.selectors.join(`,\n${indent}`)
					: `@${node.name}${node.params ? ` ${node.params}` : ""}`;
			if (!node.nodes) return `${indent}${heading};`;
			return `${indent}${heading} {\n${render(node, depth + 1)}\n${indent}}`;
		})
		.join(depth === 0 || container.type === "atrule" ? "\n\n" : "\n");
}

export function formatCss(): Plugin {
	return {
		postcssPlugin: "miami-wind-format",
		OnceExit(root, { result }) {
			// Assign a stringifier so downstream consumers still receive the original source-aware AST.
			result.opts.stringifier = (_node, builder) =>
				builder(`${render(root)}\n`);
		},
	};
}
