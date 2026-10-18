// The shared conformance cases, run against the C# SDK. No test framework:
//
//   dotnet run --project sdk/dotnet/Kastrack.StyleEditor.Tests
//
// Exits non-zero if any case fails.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Kastrack.StyleEditor;

internal static class Conformance
{
    private static int total;
    private static int failed;

    private static void Check(string name, bool ok, string got = "", string want = "")
    {
        total++;
        if (ok) return;
        failed++;
        Console.WriteLine("FAIL " + name + "\n  got:  " + got + "\n  want: " + want);
    }

    private static string Show(IEnumerable<Declaration> decls) =>
        string.Join(" | ", decls.Select(d => d.Property + "=" + d.Value + (d.Important ? "!" : "")));

    private static List<Declaration> Decls(JsonElement list) =>
        list.EnumerateArray()
            .Select(d => new Declaration(
                d.GetProperty("property").GetString()!,
                d.GetProperty("value").GetString()!,
                d.GetProperty("important").GetBoolean()))
            .ToList();

    private static StyleOptions Options(JsonElement o)
    {
        var opts = new StyleOptions();
        if (o.TryGetProperty("selector", out var s)) opts.Selector = s.GetString();
        if (o.TryGetProperty("pretty", out var p)) opts.Pretty = p.GetBoolean();
        if (o.TryGetProperty("allow", out var a))
        {
            opts.Allow = a.ValueKind == JsonValueKind.String
                ? new[] { a.GetString()! }
                : a.EnumerateArray().Select(x => x.GetString()!).ToArray();
        }
        return opts;
    }

    private static string FindFixtures()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Combine(dir, "tests", "fixtures", "cases.json");
            if (File.Exists(candidate)) return candidate;
            dir = Path.GetDirectoryName(dir);
        }
        throw new FileNotFoundException("tests/fixtures/cases.json not found above " + AppContext.BaseDirectory);
    }

    private static int Main()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(FindFixtures()));
        var cases = doc.RootElement;

        var allow = cases.GetProperty("defaultAllow").EnumerateArray().Select(x => x.GetString()!).ToList();
        Check("DefaultAllow matches the fixture list", KStyleCss.DefaultAllow.SequenceEqual(allow));

        foreach (var c in cases.GetProperty("parse").EnumerateArray())
        {
            var got = KStyleCss.Parse(c.GetProperty("input").GetString());
            var want = Decls(c.GetProperty("expect"));
            Check("parse: " + c.GetProperty("name").GetString(), got.SequenceEqual(want), Show(got), Show(want));
        }

        foreach (var c in cases.GetProperty("stringify").EnumerateArray())
        {
            var got = KStyleCss.Stringify(Decls(c.GetProperty("input")), Options(c.GetProperty("options")));
            var want = c.GetProperty("expect").GetString()!;
            Check("stringify: " + c.GetProperty("name").GetString(), got == want, got, want);
        }

        foreach (var c in cases.GetProperty("sanitize").EnumerateArray())
        {
            var name = c.GetProperty("name").GetString();
            var input = c.GetProperty("input").GetString();
            var opts = Options(c.GetProperty("options"));
            var got = KStyleCss.Sanitize(input, opts);
            var want = c.GetProperty("expect").GetString()!;
            Check("sanitize: " + name, got == want, got, want);

            var rejected = string.Join(" | ", KStyleCss.Clean(input, opts).Rejected.Select(r => r.Property + ":" + r.Reason));
            var wantRejected = string.Join(" | ", c.GetProperty("rejected").EnumerateArray()
                .Select(r => r.GetProperty("property").GetString() + ":" + r.GetProperty("reason").GetString()));
            Check("clean: " + name, rejected == wantRejected, rejected, wantRejected);
        }

        foreach (var s in cases.GetProperty("invalidSelectors").EnumerateArray())
        {
            var threw = false;
            try { KStyleCss.Sanitize("color: red", new StyleOptions { Selector = s.GetString() }); }
            catch (ArgumentException) { threw = true; }
            Check("invalid selector is refused: " + s.GetRawText(), threw);
        }

        Console.WriteLine("C# SDK: " + total + " checks, failures: " + failed);
        return failed == 0 ? 0 : 1;
    }
}
