/*!
 * The element preview under a strict Content-Security-Policy.
 *
 * The page is served with `style-src 'self'` and no 'unsafe-inline', which
 * refuses every write to a style attribute (setAttribute('style', …)) but not
 * the CSSOM (style.cssText, style.setProperty). The preview must apply,
 * restore, and leave each element exactly as found without one violation.
 *
 * Run in Chromium, WebKit and Firefox: the lazy attribute sync this guards
 * against is in Chromium and WebKit, and the engines differ in what they show
 * for an attribute the policy blocked. An engine Playwright has not installed
 * is skipped, and says so.
 *
 * Playwright's WebKit reports one style-src-attr violation for every <select>
 * it renders, even a plain one in static markup: its own menu-list internals,
 * not anything a page writes. So each engine's count for one bare <select> is
 * measured first, building an editor may cost exactly that per <select> and
 * nothing more, and the preview itself must cost nothing in any engine.
 */
'use strict';

const playwright = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness');

const CSP = "style-src 'self'";

// No inline <style> (the policy would refuse it): the page stylesheet is
// served beside the page, through the route below.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script>
  window.phase = 'page';
  window.violations = [];
  document.addEventListener('securitypolicyviolation', function (e) {
    window.violations.push({ phase: window.phase, directive: e.violatedDirective, sample: e.sample, at: e.sourceFile + ':' + e.lineNumber + ':' + e.columnNumber });
  });
</script>
<link rel="stylesheet" href="src/k-style-editor.css">
<link rel="stylesheet" href="tests/browser/.scratch/preview-csp.css"></head><body>
<p id="bare">No style attribute</p>
<p id="scripted">Inline style set by script</p>
<p id="blocked" style="margin-top: 5px">Inline style in the markup, which the policy blocks</p>
<p id="last">Destroyed in place</p>
<textarea id="t">color: rgb(200, 0, 0);
padding: 10px;</textarea>
<textarea id="u">color: rgb(0, 128, 0);</textarea>
<textarea id="v">color: rgb(0, 0, 200);</textarea>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>
  // The CSSOM is how a page under this policy gets an inline style at all.
  document.getElementById('scripted').style.cssText = 'margin-top: 7px; padding-top: 3px';
</script></body></html>`;

const SHEET = 'p { color: rgb(1, 2, 3); margin-top: 16px; padding-top: 0px; }';

async function check(name, srv, c) {
  let browser;
  try { browser = await playwright[name].launch(); } catch (e) {
    console.log('SKIP ' + name + ': ' + String(e.message).split('\n')[0]);
    return;
  }
  const page = await browser.newPage();
  const errors = watchErrors(page, []);
  await page.route('**/preview-csp.html', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: Object.assign({}, res.headers(), { 'content-security-policy': CSP }) });
  });
  await page.route('**/preview-csp.css', (route) => route.fulfill({ contentType: 'text/css', body: SHEET }));
  await page.goto(srv.url + scratch.url('preview-csp.html'));
  // Let the page's own violation (the blocked markup) be reported first.
  await page.waitForTimeout(100);

  const ok = (label, cond, detail) => c.ok(name + ': ' + label, cond, detail);
  const cs = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
  const attr = (sel) => page.evaluate((s) => document.querySelector(s).getAttribute('style'), sel);

  ok('the policy is in force (the markup style attribute was refused)', await page.evaluate(() =>
    violations.some(function (v) { return v.phase === 'page'; })) && await cs('#blocked', 'marginTop') === '16px');

  const found = {
    scripted: await attr('#scripted'),
    blocked: await attr('#blocked')
  };

  // What one bare <select> costs in this engine.
  await page.evaluate(() => {
    window.phase = 'select';
    var s = document.createElement('select');
    s.appendChild(document.createElement('option'));
    document.body.appendChild(s);
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.querySelector('body > select').remove(); });
  const phase = (p) => page.evaluate((x) => violations.filter(function (v) { return v.phase === x; }), p);
  const perSelect = (await phase('select')).length;

  // Building an editor (which also applies its first preview).
  const build = async (fn) => {
    await page.evaluate(() => { window.phase = 'build'; });
    await page.evaluate(fn);
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.phase = 'preview'; });
  };
  await page.evaluate(() => { window.selects = 0; });
  await build(() => {
    window.ed = KStyleEditor.attach('#t', { preview: '#bare' });
    window.box = KStyleEditor.attach('#u', { preview: true, previewContent: 'Hello' });
    window.selects += ed.root.querySelectorAll('select').length + box.root.querySelectorAll('select').length;
  });

  ok('element is styled at attach', await cs('#bare', 'color') === 'rgb(200, 0, 0)');
  ok('a shorthand is applied', await cs('#bare', 'paddingTop') === '10px');
  ok('built-in preview is styled', await cs('.kse-preview-target', 'color') === 'rgb(0, 128, 0)');

  await page.evaluate(() => { ed.set('padding', ''); });
  ok('removing a declaration removes it', await cs('#bare', 'paddingTop') === '0px');
  await page.evaluate(() => { ed.set('color', 'rgb(0, 0, 255)'); });
  ok('a changed value is applied', await cs('#bare', 'color') === 'rgb(0, 0, 255)');

  await page.evaluate(() => { ed.setPreview('#scripted'); });
  ok('setPreview leaves an element that had no style attribute without one', await page.evaluate(() =>
    !document.getElementById('bare').hasAttribute('style')));
  ok('setPreview restores the old element\'s look', await cs('#bare', 'color') === 'rgb(1, 2, 3)');
  ok('setPreview styles the new element', await cs('#scripted', 'color') === 'rgb(0, 0, 255)');
  ok('its own inline style is kept', await cs('#scripted', 'marginTop') === '7px' && await cs('#scripted', 'paddingTop') === '3px');
  await page.evaluate(() => { ed.set('padding', '12px'); });
  ok('a shorthand applies over its own inline longhand', await cs('#scripted', 'paddingTop') === '12px');
  await page.evaluate(() => { ed.set('padding', ''); });
  ok('removing it restores the inline value', await cs('#scripted', 'paddingTop') === '3px');

  await page.evaluate(() => { ed.setPreview('#blocked'); });
  ok('the scripted element gets back its exact style attribute', await attr('#scripted') === found.scripted,
    [await attr('#scripted'), found.scripted]);
  ok('and looks as it did', await cs('#scripted', 'color') === 'rgb(1, 2, 3)' && await cs('#scripted', 'marginTop') === '7px');
  ok('a blocked element is styled too', await cs('#blocked', 'color') === 'rgb(0, 0, 255)');
  ok('its blocked inline style stays unapplied', await cs('#blocked', 'marginTop') === '16px');

  await page.evaluate(() => { ed.destroy(); });
  ok('destroy restores the blocked element\'s look', await cs('#blocked', 'color') === 'rgb(1, 2, 3)' &&
    await cs('#blocked', 'marginTop') === '16px');
  // Its attribute text applied nothing, and writing it back would be refused
  // again, so the CSSOM's spelling of "nothing" is what is left.
  ok('the blocked element keeps a style attribute', await attr('#blocked') !== null, [await attr('#blocked'), found.blocked]);

  await build(() => {
    window.last = KStyleEditor.attach('#v', { preview: '#last' });
    window.selects += last.root.querySelectorAll('select').length;
  });
  ok('a second editor styles its element', await cs('#last', 'color') === 'rgb(0, 0, 200)');
  await page.evaluate(() => { last.set('color', 'rgb(9, 9, 9)'); last.destroy(); box.destroy(); });
  // Checked after a task too: the attribute sync this guards against is lazy.
  await page.waitForTimeout(50);
  ok('destroy leaves an element with no style attribute without one', await page.evaluate(() =>
    !document.getElementById('last').hasAttribute('style') && document.getElementById('last').outerHTML.indexOf('style') === -1));
  ok('and looks as it did', await cs('#last', 'color') === 'rgb(1, 2, 3)');

  await page.waitForTimeout(100);
  const fromPreview = await phase('preview');
  ok('no CSP violation from the preview, its restore or destroy', fromPreview.length === 0, fromPreview);
  const fromBuild = await phase('build');
  const selects = await page.evaluate(() => window.selects);
  ok('no CSP violation from building the editor beyond the engine\'s own per <select>',
    fromBuild.length === perSelect * selects, { violations: fromBuild.length, perSelect: perSelect, selects: selects });
  if (perSelect) console.log('NOTE ' + name + ' reports ' + perSelect + ' violation per <select> on its own (' + selects + ' built)');

  // A refused style attribute logs a console error in Chromium; that page's
  // own one is expected, so only the editor's would count.
  const own = errors.filter((e) => !/Content Security Policy|Content-Security-Policy/i.test(e));
  ok('no other console errors', own.length === 0, own);

  await browser.close();
}

(async function () {
  scratch('preview-csp.html', PAGE);
  const srv = await serve();
  const c = checker();
  for (const name of ['chromium', 'webkit', 'firefox']) await check(name, srv, c);
  c.finish();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
