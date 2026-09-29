-- tests/sql/v22-world-smoke.sql — 0083 (v22 "world": the wild animals' hunt / trap / photo minigames and the bosses' and
-- the dungeon's combo strike). Run as the superuser on the throwaway cluster after the full chain (0004 … 0083), from
-- the repo root, with the fixture's absolute path:
--   psql -v cases=<repo>/tests/fixtures/world-mg-cases.json -f tests/sql/v22-world-smoke.sql
-- It re-runs 0083 twice (re-runnable). Every check is an ASSERT; time passing is simulated by moving timestamps back.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0083_world_minigames.sql
\i supabase/migrations/0083_world_minigames.sql
reset client_min_messages;
create temp table wgx as select pg_read_file(:'cases')::jsonb j;

-- ---------- 1. The fixtures: the SQL sims = minigames.ts ----------
do $$
declare c jsonb; got jsonb; n integer := 0;
  ia constant text := 'select coalesce(array_agg(x::int order by o), ''{}'') from jsonb_array_elements_text($1) with ordinality t(x, o)';
  a integer[]; b integer[];
begin
  for c in select jsonb_array_elements(j->'wild') from wgx loop
    execute ia into a using c->'a';
    execute ia into b using c->'b';
    got := case c->>'game' when 'hunt' then public._wg_hunt((c->>'seed')::bigint, c->>'species', (c->>'danger')::boolean, a, b)
                           when 'trap' then public._wg_trap((c->>'seed')::bigint, c->>'species', a)
                           else public._wg_photo((c->>'seed')::bigint, c->>'species', a, b) end;
    assert got = c->'expected', format('%s: sql %s ts %s', c->>'name', got, c->'expected');
    assert public._wg_input_error(c->>'game', a, b, 900) is null, format('%s shape', c->>'name');
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(j->'combo') from wgx loop
    execute ia into a using c->'keys';
    execute ia into b using c->'dodges';
    got := public._wg_combo((c->>'seed')::bigint, a, b, (c->>'ticks')::int);
    assert got = c->'expected', format('%s: sql %s ts %s', c->>'name', got, c->'expected');
    assert public._wg_combo_error(a, b, (c->>'ticks')::int) is null, format('%s shape', c->>'name');
    n := n + 1;
  end loop;
  assert n >= 60, format('%s cases', n);
  assert public._wg_input_error('trap', array[5, 80], '{}', 100) = 'too_many', 'one pull';
  assert public._wg_input_error('hunt', array[5, 20], '{}', 100) = 'rate', 'reload';
  assert public._wg_combo_error(array[-1], '{}', 100) = 'range', 'negative key';
  assert public._wg_combo_error(array[404, 400], '{}', 200) = 'order', 'key order';
  assert public._wg_chance(70, 1000, true) = 90 and public._wg_chance(25, 0, true) = 5 and public._wg_chance(90, 999, false) = 0, 'chance';
  raise notice 'world minigame fixtures ok: % cases', n;
end $$;

-- ---------- 2. The RPCs ----------
create temp table wx (k text primary key, v text);
insert into wx select 't' || i, token from generate_series(1, 3) i,
  lateral public.register('wg' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into wx select 'a' || substr(k, 2), public._auth_account(v)::text from wx where k like 't%';
insert into wx select 'room', room_id::text from public.create_room('Minigame', 'pw', (select v from wx where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from wx where k = 'room')::uuid), 'pw', v)
  from wx where k in ('t2', 't3');
update public.anticheat_config set mode = 'log';
insert into public.wallets (account_id, coins) select v::uuid, 5000 from wx where k like 'a%'
  on conflict (account_id) do update set coins = 5000;
insert into public.vitals (account_id) select v::uuid from wx where k like 'a%' on conflict do nothing;

create or replace function pg_temp.t(p text) returns text language sql as $$ select v from wx where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql as $$ select v::uuid from wx where k = 'a' || p $$;
create or replace function pg_temp.room() returns uuid language sql as $$ select v::uuid from wx where k = 'room' $$;
create or replace function pg_temp.put(p text, p_map text, p_x integer, p_y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (pg_temp.a(p), p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
-- a fresh rabbit next to account p (born 10 s ago), returns its id; the account stands on it
create or replace function pg_temp.rabbit(p text) returns bigint language plpgsql as $$
declare sp public.wild_spawns; x double precision; y double precision;
begin
  insert into public.wild_spawns (map, species, hx, hy, seed, born_at, expires_at)
  values ('field', 'rabbit', 300, 60, 12345, now() - interval '10 seconds', now() + interval '5 minutes') returning * into sp;
  select q.x, q.y into x, y from public._wild_xy(300, 60, 12345, 40, 10) q;
  perform pg_temp.put(p, 'field', round(x)::int, round(y)::int);
  insert into wx values ('xy', round(x)::int || ',' || round(y)::int) on conflict (k) do update set v = excluded.v;
  return sp.id;
end $$;
create or replace function pg_temp.x() returns int language sql as $$ select split_part(v, ',', 1)::int from wx where k = 'xy' $$;
create or replace function pg_temp.y() returns int language sql as $$ select split_part(v, ',', 2)::int from wx where k = 'xy' $$;

-- the wild
do $$
declare sp bigint; j jsonb; r jsonb; e text; seed bigint; t integer; rep jsonb; ok integer := 0; n integer := 0; st0 numeric;
begin
  -- the instant action is gone
  sp := pg_temp.rabbit('1');
  e := pg_temp.err(format('select public.wild_act(%L, %s, %L, %L, %s, %s)', pg_temp.t('1'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y()));
  assert e = 'outdated', format('wild_act %s', e);
  -- a hunt: start (seed back), a leading shot replayed, paid within base ± 20
  loop
    n := n + 1;
    update public.wild_profile set last_at = null, kills = 0 where account_id = pg_temp.a('1');
    sp := pg_temp.rabbit('1');
    select value into st0 from public.player_stamina where account_id = pg_temp.a('1');
    j := public.wild_start(pg_temp.t('1'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y());
    seed := (j->'round'->>'seed')::bigint;
    assert j->'round'->>'species' = 'rabbit' and not (j->'round'->>'danger')::boolean, format('round %s', j);
    if n = 1 then
      assert (select value from public.player_stamina where account_id = pg_temp.a('1')) <= public._stamina_max(pg_temp.a('1')) - 0.9, 'stamina spent';
    end if;
    t := null;
    for k in 0 .. 800 loop
      rep := public._wg_hunt(seed, 'rabbit', false, array[k], '{}');
      if rep->>'outcome' = 'hit' then t := k; exit; end if;
    end loop;
    assert t is not null, 'a shot exists';
    update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('1');
    r := public.wild_finish(pg_temp.t('1'), array[t], '{}', (rep->>'ticks')::int);
    assert r->>'outcome' = 'hit' and (r->>'chance')::int = public._wg_chance(70, (rep->>'score')::int, true), format('hunt %s', r);
    if r->>'result' = 'ok' then ok := ok + 1; end if;
    exit when ok >= 1 or n > 20;
  end loop;
  assert ok >= 1, 'caught one';
  assert exists (select 1 from public.game_events where account_id = pg_temp.a('1') and kind = 'wild_hunt'), 'wild_hunt event';
  assert exists (select 1 from public.game_events where account_id = pg_temp.a('1') and kind = 'xp_grant' and meta->>'source' = 'wild'), 'xp';
  -- single use
  e := pg_temp.err(format('select public.wild_finish(%L, %L, %L, 100)', pg_temp.t('1'), '{}', '{}'));
  assert e = 'round not found', e;
  -- a mismatch (a later end than the replay) is refused and flagged
  update public.wild_profile set last_at = null where account_id = pg_temp.a('1');
  sp := pg_temp.rabbit('1');
  sp := pg_temp.rabbit('1');
  j := public.wild_start(pg_temp.t('1'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y());
  update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('1');
  r := public.wild_finish(pg_temp.t('1'), '{}', '{}', 900);
  assert r->>'result' = 'fail' and r->>'outcome' = 'gave_up', format('gave up %s', r);
  update public.wild_profile set last_at = null where account_id = pg_temp.a('1');
  sp := pg_temp.rabbit('1');
  j := public.wild_start(pg_temp.t('1'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y());
  seed := (j->'round'->>'seed')::bigint;
  for k in 0 .. 800 loop
    rep := public._wg_hunt(seed, 'rabbit', false, array[k], '{}');
    if rep->>'outcome' = 'hit' then t := k; exit; end if;
  end loop;
  update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('1');
  r := public.wild_finish(pg_temp.t('1'), array[t], '{}', (rep->>'ticks')::int + 5);
  assert r->>'result' = 'lost' and r->>'why' = 'refused', format('mismatch %s', r);
  assert exists (select 1 from public.anticheat_events where account_id = pg_temp.a('1') and code = 'wild_mismatch'), 'flag mismatch';
  -- too fast
  update public.wild_profile set last_at = null where account_id = pg_temp.a('1');
  sp := pg_temp.rabbit('1');
  j := public.wild_start(pg_temp.t('1'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y());
  r := public.wild_finish(pg_temp.t('1'), '{}', '{}', 600);
  assert r->>'why' = 'refused', format('too fast %s', r);
  assert exists (select 1 from public.anticheat_events where account_id = pg_temp.a('1') and code = 'wild_too_fast'), 'flag too fast';
  -- bad input
  update public.wild_profile set last_at = null where account_id = pg_temp.a('1');
  sp := pg_temp.rabbit('1');
  j := public.wild_start(pg_temp.t('1'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y());
  r := public.wild_finish(pg_temp.t('1'), array[10, 20], '{}', 100);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = pg_temp.a('1') and code = 'wild_bad_input'), 'bad input';
  -- the cooldown still holds at the start
  sp := pg_temp.rabbit('1');
  e := pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, %s, %s)', pg_temp.t('1'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y()));
  assert e = 'cooldown', e;
  -- a trap: an exact pull on the trail
  sp := pg_temp.rabbit('2');
  j := public.wild_start(pg_temp.t('2'), sp, 'trap', 'field', pg_temp.x(), pg_temp.y());
  seed := (j->'round'->>'seed')::bigint;
  t := null;
  for k in 0 .. 899 loop
    rep := public._wg_trap(seed, 'rabbit', array[k]);
    if rep->>'outcome' = 'caught' then t := k; exit; end if;
  end loop;
  update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('2');
  r := public.wild_finish(pg_temp.t('2'), array[t], '{}', t + 1);
  assert r->>'outcome' = 'caught' and r->>'result' in ('ok', 'fail'), format('trap %s', r);
  sp := pg_temp.rabbit('2');
  e := pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, %s, %s)', pg_temp.t('2'), sp, 'trap', 'field', pg_temp.x(), pg_temp.y()));
  assert e = 'cooldown', format('trap cooldown %s', e);
  -- a photo: three snaps, the best kept from 250, once per animal
  sp := pg_temp.rabbit('3');
  j := public.wild_start(pg_temp.t('3'), sp, 'photo', 'field', pg_temp.x(), pg_temp.y());
  seed := (j->'round'->>'seed')::bigint;
  update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('3');
  -- the best snap tick from the sim
  select k into t from generate_series(0, 899) k order by (public._wg_photo(seed, 'rabbit', array[k], '{}')->>'score')::int desc, k limit 1;
  rep := public._wg_photo(seed, 'rabbit', array[t], '{}');
  r := public.wild_finish(pg_temp.t('3'), array[t], '{}', t + 1);
  assert (r->>'score')::int = (rep->>'score')::int and (r->>'saved')::boolean = ((rep->>'score')::int >= 250), format('photo %s', r);
  if (r->>'saved')::boolean then
    assert (r->'wild'->'album'->>'rabbit')::int >= 1, 'album';
    update public.wild_profile set last_at = null where account_id = pg_temp.a('3');
    e := pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, %s, %s)', pg_temp.t('3'), sp, 'photo', 'field', pg_temp.x(), pg_temp.y()));
    assert e = 'already photographed', e;
  end if;
  -- an abandoned dangerous hunt is a charge taken (the next start settles it)
  update public.vitals set hunger = 80, thirst = 80, fainted_until = null where account_id = pg_temp.a('3');
  update public.world_mg set open = true, kind = 'hunt', danger = true, species = 'wolf' where account_id = pg_temp.a('3');
  update public.wild_profile set last_at = null where account_id = pg_temp.a('3');
  sp := pg_temp.rabbit('3');
  perform pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, %s, %s)', pg_temp.t('3'), sp, 'hunt', 'field', pg_temp.x(), pg_temp.y()));
  assert (select hunger from public.vitals where account_id = pg_temp.a('3')) <= 72.01, 'charged on abandon';
  raise notice 'wild minigames ok';
end $$;

-- the combo strike: boss and dungeon
create or replace function pg_temp.perfect(p_seed bigint) returns integer[] language plpgsql as $$
declare u bigint[] := public._wg_draws(p_seed, 13); b integer; o integer[] := '{}';
begin
  b := 90 + (u[1] % 31)::int;
  for j in 0 .. 5 loop
    if j > 0 then b := b + 54 + (u[2 * j + 1] % 19)::int; end if;
    o := o || (b * 4 + (u[2 * j + 2] % 4)::int);
  end loop;
  return o;
end $$;
do $$
declare f bigint; j jsonb; r jsonb; e text; seed bigint; keys integer[]; rep jsonb; hp0 integer; run bigint; p bigint; u text;
begin
  e := pg_temp.err(format('select public.boss_attack(%L, 1, %L, 400, 200)', pg_temp.t('1'), 'bai_dat'));
  assert e = 'outdated', format('boss_attack %s', e);
  insert into public.boss_fights (boss, slot, announce_at, starts_at, ends_at, hp, max_hp)
  values ('trau_tinh', now() - interval '3 days', now() - interval '1 minute', now() - interval '1 minute', now() + interval '20 minutes', 10000, 10000)
  returning id into f;
  perform pg_temp.put('1', 'bai_dat', 400, 200);
  update public.vitals set hunger = 90, thirst = 90, fainted_until = null where account_id = pg_temp.a('1');
  update public.world_mg set stun_until = null, last_start = null, open = false;
  j := public.combo_start(pg_temp.t('1'), 'boss', f, 0, 'bai_dat', 400, 200);
  seed := (j->'round'->>'seed')::bigint;
  e := pg_temp.err(format('select public.combo_start(%L, %L, %s, 0, %L, 400, 200)', pg_temp.t('1'), 'boss', f, 'bai_dat'));
  assert e = 'cooldown', format('start cooldown %s', e);
  -- perfect arrows, no dodge: damage within 6 × the old strike range, a stun and the strike-back
  keys := pg_temp.perfect(seed);
  rep := public._wg_combo(seed, keys, '{}', 900);
  assert (rep->>'perfect')::int = 6, format('perfect %s', rep);
  update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('1');
  r := public.combo_finish(pg_temp.t('1'), keys, '{}', (rep->>'end')::int);
  assert r->>'result' = 'ok' and (r->>'stunned')::boolean, format('combo %s', r);
  assert (r->>'dmg')::int between 6 * 40 and 6 * 105, format('dmg %s', r);
  assert (select hp from public.boss_fights where id = f) = 10000 - (r->>'dmg')::int, 'boss hp';
  assert exists (select 1 from public.game_events where account_id = pg_temp.a('1') and kind = 'boss_hit' and qty = (r->>'dmg')::int), 'boss_hit';
  assert exists (select 1 from public.anticheat_events where account_id = pg_temp.a('1') and code = 'combo_timing'), 'exact beats: soft flag';
  e := pg_temp.err(format('select public.combo_start(%L, %L, %s, 0, %L, 400, 200)', pg_temp.t('1'), 'boss', f, 'bai_dat'));
  assert e = 'stunned', format('stun %s', e);
  -- dodged, sloppy: no stun
  update public.world_mg set stun_until = null, last_start = null where account_id = pg_temp.a('1');
  j := public.combo_start(pg_temp.t('1'), 'boss', f, 0, 'bai_dat', 400, 200);
  seed := (j->'round'->>'seed')::bigint;
  keys := array(select k + 16 from unnest(pg_temp.perfect(seed)) k);          -- 4 ticks late: "good"
  rep := public._wg_combo(seed, keys, array[(public._wg_combo(seed, '{}', '{}', 900)->>'slam')::int - 5], 900);
  update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('1');
  hp0 := (select hp from public.boss_fights where id = f);
  r := public.combo_finish(pg_temp.t('1'), keys, array[(rep->>'slam')::int - 5], (rep->>'end')::int);
  assert not (r->>'stunned')::boolean and (r->>'dmg')::int > 0 and (rep->>'good')::int = 6, format('good %s %s', r, rep);
  assert (select hp from public.boss_fights where id = f) = hp0 - (r->>'dmg')::int, 'hp 2';
  -- too fast
  update public.world_mg set last_start = null where account_id = pg_temp.a('1');
  j := public.combo_start(pg_temp.t('1'), 'boss', f, 0, 'bai_dat', 400, 200);
  r := public.combo_finish(pg_temp.t('1'), '{}', '{}', 400);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = pg_temp.a('1') and code = 'combo_too_fast'), format('fast %s', r);
  -- the cap
  update public.boss_hits set dmg = 2000 where fight_id = f and account_id = pg_temp.a('1');
  update public.world_mg set last_start = null where account_id = pg_temp.a('1');
  e := pg_temp.err(format('select public.combo_start(%L, %L, %s, 0, %L, 400, 200)', pg_temp.t('1'), 'boss', f, 'bai_dat'));
  assert e = 'damage cap', e;
  -- out of the arena
  perform pg_temp.put('2', 'bai_dat', 60, 330);
  e := pg_temp.err(format('select public.combo_start(%L, %L, %s, 0, %L, 60, 330)', pg_temp.t('2'), 'boss', f, 'bai_dat'));
  assert e = 'not in arena', e;

  -- the dungeon
  e := pg_temp.err(format('select public.dungeon_attack(%L, 1, 1)', pg_temp.t('2')));
  assert e = 'outdated', e;
  j := public.party_create(pg_temp.t('2'));
  perform pg_temp.put('2', 'bai_dat', 60, 120);
  j := public.dungeon_start(pg_temp.t('2'));
  run := (j->'run'->>'id')::bigint;
  update public.vitals set hunger = 90, thirst = 90, fainted_until = null where account_id = pg_temp.a('2');
  j := public.combo_start(pg_temp.t('2'), 'dungeon', run, 2, 'bai_dat', 60, 120);
  seed := (j->'round'->>'seed')::bigint;
  keys := pg_temp.perfect(seed);
  rep := public._wg_combo(seed, keys, '{}', 900);
  update public.world_mg set started_at = now() - interval '30 seconds' where account_id = pg_temp.a('2');
  r := public.combo_finish(pg_temp.t('2'), keys, array[(rep->>'slam')::int - 3], (rep->>'end')::int);
  assert r->>'result' = 'ok' and (r->>'target')::int = 2 and (r->>'dmg')::int > 0 and not (r->>'bitten')::boolean, format('dungeon %s', r);
  assert (select mobs[2] from public.dungeon_runs where id = run) = (select mobs[1] from public.dungeon_runs where id = run) - (r->>'dmg')::int, 'mob hit';
  -- not joined
  perform pg_temp.put('3', 'bai_dat', 60, 120);
  update public.world_mg set last_start = null where account_id = pg_temp.a('3');
  -- (the wolf's charge above may have made account 3 faint — a random roll)
  update public.vitals set hunger = 90, thirst = 90, fainted_until = null where account_id = pg_temp.a('3');
  e := pg_temp.err(format('select public.combo_start(%L, %L, %s, 1, %L, 60, 120)', pg_temp.t('3'), 'dungeon', run, 'bai_dat'));
  assert e = 'not joined', e;
  raise notice 'combo ok';
end $$;

-- the helpers stay private; the new RPCs are guarded
do $$
begin
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^_wg_'
                        and has_function_privilege('anon', p.oid, 'execute')), 'helpers private';
  assert has_function_privilege('anon', 'public.wild_start(text, bigint, text, text, integer, integer)', 'execute'), 'wild_start';
  assert has_function_privilege('anon', 'public.combo_finish(text, integer[], integer[], integer)', 'execute'), 'combo_finish';
  assert not has_table_privilege('anon', 'public.world_mg', 'select'), 'table private';
  raise notice 'v22 world smoke ok';
end $$;
