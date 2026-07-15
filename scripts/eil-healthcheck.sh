#!/bin/bash
# Daily roundtrip check for the exact failure mode from the 2026-07-15
# incident: login silently not establishing a real backend session, and/or
# PUT /api/content silently failing — both looked fine in the browser for
# hours before anyone noticed. This exercises the full path for real
# (login -> read current content -> write it back unchanged -> confirm the
# round-trip) and pages ntfy on any failure. Writing the content back as-is
# is safe: update_content snapshots a .bak before every overwrite, so a
# daily no-op write just costs one rotated backup slot, never real content.
set -u

APP="https://emergent-interaction-lab.fly.dev"
NTFY_TOPIC="rfi-eil-healthcheck"
COOKIES="$(mktemp)"
trap 'rm -f "$COOKIES"' EXIT

alert() {
  curl -s -o /dev/null -X POST "https://ntfy.sh/${NTFY_TOPIC}" \
    -H "Title: EIL healthcheck FAILED" \
    -H "Priority: urgent" \
    -H "Tags: warning" \
    -d "$1"
}

login_status=$(curl -s -o /dev/null -w "%{http_code}" -c "$COOKIES" "${APP}/auth/google")
if [ "$login_status" != "303" ]; then
  alert "Login roundtrip failed: /auth/google returned ${login_status} (expected 303)."
  exit 1
fi

content=$(curl -s -b "$COOKIES" "${APP}/api/content?lang=en")
if [ -z "$content" ] || ! echo "$content" | python3 -c "import json,sys; json.load(sys.stdin)" >/dev/null 2>&1; then
  alert "GET /api/content returned invalid/empty JSON."
  exit 1
fi

put_status=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES" -X PUT "${APP}/api/content?lang=en" \
  -H "Content-Type: application/json" --data-raw "$content")
if [ "$put_status" != "200" ]; then
  alert "PUT /api/content roundtrip failed: HTTP ${put_status} (expected 200) — saves may be silently broken again."
  exit 1
fi

nav_count=$(echo "$content" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('nav',{}).get('links',[])))")
about_count=$(echo "$content" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for l in d.get('nav',{}).get('links',[]) if l.get('label')=='About'))")
if [ "$about_count" != "0" ]; then
  alert "Live nav has a bare 'About' link again (count=${about_count}, total links=${nav_count}) — same content regression as 2026-07-15."
  exit 1
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) EIL healthcheck OK (login+save roundtrip, nav clean)"
