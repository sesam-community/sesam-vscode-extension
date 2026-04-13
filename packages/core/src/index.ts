/**
 * @sesam/core — public API
 *
 * Pure TypeScript library for Sesam node operations.
 * No CLI dependencies — safe to bundle in the VS Code extension.
 */

// Types & errors
export * from "./types.js";
export * from "./errors.js";

// HTTP client (lower-level — use the operation functions for most cases)
export { NodeClient } from "./node-client.js";

// Config ZIP helper
export { zipWorkspaceConfig } from "./config-zipper.js";

// High-level operations
export { uploadConfig } from "./upload.js";
export { downloadConfig } from "./download.js";
export { runPipe, runAllPipes } from "./run-pipes.js";
export { getStatus } from "./status.js";
export { validateWorkspace } from "./validate.js";
