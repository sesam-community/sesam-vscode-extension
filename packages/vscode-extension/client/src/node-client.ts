/**
 * Sesam Node HTTP Client
 *
 * Thin wrapper around the Sesam node REST API. Uses Node.js built-in
 * `https`/`http` modules — no extra npm dependencies.
 *
 * Two exported functions:
 *   - previewPipe()          POST /api/pipes/{id}/preview
 *   - fetchDatasetEntities() GET  /api/datasets/{id}/entities
 *
 * NOTE: These functions logically belong in @sesam/core once F00 is
 * implemented. At that point this module becomes either a thin re-export
 * wrapper or is removed and the extension imports from @sesam/core directly.
 */

import * as http from "node:http";
import * as https from "node:https";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Entity = Record<string, unknown>;

export interface NodeRequestLogEntry {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  error?: string;
}

export type NodeRequestLogger = (entry: NodeRequestLogEntry) => void;

// ---------------------------------------------------------------------------
// Typed error classes
// ---------------------------------------------------------------------------

export class NodeAuthError extends Error {
  readonly kind = "auth" as const;

  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "NodeAuthError";
  }
}

export class NodeApiError extends Error {
  readonly kind = "api" as const;

  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "NodeApiError";
  }
}

export class NodeNetworkError extends Error {
  readonly kind = "network" as const;

  constructor(message: string) {
    super(message);
    this.name = "NodeNetworkError";
  }
}

export type NodeError = NodeAuthError | NodeApiError | NodeNetworkError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const isLocalhost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

const validateUrl = (rawUrl: string): URL => {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NodeNetworkError(`Invalid node URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "https:" && !isLocalhost(parsed.hostname)) {
    throw new NodeNetworkError(`Node URL must use HTTPS for non-localhost hosts ("${rawUrl}").`);
  }

  return parsed;
};

const request = (
  method: "GET" | "POST",
  url: URL,
  jwt: string,
  body?: string,
  contentType = "application/json",
  logger?: NodeRequestLogger,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const startMs = Date.now();
    let logged = false;

    const log = (statusCode: number, error?: string): void => {
      if (logged) {
        return;
      }

      logged = true;
      logger?.({ method, url: url.href, statusCode, durationMs: Date.now() - startMs, error });
    };

    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = contentType;
      headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
    }

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf8");
          const statusCode = res.statusCode ?? 0;

          if (statusCode === 401 || statusCode === 403) {
            const msg =
              tryParseMessage(responseText) ?? `Authentication failed (HTTP ${statusCode}).`;
            log(statusCode, msg);
            reject(new NodeAuthError(statusCode, msg));

            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            const msg = tryParseMessage(responseText) ?? `Node returned HTTP ${statusCode}.`;
            log(statusCode, msg);
            reject(new NodeApiError(statusCode, msg));

            return;
          }

          log(statusCode);
          resolve(responseText);
        });
      },
    );

    req.on("error", (err: NodeJS.ErrnoException) => {
      log(0, err.message);
      reject(new NodeNetworkError(err.message));
    });

    req.setTimeout(30_000, () => {
      const msg = "Request timed out after 30 s.";
      log(0, msg);
      req.destroy();
      reject(new NodeNetworkError(msg));
    });

    if (body !== undefined) {
      req.write(body, "utf8");
    }

    req.end();
  });

const tryParseMessage = (text: string): string | null => {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;

      // Check common error field names used by Sesam and general REST APIs
      for (const field of ["message", "error", "description", "detail", "reason"]) {
        if (typeof obj[field] === "string") {
          return obj[field] as string;
        }
      }
    }
  } catch {
    // not JSON — fall through to raw text
  }

  // Return raw body truncated to 300 chars so the user can see what the node said
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a pipe config to the node's preview endpoint and return the output
 * entities. The `source` block in the config is replaced with an embedded
 * source containing `inputEntities` so the exact entity the user is editing
 * gets evaluated, regardless of the original source type.
 *
 * API: POST {nodeUrl}/api/pipes/{pipeId}/preview
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: operation=preview-pipe&pipe-config=<encoded JSON>&trace=true&source=<encoded entity>
 *
 * @throws {NodeAuthError}    HTTP 401/403 — bad or missing JWT
 * @throws {NodeApiError}     HTTP 4xx/5xx — node-side error (message preserved)
 * @throws {NodeNetworkError} DNS/timeout/connection failure
 */
export const previewPipe = async (
  nodeUrl: string,
  jwt: string,
  pipeId: string,
  pipeConfig: Record<string, unknown>,
  inputEntities: Entity[],
  logger?: NodeRequestLogger,
): Promise<Entity[]> => {
  const base = validateUrl(nodeUrl);
  const url = new URL(`/api/pipes/${encodeURIComponent(pipeId)}/preview`, base);

  // The API takes the pipe config unchanged and the input entity as a
  // separate `source` form field (a single entity JSON, not an array).
  const formBody =
    `operation=preview-pipe` +
    `&pipe-config=${encodeURIComponent(JSON.stringify(pipeConfig))}` +
    `&trace=true` +
    `&source=${encodeURIComponent(JSON.stringify(inputEntities[0] ?? {}))}`;

  const responseText = await request(
    "POST",
    url,
    jwt,
    formBody,
    "application/x-www-form-urlencoded",
    logger,
  );

  const parsed: unknown = JSON.parse(responseText);

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    // Standard response shape: { transformed: [[...entities...]], sink: [...], source: {...} }
    // `transformed` is an array-of-arrays, one inner array per input entity.
    if (Array.isArray(obj["transformed"])) {
      const first = (obj["transformed"] as unknown[])[0];

      if (Array.isArray(first)) {
        return first as Entity[];
      }
    }

    // Fallback: flat sink array
    if (Array.isArray(obj["sink"])) {
      return obj["sink"] as Entity[];
    }

    // Legacy / other wrapped shapes
    for (const field of ["entities", "result", "results", "output"]) {
      if (Array.isArray(obj[field])) {
        return obj[field] as Entity[];
      }
    }
  }

  // Plain array response
  if (Array.isArray(parsed)) {
    return parsed as Entity[];
  }

  return [];
};

export interface DatasetStats {
  /** Number of non-deleted entities (`runtime.count-index-exists`). */
  totalCount: number;
  /** Number of deleted entities (`runtime.count-index-deleted`). */
  deletedCount: number;
}

/**
 * Fetch dataset metadata with counts from `GET /api/datasets/{id}?verbose=true`.
 *
 * @throws {NodeAuthError}    HTTP 401/403
 * @throws {NodeApiError}     HTTP 4xx/5xx
 * @throws {NodeNetworkError} DNS/timeout/connection failure
 */
export const fetchDatasetStats = async (
  nodeUrl: string,
  jwt: string,
  datasetId: string,
  logger?: NodeRequestLogger,
): Promise<DatasetStats> => {
  const base = validateUrl(nodeUrl);
  const url = new URL(`/api/datasets/${encodeURIComponent(datasetId)}`, base);

  url.searchParams.set("verbose", "true");

  const responseText = await request("GET", url, jwt, undefined, undefined, logger);
  const data = JSON.parse(responseText) as Record<string, unknown>;
  const runtime = (data["runtime"] ?? {}) as Record<string, unknown>;

  return {
    totalCount: Number(runtime["count-index-exists"] ?? 0),
    deletedCount: Number(runtime["count-index-deleted"] ?? 0),
  };
};

export interface FetchEntitiesOptions {
  limit?: number;
  since?: string | number;
  reverse?: boolean;
  deleted?: boolean;
  history?: boolean;
  uncommitted?: boolean;
}

/**
 * Fetch entities from a dataset on the node.
 *
 * @param options.since     Opaque cursor value (`_updated` offset) for pagination.
 * @param options.reverse   When true, returns newest entities first.
 * @param options.deleted   When false, excludes deleted entities (default API: true).
 * @param options.history   When false, returns only the latest version (default API: true).
 * @throws {NodeAuthError}    HTTP 401/403
 * @throws {NodeApiError}     HTTP 4xx/5xx
 * @throws {NodeNetworkError} DNS/timeout/connection failure
 */
export const fetchDatasetEntities = async (
  nodeUrl: string,
  jwt: string,
  datasetId: string,
  options: FetchEntitiesOptions = {},
  logger?: NodeRequestLogger,
): Promise<Entity[]> => {
  const base = validateUrl(nodeUrl);
  const url = new URL(`/api/datasets/${encodeURIComponent(datasetId)}/entities`, base);

  const { limit = 50, since, reverse, deleted, history, uncommitted } = options;

  url.searchParams.set("limit", String(limit));

  if (since !== undefined) {
    url.searchParams.set("since", String(since));
  }

  if (reverse !== undefined) {
    url.searchParams.set("reverse", String(reverse));
  }

  if (deleted !== undefined) {
    url.searchParams.set("deleted", String(deleted));
  }

  if (history !== undefined) {
    url.searchParams.set("history", String(history));
  }

  if (uncommitted !== undefined) {
    url.searchParams.set("uncommitted", String(uncommitted));
  }

  const responseText = await request("GET", url, jwt, undefined, undefined, logger);

  return JSON.parse(responseText) as Entity[];
};

/**
 * Search for entities in a dataset by entity ID.
 *
 * API: GET {nodeUrl}/api/datasets/{datasetId}/search?id={encodedEntityId}
 *
 * @returns Array of matching entities (empty = no match).
 * @throws {NodeAuthError}    HTTP 401/403
 * @throws {NodeApiError}     HTTP 4xx/5xx
 * @throws {NodeNetworkError} DNS/timeout/connection failure
 */
export const searchDatasetById = async (
  nodeUrl: string,
  jwt: string,
  datasetId: string,
  entityId: string,
  logger?: NodeRequestLogger,
): Promise<Entity[]> => {
  const base = validateUrl(nodeUrl);
  const url = new URL(`/api/datasets/${encodeURIComponent(datasetId)}/search`, base);

  url.searchParams.set("id", entityId);

  const responseText = await request("GET", url, jwt, undefined, undefined, logger);

  return JSON.parse(responseText) as Entity[];
};

/**
 * Search for the first entity in a dataset whose JSON contains `query` as a
 * case-insensitive substring. Pages through
 * GET {nodeUrl}/api/datasets/{datasetId}/entities (200 per page) until a
 * match is found or `maxEntities` are exhausted.
 *
 * @param maxEntities  Safety cap on total entities scanned (default 10 000).
 * @returns The first matching entity, or `null` if no match is found.
 * @throws {NodeAuthError}    HTTP 401/403
 * @throws {NodeApiError}     HTTP 4xx/5xx
 * @throws {NodeNetworkError} DNS/timeout/connection failure
 */
export const searchDatasetByText = async (
  nodeUrl: string,
  jwt: string,
  datasetId: string,
  query: string,
  maxEntities = 10_000,
  logger?: NodeRequestLogger,
): Promise<Entity | null> => {
  const lowerQuery = query.toLowerCase();
  const pageSize = 200;
  let scanned = 0;
  let since: string | number | undefined;

  while (scanned < maxEntities) {
    const page = await fetchDatasetEntities(
      nodeUrl,
      jwt,
      datasetId,
      { limit: pageSize, since },
      logger,
    );

    if (page.length === 0) {
      return null;
    }

    const match = page.find((entity) => JSON.stringify(entity).toLowerCase().includes(lowerQuery));

    if (match !== undefined) {
      return match;
    }

    scanned += page.length;

    if (page.length < pageSize) {
      return null;
    }

    const last = page[page.length - 1];
    since = last["_ts"] as string | number | undefined;

    if (since === undefined) {
      return null;
    }
  }

  return null;
};

/**
 * Lightweight connectivity + auth check.
 * GETs /api/config and returns `"ok"`, `"auth"`, or `"network"`.
 *
 * @throws never — all errors are caught and returned as a discriminated string
 */
export const pingNode = async (
  nodeUrl: string,
  jwt: string,
  logger?: NodeRequestLogger,
): Promise<
  { status: "ok" } | { status: "auth"; message: string } | { status: "network"; message: string }
> => {
  try {
    const base = validateUrl(nodeUrl);
    const url = new URL("/api/config", base);
    await request("GET", url, jwt, undefined, undefined, logger);

    return { status: "ok" };
  } catch (err) {
    if (err instanceof NodeAuthError) {
      return { status: "auth", message: err.message };
    }

    return { status: "network", message: err instanceof Error ? err.message : String(err) };
  }
};
