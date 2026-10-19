// Package kstyle parses, serialises and sanitises the CSS declarations
// kStyleEditor writes.
//
// It is a port of src/k-style-css.js, held to the same behaviour by
// tests/fixtures/cases.json; SPEC.md is the prose version. Everything works on
// bytes: every character the rules care about is ASCII, and UTF-8 never puts
// an ASCII byte inside a multi-byte character.
//
//	css, err := kstyle.Sanitize(untrusted, kstyle.Options{Selector: "#field-12"})
package kstyle

import (
	"errors"
	"regexp"
	"strings"
)

// Version is the SDK version.
const Version = "0.1.2"

// Declaration is one CSS declaration.
type Declaration struct {
	Property  string `json:"property"`
	Value     string `json:"value"`
	Important bool   `json:"important"`
}

// Rejection is a declaration Sanitize dropped. Reason is one of property,
// blocked, not-allowed, value or url.
type Rejection struct {
	Property string `json:"property"`
	Value    string `json:"value"`
	Reason   string `json:"reason"`
}

// Result is what Sanitize would keep and what it would drop.
type Result struct {
	Declarations []Declaration
	Rejected     []Rejection
}

// Options for Stringify, Clean and Sanitize. The zero value is the default:
// DefaultAllow, no selector, one declaration per line.
type Options struct {
	// Allow lists the property names to keep; nil means DefaultAllow. A
	// trailing "*" is a prefix match ("border-*"); "*" keeps any well-formed
	// name.
	Allow []string
	// Selector wraps the output in `selector { ... }`.
	Selector string
	// Compact puts every declaration on one line.
	Compact bool
}

// ErrInvalidSelector is returned for a selector that could break out of its rule.
var ErrInvalidSelector = errors.New("kstyle: invalid selector")

// DefaultAllow is every property the built-in controls can write, plus the
// common shorthands people type into the Code tab.
var DefaultAllow = []string{
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
}

var blocked = []string{"behavior", "-moz-binding"}

var badFragments = []string{
	"expression(", "javascript:", "vbscript:", "-moz-binding", "@import",
	"image-set(", "image(", "element(", "cross-fade(", "src(",
}

var dataImages = []string{"data:image/png", "data:image/gif", "data:image/jpeg", "data:image/webp"}

const space = " \t\n\r\f"

var (
	collapseRe       = regexp.MustCompile(`[ \t\n\r\f]+`)
	importantRe      = regexp.MustCompile(`(?i) *! *important$`)
	propertyRe       = regexp.MustCompile(`^-?[a-z][a-z0-9-]*$`)
	customPropertyRe = regexp.MustCompile(`^--[A-Za-z0-9_-]+$`)
	schemeRe         = regexp.MustCompile(`^[a-z][a-z0-9+.-]*:`)
	selectorBadRe    = regexp.MustCompile(`[{}<;\\\x00-\x1f\x7f]`)
	valueBadRe       = regexp.MustCompile(`[{}<>\\\x00-\x1f\x7f]`)
)

// ─── parse ───────────────────────────────────────────────────────────────

// Parse reads CSS declarations, in order. It accepts a bare list or one rule
// (`sel { ... }`). It never validates; that is Sanitize's job.
func Parse(css string) []Declaration {
	out := []Declaration{}
	for _, piece := range splitDeclarations(ruleBody(stripComments(css))) {
		colon := strings.IndexByte(piece, ':')
		if colon == -1 {
			continue
		}
		property := collapse(strings.Trim(piece[:colon], space))
		if !strings.HasPrefix(property, "--") {
			property = asciiLower(property)
		}
		value := collapse(strings.Trim(piece[colon+1:], space))
		important := false
		if importantRe.MatchString(value) {
			important = true
			value = strings.Trim(importantRe.ReplaceAllString(value, ""), space)
		}
		if property == "" || value == "" {
			continue
		}
		out = append(out, Declaration{Property: property, Value: value, Important: important})
	}
	return out
}

// ─── stringify ───────────────────────────────────────────────────────────

// Stringify writes declarations back out. An empty list is always "".
func Stringify(decls []Declaration, opts Options) (string, error) {
	selector := ""
	if opts.Selector != "" {
		s, err := checkSelector(opts.Selector)
		if err != nil {
			return "", err
		}
		selector = s
	}
	lines := make([]string, 0, len(decls))
	for _, d := range decls {
		line := d.Property + ": " + d.Value
		if d.Important {
			line += " !important"
		}
		lines = append(lines, line+";")
	}
	if len(lines) == 0 {
		return "", nil
	}
	if selector == "" {
		if opts.Compact {
			return strings.Join(lines, " "), nil
		}
		return strings.Join(lines, "\n"), nil
	}
	if opts.Compact {
		return selector + " { " + strings.Join(lines, " ") + " }", nil
	}
	return selector + " {\n  " + strings.Join(lines, "\n  ") + "\n}", nil
}

// ─── clean / sanitize ────────────────────────────────────────────────────

// Clean splits CSS into what Sanitize would keep and what it would drop.
func Clean(css string, opts Options) Result {
	allow := opts.Allow
	if allow == nil {
		allow = DefaultAllow
	}
	r := Result{Declarations: []Declaration{}, Rejected: []Rejection{}}
	for _, d := range Parse(css) {
		if why := reject(d, allow); why != "" {
			r.Rejected = append(r.Rejected, Rejection{Property: d.Property, Value: d.Value, Reason: why})
		} else {
			r.Declarations = append(r.Declarations, d)
		}
	}
	return r
}

// Sanitize turns untrusted CSS into safe CSS. The only error is
// ErrInvalidSelector.
func Sanitize(css string, opts Options) (string, error) {
	return Stringify(Clean(css, opts).Declarations, opts)
}

// ─── Internals ───────────────────────────────────────────────────────────

func collapse(s string) string { return collapseRe.ReplaceAllString(s, " ") }

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func stripComments(css string) string {
	var sb strings.Builder
	var quote byte
	n := len(css)
	for i := 0; i < n; i++ {
		ch := css[i]
		if quote != 0 {
			sb.WriteByte(ch)
			if ch == '\\' && i+1 < n {
				i++
				sb.WriteByte(css[i])
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '"' || ch == '\'' {
			quote = ch
			sb.WriteByte(ch)
			continue
		}
		if ch == '/' && i+1 < n && css[i+1] == '*' {
			end := strings.Index(css[i+2:], "*/")
			if end == -1 {
				i = n
			} else {
				i = i + 2 + end + 1
			}
			sb.WriteByte(' ')
			continue
		}
		sb.WriteByte(ch)
	}
	return sb.String()
}

func ruleBody(css string) string {
	var quote byte
	open := -1
	depth := 0
	for i := 0; i < len(css); i++ {
		ch := css[i]
		if quote != 0 {
			if ch == '\\' {
				i++
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}
		switch {
		case ch == '"' || ch == '\'':
			quote = ch
		case ch == '{':
			if open == -1 {
				open = i
			}
			depth++
		case ch == '}' && open != -1:
			depth--
			if depth == 0 {
				return css[open+1 : i]
			}
		}
	}
	if open == -1 {
		return css
	}
	return css[open+1:]
}

func splitDeclarations(body string) []string {
	var parts []string
	var quote byte
	depth := 0
	start := 0
	for i := 0; i < len(body); i++ {
		ch := body[i]
		if quote != 0 {
			if ch == '\\' {
				i++
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}
		switch {
		case ch == '"' || ch == '\'':
			quote = ch
		case ch == '(':
			depth++
		case ch == ')':
			if depth > 0 {
				depth--
			}
		case ch == ';' && depth == 0:
			parts = append(parts, body[start:i])
			start = i + 1
		}
	}
	if start > len(body) {
		start = len(body)
	}
	return append(parts, body[start:])
}

func checkSelector(selector string) (string, error) {
	s := collapse(strings.Trim(selector, space))
	if s == "" || selectorBadRe.MatchString(s) || strings.Contains(s, "/*") {
		return "", ErrInvalidSelector
	}
	return s, nil
}

func isAllowed(property string, allow []string) bool {
	for _, entry := range allow {
		if entry == "*" {
			return true
		}
		if strings.HasSuffix(entry, "*") {
			if strings.HasPrefix(property, entry[:len(entry)-1]) {
				return true
			}
		} else if entry == property {
			return true
		}
	}
	return false
}

func isSafeValue(value string) bool {
	if valueBadRe.MatchString(value) {
		return false
	}
	var quote byte
	depth := 0
	for i := 0; i < len(value); i++ {
		ch := value[i]
		if quote != 0 {
			if ch == quote {
				quote = 0
			}
			continue
		}
		switch ch {
		case '"', '\'':
			quote = ch
		case '(':
			depth++
		case ')':
			depth--
			if depth < 0 {
				return false
			}
		}
	}
	if quote != 0 || depth != 0 {
		return false
	}
	squashed := strings.ReplaceAll(asciiLower(value), " ", "")
	for _, f := range badFragments {
		if strings.Contains(squashed, f) {
			return false
		}
	}
	return true
}

func urls(value string) []string {
	var found []string
	lower := asciiLower(value)
	n := len(value)
	at := strings.Index(lower, "url(")
	for at != -1 {
		i := at + 4
		for i < n && value[i] == ' ' {
			i++
		}
		var end int
		if i < n && (value[i] == '"' || value[i] == '\'') {
			end = strings.IndexByte(value[i+1:], value[i])
			if end == -1 {
				end = n
			} else {
				end += i + 1
			}
			found = append(found, value[i+1:end])
		} else {
			end = strings.IndexByte(value[i:], ')')
			if end == -1 {
				end = n
			} else {
				end += i
			}
			found = append(found, strings.Trim(value[i:end], space))
		}
		if end >= n {
			break
		}
		next := strings.Index(lower[end:], "url(")
		if next == -1 {
			break
		}
		at = end + next
	}
	return found
}

func isSafeURL(url string) bool {
	u := asciiLower(strings.Trim(url, space))
	if !schemeRe.MatchString(u) {
		return true
	}
	if strings.HasPrefix(u, "http:") || strings.HasPrefix(u, "https:") {
		return true
	}
	for _, prefix := range dataImages {
		if strings.HasPrefix(u, prefix) && len(u) > len(prefix) && (u[len(prefix)] == ';' || u[len(prefix)] == ',') {
			return true
		}
	}
	return false
}

func reject(d Declaration, allow []string) string {
	p := d.Property
	if !propertyRe.MatchString(p) && !customPropertyRe.MatchString(p) {
		return "property"
	}
	for _, b := range blocked {
		if p == b {
			return "blocked"
		}
	}
	if !isAllowed(p, allow) {
		return "not-allowed"
	}
	if !isSafeValue(d.Value) {
		return "value"
	}
	for _, u := range urls(d.Value) {
		if !isSafeURL(u) {
			return "url"
		}
	}
	return ""
}
