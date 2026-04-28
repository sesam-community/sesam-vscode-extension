#!/usr/bin/env bash
# Sesam VS Code Extension — Installer & Updater
#
# First run  : downloads and installs the latest release.
# Subsequent : checks whether a newer release is available and updates.
#
# Requirements: code (VS Code CLI), gh (GitHub CLI — https://cli.github.com)

set -euo pipefail

REPO="datanav/sesam-ts"
EXT_ID="bouvet.dtl-language-support"

# ── 1. Re-open in a graphical terminal when double-clicked ───────────────────
if ! tty -s; then
  SCRIPT_PATH="$(realpath "$0")"
  for term in gnome-terminal xterm konsole xfce4-terminal mate-terminal tilix; do
    if command -v "$term" &>/dev/null; then
      exec "$term" -- bash "$SCRIPT_PATH"
    fi
  done
  if command -v zenity &>/dev/null; then
    zenity --error --text="No terminal emulator found.\nPlease run this script from a terminal."
  fi
  exit 1
fi

echo "┌─────────────────────────────────────────┐"
echo "│  Sesam VS Code Extension — Installer    │"
echo "└─────────────────────────────────────────┘"
echo ""

# ── 2. Check dependencies ────────────────────────────────────────────────────
missing=()
command -v code &>/dev/null || missing+=("code  — VS Code CLI (add VS Code to PATH)")
command -v gh   &>/dev/null || missing+=("gh    — GitHub CLI  (https://cli.github.com)")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: The following required tools were not found:"
  for m in "${missing[@]}"; do echo "  • $m"; done
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

# ── 3. Resolve versions ──────────────────────────────────────────────────────
INSTALLED=$(code --list-extensions --show-versions 2>/dev/null \
  | grep -i "^${EXT_ID}@" | cut -d@ -f2 || true)

LATEST_TAG=$(gh release view --repo "$REPO" --json tagName -q .tagName 2>/dev/null || true)

if [[ -z "$LATEST_TAG" ]]; then
  echo "ERROR: Could not reach GitHub. Make sure you are logged in:"
  echo "  gh auth login"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

LATEST="${LATEST_TAG#v}"   # strip leading 'v'

# ── 4. Compare ───────────────────────────────────────────────────────────────
if [[ -n "$INSTALLED" && "$INSTALLED" == "$LATEST" ]]; then
  echo "✓ Sesam extension v${INSTALLED} is already installed and up to date."
  echo ""
  read -r -p "Press Enter to close..."
  exit 0
fi

if [[ -n "$INSTALLED" ]]; then
  echo "Update available: v${INSTALLED}  →  v${LATEST}"
else
  echo "Installing Sesam extension v${LATEST}…"
fi

# ── 5. Download & install ────────────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

gh release download "$LATEST_TAG" \
  --repo "$REPO" \
  --pattern "*.vsix" \
  --dir "$TMP_DIR"

code --install-extension "$TMP_DIR"/*.vsix --force

echo ""
echo "✓ Sesam extension v${LATEST} installed successfully."
echo "  Restart VS Code to activate the new version."
echo ""
read -r -p "Press Enter to close..."
