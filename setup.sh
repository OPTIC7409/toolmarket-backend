#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd node
need_cmd python3

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$EXAMPLE_FILE" ]]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo "Created .env from .env.example"
  else
    touch "$ENV_FILE"
    echo "Created empty .env"
  fi
fi

ALLOW_ORIGINS=(
  "http://localhost:3000"
  "http://localhost:3001"
  "https://toolmarketai.app"
  "https://www.toolmarketai.app"
)

join_by_comma() {
  local IFS=","
  echo "$*"
}

DESIRED_CORS_ORIGINS="$(join_by_comma "${ALLOW_ORIGINS[@]}")"

update_env_kv() {
  local key="$1"
  local value="$2"

  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import sys

path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
try:
  with open(path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines(True)
except FileNotFoundError:
  lines = []

needle = f"{key}="
out = []
replaced = False
for line in lines:
  if line.startswith(needle):
    out.append(f'{key}="{value}"\n')
    replaced = True
  else:
    out.append(line)

if not replaced:
  if out and not out[-1].endswith("\n"):
    out[-1] = out[-1] + "\n"
  if out and out[-1].strip() != "":
    out.append("\n")
  out.append(f'{key}="{value}"\n')

with open(path, "w", encoding="utf-8") as f:
  f.write("".join(out))
PY
}

echo "Updating backend env for CORS…"
update_env_kv "CORS_ORIGINS" "$DESIRED_CORS_ORIGINS"

echo "Setting FRONTEND_URL to toolmarketai.app…"
update_env_kv "FRONTEND_URL" "https://toolmarketai.app"

echo
echo "Done."
echo "- Updated: $ENV_FILE"
echo "- CORS_ORIGINS: $DESIRED_CORS_ORIGINS"
echo "- FRONTEND_URL: https://toolmarketai.app"
echo
echo "Next:"
echo "- Restart your backend server so it reloads .env"

