/*!
 * The colour palette floats above whatever holds the editor: a narrow
 * scrolling panel, a transformed ancestor, the edges of the window.
 *
 * Runs in Chromium, WebKit and Firefox, all under `style-src 'self'` (as
 * bspkfw serves it), so the placement must go through the CSSOM. An engine
 * Playwright has not installed is skipped, and says so. WebKit's own
 * per-<select> violation is measured and allowed, as in preview-csp.js.
 * Then, in Chromium, the fallback for a browser without popover.
 */
'use strict';

const playwright = require('playwright');
const { serve, scratch, shot, checker, watchErrors } = require('./harness');

const CSP = "style-src 'self'";

// No inline <style> (the policy would refuse it): served through the route below.
const SHEET = `
  body { margin: 0; font: 14px sans-serif; }
  .box { position: absolute; width: 280px; height: 300px; overflow: auto; border: 1px solid #999; }
  #panel { left: 20px; top: 20px; }
  #moved { left: 340px; top: 20px; transform: translateX(0); }
  #right { right: 0; top: 20px; width: 220px; }
  #low { position: fixed; left: 660px; bottom: 0; height: 120px; }
  .pad { height: 400px; }
  /* A scrollbar that takes room, as on Windows. WebKit draws it; headless
     Chromium ignores it and Firefox has no such selector. */
  .kse-palette::-webkit-scrollbar { width: 15px; }
  .kse-palette::-webkit-scrollbar-thumb { background: #888; }`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script>
  window.phase = 'page';
  window.violations = [];
  document.addEventListener('securitypolicyviolation', function (e) {
    window.violations.push({ phase: window.phase, directive: e.violatedDirective, sample: e.sample });
  });
</script>
<link rel="stylesheet" href="src/k-style-editor.css">
<link rel="stylesheet" href="tests/browser/.scratch/palette-float.css"></head><body>
<div class="box" id="panel"><textarea id="t"></textarea><div class="pad"></div></div>
<div class="box" id="moved"><textarea id="u"></textarea></div>
<div class="box" id="right"><textarea id="v"></textarea></div>
<div class="box" id="low"><textarea id="w"></textarea></div>
<button type="button" id="outside">Outside</button>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
</body></html>`;

async function check(name, srv, c) {
  let browser;
  try { browser = await playwright[name].launch(); } catch (e) {
    console.log('SKIP ' + name + ': ' + String(e.message).split('\n')[0]);
    return;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = watchErrors(page, []);
  await page.route('**/palette-float.html', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: Object.assign({}, res.headers(), { 'content-security-policy': CSP }) });
  });
  await page.route('**/palette-float.css', (route) => route.fulfill({ contentType: 'text/css', body: SHEET }));
  await page.goto(srv.url + scratch.url('palette-float.html'));
  await page.waitForTimeout(100);

  const ok = (label, cond, detail) => c.ok(name + ': ' + label, cond, detail);
  const phase = (p) => page.evaluate((x) => violations.filter(function (v) { return v.phase === x; }), p);
  const settle = () => page.waitForTimeout(100);
  // Playwright's WebKit screenshot itself reports a style-src-elem
  // violation, so screenshots are a phase of their own.
  const snap = async (file) => {
    await page.evaluate(() => { window.phase = 'shot'; });
    await page.screenshot({ path: shot(file) });
    await settle();
    await page.evaluate(() => { window.phase = 'use'; });
  };

  // What one bare <select> costs in this engine.
  await page.evaluate(() => {
    window.phase = 'select';
    var s = document.createElement('select');
    s.appendChild(document.createElement('option'));
    document.body.appendChild(s);
  });
  await settle();
  await page.evaluate(() => { document.querySelector('body > select').remove(); });
  const perSelect = (await phase('select')).length;

  await page.evaluate(() => {
    window.phase = 'build';
    window.bodyCount = document.body.children.length;
    var one = { basic: ['color'], advanced: false, code: false };
    window.panel = KStyleEditor.attach('#t', {});
    window.moved = KStyleEditor.attach('#u', Object.assign({ theme: 'dark' }, one));
    window.right = KStyleEditor.attach('#v', one);
    window.low = KStyleEditor.attach('#w', one);
    window.selects = [panel, moved, right, low].reduce(function (n, e) { return n + e.root.querySelectorAll('select').length; }, 0);
  });
  await settle();
  await page.evaluate(() => { window.phase = 'use'; });

  // Where the chip and palette of one editor are, and whether the palette
  // is painted on top at its corners.
  const geo = (box) => page.evaluate((b) => {
    var chip = document.querySelector('#' + b + ' [data-control=color] .kse-swatch').getBoundingClientRect();
    var pop = document.querySelector('#' + b + ' [data-control=color] .kse-palette');
    var r = pop.getBoundingClientRect();
    var root = document.documentElement;
    var corners = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
    return {
      open: !pop.hidden, up: pop.getAttribute('data-up') === 'true',
      chip: { left: chip.left, top: chip.top, bottom: chip.bottom },
      pop: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      vw: root.clientWidth, vh: root.clientHeight,
      painted: corners.every(function (p) { var hit = document.elementFromPoint(p[0], p[1]); return !!hit && pop.contains(hit); }),
      onScreen: r.left >= 0 && r.top >= 0 && r.right <= root.clientWidth && r.bottom <= root.clientHeight,
      scrolls: pop.scrollHeight > pop.clientHeight,
      columns: Array.prototype.every.call(pop.querySelectorAll('.kse-chip'), function (b) {
        return b.getBoundingClientRect().right <= r.left + pop.clientLeft + pop.clientWidth;
      }),
      bg: getComputedStyle(pop).backgroundColor
    };
  }, box);
  const near = (a, b) => Math.abs(a - b) <= 1;
  const chipOf = (box) => '#' + box + ' [data-control=color] .kse-swatch';
  const popOf = (box) => '#' + box + ' [data-control=color] .kse-palette';
  const open = (box) => page.evaluate((s) => { document.querySelector(s).click(); }, chipOf(box));

  // A narrow scrolling panel.
  const before = await page.evaluate(() => document.getElementById('panel').scrollHeight);
  await page.click(chipOf('panel'));
  let g = await geo('panel');
  ok('the palette opens', g.open);
  ok('it is fully on screen and painted on top of the panel', g.onScreen && g.painted, g);
  ok('the panel does not grow to hold it', await page.evaluate(() => document.getElementById('panel').scrollHeight) === before);
  ok('it opens below the chip, lined up with it', near(g.pop.top, g.chip.bottom + 6) && near(g.pop.left, g.chip.left) && !g.up, g);
  ok('it extends past the panel', g.pop.right > await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().right));
  await snap('palette-float-' + name);

  await page.evaluate(() => { document.getElementById('panel').scrollTop = 20; });
  await settle();
  g = await geo('panel');
  ok('it follows the chip when the panel scrolls', g.open && near(g.pop.top, g.chip.bottom + 6), g);
  await page.evaluate(() => { document.getElementById('panel').scrollTop = 200; });
  await settle();
  ok('it closes when the chip scrolls out of sight', (await geo('panel')).open === false);
  await page.evaluate(() => { document.getElementById('panel').scrollTop = 0; });

  // Choosing, Escape, outside click, tabbing out.
  await page.click(chipOf('panel'));
  await page.click(popOf('panel') + ' .kse-chip[aria-label="Blue"]');
  ok('a click on a colour lands', await page.inputValue('#t') === 'color: #2563eb;', await page.inputValue('#t'));
  ok('and closes it', (await geo('panel')).open === false);
  await page.click(chipOf('panel'));
  await page.keyboard.press('ArrowRight');
  ok('arrow keys move around the grid', await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Violet');
  await page.keyboard.press('Escape');
  ok('Escape closes it', (await geo('panel')).open === false);
  ok('and returns focus to the chip', await page.evaluate((s) => document.activeElement === document.querySelector(s), chipOf('panel')));
  await page.click(chipOf('panel'));
  await page.click('#outside');
  ok('a click outside closes it', (await geo('panel')).open === false);
  await page.click(chipOf('panel'));
  await page.focus(popOf('panel') + ' .kse-palette-btn:last-child');
  await page.keyboard.press('Tab');
  ok('tabbing out closes it', (await geo('panel')).open === false);
  await page.click(chipOf('panel'));
  await page.click(popOf('panel') + ' .kse-palette-btn:last-child');
  ok('its Default button still unsets', await page.inputValue('#t') === '');

  // Under a transformed ancestor, and themed like its editor.
  await open('moved');
  g = await geo('moved');
  ok('under a transformed ancestor it is still at the chip', near(g.pop.top, g.chip.bottom + 6) && near(g.pop.left, g.chip.left), g);
  ok('it keeps its editor\'s dark theme', g.bg === 'rgb(22, 26, 32)', g.bg);
  await page.keyboard.press('Escape');

  // Near the right edge: shifted in, 8px from it.
  await open('right');
  g = await geo('right');
  ok('near the right edge it is shifted inside, 8px from it', near(g.pop.right, g.vw - 8) && g.pop.left < g.chip.left, g);
  await page.keyboard.press('Escape');

  // Near the bottom: above the chip.
  await open('low');
  g = await geo('low');
  ok('near the bottom it opens above', g.up && near(g.pop.bottom, g.chip.top - 6) && g.onScreen, g);
  await page.keyboard.press('Escape');

  // No room either way: capped to the larger side, scrolling.
  await page.setViewportSize({ width: 1280, height: 230 });
  await settle();
  await page.evaluate(() => { document.getElementById('low').style.setProperty('bottom', '40px'); });
  await open('low');
  g = await geo('low');
  ok('with room on neither side it is capped and scrolls', g.open && g.scrolls && g.onScreen, g);
  ok('and its scrollbar covers no colours', g.columns, g);
  await snap('palette-float-capped-' + name);

  // A resize re-places it.
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle();
  g = await geo('low');
  ok('a resize re-places it', g.open && !g.scrolls && g.onScreen, g);

  // destroy() with it open.
  await page.evaluate(() => { [panel, moved, right, low].forEach(function (e) { e.destroy(); }); });
  await page.mouse.click(5, 790);
  ok('destroy() leaves no palette behind', await page.evaluate(() =>
    document.querySelectorAll('.kse-palette').length === 0 && document.body.children.length === bodyCount));

  await settle();
  const fromUse = await phase('use');
  ok('no CSP violation from opening, placing or closing it', fromUse.length === 0, fromUse);
  const fromBuild = await phase('build');
  const selects = await page.evaluate(() => window.selects);
  ok('building costs nothing beyond the engine\'s own per <select>', fromBuild.length === perSelect * selects,
    { violations: fromBuild.length, perSelect: perSelect, selects: selects });
  // Each violation also logs a console error in WebKit; only others count.
  const own = errors.filter((e) => !/Content Security Policy|Content-Security-Policy/i.test(e));
  ok('no other console errors', own.length === 0, own);
  await browser.close();
}

// A browser without popover: the palette is position: fixed instead. It
// still leaves a scrolling panel alone, and is still placed at the chip under
// a transformed ancestor (which makes itself the fixed palette's frame), though
// that ancestor's own overflow then clips it.
async function fallback(srv, c) {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = watchErrors(page, []);
  await page.addInitScript(() => { delete HTMLElement.prototype.showPopover; });
  await page.route('**/palette-float.css', (route) => route.fulfill({ contentType: 'text/css', body: SHEET }));
  await page.goto(srv.url + scratch.url('palette-float.html'));
  const r = await page.evaluate(() => {
    var one = { basic: ['color'], advanced: false, code: false };
    window.panel = KStyleEditor.attach('#t', {});
    window.moved = KStyleEditor.attach('#u', one);
    var before = document.getElementById('panel').scrollHeight;
    function geo(box) {
      document.querySelector('#' + box + ' .kse-swatch').click();
      var chip = document.querySelector('#' + box + ' .kse-swatch').getBoundingClientRect();
      var pop = document.querySelector('#' + box + ' .kse-palette');
      var p = pop.getBoundingClientRect();
      var hit = document.elementFromPoint(p.right - 4, p.bottom - 4);
      return { popover: pop.hasAttribute('popover'), dx: p.left - chip.left, dy: p.top - chip.bottom, painted: !!hit && pop.contains(hit) };
    }
    var out = { panel: geo('panel') };
    out.grew = document.getElementById('panel').scrollHeight - before;
    out.moved = geo('moved');
    return out;
  });
  const at = (g) => Math.abs(g.dx) <= 1 && Math.abs(g.dy - 6) <= 1;
  c.ok('fallback: without popover the palette is fixed', !r.panel.popover, r);
  c.ok('fallback: it floats over a scrolling panel without growing it', at(r.panel) && r.panel.painted && r.grew === 0, r);
  c.ok('fallback: under a transformed ancestor it is still at the chip', at(r.moved), r);
  c.ok('fallback: no console errors', errors.length === 0, errors);
  await browser.close();
}

(async function () {
  scratch('palette-float.html', PAGE);
  const srv = await serve();
  const c = checker();
  for (const name of ['chromium', 'webkit', 'firefox']) await check(name, srv, c);
  await fallback(srv, c);
  c.finish();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
