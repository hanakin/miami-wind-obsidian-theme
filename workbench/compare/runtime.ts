import { existsSync } from "node:fs";
export function selectRuntimeCss(sheets: string[]): string {
	return sheets
		.filter((s) => s.includes(".ͼ1") && s.includes(".cm-scroller"))
		.join("\n");
}
export async function runtimeCss(): Promise<string> {
	const path = "workbench/out/runtime-cm.css";
	if (existsSync(path)) return Bun.file(path).text();
	// Use an isolated app instance to obtain the actual generated CM selectors and base rules.
	process.env.CAPTURE_INSTANCE = `compare-${process.pid}`;
	process.env.CAPTURE_PORT = "9347";
	const { launch, close, verifyIsolation } = await import(
		"../../capture/scripts/obsidian"
	);
	const session = await launch();
	try {
		verifyIsolation(session.proc.pid as number);
		await session.page.evaluate(
			`app.workspace.openLinkText("Markdown/Code.md", "", false)`,
		);
		await session.page.waitForSelector(".cm-editor");
		const sheets = await session.page.evaluate(() =>
			Array.from(document.head.querySelectorAll("style")).map((s) =>
				Array.from(s.sheet?.cssRules ?? [])
					.map((r) => r.cssText)
					.join("\n"),
			),
		);
		const css = selectRuntimeCss(sheets);
		if (!css.includes("cm-scroller"))
			throw new Error("No CodeMirror base rules found in isolated Obsidian");
		await Bun.write(path, css);
		return css;
	} finally {
		await close(session);
	}
}
