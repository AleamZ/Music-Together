-- tests/sql/econ-farm-smoke.sql — 0102 (Kinh tế v2, the farm: spec 2026-09-30-economy-v2-design.md §5). Run as the
-- superuser on the throwaway cluster after the full chain (0004 … 0102), from the repo root:
--   psql -f tests/sql/econ-farm-smoke.sql
-- It re-runs 0102 twice with \i (the second time over listings, subleases and offers outside the new bounds, which the
-- migration withdraws), then 0120, whose harvest functions replace three of 0102's. Every check is an ASSERT; the first failure stops psql. It turns app_flags.room_creation_open on
-- for its rooms (other smokes do the same after 0093) and puts it back as it was at the end. Time is the real now(),
-- passed as p_now to the private _farm_do_* functions (the public RPCs are wrappers that add the anti-cheat gate).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0102_econ_farm.sql
\i supabase/migrations/0102_econ_farm.sql
reset client_min_messages;

create temp table ef (k text primary key, v text);
insert into ef select 'flag', enabled::text from public.app_flags where key = 'room_creation_open';
update public.app_flags set enabled = true where key = 'room_creation_open';
update public.anticheat_config set mode = 'log', min_client_build = 0;
insert into ef select 't' || x, token from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'z']) x,
  lateral public.register('ef' || x || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into ef select 'a' || substr(k, 2), public._auth_account(v)::text from ef where k like 't%';
insert into ef select 'r' || i, room_id::text from generate_series(1, 4) i,
  lateral public.create_room('Econ farm ' || i, 'pw', (select v from ef where k = 'tz'));
select count(*) from (select public.join_room((select code from public.rooms where id = r.v::uuid), 'pw', t.v)
                        from ef r, ef t where r.k like 'r%' and t.k like 't%' and t.k <> 'tz') x;
insert into public.wallets (account_id, coins) select v::uuid, 3000000 from ef where k like 'a%'
  on conflict (account_id) do update set coins = 3000000;

create or replace function pg_temp.t(p text) returns text language sql stable as $$ select v from ef where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql stable as $$ select v::uuid from ef where k = 'a' || p $$;
create or replace function pg_temp.r(i integer) returns uuid language sql stable as $$ select v::uuid from ef where k = 'r' || i $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
#variable_conflict use_variable
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.coins(p uuid) returns integer language sql stable as $$
  select coalesce((select coins from public.wallets where account_id = p), 0)
$$;
-- the wallet less the rewards paid by the progression (a sale's XP can level an account up, which pays a level reward)
create or replace function pg_temp.bal(p uuid) returns integer language sql stable as $$
  select pg_temp.coins(p) - coalesce((select sum(delta)::int from public.coin_ledger where account_id = p
                                        and reason in ('level_reward', 'achievement_reward', 'collection_reward', 'quest_reward')), 0)
$$;
create or replace function pg_temp.set_coins(p uuid, n integer) returns void language sql as $$
  insert into public.wallets (account_id, coins) values (p, n) on conflict (account_id) do update set coins = excluded.coins
$$;
create or replace function pg_temp.events(p uuid, k text) returns bigint language sql stable as $$
  select count(*) from public.game_events where account_id = p and kind = k
$$;
-- A ripe nếp crop on plot n: ripe 2 h before t (transplanted 48·s + 2 h before t; sown 10·s h before that, soaked 3 h
-- before sowing), drained 5 h before t — ripe until t + 10 h. In hours of the variety's scale (0120: s 1 → 0.25).
create or replace function pg_temp.ripe_nep(r uuid, n integer, a uuid, t timestamptz) returns void language sql as $$
  with s as (select scale from public.rice_varieties where id = 'nep'),
       x as (select t - make_interval(secs => (48 * s.scale + 2) * 3600) as tp from s),
       y as (select x.tp, x.tp - make_interval(secs => 10 * s.scale * 3600) as sow from x, s)
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
  select r, n, a, 'nep', y.sow - interval '4 hours', y.sow - interval '3 hours', y.sow, y.tp,
         jsonb_build_array(jsonb_build_object('t', y.sow - interval '4 hours', 'l', 3),
                           jsonb_build_object('t', t - interval '5 hours', 'l', 1))
    from y
$$;
-- rats off in these rooms (their spawns would eat the ripe crops the checks weigh)
insert into public.rat_clocks (room_id, last_k) select v::uuid, 9000000000000000000 from ef where k like 'r%'
  on conflict (room_id) do update set last_k = excluded.last_k;
select public._field_open(v::uuid, now()) from ef where k like 'r%';

-- ---------- A1. Plot caps per account across all rooms ----------
do $$
declare a uuid := pg_temp.a('a'); b uuid := pg_temp.a('b'); t timestamptz := now(); s jsonb;
begin
  -- a rents a village plot in room 1 and one in room 2: the limit of 2 is reached everywhere
  perform public._farm_do_rent(pg_temp.r(1), a, 5, t);
  s := public._farm_do_rent(pg_temp.r(2), a, 5, t);
  assert public._farm_count(pg_temp.r(3), a, t) = 2 and public._farm_count(pg_temp.r(1), a, t) = 2, 'two plots, counted in any room';
  assert s->'mine'->'farm_total' = '2' and s->'mine'->'owns_land' = 'false' and s->'mine'->'farming' = '[5]',
    format('the view: the room''s plots and the total %s', s->'mine');
  assert s->'p2p_fee_pct' = '5', format('the fee %s', s->'p2p_fee_pct');
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 5, %L)', pg_temp.r(3), a, t)) = 'farm limit', 'no third rent';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', pg_temp.r(3), a, t)) = 'farm limit', 'no plot bought';
  -- b owns plot 2 of room 3 and offers it for a season: a cannot take it either
  perform public._farm_do_buy_plot(pg_temp.r(3), b, 2, t);
  perform public._farm_do_set_sublease(pg_temp.r(3), b, 2, 20000, t);
  assert pg_temp.err(format('select public._farm_do_rent_sublease(%L, %L, 2, 20000, %L)', pg_temp.r(3), a, t)) = 'farm limit',
    'no sublease past the limit';
  -- one private plot per account: b cannot buy another one in another room
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 3, %L)', pg_temp.r(2), b, t)) = 'already own land',
    'b owns land in room 3';
  -- the lease in room 2 ends: one plot farmed, so a buys a private plot in room 3
  update public.plot_leases set until = t - interval '1 second' where room_id = pg_temp.r(2) and farmer_id = a;
  perform public._farm_do_buy_plot(pg_temp.r(3), a, 1, t);
  assert public._farm_count(pg_temp.r(1), a, t) = 2 and public._owns_land(pg_temp.r(2), a), 'a lease and a private plot';
  -- no second private plot for a, from the village or by an offer
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', pg_temp.r(1), a, t)) = 'already own land',
    'no second private plot';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 2, 500000, %L)', pg_temp.r(3), a, t)) = 'already own land',
    'no offer while owning land';
  -- selling the plot back frees both caps
  perform public._farm_do_sell_to_village(pg_temp.r(3), a, 1, t);
  assert not public._owns_land(pg_temp.r(3), a) and public._farm_count(pg_temp.r(3), a, t) = 1, 'sold back';
  perform public._farm_do_offer(pg_temp.r(3), a, 2, 500000, t);
  assert exists (select 1 from public.land_offers where buyer_id = a and price = 500000), 'the offer stands now';
  delete from public.land_offers where buyer_id = a;
  delete from public.plot_leases where farmer_id = a;
  raise notice 'A1 caps ok';
end $$;

-- Nobody loses what they hold: an account over the caps (a pre-v2 holding: two private plots and a lease) keeps and farms
-- all of them; only a new rent or purchase is refused until it is under the caps.
do $$
declare c uuid := pg_temp.a('c'); t timestamptz := now(); s jsonb;
begin
  update public.field_plots set owner_id = c, owned_at = t where (room_id, plot_no) in ((pg_temp.r(1), 2), (pg_temp.r(2), 2));
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (pg_temp.r(3), 6, c, 'village', 10000, t, t + interval '96 hours');
  assert public._farm_count(pg_temp.r(4), c, t) = 3, 'three plots held';
  s := public._farm_do_prepare(pg_temp.r(1), c, 2, t);
  perform public._farm_do_prepare(pg_temp.r(2), c, 2, t);
  perform public._farm_do_prepare_beds(pg_temp.r(3), c, 6, t);
  assert (select count(*) from public.crops where farmer_id = c) = 3, 'all three are farmed';
  assert s->'mine'->'farm_total' = '3' and s->'mine'->'owns_land' = 'true', format('the view %s', s->'mine');
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 7, %L)', pg_temp.r(3), c, t)) = 'farm limit', 'no new rent';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', pg_temp.r(4), c, t)) = 'already own land', 'no new plot';
  perform public._field_open(pg_temp.r(1), t);
  perform public._field_open(pg_temp.r(2), t);
  assert (select count(*) from public.field_plots where owner_id = c) = 2, 'nothing is taken away';
  -- under the caps again: one private plot sold back, the lease ended → a rent is taken again
  delete from public.crops where farmer_id = c and room_id = pg_temp.r(2);
  perform public._farm_do_sell_to_village(pg_temp.r(2), c, 2, t);
  delete from public.crops where farmer_id = c and room_id = pg_temp.r(3);
  delete from public.plot_leases where farmer_id = c;
  perform public._farm_do_rent(pg_temp.r(3), c, 7, t);
  assert public._farm_count(pg_temp.r(3), c, t) = 2, 'a private plot and a new lease';
  delete from public.crops where farmer_id = c;
  delete from public.plot_leases where farmer_id = c;
  perform public._farm_do_sell_to_village(pg_temp.r(1), c, 2, t);
  raise notice 'A1 grandfathered ok';
end $$;

-- A closed room's plot counts for nobody (a room closed since 0093 to all but its admin): its owner may buy in the open.
do $$
declare d uuid := pg_temp.a('d'); t timestamptz := now();
begin
  perform public._farm_do_buy_plot(pg_temp.r(4), d, 4, t);
  assert public._owns_land(pg_temp.r(1), d) and public._farm_count(pg_temp.r(1), d, t) = 1, 'open: it counts';
  update public.app_flags set enabled = false where key = 'room_creation_open';
  assert not public._room_open_for(pg_temp.r(4), d) and public._room_open_for(pg_temp.r(4), pg_temp.a('z')), 'room 4 closed but to its admin';
  assert not public._owns_land(pg_temp.r(1), d) and public._farm_count(pg_temp.r(1), d, t) = 0, 'closed: it does not';
  update public.app_flags set enabled = true where key = 'room_creation_open';
  perform public._farm_do_sell_to_village(pg_temp.r(4), d, 4, t);
  raise notice 'A1 closed room ok';
end $$;

-- ---------- A3. Player land deals: the band, the fee, subleases ----------
do $$
declare b uuid := pg_temp.a('b'); e uuid := pg_temp.a('e'); g uuid := pg_temp.a('g'); r uuid := pg_temp.r(3); t timestamptz := now();
        cb integer; ce integer; o uuid; s jsonb;
begin
  -- b owns plot 2 of room 3 (A1), offered for a season at 20 000
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 2, 399999, %L)', r, b, t)) = 'invalid price', 'below the band';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 2, 2400001, %L)', r, b, t)) = 'invalid price', 'above the band';
  perform public._farm_do_list(r, b, 2, 400000, t);
  perform public._farm_do_list(r, b, 2, 2400000, t);
  assert pg_temp.err(format('update public.field_plots set sale_price = 5000000 where room_id = %L and plot_no = 2', r))
         like '%field_plots_sale_price_check%', 'the check';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 2, 399999, %L)', r, e, t)) = 'invalid price', 'an offer below';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 2, 2400001, %L)', r, e, t)) = 'invalid price', 'an offer above';
  assert pg_temp.err(format('insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (%L, 2, %L, 100, now())', r, e))
         like '%land_offers_price_check%', 'the offers'' check';
  -- a listing sold: the buyer pays the price, the seller gets 95 %, 5 % is burned
  perform public._farm_do_list(r, b, 2, 1000000, t);
  cb := pg_temp.bal(b); ce := pg_temp.bal(e);
  s := public._farm_do_buy_listed(r, e, 2, 1000000, t);
  assert pg_temp.bal(e) = ce - 1000000 and pg_temp.bal(b) = cb + 950000,
    format('the sale: %s → %s, %s → %s', ce, pg_temp.bal(e), cb, pg_temp.bal(b));
  assert (select owner_id = e and sale_price is null and sublease_price is null from public.field_plots where room_id = r and plot_no = 2),
    'e owns it, nothing listed';
  assert exists (select 1 from public.coin_ledger where account_id = b and reason = 'land_sell' and delta = 950000)
     and exists (select 1 from public.coin_ledger where account_id = e and reason = 'land_buy' and delta = -1000000), 'the ledger';
  assert s->'mine'->'owns_land' = 'true' and s->'mine'->'owned_plot' = '2', 'the buyer''s view';
  -- an accepted offer, at a 10 % fee (the knob): floor(price × 90 / 100)
  update public.econ_params set value = 10 where key = 'p2p_fee_pct';
  perform public._farm_do_offer(r, g, 2, 777777, t);
  select id into o from public.land_offers where buyer_id = g;
  ce := pg_temp.bal(e); cb := pg_temp.bal(g);
  s := public._farm_do_accept_offer(r, e, o, t);
  assert pg_temp.bal(g) = cb - 777777 and pg_temp.bal(e) = ce + 699999, format('an offer at 10 %%: %s', pg_temp.bal(e) - ce);
  assert s->'p2p_fee_pct' = '10', 'the view shows the knob';
  update public.econ_params set value = 5 where key = 'p2p_fee_pct';
  -- subleases: at most 50 000, the owner gets 95 %
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 2, 50001, %L)', r, g, t)) = 'invalid price', 'above 50 000';
  assert pg_temp.err(format('update public.field_plots set sublease_price = 50001 where room_id = %L and plot_no = 2', r))
         like '%field_plots_sublease_price_check%', 'the sublease check';
  perform public._farm_do_set_sublease(r, g, 2, 50000, t);
  cb := pg_temp.bal(g); ce := pg_temp.bal(e);
  perform public._farm_do_rent_sublease(r, e, 2, 50000, t);
  assert pg_temp.bal(e) = ce - 50000 and pg_temp.bal(g) = cb + 47500, format('the sublease: %s', pg_temp.bal(g) - cb);
  assert exists (select 1 from public.coin_ledger where account_id = g and reason = 'lease_income' and delta = 47500), 'lease_income';
  assert (select price from public.plot_leases where room_id = r and plot_no = 2) = 50000, 'the lease records what was paid';
  delete from public.plot_leases where room_id = r and plot_no = 2;
  raise notice 'A3 land deals ok';
end $$;

-- Re-running 0102 over deals outside the new bounds (an old database): they are withdrawn, the checks come back.
do $$
declare b uuid := pg_temp.a('b'); t timestamptz := now();
begin
  perform public._farm_do_buy_plot(pg_temp.r(1), b, 1, t);
  alter table public.field_plots drop constraint field_plots_sale_price_check;
  alter table public.field_plots drop constraint field_plots_sublease_price_check;
  alter table public.land_offers drop constraint land_offers_price_check;
  update public.field_plots set sale_price = 5000000, sublease_price = 100000 where room_id = pg_temp.r(3) and plot_no = 2;
  update public.field_plots set sale_price = 100, sublease_price = 45000 where room_id = pg_temp.r(1) and plot_no = 1;
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (pg_temp.r(3), 2, b, 3000000, now());
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (pg_temp.r(3), 2, pg_temp.a('d'), 900000, now());
end $$;
set client_min_messages = warning;
\i supabase/migrations/0102_econ_farm.sql
-- 0120 re-creates three of 0102's harvest functions (a lease runs its 96 h): put them back over the re-run (A4 checks them)
\i supabase/migrations/0120_farm_one_day.sql
reset client_min_messages;
do $$
begin
  assert (select sale_price is null and sublease_price is null from public.field_plots where room_id = pg_temp.r(3) and plot_no = 2),
    'out-of-band listing and sublease withdrawn';
  assert (select sale_price is null and sublease_price = 45000 from public.field_plots where room_id = pg_temp.r(1) and plot_no = 1),
    'a 100 xu listing withdrawn, a 45 000 sublease kept';
  assert not exists (select 1 from public.land_offers where price = 3000000) and exists (select 1 from public.land_offers where price = 900000),
    'offers: out of band withdrawn, in band kept';
  assert (select count(*) from pg_constraint where conname in ('field_plots_sale_price_check', 'field_plots_sublease_price_check',
                                                               'land_offers_price_check')) = 3, 'the checks are back';
  delete from public.land_offers where price = 900000;
  update public.field_plots set sublease_price = null where room_id = pg_temp.r(1) and plot_no = 1;
  raise notice 'A3 re-run ok';
end $$;

-- ---------- A2. The processor: 50 000, ≈ 1.15× recipes, +1 / +2 % sort bonus ----------
do $$
begin
  assert public._machine_price('processor') = 50000 and public._machine_price('sprinkler') = 6000
     and public._machine_price('harvester') = 15000, 'the machines';
  assert (select jsonb_object_agg(id, value) from public.processor_recipes)
         = '{"gao_trang": 8150, "banh_tet": 10900, "gao_thom": 15500, "khoai_say": 3050, "bot_bap": 5300, "tuong_ot": 9150}'::jsonb,
    'the recipes';
  -- ≈ 1.15× the field price of the input (10 kg rice or khoai / bắp, 5 kg ớt)
  assert (select bool_and(r.value::numeric / (r.input_kg * coalesce(v.price_per_kg, u.price_per_kg)) between 1.13 and 1.16)
            from public.processor_recipes r left join public.rice_varieties v on r.input_kind = 'rice' and v.id = r.input_id
            left join public.upland_crops u on r.input_kind = 'upland' and u.id = r.input_id), '≈ 1.15×';
  assert array[public._sort_bonus(0), public._sort_bonus(7), public._sort_bonus(8), public._sort_bonus(10), public._sort_bonus(11),
               public._sort_bonus(12)] = array[0, 0, 1, 1, 2, 2], 'the sort bonus';
end $$;

-- An honest sort round (0087: the grains are revealed by mg_sync 1 s ahead; time passes by moving the round's clocks back).
create or replace function pg_temp.warp(p uuid, p_s numeric) returns void language plpgsql as $$
#variable_conflict use_variable
declare iv interval := make_interval(secs => p_s);
begin
  update public.mg_live set opened_at = opened_at - iv, started_at = started_at - iv,
         seen = coalesce((select array_agg(x - iv order by o) from unnest(seen) with ordinality u(x, o)), '{}'),
         a_at = coalesce((select array_agg(x - iv order by o) from unnest(a_at) with ordinality u(x, o)), '{}'),
         b_at = coalesce((select array_agg(x - iv order by o) from unnest(b_at) with ordinality u(x, o)), '{}')
   where account_id = p;
  update public.craft_rounds set started_at = started_at - iv where account_id = p;
end $$;
create or replace function pg_temp.ev(r jsonb, i integer) returns jsonb language sql immutable as $$
  select e->'d' from jsonb_array_elements(r->'ev') e where (e->>'i')::int = i
$$;
-- Plays the collected job's sort round, putting the first p_wrong grains in the wrong basket; returns the finish's answer.
create or replace function pg_temp.sort(p text, p_wrong integer) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare t text := pg_temp.t(p); a uuid := pg_temp.a(p); j jsonb; r jsonb; e integer; ng integer := 0;
        ticks integer[] := '{}'; dirs integer[] := '{}'; react integer[] := array[9, 14, 11, 20, 12, 16, 10, 18, 13, 15, 22, 17];
begin
  insert into public.player_stamina (account_id, value) values (a, 100) on conflict (account_id) do update set value = 100;
  j := public.process_sort_start(t);
  r := public.mg_sync(t, 'sort');
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'sort', (select coalesce(array_agg(ticks[q] * 2 + dirs[q] order by q), '{}')
                                      from generate_series(1, cardinality(ticks)) q), null);
    e := (r->>'t')::int;
    if ng < 12 and pg_temp.ev(r, ng + 1) is not null and 40 + 45 * ng + react[ng + 1] <= e then
      ticks := ticks || (40 + 45 * ng + react[ng + 1]);
      dirs := dirs || case when ng < p_wrong then 1 - (pg_temp.ev(r, ng + 1)->>'kind')::int else (pg_temp.ev(r, ng + 1)->>'kind')::int end;
      ng := ng + 1;
    end if;
    exit when e >= 580;
  end loop;
  return public.process_sort_finish(t, ticks, dirs, 12 - p_wrong);
end $$;

do $$
declare f uuid := pg_temp.a('f'); t text := pg_temp.t('f'); s jsonb; c0 integer;
begin
  insert into public.player_pos (account_id, map, x, y, at) values (f, 'field', 432, 468, now())
  on conflict (account_id) do update set map = 'field', x = 432, y = 468, at = now(), tab = null, tabs = '{}';
  perform pg_temp.set_coins(f, 60000);
  c0 := pg_temp.bal(f);
  s := public.buy_machine(t, 'processor');
  assert pg_temp.bal(f) = c0 - 50000 and exists (select 1 from public.coin_ledger where account_id = f and reason = 'machine' and delta = -50000),
    format('the processor costs 50 000: %s', c0 - pg_temp.bal(f));
  -- 50 kg of dry thơm → 5 batches of gạo thơm; sorted 12 / 12 → +2 % paid at once
  perform public._rice_add(f, 'thom', 0, 80);
  perform public.process_start(t, 'gao_thom', 5);
  update public.processor_jobs set ready_at = now() - interval '1 second' where account_id = f;
  c0 := pg_temp.bal(f);
  s := pg_temp.sort('f', 0);
  assert s->>'result' = 'collected' and s->'score' = '12' and s->'bonus_pct' = '2' and s->'bonus' = '1550', format('12 / 12: %s', s - 'extras');
  assert pg_temp.bal(f) = c0 + 1550
     and exists (select 1 from public.coin_ledger where account_id = f and reason = 'produce_sell' and delta = 1550
                   and ref = 'sort bonus gao_thom x5'), 'the bonus: 15 500 × 5 × 2 %';
  -- 30 kg more: 3 batches sorted 9 / 12 → +1 %
  perform public.process_start(t, 'gao_thom', 3);
  update public.processor_jobs set ready_at = now() - interval '1 second' where account_id = f;
  c0 := pg_temp.bal(f);
  s := pg_temp.sort('f', 3);
  assert s->>'result' = 'collected' and s->'bonus_pct' = '1' and s->'bonus' = '465', format('9 / 12: %s', s - 'extras');
  assert pg_temp.bal(f) = c0 + 465, 'the bonus: 15 500 × 3 × 1 %';
  -- the goods sell at the recipe's new value
  c0 := pg_temp.bal(f);
  s := public.sell_goods(t, 'gao_thom', 8);
  assert pg_temp.bal(f) = c0 + 8 * 15500, format('8 bags of gạo thơm: %s', pg_temp.bal(f) - c0);
  raise notice 'A2 processor ok';
end $$;

-- ---------- A4. crop_harvest when a plot's crop is in ----------
do $$
declare g uuid := pg_temp.a('g'); r uuid := pg_temp.r(1); t timestamptz := now(); s jsonb; i integer; kg integer := 0;
        xp0 integer;
begin
  -- quest n_nghe_1 ("Thu hoạch 5 lần") accepted (its giver's position is 0071's business)
  insert into public.quest_progress (account_id, quest_id, period) values (g, 'n_nghe_1', '') on conflict do nothing;
  xp0 := coalesce((select xp from public.player_professions where account_id = g and prof = 'nong_dan'), 0);
  insert into public.inventory (account_id, item_id, qty) values (g, 'tool_sickle', 1) on conflict do nothing;
  -- a hand harvest: nothing until the sixth part
  perform public._farm_do_rent(r, g, 5, t);
  perform pg_temp.ripe_nep(r, 5, g, t);
  for i in 1 .. 6 loop
    assert pg_temp.events(g, 'crop_harvest') = 0, format('no event before part %s', i);
    perform public._farm_do_begin_work(r, g, 5, 'harvest', t + make_interval(secs => 10 * i));
    s := public._farm_do_harvest_part(r, g, 5, true, t + make_interval(secs => 10 * i + 8));
    kg := kg + (s->'harvest_part'->>'kg')::int;
  end loop;
  assert pg_temp.events(g, 'crop_harvest') = 1
     and (select meta = jsonb_build_object('kind', 'rice', 'crop', 'nep', 'kg', kg, 'via', 'hand') and qty = 1
            from public.game_events where account_id = g and kind = 'crop_harvest'), format('the hand harvest: %s kg', kg);
  -- 0120: a lease runs its 96 h — the last part cut by hand does not end it (g could replant); freed here for the cap
  assert exists (select 1 from public.plot_leases where room_id = r and farmer_id = g and plot_no = 5), 'the lease runs on (hand)';
  delete from public.plot_leases where room_id = r and farmer_id = g and plot_no = 5;
  -- the harvester: the sweep pays the parts left and emits it (two parts were cut by hand first)
  perform public._farm_do_rent(r, g, 6, t);
  perform pg_temp.ripe_nep(r, 6, g, t);
  perform public._farm_do_begin_work(r, g, 6, 'harvest', t);
  perform public._farm_do_harvest_part(r, g, 6, true, t + interval '8 seconds');
  perform public._farm_do_rent_harvester(r, g, 6, t + interval '9 seconds');
  perform public._field_open(r, t + interval '8 seconds');
  assert pg_temp.events(g, 'crop_harvest') = 1, 'not before the job is done';
  perform public._field_open(r, t + interval '40 seconds');
  assert pg_temp.events(g, 'crop_harvest') = 2
     and (select meta->>'via' = 'harvester' and meta->>'crop' = 'nep' and (meta->>'kg')::int > 0 from public.game_events
           where account_id = g and kind = 'crop_harvest' order by id desc limit 1), 'the harvester''s job';
  assert not exists (select 1 from public.crops where room_id = r and plot_no = 6), 'the plot is free';
  -- 0120: nor does the harvester's job
  assert exists (select 1 from public.plot_leases where room_id = r and farmer_id = g and plot_no = 6), 'the lease runs on (harvester)';
  delete from public.plot_leases where room_id = r and farmer_id = g and plot_no = 6;
  -- hoa màu: khoai (one picking) emits at its picking; ớt only at the last of its three
  perform public._farm_do_rent(r, g, 7, t);
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
  values (r, 7, g, 'upland', 'khoai', t - interval '50 hours', t - interval '49 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '1 hour', 'l', 1)));
  perform public._farm_do_begin_work(r, g, 7, 'harvest', t);
  s := public._farm_do_harvest(r, g, 7, 1.0, t + interval '3 seconds');
  assert s->'harvest'->'done' = 'true' and pg_temp.events(g, 'crop_harvest') = 3
     and (select meta = jsonb_build_object('kind', 'upland', 'crop', 'khoai', 'via', 'hand', 'kg', (s->'harvest'->>'kg')::int)
            from public.game_events where account_id = g and kind = 'crop_harvest' order by id desc limit 1), format('khoai %s', s->'harvest');
  assert exists (select 1 from public.plot_leases where room_id = r and farmer_id = g and plot_no = 7), 'the khoai lease runs on (0120)';
  delete from public.plot_leases where room_id = r and farmer_id = g and plot_no = 7;
  perform public._farm_do_rent(r, g, 8, t);
  -- ớt planted between picking 1's loss and picking 2's (0120: 13.8 h, lost 32 h later; 17.4 h; 21 h): picking 1 is gone,
  -- 2 and 3 are ready — the event at the last
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, plant_at, water_log)
  select r, 8, g, 'upland', 'ot', t - make_interval(secs => (h + u.nursery_ready_h + 1) * 3600),
         t - make_interval(secs => (h + u.nursery_ready_h + 1) * 3600), t - make_interval(secs => h * 3600),
         jsonb_build_array(jsonb_build_object('t', t - interval '1 hour', 'l', 1))
    from public.upland_crops u,
         lateral (select ((public._up_hours(u, 1) + public._up_hours(u, 2)) / 2 + u.ripe_window_h + u.lost_after_h) as h) x
   where u.id = 'ot';
  perform public._farm_do_begin_work(r, g, 8, 'harvest', t);
  s := public._farm_do_harvest(r, g, 8, 1.0, t + interval '3 seconds');
  assert s->'harvest'->'done' = 'false' and pg_temp.events(g, 'crop_harvest') = 3, format('ớt, not the last %s', s->'harvest');
  perform public._farm_do_begin_work(r, g, 8, 'harvest', t + interval '10 seconds');
  s := public._farm_do_harvest(r, g, 8, 1.0, t + interval '13 seconds');
  assert s->'harvest'->'done' = 'true' and pg_temp.events(g, 'crop_harvest') = 4, format('ớt, the last %s', s->'harvest');
  -- the quest and the nghề XP take them
  assert (select progress from public.quest_progress where account_id = g and quest_id = 'n_nghe_1') = 4, 'n_nghe_1: 4 / 5';
  assert coalesce((select xp from public.player_professions where account_id = g and prof = 'nong_dan'), 0) >= xp0 + 40,
    'nông dân XP: 10 a harvest';
  raise notice 'A4 crop_harvest ok';
end $$;

-- ---------- A5. The thương lái buys the crabs, snails and rats ----------
do $$
declare e uuid := pg_temp.a('e'); t text := pg_temp.t('e'); s jsonb; c0 integer;
begin
  -- 10 000 xu of goods already sold today; 15 000 of critters at their catch prices: 10 000 at full price, 5 000 at half
  insert into public.econ_npc_days (account_id, day, gross, paid) values (e, public._vn_today(), 10000, 10000)
  on conflict (account_id, day) do update set gross = 10000, paid = 10000;
  delete from public.critters where account_id = e;
  insert into public.critters (account_id, kind, price, caught_at) select e, 'cua_gach', 1500, now() from generate_series(1, 10);
  c0 := pg_temp.bal(e);
  s := public.sell_critters(t, null);
  assert s->'sold' = '{"n": 10, "xu": 12500}' and s->'npc_cut' = '2500', format('critters %s', s - 'mine');
  assert (s->'npc') - 'boost_pct' = jsonb_build_object('gross', 25000, 'full', 20000, 'half', 40000, 'tail_pct', 20), format('the day %s', s->'npc');   -- 0118 added boost_pct
  assert s->'mine'->'npc' = s->'npc', 'the account part carries the day';
  assert pg_temp.bal(e) = c0 + 12500
     and exists (select 1 from public.coin_ledger where account_id = e and reason = 'critter_sell' and delta = 12500), 'paid 12 500';
  -- rats: 20 000 more → 15 000 at half, 5 000 at 20 %
  insert into public.rat_bag (account_id, price, caught_at, how) select e, 2000, now(), 'dog' from generate_series(1, 10);
  c0 := pg_temp.bal(e);
  s := public.sell_rats(t);
  assert s->'sold' = '{"count": 10, "xu": 8500}' and s->'npc_cut' = '11500' and (s->'npc'->>'gross')::int = 45000,
    format('rats %s', s - 'mine');
  assert pg_temp.bal(e) = c0 + 8500 and exists (select 1 from public.coin_ledger where account_id = e and reason = 'rat_sell'
                                                    and delta = 8500), 'paid 8 500';
  -- a fresh day pays in full
  delete from public.econ_npc_days where account_id = e;
  insert into public.critters (account_id, kind, price, caught_at) values (e, 'cua_dong', 12, now());
  s := public.sell_critters(t, 'cua_dong');
  assert s->'sold' = '{"n": 1, "xu": 12}' and s->'npc_cut' = '0', format('a small sale %s', s - 'mine');
  raise notice 'A5 thương lái ok';
end $$;

-- ---------- Clean up: the flag as it was ----------
update public.app_flags set enabled = (select v::boolean from ef where k = 'flag') where key = 'room_creation_open';
select 'econ-farm smoke ok' as result;
