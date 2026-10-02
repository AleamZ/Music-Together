#!/usr/bin/env bash
# Apply the migrations from one number onward to an EXISTING database (the ones a branch added since the last deploy),
# in file order, each in its own transaction, stopping at the first error. Every migration is additive and re-runnable,
# so running one twice is safe.
#   DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     scripts/db/migrate-from.sh 0099            # 0099, 0100, … the last
#     scripts/db/migrate-from.sh 0099 0107       # 0099 … 0107 only
# Use the "Session pooler" or "Direct connection" string from Supabase → Connect (NOT the transaction pooler :6543).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to the project connection string}"
from="${1:?usage: migrate-from.sh <from> [to]}"
to="${2:-9999}"
command -v psql >/dev/null || { echo "psql is needed (apt-get install -y postgresql-client)"; exit 1; }
export PGCLIENTENCODING=UTF8
psql "$DATABASE_URL" -tAc "select to_regclass('public.accounts') is not null" | grep -q t \
  || { echo "This database has no game tables: use scripts/db/migrate-all.sh for a new project." >&2; exit 1; }

order=()
for f in supabase/migrations/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  if [ "$n" \> "$(printf '%04d' $((10#$from - 1)))" ] && [ ! "$n" \> "$to" ]; then order+=("$f"); fi
done
[ ${#order[@]} -gt 0 ] || { echo "no migration between $from and $to"; exit 1; }
echo "Applying ${#order[@]} migrations: $(basename "${order[0]}") … $(basename "${order[-1]}")"
i=0
for f in "${order[@]}"; do
  i=$((i + 1))
  printf '[%2d/%d] %s … ' "$i" "${#order[@]}" "$(basename "$f")"
  if out=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -1 -f "$f" 2>&1); then echo ok
  else echo FAILED; echo "$out" | grep -v '^NOTICE' | tail -20; exit 1; fi
done
echo "Done."
