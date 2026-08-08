# Writing hooks

Bluetemberg syncs two hook manifests, one per platform:

| Source | Platform | Output |
| ------ | -------- | ------ |
| `llm/hooks.json` | Cursor | `.cursor/hooks.json` |
| `llm/hooks.claude.json` | Claude Code | `hooks` key of `.claude/settings.json` |

## Cursor hooks (`llm/hooks.json`)

Cursor **hooks** are configured with JSON at `llm/hooks.json`. Sync validates and normalizes the file, then writes `.cursor/hooks.json`. The format matches what [Cursor’s hooks documentation](https://cursor.com/docs/hooks) describes: a version number and a map of hook events to command entries.

### Manifest shape

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

### When sync runs

Hooks are emitted only if **`cursor`** is in `platforms`. If `llm/hooks.json` is missing, sync does nothing for hooks (it does not delete an existing `.cursor/hooks.json`).

## Claude Code hooks (`llm/hooks.claude.json`)

Claude Code **hooks** are configured with JSON at `llm/hooks.claude.json`. Sync validates the file and merges it into the `hooks` key of `.claude/settings.json`. The `hooks` value uses the exact shape Claude Code expects in its settings file:

### Manifest shape

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "./scripts/after-bash.sh", "timeout": 30 }]
      }
    ],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "./scripts/retro.sh" }] }]
  }
}
```

- **`hooks`** — Object whose keys are Claude Code event names. Each value is an array of entries with an optional **`matcher`** string and a **`hooks`** array of command objects.
- **Command objects** — `type` must be `"command"` (nothing else is accepted), `command` a non-empty string, and `timeout` (optional) a positive number of seconds.

### Event whitelist

Only these events are accepted; anything else is a sync **error** naming the offending event:

`PreToolUse` · `PostToolUse` · `Stop` · `SessionStart` · `SessionEnd` · `UserPromptSubmit`

### Security boundary: packs cannot ship Claude hooks

`llm/hooks.claude.json` is honored **only from the project's own source directory** (`llm/`). If an installed pack or an `extends` source contains a `hooks.claude.json`, sync **skips it and emits a warning** naming the source. Command hooks are arbitrary shell executed by Claude Code — letting third-party packs contribute them would reintroduce the remote-code-execution vector that guardrails were designed to eliminate. [Guardrails](Guardrails) remain the only pack-shippable hook surface: they are declarative, compiled into a fixed injection-safe script.

### Coexistence with guardrails

`syncGuardrails` and `hooks.claude.json` both feed the same `hooks` key; a single writer composes them:

1. When **either** source exists (guardrail files or a local `hooks.claude.json`), the `hooks` key is **bluetemberg-owned** and fully regenerated: guardrail-generated entries first, then manifest entries, in a deterministic event order. Hand-written entries in the key are overwritten.
2. When **neither** source exists, sync never touches the key — hand-written hooks survive.
3. When sources exist but contribute nothing (e.g. every guardrail version-filtered out, or a manifest with zero events), a previously managed key is cleared rather than left stale.
4. When the manifest exists but is **invalid**, nothing is written: the error is recorded and the previous state is left intact.

All other keys in `.claude/settings.json` (e.g. `extraKnownMarketplaces`) are always preserved.

### When sync runs

Claude hooks are emitted only if **`claude`** is in `platforms`. If `llm/hooks.claude.json` is missing and no guardrails exist, sync does not touch `.claude/settings.json`.

## After changing hooks

Run `bluetemberg sync` so the generated files stay aligned with the `llm/` sources.
