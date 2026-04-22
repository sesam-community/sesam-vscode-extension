/**
 * Test Comparator
 *
 * Compares the actual pipe output against the expected output, following
 * sesam-py's exact serialisation and diff behaviour.
 */

import { createTwoFilesPatch } from "diff";

import {
  applyIgnoreDeletes,
  filterEntity,
  normalizeEntity,
  sortEntities,
} from "./test-entity-filter.js";

import type { Entity, TestSpec } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestCompareResult {
  passed: boolean;
  diff?: string;
  /** Set when both sides have different entity counts. */
  lengthMismatch?: { actual: number; expected: number };
  /** Fully serialised actual output (same format as the expected file). */
  actualSerialized?: string;
}

// ---------------------------------------------------------------------------
// Serialisation helpers  (sesam-py compatible)
// ---------------------------------------------------------------------------

/**
 * Serialise entities to a JSON string with sorted keys and HTML-escaped
 * `< > &` characters (matching sesam-py's `json.dumps` with `sort_keys=True`
 * and `ensure_ascii=False` + manual HTML escape).
 */
const serialise = (entities: Entity[]): string =>
  JSON.stringify(entities, sortedReplacer, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

/** JSON replacer that sorts object keys (mimics `sort_keys=True`). */
const sortedReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  }

  return value;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare actual pipe entities against expected output following the full
 * sesam-py verification pipeline:
 *
 * 1. Filter both sides (remove `_*` keys, apply blacklist)
 * 2. Apply `ignore_deletes` to actual
 * 3. Sort both sides
 * 4. Normalize decimals
 * 5. Serialize with sorted keys + HTML escaping
 * 6. Unified diff on mismatch
 */
export const compareTestOutput = (
  actual: Entity[],
  expected: Entity[],
  spec: TestSpec,
): TestCompareResult => {
  const filteredActual = actual
    .map((e) => filterEntity(e, spec.blacklist))
    .map((e) => normalizeEntity(e) as Entity);

  const filteredExpected = expected
    .map((e) => filterEntity(e, spec.blacklist))
    .map((e) => normalizeEntity(e) as Entity);

  const reconciled = spec.ignore_deletes
    ? applyIgnoreDeletes(filteredActual, filteredExpected)
    : filteredActual;

  const sortedActual = sortEntities(reconciled, spec.fields_to_sort_by);
  const sortedExpected = sortEntities(filteredExpected, spec.fields_to_sort_by);

  const actualStr = serialise(sortedActual);
  const expectedStr = serialise(sortedExpected);

  if (actualStr === expectedStr) {
    return { passed: true };
  }

  const lengthMismatch =
    sortedActual.length !== sortedExpected.length
      ? { actual: sortedActual.length, expected: sortedExpected.length }
      : undefined;

  const diff = createTwoFilesPatch(
    `expected/${spec.file}`,
    `actual/${spec.pipe}`,
    expectedStr,
    actualStr,
    "",
    "",
    { context: 3 },
  );

  return { passed: false, diff, lengthMismatch, actualSerialized: actualStr };
};
