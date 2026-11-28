import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { expect, test } from "vitest";

test("reports the run date and preserves the exact compared CSS with hashes and source paths", () => {
	const cwd = mkdtempSync(join(tmpdir(), "compare-themes-"));
	const inputs = {
		before: "/* Before: λ */\r\nbody {color:blue}\r\n",
		after: "/* After: 🌴 */\nbody {color:red}\n",
	};
	try {
		mkdirSync(join(cwd, "capture/fixtures"), { recursive: true });
		mkdirSync(join(cwd, "capture/.app/runtime"), { recursive: true });
		writeFileSync(
			join(cwd, "capture/.app/runtime/test-sheet.css"),
			"button {font-size:12px}",
		);
		writeFileSync(
			join(cwd, "capture/fixtures/saved.png"),
			PNG.sync.write(new PNG({ width: 1, height: 1 })),
		);
		writeFileSync(
			join(cwd, "capture/coverage.json"),
			JSON.stringify({ replay: { limits: {} } }),
		);
		writeFileSync(
			join(cwd, "capture/fixtures/canvas.png"),
			readFileSync(join(cwd, "capture/fixtures/saved.png")),
		);
		writeFileSync(
			join(cwd, "capture/fixtures/background.png"),
			readFileSync(join(cwd, "capture/fixtures/saved.png")),
		);
		mkdirSync(join(cwd, "workbench/out/themes"), { recursive: true });
		writeFileSync(
			join(cwd, "capture/fixtures.json"),
			JSON.stringify({
				obsidianVersion: "test",
				fixtures: [
					{
						id: "test",
						file: "test.html",
						runtimeStyles: ["app", "runtime", "test-sheet", "theme"],
						imageSizes: [{ index: 0, width: 1, height: 1, file: "saved.png" }],
						canvasPixels: [{ index: 0, file: "canvas.png" }],
						styleImages: { "app://test/cover.png": "background.png" },
						component: "button",
						surface: "test",
						state: "default",
						contains: [],
					},
				],
			}),
		);
		writeFileSync(
			join(cwd, "capture/fixtures/test.html"),
			"<button data-capture-target>Test</button><img><canvas></canvas><div style='width:4px;height:4px;background-image:url(app://test/cover.png)'></div>",
		);
		writeFileSync(
			join(cwd, "capture/.app/package.json"),
			JSON.stringify({ version: "test" }),
		);
		for (const file of ["app.css", "runtime-styles.css"])
			writeFileSync(join(cwd, "capture/.app", file), "body {}");
		for (const side of ["before", "after"] as const) {
			writeFileSync(join(cwd, `${side} theme.css`), inputs[side]);
			writeFileSync(join(cwd, `workbench/out/themes/${side}.css`), "stale");
		}
		const started = Date.now();
		const run = spawnSync(
			"bun",
			[
				resolve("workbench/compare/cli.ts"),
				"--before",
				"before theme.css",
				"--after",
				"after theme.css",
			],
			{ cwd, encoding: "utf8" },
		);
		expect(run.status, run.stderr).toBe(1);
		const report = JSON.parse(
			readFileSync(join(cwd, "workbench/out/compare.json"), "utf8"),
		);
		expect(report.schemaVersion).toBe(1);
		for (const file of [
			"capture/fixtures/test.html",
			"capture/fixtures/saved.png",
			"capture/fixtures/canvas.png",
			"capture/fixtures/background.png",
			"capture/fixtures.json",
			"capture/coverage.json",
			"capture/.app/app.css",
			"capture/.app/runtime-styles.css",
			"capture/.app/runtime/test-sheet.css",
		]) {
			const hash = createHash("sha256")
				.update(readFileSync(join(cwd, file)))
				.digest("hex");
			expect(report.inputs[file], file).toBe(hash);
			expect(report.fixtures[0].inputs[file], file).toBe(hash);
		}
		for (const file of ["replay.ts", "css.ts", "inpage.ts"]) {
			const path = resolve("capture/scripts", file);
			expect(report.inputs[path]).toBe(
				createHash("sha256").update(readFileSync(path)).digest("hex"),
			);
			expect(report.fixtures[0].inputs[path]).toBe(report.inputs[path]);
		}
		const fixtureHash = report.fixtures[0].inputs["capture/fixtures/test.html"];
		rmSync(join(cwd, "capture/fixtures/test.html"));
		expect(report.fixtures[0].inputs["capture/fixtures/test.html"]).toBe(
			fixtureHash,
		);
		writeFileSync(
			join(cwd, "capture/fixtures/test.html"),
			"<button data-capture-target>Test</button><img><canvas></canvas><div style='width:4px;height:4px;background-image:url(app://test/cover.png)'></div>",
		);

		expect(report.status).toBe("different");
		expect(report.fixtures[0].unsupported).not.toContain("background image");
		expect(report).not.toHaveProperty("accepted");
		expect(report.summary).not.toHaveProperty("accepted");
		for (const fixture of report.fixtures)
			for (const key of [
				"comparisonStatus",
				"acceptanceReason",
				"acceptanceScope",
				"pixelsOutsideAcceptance",
			])
				expect(fixture).not.toHaveProperty(key);
		expect(new Date(report.generated).toISOString()).toBe(report.generated);
		expect(Date.parse(report.generated)).toBeGreaterThanOrEqual(started);
		expect(Date.parse(report.generated)).toBeLessThanOrEqual(Date.now());
		for (const side of ["before", "after"] as const) {
			// A source edit after the run must not change the report's picture inputs.
			writeFileSync(join(cwd, `${side} theme.css`), "changed after comparison");
			expect(report.themes[side]).toEqual({
				source: `${side} theme.css`,
				file: `themes/${side}.css`,
				sha256: createHash("sha256").update(inputs[side]).digest("hex"),
			});
			expect(
				readFileSync(
					join(cwd, "workbench/out", report.themes[side].file),
					"utf8",
				),
			).toBe(inputs[side]);
		}
		const registryPath = join(cwd, "capture/fixtures.json");
		const registry = JSON.parse(readFileSync(registryPath, "utf8"));
		registry.fixtures = ["test", "other", "test.extra"].map((id) => ({
			...registry.fixtures[0],
			id,
		}));
		writeFileSync(registryPath, JSON.stringify(registry));
		for (const side of ["before", "after"] as const)
			writeFileSync(join(cwd, `${side} theme.css`), inputs[side]);
		writeFileSync(join(cwd, "empty theme.css"), "");
		for (const [before, after, ids] of [
			["empty theme.css", "empty theme.css", ["--id", "test,other"]],
			["empty theme.css", "empty theme.css", ["--id", "test"]],
			["empty theme.css", "after theme.css", ["--id", "test", "--id", "other"]],
			["before theme.css", "empty theme.css", ["--id", "test,other"]],
		] as const) {
			const child = spawnSync(
				"bun",
				[
					resolve("workbench/compare/cli.ts"),
					"--before",
					before,
					"--after",
					after,
					...ids,
				],
				{ cwd, encoding: "utf8" },
			);
			expect(child.status, child.stderr).toBe(
				before === "empty theme.css" && after === "empty theme.css" ? 0 : 1,
			);
			const current = JSON.parse(
				readFileSync(join(cwd, "workbench/out/compare.json"), "utf8"),
			);
			expect(current.fixtures.map((f: { id: string }) => f.id).sort()).toEqual(
				ids.length === 2 && ids[1] === "test" ? ["test"] : ["other", "test"],
			);
			for (const side of ["before", "after"] as const)
				if (current.themes[side].source === "empty theme.css") {
					expect(current.themes[side].sha256).toBe(
						createHash("sha256").update("").digest("hex"),
					);
					expect(
						readFileSync(
							join(cwd, "workbench/out", current.themes[side].file),
							"utf8",
						),
					).toBe("");
				}
		}
		for (const [before, after] of [
			["none", "empty theme.css"],
			["empty theme.css", "none"],
		]) {
			const invalid = spawnSync(
				"bun",
				[
					resolve("workbench/compare/cli.ts"),
					"--before",
					before ?? "",
					"--after",
					after ?? "",
					"--id",
					"test",
				],
				{ cwd, encoding: "utf8" },
			);
			expect(invalid.status).not.toBe(0);
			expect(invalid.stderr).toContain("ENOENT");
		}
		for (const side of ["before", "after"] as const) {
			const args = [
				resolve("workbench/compare/cli.ts"),
				"--before",
				side === "before" ? "" : "empty theme.css",
				"--after",
				side === "after" ? "" : "empty theme.css",
			];
			const emptyArgument = spawnSync("bun", args, { cwd, encoding: "utf8" });
			expect(emptyArgument.status).not.toBe(0);
			expect(emptyArgument.stderr).toContain(
				`Expected non-empty --${side} path`,
			);
		}
		const missing = spawnSync(
			"bun",
			[
				resolve("workbench/compare/cli.ts"),
				"--before",
				"empty theme.css",
				"--after",
				"empty theme.css",
				"--id",
				"test,missing",
			],
			{ cwd, encoding: "utf8" },
		);
		expect(missing.status).not.toBe(0);
		expect(missing.stderr).toContain("Unknown fixture IDs");
		rmSync(join(cwd, "capture/coverage.json"));
		for (const file of ["compare.json", "compare.md", "component-diffs.json"])
			writeFileSync(join(cwd, "workbench/out", file), "stale");
		const noCoverage = spawnSync(
			"bun",
			[
				resolve("workbench/compare/cli.ts"),
				"--before",
				"empty theme.css",
				"--after",
				"empty theme.css",
				"--id",
				"test",
			],
			{ cwd, encoding: "utf8" },
		);
		expect(noCoverage.status).not.toBe(0);
		expect(noCoverage.stderr).toContain("Missing capture coverage");
		for (const file of ["compare.json", "compare.md", "component-diffs.json"])
			expect(() => readFileSync(join(cwd, "workbench/out", file))).toThrow();
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}, 30000);
