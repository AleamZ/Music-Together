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
docker compose -p "$PROJECT" -f deploy/docker-compose.yml --env-file .env --profile "${PROXY:-tunnel}" up -d --build --remove-orphans
docker image prune -f >/dev/null
for i in $(seq 1 45); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/"; then echo "deployed $BRANCH @ $GIT_COMMIT_SHA on :$APP_PORT"; exit 0; fi
  sleep 2
done
echo "$BRANCH did not answer on :$APP_PORT" >&2
docker compose -p "$PROJECT" -f deploy/docker-compose.yml logs --tail=80 app >&2
exit 1
