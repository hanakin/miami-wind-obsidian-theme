import { PNG } from "pngjs";
import { expect, test } from "vitest";
import { outcome } from "./model";
import { repeatedPixels } from "./pixels";

function shot(...reds: number[]) {
	const p = new PNG({ width: reds.length, height: 1 });
	reds.forEach((red, i) => {
		p.data.set([red, 0, 0, 255], i * 4);
	});
	return PNG.sync.write(p);
}
test("counts a stable one-channel-level difference without tolerance", () => {
	const a = shot(10),
		b = shot(11);
	const r = repeatedPixels([a, a], [b, b]);
	expect(r.count).toBe(1);
	expect(r.noise).toEqual({ before: 0, after: 0, pixels: 0 });
});
test("same-CSS flips before or after are noise rather than theme differences", () => {
	const a = shot(10),
		b = shot(11);
	for (const r of [
		repeatedPixels([a, b], [b, b]),
		repeatedPixels([a, a], [a, b]),
	]) {
		expect(r.count).toBe(0);
		expect(r.noise.pixels).toBe(1);
		expect(
			outcome({
				differences: 0,
				pixels: r.count,
				noise: !!r.noise.pixels,
				invisible: false,
				unsupported: [],
				replayIssues: [],
			}).status,
		).toBe("not-proven");
	}
});
test("records stable differences and unstable pixels separately without hiding either", () => {
	const r = repeatedPixels(
		[shot(10, 10), shot(10, 11)],
		[shot(20, 20), shot(20, 20)],
	);
	expect(r.count).toBe(1);
	expect(r.rawCount).toBe(2);
	expect(r.noise).toEqual({ before: 1, after: 0, pixels: 1 });
	const p = PNG.sync.read(r.png!);
	expect([...p.data]).toEqual([255, 0, 0, 255, 255, 165, 0, 255]);
	expect(
		outcome({
			differences: 1,
			pixels: r.count,
			noise: true,
			invisible: false,
			unsupported: [],
			replayIssues: [],
		}).status,
	).toBe("different");
});
test("requires equal screenshot dimensions across every repeat", () => {
	expect(() =>
		repeatedPixels([shot(1), shot(1, 2)], [shot(1), shot(1)]),
	).toThrow("Screenshot size changed");
});

test("counts every stable changed pixel and separately attributes pixels outside select rectangles", () => {
	const a = shot(10, 10, 10),
		b = shot(20, 20, 20);
	const r = repeatedPixels(
		[a, a],
		[b, b],
		[
			{ x: 0, y: 0, width: 1, height: 1 },
			{ x: 1, y: 0, width: 1, height: 1 },
		],
	);
	expect(r.count).toBe(3);
	expect(r.rawCount).toBe(3);
	expect(r.outsideAcceptance).toBe(1);
	expect([...PNG.sync.read(r.png!).data]).toEqual(
		Array(3).fill([255, 0, 0, 255]).flat(),
	);
	expect(repeatedPixels([a, a], [b, b]).outsideAcceptance).toBe(3);
});
test("only stable changed pixels count outside the rectangle union", () => {
	const r = repeatedPixels(
		[shot(10, 10), shot(10, 11)],
		[shot(20, 20), shot(20, 20)],
		[{ x: 0, y: 0, width: 1, height: 1 }],
	);
	expect(r.count).toBe(1);
	expect(r.outsideAcceptance).toBe(0);
	expect(r.noise.pixels).toBe(1);
});
