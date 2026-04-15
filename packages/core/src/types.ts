// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface NodeRequestLogEntry {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  error?: string;
}

export type NodeRequestLogger = (entry: NodeRequestLogEntry) => void;

export interface NodeCredentials {
  nodeUrl: string;
  jwtToken: string;
  /** Whether to verify SSL certificates (default: true). */
  sslVerify?: boolean;
  /** Optional logger called after every HTTP request. */
  logger?: NodeRequestLogger;
}

// ---------------------------------------------------------------------------
// Raw API response shapes
// ---------------------------------------------------------------------------

export interface PipeRuntimeInfo {
  state: string;
  success_count?: number;
  failure_count?: number;
  queued?: number;
  retries?: number;
  last_run?: string;
  next_run?: string;
}

export interface ApiPipe {
  _id: string;
  config?: Record<string, unknown>;
  runtime?: PipeRuntimeInfo;
}

export interface ApiSystem {
  _id: string;
  config?: Record<string, unknown>;
}

export type Entity = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadOptions {
  /** Force upload even if the node reports conflicts. */
  force?: boolean;
  /** Additional environment variables to PUT before uploading. */
  envVars?: Record<string, string>;
  /** Skip the pre-upload local validation step (not recommended). */
  skipValidate?: boolean;
}

export interface UploadResult {
  success: boolean;
  pipesUploaded: number;
  systemsUploaded: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export interface DownloadOptions {
  /** Directory to write downloaded configs into.  `pipes/` and `systems/` are created as subdirs. */
  outDir: string;
  /**
   * Optional formatter applied to each config before writing to disk.
   * When omitted, files are written with `JSON.stringify(config, null, 2)`.
   */
  formatter?: (config: unknown) => string;
}

export interface DownloadResult {
  pipesWritten: number;
  systemsWritten: number;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface RunAllOptions {
  /** Number of extra zero-entity runs to flush downstream pipes. */
  extraZeroRuns?: number;
  /** Hard cap on total pump iterations across all pipes. */
  maxRuns?: number;
  /** Wall-clock timeout in seconds for the entire run. */
  maxRunTime?: number;
}

export interface RunResult {
  success: boolean;
  pipeId?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface PipeStatus {
  id: string;
  state: string;
  successCount: number;
  failureCount: number;
  queued: number;
  lastRun?: string;
  nextRun?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  file: string;
  message: string;
  line?: number;
  column?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Single-config upload / download
// ---------------------------------------------------------------------------

export interface SingleUploadResult {
  success: boolean;
  configId: string;
  configType: "pipe" | "system";
  message?: string;
}

export interface DownloadSingleOptions {
  /** Directory to write the downloaded config into (`pipes/` or `systems/` is appended). */
  outDir: string;
  /** Optional formatter applied to the config before writing to disk. */
  formatter?: (config: unknown) => string;
}

export interface SingleDownloadResult {
  configId: string;
  configType: "pipe" | "system";
  filePath: string;
}

// ---------------------------------------------------------------------------
// Test management (F05)
// ---------------------------------------------------------------------------

export interface TestSpec {
  /** Pipe _id to test. */
  pipe: string;
  /** Expected output filename (relative to expected/). */
  file: string;
  /** Publisher endpoint type: "json", "csv", "xml", etc. */
  endpoint: string;
  /** If true, the expected output file should NOT exist. */
  ignore: boolean;
  /** Whether to drop unexpected `_deleted: true` entities. */
  ignore_deletes: boolean;
  /** Named pipeline stage parameter for entity fetch. */
  stage: string | null;
  /** fnmatch patterns for keys to exclude from comparison. */
  blacklist: string[] | null;
  /** Extra query params for the publisher endpoint. */
  parameters: Record<string, string> | null;
  /** Sort fields (full JSON dump used as tiebreaker). */
  fields_to_sort_by: string[];
}

export interface TestResult {
  spec: TestSpec;
  passed: boolean;
  diff?: string;
  error?: string;
}

/** Options for the test orchestration (upload → run → verify). */
export interface RunOptions {
  extraZeroRuns?: number;
  maxRuns?: number;
  maxRunTime?: number;
}
