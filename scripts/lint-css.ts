import { mkdir, writeFile } from "node:fs/promises";
import { lintCss } from "./css-lint";

const result = await lintCss();
await mkdir("workbench/out", { recursive: true });
await writeFile(
	"workbench/out/stylelint.json",
	`${JSON.stringify(result, null, "\t")}\n`,
);
console.log(
	`Base-l Stylelint: ${result.unexpected.length} unexpected, ${result.stale.length} stale exceptions, ${result.permanent} Obsidian exceptions, ${result.temporary} temporary source/legacy exceptions.`,
);
console.log(JSON.stringify(result.counts, null, 2));
if (
	(result.unexpected.length || result.stale.length) &&
	!process.argv.includes("--report")
) {
	console.error(
		JSON.stringify(
			{
				unexpected: result.unexpected.slice(0, 12),
				stale: result.stale.slice(0, 12),
			},
			null,
			2,
		),
	);
	process.exitCode = 1;
}
