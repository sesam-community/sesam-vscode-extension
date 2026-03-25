import {
  DiagnosticSeverity,
  CompletionItem,
  CompletionItemKind,
  MarkupKind,
  DocumentSymbol,
  SymbolKind,
  Range,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  getAllFunctions,
  DTL_VARIABLES,
  ENTITY_RESERVED_FIELDS,
} from "../../../src/shared/dtl-registry";
import { parseDtlText } from "../dtl-parser";
import { SYSTEM_TYPES, PIPE_SOURCE_TYPES } from "../constants";

import type { DtlFunction } from "../../../src/shared/dtl-registry";
import type { DtlRange } from "../dtl-parser";

// ---------------------------------------------------------------------------
// Node-backed validation helpers (retained for future use)
// ---------------------------------------------------------------------------
export const levelToSeverity = (level: string): DiagnosticSeverity => {
  switch (level) {
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    default: // "error" or "critical"
      return DiagnosticSeverity.Error;
  }
};

export const escapeRegex = (s: string): string => {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const elementsToRange = (document: TextDocument, text: string, elements: string): Range => {
  const match = /\['([^']+)'\]/.exec(elements);
  if (match) {
    const key = match[1];
    const keyPattern = new RegExp(`"${escapeRegex(key)}"\\s*:`);
    const m = keyPattern.exec(text);
    if (m) {
      const start = document.positionAt(m.index);
      const end = document.positionAt(m.index + m[0].length);
      return Range.create(start, end);
    }
  }
  return Range.create(Position.create(0, 0), Position.create(0, Number.MAX_VALUE));
};

// ---------------------------------------------------------------------------
// Completion context predicates
// ---------------------------------------------------------------------------
export const isSourceTypeContext = (prefix: string): boolean => {
  return /"source"\s*:\s*\{[^{}]*"type"\s*:\s*"[^"]*$/.test(prefix);
};

export const isSystemTypeContext = (prefix: string): boolean => {
  if (!/"type"\s*:\s*"[^"]*$/.test(prefix)) {
    return false;
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (const c of prefix) {
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\" && inStr) {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      }
    }
  }
  return depth === 1;
};

export const isVariableContext = (prefix: string): boolean => {
  return /"\s*_[STPRB]?\.?[^"]*$/.test(prefix);
};

export const isFunctionNameContext = (prefix: string): boolean => {
  return /\[\s*"[^"]*$/.test(prefix) || /\[\s*$/.test(prefix);
};

// ---------------------------------------------------------------------------
// Completion item builders
// ---------------------------------------------------------------------------
export const buildSystemTypeCompletions = (): CompletionItem[] => {
  return SYSTEM_TYPES.map(({ label, detail, doc }) => ({
    label,
    kind: CompletionItemKind.EnumMember,
    detail,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**\`${label}\`** — ${detail}\n\n${doc}\n\n[📖 Documentation](https://docs.sesam.io/hub/documentation/service-configuration/systems/configuration-systems.html)`,
    },
    insertText: label,
    sortText: label,
  }));
};

export const buildSourceTypeCompletions = (): CompletionItem[] => {
  return PIPE_SOURCE_TYPES.map(({ label, detail, doc }) => ({
    label,
    kind: CompletionItemKind.EnumMember,
    detail,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**\`${label}\`** — pipe source type\n\n${doc}\n\n[📖 Documentation](https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources.html)`,
    },
    insertText: label,
    sortText: label,
  }));
};

export const buildFunctionCompletions = (): CompletionItem[] => {
  return getAllFunctions().map((fn: DtlFunction) => ({
    label: fn.name,
    kind: fn.kind === "transform" ? CompletionItemKind.Method : CompletionItemKind.Function,
    detail: fn.description,
    labelDetails: { description: fn.signature },
    documentation: {
      kind: MarkupKind.Markdown,
      value: buildFunctionMarkdown(fn),
    },
    sortText: fn.kind === "transform" ? `0_${fn.name}` : `1_${fn.name}`,
    insertText: fn.name,
  }));
};

export const buildVariableCompletions = (): CompletionItem[] => {
  const items: CompletionItem[] = Object.entries(DTL_VARIABLES).map(([name, desc]) => ({
    label: name,
    kind: CompletionItemKind.Variable,
    detail: desc,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${name}** — DTL built-in variable\n\n${desc}\n\n[📖 Documentation](https://docs.sesam.io/hub/dtl/dtl-variables.html)`,
    },
    insertText: name,
    sortText: `0_${name}`,
  }));
  ENTITY_RESERVED_FIELDS.forEach((field) => {
    items.push({
      label: field,
      kind: CompletionItemKind.Field,
      detail: "Sesam entity reserved field",
      insertText: field,
      sortText: `1_${field}`,
    });
  });
  return items;
};

// ---------------------------------------------------------------------------
// Hover helpers
// ---------------------------------------------------------------------------
export const getWordAtPosition = (document: TextDocument, position: Position): string | null => {
  const text = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }
  let end = offset;
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }
  if (start === end) {
    return null;
  }
  return text.slice(start, end);
};

export const isWordChar = (ch: string): boolean => {
  return /[a-zA-Z0-9_$\-!.]/.test(ch);
};

export const buildFunctionMarkdown = (fn: DtlFunction): string => {
  const kindLabel = fn.kind === "transform" ? "🔧 Transform" : "📦 Expression";
  const params = fn.params
    .map((p) => `- \`${p.name}\`${p.optional ? " *(optional)*" : ""} — ${p.description}`)
    .join("\n");
  const argInfo =
    fn.maxArgs === null
      ? `${fn.minArgs}+ arguments`
      : fn.minArgs === fn.maxArgs
        ? `${fn.minArgs} argument${fn.minArgs !== 1 ? "s" : ""}`
        : `${fn.minArgs}–${fn.maxArgs} arguments`;
  return [
    `**\`${fn.name}\`** — ${fn.category} · ${kindLabel}`,
    "",
    `\`\`\`\n${fn.signature}\n\`\`\``,
    "",
    fn.description,
    "",
    params ? `**Parameters** (${argInfo}):\n${params}` : `*No arguments.*`,
    "",
    `[📖 Documentation](${fn.docUrl})`,
  ].join("\n");
};

// ---------------------------------------------------------------------------
// Document Symbols helpers
// ---------------------------------------------------------------------------
export const lspRange = (r: DtlRange): Range => {
  return Range.create(
    Position.create(r.start.line, r.start.character),
    Position.create(r.end.line, r.end.character),
  );
};

export const findKeyOffset = (text: string, key: string, fromOffset = 0): number => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escaped}"\\s*:`);
  const m = pattern.exec(text.slice(fromOffset));
  return m ? fromOffset + m.index : -1;
};

/** Convert a zero-based character offset in `text` to an LSP Position. */
export const offsetToPosition = (text: string, offset: number): Position => {
  const clamped = Math.min(offset, text.length);
  let line = 0;
  let character = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return Position.create(line, character);
};

export const buildDocumentSymbols = (
  document: TextDocument,
  text: string,
  obj: Record<string, unknown>,
): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];

  // ── _id symbol ────────────────────────────────────────────────────────────
  const configId = obj["_id"];
  if (typeof configId === "string") {
    const off = findKeyOffset(text, "_id");
    if (off >= 0) {
      const pos = document.positionAt(off);
      const range = Range.create(pos, document.positionAt(off + 5));
      symbols.push(
        DocumentSymbol.create(`_id: ${configId}`, undefined, SymbolKind.Key, range, range, []),
      );
    }
  }

  // ── transform ─────────────────────────────────────────────────────────────
  const rawTransform = obj["transform"];
  if (rawTransform == null || typeof rawTransform !== "object") {
    return symbols;
  }

  // Normalise: always work with a flat list of step objects.
  const isArrayTransform = Array.isArray(rawTransform);
  const allSteps: unknown[] = isArrayTransform ? (rawTransform as unknown[]) : [rawTransform];

  // Collect only DTL steps that have a "rules" object, in document order.
  interface DtlStepInfo {
    rulesObj: Record<string, unknown>;
    rulesKeyOff: number;
    /** Exclusive end offset bounding this step (start of next step's rules, or text.length). */
    boundary: number;
  }

  const dtlStepInfos: DtlStepInfo[] = [];
  let searchFrom = 0;

  for (const step of allSteps) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      continue;
    }
    const rules = (step as Record<string, unknown>)["rules"];
    if (rules == null || typeof rules !== "object" || Array.isArray(rules)) {
      continue;
    }
    const rulesKeyOff = findKeyOffset(text, "rules", searchFrom);
    if (rulesKeyOff < 0) {
      continue;
    }
    dtlStepInfos.push({
      rulesObj: rules as Record<string, unknown>,
      rulesKeyOff,
      boundary: 0, // filled below
    });
    searchFrom = rulesKeyOff + 7; // advance past `"rules"`
  }

  // Set each step's boundary to the next step's rulesKeyOff, last step → text.length.
  for (let i = 0; i < dtlStepInfos.length; i++) {
    dtlStepInfos[i].boundary =
      i + 1 < dtlStepInfos.length ? dtlStepInfos[i + 1].rulesKeyOff : text.length;
  }

  if (dtlStepInfos.length === 0) {
    return symbols;
  }

  const allTopCalls = parseDtlText(text, "json").calls.filter(
    (c) => c.isTopLevel && c.functionName !== null,
  );

  // When the transform is an array with more than one DTL step, label each "dtl [N]".
  const multiStep = isArrayTransform && dtlStepInfos.length > 1;

  /** Build rule-name child symbols for one DTL step. */
  const buildStepRuleSymbols = ({
    rulesObj,
    rulesKeyOff,
    boundary,
  }: DtlStepInfo): DocumentSymbol[] => {
    const ruleNames = Object.keys(rulesObj);
    if (ruleNames.length === 0) {
      return [];
    }

    const ruleOffsets: Array<{ name: string; start: number; end: number }> = [];
    let ruleSearchFrom = rulesKeyOff;
    for (const name of ruleNames) {
      const off = findKeyOffset(text, name, ruleSearchFrom);
      if (off >= 0 && off < boundary) {
        ruleOffsets.push({ name, start: off, end: 0 });
        ruleSearchFrom = off + name.length + 3;
      }
    }
    ruleOffsets.sort((a, b) => a.start - b.start);
    for (let i = 0; i < ruleOffsets.length; i++) {
      ruleOffsets[i].end = i + 1 < ruleOffsets.length ? ruleOffsets[i + 1].start : boundary;
    }

    return ruleOffsets.map(({ name, start, end }) => {
      const callsInRule = allTopCalls.filter(
        (c) => c.range.start.offset >= start && c.range.start.offset < end,
      );
      const callSymbols = callsInRule.map((c) => {
        const r = lspRange(c.range);
        return DocumentSymbol.create(c.functionName!, undefined, SymbolKind.Function, r, r, []);
      });

      const namePos = document.positionAt(start);
      const bodyRange =
        callSymbols.length > 0
          ? Range.create(namePos, callSymbols[callSymbols.length - 1].range.end)
          : Range.create(namePos, document.positionAt(start + name.length + 2));

      return DocumentSymbol.create(
        name,
        `${callSymbols.length} rule${callSymbols.length !== 1 ? "s" : ""}`,
        SymbolKind.Module,
        bodyRange,
        bodyRange,
        callSymbols,
      );
    });
  };

  // Build the child symbols that sit directly under "transform".
  const transformChildren: DocumentSymbol[] = [];

  for (let si = 0; si < dtlStepInfos.length; si++) {
    const stepInfo = dtlStepInfos[si];
    const ruleSymbols = buildStepRuleSymbols(stepInfo);
    if (ruleSymbols.length === 0) {
      continue;
    }

    const rulesPos = document.positionAt(Math.max(0, stepInfo.rulesKeyOff));
    const lastRule = ruleSymbols[ruleSymbols.length - 1];
    const rulesRange = Range.create(rulesPos, lastRule.range.end);

    if (isArrayTransform) {
      // Each DTL step is labelled "dtl" (or "dtl [N]" when there are multiple).
      const label = multiStep ? `dtl [${si + 1}]` : "dtl";
      transformChildren.push(
        DocumentSymbol.create(
          label,
          undefined,
          SymbolKind.Namespace,
          rulesRange,
          rulesRange,
          ruleSymbols,
        ),
      );
    } else {
      // Plain-object transform: keep existing "rules" wrapper.
      transformChildren.push(
        DocumentSymbol.create(
          "rules",
          undefined,
          SymbolKind.Namespace,
          rulesRange,
          rulesRange,
          ruleSymbols,
        ),
      );
    }
  }

  if (transformChildren.length === 0) {
    return symbols;
  }

  const transformOff = findKeyOffset(text, "transform");
  const transformPos = document.positionAt(Math.max(0, transformOff));
  const lastChild = transformChildren[transformChildren.length - 1];
  const transformRange = Range.create(transformPos, lastChild.range.end);

  symbols.push(
    DocumentSymbol.create(
      "transform",
      undefined,
      SymbolKind.Namespace,
      transformRange,
      transformRange,
      transformChildren,
    ),
  );

  return symbols;
};
