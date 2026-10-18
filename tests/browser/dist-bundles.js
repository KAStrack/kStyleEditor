/*!
 * The built files work on their own: the two-file bundle in a browser, and
 * the minified sanitiser and bundle under Node's require().
 */
'use strict';

const path = require('path');
const { chromium } = require('playwright');
const { ROOT, serve, scratch, checker, watchErrors } = require('./harness');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="dist/k-style.min.css"></head><body>
<textarea id="t">color: red</textarea>
<script src="dist/k-style.min.js"></script>
<script>window.ed = KStyleEditor.attach('#t', { preview: true });</script>
</body></html>`;

(async function () {
  const c = checker();

  const css = require(path.join(ROOT, 'dist', 'k-style-css.min.js'));
  c.ok('minified sanitiser under require()', css.sanitize('color: red; behavior: url(x)') === 'color: red;');
  const bundle = require(path.join(ROOT, 'dist', 'k-style.min.js'));
  c.ok('bundle exports both', !!(bundle.KStyleCss && bundle.KStyleEditor && bundle.KStyleEditor.css === bundle.KStyleCss));

  scratch('bundle.html', PAGE);
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = watchErrors(page, []);
  await page.goto(srv.url + scratch.url('bundle.html'));
  c.ok('bundle sets both globals', await page.evaluate(() => !!(window.KStyleCss && window.KStyleEditor)));
  c.ok('bundle editor works', await page.evaluate(() => ed.getCss() === 'color: red;' &&
    getComputedStyle(ed.root.querySelector('.kse-preview-target')).color === 'rgb(255, 0, 0)'));
  c.ok('bundle stylesheet applies', await page.evaluate(() => getComputedStyle(ed.root).borderTopStyle === 'solid'));

  c.finish(errors);
  await browser.close();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
