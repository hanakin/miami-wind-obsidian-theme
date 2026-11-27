import stylelint from "stylelint";
import { expect, it } from "vitest";
import reference from "../config/base-l-stylelint.json";
import {
	type CssException,
	type Finding,
	partitionFindings,
} from "../scripts/css-lint";
import { stylelintConfig } from "../scripts/stylelint-config";

it("keeps base-l's explicit CSS rules without a Sass preset", () => {
	expect(stylelintConfig.extends).toBeUndefined();
	expect(stylelintConfig.plugins).toEqual([
		"stylelint-order",
		"@stylistic/stylelint-plugin",
	]);
	expect(stylelintConfig.rules?.["order/properties-order"]).toEqual(
		reference.config.rules["order/properties-order"],
	);
	expect(stylelintConfig.rules?.["@stylistic/string-quotes"]).toBe("single");
	expect(
		Object.keys(stylelintConfig.rules ?? {}).some((rule) =>
			rule.startsWith("scss/"),
		),
	).toBe(false);
});

it("rejects new IDs, :has and type-qualified classes by default", async () => {
	const result = await stylelint.lint({
		code: "#x div.bad:has(.y) { color: #ffffff; }\n",
		config: stylelintConfig,
	});
	const rules = new Set(
		result.results.flatMap((file) =>
			file.warnings.map((warning) => warning.rule),
		),
	);
	for (const rule of [
		"selector-max-id",
		"selector-pseudo-class-disallowed-list",
		"selector-no-qualifying-type",
	])
		expect(rules.has(rule)).toBe(true);
});

it("recognizes PostCSS mixins without a Sass parser", async () => {
	const result = await stylelint.lint({
		code: "@define-mixin example { color: #ffffff; }\n.x { @mixin example; }\n",
		config: stylelintConfig,
	});
	expect(
		result.results
			.flatMap((file) => file.warnings)
			.filter((warning) => warning.rule === "at-rule-no-unknown"),
	).toEqual([]);
});

it("bounds exceptions to an exact file, rule, selector and occurrence count", () => {
	const finding: Finding = {
		file: "src/markdown/code.css",
		rule: "selector-no-qualifying-type",
		selector: ".cm-s-obsidian span.cm-keyword",
		property: "",
		value: "",
		text: "legacy rival",
	};
	const exception: CssException = {
		...finding,
		count: 1,
		reason: "Obsidian specificity tie",
	};
	const result = partitionFindings(
		[
			finding,
			finding,
			{ ...finding, file: "src/new.css" },
			{ ...finding, selector: "div.other" },
			{ ...finding, rule: "selector-max-id" },
		],
		[exception],
	);
	expect(result.excepted).toEqual([finding]);
	expect(result.unexpected).toHaveLength(4);
});

it("detects unused exception entries and counts above their remaining findings", () => {
	const exception: CssException = {
		file: "src/markdown/code.css",
		rule: "selector-no-qualifying-type",
		selector: ".cm-s-obsidian span.cm-keyword",
		count: 2,
		reason: "specificity tie",
	};
	const finding: Finding = {
		...exception,
		property: "",
		value: "",
		text: "rival",
	};
	expect(partitionFindings([finding], [exception]).stale).toEqual([exception]);
	expect(partitionFindings([], [exception]).stale).toEqual([exception]);
	expect(partitionFindings([finding, finding], [exception]).stale).toEqual([]);
});
