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
  RenameFile,
  TextDocumentEdit,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
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
  isTransformTypeContext,
  isSystemTypeContext,
  isVariableContext,
  isDtlRuleArrayContext,
  isPropKeyContext,
  getPropKeyContext,
  getConfigFileType,
  buildSystemTypeCompletions,
  buildSourceTypeCompletions,
  buildTransformTypeCompletions,
  buildFunctionCompletions,
  buildVariableCompletions,
  buildPropCompletions,
  getWordAtPosition,
  isWordChar,
  isAtJsonKeyPosition,
  buildPropKeyHover,
  buildFunctionMarkdown,
  buildSourceTypeHover,
  buildSystemTypeHover,
  buildTransformTypeHover,
  buildDocumentSymbols,
  offsetToPosition,
  getRefKeyAtValuePosition,
  buildRefValueHover,
  getPermissionsActionContext,
  buildPermissionsActionCompletions,
  buildPermissionsActionHover,
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
import {
  findAllCrossReferences,
  findAllDatasetCrossRefs,
  findAllSystemCrossRefs,
} from "./utils/cross-references.utils";
import {
  findAliasAtOffset,
  findAliasUsageAtOffset,
  collectAliasRanges,
  offsetRangeToLsp,
} from "./utils/alias-rename.utils";
import { findAddPropertyAtOffset, findAllAddPropertyDefinitions } from "./utils/dtl-property.utils";
import { buildCodeActionsForDiagnostics } from "./utils/code-actions.utils";

import type { DtlSettings } from "./server.types";
import type { ConfigFileType } from "./utils/server.utils";
import type { ValidatorOptions } from "../../types/dtl-validator.types";
import type {
  LintContentRequest,
  LintContentResponse,
  LintDiagnostic,
  LintSeverity,
  LintWorkspaceRequest,
  LintWorkspaceResponse,
} from "../../types/lint.types";

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
        triggerCharacters: ['"', "[", "_", ".", ":", "{"],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentFormattingProvider: true,
      documentSymbolProvider: true,
      documentLinkProvider: { resolveProvider: false },
      renameProvider: { prepareProvider: true },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
    },
  };
});

connection.onInitialized(() => {
  void workspaceIndex.scanWorkspace(workspaceFolders);
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    const uri = change.uri;

    if (change.type === FileChangeType.Deleted) {
      workspaceIndex.removeFile(uri);
    } else {
      void fs.promises
        .readFile(fileURLToPath(uri), "utf-8")
        .then((text) => {
          workspaceIndex.updateFile(uri, text);
        })
        .catch(() => {
          // File temporarily inaccessible — skip
        });
    }
  }
});

// ---------------------------------------------------------------------------
// Concurrency limiter — caps parallel validateDocument calls to avoid
// saturating the event loop when many files are validated at once (e.g. on
// config-change when 1 000+ documents are open).
// ---------------------------------------------------------------------------
function makeLimiter(concurrency: number): (fn: () => Promise<void>) => void {
  let running = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (queue.length === 0 || running >= concurrency) {
      return;
    }

    running++;
    const task = queue.shift()!;
    task();
  };

  return (fn: () => Promise<void>): void => {
    queue.push(() => {
      fn().finally(() => {
        running--;
        next();
      });
    });
    next();
  };
}

const limitedValidate = makeLimiter(4);

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
  documents.all().forEach((doc) => limitedValidate(() => validateDocument(doc)));
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
  workspaceIndex.updateFile(change.document.uri, change.document.getText());
  limitedValidate(() => validateDocument(change.document));
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

  const fileType = getConfigFileType(params.textDocument.uri);

  // Source type completion: inside "source": { "type": "..."
  if (isSourceTypeContext(prefix)) {
    return buildSourceTypeCompletions();
  }

  // Transform type completion: inside "transform": { "type": "..."
  if (isTransformTypeContext(prefix)) {
    return buildTransformTypeCompletions();
  }

  // System type completion: root-level "type": "system:..."
  // Not applicable for node-metadata.conf.json
  if (isSystemTypeContext(prefix) && fileType !== "node-metadata") {
    return buildSystemTypeCompletions();
  }

  // Permissions action completion: must be checked before isPropKeyContext because
  // `, "` inside an actions array also matches the generic key-position predicate.
  const permCtx = getPermissionsActionContext(prefix);

  if (permCtx) {
    // Infer system vs pipe from content for .conf.json files where URI alone is ambiguous.
    const effectiveFileType: ConfigFileType =
      fileType !== "unknown" ? fileType : /"type"\s*:\s*"system:/.test(prefix) ? "system" : "pipe";

    return buildPermissionsActionCompletions(effectiveFileType, permCtx.usedActions);
  }

  // Property key completion: cursor is at a JSON object key position.
  // Checked before variable context so that keys starting with "_" (like "_id")
  // get prop completions rather than DTL variable completions.
  if (isPropKeyContext(prefix)) {
    const ctx = getPropKeyContext(prefix);

    if (ctx) {
      return buildPropCompletions(
        ctx.path,
        fileType,
        ctx.presentKeys,
        ctx.hasOpenQuote,
        ctx.typeAtCurrentDepth,
      );
    }
  }

  // Variable completion: triggered after "_" or inside a string starting with "_"
  if (isVariableContext(prefix)) {
    return buildVariableCompletions();
  }

  // Function name completion: only inside a DTL rule array (transform.rules.<name>.[...)
  if (isDtlRuleArrayContext(prefix)) {
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
        value: `**${aliasHit.alias}**\n\nalias for dataset \`${aliasHit.datasetId}\``,
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
          value: `**${varKey}**\n\nDTL built-in variable\n\n${varDesc}\n\n[📖 Documentation](https://docs.sesam.io/hub/dtl/variables.html)`,
        },
      };
    }
  }

  // Check DTL functions — only when NOT at a JSON key position.
  // Function names appear as string values inside arrays (["add", ...]),
  // never as object keys, so a key like "default" under "rules" must not
  // be mistaken for the DTL `default` function.
  if (!isAtJsonKeyPosition(text, offset)) {
    const prefix = text.slice(0, offset);

    // System type value hover ("type": "system:*")
    if (isSystemTypeContext(prefix)) {
      const content = buildSystemTypeHover(word);

      if (content) {
        return { contents: { kind: MarkupKind.Markdown, value: content } };
      }
    }

    // Source type value hover (inside source.type)
    if (isSourceTypeContext(prefix)) {
      const content = buildSourceTypeHover(word);

      if (content) {
        return { contents: { kind: MarkupKind.Markdown, value: content } };
      }
    }

    // Transform type value hover (inside transform.type)
    if (isTransformTypeContext(prefix)) {
      const content = buildTransformTypeHover(word);

      if (content) {
        return { contents: { kind: MarkupKind.Markdown, value: content } };
      }
    }

    // Reference value hover ("dataset": "...", "system": "...", etc.)
    const refHit = getRefKeyAtValuePosition(prefix);

    if (refHit) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: buildRefValueHover(refHit.refKey, refHit.block, word),
        },
      };
    }

    // Permissions action hover ("read_config", "write_config", etc.)
    const permHover = buildPermissionsActionHover(word);

    if (permHover) {
      return { contents: { kind: MarkupKind.Markdown, value: permHover } };
    }

    const fn = getDtlFunction(word);

    if (fn) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: buildFunctionMarkdown(fn),
        },
      };
    }
  }

  // Reserved entity fields
  if (ENTITY_RESERVED_FIELDS.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}**\n\nSesam reserved entity field.\n\n[DTL documentation](https://docs.sesam.io/hub/quick-reference.html)`,
      },
    };
  }

  // Config property key hover
  if (isAtJsonKeyPosition(text, offset)) {
    let wordStart = offset;

    while (wordStart > 0 && isWordChar(text[wordStart - 1])) {
      wordStart--;
    }

    const hoverPrefix = text.slice(0, wordStart);
    const hoverCtx = getPropKeyContext(hoverPrefix);

    if (hoverCtx?.path[hoverCtx.path.length - 1] === "rules") {
      const isDefault = word === "default";

      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: isDefault
            ? `**\`default\`** *(required)*\n\nThe entry-point DTL rule. Every DTL transform must have a \`default\` rule — it is the rule applied to each source entity.`
            : `**\`${word}\`**\n\nDTL rule name\n\nCan be invoked from the \`default\` rule (or other rules) via \`apply\` or \`apply-hops\`.`,
        },
      };
    }

    const detail = buildPropKeyHover(word, hoverCtx?.path ?? []);

    if (detail) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**\`${word}\`**\n\n${detail}`,
        },
      };
    }
  }

  return null;
});

// ---------------------------------------------------------------------------
// Code Actions (Quick Fixes)
// ---------------------------------------------------------------------------
connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return [];
  }

  return buildCodeActionsForDiagnostics(
    document.getText(),
    document,
    params.context.diagnostics,
    params.textDocument.uri,
  );
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

  // DTL add/add-if property references — checked before alias so a property
  // named the same as a dataset alias doesn't get hijacked.
  const propHit = findAddPropertyAtOffset(text, offset);

  if (propHit) {
    const defs = findAllAddPropertyDefinitions(text, propHit.propName);
    return defs.map(({ start, end }) =>
      Location.create(
        params.textDocument.uri,
        Range.create(document.positionAt(start), document.positionAt(end)),
      ),
    );
  }

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
    // Cross-file: cursor on _id, dataset ref, or system ref → find all files referencing it
    const idHit = findIdAtOffset(text, offset);
    const dsHit = !idHit ? findDatasetReference(text, offset) : null;
    const sysHit = !idHit && !dsHit ? findSystemReference(text, offset) : null;
    const refName = idHit?.name ?? dsHit?.name ?? sysHit?.name ?? null;

    if (!refName) {
      return null;
    }

    const crossRefs = findAllCrossReferences(refName, workspaceIndex.fileTexts);
    const locations: Location[] = crossRefs.map(({ uri, nameStart, nameEnd }) => {
      const refText = workspaceIndex.fileTexts.get(uri) ?? "";
      return Location.create(
        uri,
        Range.create(offsetToPosition(refText, nameStart), offsetToPosition(refText, nameEnd)),
      );
    });

    if (params.context.includeDeclaration) {
      if (idHit) {
        // Cursor IS on the declaration
        locations.push(
          Location.create(
            document.uri,
            Range.create(
              document.positionAt(idHit.range.start),
              document.positionAt(idHit.range.end),
            ),
          ),
        );
      } else {
        // Cursor is on a reference — add the defining _id location
        const entry =
          workspaceIndex.pipeIndex.get(refName) ?? workspaceIndex.systemIndex.get(refName);

        if (entry) {
          const entryText = workspaceIndex.fileTexts.get(entry.uri) ?? "";
          locations.push(
            Location.create(
              entry.uri,
              Range.create(
                offsetToPosition(entryText, entry.idOffset),
                offsetToPosition(entryText, entry.idOffset + refName.length),
              ),
            ),
          );
        }
      }
    }

    return locations.length > 0 ? locations : null;
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
// Rename (dataset alias and DTL rule name)
// ---------------------------------------------------------------------------
connection.onPrepareRename(
  (params: PrepareRenameParams): { range: Range; placeholder: string } | null => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return null;
    }

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // Try rule key first, then apply-reference, then property name, then alias.
    const ruleKeyHit = findRuleKeyAtOffset(text, offset);

    if (ruleKeyHit) {
      return {
        range: Range.create(
          document.positionAt(ruleKeyHit.keyRange.start),
          document.positionAt(ruleKeyHit.keyRange.end),
        ),
        placeholder: ruleKeyHit.ruleName,
      };
    }

    const applyHit = findApplyRuleReference(text, offset);

    if (applyHit) {
      return {
        range: Range.create(
          document.positionAt(applyHit.nameRange.start),
          document.positionAt(applyHit.nameRange.end),
        ),
        placeholder: applyHit.ruleName,
      };
    }

    // Property name check before alias — avoids false-positive alias match.
    const propHitPR = findAddPropertyAtOffset(text, offset);

    if (propHitPR) {
      return {
        range: Range.create(
          document.positionAt(propHitPR.nameStart),
          document.positionAt(propHitPR.nameEnd),
        ),
        placeholder: propHitPR.propName,
      };
    }

    const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

    if (!aliasHit) {
      // Fall through to _id check as last resort.
      const idHit = findIdAtOffset(text, offset);

      if (!idHit) {
        // Also allow rename from a dataset/system reference site
        const dsHitPR = findDatasetReference(text, offset);
        const sysHitPR = !dsHitPR ? findSystemReference(text, offset) : null;
        const refHitPR = dsHitPR ?? sysHitPR;

        if (!refHitPR) {
          return null;
        }

        if (
          !workspaceIndex.pipeIndex.has(refHitPR.name) &&
          !workspaceIndex.systemIndex.has(refHitPR.name)
        ) {
          return null;
        }

        return {
          range: Range.create(
            document.positionAt(refHitPR.range.start),
            document.positionAt(refHitPR.range.end),
          ),
          placeholder: refHitPR.name,
        };
      }

      return {
        range: Range.create(
          document.positionAt(idHit.range.start),
          document.positionAt(idHit.range.end),
        ),
        placeholder: idHit.name,
      };
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

  // Rule rename: find the rule name (from key or apply-ref), then rename all occurrences.
  const ruleKeyHit = findRuleKeyAtOffset(text, offset);
  const applyHit = !ruleKeyHit ? findApplyRuleReference(text, offset) : null;
  const ruleName = ruleKeyHit?.ruleName ?? applyHit?.ruleName ?? null;

  if (ruleName !== null) {
    const ruleDef = findRuleDefinition(text, ruleName, offset);
    const applyRefs = findAllApplyReferences(text, ruleName);

    const allRanges: Array<{ start: number; end: number }> = [];

    if (ruleDef) {
      allRanges.push({ start: ruleDef.keyStart, end: ruleDef.keyEnd });
    }

    allRanges.push(...applyRefs);

    const edits = allRanges.map((r) =>
      TextEdit.replace(
        Range.create(document.positionAt(r.start), document.positionAt(r.end)),
        params.newName,
      ),
    );

    return { changes: { [params.textDocument.uri]: edits } };
  }

  // Add/add-if property rename — checked before alias.
  const propHitRen = findAddPropertyAtOffset(text, offset);

  if (propHitRen !== null) {
    const propDefs = findAllAddPropertyDefinitions(text, propHitRen.propName);
    const edits = propDefs.map(({ start, end }) =>
      TextEdit.replace(
        Range.create(document.positionAt(start), document.positionAt(end)),
        params.newName,
      ),
    );

    return { changes: { [params.textDocument.uri]: edits } };
  }

  const aliasHit = findAliasAtOffset(text, offset) ?? findAliasUsageAtOffset(text, offset);

  if (!aliasHit) {
    const idHit = findIdAtOffset(text, offset);

    if (idHit) {
      return {
        documentChanges: buildIdRenameDocumentChanges(
          idHit.name,
          params.newName,
          params.textDocument.uri,
          document,
          text,
          idHit.range.start,
        ),
      };
    }

    // Rename from a dataset/system reference site — renames the target pipe/system.
    const dsHitRen = findDatasetReference(text, offset);
    const sysHitRen = !dsHitRen ? findSystemReference(text, offset) : null;
    const refHitRen = dsHitRen ?? sysHitRen;

    if (!refHitRen) {
      return null;
    }

    const targetEntry =
      workspaceIndex.pipeIndex.get(refHitRen.name) ??
      workspaceIndex.systemIndex.get(refHitRen.name);

    if (!targetEntry) {
      return null;
    }

    const targetRawText = workspaceIndex.fileTexts.get(targetEntry.uri) ?? "";
    const targetDoc = documents.get(targetEntry.uri);

    return {
      documentChanges: buildIdRenameDocumentChanges(
        refHitRen.name,
        params.newName,
        targetEntry.uri,
        targetDoc ?? null,
        targetRawText,
        targetEntry.idOffset,
      ),
    };
  }

  const aliasRanges = collectAliasRanges(text, aliasHit.alias);
  const edits = aliasRanges.map((r) =>
    TextEdit.replace(offsetRangeToLsp(document, r), params.newName),
  );

  return { changes: { [params.textDocument.uri]: edits } };
});

// ---------------------------------------------------------------------------
// Rename helper
// ---------------------------------------------------------------------------

/**
 * Builds the full documentChanges array for renaming a config _id:
 * updates the _id value in the target file, renames the file, and updates
 * all cross-file dataset references (unless sink.dataset is explicit).
 */
function buildIdRenameDocumentChanges(
  oldId: string,
  newId: string,
  targetUri: string,
  targetDoc: TextDocument | null,
  targetText: string,
  idValueOffset: number,
): (TextDocumentEdit | RenameFile)[] {
  const lastSlash = targetUri.lastIndexOf("/");
  const ext = targetUri.endsWith(".conf.pipe")
    ? ".conf.pipe"
    : targetUri.endsWith(".conf.system")
      ? ".conf.system"
      : ".conf.json";
  const newUri = targetUri.slice(0, lastSlash + 1) + newId + ext;

  const idEnd = idValueOffset + oldId.length;
  const idTextEdit = TextEdit.replace(
    targetDoc
      ? Range.create(targetDoc.positionAt(idValueOffset), targetDoc.positionAt(idEnd))
      : Range.create(
          offsetToPosition(targetText, idValueOffset),
          offsetToPosition(targetText, idEnd),
        ),
    newId,
  );

  const documentChanges: (TextDocumentEdit | RenameFile)[] = [
    TextDocumentEdit.create({ uri: targetUri, version: null }, [idTextEdit]),
    RenameFile.create(targetUri, newUri),
  ];

  let parsedConfig: Record<string, unknown> = {};

  try {
    parsedConfig = JSON.parse(targetText) as Record<string, unknown>;
  } catch {
    // ignore
  }

  const configType = typeof parsedConfig["type"] === "string" ? parsedConfig["type"] : "";
  const isSystem = configType === "system" || configType.startsWith("system:");

  const sinkObj =
    typeof parsedConfig["sink"] === "object" && parsedConfig["sink"] !== null
      ? (parsedConfig["sink"] as Record<string, unknown>)
      : {};
  const explicitSinkDataset = typeof sinkObj["dataset"] === "string" ? sinkObj["dataset"] : null;

  if (isSystem || explicitSinkDataset === null) {
    // For systems: find all "system": "id" references.
    // For pipes without explicit sink.dataset: find all dataset references.
    // Include all files — even targetUri itself (self-referencing uses).
    const datasetRefs = isSystem
      ? findAllSystemCrossRefs(oldId, workspaceIndex.fileTexts)
      : findAllDatasetCrossRefs(oldId, workspaceIndex.fileTexts, "");
    const refsByUri = new Map<string, Array<{ start: number; end: number }>>();

    for (const ref of datasetRefs) {
      const existing = refsByUri.get(ref.uri) ?? [];
      existing.push({ start: ref.nameStart, end: ref.nameEnd });
      refsByUri.set(ref.uri, existing);
    }

    for (const [refUri, ranges] of refsByUri) {
      const refRawText = workspaceIndex.fileTexts.get(refUri) ?? "";
      const crossEdits = ranges.map((r) =>
        TextEdit.replace(
          Range.create(offsetToPosition(refRawText, r.start), offsetToPosition(refRawText, r.end)),
          newId,
        ),
      );

      if (refUri === targetUri) {
        // Merge self-references into the existing _id TextDocumentEdit so VS Code
        // doesn't receive two edits for the same URI (it would drop the second).
        const existing = documentChanges[0] as TextDocumentEdit;
        documentChanges[0] = TextDocumentEdit.create({ uri: targetUri, version: null }, [
          ...existing.edits,
          ...crossEdits,
        ]);
      } else {
        documentChanges.push(TextDocumentEdit.create({ uri: refUri, version: null }, crossEdits));
      }
    }
  }

  return documentChanges;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Custom request: sesam/lintContent
// ---------------------------------------------------------------------------

async function lintText(text: string, uri: string): Promise<LintDiagnostic[]> {
  const settings = await getDocumentSettings(uri);
  const parseResult = parseDtlText(text, "json");
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
    diagnostics.push(
      ...validateStructure(parseResult.calls, parseResult.structuralErrors, validatorOptions),
    );
    diagnostics.push(...validateCalls(parseResult.calls, validatorOptions));
    diagnostics.push(...validatePathStrings(parseResult.calls, validatorOptions));
    diagnostics.push(...validateConfigStructure(text, validatorOptions));
  }

  return diagnostics.map((d) => ({
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character },
    },
    severity: (d.severity ?? DiagnosticSeverity.Information) as LintSeverity,
    message: d.message,
    code: typeof d.code === "string" ? d.code : d.code !== undefined ? String(d.code) : undefined,
    source: d.source,
  }));
}

connection.onRequest(
  "sesam/lintContent",
  async (params: LintContentRequest): Promise<LintContentResponse> => {
    try {
      let text: string;
      let fileLabel: string;

      if (params.content !== undefined) {
        text = params.content;
        fileLabel = "inline content";
      } else if (params.uri) {
        const openDoc = documents.get(params.uri);

        if (openDoc) {
          text = openDoc.getText();
        } else {
          text = fs.readFileSync(fileURLToPath(params.uri), "utf-8");
        }

        fileLabel = params.uri.split("/").pop() ?? params.uri;
      } else {
        return {
          diagnostics: [],
          fileLabel: "unknown",
          error: "Either 'uri' or 'content' must be provided.",
        };
      }

      const diagnostics = await lintText(text, params.uri ?? "untitled:lint");

      return { diagnostics, fileLabel };
    } catch (e) {
      return { diagnostics: [], fileLabel: "unknown", error: String(e) };
    }
  },
);

// ---------------------------------------------------------------------------
// Custom request: sesam/lintWorkspace
// ---------------------------------------------------------------------------

connection.onRequest(
  "sesam/lintWorkspace",
  async (params: LintWorkspaceRequest): Promise<LintWorkspaceResponse> => {
    try {
      const maxProblems = params.maxProblems ?? 100;
      const minSeverity: LintSeverity = params.minSeverity ?? 4;
      const results: LintWorkspaceResponse["results"] = [];
      let totalCollected = 0;

      for (const uri of workspaceIndex.allFileUris()) {
        if (totalCollected >= maxProblems) {
          break;
        }

        try {
          const text = workspaceIndex.fileTexts.get(uri);

          if (text === undefined) {
            continue;
          }

          const allDiags = await lintText(text, uri);
          const filtered = allDiags.filter((d) => d.severity <= minSeverity);

          if (filtered.length > 0) {
            results.push({
              uri,
              fileLabel: uri.split("/").pop() ?? uri,
              diagnostics: filtered.slice(0, maxProblems - totalCollected),
            });
            totalCollected += filtered.length;
          }
        } catch {
          // Skip unreadable files silently
        }
      }

      return { results };
    } catch (e) {
      return { results: [], error: String(e) };
    }
  },
);

documents.listen(connection);
connection.listen();
