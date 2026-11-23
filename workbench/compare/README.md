# Compare themes

Run `bun install`.
Run `bunx playwright install chromium`.
Run `bun run capture:extract-app-css`.
Run `bun run compare`.

The default command builds the after theme first. It compares `b478dc8:theme.css` with the built root `theme.css`.
Use `--before path` to select a baseline file.
Use `--after path` to select an after file without building.

Use `--id substring` to filter fixture IDs.
Use `--component exact-name` to filter component tags, including nested tags.
Use `--surface exact-name` to filter surfaces.
Combine filters to narrow the selection. An empty selection fails.

The command uses Playwright Chromium with single-threaded software rasterization at 1600 × 1000, scale 1, in sRGB. It disables partial raster reuse, zero-copy rasterization, and threaded scrolling and animation. It drives pending compositor work and the screenshot frame explicitly through `HeadlessExperimental.beginFrame`. Scrollbars remain visible. The system color preference is dark. Each fixture retains its theme and platform classes.

An isolated Obsidian instance supplies the CodeMirror runtime rules on the first run. The cache is `workbench/out/runtime-cm.css`.
After an Obsidian update, delete this cache.
The extracted app CSS version must match the fixture version.

Each fixture loads CodeMirror rules and app CSS once. Every capture clears the theme stylesheet, resolves layout, and swaps in the requested CSS. The three captures use the baseline, the baseline with an extra comment, and the after theme. This exercises the same swap path for the sanity check and the actual comparison.

The command restores recorded pseudo-states through CDP. Hover and active states propagate to ancestors. Focus-visible also forces focus. Focus propagates focus-within to ancestors. Selection fixtures receive a native selection. Scrollbar-hover fixtures receive a real pointer over the scroll thumb. An unavailable state receives a not-proven reason.

Style reads compare standard computed properties on every element. Applicable pseudo-elements include generated content, markers, selection, placeholders, scrollbars, scrollbar thumbs, tracks, corners, and file-selector buttons. Offscreen probes resolve graph, canvas, and PDF colors that Obsidian reads through JavaScript.

The command disables animation and caret suppression during computed-style reads. It enables suppression for screenshots. Caret-color changes remain visible in computed-style differences. Native media control UI remains hidden because its internal loading state is not serialized. Pixel comparison is exact, including antialiasing. There is no pixel tolerance.

Before-vs-before must have zero style and pixel changes. A noisy fixture receives diagnostic images and a noise record. Computed-style differences retain `different` status despite pixel noise. Noise downgrades pixel-only results to `not-proven`. The command completes the remaining fixtures. It does not classify sanity noise as a theme difference.

Exit codes:

- `0`: every selected fixture has proven `same` status.
- `1`: at least one fixture has proven `different` status, or setup fails.
- `2`: no proven differences, but at least one fixture is not proven.

Outputs are local and gitignored. Each run removes old reports and diff images before validation.

- `workbench/out/compare.json`: metadata, summary, fixture results, and coverage limits.
- `workbench/out/compare.md`: summary, not-proven reasons, and top element/property changes.
- `workbench/out/diffs/`: before, after, diff, and sanity evidence images. JSON image paths are relative to `workbench/out/`.
- `workbench/out/component-diffs.json`: `{ [component]: { [surface]: { same, props } } }`.

The JSON keeps `schemaVersion: 1` and the existing fields. Each fixture adds `status`, `notProvenReasons`, `noise: { styles, pixels }`, and `repeats: { before, after }`. The top-level `rasterization` record names the capture protocol and launch flags. A fixture with `not-proven` status has `same: false`.

The top-level `notProven` list contains `{ id, reasons }` records. The top-level `noise` list contains `{ id, styles, pixels }` records. Summary additions are `notProven`, `notProvenOnly`, and `noise` counts.

`summary.changed` counts proven differences. `summary.unchanged` counts proven same results. `summary.notProvenOnly` counts fixtures with not-proven status. These three counts sum to `summary.checked`. `summary.notProven` includes every fixture with a coverage limit. It can overlap proven differences because a partial replay can still expose a genuine CSS difference.

The shared component look uses each property's most common after-theme value within the same interaction state. Ties select the first use in fixture ID order. The comparison excludes container dimensions: width, height, inline-size, block-size, transform-origin, and perspective-origin. Filtered runs describe only the selected uses. This output measures surface consistency independently of before/after parity.

DOM replay cannot reconstruct canvas content, media playback, native media controls, populated iframe contents, missing external images, or Obsidian runtime behavior. Fixtures with those elements receive not-proven reasons. CodeMirror spacer images and images without a source do not represent missing assets. Loaded images are rebuilt. Source-less empty iframes are empty, including graph resize sensors. The controlled Canvas editor iframe remains not-proven because Obsidian injects its editor document through JavaScript. Hidden or offscreen targets also receive not-proven reasons. Their computed styles remain compared.

Fonts are local host fonts. Platform variants do not prove native macOS or Windows appearance. A zero-difference result does not prove live-app parity when the report lists not-proven fixtures.

Fixtures can provide `imageSizes: [{ index, width, height }]`. The index uses zero-based `document.images` order from the serialized fixture HTML, including CodeMirror spacers. Width and height are positive intrinsic `naturalWidth` and `naturalHeight` pixels. Missing images with this metadata receive a plain SVG placeholder at those intrinsic dimensions. The original image classes and CSS sizing remain active. These placeholders prove layout, not image pixels, and do not create a not-proven reason. Loaded images retain their actual pixels.

If `/tmp` is full, set `TMPDIR` to a directory under `~/Work` before running checks or comparisons.
