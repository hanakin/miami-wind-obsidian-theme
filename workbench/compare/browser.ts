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
	],
};

export async function captureFrame(cdp: CDPSession): Promise<Buffer> {
	const frame = await cdp.send("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: false,
	});
	return Buffer.from(frame.data, "base64");
}

export async function movePointer(
	cdp: CDPSession,
	x: number,
	y: number,
): Promise<void> {
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}
