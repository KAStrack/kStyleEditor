package kstyle

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// The shared conformance cases, run against the Go SDK.

type fixtureOptions struct {
	Allow    json.RawMessage `json:"allow"`
	Selector string          `json:"selector"`
	Pretty   *bool           `json:"pretty"`
}

func (o fixtureOptions) options(t *testing.T) Options {
	opts := Options{Selector: o.Selector, Compact: o.Pretty != nil && !*o.Pretty}
	if len(o.Allow) > 0 {
		var one string
		if json.Unmarshal(o.Allow, &one) == nil {
			opts.Allow = []string{one}
		} else if err := json.Unmarshal(o.Allow, &opts.Allow); err != nil {
			t.Fatal(err)
		}
	}
	return opts
}

type fixtures struct {
	Parse []struct {
		Name   string        `json:"name"`
		Input  string        `json:"input"`
		Expect []Declaration `json:"expect"`
	} `json:"parse"`
	Stringify []struct {
		Name    string         `json:"name"`
		Input   []Declaration  `json:"input"`
		Options fixtureOptions `json:"options"`
		Expect  string         `json:"expect"`
	} `json:"stringify"`
	Sanitize []struct {
		Name     string         `json:"name"`
		Input    string         `json:"input"`
		Options  fixtureOptions `json:"options"`
		Expect   string         `json:"expect"`
		Rejected []struct {
			Property string `json:"property"`
			Reason   string `json:"reason"`
		} `json:"rejected"`
	} `json:"sanitize"`
	InvalidSelectors []string `json:"invalidSelectors"`
	DefaultAllow     []string `json:"defaultAllow"`
}

func load(t *testing.T) fixtures {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "tests", "fixtures", "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestConformance(t *testing.T) {
	f := load(t)

	if !reflect.DeepEqual(DefaultAllow, f.DefaultAllow) {
		t.Error("DefaultAllow does not match the fixture list")
	}

	for _, c := range f.Parse {
		got := Parse(c.Input)
		if !reflect.DeepEqual(got, c.Expect) {
			t.Errorf("parse: %s\n  got:  %#v\n  want: %#v", c.Name, got, c.Expect)
		}
	}

	for _, c := range f.Stringify {
		got, err := Stringify(c.Input, c.Options.options(t))
		if err != nil || got != c.Expect {
			t.Errorf("stringify: %s\n  got:  %q (%v)\n  want: %q", c.Name, got, err, c.Expect)
		}
	}

	for _, c := range f.Sanitize {
		opts := c.Options.options(t)
		got, err := Sanitize(c.Input, opts)
		if err != nil || got != c.Expect {
			t.Errorf("sanitize: %s\n  got:  %q (%v)\n  want: %q", c.Name, got, err, c.Expect)
		}
		rejected := Clean(c.Input, opts).Rejected
		if len(rejected) != len(c.Rejected) {
			t.Errorf("clean: %s: %d rejected, want %d", c.Name, len(rejected), len(c.Rejected))
			continue
		}
		for i, r := range rejected {
			if r.Property != c.Rejected[i].Property || r.Reason != c.Rejected[i].Reason {
				t.Errorf("clean: %s [%d]: got %s/%s, want %s/%s", c.Name, i, r.Property, r.Reason, c.Rejected[i].Property, c.Rejected[i].Reason)
			}
		}
	}

	for _, s := range f.InvalidSelectors {
		if _, err := Sanitize("color: red", Options{Selector: s}); !errors.Is(err, ErrInvalidSelector) {
			t.Errorf("invalid selector %q was not refused", s)
		}
	}
}
