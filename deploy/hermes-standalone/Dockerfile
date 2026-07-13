# Standalone Hermes research agent — meant to run on its own always-on host
# (the Frankfurt server), NOT inside the emergent-interaction-lab Fly
# container. Extracted from the repo root Dockerfile's "Stage 3: build the
# Hermes research agent" — same pinned commit, same venv-isolated install —
# but this image's CMD actually runs the gateway, instead of copying the venv
# into a bigger multi-stage image that starts it conditionally from
# start.sh.
#
# Why this needs to exist at all (2026-07-13): the bundled version binds
# Hermes to 127.0.0.1 inside the same container as the Rust backend, so its
# memory lives on that container's mounted volume and resets its *reachability*
# every time that container's machine scales to zero (auto_stop_machines,
# min_machines_running=0 in fly.toml) — the memory itself persists on the
# volume, but the agent isn't a standing presence, it's something that spins
# up and down with traffic. Running it here instead — on a host that's simply
# always on — is what makes Hermes the base intelligence behind Jarvis by
# default, not a service that has to wake up first.
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
# The api_server platform adapter (what actually serves HTTP — the entire
# point of this image) needs aiohttp, which hermes-agent only pulls in under
# its "messaging"/"slack"/"matrix"/etc. extras, none of which a plain
# `pip install .` grabs. Without this, `hermes gateway run` starts and logs
# cron jobs fine but warns "API Server: aiohttp not installed" / "No adapter
# available for api_server" and never actually binds the port — found by
# building and running this image for real (2026-07-13); a mock or unit test
# would never catch it, since the process itself doesn't crash. Pinned to the
# same version hermes-agent's own extras specify, installed directly instead
# of pulling in a whole messaging-platform extras group we don't need.
RUN pip install --no-cache-dir aiohttp==3.14.1

# This app's own toolset is deliberately wider than the bundled deployment's
# (see hermes-config-full.yaml's own doc comment for why that's safe here and
# isn't elsewhere): memory/web/skills/cron/delegation, using Hermes's own
# DEFAULT memory (proven live 2026-07-13 — a fact planted in one conversation
# was correctly recalled from a completely unrelated one, memory intact
# across a redeploy too), not a vector-DB-backed alternative.
#
# A vector-DB memory backend (mem0 OSS mode) was attempted and deliberately
# reverted the same day: mem0ai + qdrant-client installed fine, but
# _setup.py's build_oss_config() only ever writes a custom base_url
# ("ollama_base_url") for the "ollama" provider — the "openai" provider this
# deployment would otherwise reuse (same NVIDIA endpoint/key as everything
# else here) has no equivalent override in this wrapper. The only fully
# self-contained fix left is bundling a local Ollama server + two models
# (~1.6GB) into this image, which hit repeated build instability under this
# environment's resource constraints without ever reaching a verified boot.
# Shipping proven, working default memory now rather than blocking on an
# unverified integration; the Ollama-bundling path is real and documented
# here for whoever picks this back up — it just needs a calmer build
# environment (or a real OpenAI/Mem0-Cloud key) to actually finish.
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=hermes-build /opt/hermes-venv /opt/hermes-venv
ENV PATH="/opt/hermes-venv/bin:$PATH"

# The FULL toolset config — not deploy/hermes-config.yaml (that one stays
# locked down for the bundled deployment, which shares a container with
# production secrets this app doesn't have). Copied in at build time; the
# entrypoint refreshes it from this seed on every boot (see start.sh).
COPY deploy/hermes-standalone/hermes-config-full.yaml /app/seed/hermes-config.yaml

RUN mkdir -p /app/data

# A plain file, not an inline Dockerfile heredoc (`COPY <<'EOF' ...`) — that
# syntax needs BuildKit, and this image should build with either the legacy
# builder or BuildKit/buildx, since Fly's remote builder and a plain `docker
# build` on the Frankfurt host shouldn't have to agree on which one is
# available (found the hard way: a local BuildKit-less `docker build` failed
# outright on the heredoc form while validating this Dockerfile 2026-07-13).
COPY deploy/hermes-standalone/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8765
CMD ["/app/start.sh"]
