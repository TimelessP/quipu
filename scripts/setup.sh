#!/usr/bin/env bash
# scripts/setup.sh
#
# One-time project bootstrap. Run from the repo root OR from scripts/:
#   bash scripts/setup.sh
#
# What this does:
#   1. Checks Python 3.12+ is available
#   2. Creates a .venv virtual environment at the repo root
#   3. Installs all Python dependencies from requirements.txt
#   4. Creates the data/ directory layout expected at startup
#
# Re-running is safe – existing venv and data dirs are preserved.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Python version check ─────────────────────────────────────────────────────

find_python() {
  # .python-version pins 3.12; prefer it, fall back to 3.11/3.10 if unavailable
  for cmd in python3.12 python3.11 python3.10 python3; do
    if command -v "$cmd" &>/dev/null; then
      if "$cmd" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
        echo "$cmd"
        return 0
      fi
    fi
  done
  return 1
}

PYTHON=$(find_python || true)
if [[ -z "$PYTHON" ]]; then
  echo "ERROR: Python 3.10+ is required but not found." >&2
  echo "  Install it with: sudo apt install python3.12" >&2
  exit 1
fi

echo "Using $PYTHON ($($PYTHON --version))"

# ── Virtual environment ───────────────────────────────────────────────────────

if [[ ! -d ".venv" ]]; then
  echo "Creating .venv ..."
  "$PYTHON" -m venv .venv
else
  echo ".venv already exists – skipping creation"
fi

# shellcheck disable=SC1091
source .venv/bin/activate

# ── Python dependencies ───────────────────────────────────────────────────────

echo "Installing Python dependencies ..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo ""
echo "Installed packages:"
pip show fastapi uvicorn python-multipart | grep -E "^(Name|Version):"

# ── Data directories ──────────────────────────────────────────────────────────

for d in data/nodes data/items data/uploads; do
  mkdir -p "$d"
  echo "  $d/ ready"
done

echo ""
echo "Setup complete. Next step:"
echo "  bash scripts/serve.sh"
