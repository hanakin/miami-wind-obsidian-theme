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
	for (let attempt = 0; attempt < 8; attempt++) {
		const frame = await beginFrame(cdp, {
			screenshot: { format: "png" },
		});
		if (frame.screenshotData)
			return Buffer.from(frame.screenshotData, "base64");
	}
	throw new Error(
		"Deterministic beginFrame returned no screenshot after eight frames",
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
	for (let frame = 0; !done && frame < 8; frame++) await beginFrame(cdp);
	if (!done)
		throw new Error(
			"Pointer did not settle after eight driven compositor frames",
		);
	await action;
	if (failure) throw failure;
}
