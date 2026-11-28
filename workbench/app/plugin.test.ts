import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { frameHandler } from "./plugin.ts";

// The frame address is the port after the workbench's: listen first, then tell the handler.
let handle: (req: IncomingMessage, res: ServerResponse) => void = () => {};
const server = createServer((req, res) => handle(req, res));
let origin = "";
beforeAll(async () => {
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const { port } = server.address() as AddressInfo;
	handle = frameHandler(port - 1, new Map());
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
