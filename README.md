# Emergent Interaction Lab

[![Release](https://img.shields.io/github/v/release/rfi-irfos/emergent-interaction-lab?color=3b6bf6&label=release)](../../releases)
[![Deploy](https://github.com/rfi-irfos/emergent-interaction-lab/actions/workflows/deploy.yml/badge.svg)](../../actions/workflows/deploy.yml)
[![Last commit](https://img.shields.io/github/last-commit/rfi-irfos/emergent-interaction-lab?color=10b981)](../../commits/main)
[![Stars](https://img.shields.io/github/stars/rfi-irfos/emergent-interaction-lab?color=f59e0b)](../../stargazers)
[![Backend](https://img.shields.io/badge/backend-Rust%20%2F%20Axum-CE422B)](backend)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2F%20TypeScript-3178C6)](frontend)
[![Database](https://img.shields.io/badge/database-SQLite-003B57)](backend/src)
[![Hosting](https://img.shields.io/badge/hosted%20on-Fly.io-8B5CF6)](https://fly.io)
[![Status](https://img.shields.io/badge/status-live%20research%20instrument-10b981)](https://rfi-irfos.github.io/emergent-interaction-lab/)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey)](#)
[![Laura](https://img.shields.io/badge/Laura-Human%E2%80%93AI%20Co--Evolution-ff69b4)](https://github.com/rfi-irfos/call-laura)
[![CoEvolution Factory](https://img.shields.io/badge/CoEvolution%20Factory-50%20live%20centers-8B5CF6)](https://coevolution-factory-sparkling-mountain-1802.fly.dev)
[![OSF](https://img.shields.io/badge/OSF-IEIA--2025%20preprint-10b981)](https://doi.org/10.17605/OSF.IO/HC9ZB)
[![lauras-core](https://img.shields.io/crates/v/lauras-core?color=dea584)](https://crates.io/crates/lauras-core)

**Emergent Interaction Lab (EIL)** is the operating-system base of the RFI-IRFOS stack — the instrument everything else is orchestrated from or emerges into. The Laura agent system, the CoEvolution Factory, the ternary OS work, and the public research all hang off this repo.

Built for Laura Serna Gaviria's Emergent Interaction Lab research (RFI-IRFOS). See the [`v1.0.0` release](../../releases/tag/v1.0.0) for the full feature history.

---

## What's actually in here

**Research instrument**
- **Jarvis** — an self improving, recursive AI research partner embedded and growing from within the Forschung tab: RAG chat over uploaded documents and past conversations, autonomous tool use (research notes, simulation runs, blog drafts, live web search), a four-level signal classification (Human / AI / Interaction / System), and a reasoning-mode toggle.
- **Observatory dashboard** — Emergence Monitor, Simulation Center, Research Pulse, Knowledge Graph, System Map, System State, Interaction Dynamics, Behavioral Landscape, Information Dynamics — each surfacing real queried data, never a fabricated placeholder.
- A deliberate **no-fabrication principle** running through the whole system: heuristic connections are labeled as heuristic, missing data is left honestly absent rather than invented, and this is enforced structurally (schema, UI, system prompt), not left to convention.

**Platform**
- Public research site, bilingual (DE/EN), with an admin CMS ("Verwaltung") and a Stripe-backed monetization funnel.
- Rust/Axum backend, React/TypeScript frontend.

---

## Quick Start

```bash
# Terminal 1: Backend
cd backend && cargo run

# Terminal 2: Frontend
cd frontend && npm run dev
```

Open: **[http://localhost:5173](http://localhost:5173)** — public site
Admin: **[http://localhost:5173/admin](http://localhost:5173/admin)** — login and edit (`DEV_MODE=true` bypasses Google OAuth locally)

Copy `.env.example` → `.env` in `backend/` and fill in what you need — most integrations (NVIDIA chat, Stripe, web search, GitHub activity) degrade gracefully with a loud startup warning if their key is missing, so a bare-minimum `.env` is enough to run the site locally.

---

## Stack

- **Backend:** Rust, Axum 0.7, Tokio, SQLite (`sqlx`) — content API, chat/RAG, Observatory endpoints, billing, OAuth2, file uploads, serves the built SPA.
- **Frontend:** React 19, TypeScript, Vite — public site renderer + admin/Observatory UI.
- **AI:** NVIDIA-hosted LLMs (chat + embeddings), with a fallback ladder across candidate models. The Forschung tab can optionally run on a [Hermes](https://github.com/NousResearch/hermes-agent) agent instead — see *Hermes research engine* below.
- **Auth:** Google OAuth2 for the admin login, plus a shared-secret header for API calls from the admin UI.
- **Payments:** Stripe (Products → Prices → Payment Links).
- **Deploy:** Fly.io (backend + SQLite on a persistent volume) and GitHub Pages (public frontend build).

---

## Project Structure

```
emergent-interaction-lab/
├── backend/
│   └── src/
│       ├── main.rs          router, shared state, all env-driven config
│       ├── auth.rs           Google OAuth2, sessions
│       ├── authz.rs          shared-secret admin auth check
│       ├── chat.rs           Jarvis: RAG, streaming, model ladder, tool loop
│       ├── agent.rs           tool definitions (notes, simulations, blog, web search)
│       ├── hermes.rs          optional 2nd research engine: a Hermes agent as a service
│       ├── mcp.rs             MCP server: lets the Hermes agent write research notes back
│       ├── emergence.rs       emergence signal detection
│       ├── observatory.rs     Observatory dashboard endpoints
│       ├── research.rs        Research Workspace / Innovation Lab notes
│       ├── simulation.rs      Simulation Center
│       ├── blog.rs            blog drafts + publishing
│       ├── analytics.rs       admin usage stats
│       ├── track.rs           public visitor tracking pixel
│       ├── billing.rs         Stripe product/payment-link mechanism
│       ├── content.rs         GET/PUT content.json (site CMS)
│       ├── contact.rs         contact form inbox
│       ├── upload.rs          image upload
│       └── inspect.rs         NVIDIA logprobs proxy (debug tooling)
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── PublicSite.tsx        the live public research site
│       │   ├── AdminPanel.tsx        Verwaltung + Observatory shell
│       │   ├── ResearchChat.tsx      the Jarvis chat UI
│       │   ├── CertificationPage.tsx public monetization funnel page
│       │   └── observatory/          one component per Observatory module
│       ├── hooks/                    useContent, useAuth, useLang, useTheme
│       └── lib/                      shared frontend helpers (github.ts, adminApi.ts, ...)
└── .env.example
```

---

## Hermes research engine (optional)

The Forschung tab can be answered by one of two engines:

- **Jarvis** (default) — the built-in loop in `chat.rs`: one NVIDIA chat-completions
  call per round, tool calls parsed out of the model's own text. Stateless between
  turns; everything it "remembers" is what `chat.rs` reassembles from SQLite and
  the RAG chunks on the next request.
- **Hermes** (opt-in) — [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
  (MIT), a full agent runtime with its own tool loop, its own skills, and its own
  long-term memory that persists across turns and grows.

Hermes runs as a **service**, not in the browser. It needs a long-lived process, a
filesystem for its memory, and an inference key — in a browser tab (WASM/Pyodide)
the key would ship to every visitor, the tools wouldn't run, and the memory would
die with the tab, which is the one property the agent exists to have. So Hermes
runs server-side and the tab streams from it.

Nothing about Hermes is vendored into this repo: `hermes.rs` drives the HTTP API
server Hermes already ships, so it stays on its own release cycle.

### Deployed (Docker/Fly): nothing to configure

Hermes is **bundled into the image** and started by `start.sh`. It uses the same
`NVIDIA_API_KEY` the backend already has — Hermes's `nvidia` provider reads that
exact variable — so there is no second key and no second service to run:

```bash
NVIDIA_API_KEY=<your key>     # that's it
```

The engine picker then appears in the Forschung tab. Optional knobs:
`HERMES_ENABLED=0` (don't start it at all), `HERMES_MODEL=<model>` (override the
default).

Two things `start.sh` handles that are easy to get wrong:

- **Memory lives on the volume** (`HERMES_HOME=/app/data/hermes`). The container's
  writable layer is erased on every deploy *and* whenever the machine idles out
  (`min_machines_running = 0`) — the same trap that silently ate uploaded images
  before 2026-07-11. An agent whose long-term memory resets when the machine
  sleeps isn't a growing agent.
- **The agent runs with a research-only toolset** (`deploy/hermes-config.yaml`).
  Hermes's *default* API-server toolset includes `terminal`, `process` and
  `read_file`/`write_file` — a shell and filesystem, over HTTP, in a container
  holding `STRIPE_SECRET_KEY`, `CHAT_API_SECRET` and the live database, driven by
  whatever someone types into a chat box. The bundled agent is pinned to `web` +
  `memory` and nothing else. **Don't widen that list in place** — if you need
  those tools, give Hermes its own container with no production secrets.

**Cold start:** the machine scales to zero, and Hermes (Python) takes ~20s to come
up after a wake while the Rust binary is serving immediately. The engine picker
health-probes Hermes, so it appears once Hermes can actually answer; a turn sent
during that window waits it out rather than failing.

### What the Hermes agent can do

Hermes runs its *own* tool loop, so it never calls the tools in `agent.rs`. To let
it take part in the lab rather than just talk in it, the backend exposes an **MCP
server** at `POST /api/mcp` (`backend/src/mcp.rs`) — no bridge process; the Rust
backend *is* the MCP server. Hermes gets exactly three tools:

| tool | what it does |
|---|---|
| `log_research_note` | writes into the same `research_notes` table the human UI and Jarvis write to — the note shows up in Research Pulse tagged **🜂 Hermes**, linked to the conversation it grew out of |
| `search_research_notes` | reads what the lab already knows, so it builds on existing notes instead of re-deriving them |
| `web_search` | the backend's own keyless DuckDuckGo search |

`web_search` is served from here rather than from Hermes's own `web` toolset
because that toolset needs a *separate* search-provider API key and silently drops
its tools without one — driven for real, the bundled agent was offered `memory`
and nothing else. Routing search through the lab's keyless tool is what keeps
"one NVIDIA key and it works" actually true.

Note there is **no update and no delete**. The agent can add to the lab's
knowledge and read it back; it cannot rewrite or destroy it. A bad turn (or a
prompt injection in a page it read) can leave a junk note for a human to remove —
it cannot take anything away.

The endpoint is guarded by `EIL_MCP_TOKEN`, generated per boot and given to both
processes. Without it the route does not exist at all.

### Local dev: point at your own Hermes

```bash
API_SERVER_ENABLED=1 API_SERVER_KEY=<secret> API_SERVER_PORT=8765 \
API_SERVER_HOST=127.0.0.1 hermes gateway run

# then, for this backend:
HERMES_URL=http://127.0.0.1:8765
HERMES_API_KEY=<the same secret>
```

With `HERMES_URL` unset and no `NVIDIA_API_KEY` in a bundled image, `hermes.rs` is
inert: the picker never renders and every turn takes the built-in path exactly as
before.

**How a Hermes turn stays a first-class citizen.** One Hermes session per EIL
conversation, keyed by the same id. A Hermes turn ends in the same
`chat::finalize_turn` a built-in turn does, so it lands in the same tables and
feeds the same machinery: the transcript, the cross-chat RAG memory, the tool-call
log the Observatory reads, and the emergence / CCET / anomaly instrumentation.
The engine choice changes *who thinks*, not what the system learns from it.

---

## Ecosystem — the RFI-IRFOS stack

EIL is the base OS. Everything below is either orchestrated from it or emerges out of it.

**Laura — Human–AI Co-Evolution research framework**
- Deterministic MCP review server (public sibling): [github.com/rfi-irfos/call-laura](https://github.com/rfi-irfos/call-laura)
- Agent implementations (private core + public overview):
  [github.com/rfi-irfos/lauras-agents](https://github.com/rfi-irfos/lauras-agents) ·
  [github.com/rfi-irfos/lauras-agents-public](https://github.com/rfi-irfos/lauras-agents-public)
- Rust crates (v0.2.0):
  [lauras-core](https://crates.io/crates/lauras-core) ·
  [lauras-team](https://crates.io/crates/lauras-team) ·
  [lauras-mcp](https://crates.io/crates/lauras-mcp) ·
  [lauras-api](https://crates.io/crates/lauras-api)

**CoEvolution Factory — autonomous 50+ center system**
- Live: [coevolution-factory-sparkling-mountain-1802.fly.dev](https://coevolution-factory-sparkling-mountain-1802.fly.dev)
- Source: [github.com/rfi-irfos/coevolution-factory](https://github.com/rfi-irfos/coevolution-factory)

**Peer-reviewed research (Open Science Framework)**
- IEIA-2025 framework preprint: [doi.org/10.17605/OSF.IO/HC9ZB](https://doi.org/10.17605/OSF.IO/HC9ZB)
- Companion preprint: [doi.org/10.17605/OSF.IO/QCVJB](https://doi.org/10.17605/OSF.IO/QCVJB)

**Ternary Intelligence Stack (the OS maths under EIL)**
- [github.com/rfi-irfos/ternary-intelligence-stack](https://github.com/rfi-irfos/ternary-intelligence-stack)

---

## Production Deploy

```bash
# Backend + frontend, deployed together on Fly.io, and logs the deploy to
# the Observatory's Agent-Aktivität feed (POST /api/observatory/deploy-log)
# so `fly deploy`s show up alongside real GitHub PRs/commits/workflow runs.
scripts/deploy.sh

# Equivalent to a bare `fly deploy` if you deliberately want to skip logging:
scripts/deploy.sh --local-only
# or just:
fly deploy -a emergent-interaction-lab

# Frontend also auto-deploys to GitHub Pages on push to main
# (see .github/workflows/deploy.yml — that workflow never touches Fly)
```
