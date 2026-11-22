# Headless theme comparison

This harness compares the 1.2.0 stylesheet with the working `theme.css` for the 1.3.0 directory fixes.
It reads `app.css` from the installed Obsidian archive into a temporary directory.
It opens no Obsidian process or real vault.
It runs Chromium headlessly with synthetic markup from `fixture.html`.

## Run

1. Install the temporary test dependency:

   ```sh
   review_tools=$(mktemp -d)
   npm install --prefix "$review_tools" playwright@1.58.2 --no-audit --no-fund
   "$review_tools/node_modules/.bin/playwright" install chromium
   ```

2. Run the comparison from the repository root:

   ```sh
   NODE_PATH="$review_tools/node_modules" node .github/theme-review/check.cjs
   ```

The script prints its output directory and exits with an error if styles, screenshots, or selector coverage differ.
The directory contains full computed-style dumps, `diff.json`, `summary.json`, the extracted `app.css`, and screenshots.
The Obsidian stylesheet stays outside the repository.

Optional environment variables:

- `OBSIDIAN_ASAR`: another Obsidian archive path.
- `CHROMIUM_EXECUTABLE`: an extracted Chromium executable, if the Playwright browser installation is unavailable.
- `REVIEW_OUTPUT`: the output directory.
- `BASELINE_REF`: the Git reference for the original stylesheet. The default is the 1.2.0 commit.
- `CANDIDATE_REF`: compare another Git reference instead of the working stylesheet, for a harness self-check.

## Coverage and limits

The harness checks every original selector branch with an important declaration, plus the tag hover rule.
It dumps every standard computed property for each probe and its `::before`, `::after`, and scrollbar-thumb pseudo-elements.
It uses forced CSS hover, focus, focus-visible, focus-within, and active states in desktop and phone contexts.
Real pointer movement also checks both halves of two adjacent tags and the surrounding plain text.
Assertions check that only the tag under the pointer highlights.
Fixture layout rules disable animation and place components in a static document.

The committed evidence in `../pr-assets/` records Obsidian 1.15.1 and Chromium 145.0.7632.6.
These checks cover representative static markup, not Obsidian runtime changes, third-party plugins, or native select popup painting.
Other Obsidian versions and browsers were not tested.

## Retained tag selector

The editor places the `#` and tag text in adjacent sibling spans without a wrapper for each tag.
The `:has(+ .cm-hashtag-end:hover)` selector styles the preceding `#` when the pointer hovers over its tag text.
A line-level hover selector also highlights adjacent tags and responds over plain text.
A wrapper needs a change to Obsidian's DOM.
JavaScript needs a plugin.
The theme retains this one `:has()` use to preserve the existing behavior.

## Official references

- [Manifest fields](https://docs.obsidian.md/Reference/Manifest)
- [Theme installation labels](https://help.obsidian.md/themes)
- [Previous-sibling selection with `:has()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Next-sibling_combinator#selecting_a_previous_sibling)
