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
  downloadSingleConfig,
  getPipeStatus,
  getStatus,
  getSyncStatus,
  runAllPipes,
  runPipe,
  uploadConfig,
  uploadSingleConfig,
  validateWorkspace,
} from "@sesam/core";
import { NodeClient } from "@sesam/core";

import type {
  DownloadOptions,
  DownloadResult,
  DownloadSingleOptions,
  NodeCredentials,
  PipeStatus,
  RunAllOptions,
  RunResult,
  SingleDownloadResult,
  SingleUploadResult,
  SyncStatusItem,
  SystemSummary,
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
   * Compare local workspace configs against the live node.
   * Returns items that differ (modified, node-only, or local-only).
   */
  async syncStatus(creds: NodeCredentials, workspaceDir: string): Promise<SyncStatusItem[]> {
    return getSyncStatus(creds, workspaceDir);
  }

  /**
   * Fetch all systems from the node and compute pipe-in / pipe-out counts.
   */
  async systemSummaries(creds: NodeCredentials): Promise<SystemSummary[]> {
    const client = new NodeClient(creds);
    const [systems, pipes] = await Promise.all([client.getSystems(), client.getPipes()]);

    return systems.map((s) => {
      const systemType =
        typeof (s.config?.["original"] as Record<string, unknown> | undefined)?.["type"] ===
        "string"
          ? ((s.config?.["original"] as Record<string, unknown>)["type"] as string)
          : typeof s.config?.["type"] === "string"
            ? (s.config["type"] as string)
            : "unknown";

      const pipesIn = pipes.filter((p) =>
        (p.config?.["original"] as Record<string, unknown> | undefined)?.["source"] !== undefined
          ? (
              (p.config?.["original"] as Record<string, unknown>)["source"] as Record<
                string,
                unknown
              >
            )?.["system"] === s._id
          : (p.config?.["source"] as Record<string, unknown> | undefined)?.["system"] === s._id,
      ).length;

      const pipesOut = pipes.filter((p) =>
        (p.config?.["original"] as Record<string, unknown> | undefined)?.["sink"] !== undefined
          ? (
              (p.config?.["original"] as Record<string, unknown>)["sink"] as Record<string, unknown>
            )?.["system"] === s._id
          : (p.config?.["sink"] as Record<string, unknown> | undefined)?.["system"] === s._id,
      ).length;

      return { id: s._id, systemType, pipesIn, pipesOut };
    });
  }

  /**
   * Fetch the runtime status of a single pipe.
   */
  async pipeStatus(creds: NodeCredentials, pipeId: string): Promise<PipeStatus> {
    return getPipeStatus(creds, pipeId);
  }

  /**
   * Validate all local config files in the workspace (offline — no node required).
   */
  async validate(workspaceDir: string): Promise<ValidationResult> {
    return validateWorkspace(workspaceDir);
  }

  /**
   * Upload a single config file to the node without replacing other configs.
   */
  async uploadFile(
    creds: NodeCredentials,
    filePath: string,
    opts?: { skipValidate?: boolean },
  ): Promise<SingleUploadResult> {
    return uploadSingleConfig(creds, filePath, opts);
  }

  /**
   * Download a single pipe or system config from the node to disk.
   */
  async downloadFile(
    creds: NodeCredentials,
    configId: string,
    configType: "pipe" | "system",
    opts: DownloadSingleOptions,
  ): Promise<SingleDownloadResult> {
    return downloadSingleConfig(creds, configId, configType, opts);
  }
}
