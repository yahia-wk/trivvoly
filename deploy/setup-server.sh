#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for Trivvoly. Run it as root, once:
#
#   curl -fsSL https://raw.githubusercontent.com/yahia-wk/trivvoly/main/deploy/setup-server.sh | bash -s -- trivvoly.com you@example.com
#
# (your domain, then your email address: it becomes the admin, and Let's Encrypt writes to it if a
# certificate has trouble). Safe to run again. See docs/DEPLOY.md.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
DIR=/srv/trivvoly
REPO=https://github.com/yahia-wk/trivvoly.git

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || { echo "Usage: setup-server.sh <domain> <your email>"; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || echo "Warning: this script is written for Ubuntu; you have $PRETTY_NAME."
export DEBIAN_FRONTEND=noninteractive

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

say "Swap space (building the app needs a little more memory than small servers have)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Getting Trivvoly into $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR"
mkdir -p backups
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env  # secrets: readable by root only
  password=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 32)
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${password}|" .env
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
  sed -i "s|^ACME_EMAIL=.*|ACME_EMAIL=${EMAIL}|" .env
  sed -i "s|^ADMIN_EMAILS=.*|ADMIN_EMAILS=${EMAIL}|" .env
  sed -i "s|^CONTACT_EMAIL=.*|CONTACT_EMAIL=${EMAIL}|" .env
  echo "Wrote $DIR/.env (with a random database password)."
else
  echo "$DIR/.env already exists: left as it is."
fi

say "Done. Next:"
cat <<EOF
  1. Check the settings:     nano $DIR/.env
     (add the Google and Resend keys now, or later; then save with Ctrl+O, Enter, Ctrl+X)
  2. Start Trivvoly:         $DIR/deploy/deploy.sh
  3. Open https://$DOMAIN
EOF
