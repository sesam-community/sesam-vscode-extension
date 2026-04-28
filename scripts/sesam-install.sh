#!/usr/bin/env bash
# Sesam VS Code Extension — Installer & Updater
#
# Usage: bash sesam-install.sh [--uninstall]
#
# Requirements: curl, code (VS Code CLI in PATH)

set -euo pipefail

REPO="datanav/sesam-ts"
EXT_ID="bouvet.dtl-language-support"
TOKEN_FILE="$HOME/.config/sesam/github-token"

# ── Colours ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD="\033[1m"; DIM="\033[2m"; RESET="\033[0m"
  GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; CYAN="\033[36m"
else
  BOLD=""; DIM=""; RESET=""; GREEN=""; YELLOW=""; RED=""; CYAN=""
fi

info()    { echo -e "${CYAN}${BOLD}$*${RESET}"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✗ ERROR:${RESET} $*"; }
dim()     { echo -e "${DIM}$*${RESET}"; }

# ── 1. Re-open in a graphical terminal when double-clicked ───────────────────
if ! tty -s; then
  SCRIPT_PATH="$(realpath "$0")"
  for term in gnome-terminal xterm konsole xfce4-terminal mate-terminal tilix; do
    if command -v "$term" &>/dev/null; then
      exec "$term" -- bash "$SCRIPT_PATH" "$@"
    fi
  done
  if command -v zenity &>/dev/null; then
    zenity --error --text="No terminal emulator found.\nPlease run this script from a terminal."
  fi
  exit 1
fi

echo ""
echo -e "${BOLD}${CYAN}┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}${CYAN}│  Sesam VS Code Extension — Installer    │${RESET}"
echo -e "${BOLD}${CYAN}└─────────────────────────────────────────┘${RESET}"
echo ""

# ── 2. Check required tools ───────────────────────────────────────────────────
for tool in curl code; do
  if ! command -v "$tool" &>/dev/null; then
    error "'$tool' not found in PATH."
    [[ "$tool" == "code" ]] && dim "  https://code.visualstudio.com/docs/setup/linux"
    echo ""
    read -r -p "Press Enter to close..."
    exit 1
  fi
done

# ── 3. Uninstall mode ─────────────────────────────────────────────────────────
UNINSTALL=false
[[ "${1:-}" == "--uninstall" ]] && UNINSTALL=true

INSTALLED=$(code --list-extensions --show-versions 2>/dev/null \
  | grep -i "^${EXT_ID}@" | cut -d@ -f2 || true)

if [[ "$UNINSTALL" == "true" ]]; then
  if [[ -z "$INSTALLED" ]]; then
    warn "Sesam extension is not currently installed."
  else
    info "Uninstalling Sesam extension v${INSTALLED}…"
    code --uninstall-extension "$EXT_ID"
    echo ""
    success "Sesam extension v${INSTALLED} uninstalled."
    dim "  Restart VS Code to complete the removal."
  fi
  echo ""
  read -r -p "Press Enter to close..."
  exit 0
fi

# ── 4. Load or prompt for GitHub token ───────────────────────────────────────
GH_TOKEN=""
if [[ -f "$TOKEN_FILE" ]]; then
  GH_TOKEN="$(cat "$TOKEN_FILE")"
fi

if [[ -z "$GH_TOKEN" ]]; then
  echo -e "A ${BOLD}GitHub Personal Access Token${RESET} is needed to download from the private repo."
  echo ""
  dim "  Create one at: https://github.com/settings/tokens"
  dim "  Required scope: Contents: read  (or: repo)"
  echo ""
  read -r -s -p "Paste your token and press Enter: " GH_TOKEN
  echo ""

  if [[ -z "$GH_TOKEN" ]]; then
    error "No token provided. Aborting."
    echo ""
    read -r -p "Press Enter to close..."
    exit 1
  fi

  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/$REPO/releases/latest")

  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo ""
    error "Token validation failed (HTTP $HTTP_STATUS)."
    dim "  Check that the token is correct and has 'Contents: read' scope."
    echo ""
    read -r -p "Press Enter to close..."
    exit 1
  fi

  mkdir -p "$(dirname "$TOKEN_FILE")"
  chmod 700 "$(dirname "$TOKEN_FILE")"
  echo "$GH_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  success "Token saved to ${TOKEN_FILE}"
  echo ""
fi

# ── 5. Fetch latest release info ─────────────────────────────────────────────
info "Checking latest release…"
RELEASE_JSON=$(curl -sf \
  -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$REPO/releases/latest" || true)

if [[ -z "$RELEASE_JSON" ]]; then
  error "Could not fetch release info. Check your token or network connection."
  dim "  To reset your token: rm $TOKEN_FILE"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

LATEST_TAG=$(echo "$RELEASE_JSON" | grep -oP '"tag_name":\s*"\K[^"]+')
LATEST="${LATEST_TAG#v}"
VSIX_URL=$(echo "$RELEASE_JSON" | grep -oP '"browser_download_url":\s*"\K[^"]+\.vsix')

if [[ -z "$LATEST_TAG" || -z "$VSIX_URL" ]]; then
  error "Could not find a .vsix asset in the latest release."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

# ── 6. Compare versions ───────────────────────────────────────────────────────
if [[ -n "$INSTALLED" && "$INSTALLED" == "$LATEST" ]]; then
  success "Sesam extension ${BOLD}v${INSTALLED}${RESET} is already installed and up to date."
  echo ""
  dim "  To uninstall: bash sesam-install.sh --uninstall"
  echo ""
  read -r -p "Press Enter to close..."
  exit 0
fi

if [[ -n "$INSTALLED" ]]; then
  echo -e "  ${YELLOW}Update available:${RESET} v${INSTALLED}  →  ${BOLD}v${LATEST}${RESET}"
else
  echo -e "  Installing ${BOLD}Sesam extension v${LATEST}${RESET}…"
fi
echo ""

# ── 7. Download & install ─────────────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

VSIX_PATH="$TMP_DIR/sesam-${LATEST_TAG}.vsix"

info "Downloading sesam-${LATEST_TAG}.vsix…"
curl -sL \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/octet-stream" \
  "$VSIX_URL" \
  -o "$VSIX_PATH"

code --install-extension "$VSIX_PATH" --force

echo ""
success "Sesam extension ${BOLD}v${LATEST}${RESET} installed successfully."
dim "  Restart VS Code to activate the new version."
dim "  To uninstall: bash sesam-install.sh --uninstall"
echo ""
read -r -p "Press Enter to close..."
