declare module "stylelint-config-obsidianmd" {
	const config: import("stylelint").Config;
	export default config;
}
// The package ships types but omits them from its exports map.
declare module "@bramus/specificity" {
	interface Tuple {
		a: number;
		b: number;
		c: number;
	}
	export default class Specificity {
		static calculate(selector: string): Specificity[];
		static compare(a: Specificity | Tuple, b: Specificity | Tuple): number;
	}
}
