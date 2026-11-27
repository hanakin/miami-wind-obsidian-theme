# Compare themes

Run `bun install`.
Run `bunx playwright install chromium`.
Run `bun run capture:extract-app-css`.
Run `bun run capture:extract-runtime-css`.
Run `bun run compare`.

The default command builds the after theme first. It compares `b478dc8:theme.css` with the built root `theme.css`.
Run `bun run compare:formatting` to compare the same sources before and after the formatter.
This command saves the pre-format build as `workbench/out/before-format.css`, then builds the formatted `theme.css`.
It runs the full fixture set by default. It accepts the same fixture filters.
Use this command for formatting parity after merging port branches into a preview worktree.
The default `bun run compare` baseline remains 1.x.

Use `--before path` to select a baseline file.
Use `--after path` to select an after file without building.

Use `--id substring` to filter fixture IDs.
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

- `0`: every selected fixture is same or accepted, with no coverage limits on accepted results.
- `1`: at least one fixture has proven `different` status, or setup fails.
- `2`: no unaccepted differences, but at least one fixture is not proven or an accepted result has coverage limits.

Outputs are local and gitignored. Each run removes old reports and diff images before validation.

- `workbench/out/compare.json`: metadata, summary, fixture results, and coverage limits.
- `workbench/out/compare.md`: summary, not-proven reasons, and top element/property changes.
- `workbench/out/diffs/`: before, after, diff, and sanity evidence images. JSON image paths are relative to `workbench/out/`.
- `workbench/out/component-diffs.json`: `{ [component]: { [surface]: { same, props } } }`.

The JSON keeps `schemaVersion: 1` and the existing fields. Each fixture adds `status`, `notProvenReasons`, `noise`, and `repeats: { before: 2, after: 2 }`. `noise.beforePixels` and `noise.afterPixels` count same-CSS flips on each side. `noise.pixels` counts their union. `pixelDiff` counts only stable changes. `rawPixelDiff` preserves the first before/after pixel count. The top-level `rasterization` record names the capture protocol and launch flags. A fixture with `not-proven` status has `same: false`.

The top-level `notProven` list contains `{ id, reasons }` records. The top-level `noise` list contains the fixture ID and its style, union-pixel, before-pixel, and after-pixel noise counts. Summary additions are `notProven`, `notProvenOnly`, and `noise` counts.

`summary.changed` counts proven differences. `summary.unchanged` counts proven same results. `summary.notProvenOnly` counts fixtures with not-proven status. These counts plus `summary.accepted` sum to `summary.checked`. `summary.notProven` includes every fixture with a coverage limit. It can overlap proven differences because a partial replay can still expose a genuine CSS difference.

The shared component look uses each property's most common after-theme value within the same interaction state. Ties select the first use in fixture ID order. The comparison excludes container dimensions: width, height, inline-size, block-size, transform-origin, and perspective-origin. Filtered runs describe only the selected uses. This output measures surface consistency independently of before/after parity.

DOM replay cannot reconstruct canvas content, media playback, native media controls, populated iframe contents, missing external images, or Obsidian runtime behavior. Fixtures with those elements receive not-proven reasons. CodeMirror spacer images and images without a source do not represent missing assets. Loaded images are rebuilt. Source-less empty iframes are empty, including graph resize sensors. The controlled Canvas editor iframe remains not-proven because Obsidian injects its editor document through JavaScript. Hidden or offscreen targets also receive not-proven reasons. Their computed styles remain compared.

Fonts are local host fonts. Platform variants do not prove native macOS or Windows appearance. A zero-difference result does not prove live-app parity when the report lists not-proven fixtures.

Fixtures can provide `imageSizes: [{ index, width, height }]`. The index uses zero-based `document.images` order from the serialized fixture HTML, including CodeMirror spacers. Width and height are positive intrinsic `naturalWidth` and `naturalHeight` pixels. Missing images with this metadata receive a plain SVG placeholder at those intrinsic dimensions. The original image classes and CSS sizing remain active. These placeholders prove layout, not image pixels, and do not create a not-proven reason. Loaded images retain their actual pixels.

If `/tmp` is full, set `TMPDIR` to a directory under `~/Work` before running checks or comparisons.

Diff images use red for stable changes and orange for unstable pixels. All unstable pixels remain visible in the evidence. Noisy fixtures also save all four screenshots for inspection.

The accepted-difference list is `workbench/compare/accepted-differences.json`. It contains one intentional PDF form-dropdown decision. The DOM must match its select selector and inline black/transparent style guard in all four captures. Both after captures must resolve the select to black text and a transparent background. The pinned property list allows only those colors and their currentColor consequences. Border-color changes are allowed only on the select’s own pseudos. Typography, geometry, stacking, visibility, and other properties remain differences. A fixture becomes `accepted` only when every computed-style difference belongs to that select or its own pseudo-elements and every stable changed pixel intersects the union of its measured before/after rectangles. A sibling or descendant style difference, stable pixel change outside those rectangles, repeat noise, or a pixel-only result prevents acceptance. This attribution never masks pixels or changes the measured counts or evidence. `acceptanceScope` records matched element keys and rectangles. `pixelsOutsideAcceptance` records stable changes outside them.

Matching and not-proven observations retain their measured status. Accepted results retain `same: false`, `comparisonStatus: different`, all measurements, coverage reasons, and evidence images. `acceptanceReason` records the decision. The top-level `accepted` list contains `{ id, reason }` records for accepted fixtures. `summary.accepted` counts them. Unaccepted differences fail with exit 1. Not-proven results, including accepted results with coverage limits, fail with exit 2 and give the report not-proven status when no unaccepted differences remain. The JSON keeps schema version 1. CodeMirror `.cm-tooltip` uses belong to the shared `tooltip` component.
