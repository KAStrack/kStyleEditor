# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-10-18

### Fixed

- The colour palette now floats above whatever holds the editor. It was absolutely positioned inside the colour field, so in a narrow scrolling panel or a modal's scrolling body it opened inside that container. The container grew to hold it, people had to scroll to reach its bottom row, and near the container's right edge it was cut off. It only flipped upwards when the window had no room below, and it never moved sideways. It now opens in the browser's top layer (`popover="manual"`), where no ancestor's `overflow` or `transform` can clip or move it, placed from the chip:
  - below it, or above when there is not room below and more above;
  - if neither side fits, shortened to the larger side, and it scrolls;
  - lined up with the chip but kept 8px inside the window's right edge;
  - re-placed whenever anything scrolls or the window resizes, and closed when the chip scrolls out of sight.

  It stays inside the editor in the DOM, so the `--kse-*` tokens, `data-kse-theme` and dark mode still apply, `destroy()` still removes it, and keyboard use, Escape, outside clicks and tabbing out work as before. It is placed through the CSSOM only, so a strict CSP allows it. Browsers without `popover` get a `position: fixed` palette, corrected for a transformed ancestor.

## [0.1.2] - 2026-10-18

### Added

- The `inherited` option and `setInherited()`: what each property shows while the editor does not set it, such as the value a page's theme gives it, as `{ property: value }` (custom properties keyed as written) or `function (property)`. Before, every unset field looked empty: a colour showed a checkerboard and "Default", a length an empty box, a list its bare "Default". So a theme editor could not show people the colour they were about to change, only a blank. Now an unset colour field draws its chip in the inherited colour with a dashed ring (`data-inherited="true"`, coloured by the new `--kse-inherited` token), shows the colour as its placeholder, offers *Use inherited (#1f2933)* in the palette and starts the system picker from it. A length shows the number as its placeholder with its unit selected, so a number typed over it keeps that unit and the arrow keys step from it. A select or font list's empty option reads *Default (600 Semi-bold)*. Text and range fields show it as a placeholder, and box, stroke, shadow and functions fields show their part of it. Image fields ignore it except in their raw text box. It is display only: it is never written to the textarea, `getCss()`, `get()`, the Code tab or the preview, and neither attaching nor `setInherited()` rewrites the textarea. Choosing a value equal to the inherited one sets it explicitly, and *Default* goes back to inheriting.
- Labels `inherited` ("Inherited: {value}", given to screen readers through `aria-describedby`), `useInherited` ("Use inherited ({value})") and `inheritedOption` ("Default ({value})").
- `ctx.inherited(prop)` for custom field types, and an optional `inherit()` method on a field, which `setInherited()` calls.

## [0.1.1] - 2026-10-17

### Added

- `labels.options` translates the texts of a field's options, keyed by the field (`id.key`, as for field titles in `labels.controls`) and then by option value: `{ 'font.weight': { '700': '700 Negrita' } }`. It works for select and font fields, built-in or custom. Before, `labels` reached control and field titles but not option texts, so a translated editor still offered "700 Bold", and a custom control's `[value, label]` options could not be translated at all without redefining the control. An option it does not name keeps its own label.
- `KStyleEditor.DEFAULT_SWATCHES` (the built-in 24-colour palette) and `KStyleEditor.DEFAULT_FONTS`, as copies beside `DEFAULT_BASIC` and `DEFAULT_ADVANCED`. The palette was not exported at all (`DEFAULTS.swatches` is `null`), so an integrator who wanted their own colours first had to copy all 24 pairs.

### Fixed

- The element preview now works under a Content-Security-Policy whose `style-src` has no `'unsafe-inline'`. It restored the element by writing its `style` attribute before every apply, on `destroy()` and on `setPreview()`; such a policy refuses that write, so every change logged a violation and the reset never happened: removed declarations stayed on the element, and `destroy()` left the editor's styles behind. It now restores through the CSSOM (`style.cssText`), which the policy allows, and leaves an element that had no `style` attribute without one in Chromium, WebKit and Firefox. The original attribute text is still put back exactly when it was not blocked.

## [0.1.0] - 2026-10-17

### Added

- The editor, `KStyleEditor`: takes over a `<textarea>` and stores plain CSS declarations, optionally wrapped in a selector.
- Basic and Advanced control groups, both configurable. The defaults are five basic controls and 58 advanced ones in nine sections, with a filter box.
- Colour fields open a palette of 24 named colours (or your own, via `swatches`), with the system picker behind *Custom colour…*, starting from the colour on screen rather than black.
- A Code tab that syncs both ways and warns about anything the server SDK would drop.
- Live preview in a built-in box or on a page element, restored exactly on `destroy()`.
- Eleven field types (colour, length, select, font, text, range, box, stroke, shadow, functions, image), `registerControl()` and `registerFieldType()`.
- `strict` and `sanitize` options, data-attribute initialisation, labels for translation, and `--kse-*` theming with automatic dark mode.
- The sanitiser, `KStyleCss` (`parse`, `stringify`, `clean`, `sanitize`), with ports for PHP, Python, C#, Go and Ruby, held to one set of conformance cases.
- The documentation site in `docs/`, with a landing page, a playground and an API reference.

[0.1.3]: https://github.com/KAStrack/kStyleEditor/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/KAStrack/kStyleEditor/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/KAStrack/kStyleEditor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KAStrack/kStyleEditor/releases/tag/v0.1.0
