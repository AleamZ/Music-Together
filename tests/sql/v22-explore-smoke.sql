-- tests/sql/v22-explore-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain and
-- 0086, from the repo root:
--   psql -f tests/sql/v22-explore-smoke.sql -v rows=<abs path>/tests/fixtures/row-cases.json
-- It re-runs 0086 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql. Time passing is
-- simulated by moving timestamps back.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0086_explore_minigames.sql
\i supabase/migrations/0086_explore_minigames.sql
reset client_min_messages;

create temp table xp (k text primary key, v text);
insert into xp select 'ta', token from public.register('xpa_' || floor(random() * 1e9)::text, 'pw123456');
insert into xp select 'tb', token from public.register('xpb_' || floor(random() * 1e9)::text, 'pw123456');
insert into xp select 'a', public._auth_account(v)::text from xp where k = 'ta';
insert into xp select 'b', public._auth_account(v)::text from xp where k = 'tb';
insert into xp select 'room', room_id::text from public.create_room('Explore', 'pw', (select v from xp where k = 'ta'));
insert into xp select 'join', (public.join_room((select code from public.rooms where id = (select v from xp where k = 'room')::uuid), 'pw', (select v from xp where k = 'tb'))).room_id::text;
update public.anticheat_config set mode = 'log';

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from xp where k = key $$;
create or replace function pg_temp.stand(acc uuid, m text, x integer, y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (acc, m, x, y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, tab = null, tabs = '{}'
$$;
create or replace function pg_temp.fresh(acc uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (acc) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  delete from public.player_stamina where account_id = acc;
end $$;
create or replace function pg_temp.flags(acc uuid, c text) returns bigint language sql stable as $$
  select count(*) from public.anticheat_events where account_id = acc and code = c
$$;
-- a row that hits every beat 2 ticks late (not "exact"), on its side
create or replace function pg_temp.good_row(seed bigint) returns integer[] language sql immutable as $$
  select array_agg(((r)[b] + 2) * 2 + (r)[b + 12] order by b)
    from (select public._row_round(seed) r) x, generate_series(1, 12) b
$$;
-- a shovel dig that passes: the first tick after the last strike where the blade is within the window of the next
-- centre, not on its best tick
create or replace function pg_temp.good_dig(seed bigint, need integer, win integer) returns integer[] language plpgsql immutable as $$
declare rd integer[] := public._mine_round(seed, need); out integer[] := '{}'; t integer := 0; h integer := 1;
begin
  while h <= need and t < 3000 loop
    if abs(public._mine_pos(rd[1], t) - rd[h + 1]) between 3 and win - 5 then
      out := out || t;
      h := h + 1;
      t := t + 70;
    else
      t := t + 1;
    end if;
  end loop;
  return out;
end $$;

-- ---------- 1. The river's geometry and the gate ----------
do $$
begin
  assert exists (select 1 from public._pos_maps() where map = 'song_cai' and w = 960 and h = 480), 'song_cai in _pos_maps';
  assert (select count(*) from public._pos_maps()) = 9, 'nine maps';
  assert exists (select 1 from public._pos_maps() where map = 'mo_da'), 'mo_da kept';
  assert (select min_level from public.map_levels where map = 'song_cai') = 3, 'level 3';
  assert not exists (select 1 from public._pos_portals() where from_map = 'song_cai' or to_map = 'song_cai'), 'no portal';
  assert public._river_water(80, 240) and public._river_water(150, 200), 'water';
  assert not public._river_water(20, 20) and not public._river_water(600, 450), 'banks';
  assert not public._river_water(620, 230), 'the island';
  assert public._river_water(44, 240), 'lenient by the hull';
  assert not public._river_water(null, 5), 'null';
  assert public._river_shoal(250, 300) and not public._river_shoal(150, 200), 'shoals';
  assert public._treasure_band(0) = 0 and public._treasure_band(16) = 0 and public._treasure_band(17) = 1
     and public._treasure_band(180) = 6 and public._treasure_band(181) = 7, 'bands';
  assert (select count(*) from public.fish_species where water = 'deep') = 11, 'eleven deep species';
  assert not exists (select 1 from public.fish_species where water = 'deep' and rarity < 3), 'deep species are rare+';
  raise notice 'geometry ok';
end $$;

-- ---------- 2. The rowing replay against the TS fixtures ----------
\set rowsfile '\'' :rows '\''
create temp table row_cases as select c from jsonb_array_elements(pg_read_file(:rowsfile)::jsonb) c;
do $$
declare c jsonb; r jsonb; n integer := 0; rd integer[];
begin
  for c in select row_cases.c from row_cases loop
    rd := public._row_round((c->>'seed')::bigint);
    assert to_jsonb(rd) = c->'expected'->'round', format('%s: round %s', c->>'name', rd);
    r := public._row_replay((c->>'seed')::bigint, (c->>'need')::int,
                            array(select jsonb_array_elements_text(c->'strokes')::int));
    assert r->>'outcome' = c->'expected'->>'outcome' and (r->>'ticks')::int = (c->'expected'->>'ticks')::int
       and (r->>'hits')::int = (c->'expected'->>'hits')::int and (r->>'stray')::int = (c->'expected'->>'stray')::int
       and (r->>'exact')::int = (c->'expected'->>'exact')::int, format('%s: %s vs %s', c->>'name', r, c->'expected');
    assert public._row_input_error(array(select jsonb_array_elements_text(c->'strokes')::int), (r->>'ticks')::int) is null,
      format('%s: input', c->>'name');
    n := n + 1;
  end loop;
  assert n >= 30, format('%s cases', n);
  assert public._row_input_error('{200,210,220,222}', 600) = 'rate', 'rate';
  assert public._row_input_error('{200,190}', 600) = 'order', 'order';
  assert public._row_input_error('{1300}', 600) = 'range', 'range';
  assert public._row_input_error('{}', 0) = 'ticks', 'ticks';
  raise notice 'row replay ok (% cases)', n;
end $$;

-- ---------- 3. Chèo ghe: out, fish the river, home ----------
do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid; s jsonb; f jsonb;
        c jsonb; i integer; cx public.casts; seed bigint; ev bigint;
begin
  perform pg_temp.fresh(a);
  perform pg_temp.stand(a, 'pond', 378, 206);
  begin
    perform public.river_row_start(room, t, 'out');
    assert false, 'no boat';
  exception when others then assert sqlerrm = 'no boat', sqlerrm;
  end;
  insert into public.boats (account_id) values (a) on conflict do nothing;
  insert into public.player_progress (account_id, level) values (a, 1) on conflict (account_id) do update set level = 1;
  begin
    perform public.river_row_start(room, t, 'out');
    assert false, 'locked';
  exception when others then assert sqlerrm = 'map locked', sqlerrm;
  end;
  update public.player_progress set level = 5 where account_id = a;
  begin
    perform public.river_row_start(room, t, 'sideways');
    assert false, 'dir';
  exception when others then assert sqlerrm = 'bad direction', sqlerrm;
  end;
  -- walking onto the river is no path (there is no portal)
  s := public._pos_claim(a, 'song_cai', 80, 240, 'pos_report', room, 'too far');
  assert s is not null and s->'anticheat'->>'code' = 'pos_teleport', format('walked onto the river %s', s);
  perform pg_temp.stand(a, 'pond', 378, 206);
  -- a row out: the seed, the need; a pass moves the server position onto the river
  s := public.river_row_start(room, t, 'out');
  seed := (s->'row'->>'seed')::bigint;
  assert (s->'row'->>'need')::int = 8 and s->'row'->>'dir' = 'out', format('start %s', s);
  assert (select value < 100 from public.player_stamina where account_id = a), 'stamina spent';
  -- too fast: the server's clock says the row cannot be over yet
  f := public.river_row_finish(room, t, pg_temp.good_row(seed), (public._row_replay(seed, 8, pg_temp.good_row(seed))->>'ticks')::int);
  assert f->>'result' = 'drift' and f->'anticheat'->>'code' = 'row_too_fast', format('too fast %s', f);
  assert (select map from public.player_pos where account_id = a) = 'pond', 'still on the pond';
  -- a mismatch (the ticks are not the row's)
  s := public.river_row_start(room, t, 'out');
  seed := (s->'row'->>'seed')::bigint;
  update public.river_rows set started_at = now() - interval '30 seconds' where account_id = a;
  f := public.river_row_finish(room, t, pg_temp.good_row(seed), 700);
  assert f->'anticheat'->>'code' = 'row_mismatch', format('mismatch %s', f);
  -- bad input
  s := public.river_row_start(room, t, 'out');
  update public.river_rows set started_at = now() - interval '30 seconds' where account_id = a;
  f := public.river_row_finish(room, t, '{500,400}', 600);
  assert f->'anticheat'->>'code' = 'row_bad_input', format('bad input %s', f);
  -- a missed row out drifts back
  s := public.river_row_start(room, t, 'out');
  seed := (s->'row'->>'seed')::bigint;
  update public.river_rows set started_at = now() - interval '30 seconds' where account_id = a;
  f := public.river_row_finish(room, t, '{}', (public._row_replay(seed, 8, '{}')->>'ticks')::int);
  assert f->>'result' = 'drift' and f->>'why' = 'missed' and (f->>'hits')::int = 0, format('drift %s', f);
  assert (select map from public.player_pos where account_id = a) = 'pond', 'drifted back';
  -- a good row
  ev := (select count(*) from public.game_events where account_id = a and kind = 'river_row');
  s := public.river_row_start(room, t, 'out');
  seed := (s->'row'->>'seed')::bigint;
  update public.river_rows set started_at = now() - interval '30 seconds' where account_id = a;
  f := public.river_row_finish(room, t, pg_temp.good_row(seed), (public._row_replay(seed, 8, pg_temp.good_row(seed))->>'ticks')::int);
  assert f->>'result' = 'arrived' and (f->>'hits')::int = 12 and (f->>'pass')::boolean, format('arrived %s', f);
  assert f->'to'->>'map' = 'song_cai' and (f->'to'->>'x')::int = 80, format('to %s', f);
  assert (select map = 'song_cai' and x = 80 and y = 240 from public.player_pos where account_id = a), 'on the river';
  assert (select count(*) from public.game_events where account_id = a and kind = 'river_row') = ev + 1, 'river_row event';
  assert not exists (select 1 from public.river_rows where account_id = a), 'row consumed';
  -- the client's arrival claim is the same point
  assert public._pos_claim(a, 'song_cai', 80, 240, 'pos_report', room, 'too far') is null, 'arrival claim';
  -- fish the river: off the water is a bad spot; on it, a boat cast of the deep water's species
  update public.player_pos set at = now() - interval '1 hour' where account_id = a;
  c := public.start_river_cast(room, t, 600, 450);
  assert c->'anticheat'->>'code' = 'bad_spot', format('the bank %s', c);
  for i in 1 .. 30 loop
    perform pg_temp.fresh(a);
    update public.player_pos set at = now() - interval '1 hour' where account_id = a;
    insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 99)
    on conflict (account_id, item_id) do update set qty = 99;
    delete from public.fish where account_id = a;
    c := public.start_river_cast(room, t, case when i % 2 = 0 then 250 else 150 end, case when i % 2 = 0 then 300 else 200 end);
    assert c->>'spot' = 'boat' and c ? 'cast_id', format('a river cast %s', c);
    assert (c->>'shoal')::boolean = (i % 2 = 0), format('shoal %s', c);
    select * into cx from public.casts where id = (c->>'cast_id')::uuid;
    assert cx.spot = 'boat' and cx.reel_seed is not null, 'the cast row';
    assert (select case when rarity >= 3 then water = 'deep' else water = 'pond' end from public.fish_species where id = cx.species_id),
      format('the river roll %s', cx.species_id);
    assert (select map = 'song_cai' from public.player_pos where account_id = a), 'claimed on the river';
  end loop;
  delete from public.casts where account_id = a;
  -- the old boat RPCs are gone
  begin
    perform public.start_boat_cast(room, t);
    assert false, 'outdated cast';
  exception when others then assert sqlerrm = 'outdated', sqlerrm;
  end;
  begin
    perform public.board_boat(room, t);
    assert false, 'outdated board';
  exception when others then assert sqlerrm = 'outdated', sqlerrm;
  end;
  -- home: from the boat's spot; even a missed row gets there (nobody is stranded)
  perform pg_temp.fresh(a);
  update public.player_pos set x = 150, y = 200, at = now() - interval '1 hour' where account_id = a;
  s := public.river_row_start(room, t, 'home', 20, 20);
  assert s->'anticheat'->>'code' = 'bad_spot', format('home from the bank %s', s);
  s := public.river_row_start(room, t, 'home', 150, 200);
  seed := (s->'row'->>'seed')::bigint;
  assert (s->'row'->>'need')::int = 6, format('home need %s', s);
  update public.river_rows set started_at = now() - interval '30 seconds' where account_id = a;
  f := public.river_row_finish(room, t, '{}', (public._row_replay(seed, 6, '{}')->>'ticks')::int);
  assert f->>'result' = 'arrived' and not (f->>'pass')::boolean and f->'to'->>'map' = 'pond', format('home %s', f);
  assert (select map = 'pond' and x = 378 and y = 206 from public.player_pos where account_id = a), 'at the pier';
  -- an expired row
  s := public.river_row_start(room, t, 'out');
  update public.river_rows set started_at = now() - interval '2 minutes' where account_id = a;
  f := public.river_row_finish(room, t, '{}', 600);
  assert f->>'why' = 'expired', format('expired %s', f);
  begin
    perform public.river_row_finish(room, t, '{}', 600);
    assert false, 'no row';
  exception when others then assert sqlerrm = 'row not found', sqlerrm;
  end;
  raise notice 'rowing ok';
end $$;

-- ---------- 4. Treasure: the detector and the dig ----------
do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid; r jsonb; f jsonb;
        mid uuid; mid2 uuid; sp public.treasure_spots; d public.treasure_digs; before integer; v_loot integer;
begin
  perform pg_temp.fresh(a);
  delete from public.treasure_maps where account_id = a;
  select * into sp from public.treasure_spots where id = 1;
  insert into public.treasure_maps (account_id, spot, source) values (a, 1, 'fishing') returning id into mid;
  -- pings: only a band, never the spot
  perform pg_temp.stand(a, sp.map, sp.x, sp.y);
  r := public.treasure_ping(room, t, mid, sp.map, sp.x + 150, sp.y + 100);
  assert (r->>'band')::int = 7 and not (r ? 'x'), format('cold %s', r);
  r := public.treasure_ping(room, t, mid, sp.map, sp.x, sp.y);
  assert (r->>'wait')::boolean, format('too soon %s', r);
  update public.treasure_maps set last_ping_at = now() - interval '1 second' where id = mid;
  update public.player_pos set at = now() - interval '1 hour' where account_id = a;
  r := public.treasure_ping(room, t, mid, sp.map, sp.x + 30, sp.y);
  assert (r->>'band')::int = 1, format('close %s', r);
  update public.treasure_maps set last_ping_at = now() - interval '1 second' where id = mid;
  update public.player_pos set at = now() - interval '1 hour' where account_id = a;
  r := public.treasure_ping(room, t, mid, 'field', 300, 300);
  assert r->>'heat' = 'wrong_map', format('wrong map %s', r);
  assert (select pings from public.treasure_maps where id = mid) = 3, 'pings counted';
  begin
    perform public.treasure_ping(room, pg_temp.v('tb'), mid, sp.map, sp.x, sp.y);
    assert false, 'not mine';
  exception when others then assert sqlerrm = 'no map', sqlerrm;
  end;
  -- the dig: off the spot is a miss; on it, a seeded shovel round
  perform pg_temp.stand(a, sp.map, sp.x, sp.y);
  r := public.treasure_dig_start(room, t, mid, sp.map, sp.x + 40, sp.y);
  assert r->>'result' = 'miss' and r->>'heat' = 'hot', format('miss %s', r);
  begin
    perform public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
    assert false, 'cooldown';
  exception when others then assert sqlerrm = 'dig cooldown', sqlerrm;
  end;
  update public.treasure_maps set last_dig_at = now() - interval '10 seconds' where id = mid;
  update public.player_pos set at = now() - interval '1 hour' where account_id = a;
  r := public.treasure_dig_start(room, t, mid, sp.map, sp.x + 5, sp.y - 5);
  assert r->>'result' = 'dig' and (r->'dig'->>'need')::int = 3 and (r->'dig'->>'win')::int = 120, format('dig %s', r);
  select * into d from public.treasure_digs where account_id = a;
  assert d.loot = 8000 or d.loot between 400 and 2500, format('loot rolled %s', d.loot);
  -- too fast
  f := public.treasure_dig_finish(room, t, pg_temp.good_dig(d.seed, 3, 120), (select max(s) + 1 from unnest(pg_temp.good_dig(d.seed, 3, 120)) s), true);
  assert f->'anticheat'->>'code' = 'treasure_too_fast', format('too fast %s', f);
  assert (select found_at is null from public.treasure_maps where id = mid), 'not found yet';
  -- a real dig
  update public.treasure_maps set last_dig_at = now() - interval '10 seconds' where id = mid;
  update public.player_pos set at = now() - interval '1 hour' where account_id = a;
  perform pg_temp.fresh(a);
  r := public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
  select * into d from public.treasure_digs where account_id = a;
  update public.treasure_digs set started_at = now() - interval '60 seconds' where account_id = a;
  before := (select coins from public.wallets where account_id = a);
  f := public.treasure_dig_finish(room, t, pg_temp.good_dig(d.seed, 3, 120), (select max(s) + 1 from unnest(pg_temp.good_dig(d.seed, 3, 120)) s), true);
  assert f->>'result' = 'found', format('found %s', f);
  v_loot := (f->>'loot')::int;
  assert (f->>'clean')::boolean, 'a clean dig';
  assert v_loot = case when d.loot = 8000 then 8000 else least(2500, round(d.loot * 1.1)::int) end, format('loot %s of %s', v_loot, d.loot);
  assert (select coins from public.wallets where account_id = a) = coalesce(before, 0) + v_loot, 'paid';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'treasure' and delta = v_loot), 'ledger';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'treasure_found' and qty = v_loot), 'event';
  assert (select m.found_at is not null and m.loot = v_loot from public.treasure_maps m where m.id = mid), 'map found';
  begin
    perform public.treasure_ping(room, t, mid, sp.map, sp.x, sp.y);
    assert false, 'found maps are done';
  exception when others then assert sqlerrm = 'no map', sqlerrm;
  end;
  -- a failed dig keeps the map; a made-up pass is a mismatch
  insert into public.treasure_maps (account_id, spot, source) values (a, 1, 'dig') returning id into mid2;
  perform pg_temp.fresh(a);
  update public.player_pos set at = now() - interval '1 hour' where account_id = a;
  r := public.treasure_dig_start(room, t, mid2, sp.map, sp.x, sp.y);
  update public.treasure_digs set started_at = now() - interval '60 seconds' where account_id = a;
  f := public.treasure_dig_finish(room, t, '{10,200}', 400, false);
  assert f->>'result' = 'lost' and f->>'why' = 'gave_up', format('gave up %s', f);
  assert (select found_at is null from public.treasure_maps where id = mid2), 'kept';
  update public.treasure_maps set last_dig_at = now() - interval '10 seconds' where id = mid2;
  update public.player_pos set at = now() - interval '1 hour' where account_id = a;
  perform pg_temp.fresh(a);
  r := public.treasure_dig_start(room, t, mid2, sp.map, sp.x, sp.y);
  update public.treasure_digs set started_at = now() - interval '60 seconds' where account_id = a;
  f := public.treasure_dig_finish(room, t, '{10,90,170}', 171, true);
  assert f->'anticheat'->>'code' = 'treasure_mismatch', format('mismatch %s', f);
  -- the old one-shot dig
  begin
    perform public.dig_treasure(room, t, mid2, sp.map, sp.x, sp.y);
    assert false, 'outdated dig';
  exception when others then assert sqlerrm = 'outdated', sqlerrm;
  end;
  raise notice 'treasure ok';
end $$;

-- ---------- 5. Privileges and the wipe ----------
do $$
declare a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid;
begin
  assert has_function_privilege('anon', 'public.river_row_start(uuid, text, text, integer, integer)', 'execute'), 'row start public';
  assert has_function_privilege('anon', 'public.river_row_finish(uuid, text, integer[], integer)', 'execute'), 'row finish public';
  assert has_function_privilege('anon', 'public.start_river_cast(uuid, text, integer, integer)', 'execute'), 'river cast public';
  assert has_function_privilege('anon', 'public.treasure_ping(uuid, text, uuid, text, integer, integer)', 'execute'), 'ping public';
  assert not has_function_privilege('anon', 'public._river_move(uuid, text, integer, integer)', 'execute'), 'move private';
  assert not has_function_privilege('anon', 'public._row_replay(bigint, integer, integer[])', 'execute'), 'replay private';
  assert not has_table_privilege('anon', 'public.river_rows', 'select'), 'rows private';
  assert not has_table_privilege('anon', 'public.treasure_digs', 'select'), 'digs private';
  insert into public.river_rows (account_id, room_id, dir, seed, need, x, y) values (a, room, 'out', 1, 8, 378, 206)
  on conflict (account_id) do nothing;
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot) values (a, 'x', null, '{}'::jsonb);
  assert not exists (select 1 from public.river_rows where account_id = a), 'rows wiped';
  assert not exists (select 1 from public.treasure_digs where account_id = a), 'digs wiped';
  raise notice 'privileges and wipe ok';
end $$;
