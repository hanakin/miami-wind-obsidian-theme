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

The command uses Playwright Chromium with single-threaded software rasterization at 1600 × 1000, scale 1, in sRGB. It disables partial raster reuse, zero-copy rasterization, and threaded scrolling and animation. Normal compositor frame scheduling remains active for background pages. Explicit begin-frame control was tested, but it stalled on background fixture pages. Scrollbars remain visible. The system color preference is dark. Each fixture retains its theme and platform classes.

The runtime extraction command saves CodeMirror and other runtime sheets to `capture/.app/runtime-styles.css`. It excludes the theme. Regenerate app and runtime CSS after an Obsidian update. Both files remain gitignored.
The extracted app CSS version must match the fixture version.

Each fixture loads app CSS followed by the extracted runtime rules once. The manifest selects the fixture file and its format. A fixture with `format: "xhtml"` loads as `application/xhtml+xml`, preserving XML nesting. Invalid XHTML fails the run. Empty `data-capture-placeholder` stand-ins remain hidden and are excluded from style reads, pseudo-state replay, component samples, and missing-content checks. They contribute no comparison observations. Every capture clears the theme stylesheet, resolves layout, and swaps in the requested CSS. Four independent captures use the baseline, the baseline with a comment, the after theme, and the after theme with a comment. This exercises the same swap path for the sanity check and the actual comparison.

The command restores recorded pseudo-states through CDP. Hover and active states propagate to ancestors. Focus-visible also forces focus. Focus propagates focus-within to ancestors. Selection fixtures receive a native selection. Scrollbar-hover fixtures receive a real pointer over the scroll thumb. An unavailable state receives a not-proven reason.

Style reads compare standard computed properties on every element. Applicable pseudo-elements include generated content, markers, selection, placeholders, scrollbars, scrollbar thumbs, tracks, corners, and file-selector buttons. Offscreen probes resolve graph, canvas, and PDF colors that Obsidian reads through JavaScript.

The command disables animation and caret suppression during computed-style reads. It enables suppression for screenshots. Caret-color changes remain visible in computed-style differences. Native media control UI remains hidden because its internal loading state is not serialized. Pixel comparison checks every RGBA channel exactly, including antialiasing. A changed pixel counts only when both before captures agree and both after captures agree. There is no color tolerance or geometric mask. A same-CSS pixel flip creates a noise record and makes pixel-only conclusions not-proven.

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

DOM replay cannot reconstruct canvas content, media playback, native media controls, populated iframe contents, missing external images, or Obsidian runtime behavior. Fixtures with those elements receive not-proven reasons. CodeMirror spacer images and images without a source do not represent missing assets. Loaded images are rebuilt. Source-less empty iframes are empty, including graph resize sensors. The controlled Canvas editor iframe remains not-proven because Obsidian injects its editor document through JavaScript. Hidden or offscreen targets also receive not-proven reasons. Their computed styles remain compared.

MathJax WOFF2 fonts are embedded from the matching local Obsidian archive at runtime. The archive must match the extracted app CSS version. No font binaries are committed. Every capture waits for font loading. Failed MathJax faces or missing per-glyph sizing rules create explicit not-proven reasons. The captured runtime stylesheet must retain the glyph rules needed by the fixture. Other fonts use local host fallbacks. Platform variants do not prove native macOS or Windows appearance. A zero-difference result does not prove live-app parity when the report lists not-proven fixtures.

Fixtures can provide `imageSizes: [{ index, width, height }]`. The index uses zero-based `document.images` order from the serialized fixture HTML, including CodeMirror spacers. Width and height are positive intrinsic `naturalWidth` and `naturalHeight` pixels. Missing images with this metadata receive a plain SVG placeholder at those intrinsic dimensions. The original image classes and CSS sizing remain active. These placeholders prove layout, not image pixels, and do not create a not-proven reason. Loaded images retain their actual pixels.

If `/tmp` is full, set `TMPDIR` to a directory under `~/Work` before running checks or comparisons.

Diff images use red for stable changes and orange for unstable pixels. All unstable pixels remain visible in the evidence. Noisy fixtures also save all four screenshots for inspection.
