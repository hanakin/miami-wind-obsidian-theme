// Starts a fully isolated, off-screen Obsidian and connects to it over the DevTools protocol.
// Isolation: own XDG_CONFIG_HOME + --user-data-dir under the work dir, a throwaway vault,
// no display variables, and Chromium's headless Ozone platform (no window on any screen).
import { type ChildProcess, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";

export const WORK = process.env.CAPTURE_WORK ?? join(homedir(), "Work/miami-wind-obsidian-capture");
// CAPTURE_INSTANCE lets a second isolated instance run beside the first (own vault, config, port).
const INSTANCE = join(WORK, process.env.CAPTURE_INSTANCE ?? "");
export const VAULT = join(INSTANCE, "vault");
export const SCREENSHOTS = join(WORK, "screenshots");
const CONFIG_HOME = join(INSTANCE, "config");
const USER_DATA = join(CONFIG_HOME, "obsidian");
const RUNTIME_DIR = join(INSTANCE, "runtime");
const REAL_CONFIG = join(homedir(), ".config/obsidian");
const SESSION_VARS = [
	"WAYLAND_DISPLAY",
	"DISPLAY",
	"DBUS_SESSION_BUS_ADDRESS",
	"HYPRLAND_INSTANCE_SIGNATURE",
	"XDG_RUNTIME_DIR",
	"SWAYSOCK",
];
const REPO = new URL("../../", import.meta.url).pathname;
const ELECTRON = "/usr/lib/electron43/electron";
// The Arch package's loader. It runs the newest obsidian-<version>.asar found in the user-data
// dir, so dropping a copy of Mike's self-updated 1.15.1 asar there runs 1.15.1.
const APP = "/usr/lib/obsidian/app.asar";
/** Newest obsidian-*.asar copied into the work dir (read-only copy of ~/.config/obsidian's). */
export function appAsar(): string | undefined {
	if (process.env.OBSIDIAN_ASAR) return process.env.OBSIDIAN_ASAR;
	if (!existsSync(WORK)) return undefined;
	const found = readdirSync(WORK)
		.filter((f) => /^obsidian-[\d.]+\.asar$/.test(f))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	const newest = found.at(-1);
	return newest ? join(WORK, newest) : undefined;
}
const PORT = Number(process.env.CAPTURE_PORT ?? 9339);
const VAULT_ID = "c4c7a9e0aa11b0b5";
export const WIDTH = 1600;
export const HEIGHT = 1000;

export interface Session {
	browser: Browser;
	page: Page;
	proc: ChildProcess;
}

/** Copies the sample vault and theme into the throwaway work dir. Fresh every run. */
function prepareVault(): void {
	if (!WORK.startsWith(join(homedir(), "Work/"))) throw new Error(`Refusing work dir ${WORK}`);
	rmSync(VAULT, { recursive: true, force: true });
	rmSync(CONFIG_HOME, { recursive: true, force: true });
	rmSync(RUNTIME_DIR, { recursive: true, force: true });
	cpSync(join(REPO, "capture/vault"), VAULT, { recursive: true });
	const theme = join(VAULT, ".obsidian/themes/Miami Wind");
	mkdirSync(theme, { recursive: true });
	cpSync(join(REPO, "theme.css"), join(theme, "theme.css"));
	cpSync(join(REPO, "manifest.json"), join(theme, "manifest.json"));
	mkdirSync(USER_DATA, { recursive: true });
	mkdirSync(SCREENSHOTS, { recursive: true });
	const asar = appAsar();
	if (asar) cpSync(asar, join(USER_DATA, basename(asar)));
	writeFileSync(
		join(USER_DATA, "obsidian.json"),
		JSON.stringify({
			vaults: { [VAULT_ID]: { path: VAULT, ts: Date.now(), open: true } },
			updateDisabled: true,
			frame: "hidden",
		}),
	);
	writeFileSync(
		join(USER_DATA, `${VAULT_ID}.json`),
		JSON.stringify({ x: 0, y: 0, width: WIDTH, height: HEIGHT, isMaximized: false }),
	);
}

/** Fails loudly if any process we started can see Mike's real Obsidian config. */
export function verifyIsolation(pid: number): string[] {
	const evidence: string[] = [];
	const pids = [pid, ...descendants(pid)];
	for (const p of pids) {
		const cmd = readFileSync(`/proc/${p}/cmdline`, "utf8").replaceAll("\0", " ");
		if (cmd.includes(REAL_CONFIG)) throw new Error(`pid ${p} cmdline mentions ${REAL_CONFIG}`);
		const env = readFileSync(`/proc/${p}/environ`, "utf8").split("\0");
		const leaked = env.find((e) =>
			SESSION_VARS.some((v) => e.startsWith(`${v}=`) && !e.includes(WORK)),
		);
		if (leaked) throw new Error(`pid ${p} can reach the desktop session: ${leaked}`);
		for (const fd of safeFds(p)) {
			if (fd.startsWith(REAL_CONFIG)) throw new Error(`pid ${p} has ${fd} open`);
		}
	}
	evidence.push(
		`${pids.length} processes checked: none reference ${REAL_CONFIG}, none can reach the desktop session (no display, bus or runtime dir)`,
	);
	if (
		!existsSync(join(USER_DATA, "Local Storage")) &&
		!existsSync(join(USER_DATA, "Preferences"))
	) {
		throw new Error(`Obsidian did not write to ${USER_DATA}`);
	}
	evidence.push(`Obsidian writes its app data to ${USER_DATA}`);
	return evidence;
}

function descendants(pid: number): number[] {
	const out = Bun.spawnSync(["pgrep", "-P", String(pid)])
		.stdout.toString()
		.trim();
	if (!out) return [];
	return out.split("\n").flatMap((c) => [Number(c), ...descendants(Number(c))]);
}

function safeFds(pid: number): string[] {
	const out = Bun.spawnSync(["find", `/proc/${pid}/fd`, "-maxdepth", "1", "-printf", "%l\n"]);
	return out.stdout.toString().split("\n");
}

export async function launch(): Promise<Session> {
	prepareVault();
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined && !SESSION_VARS.includes(k)) env[k] = v;
	}
	// A private runtime dir and no session bus: links, dialogs and helpers cannot reach the desktop.
	mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
	env.XDG_RUNTIME_DIR = RUNTIME_DIR;
	env.BROWSER = "/bin/false";
	env.XDG_CONFIG_HOME = CONFIG_HOME;
	env.ELECTRON_DISABLE_SECURITY_WARNINGS = "1";
	const proc = spawn(
		ELECTRON,
		[
			APP,
			`--user-data-dir=${USER_DATA}`,
			"--ozone-platform=headless",
			`--ozone-override-screen-size=${WIDTH},${HEIGHT}`,
			`--remote-debugging-port=${PORT}`,
			"--remote-debugging-address=127.0.0.1",
			"--disable-gpu",
			// Mike's vault uses the "system" base theme; his desktop is dark, a headless window is not.
			"--force-dark-mode",
			"--force-device-scale-factor=1",
		],
		{ env, stdio: ["ignore", "pipe", "pipe"], detached: false },
	);
	proc.stderr?.on("data", (d: Buffer) => {
		if (process.env.CAPTURE_DEBUG) process.stderr.write(d);
	});
	let browser: Browser | undefined;
	for (let i = 0; i < 60 && !browser; i++) {
		await Bun.sleep(500);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
	}
	if (!browser) throw new Error("Could not reach Obsidian's DevTools port");
	let page: Page | undefined;
	for (let i = 0; i < 60 && !page; i++) {
		page = browser
			.contexts()
			.flatMap((c) => c.pages())
			.find((p) => p.url().includes("index.html"));
		if (!page) await Bun.sleep(500);
	}
	if (!page) throw new Error("Obsidian's main window did not open");
	await page.waitForFunction(
		() =>
			"app" in window &&
			(window as { app?: { workspace?: { layoutReady?: boolean } } }).app?.workspace
				?.layoutReady === true,
		null,
		{ timeout: 30000 },
	);
	return { browser, page, proc };
}

export async function close(s: Session): Promise<void> {
	await s.browser.close().catch(() => undefined);
	s.proc.kill("SIGTERM");
	for (let i = 0; i < 20 && s.proc.exitCode === null; i++) await Bun.sleep(250);
	if (s.proc.exitCode === null) s.proc.kill("SIGKILL");
}
