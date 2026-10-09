-- tests/sql/forest-crafts-trade-smoke.sql — 0123 (the tools rebalanced, traps and charcoal as items, carpentry, charcoal in
-- the kitchen, placed traps) and 0124 (logs, wild goods, dishes and forest items between players: trades by mail, the
-- market, auctions). Run as the superuser on the throwaway cluster after the full chain (… 0124), from the repo root:
--   psql -f tests/sql/forest-crafts-trade-smoke.sql
-- It re-runs 0123 and 0124 twice with \i, and rolls everything back (one transaction).
\set ON_ERROR_STOP on
set time zone 'UTC';
begin;
set local client_min_messages = warning;
\i supabase/migrations/0123_forest_crafts_traps.sql
\i supabase/migrations/0123_forest_crafts_traps.sql
\i supabase/migrations/0124_forest_trade.sql
\i supabase/migrations/0124_forest_trade.sql
set local client_min_messages = notice;
update public.anticheat_config set mode = 'log', min_client_build = 0;
update public.app_flags set enabled = true where key = 'room_creation_open';

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;
create temp table px (k text primary key, t text, a uuid);
create or replace function pg_temp.acc(p_k text) returns uuid language plpgsql as $$
declare v_t text; v_a uuid;
begin
  select token into v_t from public.register('fct_' || p_k || '_' || floor(random() * 1e9)::text, 'pw123456');
  v_a := public._auth_account(v_t);
  update public.accounts set created_at = now() - interval '10 days' where id = v_a;
  insert into public.player_progress (account_id, xp, level) values (v_a, public._pg_xp_at(10), 10)
  on conflict (account_id) do update set xp = excluded.xp, level = excluded.level;
  insert into public.wallets (account_id, coins) values (v_a, 100000) on conflict (account_id) do update set coins = 100000;
  insert into public.vitals (account_id) values (v_a) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  insert into public.player_stamina (account_id, value) values (v_a, 100) on conflict (account_id) do update set value = 100, at = now();
  insert into px values (p_k, v_t, v_a);
  return v_a;
end $$;
create or replace function pg_temp.a(p_k text) returns uuid language sql as $$ select a from px where k = p_k $$;
create or replace function pg_temp.t(p_k text) returns text language sql as $$ select t from px where k = p_k $$;
-- a 2D client standing on a map, an hour after its last claim
create or replace function pg_temp.put2(p uuid, p_map text, p_x integer, p_y integer) returns void language plpgsql as $$
begin
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb;
  update public.player_pos set mode = null where account_id = p;
end $$;
create or replace function pg_temp.inv(p uuid, i text) returns integer language sql as $$
  select coalesce((select qty from public.inventory where account_id = p and item_id = i), 0) $$;
select pg_temp.acc('w'), pg_temp.acc('h'), pg_temp.acc('c'), pg_temp.acc('b');

-- ---------- A. The tools ----------
do $$
declare acc uuid := pg_temp.a('w'); j jsonb;
begin
  assert (select array_agg(price || '/' || durability || '/' || repair_pp order by id) from public._prof_tools_catalog() where kind = 'axe')
         = array['450/200/1', '80/100/1', '900/300/1', '1300/400/1', '2000/800/1'], 'axes';
  assert (select array_agg(price || '/' || durability || '/' || repair_pp order by power, price) from public._prof_tools_catalog() where kind = 'bow')
         = array['100/80/1', '200/200/1', '700/200/1', '1500/300/2'], 'bows';
  assert (select array_agg(price || '/' || durability || '/' || repair_pp order by power, price) from public._prof_tools_catalog() where kind = 'pan')
         = array['80/80/1', '150/200/1', '600/200/1', '1200/300/2'], 'pans';
  -- a tool already owned gets the new maximum and the difference
  insert into public.prof_tools (account_id, item, durability, max_durability) values (acc, 'riu_sat', 30, 80);
  update public.prof_tools t set durability = t.durability + (c.durability - t.max_durability), max_durability = c.durability
    from public._prof_tools_catalog() c where c.id = t.item and t.max_durability < c.durability and t.account_id = acc;
  assert (select durability = 150 and max_durability = 200 from public.prof_tools where account_id = acc and item = 'riu_sat'), 'upgraded';
  raise notice 'A tools ok';
end $$;

-- ---------- B. Traps at the stall ----------
do $$
declare acc uuid := pg_temp.a('h'); t text := pg_temp.t('h'); j jsonb;
begin
  assert (select kind = 'forest' and price = 120 and durability = 6 from public.shop_items where id = 'bay_go'), 'bay_go';
  assert pg_temp.fails(format('select public.forest_buy(%L, %L, 1)', t, 'than_cui'), 'invalid item'), 'charcoal is crafted only';
  perform pg_temp.put2(acc, 'bai_dat', 460, 56);
  j := public.forest_buy(t, 'bay_go', 3);
  assert pg_temp.inv(acc, 'bay_go') = 3 and (j->'forest'->'items'->>'bay_go')::int = 3, format('bought %s', j->'forest'->'items');
  j := public.forest_buy(t, 'bay_sat', 1);
  assert (select coins from public.wallets where account_id = acc) = 100000 - 360 - 450, 'paid';
  assert pg_temp.fails(format('select public.forest_buy(%L, %L, 11)', t, 'bay_go'), 'invalid quantity'), '1 … 10';
  assert 'forest' = any(public._mail_gift_kinds()), 'a code may carry them';
  raise notice 'B stall ok';
end $$;

-- ---------- C. Carpentry and D. charcoal ----------
do $$
declare acc uuid := pg_temp.a('c'); t text := pg_temp.t('c'); j jsonb; e text;
begin
  insert into public.wood_bag (account_id, item, qty, half) values (acc, 'go_tre', 10, 3), (acc, 'go_keo', 10, 0);
  e := null;
  begin perform public.carpenter_craft(t, 'chair_go'); exception when others then e := sqlerrm; end;
  assert e = 'not a carpenter', format('Thợ mộc only: %s', e);
  perform public.profession_choose(t, 'tho_moc');
  assert exists (select 1 from public.prof_tools where account_id = acc and item = 'cua_tap_su' and durability = 100), 'the saw (0123: 100)';
  j := public.carpenter_craft(t, 'chair_go');
  assert j->>'made' = 'chair_go' and j->>'kind' = 'furniture', format('a chair %s', j - 'forest');
  assert exists (select 1 from public.furniture_items where account_id = acc and item_id = 'chair_go' and apt_no is null), 'in storage';
  assert (select qty = 7 and half = 0 from public.wood_bag where account_id = acc and item = 'go_tre'), 'half-price logs first';
  assert (select qty from public.wood_bag where account_id = acc and item = 'go_keo') = 6, 'keo used';
  assert exists (select 1 from public.coin_ledger where account_id = acc and reason = 'furniture' and delta < 0 and ref = 'craft: chair_go'), 'the fee';
  assert exists (select 1 from public.game_events where account_id = acc and kind = 'furniture_crafted'), 'Thợ mộc XP';
  assert (select durability from public.prof_tools where account_id = acc and item = 'cua_tap_su') = 99, 'the saw wore';
  e := null;
  begin perform public.carpenter_craft(t, 'than_cui'); exception when others then e := sqlerrm; end;
  assert e = 'cooldown', format('2 s apart: %s', e);
  update public.carpentry_profile set last_at = null where account_id = acc;
  j := public.carpenter_craft(t, 'than_cui');
  assert pg_temp.inv(acc, 'than_cui') = 2 and (j->'forest'->'items'->>'than_cui')::int = 2, 'two bags of charcoal';
  update public.carpentry_profile set last_at = null where account_id = acc;
  e := null;
  begin perform public.carpenter_craft(t, 'bed_go'); exception when others then e := sqlerrm; end;
  assert e = 'no ingredients', format('no gõ đỏ: %s', e);
  raise notice 'C carpentry ok';
end $$;

-- the kitchen burns one bag of charcoal: +5 points in the round
do $$
declare acc uuid := pg_temp.acc('k'); t text := pg_temp.t('k'); j jsonb;
begin
  perform public.profession_choose(t, 'dau_bep');
  insert into public.inventory (account_id, item_id, qty) values (acc, 'than_cui', 2);
  j := public.cook_start(t, 'com_tam_suon');
  assert (j->'round'->>'coal')::boolean and (j->'round'->>'coal_bonus')::int = 5, format('charcoal %s', j->'round');
  assert pg_temp.inv(acc, 'than_cui') = 1, 'one burned';
  assert (select (meta->>'coal')::boolean from public.mg_live where account_id = acc and game = 'cook'), 'kept in the round';
  assert (select prosrc from pg_proc where oid = 'public.cook_finish(text, integer[], integer[])'::regprocedure)
         like '%then public._coal_bonus() else 0 end);%', 'cook_finish adds it';
  delete from public.inventory where account_id = acc and item_id = 'than_cui';
  update public.cook_profile set last_at = null where account_id = acc;
  j := public.cook_start(t, 'com_tam_suon');
  assert not (j->'round'->>'coal')::boolean, 'no charcoal, no bonus';
  raise notice 'D charcoal ok';
end $$;

-- ---------- E. Placed traps ----------
do $$
declare acc uuid := pg_temp.a('h'); t text := pg_temp.t('h'); o record; j jsonb; e text; v_id bigint; lx int; ly int; cx int; cy int;
begin
  select * into o from public._forest_origin();
  select f.cx, f.cy into cx, cy from public.world_forest f where f.core and f.cx between o.ox / 64 + 1 and o.ox / 64 + 8
     and f.cy between o.oy / 64 + 1 and o.oy / 64 + 4 order by f.cy, f.cx limit 1;
  lx := cx * 64 + 32 - o.ox; ly := cy * 64 + 32 - o.oy;
  perform pg_temp.put2(acc, 'rung_tram', lx, ly);
  j := public.trap_place(t, 'bay_go', 'rung_tram', lx, ly);
  assert jsonb_array_length(j->'forest'->'traps') = 1 and pg_temp.inv(acc, 'bay_go') = 2, format('placed %s', j->'forest'->'traps');
  v_id := (j->'forest'->'traps'->0->>'id')::bigint;
  assert (j->'forest'->'traps'->0->>'x')::int = o.ox + lx, 'in world px';
  e := null;
  begin perform public.trap_place(t, 'bay_go', 'rung_tram', lx + 10, ly); exception when others then e := sqlerrm; end;
  assert e = 'too close', format('32 px apart: %s', e);
  -- a fresh trap catches nothing (before 5 min); a second look within 30 s is refused
  j := public.trap_check(t, v_id, 'rung_tram', lx, ly);
  assert j->>'result' = 'empty' and (j->>'odds')::int = 0, format('fresh %s', j - 'forest');
  e := null;
  begin perform public.trap_check(t, v_id, 'rung_tram', lx, ly); exception when others then e := sqlerrm; end;
  assert e = 'cooldown', format('30 s: %s', e);
  assert abs(public._trap_odds('bay_go', 30) - (1 - exp(-1))) < 1e-9 and public._trap_odds('bay_sat', 30) > public._trap_odds('bay_go', 30)
     and public._trap_odds('bay_go', 10000) = public._trap_odds('bay_go', 240), 'the odds';
  -- four hours later: a catch (odds ≈ 99.97 %), a point of wear, the day's kills
  update public.forest_traps set placed_at = now() - interval '6 hours', last_check = now() - interval '1 minute' where id = v_id;
  j := public.trap_check(t, v_id, 'rung_tram', lx, ly);
  if j->>'result' = 'empty' then                                     -- the 0.03 %: once more
    update public.forest_traps set last_check = now() - interval '1 minute' where id = v_id;
    j := public.trap_check(t, v_id, 'rung_tram', lx, ly);
  end if;
  assert j->>'result' = 'caught' and (j->>'qty')::int >= 1, format('caught %s', j - 'forest');
  assert (select durability from public.forest_traps where id = v_id) = 5, 'worn';
  assert exists (select 1 from public.wild_bag where account_id = acc and item = j->>'item' and qty >= 1), 'in the bag';
  assert (select kills from public.wild_profile where account_id = acc) >= 1, 'the day''s kills';
  assert exists (select 1 from public.game_events where account_id = acc and kind = 'wild_trap' and meta->>'via' = 'set_trap'), 'event';
  -- right after a catch: nothing for 5 minutes
  update public.forest_traps set last_check = now() - interval '1 minute' where id = v_id;
  assert public.trap_check(t, v_id, 'rung_tram', lx, ly)->>'result' = 'empty', 'not again at once';
  -- a used trap picked up is lost; an unused one comes back; at most three
  j := public.trap_take(t, v_id, 'rung_tram', lx, ly);
  assert not (j->>'returned')::boolean and pg_temp.inv(acc, 'bay_go') = 2, 'a used trap is gone';
  j := public.trap_place(t, 'bay_go', 'rung_tram', lx, ly);
  v_id := (j->'forest'->'traps'->0->>'id')::bigint;
  j := public.trap_take(t, v_id, 'rung_tram', lx, ly);
  assert (j->>'returned')::boolean and pg_temp.inv(acc, 'bay_go') = 2, 'an unused one comes back';
  perform public.trap_place(t, 'bay_go', 'rung_tram', lx, ly);
  perform public.trap_place(t, 'bay_go', 'rung_tram', lx + 40, ly);
  perform public.trap_place(t, 'bay_sat', 'rung_tram', lx + 80, ly);
  insert into public.inventory (account_id, item_id, qty) values (acc, 'bay_go', 1) on conflict (account_id, item_id) do update set qty = 1;
  e := null;
  begin perform public.trap_place(t, 'bay_go', 'rung_tram', lx + 120, ly); exception when others then e := sqlerrm; end;
  assert e = 'trap limit', format('three: %s', e);
  -- off the forest
  perform pg_temp.put2(acc, 'bai_dat', 300, 200);
  e := null;
  begin perform public.trap_place(t, 'bay_go', 'bai_dat', 300, 200); exception when others then e := sqlerrm; end;
  assert e = 'not in forest', format('the forest only: %s', e);
  -- the wipe and the Beta reset know the new tables
  assert exists (select 1 from public.beta_reset_scope where tbl = 'forest_traps' and action = 'wipe')
     and exists (select 1 from public.beta_reset_scope where tbl = 'carpentry_profile' and action = 'wipe'), 'classified';
  assert cardinality(public._beta_unclassified()) = 0, format('unclassified %s', public._beta_unclassified());
  assert (select prosrc from pg_proc where proname = '_forest_on_wipe') like '%forest_traps%', 'wiped with the account';
  raise notice 'E traps ok';
end $$;

-- ---------- 0124. Goods between players ----------
do $$
declare a uuid := pg_temp.a('w'); b uuid := pg_temp.a('b'); j jsonb; v_t bigint; v_ma bigint; v_mb bigint; room uuid; e text;
begin
  -- the values
  assert public._forest_goods_value('wood', 'go_soi', 3) = 45 and public._forest_goods_value('wild', 'thit_ga_rung', 2) = 170
     and public._forest_goods_value('dish', 'com_tam_suon:2', 2) = (select 2 * ((price * 110) / 100) from public._cook_recipes() where id = 'com_tam_suon')
     and public._forest_goods_value('item', 'bay_go', 2) = 240 and public._forest_goods_value('item', 'bait_shrimp', 1) is null
     and public._forest_goods_value('dish', 'nope', 1) is null, 'values';
  insert into public.wood_bag (account_id, item, qty, half) values (a, 'go_soi', 4, 6);
  insert into public.wild_bag (account_id, item, qty) values (a, 'thit_ga_rung', 3);
  insert into public.cooked_dishes (account_id, dish, quality, qty) values (a, 'com_tam_suon', 2, 2);
  insert into public.inventory (account_id, item_id, qty) values (a, 'bay_go', 2);
  -- only the full-price logs can leave
  assert public._econ_value(a, 'wood', 'go_soi', 4, 0) = 60 and public._econ_value(a, 'wood', 'go_soi', 5, 0) is null, 'full-price logs only';
  -- the asset list shows them
  j := public._econ_json(a);
  assert (select count(*) from jsonb_array_elements(j->'assets') x where x->>'kind' in ('wood', 'wild', 'dish', 'item')) = 4,
    format('assets %s', j->'assets');
  -- a trade, delivered by mail
  insert into public.rooms (code, name) values ('FCT' || floor(random() * 1e6)::text, 'forest trade smoke') returning id into room;
  insert into public.members (room_id, account_id) values (room, a), (room, b);
  insert into public.player_pos (account_id, map, x, y, at) values (a, 'hall', 400, 300, now()), (b, 'hall', 420, 300, now())
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at;
  j := public.trade_open(room, pg_temp.t('w'), b);
  v_t := (j->'trade'->>'id')::bigint;
  j := public.trade_offer(pg_temp.t('w'), v_t, '{"coins": 0, "items": [{"kind": "wood", "ref": "go_soi", "qty": 4},
     {"kind": "wild", "ref": "thit_ga_rung", "qty": 2}, {"kind": "dish", "ref": "com_tam_suon:2", "qty": 1},
     {"kind": "item", "ref": "bay_go", "qty": 1}]}');
  j := public.trade_offer(pg_temp.t('b'), v_t, '{"coins": 500, "items": []}');
  j := public.trade_confirm(pg_temp.t('w'), v_t, (j->'trade'->>'rev')::int);
  j := public.trade_confirm(pg_temp.t('b'), v_t, (j->'trade'->>'rev')::int);
  assert (select qty = 0 and half = 6 from public.wood_bag where account_id = a and item = 'go_soi'), 'the logs left a (the half-price stayed)';
  assert (select qty from public.wild_bag where account_id = a and item = 'thit_ga_rung') = 1, 'meat left';
  v_mb := (select id from public.mail where account_id = b and kind = 'trade' and claimed_at is null order by id desc limit 1);
  assert (select count(*) from public.mail_items where mail_id = v_mb and kind in ('wood', 'wild', 'dish', 'item')) = 4, 'in the mail';
  j := public.mail_claim(pg_temp.t('b'), v_mb);
  assert (select qty = 4 and half = 0 from public.wood_bag where account_id = b and item = 'go_soi'), 'logs at b, full price';
  assert (select qty from public.wild_bag where account_id = b and item = 'thit_ga_rung') = 2, 'meat at b';
  assert (select qty from public.cooked_dishes where account_id = b and dish = 'com_tam_suon' and quality = 2) = 1, 'dish at b';
  assert pg_temp.inv(b, 'bay_go') = 1, 'trap at b';
  -- the market: a listing in the band, its value the NPC price
  j := public.market_list(pg_temp.t('b'), 'wood', 'go_soi', 4, 90);
  assert exists (select 1 from public.econ_listings where seller = b and asset_kind = 'wood' and value = 60 and status = 'open'), 'listed';
  e := null;
  begin perform public.market_list(pg_temp.t('b'), 'wild', 'thit_ga_rung', 2, 1000); exception when others then e := sqlerrm; end;
  assert e = 'bad price', format('the band: %s', e);
  e := null;
  begin perform public.market_list(pg_temp.t('b'), 'item', 'bait_shrimp', 1, 10); exception when others then e := sqlerrm; end;
  assert e = 'not owned', format('only forest items: %s', e);
  raise notice '0124 goods ok';
end $$;

do $$ begin raise notice 'forest-crafts-trade smoke ok'; end $$;
rollback;
