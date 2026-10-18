/*
 * The shared conformance cases, run against the JavaScript SDK.
 * Every other SDK runs the same file; see tests/fixtures/cases.json.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KStyleCss = require('../../src/k-style-css.js');
const cases = require(path.join(__dirname, '..', 'fixtures', 'cases.json'));

test('DEFAULT_ALLOW matches the fixture list', () => {
  assert.deepEqual(KStyleCss.DEFAULT_ALLOW, cases.defaultAllow);
});

for (const c of cases.parse) {
  test('parse: ' + c.name, () => {
    assert.deepEqual(KStyleCss.parse(c.input), c.expect);
  });
}

for (const c of cases.stringify) {
  test('stringify: ' + c.name, () => {
    assert.equal(KStyleCss.stringify(c.input, c.options), c.expect);
  });
}

for (const c of cases.sanitize) {
  test('sanitize: ' + c.name, () => {
    assert.equal(KStyleCss.sanitize(c.input, c.options), c.expect);
    const rejected = KStyleCss.clean(c.input, c.options).rejected
      .map((r) => ({ property: r.property, reason: r.reason }));
    assert.deepEqual(rejected, c.rejected);
  });
}

for (const selector of cases.invalidSelectors) {
  test('invalid selector is refused: ' + JSON.stringify(selector), () => {
    assert.throws(() => KStyleCss.sanitize('color: red', { selector: selector }));
  });
}
