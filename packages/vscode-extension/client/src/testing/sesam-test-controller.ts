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

import { testPipes, ValidationFailedError } from "@sesam/core";

import { resolveCredentials } from "../credential-resolver";
import { getSesamChannel, logNodeRequest } from "../sesam-channel";

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

      const run = ctrl.createTestRun(request, undefined, /* persist */ false);
      setRunning(true);

      const ch = getSesamChannel();
      const ansi = {
        reset: "\x1b[0m",
        bold: "\x1b[1m",
        dim: "\x1b[2m",
        green: "\x1b[32m",
        red: "\x1b[31m",
        yellow: "\x1b[33m",
        cyan: "\x1b[36m",
        gray: "\x1b[90m",
      };
      const appendOutput = (line: string): void => {
        run.appendOutput(line + "\r\n");
      };

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

        appendOutput(
          `${ansi.bold}${ansi.cyan}── Sesam pipe tests started (${new Date().toLocaleTimeString()}) ──${ansi.reset}`,
        );
        ch.appendLine(
          `\n[TEST] ──────────────── Sesam pipe tests started (${new Date().toLocaleTimeString()}) ────────────────`,
        );

        const failedResults: TestResult[] = [];

        await testPipes(
          { nodeUrl: creds.nodeUrl, jwtToken: creds.jwt, logger: logNodeRequest },
          workspaceRoot,
          {
            whitelist,
            skipValidate: false,
            onPhase: (phase: string) => {
              const ts = new Date().toLocaleTimeString();
              appendOutput(`${ansi.gray}[${ts}]${ansi.reset} ${ansi.cyan}${phase}${ansi.reset}`);
              ch.appendLine(`[${ts}] [TEST] ${phase}`);
            },
            onResult: (result: TestResult) => {
              if (token.isCancellationRequested) {
                return;
              }

              const item = scopedItems.get(result.spec.pipe);

              if (!item) {
                return;
              }

              if (result.passed) {
                appendOutput(`${ansi.green}✔ ${result.spec.pipe}${ansi.reset}`);
                run.passed(item);
              } else if (result.error) {
                appendOutput(`${ansi.red}✘ ${result.spec.pipe}${ansi.reset}`);
                run.errored(item, new vscode.TestMessage(result.error));
                failedResults.push(result);
              } else {
                appendOutput(`${ansi.red}✘ ${result.spec.pipe}${ansi.reset}`);
                const msg = result.diff
                  ? vscode.TestMessage.diff(
                      `${result.spec.pipe}: output does not match`,
                      extractExpected(result.diff),
                      extractActual(result.diff),
                    )
                  : new vscode.TestMessage(`${result.spec.pipe}: output does not match`);
                run.failed(item, msg);
                failedResults.push(result);
              }
            },
          },
        );

        // ── Failed summary (Vitest-style) ────────────────────────────────
        if (failedResults.length > 0) {
          const bar = "⎯".repeat(32);
          appendOutput("");
          appendOutput(
            `${ansi.red}${ansi.bold}${bar} Failed Tests ${failedResults.length} ${bar}${ansi.reset}`,
          );
          for (const result of failedResults) {
            appendOutput("");
            appendOutput(`${ansi.red}${ansi.bold} FAIL ${result.spec.pipe}.test.json${ansi.reset}`);
            appendOutput("");
            if (result.error) {
              appendOutput(`${ansi.red}${result.error}${ansi.reset}`);
            } else if (result.diff) {
              appendOutput(`${ansi.red}${ansi.bold}- Expected${ansi.reset}`);
              appendOutput(`${ansi.green}${ansi.bold}+ Received${ansi.reset}`);
              appendOutput("");
              result.diff.split("\n").forEach((line) => {
                if (line.startsWith("---") || line.startsWith("+++")) {
                  appendOutput(`${ansi.dim}${line}${ansi.reset}`);
                } else if (line.startsWith("-")) {
                  appendOutput(`${ansi.red}${line}${ansi.reset}`);
                } else if (line.startsWith("+")) {
                  appendOutput(`${ansi.green}${line}${ansi.reset}`);
                } else if (line.startsWith("@@")) {
                  appendOutput(`${ansi.cyan}${ansi.dim}${line}${ansi.reset}`);
                } else {
                  appendOutput(line);
                }
              });
            }
          }
          appendOutput("");
        }
      } catch (err) {
        const items = request.include ?? [...ctrl.items].map(([, item]) => item);

        let summary: string;

        // Use duck-typing instead of instanceof — survives ESM→CJS bundle boundary
        const isValidationError =
          err instanceof Error &&
          "errors" in err &&
          Array.isArray((err as ValidationFailedError).errors);

        if (isValidationError) {
          const verr = err as ValidationFailedError;
          const details = verr.errors
            .map((e) => `  • ${path.basename(e.file)}: ${e.message}`)
            .join("\n");
          summary =
            `Local validation failed — test was not run.\n\n` +
            `${verr.errors.length} error(s) found:\n${details}\n\n` +
            `Fix the config files listed above, then re-run the test.`;
          const coloredDetails = verr.errors
            .map(
              (e) =>
                `  ${ansi.yellow}•${ansi.reset} ${ansi.bold}${path.basename(e.file)}${ansi.reset}: ${e.message}`,
            )
            .join("\r\n");
          appendOutput(
            `\r\n${ansi.red}${ansi.bold}Local validation failed — test was not run.${ansi.reset}`,
          );
          appendOutput(`${ansi.red}${verr.errors.length} error(s) found:${ansi.reset}`);
          appendOutput(coloredDetails);
          appendOutput(
            `\r\n${ansi.dim}Fix the config files listed above, then re-run the test.${ansi.reset}`,
          );
        } else {
          summary = `Test run failed: ${err instanceof Error ? err.message : String(err)}`;
          appendOutput(`${ansi.red}${ansi.bold}${summary}${ansi.reset}`);
        }

        const msg = new vscode.TestMessage(summary);

        for (const item of items) {
          run.errored(item, msg);
        }
      } finally {
        const endTs = new Date().toLocaleTimeString();
        appendOutput(
          `\r\n${ansi.bold}${ansi.cyan}── Sesam pipe tests ended   (${endTs}) ──${ansi.reset}`,
        );
        getSesamChannel().appendLine(
          `[TEST] ──────────────── Sesam pipe tests ended   (${endTs}) ────────────────\n`,
        );
        run.end();
        setRunning(false);
        void vscode.commands.executeCommand("workbench.view.testing.focus");
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
