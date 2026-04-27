import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverTestSpecs, readExpectedOutput, readTestSpec } from "../src/test-spec-reader.js";

// ---------------------------------------------------------------------------
// Temp-dir helpers (mirrors config-zipper.test.ts)
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sesam-spec-reader-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const write = (relPath: string, content: string): Promise<void> =>
  fs
    .mkdir(path.join(tmpDir, path.dirname(relPath)), { recursive: true })
    .then(() => fs.writeFile(path.join(tmpDir, relPath), content, "utf-8"));

// ---------------------------------------------------------------------------
// readTestSpec
// ---------------------------------------------------------------------------

describe("readTestSpec", () => {
  it("fills in all defaults when spec file is empty ({})", async () => {
    await write("expected/my-pipe.test.json", "{}");
    const spec = await readTestSpec(path.join(tmpDir, "expected/my-pipe.test.json"));

    expect(spec.pipe).toBe("my-pipe");
    expect(spec.file).toBe("my-pipe.json");
    expect(spec.endpoint).toBe("json");
    expect(spec.ignore).toBe(false);
    expect(spec.ignore_deletes).toBe(true);
    expect(spec.stage).toBeNull();
    expect(spec.blacklist).toBeNull();
    expect(spec.parameters).toBeNull();
    expect(spec.fields_to_sort_by).toEqual(["_id"]);
  });

  it("uses values from the spec file when provided", async () => {
    const raw = {
      pipe: "custom-pipe",
      file: "custom.json",
      endpoint: "csv",
      ignore: true,
      ignore_deletes: false,
      stage: "stage1",
      blacklist: ["_ts"],
      parameters: { foo: "bar" },
      fields_to_sort_by: ["name"],
    };
    await write("expected/my-pipe.test.json", JSON.stringify(raw));
    const spec = await readTestSpec(path.join(tmpDir, "expected/my-pipe.test.json"));

    expect(spec.pipe).toBe("custom-pipe");
    expect(spec.file).toBe("custom.json");
    expect(spec.endpoint).toBe("csv");
    expect(spec.ignore).toBe(true);
    expect(spec.ignore_deletes).toBe(false);
    expect(spec.stage).toBe("stage1");
    expect(spec.blacklist).toEqual(["_ts"]);
    expect(spec.parameters).toEqual({ foo: "bar" });
    expect(spec.fields_to_sort_by).toEqual(["name"]);
  });

  it("derives pipe id from the filename stem", async () => {
    await write("expected/hello-world.test.json", "{}");
    const spec = await readTestSpec(path.join(tmpDir, "expected/hello-world.test.json"));
    expect(spec.pipe).toBe("hello-world");
  });

  it("throws when the spec file does not exist", async () => {
    await expect(readTestSpec(path.join(tmpDir, "expected/missing.test.json"))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// readExpectedOutput
// ---------------------------------------------------------------------------

describe("readExpectedOutput", () => {
  it("returns parsed JSON array from the expected file", async () => {
    const entities = [{ _id: "a", name: "Alice" }];
    await write("expected/my-pipe.json", JSON.stringify(entities));

    const spec = {
      pipe: "my-pipe",
      file: "my-pipe.json",
      endpoint: "json",
      ignore: false,
      ignore_deletes: true,
      stage: null,
      blacklist: null,
      parameters: null,
      fields_to_sort_by: ["_id"],
    };

    const result = await readExpectedOutput(path.join(tmpDir, "expected/my-pipe.test.json"), spec);

    expect(result).toEqual(entities);
  });

  it("returns empty array when ignore is true and the expected file is absent", async () => {
    // Do not create the expected file
    const spec = {
      pipe: "my-pipe",
      file: "my-pipe.json",
      endpoint: "json",
      ignore: true,
      ignore_deletes: true,
      stage: null,
      blacklist: null,
      parameters: null,
      fields_to_sort_by: ["_id"],
    };

    const result = await readExpectedOutput(path.join(tmpDir, "expected/my-pipe.test.json"), spec);

    expect(result).toEqual([]);
  });

  it("throws when ignore is false and the expected file is absent", async () => {
    const spec = {
      pipe: "my-pipe",
      file: "my-pipe.json",
      endpoint: "json",
      ignore: false,
      ignore_deletes: true,
      stage: null,
      blacklist: null,
      parameters: null,
      fields_to_sort_by: ["_id"],
    };

    await expect(
      readExpectedOutput(path.join(tmpDir, "expected/my-pipe.test.json"), spec),
    ).rejects.toThrow("Cannot read expected output");
  });
});

// ---------------------------------------------------------------------------
// discoverTestSpecs
// ---------------------------------------------------------------------------

describe("discoverTestSpecs", () => {
  it("returns paths for all .test.json files in expected/", async () => {
    await write("expected/pipe-a.test.json", "{}");
    await write("expected/pipe-b.test.json", "{}");

    const specs = await discoverTestSpecs(tmpDir);

    expect(specs).toHaveLength(2);
    expect(specs.some((p) => p.endsWith("pipe-a.test.json"))).toBe(true);
    expect(specs.some((p) => p.endsWith("pipe-b.test.json"))).toBe(true);
  });

  it("excludes non-.test.json files", async () => {
    await write("expected/pipe-a.test.json", "{}");
    await write("expected/pipe-a.json", "[]"); // expected output file, not a spec

    const specs = await discoverTestSpecs(tmpDir);

    expect(specs).toHaveLength(1);
    expect(specs[0]).toContain("pipe-a.test.json");
  });

  it("returns empty array when expected/ directory is absent", async () => {
    const specs = await discoverTestSpecs(tmpDir);
    expect(specs).toEqual([]);
  });

  it("returns empty array when expected/ is empty", async () => {
    await fs.mkdir(path.join(tmpDir, "expected"), { recursive: true });
    const specs = await discoverTestSpecs(tmpDir);
    expect(specs).toEqual([]);
  });

  it("returns absolute paths", async () => {
    await write("expected/pipe-a.test.json", "{}");
    const specs = await discoverTestSpecs(tmpDir);
    expect(path.isAbsolute(specs[0])).toBe(true);
  });
});
