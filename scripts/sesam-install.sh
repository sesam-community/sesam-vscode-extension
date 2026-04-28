#!/usr/bin/env bash
# Sesam VS Code Extension — Installer & Updater
#
# Usage:
#   1. Download sesam-vX.Y.Z.vsix and this script from the GitHub Releases page
#      into the same folder.
#   2. Run:  bash sesam-install.sh
#
# On re-run: if the installed version matches the .vsix in this folder,
# reports "already up to date". If a newer .vsix is present, updates.
#
# Requirements: code (VS Code CLI in PATH)

set -euo pipefail

EXT_ID="bouvet.dtl-language-support"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# ── 2. Require code CLI ───────────────────────────────────────────────────────
if ! command -v code &>/dev/null; then
  echo "ERROR: 'code' command not found."
  echo "  Add VS Code to your PATH: https://code.visualstudio.com/docs/setup/linux"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

# ── 3. Find .vsix next to this script ────────────────────────────────────────
VSIX_FILE=$(ls "$SCRIPT_DIR"/sesam-*.vsix 2>/dev/null | sort -V | tail -1 || true)

if [[ -z "$VSIX_FILE" ]]; then
  echo "ERROR: No sesam-*.vsix file found in the same folder as this script."
  echo ""
  echo "  Download both sesam-vX.Y.Z.vsix and sesam-install.sh from:"
  echo "  https://github.com/datanav/sesam-ts/releases/latest"
  echo "  Place them in the same folder, then run this script again."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

VSIX_VERSION=$(basename "$VSIX_FILE" | grep -oP '\d+\.\d+\.\d+' || true)

# ── 4. Check installed version ───────────────────────────────────────────────
INSTALLED=$(code --list-extensions --show-versions 2>/dev/null \
  | grep -i "^${EXT_ID}@" | cut -d@ -f2 || true)

if [[ -n "$INSTALLED" && "$INSTALLED" == "$VSIX_VERSION" ]]; then
  echo "✓ Sesam extension v${INSTALLED} is already installed and up to date."
  echo ""
  echo "  To update: download a newer sesam-*.vsix from GitHub Releases,"
  echo "  replace the .vsix in this folder, and run this script again."
  echo ""
  read -r -p "Press Enter to close..."
  exit 0
fi

if [[ -n "$INSTALLED" ]]; then
  echo "Updating Sesam extension: v${INSTALLED}  →  v${VSIX_VERSION}…"
else
  echo "Installing Sesam extension v${VSIX_VERSION}…"
fi

# ── 5. Install ────────────────────────────────────────────────────────────────
code --install-extension "$VSIX_FILE" --force

echo ""
echo "✓ Sesam extension v${VSIX_VERSION} installed successfully."
echo "  Restart VS Code to activate the new version."
echo ""
read -r -p "Press Enter to close..."
