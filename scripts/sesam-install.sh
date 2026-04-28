#!/usr/bin/env bash
# Sesam VS Code Extension — Installer & Updater
#
# Usage: bash sesam-install.sh
#
# First run: prompts for a GitHub Personal Access Token (saved for future runs),
#            downloads the latest .vsix, and installs the extension.
# Re-run:    checks whether a newer release is available and updates.
#
# Requirements: curl, code (VS Code CLI in PATH)

set -euo pipefail

REPO="datanav/sesam-ts"
EXT_ID="bouvet.dtl-language-support"
TOKEN_FILE="$HOME/.config/sesam/github-token"

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

# ── 2. Check required tools ───────────────────────────────────────────────────
for tool in curl code; do
  if ! command -v "$tool" &>/dev/null; then
    echo "ERROR: '$tool' not found in PATH."
    [[ "$tool" == "code" ]] && echo "  https://code.visualstudio.com/docs/setup/linux"
    echo ""
    read -r -p "Press Enter to close..."
    exit 1
  fi
done

# ── 3. Load or prompt for GitHub token ───────────────────────────────────────
GH_TOKEN=""
if [[ -f "$TOKEN_FILE" ]]; then
  GH_TOKEN="$(cat "$TOKEN_FILE")"
fi

if [[ -z "$GH_TOKEN" ]]; then
  echo "A GitHub Personal Access Token is needed to download from the private repo."
  echo ""
  echo "  Create one at: https://github.com/settings/tokens"
  echo "  Required scope: repo  (or just: Contents: read)"
  echo ""
  read -r -s -p "Paste your token and press Enter: " GH_TOKEN
  echo ""

  if [[ -z "$GH_TOKEN" ]]; then
    echo "No token provided. Aborting."
    echo ""
    read -r -p "Press Enter to close..."
    exit 1
  fi

  # Validate token against the API
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/$REPO/releases/latest"\)

  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo ""
    echo "ERROR: Token validation failed (HTTP $HTTP_STATUS)."
    echo "  Check that the token is correct and has 'repo' scope."
    echo ""
    read -r -p "Press Enter to close..."
    exit 1
  fi

  mkdir -p "$(dirname "$TOKEN_FILE")"
  chmod 700 "$(dirname "$TOKEN_FILE")"
  echo "$GH_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "Token saved to $TOKEN_FILE"
  echo ""
fi

# ── 4. Fetch latest release info ─────────────────────────────────────────────
RELEASE_JSON=$(curl -sf \
  -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$REPO/releases/latest" || true)

if [[ -z "$RELEASE_JSON" ]]; then
  echo "ERROR: Could not fetch release info. Check your token or network connection."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

LATEST_TAG=$(echo "$RELEASE_JSON" | grep -oP '"tag_name":\s*"\K[^"]+')
LATEST="${LATEST_TAG#v}"
VSIX_URL=$(echo "$RELEASE_JSON" | grep -oP '"browser_download_url":\s*"\K[^"]+\.vsix')

if [[ -z "$LATEST_TAG" || -z "$VSIX_URL" ]]; then
  echo "ERROR: Could not find a .vsix asset in the latest release."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

# ── 5. Compare with installed version ────────────────────────────────────────
INSTALLED=$(code --list-extensions --show-versions 2>/dev/null \
  | grep -i "^${EXT_ID}@" | cut -d@ -f2 || true)

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

# ── 6. Download & install ─────────────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

VSIX_PATH="$TMP_DIR/sesam-${LATEST_TAG}.vsix"

echo "Downloading sesam-${LATEST_TAG}.vsix…"
curl -sL \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/octet-stream" \
  "$VSIX_URL" \
  -o "$VSIX_PATH"

code --install-extension "$VSIX_PATH" --force

echo ""
echo "✓ Sesam extension v${LATEST} installed successfully."
echo "  Restart VS Code to activate the new version."
echo ""
read -r -p "Press Enter to close..."
