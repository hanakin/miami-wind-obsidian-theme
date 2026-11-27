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
import { expect, test } from "vitest";

test("reports the run date and preserves the exact compared CSS with hashes and source paths", () => {
	const cwd = mkdtempSync(join(tmpdir(), "compare-themes-"));
	const inputs = {
		before: "/* Before: λ */\r\nbody {color:blue}\r\n",
		after: "/* After: 🌴 */\nbody {color:red}\n",
	};
	try {
		mkdirSync(join(cwd, "capture/fixtures"), { recursive: true });
		mkdirSync(join(cwd, "capture/.app"));
		mkdirSync(join(cwd, "workbench/out/themes"), { recursive: true });
		writeFileSync(
			join(cwd, "capture/fixtures.json"),
			JSON.stringify({
				obsidianVersion: "test",
				fixtures: [
					{
						id: "test",
						file: "test.html",
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
			"<button data-capture-target>Test</button>",
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
		expect(report.status).toBe("different");
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
		for (const [before, after, ids] of [
			["none", "none", ["--id", "test,other"]],
			["none", "none", ["--id", "test"]],
			["none", "after theme.css", ["--id", "test", "--id", "other"]],
			["before theme.css", "none", ["--id", "test,other"]],
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
				before === "none" && after === "none" ? 0 : 1,
			);
			const current = JSON.parse(
				readFileSync(join(cwd, "workbench/out/compare.json"), "utf8"),
			);
			expect(current.fixtures.map((f: { id: string }) => f.id).sort()).toEqual(
				ids.length === 2 && ids[1] === "test" ? ["test"] : ["other", "test"],
			);
			for (const side of ["before", "after"] as const)
				if (current.themes[side].source === "none") {
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
		const missing = spawnSync(
			"bun",
			[
				resolve("workbench/compare/cli.ts"),
				"--before",
				"none",
				"--after",
				"none",
				"--id",
				"test,missing",
			],
			{ cwd, encoding: "utf8" },
		);
		expect(missing.status).not.toBe(0);
		expect(missing.stderr).toContain("Unknown fixture IDs");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}, 30000);
