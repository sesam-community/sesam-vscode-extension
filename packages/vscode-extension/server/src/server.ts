/**
 * DTL Language Server
 * Implements LSP features: completions, hover, diagnostics, and document formatting.
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  TextDocumentPositionParams,
  Hover,
  MarkupKind,
  DocumentFormattingParams,
  TextEdit,
  Range,
  Position,
  Location,
  ReferenceParams,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  DocumentSymbolParams,
  DocumentLink,
  DocumentLinkParams,
  FileChangeType,
  WorkspaceFolder,
  RenameParams,
  PrepareRenameParams,
  WorkspaceEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  getDtlFunction,
  DTL_VARIABLES,
  ENTITY_RESERVED_FIELDS,
} from "../../src/shared/dtl-registry";
import { formatSesamJson } from "../../src/shared/config-formatter";
import { parseDtlText } from "./dtl-parser";
import { validateCalls } from "./dtl-validator";
import { validateStructure } from "./dtl-structure-validator";
import { validatePathStrings } from "./dtl-path-validator";
import { validateConfigStructure } from "./config-structure-validator";
import { defaultSettings } from "./constants";
import {
  isSourceTypeContext,
  isSystemTypeContext,
  isVariableContext,
  isFunctionNameContext,
  buildSystemTypeCompletions,
  buildSourceTypeCompletions,
  buildFunctionCompletions,
  buildVariableCompletions,
  getWordAtPosition,
  buildFunctionMarkdown,
  buildDocumentSymbols,
  offsetToPosition,
} from "./utils/server.utils";
import {
  findApplyRuleReference,
  findRuleDefinition,
  findRuleKeyAtOffset,
  findAllApplyReferences,
} from "./utils/definition.utils";
import { workspaceIndex } from "./utils/workspace-index";
import {
  findDatasetReference,
  findSystemReference,
  findIdAtOffset,
} from "./utils/reference-detection.utils";
import { collectDocumentLinks } from "./utils/document-links.utils";
import { findAllCrossReferences } from "./utils/cross-references.utils";
import {
  findAliasAtOffset,
  findAliasUsageAtOffset,
  collectAliasRanges,
  offsetRangeToLsp,
} from "./utils/alias-rename.utils";

import type { DtlSettings } from "./server.types";
import type { ValidatorOptions } from "../../types/dtl-validator.types";

// ---------------------------------------------------------------------------
// Connection & document store
// ---------------------------------------------------------------------------
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
let workspaceFolders: WorkspaceFolder[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceFolders = params.workspaceFolders ?? [];
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      completionProvider: {
        triggerCharacters: ['"', "[", "_", ".", ":"],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentFormattingProvider: true,
      documentSymbolProvider: true,
      documentLinkProvider: { resolveProvider: false },
      renameProvider: { prepareProvider: true },
    },
  };
});

connection.onInitialized(() => {
  workspaceIndex.scanWorkspace(workspaceFolders);
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    const uri = change.uri;
    if (change.type === FileChangeType.Deleted) {
      workspaceIndex.removeFile(uri);
    } else {
      try {
        const fsPath = fileURLToPath(uri);
        const text = fs.readFileSync(fsPath, "utf-8");
        workspaceIndex.updateFile(uri, text);
      } catch {
        // File temporarily inaccessible — skip
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Settings (kept in sync with VS Code configuration)
// ---------------------------------------------------------------------------
const documentSettings = new Map<string, Promise<DtlSettings>>();

// ---------------------------------------------------------------------------
// Sesam node settings
// ---------------------------------------------------------------------------
// let sesamSettingsCache: SesamSettings | null = null;

// async function getSesamSettings(): Promise<SesamSettings> {
//   if (!sesamSettingsCache) {
//     const s = (await connection.workspace.getConfiguration({
//       section: "sesam",
//     })) as { nodeUrl?: string; jwt?: string } | null;
//     sesamSettingsCache = {
//       nodeUrl: (s?.nodeUrl ?? "").trim().replace(/\/$/, ""),
//       jwt: (s?.jwt ?? "").trim(),
//     };
//   }
//   return sesamSettingsCache;
// }

// Cache for node-backed diagnostics, keyed by document URI
const nodeValidationDiagnostics = new Map<string, Diagnostic[]>();

connection.onDidChangeConfiguration(() => {
  // sesamSettingsCache = null;
  documentSettings.clear();
  documents.all().forEach(validateDocument);
});

async function getDocumentSettings(resource: string): Promise<DtlSettings> {
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace
      .getConfiguration({ scopeUri: resource, section: "dtl" })
      .then((s) => (s as DtlSettings) ?? defaultSettings);
    documentSettings.set(resource, result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation / Diagnostics
// ---------------------------------------------------------------------------
async function validateDocument(document: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(document.uri);

  if (!settings.validate?.enabled) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }

  const text = document.getText();
  const ext = "json";
  const parseResult = parseDtlText(text, ext);
  const diagnostics: Diagnostic[] = [];

  const validatorOptions: ValidatorOptions = {
    maxProblems: settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems,
    validateUnknownFunctions: settings.validate?.unknownFunctions ?? true,
    validateArgCount: settings.validate?.argCount ?? true,
    validateJsonSyntax: settings.validate?.jsonSyntax ?? true,
    validateDtlStructure: settings.validate?.dtlStructure ?? true,
    validateTransformInExpression: settings.validate?.transformInExpression ?? true,
    validatePathExpressions: settings.validate?.pathExpressions ?? false,
    validateConfigStructure: settings.validate?.configStructure ?? true,
    ruleNames: parseResult.ruleNames,
  };

  // Phase A: JSON parse error
  if (parseResult.parseError !== null && validatorOptions.validateJsonSyntax) {
    const offset = parseResult.parseError.offset;
    const pos = offset >= 0 ? offsetToPosition(text, offset) : { line: 0, character: 0 };
    diagnostics.push({
      range: Range.create(
        pos.line,
        pos.character,
        pos.line,
        Math.max(pos.character + 1, pos.character),
      ),
      severity: DiagnosticSeverity.Error,
      message: `Invalid JSON: ${parseResult.parseError.message}`,
      source: "dtl",
      code: "invalid-json",
    });
  } else {
    // Only run semantic checks when JSON is valid
    diagnostics.push(
      ...validateStructure(parseResult.calls, parseResult.structuralErrors, validatorOptions),
    );
    diagnostics.push(...validateCalls(parseResult.calls, validatorOptions));
    diagnostics.push(...validatePathStrings(parseResult.calls, validatorOptions));
    diagnostics.push(...validateConfigStructure(text, validatorOptions));
  }

  const nodeDiags = nodeValidationDiagnostics.get(document.uri) ?? [];
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: [...diagnostics, ...nodeDiags],
  });
}

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

documents.onDidClose((event) => {
  documentSettings.delete(event.document.uri);
  nodeValidationDiagnostics.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Use a wider window so we can detect "source": { "type": context
  const prefix = text.slice(Math.max(0, offset - 2000), offset);

  // Source type completion: inside "source": { "type": "..."
  if (isSourceTypeContext(prefix)) {
    return buildSourceTypeCompletions();
  }

  // System type completion: root-level "type": "system:..."
  if (isSystemTypeContext(prefix)) {
    return buildSystemTypeCompletions();
  }

  // Variable completion: triggered after "_" or inside a string starting with "_"
  if (isVariableContext(prefix)) {
    return buildVariableCompletions();
  }

  // Function name completion: cursor is after an opening "[" (possibly with a quote)
  if (isFunctionNameContext(prefix)) {
    return buildFunctionCompletions();
  }

  return [];
});

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Alias hover — check before word-based lookup
  const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

  if (aliasHit) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${aliasHit.alias}** — alias for dataset \`${aliasHit.datasetId}\``,
      },
    };
  }

  const word = getWordAtPosition(document, params.position);

  if (!word) {
    return null;
  }

  // Check built-in variables first
  if (word.startsWith("_")) {
    const varKey = word.split(".")[0]; // "_S" from "_S.name"
    const varDesc = DTL_VARIABLES[varKey];
    if (varDesc) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${varKey}** — DTL built-in variable\n\n${varDesc}`,
        },
      };
    }
  }

  // Check DTL functions
  const fn = getDtlFunction(word);
  if (fn) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: buildFunctionMarkdown(fn),
      },
    };
  }

  // Reserved entity fields
  if (ENTITY_RESERVED_FIELDS.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** — Sesam reserved entity field.\n\n[DTL documentation](https://docs.sesam.io/hub/quick-reference.html)`,
      },
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// Document Symbols (Outline)
// ---------------------------------------------------------------------------
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  const text = document.getText();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  return buildDocumentSymbols(document, text, parsed as Record<string, unknown>);
});

// ---------------------------------------------------------------------------
// Document Formatting
// ---------------------------------------------------------------------------
connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const formatted = formatSesamJson(parsed, params.options.tabSize ?? 2);
  if (formatted === text) {
    return [];
  }

  const endPos = document.positionAt(text.length);
  return [TextEdit.replace(Range.create(Position.create(0, 0), endPos), formatted)];
});

// ---------------------------------------------------------------------------
// Go to Definition
// ---------------------------------------------------------------------------
connection.onDefinition((params: TextDocumentPositionParams): Location | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // 1. Same-file: apply/apply-hops rule reference
  const ref = findApplyRuleReference(text, offset);
  if (ref) {
    const def = findRuleDefinition(text, ref.ruleName, offset);
    if (def) {
      return Location.create(
        params.textDocument.uri,
        Range.create(document.positionAt(def.keyStart), document.positionAt(def.keyEnd)),
      );
    }
  }

  // 2. Cross-file: dataset reference → pipe file
  const dsRef = findDatasetReference(text, offset);
  if (dsRef) {
    const entry = workspaceIndex.pipeIndex.get(dsRef.name);
    if (entry) {
      const targetText = workspaceIndex.fileTexts.get(entry.uri) ?? "";
      return Location.create(
        entry.uri,
        Range.create(
          offsetToPosition(targetText, entry.idOffset),
          offsetToPosition(targetText, entry.idOffset + dsRef.name.length),
        ),
      );
    }
  }

  // 3. Cross-file: system reference → system file
  const sysRef = findSystemReference(text, offset);
  if (sysRef) {
    const entry = workspaceIndex.systemIndex.get(sysRef.name);
    if (entry) {
      const targetText = workspaceIndex.fileTexts.get(entry.uri) ?? "";
      return Location.create(
        entry.uri,
        Range.create(
          offsetToPosition(targetText, entry.idOffset),
          offsetToPosition(targetText, entry.idOffset + sysRef.name.length),
        ),
      );
    }
  }

  return null;
});

// ---------------------------------------------------------------------------
// Find All References
// ---------------------------------------------------------------------------
connection.onReferences((params: ReferenceParams): Location[] | null => {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Alias references
  const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

  if (aliasHit) {
    const aliasRanges = collectAliasRanges(text, aliasHit.alias);
    return aliasRanges.map((r) =>
      Location.create(params.textDocument.uri, offsetRangeToLsp(document, r)),
    );
  }

  const keyHit = findRuleKeyAtOffset(text, offset);
  const applyHit = keyHit ? null : findApplyRuleReference(text, offset);
  const ruleName = keyHit?.ruleName ?? applyHit?.ruleName ?? null;

  if (!ruleName) {
    // Cross-file: cursor on pipe/system _id value → find all files referencing it
    const idHit = findIdAtOffset(text, offset);
    if (idHit) {
      const crossRefs = findAllCrossReferences(idHit.name, workspaceIndex.fileTexts);
      const locations: Location[] = crossRefs.map(({ uri, nameStart, nameEnd }) => {
        const refText = workspaceIndex.fileTexts.get(uri) ?? "";
        return Location.create(
          uri,
          Range.create(offsetToPosition(refText, nameStart), offsetToPosition(refText, nameEnd)),
        );
      });

      if (params.context.includeDeclaration) {
        locations.push(
          Location.create(
            document.uri,
            Range.create(
              document.positionAt(idHit.range.start),
              document.positionAt(idHit.range.end),
            ),
          ),
        );
      }

      return locations.length > 0 ? locations : null;
    }
    return null;
  }

  const refs = findAllApplyReferences(text, ruleName);
  const locations: Location[] = refs.map(({ start, end }) =>
    Location.create(
      params.textDocument.uri,
      Range.create(document.positionAt(start), document.positionAt(end)),
    ),
  );

  if (params.context.includeDeclaration) {
    const def = findRuleDefinition(text, ruleName, offset);
    if (def) {
      locations.push(
        Location.create(
          params.textDocument.uri,
          Range.create(document.positionAt(def.keyStart), document.positionAt(def.keyEnd)),
        ),
      );
    }
  }

  return locations.length > 0 ? locations : null;
});

// ---------------------------------------------------------------------------
// Document Links
// ---------------------------------------------------------------------------
connection.onDocumentLinks((params: DocumentLinkParams): DocumentLink[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  return collectDocumentLinks(
    document.getText(),
    workspaceIndex.pipeIndex,
    workspaceIndex.systemIndex,
  );
});

// ---------------------------------------------------------------------------
// Rename (dataset alias)
// ---------------------------------------------------------------------------
connection.onPrepareRename(
  (params: PrepareRenameParams): { range: Range; placeholder: string } | null => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return null;
    }

    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

    if (!aliasHit) {
      return null;
    }

    return {
      range: Range.create(
        document.positionAt(aliasHit.aliasStart),
        document.positionAt(aliasHit.aliasEnd),
      ),
      placeholder: aliasHit.alias,
    };
  },
);

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

  if (!aliasHit) {
    return null;
  }

  const aliasRanges = collectAliasRanges(text, aliasHit.alias);
  const edits = aliasRanges.map((r) =>
    TextEdit.replace(offsetRangeToLsp(document, r), params.newName),
  );

  return { changes: { [params.textDocument.uri]: edits } };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
documents.listen(connection);
connection.listen();
