#!/usr/bin/env bash
# Sesam VS Code Extension — Installer & Updater
#
# Usage:
#   bash sesam-install.sh            — install or update
#   bash sesam-install.sh --uninstall — remove the extension
#
# The script looks for a sesam-*.vsix in the same folder as this script.
# To update: replace the .vsix with a newer one and run again.
#
# Requirements: code (VS Code CLI in PATH)

set -euo pipefail

EXT_ID="bouvet.dtl-language-support"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# ── 2. Require code CLI ───────────────────────────────────────────────────────
if ! command -v code &>/dev/null; then
  error "'code' command not found."
  dim "  Add VS Code to your PATH: https://code.visualstudio.com/docs/setup/linux"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

# ── 3. Get currently installed version ───────────────────────────────────────
INSTALLED=$(code --list-extensions --show-versions 2>/dev/null \
  | grep -i "^${EXT_ID}@" | cut -d@ -f2 || true)

# ── 4. Uninstall mode ─────────────────────────────────────────────────────────
if [[ "${1:-}" == "--uninstall" ]]; then
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

# ── 5. Find .vsix next to this script ────────────────────────────────────────
VSIX_FILE=$(ls "$SCRIPT_DIR"/sesam-*.vsix 2>/dev/null | sort -V | tail -1 || true)

if [[ -z "$VSIX_FILE" ]]; then
  error "No sesam-*.vsix file found in: $SCRIPT_DIR"
  echo ""
  dim "  The .vsix should be in the same folder as this script."
  dim "  Download a fresh installer archive from GitHub Releases."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

VSIX_VERSION=$(basename "$VSIX_FILE" | grep -oP '\d+\.\d+\.\d+' || true)

# ── 6. Compare versions / show menu if up to date ────────────────────────────
if [[ -n "$INSTALLED" && "$INSTALLED" == "$VSIX_VERSION" ]]; then
  while true; do
    if [[ -n "$INSTALLED" ]]; then
      success "Sesam extension ${BOLD}v${INSTALLED}${RESET} is already installed and up to date."
    else
      warn "Sesam extension is not currently installed."
    fi
    echo ""
    echo -e "  ${BOLD}What would you like to do?${RESET}"
    echo -e "  ${CYAN}1)${RESET} Reinstall (same version)"
    echo -e "  ${CYAN}2)${RESET} Uninstall"
    echo -e "  ${CYAN}3)${RESET} Exit"
    echo ""
    read -r -p "  Choose [1/2/3]: " CHOICE
    echo ""
    case "${CHOICE:-3}" in
      1)
        info "Reinstalling Sesam extension v${VSIX_VERSION}…"
        code --install-extension "$VSIX_FILE" --force
        echo ""
        success "Sesam extension ${BOLD}v${VSIX_VERSION}${RESET} reinstalled."
        dim "  Restart VS Code to activate."
        echo ""
        ;;
      2)
        info "Uninstalling Sesam extension v${INSTALLED}…"
        code --uninstall-extension "$EXT_ID"
        echo ""
        success "Sesam extension v${INSTALLED} uninstalled."
        dim "  Restart VS Code to complete the removal."
        echo ""
        INSTALLED=""
        ;;
      *)
        exit 0
        ;;
    esac
  done
fi

if [[ -n "$INSTALLED" ]]; then
  echo -e "  ${YELLOW}Update available:${RESET} v${INSTALLED}  →  ${BOLD}v${VSIX_VERSION}${RESET}"
else
  echo -e "  Installing ${BOLD}Sesam extension v${VSIX_VERSION}${RESET}…"
fi
echo ""

# ── 7. Install ────────────────────────────────────────────────────────────────
code --install-extension "$VSIX_FILE" --force
INSTALLED="$VSIX_VERSION"

echo ""
success "Sesam extension ${BOLD}v${VSIX_VERSION}${RESET} installed successfully."
echo -e "  Restart VS Code to activate the new version."
echo ""

# ── 8. Post-install menu ──────────────────────────────────────────────────────
while true; do
  echo -e "  ${BOLD}What would you like to do next?${RESET}"
  echo -e "  ${CYAN}1)${RESET} Reinstall (same version)"
  echo -e "  ${CYAN}2)${RESET} Uninstall"
  echo -e "  ${CYAN}3)${RESET} Exit"
  echo ""
  read -r -p "  Choose [1/2/3]: " CHOICE
  echo ""
  case "${CHOICE:-3}" in
    1)
      info "Reinstalling Sesam extension v${VSIX_VERSION}…"
      code --install-extension "$VSIX_FILE" --force
      echo ""
      success "Sesam extension ${BOLD}v${VSIX_VERSION}${RESET} reinstalled."
      dim "  Restart VS Code to activate."
      echo ""
      ;;
    2)
      info "Uninstalling Sesam extension v${INSTALLED}…"
      code --uninstall-extension "$EXT_ID"
      echo ""
      success "Sesam extension v${INSTALLED} uninstalled."
      dim "  Restart VS Code to complete the removal."
      echo ""
      INSTALLED=""
      ;;
    *)
      exit 0
      ;;
  esac
done
