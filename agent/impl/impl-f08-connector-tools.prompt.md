# F08: Connector Development Tools

> **Status**: `planned`
> **Rollout Phase**: Phase 4 - AI & Visual Polish
> **Tracking**: [impl-plan.prompt.md](impl-plan.prompt.md)

---

## Summary

Provide in-editor tooling for developing sesam connectors: a wizard to scaffold new connectors via
`sesam connector_init`, a Jinja template expansion preview, and an in-editor OAuth2 token tester.
Reduces context-switching to the terminal for connector iteration.

---

## sesam-py Connector Commands Reference

| Command | Description |
|---|---|
| `sesam connector_init <type>` | Scaffold connector directory from template |
| `sesam expand` | Expand Jinja templates in current directory |
| `connector_cli` package | Python package used inside connector containers |

---

## Implementation Phases

### Phase A: Connector Init Wizard

1. Register command `sesam.connectorInit`.
2. Show a multi-step QuickPick flow:
   - Step 1: Select connector type from a predefined list (REST, SQL, file, custom).
   - Step 2: Enter connector name.
   - Step 3: Select output directory.
3. Invoke `sesam connector_init <type> --name <name> --dir <dir>` via F01/F00 binary mechanism.
4. After completion, prompt "Open new connector folder?" and call `vscode.commands.executeCommand
   ('vscode.openFolder', newDir)`.

### Phase B: Jinja Template Expansion Preview

1. Register a `TextDocumentContentProvider` for the custom scheme `sesam-jinja-preview:`.
2. Register command `sesam.previewJinjaExpansion` (`when`: file has `.j2` extension or is in a
   connector template directory).
3. On invocation:
   - Read variable values from `.jinja_vars` in the workspace root.
   - Call `sesam expand --preview` (or implement a lightweight Jinja renderer in TS using `nunjucks`).
   - Display expanded output in a side-by-side virtual document.
4. Auto-refresh the preview on save of the source template or `.jinja_vars`.

### Phase C: OAuth2 Token Tester

1. Register command `sesam.testOAuthToken` (available when `.authconfig` has `type: oauth2`).
2. Read `tokenUrl`, `clientId` from `.authconfig`; read `clientSecret` from SecretStorage (F03).
3. Perform a `client_credentials` grant using `node-fetch`.
4. Display the received token (masked), expiry, and scopes in an Output Channel.
5. Offer a "Copy token to clipboard" action.
6. Additionally, offer `sesam.testApiKey` and `sesam.testTripletex` for the other auth types.

### Phase D: Connector Container Dev Loop

1. Add a VS Code task template `Sesam: Build connector image` that runs `docker build` in the
   connector directory.
2. Add a VS Code task template `Sesam: Run connector locally` that runs `docker run` with env vars
   injected from `.authconfig` + SecretStorage.
3. Both tasks defined as problem matchers that capture docker output and highlight errors in the
   Terminal panel.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | Command registrations, activation events |
| `client/src/connectorWizard.ts` (new) | Multi-step QuickPick for `connector_init` |
| `client/src/jinjaPreview.ts` (new) | Jinja expansion preview provider |
| `client/src/oauthTester.ts` (new) | OAuth2 / API key test implementations |
| `client/src/sesamTaskProvider.ts` | Add connector Docker task templates (extends F01 Phase C) |

---

## Dependencies

- **F00/F01** - binary execution for `sesam connector_init` and `sesam expand`
- **F03** - SecretStorage for OAuth2 `clientSecret` in Phase C
- **F02** - `.jinja_vars` language support feeds into Phase B variable resolution
