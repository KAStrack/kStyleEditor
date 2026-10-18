/*!
 * The Code tab: typing CSS, keeping what no control understands, and the
 * strict and sanitize options.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-style-editor.css"></head><body>
<textarea id="a">content: "x";
color: red;
background: url(a.png);
-webkit-line-clamp: 2;</textarea>
<textarea id="b">color: red;
content: "x";
background-image: url(javascript:alert(1));</textarea>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>
  window.a = KStyleEditor.attach('#a', { startTab: 'code' });
  window.b = KStyleEditor.attach('#b', { startTab: 'code', strict: true, sanitize: true });
</script></body></html>`;

(async function () {
  scratch('code.html', PAGE);
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = watchErrors(page, []);
  const c = checker();
  await page.goto(srv.url + scratch.url('code.html'));
  const codeA = () => page.locator('.kse').nth(0).locator('.kse-code');
  const codeB = () => page.locator('.kse').nth(1).locator('.kse-code');

  c.ok('code tab shows the CSS', await codeA().inputValue() === 'content: "x";\ncolor: red;\nbackground: url(a.png);\n-webkit-line-clamp: 2;');

  // A control edit keeps unknown declarations where they were.
  await page.evaluate(() => a.setTab('basic'));
  await page.locator('.kse').nth(0).locator('[data-control=color] .kse-colour-text').fill('blue');
  c.ok('unknown declarations keep their places', await page.inputValue('#a') ===
    'content: "x";\ncolor: blue;\nbackground: url(a.png);\n-webkit-line-clamp: 2;', await page.inputValue('#a'));
  c.ok('the basic tab says how many are code-only', await page.evaluate(() =>
    !a.root.querySelector('.kse-panel--basic .kse-note').hidden &&
    /^3 /.test(a.root.querySelector('.kse-panel--basic .kse-note').textContent)));

  // Typing in Code updates the controls.
  await page.evaluate(() => a.setTab('code'));
  await codeA().fill('color: green;\npadding: 4px');
  await page.waitForTimeout(250);
  c.ok('typing in code saves', await page.inputValue('#a') === 'color: green;\npadding: 4px;', await page.inputValue('#a'));
  c.ok('typing in code refreshes controls', await page.evaluate(() =>
    a.root.querySelector('[data-control=color] .kse-colour-text').value === 'green'));
  c.ok('the typed text is not rewritten while typing', await codeA().inputValue() === 'color: green;\npadding: 4px');
  await codeA().blur();
  c.ok('leaving the code box tidies it', await codeA().inputValue() === 'color: green;\npadding: 4px;');

  // The server warnings
  await codeA().fill('color: red; behavior: url(x.htc)');
  await codeA().blur();
  c.ok('code tab warns what the SDK would drop', await page.evaluate(() =>
    /behavior/.test(a.root.querySelector('.kse-issues').textContent) && !a.root.querySelector('.kse-issues').hidden));
  c.ok('without sanitize it is still saved', (await page.inputValue('#a')).indexOf('behavior') !== -1);

  // strict + sanitize
  c.ok('strict and sanitize drop at load (once changed)', await page.evaluate(() => b.getCss()) === 'color: red;', await page.evaluate(() => b.getCss()));
  c.ok('the textarea is not rewritten until a change', (await page.inputValue('#b')).indexOf('content') !== -1);
  await codeB().fill('color: red; content: "y"; margin: 0');
  await codeB().blur();
  c.ok('strict saves only editable properties', await page.inputValue('#b') === 'color: red;\nmargin: 0;', await page.inputValue('#b'));
  c.ok('strict lists what it left out', await page.evaluate(() => /content/.test(b.root.querySelector('.kse-issues').textContent)));

  // Pasting a whole rule
  await codeA().fill('.thing { color: navy; }');
  await codeA().blur();
  c.ok('a pasted rule is unwrapped', await page.inputValue('#a') === 'color: navy;');

  c.finish(errors);
  await browser.close();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
