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

function entityPage(entity, locale, typeLabel, allData) {
  const title = entity[`title_${locale}`] || entity.title_en;
  const desc = entity[`description_${locale}`] || entity.description_en || "";
  const summary = entity[`abstract_${locale}`] || entity[`core_question_${locale}`] || entity[`research_question_${locale}`] || desc;
  const url = `${BASE}/${locale}/${typeLabel}/${entity.slug}/`;
  
  // Build related links from all data
  const related = [];
  if (allData) {
    for (const [key, route] of [
      ["research_programs", "research"],
      ["case_studies", "evidence"],
      ["publications", "publications"],
      ["frameworks", "frameworks"],
      ["systems", "systems"],
      ["methods", "methods"],
      ["datasets", "datasets"],
      ["profiles", "laura"]
    ]) {
      for (const e of (allData[key] || []).slice(0, 3)) {
        const t = e[`title_${locale}`] || e.title_en || e.name_en;
        if (t && e.slug !== entity.slug) {
          related.push(`<li><a href="${BASE}/${locale}/${route}/${e.slug}/">${esc(t)}</a></li>`);
        }
      }
    }
  }
  
  // JSON-LD structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    "name": title,
    "description": summary,
    "url": url,
    "inLanguage": locale,
    "datePublished": entity.published_at || entity.created_at || new Date().toISOString().split("T")[0],
  };

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — Emergent Interaction Lab</title>
  <meta name="description" content="${esc(summary).slice(0, 160)}">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="en" href="${BASE}/en/${typeLabel}/${entity.slug}/">
  <link rel="alternate" hreflang="de" href="${BASE}/de/${typeLabel}/${entity.slug}/">
  <link rel="alternate" hreflang="x-default" href="${BASE}/en/${typeLabel}/${entity.slug}/">
  <link rel="preconnect" href="https://rfi-irfos.github.io">
  <meta name="robots" content="index,follow">
  <script type="application/ld+json">${esc(JSON.stringify(jsonLd))}</script>
</head>
<body>
  <article>
    <h1>${esc(title)}</h1>
    <p class="summary">${esc(summary)}</p>
    ${entity[`abstract_${locale}`] ? `<section><h2>Abstract</h2><p>${esc(entity[`abstract_${locale}`])}</p></section>` : ""}
    ${entity.doi ? `<p><strong>DOI:</strong> <a href="https://doi.org/${esc(entity.doi)}">${esc(entity.doi)}</a></p>` : ""}
    ${related.length ? `<nav><h2>Related</h2><ul>${related.slice(0, 6).join("")}</ul></nav>` : ""}
    <nav class="lang"><a href="/en/">English</a> · <a href="/de/">Deutsch</a></nav>
  </article>
</body>
</html>`;
}

function rootPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Emergent Interaction Lab</title>
  <meta name="description" content="Complex Systems · Interaction · Intelligence · Architecture">
  <link rel="canonical" href="${BASE}/">
  <link rel="alternate" hreflang="x-default" href="${BASE}/">
  <link rel="alternate" hreflang="en" href="${BASE}/en/">
  <link rel="alternate" hreflang="de" href="${BASE}/de/">
  <link rel="preconnect" href="https://rfi-irfos.github.io">
  <meta name="robots" content="index,follow">
  <script type="application/ld+json">${esc(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Emergent Interaction Lab",
    "url": BASE,
    "description": "Complex Systems · Interaction · Intelligence · Architecture"
  }))}</script>
</head>
<body>
  <main>
    <h1>Emergent Interaction Lab</h1>
    <p class="claim">Different systems. Same analytical core.</p>
    <nav><a href="${BASE}/en/">English</a> · <a href="${BASE}/de/">Deutsch</a></nav>
  </main>
</body>
</html>`;
}

function writeSitemap(snap) {
  const urls = [`${BASE}/`, `${BASE}/en/`, `${BASE}/de/`];
  const add = (loc, slug, typeLabel) => {
    if (!slug) return;
    urls.push(`${BASE}/${loc}/${typeLabel}/${slug}/`);
  };
  for (const loc of ["en", "de"]) {
    for (const [key, route] of [
      ["research_programs", "research"],
      ["case_studies", "evidence"],
      ["publications", "publications"],
      ["frameworks", "frameworks"],
      ["systems", "systems"],
      ["methods", "methods"],
      ["datasets", "datasets"],
      ["profiles", "laura"]
    ]) {
      for (const e of (snap[key] || [])) add(loc, e.slug, route);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join("\n")}
</urlset>`;
  fs.writeFileSync(path.join(OUT, "sitemap.xml"), xml);
}

function writeRobots() {
  const txt = `User-agent: *
Allow: /
Sitemap: ${BASE}/sitemap.xml
`;
  fs.writeFileSync(path.join(OUT, "robots.txt"), txt);
}

async function main() {
  const snap = await fetchSnapshot();
  writeHtml("index.html", rootPage());
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
      writeHtml(`en/${route}/${e.slug}/index.html`, entityPage(e, "en", route, snap));
      writeHtml(`de/${route}/${e.slug}/index.html`, entityPage(e, "de", route, snap));
    }
  }
  writeSitemap(snap);
  writeRobots();
  console.log(`STATIC BUILD OK — programs:${snap.research_programs?.length||0} cases:${snap.case_studies?.length||0} pubs:${snap.publications?.length||0} frameworks:${snap.frameworks?.length||0} systems:${snap.systems?.length||0} methods:${snap.methods?.length||0} datasets:${snap.datasets?.length||0} profiles:${snap.profiles?.length||0} | root + locale routes + sitemap + robots -> dist-static/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
