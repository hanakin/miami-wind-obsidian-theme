import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Inputs } from "./inputs";

test("fingerprints describe bytes consumed, including cached inputs shared by fixtures", () => {
	const dir = mkdtempSync(join(tmpdir(), "compare-inputs-"));
	try {
		const file = join(dir, "fixture.xhtml");
		const shared = join(dir, "app.css");
		writeFileSync(file, "original fixture");
		writeFileSync(shared, "original app");
		const run = new Inputs();
		run.read(shared);
		const inherited = { ...run.hashes };
		const first = run.fork(inherited);
		expect(first.read(file).toString()).toBe("original fixture");
		writeFileSync(file, "changed after read");
		const second = run.fork(inherited);
		expect(second.hashes[file]).toBeUndefined();
		expect(second.read(file).toString()).toBe("original fixture");
		const key = file;
		const hash = createHash("sha256").update("original fixture").digest("hex");
		expect(first.hashes[key]).toBe(hash);
		expect(second.hashes[key]).toBe(hash);
		expect(run.hashes[key]).toBe(hash);
		expect(first.hashes[shared]).toBeDefined();
		expect(new Inputs().read(file).toString()).toBe("changed after read");
		rmSync(file);
		expect(first.hashes[key]).toBe(hash);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
