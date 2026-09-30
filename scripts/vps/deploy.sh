#!/usr/bin/env bash
# Deploy the current branch on the VPS (the "Deploy VPS" workflow runs this over SSH; it also works by hand):
# pull, rebuild the image, restart with the proxy chosen in .env (PROXY=tunnel | caddy), prune old images.
set -euo pipefail
DIR="${DIR:-/opt/music-together}"
BRANCH="${1:-${BRANCH:-dev}}"
cd "$DIR"
git fetch --prune origin "$BRANCH"
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
set -a; . ./.env; set +a
export GIT_COMMIT_SHA="$(git rev-parse HEAD)"
PROFILE="${PROXY:-tunnel}"
docker compose -f deploy/docker-compose.yml --env-file .env --profile "$PROFILE" up -d --build --remove-orphans
docker image prune -f >/dev/null
# wait for the app to answer
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT:-3000}/"; then echo "deployed $GIT_COMMIT_SHA"; exit 0; fi
  sleep 2
done
echo "the app did not answer on :${APP_PORT:-3000}" >&2
docker compose -f deploy/docker-compose.yml logs --tail=80 app >&2
exit 1
