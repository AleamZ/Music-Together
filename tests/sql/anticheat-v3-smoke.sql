-- tests/sql/anticheat-v3-smoke.sql — 0108 (anti-cheat v3). Run as the superuser on the throwaway cluster after the full
-- chain, from the repo root, with the reel fixtures' absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/reel-cases.json -f tests/sql/anticheat-v3-smoke.sql
-- It re-runs 0108 twice with \i (re-runnable), sets the room_creation_open flag for its checks and puts it back, and
-- deletes its accounts at the end. Every check is an ASSERT.
--   1. A: an honest 7-argument finish lands the fish; a widened zone (won or lost) is lost, spent and flagged
--      client_tamper (hard); an incomplete claim falls back to the replay; the 6-argument form still answers.
--   2. B: the call budget — rate_high past the soft line (once a minute), rate_block at the block line, then 'rate limited'
--      until the minute is over; a new minute counts from 1.
--   3. C: market_list / auction_create hold the wallet lock before the reserved sum.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0108_anticheat_v3.sql
\i supabase/migrations/0108_anticheat_v3.sql
-- 0113 re-creates functions of this migration: re-run it after, as the chain does
\i supabase/migrations/0113_review_fixes.sql
\i supabase/migrations/0113_review_fixes.sql
-- 0115 re-creates finish_cast / buy_item / the rig per rod instance over it: re-apply it, as the chain does
\i supabase/migrations/0115_rod_builds.sql
reset client_min_messages;

create temp table av (k text primary key, v text);
insert into av select 'mode', mode from public.anticheat_config where id;
update public.anticheat_config set mode = 'enforce';
insert into av select 'flag_rooms', enabled::text from public.app_flags where key = 'room_creation_open';
update public.app_flags set enabled = true where key = 'room_creation_open';
create temp table rf as select pg_read_file(:'fixtures')::jsonb j;
do $$
declare n text; r text;
begin
  foreach n in array array['a', 'b'] loop
    r := 'av' || n || '_' || floor(random() * 1e9)::text;
    insert into av select 't' || n, token from public.register(r, 'pw123456');
    insert into av select n, public._auth_account((select v from av where k = 't' || n))::text;
  end loop;
end $$;
insert into av select 'room', room_id::text from public.create_room('ac v3', 'pw', (select v from av where k = 'ta'));
create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from av where k = key $$;
create or replace function pg_temp.u(key text) returns uuid language sql stable as $$ select v::uuid from av where k = key $$;
-- a hooked cast with the fixture's reel, a minute old
create or replace function pg_temp.cast(p uuid, room uuid, won jsonb) returns uuid language sql as $$
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, reel_seed, reel_params, hooked_at)
  values (p, room, 'ca_ro', 200, (won->'params'->>'minReelMs')::int, now() - interval '61 seconds', now() + interval '30 seconds',
          (won->'params'->>'seed')::bigint,
          jsonb_build_object('zone_pct', won->'params'->'zonePct', 'difficulty', won->'params'->'difficulty',
                             'min_reel_ms', won->'params'->'minReelMs'), now() - interval '60 seconds')
  returning id
$$;

-- ---------- 1. A: the client's word ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); cid uuid; r jsonb; tg integer[];
        won jsonb := (select x from rf, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'caught' limit 1);
        honest jsonb; ticks integer;
begin
  select array_agg(x::int order by o) into tg from jsonb_array_elements_text(won->'toggles') with ordinality q(x, o);
  tg := coalesce(tg, '{}');
  ticks := (won->'expected'->>'ticks')::int;
  honest := jsonb_build_object('zone_pct', won->'params'->'zonePct', 'difficulty', won->'params'->'difficulty',
                               'min_reel_ms', won->'params'->'minReelMs');
  assert public._reel_claim_diff(honest, honest) is null, 'same params: no diff';
  assert public._reel_claim_diff(honest, '{"zone_pct": 25}') is null, 'an incomplete claim is ignored';
  assert public._reel_claim_diff(honest, honest || '{"zone_pct": 100}') ? 'zone_pct', 'a widened zone differs';
  assert public._reel_claim_diff(honest, honest || '{"difficulty": "52"}') ? 'difficulty', 'a string is not a number';
  -- honest, 7 arguments
  cid := pg_temp.cast(a, room, won);
  insert into public.ac_rate (account_id, calls, win_at) values (a, 5, now())
    on conflict (account_id) do update set calls = 5, win_at = now();   -- 0113
  r := public.finish_cast(t, cid, true, false, tg, ticks, honest);
  assert r->>'result' = 'caught', format('honest 7-arg %s', r);
  assert (select calls from public.ac_rate where account_id = a) = 6, 'the 7-arg finish counts once (0113)';
  assert coalesce(current_setting('mt.ac_counted', true), '') = '', 'the skip is used up (0113)';
  perform public._ac_guard(a);
  assert (select calls from public.ac_rate where account_id = a) = 7, 'the next call counts again (0113)';
  -- the 6-argument form (a page before 0108)
  delete from public.fish where account_id = a;
  cid := pg_temp.cast(a, room, won);
  r := public.finish_cast(t, cid, true, false, tg, ticks);
  assert r->>'result' = 'caught', format('6-arg %s', r);
  -- a widened zone, lost: spent, flagged hard
  delete from public.fish where account_id = a;
  cid := pg_temp.cast(a, room, won);
  r := public.finish_cast(t, cid, false, false, tg, ticks, honest || '{"zone_pct": 100}');
  assert r->>'result' = 'lost' and r->>'why' = 'reel_invalid' and r->'anticheat'->>'code' = 'client_tamper'
     and (r->'anticheat'->>'strike')::int = 1, format('tamper lost %s', r);
  assert not exists (select 1 from public.casts where id = cid), 'the cast is spent';
  assert (select detail->'diff'->'zone_pct'->>'client' from public.anticheat_events
           where account_id = a and code = 'client_tamper' order by id desc limit 1) = '100', 'the evidence';
  -- locked now (strike 1): the next call raises
  begin
    perform public.finish_cast(t, gen_random_uuid(), false);
    assert false, 'locked';
  exception when insufficient_privilege then null;
  end;
  update public.anticheat_status set locked_until = null where account_id = a;
  -- a widened zone, won: no fish
  cid := pg_temp.cast(a, room, won);
  r := public.finish_cast(t, cid, true, false, tg, ticks, honest || '{"zone_pct": 90}');
  assert r->>'why' = 'reel_invalid' and not exists (select 1 from public.fish where account_id = a), format('tamper won %s', r);
  assert (select ban_state from public.anticheat_status where account_id = a) = 'pending_wipe', 'strike 2 bans';
  raise notice 'client word ok';
end $$;

-- ---------- 2. B: the budget ----------
update public.anticheat_config set rate_soft_per_min = 60, rate_block_per_min = 80;
do $$
declare b uuid := pg_temp.u('b'); n integer := 0; v_err text;
begin
  delete from public.ac_rate where account_id = b;
  for i in 1 .. 80 loop perform public._ac_guard(b); end loop;
  assert (select calls from public.ac_rate where account_id = b) = 80, 'counted';
  assert (select count(*) from public.anticheat_events where account_id = b and code = 'rate_high' and outcome = 'soft') = 1,
    'rate_high once a minute';
  assert (select count(*) from public.anticheat_events where account_id = b and code = 'rate_block') = 1, 'rate_block at the line';
  begin
    perform public._ac_guard(b);
    assert false, 'blocked';
  exception when sqlstate '53400' then get stacked diagnostics v_err = message_text;
  end;
  assert v_err = 'rate limited', v_err;
  assert (select calls from public.ac_rate where account_id = b) = 80, 'a refused call is not counted';
  update public.ac_rate set win_at = now() - interval '61 seconds' where account_id = b;
  perform public._ac_guard(b);
  assert (select calls from public.ac_rate where account_id = b) = 1, 'a new minute';
  assert (select provolatile from pg_proc where proname = '_ac_guard') = 'v', 'volatile';
  raise notice 'budget ok';
end $$;
update public.anticheat_config set rate_soft_per_min = 900, rate_block_per_min = 1200;

-- ---------- 3. C: one listing per asset ----------
do $$
begin
  assert (select position('_wallet_lock' in prosrc) < position('_econ_reserved' in prosrc) from pg_proc where proname = 'market_list'),
    'market_list locks first';
  assert (select position('_wallet_lock' in prosrc) between 1 and position('_econ_reserved' in prosrc) from pg_proc
           where proname = 'auction_create'), 'auction_create locks first';
  raise notice 'listing lock ok';
end $$;

update public.anticheat_config set mode = (select v from av where k = 'mode');
update public.app_flags set enabled = (select v::boolean from av where k = 'flag_rooms') where key = 'room_creation_open';
delete from public.rooms where id = pg_temp.u('room');
delete from public.accounts where id in (pg_temp.u('a'), pg_temp.u('b'));
do $$ begin raise notice 'anticheat v3 smoke ok'; end $$;
