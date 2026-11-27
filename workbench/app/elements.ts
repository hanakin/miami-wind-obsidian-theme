// Tells whether a difference the compare tool recorded sits on a component's own element.
import selectorParser from "postcss-selector-parser";

/**
 * True when the element surely matches the selector list. `key` is the compare tool's element
 * key, "<index>:<tag>.<class>.<class>" with "::pseudo" appended for pseudo-elements. The key holds
 * no attributes, so a selector that needs one (input[type=checkbox]) is never a sure match.
 */
export function matchesElement(selector: string, key: string): boolean {
	return match(selector, key, false);
}

/**
 * True when the element could match once its attributes are known: the tag and classes fit, and
 * only an attribute or state the key does not record stands between it and a sure match.
 */
export function mayMatchElement(selector: string, key: string): boolean {
	return match(selector, key, true);
}

function match(selector: string, key: string, lenient: boolean): boolean {
	const [tag = "", ...classes] = (key.split("::")[0] ?? "").replace(/^\d+:/, "").split(".");
	let sure = false;
	selectorParser((root) => {
		sure = root.nodes.some(
			(alternative) =>
				alternative.nodes.length > 0 &&
				alternative.nodes.every(
					(node) =>
						(node.type === "tag" && node.value.toLowerCase() === tag) ||
						(node.type === "class" && classes.includes(node.value)) ||
						(lenient && (node.type === "attribute" || node.type === "pseudo")),
				),
		);
	}).processSync(selector);
	return sure;
}

/**
 * For each capture with differences: the components that have one on their own elements.
 * `selectors` maps component names to their selector lists.
 */
export function touchedComponents(
	differences: { element: string }[],
	components: string[],
	selectors: Record<string, string>,
): string[] {
	const elements = [...new Set(differences.map((d) => d.element.split("::")[0] ?? ""))];
	return components.filter((c) => {
		const selector = selectors[c];
		return selector !== undefined && elements.some((e) => matchesElement(selector, e));
	});
}
