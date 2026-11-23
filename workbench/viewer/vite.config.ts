import { defineConfig } from "vite";
import { viewer } from "./plugin.ts";

export default defineConfig({
	root: import.meta.dirname,
	plugins: [viewer()],
	server: {
		// Local only: the captures and Obsidian's CSS must not be reachable from the network.
		host: "127.0.0.1",
		port: Number(process.env.PORT ?? 5175),
		strictPort: true,
		headers: {
			"Content-Security-Policy": [
				"default-src 'self'",
				"script-src 'self'",
				// Vite's dev server delivers the page's CSS as style elements.
				"style-src 'self' 'unsafe-inline'",
				"frame-src 'self'",
				"object-src 'none'",
				"base-uri 'none'",
				"form-action 'none'",
				"frame-ancestors 'none'",
			].join("; "),
		},
	},
});
