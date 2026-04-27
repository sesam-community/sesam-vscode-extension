/**
 * Minimal vscode module stub for Vitest unit tests.
 *
 * Only the symbols needed to allow client-side modules to be imported
 * without crashing are provided here. Tests that need richer behaviour
 * should override individual exports with vi.mock() factories.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const commands = {
  executeCommand: (): Promise<undefined> => Promise.resolve(undefined),
  registerCommand: (_id: string, _handler: (...args: any[]) => any) => ({ dispose: () => {} }),
};

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: () => {},
    append: () => {},
    show: () => {},
    dispose: () => {},
  }),
  showWarningMessage: (): Promise<undefined> => Promise.resolve(undefined),
  showInformationMessage: (): Promise<undefined> => Promise.resolve(undefined),
  showErrorMessage: (): Promise<undefined> => Promise.resolve(undefined),
};

export const workspace = {
  getConfiguration: () => ({ get: () => undefined }),
  findFiles: (): Promise<never[]> => Promise.resolve([]),
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  openTextDocument: (): Promise<never> => Promise.reject(new Error("not mocked")),
  applyEdit: (): Promise<boolean> => Promise.resolve(true),
};

export const tests = {
  createTestController: (_id: string, _label: string) => ({
    items: { replace: () => {}, add: () => {}, delete: () => {} },
    createRunProfile: () => ({ dispose: () => {} }),
    createTestRun: () => ({
      appendOutput: () => {},
      started: () => {},
      passed: () => {},
      failed: () => {},
      errored: () => {},
      end: () => {},
    }),
    createTestItem: (_id: string, _label: string, _uri?: any) => ({
      id: _id,
      label: _label,
      uri: _uri,
      canResolveChildren: false,
    }),
    dispose: () => {},
  }),
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
};

export const Range = class {
  constructor(
    public start: any,
    public end: any,
  ) {}
};

export const WorkspaceEdit = class {
  replace() {}
};

export const TestMessage = class {
  constructor(public message: string) {}
  static diff(_label: string, _expected: string, _actual: string) {
    return new TestMessage(_label);
  }
};

export const TestRunProfileKind = { Run: 1, Coverage: 2, Debug: 3 };
