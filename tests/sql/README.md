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

6. v21, after steps 1–5 on the same cluster: each group smoke re-applies its own migration with `\i` (putting that
   migration's bodies back over 0078's), so run them **in migration order** — `v21-progression-smoke.sql` (0070),
   `v21-quests-smoke.sql` (0071), `v21-crafting-smoke.sql` (0072; `-v mine=…/mine-cases.json`), `v21-economy-smoke.sql`
   (0073), `v21-pets-smoke.sql` (0074), `v21-world-smoke.sql` (0075), `v21-fishing-smoke.sql` (0076),
   `v21-professions-smoke.sql` (0077) — then **re-apply 0078, 0079 and 0081**, then `v21-fixes-smoke.sql` (0078, re-applies it itself;
   `-v fixtures=…/reel-cases.json`) and `anticheat-guards.sql` once more. The group smokes are listed below too.
7. 0079 (the chibi's boxes) re-creates 0048's `_fx_moves` / `_fx_contact` and 0049's `_fx_bot`: `v20-rerun.sql` puts the
   old bodies back, so the re-apply of 0055 … newest after it (step 2) must include 0079 — `fight-engine-smoke.sql`,
   `v20-2`, `v20-3`, `v20-4` and `anticheat-v2-fight-smoke.sql` replay fixtures generated with its numbers.
   0081 (the attack boxes' heights) re-creates `_fx_moves` once more, over 0079's: re-apply it after 0079 every time
   (0080 is news data only and needs no re-apply); the fight fixtures carry 0081's table.

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
- `v22-pets-smoke.sql` (0085: the replayed care minigames feed/pat/play, the battle's power press; `-v fixtures=…/pet-care-cases.json`): chain-level, re-runs 0085 with `\i` twice; run after `v21-pets-smoke.sql` (which puts 0074's pet_pat / pet_feed / pet_play / battle_act / _battle_turn / _battle_json back) — re-apply 0085 after any re-run of 0074.
- `v21-professions-smoke.sql` (0077: professions, skill trees, perks via the ledger, stamina, food buffs; needs 0072's `player_buffs` shape): chain-level, re-runs 0077 with `\i`; run after the full chain.
- `v21-quests-smoke.sql` (0071: daily/weekly/NPC/explore quests from game_events, the company quest, the login calendar, the photo album, the 2v2 tag team series): chain-level, re-runs 0071 with `\i`; run after the full chain.
- `v21-economy-smoke.sql` (0073: player trading, the Chợ người chơi board, the auction house, rented stalls, the collusion guard): chain-level, re-runs 0073 with `\i`; run after the full chain.
- `v21-crafting-smoke.sql` (0072: Mỏ đá mining with the replayed dig, herbs, ore selling, pickaxes, potions and buffs, item upgrades; `-v mine=…/mine-cases.json`): chain-level, re-runs 0072 with `\i`; run after the full chain.
- `v21-world-smoke.sql` (0075, v21 world: snow, wild animals, party, bosses, dungeon): re-runs 0075 twice, owns its rows (truncates them first); run after the chain 0004 … 0069 + 0075.
- `v21-fixes-smoke.sql` (0078: only finish_cast / finish_net emit 'fish_catch' and score a fishing battle; the locked map on ordinary travel; the leaderboard; the company quest's daily cap, arena membership, the photo log and the quest wipe; the dig's timing flag and the pickaxe at the finish; PvP pet XP caps and the knock; the fishing-battle wipe; boss room / dungeon party checks; stamina-short fights and the hammock; `-v fixtures=…/reel-cases.json`): chain-level, re-runs 0078 with `\i`; run after the v21 group smokes and a re-apply of 0078 (step 6).
- `v22-world-smoke.sql` (0083: the wild hunt / trap / photo minigames and the boss / dungeon combo strike, replayed from `-v cases=…/world-mg-cases.json`; wild_act / boss_attack / dungeon_attack refuse 'outdated'): chain-level, re-runs 0083 twice with `\i`; run after the full chain — and re-apply 0083 after `v21-world-smoke.sql` / `v21-fixes-smoke.sql` (they put 0075's / 0078's strike bodies back).
- `v22-crafting-smoke.sql` (0084: the cauldron's heat minigame + potion quality, the anvil's hammer timing ±10 pp, the processor's grain sort bonus; the old brew_potion / upgrade_item / process_collect refuse 'outdated'; `-v craft=…/craft-cases.json`): chain-level, re-runs 0084 with `\i`; run after the full chain — and re-apply 0084 after `v21-crafting-smoke` / `v21-fishing-smoke` / `v21-fixes-smoke` (they put 0072's / 0076's / 0078's old bodies back).
- `v22-explore-smoke.sql` (0086: Sông Cái — the map, the boat-only trip, the rowing replay from `-v rows=…/row-cases.json`, river casts; the treasure detector bands and the replayed shovel dig; start_boat_cast / board_boat / dig_treasure refuse 'outdated'): chain-level, re-runs 0086 twice with `\i`; run after the full chain — and re-apply 0086 after `v21-fishing-smoke.sql` (it puts 0076's boat / dig bodies back; that smoke also expects them, so run it before 0086).
