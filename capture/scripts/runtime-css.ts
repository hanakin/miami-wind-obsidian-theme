// Saves Obsidian's runtime stylesheets (CodeMirror's style modules and other <style>/adopted
// sheets, not the theme) to capture/.app/runtime-styles.css (gitignored, like app.css). Editor
// fixtures need it to render as captured. Usage: bun run capture:extract-runtime-css
import { saveRuntimeStyles } from "./engine.ts";
import { close, launch, verifyIsolation } from "./obsidian.ts";

const s = await launch();
try {
	console.log(verifyIsolation(s.pid, s.windowed).join("\n"));
	// Open every kind of view once so each registers its styles.
	await s.page.evaluate(`(async () => {
		const ws = app.workspace;
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const l = ws.getMostRecentLeaf(ws.rootSplit);
		for (const [type, state] of [
			["markdown", { file: "Markdown/Kitchen sink.md", mode: "source", source: true }],
			["markdown", { file: "Markdown/Kitchen sink.md", mode: "source", source: false }],
			["markdown", { file: "Markdown/Kitchen sink.md", mode: "preview" }],
			["canvas", { file: "Canvas.canvas" }],
			["bases", { file: "Base.base" }],
			["pdf", { file: "Attachments/sample.pdf" }],
		]) { await l.setViewState({ type, state, active: true }); await sleep(1200); }
		app.commands.executeCommandById("graph:open");
		await sleep(1500);
	})()`);
	await saveRuntimeStyles(s.page);
	console.log("saved capture/.app/runtime-styles.css");
} finally {
	await close(s);
}
