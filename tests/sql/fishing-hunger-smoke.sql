-- tests/sql/fishing-hunger-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0047, from the
-- repo root. Re-runs 0047 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\i supabase/migrations/0047_fishing_hunger.sql
\i supabase/migrations/0047_fishing_hunger.sql
reset client_min_messages;

create temp table hs (k text primary key, v text);
insert into hs select 't', token from public.register('fh_' || floor(random() * 1e9)::text, 'pw123456');
insert into hs select 'a', public._auth_account(v)::text from hs where k = 't';
insert into hs select 'room', room_id::text from public.create_room('Fishing hunger', 'pw', (select v from hs where k = 't'));

-- 1. no hourly or daily cap: 350 casts in a row (bars refilled each time), counters untouched
do $$
declare t text := (select v from hs where k = 't'); a uuid := (select v from hs where k = 'a')::uuid;
        room uuid := (select v from hs where k = 'room')::uuid; c jsonb;
begin
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  for i in 1 .. 350 loop
    insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 20)
    on conflict (account_id, item_id) do update set qty = 20;
    update public.vitals set hunger = 100, thirst = 100, last_tick = now() where account_id = a;
    c := public.start_cast(room, t);
    assert c ? 'cast_id', format('cast %s: %s', i, c);
  end loop;
  assert (select coalesce(window_casts, 0) = 0 and coalesce(day_casts, 0) = 0 from public.fishing_profiles where account_id = a),
    'the cap counters are no longer bumped';
  assert not exists (select 1 from public.anticheat_events where account_id = a and code = 'cast_daily_cap'), 'no cap flag';
  -- even with the old counters maxed out, a cast goes through
  update public.fishing_profiles set window_start = now(), window_casts = 40, day_on = public._vn_today(), day_casts = 300
   where account_id = a;
  c := public.start_cast(room, t);
  assert c ? 'cast_id', 'maxed old counters do not block';
  raise notice '350+ casts ok';
end $$;

-- 2. each cast costs hunger 1.8 / thirst 2.2, returned at once; clamped at 0
do $$
declare t text := (select v from hs where k = 't'); a uuid := (select v from hs where k = 'a')::uuid;
        room uuid := (select v from hs where k = 'room')::uuid; c jsonb; v public.vitals;
begin
  update public.vitals set hunger = 50, thirst = 50, last_tick = now() where account_id = a;
  c := public.start_cast(room, t);
  select * into v from public.vitals where account_id = a;
  assert v.hunger between 48.19 and 48.2 and v.thirst between 47.79 and 47.8, format('after a cast %s / %s', v.hunger, v.thirst);
  assert abs((c->'vitals'->>'hunger')::numeric - v.hunger) < 0.001 and abs((c->'vitals'->>'thirst')::numeric - v.thirst) < 0.001,
    format('answer vitals %s', c->'vitals');
  update public.vitals set hunger = 1, thirst = 1, last_tick = now() where account_id = a;
  c := public.start_cast(room, t);
  select * into v from public.vitals where account_id = a;
  assert v.hunger = 0 and v.thirst = 0, format('clamped %s / %s', v.hunger, v.thirst);
  -- 3. at 0 the guard refuses (hunger first)
  begin
    c := public.start_cast(room, t);
    assert false, 'expected too hungry';
  exception when sqlstate '53400' then
    assert sqlerrm = 'too hungry', sqlerrm;
  end;
  update public.vitals set hunger = 50, thirst = 0, starve_s = 0, last_tick = now() where account_id = a;
  begin
    c := public.start_cast(room, t);
    assert false, 'expected too thirsty';
  exception when sqlstate '53400' then
    assert sqlerrm = 'too thirsty', sqlerrm;
  end;
  -- a refused cast costs nothing
  select * into v from public.vitals where account_id = a;
  assert v.hunger > 49.9, format('refusal cost %s', v.hunger);
  raise notice 'cast vitals ok';
end $$;

-- 4. a net throw costs hunger 3 / thirst 3.5, no cap
do $$
declare t text := (select v from hs where k = 't'); a uuid := (select v from hs where k = 'a')::uuid;
        room uuid := (select v from hs where k = 'room')::uuid; c jsonb; v public.vitals; n text; cc integer; rr integer;
begin
  select id into n from public.shop_items where kind = 'net' order by id limit 1;
  assert n is not null, 'a net exists';
  select x, y into cc, rr from generate_series(0, 200) x, generate_series(0, 200) y
   where public._pond_spot(x, y) is not null limit 1;
  assert cc is not null, 'a pond cell exists';
  delete from public.fish where account_id = a;
  update public.fishing_profiles set window_start = now(), window_casts = 40, day_on = public._vn_today(), day_casts = 300
   where account_id = a;
  insert into public.inventory (account_id, item_id, qty, durability) values (a, n, 1, 50)
  on conflict (account_id, item_id) do update set qty = 1, durability = 50;
  update public.vitals set hunger = 50, thirst = 50, starve_s = 0, last_tick = now() where account_id = a;
  c := public.start_net(room, t, cc, rr, n);
  select * into v from public.vitals where account_id = a;
  assert v.hunger between 46.99 and 47 and v.thirst between 46.49 and 46.5, format('after a net %s / %s', v.hunger, v.thirst);
  assert c ? 'throw_id' and abs((c->'vitals'->>'hunger')::numeric - v.hunger) < 0.001, format('net answer %s', c);
  raise notice 'net vitals ok';
end $$;

select 'fishing hunger smoke ok';
