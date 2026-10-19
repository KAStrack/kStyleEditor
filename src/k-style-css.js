/*!
 * kStyleCss 0.1.2
 * Parse, serialise and sanitise the CSS declarations kStyleEditor writes.
 * The editor uses it in the browser; it is also the JavaScript / Node SDK.
 * MIT Licence. https://github.com/KAStrack/kStyleEditor
 *
 * Every SDK (PHP, Python, C#, Go, Ruby) implements exactly this behaviour and
 * is held to it by tests/fixtures/cases.json. SPEC.md is the prose version. If
 * you change a rule here, change the fixtures and every SDK with it.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KStyleCss = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '0.1.2';

  // ─── The default allow-list ───────────────────────────────────────────────
  //
  // Every property the built-in controls can write, plus the common shorthands
  // people type into the Code tab. sanitize() keeps only these unless it is
  // given its own list. The order is the order the controls appear in.
  var DEFAULT_ALLOW = [
    'color',
    'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'background', 'background-color', 'background-image', 'background-size',
    'background-position', 'background-repeat', 'background-attachment',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform',
    'text-decoration', 'text-decoration-line', 'text-decoration-style',
    'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset',
    'text-shadow', 'text-indent', 'white-space', 'word-break', 'overflow-wrap',
    'vertical-align',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-width', 'border-style', 'border-color',
    'border-radius', 'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
    'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'box-sizing', 'aspect-ratio',
    'display', 'overflow', 'overflow-x', 'overflow-y', 'float', 'clear', 'visibility',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
    'gap', 'row-gap', 'column-gap', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
    'align-self', 'order', 'grid-template-columns', 'grid-template-rows',
    'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index',
    'opacity', 'box-shadow', 'transform', 'filter', 'mix-blend-mode', 'transition',
    'cursor', 'pointer-events', 'user-select',
    'list-style', 'list-style-type', 'list-style-position'
  ];

  // Never allowed, whatever the allow-list says: both bind script to an element
  // in the old browsers that honour them.
  var BLOCKED = ['behavior', '-moz-binding'];

  // Lower-cased, whitespace-free fragments that are refused anywhere in a value.
  // The image functions are here because they take bare strings as URLs, which
  // the url() check below would not see.
  var BAD_FRAGMENTS = [
    'expression(', 'javascript:', 'vbscript:', '-moz-binding', '@import',
    'image-set(', 'image(', 'element(', 'cross-fade(', 'src('
  ];

  var DATA_IMAGES = ['data:image/png', 'data:image/gif', 'data:image/jpeg', 'data:image/webp'];

  var PROPERTY_RE = /^-?[a-z][a-z0-9-]*$/;
  var CUSTOM_PROPERTY_RE = /^--[A-Za-z0-9_-]+$/;
  var IMPORTANT_RE = /[ ]*![ ]*important$/i;
  var SCHEME_RE = /^[a-z][a-z0-9+.-]*:/;

  // ─── Small helpers ────────────────────────────────────────────────────────
  //
  // Whitespace is CSS whitespace, spelled out, not \s: \s means different
  // things in different languages and the SDKs must agree byte for byte.

  function isSpace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
  }

  function trim(s) {
    var a = 0;
    var b = s.length;
    while (a < b && isSpace(s.charAt(a))) a++;
    while (b > a && isSpace(s.charAt(b - 1))) b--;
    return s.slice(a, b);
  }

  /** Every run of whitespace becomes one space. */
  function collapse(s) {
    var out = '';
    var gap = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (isSpace(ch)) { gap = true; continue; }
      if (gap && out) out += ' ';
      gap = false;
      out += ch;
    }
    return out;
  }

  function asciiLower(s) {
    return s.replace(/[A-Z]+/g, function (m) { return m.toLowerCase(); });
  }

  /** Remove comments, leaving a space so `a/**\/b` stays two tokens. */
  function stripComments(css) {
    var out = '';
    var quote = '';
    for (var i = 0; i < css.length; i++) {
      var ch = css.charAt(i);
      if (quote) {
        out += ch;
        if (ch === '\\' && i + 1 < css.length) { out += css.charAt(++i); continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === '\'') { quote = ch; out += ch; continue; }
      if (ch === '/' && css.charAt(i + 1) === '*') {
        var end = css.indexOf('*/', i + 2);
        i = end === -1 ? css.length : end + 1;
        out += ' ';
        continue;
      }
      out += ch;
    }
    return out;
  }

  /**
   * If the text is a rule (`sel { ... }`), return what is between its braces;
   * otherwise return it unchanged. Only the first rule is read.
   */
  function ruleBody(css) {
    var quote = '';
    var open = -1;
    var depth = 0;
    for (var i = 0; i < css.length; i++) {
      var ch = css.charAt(i);
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === '\'') { quote = ch; continue; }
      if (ch === '{') {
        if (open === -1) open = i;
        depth++;
      } else if (ch === '}' && open !== -1) {
        depth--;
        if (depth === 0) return css.slice(open + 1, i);
      }
    }
    return open === -1 ? css : css.slice(open + 1);
  }

  /** Split on `;` that is outside strings and parentheses. */
  function splitDeclarations(body) {
    var parts = [];
    var quote = '';
    var depth = 0;
    var start = 0;
    for (var i = 0; i < body.length; i++) {
      var ch = body.charAt(i);
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === '\'') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') { if (depth > 0) depth--; }
      else if (ch === ';' && depth === 0) {
        parts.push(body.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(body.slice(start));
    return parts;
  }

  // ─── parse ────────────────────────────────────────────────────────────────

  /**
   * Read CSS declarations into [{ property, value, important }], in order.
   *
   * Accepts a bare declaration list or one rule (`sel { ... }`); comments are
   * dropped, whitespace is collapsed, property names are lower-cased (custom
   * properties keep their case), and pieces with no colon, no name or no value
   * are skipped. Nothing is validated — that is sanitize()'s job.
   */
  function parse(css) {
    var out = [];
    if (css === null || css === undefined) return out;
    var pieces = splitDeclarations(ruleBody(stripComments(String(css))));
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      var colon = piece.indexOf(':');
      if (colon === -1) continue;
      var property = collapse(trim(piece.slice(0, colon)));
      if (property.slice(0, 2) !== '--') property = asciiLower(property);
      var value = collapse(trim(piece.slice(colon + 1)));
      var important = false;
      if (IMPORTANT_RE.test(value)) {
        important = true;
        value = trim(value.replace(IMPORTANT_RE, ''));
      }
      if (!property || !value) continue;
      out.push({ property: property, value: value, important: important });
    }
    return out;
  }

  // ─── stringify ────────────────────────────────────────────────────────────

  /**
   * Write declarations back out.
   *
   * options.pretty (default true): one declaration per line; false puts them
   * on one line separated by spaces.
   * options.selector: wrap them in `selector { ... }`.
   * An empty list is always an empty string, selector or not.
   */
  function stringify(decls, options) {
    options = options || {};
    var pretty = options.pretty !== false;
    var selector = options.selector ? checkSelector(options.selector) : '';
    var lines = [];
    for (var i = 0; i < (decls || []).length; i++) {
      var d = decls[i];
      lines.push(d.property + ': ' + d.value + (d.important ? ' !important' : '') + ';');
    }
    if (!lines.length) return '';
    if (!selector) return lines.join(pretty ? '\n' : ' ');
    if (pretty) return selector + ' {\n  ' + lines.join('\n  ') + '\n}';
    return selector + ' { ' + lines.join(' ') + ' }';
  }

  /** A selector is the caller's, not the user's — refuse rather than repair. */
  function checkSelector(selector) {
    var s = collapse(trim(String(selector)));
    if (!s || /[{}<;\\]/.test(s) || s.indexOf('/*') !== -1 || /[\u0000-\u001f\u007f]/.test(s)) {
      throw new Error('kStyleCss: invalid selector "' + selector + '"');
    }
    return s;
  }

  // ─── sanitize ─────────────────────────────────────────────────────────────

  function isAllowed(property, allow) {
    if (allow === '*') return true;
    for (var i = 0; i < allow.length; i++) {
      var entry = allow[i];
      if (entry === '*') return true;
      if (entry.charAt(entry.length - 1) === '*') {
        if (property.indexOf(entry.slice(0, -1)) === 0) return true;
      } else if (entry === property) {
        return true;
      }
    }
    return false;
  }

  /** Quotes closed, parentheses balanced, nothing that can end the block. */
  function isSafeValue(value) {
    if (/[{}<>\\]/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return false;
    var quote = '';
    var depth = 0;
    for (var i = 0; i < value.length; i++) {
      var ch = value.charAt(i);
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === '\'') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth < 0) return false; }
    }
    if (quote || depth !== 0) return false;
    var squashed = asciiLower(value).replace(/ /g, '');
    for (var j = 0; j < BAD_FRAGMENTS.length; j++) {
      if (squashed.indexOf(BAD_FRAGMENTS[j]) !== -1) return false;
    }
    return true;
  }

  /** The address inside every url(...) in a value. */
  function urls(value) {
    var found = [];
    var lower = asciiLower(value);
    var at = lower.indexOf('url(');
    while (at !== -1) {
      var i = at + 4;
      while (i < value.length && value.charAt(i) === ' ') i++;
      var ch = value.charAt(i);
      var end;
      if (ch === '"' || ch === '\'') {
        end = value.indexOf(ch, i + 1);
        if (end === -1) end = value.length;
        found.push(value.slice(i + 1, end));
      } else {
        end = value.indexOf(')', i);
        if (end === -1) end = value.length;
        found.push(trim(value.slice(i, end)));
      }
      at = lower.indexOf('url(', end);
    }
    return found;
  }

  function isSafeUrl(url) {
    var u = asciiLower(trim(url));
    if (!SCHEME_RE.test(u)) return true; // relative, root-relative or //host
    if (u.indexOf('http:') === 0 || u.indexOf('https:') === 0) return true;
    for (var i = 0; i < DATA_IMAGES.length; i++) {
      var p = DATA_IMAGES[i];
      if (u.indexOf(p) === 0 && (u.charAt(p.length) === ';' || u.charAt(p.length) === ',')) return true;
    }
    return false;
  }

  /** Why a declaration would be refused, or '' if it would be kept. */
  function reject(decl, allow) {
    var p = decl.property;
    if (!PROPERTY_RE.test(p) && !CUSTOM_PROPERTY_RE.test(p)) return 'property';
    if (BLOCKED.indexOf(p) !== -1) return 'blocked';
    if (!isAllowed(p, allow)) return 'not-allowed';
    if (!isSafeValue(decl.value)) return 'value';
    var list = urls(decl.value);
    for (var i = 0; i < list.length; i++) if (!isSafeUrl(list[i])) return 'url';
    return '';
  }

  /**
   * Split CSS into what sanitize() would keep and what it would drop.
   * Returns { declarations: [...], rejected: [{ property, value, reason }] }.
   * Reasons: property, blocked, not-allowed, value, url.
   */
  function clean(css, options) {
    options = options || {};
    var allow = options.allow === undefined || options.allow === null ? DEFAULT_ALLOW : options.allow;
    var kept = [];
    var rejected = [];
    var decls = parse(css);
    for (var i = 0; i < decls.length; i++) {
      var why = reject(decls[i], allow);
      if (why) rejected.push({ property: decls[i].property, value: decls[i].value, reason: why });
      else kept.push(decls[i]);
    }
    return { declarations: kept, rejected: rejected };
  }

  /**
   * Untrusted CSS in, safe CSS out.
   *
   * options.allow: property names to keep (default DEFAULT_ALLOW). A trailing
   * `*` is a prefix match (`'border-*'`); `'*'` keeps any well-formed name.
   * options.selector / options.pretty: as stringify().
   */
  function sanitize(css, options) {
    options = options || {};
    return stringify(clean(css, options).declarations, options);
  }

  return {
    VERSION: VERSION,
    DEFAULT_ALLOW: DEFAULT_ALLOW.slice(),
    parse: parse,
    stringify: stringify,
    clean: clean,
    sanitize: sanitize
  };
}));
