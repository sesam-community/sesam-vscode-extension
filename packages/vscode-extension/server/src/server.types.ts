// ---------------------------------------------------------------------------
// Shared type definitions for the DTL Language Server
// ---------------------------------------------------------------------------

export interface DtlSettings {
  maxNumberOfProblems: number;
  validate: {
    enabled: boolean;
    unknownFunctions: boolean;
    argCount: boolean;
  };
}

export interface SesamSettings {
  nodeUrl: string;
  jwt: string;
}

export interface ConfigError {
  msg: string;
  elements: string; // JSONPath like "$" or "$['transform']"
  level: string; // "error" | "critical" | "warning" | "info"
}

export interface ValidateConfigResponse {
  "is-valid-config": boolean;
  "config-errors": ConfigError[];
}

export interface SystemTypeInfo {
  label: string; // full "system:xxx" value
  detail: string;
  doc: string;
}

export interface SourceTypeInfo {
  label: string;
  detail: string;
  doc: string;
}
