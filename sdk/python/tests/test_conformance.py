"""The shared conformance cases, run against the Python SDK."""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import kstyle_editor  # noqa: E402

with open(os.path.join(HERE, "..", "..", "..", "tests", "fixtures", "cases.json"), encoding="utf-8") as f:
    CASES = json.load(f)


def opts(o):
    return {k: v for k, v in o.items() if k in ("allow", "selector", "pretty")}


class Conformance(unittest.TestCase):
    def test_default_allow(self):
        self.assertEqual(list(kstyle_editor.DEFAULT_ALLOW), CASES["defaultAllow"])

    def test_parse(self):
        for c in CASES["parse"]:
            with self.subTest(c["name"]):
                self.assertEqual(kstyle_editor.parse(c["input"]), c["expect"])

    def test_stringify(self):
        for c in CASES["stringify"]:
            with self.subTest(c["name"]):
                o = opts(c["options"])
                self.assertEqual(kstyle_editor.stringify(c["input"], **o), c["expect"])

    def test_sanitize(self):
        for c in CASES["sanitize"]:
            with self.subTest(c["name"]):
                o = opts(c["options"])
                self.assertEqual(kstyle_editor.sanitize(c["input"], **o), c["expect"])
                rejected = [
                    {"property": r["property"], "reason": r["reason"]}
                    for r in kstyle_editor.clean(c["input"], allow=o.get("allow"))["rejected"]
                ]
                self.assertEqual(rejected, c["rejected"])

    def test_invalid_selectors(self):
        for s in CASES["invalidSelectors"]:
            with self.subTest(repr(s)):
                with self.assertRaises(ValueError):
                    kstyle_editor.sanitize("color: red", selector=s)


if __name__ == "__main__":
    unittest.main()
