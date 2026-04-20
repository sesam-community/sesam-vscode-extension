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

// Config file readers
export { readSyncConfig } from "./syncconfig.js";
export { zipWorkspaceConfig } from "./config-zipper.js";

// High-level operations
export { uploadConfig, uploadSingleConfig } from "./upload.js";
export { downloadConfig, downloadSingleConfig } from "./download.js";
export { runPipe, runAllPipes } from "./run-pipes.js";
export { getStatus, getPipeStatus } from "./status.js";
export { validateWorkspace } from "./validate.js";

// Test management (F05)
export { readTestSpec, readExpectedOutput, discoverTestSpecs } from "./test-spec-reader.js";
export {
  filterEntity,
  applyIgnoreDeletes,
  normalizeDecimal,
  normalizeEntity,
  sortEntities,
} from "./test-entity-filter.js";
export { compareTestOutput } from "./test-comparator.js";
export type { TestCompareResult } from "./test-comparator.js";
export { testPipes } from "./test-runner.js";
export type { TestPipesOptions } from "./test-runner.js";
