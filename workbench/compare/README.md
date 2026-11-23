# Compare themes

Run `bun install`.
Run `bunx playwright install chromium`.
Run `bun run capture:extract-app-css`.
Run `bun run compare`.

The default command builds the after theme first. It compares `b478dc8:theme.css` with the built root `theme.css`. Use `--before path` or `--after path` to select local CSS files. An explicit after path skips the build.

Use `--id substring`, `--component exact-name`, or `--surface exact-name` to filter fixtures. Combine filters to narrow the selection. Component filtering includes nested component tags from the fixture manifest. An empty selection fails.

The command uses Playwright Chromium with software rendering at 1600 × 1000, scale 1, dark system preference. The fixture retains its body theme and platform classes. An isolated Obsidian instance supplies its actual CodeMirror runtime rules on the first run. These rules are cached in `workbench/out/runtime-cm.css`. Delete that cache after updating Obsidian. The extracted app CSS version must match the fixture version.

Each fixture is replayed three times: before, before, after. Every replay loads CodeMirror rules, app CSS, theme CSS, then animation suppression. Recorded pseudo-states are forced through CDP. Before-vs-before must have zero style and pixel changes. A failed sanity check aborts the run and writes an error report.

Computed standard properties are compared on every element, including ancestors, and on `::before`, `::after`, and `::marker`. Custom property declarations are inputs: their resolved standard property effects are compared instead. Pixel comparison is exact, including antialiasing, over the viewport. Any style or pixel difference returns exit code 1. Setup and sanity failures also return a nonzero code.

Outputs are local and gitignored:

- `workbench/out/compare.json`: metadata, limits, summary, and fixture differences.
- `workbench/out/compare.md`: short summary and top element/property changes.
- `workbench/out/diffs/<fixture>.{before,after,diff}.png`: images for changed fixtures. Image paths in JSON are relative to `workbench/out/`.
- `workbench/out/component-diffs.json`: `{ [component]: { [surface]: { same, props } } }` for components observed on multiple surfaces.

The component shared look is the most common value of each computed property among after-theme uses in the same interaction state. A tie picks the first use in fixture ID order. A surface differs when any use differs from that shared value. Layout properties are included. Filtered runs describe only the selected uses. This file measures consistency across surfaces, independently of before/after parity.

DOM replay cannot reconstruct canvas content, media playback, iframe contents, external images, bundled fonts, or app-driven runtime behavior. External requests are blocked. Hidden targets remain in computed-style checks and are counted in the report. Their screenshots may be blank. Platform variants use host fonts. Inspect the report's limits before treating a zero-difference result as full live-app parity.
