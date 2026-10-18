/* Fill each example's "View source" panel from the example itself: the markup
 * inside .example-demo and the text of its <script type="text/plain"
 * data-example>. Then run that script. What you read is what ran.
 *
 * The scripts are inert until now so the markup can be read before an editor
 * attaches and changes it, and so they run after the library has loaded.
 */
(function () {
  'use strict';

  function dedent(text) {
    var lines = text.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
    var indent = Infinity;
    lines.forEach(function (l) {
      if (!l.trim()) return;
      indent = Math.min(indent, l.match(/^ */)[0].length);
    });
    return lines.map(function (l) { return l.slice(indent === Infinity ? 0 : indent); }).join('\n');
  }

  Array.prototype.forEach.call(document.querySelectorAll('.example'), function (ex) {
    var demo = ex.querySelector('.example-demo');
    var script = ex.querySelector('script[data-example]');
    var code = ex.querySelector('details.src code');
    if (!code) return;
    var parts = [];
    if (demo) parts.push(dedent(demo.innerHTML));
    if (script) parts.push('<script>\n' + dedent(script.textContent) + '\n</script>');
    code.textContent = parts.join('\n\n');
  });

  Array.prototype.forEach.call(document.querySelectorAll('script[data-example]'), function (inert) {
    var run = document.createElement('script');
    run.textContent = inert.textContent;
    inert.parentNode.insertBefore(run, inert.nextSibling);
  });
}());
