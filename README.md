# kStyleEditor

A zero-dependency visual CSS editor that takes over a `<textarea>`, and server-side SDKs that make the CSS it writes safe to render.

**[Live demo and documentation →](https://kastrack.github.io/kStyleEditor/)**

**Current version: 0.1.2**

---

## Why

Form builders, page builders and theme settings all end up wanting the same thing: let a user style *this* element (a field, a button, a heading) without handing them a stylesheet. kStyleEditor gives them colour pickers, font, spacing, border and shadow controls, and around fifty more behind an Advanced tab. It stores plain CSS declarations in your textarea:

```css
color: #1d4ed8;
padding: 8px 12px;
border: 1px solid #94a3b8;
```

Your form posts exactly as it always did. On the way out, a one-line SDK call (PHP, Python, Node, C#, Go or Ruby) re-parses that CSS, keeps only allowed properties with safe values, and wraps it in your selector.

- **Plain CSS in the textarea.** No JSON and no lock-in. A wrapping selector is optional.
- **Basic and Advanced groups**, each configurable control by control. A Code tab shows the CSS and accepts typing, in sync both ways.
- **Colour for everyone.** Each colour field opens a palette of named colours; the system picker is one click further and starts from the colour already showing, not black.
- **Live preview**, in a built-in box or on a real element on your page, which is put back exactly as it was on `destroy()`.
- **Nothing is lost.** Declarations no control understands are kept in place. Values a control cannot take apart (a `calc()`, two shadows) are shown as text, not rewritten.
- **Fits in a form.** Every button is `type="button"`, Enter does not submit, and no input joins the form's validation.
- **Themeable** through `--kse-*` custom properties, with automatic dark mode. Every string can be translated.

---

## Install

### Browser

Copy the files from [`docs/dist/`](docs/dist/) (or run `npm run build` and use `dist/`):

```html
<link rel="stylesheet" href="k-style-editor.min.css">
<script src="k-style-css.min.js"></script>
<script src="k-style-editor.min.js"></script>
```

### What is in `dist/`

| File | Contents |
| --- | --- |
| `k-style-css.min.js` | `KStyleCss`: the parser and sanitiser. The editor needs it; it is also the JS SDK. |
| `k-style-editor.min.js` | `KStyleEditor`: the editor. Load after `k-style-css`. |
| `k-style-editor.min.css` | The editor's stylesheet. |
| `k-style.min.js` / `k-style.min.css` | Both scripts in one file, and the stylesheet. |
| `*.js` / `*.css` without `.min` | Readable copies of the bundles. |

### npm

```sh
npm install @kastrack/style-editor
```

```js
import '@kastrack/style-editor/editor.css';
import KStyleEditor from '@kastrack/style-editor/editor';
import KStyleCss from '@kastrack/style-editor';   // the sanitiser; works in Node
```

---

## Quick start

```html
<textarea name="field_css" id="field-css">color: #333;</textarea>

<script>
  KStyleEditor.attach('#field-css', {
    preview: '#field-12 input'          // or true for a built-in preview box
  });
</script>
```

Then on the server:

```php
use Kastrack\StyleEditor\Css;

echo '<style>' . Css::sanitize($row['field_css'], ['selector' => '#field-12 input']) . '</style>';
```

---

## Controls

The default **Basic** controls are `color`, `font`, `background`, `padding` and `margin`.

The default **Advanced** controls, in sections:

| Section | Controls |
| --- | --- |
| Typography | `lineHeight`, `letterSpacing`, `wordSpacing`, `textAlign`, `textTransform`, `textDecoration`, `textShadow`, `textIndent`, `whiteSpace`, `wordBreak`, `overflowWrap`, `verticalAlign`, `fontVariant` |
| Background | `backgroundImage` (URL or gradient), `backgroundSize`, `backgroundPosition`, `backgroundRepeat`, `backgroundAttachment` |
| Border | `border` (all or per side), `borderRadius`, `outline` |
| Size | `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `boxSizing`, `aspectRatio` |
| Layout | `display`, `overflow`, `float`, `clear`, `visibility` |
| Flex & grid | `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignContent`, `gap`, `flex`, `alignSelf`, `order`, `gridTemplateColumns`, `gridTemplateRows` |
| Position | `position`, `inset`, `zIndex` |
| Effects | `opacity`, `boxShadow`, `transform`, `filter`, `mixBlendMode`, `transition` |
| Interaction | `cursor`, `pointerEvents`, `userSelect`, `listStyle` |

Any control can go in either group, in any order:

```js
KStyleEditor.attach('#css', {
  basic: ['color', 'background', 'font', 'border'],
  advanced: ['borderRadius', 'boxShadow', 'opacity']    // or false for no Advanced tab
});
```

Add your own with `controls` (one editor) or `KStyleEditor.registerControl()` (all editors). See [Custom controls](https://kastrack.github.io/kStyleEditor/docs.html#custom-controls).

---

## Options

| Option | Default | |
| --- | --- | --- |
| `basic` | five controls | Control ids for the Basic tab. |
| `advanced` | see above | Control ids for the Advanced tab; `false` for none. |
| `controls` | `null` | Extra control definitions for this editor. |
| `selector` | `null` | Save `selector { … }` instead of bare declarations. |
| `pretty` | `true` | One declaration per line. |
| `strict` | `false` | Save only properties the enabled controls can edit. |
| `sanitize` | `false` | Also drop what the SDK would. Not a substitute for sanitising on the server. |
| `allow` | `null` | Allow-list for the Code tab's warnings and for `sanitize`. |
| `preview` | `false` | `true` for a built-in box, or an element/selector to restyle live. |
| `previewContent` | pangram | Text or a node for the built-in box. |
| `code` | `true` | Show the Code tab. |
| `startTab` | `'basic'` | `'basic'`, `'advanced'` or `'code'`. |
| `hideTextarea` | `true` | Hide the original textarea. |
| `units` | `['px','em','rem','%']` | Units for length fields that do not set their own. |
| `fonts` | five stacks | Font stacks for the Font control (`KStyleEditor.DEFAULT_FONTS` by default). |
| `swatches` | `null` | The palette each colour field opens (`KStyleEditor.DEFAULT_SWATCHES`, 24 named colours, by default); `[value, label]` pairs for your own. |
| `openSetSections` | `true` | Open Advanced sections that already hold values. |
| `theme` | `null` | `'light'` or `'dark'` to pin; `null` follows the page. |
| `readOnly` | `false` | Show, do not edit. |
| `labels` | `null` | Override interface text. See [Labels](#labels). |
| `inherited` | `null` | What each unset property shows, e.g. a theme's values: `{ property: value }` or `function (property)`. Shown, never saved. See [Inherited values](#inherited-values). |
| `onChange` | `null` | `function (css, payload)` after every change. |

Methods: `getCss()`, `getDeclarations()`, `setCss()`, `get()`, `set()`, `clear()`, `sync()`, `setTab()`, `setPreview()`, `setSelector()`, `setTheme()`, `setInherited()`, `on()`, `off()`, `destroy()`. Statics: `attach()`, `attachAll()`, `get()`, `detach()`, `registerControl()`, `registerFieldType()`, `controls()`, and the values `VERSION`, `DEFAULT_BASIC`, `DEFAULT_ADVANCED`, `DEFAULT_SWATCHES`, `DEFAULT_FONTS`, `DEFAULT_LABELS`, `DEFAULTS` and `SECTIONS`. `DEFAULT_SWATCHES` and `DEFAULT_FONTS` are copies, so your own colours or fonts can go first:

```js
KStyleEditor.attach('#css', {
  swatches: [['#0b3d91', 'Brand blue']].concat(KStyleEditor.DEFAULT_SWATCHES),
  fonts: [{ label: 'Brand', value: '"Inter", sans-serif' }].concat(KStyleEditor.DEFAULT_FONTS)
});
```

The element preview works under a strict Content-Security-Policy (`style-src` without `'unsafe-inline'`): it writes only through the CSSOM, never the `style` attribute.

### Inherited values

A property the editor does not set still has a value on the page, such as the theme's colour. `inherited` lets each field show it instead of looking empty:

```js
var editor = KStyleEditor.attach('#theme-css', {
  controls: [{ id: 'primary', label: 'Main colour', fields: [{ type: 'color', prop: '--brand-primary' }] }],
  basic: ['primary'], advanced: false,
  inherited: { '--brand-primary': '#1f2933' }
});
editor.setInherited(otherTheme);   // another theme picked: redraw, CSS untouched
```

An unset colour shows its chip in the inherited colour with a dashed ring (`data-inherited="true"`, `--kse-inherited`) and offers *Use inherited (#1f2933)*. A length shows the number as its placeholder, with its unit in the unit list. A select or font list's empty option reads *Default (600 Semi-bold)*. Text and range fields show it as a placeholder. Box, stroke, shadow and functions fields show their pieces of it, and image fields show it only in their raw text box. Screen readers hear *Inherited: …*. The inherited value is never written to the textarea, `getCss()`, `get()` or the Code tab. Choosing the same value sets it explicitly; *Default* goes back to inheriting.

Full reference: [docs](https://kastrack.github.io/kStyleEditor/docs.html).

### Labels

Every interface string is in `KStyleEditor.DEFAULT_LABELS`; pass `labels` to override any of them. Control titles go in `labels.controls` by control id, field titles by `id.key` (the field's `key`, or its property), section names in `labels.sections`, and the texts of a select or font field's options in `labels.options`, by `id.key` and then by option value:

```js
KStyleEditor.attach('#css', {
  labels: {
    advanced: 'Avanzado',
    controls: { color: 'Color del texto', 'font.weight': 'Grosor' },
    options: { 'font.weight': { '700': '700 Negrita', '400': '400 Normal' }, 'font.style': { italic: 'Cursiva' } },
    sections: { typography: 'Tipografía' }
  }
});
```

An option you do not name keeps its own label. `KStyleEditor.controls()` lists every control, with each field's `options`. The [inherited value](#inherited-values) texts are `inherited`, `useInherited` and `inheritedOption`, with `{value}` standing for the value.

---

## Server SDKs

Every SDK has the same four functions, `parse`, `stringify`, `clean` and `sanitize`, and passes the same [conformance cases](tests/fixtures/cases.json). The rules are in [SPEC.md](SPEC.md).

| Language | Where | Call |
| --- | --- | --- |
| JavaScript / Node | `src/k-style-css.js` | `KStyleCss.sanitize(css, { selector })` |
| PHP 8.1+ | `sdk/php` (`kastrack/style-editor`) | `Css::sanitize($css, ['selector' => …])` |
| Python 3.8+ | `sdk/python` (`kstyle-editor`) | `kstyle_editor.sanitize(css, selector=…)` |
| C# / .NET 8 | `sdk/dotnet` (`Kastrack.StyleEditor`) | `KStyleCss.Sanitize(css, new StyleOptions { Selector = … })` |
| Go 1.21+ | `sdk/go` | `kstyle.Sanitize(css, kstyle.Options{Selector: …})` |
| Ruby 3.0+ | `sdk/ruby` (`kstyle_editor`) | `KStyleEditor.sanitize(css, selector: …)` |

`sanitize` keeps a declaration only if its property is well formed and on the allow-list, it is not `behavior` or `-moz-binding`, its value has no `{ } < > \` or control characters, its quotes and brackets balance, it contains no `expression(`, `javascript:`, `@import` or image function that takes a bare URL, and every `url()` is relative, `http(s)` or a raster `data:image`. The result is rebuilt from what was parsed, never passed through.

Allowed CSS can still hide an element or cover the page. Narrow the allow-list to what your users actually need.

---

## Theming

```css
.kse {
  --kse-accent: #0f766e;
  --kse-radius: 4px;
  --kse-font: "Inter", sans-serif;
}
```

Dark values apply under `prefers-color-scheme: dark` and under `[data-kse-theme="dark"]`. The full token list is in the [docs](https://kastrack.github.io/kStyleEditor/docs.html#theming).

---

## Testing

```sh
npm install
npm test                 # JS SDK conformance (node:test)
npm run test:php         # PHP SDK conformance
npm run test:python      # Python SDK conformance
npm run test:browser     # builds, then drives the editor and the site in Chromium (Playwright);
                         # the strict-CSP checks also run in WebKit and Firefox
npm run test:all         # all of the above
```

C#: `dotnet run --project sdk/dotnet/Kastrack.StyleEditor.Tests`. Go: `cd sdk/go && go test ./...`. Ruby: `cd sdk/ruby && ruby -Ilib test/conformance_test.rb`. GitHub Actions runs all six SDKs and the browser checks on every push.

---

## Repository layout

```
src/                 the sources: editor JS and CSS, and the sanitiser (JS SDK)
dist/                built by `npm run build` (git-ignored)
docs/                the GitHub Pages site; docs/dist holds the minified build (committed)
sdk/                 php, python, dotnet, go, ruby
tests/fixtures/      cases.json, the conformance cases every SDK runs
tests/js, tests/php  SDK runners
tests/browser/       Playwright checks for the editor and the site
SPEC.md              the stored format and the sanitiser rules
```

After changing anything in `src/`, run `npm run build` and commit `docs/dist/` with it.

---

## Browser support

Current Chrome, Edge, Firefox and Safari. The scripts are ES5 with no dependencies.

## Licence

MIT. See [LICENSE](LICENSE).
