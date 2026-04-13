/**
 * SesamRunner
 *
 * Thin VS Code extension adapter for @sesam/core.
 * Calls @sesam/core operations directly in-process (no subprocess).
 *
 * Future escape-hatch: when `dtl.sesampy.executablePath` is set, the
 * runner should spawn the provided binary instead (Phase C+).
 */

import {
  downloadConfig,
  getStatus,
  runAllPipes,
  runPipe,
  uploadConfig,
  validateWorkspace,
} from "@sesam/core";

import type {
  DownloadOptions,
  DownloadResult,
  NodeCredentials,
  PipeStatus,
  RunAllOptions,
  RunResult,
  UploadOptions,
  UploadResult,
  ValidationResult,
} from "@sesam/core";

export const SESAM_CORE_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// SesamRunner
// ---------------------------------------------------------------------------

/**
 * Wraps @sesam/core operations for use within the VS Code extension.
 * All methods delegate directly to @sesam/core — no subprocess overhead.
 */
export class SesamRunner {
  /**
   * Upload local configs from `workspaceDir` to the connected Sesam node.
   */
  async upload(
    creds: NodeCredentials,
    workspaceDir: string,
    opts?: UploadOptions,
  ): Promise<UploadResult> {
    return uploadConfig(creds, workspaceDir, opts);
  }

  /**
   * Download all pipe and system configs from the node.
   */
  async download(creds: NodeCredentials, opts: DownloadOptions): Promise<DownloadResult> {
    return downloadConfig(creds, opts);
  }

  /**
   * Start the pump for a specific pipe.
   */
  async runPipe(creds: NodeCredentials, pipeId: string): Promise<RunResult> {
    return runPipe(creds, pipeId);
  }

  /**
   * Run all pipes on the node.
   */
  async runAll(creds: NodeCredentials, opts?: RunAllOptions): Promise<RunResult> {
    return runAllPipes(creds, opts);
  }

  /**
   * Fetch the runtime status of all pipes.
   */
  async status(creds: NodeCredentials): Promise<PipeStatus[]> {
    return getStatus(creds);
  }

  /**
   * Validate all local config files in the workspace (offline — no node required).
   */
  async validate(workspaceDir: string): Promise<ValidationResult> {
    return validateWorkspace(workspaceDir);
  }
}
