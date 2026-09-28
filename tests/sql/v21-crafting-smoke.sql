-- tests/sql/v21-crafting-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0070 and 0072,
-- from the repo root, with the fixture's absolute path:
--   psql -v mine=<repo>/tests/fixtures/mine-cases.json -f tests/sql/v21-crafting-smoke.sql
-- It re-runs 0072 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0072_mining_crafting.sql
\i supabase/migrations/0072_mining_crafting.sql
reset client_min_messages;

create temp table mx as select pg_read_file(:'mine')::jsonb j;
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
-- An honest dig: strike whenever the marker is in the vein and the rate allows (lib/game/mining/game.ts's player).
create or replace function pg_temp.honest(p_seed bigint, p_need integer, p_win integer) returns integer[] language plpgsql as $$
declare rd integer[] := public._mine_round(p_seed, p_need); hits integer := 0; s integer[] := '{}'; n integer;
begin
  for t in 0 .. 3599 loop
    n := coalesce(cardinality(s), 0);
    if abs(public._mine_pos(rd[1], t) - rd[hits + 2]) <= p_win and (n < 4 or t - s[n - 3] >= 60) then
      s := s || t;
      hits := hits + 1;
      exit when hits >= p_need;
    end if;
  end loop;
  return s;
end $$;
-- Stand at (x, y) on a map (as an accepted claim a minute ago).
create or replace function pg_temp.at(a uuid, m text, x integer, y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (a, m, x, y, now() - interval '60 seconds')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, tabs = '{}'::jsonb, tab = null
$$;

-- ---------- 1. The fixtures: the SQL dig = game.ts ----------
do $$
declare c jsonb; n integer := 0; r jsonb;
begin
  for c in select jsonb_array_elements(j) from mx loop
    assert public._mine_round((c->>'seed')::bigint, (c->>'need')::int) = pg_temp.ints(c->'expected'->'round'), format('%s: round', c->>'name');
    r := public._mine_replay((c->>'seed')::bigint, (c->>'need')::int, (c->>'win')::int, pg_temp.ints(c->'strikes'));
    assert r = (c->'expected') - 'round', format('%s: sql %s ts %s', c->>'name', r, c->'expected');
    if r->>'ticks' is not null then
      assert public._mine_input_error(pg_temp.ints(c->'strikes'), (r->>'ticks')::int) is null, format('%s: honest refused', c->>'name');
    end if;
    n := n + 1;
  end loop;
  assert n >= 40, format('%s mine cases', n);
  raise notice 'mine fixtures ok: % cases', n;
end $$;

-- ---------- 2. Geometry and the rolls ----------
do $$
declare seen text[] := '{}'; it text;
begin
  assert public._pos_need_s('bai_dat', 400, 48, 'mo_da', 44, 200, 0) is not null, 'bai_dat → mo_da';
  assert public._pos_need_s('market', 640, 350, 'mo_da', 300, 300, 0) is not null, 'market → mo_da (2 hops)';
  assert exists (select 1 from public._pos_maps() where map = 'mo_da' and w = 640 and h = 400), 'mo_da is a map';
  assert (select count(*) from public._pos_portals()) = 16, 'the 14 old portals kept + 2';
  for k in 0 .. 999 loop
    it := public._mine_roll(9, k / 1000.0);
    if not it = any(seen) then seen := seen || it; end if;
  end loop;
  assert 'ore_tinhthe' = any(seen) and 'ore_kimcuong' = any(seen) and not 'ore_da' = any(seen), format('deep pool %s', seen);
  assert public._mine_roll(1, 0) = 'ore_da' and public._mine_roll(1, 0.999) = 'ore_bac', 'shallow pool ends';
  assert public._mine_roll(12, 0.99) = 'herb_linhchi', 'herb pool';
  assert public._upgrade_max(120, 2) = 168 and public._upgrade_coins(12000, 0) = 3000 and public._mine_win(1, 0) = 90, 'rules';
end $$;

-- ---------- 3. The game ----------
create temp table cx (k text primary key, v text);
insert into cx select 't', token from public.register('mine_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into cx select 't2', token from public.register('mine_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into cx select 'a', public._auth_account(v)::text from cx where k = 't';
insert into cx select 'a2', public._auth_account(v)::text from cx where k = 't2';
insert into cx select 'room', room_id::text from public.create_room('Mỏ đá', 'pw', (select v from cx where k = 't'));
update public.anticheat_config set mode = 'log', min_client_build = 0;
update public.map_levels set min_level = 1 where map = 'mo_da';

do $$
declare t text := (select v from cx where k = 't'); a uuid := (select v from cx where k = 'a')::uuid;
        room uuid := (select v from cx where k = 'room')::uuid; r jsonb; d jsonb; s integer[]; ticks integer; c0 integer;
begin
  -- the level gate
  perform pg_temp.at(a, 'mo_da', 100, 124);
  update public.map_levels set min_level = 99 where map = 'mo_da';
  assert pg_temp.err(format('select public.mine_start(%L, %L, 1)', room, t)) = 'map locked', 'gated';
  update public.map_levels set min_level = 1 where map = 'mo_da';
  -- no pickaxe, then chú Tám's
  perform public.mine_state(room, t);
  assert (select count(*) from public.mine_nodes where room_id = room) = 14, '14 nodes';
  update public.mine_nodes set item_id = 'ore_da', ready_at = now() where room_id = room and node_no = 1;
  assert pg_temp.err(format('select public.mine_start(%L, %L, 1)', room, t)) = 'no pickaxe', 'no pickaxe';
  perform public._wallet_lock(a);
  update public.wallets set coins = 100000 where account_id = a;
  perform pg_temp.at(a, 'mo_da', 120, 282);
  perform public.buy_pickaxe(t, 'pick_da');
  assert (select durability from public.mine_tools where account_id = a and tool_id = 'pick_da') = 60, 'bought';
  assert (select delta from public.coin_ledger where account_id = a and reason = 'mine_tool' order by id desc limit 1) = -150, 'mine_tool';
  assert pg_temp.err(format('select public.buy_pickaxe(%L, %L)', t, 'pick_da')) = 'already owned', 'owned';
  -- a stone pickaxe cannot take gold
  perform pg_temp.at(a, 'mo_da', 100, 124);
  update public.mine_nodes set item_id = 'ore_vang' where room_id = room and node_no = 1;
  assert pg_temp.err(format('select public.mine_start(%L, %L, 1)', room, t)) = 'pickaxe too weak', 'too weak';
  -- an honest dig
  update public.mine_nodes set item_id = 'ore_da' where room_id = room and node_no = 1;
  r := public.mine_start(room, t, 1);
  d := r->'dig';
  assert d->>'item' = 'ore_da' and (d->>'need')::int = 2 and (d->>'win')::int = 90 and d->>'tool' = 'pick_da', format('dig %s', d);
  s := pg_temp.honest((d->>'seed')::bigint, 2, 90);
  ticks := s[cardinality(s)] + 1;
  update public.mine_digs set started_at = now() - interval '70 seconds' where account_id = a;
  r := public.mine_finish(room, t, s, ticks, true);
  assert r->>'result' = 'mined' and (r->>'qty')::int = 2 and (r->>'perfect')::boolean, format('mined %s', r - 'state');
  assert (select qty from public.craft_bag where account_id = a and item_id = 'ore_da') = 2, 'in the bag';
  assert (select durability from public.mine_tools where account_id = a and tool_id = 'pick_da') = 59, 'worn';
  assert (select ready_at from public.mine_nodes where room_id = room and node_no = 1) > now(), 'the node grows back';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'ore_mined' and qty = 2 and meta->>'item' = 'ore_da'), 'ore_mined';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'mining' and qty = 4), 'xp';
  assert pg_temp.err(format('select public.mine_start(%L, %L, 1)', room, t)) = 'node empty', 'empty';
  assert pg_temp.err(format('select public.mine_finish(%L, %L, %L::int[], 5, true)', room, t, '{1}')) = 'dig not found', 'single use';
  -- a lie: a pass the replay does not give
  perform pg_temp.at(a, 'mo_da', 200, 110);
  update public.mine_nodes set item_id = 'ore_than', ready_at = now() where room_id = room and node_no = 2;
  r := public.mine_start(room, t, 2);
  update public.mine_digs set started_at = now() - interval '70 seconds' where account_id = a;
  r := public.mine_finish(room, t, '{3000}'::int[], 3001, true);
  assert r->>'result' = 'lost' and r->'anticheat'->>'code' = 'mine_mismatch', format('mismatch %s', r - 'state');
  -- too fast: an honest pass right after the start
  r := public.mine_start(room, t, 2);
  s := pg_temp.honest((r->'dig'->>'seed')::bigint, 2, 90);
  r := public.mine_finish(room, t, s, s[cardinality(s)] + 1, true);
  assert r->'anticheat'->>'code' = 'mine_too_fast', format('too fast %s', r - 'state');
  -- bad input: 5 strikes in 60 ticks
  r := public.mine_start(room, t, 2);
  r := public.mine_finish(room, t, '{1,2,3,4,5}'::int[], 6, true);
  assert r->'anticheat'->>'code' = 'mine_bad_input', format('bad input %s', r - 'state');
  assert (select count(*) from public.anticheat_events where account_id = a and code in ('mine_mismatch', 'mine_too_fast', 'mine_bad_input')) = 3, 'logged';
  -- giving up
  r := public.mine_start(room, t, 2);
  r := public.mine_finish(room, t, '{}'::int[], 30, false);
  assert r->>'result' = 'lost' and r->>'why' = 'gave_up' and r->'anticheat' is null, 'gave up';
  assert (select qty from public.craft_bag where account_id = a and item_id = 'ore_than') is null, 'no ore from a lost dig';
  -- too far
  perform pg_temp.at(a, 'mo_da', 560, 314);
  update public.player_pos set at = now() where account_id = a;             -- just now: node 1 is 2 s away
  r := public.mine_start(room, t, 1);
  assert r->'anticheat'->>'code' = 'pos_teleport', format('too far %s', r);
  -- someone else took it first
  perform pg_temp.at(a, 'mo_da', 300, 124);
  update public.mine_nodes set item_id = 'ore_da', ready_at = now() where room_id = room and node_no = 3;
  r := public.mine_start(room, t, 3);
  update public.mine_nodes set ready_at = now() + interval '1 minute' where room_id = room and node_no = 3;
  update public.mine_digs set started_at = now() - interval '70 seconds' where account_id = a;
  s := pg_temp.honest((r->'dig'->>'seed')::bigint, 2, 90);
  r := public.mine_finish(room, t, s, s[cardinality(s)] + 1, true);
  assert r->>'why' = 'taken', format('taken %s', r - 'state');

  -- herbs
  perform pg_temp.at(a, 'mo_da', 90, 342);
  update public.mine_nodes set item_id = 'herb_nam', ready_at = now() where room_id = room and node_no = 11;
  r := public.gather_herb(room, t, 11);
  assert r->>'item' = 'herb_nam' and (r->>'qty')::int between 1 and 2, 'herb';
  assert pg_temp.err(format('select public.gather_herb(%L, %L, 12)', room, t)) = 'too fast', 'rate';
  update public.mining_profiles set last_act_at = null where account_id = a;
  assert pg_temp.err(format('select public.gather_herb(%L, %L, 11)', room, t)) = 'node empty', 'patch empty';

  -- selling
  perform pg_temp.at(a, 'mo_da', 120, 282);
  c0 := (select coins from public.wallets where account_id = a);
  r := public.sell_ore(t, 'ore_da', 2);
  assert (r->'sold'->>'xu')::int = 8 and (select coins from public.wallets where account_id = a) = c0 + 8, 'sold';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'ore_sell' and delta = 8), 'ore_sell';
  assert pg_temp.err(format('select public.sell_ore(%L, %L, 1)', t, 'ore_da')) = 'not enough items', 'none left';

  -- the cauldron
  perform pg_temp.at(a, 'mo_da', 320, 346);
  update public.mining_profiles set last_act_at = null where account_id = a;
  assert pg_temp.err(format('select public.brew_potion(%L, %L, 1)', t, 'pot_luck')) = 'not enough items', 'no ingredients';
  perform public._bag_add(a, 'herb_nam', 5);
  perform public._bag_add(a, 'herb_linhchi', 2);
  perform public._bag_add(a, 'ore_vang', 1);
  update public.mining_profiles set last_act_at = null where account_id = a;
  r := public.brew_potion(t, 'pot_luck', 1);
  assert (select qty from public.craft_bag where account_id = a and item_id = 'pot_luck') = 1, 'brewed';
  assert (select qty from public.craft_bag where account_id = a and item_id = 'herb_linhchi') = 0, 'used up';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'potion' and delta = -80), 'potion fee';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'potion_brewed' and meta->>'potion' = 'pot_luck'), 'potion_brewed';
  -- a fish soup takes the cheapest fish
  insert into public.fish (account_id, species_id, weight_g, price) select a, id, 500, 7 from public.fish_species order by id limit 1;
  update public.mining_profiles set last_act_at = null where account_id = a;
  r := public.brew_potion(t, 'pot_canh', 1);
  assert (select count(*) from public.fish where account_id = a) = 0, 'the fish went in';
  -- drinking
  update public.mining_profiles set last_act_at = null where account_id = a;
  r := public.drink_potion(t, 'pot_luck');
  assert public._buff_power(a, 'luck') = 1, 'luck on';
  perform public._vitals_apply(a);
  update public.vitals set hunger = 10, thirst = 10 where account_id = a;
  update public.mining_profiles set last_act_at = null where account_id = a;
  r := public.drink_potion(t, 'pot_canh');
  assert (select hunger from public.vitals where account_id = a) >= 69 and (select thirst from public.vitals where account_id = a) >= 69, 'fed';
  assert pg_temp.err(format('select public.drink_potion(%L, %L)', t, 'pot_canh')) in ('too fast', 'not enough items'), 'gone';

  -- the luck buff lifts a cast (power 50: always)
  update public.player_buffs set power = 50 where account_id = a and kind = 'luck';
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  select a, room, id, min_g, 2000, now(), now() + interval '1 minute' from public.fish_species where rarity = 1 order by id limit 1;
  assert (select s2.rarity from public.casts c join public.fish_species s2 on s2.id = c.species_id where c.account_id = a) = 2, 'lifted';
  delete from public.casts where account_id = a;

  -- the anvil
  perform pg_temp.at(a, 'mo_da', 200, 306);
  assert pg_temp.err(format('select public.upgrade_item(%L, %L)', t, 'pick_da')) = 'not enough items', 'no ores';
  for i in 1 .. 30 loop
    exit when public._upgrade_level(a, 'pick_da') >= 1;
    perform public._bag_add(a, 'ore_dong', 3);
    r := public.upgrade_item(t, 'pick_da');
  end loop;
  assert public._upgrade_level(a, 'pick_da') = 1, 'upgraded';
  assert (select durability from public.mine_tools where account_id = a and tool_id = 'pick_da') = 72, 'refilled to 72';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'upgrade' and delta = -50), 'upgrade fee';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'item_upgraded' and (meta->>'ok')::boolean), 'item_upgraded';
  assert public._mine_win(1, public._upgrade_level(a, 'pick_da')) = 102, 'wider window';
  -- a rod: owned, upgraded, repaired to its upgraded max
  insert into public.inventory (account_id, item_id, qty, durability) values (a, 'rod_bamboo', 1, 10)
  on conflict (account_id, item_id) do update set qty = 1, durability = 10;
  insert into public.item_upgrades (account_id, item_id, level) values (a, 'rod_bamboo', 2);
  update public.inventory set durability = 120 where account_id = a and item_id = 'rod_bamboo';
  assert (select durability from public.inventory where account_id = a and item_id = 'rod_bamboo') = 168, 'repair keeps the upgrade';
  update public.item_upgrades set level = 5 where account_id = a and item_id = 'rod_bamboo';
  assert pg_temp.err(format('select public.upgrade_item(%L, %L)', t, 'rod_bamboo')) = 'max level', 'max';
  assert pg_temp.err(format('select public.upgrade_item(%L, %L)', t, 'rod_master')) = 'item not available', 'not owned';

  -- the state
  r := public.mine_state(room, t);
  assert jsonb_array_length(r->'state'->'nodes') = 14 and (r->'state'->'tools'->0->>'level')::int = 1
     and exists (select 1 from jsonb_array_elements(r->'state'->'gear') g where g->>'id' = 'rod_bamboo' and (g->>'level')::int = 5), 'state';

  -- a wipe takes it all
  insert into public.anticheat_wipes (account_id, username, snapshot) values (a, 'x', '{}');
  assert not exists (select 1 from public.craft_bag where account_id = a) and not exists (select 1 from public.mine_tools where account_id = a)
     and not exists (select 1 from public.item_upgrades where account_id = a), 'wiped';
end $$;

-- ---------- 4. Privileges ----------
do $$
begin
  assert not has_table_privilege('anon', 'public.craft_bag', 'select'), 'craft_bag closed';
  assert not has_table_privilege('anon', 'public.mine_nodes', 'select'), 'mine_nodes closed';
  assert not has_function_privilege('anon', 'public._mine_replay(bigint,integer,integer,integer[])', 'execute'), '_mine_replay private';
  assert not has_function_privilege('anon', 'public._bag_add(uuid,text,integer)', 'execute'), '_bag_add private';
  assert has_function_privilege('anon', 'public.mine_finish(uuid,text,integer[],integer,boolean)', 'execute'), 'mine_finish open';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^_(mine|bag|upgrade|buff|cast_luck|mining)'
                       and has_function_privilege('anon', p.oid, 'execute')), 'every helper private';
end $$;
update public.anticheat_config set mode = 'enforce';
\echo 'v21-crafting-smoke: all asserts passed'
