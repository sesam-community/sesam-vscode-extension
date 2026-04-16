/**
 * Test Entity Filter
 *
 * Faithfully reimplements sesam-py's entity filtering, sorting, and
 * normalization logic used during `sesam test` verification.
 */

import type { Entity } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert an fnmatch-style blacklist pattern (as used by sesam-py) into a
 * regular expression. sesam-py replaces `[].` with `*.` before matching so
 * array-traversal patterns work against flattened key paths.
 *
 * Supported wildcards: `*` (any segment), `?` (single char).
 */
const fnmatchToRegex = (pattern: string): RegExp => {
  // Replicate sesam-py's `[].` → `*.` substitution
  const normalised = pattern.replace(/\[\]\./g, "*.");

  const escaped = normalised
    .split("*")
    .map((part) =>
      part
        .split("?")
        .map((p) => p.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
        .join("."),
    )
    .join(".*");

  return new RegExp(`^${escaped}$`);
};

/**
 * Collect all dot-separated key paths in a JSON value (for blacklist matching).
 * e.g. `{ a: { b: 1 } }` → `["a", "a.b"]`
 */
const collectPaths = (value: unknown, prefix = ""): string[] => {
  if (typeof value !== "object" || value === null) {
    return prefix ? [prefix] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPaths(item, prefix));
  }

  return Object.keys(value as Record<string, unknown>).flatMap((key) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return [fullKey, ...collectPaths((value as Record<string, unknown>)[key], fullKey)];
  });
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter a single entity according to sesam-py rules:
 * - Remove all `_`-prefixed keys except `_id` and `_deleted` (only when `true`).
 * - Remove keys matched by any blacklist pattern.
 */
export const filterEntity = (entity: Entity, blacklist?: string[] | null): Entity => {
  const regexes = blacklist?.map(fnmatchToRegex) ?? [];

  const result: Entity = {};

  for (const [key, value] of Object.entries(entity)) {
    // Drop internal keys, but keep _id and _deleted: true
    if (key.startsWith("_")) {
      if (key === "_id") {
        result[key] = value;
      } else if (key === "_deleted" && value === true) {
        result[key] = value;
      }

      continue;
    }

    // Drop keys matched by any blacklist pattern
    const paths = collectPaths({ [key]: value });
    const isBlacklisted = paths.some((p) => regexes.some((re) => re.test(p)));

    if (!isBlacklisted) {
      result[key] = value;
    }
  }

  return result;
};

/**
 * Remove unexpected `_deleted: true` entities from `current` that do not
 * appear in `expected`. sesam-py skips deleted entities that weren't expected
 * when `ignore_deletes` is true (the default).
 */
export const applyIgnoreDeletes = (current: Entity[], expected: Entity[]): Entity[] => {
  const expectedIds = new Set(expected.map((e) => e["_id"]));

  return current.filter((e) => {
    if (e["_deleted"] !== true) {
      return true;
    }

    return expectedIds.has(e["_id"]);
  });
};

/**
 * Normalize a scalar value the same way sesam-py does:
 * - Float `x.0` (e.g. `1.0`) → integer (`1`)
 * - Integer larger than `Number.MAX_SAFE_INTEGER` → float-rounded integer
 */
export const normalizeDecimal = (value: unknown): unknown => {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value % 1 === 0) {
      // Float that is a whole number → integer representation
      return Math.trunc(value);
    }

    if (!Number.isSafeInteger(value)) {
      // Large integer: round-trip through float to match Go client behaviour
      return Math.round(value);
    }
  }

  return value;
};

/**
 * Recursively normalize all numeric values in an entity.
 */
export const normalizeEntity = (entity: unknown): unknown => {
  if (Array.isArray(entity)) {
    return entity.map(normalizeEntity);
  }

  if (typeof entity === "object" && entity !== null) {
    return Object.fromEntries(
      Object.entries(entity as Record<string, unknown>).map(([k, v]) => [k, normalizeEntity(v)]),
    );
  }

  return normalizeDecimal(entity);
};

/**
 * Sort entities by `fieldsToSortBy`, using the full JSON dump as a tiebreaker
 * (sesam-py behaviour: `sorted(entities, key=lambda e: [e.get(f, ''), json.dumps(e)])`).
 */
export const sortEntities = (entities: Entity[], fieldsToSortBy: string[]): Entity[] =>
  [...entities].sort((a, b) => {
    for (const field of fieldsToSortBy) {
      const av = String(a[field] ?? "");
      const bv = String(b[field] ?? "");

      if (av < bv) {
        return -1;
      }

      if (av > bv) {
        return 1;
      }
    }

    // Tiebreaker: full JSON dump
    const aj = JSON.stringify(a);
    const bj = JSON.stringify(b);

    return aj < bj ? -1 : aj > bj ? 1 : 0;
  });
