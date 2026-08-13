#!/usr/bin/env python3
"""Seed the live Fly EIL DB from frontend/snapshot.json via the CRUD API.

snapshot.json is the *public projection* of the EIL content — it is missing
the deeper NOT NULL columns the schema requires (reconstruction_en,
limitations_en, provenance_en, created_at, ...). This script enriches each
row with sensible defaults (status='Published', now() timestamps, empty text)
so the INSERTs succeed, then POSTs every entity to
/api/eil/entities/{table}/create with an admin session cookie.

Run after the backend is deployed and /auth/login works.
"""
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE = "https://emergent-interaction-lab.fly.dev"
PASSWORD = "emergent2026!"

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# Tables present in snapshot.json -> CRUD URL segment + required NOT NULL
# columns (without a DEFAULT in eil_schema.sql) that the projection lacks.
# We fill them with safe defaults so the INSERT passes.
TABLE_MAP = {
    "research_programs": {
        "url": "research_programs",
        "fill": {"status": "Published", "lifecycle": "Active", "program_type": "Core",
                  "created_at": NOW, "updated_at": NOW},
    },
    "publications": {
        "url": "publications",
        "fill": {"publication_type": "Article", "publication_status": "Published",
                  "created_at": NOW, "updated_at": NOW},
    },
    "case_studies": {
        "url": "case_studies",
        "fill": {"available_signals_en": "", "reconstruction_en": "",
                  "synthesis_or_system_model_en": "", "limitations_en": "",
                  "status": "Published", "created_at": NOW, "updated_at": NOW},
    },
    "methods": {
        "url": "methods",
        "fill": {"status": "Published", "lifecycle": "Active",
                  "created_at": NOW, "updated_at": NOW},
    },
    "frameworks": {
        "url": "frameworks",
        "fill": {"status": "Published", "lifecycle": "Active",
                  "created_at": NOW, "updated_at": NOW},
    },
    "systems": {
        "url": "systems",
        "fill": {"lifecycle": "Active", "status": "Published",
                  "created_at": NOW, "updated_at": NOW},
    },
    "datasets": {
        "url": "datasets",
        "fill": {"provenance_en": "", "status": "Published",
                  "created_at": NOW, "updated_at": NOW},
    },
    "profiles": {
        "url": "profiles",
        "fill": {"role": "Researcher", "status": "Published",
                  "created_at": NOW, "updated_at": NOW},
    },
}


def login():
    req = urllib.request.Request(
        f"{BASE}/auth/login",
        data=json.dumps({"password": PASSWORD}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req)
    cookie = resp.headers.get("Set-Cookie", "")
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith("rfi_session="):
            return part.split("=", 1)[1]
    raise RuntimeError("no session cookie in login response")


def seed(session):
    snap = json.load(open("frontend/snapshot.json", encoding="utf-8"))
    total = 0
    skipped = 0
    for key, cfg in TABLE_MAP.items():
        rows = snap.get(key, [])
        if not isinstance(rows, list):
            continue
        for row in rows:
            # enrich with required defaults
            for col, val in cfg["fill"].items():
                row.setdefault(col, val)
            url = f"{BASE}/api/eil/entities/{cfg['url']}/create"
            req = urllib.request.Request(
                url,
                data=json.dumps(row).encode(),
                headers={"Content-Type": "application/json",
                          "Cookie": f"rfi_session={session}"},
                method="POST",
            )
            try:
                urllib.request.urlopen(req)
                total += 1
                print(f"  + {key}/{row.get('id','?')}")
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")[:140]
                if e.code == 500 and "UNIQUE" in body.upper():
                    skipped += 1
                    print(f"  = {key}/{row.get('id','?')} exists (skip)")
                else:
                    print(f"  ! {key}/{row.get('id','?')} HTTP {e.code}: {body}")
    print(f"Seeded {total} entities, {skipped} already present.")


if __name__ == "__main__":
    print("Logging in...")
    s = login()
    print("Session OK, seeding...")
    seed(s)
