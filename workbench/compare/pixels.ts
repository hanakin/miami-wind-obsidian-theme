import { PNG } from "pngjs";

export interface PixelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function repeatedPixels(
	before: readonly [Buffer, Buffer],
	after: readonly [Buffer, Buffer],
	acceptanceRects: readonly PixelRect[] = [],
) {
	const [a, a2, b, b2] = [...before, ...after].map((p) => PNG.sync.read(p));
	if (!a || !a2 || !b || !b2) throw new Error("Missing screenshot repeat");
	if ([a2, b, b2].some((p) => p.width !== a.width || p.height !== a.height))
		throw new Error("Screenshot size changed");
	const diff = new PNG({ width: a.width, height: a.height });
	const equal = (x: PNG, y: PNG, i: number) =>
		x.data[i] === y.data[i] &&
		x.data[i + 1] === y.data[i + 1] &&
		x.data[i + 2] === y.data[i + 2] &&
		x.data[i + 3] === y.data[i + 3];
	let count = 0,
		rawCount = 0,
		outsideAcceptance = 0;
	const noise = { before: 0, after: 0, pixels: 0 };
	for (let i = 0; i < a.data.length; i += 4) {
		const beforeStable = equal(a, a2, i),
			afterStable = equal(b, b2, i),
			same = equal(a, b, i);
		if (!same) rawCount++;
		if (!beforeStable) noise.before++;
		if (!afterStable) noise.after++;
		if (!beforeStable || !afterStable) {
			noise.pixels++;
			diff.data.set([255, 165, 0, 255], i);
		} else if (!same) {
			count++;
			const x = (i / 4) % a.width,
				y = Math.floor(i / 4 / a.width);
			// Attribute pixel cells intersecting the measured rectangles. Every
			// changed pixel still contributes to count, rawCount and the diff image.
			if (
				!acceptanceRects.some(
					(r) =>
						r.width > 0 &&
						r.height > 0 &&
						x + 1 > r.x &&
						x < r.x + r.width &&
						y + 1 > r.y &&
						y < r.y + r.height,
				)
			)
				outsideAcceptance++;
			diff.data.set([255, 0, 0, 255], i);
		} else {
			const gray = Math.round(
				(a.data[i]! + a.data[i + 1]! + a.data[i + 2]!) / 3,
			);
			diff.data.set([gray, gray, gray, 60], i);
		}
	}
	return {
		count,
		rawCount,
		outsideAcceptance,
		noise,
		png: count || noise.pixels ? PNG.sync.write(diff) : null,
	};
}
