# frozen_string_literal: true

# Parse, serialise and sanitise the CSS declarations kStyleEditor writes.
#
# A port of src/k-style-css.js, held to the same behaviour by
# tests/fixtures/cases.json. SPEC.md is the prose version.
#
# A declaration is a Hash: { property: String, value: String, important: Boolean }.
#
#   require "kstyle_editor"
#   KStyleEditor.sanitize(untrusted, selector: "#field-12")
module KStyleEditor
  VERSION = "0.1.1"

  # Every property the built-in controls can write, plus the common shorthands
  # people type into the Code tab.
  DEFAULT_ALLOW = %w[
    color
    font font-family font-size font-weight font-style font-variant
    background background-color background-image background-size
    background-position background-repeat background-attachment
    padding padding-top padding-right padding-bottom padding-left
    margin margin-top margin-right margin-bottom margin-left
    line-height letter-spacing word-spacing text-align text-transform
    text-decoration text-decoration-line text-decoration-style
    text-decoration-color text-decoration-thickness text-underline-offset
    text-shadow text-indent white-space word-break overflow-wrap
    vertical-align
    border border-top border-right border-bottom border-left
    border-width border-style border-color
    border-radius border-top-left-radius border-top-right-radius
    border-bottom-right-radius border-bottom-left-radius
    outline outline-width outline-style outline-color outline-offset
    width height min-width max-width min-height max-height
    box-sizing aspect-ratio
    display overflow overflow-x overflow-y float clear visibility
    flex-direction flex-wrap justify-content align-items align-content
    gap row-gap column-gap flex flex-grow flex-shrink flex-basis
    align-self order grid-template-columns grid-template-rows
    position inset top right bottom left z-index
    opacity box-shadow transform filter mix-blend-mode transition
    cursor pointer-events user-select
    list-style list-style-type list-style-position
  ].freeze

  BLOCKED = %w[behavior -moz-binding].freeze

  BAD_FRAGMENTS = [
    "expression(", "javascript:", "vbscript:", "-moz-binding", "@import",
    "image-set(", "image(", "element(", "cross-fade(", "src("
  ].freeze

  DATA_IMAGES = %w[data:image/png data:image/gif data:image/jpeg data:image/webp].freeze

  # \A and \z, never ^ and $: in Ruby those match at every line break.
  SPACE = " \t\n\r\f"
  COLLAPSE_RE = /[ \t\n\r\f]+/
  IMPORTANT_RE = / *! *important\z/i
  PROPERTY_RE = /\A-?[a-z][a-z0-9-]*\z/
  CUSTOM_PROPERTY_RE = /\A--[A-Za-z0-9_-]+\z/
  SCHEME_RE = /\A[a-z][a-z0-9+.-]*:/
  SELECTOR_BAD_RE = /[{}<;\\\x00-\x1f\x7f]/
  VALUE_BAD_RE = /[{}<>\\\x00-\x1f\x7f]/

  module_function

  # Read CSS declarations, in order. Accepts a bare list or one rule
  # (`sel { ... }`). Never validates; that is sanitize's job.
  def parse(css)
    out = []
    return out if css.nil?

    split_declarations(rule_body(strip_comments(css.to_s))).each do |piece|
      colon = piece.index(":")
      next if colon.nil?

      property = collapse(trim(piece[0...colon]))
      property = ascii_lower(property) unless property.start_with?("--")
      value = collapse(trim(piece[(colon + 1)..]))
      important = false
      if IMPORTANT_RE.match?(value)
        important = true
        value = trim(value.sub(IMPORTANT_RE, ""))
      end
      next if property.empty? || value.empty?

      out << { property: property, value: value, important: important }
    end
    out
  end

  # Write declarations back out. An empty list is always "".
  # Raises ArgumentError for an unsafe selector.
  def stringify(declarations, selector: nil, pretty: true)
    sel = selector.nil? || selector.empty? ? "" : check_selector(selector)
    lines = (declarations || []).map do |d|
      "#{d[:property]}: #{d[:value]}#{d[:important] ? ' !important' : ''};"
    end
    return "" if lines.empty?
    return lines.join(pretty ? "\n" : " ") if sel.empty?
    return "#{sel} {\n  #{lines.join("\n  ")}\n}" if pretty

    "#{sel} { #{lines.join(' ')} }"
  end

  # Split CSS into what sanitize would keep and what it would drop.
  # Returns { declarations: [...], rejected: [{ property:, value:, reason: }] }.
  # Reasons: property, blocked, not-allowed, value, url.
  def clean(css, allow: nil)
    allow = DEFAULT_ALLOW if allow.nil?
    kept = []
    rejected = []
    parse(css).each do |d|
      why = reject(d, allow)
      if why.empty?
        kept << d
      else
        rejected << { property: d[:property], value: d[:value], reason: why }
      end
    end
    { declarations: kept, rejected: rejected }
  end

  # Untrusted CSS in, safe CSS out.
  #
  # allow: property names to keep (default DEFAULT_ALLOW). A trailing "*" is a
  # prefix match ("border-*"); "*" keeps any well-formed name.
  def sanitize(css, allow: nil, selector: nil, pretty: true)
    stringify(clean(css, allow: allow)[:declarations], selector: selector, pretty: pretty)
  end

  # ─── Internals ─────────────────────────────────────────────────────────

  def trim(str)
    str.sub(/\A[ \t\n\r\f]+/, "").sub(/[ \t\n\r\f]+\z/, "")
  end

  def collapse(str)
    str.gsub(COLLAPSE_RE, " ")
  end

  def ascii_lower(str)
    str.tr("A-Z", "a-z")
  end

  # The scanners index a chars array: String#[] on non-ASCII UTF-8 walks the
  # string from the start each time, which is quadratic on a long value.
  def strip_comments(css)
    chars = css.chars
    out = +""
    quote = nil
    i = 0
    n = chars.length
    while i < n
      ch = chars[i]
      if quote
        out << ch
        if ch == "\\" && i + 1 < n
          i += 1
          out << chars[i]
        elsif ch == quote
          quote = nil
        end
        i += 1
        next
      end
      if ch == '"' || ch == "'"
        quote = ch
        out << ch
      elsif ch == "/" && chars[i + 1] == "*"
        finish = css.index("*/", i + 2)
        i = finish.nil? ? n : finish + 2
        out << " "
        next
      else
        out << ch
      end
      i += 1
    end
    out
  end

  def rule_body(css)
    chars = css.chars
    quote = nil
    open = -1
    depth = 0
    i = 0
    n = chars.length
    while i < n
      ch = chars[i]
      if quote
        if ch == "\\"
          i += 2
          next
        end
        quote = nil if ch == quote
      elsif ch == '"' || ch == "'"
        quote = ch
      elsif ch == "{"
        open = i if open == -1
        depth += 1
      elsif ch == "}" && open != -1
        depth -= 1
        return chars[(open + 1)...i].join if depth.zero?
      end
      i += 1
    end
    open == -1 ? css : chars[(open + 1)..].join
  end

  def split_declarations(body)
    chars = body.chars
    parts = []
    quote = nil
    depth = 0
    start = 0
    i = 0
    n = chars.length
    while i < n
      ch = chars[i]
      if quote
        if ch == "\\"
          i += 2
          next
        end
        quote = nil if ch == quote
      elsif ch == '"' || ch == "'"
        quote = ch
      elsif ch == "("
        depth += 1
      elsif ch == ")"
        depth -= 1 if depth.positive?
      elsif ch == ";" && depth.zero?
        parts << chars[start...i].join
        start = i + 1
      end
      i += 1
    end
    parts << (chars[start..] || []).join
    parts
  end

  def check_selector(selector)
    s = collapse(trim(selector.to_s))
    if s.empty? || SELECTOR_BAD_RE.match?(s) || s.include?("/*")
      raise ArgumentError, "kStyleCss: invalid selector #{selector.inspect}"
    end

    s
  end

  def allowed?(property, allow)
    return true if allow == "*"

    Array(allow).any? do |entry|
      next true if entry == "*"

      if entry.end_with?("*")
        property.start_with?(entry[0...-1])
      else
        entry == property
      end
    end
  end

  def safe_value?(value)
    return false if VALUE_BAD_RE.match?(value)

    quote = nil
    depth = 0
    value.each_char do |ch|
      if quote
        quote = nil if ch == quote
        next
      end
      if ch == '"' || ch == "'"
        quote = ch
      elsif ch == "("
        depth += 1
      elsif ch == ")"
        depth -= 1
        return false if depth.negative?
      end
    end
    return false if quote || depth != 0

    squashed = ascii_lower(value).delete(" ")
    BAD_FRAGMENTS.none? { |f| squashed.include?(f) }
  end

  def urls(value)
    chars = value.chars
    found = []
    lower = ascii_lower(value)
    n = chars.length
    at = lower.index("url(")
    until at.nil?
      i = at + 4
      i += 1 while i < n && chars[i] == " "
      ch = i < n ? chars[i] : ""
      if ch == '"' || ch == "'"
        finish = value.index(ch, i + 1) || n
        found << value[(i + 1)...finish]
      else
        finish = value.index(")", i) || n
        found << trim(value[i...finish])
      end
      at = lower.index("url(", finish)
    end
    found
  end

  def safe_url?(url)
    u = ascii_lower(trim(url))
    return true unless SCHEME_RE.match?(u)
    return true if u.start_with?("http:", "https:")

    DATA_IMAGES.any? do |prefix|
      u.start_with?(prefix) && [";", ","].include?(u[prefix.length])
    end
  end

  def reject(decl, allow)
    p = decl[:property]
    return "property" unless PROPERTY_RE.match?(p) || CUSTOM_PROPERTY_RE.match?(p)
    return "blocked" if BLOCKED.include?(p)
    return "not-allowed" unless allowed?(p, allow)
    return "value" unless safe_value?(decl[:value])
    return "url" if urls(decl[:value]).any? { |u| !safe_url?(u) }

    ""
  end

  private_class_method :trim, :collapse, :ascii_lower, :strip_comments, :rule_body,
                       :split_declarations, :check_selector, :allowed?, :safe_value?,
                       :urls, :safe_url?, :reject
end
