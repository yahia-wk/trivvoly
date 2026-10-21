#!/usr/bin/env bash
# Start Trivvoly, or update it to the latest version on GitHub. Run on the server:
#   /srv/trivvoly/deploy/deploy.sh
# Running games are saved, so they carry on after the restart (phones reconnect by themselves),
# but it's kindest to update when no game is on.
set -euo pipefail
cd "$(dirname "$0")/.."
compose() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }

grep -q '^DOMAIN=.\+' .env || { echo "Set DOMAIN in .env first (see docs/DEPLOY.md)."; exit 1; }

echo "==> Getting the latest version"
git pull --ff-only

echo "==> Building and starting (the first time takes a few minutes)"
compose up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "==> Waiting for Trivvoly to answer"
for _ in $(seq 1 60); do
  if compose exec -T app python -c "import urllib.request; urllib.request.urlopen('http://localhost:3000/healthz')" 2>/dev/null; then
    domain=$(grep '^DOMAIN=' .env | cut -d= -f2)
    echo "==> Trivvoly is running: https://${domain}  (version $(git rev-parse --short HEAD))"
    compose ps --format 'table {{.Service}}\t{{.Status}}'
    exit 0
  fi
  sleep 2
done
echo "Trivvoly didn't start. The last log lines:"
compose logs --tail 60 app
exit 1
