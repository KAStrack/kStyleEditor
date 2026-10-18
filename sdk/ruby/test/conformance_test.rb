# frozen_string_literal: true

# The shared conformance cases, run against the Ruby SDK.
#
#   ruby -Ilib test/conformance_test.rb

require "json"
require "minitest/autorun"
require_relative "../lib/kstyle_editor"

CASES = JSON.parse(File.read(File.join(__dir__, "..", "..", "..", "tests", "fixtures", "cases.json")))

def symbolise(decls)
  decls.map { |d| { property: d["property"], value: d["value"], important: d["important"] } }
end

def options(raw)
  { allow: raw["allow"], selector: raw["selector"], pretty: raw.fetch("pretty", true) }
end

class ConformanceTest < Minitest::Test
  def test_default_allow
    assert_equal CASES["defaultAllow"], KStyleEditor::DEFAULT_ALLOW
  end

  CASES["parse"].each_with_index do |c, i|
    define_method("test_parse_#{i}") do
      assert_equal symbolise(c["expect"]), KStyleEditor.parse(c["input"]), c["name"]
    end
  end

  CASES["stringify"].each_with_index do |c, i|
    define_method("test_stringify_#{i}") do
      o = options(c["options"])
      got = KStyleEditor.stringify(symbolise(c["input"]), selector: o[:selector], pretty: o[:pretty])
      assert_equal c["expect"], got, c["name"]
    end
  end

  CASES["sanitize"].each_with_index do |c, i|
    define_method("test_sanitize_#{i}") do
      o = options(c["options"])
      assert_equal c["expect"], KStyleEditor.sanitize(c["input"], **o), c["name"]
      rejected = KStyleEditor.clean(c["input"], allow: o[:allow])[:rejected]
                             .map { |r| { "property" => r[:property], "reason" => r[:reason] } }
      assert_equal c["rejected"], rejected, c["name"]
    end
  end

  CASES["invalidSelectors"].each_with_index do |s, i|
    define_method("test_invalid_selector_#{i}") do
      assert_raises(ArgumentError) { KStyleEditor.sanitize("color: red", selector: s) }
    end
  end
end
