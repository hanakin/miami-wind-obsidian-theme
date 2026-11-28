import { readFile } from "node:fs/promises";
import { compile, lintPublished } from "./pipeline";

const result = await compile();
await lintPublished(result.css);
for (const [file, expected] of [
	["theme.css", result.css],
	["workbench/component-usage.json", result.usage],
] as const) {
	if ((await readFile(file, "utf8")) !== expected)
		throw new Error(`${file} is stale; run bun run build`);
}
console.log("CSS checks passed; committed artifacts match a fresh build.");
