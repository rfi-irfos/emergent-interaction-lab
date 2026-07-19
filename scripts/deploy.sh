#!/usr/bin/env bash
# scripts/deploy.sh — runs `fly deploy` and then tells the app's own
# Observatory about it via POST /api/observatory/deploy-log, so
# Agent-Aktivität can show backend deploys alongside real GitHub PRs/commits/
# workflow runs instead of leaving them as the one invisible gap (see
# backend/src/github_activity.rs's doc comments on `deploy_log`/`log_deploy`).
#
# Why this script exists: `fly deploy` for this app is NOT run from CI —
# .github/workflows/deploy.yml only builds+deploys the GitHub Pages
# frontend, it never touches Fly. The backend is deployed manually, by
# whichever agent/session ships a backend change (see README.md's
# "Production Deploy" section). Before this script, nothing ever called
# `log_deploy`, so `deploy_log` stayed permanently empty. Run this instead of
# a bare `fly deploy` and that gap closes itself, going forward, automatically.
#
# Usage:
#   scripts/deploy.sh                 # fly deploy -a emergent-interaction-lab
#   scripts/deploy.sh --local-only     # skip the deploy-log POST entirely
#   FLY_APP=other-app scripts/deploy.sh
#
# Auth: the deploy-log POST needs the same shared secret the admin UI uses
# (x-chat-secret / CHAT_API_SECRET — see backend/src/authz.rs). If it's not
# set in the shell running this script, the deploy itself still happens; only
# the logging step is skipped (with a clear warning, not a silent no-op).
set -euo pipefail

SKIP_LOG=false
if [ "${1:-}" = "--local-only" ]; then
  SKIP_LOG=true
  shift
fi

APP="${FLY_APP:-emergent-interaction-lab}"
API_BASE="${DEPLOY_LOG_API_BASE:-https://${APP}.fly.dev}"

echo "==> fly deploy -a ${APP}"
fly deploy -a "${APP}" "$@"

if [ "${SKIP_LOG}" = true ]; then
  echo "==> --local-only set, skipping deploy-log POST."
  exit 0
fi

COMMIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [ -z "${CHAT_API_SECRET:-}" ]; then
  echo "==> CHAT_API_SECRET not set in this shell — skipping deploy-log POST." >&2
  echo "    The fly deploy above already succeeded; only the Agent-Aktivität log entry was skipped." >&2
  exit 0
fi

echo "==> logging deploy to ${API_BASE}/api/observatory/deploy-log (target=fly, version=${VERSION})"
# L1 (2026-07-19): pass the shared secret via a header FILE, not a `-H` inline
# arg — an inline `-H "x-chat-secret: ..."` puts the secret in the process
# argument list, visible to `ps`/audit logs on whatever runner executes this.
HDR_FILE="$(mktemp)"
trap 'rm -f "${HDR_FILE}"' EXIT
{
  printf 'Content-Type: application/json\n'
  printf 'x-chat-secret: %s\n' "${CHAT_API_SECRET}"
} > "${HDR_FILE}"
if curl -fsS -X POST "${API_BASE}/api/observatory/deploy-log" \
  -H @"${HDR_FILE}" \
  -d "{\"target\":\"fly\",\"version\":\"${VERSION}\",\"commit_sha\":\"${COMMIT_SHA}\"}"; then
  echo ""
  echo "==> deploy-log entry recorded."
else
  echo "==> WARNING: deploy-log POST failed (the fly deploy above already succeeded, this only affects the Agent-Aktivität log entry)." >&2
fi
