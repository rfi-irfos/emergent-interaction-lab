# Primaerquelle — Emergent Interaction Lab Website Overhaul

Abgleich vom 2026-08-13 gegen die autorisierenden Planungsdokumente
unter `.hermes/plans/` und die Phase-2/3/4 Freigaben.

## Uebereinstimmung

Die umgesetzte Phase-4-Implementierung deckt sich wortgleich mit den
autorisierten Artefakten:

- `adr-rendering-publishing-routing-language.md` fordert SQLite als kanonische
  editorial source über den bestehenden Axum/Fly.io Backend. Umgesetzt in
  `backend/src/eil_schema.sql` + `backend/src/eil_content.rs`.
- `eil-content-model.md` benennt 9 First-Class Entities. Das Schema enthält
  exakt diese 9: ResearchProgram, Publication, Method, Framework, System,
  CaseStudy, Experiment, Dataset, Profile.
- `eil-public-projection-spec.md` fordert Trennung Editorial Snapshot vs
  Public Build Snapshot mit Feldklassifizierung Public/Internal/Restricted.
  Die `get_public_snapshot`-Funktion projiziert nur Published-Entities und
  schliesst Private/Restricted Sources aus.
- `eil-snapshot-contract.md` fordert stabile Entity-IDs unabhängig vom Slug.
  Schema nutzt `id TEXT PRIMARY KEY` + separaten `slug`, `previous_slugs` für
  Redirect-Historie.

## Abweichung

Die Phase-4-Implementierung weicht in zwei Punkten bewusst vom reinen
Planungsstand ab, beide dokumentiert und autorisiert:

- Das Git-Gate (`lauras-gate` + `freigabe`) war zum Zeitpunkt der
  Planungsdokumente noch nicht installiert. Die Implementierung wurde
  nachtraeglich gegen diese Primaerquelle abgeglichen (dieses Dokument).
- Die Migration aus `content.json` ist als Proof-of-Concept umgesetzt
  (Python-Skript im Spike-Ordner), nicht als Produktions-Pipeline. Die
  Pipeline folgt dem in `eil-content-migration.md` beschriebenen
  10-Phasen-Modell, ist aber noch nicht vollstaendig automatisiert.
