# F02: Config File Intelligence

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP
> **Tracking**: [README.md](README.md)

---

## Summary

Provide JSON Schema validation, autocompletion, hover documentation, and quick-fix actions for the four
sesam-py configuration files: `.syncconfig`, `.sesamconfig.json`, `.authconfig`, and `.jinja_vars`.
Uses the VS Code built-in JSON language service (schema association) plus a custom LSP contribution for
`.jinja_vars` (which is a key=value text format, not JSON).

---

## Config File Reference

| File | Format | Purpose |
|---|---|---|
| `.syncconfig` | `KEY=VALUE` | `NODE` URL + `JWT` token per environment |
| `.sesamconfig.json` | JSON | Formatter/style options (`formatStyle`, `encoding`, etc.) |
| `.authconfig` | JSON | OAuth2 / Tripletex / API key auth secrets |
| `.jinja_vars` | `KEY=VALUE` | Jinja template variable bindings passed at runtime |

---

## Implementation Phases

### Phase A: JSON Schema for .sesamconfig.json and .authconfig

1. Author JSON Schemas for both files under `schemas/`:
   - `schemas/sesamconfig.schema.json`
   - `schemas/authconfig.schema.json`
2. In `package.json`, add `contributes.jsonValidation` entries:
   ```jsonc
   { "fileMatch": "**/.sesamconfig.json", "url": "./schemas/sesamconfig.schema.json" },
   { "fileMatch": "**/.authconfig",        "url": "./schemas/authconfig.schema.json"  }
   ```
3. This gives hover docs, autocompletion, and red-squiggle validation for free via the built-in JSON
   language server - no custom LSP code needed.

**sesamconfig.json known fields:**

| Field | Type | Description |
|---|---|---|
| `formatStyle` | `"compact"` \| `"expanded"` | Output indentation style |
| `encoding` | `"utf-8"` \| `"latin-1"` | File encoding for write operations |
| `excludes` | `string[]` | Glob patterns to skip during upload |

**authconfig known shapes:**

| Auth type | Required fields |
|---|---|
| `api_key` | `type`, `apiKey` |
| `oauth2` | `type`, `clientId`, `clientSecret`, `tokenUrl`, `scopes` |
| `tripletex` | `type`, `consumerToken`, `employeeToken` |

### Phase B: .syncconfig File Support

`.syncconfig` is a plain `KEY=VALUE` file (not JSON), so schema association won't work.

1. Register a `TextDocumentContentProvider` or, simpler, a language ID `sesam-syncconfig`:
   - Add `contributes.languages` entry matching filename `.syncconfig`.
   - Provide a minimal grammar (`syntaxes/syncconfig.tmLanguage.json`) highlighting keys and values.
2. In the LSP server (`server/src/server.ts`), add hover & completion for the two known keys:
   - `NODE` - "Sesam node URL, e.g. https://datahub-<id>.sesam.cloud"
   - `JWT` - "JWT token for the node. Keep this file out of version control."
3. Add a diagnostic warning if either key is missing.
4. Add a code action "Add NODE key" / "Add JWT key" if missing.

### Phase C: .jinja_vars Autocomplete

1. Register language ID `sesam-jinja-vars` for files named `.jinja_vars`.
2. In the LSP, scan all `*.json` and `*.conf.json` files in the workspace for Jinja expressions
   `{{ varName }}` to discover used variable names.
3. Provide completions for known variable names when editing `.jinja_vars` keys.
4. Warn on variables referenced in DTL/Jinja templates that are not declared in `.jinja_vars`.

### Phase D: Security Warnings

1. On document save of `.syncconfig` or `.authconfig`, check if the file is tracked by git
   (`git ls-files --error-unmatch <file>`).
2. If tracked, surface a warning diagnostic: "This file contains secrets and is tracked by git. Consider
   adding it to .gitignore."
3. Provide a quick-fix action "Add to .gitignore".

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | `jsonValidation`, `languages`, `grammars` contributions |
| `schemas/sesamconfig.schema.json` (new) | JSON Schema for `.sesamconfig.json` |
| `schemas/authconfig.schema.json` (new) | JSON Schema for `.authconfig` |
| `syntaxes/syncconfig.tmLanguage.json` (new) | Grammar for `.syncconfig` |
| `server/src/server.ts` | Hover + completion handlers for `.syncconfig` / `.jinja_vars` |
| `server/src/configFileHandlers.ts` (new) | Config file diagnostic + completion logic |

---

## Dependencies

- None (pure static analysis, no binary needed)
- F03 complements Phase D (secret management)
