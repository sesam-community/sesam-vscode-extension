import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateWorkspace } from "../src/validate.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sesam-validate-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const writePipe = (name: string, content: unknown) =>
  fs.writeFile(path.join(tmpDir, "pipes", name), JSON.stringify(content), "utf-8");

const writeSystem = (name: string, content: unknown) =>
  fs.writeFile(path.join(tmpDir, "systems", name), JSON.stringify(content), "utf-8");

const mkPipesDir = () => fs.mkdir(path.join(tmpDir, "pipes"), { recursive: true });
const mkSystemsDir = () => fs.mkdir(path.join(tmpDir, "systems"), { recursive: true });

// ---------------------------------------------------------------------------
// validateWorkspace
// ---------------------------------------------------------------------------

describe("validateWorkspace", () => {
  it("returns valid=true when both subdirectories are absent", async () => {
    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid=true for a well-formed pipe config", async () => {
    await mkPipesDir();
    await writePipe("my-pipe.conf.pipe", { _id: "my-pipe", type: "pipe" });

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid=true for a well-formed system config", async () => {
    await mkSystemsDir();
    await writeSystem("my-system.conf.system", { _id: "my-system", type: "system:rest" });

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports an error for missing _id", async () => {
    await mkPipesDir();
    await writePipe("no-id.conf.pipe", { type: "pipe" });

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("_id");
  });

  it("reports an error for missing type", async () => {
    await mkPipesDir();
    await writePipe("no-type.conf.pipe", { _id: "no-type" });

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("type");
  });

  it("reports both errors when _id and type are missing", async () => {
    await mkPipesDir();
    await writePipe("empty.conf.pipe", {});

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("reports a parse error for invalid JSON", async () => {
    await mkPipesDir();
    await fs.writeFile(path.join(tmpDir, "pipes", "bad.conf.pipe"), "{ not json }", "utf-8");

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("JSON parse error");
  });

  it("reports an error when the root value is an array", async () => {
    await mkPipesDir();
    await writePipe("array.conf.pipe", [{ _id: "x", type: "pipe" }]);

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("JSON object");
  });

  it("ignores non-config files in pipes/", async () => {
    await mkPipesDir();
    await fs.writeFile(path.join(tmpDir, "pipes", "readme.txt"), "ignore me", "utf-8");
    await writePipe("real.conf.pipe", { _id: "real", type: "pipe" });

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(true);
  });

  it("collects errors from both pipes/ and systems/", async () => {
    await mkPipesDir();
    await mkSystemsDir();
    await writePipe("bad-pipe.conf.pipe", { type: "pipe" }); // missing _id
    await writeSystem("bad-system.conf.system", { _id: "s" }); // missing type

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("accepts .conf.json extension for backwards compatibility", async () => {
    await mkPipesDir();
    await writePipe("legacy.conf.json", { _id: "legacy", type: "pipe" });

    const result = await validateWorkspace(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
