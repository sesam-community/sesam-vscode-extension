---
name: create-pr-description
description: Generate a pull request description from the current git diff and the relevant impl spec. Use when the user wants to open a PR, write a PR description, or summarise changes for review.
---

# Create PR Description

Generate a structured, reviewable PR description grounded in the actual diff and the feature spec.

## Step 1 — Gather context

Run these commands to collect the raw material:

```bash
git diff main...HEAD --stat          # files changed
git diff main...HEAD                 # full diff (or a representative subset)
git log main...HEAD --oneline        # commit list
```

Also read:
- The relevant `agent/impl/impl-f*.prompt.md` spec (if this is a feature branch).
- `agent/impl/README.md` to note the feature's phase and status.

## Step 2 — Write the description

Use this structure:

```md
## Summary
<!-- One paragraph: what this PR does and why. Name the feature (F-number if applicable). -->

## Changes

### New files
- `path/to/file.ts` — one-line purpose

### Modified files
- `path/to/file.ts` — what changed and why

## How to test
<!-- Steps to verify the feature works manually (F5 → Extension Development Host). -->
1. Open a `.conf.pipe` file.
2. ...

## Test coverage
<!-- What new Vitest tests were added and what they cover. -->
- `tests/foo.test.ts` — covers `myFunction` (N cases)

## Notes / follow-up
<!-- Deferred decisions, known limitations, or follow-up tickets. -->
```

## Rules

- **Be specific.** Reference actual file names and function names from the diff.
- **Skip boilerplate.** Omit sections that are empty or not applicable.
- **Link the spec.** If there is an `impl-f*.prompt.md`, mention it by name.
- **Honest about scope.** If only some phases of a spec are implemented, say which ones.
- **No filler.** Avoid sentences like "This PR improves the codebase." State what changed.
