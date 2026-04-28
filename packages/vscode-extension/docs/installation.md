# Installing the Sesam VS Code Extension

The extension is for **internal use only** and is not published to the VS Code Marketplace.
Download assets from the [GitHub Releases page](https://github.com/datanav/sesam-ts/releases/latest).

## Prerequisites

- VS Code with `code` in your PATH
  - To add it: **Command Palette → Shell Command: Install 'code' command in PATH**

---

## Option 1 — Installer bundle (recommended)

Each release ships a self-contained archive containing both the `.vsix` and the `sesam-install.sh` script.
The script detects the bundled `.vsix`, installs it, and opens an interactive menu for reinstall / uninstall.

### tar.gz (macOS / Linux)

```bash
# 1. Download sesam-installer-vX.Y.Z.tar.gz from the releases page, then:
tar -xzf sesam-installer-v0.1.0.tar.gz && bash sesam-install.sh
```

### zip (Windows Git Bash / cross-platform)

```bash
# 1. Download sesam-installer-vX.Y.Z.zip from the releases page, then:
unzip sesam-installer-v0.1.0.zip && bash sesam-install.sh
```

> On Linux, do **not** double-click the `.sh` file — open a terminal and run `bash sesam-install.sh`.

### Interactive menu

When the extension is already installed and up to date, the script shows a menu:

```
  Sesam extension v0.1.0 is already installed and up to date.
  What would you like to do?
  1) Reinstall (same version)
  2) Uninstall
  3) Exit
```

After any action (install / reinstall / uninstall) the menu is shown again so you can take further action
without re-running the script.

### Uninstall flag

You can also uninstall non-interactively:

```bash
bash sesam-install.sh --uninstall
```

---

## Option 2 — Manual VSIX install

```bash
# 1. Download sesam-vX.Y.Z.vsix from the releases page, then:
code --install-extension sesam-v0.1.0.vsix
```

Or via the VS Code UI: **Extensions view (`Ctrl+Shift+X`) → `···` menu → Install from VSIX…**

---

## Updating

Re-run the installer script with the new archive — it detects the version difference and upgrades automatically.
For a manual update, download the new `.vsix` and run `code --install-extension` again.
