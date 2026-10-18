/*!
 * The live preview: the built-in box, and a real element that must be left
 * exactly as it was found.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-style-editor.css">
<style>#el { color: rgb(1, 2, 3); }</style></head><body>
<p id="el" style="margin-top: 7px; padding-top: 3px">Target</p>
<p id="other">Other</p>
<textarea id="t">color: rgb(200, 0, 0);
padding: 10px;</textarea>
<textarea id="u">color: rgb(0, 128, 0);</textarea>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>
  window.ed = KStyleEditor.attach('#t', { preview: '#el' });
  window.box = KStyleEditor.attach('#u', { preview: true, previewContent: 'Hello' });
</script></body></html>`;

(async function () {
  scratch('preview.html', PAGE);
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = watchErrors(page, []);
  const c = checker();
  await page.goto(srv.url + scratch.url('preview.html'));
  const cs = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);

  c.ok('element is styled at attach', await cs('#el', 'color') === 'rgb(200, 0, 0)');
  c.ok('shorthand applied over its own inline longhand', await cs('#el', 'paddingTop') === '10px');
  c.ok('its own unrelated inline style is kept', await cs('#el', 'marginTop') === '7px');

  await page.evaluate(() => { ed.set('padding', ''); });
  c.ok('removing a declaration restores the original inline value', await cs('#el', 'paddingTop') === '3px');
  await page.evaluate(() => { ed.set('color', ''); });
  c.ok('removing colour falls back to the page stylesheet', await cs('#el', 'color') === 'rgb(1, 2, 3)');

  await page.evaluate(() => { ed.set('color', 'rgb(0, 0, 255)').setPreview('#other'); });
  c.ok('setPreview moves the styles', await cs('#other', 'color') === 'rgb(0, 0, 255)');
  c.ok('setPreview restores the old element', await page.evaluate(() =>
    document.getElementById('el').getAttribute('style') === 'margin-top: 7px; padding-top: 3px'));

  await page.evaluate(() => { ed.destroy(); });
  c.ok('destroy leaves an element with no style attribute without one', await page.evaluate(() =>
    !document.getElementById('other').hasAttribute('style')));

  c.ok('built-in preview shows the content', await page.evaluate(() =>
    box.root.querySelector('.kse-preview-target').textContent === 'Hello'));
  c.ok('built-in preview is styled', await cs('.kse-preview-target', 'color') === 'rgb(0, 128, 0)');
  c.ok('built-in preview sits above the tabs', await page.evaluate(() =>
    box.root.firstElementChild.classList.contains('kse-preview')));

  c.finish(errors);
  await browser.close();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
