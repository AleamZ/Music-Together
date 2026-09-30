-- tests/sql/v22-crafting-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain and
-- 0084, from the repo root, with the fixture's absolute path:
--   psql -v craft=<repo>/tests/fixtures/craft-cases.json -f tests/sql/v22-crafting-smoke.sql
-- It re-runs 0084 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0084_craft_minigames.sql
\i supabase/migrations/0084_craft_minigames.sql
reset client_min_messages;

create temp table kx as select pg_read_file(:'craft')::jsonb j;
create or replace function pg_temp.ints(v jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;
create or replace function pg_temp.at(a uuid, m text, x integer, y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (a, m, x, y, now() - interval '60 seconds')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, tabs = '{}'::jsonb, tab = null
$$;
-- A pending round with a fixture's seed, started 30 s ago.
create or replace function pg_temp.seed(a uuid, g text, s bigint) returns void language sql as $$
  update public.craft_rounds set seed = s, started_at = now() - interval '30 seconds' where account_id = a and game = g
$$;
create or replace function pg_temp.fresh(a uuid) returns void language sql as $$
  update public.mining_profiles set last_act_at = null where account_id = a;
  insert into public.player_stamina (account_id, value) values (a, 100)
  on conflict (account_id) do update set value = 100;
$$;

-- ---------- 1. The fixtures: the SQL sims = games.ts ----------
do $$
declare c jsonb; n integer := 0; r jsonb;
begin
  for c in select jsonb_array_elements(j->'brew') from kx loop
    assert public._brew_round((c->>'seed')::bigint) = pg_temp.ints(c->'expected'->'round'), format('%s: round', c->>'name');
    assert public._brew_replay((c->>'seed')::bigint, pg_temp.ints(c->'toggles')) = (c->'expected'->>'score')::int,
      format('%s: sql %s ts %s', c->>'name', public._brew_replay((c->>'seed')::bigint, pg_temp.ints(c->'toggles')), c->'expected'->>'score');
    assert public._toggles_error(pg_temp.ints(c->'toggles'), 600, 600, 120, 10) is null, format('%s: honest refused', c->>'name');
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(j->'anvil') from kx loop
    assert public._anvil_round((c->>'seed')::bigint) = pg_temp.ints(c->'expected'->'round'), format('%s: round', c->>'name');
    r := public._anvil_replay((c->>'seed')::bigint, pg_temp.ints(c->'strikes'));
    assert r = (c->'expected') - 'round', format('%s: sql %s ts %s', c->>'name', r, c->'expected');
    assert public._toggles_error(pg_temp.ints(c->'strikes'), (r->>'ticks')::int, 1800, 5, 2) is null, format('%s: honest refused', c->>'name');
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(j->'sort') from kx loop
    assert public._sort_round((c->>'seed')::bigint) = pg_temp.ints(c->'expected'->'round'), format('%s: round', c->>'name');
    r := public._sort_replay((c->>'seed')::bigint, pg_temp.ints(c->'ticks'), pg_temp.ints(c->'dirs'));
    assert (r->>'score')::int = (c->'expected'->>'score')::int, format('%s: sql %s ts %s', c->>'name', r, c->'expected');
    assert public._sort_input_error(pg_temp.ints(c->'ticks'), pg_temp.ints(c->'dirs')) is null, format('%s: honest refused', c->>'name');
    n := n + 1;
  end loop;
  assert n >= 50, format('%s craft cases', n);
  assert public._anvil_nudge(0) = -100 and public._anvil_nudge(10) = 100 and public._anvil_nudge(5) = 0, 'nudge ±10 pp';
  assert public._brew_bonus(3) = 10 and public._brew_bonus(2) = 5 and public._brew_bonus(1) = 0, 'brew bonus';
  assert public._sort_bonus(12) = 5 and public._sort_bonus(8) = 2 and public._sort_bonus(7) = 0, 'sort bonus';
  assert public._sort_input_error('{50}', '{2}') = 'dir' and public._sort_input_error('{50}', '{}') = 'shape', 'sort shape';
  assert public._craft_regular('{10,20,30,40,50,60,70,80,90,100}', 10) and not public._craft_regular('{10,20,30,40,50,60,70,80,90,103}', 10), 'regular';
  raise notice 'craft fixtures ok: % cases', n;
end $$;

-- ---------- 2. The game ----------
create temp table cx (k text primary key, v text);
insert into cx select 't', token from public.register('craft_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into cx select 'a', public._auth_account(v)::text from cx where k = 't';
update public.anticheat_config set mode = 'log', min_client_build = 0;
update public.map_levels set min_level = 1 where map = 'mo_da';

-- A. the cauldron
do $$
declare t text := (select v from cx where k = 't'); a uuid := (select v from cx where k = 'a')::uuid; r jsonb;
        sharp jsonb := (select c from kx, jsonb_array_elements(j->'brew') c where c->>'name' = 'brew-sharp-0');
        idle jsonb := (select c from kx, jsonb_array_elements(j->'brew') c where c->>'name' = 'brew-idle-0');
begin
  perform public._wallet_lock(a);
  update public.wallets set coins = 100000 where account_id = a;
  perform pg_temp.at(a, 'mo_da', 320, 346);
  perform pg_temp.fresh(a);
  assert pg_temp.err(format('select public.brew_potion(%L, %L, 1)', t, 'pot_hunger')) = 'outdated', 'old brew refused';
  assert pg_temp.err(format('select public.brew_start(%L, %L, 1)', t, 'pot_hunger')) = 'not enough items', 'no ingredients';
  perform public._bag_add(a, 'herb_nam', 10);
  perform pg_temp.fresh(a);
  r := public.brew_start(t, 'pot_hunger', 2);
  assert r->'round'->>'game' = 'brew' and (r->'round'->>'seed') is not null, 'round';
  assert (select qty from public.craft_bag where account_id = a and item_id = 'herb_nam') = 10, 'nothing taken at the start';
  -- too fast (the round just started)
  r := public.brew_finish(t, pg_temp.ints(sharp->'toggles'), 0);
  assert r->>'why' = 'refused', format('refused %s', r);
  assert exists (select 1 from public.anticheat_events where account_id = a and code in ('brew_mismatch', 'brew_too_fast')), 'flagged';
  assert pg_temp.err(format('select public.brew_finish(%L, %L::int[], 1)', t, '{}')) = 'round not found', 'single use';
  -- a mismatch
  perform pg_temp.fresh(a);
  perform public.brew_start(t, 'pot_hunger', 2);
  perform pg_temp.seed(a, 'brew', (sharp->>'seed')::bigint);
  r := public.brew_finish(t, pg_temp.ints(sharp->'toggles'), (sharp->'expected'->>'score')::int + 1);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'brew_mismatch'), 'mismatch';
  -- bad input
  perform pg_temp.fresh(a);
  perform public.brew_start(t, 'pot_hunger', 2);
  perform pg_temp.seed(a, 'brew', 5);
  r := public.brew_finish(t, '{9,3}', 0);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'brew_bad_input'), 'bad input';
  -- an honest, sharp brew: quality 3
  perform pg_temp.fresh(a);
  perform public.brew_start(t, 'pot_hunger', 2);
  perform pg_temp.seed(a, 'brew', (sharp->>'seed')::bigint);
  r := public.brew_finish(t, pg_temp.ints(sharp->'toggles'), (sharp->'expected'->>'score')::int);
  assert r->>'result' = 'brewed' and (r->'brewed'->>'quality')::int = 3, format('brewed %s', r);
  assert (select qty from public.craft_bag where account_id = a and item_id = 'pot_hunger') = 2, 'two potions';
  assert (select qty from public.craft_bag where account_id = a and item_id = 'herb_nam') = 6, 'ingredients taken at the finish';
  assert (select qty from public.potion_quality where account_id = a and item_id = 'pot_hunger' and tier = 3) = 2, 'quality kept';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'potion'
                   and delta = -2 * (select fee from public.potion_recipes where id = 'pot_hunger')), 'fee';   -- 2 × 10, 2 × 60 from 0103
  assert exists (select 1 from public.game_events where account_id = a and kind = 'potion_brewed' and (meta->>'quality')::int = 3), 'event';
  assert (select value from public.player_stamina where account_id = a) < 100, 'stamina spent';
  assert jsonb_array_length(r->'state'->'quality') = 1, 'state shows the quality';
  -- an idle brew: quality 1
  perform pg_temp.fresh(a);
  perform public.brew_start(t, 'pot_hunger', 1);
  perform pg_temp.seed(a, 'brew', (idle->>'seed')::bigint);
  r := public.brew_finish(t, '{}', (idle->'expected'->>'score')::int);
  assert (r->'brewed'->>'quality')::int = 1, 'plain';
  assert (select qty from public.craft_bag where account_id = a and item_id = 'pot_hunger') = 3, 'three potions';
  -- drinking: the Hoàn hảo one first, +10 %
  perform public._vitals_apply(a);
  update public.vitals set hunger = 10 where account_id = a;
  perform pg_temp.fresh(a);
  r := public.drink_potion(t, 'pot_hunger');
  assert (r->>'quality')::int = 3 and (select hunger from public.vitals where account_id = a) between 52 and 55, format('drank %s', r);
  assert (select qty from public.potion_quality where account_id = a and item_id = 'pot_hunger' and tier = 3) = 1, 'one tier-3 left';
  -- the tiers never exceed the bag
  update public.craft_bag set qty = 1 where account_id = a and item_id = 'pot_hunger';
  update public.potion_quality set qty = 5 where account_id = a and item_id = 'pot_hunger' and tier = 3;
  perform pg_temp.fresh(a);
  r := public.drink_potion(t, 'pot_hunger');
  assert (select coalesce(sum(qty), 0) from public.potion_quality where account_id = a and item_id = 'pot_hunger') = 0, 'clamped';
  -- far from the cauldron (a claim just now, elsewhere on the map)
  perform pg_temp.at(a, 'mo_da', 60, 60);
  update public.player_pos set at = now() where account_id = a;
  perform pg_temp.fresh(a);
  perform pg_temp.err(format('select public.brew_start(%L, %L, 1)', t, 'pot_hunger'));
  assert not exists (select 1 from public.craft_rounds where account_id = a and game = 'brew'), 'too far';
end $$;

-- B. the anvil
do $$
declare t text := (select v from cx where k = 't'); a uuid := (select v from cx where k = 'a')::uuid; r jsonb; ok integer := 0;
        sharp jsonb := (select c from kx, jsonb_array_elements(j->'anvil') c where c->>'name' = 'anvil-sharp-0');
        idle jsonb := (select c from kx, jsonb_array_elements(j->'anvil') c where c->>'name' = 'anvil-idle-0');
begin
  insert into public.mine_tools (account_id, tool_id, durability) values (a, 'pick_da', 60) on conflict do nothing;
  perform pg_temp.at(a, 'mo_da', 200, 306);
  perform pg_temp.fresh(a);
  assert pg_temp.err(format('select public.upgrade_item(%L, %L)', t, 'pick_da')) = 'outdated', 'old upgrade refused';
  assert pg_temp.err(format('select public.upgrade_start(%L, %L)', t, 'pick_da')) = 'not enough items', 'no ores';
  perform public._bag_add(a, 'ore_dong', 3);
  perform pg_temp.fresh(a);
  r := public.upgrade_start(t, 'pick_da');
  assert (r->'round'->>'chance')::int = 900 and (select qty from public.craft_bag where account_id = a and item_id = 'ore_dong') = 3, 'start';
  perform pg_temp.seed(a, 'anvil', (sharp->>'seed')::bigint);
  r := public.upgrade_finish(t, pg_temp.ints(sharp->'strikes'), (sharp->'expected'->>'ticks')::int, 9);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'anvil_mismatch'), 'mismatch';
  -- the idle hammer: −10 pp; the sharp one: +10 pp (to 100 %)
  perform pg_temp.fresh(a);
  perform public.upgrade_start(t, 'pick_da');
  perform pg_temp.seed(a, 'anvil', (idle->>'seed')::bigint);
  r := public.upgrade_finish(t, '{}', 1800, 0);
  assert (r->'upgrade'->>'nudge')::int = -100 and (r->'upgrade'->>'final')::int = 800, format('idle %s', r);
  assert (select qty from public.craft_bag where account_id = a and item_id = 'ore_dong') = 0, 'ores taken at the finish';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'upgrade'), 'fee';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'item_upgraded' and (meta->>'nudge')::int = -100), 'event';
  if (r->'upgrade'->>'ok')::boolean then delete from public.item_upgrades where account_id = a and item_id = 'pick_da'; end if;
  for i in 1 .. 3 loop
    perform public._bag_add(a, 'ore_dong', 3);
    perform pg_temp.fresh(a);
    perform public.upgrade_start(t, 'pick_da');
    perform pg_temp.seed(a, 'anvil', (sharp->>'seed')::bigint);
    r := public.upgrade_finish(t, pg_temp.ints(sharp->'strikes'), (sharp->'expected'->>'ticks')::int, 10);
    assert (r->'upgrade'->>'final')::int = 1000 and (r->'upgrade'->>'ok')::boolean, format('sharp %s', r);
    delete from public.item_upgrades where account_id = a and item_id = 'pick_da';
  end loop;
  -- expired
  perform public._bag_add(a, 'ore_dong', 3);
  perform pg_temp.fresh(a);
  perform public.upgrade_start(t, 'pick_da');
  update public.craft_rounds set started_at = now() - interval '5 minutes' where account_id = a and game = 'anvil';
  r := public.upgrade_finish(t, '{}', 1800, 0);
  assert r->>'why' = 'expired' and (select qty from public.craft_bag where account_id = a and item_id = 'ore_dong') = 3, 'expired costs nothing';
end $$;

-- C. the processor
do $$
declare t text := (select v from cx where k = 't'); a uuid := (select v from cx where k = 'a')::uuid; r jsonb; c0 integer;
        sharp jsonb := (select c from kx, jsonb_array_elements(j->'sort') c where c->>'name' = 'sort-sharp-0');
        idle jsonb := (select c from kx, jsonb_array_elements(j->'sort') c where c->>'name' = 'sort-idle-0');
begin
  perform pg_temp.fresh(a);
  insert into public.farm_machines (account_id, machine) values (a, 'processor') on conflict do nothing;
  assert pg_temp.err(format('select public.process_collect(%L)', t)) = 'outdated', 'old collect refused';
  assert pg_temp.err(format('select public.process_sort_start(%L)', t)) = 'no job', 'no job';
  insert into public.processor_jobs (account_id, recipe, batches, started_at, ready_at)
  values (a, 'gao_trang', 2, now() - interval '1 hour', now() + interval '1 hour');
  assert pg_temp.err(format('select public.process_sort_start(%L)', t)) = 'not ready', 'not ready';
  update public.processor_jobs set ready_at = now() - interval '1 minute' where account_id = a;
  r := public.process_sort_start(t);
  assert r->'round'->>'recipe' = 'gao_trang', 'sort start';
  perform pg_temp.seed(a, 'sort', (sharp->>'seed')::bigint);
  r := public.process_sort_finish(t, pg_temp.ints(sharp->'ticks'), pg_temp.ints(sharp->'dirs'), 11);
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'sort_mismatch'), 'mismatch';
  assert exists (select 1 from public.processor_jobs where account_id = a), 'job kept';
  -- the sharp sorter: 12, +5 %; its reactions are all the same tick, so a soft timing flag
  perform public.process_sort_start(t);
  perform pg_temp.seed(a, 'sort', (sharp->>'seed')::bigint);
  c0 := (select coins from public.wallets where account_id = a);
  r := public.process_sort_finish(t, pg_temp.ints(sharp->'ticks'), pg_temp.ints(sharp->'dirs'), 12);
  assert r->>'result' = 'collected' and (r->>'bonus_pct')::int = 5 and (r->>'bonus')::int = 960, format('collected %s', r);
  assert (select coins from public.wallets where account_id = a) >= c0 + 960, 'bonus paid';
  assert (select qty from public.processed_goods where account_id = a and recipe = 'gao_trang') = 2, 'goods';
  assert exists (select 1 from public.anticheat_events where account_id = a and code = 'sort_timing'), 'soft timing';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'crop_processed' and (meta->>'sort')::int = 12), 'event';
  assert not exists (select 1 from public.processor_jobs where account_id = a), 'job done';
  -- an idle sorter: no bonus
  insert into public.processor_jobs (account_id, recipe, batches, started_at, ready_at)
  values (a, 'gao_trang', 1, now() - interval '1 hour', now() - interval '1 minute');
  perform pg_temp.fresh(a);
  perform public.process_sort_start(t);
  perform pg_temp.seed(a, 'sort', (idle->>'seed')::bigint);
  r := public.process_sort_finish(t, '{}', '{}', 0);
  assert r->>'result' = 'collected' and (r->>'bonus')::int = 0, format('idle %s', r);
  -- the 5th regular sort in 24 h is hard
  for i in 1 .. 4 loop
    insert into public.processor_jobs (account_id, recipe, batches, started_at, ready_at)
    values (a, 'gao_trang', 1, now() - interval '1 hour' - make_interval(secs => i), now() - interval '1 minute');
    perform pg_temp.fresh(a);
    perform public.process_sort_start(t);
    perform pg_temp.seed(a, 'sort', (sharp->>'seed')::bigint);
    r := public.process_sort_finish(t, pg_temp.ints(sharp->'ticks'), pg_temp.ints(sharp->'dirs'), 12);
    delete from public.processor_jobs where account_id = a;
  end loop;
  assert r->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'sort_timing_repeat'), format('repeat %s', r);
end $$;

-- D. the wipe and the privileges
do $$
declare a uuid := (select v from cx where k = 'a')::uuid;
begin
  insert into public.craft_rounds (account_id, game, seed) values (a, 'brew', 1) on conflict do nothing;
  insert into public.potion_quality (account_id, item_id, tier, qty) values (a, 'pot_luck', 2, 1) on conflict do nothing;
  insert into public.anticheat_wipes (account_id, username, snapshot) values (a, 'smoke', '{}'::jsonb);
  assert not exists (select 1 from public.craft_rounds where account_id = a), 'rounds wiped';
  assert not exists (select 1 from public.potion_quality where account_id = a), 'quality wiped';
  assert not has_function_privilege('anon', 'public._brew_replay(bigint, integer[])', 'execute'), 'helper private';
  assert not has_function_privilege('anon', 'public._craft_timing(uuid, text, text, jsonb)', 'execute'), 'helper private';
  assert has_function_privilege('anon', 'public.brew_finish(text, integer[], integer)', 'execute'), 'rpc granted';
  assert not has_table_privilege('anon', 'public.craft_rounds', 'select'), 'table private';
  raise notice 'v22 crafting smoke ok';
end $$;
