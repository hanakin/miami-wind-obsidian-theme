const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

// Run with NODE_PATH pointing to a temporary installation of playwright@1.58.2.
const repo = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json')));
assert.deepEqual(Object.keys(manifest).sort(), ['author', 'authorUrl', 'minAppVersion', 'name', 'version']);
assert.equal(manifest.version, '1.3.0');
const baselineRef = process.env.BASELINE_REF || 'f1a5e79a2f83f8d3d2c995040c188f483f9b606e';
const out = process.env.REVIEW_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'miami-theme-review-'));
fs.mkdirSync(out, { recursive: true });
const asarPath = process.env.OBSIDIAN_ASAR || '/Applications/Obsidian.app/Contents/Resources/obsidian.asar';
// Read the archive only; no Electron/Obsidian process or real vault is opened.
const archive = fs.readFileSync(asarPath);
const headerSize = archive.readUInt32LE(4);
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
function extract(name) {
  const entry = header.files[name];
  assert(entry && !entry.unpacked, `Missing packed file: ${name}`);
  const start = 8 + headerSize + Number(entry.offset);
  return archive.subarray(start, start + entry.size);
}
const app = extract('app.css').toString();
const appVersion = JSON.parse(extract('package.json')).version;
fs.writeFileSync(path.join(out, 'app.css'), app);
const themes = {
  before: execFileSync('git', ['show', `${baselineRef}:theme.css`], { cwd: repo, encoding: 'utf8' }),
  after: process.env.CANDIDATE_REF ? execFileSync('git', ['show', `${process.env.CANDIDATE_REF}:theme.css`], { cwd: repo, encoding: 'utf8' }) : fs.readFileSync(path.join(repo, 'theme.css'), 'utf8'),
};
const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE });
  try {
    const results = {};
    const coverage = new Set();
    let requiredSelectors;
    let probeCount;
    for (const [label, theme] of Object.entries(themes)) {
      console.log(`Measuring ${label}...`);
      const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1, colorScheme: 'dark' });
      await page.route('**/*', route => route.abort());
      await page.setContent(fixture);
      await page.evaluate(({ app, theme }) => {
        document.querySelector('#app').textContent = app;
        document.querySelector('#theme').textContent = theme;
        document.querySelectorAll('[data-probe]').forEach((el, i) => el.id = `probe-${i}`);
      }, { app, theme });
      await page.evaluate(() => document.fonts.ready);
      if (label === 'before') {
        requiredSelectors = await page.evaluate(() => [...document.querySelector('#theme').sheet.cssRules]
          .filter(rule => rule.style && ([...rule.style].some(prop => rule.style.getPropertyPriority(prop)) || rule.selectorText.includes(':has(')))
          .flatMap(rule => rule.selectorText.split(/,\s*/)));
      }
      const probes = await page.locator('[data-probe]').evaluateAll(els => els.map(el => ({ id: el.id, case: el.closest('[data-case]').dataset.case })));
      probeCount = probes.length;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      const nodes = new Map();
      for (const probe of probes) {
        nodes.set(probe.id, (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${probe.id}` })).nodeId);
      }
      const snapshot = async caseName => page.evaluate(({ caseName, selectors }) => {
        const elements = document.querySelector(`[data-case="${caseName}"]`);
        const styles = {};
        for (const el of [elements, ...elements.querySelectorAll('[data-probe]')]) {
          if (!el.matches('[data-probe]')) continue;
          for (const pseudo of ['', '::before', '::after', '::-webkit-scrollbar-thumb']) {
            const computed = getComputedStyle(el, pseudo || null);
            styles[el.id + pseudo] = Object.fromEntries([...computed].filter(p => !p.startsWith('--')).map(p => [p, computed.getPropertyValue(p)]));
          }
        }
        const matched = selectors.filter(selector => document.querySelector(selector.replace(/::[\w-]+$/, '')));
        return { styles, matched };
      }, { caseName, selectors: requiredSelectors });
      const states = { normal: [], hover: ['hover'], focus: ['focus', 'focus-visible', 'focus-within'], hoverFocus: ['hover', 'focus', 'focus-visible', 'focus-within'], active: ['hover', 'active'] };
      const snapshots = {};
      for (const mode of ['desktop', 'phone']) {
        await page.evaluate(mode => { document.body.classList.toggle('is-mobile', mode === 'phone'); document.body.classList.toggle('is-phone', mode === 'phone'); }, mode);
        for (const probe of probes) {
          for (const [state, pseudoClasses] of Object.entries(states)) {
            await cdp.send('CSS.forcePseudoState', { nodeId: nodes.get(probe.id), forcedPseudoClasses: pseudoClasses });
            const snap = await snapshot(probe.case);
            snapshots[`${mode}/${probe.id}/${state}`] = snap.styles;
            if (label === 'before') snap.matched.forEach(s => coverage.add(s));
          }
          await cdp.send('CSS.forcePseudoState', { nodeId: nodes.get(probe.id), forcedPseudoClasses: [] });
        }
      }
      await page.evaluate(() => document.body.classList.remove('is-mobile', 'is-phone'));
      for (const section of ['markdown', 'controls', 'dialogs']) {
        await page.locator(`#${section}`).screenshot({ path: path.join(out, `${section}-${label}.png`), animations: 'disabled' });
      }
      // Real pointer movement verifies both tag halves, adjacent tags, and plain text.
      const tagProbes = await page.locator('[data-case="tags"] [data-probe]').evaluateAll(els => els.map(el => el.id));
      for (const id of tagProbes) {
        await page.locator(`#${id}`).hover({ force: true });
        snapshots[`pointer/${id}`] = (await snapshot('tags')).styles;
        const hoveredIndex = tagProbes.indexOf(id);
        for (const index of [1, 2, 3, 4]) {
          const pairHovered = (hoveredIndex === 1 || hoveredIndex === 2) ? index <= 2 : (hoveredIndex === 3 || hoveredIndex === 4) && index >= 3;
          assert.equal(snapshots[`pointer/${id}`][tagProbes[index]]['background-color'], pairHovered ? 'rgb(244, 114, 182)' : 'rgb(34, 211, 238)', 'Hover must highlight only the complete tag under the pointer');
        }
      }
      await page.mouse.move(0, 0);
      const tagText = page.locator('[data-case="tags"] .cm-hashtag-end').first();
      await tagText.hover();
      await page.locator('[data-case="tags"]').screenshot({ path: path.join(out, `tags-hover-${label}.png`), animations: 'disabled' });
      results[label] = snapshots;
      fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(snapshots));
      await page.close();
    }
    const differences = [];
    for (const [state, elements] of Object.entries(results.before)) {
      for (const [id, styles] of Object.entries(elements)) {
        for (const [property, before] of Object.entries(styles)) {
          const after = results.after[state]?.[id]?.[property];
          if (before !== after) differences.push({ state, id, property, before, after });
        }
      }
    }
    const uncovered = [...new Set(requiredSelectors)].filter(selector => !coverage.has(selector));
    const screenshots = ['markdown', 'controls', 'dialogs', 'tags-hover'].map(area => ({ area, identical: hash(fs.readFileSync(path.join(out, `${area}-before.png`))) === hash(fs.readFileSync(path.join(out, `${area}-after.png`))) }));
    const summary = { baselineRef, appVersion, appCssSha256: hash(app), beforeCssSha256: hash(themes.before), afterCssSha256: hash(themes.after), chromium: browser.version(), probes: probeCount, states: Object.keys(results.before).length, selectorBranches: new Set(requiredSelectors).size, uncovered, computedStyleDifferences: differences.length, screenshots };
    fs.writeFileSync(path.join(out, 'diff.json'), JSON.stringify(differences, null, 2));
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ out, ...summary }, null, 2));
    assert.equal(uncovered.length, 0, 'Fixture must cover every affected selector branch');
    assert.equal(differences.length, 0, 'Computed styles changed; inspect diff.json');
    assert(screenshots.every(s => s.identical), 'Screenshots changed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
