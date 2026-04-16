/**
 * Test Result Webview (F05 Phase 4)
 *
 * Opens a WebviewPanel showing the unified diff for a failing test.
 * - Lines starting with `-` → red (Expected)
 * - Lines starting with `+` → green (Received)
 * - `@@` hunk headers → muted/italic
 */

import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Panel registry
// ---------------------------------------------------------------------------

const _panels = new Map<string, vscode.WebviewPanel>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const showTestFailure = (
  context: vscode.ExtensionContext,
  pipeId: string,
  diff: string,
): void => {
  const existing = _panels.get(pipeId);

  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    existing.webview.postMessage({ type: "update", diff });
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "sesam.testResult",
    `Test Result: ${pipeId}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  _panels.set(pipeId, panel);

  panel.onDidDispose(() => {
    _panels.delete(pipeId);
  });

  panel.webview.html = buildHtml(panel.webview, pipeId, diff);
};

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const buildHtml = (webview: vscode.Webview, pipeId: string, diff: string): string => {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const diffRows = diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("---") || line.startsWith("+++")) {
        return `<div class="diff-header">${esc(line)}</div>`;
      }

      if (line.startsWith("@@")) {
        return `<div class="diff-hunk">${esc(line)}</div>`;
      }

      if (line.startsWith("-")) {
        return `<div class="diff-removed"><span class="diff-sign">−</span>${esc(line.slice(1))}</div>`;
      }

      if (line.startsWith("+")) {
        return `<div class="diff-added"><span class="diff-sign">+</span>${esc(line.slice(1))}</div>`;
      }

      return `<div class="diff-context">${esc(line)}</div>`;
    })
    .join("");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Test Result: ${esc(pipeId)}</title>
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      margin: 0;
      padding: 8px 0;
    }

    h2 {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      font-weight: 600;
      padding: 8px 16px;
      margin: 0 0 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .diff-wrap {
      overflow-x: auto;
      padding: 0 8px;
    }

    .diff-header, .diff-hunk, .diff-removed, .diff-added, .diff-context {
      white-space: pre;
      line-height: 1.5;
      padding: 0 8px;
      border-radius: 2px;
    }

    .diff-header { opacity: 0.5; font-size: 0.9em; }
    .diff-hunk   { color: var(--vscode-editorCodeLens-foreground, #999); font-style: italic; margin: 4px 0; }

    .diff-removed {
      background: rgba(255, 80, 80, 0.15);
      color: var(--vscode-diffEditor-removedTextForeground, #f97171);
    }

    .diff-added {
      background: rgba(80, 200, 100, 0.15);
      color: var(--vscode-diffEditor-insertedTextForeground, #71f98e);
    }

    .diff-context { opacity: 0.75; }

    .diff-sign {
      display: inline-block;
      width: 16px;
      font-weight: bold;
      user-select: none;
    }

    .legend {
      display: flex;
      gap: 16px;
      font-family: var(--vscode-font-family);
      font-size: 11px;
      padding: 0 16px 10px;
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <h2>Test Result: ${esc(pipeId)}</h2>
  <div class="legend">
    <span style="color:#f97171">− Expected</span>
    <span style="color:#71f98e">+ Received</span>
  </div>
  <div class="diff-wrap" id="diff-wrap">
    ${diffRows}
  </div>
  <script nonce="${nonce}">
    window.addEventListener('message', (event) => {
      if (event.data.type === 'update') {
        // Re-render diff content from updated data
        document.getElementById('diff-wrap').innerHTML = event.data.diffRows ?? '';
      }
    });
  </script>
</body>
</html>`;
};
