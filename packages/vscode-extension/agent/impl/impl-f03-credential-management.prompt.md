# F03: Secure Credential Management

> **Status**: `implemented`
> **Rollout Phase**: Phase 1 - MVP
> **Tracking**: [README.md](README.md)

---

## Summary

Replace plain-text JWT tokens in `.syncconfig` and secrets in `.authconfig` with VS Code's encrypted
`SecretStorage` API. The user obtains a JWT manually (e.g. from the Sesam portal in a browser) and
pastes it into the extension via a prompted command. The extension stores it in SecretStorage — it
never writes tokens to disk. Support multiple named environment profiles (e.g. `dev`, `staging`, `prod`)
so developers can quickly switch node contexts without touching files on disk.

---

## Implementation Phases

### Phase A: SecretStorage Integration for JWT

The user is responsible for obtaining a JWT (e.g. from the Sesam portal in their browser) and providing
it to the extension. The extension's only job is to receive the token from the user and store it safely.

1. Create `client/src/credentialManager.ts`:
   - `storeToken(profile: string, token: string): Promise<void>` - `context.secrets.store(key, token)`
   - `getToken(profile: string): Promise<string | undefined>`
   - `deleteToken(profile: string): Promise<void>`
   - Key format: `sesam.jwt.<profile>` (e.g. `sesam.jwt.dev`)
2. Register commands:
   - `sesam.setToken` — prompts for profile name (default `"default"`), then shows an input box with
     `password: true` for the JWT. Validates that the input is non-empty. Stores via
     `credentialManager.storeToken`. Shows an information message on success: _"JWT stored for profile
     '<name>'"_.
   - `sesam.deleteToken` — shows a QuickPick of all stored profile names, prompts to confirm deletion,
     then calls `credentialManager.deleteToken`. Shows an information message on success.
3. When F01 commands run, resolve the JWT from SecretStorage first; fall back to `.syncconfig` only if not
   found in SecretStorage. This means `.syncconfig` can omit the `JWT=` line entirely for stored profiles.
4. Add setting `dtl.sesampy.activeProfile` (string, default `"default"`) — the profile whose stored JWT
   is used for all sesam commands.

### Phase B: Multi-Environment Profile Switcher

1. Extend the status bar widget (F01 Phase B) with a profile indicator: `$(key) [dev]`.
2. Clicking the profile badge opens a QuickPick with all stored profile names, plus an _"Add profile…"_ entry.
3. Selecting a profile updates `dtl.sesampy.activeProfile` in workspace settings.
4. Profile metadata (NODE URL only, no token) stored in VS Code workspace state
   (`context.workspaceState.update('sesam.profiles', {...})`).
5. `sesam.addProfile` command — prompts for profile name, NODE URL, then shows a `password: true` input
   box for the JWT. The user pastes a manually obtained token. Token goes to SecretStorage; NODE URL
   goes to workspace state.
6. `sesam.listProfiles` command — shows a list of configured profiles in the Output Channel.

### Phase C: .authconfig OAuth2 Profile Support

1. Detect presence of `.authconfig` and parse auth type.
2. For `oauth2` auth type: store `clientSecret` in SecretStorage (`sesam.oauth2.<profile>.clientSecret`).
3. Warn the user if `clientSecret` is found in the `.authconfig` file on disk (surface as a diagnostic
   in the file with a quick-fix "Move to secure storage").
4. At command execution time, merge the on-disk `.authconfig` (without secret) with the SecretStorage
   token to build the final effective config passed to the binary.

### Phase D: Security Audit

1. On workspace open, scan `.syncconfig` and `.authconfig` for secrets present in plain text.
2. If secrets found and git-tracked (from F02 Phase D), show a workspace-level warning notification
   once per session with options: "Review", "Don't show again".
3. "Review" opens both files side-by-side for user inspection.

### Phase E: (Deferred) Portal Login Flow

Automatic JWT acquisition via the Sesam portal API is **out of scope for the MVP**. The user is expected
to obtain their JWT manually from the Sesam portal (browser) and paste it into the extension via the
`sesam.setToken` / `sesam.addProfile` commands.

If a portal-assisted login flow is added in the future it should be implemented as an additive step on
top of Phase A — the manual-paste path must always remain available as a fallback.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | Command registrations (`sesam.setToken`, `sesam.deleteToken`, `sesam.addProfile`, `sesam.listProfiles`), `dtl.sesampy.activeProfile` setting |
| `client/src/extension.ts` | Pass `context` to credential manager on activation |
| `client/src/credentialManager.ts` (new) | SecretStorage wrapper — store/retrieve/delete JWT per profile |
| `client/src/profileManager.ts` (new) | Multi-profile switcher, workspace state management |
| `client/src/sesamCommands.ts` | Use `credentialManager` to resolve JWT before spawning binary |

---

## Dependencies

- **F01** - commands must be registered; credential manager wires into command execution
- **F02 Phase D** - security warnings overlap; coordinate to avoid duplicate diagnostics
- VS Code `SecretStorage` API (available since VS Code 1.53)
