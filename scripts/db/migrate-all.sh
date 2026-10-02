#!/usr/bin/env bash
# Build a NEW, empty Supabase database from scratch: every migration in supabase/migrations, in the production order
# (file order, except 0014 before 0013), each in its own transaction, stopping at the first error.
#   DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     scripts/db/migrate-all.sh
# Use the "Session pooler" or "Direct connection" string from Supabase → Connect (NOT the transaction pooler :6543).
# Never on a database that already has data: 0004 drops and rebuilds the schema.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to the new project connection string}"
command -v psql >/dev/null || { echo "psql is needed (apt-get install -y postgresql-client)"; exit 1; }
export PGCLIENTENCODING=UTF8

files=()
for f in supabase/migrations/*.sql; do files+=("$f"); done
# the production order: 0014 runs before 0013
order=()
for f in "${files[@]}"; do
  case "$(basename "$f")" in
    0013_*) held="$f" ;;
    0014_*) order+=("$f"); [ -n "${held:-}" ] && order+=("$held") && held="" ;;
    *) order+=("$f") ;;
  esac
done

if [ "${FORCE:-0}" != 1 ] && psql "$DATABASE_URL" -tAc "select to_regclass('public.accounts') is not null" | grep -q t; then
  echo "This database already has the game's tables (public.accounts). Refusing: use it only on a NEW project (FORCE=1 overrides)." >&2
  exit 1
fi

n=0
for f in "${order[@]}"; do
  n=$((n + 1))
  printf '[%2d/%d] %s … ' "$n" "${#order[@]}" "$(basename "$f")"
  if out=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -1 -f "$f" 2>&1); then echo ok
  else echo FAILED; echo "$out" | grep -v '^NOTICE' | tail -20; exit 1; fi
done
echo "All ${#order[@]} migrations applied."

# the root (admin) account, when ROOT_PASSWORD is given (README "Bootstrap the root account"); passed as a psql
# variable, never written into a file
if [ -n "${ROOT_PASSWORD:-}" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -v pw="$ROOT_PASSWORD" <<'SQL'
\o /dev/null
select set_config('mt.root_pw', :'pw', false);
\o
do $$
declare v_id uuid;
begin
  insert into public.accounts (username, is_root) values ('root', true)
    on conflict (lower(username)) do update set is_root = true
    returning id into v_id;
  insert into public.account_secrets (account_id, password_hash)
    values (v_id, extensions.crypt(current_setting('mt.root_pw'), extensions.gen_salt('bf')))
    on conflict (account_id) do update set password_hash = excluded.password_hash;
end $$;
SQL
  echo "Root account 'root' ready."
fi
# the feature flags (both off after a fresh chain): WORLD=1 opens the unified 3D world, ROOMS=1 lets anyone create rooms
[ "${WORLD:-0}" = 1 ] && psql "$DATABASE_URL" -q -X -c "update public.app_flags set enabled = true where key = 'unified_world'" && echo "unified_world on"
[ "${ROOMS:-0}" = 1 ] && psql "$DATABASE_URL" -q -X -c "update public.app_flags set enabled = true where key = 'room_creation_open'" && echo "room_creation_open on"
exit 0
