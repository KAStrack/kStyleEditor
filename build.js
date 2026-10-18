#!/usr/bin/env node
/*
 * Build the dist/ directory: a minified copy of every source file, plus a
 * combined pair so a page can load one CSS and one JS file.
 *
 *   node build.js
 *
 * The sources stay the deliverable — dist/ is generated and git-ignored; the
 * npm package carries it (prepublishOnly builds), so installing needs no build
 * step.
 *
 * The minified files are also copied to docs/dist/, which the GitHub Pages site
 * in docs/ loads. That copy IS committed — Pages serves the repository as it
 * stands, with no build — so run this after any change to src/ and commit
 * docs/ alongside it.
 *
 * Why the JS bundle is not a plain concatenation
 * ----------------------------------------------
 * Each source file is its own UMD module. Concatenated as-is, both would take
 * the CommonJS branch under a bundler and fight over `module.exports`, and
 * `require('./k-style-css.js')` would point at a file that is not next to the
 * bundle. So each file is wrapped in a scope carrying its own `module` and a
 * `require` that resolves from an in-bundle registry, and the bundle's own UMD
 * wrapper decides what to export or attach to the global. The sources are used
 * verbatim; nothing is rewritten.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { minify } = require('terser');
const CleanCSS = require('clean-css');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const SITE_DIST = path.join(ROOT, 'docs', 'dist');

const VERSION = require('./package.json').version;

/* Load order is not cosmetic: the editor reads KStyleCss as it loads. */
const JS_FILES = [
  'k-style-css.js',
  'k-style-editor.js'
];
const CSS_FILES = [
  'k-style-editor.css'
];

const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const gzip = (text) => zlib.gzipSync(Buffer.from(text, 'utf8')).length;

function banner(what) {
  return '/*! kStyleEditor ' + VERSION + ' — ' + what +
    ' | MIT | https://github.com/KAStrack/kStyleEditor */\n';
}

/** One source file, given its own module scope and a registry-backed require. */
function wrapModule(name, code) {
  return '/* ---- ' + name + ' ---- */\n' +
    '(function () {\n' +
    'var module = { exports: {} };\n' +
    'var exports = module.exports;\n' +
    'var require = function (p) { return REGISTRY[String(p).replace(/^.*\\//, \'\')]; };\n' +
    code + '\n' +
    'REGISTRY[' + JSON.stringify(name) + '] = module.exports;\n' +
    '}());\n';
}

function buildJsBundle() {
  const parts = JS_FILES.map((name) => wrapModule(name, read(name)));
  return [
    '(function (root, factory) {',
    "  'use strict';",
    '  if (typeof module === \'object\' && module.exports) {',
    '    module.exports = factory();',
    '  } else {',
    '    var api = factory();',
    '    root.KStyleCss = api.KStyleCss;',
    '    root.KStyleEditor = api.KStyleEditor;',
    '  }',
    '}(typeof globalThis !== \'undefined\' ? globalThis : this, function () {',
    "  'use strict';",
    '  var REGISTRY = {};',
    parts.join('\n'),
    '  return {',
    '    KStyleCss: REGISTRY[' + JSON.stringify(JS_FILES[0]) + '],',
    '    KStyleEditor: REGISTRY[' + JSON.stringify(JS_FILES[1]) + ']',
    '  };',
    '}));',
    ''
  ].join('\n');
}

async function minifyJs(code, keepBanner) {
  const out = await minify(code, {
    // The sources are ES5 on purpose — no build step is required to use them,
    // so nothing here should raise the floor.
    ecma: 5,
    compress: { passes: 2 },
    mangle: true,
    format: { comments: keepBanner ? /^!/ : false, ascii_only: true }
  });
  if (out.error) throw out.error;
  return out.code + '\n';
}

function minifyCss(code) {
  const out = new CleanCSS({ level: 2, format: false, returnPromise: false }).minify(code);
  if (out.errors && out.errors.length) throw new Error(out.errors.join('\n'));
  if (out.warnings && out.warnings.length) {
    out.warnings.forEach((w) => console.warn('  clean-css: ' + w));
  }
  return out.styles + '\n';
}

const rows = [];
function write(name, text, source) {
  fs.writeFileSync(path.join(DIST, name), text);
  rows.push({
    name: name,
    bytes: Buffer.byteLength(text),
    gz: gzip(text),
    from: source ? Buffer.byteLength(source) : null
  });
}

(async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  /* --- one minified file per source ------------------------------------- */
  for (const name of JS_FILES) {
    const source = read(name);
    // The minified files sit next to each other, so a CommonJS require of a
    // sibling has to name the minified sibling.
    const relinked = source.replace(
      /(['"])\.\/(k-style-[a-z]+)\.js\1/g,
      (m, q, base) => q + './' + base + '.min.js' + q
    );
    write(name.replace(/\.js$/, '.min.js'), await minifyJs(relinked, true), source);
  }
  for (const name of CSS_FILES) {
    const source = read(name);
    write(name.replace(/\.css$/, '.min.css'), minifyCss(source), source);
  }

  /* --- the combined pair ------------------------------------------------ */
  const jsBundle = buildJsBundle();
  const jsSource = JS_FILES.map(read).join('\n');
  write('k-style.js', banner('editor and CSS sanitiser') + jsBundle, jsSource);
  write('k-style.min.js', banner('editor and CSS sanitiser') + await minifyJs(jsBundle, false), jsSource);

  const cssSource = CSS_FILES.map(read).join('\n');
  write('k-style.css', banner('editor stylesheet') + cssSource, cssSource);
  write('k-style.min.css', banner('editor stylesheet') + minifyCss(cssSource), cssSource);

  /* --- the site's copy ------------------------------------------------- */
  // Only the minified files: the pages load those, as a real install would.
  fs.rmSync(SITE_DIST, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIST, { recursive: true });
  rows.filter((r) => /\.min\.(js|css)$/.test(r.name)).forEach((r) => {
    fs.copyFileSync(path.join(DIST, r.name), path.join(SITE_DIST, r.name));
  });

  /* --- report ----------------------------------------------------------- */
  const pad = (s, n) => String(s).padEnd(n);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('\nkStyleEditor ' + VERSION + ' → dist/\n');
  console.log('  ' + pad('file', 26) + pad('size', 11) + pad('gzipped', 11) + 'vs source');
  console.log('  ' + '-'.repeat(58));
  rows.forEach((r) => {
    const saved = r.from ? (100 - (r.bytes / r.from) * 100).toFixed(0) + '% smaller' : '';
    console.log('  ' + pad(r.name, 26) + pad(kb(r.bytes), 11) + pad(kb(r.gz), 11) + saved);
  });
  console.log('\n  minified files copied to docs/dist/ for the GitHub Pages site\n');
}()).catch((err) => {
  console.error(err);
  process.exit(1);
});
