/**
 * Centralized Network Status Toaster (F23)
 *
 * Shows a single VS Code progress notification (bottom-right toaster) that
 * reflects live HTTP activity for all extension requests — portal API, node
 * API, and pipe operations.
 *
 * While any request is in flight the notification stays open with a spinner.
 * When the last request completes it briefly shows the result, then
 * auto-dismisses (2 s on success, 3 s on failure).
 *
 * Multiple concurrent requests share one notification — the message updates
 * to the most recently started request and shows a "+N" count when there are
 * several in flight.
 *
 * Usage:
 *   // Once, during activate():
 *   createNetworkStatusBar(context);   // sets up context; no-op for the bar
 *
 *   // Around every tracked request:
 *   const done = trackRequest("POST", "run-pipe/my-pipe");
 *   try { ... done(true, 200); }
 *   catch { done(false); }
 */

import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _inflightCount = 0;
let _lastMethod = "";
let _lastLabel = "";
let _progress: vscode.Progress<{ message?: string }> | undefined;
let _resolveNotification: (() => void) | undefined;
let _revertTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const inflightMessage = (): string => {
  const suffix = _inflightCount > 1 ? ` (+${_inflightCount - 1})` : "";

  return `${_lastMethod} ${_lastLabel}${suffix}`;
};

const spawnNotification = (initialMessage: string): void => {
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Sesam", cancellable: false },
    (progress) => {
      _progress = progress;
      progress.report({ message: initialMessage });

      return new Promise<void>((resolve) => {
        _resolveNotification = resolve;
      });
    },
  );
};

const scheduleRevert = (delayMs: number): void => {
  if (_revertTimer !== undefined) {
    clearTimeout(_revertTimer);
  }

  _revertTimer = setTimeout(() => {
    _revertTimer = undefined;
    _progress = undefined;
    _resolveNotification?.();
    _resolveNotification = undefined;
  }, delayMs);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * No-op initializer kept for API consistency with callers.
 * Call **once** from `activate()`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createNetworkStatusBar = (_context: vscode.ExtensionContext): void => {
  // Nothing to create — we use withProgress notifications instead of a status
  // bar item, so no disposable needs to be registered.
};

/**
 * Track an outgoing HTTP request.
 *
 * @param method  HTTP method, e.g. `"GET"`, `"POST"`
 * @param label   Short human-readable description, e.g. `"run-pipe/my-pipe"`
 * @returns A `done(success, statusCode?)` callback — call it when the request completes.
 *
 * @example
 * const done = trackRequest("POST", `run-pipe/${pipeId}`);
 * try {
 *   const result = await runner.runPipe(creds, pipeId);
 *   done(result.success);
 * } catch {
 *   done(false);
 * }
 */
export const trackRequest = (
  method: string,
  label: string,
): ((success: boolean, statusCode?: number) => void) => {
  _inflightCount += 1;
  _lastMethod = method.toUpperCase();
  _lastLabel = label;

  // Cancel any pending auto-dismiss — a new request started while we were
  // showing the result of the previous one.
  if (_revertTimer !== undefined) {
    clearTimeout(_revertTimer);
    _revertTimer = undefined;
  }

  if (_resolveNotification) {
    // A notification is already open — just update its message.
    _progress?.report({ message: inflightMessage() });
  } else {
    spawnNotification(inflightMessage());
  }

  return (success: boolean, statusCode?: number): void => {
    _inflightCount = Math.max(0, _inflightCount - 1);

    if (_inflightCount > 0) {
      // Other requests still in flight — keep the spinner, update label.
      _progress?.report({ message: inflightMessage() });

      return;
    }

    // All done — show result briefly then auto-dismiss.
    const resultMessage = success ? `✓ ${statusCode ?? "OK"}` : `✗ ${statusCode ?? "Failed"}`;

    _progress?.report({ message: resultMessage });
    scheduleRevert(success ? 2_000 : 3_000);
  };
};
