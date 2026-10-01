-- tests/sql/song-cai-route-smoke.sql — 0116 (the road out to Sông Cái: board the ghe at Bến đò, the road's end). Run as
-- the superuser on the throwaway cluster after the full chain (0004 … 0116, README order), from the repo root:
--   psql -f tests/sql/song-cai-route-smoke.sql
-- It re-runs 0116 twice with \i. Every check is an ASSERT. Time is simulated as in v22-fixes-smoke.sql (pg_temp.warp).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0116_song_cai_route.sql
\i supabase/migrations/0116_song_cai_route.sql
reset client_min_messages;

create temp table vx (k text primary key, v text);
insert into vx select 'flag_rooms', enabled::text from public.app_flags where key = 'room_creation_open';
insert into vx select 'flag_world', enabled::text from public.app_flags where key = 'unified_world';
update public.app_flags set enabled = true where key = 'room_creation_open';
insert into vx select 't' || i, token from generate_series(1, 2) i,
  lateral public.register('scr' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into vx select 'a' || substr(k, 2), public._auth_account(v)::text from vx where k like 't%';
insert into vx select 'room', room_id::text from public.create_room('Song Cai', 'pw', (select v from vx where k = 't1'));
select count(*) from (select public.join_room((select code from public.rooms where id = (select v from vx where k = 'room')::uuid), 'pw', v)
  from vx where k = 't2') x;
update public.anticheat_config set mode = 'log', min_client_build = 0;
update public.app_flags set enabled = true where key = 'unified_world';

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
end $$;
create or replace function pg_temp.warp(p uuid, p_s numeric) returns void language plpgsql as $$
#variable_conflict use_variable
declare iv interval := make_interval(secs => p_s);
begin
  update public.mg_live set opened_at = opened_at - iv, started_at = started_at - iv,
         seen = coalesce((select array_agg(x - iv order by o) from unnest(seen) with ordinality u(x, o)), '{}'),
         a_at = coalesce((select array_agg(x - iv order by o) from unnest(a_at) with ordinality u(x, o)), '{}'),
         b_at = coalesce((select array_agg(x - iv order by o) from unnest(b_at) with ordinality u(x, o)), '{}')
   where account_id = p;
  update public.river_rows set started_at = started_at - iv where account_id = p;
end $$;
create or replace function pg_temp.ev(r jsonb, i integer) returns jsonb language sql immutable as $$
  select e->'d' from jsonb_array_elements(r->'ev') e where (e->>'i')::int = i
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------- A. The landing = routes.ts ----------
do $$ begin
  assert public._song_cai_landing() = '{"x": 1312, "y": 1568, "r": 48, "foot_x": 352, "foot_y": 104}'::jsonb, 'landing';
  assert not has_function_privilege('anon', 'public._song_cai_landing()', 'execute'), 'landing private';
  assert has_function_privilege('anon', 'public.river_row_start(uuid, text, text, integer, integer)', 'execute'), 'start granted';
  -- the dock's foot is river water the row can land on
  assert public._river_water(352, 104), 'the foot floats';
  raise notice 'landing ok';
end $$;

-- ---------- B. Walk the road (pond exit → junction → landing) and row out from Bến đò ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); room uuid := pg_temp.room(); j jsonb; r jsonb; e integer;
        strokes integer[] := '{}'; nb integer := 0; d jsonb; p public.player_pos;
begin
  perform pg_temp.fresh(a);
  insert into public.boats (account_id) values (a) on conflict do nothing;
  insert into public.player_progress (account_id, level) values (a, 3) on conflict (account_id) do update set level = 3;
  update public.map_levels set min_level = 3 where map = 'song_cai';
  -- at the pond's exit, then down the visible road at walking pace (one report each second, 60 px apart: well under 260 px/s)
  perform pg_temp.put(a, 'pond', 352, 374);
  update public.player_pos set at = now() - interval '10 seconds' where account_id = a;
  for i in 0 .. 2 loop
    j := public._pos_claim(a, 'wild', 1312, 1460 + i * 54, 'pos_report_w', room, 'too far');
    assert j is null, format('the road at y %s refused: %s', 1460 + i * 54, j);
    update public.player_pos set at = at - interval '1 second' where account_id = a;
  end loop;
  select * into p from public.player_pos where account_id = a;
  assert p.map = 'wild' and p.wx = 1312 and p.wy = 1568, format('at the landing %s', to_jsonb(p));
  -- the row out from here: claimed at the landing (not at Cầu ao's pier, 330 px away)
  j := public.river_row_start(room, t, 'out');
  assert j ? 'row' and (j->'row'->>'need')::int = 8, format('row start at the landing %s', j);
  assert (select (x, y) = (1312, 1568) from public.river_rows where account_id = a), 'the row starts at the landing';
  r := public.mg_sync(t, 'row');
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
  assert r->>'result' = 'arrived', format('row out from the landing %s', r);
  assert r->'to' = '{"map": "song_cai", "x": 352, "y": 104, "dir": "down"}'::jsonb, format('lands at the dock''s foot %s', r->'to');
  select * into p from public.player_pos where account_id = a;
  assert p.map = 'song_cai' and p.x = 352 and p.y = 104 and p.wx = 1312 and p.wy = 1704, format('on the river %s', to_jsonb(p));
  raise notice 'road + landing row ok';
end $$;

-- ---------- C. The pier still works (2D clients, the old way); the level gate holds at the landing; far is far ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('2'); t text := pg_temp.t('2'); room uuid := pg_temp.room(); j jsonb;
begin
  perform pg_temp.fresh(a);
  insert into public.boats (account_id) values (a) on conflict do nothing;
  insert into public.player_progress (account_id, level) values (a, 2) on conflict (account_id) do update set level = 2;
  perform pg_temp.put(a, 'wild', 1312, 1568);
  update public.player_pos set mode = 'w' where account_id = a;                     -- a world client (pos_report_w)
  assert pg_temp.err(format('select public.river_row_start(%L, %L, ''out'')', room, t)) = 'map locked', 'lv2 at the landing';
  update public.player_progress set level = 3 where account_id = a;
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'pond', 378, 206);
  j := public.river_row_start(room, t, 'out');
  assert j ? 'row', format('the pier %s', j);
  assert (select (x, y) = (378, 206) from public.river_rows where account_id = a), 'the row starts at the pier';
  delete from public.river_rows where account_id = a;
  delete from public.mg_live where account_id = a;
  -- in the wild but nowhere near Bến đò (nor the pier): the pier's claim, refused as too far
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', 2000, 1300);
  update public.player_pos set at = now() where account_id = a;
  j := public.river_row_start(room, t, 'out');
  assert not (j ? 'row'), format('far from both %s', j);
  raise notice 'pier, gate, far ok';
end $$;

update public.app_flags set enabled = (select v::boolean from vx where k = 'flag_rooms') where key = 'room_creation_open';
update public.app_flags set enabled = (select v::boolean from vx where k = 'flag_world') where key = 'unified_world';
update public.map_levels set min_level = 3 where map = 'song_cai';
