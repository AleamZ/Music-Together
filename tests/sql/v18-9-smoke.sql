-- tests/sql/v18-9-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0038 (see the plan),
-- from the repo root: it re-runs 0038 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0038_rain.sql
\i supabase/migrations/0038_rain.sql
reset client_min_messages;

create temp table rn (k text primary key, v text);
insert into rn select 'tok', token from public.register('rn_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into rn select 'tok2', token from public.register('rn_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into rn select 'room', room_id::text from public.create_room('Mưa', 'pw', (select v from rn where k = 'tok'));
select public.join_room((select code from public.rooms where id = (select v from rn where k = 'room')::uuid), 'pw',
                        (select v from rn where k = 'tok2'));
create temp view rnv as select (select v from rn where k = 'tok') t, (select v from rn where k = 'tok2') t2,
  (select v from rn where k = 'room')::uuid r, public._auth_account((select v from rn where k = 'tok')) a,
  public._auth_account((select v from rn where k = 'tok2')) a2;

-- 1) pure rules
do $$ begin
  assert public._umbrella_price('o_giay') = 300 and public._umbrella_price('o_vai') = 800
     and public._umbrella_price('o_gap') = 2000 and public._umbrella_price('x') is null, 'prices';
  assert public._umbrella_life_s('o_giay') = 1800 and public._umbrella_life_s('o_vai') = 5400
     and public._umbrella_life_s('o_gap') = 14400, 'durability';
  assert public._rain_kind('rain') and public._rain_kind('thunder') and public._rain_kind('storm')
     and not public._rain_kind('clear') and not public._rain_kind('fog') and not public._rain_kind(null), 'rainy kinds';
  assert abs(public._strike_chance(60) - 0.01) < 1e-9 and public._strike_chance(0) = 0
     and abs(public._strike_chance(120) - (1 - 0.99 * 0.99)) < 1e-9, 'strike chance';
end $$;

-- 2) buying and holding
do $$ declare x rnv; j jsonb; ok boolean := false; begin
  select * into x from rnv;
  begin perform public.umbrella_buy(x.t, 'o_giay'); exception when others then ok := sqlerrm = 'insufficient funds'; end;
  assert ok, 'no money';
  perform public._wallet_lock(x.a);
  perform public._pay(x.a, 20000, 'daily', 'smoke');
  j := public.umbrella_buy(x.t, 'o_giay');
  assert (j->>'coins')::int = (select coins from public.wallets where account_id = x.a)
     and jsonb_array_length(j->'umbrellas') = 1 and (j->'umbrellas'->0->>'held')::boolean
     and (j->'umbrellas'->0->>'left_s')::int = 1800, format('first is held: %s', j);
  j := public.umbrella_buy(x.t, 'o_vai');
  assert jsonb_array_length(j->'umbrellas') = 2 and not (j->'umbrellas'->1->>'held')::boolean, format('second not held: %s', j);
  assert (select count(*) from public.coin_ledger where account_id = x.a and reason = 'umbrella') = 2, 'ledger';
  ok := false;
  begin perform public.umbrella_buy(x.t, 'o_sat'); exception when others then ok := sqlerrm = 'unknown umbrella'; end;
  assert ok, 'unknown kind';
  j := public.umbrella_hold(x.t, (select id from public.umbrellas where account_id = x.a and kind = 'o_vai'));
  assert (select kind from public.umbrellas where account_id = x.a and held) = 'o_vai'
     and (select count(*) from public.umbrellas where account_id = x.a and held) = 1, 'hold swaps';
  j := public.umbrella_hold(x.t, null);
  assert not exists (select 1 from public.umbrellas where account_id = x.a and held), 'put away';
  ok := false;
  begin perform public.umbrella_hold(x.t2, (select id from public.umbrellas where account_id = x.a limit 1));
  exception when others then ok := sqlerrm = 'umbrella not found'; end;
  assert ok, 'not mine';
  perform public.umbrella_buy(x.t, 'o_giay'); perform public.umbrella_buy(x.t, 'o_giay');
  perform public.umbrella_buy(x.t, 'o_giay'); perform public.umbrella_buy(x.t, 'o_giay');
  ok := false;
  begin perform public.umbrella_buy(x.t, 'o_giay'); exception when others then ok := sqlerrm = 'too many umbrellas'; end;
  assert ok, 'at most 6';
  delete from public.umbrellas where account_id = x.a and id not in
    (select id from public.umbrellas where account_id = x.a order by id limit 2);
end $$;

-- the room is raining (the owner reports WMO 61, light wind); no lightning for account a in 3)–7)
select public.set_room_weather((select r from rnv), (select t from rnv), 61, true, null, null, 2, 5, 24);
update public.rain_state set strike_cd_until = now() + interval '1 hour' where account_id = (select a from rnv);
insert into public.rain_state(account_id, strike_cd_until) select a, now() + interval '1 hour' from rnv
  on conflict (account_id) do update set strike_cd_until = excluded.strike_cd_until;

-- 3) wet outdoors, drying in the shade
do $$ declare x rnv; j jsonb; begin
  select * into x from rnv;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert (j->'rain'->>'exposed')::boolean, format('exposed: %s', j->'rain');
  update public.rain_state set last_seen = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert (j->'rain'->>'wet')::boolean and (j->'rain'->>'wet_s')::int between 59 and 61, format('wet 60 s: %s', j->'rain');
  update public.rain_state set last_seen = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'market', 140, 176);
  assert not (j->'rain'->>'exposed')::boolean and (j->'rain'->>'drying')::boolean, format('drying: %s', j->'rain');
  update public.rain_state set last_seen = now() - interval '61 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'market', 140, 176);
  assert not (j->'rain'->>'wet')::boolean, format('dry after 120 s: %s', j->'rain');
  -- no rain: never exposed
  update public.room_weather set kind = 'cloudy' where room_id = x.r;
  update public.rain_state set last_seen = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert not (j->'rain'->>'exposed')::boolean and not (j->'rain'->>'wet')::boolean, 'cloudy is dry';
  update public.room_weather set kind = 'rain' where room_id = x.r;
end $$;

-- 4) the umbrella keeps me dry and wears (storm ×3), then breaks
do $$ declare x rnv; j jsonb; u bigint; begin
  select * into x from rnv;
  u := (select id from public.umbrellas where account_id = x.a and kind = 'o_giay' order by id limit 1);
  perform public.umbrella_hold(x.t, u);
  update public.rain_state set last_seen = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert not (j->'rain'->>'exposed')::boolean and not (j->'rain'->>'wet')::boolean, format('held: %s', j->'rain');
  assert (select left_s from public.umbrellas where id = u) between 1739 and 1741, 'worn 60 s';
  update public.room_weather set kind = 'storm' where room_id = x.r;
  update public.rain_state set last_seen = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert (select left_s from public.umbrellas where id = u) between 1558 and 1562, 'storm x3';
  update public.umbrellas set left_s = 10 where id = u;
  update public.rain_state set last_seen = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert not exists (select 1 from public.umbrellas where id = u) and j->'rain'->>'broke_at_ms' is not null
     and (j->'rain'->>'exposed')::boolean, format('broke: %s', j->'rain');
  -- in the shade it does not wear
  perform public.umbrella_hold(x.t, (select id from public.umbrellas where account_id = x.a order by id limit 1));
  update public.rain_state set last_seen = now() - interval '60 seconds' where account_id = x.a;
  perform public.vitals_tick(x.t, x.r, 'market', 140, 176);
  assert (select left_s from public.umbrellas where account_id = x.a and held) = 5400, 'no wear in the shade';
  perform public.umbrella_hold(x.t, null);
  update public.room_weather set kind = 'rain' where room_id = x.r;
end $$;

-- 5) 5 min wet → hunger ×24
do $$ declare x rnv; j jsonb; hu numeric; begin
  select * into x from rnv;
  update public.rain_state set wet_s = 300, dry_s = 0, last_seen = now() - interval '60 seconds' where account_id = x.a;
  update public.vitals set hunger = 50, thirst = 90, fainted_until = null, last_tick = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  hu := (j->>'hunger')::numeric;
  assert abs((50 - hu) - 60 * 100.0 / 86400 * 24) < 0.02, 'hunger x24: ' || hu;
  -- under 5 min: the normal rate
  update public.rain_state set wet_s = 100, last_seen = now() - interval '60 seconds' where account_id = x.a;
  update public.vitals set hunger = 50, last_tick = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert abs((50 - (j->>'hunger')::numeric) - 60 * 100.0 / 86400) < 0.01, 'normal rate';
end $$;

-- 6) hunger 0 from the wet → cảm lạnh
do $$ declare x rnv; j jsonb; begin
  select * into x from rnv;
  update public.rain_state set wet_s = 400, cold_until = null, last_seen = now() - interval '60 seconds' where account_id = x.a;
  update public.vitals set hunger = 0.5, last_tick = now() - interval '60 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert (j->>'hunger')::numeric = 0 and j->'rain'->>'cold_until_ms' is not null
     and public._rain_cold(x.a), format('cold: %s', j->'rain');
  assert (select cold_until from public.rain_state where account_id = x.a) between now() + interval '29 minutes' and now() + interval '31 minutes', '30 min';
end $$;

-- 7) still wet 5 more minutes while cảm lạnh → the faint
do $$ declare x rnv; j jsonb; begin
  select * into x from rnv;
  update public.vitals set hunger = 40, starve_s = 0, last_tick = now() where account_id = x.a;
  update public.rain_state set cold_wet_s = 250, last_seen = now() - interval '30 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert j->>'fainted_until_ms' is null, 'not yet';
  update public.rain_state set last_seen = now() - interval '30 seconds' where account_id = x.a;
  j := public.vitals_tick(x.t, x.r, 'pond', 100, 300);
  assert j->>'fainted_until_ms' is not null and not (j->'rain'->>'wet')::boolean, format('fainted: %s', j);
end $$;

-- 8) a hot dish cures it; a drink does not
do $$ declare x rnv; j jsonb; begin
  select * into x from rnv;
  update public.vitals set fainted_until = null where account_id = x.a;
  j := public.eat_meal(x.t, 'tra_da');
  assert not (j->>'cured')::boolean and public._rain_cold(x.a), 'a drink';
  j := public.eat_meal(x.t, 'pho_bo');
  assert (j->>'cured')::boolean and not public._rain_cold(x.a), format('phở cures: %s', j);
  j := public.eat_meal(x.t, 'bun_bo');
  assert not (j->>'cured')::boolean, 'nothing to cure';
end $$;

-- 9) lightning: never in the shade; outdoors (umbrella or not) about 1 %/min; then a 30 min cooldown
do $$ declare x rnv; j jsonb; i int; hit int := null; at text; begin
  select * into x from rnv;
  perform setseed(0.42);
  perform public._wallet_lock(x.a2);
  perform public._pay(x.a2, 5000, 'daily', 'smoke');
  perform public.umbrella_buy(x.t2, 'o_gap');
  perform public.vitals_tick(x.t2, x.r, 'market', 140, 176);
  for i in 1..300 loop
    update public.rain_state set last_seen = now() - interval '120 seconds' where account_id = x.a2;
    j := public.vitals_tick(x.t2, x.r, 'market', 140, 176);
    assert j->'rain'->>'struck_at_ms' is null, 'struck in the shade';
  end loop;
  for i in 1..2000 loop
    update public.rain_state set last_seen = now() - interval '120 seconds' where account_id = x.a2;
    update public.umbrellas set left_s = 14400 where account_id = x.a2;
    update public.vitals set hunger = 90, thirst = 90, last_tick = now() where account_id = x.a2;
    j := public.vitals_tick(x.t2, x.r, 'pond', 100, 300);
    assert not (j->'rain'->>'exposed')::boolean, 'the umbrella keeps the rain off';
    if j->'rain'->>'struck_at_ms' is not null then hit := i; exit; end if;
  end loop;
  assert hit is not null, 'never struck in 2000 ticks';
  assert j->>'fainted_until_ms' is not null, 'struck → fainted';
  assert (select strike_cd_until from public.rain_state where account_id = x.a2) > now() + interval '29 minutes', 'cooldown';
  at := j->'rain'->>'struck_at_ms';
  update public.vitals set fainted_until = null where account_id = x.a2;
  for i in 1..300 loop
    update public.rain_state set last_seen = now() - interval '120 seconds' where account_id = x.a2;
    j := public.vitals_tick(x.t2, x.r, 'pond', 100, 300);
    assert j->'rain'->>'struck_at_ms' = at and j->>'fainted_until_ms' is null, 'no strike in the cooldown';
  end loop;
  raise notice 'struck after % ticks', hit;
end $$;

-- 10) cast bites while cảm lạnh exist in start_cast; grants
do $$ begin
  assert position('_rain_cold' in pg_get_functiondef('public.start_cast(uuid, text, integer, integer)'::regprocedure)) > 0, 'start_cast';
  assert has_function_privilege('anon', 'public.rain_state(text)', 'execute')
     and has_function_privilege('anon', 'public.umbrella_buy(text, text)', 'execute')
     and has_function_privilege('anon', 'public.umbrella_hold(text, bigint)', 'execute'), 'rpc grants';
  assert not has_function_privilege('anon', 'public._rain_json(uuid, boolean)', 'execute')
     and not has_function_privilege('anon', 'public._rain_row(uuid)', 'execute')
     and not has_function_privilege('anon', 'public._rain_cold(uuid)', 'execute'), 'helpers private';
  assert not has_table_privilege('anon', 'public.umbrellas', 'select')
     and not has_table_privilege('anon', 'public.rain_state', 'select'), 'tables private';
end $$;

select 'v18.9 smoke ok';
