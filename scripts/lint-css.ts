import { mkdir, writeFile } from "node:fs/promises";
import { lintCss } from "./css-lint";

const result = await lintCss();
await mkdir("workbench/out", { recursive: true });
await writeFile(
	"workbench/out/stylelint.json",
	`${JSON.stringify(result, null, "\t")}\n`,
);
console.log(
	`Base-l Stylelint: ${result.unexpected.length} unexpected, ${result.permanent} Obsidian exceptions, ${result.temporary} temporary source-format exceptions.`,
);
console.log(JSON.stringify(result.counts, null, 2));
console.log(
	`Source order retained in ${result.retainedOrder.length} source/output rules; see workbench/out/stylelint.json.`,
);
if (result.unexpected.length && !process.argv.includes("--report")) {
	console.error(JSON.stringify(result.unexpected.slice(0, 12), null, 2));
	process.exitCode = 1;
}
