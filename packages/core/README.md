# @sesam/core

Pure TypeScript library for Sesam node operations. No CLI dependencies — safe to bundle directly in the VS Code extension or any Node.js application.

## Public API

### Credentials

```ts
interface NodeCredentials {
  nodeUrl: string;   // e.g. https://datahub-xxxx.sesam.cloud
  jwtToken: string;  // Bearer token from the Sesam portal
}
```

### High-level operations

```ts
import {
  uploadConfig,
  uploadSingleConfig,
  downloadConfig,
  downloadSingleConfig,
  runPipe,
  runAllPipes,
  getStatus,
  getPipeStatus,
  validateWorkspace,
} from "@sesam/core";

// Upload all local configs to the node
const result = await uploadConfig(creds, "/path/to/workspace");
// → { success: true, pipesUploaded: 12, systemsUploaded: 3 }

// Upload a single config file (pipe or system) without replacing others
const result = await uploadSingleConfig(creds, "/path/to/workspace/pipes/my-pipe.conf.json");
// → { success: true, id: "my-pipe", configType: "pipe" }

// Download all configs from the node
const result = await downloadConfig(creds, { outDir: "/path/to/workspace" });
// → { pipesWritten: 12, systemsWritten: 3 }

// Download a single pipe or system config from the node
const result = await downloadSingleConfig(creds, { pipeId: "my-pipe", outDir: "/path/to/workspace" });
// → { written: "/path/to/workspace/pipes/my-pipe.conf.json" }

// Run all pipes
await runAllPipes(creds);

// Run a single pipe
await runPipe(creds, "my-pipe-id");

// Get status of all pipes
const statuses = await getStatus(creds);
// → [{ id, state, successCount, failureCount, queued, lastRun, nextRun }, ...]

// Get status of a single pipe (single HTTP request — faster than getStatus)
const status = await getPipeStatus(creds, "my-pipe-id");
// → { id, state, successCount, failureCount, queued, lastRun, nextRun }

// Validate local configs (offline — no node needed)
const result = await validateWorkspace("/path/to/workspace");
// → { valid: true, errors: [] }
```

### .syncconfig reader

```ts
import { readSyncConfig } from "@sesam/core";

// Walks up from cwd looking for a .syncconfig file
const config = await readSyncConfig();
// → { nodeUrl, jwtToken, raw } | null
```

### Low-level NodeClient

```ts
import { NodeClient } from "@sesam/core";

const client = new NodeClient({ nodeUrl: "...", jwtToken: "..." });
await client.getPipes();
await client.getPipeEntities("my-pipe");
await client.previewPipe("my-pipe", [{ _id: "e1" }]);
```

### Error types

All network operations throw one of:

| Class | Cause |
|---|---|
| `NodeAuthError` | HTTP 401 / 403 — bad or expired JWT |
| `NodeApiError` | HTTP 4xx / 5xx (non-auth) |
| `NodeNetworkError` | DNS failure, timeout, connection refused |

```ts
import { NodeAuthError, NodeApiError, NodeNetworkError } from "@sesam/core";

try {
  await uploadConfig(creds, dir);
} catch (err) {
  if (err instanceof NodeAuthError) { /* re-authenticate */ }
  if (err instanceof NodeApiError)  { /* show err.statusCode */ }
  if (err instanceof NodeNetworkError) { /* check connectivity */ }
}
```

## Development

```bash
pnpm build   # compile TypeScript → dist/
pnpm test    # run Vitest unit tests
```

Tests use `vi.stubGlobal('fetch', ...)` — no live node required.
