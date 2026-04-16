/**
 * Sesam Test Controller (F05)
 *
 * Integrates the sesam-py test flow with the VS Code Testing API.
 *   - One TestItem per `expected/*.test.json` spec file
 *   - File watcher keeps the test tree in sync with the filesystem
 *   - Run handler maps TestResult → passed / failed TestMessages
 *   - Exports isSesamTestRunning() for command guards in extension.ts
 */

import * as path from "node:path";

import * as vscode from "vscode";

import { testPipes } from "@sesam/core";

import { resolveCredentials } from "../credential-resolver";
import { logNodeRequest } from "../sesam-channel";
import { showTestFailure } from "./test-result-webview";

import type { TestResult } from "@sesam/core";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _isRunning = false;

export const isSesamTestRunning = (): boolean => _isRunning;

const setRunning = (value: boolean): void => {
  _isRunning = value;
  void vscode.commands.executeCommand("setContext", "sesam.testRunning", value);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a pipe ID from a `.test.json` file path (the filename stem).
 */
const pipeIdFromUri = (uri: vscode.Uri): string => path.basename(uri.fsPath, ".test.json");

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export const registerSesamTestController = (context: vscode.ExtensionContext): void => {
  const ctrl = vscode.tests.createTestController("sesam-pipes", "Sesam Pipes");
  context.subscriptions.push(ctrl);

  // ── Discovery ────────────────────────────────────────────────────────────

  const makeItem = (uri: vscode.Uri): vscode.TestItem => {
    const id = pipeIdFromUri(uri);
    const item = ctrl.createTestItem(id, id, uri);
    item.canResolveChildren = false;
    return item;
  };

  const refreshAll = async (): Promise<void> => {
    ctrl.items.replace([]);
    const uris = await vscode.workspace.findFiles("**/expected/*.test.json");
    uris.forEach((uri) => ctrl.items.add(makeItem(uri)));
  };

  void refreshAll();

  // File watcher for live add/remove
  const watcher = vscode.workspace.createFileSystemWatcher("**/expected/*.test.json");

  watcher.onDidCreate((uri) => ctrl.items.add(makeItem(uri)));
  watcher.onDidDelete((uri) => ctrl.items.delete(pipeIdFromUri(uri)));
  watcher.onDidChange((uri) => {
    // Refresh the item (recreate to pick up any label change)
    ctrl.items.delete(pipeIdFromUri(uri));
    ctrl.items.add(makeItem(uri));
  });

  context.subscriptions.push(watcher);

  // ── Run handler ──────────────────────────────────────────────────────────

  ctrl.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      if (_isRunning) {
        vscode.window.showWarningMessage("Sesam tests are already running. Please wait.");
        return;
      }

      const run = ctrl.createTestRun(request);
      setRunning(true);

      try {
        const creds = await resolveCredentials();

        if (!creds) {
          const items = request.include ?? [...ctrl.items].map(([, item]) => item);

          for (const item of items) {
            run.errored(
              item,
              new vscode.TestMessage(
                "No Sesam credentials configured. Run 'Sesam: Set JWT Token'.",
              ),
            );
          }

          return;
        }

        // Determine workspace root (look beside the first spec file)
        const firstItem = (request.include ?? [...ctrl.items].map(([, item]) => item))[0];

        if (!firstItem?.uri) {
          return;
        }

        // expected/ lives at <suite>/expected/<spec>.test.json → suite = ../../
        const workspaceRoot = path.resolve(firstItem.uri.fsPath, "..", "..");

        // Whitelist from request.include
        const whitelist = request.include?.map((item) => item.id);

        // Mark all items in scope as "running"
        const scopedItems = new Map<string, vscode.TestItem>();

        (request.include ?? [...ctrl.items].map(([, item]) => item)).forEach((item) => {
          run.started(item);
          scopedItems.set(item.id, item);
        });

        if (token.isCancellationRequested) {
          return;
        }

        await testPipes(
          { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
          workspaceRoot,
          {
            whitelist,
            skipValidate: false,
            onResult: (result: TestResult) => {
              if (token.isCancellationRequested) {
                return;
              }

              const item = scopedItems.get(result.spec.pipe);

              if (!item) {
                return;
              }

              if (result.passed) {
                run.passed(item);
              } else if (result.error) {
                run.errored(item, new vscode.TestMessage(result.error));
              } else {
                const msg = result.diff
                  ? vscode.TestMessage.diff(
                      `${result.spec.pipe}: output does not match`,
                      // expected first, actual second (VS Code convention)
                      extractExpected(result.diff),
                      extractActual(result.diff),
                    )
                  : new vscode.TestMessage(`${result.spec.pipe}: output does not match`);
                run.failed(item, msg);
                if (result.diff) {
                  showTestFailure(context, result.spec.pipe, result.diff);
                }
              }
            },
          },
        );
      } catch (err) {
        // Top-level failure (upload/run error) — fail all scoped items
        const items = request.include ?? [...ctrl.items].map(([, item]) => item);
        const msg = new vscode.TestMessage(
          `Test run failed: ${err instanceof Error ? err.message : String(err)}`,
        );

        for (const item of items) {
          run.errored(item, msg);
        }
      } finally {
        run.end();
        setRunning(false);
      }
    },
    true, // isDefault
  );
};

// ---------------------------------------------------------------------------
// Diff helper — extract expected / actual JSON strings from unified diff
// ---------------------------------------------------------------------------

const extractExpected = (diff: string): string => {
  const lines = diff.split("\n");
  return lines
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1))
    .join("\n");
};

const extractActual = (diff: string): string => {
  const lines = diff.split("\n");
  return lines
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
};
