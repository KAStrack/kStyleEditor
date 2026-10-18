/*!
 * The colour palette: a layperson's way to pick a colour. Opening, choosing,
 * closing, keyboard use, and the native picker never starting on black.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, shot, checker, watchErrors } = require('./harness');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-style-editor.css">
<style>#el { color: rgb(200, 0, 0); }</style></head><body style="max-width:700px;padding:16px">
<p id="el">Target</p>
<textarea id="t"></textarea>
<textarea id="u"></textarea>
<textarea id="v"></textarea>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>
  window.ed = KStyleEditor.attach('#t', { preview: '#el', advanced: false });
  window.plain = KStyleEditor.attach('#u', { basic: ['color'], advanced: false, code: false });
  window.brand = KStyleEditor.attach('#v', { basic: ['color'], advanced: false, code: false,
    swatches: [['#0f766e', 'Brand teal'], '#111111'] });
</script></body></html>`;

(async function () {
  scratch('palette.html', PAGE);
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = watchErrors(page, []);
  const c = checker();
  await page.goto(srv.url + scratch.url('palette.html'));
  const chip = '#t + .kse [data-control=color] .kse-swatch';
  const pop = '#t + .kse [data-control=color] .kse-palette';

  c.ok('palette starts closed', await page.isHidden(pop));
  c.ok('chip says what it does', await page.getAttribute(chip, 'aria-haspopup') === 'dialog' &&
    /Choose a colour/.test(await page.getAttribute(chip, 'aria-label')));

  await page.click(chip);
  c.ok('clicking the chip opens the palette', await page.isVisible(pop));
  c.ok('aria-expanded follows', await page.getAttribute(chip, 'aria-expanded') === 'true');
  c.ok('24 named colours by default', await page.evaluate((s) =>
    Array.prototype.every.call(document.querySelectorAll(s + ' .kse-chip'), (b) => !!b.getAttribute('aria-label')) &&
    document.querySelectorAll(s + ' .kse-chip').length === 24, pop));
  c.ok('focus moves into the palette', await page.evaluate(() => document.activeElement.classList.contains('kse-chip')));
  await page.screenshot({ path: shot('colour-palette-open') });

  // The palette is not clipped by the editor.
  c.ok('palette is fully painted', await page.evaluate((s) => {
    var r = document.querySelector(s).getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.bottom - 4;
    var hit = document.elementFromPoint(x, y);
    return !!hit && !!hit.closest('.kse-palette');
  }, pop));

  // Choosing
  await page.click(pop + ' .kse-chip[aria-label="Blue"]');
  c.ok('choosing a colour writes it', await page.inputValue('#t') === 'color: #2563eb;', await page.inputValue('#t'));
  c.ok('and closes the palette', await page.isHidden(pop));
  c.ok('and returns focus to the chip', await page.evaluate((s) => document.activeElement === document.querySelector(s), chip));
  c.ok('the preview shows it', await page.evaluate(() => getComputedStyle(document.getElementById('el')).color) === 'rgb(37, 99, 235)');

  // The current colour is marked when reopened.
  await page.click(chip);
  c.ok('the current colour is marked', await page.getAttribute(pop + ' .kse-chip[aria-label="Blue"]', 'aria-pressed') === 'true');
  c.ok('and focused', await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Blue');

  // Keyboard
  await page.keyboard.press('ArrowRight');
  c.ok('ArrowRight moves along', await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Violet');
  await page.keyboard.press('ArrowDown');
  c.ok('ArrowDown moves a row', await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Light violet');
  await page.keyboard.press('Enter');
  c.ok('Enter chooses', await page.inputValue('#t') === 'color: #ede9fe;');
  await page.click(chip);
  await page.keyboard.press('Escape');
  c.ok('Escape closes', await page.isHidden(pop));
  c.ok('Escape returns focus', await page.evaluate((s) => document.activeElement === document.querySelector(s), chip));

  // Outside click, and only one open at a time
  await page.click(chip);
  await page.mouse.click(850, 850);
  c.ok('clicking outside closes', await page.isHidden(pop));
  await page.click(chip);
  await page.focus('#t + .kse [data-control=font] select');
  c.ok('tabbing away closes it', await page.isHidden(pop));
  await page.click(chip);
  await page.evaluate(() => document.querySelector('#t + .kse [data-control=background] .kse-swatch').click());
  c.ok('opening another closes the first', await page.isHidden(pop) &&
    await page.isVisible('#t + .kse [data-control=background] .kse-palette'));
  await page.keyboard.press('Escape');

  // Default clears
  await page.click(chip);
  await page.click(pop + ' .kse-palette-btn >> nth=1');
  c.ok('Default removes the colour', await page.inputValue('#t') === '');

  // The native picker never starts on black.
  await page.evaluate(() => { HTMLInputElement.prototype.showPicker = function () { window.shown = this.value; }; });
  await page.click(chip);
  await page.click(pop + ' .kse-palette-btn >> nth=0');
  c.ok('custom starts from what the preview shows', await page.evaluate(() => window.shown) === '#c80000',
    await page.evaluate(() => window.shown));
  await page.click('#u + .kse .kse-swatch');
  await page.click('#u + .kse .kse-palette-btn >> nth=0');
  c.ok('with no preview, custom starts on a friendly blue', await page.evaluate(() => window.shown) === '#3b82f6',
    await page.evaluate(() => window.shown));
  await page.evaluate(() => plain.set('color', 'rgb(10, 20, 30)'));
  await page.click('#u + .kse .kse-swatch');
  await page.click('#u + .kse .kse-palette-btn >> nth=0');
  c.ok('with a colour set, custom starts on it', await page.evaluate(() => window.shown) === '#0a141e');
  await page.evaluate(() => { ed.set('color', 'transparent'); });
  await page.click(chip);
  await page.click(pop + ' .kse-palette-btn >> nth=0');
  c.ok('transparent is not mistaken for black', await page.evaluate(() => window.shown) === '#3b82f6',
    await page.evaluate(() => window.shown));

  // A native picker change writes through.
  await page.locator('#u + .kse .kse-picker').evaluate((i) => {
    i.value = '#00ff00';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  c.ok('the native picker writes', await page.inputValue('#u') === 'color: #00ff00;');

  // Brand palette with names
  await page.click('#v + .kse .kse-swatch');
  c.ok('a custom palette replaces the default', await page.evaluate(() =>
    document.querySelectorAll('#v + .kse .kse-chip').length === 2 &&
    document.querySelector('#v + .kse .kse-chip').getAttribute('aria-label') === 'Brand teal'));
  await page.keyboard.press('Escape');

  // Near the bottom of the window it opens upwards.
  await page.setViewportSize({ width: 900, height: 420 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.click('#v + .kse .kse-swatch');
  c.ok('opens upwards when there is no room below', await page.evaluate(() => {
    var p = document.querySelector('#v + .kse .kse-palette');
    return p.getAttribute('data-up') === 'true' && p.getBoundingClientRect().bottom <= window.innerHeight;
  }));

  // Destroy with a palette open leaves no listeners behind.
  await page.evaluate(() => brand.destroy());
  await page.mouse.click(10, 10);
  c.ok('destroy with the palette open is clean', !(await page.evaluate(() => document.querySelector('#v + .kse'))));

  c.finish(errors);
  await browser.close();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
