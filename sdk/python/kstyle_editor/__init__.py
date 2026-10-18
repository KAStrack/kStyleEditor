"""Parse, serialise and sanitise the CSS declarations kStyleEditor writes.

A port of src/k-style-css.js, held to the same behaviour by
tests/fixtures/cases.json. SPEC.md is the prose version.

A declaration is a dict: {"property": str, "value": str, "important": bool}.

    import kstyle_editor
    kstyle_editor.sanitize(untrusted_css, selector="#field-12")
"""

import re

__all__ = ["DEFAULT_ALLOW", "VERSION", "parse", "stringify", "clean", "sanitize"]

VERSION = "0.1.0"

# Every property the built-in controls can write, plus the common shorthands
# people type into the Code tab.
DEFAULT_ALLOW = (
    "color",
    "font", "font-family", "font-size", "font-weight", "font-style", "font-variant",
    "background", "background-color", "background-image", "background-size",
    "background-position", "background-repeat", "background-attachment",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "line-height", "letter-spacing", "word-spacing", "text-align", "text-transform",
    "text-decoration", "text-decoration-line", "text-decoration-style",
    "text-decoration-color", "text-decoration-thickness", "text-underline-offset",
    "text-shadow", "text-indent", "white-space", "word-break", "overflow-wrap",
    "vertical-align",
    "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-width", "border-style", "border-color",
    "border-radius", "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius",
    "outline", "outline-width", "outline-style", "outline-color", "outline-offset",
    "width", "height", "min-width", "max-width", "min-height", "max-height",
    "box-sizing", "aspect-ratio",
    "display", "overflow", "overflow-x", "overflow-y", "float", "clear", "visibility",
    "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content",
    "gap", "row-gap", "column-gap", "flex", "flex-grow", "flex-shrink", "flex-basis",
    "align-self", "order", "grid-template-columns", "grid-template-rows",
    "position", "inset", "top", "right", "bottom", "left", "z-index",
    "opacity", "box-shadow", "transform", "filter", "mix-blend-mode", "transition",
    "cursor", "pointer-events", "user-select",
    "list-style", "list-style-type", "list-style-position",
)

# Never allowed, whatever the allow-list says.
_BLOCKED = ("behavior", "-moz-binding")

# Lower-cased, space-free fragments refused anywhere in a value.
_BAD_FRAGMENTS = (
    "expression(", "javascript:", "vbscript:", "-moz-binding", "@import",
    "image-set(", "image(", "element(", "cross-fade(", "src(",
)

_DATA_IMAGES = ("data:image/png", "data:image/gif", "data:image/jpeg", "data:image/webp")

# CSS whitespace, spelled out: \s means more than this in Python. re.ASCII
# keeps IGNORECASE from matching the Kelvin sign as a "k".
_SPACE = " \t\n\r\f"
_COLLAPSE_RE = re.compile(r"[ \t\n\r\f]+")
_IMPORTANT_RE = re.compile(r" *! *important\Z", re.IGNORECASE | re.ASCII)
_PROPERTY_RE = re.compile(r"-?[a-z][a-z0-9-]*\Z")
_CUSTOM_PROPERTY_RE = re.compile(r"--[A-Za-z0-9_-]+\Z")
_SCHEME_RE = re.compile(r"[a-z][a-z0-9+.-]*:")
_SELECTOR_BAD_RE = re.compile(r"[{}<;\\\x00-\x1f\x7f]")
_VALUE_BAD_RE = re.compile(r"[{}<>\\\x00-\x1f\x7f]")


def _trim(s):
    return s.strip(_SPACE)


def _collapse(s):
    return _COLLAPSE_RE.sub(" ", s)


def _ascii_lower(s):
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)


def _strip_comments(css):
    out = []
    quote = ""
    i = 0
    n = len(css)
    while i < n:
        ch = css[i]
        if quote:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                i += 1
                out.append(css[i])
            elif ch == quote:
                quote = ""
            i += 1
            continue
        if ch in "\"'":
            quote = ch
            out.append(ch)
        elif ch == "/" and i + 1 < n and css[i + 1] == "*":
            end = css.find("*/", i + 2)
            i = n if end == -1 else end + 2
            out.append(" ")
            continue
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _rule_body(css):
    quote = ""
    opened = -1
    depth = 0
    i = 0
    n = len(css)
    while i < n:
        ch = css[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch == "{":
            if opened == -1:
                opened = i
            depth += 1
        elif ch == "}" and opened != -1:
            depth -= 1
            if depth == 0:
                return css[opened + 1:i]
        i += 1
    return css if opened == -1 else css[opened + 1:]


def _split_declarations(body):
    parts = []
    quote = ""
    depth = 0
    start = 0
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            if depth > 0:
                depth -= 1
        elif ch == ";" and depth == 0:
            parts.append(body[start:i])
            start = i + 1
        i += 1
    parts.append(body[start:])
    return parts


def parse(css):
    """Read CSS declarations, in order.

    Accepts a bare list or one rule (``sel { ... }``). Comments are dropped,
    whitespace collapsed, names lower-cased (custom properties keep their
    case). Never validates; that is sanitize()'s job.
    """
    out = []
    if css is None:
        return out
    for piece in _split_declarations(_rule_body(_strip_comments(str(css)))):
        colon = piece.find(":")
        if colon == -1:
            continue
        prop = _collapse(_trim(piece[:colon]))
        if not prop.startswith("--"):
            prop = _ascii_lower(prop)
        value = _collapse(_trim(piece[colon + 1:]))
        important = False
        if _IMPORTANT_RE.search(value):
            important = True
            value = _trim(_IMPORTANT_RE.sub("", value))
        if not prop or not value:
            continue
        out.append({"property": prop, "value": value, "important": important})
    return out


def _check_selector(selector):
    s = _collapse(_trim(str(selector)))
    if not s or _SELECTOR_BAD_RE.search(s) or "/*" in s:
        raise ValueError('kStyleCss: invalid selector "%s"' % selector)
    return s


def stringify(declarations, selector=None, pretty=True):
    """Write declarations back out.

    pretty: one per line (default) or all on one line.
    selector: wrap them in ``selector { ... }``.
    An empty list is always "". Raises ValueError for an unsafe selector.
    """
    sel = _check_selector(selector) if selector else ""
    lines = [
        "%s: %s%s;" % (d["property"], d["value"], " !important" if d.get("important") else "")
        for d in declarations or ()
    ]
    if not lines:
        return ""
    if not sel:
        return ("\n" if pretty else " ").join(lines)
    if pretty:
        return sel + " {\n  " + "\n  ".join(lines) + "\n}"
    return sel + " { " + " ".join(lines) + " }"


def _is_allowed(prop, allow):
    if allow == "*":
        return True
    for entry in allow:
        if entry == "*":
            return True
        if entry.endswith("*"):
            if prop.startswith(entry[:-1]):
                return True
        elif entry == prop:
            return True
    return False


def _is_safe_value(value):
    if _VALUE_BAD_RE.search(value):
        return False
    quote = ""
    depth = 0
    for ch in value:
        if quote:
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    if quote or depth != 0:
        return False
    squashed = _ascii_lower(value).replace(" ", "")
    return not any(f in squashed for f in _BAD_FRAGMENTS)


def _urls(value):
    found = []
    lower = _ascii_lower(value)
    n = len(value)
    at = lower.find("url(")
    while at != -1:
        i = at + 4
        while i < n and value[i] == " ":
            i += 1
        ch = value[i] if i < n else ""
        if ch in ("\"", "'"):
            end = value.find(ch, i + 1)
            if end == -1:
                end = n
            found.append(value[i + 1:end])
        else:
            end = value.find(")", i)
            if end == -1:
                end = n
            found.append(_trim(value[i:end]))
        at = lower.find("url(", end)
    return found


def _is_safe_url(url):
    u = _ascii_lower(_trim(url))
    if not _SCHEME_RE.match(u):
        return True
    if u.startswith("http:") or u.startswith("https:"):
        return True
    for prefix in _DATA_IMAGES:
        if u.startswith(prefix) and u[len(prefix):len(prefix) + 1] in (";", ","):
            return True
    return False


def _reject(decl, allow):
    p = decl["property"]
    if not _PROPERTY_RE.match(p) and not _CUSTOM_PROPERTY_RE.match(p):
        return "property"
    if p in _BLOCKED:
        return "blocked"
    if not _is_allowed(p, allow):
        return "not-allowed"
    if not _is_safe_value(decl["value"]):
        return "value"
    for url in _urls(decl["value"]):
        if not _is_safe_url(url):
            return "url"
    return ""


def clean(css, allow=None):
    """Split CSS into what sanitize() would keep and what it would drop.

    Returns {"declarations": [...], "rejected": [{"property", "value", "reason"}]}.
    Reasons: property, blocked, not-allowed, value, url.
    """
    if allow is None:
        allow = DEFAULT_ALLOW
    kept = []
    rejected = []
    for d in parse(css):
        why = _reject(d, allow)
        if why:
            rejected.append({"property": d["property"], "value": d["value"], "reason": why})
        else:
            kept.append(d)
    return {"declarations": kept, "rejected": rejected}


def sanitize(css, allow=None, selector=None, pretty=True):
    """Untrusted CSS in, safe CSS out.

    allow: property names to keep (default DEFAULT_ALLOW). A trailing ``*`` is
    a prefix match ("border-*"); "*" keeps any well-formed name.
    selector, pretty: as stringify().
    """
    return stringify(clean(css, allow)["declarations"], selector=selector, pretty=pretty)
