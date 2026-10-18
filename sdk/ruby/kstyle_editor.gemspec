# frozen_string_literal: true

require_relative "lib/kstyle_editor"

Gem::Specification.new do |s|
  s.name = "kstyle_editor"
  s.version = KStyleEditor::VERSION
  s.summary = "Server-side sanitiser for the CSS that kStyleEditor writes."
  s.description = "Parse, allow-list and re-serialise untrusted CSS declarations written by kStyleEditor."
  s.authors = ["KAStrack"]
  s.license = "MIT"
  s.homepage = "https://kastrack.github.io/kStyleEditor/"
  s.metadata = { "source_code_uri" => "https://github.com/KAStrack/kStyleEditor" }
  s.files = ["lib/kstyle_editor.rb"]
  s.required_ruby_version = ">= 3.0"
end
