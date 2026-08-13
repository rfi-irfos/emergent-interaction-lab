// EIL static site build — Phase 4
// Reads public snapshot from backend, generates static EN/DE HTML + root.
// Run: node build-static.mjs
import fs from "fs";
import path from "path";

const SNAPSHOT_URL = process.env.EIL_SNAPSHOT_URL || "http://localhost:3000/api/eil/public-snapshot";
const OUT = path.resolve("dist-static");
const BASE = "https://rfi-irfos.github.io/emergent-interaction-lab";

async function fetchSnapshot() {
  try {
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
    return res.json();
  } catch (e) {
    // Fallback: use local snapshot.json (committed build artifact)
    const fs = await import("fs");
    const path = await import("path");
    const local = path.resolve("snapshot.json");
    if (fs.existsSync(local)) {
      console.log("WARN: live snapshot failed, using local snapshot.json");
      return JSON.parse(fs.readFileSync(local, "utf8"));
    }
    throw e;
  }
}

function esc(s = "") {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function writeHtml(relPath, html) {
  const full = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
}

function entityPage(entity, locale, typeLabel) {
  const title = entity[`title_${locale}`] || entity.title_en;
  const desc = entity[`description_${locale}`] || entity.description_en || "";
  const summary = entity[`abstract_${locale}`] || entity[`core_question_${locale}`] || desc;
  const url = `${BASE}/${locale}/${typeLabel}/${entity.slug}/`;
  const other = locale === "en" ? "de" : "en";
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <title>${esc(title)} — Emergent Interaction Lab</title>
  <meta name="description" content="${esc(summary).slice(0, 160)}">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="en" href="${BASE}/en/${typeLabel}/${entity.slug}/">
  <link rel="alternate" hreflang="de" href="${BASE}/de/${typeLabel}/${entity.slug}/">
  <link rel="alternate" hreflang="x-default" href="${BASE}/en/${typeLabel}/${entity.slug}/">
  <meta name="robots" content="index,follow">
</head>
<body>
  <h1>${esc(title)}</h1>
  <p>${esc(desc)}</p>
  <nav><a href="/en/">English</a> · <a href="/de/">Deutsch</a></nav>
</body>
</html>`;
}

function rootPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Emergent Interaction Lab</title>
  <meta name="description" content="Complex Systems · Interaction · Intelligence · Architecture">
  <link rel="canonical" href="${BASE}/">
  <link rel="alternate" hreflang="x-default" href="${BASE}/">
  <link rel="alternate" hreflang="en" href="${BASE}/en/">
  <link rel="alternate" hreflang="de" href="${BASE}/de/">
  <meta name="robots" content="index,follow">
</head>
<body>
  <h1>Emergent Interaction Lab</h1>
  <nav><a href="/en/">English</a> · <a href="/de/">Deutsch</a></nav>
</body>
</html>`;
}

async function main() {
  const snap = await fetchSnapshot();
  writeHtml("index.html", rootPage());

  // write full snapshot as index.json for client-side SPA/preview
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(snap, null, 2));

  const types = [
    ["research_programs", "research"],
    ["case_studies", "evidence"],
    ["publications", "publications"],
    ["frameworks", "frameworks"],
    ["systems", "systems"],
    ["methods", "methods"],
    ["datasets", "datasets"],
    ["profiles", "laura"],
  ];
  for (const [key, route] of types) {
    for (const e of snap[key] || []) {
      writeHtml(`en/${route}/${e.slug}/index.html`, entityPage(e, "en", route));
      writeHtml(`de/${route}/${e.slug}/index.html`, entityPage(e, "de", route));
    }
  }
  console.log(`STATIC BUILD OK — programs:${snap.research_programs?.length||0} cases:${snap.case_studies?.length||0} pubs:${snap.publications?.length||0} | root + locale routes + index.json -> dist-static/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
