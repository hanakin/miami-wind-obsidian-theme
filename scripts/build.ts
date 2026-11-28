import { writeFile } from "node:fs/promises";
import { compile, lintPublished } from "./pipeline";

const result = await compile();
await lintPublished(result.css);
await writeFile("theme.css", result.css);
await writeFile("workbench/component-usage.json", result.usage);
console.log(
	"Built theme.css and workbench/component-usage.json; CSS checks passed.",
);
