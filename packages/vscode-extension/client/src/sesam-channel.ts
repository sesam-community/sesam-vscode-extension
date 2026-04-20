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
  const status = entry.statusCode > 0 ? String(entry.statusCode) : "(network)";

  if (entry.error) {
    ch.appendLine(
      `[${ts}] [NODE] ${entry.method} ${entry.url}  ${status}  ${entry.durationMs} ms  — ${entry.error}`,
    );
  } else {
    ch.appendLine(`[${ts}] [NODE] ${entry.method} ${entry.url}  ${status}  ${entry.durationMs} ms`);
  }
};

/**
 * Log a portal HTTP request line to the Sesam output channel.
 * Used by portal-client.ts to avoid duplicating timestamp + formatting logic.
 */
export const logPortalRequest = (
  method: string,
  url: string,
  status: number,
  durationMs: number,
  extra?: string,
): void => {
  const ch = getSesamChannel();
  const ts = timestamp();
  const statusStr = status > 0 ? String(status) : "(network)";
  const extraStr = extra ? `  — ${extra}` : "";

  ch.appendLine(`[${ts}] [PORTAL] ${method} ${url}  ${statusStr}  ${durationMs} ms${extraStr}`);
};
