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
	const Specificity: {
		calculate(selector: string): Specificity[];
		compare(a: Specificity | Tuple, b: Specificity | Tuple): number;
	};
	export default Specificity;
}
