/**
 * DTL Registry — shared types.
 * Imported by dtl-registry.ts and re-exported from there for backwards compatibility.
 */

export type DtlFunctionKind = "transform" | "expression";

export type DtlCategory =
  | "Transforms"
  | "Boolean logic"
  | "Booleans"
  | "Bytes"
  | "Comparisons"
  | "Conditionals"
  | "Date and time"
  | "Dictionaries"
  | "Encryption"
  | "Hops"
  | "JSON"
  | "Lists"
  | "Math"
  | "Misc"
  | "Namespaced identifiers"
  | "Nulls"
  | "Numbers"
  | "Phonenumbers"
  | "Sets"
  | "Strings"
  | "URIs"
  | "UUIDs";

export interface DtlParam {
  name: string;
  description: string;
  optional?: boolean;
}

export interface DtlFunction {
  /** The function name as it appears in DTL (e.g. "add", "concat") */
  name: string;
  category: DtlCategory;
  kind: DtlFunctionKind;
  /** Human-readable call signature, e.g. "add(property, value)" */
  signature: string;
  /** Short description shown in hover and completion details */
  description: string;
  params: readonly DtlParam[];
  /** Minimum number of arguments (excluding function name) */
  minArgs: number;
  /** Maximum number of arguments. null = variadic */
  maxArgs: number | null;
  docUrl: string;
}
