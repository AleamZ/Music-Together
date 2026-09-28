-- tests/sql/v21-world-smoke.sql — 0075 (v21 "world": snow, day/night, wild animals, party, bosses, dungeon). Run as the
-- superuser on the throwaway cluster after the chain 0004 … 0069 (+ 0075), from the repo root. It re-runs 0075 twice
-- (re-runnable). Every check is an ASSERT; time passing is simulated by moving timestamps back.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0075_world_bosses.sql
\i supabase/migrations/0075_world_bosses.sql
reset client_min_messages;
-- re-runnable: this smoke owns these tables' rows
truncate public.wild_spawns, public.boss_fights, public.dungeon_runs, public.parties, public.world_snow cascade;

create temp table wx (k text primary key, v text);
insert into wx select 't' || i, token from generate_series(1, 5) i,
  lateral public.register('wx' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into wx select 'a' || substr(k, 2), public._auth_account(v)::text from wx where k like 't%';
insert into wx select 'room', room_id::text from public.create_room('Thế giới', 'pw', (select v from wx where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from wx where k = 'room')::uuid), 'pw', v)
  from wx where k in ('t2', 't3', 't4', 't5');
update public.anticheat_config set mode = 'log';
insert into public.wallets (account_id, coins) select v::uuid, 5000 from wx where k like 'a%'
  on conflict (account_id) do update set coins = 5000;

create or replace function pg_temp.t(p text) returns text language sql as $$ select v from wx where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql as $$ select v::uuid from wx where k = 'a' || p $$;
create or replace function pg_temp.room() returns uuid language sql as $$ select v::uuid from wx where k = 'room' $$;
-- put an account at (map, x, y) long ago (any claim is then reachable)
create or replace function pg_temp.put(p text, p_map text, p_x integer, p_y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (pg_temp.a(p), p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------- A. Snow ----------
do $$
declare j jsonb;
begin
  assert public._weather_kind(73, 0) = 'snow' and public._weather_kind(85, 90) = 'snow' and public._weather_kind(3, 0) = 'cloudy', 'snow codes';
  assert (public._weather_effects('snow', true)->>'rideSpeed')::numeric = 0.7, 'snow effects';
  assert pg_temp.err(format('select public.snow_event_start(%L, %L, 30)', pg_temp.room(), pg_temp.t('2'))) = 'not owner', 'owner only';
  assert pg_temp.err(format('select public.snow_event_start(%L, %L, 5)', pg_temp.room(), pg_temp.t('1'))) = 'invalid minutes', 'minutes';
  j := public.snow_event_start(pg_temp.room(), pg_temp.t('1'), 30);
  assert j->>'kind' = 'snow' and (j->>'stale')::boolean = false, format('snowing %s', j);
  assert (public._room_effects(pg_temp.room())->>'bite')::numeric = 0.8, 'effects follow the event';
  assert pg_temp.err(format('select public.snow_event_start(%L, %L, 30)', pg_temp.room(), pg_temp.t('1'))) = 'too soon', 'once per 6 h';
  raise notice 'snow ok';
end $$;

-- ---------- C. Wild ----------
do $$
declare j jsonb; sp public.wild_spawns; s record; x double precision; y double precision; n integer; e text; v_have integer; c0 integer;
begin
  perform pg_temp.put('1', 'field', 400, 60);
  j := public.world_state(pg_temp.t('1'), pg_temp.room(), 'field');
  assert jsonb_array_length(j->'wild'->'animals') = 6, format('field filled %s', j->'wild');
  assert j ? 'bosses' and j ? 'dungeon' and j ? 'invites', 'poll shape';
  -- every animal is of the hour
  assert not exists (select 1 from public.wild_spawns w join public._wild_species() ws on ws.id = w.species
                      where w.map = 'field' and w.taken_at is null and w.expires_at > now()
                        and ws.active = case when public._world_night() then 'day' else 'night' end), 'of the hour';
  -- pick a rabbit-like animal: put a known rabbit in to test deterministically
  insert into public.wild_spawns (map, species, hx, hy, seed, born_at, expires_at)
  values ('field', 'rabbit', 300, 60, 12345, now() - interval '10 seconds', now() + interval '5 minutes') returning * into sp;
  select q.x, q.y into x, y from public._wild_xy(300, 60, 12345, 40, 10) q;
  assert abs(x - (300 + 40 * sin(10 * 2 * pi() / (20 + 12345 % 13) + (12345 % 628) / 100.0))) < 1e-9, 'path';
  -- far away: refused
  perform pg_temp.put('1', 'field', 700, 450);
  e := pg_temp.err(format('select public.wild_act(%L, %s, %L, %L, 700, 450)', pg_temp.t('1'), sp.id, 'hunt', 'field'));
  assert e = 'too far', format('far %s', e);
  -- a photo from 100 px works once
  perform pg_temp.put('1', 'field', round(x)::int + 100, round(y)::int);
  j := public.wild_act(pg_temp.t('1'), sp.id, 'photo', 'field', round(x)::int + 100, round(y)::int);
  assert j->>'ok' = 'true' and (j->'wild'->'album'->>'rabbit')::int = 1, format('photo %s', j);
  update public.wild_profile set last_at = now() - interval '1 minute' where account_id = pg_temp.a('1');
  e := pg_temp.err(format('select public.wild_act(%L, %s, %L, %L, %s, %s)', pg_temp.t('1'), sp.id, 'photo', 'field', round(x)::int + 100, round(y)::int));
  assert e = 'already photographed', e;
  -- hunt up close until caught (70 %); cooldown between tries
  n := 0;
  loop
    n := n + 1;
    update public.wild_profile set last_at = now() - interval '1 minute' where account_id = pg_temp.a('1');
    update public.wild_spawns set expires_at = now() + interval '5 minutes' where id = sp.id;
    perform pg_temp.put('1', 'field', round(x)::int, round(y)::int);
    j := public.wild_act(pg_temp.t('1'), sp.id, 'hunt', 'field', round(x)::int, round(y)::int);
    exit when (j->>'ok')::boolean or n > 40;
  end loop;
  assert (j->>'ok')::boolean and (j->>'qty')::int between 1 and 2, format('caught %s', j);
  e := pg_temp.err(format('select public.wild_act(%L, %s, %L, %L, %s, %s)', pg_temp.t('1'), sp.id, 'hunt', 'field', round(x)::int, round(y)::int));
  assert e = 'gone', format('taken %s', e);
  assert (select count(*) from public.game_events where account_id = pg_temp.a('1') and kind = 'wild_hunt') = 1, 'wild_hunt event';
  assert exists (select 1 from public.game_events where account_id = pg_temp.a('1') and kind = 'xp_grant' and meta->>'source' = 'wild'), 'xp';
  -- cooldown
  insert into public.wild_spawns (map, species, hx, hy, seed, born_at, expires_at)
  values ('field', 'rabbit', 300, 60, 12345, now() - interval '10 seconds', now() + interval '5 minutes') returning * into sp;
  e := pg_temp.err(format('select public.wild_act(%L, %s, %L, %L, %s, %s)', pg_temp.t('1'), sp.id, 'hunt', 'field', round(x)::int, round(y)::int));
  assert e = 'cooldown', format('cooldown %s', e);
  -- cannot hunt a firefly
  insert into public.wild_spawns (map, species, hx, hy, seed, born_at, expires_at)
  values ('field', 'firefly', 300, 60, 12345, now() - interval '10 seconds', now() + interval '5 minutes') returning * into sp;
  update public.wild_profile set last_at = null where account_id = pg_temp.a('1');
  select q.x, q.y into x, y from public._wild_xy(300, 60, 12345, 30, 10) q;
  perform pg_temp.put('1', 'field', round(x)::int, round(y)::int);
  e := pg_temp.err(format('select public.wild_act(%L, %s, %L, %L, %s, %s)', pg_temp.t('1'), sp.id, 'hunt', 'field', round(x)::int, round(y)::int));
  assert e = 'cannot', e;
  -- sell at the stall: pays by the item's price (× 1.3 at night), ledger reason wild_sell
  select qty into v_have from public.wild_bag where account_id = pg_temp.a('1') and item = 'thit_tho';
  select coins into c0 from public.wallets where account_id = pg_temp.a('1');
  perform pg_temp.put('1', 'bai_dat', 460, 56);
  j := public.wild_sell(pg_temp.t('1'), 'thit_tho', v_have);
  assert (j->>'earned')::int = case when public._world_night() then (25 * v_have * 13) / 10 else 25 * v_have end, format('sell %s', j);
  assert (j->>'coins')::int = c0 + (j->>'earned')::int, 'paid';
  assert exists (select 1 from public.coin_ledger where account_id = pg_temp.a('1') and reason = 'wild_sell'), 'ledger';
  e := pg_temp.err(format('select public.wild_sell(%L, %L, 1)', pg_temp.t('1'), 'thit_tho'));
  assert e = 'not enough', e;
  j := public.wild_sell(pg_temp.t('1'), 'thit_tho', -3);
  assert j ? 'anticheat', 'bad qty flagged';
  raise notice 'wild ok';
end $$;

-- a night wolf strikes back on a miss (forced: danger 100 via a patched species table is not possible — check the path
-- by hunting a wolf until a miss while it is night; skipped by day)
do $$
declare sp public.wild_spawns; x double precision; y double precision; j jsonb; n integer := 0; h0 numeric;
begin
  if not public._world_night() then raise notice 'wolf: day, skipped'; return; end if;
  insert into public.vitals (account_id) values (pg_temp.a('2')) on conflict do nothing;
  loop
    n := n + 1;
    insert into public.wild_spawns (map, species, hx, hy, seed, born_at, expires_at)
    values ('field', 'wolf', 300, 60, 777, now() - interval '5 seconds', now() + interval '5 minutes') returning * into sp;
    select q.x, q.y into x, y from public._wild_xy(300, 60, 777, 55, 5) q;
    perform pg_temp.put('2', 'field', round(x)::int, round(y)::int);
    update public.wild_profile set last_at = null where account_id = pg_temp.a('2');
    update public.vitals set fainted_until = null, hunger = 80, thirst = 80 where account_id = pg_temp.a('2');
    j := public.wild_act(pg_temp.t('2'), sp.id, 'hunt', 'field', round(x)::int, round(y)::int);
    exit when not (j->>'ok')::boolean or n > 40;
  end loop;
  assert (j->>'knocked')::boolean, format('knocked %s', j);
  assert (select hunger from public.vitals where account_id = pg_temp.a('2')) <= 72.01, 'drained';
  update public.vitals set fainted_until = null where account_id = pg_temp.a('2');
  raise notice 'wolf ok';
end $$;

-- ---------- D. Party ----------
do $$
declare j jsonb; p bigint; e text; u text;
begin
  j := public.party_create(pg_temp.t('1'));
  p := (j->'party'->>'id')::bigint;
  assert jsonb_array_length(j->'party'->'members') = 1, 'created';
  assert pg_temp.err(format('select public.party_create(%L)', pg_temp.t('1'))) = 'in party', 'one party';
  for i in 2 .. 5 loop
    select username into u from public.accounts where id = pg_temp.a(i::text);
    perform public.party_invite(pg_temp.t('1'), u);
  end loop;
  assert pg_temp.err(format('select public.party_invite(%L, %L)', pg_temp.t('2'), 'x')) = 'no party', 'invite needs a party';
  j := public.world_state(pg_temp.t('2'), pg_temp.room(), 'hall');
  assert jsonb_array_length(j->'invites') = 1, format('invited %s', j->'invites');
  for i in 2 .. 4 loop perform public.party_accept(pg_temp.t(i::text), p); end loop;
  e := pg_temp.err(format('select public.party_accept(%L, %s)', pg_temp.t('5'), p));
  assert e = 'party full', e;
  j := public.party_say(pg_temp.t('2'), 'chào cả nhóm');
  assert j->'party'->'chat'->0->>'body' = 'chào cả nhóm', 'chat';
  assert pg_temp.err(format('select public.party_say(%L, %L)', pg_temp.t('2'), 'again')) = 'too fast', 'chat rate';
  assert pg_temp.err(format('select public.party_kick(%L, %L)', pg_temp.t('2'), pg_temp.a('3'))) = 'not leader', 'kick leader only';
  j := public.party_kick(pg_temp.t('1'), pg_temp.a('4'));
  assert jsonb_array_length(j->'party'->'members') = 3, 'kicked';
end $$;

do $$
declare j jsonb; p bigint := public._party_of(pg_temp.a('1')); u text;
begin
  select username into u from public.accounts where id = pg_temp.a('4');
  perform public.party_invite(pg_temp.t('1'), u);
  perform public.party_accept(pg_temp.t('4'), p);
  perform pg_temp.put('2', 'pond', 100, 300);
  update public.player_pos set at = now() where account_id = pg_temp.a('2');
  j := public.world_state(pg_temp.t('1'), pg_temp.room(), 'hall');
  assert jsonb_array_length(j->'party'->'members') = 4, 'four';
  assert exists (select 1 from jsonb_array_elements(j->'party'->'members') m where m->>'map' = 'pond' and (m->>'x')::int = 100), 'positions';
  -- the leader leaves: the oldest member leads
  j := public.party_leave(pg_temp.t('1'));
  assert j->'party' = 'null'::jsonb, 'left';
  assert (select leader from public.parties where id = p) = pg_temp.a('2'), 'new leader';
  perform public.party_leave(pg_temp.t('2'));
  -- back together for the raid: 1 leads 1, 2, 3
  delete from public.party_members where account_id in (pg_temp.a('3'), pg_temp.a('4'));
  delete from public.parties where id = p;
  j := public.party_create(pg_temp.t('1'));
  p := (j->'party'->>'id')::bigint;
  for i in 2 .. 3 loop
    select username into u from public.accounts where id = pg_temp.a(i::text);
    perform public.party_invite(pg_temp.t('1'), u);
    perform public.party_accept(pg_temp.t(i::text), p);
  end loop;
  raise notice 'party ok';
end $$;

-- ---------- E. Bosses ----------
do $$
declare j jsonb; f bigint; e text; r jsonb; c0 integer; tot integer := 0; n integer := 0; kk integer;
begin
  -- the raid needs 3 of the party in the arena
  perform pg_temp.put('1', 'bai_dat', 400, 200);
  perform pg_temp.put('2', 'bai_dat', 400, 210);
  perform pg_temp.put('3', 'hall', 100, 100);
  e := pg_temp.err(format('select public.boss_summon(%L, %L, 400, 200)', pg_temp.t('1'), 'bai_dat'));
  assert e = 'need 3', e;
  perform pg_temp.put('3', 'bai_dat', 420, 220);
  update public.player_pos set at = now() where account_id in (pg_temp.a('2'), pg_temp.a('3'));
  j := public.boss_summon(pg_temp.t('1'), 'bai_dat', 400, 200);
  assert j->>'ok' = 'true', format('summoned %s', j);
  select id into f from public.boss_fights where boss = 'heo_rung' and status = 'up';
  e := pg_temp.err(format('select public.boss_attack(%L, %s, %L, 400, 200)', pg_temp.t('1'), f, 'bai_dat'));
  assert e = 'boss not up', format('not yet %s', e);
  update public.boss_fights set starts_at = now() - interval '1 second', hp = 1000, max_hp = 1000 where id = f;
  -- out of the arena
  perform pg_temp.put('4', 'bai_dat', 60, 330);
  e := pg_temp.err(format('select public.boss_attack(%L, %s, %L, 60, 330)', pg_temp.t('4'), f, 'bai_dat'));
  assert e = 'not in arena', e;
  -- a hit: server damage 40–60 (no combo on the first)
  r := public.boss_attack(pg_temp.t('1'), f, 'bai_dat', 400, 200);
  assert (r->>'dmg')::int between 40 and 60 and (r->>'combo')::int = 0, format('hit %s', r);
  -- too soon again: cooldown; spam (< 0.3 s) is a soft flag
  r := public.boss_attack(pg_temp.t('1'), f, 'bai_dat', 400, 200);
  assert r ? 'anticheat', format('spam %s', r);
  update public.boss_hits set last_at = now() - interval '0.5 seconds' where fight_id = f and account_id = pg_temp.a('1');
  e := pg_temp.err(format('select public.boss_attack(%L, %s, %L, 400, 200)', pg_temp.t('1'), f, 'bai_dat'));
  assert e = 'cooldown', e;
  -- in rhythm: combo 1
  update public.boss_hits set last_at = now() - interval '1.2 seconds' where fight_id = f and account_id = pg_temp.a('1');
  r := public.boss_attack(pg_temp.t('1'), f, 'bai_dat', 400, 200);
  assert (r->>'combo')::int = 1, format('combo %s', r);
  -- the per-account cap (25 % of 1000 = 250)
  loop
    update public.boss_hits set last_at = now() - interval '5 seconds' where fight_id = f and account_id = pg_temp.a('1');
    e := pg_temp.err(format('select public.boss_attack(%L, %s, %L, 400, 200)', pg_temp.t('1'), f, 'bai_dat'));
    exit when e is not null;
  end loop;
  assert e = 'damage cap', e;
  assert (select dmg from public.boss_hits where fight_id = f and account_id = pg_temp.a('1')) = 250, 'capped at 250';
  -- 3 more fighters finish it (4 × 250 = 1000)
  select coins into c0 from public.wallets where account_id = pg_temp.a('2');
  perform pg_temp.put('4', 'bai_dat', 400, 250);
  for kk in 2 .. 4 loop
    loop
      update public.boss_hits set last_at = now() - interval '5 seconds' where fight_id = f;
      update public.vitals set hunger = 90, thirst = 90 where account_id = pg_temp.a(kk::text);
      e := pg_temp.err(format('select public.boss_attack(%L, %s, %L, 400, %s)', pg_temp.t(kk::text), f, 'bai_dat', 200 + kk));
      exit when e is not null;
      perform pg_temp.put(kk::text, 'bai_dat', 400, 200 + kk);
    end loop;
  end loop;
  assert (select status from public.boss_fights where id = f) = 'dead', format('dead %s', e);
  assert (select count(*) from public.coin_ledger l where l.reason = 'boss_reward' and l.account_id in (select v::uuid from wx where k like 'a%')) = 4, 'four paid';
  assert (select coins from public.wallets where account_id = pg_temp.a('2')) >= c0 + 400, 'share of the pool';
  assert (select count(*) from public.game_events where kind = 'boss_kill' and account_id in (select v::uuid from wx where k like 'a%')) = 4, 'boss_kill events';
  assert exists (select 1 from public.game_events where kind = 'xp_grant' and meta->>'source' = 'boss'), 'xp boss';
  assert (select count(*) from public.game_events where kind = 'boss_hit' and meta->>'fight' = f::text) >= 16, 'boss_hit events';
  -- a party once an hour
  update public.player_pos set at = now() where account_id in (pg_temp.a('1'), pg_temp.a('2'), pg_temp.a('3'));
  e := pg_temp.err(format('select public.boss_summon(%L, %L, 400, 200)', pg_temp.t('1'), 'bai_dat'));
  assert e = 'too soon', e;
  -- the weather boss: the snowing room gets Người Tuyết
  j := public.world_state(pg_temp.t('1'), pg_temp.room(), 'bai_dat');
  assert exists (select 1 from jsonb_array_elements(j->'bosses'->'fights') x where x->>'boss' = 'nguoi_tuyet'), format('snow boss %s', j->'bosses');
  assert jsonb_array_length(j->'bosses'->'next') >= 1, 'schedule';
  -- the world boss appears 15 min before its slot
  perform public._boss_ensure(null);
  raise notice 'boss ok';
end $$;

-- ---------- F. Dungeon ----------
do $$
declare j jsonb; run bigint; e text; n integer := 0; c0 integer;
begin
  e := pg_temp.err(format('select public.dungeon_start(%L)', pg_temp.t('5')));
  assert e = 'no party', e;
  select coins into c0 from public.wallets where account_id = pg_temp.a('1');
  perform pg_temp.put('1', 'bai_dat', 60, 120);
  j := public.dungeon_start(pg_temp.t('1'));
  run := (j->'run'->>'id')::bigint;
  assert (j->'run'->>'room')::int = 1 and jsonb_array_length(j->'run'->'mobs') = 3, format('run %s', j);
  assert (select coins from public.wallets where account_id = pg_temp.a('1')) = c0 - 150, 'fee';
  e := pg_temp.err(format('select public.dungeon_start(%L)', pg_temp.t('1')));
  assert e = 'run open', format('one run %s', e);
  perform pg_temp.put('2', 'bai_dat', 60, 120);
  j := public.dungeon_join(pg_temp.t('2'), run);
  assert jsonb_array_length(j->'run'->'members') = 2, 'joined';
  perform pg_temp.put('3', 'bai_dat', 60, 120);
  e := pg_temp.err(format('select public.dungeon_attack(%L, %s, 1)', pg_temp.t('3'), run));
  assert e = 'not joined', e;
  -- fight through (scale 2: 3 members at start)
  loop
    n := n + 1;
    update public.dungeon_members set last_at = now() - interval '5 seconds' where run_id = run;
    update public.vitals set hunger = 90, thirst = 90 where account_id in (pg_temp.a('1'), pg_temp.a('2'));
    j := public.dungeon_attack(pg_temp.t(case when n % 2 = 0 then '1' else '2' end), run, 1);
    exit when (j->>'cleared')::boolean or n > 2000;
  end loop;
  assert (j->>'cleared')::boolean, format('cleared after %s', n);
  assert (select count(*) from public.coin_ledger where reason = 'dungeon_reward' and account_id in (select v::uuid from wx where k like 'a%')) = 2, 'two rewards';
  assert (select count(*) from public.game_events where kind = 'dungeon_clear' and account_id in (select v::uuid from wx where k like 'a%')) = 2, 'dungeon_clear';
  assert pg_temp.err(format('select public.dungeon_attack(%L, %s, 1)', pg_temp.t('1'), run)) = 'run over', 'over';
  raise notice 'dungeon ok';
end $$;

-- ---------- G. Privileges ----------
do $$
begin
  assert not has_function_privilege('anon', 'public._wild_fill(text)', 'execute'), 'helpers private';
  assert not has_function_privilege('anon', 'public._boss_payout(bigint)', 'execute'), 'payout private';
  assert has_function_privilege('anon', 'public.world_state(text,uuid,text)', 'execute'), 'poll public';
  assert not has_table_privilege('anon', 'public.boss_fights', 'select'), 'tables closed';
  raise notice 'privileges ok';
end $$;
