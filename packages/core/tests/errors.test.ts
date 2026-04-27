import { describe, expect, it } from "vitest";

import {
  NodeApiError,
  NodeAuthError,
  NodeNetworkError,
  ValidationFailedError,
} from "../src/errors.js";

import type { NodeError } from "../src/errors.js";

describe("NodeAuthError", () => {
  it("has kind='auth'", () => {
    const err = new NodeAuthError(401, "Unauthorized");
    expect(err.kind).toBe("auth");
  });

  it("carries the status code", () => {
    expect(new NodeAuthError(403, "Forbidden").statusCode).toBe(403);
  });

  it("is an instance of Error", () => {
    expect(new NodeAuthError(401, "Unauthorized")).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new NodeAuthError(401, "Unauthorized").name).toBe("NodeAuthError");
  });
});

describe("NodeApiError", () => {
  it("has kind='api'", () => {
    const err = new NodeApiError(500, "Server error");
    expect(err.kind).toBe("api");
  });

  it("carries the status code", () => {
    expect(new NodeApiError(404, "Not found").statusCode).toBe(404);
  });

  it("is an instance of Error", () => {
    expect(new NodeApiError(500, "Server error")).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new NodeApiError(500, "Server error").name).toBe("NodeApiError");
  });
});

describe("NodeNetworkError", () => {
  it("has kind='network'", () => {
    const err = new NodeNetworkError("DNS failure");
    expect(err.kind).toBe("network");
  });

  it("is an instance of Error", () => {
    expect(new NodeNetworkError("timeout")).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new NodeNetworkError("refused").name).toBe("NodeNetworkError");
  });
});

describe("NodeError discriminated union", () => {
  it("narrows correctly on kind='auth'", () => {
    const err: NodeError = new NodeAuthError(401, "Unauthorized");

    if (err.kind === "auth") {
      expect(err.statusCode).toBe(401);
    } else {
      throw new Error("Expected auth kind");
    }
  });

  it("narrows correctly on kind='api'", () => {
    const err: NodeError = new NodeApiError(500, "oops");

    if (err.kind === "api") {
      expect(err.statusCode).toBe(500);
    } else {
      throw new Error("Expected api kind");
    }
  });

  it("narrows correctly on kind='network'", () => {
    const err: NodeError = new NodeNetworkError("timeout");

    if (err.kind === "network") {
      expect(err.message).toBe("timeout");
    } else {
      throw new Error("Expected network kind");
    }
  });
});

describe("ValidationFailedError", () => {
  it("has kind='validation'", () => {
    const err = new ValidationFailedError([]);
    expect(err.kind).toBe("validation");
  });

  it("is an instance of Error", () => {
    expect(new ValidationFailedError([])).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new ValidationFailedError([]).name).toBe("ValidationFailedError");
  });

  it("message includes the error count", () => {
    const err = new ValidationFailedError([
      { file: "pipes/p.conf.pipe", message: "missing _id" },
      { file: "pipes/q.conf.pipe", message: "missing type" },
    ]);
    expect(err.message).toBe("Validation failed with 2 error(s)");
  });

  it("exposes the errors array", () => {
    const errors = [{ file: "pipes/p.conf.pipe", message: "missing _id", line: 1, column: 0 }];
    const err = new ValidationFailedError(errors);
    expect(err.errors).toEqual(errors);
  });

  it("handles empty errors array", () => {
    const err = new ValidationFailedError([]);
    expect(err.errors).toHaveLength(0);
    expect(err.message).toBe("Validation failed with 0 error(s)");
  });
});
