# Standalone Hermes — the Frankfurt host

Runs Hermes as a standing, always-on service on its own server, instead of
bundled inside the `emergent-interaction-lab` Fly container. This is what
makes Hermes the one brain behind Jarvis by default (2026-07-13 direction,
see PR #90's follow-up comments) rather than something that has to cold-start
whenever the Fly machine wakes from `min_machines_running = 0`.

Nothing about `backend/src/hermes.rs` or `backend/src/mcp.rs` changes for
this — they already talk to Hermes purely over `HERMES_URL`/`HERMES_API_KEY`,
wherever that points. This only changes *where* Hermes runs.

## Prerequisites on the server

- Docker + the Docker Compose plugin (`docker compose version` works)
- A domain or subdomain or you control (e.g. `hermes.rfi-irfos.com`), with an
  A/AAAA record already pointed at this server's public IP
- Ports 80 and 443 reachable from the internet (Caddy needs 80 for the
  Let's Encrypt ACME challenge, 443 for the actual TLS traffic)
- The same `NVIDIA_API_KEY` the Fly app already uses (`fly secrets list` on
  the main app, or wherever it's stored)

## 1. Get the repo onto the server

```bash
git clone https://github.com/rfi-irfos/emergent-interaction-lab.git
cd emergent-interaction-lab
```

## 2. Generate the two shared secrets

```bash
openssl rand -hex 32   # → HERMES_API_KEY
openssl rand -hex 32   # → EIL_MCP_TOKEN
```

These are **not** the ephemeral per-boot secrets the bundled deployment
generates in `start.sh` — those only worked because both processes shared one
container's lifetime. Here, two independently-restarting hosts have to agree
on the same values indefinitely, so generate them once and keep them
somewhere durable (a password manager, not just this server's disk).

## 3. Configure

```bash
cp deploy/hermes-standalone/.env.example deploy/hermes-standalone/.env
```

Fill in `deploy/hermes-standalone/.env` — every field's own comment says
where its value comes from. `HERMES_DOMAIN` is the subdomain from the
prerequisites step; `EIL_MCP_URL` should already be right as shipped
(`https://emergent-interaction-lab.fly.dev/api/mcp`) unless the Fly app's URL
ever changes.

## 4. Bring it up

```bash
docker compose -f deploy/hermes-standalone/docker-compose.yml --env-file deploy/hermes-standalone/.env up -d --build
```

Verify:

```bash
curl -s https://<HERMES_DOMAIN>/health   # or whatever hermes-agent's own health path is
docker compose -f deploy/hermes-standalone/docker-compose.yml logs -f hermes
```

Hermes's memory lives in the `hermes_data` Docker volume on this host — it
survives container restarts, image rebuilds, and reboots. It does not survive
`docker compose down -v` (the `-v` deletes volumes), so never run that here
without meaning to wipe the agent's memory.

## 5. Point the Fly app at it

```bash
fly secrets set \
  HERMES_URL="https://<HERMES_DOMAIN>" \
  HERMES_API_KEY="<the same HERMES_API_KEY from step 2>" \
  EIL_MCP_TOKEN="<the same EIL_MCP_TOKEN from step 2>" \
  -a emergent-interaction-lab
```

Setting Fly secrets triggers a redeploy on its own. After it lands, the
Forschung tab should show the `🜂 Jarvis, auf Hermes` status indicator (no
picker — this is automatic now) on every new conversation, and
`GET /api/chat/engines` should list `hermes`.

## 6. Once this is confirmed live

The bundled Hermes path in the repo root `Dockerfile` and `start.sh`
(`HERMES_ENABLED`, the loopback-only gateway, the per-boot ephemeral keys)
becomes dead weight once this standalone host is the one actually serving
traffic — smaller image, no more 512MB→1GB Fly VM bump, no OOM risk from
running a Python agent and the Rust backend in the same box. Removing it is
tracked separately; don't remove it until this standalone deployment has been
running cleanly for a few days.

## Security notes (same posture as the bundled deployment, don't loosen it)

- `deploy/hermes-config.yaml` (shared with the bundled deployment — one file,
  don't fork it) pins the agent to the `web` + `memory` toolsets only. Hermes's
  *default* toolset includes `terminal`/`process`/`read_file`/`write_file`/
  `patch` — a full shell and filesystem over HTTP. Never widen the toolset
  list in this config without understanding exactly what that reopens.
- The Hermes gateway port (8765) is never published to the host or the
  internet directly — only Caddy's 80/443 are, and Caddy is the only thing
  that reaches `hermes:8765`, over the compose-internal network.
- `HERMES_API_KEY` is the actual access control on top of that. Treat it like
  any other production secret — it's the same trust boundary as
  `CHAT_API_SECRET` on the main app.
