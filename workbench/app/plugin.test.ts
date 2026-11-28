import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, expect, it } from "vitest";
import { addresses } from "./address.ts";
import { validator } from "./inputs.ts";
import { entries, type FixtureIndex, frameHandler } from "./plugin.ts";

// The frame address is the port after the workbench's: listen first, then tell the handler.
let handle: (req: IncomingMessage, res: ServerResponse) => void = () => {};
const server = createServer((req, res) => handle(req, res));
let origin = "";
beforeAll(async () => {
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const { port } = server.address() as AddressInfo;
	handle = frameHandler(addresses({ PORT: String(port - 1) }), new Map());
	origin = `http://127.0.0.1:${port}`;
});
afterAll(() => {
	server.close();
});

it("answers a malformed address with 400 and keeps running", async () => {
	for (const path of ["/assets/%ZZ", "/frame/%E0%A4%A/x", "/css/replay/%"]) {
		const res = await fetch(`${origin}${path}`);
		expect(res.status, path).toBe(400);
	}
	// Still up, and still answering as before.
	expect((await fetch(`${origin}/assets/nothing-here.png`)).status).toBe(404);
	expect((await fetch(`${origin}/elsewhere`)).status).toBe(404);
});

it("serves nothing outside the app's own asset folder", async () => {
	for (const path of ["/assets/..%2F..%2Fapp.css", "/assets/%2Fetc%2Fpasswd"]) {
		expect((await fetch(`${origin}${path}`)).status, path).toBe(404);
	}
});

// --- Taking a compare report in ---------------------------------------------------------------

const root = `${mkdtempSync(`${tmpdir()}/mw-ingest-`)}/`;
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const index = {
	components: {},
	fixtures: [
		{
			id: "kbd.one",
			file: "one.html",
			component: "kbd",
			surface: "modal",
			state: "default",
			contains: [],
		},
		{
			id: "kbd.two",
			file: "two.html",
			component: "kbd",
			surface: "modal",
			state: "default",
			contains: [],
		},
	],
} as unknown as FixtureIndex;
const states = { "kbd.one": { status: "same" as const }, "kbd.two": { status: "same" as const } };
/** A report as the compare tool writes it: each capture with the files it read and their hashes. */
const report = (one: string, two: string) => ({
	fixtures: [
		{ id: "kbd.one", inputs: { "one.html": sha(one), "app.css": sha("app") } },
		{ id: "kbd.two", inputs: { "two.html": sha(two), "app.css": sha("app") } },
	],
});
const taken = (r: Parameters<typeof entries>[0]) =>
	Object.keys(entries(r, index, states, validator(root))).sort();

it("takes a result in only with the inputs recorded when it was made", () => {
	writeFileSync(`${root}app.css`, "app");
	writeFileSync(`${root}one.html`, "one");
	writeFileSync(`${root}two.html`, "two");
	expect(taken(report("one", "two"))).toEqual(["kbd.one", "kbd.two"]);
	// A report from before the compare tool recorded inputs: nothing is taken in.
	expect(taken({ fixtures: [{ id: "kbd.one" }, { id: "kbd.two" }] })).toEqual([]);
});

it("does not take in a capture that changed between the compare tool's read and its report", () => {
	writeFileSync(`${root}app.css`, "app");
	writeFileSync(`${root}two.html`, "two");
	// The tool read "one"; by the time the report is written and read here, the file says more.
	writeFileSync(`${root}one.html`, "one, edited after it was read");
	expect(taken(report("one", "two"))).toEqual(["kbd.two"]);
});

it("does not take in a capture whose file was deleted before the report is read", () => {
	writeFileSync(`${root}app.css`, "app");
	writeFileSync(`${root}one.html`, "one");
	rmSync(`${root}two.html`, { force: true });
	expect(taken(report("one", "two"))).toEqual(["kbd.one"]);
	// A shared input gone: every capture that read it is out.
	rmSync(`${root}app.css`);
	expect(taken(report("one", "two"))).toEqual([]);
});
