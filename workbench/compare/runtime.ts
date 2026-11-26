export async function runtimeCss(): Promise<string> {
	const file = Bun.file("capture/.app/runtime-styles.css");
	if (!(await file.exists()))
		throw new Error(
			"Missing runtime CSS: run bun run capture:extract-runtime-css first",
		);
	const css = await file.text();
	if (!css.trim())
		throw new Error(
			"Empty runtime CSS: run bun run capture:extract-runtime-css again",
		);
	return css;
}
