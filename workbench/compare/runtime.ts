import { existsSync, readFileSync } from "node:fs";
import { embedMathjaxFonts } from "./fonts";
import type { Inputs } from "./inputs";

export async function runtimeCss(inputs?: Inputs): Promise<string> {
	const file = "capture/.app/runtime-styles.css";
	if (!existsSync(file))
		throw new Error(
			"Missing runtime CSS: run bun run capture:extract-runtime-css first",
		);
	const css = inputs?.read(file).toString("utf8") ?? readFileSync(file, "utf8");
	if (!css.trim())
		throw new Error(
			"Empty runtime CSS: run bun run capture:extract-runtime-css again",
		);
	return embedMathjaxFonts(css, inputs);
}
