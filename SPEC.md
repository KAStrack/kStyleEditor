# kStyleEditor CSS Specification

Version 1.0

This is what kStyleEditor stores in a textarea, and exactly how every SDK reads, writes and sanitises it. The JavaScript implementation is [`src/k-style-css.js`](src/k-style-css.js); the PHP, Python, C#, Go and Ruby SDKs in [`sdk/`](sdk/) are ports of it. All of them are held to [`tests/fixtures/cases.json`](tests/fixtures/cases.json). If this document and the fixtures disagree, the fixtures win, and this document has a bug.

---

## 1. The stored format

A list of CSS declarations, one per line, each ending in `;`:

```css
color: #1d4ed8;
padding: 8px 12px;
```

Optionally the list is wrapped in a rule whose selector the integrator chose:

```css
#signup .email {
  color: #1d4ed8;
  padding: 8px 12px;
}
```

A **declaration** is a triple `{ property, value, important }`.

## 2. Definitions

- **Whitespace** is exactly space, tab, line feed, carriage return and form feed (`U+0020`, `U+0009`, `U+000A`, `U+000D`, `U+000C`). Not a language's `\s`, which differs between languages.
- **Trim** removes whitespace from both ends.
- **Collapse** replaces every run of whitespace with one space.
- **ASCII-lower** maps `A`–`Z` to `a`–`z` and leaves every other character alone. Locale-aware or Unicode lower-casing must not be used.
- A **quote** is `"` or `'`. Inside a quoted run, a backslash escapes the next character (for parsing only; see 5.4).

Every character these rules look for is ASCII, so an implementation may work on UTF-8 bytes or on characters and get the same answer.

## 3. parse(css) → declarations

Parsing never fails and never validates. Steps, in order:

1. **Strip comments.** Outside quotes, `/*` up to and including the next `*/` (or the end of the input) is replaced by one space. Comment markers inside quotes are text.
2. **Find the body.** Outside quotes, find the first `{`. If there is none, the body is the whole text. If there is one, the body is everything after it up to the `}` that brings brace depth back to zero, or to the end of the input if none does. Only the first rule is read; anything before the `{` (the selector) and after its closing `}` is discarded.
3. **Split** the body on `;` that is outside quotes and at parenthesis depth zero. Depth never goes below zero (a stray `)` is ignored here).
4. For each piece:
   1. Find the first `:`. If there is none, skip the piece.
   2. **Property** = collapse(trim(text before the colon)). Unless it starts with `--`, ASCII-lower it.
   3. **Value** = collapse(trim(text after the colon)).
   4. If the value ends with `!important` (ASCII case-insensitive, optional spaces around the `!`), set `important` and remove it, then trim.
   5. If property or value is empty, skip the piece.

The result keeps document order, including duplicates.

## 4. stringify(declarations, { selector, pretty }) → string

- Each declaration becomes `property: value;`, or `property: value !important;`.
- With no declarations the result is `""`, with or without a selector.
- `pretty` defaults to true.

| selector | pretty | output |
| --- | --- | --- |
| none or `""` | true | lines joined with `\n` |
| none or `""` | false | lines joined with one space |
| given | true | `selector {\n  line\n  line\n}` (two-space indent) |
| given | false | `selector { line line }` |

The selector is collapse(trim()) of what was passed. It belongs to the integrator, not the user, so an unsafe one is an **error**, not something to repair. A selector is unsafe if, after that, it is empty or contains any of `{ } < ;`, a backslash, `/*`, or a character in `U+0000`–`U+001F` or `U+007F`. (`>` is allowed: it is the child combinator.)

## 5. clean(css, { allow }) → { declarations, rejected }

`clean` parses (section 3), then tests each declaration against the rules below, **in this order**. The first rule that fails gives the rejection reason. A rejection is `{ property, value, reason }`.

### 5.1 `property`: well-formed name

The property must match `^-?[a-z][a-z0-9-]*$` or, for a custom property, `^--[A-Za-z0-9_-]+$` (anchored at the very end of the string, not before a final newline).

### 5.2 `blocked`

`behavior` and `-moz-binding` are always rejected, whatever the allow-list says.

### 5.3 `not-allowed`: the allow-list

`allow` is a list of entries, or the single string `*`. When it is absent or null, the default list in [`tests/fixtures/cases.json`](tests/fixtures/cases.json) (`defaultAllow`) is used. A property is allowed if any entry:

- is `*`; or
- ends in `*`, and the property starts with the entry minus that `*` (`border-*` allows `border-top` and `border-radius`); or
- equals the property exactly (case-sensitive).

### 5.4 `value`: a safe value

The value is rejected if any of these hold:

- It contains `{`, `}`, `<`, `>`, a backslash, or a character in `U+0000`–`U+001F` or `U+007F`.
- Scanning left to right, tracking quotes (with no escapes, since backslashes were refused) and parenthesis depth outside quotes, a `)` takes depth below zero, or the scan ends inside quotes or with depth above zero.
- After ASCII-lowering and removing every space, it contains any of: `expression(`, `javascript:`, `vbscript:`, `-moz-binding`, `@import`, `image-set(`, `image(`, `element(`, `cross-fade(`, `src(`.

The image functions are refused because they accept bare strings as URLs, which 5.5 would not see.

### 5.5 `url`: every url() is safe

For each case-insensitive occurrence of `url(` in the value, the address is:

- if the next non-space character is a quote, the text up to the matching quote (or the end);
- otherwise the trimmed text up to the next `)` (or the end).

Search for the next `url(` from where that address ended. An address, trimmed and ASCII-lowered, is safe if:

- it does not start with a scheme (`^[a-z][a-z0-9+.-]*:`), so it is relative, root-relative or protocol-relative; or
- it starts with `http:` or `https:`; or
- it starts with `data:image/png`, `data:image/gif`, `data:image/jpeg` or `data:image/webp`, immediately followed by `;` or `,`.

Everything else is rejected, including SVG data URIs (which can carry script) and every other scheme.

## 6. sanitize(css, { allow, selector, pretty }) → string

`stringify(clean(css, { allow }).declarations, { selector, pretty })`.

The output is always rebuilt from parsed declarations, never passed through, so it contains no comments, no braces other than the wrapper's, and nothing that can end a `<style>` element. It is safe inside `<style>` as is, and inside a `style=""` attribute once HTML-escaped like any other attribute text.

## 7. What the editor adds

These are editor behaviours, not SDK ones:

- An editor that has not been changed never rewrites its textarea.
- A control replaces the declarations of the properties it owns at the position of the first of them, and appends when there were none. `!important` on a replaced property is kept.
- Declarations no enabled control owns are kept unchanged, in place, unless the `strict` option is on.
- The `sanitize` option filters the saved output through `clean` with the editor's `allow` option.

## 8. Versioning

The format version is independent of the package version. A change to any rule in sections 3–6 is a new format version, a new fixture, and a change in every SDK.
