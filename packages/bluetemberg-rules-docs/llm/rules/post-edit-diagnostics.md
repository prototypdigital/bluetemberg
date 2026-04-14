---
description: Run diagnostics and formatter after editing code files.
scope: "**"
---

# Post-edit diagnostics

After each code edit, run file-scoped diagnostics for edited files.

- Run the project formatter on edited files (e.g. `prettier --write`).
- Treat diagnostics findings from edited files as required follow-up before unrelated work.
- Preserve file scope by default; do not broaden to whole-project scans unless asked.
- If multiple files were edited, check each edited file explicitly.
