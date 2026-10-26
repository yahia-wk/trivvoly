#!/usr/bin/env bash
# Deploy one version of Trivvoly to one site on this server:
#
#   deploy.sh staging                  # the latest commit on main
#   deploy.sh production <commit>      # a particular commit on main (e.g. to roll back)
#   deploy.sh status                   # what's running where
#
# Normally GitHub runs this for you (through deploy/remote-deploy.sh); you can also run it by hand.
# The commit must be on main, and its release must have published an image
# (ghcr.io/yahia-wk/trivvoly:sha-<commit>). Running games carry on after the restart; phones
# reconnect by themselves.
set -euo pipefail

# This script is part of the checkout it updates: run from a copy, so changing it can't trip us up
if [[ -z "${TRIVVOLY_DEPLOY_COPY:-}" ]]; then
  copy=$(mktemp /tmp/trivvoly-deploy.XXXXXX)
  cp "$0" "$copy"
  TRIVVOLY_DEPLOY_COPY="$copy" exec bash "$copy" "$@"
fi
trap 'rm -f "$TRIVVOLY_DEPLOY_COPY"' EXIT

ROOT="${TRIVVOLY_ROOT:-/srv/trivvoly}"
cd "$ROOT"
site="${1:-}"
sha="${2:-}"

site_compose() { docker compose -p "trivvoly-$1" --env-file env/common.env --env-file "env/$1.env" -f docker-compose.yml -f docker-compose.prod.yml "${@:2}"; }
caddy_compose() { docker compose -p trivvoly-caddy --env-file env/caddy.env -f deploy/caddy.yml "$@"; }

if [[ "$site" == status ]]; then
  for s in production staging; do
    printf '\n%s: ' "$s"; tail -n 1 "deploys/$s.log" 2>/dev/null || echo "never deployed"
    TRIVVOLY_TAG=unused site_compose "$s" ps --format '  {{.Service}}: {{.Status}}' 2>/dev/null || true
  done
  printf '\ncaddy:\n'; caddy_compose ps --format '  {{.Service}}: {{.Status}}' 2>/dev/null || true
  exit 0
fi
[[ "$site" == staging || "$site" == production ]] || { echo "Usage: deploy.sh <staging|production> [commit] | status"; exit 1; }
for f in env/common.env "env/$site.env" env/caddy.env; do
  [[ -f "$f" ]] || { echo "Missing $ROOT/$f: run deploy/setup-server.sh first."; exit 1; }
done

# One deploy at a time
exec 9>/run/lock/trivvoly-deploy.lock
flock -w 900 9 || { echo "Another deploy is still running."; exit 1; }

echo "==> Which version"
git fetch --quiet origin main
sha="${sha:-$(git rev-parse origin/main)}"
sha=$(git rev-parse --verify --quiet "${sha}^{commit}") || { echo "Unknown commit: ${2:-}"; exit 1; }
# Only commits that made it into main (GitHub can serve other commits, e.g. from forks, by ID)
git merge-base --is-ancestor "$sha" origin/main || { echo "Refused: $sha isn't on main."; exit 1; }
echo "    $site → $sha"
previous=$(tail -n 1 "deploys/$site.log" 2>/dev/null | cut -d' ' -f1 || true)   # last version that worked here
checked_out=$(git rev-parse HEAD)
mkdir -p "backups/$site" deploys

# The image first: if it can't be had, nothing on the server has changed
echo "==> Getting its image"
image="ghcr.io/yahia-wk/trivvoly:sha-$sha"
docker image inspect "$image" >/dev/null 2>&1 || docker pull --quiet "$image" >/dev/null   || { echo "No image for $sha. Did its release finish? (Actions → Release)"; exit 1; }

# Start a version: its compose files and Caddyfile, then its containers
start() {
  git -c advice.detachedHead=false checkout --quiet --detach "$1"
  TRIVVOLY_TAG="sha-$1" site_compose "$site" up -d --remove-orphans
}
healthy() {
  for _ in $(seq 1 60); do
    TRIVVOLY_TAG=unused site_compose "$site" exec -T app python -c "import urllib.request; urllib.request.urlopen('http://localhost:3000/healthz')" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}

echo "==> Starting it"
if start "$sha" && healthy; then
  echo "$sha $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "deploys/$site.log"
else
  echo "The new version didn't start. Its last log lines:"
  TRIVVOLY_TAG=unused site_compose "$site" logs --tail 60 app || true
  # A broken version never stays live: put the last working one back
  if [[ -n "$previous" && "$previous" != "$sha" ]]; then
    echo "==> Putting back $previous"
    if start "$previous" && healthy; then echo "    $site is back on $previous."; else echo "    That didn't start either: look at the logs."; fi
  else
    git -c advice.detachedHead=false checkout --quiet --detach "$checked_out"
  fi
  exit 1
fi

echo "==> HTTPS (Caddy)"
caddy_version=$(cat deploy/Caddyfile deploy/caddy.yml env/caddy.env | sha256sum | cut -c1-16)
if [[ "$(cat deploys/caddy.version 2>/dev/null)" != "$caddy_version" ]]; then
  caddy_compose up -d --force-recreate   # its settings changed (a second's pause for open connections)
  echo "$caddy_version" > deploys/caddy.version
else
  caddy_compose up -d
fi

# Keep the last few images (for quick rollbacks), drop older ones; images in use are never removed
docker images ghcr.io/yahia-wk/trivvoly --format '{{.Repository}}:{{.Tag}}' | tail -n +6 | xargs -r docker rmi >/dev/null 2>&1 || true

domain=$(grep -E '^DOMAIN=' "env/$site.env" | cut -d= -f2)
echo "==> Done: https://$domain is running $sha"
