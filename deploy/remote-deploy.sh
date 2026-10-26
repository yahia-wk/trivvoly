#!/usr/bin/env bash
# The only thing GitHub's deploy keys can do on this server. setup-server.sh installs this as
# /usr/local/bin/trivvoly-remote-deploy and adds each key to root's authorized_keys as
#   restrict,command="/usr/local/bin/trivvoly-remote-deploy staging" ssh-ed25519 AAAA... github-deploy-staging
# so the staging key can only ask for "deploy staging <commit>", and the production key only for
# "deploy production <commit>". No shell, no port forwarding, nothing else.
set -euo pipefail

allowed="${1:-}"
request="${SSH_ORIGINAL_COMMAND:-}"
refuse() { logger -t trivvoly-deploy "refused ($allowed key): ${request:0:200}"; echo "Refused: $1" >&2; exit 1; }

[[ "$allowed" == staging || "$allowed" == production ]] || refuse "this key isn't set up for an environment"
[[ "$request" =~ ^deploy\ (staging|production)\ ([0-9a-f]{40})$ ]] || refuse "expected: deploy <staging|production> <40-character commit>"
[[ "${BASH_REMATCH[1]}" == "$allowed" ]] || refuse "this key can only deploy to $allowed"

sha="${BASH_REMATCH[2]}"
logger -t trivvoly-deploy "deploying $sha to $allowed"
exec /srv/trivvoly/deploy/deploy.sh "$allowed" "$sha"
