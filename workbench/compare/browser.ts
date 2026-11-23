import type { CDPSession, LaunchOptions } from "playwright";

export const BROWSER_OPTIONS: LaunchOptions = {
	headless: true,
	ignoreDefaultArgs: ["--hide-scrollbars"],
	args: [
		"--disable-gpu",
		"--num-raster-threads=1",
		"--run-all-compositor-stages-before-draw",
		"--disable-partial-raster",
		"--disable-gpu-rasterization",
		"--disable-zero-copy",
		"--force-color-profile=srgb",
		"--force-device-scale-factor=1",
		"--disable-threaded-scrolling",
		"--disable-threaded-animation",
		"--enable-begin-frame-control",
	],
};

let frameQueue: Promise<unknown> = Promise.resolve();
export function beginFrame(
	cdp: CDPSession,
	params: { screenshot?: { format: "png" } } = {},
) {
	// Headless screenshot requests share compositor resources across pages; do not overlap them.
	const frame = frameQueue.then(() =>
		cdp.send("HeadlessExperimental.beginFrame", params),
	);
	frameQueue = frame.catch(() => undefined);
	return frame;
}

export async function captureFrame(cdp: CDPSession): Promise<Buffer> {
	// Complete pending compositor work, then capture one explicitly driven frame.
	await beginFrame(cdp);
	const deadline = performance.now() + 30000;
	while (performance.now() < deadline) {
		const frame = await beginFrame(cdp, {
			screenshot: { format: "png" },
		});
		if (frame.screenshotData)
			return Buffer.from(frame.screenshotData, "base64");
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error(
		"Deterministic beginFrame returned no screenshot within 30 seconds",
	);
}

export async function movePointer(
	cdp: CDPSession,
	x: number,
	y: number,
): Promise<void> {
	let done = false;
	let failure: unknown;
	const action = cdp
		.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
		.then(
			() => {
				done = true;
			},
			(error) => {
				failure = error;
				done = true;
			},
		);
	const deadline = performance.now() + 30000;
	while (!done && performance.now() < deadline) {
		await beginFrame(cdp);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	if (!done)
		throw new Error(
			"Pointer did not settle within 30 seconds of driven compositor frames",
		);
	await action;
	if (failure) throw failure;
}
