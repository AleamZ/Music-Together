-- =========================================================
-- 0048_fight_engine.sql — v20.1 Võ đài: the fight engine's SQL mirror (spec docs/superpowers/specs/
-- 2026-09-28-v20-fight-design.md §v20.1 "Migration 0048"). ADDITIVE and re-runnable. Run after 0046 (it uses
-- _reel_imul for the hash; the bot mirror of 0049 uses _reel_rand). Private functions only: no tables, no RPC.
--   _fx_moves()                  the move and style table of lib/game/fight/moves.ts (MOVE_TABLE), one int[] literal;
--                                pinned by tests/unit/fight-sql-mirror.test.ts
--   _fx_new(params jsonb)        createMatch: the state (176 ints) from MatchParams (camelCase keys, as the client sends)
--   _fx_step(s, a, b, m)         step: one 1/60 s frame; a and b are the two 10-bit input masks, m = _fx_moves()
--   _fx_run(s, a[], b[], m)      steps over per-frame masks (a and b the same length); the streamed replay calls it with
--                                at most 300 frames (tests/sql/fight-engine-smoke.sql times one such chunk)
--   _fx_hash(s)                  FNV-1a u32 over the ints, 4 bytes each, little-endian (hash in engine.ts)
--   _fx_runs_decode(runs, max)   RLE runs [mask, count, …] → per-frame masks, null when malformed or over max
--   _fx_runs_error(runs, max)    why runs are malformed: shape / odd / mask / count / too_long / rate (null: fine)
-- lib/game/fight/engine.ts is the source of truth; every function below mirrors the TS function of the same name
-- statement for statement (TS index i is SQL index i + 1, for the state and for the move table). Integer math only:
-- int `/` truncates like Math.trunc, and every division is of non-negative numbers. tests/fixtures/fight-cases.json
-- (Vitest + the SQL smoke) pins the two. Like 0046's _reel_* helpers these are immutable, reference nothing but their
-- arguments and each other, and carry no SET clause (a SET clause stops the small SQL helpers from being inlined).
-- =========================================================

-- ---------- the table ----------
create or replace function public._fx_moves() returns integer[]
language sql immutable parallel safe
as $$ select '{
  1,0,0,0,5,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,38,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,46,0,28,44,0,128,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,38,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,48,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,35,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,70,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,6,10,0,40,1,16,10,34,0,14,30,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,9,6,0,80,1,21,13,40,0,14,34,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,110,1,0,0,28,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,8,0,0,0,
  5,1,1,1,10,4,18,90,1,20,14,40,0,20,50,0,0,0,0,0,12,1,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,5,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,38,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,46,0,28,44,0,128,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,38,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,48,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,35,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,70,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,6,10,0,40,1,16,10,34,0,14,30,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,9,6,0,80,1,21,13,50,0,14,34,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,110,1,0,0,28,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,8,0,0,0,
  5,1,1,1,10,4,16,90,1,20,14,40,0,20,50,0,0,0,0,48,12,1,0,0,0,0,0,0,0,0,0,0,
  5,2,2,2,13,5,18,100,1,20,14,40,0,20,50,0,128,0,0,24,12,1,150,0,0,0,0,0,0,0,0,0,
  5,3,3,1,5,6,24,110,1,20,14,36,0,20,80,0,129,1,7,0,12,1,200,0,0,0,0,0,0,0,0,0,
  6,4,1,2,16,3,28,160,1,20,14,90,0,0,0,0,137,0,0,0,30,0,250,40,90,0,0,0,0,0,0,0,
  5,5,5,4,8,12,30,60,5,20,14,50,0,20,50,0,129,1,8,0,2,1,1000,0,0,0,0,0,0,0,0,0,
  1,0,0,0,5,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,38,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,46,0,28,44,0,192,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,38,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,48,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,35,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,70,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,6,10,0,40,1,16,10,34,0,14,30,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,9,6,0,80,1,21,13,40,0,14,34,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,110,1,0,0,34,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,8,0,0,0,
  5,1,1,1,14,3,18,110,1,20,14,40,0,20,50,3,128,0,0,0,12,1,0,0,0,0,0,0,0,0,0,0,
  5,2,2,2,12,6,20,120,1,20,14,40,0,20,50,0,160,0,0,56,12,1,150,0,0,6,18,0,0,0,0,0,
  5,3,3,1,5,5,26,120,1,20,14,36,0,20,80,0,129,1,6,0,12,1,200,0,0,0,0,0,0,0,0,0,
  6,4,1,2,6,2,30,60,3,20,14,32,0,0,0,0,0,0,0,0,30,0,250,0,32,0,0,0,0,0,0,0,
  5,5,5,3,7,6,34,55,6,20,14,50,0,20,50,0,129,1,7,0,2,1,1000,0,0,0,0,0,0,0,0,0,
  1,0,0,0,5,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,38,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,46,0,28,44,0,128,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,38,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,48,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,35,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,70,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,6,10,0,40,1,16,10,34,0,14,30,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,9,6,0,80,1,21,13,40,0,14,34,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,110,1,0,0,28,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,8,0,0,0,
  5,1,1,1,11,4,17,100,1,20,14,40,0,20,50,0,128,0,0,64,12,1,0,0,0,0,0,0,0,0,0,0,
  5,2,2,2,12,4,20,110,1,20,14,40,0,20,50,0,129,0,0,0,12,1,150,0,0,0,0,0,0,0,0,0,
  5,3,3,1,4,6,25,110,1,20,14,36,0,20,80,0,129,1,6,0,12,1,200,0,0,0,0,0,0,0,0,0,
  5,4,4,1,18,3,20,140,1,20,26,40,0,20,50,0,192,0,0,0,12,2,250,0,0,6,17,0,0,0,0,0,
  5,5,5,3,6,3,40,350,1,20,14,44,0,20,50,0,129,1,6,0,12,1,1000,0,0,0,0,0,0,0,0,0,
  1,0,0,0,5,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,46,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,54,0,28,44,0,128,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,46,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,56,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,35,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,70,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,6,10,0,40,1,16,10,42,0,14,30,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,9,6,0,80,1,21,13,48,0,14,34,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,110,1,0,0,28,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,8,0,0,0,
  5,1,1,2,9,4,16,90,1,20,14,40,0,20,50,0,0,0,0,0,60,1,0,0,0,0,0,0,0,0,0,0,
  5,2,2,2,13,5,20,120,1,20,14,40,0,20,50,0,129,0,0,32,12,1,150,0,0,0,0,0,0,0,0,0,
  5,3,3,2,5,7,24,110,1,20,14,36,0,20,80,0,129,1,6,0,12,1,200,0,0,0,0,0,0,0,0,0,
  5,4,4,2,10,12,20,45,3,20,14,40,0,20,50,0,0,0,0,40,2,1,250,0,0,0,0,0,0,0,0,0,
  5,5,5,4,7,20,30,55,6,20,14,50,0,20,50,0,129,1,7,0,2,1,1000,0,0,0,0,0,0,0,0,0,
  1,0,0,0,5,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,38,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,46,0,28,44,0,128,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,38,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,48,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,42,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,84,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,42,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,84,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,110,1,0,0,28,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,8,0,0,0,
  5,1,1,1,9,4,16,100,1,20,14,40,0,20,50,0,128,0,0,56,12,1,0,0,0,0,0,0,0,0,0,0,
  8,2,2,1,1,0,20,0,1,0,0,0,0,0,0,0,16,0,0,0,0,0,150,0,0,1,14,10,0,0,0,0,
  5,3,3,1,4,5,26,120,1,20,14,36,0,20,80,0,129,1,5,0,12,1,200,0,0,0,0,0,0,0,0,0,
  5,4,4,1,8,14,18,50,3,20,14,40,0,20,50,0,0,0,0,0,2,1,250,0,0,0,0,0,0,0,0,0,
  5,5,5,3,10,4,36,380,1,20,14,44,0,20,50,0,193,0,0,0,12,1,1000,0,0,1,10,0,0,0,0,0,
  1,0,0,0,5,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,38,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,46,0,28,44,0,128,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,38,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,48,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,35,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,70,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,6,10,0,40,1,16,10,34,0,14,30,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,9,6,0,80,1,21,13,40,0,14,34,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,143,1,0,0,34,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,11,0,0,0,
  6,1,1,1,5,2,26,150,1,20,14,34,0,0,0,0,129,0,0,0,30,0,0,0,34,0,0,0,0,0,0,0,
  5,2,2,2,8,4,20,80,1,20,14,40,0,0,12,2,1,0,0,0,12,1,150,0,0,0,0,0,0,0,0,0,
  7,3,3,1,14,0,22,130,1,20,14,0,0,0,0,0,129,0,0,0,20,0,200,0,0,2,14,0,0,0,0,0,
  6,4,4,2,12,3,28,180,1,20,14,50,0,0,0,0,129,0,0,0,30,0,250,0,50,0,0,0,0,0,0,0,
  6,5,5,3,3,2,40,120,3,20,14,40,0,0,0,0,129,0,0,0,30,0,1000,0,40,0,0,0,0,0,0,0,
  1,0,0,0,4,3,8,30,1,14,10,34,0,40,50,1,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,9,4,16,70,1,20,14,40,0,38,50,1,130,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,6,3,10,40,1,15,11,38,0,20,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  1,0,0,0,11,4,19,80,1,22,15,46,0,28,44,0,128,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,4,3,7,25,1,13,9,32,0,22,32,0,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,8,4,18,65,1,20,14,30,0,30,58,0,134,0,0,0,10,0,0,0,0,4,10,0,0,0,0,0,
  2,0,0,0,5,3,9,30,1,13,10,38,0,0,10,2,2,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,10,3,24,70,1,0,14,48,0,0,10,2,129,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,5,8,0,35,1,16,10,30,0,30,44,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,8,6,0,70,1,20,13,36,0,24,44,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,6,10,0,40,1,16,10,34,0,14,30,3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,9,6,0,80,1,21,13,40,0,14,34,3,128,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,5,2,20,110,1,0,0,28,0,0,0,0,129,0,0,0,30,0,0,0,0,0,0,0,8,0,0,0,
  5,1,1,1,7,15,16,22,5,20,14,40,0,20,50,0,0,0,0,30,2,1,0,0,0,0,0,0,0,0,0,0,
  5,2,2,2,6,3,16,70,1,20,14,40,0,0,12,2,0,0,0,0,50,1,150,0,0,0,0,0,0,0,0,0,
  7,3,3,1,12,0,20,40,3,20,14,0,0,0,0,0,0,0,0,0,20,0,200,0,0,1,12,0,0,0,0,0,
  5,4,4,1,14,3,22,130,1,20,14,40,0,20,50,0,129,0,0,0,80,1,250,0,0,0,0,0,0,0,0,0,
  5,5,5,3,6,30,30,32,10,20,14,50,0,20,50,0,128,1,6,0,2,1,1000,0,0,0,0,0,0,0,0,0,
  100,100,100,100,100,-1,-1,0,0,0,0,0,0,0,0,0,
  100,100,105,110,100,-1,-1,0,0,0,0,0,0,0,0,0,
  110,95,95,95,100,-1,-1,0,0,0,0,0,0,0,0,0,
  105,100,100,100,100,0,1,1,0,0,0,0,0,0,0,0,
  100,95,105,105,100,-1,-1,0,0,0,0,0,0,0,0,0,
  108,100,110,85,110,-1,-1,0,0,0,0,0,0,0,0,0,
  95,110,90,90,100,-1,-1,0,0,0,0,0,0,0,0,0,
  95,105,100,95,115,0,0,2,0,0,0,0,0,0,0,0
}'::integer[] $$;

-- a field of move record `id`; a field of a style row (moves.ts mv / styleField)
create or replace function public._fx_mv(m integer[], id integer, f integer) returns integer
language sql immutable parallel safe
as $$ select m[id * 32 + f + 1] $$;

create or replace function public._fx_sf(m integer[], style integer, f integer) returns integer
language sql immutable parallel safe
as $$ select m[4608 + style * 16 + f + 1] $$;

-- dirOf: the numpad direction (1–9, 5 = neutral) of a mask relative to facing
create or replace function public._fx_dir(mask integer, face integer) returns integer
language sql immutable parallel safe
as $$
  select 5
    + case when (mask & 1) <> ((mask >> 1) & 1) then case when ((mask >> 1) & 1) = 1 then face else -face end else 0 end
    + 3 * case when ((mask >> 2) & 1) <> ((mask >> 3) & 1) then case when ((mask >> 2) & 1) = 1 then 1 else -1 end else 0 end
$$;

-- isAirborne (b = the fighter's 1-based base: 49 or 113)
create or replace function public._fx_air(s integer[], b integer) returns boolean
language sql immutable parallel safe
as $$ select s[b + 1] > 0 or s[b + 7] = 7 or s[b + 7] = 10 or s[b + 7] = 13 $$;

-- isCrouching
create or replace function public._fx_crouch(s integer[], b integer, m integer[]) returns boolean
language sql immutable parallel safe
as $$
  select s[b + 7] = 3 or s[b + 7] = 5
      or ((s[b + 7] = 11 or s[b + 7] = 12) and s[b + 12] = 2)
      or (s[b + 7] = 9 and coalesce(m[(s[b + 9] - 1) * 32 + 0 + 1] = 2, false))
$$;

-- isFree
create or replace function public._fx_free(s integer[], b integer, m integer[]) returns boolean
language sql immutable parallel safe
as $$
  select s[b + 7] <= 5
      or (s[b + 7] = 9 and coalesce(m[(s[b + 9] - 1) * 32 + 27 + 1] > 0
                                    and s[b + 8] >= m[(s[b + 9] - 1) * 32 + 27 + 1], false))
$$;

-- startupOf: the move's startup, +2 when it came from the shortcut
create or replace function public._fx_startup(s integer[], b integer, m integer[], id integer) returns integer
language sql immutable parallel safe
as $$ select m[id * 32 + 4 + 1] + 2 * s[b + 37] $$;

-- ---------- createMatch ----------
create or replace function public._fx_reset(s integer[], b integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare d integer;
begin
  s[b + 0] := case when b = 49 then 34816 else 63488 end;       -- START_X1 / START_X2 (136 / 248 px)
  s[b + 1] := 0;
  s[b + 2] := 0;
  s[b + 3] := 0;
  s[b + 4] := case when b = 49 then 1 else -1 end;
  s[b + 5] := s[b + 51];
  s[b + 7] := 0;
  s[b + 8] := 0;
  s[b + 9] := 0;
  s[b + 10] := 0;
  s[b + 11] := 0;
  s[b + 12] := 0;
  s[b + 13] := 0;
  s[b + 14] := 0;
  s[b + 15] := 0;
  s[b + 16] := 0;
  s[b + 17] := 0;
  s[b + 18] := 100;
  s[b + 20] := 0;
  s[b + 21] := -1000;
  for d in 0..8 loop s[b + 22 + d] := -1000; end loop;
  s[b + 31] := -1000;
  s[b + 32] := -1000;
  s[b + 33] := -1000;
  s[b + 34] := 5;
  s[b + 35] := 0;
  s[b + 37] := 0;
  s[b + 38] := -1000;
  s[b + 39] := -1000;
  s[b + 40] := 0;
  s[b + 41] := -1000;
  s[b + 42] := 0;
  s[b + 43] := 0;
  s[b + 44] := 0;
  s[b + 45] := 0;
  s[b + 46] := 0;
  return s;
end $$;

-- clamp(trunc(json number), lo, hi), with a default for a missing key
create or replace function public._fx_ji(f jsonb, k text, def integer, lo integer, hi integer) returns integer
language sql immutable parallel safe
as $$ select least(hi, greatest(lo, trunc(coalesce((f->>k)::numeric, def))::integer)) $$;

create or replace function public._fx_new(p_params jsonb) returns integer[]
language plpgsql immutable parallel safe
as $$
declare
  s integer[] := array_fill(0, array[176]);
  seed bigint;
  f jsonb;
  b integer;
  side integer;
begin
  seed := trunc(coalesce((p_params->>'seed')::numeric, 1))::bigint & 4294967295;      -- seed | 0
  if seed >= 2147483648 then seed := seed - 4294967296; end if;
  s[1 + 1] := 0;                                                                         -- G_PHASE intro
  s[2 + 1] := 90;
  s[3 + 1] := 1;
  s[4 + 1] := 5940;
  s[5 + 1] := seed::integer;
  s[8 + 1] := case when coalesce((p_params->>'rounds')::numeric, 3) = 1 then 1 else 2 end;
  s[9 + 1] := public._fx_ji(p_params, 'maxRounds', 5, 1, 5);
  s[10 + 1] := seed::integer;
  s[11 + 1] := 1;                                                                        -- ENGINE_VERSION
  for side in 0..1 loop
    b := 49 + side * 64;
    f := coalesce(p_params -> (case when side = 0 then 'p1' else 'p2' end), '{}'::jsonb);
    s[b + 48] := public._fx_ji(f, 'style', 0, 0, 7);
    s[b + 49] := public._fx_ji(f, 'rank', 0, 0, 4);
    s[b + 50] := public._fx_ji(f, 'movesMask', 1, 0, 31);
    s[b + 51] := (1000 * public._fx_ji(f, 'hpPct', 100, 1, 300)) / 100;
    s[b + 52] := public._fx_ji(f, 'atk', 100, 50, 200);
    s[b + 53] := public._fx_ji(f, 'def', 100, 50, 200);
    s[b + 54] := public._fx_ji(f, 'walk', 100, 50, 200);
    s[b + 55] := public._fx_ji(f, 'jump', 100, 50, 200);
    s[b + 56] := public._fx_ji(f, 'energy', 100, 50, 200);
    s[b + 57] := public._fx_ji(f, 'bot', 0, 0, 9);
    s[b + 6] := public._fx_ji(f, 'en0', 0, 0, 1000);
    s[b + 19] := 0;
    s := public._fx_reset(s, b);
  end loop;
  return s;
end $$;

-- ---------- predicates ----------
create or replace function public._fx_invuln(s integer[], b integer, f integer, is_throw boolean, m integer[]) returns boolean
language plpgsql immutable parallel safe
as $$
declare a integer := s[b + 7]; id integer; af integer; ib integer;
begin
  if a = 13 or a = 14 or a = 15 or a = 16 or a = 17 then return true; end if;
  if f <= s[b + 15] then return true; end if;
  if a = 9 then
    id := s[b + 9] - 1;
    af := s[b + 8];
    ib := m[id * 32 + 18 + 1];
    if ib > 0 and af >= m[id * 32 + 17 + 1] and af <= ib then return true; end if;
    if not is_throw and (m[id * 32 + 16 + 1] & 16) <> 0 and af >= m[id * 32 + 25 + 1] and af <= m[id * 32 + 26 + 1] then
      return true;
    end if;
  end if;
  return false;
end $$;

create or replace function public._fx_grabbable(s integer[], b integer) returns boolean
language sql immutable parallel safe
as $$
  select s[b + 1] = 0 and not (s[b + 7] = 11 or s[b + 7] = 12 or s[b + 7] = 13 or s[b + 7] = 14 or s[b + 7] = 15
                               or s[b + 7] = 16 or s[b + 7] = 17 or s[b + 7] = 7 or s[b + 7] = 10)
$$;

create or replace function public._fx_blocks(s integer[], o integer, height integer, air boolean) returns boolean
language plpgsql immutable parallel safe
as $$
declare a integer := s[o + 7]; mk integer; d integer; crouch boolean;
begin
  if not (a <= 5 or a = 12) or s[o + 1] <> 0 then return false; end if;
  mk := s[o + 19];
  d := public._fx_dir(mk, s[o + 4]);
  if not (d = 1 or d = 4 or d = 7) and (mk & 256) = 0 then return false; end if;
  crouch := d <= 3;
  if (height = 3 or air) and crouch then return false; end if;
  if height = 2 and not crouch then return false; end if;
  return true;
end $$;

create or replace function public._fx_motion(s integer[], b integer, mo integer, pf integer) returns boolean
language plpgsql immutable parallel safe
as $$
declare
  l1 integer := s[b + 22]; l2 integer := s[b + 23]; l3 integer := s[b + 24]; l4 integer := s[b + 25];
  l6 integer := s[b + 27]; p2 integer := s[b + 31]; p3 integer := s[b + 32]; p6 integer := s[b + 33]; t integer;
begin
  if mo = 1 then
    if not (l2 < l3 and l3 < l6 and l6 - l2 <= 12) then return false; end if;
    t := l6;
  elsif mo = 2 then
    if not (l2 < l1 and l1 < l4 and l4 - l2 <= 12) then return false; end if;
    t := l4;
  elsif mo = 3 then
    if not (l6 < l2 and l2 < l3 and l3 - l6 <= 14) then return false; end if;
    t := l3;
  elsif mo = 4 then
    if not (p2 < l2 and l2 - p2 <= 14) then return false; end if;
    t := l2;
  else
    if not (p2 < p3 and p3 < p6 and p6 < l2 and l2 < l3 and l3 < l6 and l6 - p2 <= 24) then return false; end if;
    t := l6;
  end if;
  return pf >= t and pf - t <= 6;
end $$;

create or replace function public._fx_btn(btn integer, bits integer) returns boolean
language sql immutable parallel safe
as $$
  select case btn when 1 then (bits & 48) <> 0 when 2 then (bits & 192) <> 0 when 3 then (bits & 32) <> 0
                  when 4 then (bits & 128) <> 0 else false end
$$;

-- specialOk: the special's record id if unlocked and affordable (with `extra` energy), else -1
create or replace function public._fx_special_ok(s integer[], b integer, slot integer, extra integer, m integer[]) returns integer
language sql immutable parallel safe
as $$
  select case
    when m[(s[b + 48] * 18 + 12 + slot) * 32 + 0 + 1] = 0 then -1
    when (s[b + 50] & (1 << (slot - 1))) = 0 then -1
    when s[b + 6] < m[(s[b + 48] * 18 + 12 + slot) * 32 + 22 + 1] + extra then -1
    else s[b + 48] * 18 + 12 + slot end
$$;

-- ---------- resolve / startMove ----------
create or replace function public._fx_resolve(s integer[], b integer, mask integer, cancel boolean, m integer[]) returns integer
language plpgsql immutable parallel safe
as $$
declare
  bits integer := s[b + 20]; pf integer := s[b + 21]; style integer := s[b + 48];
  d integer := public._fx_dir(mask, s[b + 4]);
  slot integer; mo integer; id integer; crouch boolean; cur integer; to_ integer;
begin
  if s[b + 7] = 7 then
    if (bits & 128) <> 0 then return 11 * 2; end if;
    if (bits & 32) <> 0 then return 9 * 2; end if;
    if (bits & 64) <> 0 then return 10 * 2; end if;
    if (bits & 16) <> 0 then return 8 * 2; end if;
    return -1;
  end if;
  if (bits & 512) <> 0 then
    slot := 1;
    if (mask & 256) <> 0 then slot := 5;
    elsif d <= 3 then slot := 3;
    elsif d = 4 or d = 7 then slot := 2;
    elsif d = 6 or d = 9 then slot := 4;
    end if;
    if public._fx_special_ok(s, b, slot, 100, m) >= 0 then return (12 + slot) * 2 + 1; end if;
  end if;
  foreach mo in array array[5, 3, 1, 2, 4] loop
    if not public._fx_motion(s, b, mo, pf) then continue; end if;
    for slot in 1..5 loop
      id := style * 18 + 12 + slot;
      if m[id * 32 + 2 + 1] <> mo or not public._fx_btn(m[id * 32 + 3 + 1], bits) then continue; end if;
      if public._fx_special_ok(s, b, slot, 0, m) >= 0 then return (12 + slot) * 2; end if;
    end loop;
  end loop;
  crouch := d <= 3;
  if cancel then
    cur := (s[b + 9] - 1) - style * 18;
    to_ := public._fx_sf(m, style, 6);
    if not crouch and to_ >= 0 and cur = public._fx_sf(m, style, 5) and s[b + 40] < public._fx_sf(m, style, 7) then
      if (to_ = 0 and (bits & 16) <> 0) or (to_ = 1 and (bits & 32) <> 0) then return to_ * 2; end if;
    end if;
    return -1;
  end if;
  if (bits & 80) <> 0 and s[b + 38] >= pf - 2 and s[b + 39] >= pf - 2 then return 12 * 2; end if;
  if (bits & 128) <> 0 then return (case when crouch then 7 else 3 end) * 2; end if;
  if (bits & 32) <> 0 then return (case when crouch then 5 else 1 end) * 2; end if;
  if (bits & 64) <> 0 then return (case when crouch then 6 else 2 end) * 2; end if;
  if (bits & 16) <> 0 then return (case when crouch then 4 else 0 end) * 2; end if;
  return -1;
end $$;

create or replace function public._fx_start(s integer[], b integer, code integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare
  idx integer := code >> 1; sc integer := code & 1; style integer := s[b + 48]; id integer; chained boolean;
begin
  id := style * 18 + idx;
  if m[id * 32 + 1 + 1] > 0 then s[b + 6] := s[b + 6] - (m[id * 32 + 22 + 1] + sc * 100); end if;
  chained := s[b + 7] = 9 and idx = public._fx_sf(m, style, 6)
         and (s[b + 9] - 1) - style * 18 = public._fx_sf(m, style, 5);
  s[b + 40] := case when chained then s[b + 40] + 1 else 0 end;
  s[b + 7] := case when m[id * 32 + 0 + 1] = 3 then 10 else 9 end;
  s[b + 8] := 1;
  s[b + 9] := id + 1;
  s[b + 10] := 0;
  s[b + 37] := sc;
  s[b + 16] := case when (m[id * 32 + 16 + 1] & 64) <> 0 then 1 else 0 end;
  s[b + 13] := 0;
  if s[b + 7] = 9 then s[b + 2] := 0; end if;
  s[b + 20] := 0;
  return s;
end $$;

-- ---------- advance ----------
create or replace function public._fx_advance(s integer[], b integer, o integer, f integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare a integer; af integer; id integer; since integer; lp integer; lk integer; dir integer; face integer; dmg integer;
        want integer; nx integer; rest integer;
begin
  s[b + 8] := s[b + 8] + 1;
  a := s[b + 7];
  af := s[b + 8];
  if a = 9 then
    id := s[b + 9] - 1;
    if af > public._fx_startup(s, b, m, id) + m[id * 32 + 5 + 1] + m[id * 32 + 6 + 1] then
      if s[b + 7] <> 0 then s[b + 7] := 0; s[b + 8] := 1; end if;
      s[b + 9] := 0; s[b + 37] := 0;
    end if;
  elsif a = 6 then
    if af > 4 then
      s[b + 7] := 7;
      s[b + 8] := 1;
      s[b + 3] := (1792 * s[b + 55]) / 100;
    end if;
  elsif a = 8 then
    if af > 3 then
      s[b + 7] := 0; s[b + 8] := 1; s[b + 9] := 0; s[b + 37] := 0;
    end if;
  elsif a = 11 or a = 12 or a = 17 then
    if s[b + 11] > 0 then s[b + 11] := s[b + 11] - 1;
    else s[b + 7] := 0; s[b + 8] := 1; s[b + 9] := 0; s[b + 37] := 0;
    end if;
  elsif a = 14 then
    if s[b + 14] > 0 then s[b + 14] := s[b + 14] - 1;
    else s[b + 7] := 0; s[b + 8] := 1; s[b + 9] := 0; s[b + 37] := 0;
    end if;
  elsif a = 15 then
    if af > m[(s[b + 9] - 1) * 32 + 28 + 1] + 16 then
      s[b + 7] := 0; s[b + 8] := 1; s[b + 9] := 0; s[b + 37] := 0;
    end if;
  elsif a = 16 then
    since := f - af + 1 - 2;
    lp := s[b + 38];
    lk := s[b + 39];
    if lp >= since and lk >= since and (lp - lk <= 2 and lk - lp <= 2) then
      dir := s[o + 4];
      s[o + 7] := 17;
      s[o + 8] := 1;
      s[o + 11] := 12;
      s[o + 9] := 0;
      s[b + 7] := 17;
      s[b + 8] := 1;
      s[b + 11] := 12;
      s[o + 0] := least(94208, greatest(4096, s[o + 0] - dir * 5120));
      s[b + 0] := least(94208, greatest(4096, s[b + 0] + dir * 5120));
      s[b + 41] := f;
      s[b + 42] := 3;
      s[b + 43] := s[o + 9];
      return s;
    end if;
    s[b + 35] := s[b + 35] - 1;
    if s[b + 35] <= 0 then
      id := s[o + 9] - 1;
      face := s[o + 4];
      s[b + 17] := s[b + 17] + 1;                                                        -- comboHit
      s[b + 18] := greatest(40, 100 - 10 * (s[b + 17] - 1));
      dmg := (((m[id * 32 + 7 + 1] * s[o + 52]) / s[b + 53]) * s[b + 18]) / 100;
      s[b + 5] := greatest(0, s[b + 5] - dmg);
      s[o + 6] := least(1000, s[o + 6] + (50 * s[o + 56]) / 100);                       -- gain
      s[b + 6] := least(1000, s[b + 6] + (30 * s[b + 56]) / 100);
      s[b + 7] := 14;
      s[b + 8] := 1;
      s[b + 14] := 56;
      want := s[b + 0] + face * m[id * 32 + 20 + 1] * 256;                               -- push
      nx := least(94208, greatest(4096, want));
      s[b + 0] := nx;
      rest := want - nx;
      if rest <> 0 then s[o + 0] := least(94208, greatest(4096, s[o + 0] - rest)); end if;
      s[b + 41] := f;                                                                    -- mark
      s[b + 42] := 4;
      s[b + 43] := id + 1;
      s[b + 44] := s[b + 0] / 256 - face * 6;
      s[b + 45] := 30;
    end if;
  end if;
  return s;
end $$;

-- ---------- act (the free fighter's turn) ----------
create or replace function public._fx_act(s integer[], b integer, o integer, mask integer, fight boolean, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare dx integer; dodging boolean; code integer; face integer; d integer; bl boolean; nxt integer; vx integer;
begin
  s[b + 17] := 0;
  if s[b + 1] = 0 then
    dx := s[o + 0] - s[b + 0];
    if dx > 0 then s[b + 4] := 1; elsif dx < 0 then s[b + 4] := -1; end if;
  end if;
  dodging := s[b + 7] = 9;
  if not fight then
    if not dodging then
      if s[b + 7] <> 0 then s[b + 7] := 0; s[b + 8] := 1; end if;
      s[b + 9] := 0; s[b + 37] := 0;
    end if;
    return s;
  end if;
  if s[b + 20] <> 0 then
    code := public._fx_resolve(s, b, mask, false, m);
    s[b + 20] := 0;
    if code >= 0 then return public._fx_start(s, b, code, m); end if;
  end if;
  face := s[b + 4];
  d := public._fx_dir(mask, face);
  bl := (mask & 256) <> 0;
  if d >= 7 then nxt := 6;
  elsif d <= 3 then nxt := case when bl or d = 1 then 5 else 3 end;
  elsif bl then nxt := 4;
  elsif d = 6 then nxt := 1;
  elsif d = 4 then nxt := 2;
  else nxt := 0;
  end if;
  if dodging and nxt = 0 then return s; end if;
  if nxt = 6 then
    vx := (384 * s[b + 55]) / 100;
    s[b + 2] := case when d = 9 then vx * face when d = 7 then -vx * face else 0 end;
    s[b + 7] := 6;
    s[b + 8] := 1;
    s[b + 9] := 0;
    s[b + 37] := 0;
    return s;
  end if;
  if s[b + 7] <> nxt then s[b + 7] := nxt; s[b + 8] := 1; end if;
  s[b + 9] := 0;
  s[b + 37] := 0;
  return s;
end $$;

-- canCancel + tryCancel
create or replace function public._fx_try_cancel(s integer[], b integer, mask integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare id integer; style integer; code integer;
begin
  if s[b + 20] = 0 or s[b + 7] <> 9 or s[b + 10] = 0 then return s; end if;
  id := s[b + 9] - 1;
  style := s[b + 48];
  if (m[id * 32 + 16 + 1] & 2) = 0 and id - style * 18 <> public._fx_sf(m, style, 5) then return s; end if;
  if s[b + 8] > public._fx_startup(s, b, m, id) + m[id * 32 + 5 + 1] then return s; end if;
  code := public._fx_resolve(s, b, mask, true, m);
  if code < 0 then return s; end if;
  return public._fx_start(s, b, code, m);
end $$;

-- ---------- physics ----------
create or replace function public._fx_physics(s integer[], b integer, f integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare a integer := s[b + 7]; face integer := s[b + 4]; id integer; tr integer; st integer; af integer; dx integer;
begin
  if a = 1 then
    s[b + 0] := least(94208, greatest(4096, s[b + 0] + face * ((320 * s[b + 54]) / 100)));
  elsif a = 2 then
    s[b + 0] := least(94208, greatest(4096, s[b + 0] - face * ((256 * s[b + 54]) / 100)));
  elsif a = 9 then
    id := s[b + 9] - 1;
    tr := m[id * 32 + 19 + 1];
    if tr > 0 then
      st := public._fx_startup(s, b, m, id);
      af := s[b + 8];
      if af <= st then
        dx := (tr * 256 * af) / st - (tr * 256 * (af - 1)) / st;
        s[b + 0] := least(94208, greatest(4096, s[b + 0] + face * dx));
      end if;
    end if;
  elsif a = 7 or a = 10 or a = 13 then
    s[b + 0] := least(94208, greatest(4096, s[b + 0] + s[b + 2]));
    s[b + 1] := s[b + 1] + s[b + 3];
    s[b + 3] := s[b + 3] - 90;
    if s[b + 1] <= 0 then
      s[b + 1] := 0;
      s[b + 3] := 0;
      s[b + 2] := 0;
      if a = 13 and s[b + 46] = 1 then
        s[b + 7] := 14;
        s[b + 8] := 1;
        s[b + 14] := case when s[b + 5] <= 0 then 999 else 56 end;
      else
        if a = 13 then s[b + 15] := f + 3; end if;
        s[b + 7] := 8;
        s[b + 8] := 1;
        s[b + 9] := 0;
        s[b + 37] := 0;
      end if;
      s[b + 46] := 0;
    end if;
  end if;
  return s;
end $$;

-- ---------- fighterFrame ----------
create or replace function public._fx_fighter(s integer[], side integer, mask integer, f integer, fight boolean, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare b integer := 49 + side * 64; o integer := 49 + (1 - side) * 64; dir integer; press integer; code integer; a integer;
begin
  if fight then
    dir := public._fx_dir(mask, s[b + 4]);
    if dir <> s[b + 34] then
      if dir = 2 then s[b + 31] := s[b + 23];
      elsif dir = 3 then s[b + 32] := s[b + 24];
      elsif dir = 6 then s[b + 33] := s[b + 27];
      end if;
      s[b + 22 + dir - 1] := f;
      s[b + 34] := dir;
    end if;
    press := (mask & (~ s[b + 19])) & 752;
    if press <> 0 then
      if (press & 16) <> 0 then s[b + 38] := f; end if;
      if (press & 64) <> 0 then s[b + 39] := f; end if;
      s[b + 20] := press;
      s[b + 21] := f;
    end if;
  end if;
  s[b + 19] := mask;
  if s[b + 20] <> 0 and f - s[b + 21] > 4 then s[b + 20] := 0; end if;
  if not fight then s[b + 20] := 0; end if;

  if s[b + 13] > 0 then
    s[b + 13] := s[b + 13] - 1;
    if fight then s := public._fx_try_cancel(s, b, mask, m); end if;
    return s;
  end if;
  s := public._fx_advance(s, b, o, f, m);
  a := s[b + 7];
  if public._fx_free(s, b, m) then
    s := public._fx_act(s, b, o, mask, fight, m);
  elsif fight and a = 7 and s[b + 20] <> 0 then
    code := public._fx_resolve(s, b, mask, false, m);
    s[b + 20] := 0;
    if code >= 0 then s := public._fx_start(s, b, code, m); end if;
  elsif fight and a = 9 then
    s := public._fx_try_cancel(s, b, mask, m);
  end if;
  return public._fx_physics(s, b, f, m);
end $$;

-- ---------- contact ----------
create or replace function public._fx_contact(s integer[], side integer, f integer, m integer[]) returns integer
language plpgsql immutable parallel safe
as $$
declare
  b integer := 49 + side * 64; o integer := 49 + (1 - side) * 64; a integer; id integer; kind integer; act integer;
  i integer; grabby boolean; hits_max integer; done integer; face integer; dx integer; ax integer; ay integer;
  lo integer; hi integer; ylo integer; yhi integer; hw integer; hh integer; hx0 integer; hx1 integer; hy0 integer;
  hy1 integer; air boolean; height integer; did integer; daf integer; dfl integer; in_win boolean;
begin
  if s[b + 13] > 0 then return 0; end if;
  a := s[b + 7];
  if a <> 9 and a <> 10 then return 0; end if;
  id := s[b + 9] - 1;
  kind := m[id * 32 + 0 + 1];
  if kind = 7 or kind = 8 then return 0; end if;
  act := m[id * 32 + 5 + 1];
  i := s[b + 8] - public._fx_startup(s, b, m, id) - 1;
  if i < 0 or i >= act then return 0; end if;
  grabby := kind = 4 or kind = 6;
  hits_max := case when grabby then 1 else m[id * 32 + 8 + 1] end;
  done := s[b + 10];
  if done >= hits_max or done * act >= (i + 1) * hits_max then return 0; end if;
  face := s[b + 4];
  if grabby then
    if not public._fx_grabbable(s, o) or public._fx_invuln(s, o, f, true, m) then return 0; end if;
    dx := (s[o + 0] - s[b + 0]) * face;
    if kind = 4 then
      return case when abs(dx) <= m[id * 32 + 11 + 1] * 256 then 5 else 0 end;
    end if;
    if dx < m[id * 32 + 23 + 1] * 256 or dx > m[id * 32 + 24 + 1] * 256 then return 0; end if;
    if (m[id * 32 + 16 + 1] & 8) <> 0 and public._fx_crouch(s, o, m) then return 0; end if;
    return 6;
  end if;
  if public._fx_invuln(s, o, f, false, m) then return 0; end if;
  ax := s[b + 0];
  ay := s[b + 1];
  lo := case when face > 0 then ax + m[id * 32 + 12 + 1] * 256 else ax - m[id * 32 + 11 + 1] * 256 end;
  hi := case when face > 0 then ax + m[id * 32 + 11 + 1] * 256 else ax - m[id * 32 + 12 + 1] * 256 end;
  ylo := ay + m[id * 32 + 13 + 1] * 256;
  yhi := ay + m[id * 32 + 14 + 1] * 256;
  if public._fx_air(s, o) then hw := 20; hh := 50;
  elsif public._fx_crouch(s, o, m) then hw := 24; hh := 38;
  else hw := 22; hh := 60;
  end if;
  hx0 := s[o + 0] - hw * 128;
  hx1 := s[o + 0] + hw * 128;
  hy0 := s[o + 1];
  hy1 := s[o + 1] + hh * 256;
  if not (lo < hx1 and hx0 < hi and ylo < hy1 and hy0 < yhi) then return 0; end if;
  air := kind = 3;
  height := m[id * 32 + 15 + 1];
  if s[o + 7] = 9 then
    did := s[o + 9] - 1;
    daf := s[o + 8];
    dfl := m[did * 32 + 16 + 1];
    in_win := daf >= m[did * 32 + 25 + 1] and daf <= m[did * 32 + 26 + 1];
    if air and (dfl & 4) <> 0 and in_win then return 0; end if;
    if height = 2 and (dfl & 32) <> 0 and in_win then return 0; end if;
    if m[did * 32 + 0 + 1] = 7 and in_win then return 3; end if;
    if (dfl & 64) <> 0 and in_win and s[o + 16] > 0 then return 4; end if;
  end if;
  if public._fx_blocks(s, o, height, air) then return 2; end if;
  return 1;
end $$;

-- ---------- react / apply ----------
create or replace function public._fx_react(s integer[], o integer, b integer, kd boolean, hitstun integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare face integer := s[b + 4]; air boolean; crouch boolean;
begin
  air := public._fx_air(s, o);
  crouch := public._fx_crouch(s, o, m);
  s[o + 9] := 0;
  s[o + 37] := 0;
  s[o + 16] := 0;
  s[o + 11] := 0;
  if air then
    s[o + 7] := 13;
    s[o + 8] := 1;
    s[o + 2] := face * 256;
    if s[o + 3] > 0 then s[o + 3] := 0; end if;
    s[o + 46] := case when kd then 1 else 0 end;
  elsif kd then
    s[o + 7] := 14;
    s[o + 8] := 1;
    s[o + 14] := 56;
  else
    s[o + 12] := case when crouch then 2 else 1 end;
    s[o + 7] := 11;
    s[o + 8] := 1;
    s[o + 11] := hitstun;
  end if;
  return s;
end $$;

-- push: the defender `pb` px away from the attacker; what a wall stops moves the attacker back
create or replace function public._fx_push(s integer[], o integer, b integer, face integer, pb integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare want integer; nx integer; rest integer;
begin
  want := s[o + 0] + face * pb * 256;
  nx := least(94208, greatest(4096, want));
  s[o + 0] := nx;
  rest := want - nx;
  if rest <> 0 then s[b + 0] := least(94208, greatest(4096, s[b + 0] - rest)); end if;
  return s;
end $$;

create or replace function public._fx_apply(s integer[], side integer, code integer, f integer, id integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare
  b integer := 49 + side * 64; o integer := 49 + (1 - side) * 64; face integer; ypx integer; heavy boolean;
  is_first boolean; is_last boolean; dmg integer; grounded boolean; chip integer; pid integer;
begin
  face := s[b + 4];
  ypx := s[b + 1] / 256 + (m[id * 32 + 13 + 1] + m[id * 32 + 14 + 1]) / 2;
  heavy := (m[id * 32 + 16 + 1] & 128) <> 0;
  if code = 1 then
    is_first := s[b + 10] = 0;
    s[b + 10] := s[b + 10] + 1;
    is_last := s[b + 10] >= m[id * 32 + 8 + 1];
    if is_first or s[o + 17] = 0 then
      s[o + 17] := s[o + 17] + 1;
      s[o + 18] := greatest(40, 100 - 10 * (s[o + 17] - 1));
    end if;
    dmg := (((m[id * 32 + 7 + 1] * s[b + 52]) / s[o + 53]) * s[o + 18]) / 100;
    s[o + 5] := greatest(0, s[o + 5] - dmg);
    s[b + 6] := least(1000, s[b + 6] + (50 * s[b + 56]) / 100);
    s[o + 6] := least(1000, s[o + 6] + (30 * s[o + 56]) / 100);
    s[b + 13] := 5;
    s[o + 13] := 5;
    grounded := not public._fx_air(s, o);
    s := public._fx_react(s, o, b, (m[id * 32 + 16 + 1] & 1) <> 0 and is_last, m[id * 32 + 9 + 1], m);
    if grounded then s := public._fx_push(s, o, b, face, m[id * 32 + 20 + 1]); end if;
    s[o + 41] := f;
    s[o + 42] := case when heavy then 2 else 1 end;
    s[o + 43] := id + 1;
    s[o + 44] := s[o + 0] / 256 - face * 6;
    s[o + 45] := ypx;
  elsif code = 2 then
    s[b + 10] := s[b + 10] + 1;
    if m[id * 32 + 1 + 1] > 0 then
      chip := (((m[id * 32 + 7 + 1] * s[b + 52]) / s[o + 53]) * m[id * 32 + 21 + 1]) / 8;
      if chip > 0 then s[o + 5] := greatest(1, s[o + 5] - chip); end if;
    end if;
    s[b + 6] := least(1000, s[b + 6] + (25 * s[b + 56]) / 100);
    s[o + 6] := least(1000, s[o + 6] + (10 * s[o + 56]) / 100);
    s[b + 13] := 3;
    s[o + 13] := 3;
    s[o + 12] := case when public._fx_dir(s[o + 19], s[o + 4]) <= 3 then 2 else 1 end;
    s[o + 7] := 12;
    s[o + 8] := 1;
    s[o + 11] := m[id * 32 + 10 + 1];
    s[o + 17] := 0;
    s := public._fx_push(s, o, b, face, m[id * 32 + 20 + 1]);
    s[o + 41] := f;
    s[o + 42] := 3;
    s[o + 43] := id + 1;
    s[o + 44] := s[o + 0] / 256 - face * 6;
    s[o + 45] := ypx;
  elsif code = 3 then
    pid := s[o + 9] - 1;
    s[b + 10] := m[id * 32 + 8 + 1];
    s[b + 17] := s[b + 17] + 1;
    s[b + 18] := greatest(40, 100 - 10 * (s[b + 17] - 1));
    dmg := (((m[pid * 32 + 7 + 1] * m[pid * 32 + 8 + 1] * s[o + 52]) / s[b + 53]) * s[b + 18]) / 100;
    s[b + 5] := greatest(0, s[b + 5] - dmg);
    s[o + 6] := least(1000, s[o + 6] + (50 * s[o + 56]) / 100);
    s[b + 6] := least(1000, s[b + 6] + (30 * s[b + 56]) / 100);
    s[b + 13] := 5;
    s[o + 13] := 5;
    s[o + 10] := 1;
    s[o + 8] := m[pid * 32 + 26 + 1];
    grounded := not public._fx_air(s, b);
    s := public._fx_react(s, b, o, (m[pid * 32 + 16 + 1] & 1) <> 0, 20, m);
    if grounded then s := public._fx_push(s, b, o, s[o + 4], m[pid * 32 + 20 + 1]); end if;
    s[b + 41] := f;
    s[b + 42] := 6;
    s[b + 43] := pid + 1;
    s[b + 44] := s[b + 0] / 256 - s[o + 4] * 6;
    s[b + 45] := 36;
  elsif code = 4 then
    s[b + 10] := s[b + 10] + 1;
    s[o + 16] := s[o + 16] - 1;
    dmg := (m[id * 32 + 7 + 1] * s[b + 52]) / s[o + 53];
    s[o + 5] := greatest(0, s[o + 5] - dmg);
    s[b + 6] := least(1000, s[b + 6] + (50 * s[b + 56]) / 100);
    s[o + 6] := least(1000, s[o + 6] + (30 * s[o + 56]) / 100);
    s[b + 13] := 5;
    s[o + 13] := 5;
    s[o + 41] := f;
    s[o + 42] := 5;
    s[o + 43] := id + 1;
    s[o + 44] := s[o + 0] / 256 - face * 6;
    s[o + 45] := ypx;
  elsif code = 5 then
    s[b + 10] := 1;
    s[b + 7] := 15;
    s[b + 8] := 1;
    s[o + 7] := 16;
    s[o + 8] := 1;
    s[o + 35] := m[id * 32 + 28 + 1];
    s[o + 9] := 0;
    s[o + 37] := 0;
    s[o + 11] := 0;
    s[o + 20] := 0;
  elsif code = 6 then
    s[b + 10] := 1;
    s[o + 17] := s[o + 17] + 1;
    s[o + 18] := greatest(40, 100 - 10 * (s[o + 17] - 1));
    dmg := (((m[id * 32 + 7 + 1] * m[id * 32 + 8 + 1] * s[b + 52]) / s[o + 53]) * s[o + 18]) / 100;
    s[o + 5] := greatest(0, s[o + 5] - dmg);
    s[b + 6] := least(1000, s[b + 6] + (50 * s[b + 56]) / 100);
    s[o + 6] := least(1000, s[o + 6] + (30 * s[o + 56]) / 100);
    s[b + 13] := 5;
    s[o + 13] := 5;
    s := public._fx_react(s, o, b, (m[id * 32 + 16 + 1] & 1) <> 0, 20, m);
    s := public._fx_push(s, o, b, face, m[id * 32 + 20 + 1]);
    s[o + 41] := f;
    s[o + 42] := 4;
    s[o + 43] := id + 1;
    s[o + 44] := s[o + 0] / 256 - face * 6;
    s[o + 45] := 30;
  end if;
  return s;
end $$;

-- ---------- step ----------
create or replace function public._fx_step(s integer[], a integer, b integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare
  ph integer := s[1 + 1]; f integer; ma integer := a & 1023; mb integer := b & 1023; fight boolean;
  x1 integer; x2 integer; dist integer; ovr integer; h1 integer; h2 integer; r0 integer; r1 integer;
  id0 integer; id1 integer; dir integer; k integer; hp1 integer; hp2 integer; reason integer; winner integer;
  p1 integer; p2 integer; r integer; w1 integer; w2 integer; fb integer;
begin
  if ph = 3 then return s; end if;
  s[0 + 1] := s[0 + 1] + 1;
  f := s[0 + 1];
  if ph = 0 then
    s[49 + 19] := ma;
    s[113 + 19] := mb;
    s[2 + 1] := s[2 + 1] - 1;
    if s[2 + 1] <= 0 then s[1 + 1] := 1; end if;
    return s;
  end if;
  fight := ph = 1;
  if fight then s[4 + 1] := s[4 + 1] - 1; end if;
  s := public._fx_fighter(s, 0, ma, f, fight, m);
  s := public._fx_fighter(s, 1, mb, f, fight, m);

  -- separate
  x1 := s[49 + 0];
  x2 := s[113 + 0];
  dist := abs(x2 - x1);
  if dist < 5120 then
    ovr := 5120 - dist;
    h1 := ovr / 2;
    h2 := ovr - h1;
    if x1 < x2 or (x1 = x2 and s[49 + 4] > 0) then
      x1 := x1 - h1;
      x2 := x2 + h2;
      if x1 < 4096 then x1 := 4096; x2 := 4096 + 5120; end if;
      if x2 > 94208 then x2 := 94208; x1 := 94208 - 5120; end if;
    else
      x1 := x1 + h1;
      x2 := x2 - h2;
      if x2 < 4096 then x2 := 4096; x1 := 4096 + 5120; end if;
      if x1 > 94208 then x1 := 94208; x2 := 94208 - 5120; end if;
    end if;
    s[49 + 0] := x1;
    s[113 + 0] := x2;
  end if;

  if fight then
    -- hits: both contacts from the same state; strikes beat throws, two throws tech each other
    r0 := public._fx_contact(s, 0, f, m);
    r1 := public._fx_contact(s, 1, f, m);
    if (r0 = 5 or r0 = 6) and r1 = 1 then r0 := 0; end if;
    if (r1 = 5 or r1 = 6) and r0 = 1 then r1 := 0; end if;
    if (r0 = 5 or r0 = 6) and (r1 = 5 or r1 = 6) then
      foreach fb in array array[49, 113] loop
        s[fb + 7] := 17;
        s[fb + 8] := 1;
        s[fb + 11] := 12;
        s[fb + 9] := 0;
        s[fb + 37] := 0;
      end loop;
      dir := case when s[49 + 0] <= s[113 + 0] then 1 else -1 end;
      s[49 + 0] := least(94208, greatest(4096, s[49 + 0] - dir * 5120));
      s[113 + 0] := least(94208, greatest(4096, s[113 + 0] + dir * 5120));
    else
      id0 := s[49 + 9] - 1;
      id1 := s[113 + 9] - 1;
      if r0 <> 0 then s := public._fx_apply(s, 0, r0, f, id0, m); end if;
      if r1 <> 0 then s := public._fx_apply(s, 1, r1, f, id1, m); end if;
    end if;

    -- roundCheck
    hp1 := s[49 + 5];
    hp2 := s[113 + 5];
    reason := 0;
    if hp1 <= 0 or hp2 <= 0 then
      reason := 1;
      winner := case when hp1 <= 0 and hp2 <= 0 then 0 when hp1 <= 0 then 2 else 1 end;
      foreach fb in array array[49, 113] loop
        if s[fb + 5] <= 0 then
          -- knockOut
          if public._fx_air(s, fb) then
            if s[fb + 7] <> 13 then
              s[fb + 7] := 13;
              s[fb + 8] := 1;
              if s[fb + 3] > 0 then s[fb + 3] := 0; end if;
            end if;
            s[fb + 46] := 1;
          else
            s[fb + 7] := 14;
            s[fb + 8] := 1;
            s[fb + 14] := 999;
          end if;
          s[fb + 9] := 0;
          s[fb + 37] := 0;
        end if;
      end loop;
    elsif s[4 + 1] <= 0 then
      reason := 2;
      p1 := (hp1 * 1000) / s[49 + 51];
      p2 := (hp2 * 1000) / s[113 + 51];
      winner := case when p1 > p2 then 1 when p2 > p1 then 2 else 0 end;
    end if;
    if reason > 0 then
      r := 12 + (s[3 + 1] - 1) * 4 + 1;
      s[r] := reason * 4 + winner;
      s[r + 1] := hp1;
      s[r + 2] := hp2;
      s[r + 3] := f;
      s[6 + 1] := reason * 4 + winner;
      if winner > 0 then s[49 + (winner - 1) * 64 + 36] := s[49 + (winner - 1) * 64 + 36] + 1; end if;
      s[1 + 1] := 2;
      s[2 + 1] := 150;
    end if;
  else
    s[2 + 1] := s[2 + 1] - 1;
    if s[2 + 1] <= 0 then
      -- endRound
      w1 := s[49 + 36];
      w2 := s[113 + 36];
      if w1 >= s[8 + 1] or w2 >= s[8 + 1] then
        s[1 + 1] := 3;
        s[7 + 1] := case when w1 >= s[8 + 1] then 1 else 2 end;
      elsif s[3 + 1] >= s[9 + 1] then
        s[1 + 1] := 3;
        s[7 + 1] := case when w1 > w2 then 1 when w2 > w1 then 2 else 3 end;
      else
        s[3 + 1] := s[3 + 1] + 1;
        s[1 + 1] := 0;
        s[2 + 1] := 90;
        s[4 + 1] := 5940;
        s := public._fx_reset(s, 49);
        s := public._fx_reset(s, 113);
      end if;
    end if;
  end if;
  return s;
end $$;

-- steps over per-frame masks (the streamed replay's chunk)
create or replace function public._fx_run(s integer[], a integer[], b integer[], m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare k integer; n integer := coalesce(cardinality(a), 0);
begin
  if n <> coalesce(cardinality(b), 0) then raise exception '_fx_run: logs of different lengths (% and %)', n, cardinality(b); end if;
  for k in 1..n loop
    s := public._fx_step(s, a[k], b[k], m);
  end loop;
  return s;
end $$;

-- FNV-1a (u32) over the ints, 4 bytes each, little-endian
create or replace function public._fx_hash(s integer[]) returns bigint
language plpgsql immutable parallel safe
as $$
declare h bigint := 2166136261; u bigint; v integer; k integer;
begin
  foreach v in array s loop
    u := v::bigint & 4294967295;
    for k in 0..3 loop
      h := h # ((u >> (8 * k)) & 255);
      h := public._reel_imul(h, 16777619);
    end loop;
  end loop;
  return h;
end $$;

-- ---------- logs (lib/game/fight/log.ts decodeRuns / runsError) ----------
create or replace function public._fx_runs_decode(p_runs integer[], p_max integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare out_ integer[] := '{}'; i integer; n integer; mk integer; c integer; total integer := 0;
begin
  if p_runs is null then return null; end if;
  n := coalesce(cardinality(p_runs), 0);
  if n = 0 then return out_; end if;
  if array_ndims(p_runs) <> 1 or array_lower(p_runs, 1) <> 1 then return null; end if;
  if n % 2 <> 0 then return null; end if;
  for i in 1..n by 2 loop
    mk := p_runs[i];
    c := p_runs[i + 1];
    if mk is null or c is null or mk < 0 or mk > 1023 or c < 1 then return null; end if;
    total := total + c;
    if total > p_max then return null; end if;
    out_ := out_ || array_fill(mk, array[c]);
  end loop;
  return out_;
end $$;

create or replace function public._fx_runs_error(p_runs integer[], p_max integer) returns text
language plpgsql immutable parallel safe
as $$
declare n integer; i integer; mk integer; c integer; total integer := 0; prev integer := -1; changes integer[] := '{}'; k integer;
begin
  if p_runs is null then return 'shape'; end if;
  n := coalesce(cardinality(p_runs), 0);
  if n = 0 then return null; end if;
  if array_ndims(p_runs) <> 1 or array_lower(p_runs, 1) <> 1 then return 'shape'; end if;
  if n % 2 <> 0 then return 'odd'; end if;
  for i in 1..n by 2 loop
    mk := p_runs[i];
    c := p_runs[i + 1];
    if mk is null or mk < 0 or mk > 1023 then return 'mask'; end if;
    if c is null or c < 1 then return 'count'; end if;
    if i > 1 and mk <> prev then changes := changes || total; end if;
    prev := mk;
    total := total + c;
    if total > p_max then return 'too_long'; end if;
  end loop;
  for k in 21..coalesce(cardinality(changes), 0) loop
    if changes[k] - changes[k - 20] < 60 then return 'rate'; end if;
  end loop;
  return null;
end $$;

-- ---------- private: no role may call any of them ----------
revoke all on function public._fx_moves() from public, anon, authenticated;
revoke all on function public._fx_mv(integer[], integer, integer) from public, anon, authenticated;
revoke all on function public._fx_sf(integer[], integer, integer) from public, anon, authenticated;
revoke all on function public._fx_dir(integer, integer) from public, anon, authenticated;
revoke all on function public._fx_air(integer[], integer) from public, anon, authenticated;
revoke all on function public._fx_crouch(integer[], integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_free(integer[], integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_startup(integer[], integer, integer[], integer) from public, anon, authenticated;
revoke all on function public._fx_reset(integer[], integer) from public, anon, authenticated;
revoke all on function public._fx_ji(jsonb, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._fx_new(jsonb) from public, anon, authenticated;
revoke all on function public._fx_invuln(integer[], integer, integer, boolean, integer[]) from public, anon, authenticated;
revoke all on function public._fx_grabbable(integer[], integer) from public, anon, authenticated;
revoke all on function public._fx_blocks(integer[], integer, integer, boolean) from public, anon, authenticated;
revoke all on function public._fx_motion(integer[], integer, integer, integer) from public, anon, authenticated;
revoke all on function public._fx_btn(integer, integer) from public, anon, authenticated;
revoke all on function public._fx_special_ok(integer[], integer, integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_resolve(integer[], integer, integer, boolean, integer[]) from public, anon, authenticated;
revoke all on function public._fx_start(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_advance(integer[], integer, integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_act(integer[], integer, integer, integer, boolean, integer[]) from public, anon, authenticated;
revoke all on function public._fx_try_cancel(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_physics(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_fighter(integer[], integer, integer, integer, boolean, integer[]) from public, anon, authenticated;
revoke all on function public._fx_contact(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_react(integer[], integer, integer, boolean, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_push(integer[], integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._fx_apply(integer[], integer, integer, integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_step(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_run(integer[], integer[], integer[], integer[]) from public, anon, authenticated;
revoke all on function public._fx_hash(integer[]) from public, anon, authenticated;
revoke all on function public._fx_runs_decode(integer[], integer) from public, anon, authenticated;
revoke all on function public._fx_runs_error(integer[], integer) from public, anon, authenticated;
