

A minimalist, high-performance website builder kit. Fast. No bloat. No subscription.

**The product:** Clone this repo for any client. They get a fully-built website on their domain. If they want Tier 3, they also get a Gmail-authenticated admin panel to edit everything themselves — texts, images, products — live, no deployments needed.

**Every page ships, by mandate:**

- **Three themes — Light / Dark / High-Contrast.** EU accessibility lock-in. A theme switch sits in the nav (and the mobile menu), defaults to the visitor's system preference (`prefers-color-scheme`, `prefers-contrast`), and persists. High-contrast is WCAG-AAA black/white/amber with thick borders and visible focus rings. Built on semantic tokens (`--text`, `--text-soft`, `--surface`, `--on-primary`, …) — never a faint grey for readable text.
- **Mobile-app layout, automatic.** The same page reflows to a phone-native layout below 680px: a hamburger menu (top-right) holds every nav link, the phone CTA, the action button and the theme switch in a slide-in drawer. Tablet breakpoint at 1024px. No separate app, no separate build — one page, device-aware.
- **Device preview in the builder.** A `Web · Tablet · Mobil` toggle above the live preview renders the real page inside a true-to-width device frame, so you verify the fit before you ship. It uses CSS container queries, so the frame triggers the *actual* phone/tablet layout — not a squished desktop.

**[http://localhost:5173](http://localhost:5173)** — public site  
**[http://localhost:5173/admin](http://localhost:5173/admin)** — admin panel

---

## Pricing

| Tier | Price | What the client gets |
|------|-------|----------------------|
| **Basis** | €500 | Complete homepage, live on their domain. Fast, clean, done. One-time. |
| **Premium** | €1.400 | Better site with product categories, tabs, full contact section. Ongoing support: we build new features on request. |
| **Enterprise** | €2.900 | Full frontend + CMS backend. Client logs in with Gmail, edits everything themselves. Hosting included. Support included. No subscription, ever. |

**Standard for every client — same tiers, no exceptions.**

---

## How It Works

```
Clone repo
  Copy .env.example → .env, set ALLOWED_EMAIL=client@gmail.com
  cargo run (backend, port 3000)
  npm run dev (frontend, port 5173)

yoursite.at           → public site, always live
yoursite.at/admin     → Gmail login → admin panel → edit everything → Save
                                                                        |
                                                             PUT /api/content
                                                             writes content.json
                                                             live on next page load
```

---

## Quick Start

```bash
# Terminal 1: Backend
cd backend && cargo run

# Terminal 2: Frontend
cd frontend && npm run dev
```

Open: **[http://localhost:5173](http://localhost:5173)** — public site  
Admin: **[http://localhost:5173/admin](http://localhost:5173/admin)** — login and edit

---

## Admin Panel

- **Canvas editor** — every element freely draggable on the left, settings panel on the right, updates as you type
- **Device preview toggle** — `Bearbeiten · Web · Tablet · Mobil` above the canvas. Web = 1280px, Tablet = 834px, Mobil = 390px, each in a device frame that reflows the real responsive layout (container queries) so you can confirm fit before shipping
- Sections: Site Settings (colors, font), Navigation, Hero, Features, Products, Contact, Footer
- Image upload per section/product
- Gmail OAuth login (or `DEV_MODE=true` to bypass locally)

## Accessibility & Themes

- **Light / Dark / High-Contrast** on every public page — switch in the nav and the mobile drawer, system-preference default, persisted to `localStorage` (`rfi-theme`).
- Themes are pure CSS-token swaps on `.site[data-theme="…"]` — no flash, no JS repaint cost. To retheme, edit the three token blocks at the top of `frontend/src/App.css`.
- High-contrast forces amber `--primary`/`--accent`, white-on-black text, 2px borders and 3px focus outlines (WCAG AAA).

## Responsive / Mobile

- One page, device-aware. Breakpoints: tablet ≤ 1024px (2-col grids), phone ≤ 680px (single column, hamburger nav).
- The hamburger drawer (top-right on mobile) carries every nav link, the phone shortcut, the primary CTA and the theme switch.
- Real-page reflow uses `@media`; the builder's device frame mirrors the same rules as `@container` queries (the live page must stay out of a query container so `position: fixed` nav / WhatsApp button keep working).

---

## Stack

- **Backend:** Rust, Axum 0.7, Tokio — content API, OAuth2, file uploads, serves the SPA
- **Frontend:** React 19, TypeScript, Vite — public renderer + admin editor
- **Auth:** Google OAuth2 (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`)
- **Content:** `content.json` on disk, PUT to update, no database needed
- **Uploads:** `/uploads/` directory, served as static files

---

## Project Structure

```
rfi-irfos-web-template/
├── backend/
│   ├── src/
│   │   ├── main.rs       router, shared state
│   │   ├── auth.rs       Google OAuth2, sessions
│   │   ├── content.rs    GET/PUT content.json
│   │   └── upload.rs     image upload
│   ├── content.json      site content (auto-created on first run)
│   └── uploads/          uploaded images
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── PublicSite.tsx   renders the live website
│   │   │   ├── AdminPanel.tsx   the CMS editor
│   │   │   └── LoginPage.tsx    Google login screen
│   │   ├── hooks/
│   │   │   ├── useContent.ts
│   │   │   ├── useAuth.ts
│   │   │   └── useTheme.ts    light / dark / high-contrast state
│   │   └── types/
│   │       └── content.ts
│   └── dist/             built frontend (served by backend in production)
└── .env.example          copy to .env and fill in
```

---

## Production Deploy

```bash
# Build frontend
cd frontend && npm run build

# Build backend (serves the frontend SPA + API from one binary)
cd backend && cargo build --release

# Set env vars, run
./target/release/backend
```

Point DNS to the server. Done.
