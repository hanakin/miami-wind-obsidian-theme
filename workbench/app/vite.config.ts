import { defineConfig } from "vite";
import { viewer } from "./plugin.ts";

const PORT = Number(process.env.PORT ?? 5175);

export default defineConfig({
	root: import.meta.dirname,
	plugins: [viewer()],
	server: {
		// Local only: the captures and Obsidian's CSS must not be reachable from the network.
		host: "127.0.0.1",
		port: PORT,
		strictPort: true,
		// Vite serves only the viewer's own files; captures and CSS go through the plugin's routes.
		fs: { strict: true, allow: [import.meta.dirname] },
		headers: {
			"Content-Security-Policy": [
				"default-src 'self'",
				"script-src 'self'",
				// Vite's dev server delivers the page's CSS as style elements.
				"style-src 'self' 'unsafe-inline'",
				// Fixture frames are served from the next port (plugin.ts).
				`frame-src http://127.0.0.1:${PORT + 1}`,
				"object-src 'none'",
				"base-uri 'none'",
				"form-action 'none'",
				"frame-ancestors 'none'",
			].join("; "),
		},
	},
});
