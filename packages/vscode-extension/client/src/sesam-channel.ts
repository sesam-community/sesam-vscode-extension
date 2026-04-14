import * as vscode from "vscode";

import type { NodeRequestLogEntry } from "./node-client";

let _channel: vscode.OutputChannel | undefined;

export const getSesamChannel = (): vscode.OutputChannel => {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("Sesam");
  }

  return _channel;
};

export const disposeSesamChannel = (): void => {
  _channel?.dispose();
  _channel = undefined;
};

// ANSI escape helpers (rendered by VS Code output channels)
export const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightRed: "\x1b[91m",
  brightYellow: "\x1b[93m",
} as const;

const timestamp = (): string => {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
};

export const logNodeRequest = (entry: NodeRequestLogEntry): void => {
  const ch = getSesamChannel();
  const ts = timestamp();
  const duration = `${entry.durationMs} ms`;

  if (entry.error) {
    const code = entry.statusCode > 0 ? ` ${entry.statusCode}` : " (network)";

    ch.appendLine(`[${ts}] ${entry.method} ${entry.url}${code}  ${duration}  — ${entry.error}`);
    ch.show(/* preserveFocus */ true);
  } else {
    ch.appendLine(`[${ts}] ${entry.method} ${entry.url}  ${entry.statusCode}  ${duration}`);
  }
};
