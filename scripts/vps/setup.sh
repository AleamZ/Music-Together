#!/usr/bin/env bash
# One-time setup of the VPS (deploy/README.md). Run as root on the server:
#   curl -fsSL https://raw.githubusercontent.com/AleamZ/Music-Together/dev/scripts/vps/setup.sh | bash
# Installs Docker + git, and for EACH environment (dev, main) clones its branch to /opt/music-together-<branch> with its
# own .env (own port, own domain / tunnel); adds a deploy user whose SSH key GitHub Actions uses; hardens SSH (keys
# only, once your own key is in). Safe to run again.
set -euo pipefail
REPO="${REPO:-https://github.com/AleamZ/Music-Together.git}"
ENVS="${ENVS:-dev main}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker

echo "==> deploy user ($DEPLOY_USER)"
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

for B in $ENVS; do
  DIR="/opt/music-together-$B"
  PORT=$([ "$B" = main ] && echo 3000 || echo 3001)
  echo "==> $B: $DIR (port $PORT)"
  if [ ! -d "$DIR/.git" ]; then git clone --branch "$B" "$REPO" "$DIR" || git clone "$REPO" "$DIR"; fi
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DIR"
  if [ ! -f "$DIR/.env" ]; then
    cat > "$DIR/.env" <<ENV
# $B environment (never committed). The NEXT_PUBLIC_* values are built into the page.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_MODE=$([ "$B" = main ] && echo prod || echo dev)
# the domain: a Cloudflare Tunnel token of THIS environment's tunnel (its public hostname → http://app:3000)
PROXY=tunnel
CLOUDFLARE_TUNNEL_TOKEN=
DOMAIN=
APP_PORT=$PORT
ENV
    chown "$DEPLOY_USER:$DEPLOY_USER" "$DIR/.env"
    chmod 600 "$DIR/.env"
  fi
done

echo "==> SSH: keys only once your own key is in"
if [ -s /root/.ssh/authorized_keys ] || [ "${FORCE_KEYS_ONLY:-0}" = "1" ]; then
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
else
  echo "   (skipped: add your own key to /root/.ssh/authorized_keys first, then run again)"
fi

cat <<MSG

Done. Next:
 1. Fill in /opt/music-together-dev/.env and /opt/music-together-main/.env (Supabase, each one's tunnel token).
 2. GitHub → Settings → Secrets and variables → Actions: VPS_HOST, VPS_PORT, VPS_USER=$DEPLOY_USER, VPS_SSH_KEY (below).
 3. Deploy by hand once:  su - $DEPLOY_USER -c "/opt/music-together-dev/scripts/vps/deploy.sh dev"
                          su - $DEPLOY_USER -c "/opt/music-together-main/scripts/vps/deploy.sh main"
    From then on a push to dev or main deploys that one.

----- VPS_SSH_KEY (private, keep secret) -----
$(cat "$KEY")
-----------------------------------------------
MSG
