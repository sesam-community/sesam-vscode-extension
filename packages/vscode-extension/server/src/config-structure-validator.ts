/**
 * Config Structure Validator — Phase E
 *
 * Validates that pipe and system config JSON objects contain the minimum required
 * top-level properties AND that `type` values on the config, source, transform,
 * and sink are drawn from the documented allowed value sets.
 *
 *   Pipe   (_id, type = "pipe", source)
 *   System (_id, type = "system:<known-type>")
 *
 * Type checks (Warning severity — unknown types may appear in connectors):
 *   pipe.type         must be "pipe"           (already Error in missing-type)
 *   system.type       must be one of SYSTEM_TYPES
 *   source.type       must be one of PIPE_SOURCE_TYPES
 *   transform[].type  must be one of TRANSFORM_TYPES
 *   sink.type         must be one of SINK_TYPES
 *
 * Handles both a single config object { ... } and an array of configs [{ ... }, ...].
 *
 * Docs:
 *   Pipes:      https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-pipes.html
 *   Systems:    https://docs.sesam.io/hub/documentation/service-configuration/systems/configuration-systems.html
 *   Sources:    https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources.html
 *   Transforms: https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-transforms.html
 *   Sinks:      https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sinks.html
 */

import { Diagnostic, DiagnosticSeverity, Range, Position } from "vscode-languageserver/node";

import { SYSTEM_TYPES, PIPE_SOURCE_TYPES, TRANSFORM_TYPES, SINK_TYPES } from "./constants";

import type { ValidatorOptions } from "../../types/dtl-validator.types";

// ---------------------------------------------------------------------------
// Precomputed sets (derived from constants so they stay in sync)
// ---------------------------------------------------------------------------

const KNOWN_SYSTEM_TYPES: ReadonlySet<string> = new Set(SYSTEM_TYPES.map((s) => s.label));
const KNOWN_SOURCE_TYPES: ReadonlySet<string> = new Set(PIPE_SOURCE_TYPES.map((s) => s.label));

// ---------------------------------------------------------------------------
// Source type field schemas (required + allowed keys, excluding "type")
// Sourced from each type's dedicated docs page.
// ---------------------------------------------------------------------------

interface SourceSchema {
  required: readonly string[];
  allowed: ReadonlySet<string>;
}

// Properties available on every source type regardless of "type".
// "type" itself is always excluded from field-level checks via the filter below.
// Ref: https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources.html
const COMMON_SOURCE_PROPS: ReadonlySet<string> = new Set([
  "comment",
  // Continuation support properties (relevant when supports_since is true)
  "supports_since",
  "is_since_comparable",
  "is_chronological",
  "updated_expression",
  "since_property_name",
  "since_property_location",
  "initial_since_value",
]);

const SOURCE_SCHEMAS: Readonly<Record<string, SourceSchema>> = (() => {
  const define = (required: string[], allowed: string[]): SourceSchema => ({
    required,
    allowed: new Set([...required, ...allowed]),
  });

  return {
    dataset: define(
      ["dataset"],
      [
        "subset",
        "completeness",
        "initial_completeness",
        "require_populated_input",
        "include_previous_versions",
        "include_replaced",
        "supports_signalling",
        "if_source_empty",
      ],
    ),
    sql: define(
      ["system", "table"],
      [
        "primary_key",
        "query",
        "updated_column",
        "updated_query",
        "schema",
        "whitelist",
        "blacklist",
        "preserve_null_values",
        "fetch_size",
        "if_source_empty",
        "supports_since",
        "is_since_comparable",
        "is_chronological",
        "is_chronological_full",
      ],
    ),
    rest: define(
      ["system", "operation"],
      [
        "operations",
        "properties",
        "payload",
        "response_property",
        "response_headers_property",
        "response_include_content_type",
        "payload_property",
        "id_expression",
        "updated_expression",
        "rate_limiting_retries",
        "rate_limiting_delay",
        "if_source_empty",
        "trace",
        "supports_since",
        "is_since_comparable",
        "is_chronological",
        "since_property_name",
        "since_property_location",
        "initial_since_value",
      ],
    ),
    json: define(
      ["system", "url"],
      [
        "supports_signalling",
        "page_size",
        "subset",
        "headers",
        "if_source_empty",
        "supports_since",
        "is_since_comparable",
        "is_chronological",
      ],
    ),
    csv: define(
      ["url", "system", "primary_key"],
      [
        "has_header",
        "field_names",
        "auto_dialect",
        "dialect",
        "encoding",
        "decode_error_strategy",
        "whitelist",
        "blacklist",
        "preserve_empty_strings",
        "delimiter",
        "escape_null_bytes",
        "if_source_empty",
        "supports_since",
        "is_since_comparable",
        "is_chronological",
      ],
    ),
    http_endpoint: define(
      [],
      [
        "auto_populate_dataset",
        "do_float_as_decimal",
        "do_float_as_int",
        "trace",
        "validation_expression",
      ],
    ),
    embedded: define(
      ["entities"],
      ["system", "if_source_empty", "supports_since", "is_since_comparable", "is_chronological"],
    ),
    empty: define([], []),
    union_datasets: define(
      ["datasets"],
      [
        "initial_datasets",
        "ignore_non_existent_datasets",
        "require_populated_input",
        "include_previous_versions",
        "supports_signalling",
        "prefix_ids",
        "if_source_empty",
      ],
    ),
    merge: define(
      ["datasets"],
      [
        "version",
        "initial_datasets",
        "ignore_non_existent_datasets",
        "require_populated_input",
        "equality",
        "equality_sets",
        "identity",
        "strategy",
        "include_internal_properties",
        "max_merged",
        "supports_signalling",
        "if_source_empty",
      ],
    ),
    merge_datasets: define(
      ["datasets"],
      [
        "initial_datasets",
        "ignore_non_existent_datasets",
        "require_populated_input",
        "strategy",
        "supports_signalling",
        "if_source_empty",
      ],
    ),
    conditional: define(["condition", "alternatives"], []),
    kafka: define(
      ["system", "topic"],
      [
        "partitions",
        "seek_to_beginning",
        "key_deserializer",
        "value_deserializer",
        "strategy",
        "strict",
        "consumer_timeout_ms",
      ],
    ),
    ldap: define(
      ["system"],
      [
        "search_base",
        "search_filter",
        "attributes",
        "id_attribute",
        "page_size",
        "attribute_blacklist",
        "if_source_empty",
      ],
    ),
    binary: define(["system", "url"], ["supports_signalling", "page_size", "subset"]),
    sdshare: define(
      ["system", "url"],
      ["sort_lists", "if_source_empty", "supports_since", "is_chronological"],
    ),
    sparql: define(
      ["system", "fragments_query", "fragment_query"],
      [
        "initial_since_value",
        "if_source_empty",
        "supports_since",
        "is_since_comparable",
        "is_chronological",
      ],
    ),
    rdf: define(
      ["system", "url"],
      [
        "format",
        "sort_lists",
        "is_sorted",
        "if_source_empty",
        "supports_since",
        "is_since_comparable",
        "is_chronological",
      ],
    ),
  };
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toPos = (line: number, character: number): Position => Position.create(line, character);

const toRange = (line: number, character: number, endChar?: number): Range =>
  Range.create(toPos(line, character), toPos(line, endChar ?? character + 1));

/**
 * Find the 0-based line and character of the first occurrence of `needle`
 * in `text`, starting from `fromOffset`. Returns null when not found.
 */
const findPosition = (
  text: string,
  needle: string,
  fromOffset = 0,
): { line: number; character: number; offset: number } | null => {
  const idx = text.indexOf(needle, fromOffset);

  if (idx === -1) {
    return null;
  }

  let line = 0;
  let character = 0;

  for (let i = 0; i < idx; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }

  return { line, character, offset: idx };
};

/**
 * Return a Range covering the JSON string value of `key` within `text`,
 * searching from `fromOffset`. Falls back to `fallback` when not found.
 */
const keyValueRange = (text: string, key: string, fromOffset: number, fallback: Range): Range => {
  const keyHit = findPosition(text, `"${key}"`, fromOffset);

  if (!keyHit) {
    return fallback;
  }

  const afterColon = text.indexOf(":", keyHit.offset + key.length + 2);

  if (afterColon === -1) {
    return fallback;
  }

  let valStart = afterColon + 1;

  while (valStart < text.length && " \t\r\n".includes(text[valStart])) {
    valStart++;
  }

  if (text[valStart] !== '"') {
    return fallback;
  }

  const valEnd = text.indexOf('"', valStart + 1);

  if (valEnd === -1) {
    return fallback;
  }

  const startPos = findPosition(text, text.slice(valStart, valEnd + 1), valStart);

  if (!startPos) {
    return fallback;
  }

  return Range.create(
    toPos(startPos.line, startPos.character),
    toPos(startPos.line, startPos.character + (valEnd - valStart + 1)),
  );
};

// ---------------------------------------------------------------------------
// Nested type validation helpers
// ---------------------------------------------------------------------------

/**
 * Emit a Warning diagnostic when `value` is not in `knownTypes`.
 * `searchFrom` is the approximate text offset at which to locate the key for
 * squiggle positioning — falls back to `fallback` range on miss.
 */
const checkType = (
  text: string,
  value: string,
  knownTypes: ReadonlySet<string>,
  key: string,
  searchFrom: number,
  fallback: Range,
  label: string,
  out: Diagnostic[],
): void => {
  if (knownTypes.has(value)) {
    return;
  }

  const range = keyValueRange(text, key, searchFrom, fallback);
  out.push({
    range,
    severity: DiagnosticSeverity.Warning,
    message: `Unknown ${label} type "${value}". Expected one of: ${[...knownTypes].join(", ")}.`,
    source: "sesam",
    code: "unknown-type",
  });
};

/**
 * Find the text offset of an object nested under `parentKey` inside the slice
 * starting at `fromOffset`. Returns -1 if not found.
 */
const findNestedObjectOffset = (text: string, parentKey: string, fromOffset: number): number => {
  const keyHit = text.indexOf(`"${parentKey}"`, fromOffset);

  if (keyHit === -1) {
    return -1;
  }

  const colon = text.indexOf(":", keyHit + parentKey.length + 2);

  if (colon === -1) {
    return -1;
  }

  let valStart = colon + 1;

  while (valStart < text.length && " \t\r\n".includes(text[valStart])) {
    valStart++;
  }

  return valStart;
};

// ---------------------------------------------------------------------------
// Per-object validation
// ---------------------------------------------------------------------------

type ConfigObject = Record<string, unknown>;

const validateOne = (
  text: string,
  obj: ConfigObject,
  fromOffset: number,
  out: Diagnostic[],
  maxProblems: number,
): void => {
  const openBrace = findPosition(text, "{", fromOffset);
  const fallback = openBrace ? toRange(openBrace.line, openBrace.character) : toRange(0, 0);

  // --- _id ---
  if (!("_id" in obj) || typeof obj["_id"] !== "string" || obj["_id"].trim() === "") {
    out.push({
      range: fallback,
      severity: DiagnosticSeverity.Error,
      message: 'Sesam config is missing required property "_id" (must be a non-empty string).',
      source: "sesam",
      code: "missing-id",
    });

    if (out.length >= maxProblems) {
      return;
    }
  }

  // --- type ---
  const typeVal = obj["type"];

  if (typeof typeVal !== "string" || typeVal.trim() === "") {
    out.push({
      range: fallback,
      severity: DiagnosticSeverity.Error,
      message:
        'Sesam config is missing required property "type". Expected "pipe" or "system:<type>".',
      source: "sesam",
      code: "missing-type",
    });

    return;
  }

  const isPipe = typeVal === "pipe";
  const isSystem = typeVal.startsWith("system:");
  const isMetadata = typeVal === "metadata";

  // Service metadata config (node-metadata.conf.json) — no pipe/system rules apply.
  if (isMetadata) {
    return;
  }

  if (!isPipe && !isSystem) {
    const typeRange = keyValueRange(text, "type", fromOffset, fallback);
    out.push({
      range: typeRange,
      severity: DiagnosticSeverity.Warning,
      message: `Unknown config type "${typeVal}". Expected "pipe", "system:<type>" (e.g. "system:rest"), or "metadata".`,
      source: "sesam",
      code: "invalid-type",
    });

    if (out.length >= maxProblems) {
      return;
    }
  }

  // --- system: validate specific system subtype ---
  if (isSystem) {
    checkType(text, typeVal, KNOWN_SYSTEM_TYPES, "type", fromOffset, fallback, "system", out);

    if (out.length >= maxProblems) {
      return;
    }
  }

  // --- pipe-specific checks ---
  if (isPipe) {
    // source: required + type check
    if (!("source" in obj)) {
      const sourceRange = keyValueRange(text, "type", fromOffset, fallback);
      out.push({
        range: sourceRange,
        severity: DiagnosticSeverity.Error,
        message: 'Pipe config is missing required property "source".',
        source: "sesam",
        code: "missing-source",
      });

      if (out.length >= maxProblems) {
        return;
      }
    } else {
      const sourceObj = obj["source"];

      if (typeof sourceObj === "object" && sourceObj !== null && !Array.isArray(sourceObj)) {
        const srcType = (sourceObj as Record<string, unknown>)["type"];

        if (typeof srcType !== "string" || srcType.trim() === "") {
          const sourceRange = keyValueRange(text, "source", fromOffset, fallback);
          out.push({
            range: sourceRange,
            severity: DiagnosticSeverity.Error,
            message: 'Source object is missing required property "type".',
            source: "sesam",
            code: "missing-source-type",
          });

          if (out.length >= maxProblems) {
            return;
          }
        } else {
          const sourceOffset = findNestedObjectOffset(text, "source", fromOffset);
          checkType(
            text,
            srcType,
            KNOWN_SOURCE_TYPES,
            "type",
            sourceOffset !== -1 ? sourceOffset : fromOffset,
            fallback,
            "source",
            out,
          );

          if (out.length >= maxProblems) {
            return;
          }

          // Validate required and allowed fields for known source types
          const schema = SOURCE_SCHEMAS[srcType];

          if (schema) {
            const srcKeys = Object.keys(sourceObj as Record<string, unknown>).filter(
              (k) => k !== "type" && !COMMON_SOURCE_PROPS.has(k),
            );

            // Missing required fields
            for (const req of schema.required) {
              if (!(req in (sourceObj as Record<string, unknown>))) {
                const sourceRange = keyValueRange(
                  text,
                  "type",
                  sourceOffset !== -1 ? sourceOffset : fromOffset,
                  fallback,
                );
                out.push({
                  range: sourceRange,
                  severity: DiagnosticSeverity.Error,
                  message: `Source type "${srcType}" is missing required property "${req}".`,
                  source: "sesam",
                  code: "missing-source-property",
                });

                if (out.length >= maxProblems) {
                  return;
                }
              }
            }

            // Unknown fields (common props are already excluded from srcKeys)
            for (const key of srcKeys) {
              if (!schema.allowed.has(key)) {
                const keyRange = keyValueRange(
                  text,
                  key,
                  sourceOffset !== -1 ? sourceOffset : fromOffset,
                  fallback,
                );
                out.push({
                  range: keyRange,
                  severity: DiagnosticSeverity.Warning,
                  message: `Property "${key}" is not valid for source type "${srcType}".`,
                  source: "sesam",
                  code: "invalid-source-property",
                });

                if (out.length >= maxProblems) {
                  return;
                }
              }
            }
          }
        }
      }
    }

    // transform: may be an object or an array of objects
    const transforms = obj["transform"];

    if (transforms !== undefined && transforms !== null) {
      const steps = Array.isArray(transforms) ? transforms : [transforms];

      for (const step of steps) {
        if (out.length >= maxProblems) {
          break;
        }

        if (typeof step === "object" && step !== null && !Array.isArray(step)) {
          const tType = (step as Record<string, unknown>)["type"];

          if (typeof tType === "string" && tType.trim() !== "") {
            const transformOffset = findNestedObjectOffset(text, "transform", fromOffset);
            checkType(
              text,
              tType,
              TRANSFORM_TYPES,
              "type",
              transformOffset !== -1 ? transformOffset : fromOffset,
              fallback,
              "transform",
              out,
            );
          }

          // dtl transform: rules object must have a "default" rule
          if (tType === "dtl" || tType === undefined) {
            const rulesObj = (step as Record<string, unknown>)["rules"];

            if (
              typeof rulesObj === "object" &&
              rulesObj !== null &&
              !Array.isArray(rulesObj) &&
              !("default" in rulesObj)
            ) {
              const transformOffset = findNestedObjectOffset(text, "transform", fromOffset);
              const rulesOffset = findNestedObjectOffset(
                text,
                "rules",
                transformOffset !== -1 ? transformOffset : fromOffset,
              );
              const rulesRange = keyValueRange(
                text,
                "rules",
                transformOffset !== -1 ? transformOffset : fromOffset,
                fallback,
              );
              out.push({
                range: rulesOffset !== -1 ? rulesRange : fallback,
                severity: DiagnosticSeverity.Error,
                message:
                  'DTL transform is missing a "default" rule. The default rule is the entry point for the transform.',
                source: "sesam",
                code: "missing-default-rule",
              });
            }
          }
        }
      }
    }

    // sink: optional, type check when present
    const sinkObj = obj["sink"];

    if (typeof sinkObj === "object" && sinkObj !== null && !Array.isArray(sinkObj)) {
      const sinkType = (sinkObj as Record<string, unknown>)["type"];

      if (typeof sinkType === "string" && sinkType.trim() !== "") {
        const sinkOffset = findNestedObjectOffset(text, "sink", fromOffset);
        checkType(
          text,
          sinkType,
          SINK_TYPES,
          "type",
          sinkOffset !== -1 ? sinkOffset : fromOffset,
          fallback,
          "sink",
          out,
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export const validateConfigStructure = (text: string, options: ValidatorOptions): Diagnostic[] => {
  if (!options.validateConfigStructure) {
    return [];
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(text);
  } catch {
    return [];
  }

  const out: Diagnostic[] = [];

  if (Array.isArray(parsedJson)) {
    let searchFrom = 0;

    for (const item of parsedJson) {
      if (out.length >= options.maxProblems) {
        break;
      }

      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const bracePos = text.indexOf("{", searchFrom);
        validateOne(text, item as ConfigObject, searchFrom, out, options.maxProblems);
        searchFrom = bracePos + 1;
      }
    }
  } else if (typeof parsedJson === "object" && parsedJson !== null) {
    validateOne(text, parsedJson as ConfigObject, 0, out, options.maxProblems);
  }

  return out;
};
