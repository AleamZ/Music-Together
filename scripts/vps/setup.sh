#!/usr/bin/env bash
# One-time setup of the VPS (deploy/README.md). Run as root on the server:
#   curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/setup.sh | bash
# Installs Docker + git, clones the repo to /opt/music-together, writes a .env to fill in, adds a deploy user whose SSH
# key GitHub Actions uses, and hardens SSH (keys only). Safe to run again.
set -euo pipefail
REPO="${REPO:-https://github.com/AleamZ/Music-Together.git}"
BRANCH="${BRANCH:-dev}"
DIR="${DIR:-/opt/music-together}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ufw
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker

echo "==> deploy user ($DEPLOY_USER): runs docker, owns $DIR"
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
KEY="/home/$DEPLOY_USER/.ssh/ci_deploy"
if [ ! -f "$KEY" ]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f "$KEY" >/dev/null
  cat "$KEY.pub" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

echo "==> repo at $DIR ($BRANCH)"
if [ ! -d "$DIR/.git" ]; then git clone --branch "$BRANCH" "$REPO" "$DIR"; fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DIR"
if [ ! -f "$DIR/.env" ]; then
  cat > "$DIR/.env" <<'ENV'
# Filled in once on the server (never committed). The NEXT_PUBLIC_* values are built into the page.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_MODE=prod
# The domain: EITHER a Cloudflare Tunnel token (profile tunnel, NAT VPS) OR the domain for Caddy (profile caddy, 80/443 open)
PROXY=tunnel
CLOUDFLARE_TUNNEL_TOKEN=
DOMAIN=
APP_PORT=3000
ENV
  chown "$DEPLOY_USER:$DEPLOY_USER" "$DIR/.env"
  chmod 600 "$DIR/.env"
fi

echo "==> SSH: keys only (log in with the deploy key or your own key from now on)"
if [ -s /root/.ssh/authorized_keys ] || [ "${FORCE_KEYS_ONLY:-0}" = "1" ]; then
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
else
  echo "   (skipped: add your own key to /root/.ssh/authorized_keys first, then run again to turn passwords off)"
fi

cat <<MSG

Done. Next:
 1. Fill in $DIR/.env (Supabase URL + publishable key, and the tunnel token or the domain).
 2. In GitHub → Settings → Secrets and variables → Actions, add:
      VPS_HOST = this server's SSH host      VPS_PORT = its SSH port      VPS_USER = $DEPLOY_USER
      VPS_SSH_KEY = the private key below (all of it)
 3. Push to $BRANCH (or run the "Deploy VPS" workflow) — it builds and starts the site.

----- VPS_SSH_KEY (private, keep secret) -----
$(cat "$KEY")
-----------------------------------------------
MSG
