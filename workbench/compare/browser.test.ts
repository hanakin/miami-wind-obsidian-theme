import type { CDPSession } from "playwright";
import { expect, test } from "vitest";
import { movePointer } from "./browser";

test("allows delayed pointer acknowledgment while compositor frames continue", async () => {
	let acknowledge: () => void = () => {};
	let frames = 0;
	const cdp = {
		send: (method: string) => {
			if (method === "Input.dispatchMouseEvent")
				return new Promise<void>((resolve) => {
					acknowledge = resolve;
				});
			if (method === "HeadlessExperimental.beginFrame") {
				if (++frames === 10) acknowledge();
				return Promise.resolve({ hasDamage: false });
			}
			throw new Error(`Unexpected protocol method: ${method}`);
		},
	} as unknown as CDPSession;
	await expect(movePointer(cdp, 10, 10)).resolves.toBeUndefined();
});
