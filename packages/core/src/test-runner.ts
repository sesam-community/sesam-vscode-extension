/**
 * Test Runner
 *
 * Orchestrates the full sesam-py `test` command flow:
 *   1. Upload configs + env vars + testdata
 *   2. Run all pipes
 *   3. Verify each spec against actual output
 *
 * No VS Code imports — this file is safe to use from the CLI or tests.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { NodeClient } from "./node-client.js";
import { zipWorkspaceConfig } from "./config-zipper.js";
import { validateWorkspace } from "./validate.js";
import { ValidationFailedError } from "./errors.js";
import { readTestSpec, readExpectedOutput, discoverTestSpecs } from "./test-spec-reader.js";
import { compareTestOutput } from "./test-comparator.js";

import type { Entity, NodeCredentials, RunOptions, TestResult, TestSpec } from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TestPipesOptions extends RunOptions {
  /** Only run tests whose pipe ID appears in this list. */
  whitelist?: string[];
  /** Skip the pre-upload local validation step. */
  skipValidate?: boolean;
  /** Called after each individual test result is available (for streaming UI updates). */
  onResult?: (result: TestResult) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full sesam-py test cycle for a workspace:
 *   upload → run-all-pipes → verify each spec.
 *
 * @param creds        Node credentials.
 * @param workspaceDir Absolute path to the sesam workspace root (contains
 *                     `pipes/`, `systems/`, `expected/`, optionally `testdata/`).
 * @param opts         Pass `whitelist` to test only specific pipes.
 */
export const testPipes = async (
  creds: NodeCredentials,
  workspaceDir: string,
  opts?: TestPipesOptions,
): Promise<TestResult[]> => {
  const client = new NodeClient(creds);

  // ── 1. Validate ──────────────────────────────────────────────────────────
  if (!opts?.skipValidate) {
    const validation = await validateWorkspace(workspaceDir);

    if (!validation.valid) {
      throw new ValidationFailedError(validation.errors);
    }
  }

  // ── 2. PUT env vars (test-env.json) ──────────────────────────────────────
  const testEnvPath = path.join(workspaceDir, "test-env.json");
  const testEnv = await readJson<Record<string, string>>(testEnvPath);

  if (testEnv && Object.keys(testEnv).length > 0) {
    await client.putEnvVars(testEnv);
  }

  // ── 3. ZIP + PUT config ───────────────────────────────────────────────────
  const zipBuffer = await zipWorkspaceConfig(workspaceDir);
  await client.putConfig(zipBuffer);
  await client.waitForDeploy();

  // ── 4. POST testdata to receivers ─────────────────────────────────────────
  const testdataDir = path.join(workspaceDir, "testdata");

  try {
    const entries = await fs.readdir(testdataDir);
    const jsonFiles = entries.filter((f) => f.endsWith(".json"));

    await Promise.all(
      jsonFiles.map(async (file) => {
        const pipeId = path.basename(file, ".json");
        const entities = await readJson<Entity[]>(path.join(testdataDir, file));

        if (entities && entities.length > 0) {
          await client.postToReceiver(pipeId, entities);
        }
      }),
    );
  } catch {
    // testdata/ is optional
  }

  // ── 5. Run all pipes ─────────────────────────────────────────────────────
  await client.runAllPipes({
    extraZeroRuns: opts?.extraZeroRuns ?? 2,
    maxRuns: opts?.maxRuns ?? 100,
    maxRunTime: opts?.maxRunTime,
  });

  // ── 6. Discover specs ────────────────────────────────────────────────────
  const allSpecPaths = await discoverTestSpecs(workspaceDir);
  const specPaths = opts?.whitelist
    ? allSpecPaths.filter((p) => {
        const stem = path.basename(p, ".test.json");
        return opts.whitelist!.includes(stem);
      })
    : allSpecPaths;

  // ── 7. Verify each spec ──────────────────────────────────────────────────
  const results: TestResult[] = [];

  for (const specPath of specPaths) {
    let spec: TestSpec;

    try {
      spec = await readTestSpec(specPath);
    } catch (err) {
      const errorResult: TestResult = {
        spec: {
          pipe: path.basename(specPath, ".test.json"),
          file: "",
          endpoint: "json",
          ignore: false,
          ignore_deletes: true,
          stage: null,
          blacklist: null,
          parameters: null,
          fields_to_sort_by: ["_id"],
        },
        passed: false,
        error: `Failed to read spec: ${err instanceof Error ? err.message : String(err)}`,
      };
      results.push(errorResult);
      opts?.onResult?.(errorResult);
      continue;
    }

    try {
      let actual: Entity[];

      if (spec.endpoint === "json") {
        actual = await client.getPipeEntities(spec.pipe, spec.stage ?? undefined);
      } else {
        actual = (await client.getPublishedData(
          spec.pipe,
          spec.endpoint,
          spec.parameters ?? undefined,
        )) as Entity[];
      }

      const expected = await readExpectedOutput(specPath, spec);
      const compare = compareTestOutput(actual, expected as Entity[], spec);

      const result: TestResult = {
        spec,
        passed: compare.passed,
        diff: compare.diff,
      };
      results.push(result);
      opts?.onResult?.(result);
    } catch (err) {
      const result: TestResult = {
        spec,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
      results.push(result);
      opts?.onResult?.(result);
    }
  }

  return results;
};
