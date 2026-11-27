# Compare themes

Run `bun install`.
Run `bunx playwright install chromium`.
Run `bun run capture:extract-app-css`.
Run `bun run capture:extract-runtime-css`.
Run `bun run compare`.

The default command builds the after theme first. It compares `b478dc8:theme.css` with the built root `theme.css`.
Use `--before path` to select a baseline file.
Use `--after path` to select an after file without building. Pass an empty CSS file for Default Obsidian. The report records the file path, an empty snapshot, and the SHA-256 hash of the empty string.

Use `--id substring` to search fixture IDs. A single exact fixture ID selects only that fixture. Use `--id id1,id2` or repeat `--id id1 --id id2` for an exact list. Unknown IDs in a list fail the run.
Use `--component exact-name` to filter component tags, including nested tags.
Use `--surface exact-name` to filter surfaces.
Combine filters to narrow the selection. An empty selection fails.

The command uses Playwright Chromium with single-threaded software rasterization, scale 1, in sRGB. It disables partial raster reuse, zero-copy rasterization, and threaded scrolling and animation. Normal compositor scheduling remains active for background pages. Scrollbars remain visible.

The extracted app CSS version must match the fixture version. Each capture saves ordered stylesheet hashes under `capture/.app/runtime/`. Use the matching capture cache when copying fixtures to another worktree. The runtime extraction command supplies the combined stylesheet for older fixtures. Regenerate app and runtime CSS after an Obsidian update. Extracted files remain gitignored.

Compare calls `capture/scripts/replay.ts` for recorded fixtures. Capture owns DOM, canvas, frame, geometry, native selection, and scroll restoration. Compare substitutes the selected theme into the recorded stylesheet order. Each fixture uses its recorded viewport, media preferences, and document mode. XHTML passes through capture's XML parser.

Empty `data-capture-placeholder` stand-ins retain their recorded layout boxes but remain hidden. They contribute no style reads, component samples, or missing-content observations. Synthetic capture-check overlays also contribute no observations. Compare does not use capture's pixel masks or color tolerances.

Four independent captures use the baseline, baseline with a comment, after theme, and after theme with a comment. Every capture clears the stylesheet, resolves layout, and swaps in the requested CSS. This exercises the same replay path for repeat checks and theme comparisons.

Each observation primes one identical reconstruction before its style read and screenshot. Chromium otherwise reports unstable used auto-margins on the first PDF reconstruction. The priming replay contributes no comparison observations.

Capture's shared stylesheet transformation restores recorded pseudo-states. Its shared replay restores text selection, field selection, canvas pixels, styled frame documents, and scrolling. An unavailable state receives a not-proven reason. Computed styles inside frames remain compared.

Compare passes `forceRecordedGeometry: false` to capture replay. Real positioned parents, media, and restored frames keep their natural CSS geometry. Only empty stand-ins retain forced recorded boxes. This prevents saved dimensions from hiding theme width or height changes.

Style reads compare standard computed properties on every element. Applicable pseudo-elements include generated content, markers, selection, placeholders, scrollbars, scrollbar thumbs, tracks, corners, and file-selector buttons. The command also compares the audited JavaScript-read custom properties on every real element. The list lives in `variables.ts`. Offscreen probes resolve graph, canvas, startup/mobile colors, and the page color inside an app-shaped `.pdf-container.mod-themed` context.

The command disables animation and caret suppression during computed-style reads. It enables suppression for screenshots. Caret-color changes remain visible in computed-style differences. Native media UI remains present on shared replays. Its unrestored playback state receives a coverage limit. Pixel comparison checks every RGBA channel exactly, including antialiasing. A changed pixel counts only when both before captures agree and both after captures agree. There is no color tolerance or geometric mask. A same-CSS pixel flip creates a noise record and makes pixel-only conclusions not-proven.

Both same-CSS pairs must have zero style and pixel changes. A noisy fixture receives diagnostic images and a noise record. Computed-style differences retain `different` status despite pixel noise. Noise downgrades pixel-only results to `not-proven`. The command completes the remaining fixtures. It does not classify sanity noise as a theme difference.

Exit codes:

- `0`: every selected fixture is proven same.
- `1`: at least one fixture has proven `different` status, or setup fails.
- `2`: no differences, but at least one fixture is not proven.

Outputs are local and gitignored. Each run removes old reports and diff images before validation.

- `workbench/out/compare.json`: metadata, summary, fixture results, and coverage limits. `generated` is the run start time in ISO format. `themes.before` and `themes.after` each contain the exact compared text’s SHA-256 hash, its source label, and its snapshot file path relative to `workbench/out/`.
- `workbench/out/themes/{before,after}.css`: copies of the exact compared theme texts. The viewer uses these files even if the source files change later.
- `workbench/out/compare.md`: summary, not-proven reasons, and top element/property changes.
- `workbench/out/diffs/`: before, after, diff, and sanity evidence images. JSON image paths are relative to `workbench/out/`.
- `workbench/out/component-diffs.json`: `{ [component]: { [surface]: { same, props } } }`.

The JSON keeps `schemaVersion: 1` and the existing fields. Each fixture adds `status`, `notProvenReasons`, `noise`, and `repeats: { before: 2, after: 2 }`. `noise.beforePixels` and `noise.afterPixels` count same-CSS flips on each side. `noise.pixels` counts their union. `pixelDiff` counts only stable changes. `rawPixelDiff` preserves the first before/after pixel count. The top-level `rasterization` record names the capture protocol and launch flags. A fixture with `not-proven` status has `same: false`.

The top-level `notProven` list contains `{ id, reasons }` records. The top-level `noise` list contains the fixture ID and its style, union-pixel, before-pixel, and after-pixel noise counts. Summary additions are `notProven`, `notProvenOnly`, and `noise` counts.

`summary.changed` counts proven differences. `summary.unchanged` counts proven same results. `summary.notProvenOnly` counts fixtures with not-proven status. These three counts sum to `summary.checked`. `summary.notProven` includes every fixture with a coverage limit. It can overlap proven differences because a partial replay can still expose a genuine CSS difference.

The shared component look uses each property's most common after-theme value within the same interaction state. Ties select the first use in fixture ID order. The comparison excludes container dimensions: width, height, inline-size, block-size, transform-origin, and perspective-origin. Filtered runs describe only the selected uses. This output measures surface consistency independently of before/after parity.

Missing image and media interiors receive not-proven reasons. Unrecorded canvas or frame contents also receive not-proven reasons. The report retains limits declared by capture's replay check. A missing `capture/coverage.json` fails setup. Coverage reasons from both themes and their repeats remain in the report. Drag ghosts with captured JavaScript-copied custom properties remain not proven until that runtime initialization can be reconstructed. Hidden or offscreen targets remain in computed-style comparisons.

Images with a recorded fixture file load their saved pixels. Other loaded images retain their pixels. Capture uses `imageSizes: [{ index, width, height }]` for same-size placeholders. The index follows zero-based `document.images` order, including spacer images. Width and height are intrinsic pixels. Placeholders preserve layout while their missing image interiors remain not proven. CodeMirror spacers and images without sources do not represent missing assets.

MathJax fonts load from the matching local Obsidian archive. No font binaries are committed. Every capture waits for font loading. Failed MathJax faces or missing glyph metrics create not-proven reasons. Other fonts use local host fallbacks. Platform variants do not prove native macOS or Windows appearance.

If `/tmp` is full, set `TMPDIR` to a directory under `~/Work` before running checks or comparisons.

Diff images use red for stable changes and orange for unstable pixels. All unstable pixels remain visible in the evidence. Noisy fixtures also save all four screenshots for inspection.
