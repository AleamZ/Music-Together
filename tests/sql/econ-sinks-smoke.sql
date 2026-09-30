-- tests/sql/econ-sinks-smoke.sql — 0105 (Kinh tế v2, the sinks: spec 2026-09-30-economy-v2-design.md §8). Run as the
-- superuser on the throwaway cluster after the full chain, from the repo root. It re-runs 0105 twice with \i. Every
-- check is an ASSERT; the first failure stops psql.
--   1. S1 meal_buffs: the 13 rows; the rare-fish lifts 4 / 6 / 5 / 2 and the stamina regens 30 / 25 / 20 / 10, with
--      0077's durations; a meal bought through eat_meal grants them (the _perk_ledger trigger), the strongest wins.
--   2. S2 "Ngủ ngon": _stamina_rate ×1.2 (was ×1.5) — a motel night and a sleep, alone, with a phở, lying in the hammock;
--      the regen over a minute.
--   3. S4 housing: the prices; the upkeep pays 1 500; giving a lot back pays 20 000, a repossession 10 000; the
--      apartment rent is 2 000, buying 25 000, selling back 17 500; the helpers stay private.
--   4. The motel: a night 300, a month 6 000 (a third cheaper than 30 nights), 60 days ahead at most.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0105_econ_sinks.sql
\i supabase/migrations/0105_econ_sinks.sql
reset client_min_messages;
-- a clean street (the smoke may run twice on the same cluster)
select public._house_free(no, false) from public.house_lots;
update public.apartments set owner_id = null;
select public._apt_sweep();

create temp table es (k text primary key, v text);
insert into es select 'a', token from public.register('es_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into es select 'b', token from public.register('es_b_' || floor(random() * 1e9)::text, 'pw123456');
create temp view esv as select (select v from es where k = 'a') t, (select v from es where k = 'b') t2,
  public._auth_account((select v from es where k = 'a')) a, public._auth_account((select v from es where k = 'b')) a2;

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;

-- ---------- 1. S1: the meal buffs ----------
do $$
declare x esv; r record;
begin
  select * into x from esv;
  assert (select count(*) from public.meal_buffs) = 13, format('13 rows, %s', (select count(*) from public.meal_buffs));
  for r in select * from (values
      ('com_tam', 'strength', 15, 30), ('pho_bo', 'stamina_regen', 30, 30), ('banh_mi', 'speed', 5, 15),
      ('bun_bo', 'strength', 20, 30), ('ca_kho_to', 'rare_fish', 4, 30), ('canh_chua', 'rare_fish', 6, 30),
      ('ca_chien', 'rare_fish', 5, 20), ('tra_da', 'stamina_regen', 10, 15), ('nuoc_mia', 'speed', 8, 15),
      ('cafe_sua', 'speed', 10, 20), ('cafe_sua', 'stamina_regen', 20, 20), ('nuoc_dua', 'stamina_regen', 25, 20),
      ('sinh_to', 'rare_fish', 2, 20)) v(meal, key, value, minutes) loop
    assert exists (select 1 from public.meal_buffs b where b.meal_id = r.meal and b.key = r.key and b.value = r.value
                                                        and b.minutes = r.minutes), format('buff %s', to_jsonb(r));
  end loop;
  -- no stronger lift than 6 % left on the menu, no stamina buff above 30 %
  assert (select max(value) from public.meal_buffs where key = 'rare_fish') = 6, 'rare-fish lifts ≤ 6';
  assert (select max(value) from public.meal_buffs where key = 'stamina_regen') = 30, 'stamina buffs ≤ 30';
  -- the meal prices stay
  assert (select price from public.meal_catalog where id = 'pho_bo') = 400 and (select price from public.meal_catalog where id = 'canh_chua') = 500
     and (select price from public.meal_catalog where id = 'tra_da') = 50, 'meal prices';
  -- eating grants them through the ledger trigger
  perform public._wallet_lock(x.a); perform public._pay(x.a, 10000, 'daily', 'smoke');
  delete from public.player_buffs where account_id = x.a;
  perform public.eat_meal(x.t, 'pho_bo');
  assert public._buff(x.a, 'stamina_regen') = 30, format('phở %s', public._buff(x.a, 'stamina_regen'));
  assert (select until from public.player_buffs where account_id = x.a and kind = 'stamina_regen')
         between now() + interval '29 minutes' and now() + interval '31 minutes', 'phở 30 minutes';
  perform public.eat_meal(x.t, 'canh_chua');
  assert public._buff(x.a, 'rare_fish') = 6, format('canh chua %s', public._buff(x.a, 'rare_fish'));
  perform public.eat_meal(x.t, 'sinh_to');
  assert public._buff(x.a, 'rare_fish') = 6, 'a weaker lift does not lower a running one';
  perform public.eat_meal(x.t, 'tra_da');
  assert public._buff(x.a, 'stamina_regen') = 30, 'trà đá under a running phở';
  delete from public.player_buffs where account_id = x.a;
  perform public.eat_meal(x.t, 'tra_da');
  assert public._buff(x.a, 'stamina_regen') = 10, format('trà đá alone %s', public._buff(x.a, 'stamina_regen'));
  perform public.eat_meal(x.t, 'nuoc_dua');
  assert public._buff(x.a, 'stamina_regen') = 25, format('nước dừa %s', public._buff(x.a, 'stamina_regen'));
  delete from public.player_buffs where account_id = x.a;
  perform public.eat_meal(x.t, 'cafe_sua');
  assert public._buff(x.a, 'stamina_regen') = 20 and public._buff(x.a, 'speed') = 10, 'cà phê sữa';
  delete from public.player_buffs where account_id = x.a;
  perform public.eat_meal(x.t, 'ca_chien');
  assert public._buff(x.a, 'rare_fish') = 5, 'cá chiên';
  delete from public.player_buffs where account_id = x.a;
  perform public.eat_meal(x.t, 'ca_kho_to');
  assert public._buff(x.a, 'rare_fish') = 4, 'cá kho tộ';
  delete from public.player_buffs where account_id = x.a;
  raise notice 'meal buffs ok';
end $$;

-- ---------- 2. S2: "Ngủ ngon" ×1.2 ----------
do $$
declare x esv; j jsonb; base numeric := 100.0 / 600; v numeric;
begin
  select * into x from esv;
  delete from public.rest_state where account_id = x.a;
  delete from public.player_buffs where account_id = x.a;
  assert public._perk(x.a, 'stamina_regen_pct') = 0, 'no regen perk';
  assert round(public._stamina_rate(x.a, false), 6) = round(base, 6), format('awake %s', public._stamina_rate(x.a, false));
  -- a motel night and a sleep
  j := public.motel_rent(x.t, 'night');
  assert exists (select 1 from public.coin_ledger where account_id = x.a and reason = 'motel' and delta = -300), 'the night is 300';
  j := public.motel_sleep(x.t);
  assert public._rest_factor(x.a) = 0.7, 'rested: the drain ×0.7 stays';
  assert round(public._stamina_rate(x.a, false), 6) = 0.2, format('rested ×1.2 %s', public._stamina_rate(x.a, false));
  assert round(public._stamina_rate(x.a, true), 6) = 0.6, format('rested in the hammock %s', public._stamina_rate(x.a, true));
  -- with a phở (+30 %): 100/600 × 1.3 × 1.2
  perform public.eat_meal(x.t, 'pho_bo');
  assert round(public._stamina_rate(x.a, false), 6) = 0.26, format('rested + phở %s', public._stamina_rate(x.a, false));
  -- the regen over a minute, rested without a buff: 12 (was 15)
  delete from public.player_buffs where account_id = x.a;
  delete from public.player_stamina where account_id = x.a;
  perform public._stamina_settle(x.a);
  update public.player_stamina set value = 0, at = now() - interval '60 seconds', rest_until = null where account_id = x.a;
  v := (public._stamina_settle(x.a)).value;
  assert v between 11.99 and 12.01, format('12 a minute rested, %s', v);
  -- the buff over: back to the base rate
  update public.rest_state set buff_until = now() - interval '1 second' where account_id = x.a;
  assert round(public._stamina_rate(x.a, false), 6) = round(base, 6), 'buff over';
  raise notice 'rest ok';
end $$;

-- ---------- 3. S4: housing ----------
do $$
declare x esv; j jsonb; c0 integer; v_no smallint;
begin
  select * into x from esv;
  assert public._house_price('land') = 40000 and public._house_price('upkeep') = 1500 and public._house_price('refund') = 20000
     and public._house_price('repossess') = 10000, 'house prices';
  assert public._apt_price('rent') = 2000 and public._apt_price('buy') = 25000 and public._apt_price('sell') = 17500, 'flat prices';
  assert not has_function_privilege('anon', 'public._house_price(text)', 'execute')
     and not has_function_privilege('anon', 'public._house_sweep()', 'execute')
     and not has_function_privilege('anon', 'public._apt_price(text)', 'execute')
     and not has_function_privilege('anon', 'public._stamina_rate(uuid, boolean)', 'execute'), 'helpers stay private';
  perform public._wallet_lock(x.a); perform public._pay(x.a, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.a2); perform public._pay(x.a2, 200000, 'daily', 'smoke');

  -- a lot: buy, upkeep 1 500, give it back for 20 000
  c0 := (select coins from public.wallets where account_id = x.a);
  j := public.lot_buy(x.t, 1);
  assert (j->>'coins')::int = c0 - 40000, format('land %s', j->>'coins');
  j := public.lot_upkeep(x.t);
  assert (j->>'coins')::int = c0 - 41500, format('upkeep %s', j->>'coins');
  assert exists (select 1 from public.coin_ledger where account_id = x.a and reason = 'house_upkeep' and delta = -1500), 'upkeep row';
  assert pg_temp.fails(format('select public.lot_upkeep(%L)', x.t), 'too far ahead'), 'still 60 days ahead at most';
  j := public.lot_sell(x.t);
  assert (j->>'coins')::int = c0 - 41500 + 20000 and j->'mine' = 'null'::jsonb, format('given back %s', j);

  -- a repossession: 10 000
  j := public.lot_buy(x.t, 2);
  c0 := (select coins from public.wallets where account_id = x.a);
  update public.house_lots set paid_until = now() - interval '59 days' where no = 2;
  j := public.house_list(x.t);
  assert (j->'mine'->>'no')::int = 2 and (select coins from public.wallets where account_id = x.a) = c0, 'not yet (59 days)';
  update public.house_lots set paid_until = now() - interval '61 days' where no = 2;
  j := public.house_list(x.t);
  assert j->'mine' = 'null'::jsonb and (select owner_id from public.house_lots where no = 2) is null, format('repossessed %s', j);
  assert (select coins from public.wallets where account_id = x.a) = c0 + 10000, 'a quarter of the land back';
  assert exists (select 1 from public.coin_ledger where account_id = x.a and reason = 'house_refund' and delta = 10000
                   and ref = 'house #2: repossessed'), 'repossession row';

  -- a flat: rent 2 000, buy 25 000, sell back 17 500
  c0 := (select coins from public.wallets where account_id = x.a2);
  j := public.apt_rent(x.t2, 3);
  assert (j->>'coins')::int = c0 - 2000, format('rent %s', j->>'coins');
  assert exists (select 1 from public.coin_ledger where account_id = x.a2 and reason = 'apartment' and delta = -2000), 'rent row';
  assert (select paid_until between now() + interval '29 days' and now() + interval '31 days' from public.apartments where no = 3), '30 days';
  j := public.apt_rent(x.t2, 3);
  assert (j->>'coins')::int = c0 - 4000, 'extended';
  assert pg_temp.fails(format('select public.apt_rent(%L, 3)', x.t2), 'too far ahead'), '60 days ahead at most';
  j := public.apt_buy(x.t2, 3);
  assert (j->>'coins')::int = c0 - 4000 - 25000, format('bought %s', j->>'coins');
  j := public.apt_move_out(x.t2);
  assert (j->>'coins')::int = c0 - 4000 - 25000 + 17500, format('sold back %s', j->>'coins');
  select no into v_no from public.apartments where owner_id = x.a2;
  assert v_no is null, 'moved out';
  raise notice 'housing ok';
end $$;

-- ---------- 4. The motel: 300 a night, 6 000 a month ----------
do $$
declare x esv; j jsonb;
begin
  select * into x from esv;
  assert public._motel_price('night') = 300 and public._motel_price('month') = 6000 and public._motel_price('week') is null, 'motel prices';
  assert public._motel_price('month') * 3 = public._motel_price('night') * 30 * 2, 'a month is a third cheaper than 30 nights';
  assert not has_function_privilege('anon', 'public._motel_price(text)', 'execute'), 'helper stays private';
  delete from public.motel_stays where account_id = x.a2;
  perform public._wallet_lock(x.a2);
  update public.wallets set coins = 5999 where account_id = x.a2;
  assert pg_temp.fails(format('select public.motel_rent(%L, %L)', x.t2, 'month'), 'insufficient funds'), 'a month needs 6 000';
  update public.wallets set coins = 20000 where account_id = x.a2;
  j := public.motel_rent(x.t2, 'month');
  assert (j->>'coins')::int = 14000 and j->'stay'->>'plan' = 'month', format('a month %s', j);
  assert (select until between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
            from public.motel_stays where account_id = x.a2), '30 days';
  j := public.motel_rent(x.t2, 'month');
  assert (j->>'coins')::int = 8000, format('a second month %s', j->>'coins');
  assert pg_temp.fails(format('select public.motel_rent(%L, %L)', x.t2, 'night'), 'too far ahead'), '60 days ahead at most';
  assert (select count(*) from public.coin_ledger where account_id = x.a2 and reason = 'motel' and delta = -6000) = 2, 'two month rows';
  raise notice 'motel ok';
end $$;

select 'econ sinks smoke ok';
