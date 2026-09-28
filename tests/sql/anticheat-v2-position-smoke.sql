-- tests/sql/anticheat-v2-position-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0057,
-- from the repo root. It re-runs 0057 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
-- Time passing is simulated by moving player_pos.at back (each DO block is one transaction: now() stands still).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0057_server_position.sql
\i supabase/migrations/0057_server_position.sql
reset client_min_messages;

create temp table px (k text primary key, v text);
insert into px select 'ta', token from public.register('px_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into px select 'tb', token from public.register('px_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into px select 'a', public._auth_account(v)::text from px where k = 'ta';
insert into px select 'b', public._auth_account(v)::text from px where k = 'tb';
insert into px select 'room', room_id::text from public.create_room('Vị trí', 'pw', (select v from px where k = 'ta'));
select public.join_room((select code from public.rooms where id = (select v from px where k = 'room')::uuid), 'pw',
                        (select v from px where k = 'tb'));
update public.anticheat_config set mode = 'log';

-- put an account at (map, x, y), accepted `ago` seconds back, with no refusals and no skip
create or replace function pg_temp.put(p_acc text, p_map text, p_x integer, p_y integer, p_ago numeric) returns void
language sql as $$
  insert into public.player_pos (account_id, map, x, y, at, skip_at, bad_since, bad_count)
  values ((select v from px where k = p_acc)::uuid, p_map, p_x, p_y, now() - make_interval(secs => p_ago), null, null, 0)
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at,
    skip_at = null, bad_since = null, bad_count = 0
$$;
create or replace function pg_temp.pos(p_acc text) returns text language sql as $$
  select map || ':' || x || ',' || y from public.player_pos where account_id = (select v from px where k = p_acc)::uuid
$$;

-- ---------- 1. The geometry ----------
do $$
declare n numeric;
begin
  n := public._pos_need_s('hall', 0, 0, 'hall', 300, 400, 13.5);
  -- straight: (500 − 64) / 260 s; a hop out and back through a portal pair may shave its 40 px a hop off it
  assert n <= (500 - 64) / 260.0 + 0.001 and n >= (500 - 64 - 3 * 40) / 260.0 - 0.001, format('same map %s', n);
  assert public._pos_need_s('hall', 0, 0, 'hall', 30, 40, 13.5) = 0, 'within the slack';
  -- pond dock → Vựa cá Chợ Lớn: pond → hall → (road) → market
  n := public._pos_need_s('pond', 300, 204, 'market', 80, 360, 1.8);
  assert n > 1.8 and n < 4, format('pond → market by car %s', n);
  assert public._pos_need_s('pond', 300, 204, 'market', 80, 360, 13.5) > 13.5, 'on foot';
  assert public._pos_need_s('pond', 300, 204, 'khu_nha', 68, 208, 0) is not null, 'three hops';
  assert public._pos_need_s('ham_ngam', 48, 84, 'field', 60, 106, 0) is not null, 'the hầm to the field';
  assert public._pos_need_s('pond', 1, 1, 'moon', 1, 1, 0) is null, 'no path';
  assert (select count(*) from public._pos_portals()) = 14 and (select count(*) from public._pos_maps()) = 7, 'tables';
  raise notice 'geometry ok';
end $$;

-- ---------- 2. Claims: walk, teleport, time heals, the spawn, off the map ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid; j jsonb; n0 integer;
begin
  delete from public.player_pos where account_id = a;
  j := public.pos_report(t, 'pond', 300, 204);
  assert j = '{"ok": true}'::jsonb and pg_temp.pos('a') = 'pond:300,204', format('first claim %s', j);
  j := public.pos_report(t, 'pond', 500, 204);                                   -- 200 px at once: within 64 px + 1 s
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'pond:500,204', format('a short walk %s', j);
  n0 := (select count(*) from public.anticheat_events where account_id = a and code = 'pos_teleport');
  j := public.pos_report(t, 'market', 80, 360);                                  -- the market at once: refused, soft
  assert j->'anticheat'->>'code' = 'pos_teleport' and (j->'anticheat'->>'strike')::int = 0, format('teleport %s', j);
  assert pg_temp.pos('a') = 'pond:500,204', 'the position stays';
  assert (select count(*) from public.anticheat_events where account_id = a and code = 'pos_teleport' and outcome = 'soft') = n0 + 1,
    'soft event';
  assert (select bad_count from public.player_pos where account_id = a) = 1, 'counted';
  update public.player_pos set at = now() - interval '20 seconds' where account_id = a;     -- on foot the road takes 13.5 s
  j := public.pos_report(t, 'market', 80, 360);
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'market:80,360', format('after 20 s %s', j);
  j := public.pos_report(t, 'hall', 612, 300);                                   -- the hall's spawn: always
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'hall:612,300', format('spawn %s', j);
  j := public.pos_report(t, 'moon', 1, 1);
  assert j->'anticheat'->>'code' = 'pos_teleport' and j->'anticheat'->>'code' is not null, 'an unknown map';
  j := public.pos_report(t, 'hall', 9999, 1);
  assert j->'anticheat'->>'code' = 'pos_teleport', 'off the map';
  assert pg_temp.pos('a') = 'hall:612,300', 'unchanged';
  raise notice 'claims ok';
end $$;

-- ---------- 3. The road: own vehicles, a paid skip, a ride ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid;
        tb text := (select v from px where k = 'tb'); b uuid := (select v from px where k = 'b')::uuid; j jsonb;
begin
  delete from public.owned_vehicles where account_id in (a, b);
  -- on foot, 3 s after the hall's market sign: refused
  perform pg_temp.put('a', 'hall', 604, 200, 3);
  j := public.pos_report(t, 'market', 72, 252);
  assert j ? 'anticheat', format('on foot in 3 s %s', j);
  -- with a car: 1.8 s
  insert into public.owned_vehicles (account_id, vehicle_id) values (a, 'car');
  perform pg_temp.put('a', 'hall', 604, 200, 3);
  j := public.pos_report(t, 'market', 72, 252);
  assert j->>'ok' = 'true', format('by car in 3 s %s', j);
  perform pg_temp.put('a', 'hall', 604, 200, 0.5);
  j := public.pos_report(t, 'market', 72, 252);
  assert j ? 'anticheat', format('by car in 0.5 s %s', j);
  delete from public.owned_vehicles where account_id = a;
  -- a paid skip: the road takes no time
  insert into public.wallets (account_id, coins) values (a, 100) on conflict (account_id) do update set coins = 100;
  perform pg_temp.put('a', 'hall', 604, 200, 0);
  perform public.skip_trip(t);
  j := public.pos_report(t, 'market', 72, 252);
  assert j->>'ok' = 'true', format('after a skip %s', j);
  -- a ride: b (with a car) arrived on the market after a's last claim
  insert into public.owned_vehicles (account_id, vehicle_id) values (b, 'car');
  perform pg_temp.put('a', 'hall', 604, 200, 3);
  perform pg_temp.put('b', 'hall', 604, 200, 3);
  j := public.pos_report(tb, 'market', 72, 252);
  assert j->>'ok' = 'true', format('the driver %s', j);
  j := public.pos_report(t, 'market', 72, 252);
  assert j->>'ok' = 'true', format('the passenger %s', j);
  delete from public.owned_vehicles where account_id = b;
  raise notice 'road ok';
end $$;

-- ---------- 4. Repeated teleports: the 30th refusal within the hour is a hard flag ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid; j jsonb;
begin
  perform pg_temp.put('a', 'pond', 300, 204, 0);
  update public.player_pos set bad_since = now() - interval '10 minutes', bad_count = 28 where account_id = a;
  j := public.pos_report(t, 'khu_nha', 400, 200);
  assert j->'anticheat'->>'code' = 'pos_teleport', format('29th %s', j);
  j := public.pos_report(t, 'khu_nha', 400, 200);
  assert j->'anticheat'->>'code' = 'pos_teleport_repeat', format('30th %s', j);
  assert exists (select 1 from public.anticheat_events where account_id = a and code = 'pos_teleport_repeat' and outcome = 'log_only'),
    'hard (log mode)';
  -- an hour later the count starts again
  update public.player_pos set bad_since = now() - interval '61 minutes' where account_id = a;
  j := public.pos_report(t, 'khu_nha', 400, 200);
  assert (select bad_count from public.player_pos where account_id = a) = 1, 'a new hour';
  raise notice 'repeat ok';
end $$;

-- ---------- 5. The market depots: only on Chợ Lớn ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid; j jsonb; f uuid;
        c0 integer; ok boolean := false;
begin
  update public.wallets set coins = 100 where account_id = a;
  insert into public.fish (account_id, species_id, weight_g, price)
  values (a, (select id from public.fish_species order by id limit 1), 500, 50) returning id into f;
  perform pg_temp.put('a', 'pond', 300, 204, 0);
  j := public.sell_fish_market(t, array[f]);
  assert j->'anticheat'->>'error' = 'not at market' and (j->'anticheat'->>'strike')::int = 0, format('from the pond %s', j);
  assert exists (select 1 from public.fish where id = f) and (select coins from public.wallets where account_id = a) = 100,
    'nothing sold';
  update public.player_pos set at = now() - interval '60 seconds' where account_id = a;
  j := public.sell_fish_market(t, array[f]);
  assert (j->>'sold')::int = 1 and (j->>'earned')::int = 60, format('at the market %s', j);
  assert pg_temp.pos('a') = 'market:80,360', 'the sale is a claim at the counter';
  -- the farm depot: refused from afar, else on to its own checks
  perform pg_temp.put('a', 'field', 744, 344, 0);
  j := public.sell_rice_market(t, 'nope', true, 1);
  assert j->'anticheat'->>'error' = 'not at market', format('rice from the field %s', j);
  j := public.sell_produce_market(t, 'nope', 1);
  assert j->'anticheat'->>'error' = 'not at market', format('produce from the field %s', j);
  update public.player_pos set at = now() - interval '60 seconds' where account_id = a;
  begin perform public.sell_rice_market(t, 'nope', true, 1); exception when others then ok := sqlerrm = 'invalid variety'; end;
  assert ok, 'past the claim: the old checks';
  raise notice 'market ok';
end $$;

-- ---------- 6. Casting and throwing from the pond only; a cast needs its cell ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid;
        r uuid := (select v from px where k = 'room')::uuid; j jsonb; ok boolean := false;
begin
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  delete from public.fish where account_id = a;
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 5)
  on conflict (account_id, item_id) do update set qty = 5;
  insert into public.inventory (account_id, item_id, qty, durability) values (a, 'net_small', 1, 20)
  on conflict (account_id, item_id) do update set qty = 1, durability = 20;
  update public.vitals set hunger = 80, thirst = 80, starve_s = 0, fainted_until = null, last_tick = now() where account_id = a;
  perform pg_temp.put('a', 'market', 640, 200, 0);
  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  assert j->'anticheat'->>'error' = 'too far', format('cast from the market %s', j);
  assert (select qty from public.inventory where account_id = a and item_id = 'bait_worm') = 5, 'no bait spent';
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  assert j->'anticheat'->>'error' = 'too far', format('net from the market %s', j);
  begin perform public.start_cast(r, t); exception when others then ok := sqlerrm = 'bad spot'; end;
  assert ok, 'a cast without a cell';
  update public.player_pos set at = now() - interval '60 seconds' where account_id = a;
  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  assert j ? 'cast_id', format('cast at the pond %s', j);
  assert pg_temp.pos('a') = 'pond:' || (252 / 8 * 8 + 4) || ',' || (204 / 8 * 8 + 4), 'the cast is a claim at its cell';
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  assert j ? 'throw_id', format('net at the pond %s', j);
  raise notice 'cast ok';
end $$;

-- ---------- 7. The heartbeat: the shade from the server's position ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid;
        r uuid := (select v from px where k = 'room')::uuid; j jsonb;
begin
  delete from public.room_weather where room_id = r;
  perform public.set_room_weather(r, t, 0, true, null, null, 0, 5, 36.5);
  update public.heat_state set outdoor_since = null, immune_until = null, swimming = false, cramp_until = null where account_id = a;
  perform pg_temp.put('a', 'market', 140, 176, 60);
  j := public.vitals_tick(t, r, 'market', 140, 176);                               -- in the porch's shade
  assert (select outdoor_since from public.heat_state where account_id = a) is null, 'shade';
  j := public.vitals_tick(t, r, 'pond', 100, 300);                                 -- the pond at once: refused, still shade
  assert pg_temp.pos('a') = 'market:140,176', 'the claim was refused';
  assert (select outdoor_since from public.heat_state where account_id = a) is null, 'judged at the server position';
  update public.player_pos set at = now() - interval '60 seconds' where account_id = a;
  j := public.vitals_tick(t, r, 'pond', 100, 300);
  assert pg_temp.pos('a') = 'pond:100,300' and (select outdoor_since from public.heat_state where account_id = a) is not null,
    'outdoors once there';
  -- no position known at all: outdoors
  delete from public.player_pos where account_id = a;
  update public.heat_state set outdoor_since = null where account_id = a;
  j := public.vitals_tick(t, r);
  assert (select outdoor_since from public.heat_state where account_id = a) is not null, 'unknown = outdoors';
  delete from public.room_weather where room_id = r;
  raise notice 'heartbeat ok';
end $$;

-- ---------- 8. Rescue: the victim must be near the rescuer ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid;
        b uuid := (select v from px where k = 'b')::uuid; r uuid := (select v from px where k = 'room')::uuid; j jsonb;
        ok boolean := false; c integer; w integer;
begin
  select x, y into c, w from generate_series(0, 79) x, generate_series(0, 49) y where public._pond_spot(x, y) is not null
   order by x, y limit 1;
  update public.vitals set hunger = 80, thirst = 80, starve_s = 0, fainted_until = null, last_tick = now() where account_id = a;
  perform public._heat_row(b);
  -- the victim far across the pond
  update public.heat_state set cramp_until = now() + interval '10 seconds', cramp_room = r, swimming = true where account_id = b;
  perform pg_temp.put('b', 'pond', 600, 50, 0);
  perform pg_temp.put('a', 'pond', c * 8 + 4, w * 8 + 4, 60);
  begin perform public.rescue_swimmer(r, t, b, c, w); exception when others then ok := sqlerrm = 'too far'; end;
  assert ok, 'a remote rescue';
  assert (select cramp_until from public.heat_state where account_id = b) is not null, 'still cramping';
  -- the victim beside the rescuer
  perform pg_temp.put('b', 'pond', c * 8 + 20, w * 8 + 4, 0);
  j := public.rescue_swimmer(r, t, b, c, w);
  assert j->>'rescued' = b::text, format('rescued %s', j);
  -- a rescuer who claims a cell it cannot have reached: the envelope
  update public.heat_state set cramp_until = now() + interval '10 seconds', cramp_room = r where account_id = b;
  perform pg_temp.put('a', 'market', 640, 200, 0);
  j := public.rescue_swimmer(r, t, b, c, w);
  assert j->'anticheat'->>'error' = 'too far', format('rescuer teleport %s', j);
  -- jump_in claims its cell too
  j := public.jump_in(r, t, c, w);
  assert j->'anticheat'->>'error' = 'too far', format('jump from the market %s', j);
  update public.heat_state set cramp_until = null, cramp_room = null, swimming = false where account_id = b;
  raise notice 'rescue ok';
end $$;

-- ---------- 9. The drain by real time (up to 30 min a gap) ----------
do $$
declare a uuid := (select v from px where k = 'a')::uuid; v public.vitals;
begin
  update public.vitals set hunger = 80, thirst = 80, starve_s = 0, fainted_until = null, last_tick = now() - interval '1000 seconds'
   where account_id = a;
  v := public._vitals_apply(a);
  assert abs((80 - v.hunger) - 1000 * 100.0 / 86400) < 0.001, format('1000 s: %s', v.hunger);
  update public.vitals set hunger = 80, last_tick = now() - interval '5 hours' where account_id = a;
  v := public._vitals_apply(a, 1);
  assert abs((80 - v.hunger) - 1800 * 100.0 / 86400) < 0.001, format('capped at 1800 s: %s', v.hunger);
  update public.vitals set hunger = 80, last_tick = now() - interval '5 hours' where account_id = a;
  v := public._vitals_apply(a, 1, 1);
  assert abs((80 - v.hunger) - 1800 * 100.0 / 86400) < 0.001, format('3-arg capped: %s', v.hunger);
  raise notice 'drain ok';
end $$;

-- ---------- 10. Privileges ----------
do $$
begin
  assert has_function_privilege('anon', 'public.pos_report(text, text, integer, integer)', 'execute'), 'pos_report public';
  assert not has_function_privilege('anon', 'public._pos_claim(uuid, text, integer, integer, text, uuid, text)', 'execute')
     and not has_function_privilege('anon', 'public._pos_need_s(text, integer, integer, text, integer, integer, numeric)', 'execute')
     and not has_function_privilege('anon', 'public._pos_road_s(uuid, text, timestamptz, timestamptz)', 'execute'), 'helpers private';
  assert not has_table_privilege('anon', 'public.player_pos', 'select'), 'the table is private';
  raise notice 'privileges ok';
end $$;

select 'anticheat v2 position smoke ok';
