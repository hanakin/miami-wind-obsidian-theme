import type { Container, Plugin } from "postcss";
import { formatConfig as config } from "./format-config";

function render(container: Container, depth = 0): string {
	const indent = config.indent.repeat(depth);
	return (container.nodes ?? [])
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
