import stylistic from "@stylistic/stylelint-plugin";
import stylelint, { type Config } from "stylelint";
import reference from "../config/base-l-stylelint.json";

const pluginRules = new Set(
	stylistic.map((plugin) =>
		"ruleName" in plugin ? plugin.ruleName : plugin.default?.ruleName,
	),
);
const rules: NonNullable<Config["rules"]> = {};

// Preserve base-l's explicit settings. Stylelint 16 moved formatting rules to @stylistic.
for (const [original, setting] of Object.entries(reference.config.rules)) {
	// Sass-only syntax is inapplicable to plain CSS; null rules stay disabled.
	if (original.startsWith("scss/") || setting === null) continue;
	const name =
		original in stylelint.rules ||
		pluginRules.has(original) ||
		original.startsWith("order/")
			? original
			: `@stylistic/${original}`;
	if (
		!(original in stylelint.rules) &&
		!pluginRules.has(name) &&
		!original.startsWith("order/")
	) {
		throw new Error(`Unmapped base-l rule: ${original}`);
	}
	rules[name] = setting as NonNullable<Config["rules"]>[string];
}

export const stylelintConfig: Config = {
	// This is a plain CSS/PostCSS project; no Sass parser or compiler is used.
	customSyntax: "postcss",
	plugins: ["stylelint-order", "@stylistic/stylelint-plugin"],
	rules: {
		...rules,
		// Family boundaries are validated by the source-aware PostCSS checker.
		"custom-property-empty-line-before": null,
		"selector-max-specificity": "0,4,1",
		"selector-max-compound-selectors": 3,
		"selector-pseudo-class-disallowed-list": ["has"],
		"at-rule-no-unknown": [
			true,
			{ ignoreAtRules: ["define-mixin", "mixin", "pilot"] },
		],
		"at-rule-empty-line-before": [
			"always",
			{
				except: ["blockless-after-blockless", "first-nested"],
				ignore: ["after-comment"],
				ignoreAtRules: ["mixin"],
			},
		],
		"@stylistic/block-closing-brace-newline-after": "always",
		"order/order": [
			"custom-properties",
			{ type: "at-rule", name: "mixin" },
			"declarations",
			"rules",
			{ type: "at-rule", name: "media" },
		],
		"color-function-notation": ["legacy", { ignore: ["with-var-inside"] }],
		"declaration-no-important": true,
		"property-disallowed-list": ["all"],
	},
};

// Syntax-only fixes cannot reorder declarations or change units, variable values, or selectors' specificity.
export const syntaxFormatConfig: Config = {
	plugins: ["@stylistic/stylelint-plugin"],
	rules: Object.fromEntries(
		Object.entries(rules).filter(
			([name, value]) =>
				value !== null &&
				(name.startsWith("@stylistic/") || name === "color-hex-length"),
		),
	),
};
