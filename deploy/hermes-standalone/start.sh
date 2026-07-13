#!/bin/sh
set -e

: "${NVIDIA_API_KEY:?NVIDIA_API_KEY is required — Hermes's nvidia provider reads this exact variable}"
: "${HERMES_API_KEY:?HERMES_API_KEY is required — this is the stable shared secret the Fly backend authenticates with, NOT regenerated per boot like the bundled deployment's ephemeral one}"
: "${EIL_MCP_URL:?EIL_MCP_URL is required — the lab's own MCP endpoint, e.g. https://emergent-interaction-lab.fly.dev/api/mcp}"
: "${EIL_MCP_TOKEN:?EIL_MCP_TOKEN is required — must match the EIL_MCP_TOKEN Fly secret exactly, both sides of the same shared secret}"

export HERMES_HOME=/app/data
mkdir -p "$HERMES_HOME"

if [ ! -f "$HERMES_HOME/config.yaml" ]; then
  cp /app/seed/hermes-config.yaml "$HERMES_HOME/config.yaml"
  echo "Seeded Hermes config from seed (research-only toolset)"
fi
if [ -n "$HERMES_MODEL" ]; then
  export HERMES_DEFAULT_MODEL="$HERMES_MODEL"
fi

# Binds to all interfaces here (unlike the bundled deployment's 127.0.0.1) —
# this container's whole purpose is to be reachable from the Fly app over the
# public internet. That means HERMES_API_KEY is the only thing standing
# between this endpoint and anyone who finds it: run this behind the
# Caddy reverse proxy in docker-compose.yml (TLS termination + the one
# HERMES_API_KEY check), never bind the gateway port directly to a public
# interface without it in front.
echo "Starting standalone Hermes research agent on 0.0.0.0:${API_SERVER_PORT:-8765}"
exec env API_SERVER_ENABLED=1 \
  API_SERVER_HOST=0.0.0.0 \
  API_SERVER_PORT="${API_SERVER_PORT:-8765}" \
  hermes gateway run
