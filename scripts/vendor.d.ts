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
		calculate(selector: string): Tuple[];
		compare(a: Tuple, b: Tuple): number;
	};
	export default Specificity;
}
