/*!
 * Attaching, the public API, events, and living inside a host form.
 */
'use strict';

const { chromium } = require('playwright');
const { serve, scratch, checker, watchErrors } = require('./harness');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="src/k-style-editor.css"></head><body>
<form id="f"><textarea id="t" name="css">COLOR: Red;
/* a comment */
content: "x" !important;
padding: 4px 8px</textarea></form>
<script src="src/k-style-css.js"></script><script src="src/k-style-editor.js"></script>
<script>
  window.submits = 0;
  window.events = [];
  document.getElementById('f').addEventListener('submit', function (e) { e.preventDefault(); window.submits++; });
  var t = document.getElementById('t');
  t.addEventListener('input', function () { window.events.push('input'); });
  t.addEventListener('change', function () { window.events.push('change'); });
  window.original = t.value;
  window.ed = KStyleEditor.attach('#t', { advanced: false });
  window.changes = [];
  ed.on('change', function (css, p) { window.changes.push(p.source); });
</script></body></html>`;

(async function () {
  scratch('attach.html', PAGE);
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = watchErrors(page, []);
  const c = checker();
  await page.goto(srv.url + scratch.url('attach.html'));

  c.ok('an untouched editor leaves the textarea alone',
    await page.evaluate(() => document.getElementById('t').value === window.original));
  c.ok('textarea hidden', await page.evaluate(() => getComputedStyle(document.getElementById('t')).display === 'none'));
  c.ok('handle on the element', await page.evaluate(() => document.getElementById('t').kStyleEditor === ed && KStyleEditor.get('#t') === ed));
  c.ok('getCss normalises', await page.evaluate(() => ed.getCss()) === 'color: Red;\ncontent: "x" !important;\npadding: 4px 8px;',
    await page.evaluate(() => ed.getCss()));
  c.ok('get reads a property', await page.evaluate(() => ed.get('padding')) === '4px 8px');

  // Every button must be type=button, or it would submit the host form.
  c.ok('no submit buttons', await page.evaluate(() =>
    Array.prototype.every.call(document.querySelectorAll('.kse button'), (b) => b.type === 'button')));

  // Typing in a field and pressing Enter must not submit.
  await page.fill('[data-control=color] .kse-colour-text', 'blue');
  await page.press('[data-control=color] .kse-colour-text', 'Enter');
  c.ok('Enter does not submit the form', await page.evaluate(() => window.submits) === 0);
  c.ok('control writes in place, keeps the rest', await page.inputValue('#t') ===
    'color: blue;\ncontent: "x" !important;\npadding: 4px 8px;', await page.inputValue('#t'));
  c.ok('native input and change events fired', await page.evaluate(() =>
    window.events.indexOf('input') !== -1 && window.events.indexOf('change') !== -1));
  c.ok('change event says control', await page.evaluate(() => window.changes[window.changes.length - 1]) === 'control');

  // A host form's constraint validation must not trip over the editor.
  await page.fill('[data-control=font] .kse-num', '1.25');
  c.ok('form stays valid with fractional numbers', await page.evaluate(() => document.getElementById('f').checkValidity()));

  await page.evaluate(() => ed.set('margin', '0 auto'));
  c.ok('set() adds at the end', (await page.inputValue('#t')).endsWith('margin: 0 auto;'));
  c.ok('set() refreshes the control', await page.evaluate(() =>
    document.querySelector('[data-control=margin] .kse-box').getAttribute('data-linked') === 'false'));
  await page.evaluate(() => ed.set('margin', ''));
  c.ok('set("") removes', (await page.inputValue('#t')).indexOf('margin') === -1);

  await page.evaluate(() => ed.setCss('.x { color: green; }'));
  c.ok('setCss unwraps a rule', await page.inputValue('#t') === 'color: green;');
  c.ok('setCss refreshes fields', await page.inputValue('[data-control=color] .kse-colour-text') === 'green');
  c.ok('change event says api', await page.evaluate(() => window.changes[window.changes.length - 1]) === 'api');

  await page.evaluate(() => ed.setSelector('#a .b'));
  c.ok('setSelector wraps', await page.inputValue('#t') === '#a .b {\n  color: green;\n}');
  await page.evaluate(() => ed.setSelector(null));

  await page.evaluate(() => { document.getElementById('t').value = 'color: purple;'; ed.sync(); });
  c.ok('sync re-reads the textarea', await page.inputValue('[data-control=color] .kse-colour-text') === 'purple');

  await page.evaluate(() => ed.clear());
  c.ok('clear empties', await page.inputValue('#t') === '');

  // Reset button on a set control
  await page.evaluate(() => ed.setCss('color: red; padding: 1px'));
  await page.click('[data-control=padding] .kse-reset');
  c.ok('reset clears only that control', await page.inputValue('#t') === 'color: red;', await page.inputValue('#t'));

  // A listener that throws does not stop the others.
  const logged = [];
  page.on('console', (m) => logged.push(m.type()));
  await page.evaluate(() => {
    window.after = false;
    ed.on('change', function () { throw new Error('listener boom'); });
    ed.on('change', function () { window.after = true; });
    ed.set('color', 'teal');
  });
  c.ok('a throwing listener does not stop the next', await page.evaluate(() => window.after));
  errors.splice(0, errors.length, ...errors.filter((e) => e.indexOf('listener boom') === -1));

  // Re-attach replaces; destroy is idempotent and restores the textarea.
  await page.evaluate(() => { window.ed2 = KStyleEditor.attach('#t', { code: false }); });
  c.ok('re-attach replaces the old editor', await page.evaluate(() => document.querySelectorAll('.kse').length === 1 && KStyleEditor.get('#t') === ed2));
  await page.evaluate(() => { ed2.destroy(); ed2.destroy(); });
  c.ok('destroy removes the editor', await page.evaluate(() => !document.querySelector('.kse') && !document.getElementById('t').kStyleEditor));
  c.ok('destroy shows the textarea', await page.evaluate(() => getComputedStyle(document.getElementById('t')).display !== 'none'));

  // attachAll with data attributes
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div><textarea data-k-style data-k-style-basic="color,padding" data-k-style-advanced="false" data-k-style-preview="#target" data-k-style-selector=".q">color: red</textarea>');
    window.all = KStyleEditor.attachAll();
  });
  c.ok('attachAll attaches', await page.evaluate(() => window.all.length === 1));
  c.ok('data attributes become options', await page.evaluate(() => {
    var root = all[0].root;
    return root.querySelectorAll('.kse-control').length === 2 && !root.querySelector('.kse-panel--advanced') &&
      all[0].getCss() === '.q {\n  color: red;\n}' && document.getElementById('target').style.color === 'red';
  }));

  // Labels: interface strings flat, control and field titles under controls.
  c.ok('labels override titles and strings', await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<textarea id="lab"></textarea>');
    var e = KStyleEditor.attach('#lab', { advanced: false, labels: { basic: 'Simple', controls: { color: 'Ink', 'font.size': 'Text size' } } });
    var ok = e.root.querySelector('.kse-tab').textContent === 'Simple' &&
      e.root.querySelector('[data-control=color] .kse-control-label').textContent === 'Ink' &&
      Array.prototype.some.call(e.root.querySelectorAll('[data-control=font] .kse-field-label'), function (l) { return l.textContent === 'Text size'; });
    e.destroy();
    return ok;
  }));

  // Errors are explicit
  c.ok('attach refuses a non-textarea', await page.evaluate(() => {
    try { KStyleEditor.attach(document.body); return false; } catch (e) { return /textarea/.test(e.message); }
  }));

  c.finish(errors);
  await browser.close();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
