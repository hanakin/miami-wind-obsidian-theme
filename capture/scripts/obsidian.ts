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
	/** Obsidian's main process. */
	pid: number;
	/** Set for headless runs (our child); windowed runs are started through Hyprland. */
	proc?: ChildProcess;
	windowed: boolean;
}

/** Mike's Wayland socket, by absolute path: windowed runs get the display but no runtime dir or bus. */
const WAYLAND_SOCKET = join(
	process.env.XDG_RUNTIME_DIR ?? "/run/user/1000",
	process.env.WAYLAND_DISPLAY ?? "wayland-1",
);
/** Hyprland workspace the windowed capture opens on, so it does not cover Mike's current one. */
export const CAPTURE_WORKSPACE = "name:mwcapture";

/**
 * Style Settings, which Mike runs in all his vaults: the release Obsidian's community plugin list
 * points at (obsidian-community/obsidian-style-settings), downloaded once into the work dir and
 * checked by hash. Never copied from Mike's vaults, never committed.
 */
const STYLE_SETTINGS = {
	id: "obsidian-style-settings",
	url: "https://github.com/obsidian-community/obsidian-style-settings/releases/download/1.0.9/",
	files: {
		"main.js": "1828abaacdab4c5578b705a625c585b30512f8efad4c7cfc5a18e70cc3557468",
		"manifest.json": "9cffdc20cf2aa1354820e0050b694b0f9b576446e3d5d44a36ae8b0187e5bfb8",
		"styles.css": "ee7937d2be50653a89ccb30ae5f0572b23507d5b7f1328d005271a363075bfd8",
	} as Record<string, string>,
};

async function styleSettingsDir(): Promise<string> {
	const dir = join(WORK, "cache/style-settings-1.0.9");
	mkdirSync(dir, { recursive: true });
	const sha = (b: ArrayBuffer | Uint8Array) =>
		new Bun.CryptoHasher("sha256").update(b).digest("hex");
	for (const [name, hash] of Object.entries(STYLE_SETTINGS.files)) {
		const path = join(dir, name);
		if (existsSync(path) && sha(readFileSync(path)) === hash) continue;
		const res = await fetch(STYLE_SETTINGS.url + name);
		if (!res.ok) throw new Error(`Style Settings download failed: ${name} ${res.status}`);
		const body = await res.arrayBuffer();
		if (sha(body) !== hash)
			throw new Error(`Style Settings ${name} does not match its pinned hash`);
		writeFileSync(path, new Uint8Array(body));
	}
	return dir;
}

/** Copies the sample vault and theme into the throwaway work dir. Fresh every run. */
async function prepareVault(): Promise<void> {
	if (!WORK.startsWith(join(homedir(), "Work/"))) throw new Error(`Refusing work dir ${WORK}`);
	rmSync(VAULT, { recursive: true, force: true });
	rmSync(CONFIG_HOME, { recursive: true, force: true });
	rmSync(RUNTIME_DIR, { recursive: true, force: true });
	cpSync(join(REPO, "capture/vault"), VAULT, { recursive: true });
	const theme = join(VAULT, ".obsidian/themes/Miami Wind");
	mkdirSync(theme, { recursive: true });
	cpSync(join(REPO, "theme.css"), join(theme, "theme.css"));
	cpSync(join(REPO, "manifest.json"), join(theme, "manifest.json"));
	cpSync(await styleSettingsDir(), join(VAULT, ".obsidian/plugins", STYLE_SETTINGS.id), {
		recursive: true,
	});
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
export function verifyIsolation(pid: number, windowed = false): string[] {
	const evidence: string[] = [];
	const pids = [pid, ...descendants(pid)];
	for (const p of pids) {
		const cmd = readFileSync(`/proc/${p}/cmdline`, "utf8").replaceAll("\0", " ");
		if (cmd.includes(REAL_CONFIG)) throw new Error(`pid ${p} cmdline mentions ${REAL_CONFIG}`);
		const env = readFileSync(`/proc/${p}/environ`, "utf8").split("\0");
		const leaked = env.find(
			(e) =>
				SESSION_VARS.some((v) => e.startsWith(`${v}=`) && !e.includes(WORK)) &&
				!(windowed && e === `WAYLAND_DISPLAY=${WAYLAND_SOCKET}`),
		);
		if (leaked) throw new Error(`pid ${p} can reach the desktop session: ${leaked}`);
		for (const fd of safeFds(p)) {
			if (fd.startsWith(REAL_CONFIG)) throw new Error(`pid ${p} has ${fd} open`);
		}
	}
	evidence.push(
		windowed
			? `${pids.length} processes checked: none reference ${REAL_CONFIG}; the only desktop handle is the Wayland socket ${WAYLAND_SOCKET} (no session bus, no Hyprland socket, private runtime dir)`
			: `${pids.length} processes checked: none reference ${REAL_CONFIG}, none can reach the desktop session (no display, bus or runtime dir)`,
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

export async function launch(
	opts: { windowed?: boolean; noPointer?: boolean; mobile?: "phone" | "tablet" } = {},
): Promise<Session> {
	const windowed = opts.windowed === true;
	await prepareVault();
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
	const args = [
		APP,
		`--user-data-dir=${USER_DATA}`,
		`--remote-debugging-port=${PORT}`,
		"--remote-debugging-address=127.0.0.1",
		"--disable-gpu",
		// Mike's vault uses the "system" base theme; his desktop is dark, a headless window is not.
		"--force-dark-mode",
		"--force-device-scale-factor=1",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		...(windowed
			? ["--ozone-platform=wayland"]
			: [
					"--ozone-platform=headless",
					`--ozone-override-screen-size=${WIDTH},${HEIGHT}`,
					// Headless has no pointer device, so Blink reports (hover: none) and turns off
					// Obsidian's @media (hover: hover) rules. Report a mouse, as on Mike's desktop.
					...(opts.noPointer
						? []
						: [
								"--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2",
							]),
				]),
	];
	let proc: ChildProcess | undefined;
	let pid = 0;
	if (windowed) {
		env.WAYLAND_DISPLAY = WAYLAND_SOCKET;
		// Started through Hyprland so the exec rule puts the window on its own workspace, silently.
		const envArgs = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`);
		const cmd = `/usr/bin/env -i ${envArgs.join(" ")} ${ELECTRON} ${args.map(shellQuote).join(" ")}`;
		// Hyprland 0.56 takes Lua: exec with a workspace rule bound to the new process.
		const lua = `hl.exec_cmd([==[${cmd}]==], { workspace = "${CAPTURE_WORKSPACE} silent" })`;
		const r = Bun.spawnSync(["hyprctl", "eval", lua]);
		const said = `${r.stdout}${r.stderr}`;
		if (r.exitCode !== 0 || /error/i.test(said)) throw new Error(`hyprctl eval failed: ${said}`);
		for (let i = 0; i < 40 && !pid; i++) {
			await Bun.sleep(250);
			pid = mainPid();
		}
		if (!pid) throw new Error("windowed Obsidian did not start");
	} else {
		proc = spawn(ELECTRON, args, { env, stdio: ["ignore", "pipe", "pipe"], detached: false });
		proc.stderr?.on("data", (d: Buffer) => {
			if (process.env.CAPTURE_DEBUG) process.stderr.write(d);
		});
		pid = proc.pid ?? 0;
	}
	// Everything after the spawn can fail (no DevTools port, no window, never ready): never leave
	// the spawned Obsidian or the DevTools connection behind.
	let browser: Browser | undefined;
	try {
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
		// Obsidian's own mobile emulation (app.emulateMobile) lives in localStorage of this profile:
		// set it for --mobile runs, and make sure no other run ever starts emulated.
		const size =
			opts.mobile === "phone" ? [390, 844] : opts.mobile === "tablet" ? [1024, 768] : null;
		const emulated = (await page.evaluate("!!localStorage.getItem('EmulateMobile')")) as boolean;
		if (size || emulated) {
			await page.evaluate(
				`(() => { ${size ? "localStorage.setItem('EmulateMobile', '1')" : "localStorage.removeItem('EmulateMobile')"}; require("electron").remote.getCurrentWindow().setContentSize(${size?.[0] ?? WIDTH}, ${size?.[1] ?? HEIGHT}); })()`,
			);
			await Bun.sleep(400);
			await page.evaluate("location.reload()").catch(() => undefined);
			await Bun.sleep(1500);
			await page.waitForFunction(
				() =>
					"app" in window &&
					(window as { app?: { workspace?: { layoutReady?: boolean } } }).app?.workspace
						?.layoutReady === true,
				null,
				{ timeout: 30000 },
			);
			const mobileNow = (await page.evaluate(
				"document.body.classList.contains('is-mobile')",
			)) as boolean;
			if (mobileNow !== !!size)
				throw new Error(
					`mobile emulation is ${mobileNow ? "on" : "off"}, wanted ${size ? "on" : "off"}`,
				);
		}
		// Community plugins on, as in Mike's vaults: Style Settings loads.
		await page.evaluate(
			`(async () => { if (!app.plugins.isEnabled()) await app.plugins.setEnable(true); for (let i = 0; i < 100 && !app.plugins.plugins[${JSON.stringify(STYLE_SETTINGS.id)}]; i++) await new Promise((r) => setTimeout(r, 100)); if (!app.plugins.plugins[${JSON.stringify(STYLE_SETTINGS.id)}]) throw new Error("Style Settings did not load"); })()`,
		);
		return { browser, page, pid, windowed, ...(proc ? { proc } : {}) };
	} catch (e) {
		await browser?.close().catch(() => undefined);
		if (pid && alive(pid)) {
			process.kill(pid, "SIGTERM");
			for (let i = 0; i < 20 && alive(pid); i++) await Bun.sleep(250);
			if (alive(pid)) process.kill(pid, "SIGKILL");
		}
		throw e;
	}
}

/** Turns Obsidian's mobile emulation off again in this profile (end of a --mobile run). */
export async function leaveMobile(s: Session): Promise<void> {
	await s.page.evaluate("localStorage.removeItem('EmulateMobile')").catch(() => undefined);
}

function shellQuote(v: string): string {
	return `'${v.replaceAll("'", "'\\''")}'`;
}

/** The Electron main process of this capture's profile (no --type= switch). */
function mainPid(): number {
	const out = Bun.spawnSync(["pgrep", "-f", `user-data-dir=${USER_DATA}`])
		.stdout.toString()
		.trim();
	for (const p of out.split("\n").filter(Boolean)) {
		const cmd = readFileSync(`/proc/${p}/cmdline`, "utf8");
		if (cmd.startsWith(ELECTRON) && !cmd.includes("--type=")) return Number(p);
	}
	return 0;
}

const alive = (pid: number) => existsSync(`/proc/${pid}`);

export async function close(s: Session): Promise<void> {
	await s.browser.close().catch(() => undefined);
	if (!s.pid) return;
	process.kill(s.pid, "SIGTERM");
	for (let i = 0; i < 20 && alive(s.pid); i++) await Bun.sleep(250);
	if (alive(s.pid)) process.kill(s.pid, "SIGKILL");
}
