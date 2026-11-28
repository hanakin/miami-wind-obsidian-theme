import { expect, it } from "vitest";
import { latest } from "./latest.ts";

it("drops an answer that comes back after a newer request started", async () => {
	const newest = latest();
	// The first request (the old pair of sides) is held back; the second answers at once.
	let release: (value: string) => void = () => {};
	const slow = newest(() => new Promise<string>((resolve) => (release = resolve)));
	const fast = await newest(async () => "new sides, not checked");
	expect(fast).toEqual({ value: "new sides, not checked" });
	// The old answer arrives last. It must not be applied.
	release("old sides, 1 same");
	expect(await slow).toBeNull();
});

it("keeps the answer of the request asked for last, whatever order they return in", async () => {
	const newest = latest();
	let release: (value: string) => void = () => {};
	const first = newest(async () => "first");
	const second = newest(() => new Promise<string>((resolve) => (release = resolve)));
	expect(await first).toBeNull();
	release("second");
	expect(await second).toEqual({ value: "second" });
});
