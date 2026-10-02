-- tests/sql/beta-reset-smoke.sql — 0118 (the end-of-Beta reset). Run as the superuser on the throwaway cluster after
-- the full chain (… 0117, 0118), from the repo root. It re-runs 0118 twice with \i, then does EVERYTHING inside one
-- transaction that it rolls back (the reset is destructive): re-runnable, and the cluster is left as it was.
--   0. Classification: every public table that references an account is in beta_reset_scope; the tables are private,
--      the helpers revoked, the RPCs root only.
--   1. Seed players at each tier with mixed holdings (xu, bag, rods + parts, fish, fridge, fashion, furniture,
--      vehicles, pets, land, a house, a flat), a banned and a root account, mail, a listing, chat, evidence.
--   2. Phase 1: the snapshot (tiers, breakdown, read-only on player data, re-runnable: it replaces).
--   3. Phase 2 refusals: the confirm phrase, non-root.
--   4. Phase 2: the wipe is complete, the accounts and the kept tables are intact, the ledger balances.
--   5. Rewards per tier in the Beta mail; rod, mascot, title, frame, boosts; banned and root get nothing.
--   6. Exclusivity: buy / sell / gift / list / auction / trade / admin mail / furniture refused.
--   7. The boosts: XP +50 % (and the cap), the thương lái full band +25 %; they expire.
--   8. Idempotency: a second reset does nothing; a snapshot after the reset is refused.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0118_beta_reset.sql
\i supabase/migrations/0118_beta_reset.sql
reset client_min_messages;

begin;
update public.anticheat_config set mode = 'log';
update public.app_flags set enabled = true where key = 'room_creation_open';

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm !~ p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm ~ p_msg;
end $$;
create temp table bx (k text primary key, t text, a uuid, n text) on commit drop;
create or replace function pg_temp.acc(p_k text, p_xu int) returns uuid language plpgsql as $$
declare v_t text; v_a uuid; v_n text := 'beta_' || p_k || '_' || floor(random() * 1e9)::text;
begin
  select token into v_t from public.register(v_n, 'pw123456');
  v_a := public._auth_account(v_t);
  insert into public.wallets (account_id, coins) values (v_a, p_xu)
  on conflict (account_id) do update set coins = excluded.coins;
  insert into bx values (p_k, v_t, v_a, v_n);
  return v_a;
end $$;
create or replace function pg_temp.a(p_k text) returns uuid language sql as $$ select a from bx where k = p_k $$;
create or replace function pg_temp.t(p_k text) returns text language sql as $$ select t from bx where k = p_k $$;

-- ---------- 0. Classification and privileges ----------
do $$
begin
  assert cardinality(public._beta_unclassified()) = 0, 'unclassified: ' || array_to_string(public._beta_unclassified(), ', ');
  assert not exists (select 1 from public.beta_reset_scope s where to_regclass('public.' || s.tbl) is null),
    'a scope row names no table';
  assert not has_table_privilege('anon', 'public.beta_snapshot', 'select'), 'beta_snapshot private';
  assert not has_table_privilege('anon', 'public.beta_rewards', 'select'), 'beta_rewards private';
  assert not has_table_privilege('anon', 'public.account_boosts', 'select'), 'account_boosts private';
  assert not has_function_privilege('anon', 'public._beta_net_worth(uuid)', 'execute'), 'helper revoked';
  assert has_function_privilege('anon', 'public.admin_beta_reset(text,text)', 'execute'), 'rpc callable';
  assert (select count(*) from public.item_catalog where exclusive) = 5, 'five exclusive fashion items';
  assert (select exclusive from public.furniture_catalog where id = 'beta_mascot'), 'the mascot is exclusive';
end $$;

-- ---------- 1. Seed ----------
\o /dev/null
select pg_temp.acc('root', 999000);
update public.accounts set is_root = true where id = pg_temp.a('root');
select pg_temp.acc('p0', 2000);       -- tier 0
select pg_temp.acc('p1', 9000);       -- tier 1 with items
select pg_temp.acc('p2', 30000);      -- tier 2 with fish + fashion
select pg_temp.acc('p3', 85000);      -- tier 3 with rods, vehicle, pet
select pg_temp.acc('p4', 150000);     -- tier 4 with a house and a flat
select pg_temp.acc('p5', 1000);       -- tier 5 by land
select pg_temp.acc('ban', 600000);    -- banned
update public.accounts set is_banned = true where id = pg_temp.a('ban');
select pg_temp.acc('bl', 20000);      -- blacklisted
insert into public.blacklisted_accounts (account_id, note) values (pg_temp.a('bl'), 'smoke');

-- p1: 1 500 in the bag (30 × bait_bloodworm 3 = 90; 10 × hook_large 100 = 1000; 41 × gb_cam 10 = 410)
insert into public.inventory (account_id, item_id, qty) values
  (pg_temp.a('p1'), 'bait_bloodworm', 30), (pg_temp.a('p1'), 'hook_large', 10), (pg_temp.a('p1'), 'gb_cam', 41);
-- p2: fish 15 000 + 2 000 fridge + fashion (hat_straw_cowboy 1 000 + fm_ao_dai 2 500) + 1 000 furniture (tủ áo? cabinet_go 900 + plant_trau 200 -> 1 100)
insert into public.fish (account_id, species_id, weight_g, price)
  select pg_temp.a('p2'), id, 1000, 7500 from public.fish_species order by id limit 2;
insert into public.fridge_fish (id, account_id, species_id, weight_g, price, caught_at)
  select gen_random_uuid(), pg_temp.a('p2'), id, 900, 2000, now() from public.fish_species order by id limit 1;
insert into public.account_items (account_id, item_id) values (pg_temp.a('p2'), 'hat_straw_cowboy'), (pg_temp.a('p2'), 'fm_ao_dai');
insert into public.furniture_items (account_id, item_id) values (pg_temp.a('p2'), 'cabinet_go'), (pg_temp.a('p2'), 'plant_trau');
-- p3: rods (master 5 000 + carbon 1 500) with parts (hook_triple 1 500 + line_pe 1 200), a vehicle, a pet
with r as (insert into public.rods (account_id, item_id, durability) values (pg_temp.a('p3'), 'rod_master', 600) returning id)
insert into public.rod_parts (rod_id, slot, item_id, durability) select id, 'hook', 'hook_triple', null from r
union all select id, 'line', 'line_pe', 3 from r;
insert into public.rods (account_id, item_id, durability) values (pg_temp.a('p3'), 'rod_carbon', 300);
insert into public.owned_vehicles (account_id, vehicle_id) select pg_temp.a('p3'), id from public.vehicle_catalog order by price limit 1;
insert into public.pets (account_id, species, variant, name) values (pg_temp.a('p3'), 'vet', 'xanh', 'Vẹt');
-- p4: a house lot with a build, an owned flat
update public.house_lots set owner_id = pg_temp.a('p4'), bought_at = now(), paid_until = now() + interval '30 days', build_cost = 10000
 where no = (select min(no) from public.house_lots where owner_id is null);
update public.apartments set owner_id = pg_temp.a('p4'), tenure = 'own', since = now()
 where no = (select min(no) from public.apartments where owner_id is null);
-- p5: a field plot
insert into public.rooms (code, name) values ('BETA' || floor(random() * 1e6)::text, 'beta smoke');
insert into public.field_plots (room_id, plot_no, kind, owner_id, owned_at)
values ((select id from public.rooms where name = 'beta smoke'), 1, 'private', pg_temp.a('p5'), now());
-- the rest of the world: mail, a listing, chat, evidence, a stat flag, progress, a look
select public._mail_new(pg_temp.a('p2'), 'system', null, 'admin', 'old mail', '', null, null);
insert into public.player_progress (account_id, xp, level) values (pg_temp.a('p3'), public._pg_xp_at(20), 20);
insert into public.characters (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender, outfit)
values (pg_temp.a('p2'), 'tan', 'long', 'brown', 'hat_straw_cowboy', null, null, 'shoes_dep_red', null, 'nu', 'fm_ao_dai');
insert into public.ac_stat_flags (account_id, kind, key, value, baseline, n, first_at, last_at, hits)
values (pg_temp.a('p1'), 'z', 'smoke', 1, 1, 1, now(), now(), 1);
insert into public.anticheat_events (account_id, username, code, outcome, rpc, detail)
  select id, username, 'smoke', 'log_only', 'smoke', '{}'::jsonb from public.accounts where id = pg_temp.a('ban');
create temp table kept on commit drop as
  select (select count(*) from public.chat_messages) chat, (select count(*) from public.anticheat_events) ev,
         (select count(*) from public.account_secrets) sec, (select count(*) from public.accounts) acc,
         (select count(*) from public.blacklisted_accounts) bl, (select count(*) from public.sessions) ses,
         (select coalesce(sum(coins), 0) from public.wallets) supply;

\o
-- ---------- 2. Phase 1 ----------
create temp table pre on commit drop as select account_id, coins from public.wallets;
do $$
declare j jsonb; s public.beta_snapshot;
begin
  assert pg_temp.fails(format('select public.admin_beta_snapshot(%L)', pg_temp.t('p1')), 'root role required'), 'snapshot root only';
  j := public.admin_beta_snapshot(pg_temp.t('root'));
  assert (j->>'snapshot_runs')::int >= 1, 'a run';
  select * into s from public.beta_snapshot where account_id = pg_temp.a('p0');
  assert s.tier = 0 and s.net_worth = 2000 and s.eligible, format('p0 %s', row_to_json(s));
  select * into s from public.beta_snapshot where account_id = pg_temp.a('p1');
  assert s.tier = 1 and (s.breakdown->>'items')::int = 1500 and s.net_worth = 10500, format('p1 %s', s.breakdown);
  select * into s from public.beta_snapshot where account_id = pg_temp.a('p2');
  assert (s.breakdown->>'fish')::int = 17000 and (s.breakdown->>'fashion')::int = 3500 and (s.breakdown->>'furniture')::int = 1100
     and s.net_worth = 51600 and s.tier = 2, format('p2 %s', s.breakdown);
  select * into s from public.beta_snapshot where account_id = pg_temp.a('p3');
  assert (s.breakdown->>'rods')::int = 9200 and (s.breakdown->>'pets')::int = 5000 and (s.breakdown->>'vehicles')::int > 0
     and s.tier = 3, format('p3 %s', s.breakdown);
  select * into s from public.beta_snapshot where account_id = pg_temp.a('p4');
  assert (s.breakdown->>'houses')::int = 40000 + 10000 * public._estate_rule('build') / 100 + 25000 and s.tier = 4, format('p4 %s', s.breakdown);
  select * into s from public.beta_snapshot where account_id = pg_temp.a('p5');
  assert (s.breakdown->>'land')::int = 800000 and s.tier = 5, format('p5 %s', s.breakdown);
  select * into s from public.beta_snapshot where account_id = pg_temp.a('ban');
  assert s.tier = 5 and not s.eligible and s.is_banned, 'banned: tier but not eligible';
  assert not (select eligible from public.beta_snapshot where account_id = pg_temp.a('bl')), 'blacklisted: not eligible';
  assert not (select eligible from public.beta_snapshot where account_id = pg_temp.a('root')), 'root: not eligible';
  -- read-only on player data
  assert not exists (select 1 from pre p full join public.wallets w using (account_id) where p.coins is distinct from w.coins), 'wallets untouched';
  -- re-runnable: replaces
  update public.wallets set coins = 10000 where account_id = pg_temp.a('p0');
  j := public.admin_beta_snapshot(pg_temp.t('root'));
  assert (select tier from public.beta_snapshot where account_id = pg_temp.a('p0')) = 1, 'a re-run replaces';
  update public.wallets set coins = 2000 where account_id = pg_temp.a('p0');
  j := public.admin_beta_snapshot(pg_temp.t('root'));
  assert (select tier from public.beta_snapshot where account_id = pg_temp.a('p0')) = 0, 'and again';
  assert (select count(*) from public.beta_snapshot) = (select count(*) from public.accounts), 'every account';
  j := public.admin_beta_status(pg_temp.t('root'));
  assert jsonb_array_length(j->'tiers') = 6 and jsonb_array_length(j->'top') > 0 and j->>'applied_at' is null, 'status';
end $$;

-- ---------- 3. Refusals ----------
do $$
begin
  assert pg_temp.fails(format('select public.admin_beta_reset(%L, %L)', pg_temp.t('root'), 'reset beta'), 'confirm phrase'), 'phrase';
  assert pg_temp.fails(format('select public.admin_beta_reset(%L, null)', pg_temp.t('root')), 'confirm phrase'), 'null phrase';
  assert pg_temp.fails(format('select public.admin_beta_reset(%L, %L)', pg_temp.t('p5'), 'RESET BETA'), 'root role required'), 'root only';
  assert (select applied_at from public.beta_state) is null, 'nothing applied';
end $$;

-- ---------- 4. Phase 2 ----------
create temp table res on commit drop as select public.admin_beta_reset(pg_temp.t('root'), 'RESET BETA') j;
do $$
declare r record; v_n bigint; k kept;
begin
  assert (select (j->>'ok')::boolean and not (j->>'already')::boolean from res), 'applied';
  -- every wipe table is empty, but for the rows the rewards put back (eligible accounts only)
  for r in select tbl from public.beta_reset_scope where action = 'wipe' loop
    if r.tbl in ('mail', 'rods', 'furniture_items', 'player_achievements', 'player_progress') then
      execute format('select count(*) from public.%I where account_id not in (select account_id from public.beta_rewards)', r.tbl) into v_n;
    else
      execute format('select count(*) from public.%I', r.tbl) into v_n;
    end if;
    assert v_n = 0, format('%s not wiped: %s rows', r.tbl, v_n);
  end loop;
  assert not exists (select 1 from public.apartments where owner_id is not null or tenure is not null), 'flats released';
  assert not exists (select 1 from public.house_lots where owner_id is not null or build_cost <> 0), 'lots released';
  assert not exists (select 1 from public.field_plots where owner_id is not null), 'plots released';
  assert not exists (select 1 from public.econ_stalls where renter is not null), 'stalls released';
  -- looks back to default; p2 kept her body's gender
  assert (select hat = 'hat_nonla' and outfit is null and gender = 'nu' and hair = 'long' and skin = 'warm' from public.characters
           where account_id = pg_temp.a('p2')), 'look reset';
  -- kept
  select * into k from kept;
  assert (select count(*) from public.accounts) = k.acc and (select count(*) from public.account_secrets) = k.sec
     and (select count(*) from public.chat_messages) = k.chat and (select count(*) from public.anticheat_events) = k.ev
     and (select count(*) from public.blacklisted_accounts) = k.bl and (select count(*) from public.sessions) = k.ses, 'kept tables';
  assert (select is_banned from public.accounts where id = pg_temp.a('ban')) and (select is_root from public.accounts where id = pg_temp.a('root')),
    'flags kept';
  assert exists (select 1 from public.anticheat_events where account_id = pg_temp.a('ban') and code = 'smoke'), 'evidence kept';
  -- the ledger: one 'wipe' row per non-zero wallet, exactly the supply
  assert (select -sum(delta) from public.coin_ledger where reason = 'wipe' and ref = 'beta reset') = k.supply, 'ledger = supply';
  assert (select (summary->>'supply_burned')::bigint from public.beta_state) = k.supply, 'summary supply';
end $$;

-- ---------- 5. Rewards ----------
do $$
declare m public.mail; p text; v_t int; v_items text[];
begin
  foreach p in array array['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] loop
    v_t := (select tier from public.beta_snapshot where account_id = pg_temp.a(p));
    select * into m from public.mail where account_id = pg_temp.a(p);
    assert m.title = 'Quà kỷ niệm Beta' and m.ref = 'beta_reset' and m.sender_kind = 'system' and m.xu_reason = 'admin_gift', p || ' mail';
    assert m.xu = (array[2000, 5000, 8000, 12000, 16000, 20000])[v_t + 1], format('%s xu %s', p, m.xu);
    select coalesce(array_agg(ref order by ref), '{}') into v_items from public.mail_items where mail_id = m.id and kind = 'fashion';
    assert v_items = (select coalesce(array_agg(x order by x), '{}') from unnest((array['beta_dep', 'beta_non', 'beta_quan', 'beta_ao', 'beta_set'])[1:v_t]) x),
      format('%s items %s', p, v_items);
    assert exists (select 1 from public.mail_items where mail_id = m.id and ref = 'bait_shrimp' and qty = 20)
       and exists (select 1 from public.mail_items where mail_id = m.id and ref = 'gb_cam' and qty = 5), p || ' bait';
    assert (select count(*) from public.rods r join public.rod_parts rp on rp.rod_id = r.id
             where r.account_id = pg_temp.a(p) and r.item_id = 'rod_bamboo') = 3, p || ' rod assembled';
    assert exists (select 1 from public.furniture_items where account_id = pg_temp.a(p) and item_id = 'beta_mascot'), p || ' mascot';
    assert (select pg_title = 'Người khai hoang Beta' and beta_tier = v_t from public.characters where account_id = pg_temp.a(p)), p || ' title/frame';
    assert (select title from public.player_progress where account_id = pg_temp.a(p)) = 'beta_pioneer', p || ' worn title';
    assert public._boost_pct(pg_temp.a(p), 'xp') = 50 and public._boost_pct(pg_temp.a(p), 'npc_quota') = 25, p || ' boosts';
  end loop;
  foreach p in array array['ban', 'bl', 'root'] loop
    assert not exists (select 1 from public.mail where account_id = pg_temp.a(p)), p || ' no mail';
    assert not exists (select 1 from public.beta_rewards where account_id = pg_temp.a(p)), p || ' no rewards';
    assert public._boost_pct(pg_temp.a(p), 'xp') = 0, p || ' no boost';
    assert coalesce((select beta_tier from public.characters where account_id = pg_temp.a(p)), -1) = -1, p || ' no frame';
  end loop;
  assert (public.beta_me(pg_temp.t('p5'))->>'tier')::int = 5 and jsonb_array_length(public.beta_me(pg_temp.t('p5'))->'boosts') = 2, 'beta_me';
  assert not (public.beta_me(pg_temp.t('root'))->>'beta')::boolean, 'beta_me root';
end $$;

\o /dev/null
-- the claim: p5 gets the five items and 20 000 xu
select public.mail_claim(pg_temp.t('p5'), (select id from public.mail where account_id = pg_temp.a('p5')));
select public.mail_claim(pg_temp.t('p2'), (select id from public.mail where account_id = pg_temp.a('p2')));
\o
do $$
begin
  assert (select coins from public.wallets where account_id = pg_temp.a('p5')) = 20000, 'p5 xu';
  assert (select count(*) from public.account_items where account_id = pg_temp.a('p5') and item_id like 'beta\_%') = 5, 'p5 wardrobe';
  assert (select qty from public.inventory where account_id = pg_temp.a('p5') and item_id = 'gb_cam') = 5, 'p5 groundbait';
end $$;

-- ---------- 6. Exclusivity ----------
insert into public.members (room_id, account_id) select (select id from public.rooms where name = 'beta smoke'), a from bx where k in ('p5', 'p2');
do $$
begin
  assert pg_temp.fails(format('select public.sell_fashion_item(%L, %L)', pg_temp.t('p5'), 'beta_set'), 'exclusive item'), 'sell';
  assert pg_temp.fails(format('select public.buy_fashion_item(%L, %L)', pg_temp.t('p2'), 'beta_set'), 'exclusive item'), 'buy';
  assert pg_temp.fails(format('select public.transfer_fashion_item(%L, %L, %L)', pg_temp.t('p5'), pg_temp.a('p0'), 'beta_set'), 'exclusive item|recipient not in your rooms'), 'gift (rooms)';
  assert pg_temp.fails(format('select public.transfer_fashion_item(%L, %L, %L)', pg_temp.t('p5'), pg_temp.a('p2'), 'beta_ao'), 'exclusive item'), 'gift';
  assert pg_temp.fails(format('select public.market_list(%L, %L, %L, 1, 1000)', pg_temp.t('p5'), 'fashion', 'beta_set'), '.'), 'list';
  assert pg_temp.fails(format('insert into public.econ_listings (seller, asset_kind, asset_ref, qty, name, value, price, fee, status, expires_at) values (%L, %L, %L, 1, %L, 1, 1000, 0, %L, now() + interval %L)',
                              pg_temp.a('p5'), 'fashion', 'beta_set', 'x', 'open', '1 day'), 'exclusive item'), 'listing row';
  assert pg_temp.fails(format('select public.auction_create(%L, %L, %L, 1, 1000, 24)', pg_temp.t('p5'), 'fashion', 'beta_set'), '.'), 'auction';
  assert pg_temp.fails(format('insert into public.econ_trades (a, b, a_offer, b_offer) values (%L, %L, %L, %L)', pg_temp.a('p5'), pg_temp.a('p2'),
                              '{"coins":0,"items":[{"kind":"fashion","ref":"beta_set","qty":1}]}', '{"coins":0,"items":[]}'), 'exclusive item'), 'trade';
  assert pg_temp.fails(format('select public.admin_mail_send(%L, %L, %L, %L, 0, %L)', pg_temp.t('root'), jsonb_build_object('all', true), 'x', '',
                              '[{"kind":"fashion","ref":"beta_dep","qty":1}]'), 'exclusive item|bad items'), 'admin gift';
  assert pg_temp.fails(format('select public.furniture_buy(%L, %L)', pg_temp.t('p2'), 'beta_mascot'), 'exclusive item'), 'furniture buy';
  assert pg_temp.fails(format('update public.furniture_items set account_id = %L where account_id = %L and item_id = %L', pg_temp.a('p2'), pg_temp.a('p5'), 'beta_mascot'),
                       'exclusive item'), 'furniture owner change';
  assert pg_temp.fails(format('insert into public.account_items (account_id, item_id) values (%L, %L)', pg_temp.a('p0'), 'beta_set'), 'exclusive item'), 'direct grant';
  assert (select count(*) from public.account_items where account_id = pg_temp.a('p5') and item_id like 'beta\_%') = 5, 'still owned';
end $$;

-- ---------- 7. Boosts ----------
do $$
declare v int; q jsonb;
begin
  perform public._pg_row(pg_temp.a('p0'));
  update public.player_progress set xp_grant = 0, xp_day = public._vn_today() where account_id = pg_temp.a('p0');
  v := public._pg_add_xp(pg_temp.a('p0'), 'grant', 10);
  assert v = 15, format('xp +50%%: %s', v);
  q := public._npc_quota(pg_temp.a('p0'));
  assert (q->>'full')::int = coalesce(public._econ_param('npc_full'), 20000) * 125 / 100 and (q->>'boost_pct')::int = 25, format('quota %s', q);
  v := public._npc_sale(pg_temp.a('p0'), (coalesce(public._econ_param('npc_full'), 20000) * 125 / 100)::int);
  assert v = coalesce(public._econ_param('npc_full'), 20000) * 125 / 100, format('full price within the boosted band: %s', v);
  -- expired
  update public.account_boosts set starts_at = now() - interval '8 days', until = now() - interval '1 day' where account_id = pg_temp.a('p0');
  assert public._boost_pct(pg_temp.a('p0'), 'xp') = 0, 'expired';
  v := public._pg_add_xp(pg_temp.a('p0'), 'grant', 10);
  assert v = 10, format('xp after expiry: %s', v);
  assert (public._npc_quota(pg_temp.a('p0'))->>'full')::int = coalesce(public._econ_param('npc_full'), 20000), 'quota after expiry';
  assert jsonb_array_length(public.beta_me(pg_temp.t('p0'))->'boosts') = 0, 'beta_me after expiry';
end $$;

-- ---------- 8. Idempotency ----------
do $$
declare j jsonb; v_mail bigint := (select count(*) from public.mail); v_rods bigint := (select count(*) from public.rods);
        v_coins bigint := (select coalesce(sum(coins), 0) from public.wallets);
begin
  j := public.admin_beta_reset(pg_temp.t('root'), 'RESET BETA');
  assert (j->>'already')::boolean, 'second call is a no-op';
  assert (select count(*) from public.mail) = v_mail and (select count(*) from public.rods) = v_rods
     and (select coalesce(sum(coins), 0) from public.wallets) = v_coins, 'nothing moved';
  assert pg_temp.fails(format('select public.admin_beta_snapshot(%L)', pg_temp.t('root')), 'already applied'), 'snapshot after reset';
  j := public.admin_beta_status(pg_temp.t('root'));
  assert j->>'applied_at' is not null and (j->'summary'->>'rewarded')::int >= 6, 'status after';
end $$;

-- the news post (scripts/db/beta-reset-news.sql): once, after the reset, unpinned
\o /dev/null
\i scripts/db/beta-reset-news.sql
\i scripts/db/beta-reset-news.sql
\o
do $$
begin
  assert (select count(*) from public.news_posts where title like 'Kết thúc Beta%' and not pinned) = 1, 'one news post';
end $$;

rollback;
select 'beta-reset-smoke: ok' as result;
