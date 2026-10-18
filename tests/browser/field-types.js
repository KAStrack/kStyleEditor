/*!
 * Every field type, driven through its real inputs, judged by what is saved.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, shot, checker, watchErrors } = require('./harness');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-style-editor.css"></head><body style="max-width:760px">
<textarea id="t"></textarea>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>
  window.ed = KStyleEditor.attach('#t', { startTab: 'advanced', openSetSections: false });
  document.querySelectorAll('.kse-section').forEach(function (d) { d.open = true; });
</script></body></html>`;

(async function () {
  scratch('fields.html', PAGE);
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = watchErrors(page, []);
  const c = checker();
  await page.goto(srv.url + scratch.url('fields.html'));
  const css = () => page.inputValue('#t');
  const reset = () => page.evaluate(() => ed.clear());
  const ctl = (id) => '.kse-panel--advanced [data-control=' + id + ']';
  const basic = (id) => '.kse-panel--basic [data-control=' + id + ']';

  // Control ids that match interface strings (filter, inset, width) keep their titles.
  c.ok('control titles do not collide with interface labels', await page.evaluate(() =>
    ['filter:Filter', 'inset:Offsets', 'width:Width'].every(function (pair) {
      var p = pair.split(':');
      return document.querySelector('[data-control=' + p[0] + '] .kse-control-label').textContent === p[1];
    })));

  // length: number + unit, keyword, arrow keys
  await page.fill(ctl('letterSpacing') + ' .kse-num', '2');
  c.ok('length writes number + unit', await css() === 'letter-spacing: 2px;', await css());
  await page.selectOption(ctl('letterSpacing') + ' .kse-unit', 'em');
  c.ok('changing the unit rewrites', await css() === 'letter-spacing: 2em;', await css());
  await page.press(ctl('letterSpacing') + ' .kse-num', 'ArrowUp');
  c.ok('ArrowUp steps em by 0.1', await css() === 'letter-spacing: 2.1em;', await css());
  await page.selectOption(ctl('letterSpacing') + ' .kse-unit', 'normal');
  c.ok('a keyword replaces the number', await css() === 'letter-spacing: normal;', await css());
  await reset();

  // unitless length
  await page.fill(ctl('lineHeight') + ' .kse-num', '1.5');
  c.ok('line-height defaults unitless', await css() === 'line-height: 1.5;', await css());
  await reset();

  // select
  await page.selectOption(ctl('textAlign') + ' select', 'center');
  c.ok('select writes', await css() === 'text-align: center;');
  await page.selectOption(ctl('textAlign') + ' select', '');
  c.ok('Default removes', await css() === '');

  // select with custom value
  await page.evaluate(() => ed.setCss('cursor: url(hand.png), pointer'));
  c.ok('an unknown select value shows as raw text', await page.evaluate(() =>
    document.querySelector('[data-control=cursor] .kse-field').getAttribute('data-raw') === 'true'));
  await page.fill(ctl('cursor') + ' .kse-raw', 'help');
  c.ok('raw text writes', await css() === 'cursor: help;');
  await page.locator(ctl('cursor') + ' .kse-raw').blur();
  c.ok('a known value returns to the select', await page.evaluate(() =>
    !document.querySelector('[data-control=cursor] .kse-field').hasAttribute('data-raw') &&
    document.querySelector('[data-control=cursor] select').value === 'help'));
  await reset();

  // box: linked writes a single value; unlinked writes a minimal shorthand
  await page.evaluate(() => ed.setTab('basic'));
  await page.fill(basic('padding') + ' .kse-box-all .kse-num', '8');
  c.ok('linked box writes one value', await css() === 'padding: 8px;', await css());
  await page.click(basic('padding') + ' .kse-link');
  await page.fill(basic('padding') + ' .kse-side--right .kse-num', '16');
  await page.fill(basic('padding') + ' .kse-side--left .kse-num', '16');
  c.ok('unlinked box minimises to two values', await css() === 'padding: 8px 16px;', await css());
  await page.fill(basic('padding') + ' .kse-side--bottom .kse-num', '');
  c.ok('a missing side writes longhands', await css() === 'padding-top: 8px;\npadding-right: 16px;\npadding-left: 16px;', await css());
  await reset();
  await page.evaluate(() => ed.setCss('margin: 0 auto'));
  c.ok('box reads a shorthand with a keyword', await page.evaluate(() => {
    var r = document.querySelector('[data-control=margin] .kse-side--right .kse-unit');
    return r.value === 'auto';
  }));
  await page.evaluate(() => ed.setCss('padding: calc(1em + 2px)'));
  c.ok('box shows calc() as raw text', await page.evaluate(() =>
    document.querySelector('.kse-panel--basic [data-control=padding] .kse-field').getAttribute('data-raw') === 'true' &&
    document.querySelector('.kse-panel--basic [data-control=padding] .kse-raw').value === 'calc(1em + 2px)'));
  c.ok('calc() is saved untouched', await css() === 'padding: calc(1em + 2px);');
  await reset();
  c.ok('clearing returns the box to its inputs', await page.evaluate(() =>
    !document.querySelector('.kse-panel--basic [data-control=padding] .kse-field').hasAttribute('data-raw')));
  await page.evaluate(() => ed.setTab('advanced'));

  // border-radius corners
  await page.evaluate(() => ed.setCss('border-radius: 10px 5px'));
  c.ok('corners read the shorthand', await page.evaluate(() =>
    document.querySelector('[data-control=borderRadius] .kse-side--bottom-right .kse-num').value === '10' &&
    document.querySelector('[data-control=borderRadius] .kse-side--bottom-left .kse-num').value === '5'));
  await reset();

  // stroke: width + colour pick solid automatically; sides
  await page.fill(ctl('border') + ' .kse-num', '2');
  c.ok('border picks solid when given a width', await css() === 'border: 2px solid;', await css());
  await page.fill(ctl('border') + ' .kse-colour-text', 'red');
  c.ok('border adds a colour', await css() === 'border: 2px solid red;', await css());
  await page.click(ctl('border') + ' .kse-seg-btn[data-side=bottom]');
  c.ok('switching side shows that side empty', await page.inputValue(ctl('border') + ' .kse-num') === '');
  await page.fill(ctl('border') + ' .kse-num', '4');
  c.ok('a side writes its own property', await css() === 'border: 2px solid red;\nborder-bottom: 4px solid;', await css());
  c.ok('the side is marked as set', await page.evaluate(() =>
    document.querySelector('[data-control=border] .kse-seg-btn[data-side=bottom]').getAttribute('data-set') === 'true'));
  await reset();
  await page.evaluate(() => ed.setCss('border: rgb(0, 0, 0) dotted 1px'));
  c.ok('border tokens in any order', await page.evaluate(() =>
    document.querySelector('[data-control=border] select.kse-select').value === 'dotted' &&
    document.querySelector('[data-control=border] .kse-colour-text').value === 'rgb(0, 0, 0)'));
  await reset();

  // shadow
  await page.fill(ctl('boxShadow') + ' .kse-sub:nth-child(2) .kse-num', '4');
  c.ok('shadow fills missing x with 0', await css() === 'box-shadow: 0 4px;', await css());
  await page.fill(ctl('boxShadow') + ' .kse-colour-text', 'rgba(0, 0, 0, 0.2)');
  await page.check(ctl('boxShadow') + ' .kse-check input');
  c.ok('shadow colour and inset', await css() === 'box-shadow: inset 0 4px rgba(0, 0, 0, 0.2);', await css());
  await page.evaluate(() => ed.setCss('box-shadow: 0 1px red, 0 2px blue'));
  c.ok('two shadows go raw', await page.evaluate(() =>
    document.querySelector('[data-control=boxShadow] .kse-field').getAttribute('data-raw') === 'true'));
  await reset();

  // functions
  await page.fill(ctl('transform') + ' .kse-sub:nth-child(3) .kse-num', '45');
  await page.fill(ctl('transform') + ' .kse-sub:nth-child(4) .kse-num', '1.5');
  c.ok('transform writes in order', await css() === 'transform: rotate(45deg) scale(1.5);', await css());
  await page.evaluate(() => ed.setCss('transform: scale(2) rotate(10deg)'));
  c.ok('a reordered transform goes raw', await page.evaluate(() =>
    document.querySelector('[data-control=transform] .kse-field').getAttribute('data-raw') === 'true'));
  await page.evaluate(() => ed.setCss('filter: blur(2px) hue-rotate(90deg)'));
  c.ok('filter reads hyphenated functions', await page.evaluate(() =>
    document.querySelector('[data-control=filter] .kse-field').getAttribute('data-raw') !== 'true'));
  await reset();

  // image
  await page.selectOption(ctl('backgroundImage') + ' select.kse-select', 'linear');
  await page.fill(ctl('backgroundImage') + ' .kse-only-linear .kse-num', '90');
  await page.fill(ctl('backgroundImage') + ' .kse-only-gradient >> nth=0 >> .kse-colour-text', 'red');
  await page.fill(ctl('backgroundImage') + ' .kse-only-gradient >> nth=1 >> .kse-colour-text', 'blue');
  c.ok('linear gradient', await css() === 'background-image: linear-gradient(90deg, red, blue);', await css());
  await page.selectOption(ctl('backgroundImage') + ' select.kse-select', 'url');
  await page.fill(ctl('backgroundImage') + ' .kse-url', 'https://example.com/a"b.png');
  c.ok('image url is quoted and escaped', await css() === 'background-image: url("https://example.com/a%22b.png");', await css());
  await reset();

  // range
  await page.fill(ctl('opacity') + ' .kse-num', '0.5');
  c.ok('opacity', await css() === 'opacity: 0.5;');
  await reset();

  // colour picker sets text
  await page.evaluate(() => ed.setTab('basic'));
  await page.locator(basic('color') + ' .kse-picker').evaluate((i) => {
    i.value = '#ff0000';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  c.ok('colour picker writes hex', await css() === 'color: #ff0000;');
  await reset();

  // !important survives a control rewrite
  await page.evaluate(() => ed.setCss('color: red !important'));
  await page.fill(basic('color') + ' .kse-colour-text', 'blue');
  c.ok('!important survives an edit', await css() === 'color: blue !important;', await css());
  await reset();

  // filter box
  await page.evaluate(() => ed.setTab('advanced'));
  await page.fill('.kse-filter', 'shadow');
  c.ok('filter finds shadow controls', await page.evaluate(() => {
    var shown = Array.prototype.filter.call(document.querySelectorAll('.kse-panel--advanced .kse-control'), (r) => !r.hidden);
    return shown.length === 2;
  }));
  await page.fill('.kse-filter', 'zzzz');
  c.ok('no matches message', await page.isVisible('.kse-empty'));
  await page.fill('.kse-filter', '');

  // Nothing in the editor overflows it
  c.ok('nothing overflows the editor', await page.evaluate(() => {
    var root = document.querySelector('.kse').getBoundingClientRect();
    return Array.prototype.every.call(document.querySelectorAll('.kse input, .kse select, .kse button'), function (n) {
      var r = n.getBoundingClientRect();
      return r.width === 0 || (r.right <= root.right + 0.5 && r.left >= root.left - 0.5);
    });
  }));
  await page.screenshot({ path: shot('field-types'), fullPage: true });

  c.finish(errors);
  await browser.close();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
