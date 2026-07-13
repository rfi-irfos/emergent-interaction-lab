# ── Stage 1: build frontend ───────────────────────────────────────────────────
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# useContent.ts fetches the live site copy at runtime from
# raw.githubusercontent.com/${VITE_GH_OWNER}/${VITE_GH_REPO}/main/... — these
# two are baked in at Vite build time via import.meta.env, and the GitHub
# Actions workflow that builds the GH Pages mirror sets them correctly. This
# Docker build (what Fly actually serves) never did, so OWNER/REPO came out
# as literal "undefined" in the bundle, every content fetch 404'd, and the
# site silently fell back to the hardcoded stub in defaultContent.ts — 3 nav
# links, no protocol/Jarvis/papers sections. Confirmed 2026-07-13 by pulling
# the live Fly bundle and finding ".../undefined/undefined/main/...". Not
# secrets — this repo's own public name, already linked from the site's own
# footer — so safe to bake in directly rather than needing a Fly secret.
ENV VITE_GH_OWNER=rfi-irfos
ENV VITE_GH_REPO=emergent-interaction-lab
RUN npm run build

# ── Stage 2: build backend ────────────────────────────────────────────────────
FROM rust:1.90-slim AS backend-build
WORKDIR /app/backend
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml backend/Cargo.lock ./
# pre-build empty src to cache deps
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY backend/src/ ./src/
RUN touch src/main.rs && cargo build --release

# ── Stage 3: build the Hermes research agent ─────────────────────────────────
# Hermes (NousResearch/hermes-agent, MIT) backs the Forschung tab's optional
# second engine — see backend/src/hermes.rs and the README.
#
# Pinned to an exact commit, not a branch: this is a third-party agent that runs
# next to production data, and `main` moving under a redeploy would silently
# change what it can do. Bump this deliberately.
#
# Installed into its own venv so its (pinned, exact-versioned) Python deps can
# never collide with anything else in the runtime image.
FROM python:3.11-slim AS hermes-build
ARG HERMES_REF=fc232f8ce648645b4df96d8be3fba2dc7cfd12d5
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/hermes-venv
ENV PATH="/opt/hermes-venv/bin:$PATH"
RUN git clone https://github.com/NousResearch/hermes-agent.git /src/hermes \
    && cd /src/hermes \
    && git checkout "${HERMES_REF}" \
    && pip install --no-cache-dir . \
    && rm -rf /src/hermes/.git

# ── Stage 4: runtime ─────────────────────────────────────────────────────────
# Python is in the runtime image because Hermes is a Python agent; the Rust
# backend still runs as the same single binary it always did.
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build /app/backend/target/release/backend ./backend
COPY --from=frontend-build /app/frontend/dist ./dist
COPY --from=hermes-build /opt/hermes-venv /opt/hermes-venv
COPY backend/content.json ./seed/content.json
COPY deploy/hermes-config.yaml ./seed/hermes-config.yaml
RUN mkdir -p uploads data

COPY <<'EOF' /app/start.sh
#!/bin/sh
# Boots Hermes (when configured) and then hands the container to the Rust
# backend, which stays PID 1 — a dead Hermes must never take the site down with
# it; it only means the Forschung tab falls back to the built-in engine.
if [ ! -f /app/data/content.json ]; then
  cp /app/seed/content.json /app/data/content.json
  echo "Seeded content.json from seed"
fi

# One key. NVIDIA_API_KEY is the only thing an operator sets: the Rust backend
# already uses it, and Hermes's nvidia provider reads the very same variable.
# No Hermes key, no Hermes URL, no second service to run.
#
# Skipped entirely without it — Hermes cannot answer a single turn with no
# inference credentials, so starting it would just burn 200MB of RAM to serve
# 401s. Set HERMES_ENABLED=0 to keep it off even when a key is present.
if [ -n "$NVIDIA_API_KEY" ] && [ "${HERMES_ENABLED:-1}" != "0" ]; then
  # Hermes's memory (engram.db, sessions, profile) lives HERE, on the mounted
  # volume — not in the container's writable layer. This is the same mistake
  # that silently ate every uploaded image before 2026-07-11 (see fly.toml):
  # this app runs min_machines_running=0, so the writable layer is erased on
  # every deploy AND on any idle stop. An agent whose long-term memory resets
  # when the machine sleeps is not a growing agent — it's the browser-tab
  # problem again, one layer down.
  export HERMES_HOME=/app/data/hermes
  mkdir -p "$HERMES_HOME"

  if [ ! -f "$HERMES_HOME/config.yaml" ]; then
    cp /app/seed/hermes-config.yaml "$HERMES_HOME/config.yaml"
    echo "Seeded Hermes config from seed (research-only toolset)"
  fi
  if [ -n "$HERMES_MODEL" ]; then
    export HERMES_DEFAULT_MODEL="$HERMES_MODEL"
  fi

  # Internal handshake only. Freshly generated per boot, never persisted, never
  # configured by an operator, and it never leaves the container: Hermes binds
  # to loopback, so nothing outside this container can reach it in the first
  # place. This exists so a bug that exposes the port is still an auth failure
  # rather than an open agent.
  API_SERVER_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  export API_SERVER_KEY
  export HERMES_API_KEY="$API_SERVER_KEY"
  export HERMES_URL="http://127.0.0.1:8765"

  # The other direction: the token Hermes presents to /api/mcp when it writes a
  # research note back into the lab (backend/src/mcp.rs). Same deal — generated
  # here, given to both sides, never persisted. Hermes's config refers to it as
  # ${EIL_MCP_TOKEN}, which its MCP client resolves from this environment, so the
  # config on the volume never holds a stale secret.
  EIL_MCP_TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  export EIL_MCP_TOKEN
  export EIL_MCP_URL="http://127.0.0.1:${PORT:-3000}/api/mcp"

  echo "Starting bundled Hermes research agent on 127.0.0.1:8765"
  API_SERVER_ENABLED=1 \
  API_SERVER_HOST=127.0.0.1 \
  API_SERVER_PORT=8765 \
    /opt/hermes-venv/bin/hermes gateway run &
fi

exec /app/backend
EOF
RUN chmod +x /app/start.sh

ENV STATIC_DIR=/app/dist
ENV UPLOADS_DIR=/app/uploads
ENV CONTENT_PATH=/app/data/content.json
ENV PORT=3000

EXPOSE 3000
CMD ["/app/start.sh"]
