-- tests/sql/econ-core-smoke.sql — 0099 (economy watch) and 0100 (economy v2 core). Run as the superuser on the throwaway
-- cluster after the full chain, from the repo root. It re-runs 0099 and 0100 twice with \i. Every check is an ASSERT.
--   1. Knobs: the five seeded rows; _econ_param; admin_econ_set checks root and the range, and re-prices the fish
--      snapshots at once.
--   2. The fish multiplier is the knob, not the room's wealth (a rich room stays at ×1.00).
--   3. Thương lái: full price up to npc_full, 50 % up to npc_half, the tail beyond; the day's totals; _npc_quota.
--   4. Chợ Lớn ×1.10; the perk ledger pays no market_sell_pct and caps a day at 1 500.
--   5. admin_economy: supply, flows by reason, the daily series and today's thương lái; non-root refused.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0099_economy_watch.sql
\i supabase/migrations/0099_economy_watch.sql
\i supabase/migrations/0100_econ_core.sql
\i supabase/migrations/0100_econ_core.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log';

create temp table ex (k text primary key, v text);
insert into ex select 'rt', token from public.register('ecr_' || floor(random() * 1e9)::text, 'pw123456');
insert into ex select 'ra', public._auth_account(v)::text from ex where k = 'rt';
insert into ex select 'pt', token from public.register('ecp_' || floor(random() * 1e9)::text, 'pw123456');
insert into ex select 'pa', public._auth_account(v)::text from ex where k = 'pt';
update public.accounts set is_root = true where id = (select v from ex where k = 'ra')::uuid;
insert into public.wallets (account_id) select v::uuid from ex where k in ('ra', 'pa') on conflict do nothing;

-- ---------- 1. Knobs ----------
do $$
declare v_rt text := (select v from ex where k = 'rt'); v_pt text := (select v from ex where k = 'pt'); l jsonb;
begin
  assert (select count(*) from public.econ_params where key in ('fish_mult', 'npc_full', 'npc_half', 'npc_tail_pct', 'p2p_fee_pct')) = 5, 'seeded';
  assert public._econ_param('npc_full') = 20000 and public._econ_param('nope') is null, 'param read';
  begin
    perform public.admin_econ_set(v_pt, 'npc_full', 30000);
    assert false, 'non-root set passed';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.admin_econ_set(v_rt, 'npc_tail_pct', 101);
    assert false, 'out of range passed';
  exception when sqlstate '22023' then assert sqlerrm = 'out of range', sqlerrm;
  end;
  begin
    perform public.admin_econ_set(v_rt, 'nope', 1);
    assert false, 'unknown passed';
  exception when sqlstate '22023' then assert sqlerrm = 'unknown param', sqlerrm;
  end;
  l := public.admin_econ_set(v_rt, 'npc_full', 25000);
  assert (select (x->>'value')::numeric from jsonb_array_elements(l) x where x->>'key' = 'npc_full') = 25000, 'set answered';
  assert (select updated_by from public.econ_params where key = 'npc_full') = (select v from ex where k = 'ra')::uuid, 'who';
  perform public.admin_econ_set(v_rt, 'npc_full', 20000);
  raise notice 'knobs ok';
end $$;

-- ---------- 2. The fish multiplier ----------
do $$
declare v_rt text := (select v from ex where k = 'rt'); v_room uuid; r public.fish_price_index;
begin
  insert into public.rooms (code, name) values ('ECON' || floor(random() * 1e6)::text, 'econ smoke') returning id into v_room;
  -- two rich members seen today: the old law gave ×10
  insert into public.members (room_id, account_id, last_seen_at)
    select v_room, v::uuid, now() from ex where k in ('ra', 'pa');
  update public.wallets set coins = 5000000 where account_id in (select v::uuid from ex where k in ('ra', 'pa'));
  r := public._fish_index(v_room, now());
  assert r.mult = 1.00, format('rich room mult %s', r.mult);
  assert r.wealth >= 5000000, format('wealth still measured %s', r.wealth);
  perform public.admin_econ_set(v_rt, 'fish_mult', 0.8);
  assert (select mult from public.fish_price_index where room_id = v_room) = 0.80, 'snapshot re-priced at once';
  assert (public._fish_index(v_room, now())).mult = 0.80, 'index follows the knob';
  perform public.admin_econ_set(v_rt, 'fish_mult', 1);
  assert (public._fish_index(v_room, now())).mult = 1.00, 'back to 1';
  update public.wallets set coins = 0 where account_id in (select v::uuid from ex where k in ('ra', 'pa'));
  raise notice 'fish mult ok';
end $$;

-- ---------- 3. Thương lái ----------
do $$
declare v_a uuid := (select v from ex where k = 'pa')::uuid; q jsonb;
begin
  delete from public.econ_npc_days where account_id = v_a;
  assert public._npc_sale(v_a, 0) = 0 and public._npc_sale(v_a, -5) = 0, 'nothing sold';
  assert public._npc_sale(v_a, 15000) = 15000, 'full price';
  assert public._npc_sale(v_a, 10000) = 7500, 'crosses the full mark: 5 000 + 2 500';
  assert public._npc_sale(v_a, 30000) = 10500, 'crosses the half mark: 7 500 + 3 000';
  assert public._npc_sale(v_a, 1000) = 200, 'tail 20 %';
  assert (select gross from public.econ_npc_days where account_id = v_a and day = public._vn_today()) = 56000, 'gross';
  assert (select paid from public.econ_npc_days where account_id = v_a and day = public._vn_today()) = 33200, 'paid';
  q := public._npc_quota(v_a);
  assert (q->>'gross')::int = 56000 and (q->>'full')::int = 20000 and (q->>'half')::int = 40000 and (q->>'tail_pct')::int = 20,
    format('quota %s', q);
  -- yesterday does not count
  update public.econ_npc_days set day = day - 1 where account_id = v_a;
  assert public._npc_sale(v_a, 1000) = 1000, 'a new day';
  raise notice 'thương lái ok';
end $$;

-- ---------- 4. Chợ Lớn and perks ----------
do $$
declare v_a uuid := (select v from ex where k = 'pa')::uuid; v_before integer;
begin
  assert public._market_depot_pay(1000) = 1100 and public._market_depot_pay(37) = 40, 'depot ×1.10';
  -- a thương nhân main with the full market_sell tree gets no payout on player sales any more
  insert into public.player_profession_main (account_id, prof) values (v_a, 'thuong_nhan')
    on conflict (account_id) do update set prof = excluded.prof;
  insert into public.player_skills (account_id, node) select v_a, id from public.skill_nodes
   where prof = 'thuong_nhan' and perk = 'market_sell_pct' on conflict do nothing;
  perform public._wallet_lock(v_a);
  v_before := (select coins from public.wallets where account_id = v_a);
  perform public._pay(v_a, 10000, 'market_sell', 'market #1');
  assert (select coins from public.wallets where account_id = v_a) = v_before + 10000, 'no market perk payout';
  assert not exists (select 1 from public.coin_ledger where account_id = v_a and ref like 'perk: market_sell_pct'), 'no perk row';
  -- the daily perk cap: a fish-sale perk pays at most 1 500 a day in total
  insert into public.player_skills (account_id, node) select v_a, id from public.skill_nodes
   where prof = 'thuong_nhan' and perk = 'fish_sell_pct' on conflict do nothing;
  delete from public.perk_payouts where account_id = v_a;
  perform public._pay(v_a, 1000000, 'sell', '100 con');
  assert (select paid from public.perk_payouts where account_id = v_a and day = public._vn_today()) = 1500, 'cap 1 500';
  raise notice 'depot and perks ok';
end $$;

-- ---------- 5. admin_economy ----------
do $$
declare v_rt text := (select v from ex where k = 'rt'); v_pt text := (select v from ex where k = 'pt'); e jsonb;
begin
  e := public.admin_economy(v_rt);
  assert (e->'supply'->>'total')::bigint = (select coalesce(sum(w.coins), 0) from public.wallets w join public.accounts a on a.id = w.account_id where not a.is_banned),
    'supply total';
  assert jsonb_array_length(e->'daily') = 30, 'thirty days';
  assert ((e->'daily'->29)->>'supply')::bigint = (select coalesce(sum(coins), 0) from public.wallets), 'today ends at the supply';
  assert exists (select 1 from jsonb_array_elements(e->'flows'->'d1') f where f->>'reason' = 'sell' and (f->>'in')::bigint >= 1000000), 'flows';
  assert (e->'npc_today'->>'accounts')::int >= 1, format('npc today %s', e->'npc_today');
  begin
    perform public.admin_economy(v_pt);
    assert false, 'non-root economy passed';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'admin economy ok';
end $$;

-- ---------- Clean up: the smoke's accounts, room and rows go (their 1 000 000 xu sale would skew other smokes' income
-- checks on a shared database, e.g. anticheat-v2-part3's earnings baseline) ----------
delete from public.rooms where name = 'econ smoke';
delete from public.accounts where id in (select v::uuid from ex where k in ('ra', 'pa'));
