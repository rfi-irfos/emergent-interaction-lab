#!/bin/sh
set -e

: "${NVIDIA_API_KEY:?NVIDIA_API_KEY is required — Hermes's nvidia provider reads this exact variable}"
: "${HERMES_API_KEY:?HERMES_API_KEY is required — this is the stable shared secret the Fly backend authenticates with, NOT regenerated per boot like the bundled deployment's ephemeral one}"
: "${EIL_MCP_URL:?EIL_MCP_URL is required — the lab's own MCP endpoint, e.g. https://emergent-interaction-lab.fly.dev/api/mcp}"
: "${EIL_MCP_TOKEN:?EIL_MCP_TOKEN is required — must match the EIL_MCP_TOKEN Fly secret exactly, both sides of the same shared secret}"

export HERMES_HOME=/app/data
mkdir -p "$HERMES_HOME"

# Always overwritten from the git-managed seed, not just seeded once — see
# the matching comment in the repo root Dockerfile for why (a stale
# once-seeded copy on a persistent volume silently outlives a fixed config
# shipped in a later deploy, found for real 2026-07-13).
cp /app/seed/hermes-config.yaml "$HERMES_HOME/config.yaml"
echo "Hermes config refreshed from seed"
if [ -n "$HERMES_MODEL" ]; then
  export HERMES_DEFAULT_MODEL="$HERMES_MODEL"
fi

# mem0 OSS memory config — also always-overwritten, same reasoning as
# config.yaml above. Written directly rather than via `hermes memory setup
# --mode oss`: that wizard's build_oss_config() has no CLI flag for a custom
# openai_base_url (see hermes-config-full.yaml's doc comment), but mem0ai
# itself reads openai_base_url straight out of this file's llm/embedder
# blocks (OSSBackend passes them into Memory.from_config() unmodified), so
# writing it here bypasses the wizard's limitation entirely. qdrant runs
# embedded (path-based, no separate server) on the same mounted volume as
# everything else, so memory survives redeploys the same way config.yaml does.
cat > "$HERMES_HOME/mem0.json" <<EOF
{
  "mode": "oss",
  "user_id": "laura",
  "agent_id": "hermes",
  "oss": {
    "llm": {
      "provider": "openai",
      "config": {
        "model": "nvidia/llama-3.3-nemotron-super-49b-v1",
        "api_key": "$NVIDIA_API_KEY",
        "openai_base_url": "https://integrate.api.nvidia.com/v1"
      }
    },
    "embedder": {
      "provider": "openai",
      "config": {
        "model": "nvidia/nv-embedqa-e5-v5",
        "api_key": "$NVIDIA_API_KEY",
        "openai_base_url": "https://integrate.api.nvidia.com/v1"
      }
    },
    "vector_store": {
      "provider": "qdrant",
      "config": {
        "path": "$HERMES_HOME/mem0_qdrant"
      }
    }
  }
}
EOF
echo "mem0 OSS memory config refreshed from seed"

# Hermes's own gateway reads its required auth key as API_SERVER_KEY, not
# HERMES_API_KEY — found by actually running this image and reading its
# refusal: "Refusing to start: API_SERVER_KEY is required for the API
# server". HERMES_API_KEY is this repo's own naming (matches hermes.rs's
# client-side config, this file's env contract, and the Fly secret) —
# derive Hermes's expected variable from it here rather than rename
# everything else to match Hermes's internal naming.
export API_SERVER_KEY="$HERMES_API_KEY"

# Binds to all interfaces here (unlike the bundled deployment's 127.0.0.1) —
# this container's whole purpose is to be reachable from the Fly app over the
# public internet. That means API_SERVER_KEY is the only thing standing
# between this endpoint and anyone who finds it: run this behind the
# Caddy reverse proxy in docker-compose.yml (TLS termination + the one
# key check), never bind the gateway port directly to a public interface
# without it in front.
echo "Starting standalone Hermes research agent on 0.0.0.0:${API_SERVER_PORT:-8765}"
exec env API_SERVER_ENABLED=1 \
  API_SERVER_HOST=0.0.0.0 \
  API_SERVER_PORT="${API_SERVER_PORT:-8765}" \
  API_SERVER_KEY="$API_SERVER_KEY" \
  hermes gateway run
