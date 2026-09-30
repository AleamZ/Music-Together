#!/usr/bin/env bash
# Deploy one environment (dev | main) on the VPS — the "Deploy VPS" workflow runs this over SSH for the branch pushed:
# pull that branch in /opt/music-together-<branch>, rebuild, restart its own stack (project music-together-<branch>),
# prune old images, wait for it to answer.
set -euo pipefail
BRANCH="${1:?usage: deploy.sh dev|main}"
DIR="${DIR:-/opt/music-together-$BRANCH}"
[ -d "$DIR/.git" ] || { echo "no checkout at $DIR (run setup.sh)" >&2; exit 1; }
cd "$DIR"
git fetch --prune origin "$BRANCH"
git checkout -q -B "$BRANCH" "origin/$BRANCH"
git reset -q --hard "origin/$BRANCH"
set -a; . ./.env; set +a
export GIT_COMMIT_SHA="$(git rev-parse HEAD)"
PROJECT="music-together-$BRANCH"
PROFILE="${PROXY:-tunnel}"
# no domain yet (no tunnel token): a temporary trycloudflare.com link instead
if [ "$PROFILE" = tunnel ] && [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then PROFILE=quick; fi
docker compose -p "$PROJECT" -f deploy/docker-compose.yml --env-file .env --profile "$PROFILE" up -d --build --remove-orphans
docker image prune -f >/dev/null
for i in $(seq 1 45); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/"; then
    echo "deployed $BRANCH @ $GIT_COMMIT_SHA on :$APP_PORT"
    if [ "$PROFILE" = quick ]; then
      for j in $(seq 1 20); do
        LINK=$(docker compose -p "$PROJECT" -f deploy/docker-compose.yml logs quicktunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)
        [ -n "$LINK" ] && break; sleep 2
      done
      echo "🌐 Link tạm ($BRANCH): ${LINK:-chưa lấy được, chạy: docker compose -p $PROJECT -f $DIR/deploy/docker-compose.yml logs quicktunnel}"
      echo "   (link đổi mỗi lần khởi động lại; gắn domain thật thì dán CLOUDFLARE_TUNNEL_TOKEN vào .env)"
    fi
    exit 0
  fi
  sleep 2
done
echo "$BRANCH did not answer on :$APP_PORT" >&2
docker compose -p "$PROJECT" -f deploy/docker-compose.yml logs --tail=80 app >&2
exit 1
