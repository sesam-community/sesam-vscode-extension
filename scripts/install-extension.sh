#!/usr/bin/env bash
# Install the latest sesam VS Code extension from GitHub Releases.
# Usage: bash scripts/install-extension.sh
# Requires: gh (GitHub CLI), code (VS Code CLI)

set -euo pipefail

REPO="datanav/sesam-ts"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LATEST=$(gh release view --repo "$REPO" --json tagName -q .tagName)
echo "Installing sesam extension $LATEST …"

gh release download "$LATEST" \
  --repo "$REPO" \
  --pattern "*.vsix" \
  --dir "$TMP_DIR"

code --install-extension "$TMP_DIR"/*.vsix

echo "Done — sesam extension $LATEST installed."
