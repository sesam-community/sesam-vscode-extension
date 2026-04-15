# @sesam/cli

Drop-in TypeScript replacement for `sesam-py`. Wraps `@sesam/core` with a `commander` CLI interface.

## Backwards compatibility

`@sesam/cli` is designed to be a drop-in replacement for `sesam-py`. If you already use sesam-py, **you don't need to change anything about how you manage credentials**:

- `.syncconfig` with `NODE=` / `JWT=` works identically — same format, same upward directory walk
- `NODE` / `JWT` environment variables work identically
- The credential lookup order is the same as sesam-py

The only additions over sesam-py are `--node` / `--jwt` per-command flags (for inline use).

**Implemented commands** (remaining commands will be added incrementally):

| Command | sesam-py | `@sesam/cli` | Notes |
|---|---|---|---|
| `upload` | ✅ | ✅ | |
| `download` | ✅ | ✅ | |
| `run [pipe-id]` | ✅ | ✅ | |
| `status [pipe-id]` | ✅ | ✅ | single-pipe filter is new |
| `validate` | ✅ | ✅ | sesam-py also checks internal consistency; our version currently covers JSON syntax + required fields only |
| `test` | ✅ | planned | |
| `log`, `wipe`, `dump`, `get-dataset`, `put-dataset` | ✅ | planned | |

## Installation

```bash
# Link globally for use from any directory
cd packages/cli
pnpm build
pnpm link --global

# Verify
sesam --help
```

## Credentials

Credentials are resolved in this order (first match wins):

1. `--node` / `--jwt` flags on the command
2. `NODE` / `JWT` environment variables
3. `.syncconfig` file — searched from cwd upward

### `.syncconfig` (same format as sesam-py)

`@sesam/cli` reads `.syncconfig` using the exact same `KEY=VALUE` format and `NODE`/`JWT` key names as the original `sesam-py`. If you already have a `.syncconfig` from a sesam-py project, it will work without any changes.

```
NODE=https://datahub-xxxx.sesam.cloud
JWT=eyJ...
```

Place it in your sesam project root. The CLI walks up from `cwd` until it finds one — same lookup behaviour as sesam-py.

> `.syncconfig` is gitignored — never committed to source control.

### Inline credentials (without `.syncconfig`)

Pass `--node` and `--jwt` directly on any command:

```bash
# status
sesam status --node "https://datahub-xxxx.sesam.cloud" --jwt "eyJ..."

# status — single pipe
sesam status my-pipe --node "https://datahub-xxxx.sesam.cloud" --jwt "eyJ..."

# run all pipes
sesam run --node "https://datahub-xxxx.sesam.cloud" --jwt "eyJ..."

# run single pipe
sesam run my-pipe --node "https://datahub-xxxx.sesam.cloud" --jwt "eyJ..."

# download
sesam download --node "https://datahub-xxxx.sesam.cloud" --jwt "eyJ..."

# upload
sesam upload --node "https://datahub-xxxx.sesam.cloud" --jwt "eyJ..."

# validate (offline — no credentials needed)
sesam validate
```

## Commands

### `sesam status [pipe-id]`

Show execution status for all pipes, or a single pipe.

```bash
sesam status
sesam status my-pipe-id
```

Output columns: `pipe-id  state  ok=N  fail=N`

---

### `sesam run [pipe-id]`

Run all pipes, or start the pump for a single pipe.

```bash
sesam run              # run all pipes
sesam run my-pipe-id   # run one pipe
```

---

### `sesam upload [--force]`

ZIP and upload all `pipes/` and `systems/` configs from the current directory to the node. Waits for deployment to complete.

```bash
sesam upload
sesam upload --force   # skip conflict checks
```

---

### `sesam download`

Download all pipe and system configs from the node into `./pipes/` and `./systems/`.

```bash
sesam download
```

---

### `sesam validate`

Validate all local config files (offline — no node connection required). Checks for valid JSON, required `_id` and `type` fields.

```bash
sesam validate
```

---

## Global options (per-command)

| Flag | Env var | Description |
|---|---|---|
| `--node <url>` | `NODE` | Sesam node base URL |
| `--jwt <token>` | `JWT` | Bearer JWT token |

## Development

```bash
pnpm build   # compile TypeScript → dist/
```
