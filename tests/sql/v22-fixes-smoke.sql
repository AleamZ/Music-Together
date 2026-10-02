-- tests/sql/v22-fixes-smoke.sql — 0087 (the v22 review fixes: no minigame round leaves the server; mg_sync reveals it a
-- bounded time ahead and stamps the inputs live; the finishes refuse early / late / rewritten inputs; the reviews'
-- other findings). Run as the superuser on the throwaway cluster after the full chain (0004 … 0087, README order), from
-- the repo root, with the fixtures' absolute paths:
--   psql -v world=<repo>/tests/fixtures/world-mg-cases.json -v craft=<repo>/tests/fixtures/craft-cases.json
--        -v care=<repo>/tests/fixtures/pet-care-cases.json -v rows=<repo>/tests/fixtures/row-cases.json
--        -v mine=<repo>/tests/fixtures/mine-cases.json -v events=<repo>/tests/fixtures/mg-events-cases.json
--        -f tests/sql/v22-fixes-smoke.sql
-- It re-runs 0087 twice with \i. Every check is an ASSERT. The passing of time is simulated: pg_temp.warp moves every
-- timestamp of an account's round (the live clock, the reveals, the stamps, the round's start) back by some seconds,
-- which is what that many seconds of real time would have done; an "honest client" below reads only what mg_sync
-- revealed, and presses at the ticks it could see.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0087_v22_fixes.sql
\i supabase/migrations/0087_v22_fixes.sql
reset client_min_messages;

create temp table fx as
  select pg_read_file(:'world')::jsonb w, pg_read_file(:'craft')::jsonb c, pg_read_file(:'care')::jsonb p,
         pg_read_file(:'rows')::jsonb r, pg_read_file(:'mine')::jsonb m, pg_read_file(:'events')::jsonb e;
create or replace function pg_temp.ints(v jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
#variable_conflict use_variable
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------- 1. The parameter-driven sims = the seed sims (every fixture) ----------
do $$
#variable_conflict use_variable
declare c jsonb; n integer := 0; a integer[]; b integer[];
begin
  for c in select jsonb_array_elements(w->'wild') from fx loop
    a := pg_temp.ints(c->'a'); b := pg_temp.ints(c->'b');
    assert case c->>'game'
             when 'hunt' then public._wg_hunt_u(public._wg_draws((c->>'seed')::bigint, 5), c->>'species', (c->>'danger')::boolean, a, b)
                            = public._wg_hunt((c->>'seed')::bigint, c->>'species', (c->>'danger')::boolean, a, b)
             when 'trap' then public._wg_trap_u(public._wg_draws((c->>'seed')::bigint, 16), c->>'species', a)
                            = public._wg_trap((c->>'seed')::bigint, c->>'species', a)
             else public._wg_photo_u(public._wg_draws((c->>'seed')::bigint, 4), c->>'species', a, b)
                = public._wg_photo((c->>'seed')::bigint, c->>'species', a, b) end, format('%s', c->>'name');
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(w->'combo') from fx loop
    assert public._wg_combo_u(public._wg_draws((c->>'seed')::bigint, 13), pg_temp.ints(c->'keys'), pg_temp.ints(c->'dodges'), (c->>'ticks')::int) - 'offs'
           = public._wg_combo((c->>'seed')::bigint, pg_temp.ints(c->'keys'), pg_temp.ints(c->'dodges'), (c->>'ticks')::int), c->>'name';
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(fx.c->'brew') from fx loop
    assert public._brew_replay_p(public._brew_round((c->>'seed')::bigint), pg_temp.ints(c->'toggles')) = (c->'expected'->>'score')::int, c->>'name';
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(fx.c->'anvil') from fx loop
    assert public._anvil_replay_p(public._anvil_round((c->>'seed')::bigint), pg_temp.ints(c->'strikes')) - 'spread'
           = (c->'expected') - 'round', c->>'name';
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(fx.c->'sort') from fx loop
    assert public._sort_replay_p(public._sort_round((c->>'seed')::bigint), pg_temp.ints(c->'ticks'), pg_temp.ints(c->'dirs'))
           = public._sort_replay((c->>'seed')::bigint, pg_temp.ints(c->'ticks'), pg_temp.ints(c->'dirs')), c->>'name';
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(p->'care') from fx loop
    continue when c->'expected'->>'error' is not null;
    assert public._pcare_replay_p(c->>'kind', case c->>'kind' when 'feed' then public._pcare_feed_lanes((c->>'seed')::bigint)
                                                             when 'pat' then public._pcare_rub_likes((c->>'seed')::bigint)
                                                             else public._pcare_fetch_flights((c->>'seed')::bigint) end,
                                  pg_temp.ints(c->'inputs'))
           = public._pcare_replay(c->>'kind', (c->>'seed')::bigint, pg_temp.ints(c->'inputs')), c->>'name';
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(p->'press') from fx loop
    assert public._ppress_power_p(public._ppress_round((c->>'seed')::bigint), (c->>'press')::int) = (c->>'power')::int, c->>'name';
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(fx.r) from fx loop
    assert public._row_replay_p(public._row_round((c->>'seed')::bigint), (c->>'need')::int, pg_temp.ints(c->'strokes'))
           = public._row_replay((c->>'seed')::bigint, (c->>'need')::int, pg_temp.ints(c->'strokes')), c->>'name';
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(fx.m) from fx loop
    assert public._mine_replay_p(public._mine_round((c->>'seed')::bigint, (c->>'need')::int), (c->>'need')::int, (c->>'win')::int, pg_temp.ints(c->'strikes'))
           = public._mine_replay((c->>'seed')::bigint, (c->>'need')::int, (c->>'win')::int, pg_temp.ints(c->'strikes')), c->>'name';
    assert public._mine_timing_p(public._mine_round((c->>'seed')::bigint, (c->>'need')::int), (c->>'need')::int, (c->>'win')::int, pg_temp.ints(c->'strikes'))
           = public._mine_timing((c->>'seed')::bigint, (c->>'need')::int, (c->>'win')::int, pg_temp.ints(c->'strikes')), c->>'name';
    n := n + 1;
  end loop;
  assert n >= 280, format('%s cases', n);
  -- the rolls have the seed rounds' shapes and ranges
  for i in 1 .. 50 loop
    assert (select bool_and(x between -3 and 3) from unnest((public._mg_roll('brew'))[2:21]) x), 'drift';
    a := public._mg_roll('anvil')::int[];
    assert a[1] between 50 and 80 and a[2] between 0 and a[1] - 1, 'anvil';
    a := public._mg_roll('row')::int[];
    assert cardinality(a) = 24 and a[1] = 90 and (select bool_and(a[k + 1] - a[k] between 34 and 54) from generate_series(1, 11) k), 'row';
    a := public._mg_roll('care', 'pat')::int[];
    assert (select bool_and(a[k] <> a[k + 1]) from generate_series(1, 4) k), 'pat never twice';
    a := public._mg_roll('dig', null, 3)::int[];
    assert cardinality(a) = 4 and a[1] between 80 and 140 and (select bool_and(x between 150 and 850) from unnest(a[2:4]) x), 'dig';
  end loop;
  raise notice 'parameter sims ok: % cases', n;
end $$;

-- the live events: public._mg_events = scripts/gen-mg-events-fixtures.ts (which the overlays' *From functions read)
do $$
#variable_conflict use_variable
declare c jsonb; l public.mg_live; n integer := 0;
begin
  for c in select jsonb_array_elements(e) from fx loop
    l := jsonb_populate_record(null::public.mg_live, jsonb_build_object('account_id', gen_random_uuid(), 'game', c->>'game',
           'kind', c->>'kind', 'params', c->'params', 'gate', c->'gate', 'meta', c->'meta', 'a', c->'a'));
    assert public._mg_events(l) = c->'events', format('%s: sql %s ts %s', c->>'name', public._mg_events(l), c->'events');
    n := n + 1;
  end loop;
  assert n >= 100, format('%s event cases', n);
  raise notice 'live events ok: % cases', n;
end $$;

-- ---------- 2. The accounts and the clock ----------
create temp table vx (k text primary key, v text);
insert into vx select 't' || i, token from generate_series(1, 4) i,
  lateral public.register('fx' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into vx select 'a' || substr(k, 2), public._auth_account(v)::text from vx where k like 't%';
insert into vx select 'room', room_id::text from public.create_room('Fixes', 'pw', (select v from vx where k = 't1'));
select count(*) from (select public.join_room((select code from public.rooms where id = (select v from vx where k = 'room')::uuid), 'pw', v)
  from vx where k in ('t2', 't3', 't4')) x;
update public.anticheat_config set mode = 'log', min_client_build = 0;
update public.map_levels set min_level = 1 where map in ('mo_da', 'song_cai');
insert into public.wallets (account_id, coins) select v::uuid, 100000 from vx where k like 'a%'
  on conflict (account_id) do update set coins = 100000;

create or replace function pg_temp.t(p text) returns text language sql as $$ select v from vx where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql as $$ select v::uuid from vx where k = 'a' || p $$;
create or replace function pg_temp.room() returns uuid language sql as $$ select v::uuid from vx where k = 'room' $$;
create or replace function pg_temp.put(p uuid, p_map text, p_x integer, p_y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb
$$;
create or replace function pg_temp.fresh(p uuid) returns void language plpgsql as $$
#variable_conflict use_variable
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100;
  update public.mining_profiles set last_act_at = null where account_id = p;
end $$;
create or replace function pg_temp.flags(p uuid, c text) returns bigint language sql stable as $$
  select count(*) from public.anticheat_events where account_id = p and code = c
$$;
-- p_s seconds pass for the account's rounds
create or replace function pg_temp.warp(p uuid, p_s numeric) returns void language plpgsql as $$
#variable_conflict use_variable
declare iv interval := make_interval(secs => p_s);
begin
  update public.mg_live set opened_at = opened_at - iv, started_at = started_at - iv,
         seen = coalesce((select array_agg(x - iv order by o) from unnest(seen) with ordinality u(x, o)), '{}'),
         a_at = coalesce((select array_agg(x - iv order by o) from unnest(a_at) with ordinality u(x, o)), '{}'),
         b_at = coalesce((select array_agg(x - iv order by o) from unnest(b_at) with ordinality u(x, o)), '{}')
   where account_id = p;
  update public.world_mg set started_at = started_at - iv, last_start = last_start - iv where account_id = p;
  update public.craft_rounds set started_at = started_at - iv where account_id = p;
  update public.pet_care_rounds set started_at = started_at - iv where account_id = p;
  update public.river_rows set started_at = started_at - iv where account_id = p;
  update public.treasure_digs set started_at = started_at - iv where account_id = p;
  update public.mine_digs set started_at = started_at - iv where account_id = p;
end $$;
-- the payload of revealed event i (null: not revealed)
create or replace function pg_temp.ev(r jsonb, i integer) returns jsonb language sql immutable as $$
  select e->'d' from jsonb_array_elements(r->'ev') e where (e->>'i')::int = i
$$;
create or replace function pg_temp.nev(r jsonb) returns integer language sql immutable as $$ select jsonb_array_length(r->'ev') $$;

-- ---------- 3. The combo: nothing to precompute; the honest client; the attacks ----------
-- One combo round played by a client that reads only mg_sync: each arrow pressed p_off[i] ticks off its beat once that
-- tick has come; the slam dodged 5 ticks before it. Returns the finish's answer. p_mode: 'honest' | 'offline' (plays
-- nothing live: finishes with the perfect keys after the round) | 'peek_end' (one sync at the end, then the perfect keys)
-- | 'early' (finishes before the round's end).
create or replace function pg_temp.combo(p text, f bigint, p_off integer[], p_mode text) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare t text := pg_temp.t(p); a uuid := pg_temp.a(p); j jsonb; r jsonb; e integer; keys integer[] := '{}'; dodges integer[] := '{}';
        d jsonb; nk integer := 0; v_end integer; l public.mg_live; u bigint[]; b integer;
begin
  update public.world_mg set stun_until = null, last_start = null, open = false where account_id = a;
  update public.vitals set hunger = 90, thirst = 90, fainted_until = null where account_id = a;
  insert into public.player_stamina (account_id, value) values (a, 100) on conflict (account_id) do update set value = 100;
  j := public.combo_start(t, 'boss', f, 0, 'bai_dat', 400, 200);
  assert j->'round' ? 'kind' and position('seed' in j::text) = 0 and not (j->'round' ? 'beats'), format('nothing to precompute: %s', j);
  if p_mode in ('offline', 'peek_end') then
    -- the attacker's best case: it somehow knows the whole round (here: read from the table as the superuser)
    select * into l from public.mg_live where account_id = a and game = 'world';
    u := l.params;
    b := (90 + u[1] % 31)::int;
    for jj in 0 .. 5 loop
      if jj > 0 then b := b + (54 + u[2 * jj + 1] % 19)::int; end if;
      keys := keys || (b * 4 + (u[2 * jj + 2] % 4)::int);
    end loop;
    v_end := b + 11;
    if p_mode = 'peek_end' then
      r := public.mg_sync(t, 'world');
      perform pg_temp.warp(a, v_end / 60.0 + 0.5);
      r := public.mg_sync(t, 'world');
      assert pg_temp.nev(r) = 7, 'everything revealed at the end';
    else
      perform pg_temp.warp(a, v_end / 60.0 + 0.5);
    end if;
    return public.combo_finish(t, keys, '{}', v_end);
  end if;
  r := public.mg_sync(t, 'world', '{}', '{}');
  assert (r->>'t')::int <= 6 and pg_temp.nev(r) = 1, format('tick 0 reveals the first arrow only: %s', r);
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'world', keys, dodges);
    e := (r->>'t')::int;
    assert (select bool_and(((x->'d'->>'beat')::int - 120 <= e) or x->'d' ? 'slam') from jsonb_array_elements(r->'ev') x),
           'no arrow sooner than 2 s ahead';
    d := pg_temp.ev(r, nk + 1);
    if nk < 6 and d is not null and (d->>'beat')::int + p_off[nk + 1] <= e then
      keys := keys || (((d->>'beat')::int + p_off[nk + 1]) * 4 + (d->>'dir')::int);
      nk := nk + 1;
    end if;
    d := pg_temp.ev(r, 7);
    if d is not null and cardinality(dodges) = 0 and (d->>'slam')::int - 5 <= e and p_mode <> 'early' then
      dodges := array[(d->>'slam')::int - 5];
    end if;
    exit when p_mode = 'early' and nk = 3;
    if pg_temp.ev(r, 6) is not null then v_end := (pg_temp.ev(r, 6)->>'beat')::int + 11; end if;
    exit when v_end is not null and e >= v_end;
    exit when e > 900;
  end loop;
  -- keys stamped by the next sync; the dodge may come later than a key: keep both lists sorted as the client does
  keys := array(select k from unnest(keys) k order by k);
  if p_mode = 'early' then
    perform pg_temp.warp(a, 1);
    return public.combo_finish(t, keys, dodges, keys[3] / 4 + 5);
  end if;
  return public.combo_finish(t, keys, dodges, v_end);
end $$;

do $$
#variable_conflict use_variable
declare f bigint; r jsonb; hp0 integer; a uuid := pg_temp.a('1'); e text;
begin
  insert into public.boss_fights (boss, slot, announce_at, starts_at, ends_at, hp, max_hp)
  values ('trau_tinh', now() - interval '3 days', now() - interval '1 minute', now() - interval '1 minute', now() + interval '20 minutes', 100000, 100000)
  returning id into f;
  insert into vx values ('boss', f::text);
  perform pg_temp.put(a, 'bai_dat', 400, 200);
  -- honest, human offsets: every arrow judged, damage dealt, the slam dodged, no timing flag
  r := pg_temp.combo('1', f, array[2, -1, 3, 0, -2, 1], 'honest');
  assert r->>'result' = 'ok' and (r->>'dmg')::int > 0 and (r->>'dodged')::boolean, format('honest combo %s', r);
  assert (select count(*) from jsonb_array_elements_text(r->'judges') x where x = 'perfect') = 6, format('six perfect %s', r);
  assert pg_temp.flags(a, 'combo_timing') = 0 and pg_temp.flags(a, 'combo_late') = 0, 'no flag for a human';
  -- one steady offset (+2 on every beat, never "exact"): the soft timing flag (0087)
  r := pg_temp.combo('1', f, array[2, 2, 2, 2, 2, 2], 'honest');
  assert r->>'result' = 'ok' and pg_temp.flags(a, 'combo_timing') = 1, format('steady offsets flagged %s', r);
  -- the attacks: the perfect keys, known in full, without playing live — void, nothing dealt
  hp0 := (select b.hp from public.boss_fights b where b.id = f);
  r := pg_temp.combo('1', f, null, 'offline');
  assert r->>'why' = 'late' and pg_temp.flags(a, 'combo_late') = 1, format('offline replay void %s', r);
  r := pg_temp.combo('1', f, null, 'peek_end');
  assert r->>'why' = 'late' and pg_temp.flags(a, 'combo_late') = 2, format('peek at the end void %s', r);
  assert (select b.hp from public.boss_fights b where b.id = f) = hp0, 'no damage from the attacks';
  -- an early finish (before the sixth beat's window closed): refused (0087)
  r := pg_temp.combo('1', f, array[0, 1, -1, 2, 0, 1], 'early');
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'combo_bad_input'
                                             and detail->>'error' = 'ticks'), format('early finish %s', r);
  -- mg_sync: a key ahead of the server's clock, a rewritten list
  update public.world_mg set stun_until = null, last_start = null where account_id = a;
  perform public.combo_start(pg_temp.t('1'), 'boss', f, 0, 'bai_dat', 400, 200);
  perform public.mg_sync(pg_temp.t('1'), 'world');
  e := pg_temp.err(format('select public.mg_sync(%L, %L, %L::int[], null)', pg_temp.t('1'), 'world', '{2000}'));
  assert e = 'bad inputs', format('future key %s', e);
  perform pg_temp.warp(a, 1);
  perform public.mg_sync(pg_temp.t('1'), 'world', '{120}', null);
  e := pg_temp.err(format('select public.mg_sync(%L, %L, %L::int[], null)', pg_temp.t('1'), 'world', '{124}'));
  assert e = 'bad inputs', format('rewrite %s', e);
  e := pg_temp.err(format('select public.mg_sync(%L, %L)', pg_temp.t('2'), 'world'));
  assert e = 'round not found', format('no round %s', e);
  raise notice 'combo ok';
end $$;

-- ---------- 4. The hunt (a gate: the animal shows at a secret tick) and the trap ----------
create or replace function pg_temp.rabbit(p uuid) returns bigint language plpgsql as $$
#variable_conflict use_variable
declare sp public.wild_spawns; x double precision; y double precision;
begin
  insert into public.wild_spawns (map, species, hx, hy, seed, born_at, expires_at)
  values ('field', 'rabbit', 300, 60, 12345, now() - interval '10 seconds', now() + interval '5 minutes') returning * into sp;
  select q.x, q.y into x, y from public._wild_xy(300, 60, 12345, 40, 10) q;
  perform pg_temp.put(p, 'field', round(x)::int, round(y)::int);
  update public.wild_profile set last_at = null, trap_at = null, kills = 0 where account_id = p;
  update public.world_mg set stun_until = null, open = false where account_id = p;
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100;
  return sp.id;
end $$;
create or replace function pg_temp.spawn_xy(p uuid) returns integer[] language sql as $$
  select array[x, y] from public.player_pos where account_id = p
$$;
-- the hunt's error at release tick s (the sim's formula on the revealed animal and the start's reticle)
create or replace function pg_temp.hunt_err(ret integer, d jsonb, s integer) returns integer language sql immutable as $$
  select abs(public._wg_tri(ret, s) + (d->>'wind')::int
             - (100 + (public._wg_tri((d->>'period')::int, s + 20 + (d->>'phase')::int) * 8) / 10))
$$;

do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('2'); t text := pg_temp.t('2'); sp bigint; xy integer[]; j jsonb; r jsonb; e integer; ret integer;
        d jsonb; e_seen integer; s integer; best integer; l public.mg_live; x integer; v integer; segs jsonb := '[]'; pull integer;
begin
  perform pg_temp.fresh(a);
  -- an honest hunt: nothing but the aim sweep at the start; the animal at the gate; the best shot after it
  sp := pg_temp.rabbit(a); xy := pg_temp.spawn_xy(a);
  j := public.wild_start(t, sp, 'hunt', 'field', xy[1], xy[2]);
  ret := (j->'round'->>'reticle')::int;
  assert ret between 100 and 140 and position('seed' in j::text) = 0, format('hunt start %s', j);
  r := public.mg_sync(t, 'world', '{}', '{}');
  assert pg_temp.nev(r) = 0, format('no animal at tick 0 %s', r);
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'world', '{}', '{}');
    d := pg_temp.ev(r, 1);
    exit when d is not null;
  end loop;
  e_seen := (r->>'t')::int;
  assert e_seen between 30 and 70, format('the gate %s', e_seen);
  best := null;
  for k in e_seen + 8 .. e_seen + 400 loop
    if best is null or pg_temp.hunt_err(ret, d, k) < pg_temp.hunt_err(ret, d, best) then best := k; end if;
  end loop;
  assert pg_temp.hunt_err(ret, d, best) <= 70, 'a hit exists';
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'world', case when (r->>'t')::int >= best then array[best] else '{}' end, '{}');
    exit when (r->>'t')::int >= best + 21;
  end loop;
  r := public.wild_finish(t, array[best], '{}', best + 21);
  assert r->>'outcome' = 'hit' and (r->>'score')::int = 1000 - (pg_temp.hunt_err(ret, d, best) * 600) / 70, format('honest hunt %s', r);
  -- the look-back: a shot claimed before the animal showed is refused (hard)
  sp := pg_temp.rabbit(a); xy := pg_temp.spawn_xy(a);
  j := public.wild_start(t, sp, 'hunt', 'field', xy[1], xy[2]);
  r := public.mg_sync(t, 'world');
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'world');
    exit when pg_temp.ev(r, 1) is not null;
  end loop;
  e_seen := (r->>'t')::int;
  r := public.mg_sync(t, 'world', array[e_seen - 20], null);
  perform pg_temp.warp(a, 1);
  r := public.wild_finish(t, array[e_seen - 20], '{}', e_seen);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'wild_bad_input'
                                             and detail->>'error' = 'early'), format('look-back %s', r);
  -- the offline replay: the shot known (from the table), sent after the round, never synced: a shot nobody saw aimed
  sp := pg_temp.rabbit(a); xy := pg_temp.spawn_xy(a);
  j := public.wild_start(t, sp, 'hunt', 'field', xy[1], xy[2]);
  select * into l from public.mg_live where account_id = a and game = 'world';
  best := null;
  for k in 0 .. 600 loop
    if (public._wg_hunt_u(l.params, 'rabbit', false, array[k], '{}')->>'outcome') = 'hit' then best := k; exit; end if;
  end loop;
  perform pg_temp.warp(a, 12);
  r := public.wild_finish(t, array[best], '{}', best + 21);
  assert r->>'why' = 'refused' and (select count(*) from public.anticheat_events where account_id = a and code = 'wild_bad_input'
                                       and detail->>'error' = 'early') = 2, format('offline hunt %s', r);

  -- the trap: the trail revealed 0.5 s ahead; the honest client pulls when the animal it sees is on the trap
  sp := pg_temp.rabbit(a); xy := pg_temp.spawn_xy(a);
  update public.wild_spawns set species = 'rabbit' where id = sp;
  j := public.wild_start(t, sp, 'trap', 'field', xy[1], xy[2]);
  assert position('seed' in j::text) = 0, format('trap start %s', j);
  r := public.mg_sync(t, 'world');
  x := 0; e := 0; pull := null;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'world', case when pull is not null then array[pull] else '{}' end, null);
    exit when pull is not null;
    -- step the trail from the revealed segments up to the server's tick
    while e < (r->>'t')::int and pull is null loop
      e := e + 1;
      v := coalesce((select (s.d->>'v')::int from (select pg_temp.ev(r, k) d, k from generate_series(1, 8) k) s
                      where s.d is not null
                        and e > (select coalesce(sum((pg_temp.ev(r, q)->>'len')::int), 0) from generate_series(1, s.k - 1) q)
                        and e <= (select coalesce(sum((pg_temp.ev(r, q)->>'len')::int), 0) from generate_series(1, s.k) q)), 6);
      x := least(1000, greatest(0, x + v));
      if abs(x - 500) <= 20 then pull := e; end if;
    end loop;
    exit when (r->>'t')::int > 800;
  end loop;
  assert pull is not null, 'the rabbit reached the trap';
  perform pg_temp.warp(a, 0.1);
  r := public.wild_finish(t, array[pull], '{}', pull + 1);
  assert r->>'outcome' = 'caught' and (r->>'score')::int >= 700, format('honest trap %s', r);
  raise notice 'wild ok';
end $$;

-- ---------- 5. Crafting: the brew (drift ahead), the anvil (a gate), the sort ----------
create or replace function pg_temp.at(a uuid, m text, x integer, y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (a, m, x, y, now() - interval '60 seconds')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, tabs = '{}'::jsonb, tab = null
$$;
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('3'); t text := pg_temp.t('3'); j jsonb; r jsonb; e integer; centre integer; rd integer[];
        tog integer[] := '{}'; h integer := 200; fan boolean := false; k integer := 1; tick integer := 0; sc integer;
        d jsonb; e_seen integer; per integer; ph integer; strikes integer[] := '{}'; offs integer[] := array[2, 2, 2, 2, 2];
        peak integer; ticks integer[] := '{}'; dirs integer[] := '{}'; ng integer := 0; react integer[];
begin
  perform pg_temp.fresh(a);
  perform pg_temp.at(a, 'mo_da', 320, 346);
  perform public._bag_add(a, 'herb_nam', 10);
  j := public.brew_start(t, 'pot_hunger', 1);
  centre := (j->'round'->>'centre')::int;
  assert centre between 400 and 600 and position('seed' in j::text) = 0 and not (j->'round' ? 'drift'), format('brew start %s', j);
  r := public.mg_sync(t, 'brew');
  assert pg_temp.nev(r) between 2 and 3, format('two segments at tick 0 %s', r);
  rd := array_fill(0, array[21]); rd[1] := centre;
  -- the honest cook: the fan on below the centre, off above, from what the heat did so far
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'brew', tog, null);
    e := (r->>'t')::int;
    for i in 1 .. 20 loop
      if pg_temp.ev(r, i) is not null then rd[i + 1] := (pg_temp.ev(r, i)->>'drift')::int; end if;
    end loop;
    assert (select count(*) from generate_series(1, 20) i where pg_temp.ev(r, i) is not null) <= e / 30 + 3, 'drift 1 s ahead at most';
    while tick < least(e, 600) loop
      if k <= cardinality(tog) and tog[k] = tick then fan := not fan; k := k + 1; end if;
      h := least(1000, greatest(0, h + case when fan then 7 else -4 end + rd[2 + tick / 30]));
      tick := tick + 1;
    end loop;
    exit when e >= 600;
    if (h < centre) <> fan and e > coalesce(tog[cardinality(tog)], -1) and e < 600
       and (cardinality(tog) < 10 or e - tog[cardinality(tog) - 9] >= 60) then
      tog := tog || e;
    end if;
  end loop;
  sc := public._brew_replay_p(rd, tog);
  r := public.brew_finish(t, tog, sc);
  assert r->>'result' = 'brewed' and (r->'brewed'->>'quality')::int >= 2, format('honest brew %s (%s)', r, sc);
  -- the offline brew: the best toggles for the known drift, never synced: void, nothing taken
  perform pg_temp.fresh(a);
  j := public.brew_start(t, 'pot_hunger', 1);
  perform pg_temp.warp(a, 11);
  r := public.brew_finish(t, tog, public._brew_replay_p((select params::int[] from public.mg_live where account_id = a and game = 'brew'), tog));
  assert r->>'why' = 'late' and pg_temp.flags(a, 'brew_late') = 1, format('offline brew %s', r);
  assert (select qty from public.craft_bag where account_id = a and item_id = 'herb_nam') = 8, 'a void brew takes nothing';

  -- the anvil: the glow shows at a secret tick; five strikes on one steady offset (+2 ticks: never "exact") are flagged
  insert into public.mine_tools (account_id, tool_id, durability) values (a, 'pick_da', 60) on conflict do nothing;
  perform public._bag_add(a, 'ore_dong', 3);
  perform pg_temp.at(a, 'mo_da', 200, 306);
  perform pg_temp.fresh(a);
  j := public.upgrade_start(t, 'pick_da');
  assert position('seed' in j::text) = 0 and (j->'round'->>'chance')::int = 900, format('anvil start %s', j);
  r := public.mg_sync(t, 'anvil');
  assert pg_temp.nev(r) = 0, 'no glow at tick 0';
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'anvil', strikes, null);
    d := pg_temp.ev(r, 1);
    if d is not null and per is null then
      e_seen := (r->>'t')::int; per := (d->>'period')::int; ph := (d->>'phase')::int;
      peak := e_seen + 8;
      while (peak + ph) % per <> per / 2 loop peak := peak + 1; end loop;
    end if;
    e := (r->>'t')::int;
    if per is not null and cardinality(strikes) < 5 and peak + offs[cardinality(strikes) + 1] <= e then
      strikes := strikes || (peak + offs[cardinality(strikes) + 1]);
      peak := peak + per;
      if cardinality(strikes) >= 2 and peak + 2 - strikes[cardinality(strikes) - 1] < 60 then peak := peak + per; end if;
    end if;
    exit when cardinality(strikes) = 5 and e > strikes[5] + 6;
  end loop;
  r := public.upgrade_finish(t, strikes, strikes[5] + 1, (public._anvil_replay_p(array[per, ph], strikes)->>'score')::int);
  assert r->>'result' = 'done' and (r->'upgrade'->>'score')::int = 10, format('anvil %s', r);
  assert (public._anvil_replay_p(array[per, ph], strikes)->>'exact')::int = 0 and pg_temp.flags(a, 'anvil_timing') = 1,
         'a steady offset is a metronome (0087)';
  delete from public.item_upgrades where account_id = a;
  -- a strike claimed before the glow showed: refused (hard)
  perform public._bag_add(a, 'ore_dong', 3);
  perform pg_temp.fresh(a);
  j := public.upgrade_start(t, 'pick_da');
  r := public.mg_sync(t, 'anvil');
  perform pg_temp.warp(a, 0.2);
  r := public.mg_sync(t, 'anvil', '{5}', null);
  perform pg_temp.warp(a, 1.5);
  r := public.upgrade_finish(t, '{5}', 1800, 0);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'anvil_bad_input'
                                             and detail->>'error' = 'early'), format('blind strike %s', r);

  -- the sort: each grain 1 s ahead; eleven right on one steady reaction: flagged at 11 now (0087)
  insert into public.farm_machines (account_id, machine) values (a, 'processor') on conflict do nothing;
  insert into public.processor_jobs (account_id, recipe, batches, started_at, ready_at)
  values (a, 'gao_trang', 2, now() - interval '1 hour', now() - interval '1 minute');
  perform pg_temp.fresh(a);
  j := public.process_sort_start(t);
  assert position('seed' in j::text) = 0, format('sort start %s', j);
  r := public.mg_sync(t, 'sort');
  react := array[10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'sort', (select coalesce(array_agg(ticks[q] * 2 + dirs[q] order by q), '{}') from generate_series(1, cardinality(ticks)) q), null);
    e := (r->>'t')::int;
    assert (select count(*) from generate_series(1, 12) i where pg_temp.ev(r, i) is not null) <= greatest(0, (e + 60 - 40) / 45 + 1), 'grains 1 s ahead';
    if ng < 12 and pg_temp.ev(r, ng + 1) is not null and 40 + 45 * ng + react[ng + 1] <= e then
      ticks := ticks || (40 + 45 * ng + react[ng + 1]);
      dirs := dirs || case when ng = 0 then 1 - (pg_temp.ev(r, 1)->>'kind')::int else (pg_temp.ev(r, ng + 1)->>'kind')::int end;
      ng := ng + 1;
    end if;
    exit when e >= 580;
  end loop;
  r := public.process_sort_finish(t, ticks, dirs, 11);
  assert r->>'result' = 'collected' and (r->>'bonus_pct')::int = public._sort_bonus(11), format('sort %s', r);   -- econ v2: 2 % (0102), 5 % (0084)
  assert pg_temp.flags(a, 'sort_timing') = 1, 'eleven on one reaction: soft flag (0087)';
  raise notice 'crafting ok';
end $$;

-- ---------- 6. Pets: a care round (feed) and the power press ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('4'); t text := pg_temp.t('4'); pid bigint; j jsonb; r jsonb; e integer; inp integer[] := '{}';
        bowl integer := 2; nt integer := 0; d jsonb; sc integer; b public.pet_battles; per integer; e_seen integer; p integer; ctr integer;
begin
  perform public._pay(a, 50000, 'daily', 'seed');
  perform public.pet_gacha_roll(t);
  select id into pid from public.pets where account_id = a;
  update public.pets set fullness = 50, stats_at = now() where id = pid;
  insert into public.pet_items (account_id, item_id, qty)
  select a, 'food_' || species, 3 from public.pets where id = pid on conflict (account_id, item_id) do update set qty = 3;
  j := public.pet_care_start(t, pid, 'feed');
  assert position('seed' in (j->'round')::text) = 0 and (j->'round'->>'ticks')::int = 551, format('care start %s', j->'round');
  r := public.mg_sync(t, 'care');
  assert pg_temp.nev(r) = 1, format('the first treat only %s', r);
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'care', inp, null);
    e := (r->>'t')::int;
    d := pg_temp.ev(r, nt + 1);
    -- the bowl moves once the treat before has landed (75 + 40 i), in time for this one (110 + 40 i)
    if nt < 12 and d is not null and (case when nt = 0 then 40 else 75 + 40 * nt end) <= e then
      if (d->>'lane')::int <> bowl then
        inp := inp || ((case when nt = 0 then 40 else 75 + 40 * nt end) * 8 + (d->>'lane')::int);
        bowl := (d->>'lane')::int;
      end if;
      nt := nt + 1;
    end if;
    exit when e >= 551;
  end loop;
  sc := (public._pcare_feed_p((select params::int[] from public.mg_live where account_id = a and game = 'care'), inp)->>'score')::int;
  assert sc = 12, format('every treat caught %s', sc);
  r := public.pet_care_finish(t, inp, 551, sc);
  assert r->>'result' = 'done' and (r->>'permille')::int = 1000, format('honest feed %s', r - 'pets');

  -- the power press: no seed in the battle; the meter opens, the sweet spot shows at a secret tick
  update public.pets set fullness = 100, stats_at = now() where id = pid;
  j := public.battle_start_pve(t, 'pet', pid, (select id from public.pet_npc_catalog order by sort_order limit 1));
  select * into b from public.pet_battles where p1 = a and status = 'active';
  assert (select public._battle_json(b, a)->'press_seed') = 'null'::jsonb, 'no press seed (0087)';
  update public.pet_battles set acted_at = now() - interval '10 seconds' where id = b.id;
  assert pg_temp.err(format('select public.battle_act_press(%L, %s, %L, 5, 60)', t, b.id, (b.f1->'skills'->>0))) = 'press not open',
         'a press needs the meter';
  -- a pick without a press (a guard, a heal, a hit let go) needs none: 850 ‰
  r := public.battle_act_press(t, b.id, (b.f1->'skills'->>0), null, 1);
  assert (r->>'power')::int = 850 and not (r ? 'anticheat'), format('no press %s', r->'power');
  select * into b from public.pet_battles where id = b.id;
  assert b.status = 'active', 'the battle goes on';
  update public.pet_battles set acted_at = now() - interval '10 seconds' where id = b.id;
  j := public.battle_press_open(t, b.id);
  per := (j->'press'->>'period')::int;
  assert per between 60 and 100 and not (j->'press' ? 'centre'), format('open %s', j);
  r := public.mg_sync(t, 'press');
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'press');
    exit when pg_temp.ev(r, 1) is not null;
  end loop;
  e_seen := (r->>'t')::int;
  ctr := (pg_temp.ev(r, 1)->>'centre')::int;
  p := e_seen + 8;
  while abs(public._mine_pos(per, p) - ctr) > 30 loop p := p + 1; end loop;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'press');
    exit when (r->>'t')::int >= p + 2;
  end loop;
  r := public.battle_act_press(t, b.id, (b.f1->'skills'->>0), p, p + 1);
  assert (r->>'power')::int >= 1100, format('a good press %s', r->'power');
  -- the next turn: a press claimed before the sweet spot showed is refused
  select * into b from public.pet_battles where id = b.id;
  if b.status = 'active' then
    update public.pet_battles set acted_at = now() - interval '10 seconds' where id = b.id;
    perform public.battle_press_open(t, b.id);
    r := public.mg_sync(t, 'press');
    perform pg_temp.warp(a, 0.2);
    r := public.battle_act_press(t, b.id, (b.f1->'skills'->>0), 3, 20);
    assert exists (select 1 from public.anticheat_events where account_id = a and code = 'battle_press_bad_input'
                     and detail->>'error' = 'early'), 'a blind press';
  end if;
  raise notice 'pets ok';
end $$;

-- ---------- 7. Explore: the row home (a miss drifts), the treasure dig (one chest per map) ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); room uuid := pg_temp.room(); j jsonb; r jsonb; e integer;
        strokes integer[] := '{}'; nb integer := 0; d jsonb; sp public.treasure_spots; mid uuid; loot integer; per integer;
        strikes integer[] := '{}'; hits integer := 0; c integer; s integer; e_seen integer; need integer := 3;
begin
  perform pg_temp.fresh(a);
  insert into public.boats (account_id) values (a) on conflict do nothing;
  insert into public.player_progress (account_id, level) values (a, 5) on conflict (account_id) do update set level = 5;
  -- a row out, honest: each beat 1.5 s ahead, stroked 1–2 ticks late on its side
  perform pg_temp.put(a, 'pond', 378, 206);
  j := public.river_row_start(room, t, 'out');
  assert position('seed' in j::text) = 0 and (j->'row'->>'need')::int = 8, format('row start %s', j);
  r := public.mg_sync(t, 'row');
  assert pg_temp.nev(r) = 1, format('the first beat only %s', r);
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'row', strokes, null);
    e := (r->>'t')::int;
    d := pg_temp.ev(r, nb + 1);
    if nb < 12 and d is not null and (d->>'t')::int + 1 + nb % 2 <= e then
      strokes := strokes || (((d->>'t')::int + 1 + nb % 2) * 2 + (d->>'side')::int);
      nb := nb + 1;
    end if;
    exit when nb = 12 and pg_temp.ev(r, 12) is not null and e >= (pg_temp.ev(r, 12)->>'t')::int + 12;
  end loop;
  r := public.river_row_finish(room, t, strokes, (pg_temp.ev(r, 12)->>'t')::int + 12);
  assert r->>'result' = 'arrived' and (r->>'hits')::int = 12, format('row out %s', r);
  -- rows home that miss drift (0087): the need drops 6 → 4 → 2 → 0, and at 0 the boat gets home
  for i in 1 .. 4 loop
    perform pg_temp.fresh(a);
    perform pg_temp.put(a, 'song_cai', 80, 240);
    j := public.river_row_start(room, t, 'home', 80, 240);
    assert (j->'row'->>'need')::int = 6 - 2 * (i - 1), format('need %s: %s', i, j);
    r := public.mg_sync(t, 'row');
    perform pg_temp.warp(a, 12);
    r := public.mg_sync(t, 'row');
    r := public.river_row_finish(room, t, '{}', (pg_temp.ev(r, 12)->>'t')::int + 12);
    if i < 4 then
      assert r->>'result' = 'drift' and r->>'why' = 'missed', format('home miss %s: %s', i, r);
      assert (select map from public.player_pos where account_id = a) = 'song_cai', 'still on the river';
    else
      assert r->>'result' = 'arrived' and r->'to'->>'map' = 'pond', format('towed home %s', r);
    end if;
  end loop;
  assert (select home_fails from public.boats where account_id = a) = 0, 'reset on arrival';

  -- the treasure: the chest is rolled once per map; a give-up keeps it; the honest shovel finds it
  perform pg_temp.fresh(a);
  delete from public.treasure_maps where account_id = a;
  select * into sp from public.treasure_spots where id = 1;
  insert into public.treasure_maps (account_id, spot, source) values (a, 1, 'fishing') returning id into mid;
  perform pg_temp.put(a, sp.map, sp.x, sp.y);
  j := public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
  assert j->>'result' = 'dig' and position('seed' in j::text) = 0, format('dig start %s', j);
  loot := (select dig_loot from public.treasure_maps where id = mid);
  assert loot = (select t2.loot from public.treasure_digs t2 where t2.account_id = a), 'the dig carries the map''s chest';
  r := public.mg_sync(t, 'dig');
  perform pg_temp.warp(a, 1);
  r := public.treasure_dig_finish(room, t, '{}', 60, false);
  assert r->>'why' = 'gave_up', format('give up %s', r);
  for i in 1 .. 3 loop
    update public.treasure_maps set last_dig_at = null where id = mid;
    perform pg_temp.put(a, sp.map, sp.x, sp.y);
    perform pg_temp.fresh(a);
    j := public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
    assert (select t2.loot from public.treasure_digs t2 where t2.account_id = a) = loot, 'no re-roll by giving up (0087)';
    r := public.mg_sync(t, 'dig');
    perform pg_temp.warp(a, 0.5);
    perform public.treasure_dig_finish(room, t, '{}', 30, false);
  end loop;
  -- the honest shovel: each vein after the strike that found the last one is stamped
  update public.treasure_maps set last_dig_at = null where id = mid;
  perform pg_temp.put(a, sp.map, sp.x, sp.y);
  perform pg_temp.fresh(a);
  j := public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
  per := (j->'dig'->>'period')::int;
  r := public.mg_sync(t, 'dig');
  assert pg_temp.nev(r) = 0, 'no vein at tick 0';
  s := null;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'dig', strikes, null);
    e := (r->>'t')::int;
    assert pg_temp.nev(r) <= hits + 1, format('one vein at a time %s', r);
    if s is null and pg_temp.ev(r, hits + 1) is not null then
      c := (pg_temp.ev(r, hits + 1)->>'c')::int;
      s := e + 8;
      while abs(public._mine_pos(per, s) - c) > 60
            or (cardinality(strikes) >= 4 and s - strikes[cardinality(strikes) - 3] < 60) loop s := s + 1; end loop;
    end if;
    if s is not null and s <= e then
      strikes := strikes || s; hits := hits + 1; s := null;
    end if;
    exit when hits = need;
  end loop;
  perform pg_temp.warp(a, 0.1);
  r := public.treasure_dig_finish(room, t, strikes, strikes[need] + 1, true);
  assert r->>'result' = 'found' and (r->>'loot')::int = case when loot = 8000 then 8000 else least(2500, round(loot * 1.1)::int) end,
         format('found %s (chest %s)', r, loot);
  raise notice 'explore ok';
end $$;

-- ---------- 8. Mining (0072's dig): the same veins ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('2'); t text := pg_temp.t('2'); room uuid := pg_temp.room(); j jsonb; r jsonb; e integer; per integer;
        strikes integer[] := '{}'; hits integer := 0; need integer; c integer; s integer;
begin
  perform pg_temp.fresh(a);
  perform public.mine_state(room, t);
  insert into public.mine_tools (account_id, tool_id, durability) values (a, 'pick_da', 60)
  on conflict (account_id, tool_id) do update set durability = 60;
  update public.mine_nodes set item_id = 'ore_da', ready_at = now() - interval '1 second' where room_id = room and node_no = 1;
  perform pg_temp.at(a, 'mo_da', 100, 124);
  j := public.mine_start(room, t, 1);
  assert position('seed' in j::text) = 0 and j->'state'->'dig' ? 'period' and not (j->'state'->'dig' ? 'seed'), format('mine start %s', j);
  per := (j->'dig'->>'period')::int;
  need := (j->'dig'->>'need')::int;
  r := public.mg_sync(t, 'mine');
  s := null;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'mine', strikes, null);
    e := (r->>'t')::int;
    if s is null and pg_temp.ev(r, hits + 1) is not null then
      c := (pg_temp.ev(r, hits + 1)->>'c')::int;
      s := e + 8;
      while abs(public._mine_pos(per, s) - c) > 40
            or (cardinality(strikes) >= 4 and s - strikes[cardinality(strikes) - 3] < 60) loop s := s + 1; end loop;
    end if;
    if s is not null and s <= e then strikes := strikes || s; hits := hits + 1; s := null; end if;
    exit when hits = need;
  end loop;
  perform pg_temp.warp(a, 0.1);
  r := public.mine_finish(room, t, strikes, strikes[need] + 1, true);
  assert r->>'result' = 'mined', format('mined %s', r - 'state');
  -- the offline dig: the veins known, the strikes never synced: void
  update public.mine_nodes set item_id = 'ore_da', ready_at = now() - interval '1 second' where room_id = room and node_no = 1;
  perform pg_temp.at(a, 'mo_da', 100, 124);
  j := public.mine_start(room, t, 1);
  perform pg_temp.warp(a, 20);
  r := public.mine_finish(room, t, strikes, strikes[need] + 1, true);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'mine_bad_input'
                                             and detail->>'error' = 'early'),
         format('offline dig %s', r - 'state');
  raise notice 'mining ok';
end $$;

-- ---------- 9. Privileges and the wipe ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('3');
begin
  assert has_function_privilege('anon', 'public.mg_sync(text, text, integer[], integer[])', 'execute'), 'mg_sync granted';
  assert has_function_privilege('anon', 'public.battle_press_open(text, bigint)', 'execute'), 'battle_press_open granted';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                        and p.proname ~ '^_(mg_|wg_.*_u$|brew_replay_p|anvil_replay_p|sort_replay_p|pcare_.*_p$|ppress_.*_p$|row_replay_p|mine_.*_p$)'
                        and has_function_privilege('anon', p.oid, 'execute')), 'helpers private';
  assert not has_table_privilege('anon', 'public.mg_live', 'select'), 'mg_live private';
  perform public._mg_open(a, 'brew', 'brew', '{1}', 0);
  insert into public.anticheat_wipes (account_id, username, snapshot) values (a, 'smoke', '{}'::jsonb);
  assert not exists (select 1 from public.mg_live where account_id = a), 'wiped';
  raise notice 'v22 fixes smoke ok';
end $$;
