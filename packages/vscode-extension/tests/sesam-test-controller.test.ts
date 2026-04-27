import { describe, expect, it, vi } from "vitest";

// Mock VS Code-dependent local modules before the target module is imported.
vi.mock("../client/src/credential-resolver", () => ({ resolveCredentials: vi.fn() }));
vi.mock("../client/src/sesam-channel", () => ({
  getSesamChannel: vi.fn(() => ({ appendLine: vi.fn() })),
  logNodeRequest: vi.fn(),
}));

const { extractActual } = await import("../client/src/testing/sesam-test-controller");

// ---------------------------------------------------------------------------
// extractActual
// ---------------------------------------------------------------------------

describe("extractActual", () => {
  it("extracts lines starting with + (not +++)", () => {
    const diff = [
      "--- expected/pipe.test.json",
      "+++ actual/pipe",
      "@@ -1,3 +1,3 @@",
      " [",
      '-  { "_id": "a", "x": 1 }',
      '+  { "_id": "a", "x": 2 }',
      " ]",
    ].join("\n");

    expect(extractActual(diff)).toBe('  { "_id": "a", "x": 2 }');
  });

  it("excludes the +++ header line", () => {
    const diff = ["+++ actual/pipe", '+  { "_id": "a" }'].join("\n");

    const result = extractActual(diff);
    expect(result).not.toContain("+++ actual/pipe");
    expect(result).toContain('  { "_id": "a" }');
  });

  it("strips the leading + from each extracted line", () => {
    const diff = ['+  "name": "Alice"', '+  "age": 30'].join("\n");

    const result = extractActual(diff);
    expect(result).toBe('  "name": "Alice"\n  "age": 30');
  });

  it("returns empty string when there are no + lines", () => {
    const diff = ["--- expected/pipe.test.json", "+++ actual/pipe", " context line"].join("\n");

    expect(extractActual(diff)).toBe("");
  });

  it("handles an empty diff string", () => {
    expect(extractActual("")).toBe("");
  });

  it("handles multiple + lines in order", () => {
    const diff = "+line1\n+line2\n+line3";
    expect(extractActual(diff)).toBe("line1\nline2\nline3");
  });
});
