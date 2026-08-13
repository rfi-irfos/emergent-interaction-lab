Subject: EIL Website — Phase 4 fertig, Fly.io Deploy nach Frankfurt kann losgehen

Hallo Simeon,

die EIL-Website steht und kann auf Fly.io nach Frankfurt deployed werden.

**Was fertig ist:**
- Backend: SQLite + CRUD-API für alle Entity-Typen + public-snapshot-Endpoint
- Frontend: statischer Build EN/DE, 33 Seiten, Sitemap, robots.txt, JSON-LD, React-App mit Detail-Ansichten
- Content: 5 Cases, 3 Datasets, 5 Methods, 1 Publication, 1 Research Program, 3 Frameworks, 2 Systems, 1 Profile — alle mit echten EIL-Inhalten
- GitHub Pages Workflow committed auf Branch `hermes-research-engine`
- Snapshot + Build-Pipeline verifiziert

**Was du tun musst:**
1. Backend auf Fly.io deployen (Frankfurt-Region)
   - Branch: `hermes-research-engine`
   - Backend-Pfad: `/backend`
   - DB: SQLite (`data-eil-migration.db`)
   - Port: 3000
2. GitHub Pages aktivieren (Source: `gh-pages` branch)
   - Workflow nutzt peaceiris/actions-gh-pages
   - Nach dem ersten Deploy: Pages-Source auf `gh-pages` branch umstellen

**Optional:**
- CRUD-API ist live unter `/api/eil/entities/*` — kann für Content-Pflege genutzt werden
- Admin-Auth fehlt noch (CHAT_API_SECRET wird geladen, aber EIL-CRUD hat keine Auth-Middleware)

Fragen? Ich kann auch direkt mitdeployen, wenn du mir Zugriff gibst.

Grüße,
Laura
