/**
 * Typed error hierarchy for Sesam node API failures.
 *
 * NodeAuthError  — HTTP 401 / 403 (bad / expired JWT)
 * NodeApiError   — HTTP 4xx / 5xx (non-auth)
 * NodeNetworkError — DNS failure, timeout, connection refused
 */

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
