/**
 * Test Spec Reader
 *
 * Reads `.test.json` spec files and applies all sesam-py defaults.
 * Also loads the companion `expected/<name>.json` file.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { TestSpec } from "./types.js";

// ---------------------------------------------------------------------------
// Raw JSON shape (all fields optional — spec file may omit anything)
// ---------------------------------------------------------------------------

interface RawTestSpec {
  pipe?: string;
  file?: string;
  endpoint?: string;
  ignore?: boolean;
  ignore_deletes?: boolean;
  stage?: string | null;
  blacklist?: string[] | null;
  parameters?: Record<string, string> | null;
  fields_to_sort_by?: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a `.test.json` spec file and return a fully-defaulted `TestSpec`.
 *
 * @param specFilePath Absolute path to the `.test.json` file.
 */
export const readTestSpec = async (specFilePath: string): Promise<TestSpec> => {
  const raw = JSON.parse(await fs.readFile(specFilePath, "utf-8")) as RawTestSpec;
  const stem = path.basename(specFilePath, ".test.json");

  return {
    pipe: raw.pipe ?? stem,
    file: raw.file ?? `${stem}.json`,
    endpoint: raw.endpoint ?? "json",
    ignore: raw.ignore ?? false,
    ignore_deletes: raw.ignore_deletes ?? true,
    stage: raw.stage ?? null,
    blacklist: raw.blacklist ?? null,
    parameters: raw.parameters ?? null,
    fields_to_sort_by: raw.fields_to_sort_by ?? ["_id"],
  };
};

/**
 * Load the expected output file for a test spec.
 *
 * @param specFilePath Absolute path to the `.test.json` file.
 * @param spec         Parsed TestSpec (needed for the `file` field).
 * @returns            Parsed JSON array, or `null` when `spec.ignore` is true
 *                     and the expected file does not exist.
 */
export const readExpectedOutput = async (
  specFilePath: string,
  spec: TestSpec,
): Promise<unknown[]> => {
  const expectedDir = path.dirname(specFilePath);
  const expectedPath = path.join(expectedDir, spec.file);

  try {
    const text = await fs.readFile(expectedPath, "utf-8");
    return JSON.parse(text) as unknown[];
  } catch (err) {
    if (
      spec.ignore &&
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }

    throw new Error(
      `Cannot read expected output '${expectedPath}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/**
 * Discover all `.test.json` spec files under a test suite directory.
 *
 * @param suiteDir Absolute path to the test suite (contains `expected/`).
 * @returns         Absolute paths to every `.test.json` found.
 */
export const discoverTestSpecs = async (suiteDir: string): Promise<string[]> => {
  const expectedDir = path.join(suiteDir, "expected");

  try {
    const entries = await fs.readdir(expectedDir);
    return entries.filter((f) => f.endsWith(".test.json")).map((f) => path.join(expectedDir, f));
  } catch {
    return [];
  }
};
