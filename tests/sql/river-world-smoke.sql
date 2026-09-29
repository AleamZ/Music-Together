-- tests/sql/river-world-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain
-- (0004 … 0095), from the repo root:
--   psql -f tests/sql/river-world-smoke.sql
-- 0095: the seamless river — _river_world_water (world px: Sông Cái's water and its short ends, the wild river band, the
-- canals; no other zone, no land), start_river_cast_w (map wild in the world model; map song_cai = 0086's cast; a dry
-- or non-wild spot is a bad spot). It re-runs 0095 twice with \i (re-runnable) and leaves the unified_world flag as it
-- found it.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0095_river_world.sql
\i supabase/migrations/0095_river_world.sql
reset client_min_messages;

create temp table rw (k text primary key, v text);
insert into rw select 'flag', enabled::text from public.app_flags where key = 'unified_world';
update public.app_flags set enabled = true where key = 'unified_world';
insert into rw select 'ta', token from public.register('rwa_' || floor(random() * 1e9)::text, 'pw123456');
insert into rw select 'a', public._auth_account(v)::text from rw where k = 'ta';
insert into rw select 'room', room_id::text from public.create_room('River', 'pw', (select v from rw where k = 'ta'));
update public.anticheat_config set mode = 'log';

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from rw where k = key $$;
create or replace function pg_temp.float(acc uuid, m text, x integer, y integer) returns void language plpgsql as $$
begin
  insert into public.player_pos (account_id, map, x, y, at) values (acc, m, x, y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, tab = null, tabs = '{}';
  update public.player_pos set mode = 'w' where account_id = acc;
  insert into public.vitals (account_id) values (acc) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  delete from public.player_stamina where account_id = acc;
  insert into public.inventory (account_id, item_id, qty) values (acc, 'bait_worm', 99)
  on conflict (account_id, item_id) do update set qty = 99;
  delete from public.fish where account_id = acc;
  delete from public.casts where account_id = acc;
end $$;

-- ---------- 1. The mask ----------
do $$
begin
  assert public._river_world_water(424, 1900), 'the river west of Sông Cái';
  assert public._river_world_water(3300, 1850), 'the river east';
  assert public._river_world_water(3300, 1850 + 150), 'the band, off the centreline';
  assert not public._river_world_water(3300, 1850 + 240), 'past the band';
  assert public._river_world_water(2250, 1400), 'a canal';
  assert public._river_world_water(2250 + 18, 1400), 'a canal, the hull';
  assert not public._river_world_water(2250 + 30, 1400), 'beside a canal';
  assert public._river_world_water(1000, 300), 'the north canal';
  assert not public._river_world_water(2000, 1000), 'dry land';
  assert public._river_world_water(960 + 80, 1600 + 240), 'Sông Cái''s water';
  assert not public._river_world_water(960 + 620, 1600 + 230), 'Sông Cái''s island';
  assert public._river_world_water(960 + 20, 1840), 'Sông Cái''s west end';
  assert public._river_world_water(1920 - 20, 1840), 'Sông Cái''s east end';
  assert not public._river_world_water(960 + 500, 1600 + 20), 'Sông Cái''s bank';
  assert not public._river_world_water(-5, 1560) and not public._river_world_water(4200, 1900), 'off the world';
  assert not public._river_world_water(null, 1900), 'null';
  assert not has_function_privilege('anon', 'public._river_world_water(integer, integer)', 'execute'), 'mask private';
  assert not has_function_privilege('anon', 'public._polyline_dist(integer[], double precision, double precision)', 'execute'), 'dist private';
  assert has_function_privilege('anon', 'public.start_river_cast_w(uuid, text, text, integer, integer)', 'execute'), 'cast public';
end $$;

-- ---------- 2. Casting from the boat on the wild's water ----------
do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid; c jsonb;
        cx public.casts; i integer;
begin
  insert into public.player_progress (account_id, level) values (a, 5) on conflict (account_id) do update set level = 5;
  perform pg_temp.float(a, 'wild', 424, 1900);
  begin
    perform public.start_river_cast_w(room, t, 'wild', 424, 1900);
    assert false, 'no boat';
  exception when others then assert sqlerrm = 'no boat', sqlerrm;
  end;
  insert into public.boats (account_id) values (a) on conflict do nothing;
  -- dry land, another map name, another zone's rect: bad spots
  c := public.start_river_cast_w(room, t, 'wild', 2000, 1000);
  assert c->'anticheat'->>'code' = 'bad_spot', format('dry %s', c);
  c := public.start_river_cast_w(room, t, 'pond', 424, 1900);
  assert c->'anticheat'->>'code' = 'bad_spot', format('pond %s', c);
  c := public.start_river_cast_w(room, t, 'wild', 960 + 80, 1600 + 240);
  assert c->'anticheat'->>'code' = 'bad_spot', format('Sông Cái as wild %s', c);   -- its rect is not the wild
  -- the river and the canals
  for i in 1 .. 6 loop
    perform pg_temp.float(a, 'wild', case when i % 2 = 0 then 2250 else 424 end, case when i % 2 = 0 then 1400 else 1900 end);
    c := public.start_river_cast_w(room, t, 'wild', case when i % 2 = 0 then 2250 else 424 end, case when i % 2 = 0 then 1400 else 1900 end);
    assert c->>'spot' = 'boat' and c ? 'cast_id', format('a wild river cast %s', c);
    assert not (c->>'shoal')::boolean, 'no shoal off Sông Cái';
    select * into cx from public.casts where id = (c->>'cast_id')::uuid;
    assert cx.spot = 'boat' and cx.reel_seed is not null, 'the cast row';
    assert (select map = 'wild' from public.player_pos where account_id = a), 'claimed in the wild';
  end loop;
  -- far from the last claim: too far
  perform pg_temp.float(a, 'wild', 424, 1900);
  update public.player_pos set at = now() where account_id = a;
  c := public.start_river_cast_w(room, t, 'wild', 3300, 1850);
  assert c->'anticheat'->>'code' is not null and not (c ? 'cast_id'), format('a jump %s', c);
  -- map song_cai: 0086's cast, zone-local
  perform pg_temp.float(a, 'song_cai', 250, 300);
  c := public.start_river_cast_w(room, t, 'song_cai', 250, 300);
  assert c->>'spot' = 'boat' and (c->>'shoal')::boolean, format('Sông Cái %s', c);
  delete from public.casts where account_id = a;
end $$;

update public.app_flags set enabled = (select v::boolean from rw where k = 'flag') where key = 'unified_world';
do $$ begin raise notice 'river world smoke ok'; end $$;
