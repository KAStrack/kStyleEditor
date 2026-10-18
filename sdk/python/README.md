# kstyle-editor (Python)

Server-side sanitiser for the CSS that [kStyleEditor](https://kastrack.github.io/kStyleEditor/) writes. Standard library only, Python 3.8+.

```python
import kstyle_editor

css = kstyle_editor.sanitize(untrusted, selector="#field-12")
result = kstyle_editor.clean(untrusted, allow=["color", "border-*"])
```

`parse`, `stringify`, `clean` and `sanitize` behave exactly like every other kStyleEditor SDK; see [SPEC.md](https://github.com/KAStrack/kStyleEditor/blob/main/SPEC.md).

Tests: `python3 -m unittest discover -s tests` (runs the shared conformance cases).
