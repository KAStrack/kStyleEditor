/*!
 * kStyleEditor 0.1.2
 * A zero-dependency visual CSS editor that takes over a <textarea>.
 * MIT Licence. https://github.com/KAStrack/kStyleEditor
 *
 * Requires k-style-css.js to be loaded first (or use the k-style bundle).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./k-style-css.js'));
  } else {
    if (!root.KStyleCss) {
      throw new Error('kStyleEditor: load k-style-css.js before k-style-editor.js');
    }
    root.KStyleEditor = factory(root.KStyleCss);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (KStyleCss) {
  'use strict';

  var VERSION = '0.1.2';

  // The property on a <textarea> that points back at its editor. It is how
  // get() and detach() find an instance whose attach() return value was lost,
  // and how attach() knows to replace one. Visible in devtools as
  // $0.kStyleEditor, which is deliberate.
  var HANDLE = 'kStyleEditor';

  var uid = 0;
  function nextId() { uid += 1; return 'kse-' + uid; }

  // ─── DOM and value helpers ────────────────────────────────────────────────

  function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        if (k === 'text') node.textContent = attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  // Every button is type="button": the editor usually sits inside the form it
  // is styling, and a bare <button> there would submit it.
  function button(className, text, attrs) {
    return el('button', className, extend({ type: 'button', text: text }, attrs));
  }

  function textInput(className, attrs) {
    return el('input', className, extend({ type: 'text', spellcheck: 'false', autocomplete: 'off' }, attrs));
  }

  function resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    return target.nodeType === 1 ? target : null;
  }

  function trim(s) { return String(s === null || s === undefined ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function indexOf(list, item) {
    for (var i = 0; i < list.length; i++) if (list[i] === item) return i;
    return -1;
  }

  function list(value) {
    if (value === null || value === undefined || value === false) return null;
    if (typeof value === 'string') {
      return value.split(',').map(trim).filter(function (s) { return s !== ''; });
    }
    return value.slice();
  }

  /**
   * Split a value on spaces or commas that sit outside parentheses and
   * quotes: `1px solid rgb(0, 0, 0)` is three tokens, not five.
   */
  function splitTop(value, sep) {
    var out = [];
    var depth = 0;
    var quote = '';
    var start = 0;
    var s = String(value);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === '\'') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    out.push(s.slice(start));
    return out.map(trim).filter(function (t) { return t !== ''; });
  }

  var NUMBER_RE = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

  function isLength(token) { return NUMBER_RE.test(token); }

  /** 1.50000001 → "1.5"; keeps what people typed from growing digits. */
  function tidyNumber(n) {
    var x = Math.round(parseFloat(n) * 10000) / 10000;
    return isNaN(x) ? '' : String(x);
  }

  // The native colour input only speaks #rrggbb. A canvas normalises any
  // colour the browser understands; anything it does not (var(), currentColor)
  // leaves the sentinel in place and the swatch shows as unknown.
  var colourCtx = null;
  function toHex(value) {
    if (!value) return null;
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    if (!colourCtx) {
      try { colourCtx = document.createElement('canvas').getContext('2d'); } catch (e) { colourCtx = null; }
      if (!colourCtx) return null;
    }
    colourCtx.fillStyle = '#010203';
    colourCtx.fillStyle = value;
    var a = colourCtx.fillStyle;
    colourCtx.fillStyle = '#030201';
    colourCtx.fillStyle = value;
    if (a !== colourCtx.fillStyle) return null;
    if (/^#[0-9a-f]{6}$/i.test(a)) return a;
    var m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(a);
    if (!m) return null;
    // Fully transparent has no colour to show; reporting it as black would
    // start the native picker on black.
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return '#' + [m[1], m[2], m[3]].map(function (n) {
      var h = parseInt(n, 10).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  // ─── Labels ───────────────────────────────────────────────────────────────
  //
  // Every string the editor shows. Pass `labels` to translate or reword any of
  // them. Control and field titles live apart, in `labels.controls`, keyed by
  // control id (`padding`) and by `id.key` (`font.size`), so a control id can
  // never collide with an interface string. The texts of a field's options go
  // in `labels.options`, keyed by `id.key` and then by option value.
  var DEFAULT_LABELS = {
    basic: 'Basic',
    advanced: 'Advanced',
    code: 'Code',
    preview: 'Preview',
    previewText: 'The quick brown fox jumps over the lazy dog.',
    unset: 'Default',
    inherited: 'Inherited: {value}',
    useInherited: 'Use inherited ({value})',
    inheritedOption: 'Default ({value})',
    custom: 'Custom\u2026',
    customHint: 'Custom value',
    reset: 'Reset',
    resetNamed: 'Reset {name}',
    link: 'Same value for every side',
    all: 'All',
    top: 'Top',
    right: 'Right',
    bottom: 'Bottom',
    left: 'Left',
    topLeft: 'Top left',
    topRight: 'Top right',
    bottomRight: 'Bottom right',
    bottomLeft: 'Bottom left',
    width: 'Width',
    style: 'Style',
    colour: 'Colour',
    chooseColour: 'Choose a colour',
    palette: 'Colours',
    customColour: 'Custom colour\u2026',
    x: 'X',
    y: 'Y',
    blur: 'Blur',
    spread: 'Spread',
    inset: 'Inset',
    imageType: 'Type',
    none: 'None',
    imageUrl: 'Image URL',
    linearGradient: 'Linear gradient',
    radialGradient: 'Radial gradient',
    url: 'URL',
    angle: 'Angle',
    from: 'From',
    to: 'To',
    filter: 'Filter properties',
    noMatches: 'No properties match.',
    codeOnly: '{n} more declaration(s) can only be edited as code.',
    codeOnlyNoTab: '{n} more declaration(s) are kept as they are.',
    openCode: 'Open Code',
    codeLabel: 'CSS declarations',
    codeHelp: 'One declaration per line, e.g. color: #333;',
    rejected: 'A server using the kStyleEditor SDK would drop:',
    dropped: 'Not editable here, so left out of the saved CSS:',
    reasons: {
      property: 'not a valid property name',
      blocked: 'never allowed',
      'not-allowed': 'not on the allow-list',
      value: 'unsafe or malformed value',
      url: 'URL scheme not allowed'
    },
    controls: {},
    options: {},
    sections: {
      typography: 'Typography',
      spacing: 'Spacing',
      background: 'Background',
      border: 'Border',
      size: 'Size',
      layout: 'Layout',
      flex: 'Flex & grid',
      position: 'Position',
      effects: 'Effects',
      interaction: 'Interaction',
      other: 'Other'
    }
  };

  function fill(text, values) {
    return String(text).replace(/\{(\w+)\}/g, function (m, k) {
      return values[k] === undefined ? m : values[k];
    });
  }

  // ─── Built-in controls ────────────────────────────────────────────────────
  //
  // A control is a titled row in the editor; it holds one or more fields, and
  // each field edits one CSS property (or one shorthand and its longhands). The
  // field `type` picks the widget: color, length, select, font, text, range,
  // box, stroke, shadow, functions or image.

  var SECTIONS = ['typography', 'spacing', 'background', 'border', 'size', 'layout',
    'flex', 'position', 'effects', 'interaction', 'other'];

  var CONTROLS = {};
  var CONTROL_ORDER = [];

  function registerControl(def) {
    if (!def || !def.id || !def.fields || !def.fields.length) {
      throw new Error('kStyleEditor: a control needs an id and at least one field');
    }
    var copy = extend({ section: 'other' }, def);
    if (!CONTROLS[def.id]) CONTROL_ORDER.push(def.id);
    CONTROLS[def.id] = copy;
    return copy;
  }

  function control(id, label, section, fields) {
    registerControl({ id: id, label: label, section: section, fields: fields });
  }

  function one(type, prop, extra) { return [extend({ type: type, prop: prop }, extra)]; }

  var LENGTH = ['px', 'em', 'rem', '%'];
  var SIZE_UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh'];
  var SIZE_KEYWORDS = ['auto', 'fit-content', 'min-content', 'max-content'];

  // Typography
  control('color', 'Colour', 'typography', one('color', 'color'));
  control('font', 'Font', 'typography', [
    { type: 'font', prop: 'font-family', key: 'family', label: 'Family' },
    { type: 'length', prop: 'font-size', key: 'size', label: 'Size', units: ['px', 'em', 'rem', '%', 'pt'] },
    { type: 'select', prop: 'font-weight', key: 'weight', label: 'Weight', options: [
      ['100', '100 Thin'], ['200', '200 Extra light'], ['300', '300 Light'], ['400', '400 Normal'],
      ['500', '500 Medium'], ['600', '600 Semi-bold'], ['700', '700 Bold'], ['800', '800 Extra bold'],
      ['900', '900 Black'], 'normal', 'bold', 'lighter', 'bolder'
    ] },
    { type: 'select', prop: 'font-style', key: 'style', label: 'Style', options: ['normal', 'italic', 'oblique'] }
  ]);
  control('lineHeight', 'Line height', 'typography',
    one('length', 'line-height', { units: ['', 'px', 'em', 'rem', '%'], keywords: ['normal'] }));
  control('letterSpacing', 'Letter spacing', 'typography',
    one('length', 'letter-spacing', { units: ['px', 'em', 'rem'], keywords: ['normal'] }));
  control('wordSpacing', 'Word spacing', 'typography',
    one('length', 'word-spacing', { units: ['px', 'em', 'rem'], keywords: ['normal'] }));
  control('textAlign', 'Text align', 'typography',
    one('select', 'text-align', { options: ['left', 'center', 'right', 'justify', 'start', 'end'] }));
  control('textTransform', 'Text case', 'typography',
    one('select', 'text-transform', { options: ['none', 'capitalize', 'uppercase', 'lowercase'] }));
  control('textDecoration', 'Decoration', 'typography', [
    { type: 'select', prop: 'text-decoration-line', key: 'line', label: 'Line',
      options: ['none', 'underline', 'overline', 'line-through', 'underline overline'] },
    { type: 'select', prop: 'text-decoration-style', key: 'style', label: 'Style',
      options: ['solid', 'double', 'dotted', 'dashed', 'wavy'] },
    { type: 'color', prop: 'text-decoration-color', key: 'colour', label: 'Colour' },
    { type: 'length', prop: 'text-decoration-thickness', key: 'thickness', label: 'Thickness',
      units: ['px', 'em'], keywords: ['auto', 'from-font'] },
    { type: 'length', prop: 'text-underline-offset', key: 'offset', label: 'Offset',
      units: ['px', 'em'], keywords: ['auto'] }
  ]);
  control('textShadow', 'Text shadow', 'typography', one('shadow', 'text-shadow', { spread: false, inset: false }));
  control('textIndent', 'Indent', 'typography', one('length', 'text-indent', { units: LENGTH }));
  control('whiteSpace', 'White space', 'typography',
    one('select', 'white-space', { options: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'] }));
  control('wordBreak', 'Word break', 'typography',
    one('select', 'word-break', { options: ['normal', 'break-all', 'keep-all', 'break-word'] }));
  control('overflowWrap', 'Overflow wrap', 'typography',
    one('select', 'overflow-wrap', { options: ['normal', 'break-word', 'anywhere'] }));
  control('verticalAlign', 'Vertical align', 'typography',
    one('select', 'vertical-align', { options: ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom', 'sub', 'super'] }));
  control('fontVariant', 'Font variant', 'typography',
    one('select', 'font-variant', { options: ['normal', 'small-caps', 'all-small-caps'] }));

  // Spacing
  control('padding', 'Padding', 'spacing', one('box', 'padding'));
  control('margin', 'Margin', 'spacing', one('box', 'margin', { keywords: ['auto'] }));

  // Background
  control('background', 'Background', 'background', one('color', 'background-color'));
  control('backgroundImage', 'Background image', 'background', one('image', 'background-image'));
  control('backgroundSize', 'Background size', 'background',
    one('select', 'background-size', { options: ['auto', 'cover', 'contain', '100% 100%'], custom: true }));
  control('backgroundPosition', 'Background position', 'background',
    one('select', 'background-position', { options: ['center', 'top', 'bottom', 'left', 'right',
      'left top', 'right top', 'left bottom', 'right bottom'], custom: true }));
  control('backgroundRepeat', 'Background repeat', 'background',
    one('select', 'background-repeat', { options: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round'] }));
  control('backgroundAttachment', 'Background scroll', 'background',
    one('select', 'background-attachment', { options: ['scroll', 'fixed', 'local'] }));

  // Border
  control('border', 'Border', 'border', one('stroke', 'border', { sides: true }));
  control('borderRadius', 'Corner radius', 'border', one('box', 'border-radius', { corners: true, units: ['px', '%', 'em', 'rem'] }));
  control('outline', 'Outline', 'border', [
    { type: 'stroke', prop: 'outline' },
    { type: 'length', prop: 'outline-offset', key: 'offset', label: 'Offset', units: ['px', 'em', 'rem'] }
  ]);

  // Size
  control('width', 'Width', 'size', one('length', 'width', { units: SIZE_UNITS, keywords: SIZE_KEYWORDS }));
  control('height', 'Height', 'size', one('length', 'height', { units: SIZE_UNITS, keywords: SIZE_KEYWORDS }));
  control('minWidth', 'Min width', 'size', one('length', 'min-width', { units: SIZE_UNITS, keywords: SIZE_KEYWORDS }));
  control('maxWidth', 'Max width', 'size', one('length', 'max-width', { units: SIZE_UNITS, keywords: ['none'].concat(SIZE_KEYWORDS.slice(1)) }));
  control('minHeight', 'Min height', 'size', one('length', 'min-height', { units: SIZE_UNITS, keywords: SIZE_KEYWORDS }));
  control('maxHeight', 'Max height', 'size', one('length', 'max-height', { units: SIZE_UNITS, keywords: ['none'].concat(SIZE_KEYWORDS.slice(1)) }));
  control('boxSizing', 'Box sizing', 'size', one('select', 'box-sizing', { options: ['content-box', 'border-box'] }));
  control('aspectRatio', 'Aspect ratio', 'size',
    one('select', 'aspect-ratio', { options: ['auto', '1 / 1', '4 / 3', '3 / 2', '16 / 9', '9 / 16'], custom: true }));

  // Layout
  control('display', 'Display', 'layout', one('select', 'display', {
    options: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents', 'none']
  }));
  control('overflow', 'Overflow', 'layout', one('select', 'overflow', { options: ['visible', 'hidden', 'clip', 'scroll', 'auto'] }));
  control('float', 'Float', 'layout', one('select', 'float', { options: ['none', 'left', 'right'] }));
  control('clear', 'Clear', 'layout', one('select', 'clear', { options: ['none', 'left', 'right', 'both'] }));
  control('visibility', 'Visibility', 'layout', one('select', 'visibility', { options: ['visible', 'hidden', 'collapse'] }));

  // Flex & grid
  control('flexDirection', 'Direction', 'flex',
    one('select', 'flex-direction', { options: ['row', 'row-reverse', 'column', 'column-reverse'] }));
  control('flexWrap', 'Wrap', 'flex', one('select', 'flex-wrap', { options: ['nowrap', 'wrap', 'wrap-reverse'] }));
  control('justifyContent', 'Justify content', 'flex', one('select', 'justify-content', {
    options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'start', 'end', 'stretch']
  }));
  control('alignItems', 'Align items', 'flex', one('select', 'align-items', {
    options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline', 'start', 'end']
  }));
  control('alignContent', 'Align content', 'flex', one('select', 'align-content', {
    options: ['normal', 'stretch', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']
  }));
  control('gap', 'Gap', 'flex', one('length', 'gap', { units: LENGTH, keywords: ['normal'] }));
  control('flex', 'Flex item', 'flex', [
    { type: 'length', prop: 'flex-grow', key: 'grow', label: 'Grow', units: [''] },
    { type: 'length', prop: 'flex-shrink', key: 'shrink', label: 'Shrink', units: [''] },
    { type: 'length', prop: 'flex-basis', key: 'basis', label: 'Basis', units: SIZE_UNITS, keywords: ['auto', 'content'] }
  ]);
  control('alignSelf', 'Align self', 'flex', one('select', 'align-self', {
    options: ['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline', 'start', 'end']
  }));
  control('order', 'Order', 'flex', one('length', 'order', { units: [''] }));
  control('gridTemplateColumns', 'Grid columns', 'flex', one('text', 'grid-template-columns', {
    suggestions: ['1fr 1fr', '1fr 1fr 1fr', 'repeat(4, 1fr)', 'auto 1fr', 'repeat(auto-fit, minmax(200px, 1fr))']
  }));
  control('gridTemplateRows', 'Grid rows', 'flex', one('text', 'grid-template-rows', {
    suggestions: ['auto', 'auto 1fr', 'auto 1fr auto', 'repeat(3, 1fr)']
  }));

  // Position
  control('position', 'Position', 'position',
    one('select', 'position', { options: ['static', 'relative', 'absolute', 'fixed', 'sticky'] }));
  control('inset', 'Offsets', 'position', one('box', 'inset', { shorthand: false, keywords: ['auto'] }));
  control('zIndex', 'Stack order', 'position', one('length', 'z-index', { units: [''], keywords: ['auto'] }));

  // Effects
  control('opacity', 'Opacity', 'effects', one('range', 'opacity', { min: 0, max: 1, step: 0.01 }));
  control('boxShadow', 'Shadow', 'effects', one('shadow', 'box-shadow'));
  control('transform', 'Transform', 'effects', one('functions', 'transform', { functions: [
    { name: 'translateX', label: 'Move X', units: ['px', '%', 'em', 'rem'] },
    { name: 'translateY', label: 'Move Y', units: ['px', '%', 'em', 'rem'] },
    { name: 'rotate', label: 'Rotate', units: ['deg', 'turn'] },
    { name: 'scale', label: 'Scale', units: [''] },
    { name: 'skewX', label: 'Skew X', units: ['deg'] },
    { name: 'skewY', label: 'Skew Y', units: ['deg'] }
  ] }));
  control('filter', 'Filter', 'effects', one('functions', 'filter', { functions: [
    { name: 'blur', label: 'Blur', units: ['px', 'em', 'rem'] },
    { name: 'brightness', label: 'Brightness', units: ['%', ''] },
    { name: 'contrast', label: 'Contrast', units: ['%', ''] },
    { name: 'grayscale', label: 'Greyscale', units: ['%', ''] },
    { name: 'saturate', label: 'Saturate', units: ['%', ''] },
    { name: 'sepia', label: 'Sepia', units: ['%', ''] },
    { name: 'invert', label: 'Invert', units: ['%', ''] },
    { name: 'hue-rotate', label: 'Hue', units: ['deg', 'turn'] }
  ] }));
  control('mixBlendMode', 'Blend mode', 'effects', one('select', 'mix-blend-mode', {
    options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
      'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']
  }));
  control('transition', 'Transition', 'effects', one('text', 'transition', {
    suggestions: ['all 0.2s ease', 'all 0.3s ease-in-out', 'opacity 0.2s linear', 'transform 0.3s ease-out', 'none']
  }));

  // Interaction
  control('cursor', 'Cursor', 'interaction', one('select', 'cursor', {
    options: ['auto', 'default', 'pointer', 'text', 'move', 'grab', 'not-allowed', 'help', 'wait', 'crosshair'], custom: true
  }));
  control('pointerEvents', 'Pointer events', 'interaction', one('select', 'pointer-events', { options: ['auto', 'none'] }));
  control('userSelect', 'Text selection', 'interaction', one('select', 'user-select', { options: ['auto', 'none', 'text', 'all'] }));
  control('listStyle', 'List style', 'interaction', [
    { type: 'select', prop: 'list-style-type', key: 'type', label: 'Marker', options: ['disc', 'circle', 'square', 'decimal',
      'decimal-leading-zero', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman', 'none'] },
    { type: 'select', prop: 'list-style-position', key: 'position', label: 'Position', options: ['outside', 'inside'] }
  ]);

  var DEFAULT_BASIC = ['color', 'font', 'background', 'padding', 'margin'];
  var DEFAULT_ADVANCED = [
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform', 'textDecoration',
    'textShadow', 'textIndent', 'whiteSpace', 'wordBreak', 'overflowWrap', 'verticalAlign', 'fontVariant',
    'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundAttachment',
    'border', 'borderRadius', 'outline',
    'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'boxSizing', 'aspectRatio',
    'display', 'overflow', 'float', 'clear', 'visibility',
    'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent', 'gap', 'flex',
    'alignSelf', 'order', 'gridTemplateColumns', 'gridTemplateRows',
    'position', 'inset', 'zIndex',
    'opacity', 'boxShadow', 'transform', 'filter', 'mixBlendMode', 'transition',
    'cursor', 'pointerEvents', 'userSelect', 'listStyle'
  ];

  var DEFAULT_FONTS = [
    { label: 'System', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    { label: 'Sans-serif', value: 'Helvetica, Arial, sans-serif' },
    { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Monospace', value: 'ui-monospace, Menlo, Consolas, monospace' },
    { label: 'Inherit', value: 'inherit' }
  ];

  // Three rows a non-designer can pick from: neutrals, strong colours, and
  // light tints of the same hues for backgrounds.
  var DEFAULT_PALETTE = [
    ['#000000', 'Black'], ['#374151', 'Dark grey'], ['#6b7280', 'Grey'], ['#9ca3af', 'Mid grey'],
    ['#d1d5db', 'Light grey'], ['#f3f4f6', 'Off-white'], ['#ffffff', 'White'], ['transparent', 'Transparent'],
    ['#dc2626', 'Red'], ['#ea580c', 'Orange'], ['#f59e0b', 'Amber'], ['#16a34a', 'Green'],
    ['#0d9488', 'Teal'], ['#2563eb', 'Blue'], ['#7c3aed', 'Violet'], ['#db2777', 'Pink'],
    ['#fee2e2', 'Light red'], ['#ffedd5', 'Light orange'], ['#fef3c7', 'Light amber'], ['#dcfce7', 'Light green'],
    ['#ccfbf1', 'Light teal'], ['#dbeafe', 'Light blue'], ['#ede9fe', 'Light violet'], ['#fce7f3', 'Light pink']
  ];

  // ─── Options ──────────────────────────────────────────────────────────────

  var DEFAULTS = {
    /* Control ids on the Basic tab, in order. An array or a comma list. */
    basic: DEFAULT_BASIC,
    /* Control ids on the Advanced tab, grouped into sections. false (or an
       empty list) removes the tab. */
    advanced: DEFAULT_ADVANCED,
    /* Extra or replacement controls for this editor only: { id: definition }
       or an array of definitions. Same shape as registerControl(). */
    controls: null,
    /* Wrap the saved CSS in `selector { ... }`. null saves bare declarations. */
    selector: null,
    /* One declaration per line (true) or all on one line (false). */
    pretty: true,
    /* Drop declarations that none of the enabled controls can edit. Without
       it, anything typed in the Code tab is kept. */
    strict: false,
    /* Also drop what KStyleCss.sanitize() would reject (see `allow`). */
    sanitize: false,
    /* The allow-list the Code tab warns against (and `sanitize` enforces):
       null for KStyleCss.DEFAULT_ALLOW, an array, '*', or false for no
       warnings at all. */
    allow: null,
    /* false: no preview. true: a preview box inside the editor. An element or
       selector: that element is restyled live, and put back on destroy(). */
    preview: false,
    /* Content for the built-in preview box: a string (as text) or a Node. */
    previewContent: null,
    /* Show the Code tab. */
    code: true,
    /* 'basic', 'advanced' or 'code'. */
    startTab: 'basic',
    /* Hide the original textarea. */
    hideTextarea: true,
    /* Units offered by length fields that do not name their own. */
    units: LENGTH,
    /* Font stacks for the Font control: strings or { label, value }. */
    fonts: DEFAULT_FONTS,
    /* The palette every colour field opens: colours as strings, or
       [value, label] / { value, label } so each has a readable name. null
       for the built-in 24; false for no palette, only Custom colour. */
    swatches: null,
    /* Open the Advanced sections that already hold a value. */
    openSetSections: true,
    /* null follows the page (prefers-color-scheme); 'light' or 'dark' pins it. */
    theme: null,
    /* Show everything, change nothing. */
    readOnly: false,
    /* Override any of DEFAULT_LABELS. */
    labels: null,
    /* What each property shows while the editor does not set it, e.g. the
       value a theme gives it: { property: value } (custom properties keyed
       as written) or a function (property) => value. Display only: it is
       never saved. setInherited() replaces it. */
    inherited: null,
    /* Called with (css, payload) after every change. */
    onChange: null
  };

  // ─── Field widgets ────────────────────────────────────────────────────────
  //
  // The small inputs every field type is built from. Each returns
  // { el, set(value) → bool, get() → string }; set() returns false when it
  // cannot show the value, and the field falls back to a plain text box so
  // nothing the user typed elsewhere is lost or rewritten.

  // A visually hidden "Inherited: ..." that the inputs point at with
  // aria-describedby, so a screen reader hears what the placeholder shows.
  // It goes in beside the first input once that is in the page (a <select>
  // cannot hold it), and is emptied rather than removed.
  function inheritNote(targets, L) {
    var note = null;
    return function (value) {
      if (!value && !note) return;
      if (!note) note = el('span', 'kse-visually-hidden', { id: nextId() });
      if (!note.parentNode && targets[0].parentNode) targets[0].parentNode.insertBefore(note, targets[0].nextSibling);
      note.textContent = value ? fill(L.inherited, { value: value }) : '';
      targets.forEach(function (t) {
        if (value) t.setAttribute('aria-describedby', note.id);
        else t.removeAttribute('aria-describedby');
      });
    };
  }

  function placeholder(input, text) {
    if (text) input.placeholder = text;
    else input.removeAttribute('placeholder');
  }

  function lengthWidget(ctx, opts) {
    var units = opts.units || ctx.options.units || LENGTH;
    var keywords = opts.keywords || [];
    var wrap = el('span', 'kse-length');
    var num = el('input', 'kse-num', {
      type: 'text', inputmode: 'decimal', id: opts.id || null, 'aria-label': opts.ariaLabel || null,
      autocomplete: 'off', placeholder: opts.placeholder || ''
    });
    var unit = null;
    var lastUnit = units[0];
    wrap.appendChild(num);

    var plain = units.length === 1 && !keywords.length;
    if (plain) {
      if (units[0]) wrap.appendChild(el('span', 'kse-unit-fixed', { text: units[0], 'aria-hidden': 'true' }));
    } else {
      unit = el('select', 'kse-unit', { 'aria-label': (opts.ariaLabel ? opts.ariaLabel + ' ' : '') + 'unit' });
      units.forEach(function (u) { unit.appendChild(el('option', null, { value: u, text: u || '\u2013' })); });
      if (keywords.length) {
        var group = el('optgroup', null, { label: '\u2014' });
        keywords.forEach(function (k) { group.appendChild(el('option', null, { value: k, text: k })); });
        unit.appendChild(group);
      }
      wrap.appendChild(unit);
    }

    // What shows while nothing is set (the `inherited` option): its number
    // as the placeholder, and its unit in the unit select so a number typed
    // over it keeps that unit. Never part of get().
    var inh = { text: '', num: '', unit: null };
    var describe = inheritNote([num], ctx.labels);

    function isKeyword(v) { return indexOf(keywords, v) !== -1; }

    function hasUnit(u) {
      for (var i = 0; i < unit.options.length; i++) if (unit.options[i].value === u) return true;
      return false;
    }

    // The bare number only while the unit beside it is the inherited one;
    // otherwise the whole value, so "16" never sits next to "em".
    function hint() {
      if (!inh.text) return opts.placeholder || '';
      if (inh.num !== '' && (inh.unit === null || !unit || unit.value === inh.unit)) return inh.num;
      return inh.text;
    }

    function sync() {
      var kw = unit && isKeyword(unit.value);
      num.disabled = !!(kw || ctx.readOnly);
      wrap.setAttribute('data-keyword', kw ? 'true' : 'false');
      if (kw) num.value = '';
      num.placeholder = hint();
    }

    function addUnit(u) {
      if (!unit) return false;
      if (hasUnit(u)) return true;
      unit.insertBefore(el('option', null, { value: u, text: u }), unit.firstChild.nextSibling || null);
      return true;
    }

    // Arrow keys step by 1, or 0.1 for em/rem/unitless, ×10 with Shift.
    // Done by hand because a native number input inside the host form would
    // join that form's validation and could block it from submitting.
    num.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      var u = unit ? unit.value : units[0];
      var step = opts.step || (/^(em|rem|turn|)$/.test(u) ? 0.1 : 1);
      if (e.shiftKey) step *= 10;
      var n = parseFloat(num.value);
      // From an empty box, step from the inherited number it shows.
      if (isNaN(n)) n = trim(num.value) === '' && inh.num !== '' && num.placeholder === inh.num ? parseFloat(inh.num) : 0;
      num.value = tidyNumber(n + (e.key === 'ArrowUp' ? step : -step));
      opts.onChange();
    });
    num.addEventListener('input', function () { opts.onChange(); });
    if (unit) {
      unit.addEventListener('change', function () {
        if (!isKeyword(unit.value)) lastUnit = unit.value;
        sync();
        opts.onChange();
      });
    }

    return {
      el: wrap,
      focus: num,
      set: function (v) {
        v = trim(v);
        if (v === '') {
          num.value = '';
          if (unit) unit.value = inh.unit !== null ? inh.unit : lastUnit;
          sync();
          return true;
        }
        if (isKeyword(v)) { unit.value = v; sync(); return true; }
        var m = NUMBER_RE.exec(v);
        if (!m) return false;
        var u = m[2].toLowerCase();
        if (u === '' && parseFloat(m[1]) === 0 && indexOf(units, '') === -1) u = lastUnit;
        if (indexOf(units, u) === -1 && !addUnit(u)) return false;
        num.value = m[1];
        if (unit) { unit.value = u; lastUnit = u; }
        sync();
        return true;
      },
      get: function () {
        if (unit && isKeyword(unit.value)) return unit.value;
        var n = trim(num.value);
        if (n === '' || isNaN(parseFloat(n)) || !NUMBER_RE.test(n)) return '';
        var u = unit ? unit.value : units[0];
        return parseFloat(n) === 0 && u !== '%' && opts.zeroUnitless !== false ? '0' : n + u;
      },
      inherit: function (v) {
        v = trim(v);
        if (v === inh.text) return;
        inh = { text: v, num: '', unit: null };
        var m = NUMBER_RE.exec(v);
        if (m) {
          var u = m[2].toLowerCase();
          var zero = u === '' && parseFloat(m[1]) === 0;
          if (!unit) { if (u === units[0] || zero) inh.num = m[1]; }
          else if (zero && indexOf(units, '') === -1) inh.num = m[1];
          else if (hasUnit(u)) { inh.num = m[1]; inh.unit = u; }
        }
        if (unit && inh.unit !== null && trim(num.value) === '' && !isKeyword(unit.value)) unit.value = inh.unit;
        describe(v);
        sync();
      },
      disable: function (b) { num.disabled = b; if (unit) unit.disabled = b; }
    };
  }

  // Colour: a chip that opens a palette, plus a text box for anything else.
  //
  // The palette is the main way in: most people want "that blue", not a
  // colour space. The native picker is one step further ("Custom colour…")
  // and starts from the colour already showing, never from black.

  var openPalette = null;

  function closeOpenPalette(refocus) {
    if (openPalette) openPalette.close(refocus);
  }

  function colourWidget(ctx, opts) {
    var L = ctx.labels;
    var wrap = el('span', 'kse-colour');
    var chip = button('kse-swatch', '', {
      'aria-label': opts.ariaLabel ? L.chooseColour + ': ' + opts.ariaLabel : L.chooseColour,
      'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: L.chooseColour
    });
    var text = textInput('kse-colour-text', {
      id: opts.id || null, 'aria-label': opts.ariaLabel || null, placeholder: L.unset
    });
    // The native picker stays rendered (just invisible, under the chip) so
    // showPicker() works everywhere and the system dialog opens next to it.
    var picker = el('input', 'kse-picker', { type: 'color', tabindex: '-1', 'aria-hidden': 'true' });
    var pop = el('div', 'kse-palette', { role: 'dialog', 'aria-label': L.palette });
    pop.hidden = true;
    wrap.appendChild(chip);
    wrap.appendChild(picker);
    wrap.appendChild(text);
    wrap.appendChild(pop);

    var palette = ctx.options.swatches === false ? [] :
      normaliseOptions(ctx.options.swatches || DEFAULT_PALETTE);
    var grid = el('div', 'kse-palette-grid', { role: 'group', 'aria-label': L.palette });
    var cells = palette.map(function (c) {
      var b = button('kse-chip', '', { 'aria-label': c.label, title: c.label, 'data-value': c.value });
      b.style.setProperty('--kse-chip', c.value);
      b.addEventListener('click', function () { choose(c.value); });
      grid.appendChild(b);
      return b;
    });
    if (cells.length) pop.appendChild(grid);
    var actions = el('div', 'kse-palette-actions');
    var custom = button('kse-palette-btn', L.customColour);
    var clear = button('kse-palette-btn', L.unset);
    actions.appendChild(custom);
    actions.appendChild(clear);
    pop.appendChild(actions);

    // The colour this property has while nothing is set here (the
    // `inherited` option). An empty field draws its chip in it, marked
    // data-inherited; it is never written.
    var inherited = '';
    var describe = inheritNote([text, chip], L);

    function show(v) {
      var shown = v || inherited;
      var hex = toHex(shown);
      wrap.setAttribute('data-known', hex ? 'true' : 'false');
      wrap.style.setProperty('--kse-current', shown && (hex || /^transparent$/i.test(shown)) ? shown : 'transparent');
      wrap.setAttribute('data-empty', v ? 'false' : 'true');
      if (!v && inherited) wrap.setAttribute('data-inherited', 'true');
      else wrap.removeAttribute('data-inherited');
    }

    function choose(v) {
      text.value = v;
      show(v);
      opts.onChange();
      api.close(true);
    }

    // Where the native picker starts: the colour set here, else the
    // inherited one, else whatever the preview element is showing for this
    // property, else a friendly blue.
    function startColour() {
      return toHex(trim(text.value)) || toHex(inherited) ||
        toHex(ctx.computed ? ctx.computed(opts.prop) : '') || '#3b82f6';
    }

    function place() {
      // Open downwards unless that runs off the bottom of the viewport and
      // there is more room above.
      pop.removeAttribute('data-up');
      var r = chip.getBoundingClientRect();
      var h = pop.offsetHeight;
      if (r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0) pop.setAttribute('data-up', 'true');
    }

    function onDocDown(e) {
      if (!wrap.contains(e.target)) api.close(false);
    }

    var api = {
      wrap: wrap,
      open: function () {
        if (!pop.hidden) return;
        closeOpenPalette(false);
        var current = toHex(trim(text.value));
        var raw = trim(text.value).toLowerCase();
        cells.forEach(function (b) {
          var v = b.getAttribute('data-value');
          var on = raw !== '' && (v.toLowerCase() === raw || (current && toHex(v) === current));
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        pop.hidden = false;
        chip.setAttribute('aria-expanded', 'true');
        place();
        openPalette = api;
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('touchstart', onDocDown, true);
        var focus = grid.querySelector('[aria-pressed="true"]') || cells[0] || custom;
        focus.focus();
      },
      close: function (refocus) {
        if (pop.hidden) return;
        pop.hidden = true;
        chip.setAttribute('aria-expanded', 'false');
        if (openPalette === api) openPalette = null;
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('touchstart', onDocDown, true);
        if (refocus) chip.focus();
      }
    };

    chip.addEventListener('click', function () {
      if (pop.hidden) api.open();
      else api.close(true);
    });

    // Tabbing away closes it. A null relatedTarget (Safari does not focus a
    // clicked button) is left to the mousedown check, or a click on a colour
    // would close the palette before it landed.
    wrap.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !wrap.contains(e.relatedTarget)) api.close(false);
    });

    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        api.close(true);
        return;
      }
      // Arrow keys move around the grid; its column count comes from layout.
      var i = indexOf(cells, document.activeElement);
      if (i === -1) return;
      var cols = 1;
      while (cols < cells.length && cells[cols].offsetTop === cells[0].offsetTop) cols++;
      var next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: cells.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      if (next >= 0 && next < cells.length) cells[next].focus();
    });

    custom.addEventListener('click', function () {
      picker.value = startColour();
      api.close(false);
      try {
        if (typeof picker.showPicker === 'function') picker.showPicker();
        else picker.click();
      } catch (e) {
        picker.click();
      }
    });

    clear.addEventListener('click', function () { choose(''); });

    picker.addEventListener('input', function () {
      text.value = picker.value;
      show(picker.value);
      opts.onChange();
    });
    text.addEventListener('input', function () { show(trim(text.value)); opts.onChange(); });

    return {
      el: wrap,
      focus: text,
      set: function (v) { text.value = v; show(v); return true; },
      get: function () { return trim(text.value); },
      inherit: function (v) {
        v = trim(v);
        if (v === inherited) return;
        inherited = v;
        text.placeholder = v || L.unset;
        clear.textContent = v ? fill(L.useInherited, { value: v }) : L.unset;
        describe(v);
        show(trim(text.value));
      },
      disable: function (b) {
        if (b) api.close(false);
        chip.disabled = b;
        picker.disabled = b;
        text.disabled = b;
      }
    };
  }

  function normaliseOptions(options) {
    return (options || []).map(function (o) {
      if (typeof o === 'string') return { value: o, label: o };
      if (Object.prototype.toString.call(o) === '[object Array]') return { value: o[0], label: o[1] };
      return { value: o.value, label: o.label === undefined ? o.value : o.label };
    });
  }

  var CUSTOM = '\u0000custom';

  // `opts.labels` ({ value: text }) translates option texts; an option it does
  // not name keeps the label it was defined with.
  function selectWidget(ctx, opts) {
    var select = el('select', 'kse-select', { id: opts.id || null, 'aria-label': opts.ariaLabel || null });
    var options = normaliseOptions(opts.options);
    var texts = opts.labels || {};
    var unsetText = opts.unsetLabel || ctx.labels.unset;
    var blank = el('option', null, { value: '', text: unsetText });
    var inherited = '';
    var describe = inheritNote([select], ctx.labels);
    function textOf(o) {
      return Object.prototype.hasOwnProperty.call(texts, o.value) && texts[o.value] ? texts[o.value] : o.label;
    }
    // Font stacks are written many ways: ignore case, quote style and the
    // spaces after commas.
    function loose(v) { return String(v).toLowerCase().replace(/\s*,\s*/g, ',').replace(/'/g, '"'); }
    select.appendChild(blank);
    options.forEach(function (o) {
      var text = textOf(o);
      var node = el('option', null, { value: o.value, text: text });
      if (opts.styleOptions) node.style.fontFamily = o.value;
      select.appendChild(node);
    });
    if (opts.custom) select.appendChild(el('option', null, { value: CUSTOM, text: ctx.labels.custom }));

    select.addEventListener('change', function () {
      if (select.value === CUSTOM) { opts.onCustom(); return; }
      opts.onChange();
    });

    return {
      el: select,
      focus: select,
      set: function (v) {
        v = trim(v);
        for (var i = 0; i < select.options.length; i++) {
          if (select.options[i].value === v && v !== CUSTOM) { select.value = v; return true; }
        }
        return false;
      },
      get: function () { return select.value === CUSTOM ? '' : select.value; },
      // The empty option names what it falls back to: "Default (700 Bold)",
      // with the matching option's text, else the value as it is.
      inherit: function (v) {
        v = trim(v);
        if (v === inherited) return;
        inherited = v;
        var match = null;
        var i;
        for (i = 0; i < options.length && !match; i++) if (String(options[i].value) === v) match = options[i];
        for (i = 0; i < options.length && !match; i++) if (loose(options[i].value) === loose(v)) match = options[i];
        var label = match ? textOf(match) : v;
        blank.textContent = v ? fill(ctx.labels.inheritedOption, { value: label }) : unsetText;
        describe(v ? label : '');
      },
      disable: function (b) { select.disabled = b; }
    };
  }

  // ─── Field types ──────────────────────────────────────────────────────────
  //
  // A field type is `function (spec, ctx) → { el, props, refresh() }`.
  // `props` lists every property the field owns: it removes them all when it
  // writes. ctx.get(prop) reads the current value; ctx.commit(owned, decls)
  // replaces the owned properties with the new declarations.

  var FIELD_TYPES = {};

  function fieldShell(spec, ctx, cls) {
    var wrap = el('div', 'kse-field kse-field--' + spec.type + (cls ? ' ' + cls : ''));
    var id = nextId();
    var title = spec.label ? ctx.fieldLabel(spec) : '';
    var label = null;
    if (title) {
      label = el('label', 'kse-field-label', { text: title, 'for': id });
      wrap.appendChild(label);
    }
    return { wrap: wrap, id: id, label: label, aria: title || ctx.controlLabel };
  }

  /** A field that edits one property, falling back to a raw text box. */
  function singleField(spec, ctx, make) {
    var shell = fieldShell(spec, ctx);
    var raw = textInput('kse-raw', { id: shell.id + '-raw', 'aria-label': shell.aria, title: ctx.labels.customHint });
    var widget = make({
      id: shell.id,
      ariaLabel: shell.aria,
      onChange: function () { write(widget.get()); },
      onCustom: function () {
        showRaw(ctx.get(spec.prop));
        raw.focus();
      }
    });
    shell.wrap.appendChild(widget.el);
    shell.wrap.appendChild(raw);

    function write(v) {
      v = trim(v);
      ctx.commit([spec.prop], v ? [{ property: spec.prop, value: v }] : []);
    }
    function showRaw(v) {
      shell.wrap.setAttribute('data-raw', 'true');
      raw.value = v;
      if (shell.label) shell.label.setAttribute('for', raw.id);
    }
    function showNormal() {
      shell.wrap.removeAttribute('data-raw');
      if (shell.label) shell.label.setAttribute('for', shell.id);
    }

    raw.addEventListener('input', function () { write(raw.value); });
    raw.addEventListener('change', function () { if (widget.set(trim(raw.value))) showNormal(); });

    var describeRaw = inheritNote([raw], ctx.labels);
    function inherit() {
      var v = ctx.inherited(spec.prop);
      if (widget.inherit) widget.inherit(v);
      placeholder(raw, v);
      describeRaw(v);
    }

    return {
      el: shell.wrap,
      props: [spec.prop],
      refresh: function () {
        inherit();
        var v = ctx.get(spec.prop);
        if (widget.set(v)) showNormal();
        else showRaw(v);
      },
      inherit: inherit,
      disable: function (b) { widget.disable(b); raw.disabled = b; }
    };
  }

  FIELD_TYPES.color = function (spec, ctx) {
    return singleField(spec, ctx, function (o) { return colourWidget(ctx, extend({}, o, { prop: spec.prop })); });
  };

  FIELD_TYPES.length = function (spec, ctx) {
    return singleField(spec, ctx, function (o) {
      return lengthWidget(ctx, extend({}, o, { units: spec.units, keywords: spec.keywords, step: spec.step }));
    });
  };

  FIELD_TYPES.select = function (spec, ctx) {
    return singleField(spec, ctx, function (o) {
      return selectWidget(ctx, extend({}, o, { options: spec.options, custom: spec.custom, labels: ctx.optionLabels(spec) }));
    });
  };

  FIELD_TYPES.font = function (spec, ctx) {
    var fonts = (spec.fonts || ctx.options.fonts || DEFAULT_FONTS).map(function (f) {
      if (typeof f !== 'string') return f;
      return { label: f.split(',')[0].replace(/["']/g, ''), value: f };
    });
    return singleField(spec, ctx, function (o) {
      return selectWidget(ctx, extend({}, o, { options: fonts, custom: true, styleOptions: true, labels: ctx.optionLabels(spec) }));
    });
  };

  FIELD_TYPES.text = function (spec, ctx) {
    return singleField(spec, ctx, function (o) {
      var input = textInput('kse-text', { id: o.id, 'aria-label': o.ariaLabel, placeholder: spec.placeholder || '' });
      var wrap = el('span', 'kse-text-wrap');
      wrap.appendChild(input);
      if (spec.suggestions && spec.suggestions.length) {
        var listId = o.id + '-list';
        var dl = el('datalist', null, { id: listId });
        spec.suggestions.forEach(function (s) { dl.appendChild(el('option', null, { value: s })); });
        input.setAttribute('list', listId);
        wrap.appendChild(dl);
      }
      input.addEventListener('input', o.onChange);
      var describe = inheritNote([input], ctx.labels);
      return {
        el: wrap,
        set: function (v) { input.value = v; return true; },
        get: function () { return input.value; },
        // The field's own placeholder, when it has one, wins.
        inherit: function (v) { input.placeholder = spec.placeholder || v; describe(v); },
        disable: function (b) { input.disabled = b; }
      };
    });
  };

  FIELD_TYPES.range = function (spec, ctx) {
    var min = spec.min === undefined ? 0 : spec.min;
    var max = spec.max === undefined ? 1 : spec.max;
    var step = spec.step === undefined ? 0.01 : spec.step;
    return singleField(spec, ctx, function (o) {
      var wrap = el('span', 'kse-range');
      var slider = el('input', 'kse-slider', {
        type: 'range', min: min, max: max, step: step, 'aria-label': o.ariaLabel, tabindex: '-1'
      });
      var num = el('input', 'kse-num', { type: 'text', inputmode: 'decimal', id: o.id, 'aria-label': o.ariaLabel, placeholder: String(max) });
      wrap.appendChild(slider);
      wrap.appendChild(num);
      var describe = inheritNote([num], ctx.labels);
      function mark() { wrap.setAttribute('data-empty', trim(num.value) === '' ? 'true' : 'false'); }
      slider.addEventListener('input', function () { num.value = tidyNumber(slider.value); mark(); o.onChange(); });
      num.addEventListener('input', function () {
        var n = parseFloat(num.value);
        slider.value = isNaN(n) ? max : n;
        mark();
        o.onChange();
      });
      return {
        el: wrap,
        set: function (v) {
          if (v === '') { num.value = ''; slider.value = max; mark(); return true; }
          if (!/^-?(\d+\.?\d*|\.\d+)$/.test(v)) return false;
          num.value = v;
          slider.value = v;
          mark();
          return true;
        },
        get: function () {
          var n = trim(num.value);
          return n === '' || isNaN(parseFloat(n)) ? '' : tidyNumber(n);
        },
        // Only the number box shows it; the thumb stays where it is.
        inherit: function (v) { num.placeholder = v || String(max); describe(v); },
        disable: function (b) { slider.disabled = b; num.disabled = b; }
      };
    });
  };

  /**
   * A field that edits a shorthand through several inputs, falling back to a
   * raw text box for anything it cannot take apart. `make` builds the inputs
   * and returns { el, read() → bool, value() → string, disable(b) }.
   */
  function compoundField(spec, ctx, owned, make) {
    var shell = fieldShell(spec, ctx, 'kse-compound');
    var raw = textInput('kse-raw', { 'aria-label': shell.aria, title: ctx.labels.customHint });
    // A stroke edits one side at a time, so what it owns and writes can change.
    function write(v) {
      v = trim(v);
      ctx.commit(parts.owned ? parts.owned() : owned, v ? [{ property: parts.prop ? parts.prop() : spec.prop, value: v }] : []);
    }
    var parts = make(shell, function () { write(parts.value()); });
    if (shell.label && parts.focus) {
      if (!parts.focus.id) parts.focus.id = shell.id;
      shell.label.setAttribute('for', parts.focus.id);
    } else if (shell.label) {
      shell.label.removeAttribute('for');
    }
    shell.wrap.appendChild(parts.el);
    shell.wrap.appendChild(raw);

    raw.addEventListener('input', function () { write(raw.value); });
    raw.addEventListener('change', function () { if (parts.read()) shell.wrap.removeAttribute('data-raw'); });

    // Each part shows its piece of the inherited value (parts.inherit); the
    // raw box shows all of it.
    var describeRaw = inheritNote([raw], ctx.labels);
    function inherit() {
      var v = ctx.inherited(parts.prop ? parts.prop() : spec.prop);
      if (parts.inherit) parts.inherit();
      placeholder(raw, v);
      describeRaw(v);
    }

    return {
      el: shell.wrap,
      props: owned,
      inherit: inherit,
      refresh: function () {
        inherit();
        if (parts.read()) {
          shell.wrap.removeAttribute('data-raw');
        } else {
          shell.wrap.setAttribute('data-raw', 'true');
          raw.value = parts.rawValue ? parts.rawValue() : ctx.get(spec.prop);
        }
      },
      disable: function (b) { parts.disable(b); raw.disabled = b; }
    };
  }

  function sub(labelText, widget, cls) {
    var wrap = el('span', 'kse-sub' + (cls ? ' ' + cls : ''));
    var id = (widget.focus && widget.focus.id) || nextId();
    var lab = el('label', 'kse-sub-label', { text: labelText, 'for': id });
    if (widget.focus) widget.focus.id = id;
    wrap.appendChild(lab);
    wrap.appendChild(widget.el);
    return wrap;
  }

  // Padding, margin, border-radius and inset: four sides (or corners), with a
  // link toggle for "the same on every side".
  FIELD_TYPES.box = function (spec, ctx) {
    var L = ctx.labels;
    var sides = spec.corners
      ? [['top-left', L.topLeft], ['top-right', L.topRight], ['bottom-right', L.bottomRight], ['bottom-left', L.bottomLeft]]
      : [['top', L.top], ['right', L.right], ['bottom', L.bottom], ['left', L.left]];
    function longhand(side) {
      if (spec.corners) return 'border-' + side + '-radius';
      if (spec.prop === 'inset') return side;
      return spec.prop + '-' + side;
    }
    var longhands = sides.map(function (s) { return longhand(s[0]); });
    var owned = [spec.prop].concat(longhands);
    var linked = null;

    return compoundField(spec, ctx, owned, function (shell, commit) {
      var wrap = el('div', 'kse-box' + (spec.corners ? ' kse-box--corners' : ''));
      var link = button('kse-link', '', { 'aria-label': L.link, title: L.link, 'aria-pressed': 'true' });
      var lengthOpts = { units: spec.units, keywords: spec.keywords, onChange: function () { write(); } };
      var all = lengthWidget(ctx, extend({}, lengthOpts, { ariaLabel: shell.aria }));
      var inputs = sides.map(function (s) {
        return lengthWidget(ctx, extend({}, lengthOpts, { ariaLabel: shell.aria + ' ' + s[1] }));
      });
      var allRow = sub(L.all, all, 'kse-box-all');
      var grid = el('div', 'kse-box-sides');
      inputs.forEach(function (w, i) { grid.appendChild(sub(sides[i][1], w, 'kse-side kse-side--' + sides[i][0])); });
      wrap.appendChild(link);
      wrap.appendChild(allRow);
      wrap.appendChild(grid);

      function setLinked(b) {
        linked = b;
        link.setAttribute('aria-pressed', b ? 'true' : 'false');
        wrap.setAttribute('data-linked', b ? 'true' : 'false');
      }

      link.addEventListener('click', function () {
        if (linked) {
          var v = all.get();
          inputs.forEach(function (w) { w.set(v); });
          setLinked(false);
        } else {
          var first = '';
          inputs.forEach(function (w) { if (!first) first = w.get(); });
          all.set(first);
          setLinked(true);
          write();
        }
      });

      function values() {
        if (linked) { var v = all.get(); return [v, v, v, v]; }
        return inputs.map(function (w) { return w.get(); });
      }

      function write() {
        var v = values();
        var decls = [];
        var full = v[0] && v[1] && v[2] && v[3];
        if (full && spec.shorthand !== false) {
          decls.push({ property: spec.prop, value: minimise(v) });
        } else {
          v.forEach(function (x, i) { if (x) decls.push({ property: longhands[i], value: x }); });
        }
        ctx.commit(owned, decls);
      }

      function minimise(v) {
        if (v[1] === v[3]) {
          if (v[0] === v[2]) return v[0] === v[1] ? v[0] : v[0] + ' ' + v[1];
          return v[0] + ' ' + v[1] + ' ' + v[2];
        }
        return v.join(' ');
      }

      // Each side's value from `get` (ctx.get, or ctx.inherited), or null
      // when the shorthand cannot be taken apart.
      function current(get) {
        var short = get(spec.prop);
        var v = ['', '', '', ''];
        if (short) {
          if (short.indexOf('/') !== -1) return null;
          var t = splitTop(short, ' ');
          if (t.length > 4) return null;
          v = [t[0], t[1] || t[0], t[2] || t[0], t[3] || t[1] || t[0]];
        }
        longhands.forEach(function (p, i) { var x = get(p); if (x) v[i] = x; });
        return v;
      }

      return {
        el: wrap,
        focus: null,
        owned: function () { return owned; },
        read: function () {
          var v = current(ctx.get);
          if (!v) return false;
          var same = v[0] === v[1] && v[1] === v[2] && v[2] === v[3];
          if (linked === null || !same) setLinked(same);
          if (linked) { if (!all.set(v[0])) return false; }
          for (var i = 0; i < 4; i++) if (!inputs[i].set(v[i])) return false;
          return true;
        },
        rawValue: function () {
          var short = ctx.get(spec.prop);
          if (short) return short;
          var v = current(ctx.get) || ['', '', '', ''];
          return v.join(' ');
        },
        inherit: function () {
          var v = current(ctx.inherited) || ['', '', '', ''];
          // All shows one number when the sides agree, else the shorthand.
          all.inherit(v[0] && v[1] && v[2] && v[3] ? minimise(v) : '');
          inputs.forEach(function (w, i) { w.inherit(v[i]); });
        },
        value: function () { return ''; },
        disable: function (b) {
          link.disabled = b;
          all.disable(b);
          inputs.forEach(function (w) { w.disable(b); });
        }
      };
    });
  };

  var LINE_STYLES = ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset', 'hidden'];

  // border and outline: width, style and colour in one shorthand. A border
  // can also be edited one side at a time.
  FIELD_TYPES.stroke = function (spec, ctx) {
    var L = ctx.labels;
    var sideNames = spec.sides ? ['all', 'top', 'right', 'bottom', 'left'] : ['all'];
    var side = 'all';
    var picked = false;
    function propFor(s) { return s === 'all' ? spec.prop : spec.prop + '-' + s; }
    var owned = sideNames.map(propFor);

    var field = compoundField(spec, ctx, owned, function (shell, commit) {
      var wrap = el('div', 'kse-stroke');
      var tabs = null;
      var tabButtons = {};
      if (spec.sides) {
        tabs = el('div', 'kse-seg', { role: 'group', 'aria-label': shell.aria });
        sideNames.forEach(function (s) {
          var b = button('kse-seg-btn', L[s], { 'aria-pressed': s === side ? 'true' : 'false', 'data-side': s });
          b.addEventListener('click', function () {
            side = s;
            Object.keys(tabButtons).forEach(function (k) { tabButtons[k].setAttribute('aria-pressed', k === s ? 'true' : 'false'); });
            picked = true;
            field.refresh();
            picked = false;
          });
          tabButtons[s] = b;
          tabs.appendChild(b);
        });
        wrap.appendChild(tabs);
      }
      var row = el('div', 'kse-row');
      var width = lengthWidget(ctx, { units: ['px', 'em', 'rem'], keywords: ['thin', 'medium', 'thick'], ariaLabel: shell.aria + ' ' + L.width, onChange: changed });
      var style = selectWidget(ctx, { options: LINE_STYLES, ariaLabel: shell.aria + ' ' + L.style, onChange: written });
      var colour = colourWidget(ctx, { ariaLabel: shell.aria + ' ' + L.colour, onChange: changed, prop: spec.prop === 'outline' ? 'outline-color' : 'border-top-color' });
      row.appendChild(sub(L.width, width));
      row.appendChild(sub(L.style, style));
      row.appendChild(sub(L.colour, colour));
      wrap.appendChild(row);

      // A border with a width and a colour but no style is invisible, which
      // reads as broken. Pick solid the moment either is set.
      function changed() {
        if (!style.get() && (width.get() || colour.get())) style.set('solid');
        written();
      }

      function written() {
        commit();
        markSides();
      }

      function markSides() {
        if (!tabs) return;
        sideNames.forEach(function (s) { tabButtons[s].setAttribute('data-set', ctx.get(propFor(s)) ? 'true' : 'false'); });
      }

      // Width, style and colour, in any order, or null for anything else.
      function parse(v) {
        var out = { w: '', s: '', c: '' };
        var tokens = v ? splitTop(v, ' ') : [];
        for (var i = 0; i < tokens.length; i++) {
          var t = tokens[i];
          var lower = t.toLowerCase();
          if (indexOf(LINE_STYLES, lower) !== -1 && !out.s) out.s = lower;
          else if ((isLength(t) || /^(thin|medium|thick)$/i.test(t)) && !out.w) out.w = t;
          else if (!out.c) out.c = t;
          else return null;
        }
        return out;
      }

      return {
        el: wrap,
        focus: width.focus,
        owned: function () { return [propFor(side)]; },
        prop: function () { return propFor(side); },
        read: function () {
          markSides();
          var p = parse(ctx.get(propFor(side)));
          return !!p && width.set(p.w) && style.set(p.s) && colour.set(p.c);
        },
        inherit: function () {
          var p = parse(ctx.inherited(propFor(side))) || { w: '', s: '', c: '' };
          width.inherit(p.w);
          style.inherit(p.s);
          colour.inherit(p.c);
        },
        rawValue: function () { return ctx.get(propFor(side)); },
        value: function () {
          return [width.get(), style.get(), colour.get()].filter(Boolean).join(' ');
        },
        disable: function (b) {
          width.disable(b);
          style.disable(b);
          colour.disable(b);
          if (tabs) Object.keys(tabButtons).forEach(function (k) { tabButtons[k].disabled = b; });
        }
      };
    });

    // Whenever the CSS is replaced, show a side that actually has a value
    // (All first) rather than an empty one the user happened to leave open.
    var read = field.refresh;
    field.refresh = function () {
      if (spec.sides && !picked && !ctx.get(propFor(side))) {
        side = 'all';
        for (var i = 0; i < sideNames.length; i++) {
          if (ctx.get(propFor(sideNames[i]))) { side = sideNames[i]; break; }
        }
        var btns = field.el.querySelectorAll('.kse-seg-btn');
        for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-pressed', btns[j].getAttribute('data-side') === side ? 'true' : 'false');
      }
      read();
    };
    return field;
  };

  // box-shadow and text-shadow: one shadow. Several, or `none`, go to the
  // raw box untouched.
  FIELD_TYPES.shadow = function (spec, ctx) {
    var L = ctx.labels;
    var spread = spec.spread !== false;
    var hasInset = spec.inset !== false;
    return compoundField(spec, ctx, [spec.prop], function (shell, commit) {
      var wrap = el('div', 'kse-row kse-shadow');
      var units = ['px', 'em', 'rem'];
      var o = function (name) { return { units: units, ariaLabel: shell.aria + ' ' + name, onChange: commit }; };
      var x = lengthWidget(ctx, o(L.x));
      var y = lengthWidget(ctx, o(L.y));
      var blur = lengthWidget(ctx, o(L.blur));
      var spr = spread ? lengthWidget(ctx, o(L.spread)) : null;
      var colour = colourWidget(ctx, { ariaLabel: shell.aria + ' ' + L.colour, onChange: commit, prop: 'color' });
      var inset = null;
      wrap.appendChild(sub(L.x, x));
      wrap.appendChild(sub(L.y, y));
      wrap.appendChild(sub(L.blur, blur));
      if (spr) wrap.appendChild(sub(L.spread, spr));
      wrap.appendChild(sub(L.colour, colour));
      if (hasInset) {
        var lab = el('label', 'kse-check');
        inset = el('input', null, { type: 'checkbox' });
        inset.addEventListener('change', commit);
        lab.appendChild(inset);
        lab.appendChild(document.createTextNode(' ' + L.inset));
        wrap.appendChild(lab);
      }

      // One shadow as { lengths, colour, inset }, or null for anything else.
      function parse(v) {
        var out = { lengths: [], c: '', ins: false };
        if (!v) return out;
        if (splitTop(v, ',').length > 1 || /^none$/i.test(v)) return null;
        var tokens = splitTop(v, ' ');
        for (var i = 0; i < tokens.length; i++) {
          var t = tokens[i];
          if (/^inset$/i.test(t) && hasInset) out.ins = true;
          else if (isLength(t)) out.lengths.push(t);
          else if (!out.c) out.c = t;
          else return null;
        }
        if (out.lengths.length < 2 || out.lengths.length > (spread ? 4 : 3)) return null;
        return out;
      }

      return {
        el: wrap,
        focus: x.focus,
        read: function () {
          var p = parse(ctx.get(spec.prop));
          if (!p) return false;
          if (inset) inset.checked = p.ins;
          return x.set(p.lengths[0] || '') && y.set(p.lengths[1] || '') && blur.set(p.lengths[2] || '') &&
            (!spr || spr.set(p.lengths[3] || '')) && colour.set(p.c);
        },
        inherit: function () {
          var p = parse(ctx.inherited(spec.prop)) || parse('');
          [x, y, blur, spr].forEach(function (w, i) { if (w) w.inherit(p.lengths[i] || ''); });
          colour.inherit(p.c);
        },
        value: function () {
          var parts = [x.get(), y.get(), blur.get(), spr ? spr.get() : '', colour.get()];
          if (!parts.join('') && !(inset && inset.checked)) return '';
          var out = [];
          if (inset && inset.checked) out.push('inset');
          out.push(parts[0] || '0', parts[1] || '0');
          if (parts[2] || parts[3]) out.push(parts[2] || '0');
          if (parts[3]) out.push(parts[3]);
          if (parts[4]) out.push(parts[4]);
          return out.join(' ');
        },
        disable: function (b) {
          [x, y, blur, spr, colour].forEach(function (w) { if (w) w.disable(b); });
          if (inset) inset.disabled = b;
        }
      };
    });
  };

  // transform and filter: a fixed list of single-argument functions, always
  // written in the order listed. A value in any other order, or with any other
  // function, goes to the raw box — reordering a transform changes its result.
  FIELD_TYPES.functions = function (spec, ctx) {
    var fns = spec.functions || [];
    return compoundField(spec, ctx, [spec.prop], function (shell, commit) {
      var wrap = el('div', 'kse-row kse-functions');
      var widgets = fns.map(function (f) {
        var w = lengthWidget(ctx, { units: f.units, ariaLabel: shell.aria + ' ' + f.label, onChange: commit, zeroUnitless: false, step: f.step });
        wrap.appendChild(sub(f.label, w));
        return w;
      });

      // Each function's argument, in the order listed, or null.
      function parse(v) {
        v = trim(v);
        var values = fns.map(function () { return ''; });
        var last = -1;
        var re = /^([a-z-]+)\(([^()]*)\)\s*/i;
        while (v) {
          var m = re.exec(v);
          if (!m) return null;
          var at = -1;
          for (var i = 0; i < fns.length; i++) if (fns[i].name.toLowerCase() === m[1].toLowerCase()) at = i;
          if (at <= last) return null;
          values[at] = trim(m[2]);
          last = at;
          v = v.slice(m[0].length);
        }
        return values;
      }

      return {
        el: wrap,
        focus: widgets.length ? widgets[0].focus : null,
        read: function () {
          var values = parse(ctx.get(spec.prop));
          if (!values) return false;
          for (var j = 0; j < fns.length; j++) if (!widgets[j].set(values[j])) return false;
          return true;
        },
        inherit: function () {
          var values = parse(ctx.inherited(spec.prop)) || parse('');
          widgets.forEach(function (w, j) { w.inherit(values[j]); });
        },
        value: function () {
          var out = [];
          fns.forEach(function (f, i) {
            var x = widgets[i].get();
            if (x) out.push(f.name + '(' + x + ')');
          });
          return out.join(' ');
        },
        disable: function (b) { widgets.forEach(function (w) { w.disable(b); }); }
      };
    });
  };

  // background-image: none, an image URL, or a two-colour gradient.
  FIELD_TYPES.image = function (spec, ctx) {
    var L = ctx.labels;
    return compoundField(spec, ctx, [spec.prop], function (shell, commit) {
      var wrap = el('div', 'kse-image');
      var mode = selectWidget(ctx, {
        options: [['url', L.imageUrl], ['linear', L.linearGradient], ['radial', L.radialGradient]],
        unsetLabel: L.none, ariaLabel: shell.aria + ' ' + L.imageType,
        onChange: function () { show(); commit(); }
      });
      var url = textInput('kse-text kse-url', { 'aria-label': L.url, placeholder: 'https://\u2026', inputmode: 'url' });
      var angle = lengthWidget(ctx, { units: ['deg'], ariaLabel: L.angle, onChange: commit, zeroUnitless: false, placeholder: '180' });
      var from = colourWidget(ctx, { ariaLabel: L.from, onChange: commit });
      var to = colourWidget(ctx, { ariaLabel: L.to, onChange: commit });
      var row = el('div', 'kse-row');
      row.appendChild(sub(L.imageType, mode));
      var urlWrap = sub(L.url, { el: url, focus: url }, 'kse-only-url');
      row.appendChild(urlWrap);
      row.appendChild(sub(L.angle, angle, 'kse-only-linear'));
      row.appendChild(sub(L.from, from, 'kse-only-gradient'));
      row.appendChild(sub(L.to, to, 'kse-only-gradient'));
      wrap.appendChild(row);
      url.addEventListener('input', commit);

      function show() { wrap.setAttribute('data-mode', mode.get()); }

      function stops(args) {
        if (args.length !== 2) return false;
        for (var i = 0; i < 2; i++) if (splitTop(args[i], ' ').length !== 1) return false;
        return from.set(args[0]) && to.set(args[1]);
      }

      return {
        el: wrap,
        focus: mode.focus,
        read: function () {
          var v = trim(ctx.get(spec.prop));
          var m;
          url.value = '';
          angle.set('');
          from.set('');
          to.set('');
          if (!v) { mode.set(''); show(); return true; }
          if ((m = /^url\(\s*(["']?)(.*?)\1\s*\)$/i.exec(v))) {
            mode.set('url');
            url.value = m[2];
            show();
            return true;
          }
          if ((m = /^linear-gradient\((.*)\)$/i.exec(v))) {
            var args = splitTop(m[1], ',');
            if (args.length === 3) {
              if (!/^-?\d+(\.\d+)?deg$/i.test(args[0])) return false;
              angle.set(args.shift());
            }
            mode.set('linear');
            show();
            return stops(args);
          }
          if ((m = /^radial-gradient\((.*)\)$/i.exec(v))) {
            mode.set('radial');
            show();
            return stops(splitTop(m[1], ','));
          }
          return false;
        },
        value: function () {
          var m = mode.get();
          if (m === 'url') {
            var u = trim(url.value);
            return u ? 'url("' + u.replace(/"/g, '%22') + '")' : '';
          }
          if (m === 'linear' || m === 'radial') {
            var a = from.get() || 'transparent';
            var b = to.get() || 'transparent';
            var ang = m === 'linear' ? angle.get() : '';
            return m + '-gradient(' + (ang ? ang + ', ' : '') + a + ', ' + b + ')';
          }
          return '';
        },
        disable: function (b) {
          mode.disable(b);
          url.disabled = b;
          angle.disable(b);
          from.disable(b);
          to.disable(b);
        }
      };
    });
  };

  // ─── The editor ───────────────────────────────────────────────────────────

  function Editor(textarea, options) {
    if (typeof textarea === 'string') textarea = document.querySelector(textarea);
    if (!textarea || textarea.tagName !== 'TEXTAREA') {
      throw new Error('kStyleEditor: attach() needs a <textarea> (or a selector for one)');
    }
    if (textarea[HANDLE]) textarea[HANDLE].destroy();

    options = options || {};
    this.textarea = textarea;
    this.options = extend({}, DEFAULTS, options);
    this.labels = extend({}, DEFAULT_LABELS, options.labels);
    this.labels.reasons = extend({}, DEFAULT_LABELS.reasons, options.labels && options.labels.reasons);
    this.labels.sections = extend({}, DEFAULT_LABELS.sections, options.labels && options.labels.sections);
    this.labels.controls = extend({}, options.labels && options.labels.controls);
    this.labels.options = extend({}, options.labels && options.labels.options);
    this.decls = KStyleCss.parse(textarea.value);
    this._listeners = {};
    this._fields = [];
    this._rows = [];
    this._pristine = true;
    this._destroyed = false;
    this._previewEl = null;
    this._previewOriginal = null;

    this._build();
    textarea[HANDLE] = this;
  }

  Editor.prototype._controlDefs = function () {
    var local = {};
    var extra = this.options.controls;
    if (extra) {
      var defs = Object.prototype.toString.call(extra) === '[object Array]' ? extra : Object.keys(extra).map(function (k) {
        return extend({ id: k }, extra[k]);
      });
      defs.forEach(function (d) { local[d.id] = extend({ section: 'other' }, d); });
    }
    function find(id) {
      var def = local[id] || CONTROLS[id];
      if (!def && typeof console !== 'undefined') console.warn('kStyleEditor: unknown control "' + id + '"');
      return def || null;
    }
    var basic = (list(this.options.basic) || []).map(find).filter(Boolean);
    var advanced = (list(this.options.advanced) || []).map(find).filter(Boolean);
    return { basic: basic, advanced: advanced };
  };

  Editor.prototype._build = function () {
    var self = this;
    var o = this.options;
    var L = this.labels;
    var defs = this._controlDefs();

    var rootEl = this.root = el('div', 'kse');
    if (o.theme) rootEl.setAttribute('data-kse-theme', o.theme);
    if (o.readOnly) rootEl.setAttribute('data-kse-readonly', 'true');

    // Enter in any of our inputs would submit the host form.
    rootEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault();
    });

    // Preview box
    if (o.preview === true) {
      var stage = el('div', 'kse-preview', { 'aria-label': L.preview, role: 'figure' });
      var target = this._builtinPreview = el('div', 'kse-preview-target');
      var content = o.previewContent;
      if (content && content.nodeType) target.appendChild(content);
      else target.textContent = content === null || content === undefined ? L.previewText : String(content);
      stage.appendChild(target);
      rootEl.appendChild(stage);
    }

    // Tabs
    var tabs = [];
    if (defs.basic.length) tabs.push('basic');
    if (defs.advanced.length) tabs.push('advanced');
    if (o.code || !tabs.length) tabs.push('code');
    this._tabs = tabs;

    var bar = el('div', 'kse-tabs', { role: 'tablist' });
    var panels = el('div', 'kse-panels');
    this._tabButtons = {};
    this._panels = {};
    tabs.forEach(function (name) {
      var tabId = nextId();
      var panelId = nextId();
      var b = el('button', 'kse-tab', {
        type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId, 'aria-selected': 'false', tabindex: '-1', text: L[name]
      });
      b.addEventListener('click', function () { self.setTab(name); });
      b.addEventListener('keydown', function (e) {
        var i = indexOf(tabs, name);
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); self.setTab(next); self._tabButtons[next].focus(); }
      });
      bar.appendChild(b);
      var panel = el('div', 'kse-panel kse-panel--' + name, { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId });
      panel.hidden = true;
      panels.appendChild(panel);
      self._tabButtons[name] = b;
      self._panels[name] = panel;
    });
    if (tabs.length < 2) bar.hidden = true;
    rootEl.appendChild(bar);
    rootEl.appendChild(panels);

    if (this._panels.basic) {
      var basicList = el('div', 'kse-controls');
      defs.basic.forEach(function (d) { basicList.appendChild(self._buildControl(d)); });
      this._panels.basic.appendChild(basicList);
      this._panels.basic.appendChild(this._codeOnlyNote());
    }
    if (this._panels.advanced) this._buildAdvanced(defs.advanced);
    if (this._panels.code) this._buildCode();

    this._owned = {};
    this._fields.forEach(function (f) { f.props.forEach(function (p) { self._owned[p] = true; }); });

    if (o.hideTextarea) this.textarea.classList.add('kse-hidden-textarea');
    this.textarea.parentNode.insertBefore(rootEl, this.textarea.nextSibling);

    this._setPreviewTarget(o.preview);
    this._refreshFields();
    if (o.readOnly) this._fields.forEach(function (f) { if (f.disable) f.disable(true); });
    this._render('init');
    this.setTab(indexOf(tabs, o.startTab) !== -1 ? o.startTab : tabs[0]);
  };

  Editor.prototype._buildControl = function (def) {
    var self = this;
    var L = this.labels;
    var title = L.controls[def.id] || def.label || def.id;
    var row = el('div', 'kse-control', { 'data-control': def.id });
    var head = el('div', 'kse-control-head');
    var labelId = nextId();
    var label = el('span', 'kse-control-label', { id: labelId, text: title });
    var reset = button('kse-reset', '\u00d7', { 'aria-label': fill(L.resetNamed, { name: title }), title: L.reset });
    head.appendChild(label);
    head.appendChild(reset);
    var body = el('div', 'kse-control-body', { role: 'group', 'aria-labelledby': labelId });
    row.appendChild(head);
    row.appendChild(body);

    var ctx = this._ctx(def, title);
    var fields = def.fields.map(function (spec) {
      var make = FIELD_TYPES[spec.type];
      if (!make) throw new Error('kStyleEditor: unknown field type "' + spec.type + '" in control "' + def.id + '"');
      var f = make(spec, ctx);
      body.appendChild(f.el);
      self._fields.push(f);
      return f;
    });

    // A one-field control with no field title: the control title is its label.
    if (fields.length === 1 && !def.fields[0].label) {
      var focusable = fields[0].el.querySelector('input:not([type=color]):not([type=range]), select');
      if (focusable && focusable.id) {
        var real = el('label', 'kse-control-label', { id: labelId, text: title, 'for': focusable.id });
        head.replaceChild(real, label);
      }
    }

    var props = [];
    fields.forEach(function (f) { props = props.concat(f.props); });
    reset.addEventListener('click', function () {
      self._replace(props, []);
      fields.forEach(function (f) { f.refresh(); });
      self._render('control');
    });

    var search = (title + ' ' + def.id + ' ' + props.join(' ')).toLowerCase();
    this._rows.push({ el: row, props: props, def: def, search: search });
    return row;
  };

  Editor.prototype._ctx = function (def, title) {
    var self = this;
    return {
      options: this.options,
      labels: this.labels,
      readOnly: !!this.options.readOnly,
      controlLabel: title,
      fieldLabel: function (spec) {
        return self.labels.controls[def.id + '.' + (spec.key || spec.prop)] || spec.label;
      },
      // { value: text } for the field's options, from labels.options['id.key'].
      optionLabels: function (spec) {
        return self.labels.options[def.id + '.' + (spec.key || spec.prop)] || null;
      },
      get: function (prop) { return self.get(prop); },
      // What the property shows while it is not set (the `inherited`
      // option), or ''. For display only: never commit it.
      inherited: function (prop) { return self._inherited(prop); },
      // What the preview element currently shows for a property, or ''.
      computed: function (prop) {
        var t = self._previewEl;
        if (!t || !prop) return '';
        try { return trim(window.getComputedStyle(t).getPropertyValue(prop)); } catch (e) { return ''; }
      },
      commit: function (owned, decls) {
        if (self.options.readOnly) return;
        self._replace(owned, decls);
        self._render('control');
      }
    };
  };

  Editor.prototype._buildAdvanced = function (defs) {
    var self = this;
    var L = this.labels;
    var panel = this._panels.advanced;
    var filter = el('input', 'kse-filter', {
      type: 'search', placeholder: L.filter, 'aria-label': L.filter, autocomplete: 'off', spellcheck: 'false'
    });
    panel.appendChild(filter);
    var empty = el('p', 'kse-empty', { text: L.noMatches });
    empty.hidden = true;

    var bySection = {};
    defs.forEach(function (d) {
      var s = indexOf(SECTIONS, d.section) === -1 ? 'other' : d.section;
      (bySection[s] = bySection[s] || []).push(d);
    });
    this._sections = [];
    SECTIONS.forEach(function (name) {
      if (!bySection[name]) return;
      var details = el('details', 'kse-section', { 'data-section': name });
      var summary = el('summary', 'kse-section-head');
      summary.appendChild(el('span', 'kse-section-title', { text: L.sections[name] || name }));
      var count = el('span', 'kse-count');
      summary.appendChild(count);
      details.appendChild(summary);
      var listEl = el('div', 'kse-controls');
      var first = self._rows.length;
      bySection[name].forEach(function (d) { listEl.appendChild(self._buildControl(d)); });
      details.appendChild(listEl);
      panel.appendChild(details);
      self._sections.push({ el: details, count: count, rows: self._rows.slice(first) });
    });
    panel.appendChild(empty);
    panel.appendChild(this._codeOnlyNote());

    if (this.options.openSetSections) {
      this._sections.forEach(function (s) {
        s.el.open = s.rows.some(function (r) { return r.props.some(function (p) { return self.get(p) !== ''; }); });
      });
    }

    var remembered = null;
    filter.addEventListener('input', function () {
      var q = trim(filter.value).toLowerCase();
      if (q && !remembered) remembered = self._sections.map(function (s) { return s.el.open; });
      var any = false;
      self._sections.forEach(function (s, i) {
        var hits = 0;
        s.rows.forEach(function (r) {
          var show = !q || r.search.indexOf(q) !== -1;
          r.el.hidden = !show;
          if (show) hits++;
        });
        s.el.hidden = hits === 0;
        if (hits) any = true;
        if (q) s.el.open = true;
        else if (remembered) s.el.open = remembered[i];
      });
      if (!q) remembered = null;
      empty.hidden = any;
    });
  };

  Editor.prototype._codeOnlyNote = function () {
    var self = this;
    var note = el('p', 'kse-note');
    note.hidden = true;
    var text = el('span');
    note.appendChild(text);
    if (this.options.code) {
      var open = button('kse-linkbtn', this.labels.openCode);
      open.addEventListener('click', function () { self.setTab('code'); self._code.focus(); });
      note.appendChild(document.createTextNode(' '));
      note.appendChild(open);
    }
    (this._notes = this._notes || []).push({ el: note, text: text });
    return note;
  };

  Editor.prototype._buildCode = function () {
    var self = this;
    var L = this.labels;
    var panel = this._panels.code;
    var id = nextId();
    panel.appendChild(el('label', 'kse-visually-hidden', { 'for': id, text: L.codeLabel }));
    var code = this._code = el('textarea', 'kse-code', {
      id: id, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', rows: '8', placeholder: L.codeHelp
    });
    if (this.options.readOnly) code.readOnly = true;
    panel.appendChild(code);
    this._issues = el('div', 'kse-issues', { 'aria-live': 'polite' });
    panel.appendChild(this._issues);

    var timer = null;
    code.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (self._destroyed) return;
        self.decls = KStyleCss.parse(code.value);
        self._refreshFields();
        self._render('code');
      }, 150);
    });
    // Tidy on the way out, once the user is no longer typing into it.
    code.addEventListener('blur', function () {
      clearTimeout(timer);
      if (self._destroyed || self.options.readOnly) return;
      self.decls = KStyleCss.parse(code.value);
      self._refreshFields();
      self._render('code');
      code.value = self.getCss();
    });
  };

  // ─── Model ────────────────────────────────────────────────────────────────

  /**
   * Remove every declaration of the owned properties and put the new ones
   * where the first of them was (or at the end), so a control never moves a
   * declaration past one it does not own. !important survives the rewrite.
   */
  Editor.prototype._replace = function (owned, decls) {
    var at = -1;
    var important = {};
    var kept = [];
    this.decls.forEach(function (d) {
      if (indexOf(owned, d.property) !== -1) {
        if (at === -1) at = kept.length;
        if (d.important) important[d.property] = true;
        return;
      }
      kept.push(d);
    });
    var fresh = decls.map(function (d) {
      return { property: d.property, value: d.value, important: !!(d.important || important[d.property]) };
    });
    if (at === -1) at = kept.length;
    kept.splice.apply(kept, [at, 0].concat(fresh));
    this.decls = kept;
  };

  /** The declarations that are actually saved, after strict and sanitize. */
  Editor.prototype._output = function () {
    var self = this;
    var out = this.decls;
    if (this.options.strict) out = out.filter(function (d) { return self._owned[d.property]; });
    if (this.options.sanitize) {
      out = KStyleCss.clean(KStyleCss.stringify(out), { allow: this._allow() }).declarations;
    }
    return out;
  };

  Editor.prototype._allow = function () {
    var a = this.options.allow;
    return a === null || a === undefined || a === false ? undefined : a;
  };

  Editor.prototype._refreshFields = function () {
    this._fields.forEach(function (f) { f.refresh(); });
  };

  /** The `inherited` value for one property, as a trimmed string or ''. */
  Editor.prototype._inherited = function (prop) {
    var source = this.options.inherited;
    var v = '';
    if (!source || !prop) return '';
    if (typeof source === 'function') {
      try { v = source.call(this, prop); } catch (e) { report(e); }
    } else if (typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, prop)) {
      v = source[prop];
    }
    return v === null || v === undefined || v === false ? '' : trim(v);
  };

  /** Push the model everywhere it shows: textarea, preview, code, badges. */
  Editor.prototype._render = function (source) {
    var self = this;
    var out = this._output();
    var css = KStyleCss.stringify(out, { selector: this.options.selector, pretty: this.options.pretty });
    this._css = css;

    if (source !== 'init') {
      this._pristine = false;
      if (this.textarea.value !== css) {
        this.textarea.value = css;
        fire(this.textarea, 'input');
        fire(this.textarea, 'change');
      }
    }

    this._applyPreview(out);

    if (this._code && source !== 'code') this._code.value = css;

    this._rows.forEach(function (r) {
      var set = r.props.some(function (p) { return self.get(p) !== ''; });
      r.el.setAttribute('data-set', set ? 'true' : 'false');
    });
    (this._sections || []).forEach(function (s) {
      var n = 0;
      s.rows.forEach(function (r) { if (r.el.getAttribute('data-set') === 'true') n++; });
      s.count.textContent = n ? String(n) : '';
    });

    var loose = this.decls.filter(function (d) { return !self._owned[d.property]; });
    (this._notes || []).forEach(function (n) {
      n.el.hidden = !loose.length || !!self.options.strict;
      n.text.textContent = fill(self.options.code ? self.labels.codeOnly : self.labels.codeOnlyNoTab, { n: loose.length });
    });

    if (this._issues) this._renderIssues(loose);

    if (source !== 'init') {
      var payload = { css: css, declarations: out.map(function (d) { return extend({}, d); }), source: source };
      this._emit('change', css, payload);
      if (typeof this.options.onChange === 'function') {
        try { this.options.onChange.call(this, css, payload); } catch (e) { report(e); }
      }
    }
  };

  Editor.prototype._renderIssues = function (loose) {
    var L = this.labels;
    var box = this._issues;
    box.textContent = '';
    function group(heading, items) {
      if (!items.length) return;
      box.appendChild(el('p', 'kse-issues-head', { text: heading }));
      var ul = el('ul');
      items.forEach(function (t) { ul.appendChild(el('li', null, { text: t })); });
      box.appendChild(ul);
    }
    if (this.options.strict) {
      group(L.dropped, loose.map(function (d) { return d.property + ': ' + d.value; }));
    }
    if (this.options.allow !== false) {
      var rejected = KStyleCss.clean(KStyleCss.stringify(this.decls), { allow: this._allow() }).rejected;
      group(L.rejected, rejected.map(function (r) {
        return r.property + ': ' + r.value + ' \u2014 ' + (L.reasons[r.reason] || r.reason);
      }));
    }
    box.hidden = !box.firstChild;
  };

  function fire(node, type) {
    var e;
    try { e = new Event(type, { bubbles: true }); } catch (x) {
      e = document.createEvent('Event');
      e.initEvent(type, true, false);
    }
    node.dispatchEvent(e);
  }

  function report(e) {
    if (typeof console !== 'undefined') console.error(e);
  }

  // ─── Preview ──────────────────────────────────────────────────────────────
  //
  // The target's own inline style is put back before every apply, so removing
  // a declaration in the editor really removes it, and destroy() leaves the
  // element exactly as it was found.
  //
  // Only the CSSOM is used (style.cssText, style.setProperty). A page whose
  // Content-Security-Policy has no 'unsafe-inline' in style-src refuses every
  // write to the style attribute, but not those.

  Editor.prototype._setPreviewTarget = function (preview) {
    this._restorePreview();
    var target = null;
    if (preview === true) target = this._builtinPreview || null;
    else if (preview) target = resolve(preview);
    this._previewEl = target;
    // The attribute, to give back on restore, and the inline style the
    // browser actually applied from it. They differ when a CSP blocked the
    // attribute: its text is there but none of it applies.
    this._previewOriginal = target ? { attr: target.getAttribute('style'), css: target.style.cssText } : null;
  };

  var probe = null;

  /** Whether `text`, as a style attribute, applies exactly the inline style `css`. */
  function appliesAs(text, css) {
    probe = probe || document.createElement('div');
    probe.style.cssText = text;
    return probe.style.cssText === css;
  }

  Editor.prototype._restorePreview = function () {
    var t = this._previewEl;
    var original = this._previewOriginal;
    if (!t) return;
    t.style.cssText = original.css;
    if (original.attr === null) {
      // Chromium and WebKit write the attribute back from the CSSOM lazily,
      // so a removeAttribute() straight after a cssText write leaves an empty
      // style="" behind. Reading the attribute first makes them write it now.
      t.getAttribute('style');
      t.removeAttribute('style');
    } else if (t.getAttribute('style') !== original.attr && appliesAs(original.attr, original.css)) {
      // The CSSOM writes its own spelling ("a: b;"). Put the original text
      // back, unless a CSP blocked it, in which case writing it would only be
      // refused again; the element then looks as it did, with that spelling.
      t.setAttribute('style', original.attr);
    }
    this._previewEl = null;
    this._previewOriginal = null;
  };

  Editor.prototype._applyPreview = function (decls) {
    var t = this._previewEl;
    if (!t) return;
    t.style.cssText = this._previewOriginal.css;
    decls.forEach(function (d) {
      try { t.style.setProperty(d.property, d.value, d.important ? 'important' : ''); } catch (e) { /* ignored by the browser anyway */ }
    });
  };

  // ─── Public API ───────────────────────────────────────────────────────────

  /** The CSS as saved to the textarea. */
  Editor.prototype.getCss = function () {
    return this._css;
  };

  /** The saved declarations as [{ property, value, important }]. */
  Editor.prototype.getDeclarations = function () {
    return this._output().map(function (d) { return extend({}, d); });
  };

  /** Replace everything with new CSS (declarations or one rule). */
  Editor.prototype.setCss = function (css) {
    this.decls = KStyleCss.parse(css);
    this._refreshFields();
    this._render('api');
    return this;
  };

  /** The value of one property, or '' if it is not set. The last one wins. */
  Editor.prototype.get = function (prop) {
    for (var i = this.decls.length - 1; i >= 0; i--) {
      if (this.decls[i].property === prop) return this.decls[i].value;
    }
    return '';
  };

  /** Set one property; an empty value removes it. */
  Editor.prototype.set = function (prop, value, important) {
    var v = trim(value);
    this._replace([prop], v ? [{ property: prop, value: v, important: !!important }] : []);
    this._refreshFields();
    this._render('api');
    return this;
  };

  Editor.prototype.clear = function () {
    this.decls = [];
    this._refreshFields();
    this._render('api');
    return this;
  };

  /** Re-read the textarea, after something else has changed it. */
  Editor.prototype.sync = function () {
    this.decls = KStyleCss.parse(this.textarea.value);
    this._refreshFields();
    this._render('init');
    return this;
  };

  Editor.prototype.setTab = function (name) {
    if (!this._panels[name]) return this;
    var self = this;
    this._tabs.forEach(function (t) {
      var on = t === name;
      self._tabButtons[t].setAttribute('aria-selected', on ? 'true' : 'false');
      self._tabButtons[t].setAttribute('tabindex', on ? '0' : '-1');
      self._panels[t].hidden = !on;
    });
    if (this._tab !== name) {
      this._tab = name;
      this._emit('tab', name);
    }
    return this;
  };

  Editor.prototype.getTab = function () { return this._tab; };

  /** Change where the preview goes: false, true (built-in box), or an element. */
  Editor.prototype.setPreview = function (target) {
    if (target === true && !this._builtinPreview) {
      throw new Error('kStyleEditor: the built-in preview is only created when preview: true is passed to attach()');
    }
    this._setPreviewTarget(target);
    this._applyPreview(this._output());
    return this;
  };

  /**
   * Replace the `inherited` values ({ property: value }, a function, or null)
   * and redraw the fields. The saved CSS is not touched.
   */
  Editor.prototype.setInherited = function (inherited) {
    this.options.inherited = inherited || null;
    this._fields.forEach(function (f) { if (f.inherit) f.inherit(); });
    return this;
  };

  Editor.prototype.setTheme = function (theme) {
    this.options.theme = theme || null;
    if (theme) this.root.setAttribute('data-kse-theme', theme);
    else this.root.removeAttribute('data-kse-theme');
    return this;
  };

  Editor.prototype.setSelector = function (selector) {
    this.options.selector = selector || null;
    this._render('api');
    return this;
  };

  Editor.prototype.on = function (name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
    return this;
  };

  Editor.prototype.off = function (name, fn) {
    var l = this._listeners[name];
    if (!l) return this;
    this._listeners[name] = fn ? l.filter(function (f) { return f !== fn; }) : [];
    return this;
  };

  Editor.prototype._emit = function (name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var self = this;
    (this._listeners[name] || []).slice().forEach(function (fn) {
      try { fn.apply(self, args); } catch (e) { report(e); }
    });
  };

  /** Remove the editor, show the textarea again and restore the preview element. */
  Editor.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    if (openPalette && this.root.contains(openPalette.wrap)) openPalette.close(false);
    this._restorePreview();
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.textarea.classList.remove('kse-hidden-textarea');
    if (this.textarea[HANDLE] === this) delete this.textarea[HANDLE];
    this._listeners = {};
  };

  // ─── Statics ──────────────────────────────────────────────────────────────

  function attach(textarea, options) {
    return new Editor(textarea, options);
  }

  /**
   * Attach to every textarea matching the selector (default
   * `textarea[data-k-style]`). Options can come from data attributes:
   * data-k-style-selector, -preview, -basic, -advanced ("false" for none),
   * -theme, -strict.
   */
  function attachAll(selector, options) {
    var nodes = document.querySelectorAll(selector || 'textarea[data-k-style]');
    return Array.prototype.map.call(nodes, function (t) {
      var d = t.dataset;
      var fromData = {};
      if (d.kStyleSelector) fromData.selector = d.kStyleSelector;
      if (d.kStylePreview) fromData.preview = d.kStylePreview === 'true' ? true : d.kStylePreview;
      if (d.kStyleBasic !== undefined) fromData.basic = d.kStyleBasic;
      if (d.kStyleAdvanced !== undefined) fromData.advanced = d.kStyleAdvanced === 'false' ? false : d.kStyleAdvanced;
      if (d.kStyleTheme) fromData.theme = d.kStyleTheme;
      if (d.kStyleStrict !== undefined) fromData.strict = d.kStyleStrict !== 'false';
      return new Editor(t, extend({}, options, fromData));
    });
  }

  function get(textarea) {
    var t = resolve(textarea);
    return (t && t[HANDLE]) || null;
  }

  function detach(textarea) {
    var ed = get(textarea);
    if (ed) ed.destroy();
  }

  function registerFieldType(name, factory) {
    FIELD_TYPES[name] = factory;
  }

  return {
    VERSION: VERSION,
    Editor: Editor,
    attach: attach,
    attachAll: attachAll,
    get: get,
    detach: detach,
    registerControl: registerControl,
    registerFieldType: registerFieldType,
    controls: function () {
      return CONTROL_ORDER.map(function (id) { return CONTROLS[id]; });
    },
    DEFAULT_BASIC: DEFAULT_BASIC.slice(),
    DEFAULT_ADVANCED: DEFAULT_ADVANCED.slice(),
    DEFAULT_SWATCHES: DEFAULT_PALETTE.map(function (c) { return c.slice(); }),
    DEFAULT_FONTS: DEFAULT_FONTS.map(function (f) { return extend({}, f); }),
    DEFAULT_LABELS: DEFAULT_LABELS,
    DEFAULTS: DEFAULTS,
    SECTIONS: SECTIONS.slice(),
    css: KStyleCss
  };
}));
