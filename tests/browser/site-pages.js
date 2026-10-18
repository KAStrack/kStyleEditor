/*!
 * The GitHub Pages site, served from docs/ alone the way Pages serves it:
 * every page loads with no errors, no 404s, only minified library files, and
 * no sideways scrolling on a phone, in light and dark.
 */
'use strict';

const path = require('path');
const { chromium } = require('playwright');
const { ROOT, serve, shot, checker, watchErrors } = require('./harness');

const PAGES = ['index.html', 'demo.html', 'docs.html'];

(async function () {
  const srv = await serve(0, path.join(ROOT, 'docs'));
  const browser = await chromium.launch();
  const c = checker();
  const errors = [];

  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width: width, height: 900 }, colorScheme: scheme });
      watchErrors(page, errors);
      const loaded = [];
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(r.status() + ' ' + r.url());
        loaded.push(r.url());
      });
      for (const name of PAGES) {
        await page.goto(srv.url + '/' + name);
        await page.waitForLoadState('networkidle');
        const tag = name + ' ' + scheme + ' ' + width;
        c.ok('editors attached: ' + tag, await page.evaluate(() => document.querySelectorAll('.kse').length > 0));
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        c.ok('no sideways scroll: ' + tag, sw <= width, sw);
        if (width === 390) await page.screenshot({ path: shot('site-' + name.replace('.html', '') + '-' + scheme + '-phone'), fullPage: false });
      }
      const lib = loaded.filter((u) => /\/dist\//.test(u));
      c.ok('only minified library files (' + scheme + ' ' + width + ')',
        lib.length > 0 && lib.every((u) => /\.min\.(js|css)$/.test(u)), lib);
      await page.close();
    }
  }

  // The editor follows the page into dark mode, and a pinned theme wins.
  const dark = await browser.newPage({ colorScheme: 'dark' });
  await dark.goto(srv.url + '/index.html');
  const bg = (sel) => dark.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, sel);
  c.ok('editor is dark under prefers-color-scheme: dark', await bg('#ex1 .kse') === 'rgb(22, 26, 32)', await bg('#ex1 .kse'));
  await dark.evaluate(() => KStyleEditor.get('#ex1-css').setTheme('light'));
  c.ok('a pinned light theme wins', await bg('#ex1 .kse') === 'rgb(255, 255, 255)', await bg('#ex1 .kse'));
  await dark.close();

  // Every example's View source panel was filled in.
  const page = await browser.newPage();
  await page.goto(srv.url + '/index.html');
  c.ok('every example has its source', await page.evaluate(() =>
    Array.prototype.every.call(document.querySelectorAll('.example details.src code'), (code) =>
      /KStyleEditor\.attach/.test(code.textContent) && code.textContent.indexOf('class="kse') === -1)));
  await page.close();

  c.finish(errors);
  await browser.close();
  srv.close();
}()).catch((e) => { console.error(e); process.exit(1); });
