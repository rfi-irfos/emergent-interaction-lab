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

A live research instrument for studying how meaning, structure, and behavior emerge from sustained human–AI interaction — not a static site, not a generic analytics dashboard. Every research conversation, blog entry, and note feeds the **Observatory**: a running instrument that measures emergence signals, drift, and interaction dynamics as they happen, organized into a strict three-tier hierarchy (*Forschungsebene / Systemebene / Technische Ebene*) so a real research signal is never presented with the same visual weight as a raw technical figure.

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
- **AI:** NVIDIA-hosted LLMs (chat + embeddings), with a fallback ladder across candidate models.
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
