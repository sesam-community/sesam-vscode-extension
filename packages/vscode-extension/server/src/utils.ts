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
} from "../../src/shared/dtl-registry";
import { parseDtlText } from "./dtl-parser";
import { SYSTEM_TYPES, PIPE_SOURCE_TYPES } from "./constants";

import type { DtlFunction } from "../../src/shared/dtl-registry";
import type { DtlRange } from "./dtl-parser";

// ---------------------------------------------------------------------------
// Node-backed validation helpers (retained for future use)
// ---------------------------------------------------------------------------
export function levelToSeverity(level: string): DiagnosticSeverity {
  switch (level) {
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    default: // "error" or "critical"
      return DiagnosticSeverity.Error;
  }
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function elementsToRange(document: TextDocument, text: string, elements: string): Range {
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
  return Range.create(Position.create(0, 0), Position.create(0, Number.MAX_SAFE_INTEGER));
}

// ---------------------------------------------------------------------------
// Completion context predicates
// ---------------------------------------------------------------------------
export function isSourceTypeContext(prefix: string): boolean {
  return /"source"\s*:\s*\{[^{}]*"type"\s*:\s*"[^"]*$/.test(prefix);
}

export function isSystemTypeContext(prefix: string): boolean {
  if (!/"type"\s*:\s*"[^"]*$/.test(prefix)) return false;
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
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
  }
  return depth === 1;
}

export function isVariableContext(prefix: string): boolean {
  return /"\s*_[STPRB]?\.?[^"]*$/.test(prefix);
}

export function isFunctionNameContext(prefix: string): boolean {
  return /\[\s*"[^"]*$/.test(prefix) || /\[\s*$/.test(prefix);
}

// ---------------------------------------------------------------------------
// Completion item builders
// ---------------------------------------------------------------------------
export function buildSystemTypeCompletions(): CompletionItem[] {
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
}

export function buildSourceTypeCompletions(): CompletionItem[] {
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
}

export function buildFunctionCompletions(): CompletionItem[] {
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
}

export function buildVariableCompletions(): CompletionItem[] {
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
}

// ---------------------------------------------------------------------------
// Hover helpers
// ---------------------------------------------------------------------------
export function getWordAtPosition(document: TextDocument, position: Position): string | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isWordChar(text[end])) end++;
  if (start === end) return null;
  return text.slice(start, end);
}

export function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_$\-!.]/.test(ch);
}

export function buildFunctionMarkdown(fn: DtlFunction): string {
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
}

// ---------------------------------------------------------------------------
// Document Symbols helpers
// ---------------------------------------------------------------------------
export function lspRange(r: DtlRange): Range {
  return Range.create(
    Position.create(r.start.line, r.start.character),
    Position.create(r.end.line, r.end.character),
  );
}

export function findKeyOffset(text: string, key: string, fromOffset = 0): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escaped}"\\s*:`);
  const m = pattern.exec(text.slice(fromOffset));
  return m ? fromOffset + m.index : -1;
}

export function buildDocumentSymbols(
  document: TextDocument,
  text: string,
  obj: Record<string, unknown>,
): DocumentSymbol[] {
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

  // ── transform.rules ───────────────────────────────────────────────────────
  const rawTransform = obj["transform"];
  // Transform can be a plain object or an array of transform steps; find the DTL step.
  const transform: Record<string, unknown> | null = Array.isArray(rawTransform)
    ? (((rawTransform as unknown[]).find(
        (t) => typeof t === "object" && t !== null && !Array.isArray(t),
      ) as Record<string, unknown> | undefined) ?? null)
    : typeof rawTransform === "object" && rawTransform !== null
      ? (rawTransform as Record<string, unknown>)
      : null;
  if (!transform) return symbols;

  const rules = transform["rules"];
  if (rules == null || typeof rules !== "object" || Array.isArray(rules)) return symbols;

  const rulesObj = rules as Record<string, unknown>;
  const ruleNames = Object.keys(rulesObj);
  if (ruleNames.length === 0) return symbols;

  const topCalls = parseDtlText(text, "json").calls.filter(
    (c) => c.isTopLevel && c.functionName !== null,
  );

  const rulesKeyOff = findKeyOffset(text, "rules");
  const ruleOffsets: Array<{ name: string; start: number; end: number }> = [];
  for (const name of ruleNames) {
    const off = findKeyOffset(text, name, rulesKeyOff);
    if (off >= 0) ruleOffsets.push({ name, start: off, end: Infinity });
  }
  ruleOffsets.sort((a, b) => a.start - b.start);
  for (let i = 0; i < ruleOffsets.length - 1; i++) {
    ruleOffsets[i].end = ruleOffsets[i + 1].start;
  }

  const ruleSymbols: DocumentSymbol[] = [];
  for (const { name, start, end } of ruleOffsets) {
    const callsInRule = topCalls.filter(
      (c) => c.range.start.offset >= start && c.range.start.offset < end,
    );
    const callSymbols: DocumentSymbol[] = callsInRule.map((c) => {
      const r = lspRange(c.range);
      return DocumentSymbol.create(c.functionName!, undefined, SymbolKind.Function, r, r, []);
    });

    const namePos = document.positionAt(start);
    const bodyRange =
      callSymbols.length > 0
        ? Range.create(namePos, callSymbols[callSymbols.length - 1].range.end)
        : Range.create(namePos, document.positionAt(start + name.length + 2));

    ruleSymbols.push(
      DocumentSymbol.create(
        name,
        `${callSymbols.length} rule${callSymbols.length !== 1 ? "s" : ""}`,
        SymbolKind.Module,
        bodyRange,
        bodyRange,
        callSymbols,
      ),
    );
  }

  if (ruleSymbols.length === 0) return symbols;

  const rulesPos = document.positionAt(Math.max(0, rulesKeyOff));
  const lastRule = ruleSymbols[ruleSymbols.length - 1];
  const rulesRange = Range.create(rulesPos, lastRule.range.end);

  const transformOff = findKeyOffset(text, "transform");
  const transformPos = document.positionAt(Math.max(0, transformOff));
  const transformRange = Range.create(transformPos, lastRule.range.end);

  symbols.push(
    DocumentSymbol.create(
      "transform",
      undefined,
      SymbolKind.Namespace,
      transformRange,
      transformRange,
      [
        DocumentSymbol.create(
          "rules",
          undefined,
          SymbolKind.Namespace,
          rulesRange,
          rulesRange,
          ruleSymbols,
        ),
      ],
    ),
  );

  return symbols;
}
