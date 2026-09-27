-- tests/sql/v18-1-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0030 (see the plan),
-- from the repo root: it re-runs 0031 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- Do not run v18-8-smoke after this file: it re-creates the 2-argument start_cast of 0030.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0031_pond_life.sql
\i supabase/migrations/0031_pond_life.sql
reset client_min_messages;

create temp table pl (k text primary key, v text);
insert into pl select 'tok', token from public.register('pl_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into pl select 'room', room_id::text from public.create_room('Ao sống', 'pw', (select v from pl where k = 'tok'));

-- 1) the pond's spots: the six docks (pond.ts POND_FISH_SPOTS), a shore cell, water, grass away from water, a solid
do $$ begin
  assert public._pond_spot(252 / 8, 204 / 8) = 'dock' and public._pond_spot(300 / 8, 204 / 8) = 'dock'
     and public._pond_spot(348 / 8, 204 / 8) = 'dock' and public._pond_spot(206 / 8, 212 / 8) = 'dock'
     and public._pond_spot(394 / 8, 212 / 8) = 'dock' and public._pond_spot(292 / 8, 262 / 8) = 'dock', 'docks';
  assert public._pond_spot(37, 10) is null, 'water';                   -- (300, 84): inside the pond
  assert public._pond_spot(2, 30) is null, 'far grass';
  assert public._pond_spot(70, 10) is null, 'solid (the depot stall)';
  assert public._pond_spot(-1, 3) is null and public._pond_spot(80, 3) is null and public._pond_spot(null, 3) is null, 'bounds';
  assert (select count(*) from generate_series(0, 79) c, generate_series(0, 49) r where public._pond_spot(c, r) = 'shore') > 40,
    'a ring of shore cells';
end $$;

-- 2) the overboard table: wear 3, hunger 10, the rod lost under 0.1 — never rod_wood
do $$ begin
  assert public._overboard_outcome('rod_bamboo', 0.05) = '{"wear": 3, "hunger": 10, "rod_lost": true}'::jsonb, 'lost at 0.05';
  assert not (public._overboard_outcome('rod_bamboo', 0.1)->>'rod_lost')::boolean, 'kept at 0.1';
  assert not (public._overboard_outcome('rod_wood', 0.0)->>'rod_lost')::boolean, 'rod_wood never lost';
  assert not (public._overboard_outcome(null, 0.0)->>'rod_lost')::boolean, 'no rod = rod_wood';
  assert (select rating_g from public.shop_items where id = 'rod_carbon') = 6000, 'rod rating';
end $$;

-- 3) a bad cell is refused; an older client (no cell) casts from a dock
do $$ declare r uuid := (select v from pl where k = 'room')::uuid; t text := (select v from pl where k = 'tok');
        a uuid := public._auth_account((select v from pl where k = 'tok')); ok boolean := false; j jsonb; begin
  perform public._fishing_profile(a);
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  begin perform public.start_cast(r, t, 37, 10); exception when others then ok := sqlerrm = 'bad spot'; end;
  assert ok, 'water cell refused';
  j := public.start_cast(r, t);
  assert j->>'spot' = 'dock' and (j->>'bites')::boolean, 'legacy = dock, bites';
  assert (select spot from public.casts where account_id = a) = 'dock', 'stored dock';
end $$;

-- 4) shore odds over many casts: every wait ×1.5 of a dock's range, about 40% bite
do $$ declare r uuid := (select v from pl where k = 'room')::uuid; t text := (select v from pl where k = 'tok');
        a uuid := public._auth_account((select v from pl where k = 'tok')); j jsonb; n int := 0; b int := 0; lo int := 1e9;
        vc int; vr int; begin
  select q.sc, q.sr into vc, vr from (select g1 sc, g2 sr from generate_series(0, 79) g1, generate_series(0, 49) g2
                                       where public._pond_spot(g1, g2) = 'shore' limit 1) q;
  for i in 1..200 loop
    update public.fishing_profiles set window_casts = 0, day_casts = 0 where account_id = a;
    update public.inventory set qty = 20 where account_id = a and item_id = 'bait_worm';
    j := public.start_cast(r, t, vc, vr);
    assert j->>'spot' = 'shore', 'shore spot';
    n := n + 1; b := b + (j->>'bites')::boolean::int; lo := least(lo, (j->>'bite_ms')::int);
  end loop;
  -- the feather bobber's 3000 ms minimum, divided by the room's weather bite factor, then ×1.5
  assert lo >= floor(3000 / (public._room_effects(r)->>'bite')::numeric * 1.5) - 1, format('shore wait x1.5 (min %s)', lo);
  assert b between 50 and 110, format('about 40%% bite (%s/200)', b);
end $$;

-- 5) finish: no_bite; a hooked lost reel on a lớn fish → overboard (hunger −10); not lớn → gave_up; unhooked → gave_up
do $$ declare r uuid := (select v from pl where k = 'room')::uuid; t text := (select v from pl where k = 'tok');
        a uuid := public._auth_account((select v from pl where k = 'tok')); j jsonb; cid uuid; h numeric; begin
  update public.fishing_profiles set window_casts = 0, day_casts = 0 where account_id = a;
  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set bites = false where id = (j->>'cast_id')::uuid;
  j := public.finish_cast(t, cid, true, true);
  assert j->>'why' = 'no_bite', 'no_bite';

  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set big = true, bite_at = now() - interval '1 second' where id = (j->>'cast_id')::uuid;
  perform public._vitals_apply(a);
  update public.vitals set hunger = 50 where account_id = a;
  j := public.finish_cast(t, cid, false, true);
  assert j->>'why' = 'overboard' and j->'overboard'->>'rod' = 'rod_wood' and not (j->'overboard'->>'rod_lost')::boolean, 'overboard';
  select hunger into h from public.vitals where account_id = a;
  assert h between 39.9 and 40, format('hunger -10 (%s)', h);
  assert (j->'vitals'->>'hunger')::numeric between 39.9 and 40, 'vitals in the answer';

  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set big = false, bite_at = now() - interval '1 second' where id = (j->>'cast_id')::uuid;
  j := public.finish_cast(t, cid, false, true);
  assert j->>'why' = 'gave_up', 'small fish: no fall';

  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set big = true, bite_at = now() - interval '1 second' where id = (j->>'cast_id')::uuid;
  j := public.finish_cast(t, cid, false);
  assert j->>'why' = 'gave_up', 'not hooked: no fall';

  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set big = true, bite_at = now() + interval '5 seconds' where id = (j->>'cast_id')::uuid;
  j := public.finish_cast(t, cid, false, true);
  assert j->>'why' = 'gave_up', 'before the bite: no fall';
end $$;

-- 6) a lost non-default rod: removed and unequipped (forced through the outcome's rod_lost branch by owning it and
--    re-running the fall until the 10% hits; at most 400 tries)
do $$ declare r uuid := (select v from pl where k = 'room')::uuid; t text := (select v from pl where k = 'tok');
        a uuid := public._auth_account((select v from pl where k = 'tok')); j jsonb; cid uuid; lost boolean := false; begin
  for i in 1..400 loop
    insert into public.inventory (account_id, item_id, qty) values (a, 'rod_bamboo', 1)
    on conflict (account_id, item_id) do update set qty = 1;
    update public.fishing_profiles set rod = 'rod_bamboo', window_casts = 0, day_casts = 0 where account_id = a;
    update public.inventory set qty = 20 where account_id = a and item_id = 'bait_worm';
    update public.vitals set hunger = 100 where account_id = a;
    delete from public.fish where account_id = a;
    j := public.start_cast(r, t, 252 / 8, 204 / 8);
    cid := (j->>'cast_id')::uuid;
    assert (select rod from public.casts where id = (j->>'cast_id')::uuid) = 'rod_bamboo', 'rod stored';
    update public.casts set big = true, bite_at = now() - interval '1 second' where id = (j->>'cast_id')::uuid;
    j := public.finish_cast(t, cid, false, true);
    assert j->>'why' = 'overboard', 'fall';
    if (j->'overboard'->>'rod_lost')::boolean then lost := true; exit; end if;
  end loop;
  assert lost, 'the 10% hit within 400 falls';
  assert not exists (select 1 from public.inventory where account_id = a and item_id = 'rod_bamboo'), 'rod removed';
  assert (select rod from public.fishing_profiles where account_id = a) = 'rod_wood', 'unequipped';
  assert j->'state'->'loadout'->>'rod' = 'rod_wood', 'state loadout';
end $$;

-- 7) privileges: the helpers are private, the RPCs are callable
do $$ begin
  assert not has_function_privilege('anon', 'public._pond_spot(integer, integer)', 'execute'), '_pond_spot private';
  assert not has_function_privilege('anon', 'public._overboard_outcome(text, double precision)', 'execute'), 'outcome private';
  assert not has_function_privilege('anon', 'public._rod_wear(uuid, text, integer)', 'execute'), 'wear private';
  assert has_function_privilege('anon', 'public.start_cast(uuid, text, integer, integer)', 'execute'), 'start_cast';
  assert has_function_privilege('anon', 'public.finish_cast(text, uuid, boolean, boolean)', 'execute'), 'finish_cast';
  assert (select count(*) from pg_proc where proname in ('start_cast', 'finish_cast') and pronamespace = 'public'::regnamespace) = 2,
    'one signature each';
end $$;
select 'v18.1 smoke ok';
