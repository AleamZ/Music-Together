# SQL smokes

Every file here is a psql script of `ASSERT`s (`\set ON_ERROR_STOP on`: the first failure stops it). They run as the
superuser on a **throwaway** PostgreSQL 18 cluster — never on the installed service (port 5432) and never on hosted
Supabase. Run them from the repo root (they `\i supabase/migrations/…` and read fixtures with `pg_read_file`, so fixture
paths are absolute), with `PGCLIENTENCODING=UTF8`, with plain `psql -f` — never `psql -1` (some open their own
`begin; … rollback;`).

## The cluster

```powershell
$PG = "C:\Program Files\PostgreSQL\18\bin"; $D = "<scratch>\pg"; $env:PGCLIENTENCODING = "UTF8"
& "$PG\initdb.exe" -D $D -U postgres --auth=trust -E UTF8 --no-locale
Start-Process "$PG\pg_ctl.exe" -ArgumentList "-D `"$D`" -o `"-p 54364`" -l `"$D\server.log`" start" -WindowStyle Hidden
psql -p 54364 -U postgres -c "create schema extensions; create role anon nologin; create role authenticated nologin;
  create publication supabase_realtime; grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;"
```

The default privileges mirror Supabase (anon gets every new table and function unless a migration revokes it); without
them the privilege checks prove nothing. Afterwards: `pg_ctl -D $D stop -m fast`, then delete `$D`.

## The full chain

1. Apply every migration in file order, **except that `0014` runs before `0013`** (the production order).
2. `v20-rerun.sql` — the v20 migrations are re-runnable: it re-applies 0048 → 0052 twice and checks 0052's bodies. It
   must run before any smoke writes rows (0050's and 0051's ledger checks list fewer reasons than later rows use), and
   it puts 0052's `fight_push` & co. back, so **re-apply 0055 … newest right after it**.
3. The chain-level smokes (no `\i`), in any order:
   `fight-engine-smoke.sql` (`-v fixtures=…/fight-cases.json`),
   `v20-2-smoke.sql` (`-v kata=…/kata-cases.json -v bots=…/fight-bot-cases.json`),
   `v20-3-smoke.sql` (`-v cases=…/fight-cases.json`),
   `v20-4-smoke.sql` (`-v cases=…/fight-cases.json -v bosses=…/ug-boss-cases.json`),
   `reel-verify-smoke.sql` (`-v fixtures=…/reel-cases.json`), `salon-gender-smoke.sql`, `lyrics-lockdown-smoke.sql`,
   `anticheat-guards.sql`.
4. The anti-cheat v2 smokes, **in ascending order of their migrations**. Each re-applies its own migrations with `\i`
   (so it tests those bodies even when an earlier smoke left older ones), which puts an older body back over a later
   migration's — the next smoke in the order re-applies the later one, and the last leaves the newest chain:
   `anticheat-v2-net-smoke.sql` (0056; `-v fixtures=…/net-cases.json`), `anticheat-v2-position-smoke.sql` (0057),
   `anticheat-v2-tabs-smoke.sql` (0058), `anticheat-v2-reel-hook-smoke.sql` (0059; `-v fixtures=…/reel-cases.json`),
   `anticheat-v2-fight-smoke.sql` (0060; `-v secret=…/fight-secret-cases.json -v kata=…/kata-noise-cases.json`),
   `anticheat-v2-farm-smoke.sql` (0061–0063; `-v harvest=… -v crab=… -v sling=…`),
   `anticheat-v2-part3-smoke.sql` (0064–0067; `-v harvest=…/harvest-cases.json -v crab=…/crab-cases.json`), then
   `anticheat-guards.sql` again. Running one of them alone: re-apply its migration's successors afterwards.
5. The smokes that re-run one older migration and still pass on the full chain — `faint-ladder-smoke.sql` (0045),
   `fishing-hunger-smoke.sql` (0047), `v18-5-depots-smoke.sql` (0028): they put that migration's bodies back, so
   **re-apply 0056 … newest after each** (that restores everything they touch; step 4's last two smokes pass after
   them). `v18-3-smoke.sql` (0025), `v18-10-smoke.sql` (0033) and `v18-11-smoke.sql` (0032) pass too, but they also put
   back bodies that 0048–0055 re-created (0033's `_in_shade` over 0051's breaks `v20-3`), which only a fresh chain
   restores: run them last.

Every smoke above is re-runnable on the same cluster.

## The staged smokes

The version smokes `v14`, `v15`, `v15-2`, `v15-gather`, `v16`, `v17`, `v18-1`, `v18-2`, `v18-2b`, `v18-4`, `v18-5`,
`v18-6`, `v18-8`, `v18-9`, `v18-12`, `v19-1` … `v19-4` and `anticheat-smoke.sql` check their version right after its
migration: build the chain up to it, run the smoke, go on (for example `v14-smoke.sql` right after 0012: from 0013 on a
catch is priced by the room's index). On the full chain they fail by design: they re-apply an old migration whose
ledger reasons, shop kinds or function overloads predate later rows and migrations (`coin_ledger_reason_check`,
`shop_items_kind_check`, "finish_cast … is not unique"), or they test a client-trusted RPC a later migration replaced
(`v18-2`, `v18-2b`: the net before 0056). `v15-2`, `v15-gather`, `v16`, `v17` and `anticheat-smoke` end with
`\i tests/sql/anticheat-guards.sql`, which checks the newest chain's list; at their own stage the list is older.

- `v21-fishing-smoke.sql` (0076: boat + deep water, fishing battles, treasure maps, farm machines): chain-level, re-runs 0076 with `\i`; run after the full chain.
- `v21-pets-smoke.sql` (0074: pet gacha, care/levels/evolution, fighter training, PvE/PvP pet & fish battles, the aquarium, house knocks): chain-level, re-runs 0074 with `\i`; run after the full chain.
