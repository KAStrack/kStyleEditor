// Parse, serialise and sanitise the CSS declarations kStyleEditor writes.
//
// A port of src/k-style-css.js, held to the same behaviour by
// tests/fixtures/cases.json. SPEC.md is the prose version.
// MIT Licence. https://github.com/KAStrack/kStyleEditor

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Kastrack.StyleEditor
{
    /// <summary>One CSS declaration.</summary>
    public sealed record Declaration(string Property, string Value, bool Important = false);

    /// <summary>A declaration sanitize() dropped, and why.</summary>
    /// <param name="Reason">property, blocked, not-allowed, value or url.</param>
    public sealed record Rejection(string Property, string Value, string Reason);

    /// <summary>What sanitize() would keep and what it would drop.</summary>
    public sealed record CleanResult(IReadOnlyList<Declaration> Declarations, IReadOnlyList<Rejection> Rejected);

    /// <summary>Options for Stringify, Clean and Sanitize.</summary>
    public sealed class StyleOptions
    {
        /// <summary>
        /// Property names to keep. null means <see cref="KStyleCss.DefaultAllow"/>. A trailing
        /// <c>*</c> is a prefix match ("border-*"); "*" keeps any well-formed name.
        /// </summary>
        public IReadOnlyList<string>? Allow { get; set; }

        /// <summary>Wrap the output in <c>selector { ... }</c>.</summary>
        public string? Selector { get; set; }

        /// <summary>One declaration per line (true) or all on one line.</summary>
        public bool Pretty { get; set; } = true;
    }

    /// <summary>Parse, serialise and sanitise CSS declarations.</summary>
    public static class KStyleCss
    {
        /// <summary>The SDK version.</summary>
        public const string Version = "0.1.3";

        /// <summary>
        /// Every property the built-in controls can write, plus the common shorthands
        /// people type into the Code tab.
        /// </summary>
        public static readonly IReadOnlyList<string> DefaultAllow = new[]
        {
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
        };

        private static readonly string[] Blocked = { "behavior", "-moz-binding" };

        private static readonly string[] BadFragments =
        {
            "expression(", "javascript:", "vbscript:", "-moz-binding", "@import",
            "image-set(", "image(", "element(", "cross-fade(", "src(",
        };

        private static readonly string[] DataImages =
            { "data:image/png", "data:image/gif", "data:image/jpeg", "data:image/webp" };

        // \z, not $: in .NET $ also matches before a final newline. CultureInvariant
        // keeps IgnoreCase from Turkish-I surprises.
        private const RegexOptions Plain = RegexOptions.CultureInvariant;
        private static readonly Regex CollapseRe = new Regex("[ \t\n\r\f]+", Plain);
        private static readonly Regex ImportantRe = new Regex(" *! *important\\z", Plain | RegexOptions.IgnoreCase);
        private static readonly Regex PropertyRe = new Regex("^-?[a-z][a-z0-9-]*\\z", Plain);
        private static readonly Regex CustomPropertyRe = new Regex("^--[A-Za-z0-9_-]+\\z", Plain);
        private static readonly Regex SchemeRe = new Regex("^[a-z][a-z0-9+.-]*:", Plain);
        private static readonly Regex SelectorBadRe = new Regex("[{}<;\\\\\\x00-\\x1f\\x7f]", Plain);
        private static readonly Regex ValueBadRe = new Regex("[{}<>\\\\\\x00-\\x1f\\x7f]", Plain);

        private static readonly char[] Space = { ' ', '\t', '\n', '\r', '\f' };

        // ─── parse ──────────────────────────────────────────────────────────

        /// <summary>
        /// Read CSS declarations, in order. Accepts a bare list or one rule
        /// (<c>sel { ... }</c>). Never validates; that is Sanitize's job.
        /// </summary>
        public static IReadOnlyList<Declaration> Parse(string? css)
        {
            var output = new List<Declaration>();
            if (css == null) return output;
            foreach (var piece in SplitDeclarations(RuleBody(StripComments(css))))
            {
                var colon = piece.IndexOf(':');
                if (colon == -1) continue;
                var property = Collapse(piece.Substring(0, colon).Trim(Space));
                if (!property.StartsWith("--", StringComparison.Ordinal)) property = AsciiLower(property);
                var value = Collapse(piece.Substring(colon + 1).Trim(Space));
                var important = false;
                if (ImportantRe.IsMatch(value))
                {
                    important = true;
                    value = ImportantRe.Replace(value, "").Trim(Space);
                }
                if (property.Length == 0 || value.Length == 0) continue;
                output.Add(new Declaration(property, value, important));
            }
            return output;
        }

        // ─── stringify ──────────────────────────────────────────────────────

        /// <summary>Write declarations back out. An empty list is always "".</summary>
        /// <exception cref="ArgumentException">The selector is unsafe.</exception>
        public static string Stringify(IEnumerable<Declaration> declarations, StyleOptions? options = null)
        {
            options ??= new StyleOptions();
            var selector = string.IsNullOrEmpty(options.Selector) ? "" : CheckSelector(options.Selector!);
            var lines = declarations
                .Select(d => d.Property + ": " + d.Value + (d.Important ? " !important" : "") + ";")
                .ToList();
            if (lines.Count == 0) return "";
            if (selector.Length == 0) return string.Join(options.Pretty ? "\n" : " ", lines);
            if (options.Pretty) return selector + " {\n  " + string.Join("\n  ", lines) + "\n}";
            return selector + " { " + string.Join(" ", lines) + " }";
        }

        // ─── clean / sanitize ───────────────────────────────────────────────

        /// <summary>Split CSS into what Sanitize would keep and what it would drop.</summary>
        public static CleanResult Clean(string? css, StyleOptions? options = null)
        {
            var allow = options?.Allow ?? DefaultAllow;
            var kept = new List<Declaration>();
            var rejected = new List<Rejection>();
            foreach (var d in Parse(css))
            {
                var why = Reject(d, allow);
                if (why.Length > 0) rejected.Add(new Rejection(d.Property, d.Value, why));
                else kept.Add(d);
            }
            return new CleanResult(kept, rejected);
        }

        /// <summary>Untrusted CSS in, safe CSS out.</summary>
        /// <exception cref="ArgumentException">The selector is unsafe.</exception>
        public static string Sanitize(string? css, StyleOptions? options = null)
        {
            return Stringify(Clean(css, options).Declarations, options);
        }

        // ─── Internals ──────────────────────────────────────────────────────

        private static string Collapse(string s) => CollapseRe.Replace(s, " ");

        private static string AsciiLower(string s)
        {
            var sb = new StringBuilder(s.Length);
            foreach (var c in s) sb.Append(c >= 'A' && c <= 'Z' ? (char)(c + 32) : c);
            return sb.ToString();
        }

        private static string StripComments(string css)
        {
            var sb = new StringBuilder(css.Length);
            var quote = '\0';
            for (var i = 0; i < css.Length; i++)
            {
                var ch = css[i];
                if (quote != '\0')
                {
                    sb.Append(ch);
                    if (ch == '\\' && i + 1 < css.Length) { sb.Append(css[++i]); continue; }
                    if (ch == quote) quote = '\0';
                    continue;
                }
                if (ch == '"' || ch == '\'') { quote = ch; sb.Append(ch); continue; }
                if (ch == '/' && i + 1 < css.Length && css[i + 1] == '*')
                {
                    var end = css.IndexOf("*/", i + 2, StringComparison.Ordinal);
                    i = end == -1 ? css.Length : end + 1;
                    sb.Append(' ');
                    continue;
                }
                sb.Append(ch);
            }
            return sb.ToString();
        }

        private static string RuleBody(string css)
        {
            var quote = '\0';
            var open = -1;
            var depth = 0;
            for (var i = 0; i < css.Length; i++)
            {
                var ch = css[i];
                if (quote != '\0')
                {
                    if (ch == '\\') { i++; continue; }
                    if (ch == quote) quote = '\0';
                    continue;
                }
                if (ch == '"' || ch == '\'') { quote = ch; continue; }
                if (ch == '{')
                {
                    if (open == -1) open = i;
                    depth++;
                }
                else if (ch == '}' && open != -1)
                {
                    depth--;
                    if (depth == 0) return css.Substring(open + 1, i - open - 1);
                }
            }
            return open == -1 ? css : css.Substring(open + 1);
        }

        private static List<string> SplitDeclarations(string body)
        {
            var parts = new List<string>();
            var quote = '\0';
            var depth = 0;
            var start = 0;
            for (var i = 0; i < body.Length; i++)
            {
                var ch = body[i];
                if (quote != '\0')
                {
                    if (ch == '\\') { i++; continue; }
                    if (ch == quote) quote = '\0';
                    continue;
                }
                if (ch == '"' || ch == '\'') quote = ch;
                else if (ch == '(') depth++;
                else if (ch == ')') { if (depth > 0) depth--; }
                else if (ch == ';' && depth == 0)
                {
                    parts.Add(body.Substring(start, i - start));
                    start = i + 1;
                }
            }
            parts.Add(start < body.Length ? body.Substring(start) : "");
            return parts;
        }

        private static string CheckSelector(string selector)
        {
            var s = Collapse(selector.Trim(Space));
            if (s.Length == 0 || SelectorBadRe.IsMatch(s) || s.Contains("/*"))
            {
                throw new ArgumentException("kStyleCss: invalid selector \"" + selector + "\"", nameof(selector));
            }
            return s;
        }

        private static bool IsAllowed(string property, IReadOnlyList<string> allow)
        {
            foreach (var entry in allow)
            {
                if (entry == "*") return true;
                if (entry.EndsWith("*", StringComparison.Ordinal))
                {
                    if (property.StartsWith(entry.Substring(0, entry.Length - 1), StringComparison.Ordinal)) return true;
                }
                else if (entry == property)
                {
                    return true;
                }
            }
            return false;
        }

        private static bool IsSafeValue(string value)
        {
            if (ValueBadRe.IsMatch(value)) return false;
            var quote = '\0';
            var depth = 0;
            foreach (var ch in value)
            {
                if (quote != '\0') { if (ch == quote) quote = '\0'; continue; }
                if (ch == '"' || ch == '\'') quote = ch;
                else if (ch == '(') depth++;
                else if (ch == ')') { depth--; if (depth < 0) return false; }
            }
            if (quote != '\0' || depth != 0) return false;
            var squashed = AsciiLower(value).Replace(" ", "");
            return !BadFragments.Any(f => squashed.Contains(f, StringComparison.Ordinal));
        }

        private static List<string> Urls(string value)
        {
            var found = new List<string>();
            var lower = AsciiLower(value);
            var n = value.Length;
            var at = lower.IndexOf("url(", StringComparison.Ordinal);
            while (at != -1)
            {
                var i = at + 4;
                while (i < n && value[i] == ' ') i++;
                var ch = i < n ? value[i] : '\0';
                int end;
                if (ch == '"' || ch == '\'')
                {
                    end = value.IndexOf(ch, i + 1);
                    if (end == -1) end = n;
                    found.Add(value.Substring(i + 1, end - i - 1));
                }
                else
                {
                    end = value.IndexOf(')', i);
                    if (end == -1) end = n;
                    found.Add(value.Substring(i, end - i).Trim(Space));
                }
                at = end < n ? lower.IndexOf("url(", end, StringComparison.Ordinal) : -1;
            }
            return found;
        }

        private static bool IsSafeUrl(string url)
        {
            var u = AsciiLower(url.Trim(Space));
            if (!SchemeRe.IsMatch(u)) return true;
            if (u.StartsWith("http:", StringComparison.Ordinal) || u.StartsWith("https:", StringComparison.Ordinal)) return true;
            foreach (var prefix in DataImages)
            {
                if (u.StartsWith(prefix, StringComparison.Ordinal) && u.Length > prefix.Length &&
                    (u[prefix.Length] == ';' || u[prefix.Length] == ','))
                {
                    return true;
                }
            }
            return false;
        }

        private static string Reject(Declaration d, IReadOnlyList<string> allow)
        {
            var p = d.Property;
            if (!PropertyRe.IsMatch(p) && !CustomPropertyRe.IsMatch(p)) return "property";
            if (Array.IndexOf(Blocked, p) != -1) return "blocked";
            if (!IsAllowed(p, allow)) return "not-allowed";
            if (!IsSafeValue(d.Value)) return "value";
            foreach (var url in Urls(d.Value))
            {
                if (!IsSafeUrl(url)) return "url";
            }
            return "";
        }
    }
}
