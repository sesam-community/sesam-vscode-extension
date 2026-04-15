/**
 * Sesam Node HTTP client.
 *
 * Thin wrapper around the Sesam REST API using native fetch (Node 18+).
 * All methods throw one of NodeAuthError | NodeApiError | NodeNetworkError
 * on failure — never return null / undefined for error cases.
 *
 * Base URL pattern:  {nodeUrl}/api/{path}
 * Auth header:       Authorization: Bearer {jwtToken}
 */

import { NodeAuthError, NodeApiError, NodeNetworkError } from "./errors.js";

import type {
  ApiPipe,
  ApiSystem,
  Entity,
  NodeCredentials,
  NodeRequestLogger,
  RunAllOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// NodeClient class
// ---------------------------------------------------------------------------

export class NodeClient {
  private readonly apiBase: string;
  private readonly jwt: string;
  private readonly logger: NodeRequestLogger | undefined;

  constructor(creds: NodeCredentials) {
    // Strip trailing slash and any trailing "/api" so nodeUrl can be stored
    // either as "https://host" or "https://host/api" without doubling the path.
    this.apiBase = `${creds.nodeUrl.replace(/\/+$/, "").replace(/\/api$/i, "")}/api`;
    this.jwt = creds.jwtToken;
    this.logger = creds.logger;
  }

  // ── Low-level request ──────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: string | Buffer | Uint8Array,
    contentType?: string,
  ): Promise<T> {
    const url = `${this.apiBase}/${path.replace(/^\/+/, "")}`;
    const startMs = Date.now();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.jwt}`,
      Accept: "application/json",
    };

    if (body !== undefined && contentType) {
      headers["Content-Type"] = contentType;
    }

    let response: Response;

    try {
      response = await fetch(url, { method, headers, body });
    } catch (err) {
      this.logger?.({
        method,
        url,
        statusCode: 0,
        durationMs: Date.now() - startMs,
        error: String(err),
      });
      throw new NodeNetworkError(`Network error calling ${url}: ${String(err)}`);
    }

    if (response.status === 401 || response.status === 403) {
      this.logger?.({
        method,
        url,
        statusCode: response.status,
        durationMs: Date.now() - startMs,
        error: `Auth failed`,
      });
      throw new NodeAuthError(
        response.status,
        `Authentication failed (HTTP ${response.status}) — check your JWT token.`,
      );
    }

    if (!response.ok) {
      let detail = "";

      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
        // ignore read failures
      }

      this.logger?.({
        method,
        url,
        statusCode: response.status,
        durationMs: Date.now() - startMs,
        error: `HTTP ${response.status}`,
      });
      throw new NodeApiError(
        response.status,
        `HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    this.logger?.({ method, url, statusCode: response.status, durationMs: Date.now() - startMs });

    // 204 No Content or empty body → return undefined cast to T
    const text = await response.text();

    if (!text.trim()) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  // ── Config management ─────────────────────────────────────────────────

  /** Upload a ZIP archive of all pipe/system configs to the node. */
  async putConfig(zipBuffer: Buffer, force = false): Promise<void> {
    const path = force ? "config?force=true" : "config";
    await this.request<unknown>("PUT", path, zipBuffer, "application/zip");
  }

  /** PUT environment variables (key=value map). */
  async putEnvVars(vars: Record<string, string>): Promise<void> {
    await this.request<unknown>("PUT", "env", JSON.stringify(vars), "application/json");
  }

  // ── Pipes ─────────────────────────────────────────────────────────────

  /** Fetch all pipe objects (includes runtime state and config). */
  async getPipes(): Promise<ApiPipe[]> {
    return this.request<ApiPipe[]>("GET", "pipes");
  }

  /**
   * Poll until no pipe has `runtime.state === "Deploying"`.
   * Throws NodeApiError when timeoutMs is exceeded.
   */
  async waitForDeploy(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const pipes = await this.getPipes();
      const deploying = pipes.some((p) => p.runtime?.state === "Deploying");

      if (!deploying) {
        return;
      }

      await sleep(2_000);
    }

    throw new NodeApiError(0, "Timed out waiting for pipes to finish deploying.");
  }

  /**
   * Trigger a run-all-pipes (equivalent to `sesam run`).
   * Retries with 503 back-off when the node is busy.
   */
  async runAllPipes(opts?: RunAllOptions): Promise<void> {
    const params = new URLSearchParams();

    if (opts?.extraZeroRuns !== undefined) {
      params.set("extra_zero_runs", String(opts.extraZeroRuns));
    }

    if (opts?.maxRuns !== undefined) {
      params.set("max_runs", String(opts.maxRuns));
    }

    if (opts?.maxRunTime !== undefined) {
      params.set("max_run_time", String(opts.maxRunTime));
    }

    const qs = params.size > 0 ? `?${params.toString()}` : "";
    await this.request<unknown>("POST", `pipes/run-all-pipes${qs}`);
  }

  /** Start the pump for a single pipe (equivalent to `sesam run <pipe-id>`). */
  async startPump(pipeId: string): Promise<void> {
    const encoded = encodeURIComponent(pipeId);
    await this.request<unknown>(
      "POST",
      `pipes/${encoded}/pump`,
      "operation=start",
      "application/x-www-form-urlencoded",
    );
  }

  /** Fetch entities produced by a pipe's output dataset. */
  async getPipeEntities(pipeId: string, stage?: string): Promise<Entity[]> {
    const encoded = encodeURIComponent(pipeId);
    const qs = stage ? `?stage=${encodeURIComponent(stage)}` : "";
    return this.request<Entity[]>("GET", `pipes/${encoded}/entities${qs}`);
  }

  /** POST entities directly to a pipe's HTTP receiver. Retries on 503 for up to 60 s. */
  async postToReceiver(pipeId: string, entities: Entity[]): Promise<void> {
    const encoded = encodeURIComponent(pipeId);
    const url = `pipes/${encoded}/receiver`;
    const deadline = Date.now() + 60_000;

    while (true) {
      try {
        await this.request<unknown>("POST", url, JSON.stringify(entities), "application/json");
        return;
      } catch (err) {
        if (err instanceof NodeApiError && err.statusCode === 503 && Date.now() < deadline) {
          await sleep(5_000);
          continue;
        }

        throw err;
      }
    }
  }

  /** Preview a pipe with given input entities (offline evaluation on the node). */
  async previewPipe(pipeId: string, entities: Entity[]): Promise<Entity[]> {
    const encoded = encodeURIComponent(pipeId);
    return this.request<Entity[]>(
      "POST",
      `pipes/${encoded}/preview`,
      JSON.stringify(entities),
      "application/json",
    );
  }

  // ── Publishers ────────────────────────────────────────────────────────

  /** Fetch published data. type is the publisher type, e.g. "json", "csv". */
  async getPublishedData(
    pipeId: string,
    type: string,
    params?: Record<string, string>,
  ): Promise<unknown> {
    const encoded = encodeURIComponent(pipeId);
    const encodedType = encodeURIComponent(type);
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request<unknown>("GET", `publishers/${encoded}/${encodedType}${qs}`);
  }

  // ── Datasets ──────────────────────────────────────────────────────────

  /** Fetch all entities from a dataset. */
  async getDatasetEntities(datasetId: string): Promise<Entity[]> {
    const encoded = encodeURIComponent(datasetId);
    return this.request<Entity[]>("GET", `datasets/${encoded}/entities`);
  }

  // ── Systems ───────────────────────────────────────────────────────────

  /** Fetch all system objects (includes config). */
  async getSystems(): Promise<ApiSystem[]> {
    return this.request<ApiSystem[]>("GET", "systems");
  }

  /** Fetch a single system by ID. */
  async getSystem(systemId: string): Promise<ApiSystem> {
    const encoded = encodeURIComponent(systemId);
    return this.request<ApiSystem>("GET", `systems/${encoded}`);
  }

  // ── Single-config PUT ─────────────────────────────────────────────────

  /** Fetch a single pipe by ID (includes runtime state and config). */
  async getPipe(pipeId: string): Promise<ApiPipe> {
    const encoded = encodeURIComponent(pipeId);
    return this.request<ApiPipe>("GET", `pipes/${encoded}`);
  }

  /**
   * Update a single pipe's config on the node.
   * Unlike `putConfig` (full ZIP), this only modifies the one named pipe.
   */
  async putPipeConfig(pipeId: string, config: unknown): Promise<void> {
    const encoded = encodeURIComponent(pipeId);
    await this.request<unknown>(
      "PUT",
      `pipes/${encoded}/config`,
      JSON.stringify(config),
      "application/json",
    );
  }

  /**
   * Update a single system's config on the node.
   * Unlike `putConfig` (full ZIP), this only modifies the one named system.
   */
  async putSystemConfig(systemId: string, config: unknown): Promise<void> {
    const encoded = encodeURIComponent(systemId);
    await this.request<unknown>(
      "PUT",
      `systems/${encoded}/config`,
      JSON.stringify(config),
      "application/json",
    );
  }
}
