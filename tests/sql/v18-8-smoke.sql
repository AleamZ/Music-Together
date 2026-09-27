-- tests/sql/v18-8-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0029 (see the plan),
-- from the repo root: it re-runs 0030 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0030_weather.sql
reset client_min_messages;

create temp table wx (k text primary key, v text);
insert into wx select 'owner', token from public.register('wx_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into wx select 'guest', token from public.register('wx_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into wx select 'room', room_id::text from public.create_room('Trời mưa', 'pw', (select v from wx where k = 'owner'));
insert into wx select 'room3', room_id::text from public.create_room('Sâu bệnh', 'pw', (select v from wx where k = 'owner'));
insert into wx select 'room2', room_id::text from public.create_room('Phòng khác', 'pw', (select v from wx where k = 'owner'));
select public.join_room((select code from public.rooms where id = (select v from wx where k = 'room')::uuid), 'pw',
                        (select v from wx where k = 'guest'));

-- 1) owner only
do $$ declare r uuid := (select v from wx where k = 'room'); g text := (select v from wx where k = 'guest'); ok boolean := false; begin
  begin perform public.set_room_weather(r, g, 0, true, null, null, 0, 5); exception when others then ok := sqlerrm = 'not owner'; end;
  assert ok, 'not owner';
end $$;
-- 2) invalid weather: an unknown code, rain and wind out of range
do $$ declare r uuid := (select v from wx where k = 'room'); t text := (select v from wx where k = 'owner'); n int := 0; begin
  begin perform public.set_room_weather(r, t, 5, true, null, null, 0, 5); exception when others then n := n + (sqlerrm = 'invalid weather')::int; end;
  begin perform public.set_room_weather(r, t, 61, true, null, null, 201, 5); exception when others then n := n + (sqlerrm = 'invalid weather')::int; end;
  begin perform public.set_room_weather(r, t, 61, true, null, null, 1, 301); exception when others then n := n + (sqlerrm = 'invalid weather')::int; end;
  assert n = 3, 'invalid weather x3';
  assert not exists (select 1 from public.room_weather where room_id = r), 'nothing stored';
end $$;
-- 3) the owner sets it; a second call within 10 min is too soon; rain + wind 60 is a storm
do $$ declare r uuid := (select v from wx where k = 'room'); t text := (select v from wx where k = 'owner'); j jsonb; ok boolean := false; begin
  j := public.set_room_weather(r, t, 63, true, now() - interval '6 hours', now() + interval '6 hours', 2.5, 12);
  assert j->>'kind' = 'rain' and (j->>'code')::int = 63 and not (j->>'stale')::boolean, 'rain stored';
  begin perform public.set_room_weather(r, t, 0, true, null, null, 0, 5); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'too soon';
  update public.room_weather set updated_at = now() - interval '11 minutes' where room_id = r;
  j := public.set_room_weather(r, t, 61, true, null, null, 1, 60);
  assert j->>'kind' = 'storm', 'windy rain is a storm';
  assert (select storm_since is not null from public.room_weather where room_id = r), 'spell started';
  assert public._weather_kind(0, 80) = 'clear' and public._weather_kind(95, 10) = 'thunder'
     and public._weather_kind(75, 0) = 'cloudy' and public._weather_kind(100, 0) is null, 'kind map';
  -- the guest reads it
  j := public.room_weather_state(r, (select v from wx where k = 'guest'));
  assert j->>'kind' = 'storm', 'member reads state';
end $$;
-- 4) stale after 3 h → cloudy day
do $$ declare r uuid := (select v from wx where k = 'room'); j jsonb; begin
  update public.room_weather set updated_at = now() - interval '3 hours 1 minute' where room_id = r;
  j := public.room_weather_state(r, (select v from wx where k = 'owner'));
  assert j->>'kind' = 'cloudy' and (j->>'stale')::boolean and (j->>'is_day')::boolean, 'stale → cloudy';
  assert (public._room_weather(gen_random_uuid())).kind = 'cloudy', 'missing → cloudy';
end $$;
-- 5) a storm closes the dock
do $$ declare r uuid := (select v from wx where k = 'room'); ok boolean := false; begin
  update public.room_weather set kind = 'storm', code = 99, updated_at = now() where room_id = r;
  begin perform public.start_cast(r, (select v from wx where k = 'owner')); exception when others then ok := sqlerrm = 'storm'; end;
  assert ok, 'storm refuses casting';
end $$;
-- 6) rain: fewer bites (the bite wait is divided by 0.7)
do $$ declare r uuid := (select v from wx where k = 'room'); fx jsonb; j jsonb; bmin int; begin
  update public.room_weather set kind = 'rain', code = 63, updated_at = now() where room_id = r;
  fx := public._room_effects(r);
  assert (fx->>'bite')::numeric = 0.7 and (fx->>'bigRare')::numeric = 1.5, 'rain effects';
  perform public._fishing_profile(public._auth_account((select v from wx where k = 'owner')));
  update public.fishing_profiles set bait = 'bait_worm' where account_id = public._auth_account((select v from wx where k = 'owner'));
  insert into public.inventory (account_id, item_id, qty)
  values (public._auth_account((select v from wx where k = 'owner')), 'bait_worm', 5)
  on conflict (account_id, item_id) do update set qty = 5;
  j :=public.start_cast(r, (select v from wx where k = 'owner'));
  select coalesce(s.bite_min_ms, 3000) into bmin from public.shop_items s
   where s.id = (j->'state'->'loadout'->>'bobber');
  assert (j->>'bite_ms')::int >= round(bmin / 0.7), 'rain bite wait longer';
  assert (public._weather_effects('clear', false)->>'growth')::numeric = 0, 'night no growth';
end $$;
-- 7) drying: no progress in rain, faster in sun
do $$ declare r uuid := (select v from wx where k = 'room'); a uuid := public._auth_account((select v from wx where k = 'owner'));
        t0 timestamptz := date_trunc('second', now()) + interval '2 hours'; t1 timestamptz; begin
  perform public._field_init(r);
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at) values (r, 1, a, 'short', 10, t0);
  update public.room_weather set kind = 'rain', is_day = true, updated_at = now(), accrued_at = now() - interval '1 hour' where room_id = r;
  perform public._field_open(r, now());
  select ready_at into t1 from public.drying_slots where room_id = r and slot = 1;
  assert abs(extract(epoch from t1 - (t0 + interval '1 hour'))) <= 2, 'rain: ready_at moved by the hour';
  update public.room_weather set kind = 'clear', accrued_at = now() - interval '1 hour' where room_id = r;
  perform public._field_open(r, now());
  assert abs(extract(epoch from (select ready_at from public.drying_slots where room_id = r and slot = 1) - (t1 - interval '30 minutes'))) <= 2,
    'clear: half an hour gained';
  delete from public.drying_slots where room_id = r;
end $$;
-- 8) growth: at night a crop does not age; storm loss applies once per spell
do $$ declare r uuid := (select v from wx where k = 'room'); a uuid := public._auth_account((select v from wx where k = 'owner'));
        tp timestamptz := date_trunc('second', now()) - interval '10 hours'; c public.crops; k0 int; k1 int; begin
  update public.field_plots set owner_id = a, owned_at = now() where room_id = r and plot_no = (select min(plot_no) from public.field_plots where room_id = r and kind = 'private');
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at)
  select r, fp.plot_no, a, 'short', tp - interval '30 hours', tp - interval '26 hours', tp - interval '16 hours', tp
    from public.field_plots fp where fp.room_id = r and fp.owner_id = a;
  update public.room_weather set kind = 'cloudy', is_day = false, updated_at = now(), accrued_at = now() - interval '1 hour' where room_id = r;
  perform public._field_open(r, now());
  select * into c from public.crops where room_id = r and farmer_id = a;
  assert abs(extract(epoch from c.transplant_at - (tp + interval '1 hour'))) <= 2, 'night: transplant_at moved 1 h';
  assert c.sow_at - c.soak_at = interval '10 hours', 'intervals kept';
  -- ripe it, then a storm spell
  update public.crops set transplant_at = now() - interval '44 hours', sow_at = now() - interval '60 hours',
                          soak_at = now() - interval '70 hours' where room_id = r and farmer_id = a;
  select * into c from public.crops where room_id = r and farmer_id = a;
  k0 := (public._crop_yield(c, public._variety('short'), 1.0, 1.0, now())->>'kg')::int;
  update public.room_weather set kind = 'storm', is_day = true, updated_at = now(), accrued_at = now(),
                                 storm_since = now() - interval '5 minutes' where room_id = r;
  perform public._field_open(r, now());
  perform public._field_open(r, now());
  select * into c from public.crops where room_id = r and farmer_id = a;
  assert c.weather_loss = 0.25, 'storm loss once: ' || c.weather_loss;
  k1 := (public._crop_yield(c, public._variety('short'), 1.0, 1.0, now())->>'kg')::int;
  assert k1 < k0, 'yield reduced';
end $$;
-- 9) thirst drains faster in clear weather; a room the account is not in counts as rate 1
do $$ declare r uuid := (select v from wx where k = 'room'); t text := (select v from wx where k = 'owner');
        g text := (select v from wx where k = 'guest'); a uuid := public._auth_account(t); j jsonb; base numeric; begin
  update public.room_weather set kind = 'clear', is_day = true, updated_at = now() where room_id = r;
  update public.vitals set thirst = 100, hunger = 100, fainted_until = null, starve_s = 0, last_tick = now() - interval '100 seconds'
   where account_id = a;
  j := public.vitals_tick(t, r);
  base := 100 - 100 * 100.0 / 57600;
  assert abs((j->>'thirst')::numeric - (100 - 100 * 100.0 / 57600 * 1.3)) < 0.01, 'clear thirst x1.3: ' || (j->>'thirst');
  update public.vitals set thirst = 100, last_tick = now() - interval '100 seconds' where account_id = a;
  j := public.vitals_tick(t, null);
  assert abs((j->>'thirst')::numeric - base) < 0.01, 'no room rate 1';
  assert to_regprocedure('public.vitals_tick(text)') is null, 'legacy 1-arg tick dropped';
  update public.vitals set thirst = 100, last_tick = now() - interval '100 seconds'
   where account_id = public._auth_account(g);
  perform public._vitals_apply(public._auth_account(g));
  update public.vitals set thirst = 100, last_tick = now() - interval '100 seconds' where account_id = public._auth_account(g);
  j := public.vitals_tick(g, (select v from wx where k = 'room2')::uuid);
  assert abs((j->>'thirst')::numeric - base) < 0.01, 'non-member room rate 1';
end $$;
-- 10) grants
do $$ begin
  assert has_function_privilege('anon', 'public.set_room_weather(uuid, text, integer, boolean, timestamptz, timestamptz, numeric, numeric)', 'execute'), 'set granted';
  assert has_function_privilege('anon', 'public.room_weather_state(uuid, text)', 'execute'), 'state granted';
  assert has_function_privilege('anon', 'public.vitals_tick(text, uuid)', 'execute'), 'tick(room) granted';
  assert not has_function_privilege('anon', 'public._weather_sweep(uuid, timestamptz)', 'execute'), 'sweep private';
  assert not has_function_privilege('anon', 'public._vitals_apply(uuid, numeric)', 'execute'), 'apply private';
end $$;
-- 11) the weather shift runs before _field_sweep: a batch that would be auto-collected on its old ready_at is pushed back
do $$ declare r uuid := (select v from wx where k = 'room'); a uuid := public._auth_account((select v from wx where k = 'owner')); begin
  delete from public.drying_slots where room_id = r;
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at)
  values (r, 2, a, 'short', 10, now() - interval '24 hours 10 minutes');
  update public.room_weather set kind = 'rain', is_day = true, updated_at = now() - interval '2 hours',
                                 accrued_at = now() - interval '26 hours' where room_id = r;
  perform public._field_open(r, now());
  assert exists (select 1 from public.drying_slots where room_id = r and slot = 2 and ready_at > now() - interval '24 hours'),
    'shifted before the sweep collects';
  delete from public.drying_slots where room_id = r;
end $$;
-- 12) set_room_weather checks the rate limit under the weather row's lock (row locked before the updated_at check)
do $$ declare d text := pg_get_functiondef('public.set_room_weather(uuid, text, integer, boolean, timestamptz, timestamptz, numeric, numeric)'::regprocedure); begin
  assert position('for update' in d) > 0 and position('for update' in d) < position('too soon' in d), 'lock before the check';
  assert position('on conflict (room_id) do nothing' in d) > 0, 'placeholder row';
end $$;
-- 13) pest stamps: evaluated after the shift (a slot pushed past now is not stamped), and a late sweep stamps a slot
--     due while the report was live with its multiplier and a slot due after the stale cutoff with 1
do $$ declare r uuid := (select v from wx where k = 'room3'); a uuid := public._auth_account((select v from wx where k = 'owner'));
        tp timestamptz; c public.crops; begin
  perform public._field_init(r);
  update public.field_plots set owner_id = a, owned_at = now()
   where room_id = r and plot_no = (select min(plot_no) from public.field_plots where room_id = r and kind = 'private');
  -- night, 1 h: slot 1 at u 0.5 is due at T + 3.6 h = now − 30 min before the shift, now + 30 min after it
  tp := date_trunc('second', now()) - interval '4 hours 6 minutes';
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, pest_rolls)
  select r, fp.plot_no, a, 'short', tp - interval '30 hours', tp - interval '26 hours', tp - interval '16 hours', tp,
         '[{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}]'::jsonb
    from public.field_plots fp where fp.room_id = r and fp.owner_id = a;
  insert into public.room_weather (room_id, code, kind, is_day, updated_at, accrued_at)
  values (r, 3, 'cloudy', false, now(), now() - interval '1 hour');
  perform public._field_open(r, now());
  select * into c from public.crops where room_id = r and farmer_id = a;
  assert not (c.pest_rolls->0 ? 'w'), 'not stamped: due moved past now';
  -- late sweep: rain reported 5 h ago (stale 2 h ago), last run 6 h ago; slot A due ≈ now − 4 h 54, slot B ≈ now − 1 h 24
  tp := date_trunc('second', now()) - interval '4 hours 30 minutes';
  update public.crops set transplant_at = tp, sow_at = tp - interval '16 hours', soak_at = tp - interval '26 hours',
         pest_rolls = '[{"slot": 1, "u_time": 0, "u_kind": 0.5, "u_hit": 0.99}, {"slot": 1, "u_time": 0.4861, "u_kind": 0.5, "u_hit": 0.99}]'::jsonb
   where room_id = r and farmer_id = a;
  update public.room_weather set kind = 'rain', is_day = true, updated_at = now() - interval '5 hours',
                                 accrued_at = now() - interval '6 hours' where room_id = r;
  perform public._field_open(r, now());
  select * into c from public.crops where room_id = r and farmer_id = a;
  assert (c.pest_rolls->0->>'w')::numeric = 1.5, 'live-period slot: rain multiplier ' || (c.pest_rolls->0)::text;
  assert (c.pest_rolls->1->>'w')::numeric = 1, 'post-stale slot: 1 ' || (c.pest_rolls->1)::text;
end $$;
\echo v18.8 smoke ok