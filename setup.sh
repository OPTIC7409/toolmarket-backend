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

  # Escape backslashes and ampersands for perl replacement.
  local escaped
  escaped="$(printf '%s' "$value" | perl -pe 's/([\\\\&])/\\\\$1/g')"

  if grep -qE "^${key}=" "$ENV_FILE"; then
    perl -0777 -i -pe "s/^${key}=.*\\n/${key}=\"${escaped}\"\\n/m" "$ENV_FILE"
  else
    printf '\n%s="%s"\n' "$key" "$value" >>"$ENV_FILE"
  fi
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

