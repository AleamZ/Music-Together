-- tests/sql/econ-crafts-smoke.sql — 0103 (Kinh tế v2: mining, forest, cooking, crafting; spec 2026-09-30 §6, §8 S3).
-- Run as the superuser on the throwaway cluster after the full chain (… 0100, 0103), from the repo root:
--   psql -f tests/sql/econ-crafts-smoke.sql
-- It re-runs 0103 twice with \i (re-runnable) and puts back the flags and the level gate it changes. The passing of time
-- is simulated as in v22-fixes-smoke.sql: pg_temp.warp moves an account's live round (its clock, reveals, stamps) back.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0103_econ_crafts.sql
\i supabase/migrations/0103_econ_crafts.sql
reset client_min_messages;

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------- 1. The catalogs ----------
do $$
begin
  assert (select jsonb_object_agg(id, price) from public.craft_items where kind = 'ore')
         = '{"ore_da": 1, "ore_than": 3, "ore_dong": 6, "ore_sat": 10, "ore_bac": 20, "ore_vang": 40, "ore_ngoc": 80,
             "ore_kimcuong": 175, "ore_tinhthe": 500}'::jsonb, 'ores ÷ 4';
  assert (select jsonb_object_agg(id, price) from public.craft_items where kind = 'herb')
         = '{"herb_nam": 3, "herb_reu": 8, "herb_linhchi": 30}'::jsonb, 'herbs keep their prices';
  assert (select jsonb_object_agg(id, fee) from public.potion_recipes)
         = '{"pot_hunger": 60, "pot_thirst": 25, "pot_canh": 120, "pot_cure": 30, "pot_miner": 300, "pot_luck": 150,
             "pot_luck2": 600}'::jsonb, 'potion fees';
  assert (select jsonb_object_agg(log, price) from public._forest_trees())
         = '{"go_tre": 4, "go_keo": 6, "go_thong": 9, "go_soi": 15, "go_do": 25, "go_tram_huong": 73, "go_than_moc": 160}'::jsonb,
         'logs ÷ 3';
  -- the dishes: a fee-only dish 0.8 × its fee; an ingredient dish fee + 1.3 × the ingredients' NPC value + 20 (a meat's
  -- _wild_items price; a fish's expected catch at the wooden rod, M = S = 1, on 0101's prices: cá lóc 10 xu/kg, cá rô 40,
  -- cá sặc 38 — this chain may not hold 0101 yet, so the values are the ones 0103 was priced on)
  assert (select count(*) from public._cook_recipes()) = 10, 'ten dishes';
  assert (select bool_and(price = round(0.8 * fee)) and count(*) = 3 from public._cook_recipes() where meat is null and fish is null),
         'fee-only dishes at 0.8 × the fee';
  assert (select bool_and(r.price = round(r.fee + 1.3 * r.meat_qty * i.price + 20)) and count(*) = 3
            from public._cook_recipes() r join public._wild_items() i on i.id = r.meat), 'meat dishes';
  assert (select bool_and(r.price = round(r.fee + 1.3 * r.fish_qty * v.x + 20)) and count(*) = 4
            from public._cook_recipes() r join (values ('ca_loc', 10.33), ('ca_ro', 5.33), ('ca_sac', 4.43)) v(id, x) on v.id = r.fish),
         'fish dishes';
  assert array[public._cook_pct(0), public._cook_pct(1), public._cook_pct(2), public._cook_pct(3)] = array[20, 100, 110, 125],
         'quality 20 / 100 / 110 / 125 %';
  -- a Tuyệt phẩm fee-only dish pays its fee back at most: no profit loop
  assert (select bool_and(price * public._cook_pct(3) / 100 <= fee) from public._cook_recipes() where meat is null and fish is null),
         'no fee-only profit';
  assert public._upgrade_coins(null, 0) = 200 and public._upgrade_coins(null, 4) = 1000, 'the floor 200 × (level + 1)';
  assert public._upgrade_coins(150, 0) = 200 and public._upgrade_coins(900, 0) = 225 and public._upgrade_coins(12000, 4) = 15000,
         'above the floor the price rule';
  assert position('p.kills < 40' in pg_get_functiondef('public.wild_finish(text, integer[], integer[], integer)'::regprocedure)) > 0,
         'wild_finish: 40 a day';
  -- privileges unchanged by the re-creation
  assert has_function_privilege('anon', 'public.cook_sell(text, text, integer, integer)', 'execute')
     and has_function_privilege('anon', 'public.sell_ore(text, text, integer)', 'execute')
     and has_function_privilege('anon', 'public.wood_sell(text, text, integer)', 'execute')
     and has_function_privilege('anon', 'public.wild_sell(text, text, integer)', 'execute')
     and has_function_privilege('anon', 'public.profession_choose(text, text)', 'execute'), 'the RPCs stay public';
  assert not has_function_privilege('anon', 'public._prof_json(uuid)', 'execute')
     and not has_function_privilege('anon', 'public._cook_recipes()', 'execute')
     and not has_function_privilege('anon', 'public._forest_trees()', 'execute')
     and not has_function_privilege('anon', 'public._upgrade_coins(integer, integer)', 'execute'), 'the helpers stay private';
  raise notice 'catalogs ok';
end $$;

-- ---------- 2. The accounts and the clock ----------
create temp table vx (k text primary key, v text);
insert into vx select 'flag', enabled::text from public.app_flags where key = 'unified_world';
insert into vx select 'rooms', enabled::text from public.app_flags where key = 'room_creation_open';
insert into vx select 'mo_da', min_level::text from public.map_levels where map = 'mo_da';
update public.app_flags set enabled = true where key in ('unified_world', 'room_creation_open');
update public.map_levels set min_level = 1 where map = 'mo_da';
insert into vx select 't' || i, token from generate_series(1, 5) i,
  lateral public.register('ec' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into vx select 'a' || substr(k, 2), public._auth_account(v)::text from vx where k ~ '^t[0-9]$';
insert into vx select 'room', room_id::text from public.create_room('EconCrafts', 'pw', (select v from vx where k = 't1'));
select count(*) from (select public.join_room((select code from public.rooms where id = (select v from vx where k = 'room')::uuid), 'pw', v)
  from vx where k in ('t2', 't3', 't4', 't5')) x;
update public.anticheat_config set mode = 'log', min_client_build = 0;
insert into public.wallets (account_id, coins) select v::uuid, 100000 from vx where k ~ '^a[0-9]$'
  on conflict (account_id) do update set coins = 100000;

create or replace function pg_temp.t(p text) returns text language sql as $$ select v from vx where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql as $$ select v::uuid from vx where k = 'a' || p $$;
create or replace function pg_temp.room() returns uuid language sql as $$ select v::uuid from vx where k = 'room' $$;
-- stand there, an hour after the last claim: a 2D client (p_w false) or a 3D one in the world (p_w true)
create or replace function pg_temp.put(p uuid, p_map text, p_x integer, p_y integer, p_w boolean default false) returns void
language plpgsql as $$
begin
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb;
  update public.player_pos set mode = case when p_w then 'w' end where account_id = p;
end $$;
create or replace function pg_temp.fresh(p uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100, at = now();
  update public.mining_profiles set last_act_at = null where account_id = p;
  update public.chop_profile set last_at = null where account_id = p;
  update public.cook_profile set last_at = null where account_id = p;
  update public.wild_profile set last_at = null, trap_at = null where account_id = p;
end $$;
create or replace function pg_temp.stamina(p uuid, v numeric) returns void language sql as $$
  update public.player_stamina set value = v, at = now(), rest_until = null where account_id = p
$$;
-- the account's thương lái day: p_gross of goods already sold today
create or replace function pg_temp.npc_day(p uuid, p_gross bigint) returns void language plpgsql as $$
begin
  delete from public.econ_npc_days where account_id = p;
  if p_gross > 0 then
    insert into public.econ_npc_days (account_id, day, gross, paid) values (p, public._vn_today(), p_gross, p_gross);
  end if;
end $$;
create or replace function pg_temp.coins(p uuid) returns integer language sql stable as $$
  select coins from public.wallets where account_id = p
$$;
create or replace function pg_temp.events(p uuid, k text, src text) returns bigint language sql stable as $$
  select count(*) from public.game_events where account_id = p and kind = k and (src is null or meta->>'source' = src)
$$;
create or replace function pg_temp.warp(p uuid, p_s numeric) returns void language plpgsql as $$
#variable_conflict use_variable
declare iv interval := make_interval(secs => p_s);
begin
  update public.mg_live set opened_at = opened_at - iv, started_at = started_at - iv,
         seen = coalesce((select array_agg(x - iv order by o) from unnest(seen) with ordinality u(x, o)), '{}'),
         a_at = coalesce((select array_agg(x - iv order by o) from unnest(a_at) with ordinality u(x, o)), '{}'),
         b_at = coalesce((select array_agg(x - iv order by o) from unnest(b_at) with ordinality u(x, o)), '{}')
   where account_id = p;
  update public.world_mg set started_at = started_at - iv, last_start = last_start - iv where account_id = p;
  update public.craft_rounds set started_at = started_at - iv where account_id = p;
  update public.mine_digs set started_at = started_at - iv where account_id = p;
end $$;
create or replace function pg_temp.ev(r jsonb, i integer) returns jsonb language sql immutable as $$
  select e->'d' from jsonb_array_elements(r->'ev') e where (e->>'i')::int = i
$$;

-- ---------- 3. Professions: a switch 2 000, a reset 1 000 ----------
do $$
declare a uuid := pg_temp.a('4'); t text := pg_temp.t('4'); j jsonb; c0 integer; e text;
begin
  c0 := pg_temp.coins(a);
  j := public.profession_choose(t, 'nong_dan');
  assert pg_temp.coins(a) = c0 and (j->>'switch_fee')::int = 2000 and (j->>'reset_fee')::int = 1000, format('the first nghề is free %s', j);
  update public.player_profession_main set chosen_at = now() - interval '25 hours' where account_id = a;
  update public.wallets set coins = 1999 where account_id = a;
  e := pg_temp.err(format('select public.profession_choose(%L, %L)', t, 'tieu_phu'));
  assert e = 'insufficient funds', format('a switch costs 2 000: %s', e);
  update public.wallets set coins = 5000 where account_id = a;
  j := public.profession_choose(t, 'tieu_phu');
  assert j->>'main' = 'tieu_phu' and pg_temp.coins(a) = 3000, format('switched for 2 000 %s', pg_temp.coins(a));
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'profession' and delta = -2000), 'the ledger';
  -- a reset: 1 000
  insert into public.player_professions (account_id, prof, xp) values (a, 'tieu_phu', 300)
  on conflict (account_id, prof) do update set xp = 300;
  perform public.skill_learn(t, 'l_steady');
  update public.wallets set coins = 999 where account_id = a;
  e := pg_temp.err(format('select public.skill_reset(%L, %L)', t, 'tieu_phu'));
  assert e = 'insufficient funds', format('a reset costs 1 000: %s', e);
  update public.wallets set coins = 5000 where account_id = a;
  j := public.skill_reset(t, 'tieu_phu');
  assert pg_temp.coins(a) = 4000 and jsonb_array_length(j->'skills') = 0, format('reset for 1 000 %s', j->'skills');
  update public.wallets set coins = 100000 where account_id = a;
  raise notice 'professions ok';
end $$;

-- ---------- 4. Mining: 200 digs a day, a dig's hunger / thirst ÷ 3, ores through the thương lái, herbs 1 stamina ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('2'); t text := pg_temp.t('2'); room uuid := pg_temp.room(); j jsonb; r jsonb; e integer; per integer;
        strikes integer[] := '{}'; hits integer := 0; need integer; c integer; s integer; err text; u integer[];
begin
  perform pg_temp.fresh(a);
  perform public.mine_state(room, t);
  insert into public.mine_tools (account_id, tool_id, durability) values (a, 'pick_da', 60)
  on conflict (account_id, tool_id) do update set durability = 60;
  update public.mine_nodes set item_id = 'ore_da', ready_at = now() - interval '1 second' where room_id = room and node_no = 1;
  perform pg_temp.put(a, 'mo_da', 100, 124);
  -- the day's 200th dig is the last
  perform public._mining_profile(a);
  update public.mining_profiles set day_on = public._vn_today(), day_digs = 200 where account_id = a;
  err := pg_temp.err(format('select public.mine_start(%L, %L, 1)', room, t));
  assert err = 'daily dig limit', format('200 digs a day: %s', err);
  update public.mining_profiles set day_digs = 199 where account_id = a;
  -- an honest dig (v22-fixes-smoke's client)
  j := public.mine_start(room, t, 1);
  assert (select day_digs from public.mining_profiles where account_id = a) = 200, 'the 200th';
  per := (j->'dig'->>'period')::int;
  need := (j->'dig'->>'need')::int;
  r := public.mg_sync(t, 'mine');
  s := null;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'mine', strikes, null);
    e := (r->>'t')::int;
    if s is null and pg_temp.ev(r, hits + 1) is not null then
      c := (pg_temp.ev(r, hits + 1)->>'c')::int;
      s := e + 8;
      while abs(public._mine_pos(per, s) - c) > 40
            or (cardinality(strikes) >= 4 and s - strikes[cardinality(strikes) - 3] < 60) loop s := s + 1; end loop;
    end if;
    if s is not null and s <= e then strikes := strikes || s; hits := hits + 1; s := null; end if;
    exit when hits = need;
  end loop;
  perform pg_temp.warp(a, 0.1);
  r := public.mine_finish(room, t, strikes, strikes[need] + 1, true);
  assert r->>'result' = 'mined', format('mined %s', r - 'state');
  assert (r->'vitals'->>'hunger')::numeric between 99.4 and 99.51 and (r->'vitals'->>'thirst')::numeric between 99.25 and 99.34,
         format('a dig costs 0.5 hunger and 0.67 thirst: %s', r->'vitals');

  -- ores through the thương lái: full price under npc_full, half past it
  perform pg_temp.npc_day(a, 0);
  perform public._bag_add(a, 'ore_vang', 10);
  perform pg_temp.put(a, 'mo_da', (public._mine_spot('shop'))[1], (public._mine_spot('shop'))[2]);
  j := public.sell_ore(t, 'ore_vang', 5);
  assert (j->'sold'->>'xu')::int = 200 and (j->>'npc_cut')::int = 0 and (j->'npc'->>'gross')::int = 200, format('5 vàng %s', j - 'state');
  perform pg_temp.npc_day(a, 19990);
  j := public.sell_ore(t, 'ore_vang', 5);
  assert (j->'sold'->>'xu')::int = 10 + 95 and (j->>'npc_cut')::int = 95 and (j->'npc'->>'gross')::int = 20190,
         format('past the full-price mark %s', j - 'state');
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'ore_sell' and delta = 105), 'paid what the NPC paid';
  -- herbs are sold at the same counter: counted too
  perform public._bag_add(a, 'herb_linhchi', 2);
  j := public.sell_ore(t, 'herb_linhchi', 2);
  assert (j->'npc'->>'gross')::int = 20250 and (j->'sold'->>'xu')::int = 30, format('herbs %s', j - 'state');

  -- a herb: 1 stamina
  update public.mine_nodes set item_id = 'herb_nam', ready_at = now() - interval '1 second' where room_id = room and node_no in (11, 12);
  u := public._mine_node_use(11);
  perform pg_temp.put(a, 'mo_da', u[1], u[2]);
  perform pg_temp.fresh(a);
  perform pg_temp.stamina(a, 10);
  j := public.gather_herb(room, t, 11);
  assert j->>'item' = 'herb_nam', format('gathered %s', j - 'state');
  assert (select value from public.player_stamina where account_id = a) between 9 and 9.2, 'one stamina';
  u := public._mine_node_use(12);
  perform pg_temp.put(a, 'mo_da', u[1], u[2]);
  update public.mining_profiles set last_act_at = null where account_id = a;
  perform pg_temp.stamina(a, 0.5);
  err := pg_temp.err(format('select public.gather_herb(%L, %L, 12)', room, t));
  assert err = 'too tired', format('no stamina, no herb: %s', err);
  raise notice 'mining ok';
end $$;

-- ---------- 5. Crafting: the brew and the anvil emit item_crafted (quest n_nghe_3), the fees, the upgrade floor ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('3'); t text := pg_temp.t('3'); j jsonb; r jsonb; e integer; centre integer; rd integer[];
        tog integer[] := '{}'; h integer := 200; fan boolean := false; k integer := 1; tick integer := 0; sc integer;
        d jsonb; e_seen integer; per integer; ph integer; strikes integer[] := '{}'; peak integer; c0 integer;
begin
  -- the NPC quest n_nghe_3 "Thử chế tạo" (1 item_crafted), accepted
  insert into public.quest_progress (account_id, quest_id, period, progress) values (a, 'n_nghe_3', '', 0)
  on conflict do nothing;
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'mo_da', (public._mine_spot('cauldron'))[1], (public._mine_spot('cauldron'))[2]);
  perform public._bag_add(a, 'herb_nam', 10);
  c0 := pg_temp.coins(a);
  j := public.brew_start(t, 'pot_hunger', 1);
  centre := (j->'round'->>'centre')::int;
  r := public.mg_sync(t, 'brew');
  rd := array_fill(0, array[21]); rd[1] := centre;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'brew', tog, null);
    e := (r->>'t')::int;
    for i in 1 .. 20 loop
      if pg_temp.ev(r, i) is not null then rd[i + 1] := (pg_temp.ev(r, i)->>'drift')::int; end if;
    end loop;
    while tick < least(e, 600) loop
      if k <= cardinality(tog) and tog[k] = tick then fan := not fan; k := k + 1; end if;
      h := least(1000, greatest(0, h + case when fan then 7 else -4 end + rd[2 + tick / 30]));
      tick := tick + 1;
    end loop;
    exit when e >= 600;
    if (h < centre) <> fan and e > coalesce(tog[cardinality(tog)], -1) and e < 600
       and (cardinality(tog) < 10 or e - tog[cardinality(tog) - 9] >= 60) then
      tog := tog || e;
    end if;
  end loop;
  sc := public._brew_replay_p(rd, tog);
  r := public.brew_finish(t, tog, sc);
  assert r->>'result' = 'brewed', format('brewed %s', r - 'state');
  assert pg_temp.coins(a) = c0 - 60, format('the fee is 60 now (%s)', c0 - pg_temp.coins(a));
  assert pg_temp.events(a, 'item_crafted', 'brew') = 1, 'a brew is an item crafted';
  assert (select done_at is not null and progress = 1 from public.quest_progress where account_id = a and quest_id = 'n_nghe_3'),
         'n_nghe_3 done at last';

  -- the anvil: pick_da +0 → +1 at the floor price, 200 xu; a perfect hammering (score 10) always succeeds at level 0
  insert into public.mine_tools (account_id, tool_id, durability) values (a, 'pick_da', 60) on conflict do nothing;
  perform public._bag_add(a, 'ore_dong', 3);
  perform pg_temp.put(a, 'mo_da', (public._mine_spot('anvil'))[1], (public._mine_spot('anvil'))[2]);
  perform pg_temp.fresh(a);
  c0 := pg_temp.coins(a);
  j := public.upgrade_start(t, 'pick_da');
  r := public.mg_sync(t, 'anvil');
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'anvil', strikes, null);
    d := pg_temp.ev(r, 1);
    if d is not null and per is null then
      e_seen := (r->>'t')::int; per := (d->>'period')::int; ph := (d->>'phase')::int;
      peak := e_seen + 8;
      while (peak + ph) % per <> per / 2 loop peak := peak + 1; end loop;
    end if;
    e := (r->>'t')::int;
    if per is not null and cardinality(strikes) < 5 and peak + 2 <= e then
      strikes := strikes || (peak + 2);
      peak := peak + per;
      if cardinality(strikes) >= 2 and peak + 2 - strikes[cardinality(strikes) - 1] < 60 then peak := peak + per; end if;
    end if;
    exit when cardinality(strikes) = 5 and e > strikes[5] + 6;
  end loop;
  r := public.upgrade_finish(t, strikes, strikes[5] + 1, (public._anvil_replay_p(array[per, ph], strikes)->>'score')::int);
  assert r->>'result' = 'done' and (r->'upgrade'->>'ok')::boolean and (r->'upgrade'->>'cost')::int = 200,
         format('upgraded at the floor %s', r - 'state');
  assert pg_temp.coins(a) = c0 - 200, 'paid 200';
  assert pg_temp.events(a, 'item_crafted', 'upgrade') = 1, 'an upgrade is an item crafted';
  raise notice 'crafting ok';
end $$;

-- ---------- 6. Cooking: 2 stamina a dish, half the stamina eaten, the new prices through the thương lái ----------
-- One dish played by a client that reads only mg_sync (forest-professions-smoke's honest cook).
create or replace function pg_temp.cook(p text, p_recipe text) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare t text := pg_temp.t(p); a uuid := pg_temp.a(p); j jsonb; r jsonb; e integer; pa integer[] := '{}'; pb integer[] := '{}';
        d jsonb; i integer := 1; n integer; st integer; en integer; v_end integer; done integer := 0; best integer; bt integer;
        x integer; h integer;
begin
  update public.cook_profile set last_at = null where account_id = a;
  j := public.cook_start(t, p_recipe);
  n := jsonb_array_length(j->'round'->'steps');
  r := public.mg_sync(t, 'cook', '{}', '{}');
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'cook', pa, pb);
    e := (r->>'t')::int;
    d := pg_temp.ev(r, i);
    if d is not null then
      st := (d->>'start')::int; en := (d->>'end')::int;
      if (d->>'kind')::int = 1 then
        if done = 0 and e >= (d->>'p1')::int + 1 then pa := pa || ((d->>'p1')::int + 1); done := 1; end if;
        if done = 1 and e >= (d->>'p2')::int + 1 then pa := pa || ((d->>'p2')::int + 1); done := 2; end if;
      elsif (d->>'kind')::int = 2 then
        if done = 0 and e >= st + 10 then pa := pa || (st + 10); done := 1; end if;
        if done = 1 and e >= st + 10 + (d->>'p1')::int then pb := pb || (st + 10 + (d->>'p1')::int); done := 2; end if;
      else
        if done = 0 then
          best := null;
          for bt in st + 10 .. en - 1 loop
            x := ((bt - st) + (d->>'p2')::int) % (d->>'p1')::int;
            h := case when 2 * x < (d->>'p1')::int then (200 * x) / (d->>'p1')::int else 200 - (200 * x) / (d->>'p1')::int end;
            if abs(h - (d->>'p3')::int) <= 1 then best := bt; exit; end if;
          end loop;
          if best is not null and e >= best then pa := pa || best; done := 2; end if;
        end if;
      end if;
      if done = 2 then i := i + 1; done := 0; v_end := en; end if;
    end if;
    exit when i > n and e >= v_end;
    exit when e > 2000;
  end loop;
  r := public.mg_sync(t, 'cook', pa, pb);
  return public.cook_finish(t, pa, pb);
end $$;

do $$
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); j jsonb; e text; q integer;
begin
  perform pg_temp.fresh(a);
  perform public.profession_choose(t, 'dau_bep');
  assert exists (select 1 from public.prof_tools where account_id = a and item = 'chao_tap_su'), 'the starter pan';
  perform pg_temp.stamina(a, 1);
  e := pg_temp.err(format('select public.cook_start(%L, %L)', t, 'com_tam_suon'));
  assert e = 'too tired', format('a dish costs 2 stamina: %s', e);
  perform pg_temp.stamina(a, 50);
  j := pg_temp.cook('1', 'com_tam_suon');
  assert (select value from public.player_stamina where account_id = a) between 48 and 48.5, 'two stamina spent';
  assert j->>'result' = 'ok', format('cooked %s', j - 'forest');
  q := (j->>'quality')::int;
  assert pg_temp.events(a, 'item_crafted', 'cook') = 1, 'a dish is an item crafted';
  -- eat it: half the stamina (cơm tấm sườn 18 × the quality's % / 2; a ruined dish none, as before)
  perform pg_temp.stamina(a, 50);
  j := public.cook_eat(t, 'com_tam_suon', q);
  assert (j->>'gained')::numeric = case when q = 0 then 0 else floor(18 * public._cook_pct(q) / 200.0) end,
         format('half the stamina %s (quality %s)', j->>'gained', q);
  -- sell one at the stall: the fee-only dish returns at most its fee
  update public.cooked_dishes set qty = qty + 2 where account_id = a and dish = 'com_tam_suon' and quality = q;
  if not found then insert into public.cooked_dishes (account_id, dish, quality, qty) values (a, 'com_tam_suon', q, 2); end if;
  perform pg_temp.put(a, 'bai_dat', 460, 56);
  perform pg_temp.npc_day(a, 0);
  j := public.cook_sell(t, 'com_tam_suon', q, 1);
  assert (j->>'earned')::int = 96 * public._cook_pct(q) / 100 and (j->>'earned')::int <= 120 and (j->>'npc_cut')::int = 0,
         format('sold %s', j - 'forest');
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'dish_sell' and delta = (j->>'earned')::int), 'dish_sell';
  -- past npc_half the thương lái pays its tail (20 %)
  perform pg_temp.npc_day(a, 40000);
  j := public.cook_sell(t, 'com_tam_suon', q, 1);
  assert (j->>'earned')::int = floor(96 * public._cook_pct(q) / 100 * 0.2) and (j->>'npc_cut')::int = 96 * public._cook_pct(q) / 100 - (j->>'earned')::int
     and (j->'npc'->>'tail_pct')::int = 20, format('the tail %s', j - 'forest');
  perform pg_temp.npc_day(a, 0);
  raise notice 'cooking ok';
end $$;

-- ---------- 7. Woodcutting: 30 full-price logs, 150 a day, wood_sell ≤ 10 % perk through the thương lái ----------
-- One honest round (forest-professions-smoke's client): each beat pressed p_off ticks after it once that tick has come.
create or replace function pg_temp.chop(p text, cx integer, cy integer, k integer) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare t text := pg_temp.t(p); a uuid := pg_temp.a(p); j jsonb; r jsonb; e integer; presses integer[] := '{}'; d jsonb;
        nb integer := 0; v_end integer;
begin
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', cx * 64 + 32, cy * 64 + 32, true);
  j := public.chop_start(t, cx, cy, k, 'wild', cx * 64 + 32, cy * 64 + 32);
  r := public.mg_sync(t, 'chop', '{}', '{}');
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'chop', presses, null);
    e := (r->>'t')::int;
    d := pg_temp.ev(r, nb + 1);
    if nb < 3 and d is not null and (d->>'beat')::int + 2 <= e then
      presses := presses || ((d->>'beat')::int + 2);
      nb := nb + 1;
      if nb = 3 then v_end := (d->>'beat')::int + 45; end if;
    end if;
    exit when v_end is not null and e >= v_end;
    exit when e > 600;
  end loop;
  r := public.mg_sync(t, 'chop', presses, null);
  return public.chop_finish(t, presses);
end $$;

do $$
declare a uuid := pg_temp.a('4'); t text := pg_temp.t('4'); j jsonb; e text; cx integer; cy integer; k integer;
begin
  -- a Tre (3 strikes: one honest round with the starter axe fells it) on a core cell
  select f.cx, f.cy, g into cx, cy, k from public.world_forest f, generate_series(0, 7) g
   where f.core and public._tree_of(f.cx, f.cy, g) = 'cay_tre' order by f.cy, f.cx, g limit 1;
  delete from public.forest_felled where tree_key = cx || ':' || cy || ':' || k;
  assert exists (select 1 from public.prof_tools where account_id = a and item = 'riu_tap_su'), 'the Tiều phu''s starter axe';
  -- the hard cap: 150 logs a day
  insert into public.chop_profile (account_id) values (a) on conflict do nothing;
  update public.chop_profile set day = public._vn_today(), logs = 150 where account_id = a;
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', cx * 64 + 32, cy * 64 + 32, true);
  e := pg_temp.err(format('select public.chop_start(%L, %s, %s, %s, %L, %s, %s)', t, cx, cy, k, 'wild', cx * 64 + 32, cy * 64 + 32));
  assert e = 'daily log limit', format('150 logs a day: %s', e);
  -- the 30th log is the last at full price
  update public.chop_profile set logs = 29 where account_id = a;
  delete from public.wood_bag where account_id = a;
  j := pg_temp.chop('4', cx, cy, k);
  assert j->>'result' = 'felled' and (j->>'qty')::int = 2 and (j->>'full')::int = 1, format('29 → 31 logs %s', j - 'forest');
  assert (select qty = 1 and half = 1 from public.wood_bag where account_id = a and item = 'go_tre'), 'one full, one half';
  -- the 150th: a two-log tree gives one
  delete from public.forest_felled where tree_key = cx || ':' || cy || ':' || k;
  update public.chop_profile set logs = 149 where account_id = a;
  j := pg_temp.chop('4', cx, cy, k);
  assert j->>'result' = 'felled' and (j->>'qty')::int = 1 and (j->>'full')::int = 0, format('149 → 150 logs %s', j - 'forest');
  assert (select logs from public.chop_profile where account_id = a) = 150, 'the day is full';
  delete from public.forest_felled where tree_key = cx || ':' || cy || ':' || k;

  -- the stall: 1 full + 2 half go_tre = 4 + 4 / 2 × 2 = 8 xu
  perform pg_temp.put(a, 'bai_dat', 460, 56, true);
  perform pg_temp.npc_day(a, 0);
  j := public.wood_sell(t, 'go_tre', 3);
  assert (j->>'earned')::int = 4 + (4 * 2) / 2 and (j->>'npc_cut')::int = 0 and (j->'npc'->>'gross')::int = 8, format('logs %s', j - 'forest');
  -- the wood_sell_pct perk counts at most 10 %: a 25 % node (a test row) pays 10 %
  insert into public.skill_nodes (id, prof, name, perk, value, cost, req, sort_order)
  values ('zz_econ_test', 'tieu_phu', 'test', 'wood_sell_pct', 25, 1, null, 99) on conflict (id) do nothing;
  insert into public.player_skills (account_id, node) values (a, 'zz_econ_test') on conflict do nothing;
  insert into public.wood_bag (account_id, item, qty, half) values (a, 'go_tram_huong', 20, 0)
  on conflict (account_id, item) do update set qty = 20, half = 0;
  j := public.wood_sell(t, 'go_tram_huong', 10);
  assert (j->>'earned')::int = 730 * 110 / 100, format('+10 %%, not +25 %%: %s', j->>'earned');
  delete from public.player_skills where account_id = a and node = 'zz_econ_test';
  delete from public.skill_nodes where id = 'zz_econ_test';
  -- through the thương lái: past npc_half, its tail
  perform pg_temp.npc_day(a, 40000);
  j := public.wood_sell(t, 'go_tram_huong', 10);
  assert (j->>'earned')::int = 146 and (j->>'npc_cut')::int = 584, format('the tail %s', j - 'forest');
  perform pg_temp.npc_day(a, 0);
  raise notice 'woodcutting ok';
end $$;

-- ---------- 8. Hunting: 40 a day, the night market +10 %, wild_sell through the thương lái ----------
do $$
#variable_conflict use_variable
declare a uuid := pg_temp.a('5'); t text := pg_temp.t('5'); sp public.wild_spawns; f public.world_forest; j jsonb; r jsonb; e text;
        x integer := 0; tk integer := 0; v integer; pull integer; hx integer; hy integer;
begin
  select * into f from public.world_forest where core order by cy, cx limit 1;
  hx := f.cx * 64 + 32; hy := f.cy * 64 + 32;
  insert into public.wild_profile (account_id) values (a) on conflict do nothing;
  -- the 40th kill of the day is the last: no new round
  update public.wild_profile set day = public._vn_today(), kills = 40 where account_id = a;
  insert into public.wild_spawns (map, species, hx, hy, seed, born_at, expires_at)
  values ('wild', 'rabbit', hx, hy, 12345, now() - interval '10 seconds', now() + interval '5 minutes') returning * into sp;
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', hx, hy, true);
  e := pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, %s, %s)', t, sp.id, 'trap', 'wild', hx, hy));
  assert e = 'daily cap', format('40 kills a day: %s', e);
  -- a trap at the 39th starts; the 40th taken meanwhile: caught, but nothing more today
  update public.wild_profile set kills = 39, trap_at = null, last_at = null where account_id = a;
  j := public.wild_start(t, sp.id, 'trap', 'wild', hx, hy);
  assert j->'round'->>'game' = 'trap', format('the 39th %s', j);
  r := public.mg_sync(t, 'world');
  pull := null;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'world', case when pull is not null then array[pull] else '{}' end, null);
    exit when pull is not null;
    while tk < (r->>'t')::int and pull is null loop
      tk := tk + 1;
      v := coalesce((select (s.d->>'v')::int from (select pg_temp.ev(r, q) d, q from generate_series(1, 8) q) s
                      where s.d is not null
                        and tk > (select coalesce(sum((pg_temp.ev(r, w)->>'len')::int), 0) from generate_series(1, s.q - 1) w)
                        and tk <= (select coalesce(sum((pg_temp.ev(r, w)->>'len')::int), 0) from generate_series(1, s.q) w)), 6);
      x := least(1000, greatest(0, x + v));
      if abs(x - 500) <= 20 then pull := tk; end if;
    end loop;
    exit when (r->>'t')::int > 800;
  end loop;
  assert pull is not null, 'the rabbit reached the trap';
  update public.wild_profile set kills = 40 where account_id = a;
  perform pg_temp.warp(a, 0.1);
  r := public.wild_finish(t, array[pull], '{}', pull + 1);
  assert r->>'outcome' = 'caught' and r->>'result' = 'fail', format('caught, but the day is done %s', r - 'wild');
  assert not exists (select 1 from public.wild_bag where account_id = a and qty > 0), 'nothing in the bag';

  -- the stall: +10 % at night (was +30 %), through the thương lái
  insert into public.wild_bag (account_id, item, qty) values (a, 'thit_ga_rung', 4)
  on conflict (account_id, item) do update set qty = 4;
  perform pg_temp.put(a, 'bai_dat', 460, 56, true);
  perform pg_temp.npc_day(a, 0);
  j := public.wild_sell(t, 'thit_ga_rung', 3);
  assert (j->>'earned')::int = case when public._world_night() then (85 * 3 * 11) / 10 else 85 * 3 end and (j->>'npc_cut')::int = 0,
         format('3 thịt gà rừng %s (night %s)', j->>'earned', public._world_night());
  perform pg_temp.npc_day(a, 40000);
  j := public.wild_sell(t, 'thit_ga_rung', 1);
  assert (j->>'earned')::int = floor((case when public._world_night() then (85 * 11) / 10 else 85 end) * 0.2)
     and (j->>'npc_cut')::int > 0, format('the tail %s', j - 'wild');
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'wild_sell' and delta = (j->>'earned')::int), 'wild_sell';
  perform pg_temp.npc_day(a, 0);
  raise notice 'hunting ok';
end $$;

update public.app_flags set enabled = (select v::boolean from vx where k = 'flag') where key = 'unified_world';
update public.app_flags set enabled = (select v::boolean from vx where k = 'rooms') where key = 'room_creation_open';
update public.map_levels set min_level = (select v::int from vx where k = 'mo_da') where map = 'mo_da';
\echo econ-crafts-smoke: ok
