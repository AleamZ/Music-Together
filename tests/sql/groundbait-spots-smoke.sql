-- tests/sql/groundbait-spots-smoke.sql — 0117 (Ổ thính: groundbait per spot). Run as the superuser on the throwaway
-- cluster after the full chain (… 0115, 0117), from the repo root:
--   psql -f tests/sql/groundbait-spots-smoke.sql
-- It re-runs 0117 twice with \i (re-runnable), sets room_creation_open for its rooms and puts it back; its accounts and
-- rooms are deleted at the end. Every check is an ASSERT.
--   1. The table is private; the read RPC is guarded and empty at first.
--   2. Another player in the room feels a spot within 48 px (the cast answers it); outside the radius not.
--   3. Rooms are isolated: the same cell in another room has no thính, nor its read RPC.
--   4. The read RPC: position, kind, name, stacks, time left, the first thrower's name, mine.
--   5. Refresh: the same kind within 48 px tops up the spot (+10 min, ≤ 20 min left, stacks ≤ 3), anyone may; a bag that
--      would add < 1 minute is refused ('spot full', nothing spent).
--   6. A different kind nearby is a separate spot; where they overlap the nearest centre (a tie: the newest) works.
--   7. Limits: ≤ 2 new spots per thrower ('spot limit'; a refresh is still allowed), ≤ 8 per room and map ('too many
--      spots'), another room unaffected.
--   8. Expiry: a spent spot works no more, is not listed, and is swept by the next throw there.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0117_groundbait_spots.sql
\i supabase/migrations/0117_groundbait_spots.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log';

create temp table gs (k text primary key, v text);
insert into gs select 'flag_rooms', enabled::text from public.app_flags where key = 'room_creation_open';
update public.app_flags set enabled = true where key = 'room_creation_open';
do $$
declare n text; r text;
begin
  foreach n in array array['a', 'b', 'c'] loop
    r := 'gs' || n || '_' || floor(random() * 1e9)::text;
    insert into gs select 't' || n, token from public.register(r, 'pw123456');
    insert into gs select n, public._auth_account((select v from gs where k = 't' || n))::text;
    insert into gs values ('name_' || n, r);
  end loop;
end $$;
insert into gs select 'room', room_id::text from public.create_room('ổ thính 1', 'pw', (select v from gs where k = 'ta'));
insert into gs select 'room2', room_id::text from public.create_room('ổ thính 2', 'pw', (select v from gs where k = 'tc'));
do $$
declare n text;
begin
  foreach n in array array['tb', 'tc'] loop
    perform public.join_room((select code from public.rooms where id = (select v from gs where k = 'room')::uuid), 'pw',
                             (select v from gs where k = n));
  end loop;
end $$;

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from gs where k = key $$;
create or replace function pg_temp.u(key text) returns uuid language sql stable as $$ select v::uuid from gs where k = key $$;
-- stand somewhere (an accepted claim an hour back)
create or replace function pg_temp.put(p uuid, p_map text, p_x integer, p_y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb
$$;
-- full vitals and stamina, 20 worms, 9 bags of each thính, no cast, standing on the pond's cell (col, row)
create or replace function pg_temp.fresh(p uuid, col integer default 37, rw integer default 25) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, starve_s = 0, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100, at = now();
  insert into public.inventory (account_id, item_id, qty)
  select p, i, case when i = 'bait_worm' then 20 else 9 end from unnest(array['bait_worm', 'gb_cam', 'gb_tom', 'gb_thom', 'gb_tanh']) i
  on conflict (account_id, item_id) do update set qty = excluded.qty;
  perform public._fishing_profile(p);
  delete from public.fish where account_id = p;
  delete from public.casts where account_id = p;
  perform pg_temp.put(p, 'pond', col * 8 + 4, rw * 8 + 4);
end $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlerrm;
end $$;
create or replace function pg_temp.bags(p uuid, p_item text) returns integer language sql stable as $$
  select coalesce((select qty from public.inventory where account_id = p and item_id = p_item), 0) $$;
create or replace function pg_temp.active(p_room uuid) returns bigint language sql stable as $$
  select count(*) from public.groundbait_spots where room_id = p_room and expires_at > now() $$;

-- a pond cell far (> 48 px) from Cầu ao's dock cell (37, 25), for "outside the radius"
insert into gs select 'far', c || ',' || r from generate_series(0, 79) c, generate_series(0, 49) r
 where public._pond_spot(c, r) is not null and ((c * 8 + 4) - 300) ^ 2 + ((r * 8 + 4) - 204) ^ 2 > 80 * 80
 order by ((c * 8 + 4) - 300) ^ 2 + ((r * 8 + 4) - 204) ^ 2 limit 1;

-- ---------- 1. Private; the read RPC ----------
do $$
begin
  assert not has_table_privilege('anon', 'public.groundbait_spots', 'select')
     and not has_table_privilege('authenticated', 'public.groundbait_spots', 'select'), 'the spots are private';
  assert not has_function_privilege('anon', 'public._groundbait_at(uuid, text, integer, integer, uuid)', 'execute'), '_groundbait_at private';
  assert has_function_privilege('anon', 'public.groundbait_spots(uuid, text, text)', 'execute'), 'the read RPC is the client''s';
  assert public.groundbait_spots(pg_temp.u('room'), pg_temp.v('ta')) = '[]'::jsonb, 'none yet';
  assert pg_temp.err(format('select public.groundbait_spots(%L, %L)', pg_temp.u('room'), 'nope')) <> 'no error', 'a bad token';
  assert pg_temp.v('far') is not null, 'a far pond cell';
  raise notice 'private ok';
end $$;

-- ---------- 2. Another player benefits within the radius, not outside ----------
do $$
declare a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); room uuid := pg_temp.u('room'); r jsonb; c jsonb;
        fc integer := split_part(pg_temp.v('far'), ',', 1)::int; fr integer := split_part(pg_temp.v('far'), ',', 2)::int;
begin
  perform pg_temp.fresh(a);
  r := public.throw_groundbait(room, pg_temp.v('ta'), 'gb_tom', 'pond', 37, 25);
  assert r->'groundbait'->>'item' = 'gb_tom' and (r->'groundbait'->>'x')::int = 300 and (r->'groundbait'->>'y')::int = 204
     and (r->'groundbait'->>'stacks')::int = 1 and not (r->'groundbait'->>'refreshed')::boolean, format('a new spot %s', r);
  assert pg_temp.bags(a, 'gb_tom') = 8, 'one bag spent';
  assert r->'state'->'groundbait_on'->>'item' = 'gb_tom', 'my newest spot in the state';
  assert public._groundbait_at(b, 'pond', 300, 204, room) = 'gb_tom', 'b feels a''s spot';
  assert public._groundbait_at(b, 'pond', 330, 230, room) = 'gb_tom', 'within 48 px';
  assert public._groundbait_at(b, 'pond', 349, 204, room) is null, 'outside 48 px';
  perform pg_temp.fresh(b);
  c := public.start_cast(room, pg_temp.v('tb'), 37, 25);
  assert c->>'groundbait' = 'gb_tom', format('b''s cast feels it %s', c);
  perform pg_temp.fresh(b, fc, fr);
  c := public.start_cast(room, pg_temp.v('tb'), fc, fr);
  assert c->'groundbait' = 'null'::jsonb, format('b''s cast far away does not (%s, %s): %s', fc, fr, c);
  delete from public.casts where account_id = b;
  raise notice 'shared ok';
end $$;

-- ---------- 3. Rooms are isolated ----------
do $$
declare c uuid := pg_temp.u('c'); room2 uuid := pg_temp.u('room2'); x jsonb;
begin
  assert public._groundbait_at(c, 'pond', 300, 204, room2) is null, 'not in the other room';
  assert public.groundbait_spots(room2, pg_temp.v('tc')) = '[]'::jsonb, 'nor listed there';
  perform pg_temp.fresh(c);
  x := public.start_cast(room2, pg_temp.v('tc'), 37, 25);
  assert x->'groundbait' = 'null'::jsonb, format('c''s cast in room 2 %s', x);
  delete from public.casts where account_id = c;
  raise notice 'rooms ok';
end $$;

-- ---------- 4. The read RPC ----------
do $$
declare room uuid := pg_temp.u('room'); l jsonb; s jsonb;
begin
  l := public.groundbait_spots(room, pg_temp.v('tb'));
  assert jsonb_array_length(l) = 1, format('one spot %s', l);
  s := l->0;
  assert s->>'item' = 'gb_tom' and s->>'name' = 'Thính tôm khô' and s->>'map' = 'pond' and (s->>'x')::int = 300 and (s->>'y')::int = 204
     and (s->>'stacks')::int = 1 and s->>'by' = pg_temp.v('name_a') and not (s->>'mine')::boolean, format('%s', s);
  assert (s->>'left_ms')::bigint between 9 * 60000 and 10 * 60000, format('about 10 minutes left %s', s);
  assert (public.groundbait_spots(room, pg_temp.v('ta'))->0->>'mine')::boolean, 'mine for a';
  assert public.groundbait_spots(room, pg_temp.v('ta'), 'song_cai') = '[]'::jsonb, 'by map';
  assert jsonb_array_length(public.groundbait_spots(room, pg_temp.v('ta'), 'pond')) = 1, 'the pond''s';
  raise notice 'read ok';
end $$;

-- ---------- 5. Refresh and stacks ----------
do $$
declare a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); room uuid := pg_temp.u('room'); r jsonb; id0 bigint;
begin
  select id into id0 from public.groundbait_spots where room_id = room and expires_at > now();
  perform pg_temp.fresh(b, 38, 25);                                     -- a cell next door: within 48 px of the spot
  r := public.throw_groundbait(room, pg_temp.v('tb'), 'gb_tom', 'pond', 38, 25);
  assert (r->'groundbait'->>'refreshed')::boolean and (r->'groundbait'->>'id')::bigint = id0
     and (r->'groundbait'->>'stacks')::int = 2 and (r->'groundbait'->>'x')::int = 300, format('b tops up a''s spot %s', r);
  assert pg_temp.active(room) = 1, 'still one spot';
  assert (select expires_at between now() + interval '19 minutes 50 seconds' and now() + interval '20 minutes 1 second'
            from public.groundbait_spots where id = id0), '10 left + 10 = 20 minutes (the cap)';
  assert (select thrown_by from public.groundbait_spots where id = id0) = a, 'the first thrower stays';
  assert pg_temp.bags(b, 'gb_tom') = 8, 'b spent a bag';
  -- at the cap: a bag would add nothing
  assert pg_temp.err(format('select public.throw_groundbait(%L, %L, %L, %L, 38, 25)', room, pg_temp.v('tb'), 'gb_tom', 'pond')) = 'spot full',
    'spot full';
  assert pg_temp.bags(b, 'gb_tom') = 8, 'nothing spent when full';
  update public.groundbait_spots set expires_at = now() + interval '5 minutes' where id = id0;
  r := public.throw_groundbait(room, pg_temp.v('tb'), 'gb_tom', 'pond', 38, 25);
  assert (r->'groundbait'->>'stacks')::int = 3, 'stacks 3';
  assert (select expires_at between now() + interval '14 minutes 50 seconds' and now() + interval '15 minutes 1 second'
            from public.groundbait_spots where id = id0), '5 left + 10';
  update public.groundbait_spots set expires_at = now() + interval '5 minutes' where id = id0;
  r := public.throw_groundbait(room, pg_temp.v('tb'), 'gb_tom', 'pond', 38, 25);
  assert (r->'groundbait'->>'stacks')::int = 3, 'stacks capped at 3';
  assert pg_temp.active(room) = 1, 'a refresh is never a new spot';
  raise notice 'refresh ok';
end $$;

-- ---------- 6. A different kind nearby ----------
do $$
declare a uuid := pg_temp.u('a'); room uuid := pg_temp.u('room'); r jsonb;
begin
  perform pg_temp.fresh(a, 39, 25);                                     -- 16 px east of the gb_tom spot
  r := public.throw_groundbait(room, pg_temp.v('ta'), 'gb_cam', 'pond', 39, 25);
  assert not (r->'groundbait'->>'refreshed')::boolean and (r->'groundbait'->>'x')::int = 316, format('a separate spot %s', r);
  assert pg_temp.active(room) = 2, 'two spots';
  assert public._groundbait_at(a, 'pond', 300, 204, room) = 'gb_tom', 'nearest: thính tôm at its centre';
  assert public._groundbait_at(a, 'pond', 316, 204, room) = 'gb_cam', 'nearest: thính cám at its centre';
  assert public._groundbait_at(a, 'pond', 364, 204, room) = 'gb_cam', 'only the cám reaches here';
  raise notice 'kinds ok';
end $$;

-- ---------- 7. Limits ----------
do $$
declare a uuid := pg_temp.u('a'); c uuid := pg_temp.u('c'); room uuid := pg_temp.u('room'); room2 uuid := pg_temp.u('room2');
        r jsonb; i integer;
begin
  -- a threw two spots first (tôm, cám): a third new one is refused, nothing spent; a refresh still goes
  perform pg_temp.fresh(a);
  assert pg_temp.err(format('select public.throw_groundbait(%L, %L, %L, %L, 37, 25)', room, pg_temp.v('ta'), 'gb_thom', 'pond')) = 'spot limit',
    'two spots per thrower';
  assert pg_temp.bags(a, 'gb_thom') = 9, 'nothing spent';
  update public.groundbait_spots set expires_at = now() + interval '2 minutes' where room_id = room and item = 'gb_tom';
  r := public.throw_groundbait(room, pg_temp.v('ta'), 'gb_tom', 'pond', 37, 25);
  assert (r->'groundbait'->>'refreshed')::boolean, 'a refresh is not a new spot';
  -- the room's pond holds 8: fill it to 8 (others' spots far apart), then c's new one is refused
  for i in 1 .. 6 loop
    insert into public.groundbait_spots (room_id, map, x, y, item, thrown_by, expires_at)
    values (room, 'pond', 1000 + i * 100, 1000, 'gb_tanh', null, now() + interval '5 minutes');
  end loop;
  assert pg_temp.active(room) = 8, 'eight';
  perform pg_temp.fresh(c);
  assert pg_temp.err(format('select public.throw_groundbait(%L, %L, %L, %L, 37, 25)', room, pg_temp.v('tc'), 'gb_thom', 'pond')) = 'too many spots',
    'eight per room and map';
  -- … but a refresh there is fine, and room 2 is not full
  r := public.throw_groundbait(room, pg_temp.v('tc'), 'gb_cam', 'pond', 37, 25);
  assert (r->'groundbait'->>'refreshed')::boolean and (r->'groundbait'->>'x')::int = 316, format('c tops up the cám %s', r);
  r := public.throw_groundbait(room2, pg_temp.v('tc'), 'gb_thom', 'pond', 37, 25);
  assert not (r->'groundbait'->>'refreshed')::boolean, 'room 2 has room';
  assert pg_temp.active(room2) = 1 and pg_temp.active(room) = 8, 'the rooms apart';
  assert public._groundbait_at(a, 'pond', 300, 204, room2) = 'gb_thom' and public._groundbait_at(a, 'pond', 300, 204, room) = 'gb_tom',
    'each room its own';
  raise notice 'limits ok';
end $$;

-- ---------- 8. Expiry ----------
do $$
declare a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); room uuid := pg_temp.u('room'); x jsonb;
begin
  update public.groundbait_spots set expires_at = now() - interval '1 second' where room_id = room;
  assert public._groundbait_at(b, 'pond', 300, 204, room) is null, 'spent';
  assert public.groundbait_spots(room, pg_temp.v('tb')) = '[]'::jsonb, 'not listed';
  perform pg_temp.fresh(b);
  x := public.start_cast(room, pg_temp.v('tb'), 37, 25);
  assert x->'groundbait' = 'null'::jsonb, format('the cast no more %s', x);
  delete from public.casts where account_id = b;
  -- spent a while: the next throw there sweeps them, and a has no spots left to count against the limit
  update public.groundbait_spots set expires_at = now() - interval '2 minutes' where room_id = room;
  perform pg_temp.fresh(a);
  x := public.throw_groundbait(room, pg_temp.v('ta'), 'gb_thom', 'pond', 37, 25);
  assert not (x->'groundbait'->>'refreshed')::boolean, 'new';
  assert (select count(*) from public.groundbait_spots where room_id = room) = 1, 'swept';
  raise notice 'expiry ok';
end $$;

-- ---------- Clean up ----------
delete from public.groundbait_spots where room_id in (pg_temp.u('room'), pg_temp.u('room2'));
delete from public.rooms where id in (pg_temp.u('room'), pg_temp.u('room2'));
delete from public.accounts where id in (pg_temp.u('a'), pg_temp.u('b'), pg_temp.u('c'));
update public.app_flags set enabled = (select v::boolean from gs where k = 'flag_rooms') where key = 'room_creation_open';
do $$ begin raise notice 'groundbait spots smoke ok'; end $$;
