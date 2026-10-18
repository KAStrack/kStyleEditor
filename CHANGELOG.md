# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

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

[0.1.1]: https://github.com/KAStrack/kStyleEditor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KAStrack/kStyleEditor/releases/tag/v0.1.0
