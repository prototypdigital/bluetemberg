# Writing hooks (Cursor)

Cursor **hooks** are configured with JSON at `llm/hooks.json`. Sync validates and normalizes the file, then writes `.cursor/hooks.json`. The format matches what [Cursor’s hooks documentation](https://cursor.com/docs/hooks) describes: a version number and a map of hook events to command entries.

## Manifest shape

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": "npm run lint" }],
    "afterFileEdit": [{ "command": "./scripts/format.sh" }]
  }
}
```

- **`version`** — Optional; must be a positive integer if present. Defaults to `1` when omitted.
- **`hooks`** — Object whose keys are hook event names (any string, for forward compatibility). Each value is an array of objects with a non-empty **`command`** string (path or shell command; resolved per Cursor’s rules).

Invalid JSON or structure produces a sync **error**; no partial file is written for that step.

## When sync runs

Hooks are emitted only if **`cursor`** is in `platforms`. If `llm/hooks.json` is missing, sync does nothing for hooks (it does not delete an existing `.cursor/hooks.json`).

## After changing hooks

Run `bluetemberg sync` so `.cursor/hooks.json` stays aligned with `llm/hooks.json`.
