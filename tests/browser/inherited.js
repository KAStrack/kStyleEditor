/*!
 * The `inherited` option: what an unset field shows, and that none of it is
 * ever saved. Then the same under a strict CSP in every engine, since the
 * inherited chip colour must go through the CSSOM like everything else.
 */
'use strict';

const playwright = require('playwright');
const { serve, scratch, shot, checker, watchErrors } = require('./harness');

const SETUP = `
  window.controls = [
    { id: 'tokColour', label: 'Primary colour', fields: [{ type: 'color', prop: '--x-colour' }] },
    { id: 'tokSize', label: 'Text size', fields: [{ type: 'length', prop: '--x-size', units: ['px', 'rem', 'em'] }] },
    { id: 'tokWeight', label: 'Label weight', fields: [{ type: 'select', prop: '--x-weight',
      options: [['400', '400 Normal'], ['600', '600 Semi-bold'], ['700', '700 Bold']] }] },
    { id: 'tokGap', label: 'Gap', fields: [{ type: 'length', prop: '--x-gap', units: ['px'], keywords: ['auto'] }] },
    { id: 'tokFont', label: 'Font', fields: [{ type: 'font', prop: '--x-font' }] },
    { id: 'tokText', label: 'Shadow', fields: [{ type: 'text', prop: '--x-text' }] },
    { id: 'tokOpacity', label: 'Opacity', fields: [{ type: 'range', prop: '--x-opacity' }] },
    { id: 'tokPad', label: 'Padding', fields: [{ type: 'box', prop: 'padding' }] }
  ];
  window.opts = function (extra) {
    return Object.assign({
      controls: controls, basic: controls.map(function (c) { return c.id; }),
      advanced: false, code: false, strict: true, allow: ['--x-*']
    }, extra);
  };
  window.THEME = {
    '--x-colour': '#1f2933', '--x-size': '16px', '--x-weight': '600', '--x-gap': 'auto',
    '--x-font': "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", '--x-text': '0 1px 2px black',
    '--x-opacity': 0.8, padding: '4px 8px'
  };`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-style-editor.css"></head><body style="max-width:760px">
<textarea id="t"></textarea>
<textarea id="f"></textarea>
<textarea id="n">  --x-size:2px  </textarea>
<textarea id="plain"></textarea>
<textarea id="b"></textarea>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>${SETUP}
  window.changes = 0;
  document.getElementById('t').addEventListener('input', function () { changes++; });
  window.ed = KStyleEditor.attach('#t', opts({ inherited: THEME }));
  window.asked = [];
  window.fed = KStyleEditor.attach('#f', opts({ inherited: function (p) { asked.push(p); return THEME[p] || ''; } }));
  window.ned = KStyleEditor.attach('#n', opts({ inherited: THEME }));
  window.plain = KStyleEditor.attach('#plain', opts({}));
  window.bed = KStyleEditor.attach('#b', { basic: ['border', 'boxShadow', 'transform'], advanced: false, inherited: {
    border: '2px dashed #1f2933', 'box-shadow': '0 3px 6px rgba(0, 0, 0, 0.2)', transform: 'rotate(45deg)'
  } });
</script></body></html>`;

// The DOM, read for one editor: what each field shows.
function look(name) {
  var root = window[name].root;
  var q = function (id, sel) { return root.querySelector('[data-control=' + id + '] ' + sel); };
  var colour = q('tokColour', '.kse-colour');
  var text = q('tokColour', '.kse-colour-text');
  var described = text.getAttribute('aria-describedby');
  return {
    inherited: colour.getAttribute('data-inherited'),
    chip: colour.style.getPropertyValue('--kse-current'),
    ring: getComputedStyle(q('tokColour', '.kse-swatch')).borderTopStyle,
    colourPlaceholder: text.placeholder,
    colourValue: text.value,
    description: described ? document.getElementById(described).textContent : null,
    chipDescribed: q('tokColour', '.kse-swatch').getAttribute('aria-describedby') === described,
    clear: q('tokColour', '.kse-palette-btn:last-child').textContent,
    sizePlaceholder: q('tokSize', '.kse-num').placeholder,
    sizeValue: q('tokSize', '.kse-num').value,
    sizeUnit: q('tokSize', '.kse-unit').value,
    weight: q('tokWeight', 'select').options[0].textContent,
    weightValue: q('tokWeight', 'select').value,
    weightDescribed: !!q('tokWeight', 'select').getAttribute('aria-describedby'),
    gapPlaceholder: q('tokGap', '.kse-num').placeholder,
    font: q('tokFont', 'select').options[0].textContent,
    text: q('tokText', '.kse-text').placeholder,
    opacity: q('tokOpacity', '.kse-num').placeholder,
    slider: q('tokOpacity', '.kse-slider').value,
    padAll: q('tokPad', '.kse-box-all .kse-num').placeholder,
    padTop: q('tokPad', '.kse-side--top .kse-num').placeholder,
    padRight: q('tokPad', '.kse-side--right .kse-num').placeholder
  };
}

async function main(srv, c) {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  const errors = watchErrors(page, []);
  await page.goto(srv.url + scratch.url('inherited.html'));
  await page.addScriptTag({ content: look.toString() });
  const view = (name) => page.evaluate((n) => look(n), name || 'ed');
  const css = () => page.inputValue('#t');
  const field = (id, sel) => '#t + .kse [data-control=' + id + '] ' + sel;

  let v = await view();
  c.ok('the colour chip is drawn in the inherited colour', v.chip === '#1f2933', v.chip);
  c.ok('and marked data-inherited', v.inherited === 'true');
  c.ok('with a dashed ring', v.ring === 'dashed', v.ring);
  c.ok('the colour text box has it as its placeholder, and no value', v.colourPlaceholder === '#1f2933' && v.colourValue === '');
  c.ok('the inherited colour is described to screen readers', v.description === 'Inherited: #1f2933' && v.chipDescribed, v.description);
  c.ok('the palette offers "Use inherited (#1f2933)"', v.clear === 'Use inherited (#1f2933)', v.clear);
  c.ok('the length shows 16 / px as a placeholder', v.sizePlaceholder === '16' && v.sizeValue === '' && v.sizeUnit === 'px',
    [v.sizePlaceholder, v.sizeValue, v.sizeUnit]);
  c.ok('the select\'s empty option reads "Default (600 Semi-bold)"', v.weight === 'Default (600 Semi-bold)' && v.weightValue === '', v.weight);
  c.ok('and is described', v.weightDescribed);
  c.ok('an inherited keyword is the length placeholder', v.gapPlaceholder === 'auto', v.gapPlaceholder);
  c.ok('a font stack matches its option however it is spelt', v.font === 'Default (System)', v.font);
  c.ok('text and range show it as a placeholder', v.text === '0 1px 2px black' && v.opacity === '0.8', [v.text, v.opacity]);
  c.ok('the range thumb stays where it was', v.slider === '1', v.slider);
  c.ok('each box side shows its part', v.padTop === '4' && v.padRight === '8', [v.padTop, v.padRight]);
  c.ok('and All the shorthand', v.padAll === '4px 8px', v.padAll);
  c.ok('the textarea is still empty', await css() === '');
  c.ok('and was not written', await page.evaluate(() => changes) === 0);
  c.ok('nothing inherited reaches getCss, getDeclarations or get', await page.evaluate(() =>
    ed.getCss() === '' && ed.getDeclarations().length === 0 && ed.get('--x-colour') === ''));
  c.ok('an untouched textarea is not rewritten', await page.inputValue('#n') === '  --x-size:2px  ');
  c.ok('a set value shows instead of the inherited one', await page.evaluate(() =>
    ned.root.querySelector('[data-control=tokSize] .kse-num').value === '2'));
  await page.screenshot({ path: shot('inherited'), fullPage: true });

  // Colour: a value clears the marker; Use inherited brings it back.
  await page.fill(field('tokColour', '.kse-colour-text'), '#ff0000');
  v = await view();
  c.ok('a typed colour is saved', await css() === '--x-colour: #ff0000;', await css());
  c.ok('and clears the inherited marker', v.inherited === null && v.chip === '#ff0000', [v.inherited, v.chip]);
  await page.click(field('tokColour', '.kse-swatch'));
  await page.click(field('tokColour', '.kse-palette-btn:last-child'));
  v = await view();
  c.ok('Use inherited removes the declaration', await css() === '', await css());
  c.ok('and brings the marker back', v.inherited === 'true' && v.chip === '#1f2933' && v.colourValue === '');
  // Headless Chromium's real chooser reports a colour of its own when it
  // closes, so record where it would start instead (as colour-palette.js does).
  await page.evaluate(() => { HTMLInputElement.prototype.showPicker = function () { window.shown = this.value; }; });
  await page.evaluate(() => { document.querySelector('#t + .kse [data-control=tokColour] .kse-swatch').click(); });
  await page.evaluate(() => { document.querySelector('#t + .kse [data-control=tokColour] .kse-palette-btn').click(); });
  c.ok('the native picker starts from the inherited colour', await page.evaluate(() => window.shown) === '#1f2933');
  c.ok('opening the picker saves nothing', await css() === '');

  // Choosing the inherited value itself sets it explicitly.
  await page.selectOption(field('tokWeight', 'select'), '600');
  c.ok('picking the inherited option sets it', await css() === '--x-weight: 600;', await css());
  await page.selectOption(field('tokWeight', 'select'), '');
  c.ok('Default goes back to inheriting', await css() === '');

  // Length: a typed number keeps the inherited unit; arrows step from it.
  await page.fill(field('tokSize', '.kse-num'), '20');
  c.ok('a number typed over the placeholder takes the inherited unit', await css() === '--x-size: 20px;', await css());
  await page.fill(field('tokSize', '.kse-num'), '');
  c.ok('emptying it unsets it', await css() === '');
  await page.press(field('tokSize', '.kse-num'), 'ArrowUp');
  c.ok('ArrowUp in an empty box steps from the inherited number', await css() === '--x-size: 17px;', await css());
  await page.evaluate(() => ed.clear());
  await page.selectOption(field('tokSize', '.kse-unit'), 'em');
  c.ok('another unit shows the whole inherited value', (await view()).sizePlaceholder === '16px');

  // setInherited: new values everywhere, CSS untouched.
  await page.evaluate(() => { ed.set('--x-gap', '4px'); });
  const before = { css: await css(), changes: await page.evaluate(() => changes) };
  const chained = await page.evaluate(() => ed.setInherited({
    '--x-colour': '#2563eb', '--x-size': '1.25rem', '--x-weight': '700', '--x-font': 'Comic Sans MS'
  }) === ed);
  v = await view();
  c.ok('setInherited is chainable', chained);
  c.ok('setInherited redraws the colour', v.chip === '#2563eb' && v.colourPlaceholder === '#2563eb' &&
    v.clear === 'Use inherited (#2563eb)' && v.description === 'Inherited: #2563eb');
  c.ok('the length, in its own unit', v.sizePlaceholder === '1.25' && v.sizeUnit === 'rem', [v.sizePlaceholder, v.sizeUnit]);
  c.ok('the select', v.weight === 'Default (700 Bold)', v.weight);
  c.ok('an unknown font shows as written', v.font === 'Default (Comic Sans MS)', v.font);
  c.ok('a property it no longer names shows nothing', v.text === '' && v.opacity === '1' && v.padTop === '');
  c.ok('setInherited leaves the textarea alone', await css() === before.css && await page.evaluate(() => changes) === before.changes,
    [await css(), before.css]);

  await page.evaluate(() => { ed.setInherited(null); });
  v = await view();
  c.ok('setInherited(null) draws unset fields as before', v.inherited === null && v.colourPlaceholder === 'Default' &&
    v.clear === 'Default' && v.description === null && v.weight === 'Default' && v.sizePlaceholder === '' && !v.weightDescribed, v);

  // The function form.
  v = await view('fed');
  c.ok('a function works like the object', v.inherited === 'true' && v.chip === '#1f2933' && v.sizePlaceholder === '16' &&
    v.weight === 'Default (600 Semi-bold)', v);
  c.ok('it is asked about each property', await page.evaluate(() =>
    ['--x-colour', '--x-size', '--x-weight', 'padding', 'padding-top'].every(function (p) { return asked.indexOf(p) !== -1; })));
  c.ok('its textarea is still empty', await page.inputValue('#f') === '');

  // No inherited: the 0.1.1 look.
  v = await view('plain');
  c.ok('without inherited nothing changes', v.inherited === null && v.chip === 'transparent' && v.colourPlaceholder === 'Default' &&
    v.clear === 'Default' && v.description === null && v.weight === 'Default' && v.sizePlaceholder === '' &&
    v.gapPlaceholder === '' && v.text === '' && v.opacity === '1' && v.padTop === '', v);
  c.ok('and no description nodes are added', await page.evaluate(() =>
    plain.root.querySelectorAll('[aria-describedby]').length === 0));

  // Compound fields: each part shows its piece.
  const parts = await page.evaluate(() => {
    var q = function (id, sel) { return bed.root.querySelector('[data-control=' + id + '] ' + sel); };
    var subs = function (id) { return bed.root.querySelectorAll('[data-control=' + id + '] .kse-sub'); };
    return {
      width: q('border', '.kse-num').placeholder,
      style: q('border', 'select.kse-select').options[0].textContent,
      colour: q('border', '.kse-colour').getAttribute('data-inherited'),
      blur: subs('boxShadow')[2].querySelector('.kse-num').placeholder,
      shadowColour: q('boxShadow', '.kse-colour-text').placeholder,
      rotate: subs('transform')[2].querySelector('.kse-num').placeholder
    };
  });
  c.ok('a stroke shows width, style and colour', parts.width === '2' && parts.style === 'Default (dashed)' && parts.colour === 'true', parts);
  c.ok('a shadow shows its lengths and colour', parts.blur === '6' && parts.shadowColour === 'rgba(0, 0, 0, 0.2)', parts);
  c.ok('a function list shows each argument', parts.rotate === '45', parts);
  c.ok('and its textarea is still empty', await page.inputValue('#b') === '');

  c.ok('no console errors', errors.length === 0, errors);
  await browser.close();
}

const CSP_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script>
  window.phase = 'page';
  window.violations = [];
  document.addEventListener('securitypolicyviolation', function (e) {
    window.violations.push({ phase: window.phase, directive: e.violatedDirective, sample: e.sample });
  });
</script>
<link rel="stylesheet" href="src/k-style-editor.css"></head><body>
<textarea id="t"></textarea>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>${SETUP}</script></body></html>`;

async function csp(name, srv, c) {
  let browser;
  try { browser = await playwright[name].launch(); } catch (e) {
    console.log('SKIP ' + name + ': ' + String(e.message).split('\n')[0]);
    return;
  }
  const page = await browser.newPage();
  await page.route('**/inherited-csp.html', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: Object.assign({}, res.headers(), { 'content-security-policy': "style-src 'self'" }) });
  });
  await page.goto(srv.url + scratch.url('inherited-csp.html'));
  const ok = (label, cond, detail) => c.ok(name + ' CSP: ' + label, cond, detail);
  const phase = (p) => page.evaluate((x) => violations.filter(function (v) { return v.phase === x; }), p);
  const settle = () => page.waitForTimeout(100);

  // What one bare <select> costs in this engine (see preview-csp.js).
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
    window.ed = KStyleEditor.attach('#t', opts({ inherited: THEME }));
  });
  await settle();
  const selects = await page.evaluate(() => { window.phase = 'use'; return ed.root.querySelectorAll('select').length; });
  ok('the inherited chip colour applies', await page.evaluate(() =>
    getComputedStyle(ed.root.querySelector('.kse-colour')).getPropertyValue('--kse-current').trim() === '#1f2933'));
  await page.evaluate(() => {
    ed.set('--x-colour', '#ff0000');
    ed.set('--x-colour', '');
    ed.setInherited({ '--x-colour': '#2563eb', '--x-weight': '700' });
  });
  await settle();
  ok('setInherited applies the new colour', await page.evaluate(() =>
    getComputedStyle(ed.root.querySelector('.kse-colour')).getPropertyValue('--kse-current').trim() === '#2563eb'));
  const fromUse = await phase('use');
  ok('no violation from drawing, changing or replacing inherited values', fromUse.length === 0, fromUse);
  const fromBuild = await phase('build');
  ok('building costs nothing beyond the engine\'s own per <select>', fromBuild.length === perSelect * selects,
    { violations: fromBuild.length, perSelect: perSelect, selects: selects });
  await browser.close();
}

(async function () {
  scratch('inherited.html', PAGE);
  scratch('inherited-csp.html', CSP_PAGE);
  const srv = await serve();
  const c = checker();
  await main(srv, c);
  for (const name of ['chromium', 'webkit', 'firefox']) await csp(name, srv, c);
  c.finish();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
