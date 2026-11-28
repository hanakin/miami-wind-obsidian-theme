import { defineConfig } from "vite";
import { addresses } from "./address.ts";
import { viewer } from "./plugin.ts";

// Where the page and the fixture frames are reached (address.ts).
const at = addresses();

export default defineConfig({
	root: import.meta.dirname,
	plugins: [viewer()],
	server: {
		// Local only: the captures and Obsidian's CSS must not be reachable from the network. On a
		// server, a proxy (tailscale serve) stands in front and is the only way in.
		host: "127.0.0.1",
		port: at.port,
		strictPort: true,
		// Besides its local name, the page answers only to the public name it was given.
		allowedHosts: [new URL(at.page).hostname],
		// Vite serves only the viewer's own files; captures and CSS go through the plugin's routes.
		fs: { strict: true, allow: [import.meta.dirname] },
		headers: {
			"Content-Security-Policy": [
				"default-src 'self'",
				"script-src 'self'",
				// Vite's dev server delivers the page's CSS as style elements.
				"style-src 'self' 'unsafe-inline'",
				// Fixture frames are served from their own origin (plugin.ts).
				`frame-src ${at.frames}`,
				"object-src 'none'",
				"base-uri 'none'",
				"form-action 'none'",
				"frame-ancestors 'none'",
			].join("; "),
		},
	},
});
