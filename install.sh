#!/usr/bin/env bash
set -e

echo "╭──────────────────────────────────────────────────────────╮"
echo "│  KNOXENC / UOBF v2.0.0 — Termux & Linux CLI Installer    │"
echo "╰──────────────────────────────────────────────────────────╯"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "$SCRIPT_DIR/bin/obfuscate.js" "$SCRIPT_DIR/knoxenc.js"

# Detect Termux environment
if [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *"com.termux"* ]]; then
  echo "[*] Termux environment detected ($PREFIX)"
  if ! command -v node >/dev/null 2>&1; then
    echo "[*] Installing nodejs in Termux..."
    pkg update -y && pkg install -y nodejs
  fi
  ln -sf "$SCRIPT_DIR/bin/obfuscate.js" "$PREFIX/bin/uobf"
  ln -sf "$SCRIPT_DIR/bin/obfuscate.js" "$PREFIX/bin/knoxenc"
  chmod +x "$PREFIX/bin/uobf" "$PREFIX/bin/knoxenc"
  echo "[✓] Linked 'knoxenc' and 'uobf' to $PREFIX/bin"
else
  echo "[*] Standard Linux / POSIX environment detected"
  if ! command -v node >/dev/null 2>&1; then
    echo "[!] Node.js (>=16) is required. Please install Node.js first."
    exit 1
  fi
  if [ -w "/usr/local/bin" ]; then
    ln -sf "$SCRIPT_DIR/bin/obfuscate.js" "/usr/local/bin/uobf"
    ln -sf "$SCRIPT_DIR/bin/obfuscate.js" "/usr/local/bin/knoxenc"
    echo "[✓] Linked 'knoxenc' and 'uobf' to /usr/local/bin"
  else
    npm link
    echo "[✓] Linked 'knoxenc' and 'uobf' globally via npm link"
  fi
fi

echo ""
echo "[✓] Installation complete! Run 'knoxenc' or 'node knoxenc.js' to start."
