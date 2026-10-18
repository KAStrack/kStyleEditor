# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/KAStrack/kStyleEditor/releases/tag/v0.1.0
