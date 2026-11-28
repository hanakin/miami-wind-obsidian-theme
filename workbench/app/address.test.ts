import { expect, it } from "vitest";
import { addresses } from "./address.ts";

it("uses two local ports when nothing else is given", () => {
	expect(addresses({})).toEqual({
		port: 5175,
		local: { page: "http://127.0.0.1:5175", frames: "http://127.0.0.1:5176" },
		page: "http://127.0.0.1:5175",
		frames: "http://127.0.0.1:5176",
	});
});

it("takes the public origins of a proxy from the environment", () => {
	const a = addresses({
		PORT: "5300",
		WORKBENCH_ORIGIN: "https://celestis.example.ts.net:8443/",
		WORKBENCH_FRAME_ORIGIN: "https://celestis.example.ts.net:8444",
	});
	expect([a.page, a.frames]).toEqual([
		"https://celestis.example.ts.net:8443",
		"https://celestis.example.ts.net:8444",
	]);
	expect(a.local.frames).toBe("http://127.0.0.1:5301");
});

it("refuses anything that is not a plain origin, and one origin for both", () => {
	expect(() => addresses({ WORKBENCH_ORIGIN: "celestis:8443" })).toThrow();
	expect(() => addresses({ WORKBENCH_ORIGIN: "https://host/path" })).toThrow();
	expect(() => addresses({ WORKBENCH_ORIGIN: "javascript:alert(1)" })).toThrow();
	expect(() =>
		addresses({ WORKBENCH_ORIGIN: "https://host:1", WORKBENCH_FRAME_ORIGIN: "https://host:1" }),
	).toThrow();
});
