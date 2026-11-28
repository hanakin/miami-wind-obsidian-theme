// Where the workbench is reached. On your own machine: two ports on 127.0.0.1, the page and,
// one port up, the fixture frames. Behind a proxy (tailscale serve on a server) the browser sees
// two other addresses; they are given in the environment, and the origin checks, the frame
// addresses and both content policies use them. The servers themselves always listen on
// 127.0.0.1 only.
//
//   PORT                     the page's local port (default 5175); frames take the next one
//   WORKBENCH_ORIGIN         the page as the browser reaches it, e.g. https://host.ts.net:8443
//   WORKBENCH_FRAME_ORIGIN   the frames as the browser reaches them, e.g. https://host.ts.net:8444

export interface Addresses {
	/** The page's local port; the frames listen on the next one. */
	port: number;
	/** The two addresses on this machine itself. */
	local: { page: string; frames: string };
	/** The page's origin as the browser sees it. */
	page: string;
	/** The fixture frames' origin as the browser sees it: never the page's. */
	frames: string;
}

/** An origin from the environment: http(s)://host[:port], nothing after it. */
function origin(name: string, value: string | undefined): string | undefined {
	if (!value) return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} is not an address: ${value}`);
	}
	if (!/^https?:$/.test(url.protocol) || url.origin !== value.replace(/\/$/, "")) {
		throw new Error(`${name} must be an origin like https://host:8443, not ${value}`);
	}
	return url.origin;
}

export function addresses(env: Record<string, string | undefined> = process.env): Addresses {
	const port = Number(env.PORT ?? 5175);
	if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error("PORT is not a port.");
	const local = { page: `http://127.0.0.1:${port}`, frames: `http://127.0.0.1:${port + 1}` };
	const page = origin("WORKBENCH_ORIGIN", env.WORKBENCH_ORIGIN) ?? local.page;
	const frames = origin("WORKBENCH_FRAME_ORIGIN", env.WORKBENCH_FRAME_ORIGIN) ?? local.frames;
	// The frames hold untrusted markup: they must never share the page's origin.
	if (page === frames) throw new Error("The page and the frames need two different origins.");
	return { port, local, page, frames };
}
