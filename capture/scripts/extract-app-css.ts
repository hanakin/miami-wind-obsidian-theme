// Copies Obsidian's own app.css (and its shipped JS/HTML, to tell live classes from dead ones)
// out of the local install. The files are proprietary: they land in capture/.app/ (gitignored)
// and are never committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { extractFile, listPackage } from "@electron/asar";
import { appAsar } from "./obsidian.ts";

// The same asar the capture runs: the newest obsidian-*.asar in the work dir, else the package's.
const asar = appAsar() ?? "/usr/lib/obsidian/obsidian.asar";
const outDir = new URL("../.app/", import.meta.url).pathname;

mkdirSync(outDir, { recursive: true });
for (const file of ["app.css", "package.json"]) {
	writeFileSync(`${outDir}${file}`, extractFile(asar, file));
}
const sources = listPackage(asar, { isPack: false })
	.map((p) => p.replace(/^\//, ""))
	.filter((p) => /\.(m?js|html)$/.test(p) && !p.includes("node_modules"));
for (const file of sources) {
	const dest = `${outDir}js/${file}`;
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, extractFile(asar, file));
}
// Fonts and images app.css, the runtime styles and pdf.js load (Inter, Source Code Pro, MathJax,
// annotation icons), so a
// replay of a fixture draws text like the app. Same rule: local only, never committed.
const assets = listPackage(asar, { isPack: false })
	.map((p) => p.replace(/^\//, ""))
	.filter((p) =>
		/^(public\/|lib\/mathjax\/|lib\/pdfjs\/).*\.(woff2?|ttf|otf|svg|png|gif)$/.test(p),
	);
for (const file of assets) {
	const dest = `${outDir}assets/${file}`;
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, extractFile(asar, file));
}
const { version } = JSON.parse(await Bun.file(`${outDir}package.json`).text()) as {
	version: string;
};
console.log(
	`Extracted app.css, ${sources.length} JS/HTML files and ${assets.length} fonts/images from Obsidian ${version} (${asar}) to ${outDir}`,
);
