#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for Trivvoly (production and staging). Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/yahia-wk/trivvoly/main/deploy/setup-server.sh | bash -s -- trivvoly.com you@example.com
#
# Your domain, then your email address (it becomes the admin, the privacy contact, and gets Let's
# Encrypt's notices). Safe to run again: it keeps existing settings and keys. To replace GitHub's
# deploy keys (say one leaked), add --new-deploy-keys. See docs/DEPLOY.md.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
NEW_KEYS="${3:-}"
DIR=/srv/trivvoly
REPO=https://github.com/yahia-wk/trivvoly.git
CADDY_IMAGE=caddy:2.11.7-alpine

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || { echo "Usage: setup-server.sh <domain> <your email> [--new-deploy-keys]"; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[ "$ID" = ubuntu ] || echo "Warning: this script is written for Ubuntu; you have $PRETTY_NAME."
export DEBIAN_FRONTEND=noninteractive
random() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

say "Updating the system"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw fail2ban unattended-upgrades openssl

say "Turning on automatic security updates (with a restart at 05:00 when one needs it)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52trivvoly <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";
EOF

say "Installing Docker (from Docker's own repository)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

say "Firewall: only SSH, HTTP and HTTPS in"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

say "SSH: keys only, no passwords"
if [ -s /root/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/60-trivvoly.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  systemctl reload ssh || systemctl reload sshd || true
else
  echo "No SSH key found for root, so SSH settings were left alone. Add your key, then run this again."
fi
systemctl enable --now fail2ban  # blocks addresses that keep guessing at SSH

say "Swap space (some headroom for a small server)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Getting Trivvoly into $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch --quiet origin main; else git clone --quiet "$REPO" "$DIR"; fi
cd "$DIR"
git -c advice.detachedHead=false checkout --quiet --detach origin/main 2>/dev/null || true
mkdir -p env backups/production backups/staging deploys
chmod 700 env

say "Settings (in $DIR/env, readable by root only)"
staging_password=""
write() { # file, content: only if the file doesn't exist yet
  if [ -f "env/$1" ]; then echo "  env/$1 already exists: left as it is"; return; fi
  printf '%s\n' "$2" > "env/$1"; chmod 600 "env/$1"; echo "  wrote env/$1"
}
write common.env "# Settings both sites share. After changing them, redeploy (GitHub: Actions → Deploy).
ADMIN_EMAILS=$EMAIL
CONTACT_EMAIL=$EMAIL
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MAIL_FROM=
RESEND_API_KEY=
METRICS_TOKEN=
LOG_LEVEL=INFO"
write production.env "# The live site
DOMAIN=$DOMAIN
PORT=3000
POSTGRES_PASSWORD=$(random 32)
BACKUP_DIR=./backups/production"
write staging.env "# The staging site (Caddy expects it on port 3001)
DOMAIN=staging.$DOMAIN
PORT=3001
POSTGRES_PASSWORD=$(random 32)
BACKUP_DIR=./backups/staging"
if [ ! -f env/caddy.env ]; then
  staging_password=$(random 20)
  hash=$(docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$staging_password")
  write caddy.env "# HTTPS (Caddy). The staging password is stored only as this hash.
DOMAIN=$DOMAIN
STAGING_DOMAIN=staging.$DOMAIN
ACME_EMAIL=$EMAIL
STAGING_USER=trivvoly
STAGING_PASSWORD_HASH='$hash'"
fi

say "GitHub's deploy keys (each can only deploy its own site)"
install -m 755 deploy/remote-deploy.sh /usr/local/bin/trivvoly-remote-deploy
install -m 700 -d /root/.ssh
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
declare -A private_keys=()
for site in staging production; do
  if [ "$NEW_KEYS" = --new-deploy-keys ]; then
    sed -i "/ github-deploy-$site\$/d" /root/.ssh/authorized_keys
  elif grep -q " github-deploy-$site\$" /root/.ssh/authorized_keys; then
    echo "  $site: key already set up (add --new-deploy-keys to replace it)"; continue
  fi
  tmp=$(mktemp -d)
  ssh-keygen -q -t ed25519 -N "" -C "github-deploy-$site" -f "$tmp/key"
  echo "restrict,command=\"/usr/local/bin/trivvoly-remote-deploy $site\" $(cat "$tmp/key.pub")" >> /root/.ssh/authorized_keys
  private_keys[$site]=$(cat "$tmp/key")
  rm -rf "$tmp"   # the server never keeps the private half
  echo "  $site: new key"
done

say "Starting HTTPS (Caddy)"
docker compose -p trivvoly-caddy --env-file env/caddy.env -f deploy/caddy.yml up -d
cat deploy/Caddyfile deploy/caddy.yml env/caddy.env | sha256sum | cut -c1-16 > deploys/caddy.version

ip4=$(ip -4 route get 1.1.1.1 | grep -oP 'src \K[0-9.]+')
host_key=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)

say "Done. Now put these in GitHub (docs/DEPLOY.md, Part 6 says where)"
cat <<EOF

  Repository variables:
    DOMAIN               $DOMAIN
    DEPLOY_HOST          $ip4
    DEPLOY_KNOWN_HOSTS   $ip4 $host_key
EOF
for site in staging production; do
  if [ -n "${private_keys[$site]:-}" ]; then
    printf '\n  Secret DEPLOY_SSH_KEY for the "%s" environment (copy every line, from BEGIN to END):\n\n%s\n' "$site" "${private_keys[$site]}"
  fi
done
if [ -n "$staging_password" ]; then
  printf '\n  Staging site login (keep it in your password manager; it is not stored anywhere):\n    user: trivvoly   password: %s\n' "$staging_password"
fi
cat <<EOF

  These keys and the password are shown only now. When they're safely in GitHub and your
  password manager, type  clear  to wipe them from this screen.
EOF
