-- =========================================================
-- 0105_econ_sinks.sql — Kinh tế v2, the sinks (spec docs/superpowers/specs/2026-09-30-economy-v2-design.md §8).
-- ADDITIVE and re-runnable. Run after 0104 (it also applies right after 0100: 0101–0104 re-create none of its
-- functions). The re-created functions are copied verbatim from their newest bodies (0077, 0042, 0041, 0039, 0038) with
-- only the lines marked "econ v2" changed. The potion fees (S3) are 0103's.
--   A. S1 meal_buffs (0077's rows): a buff is priced by what it earns. The fish dishes' rare-fish lift
--      10 / 15 / 12 / 5 % → 4 / 6 / 5 / 2 % (cá kho tộ / canh chua / cá chiên / sinh tố); the stamina regen of
--      phở / nước dừa / cà phê sữa / trà đá +50 / 40 / 30 / 20 % → +30 / 25 / 20 / 10 %. The durations, the strength and
--      speed buffs and the meal prices stay. A buff already running keeps its power until it ends (_buff_grant).
--   B. S2 "Ngủ ngon" (one sleep a day at the motel or at home): stamina regen ×1.5 → ×1.2 (_stamina_rate, 0077). The
--      −30 % hunger / thirst drain and the +7 % walk stay.
--   C. S4 housing (_house_price, _house_sweep, _apt_price):
--      - the lot upkeep 500 → 1 500 xu per 30 days;
--      - a repossession (upkeep unpaid 60 days) pays back 10 000 (the new 'repossess' price) instead of 20 000, while
--        giving the lot back (lot_sell) still pays 20 000 ('refund'), so letting the upkeep lapse no longer costs the
--        same as selling;
--      - the apartment rent 1 500 → 2 000 xu per 30 days.
--      The land (40 000), a flat's price (25 000) and its buy-back (17 500) stay; so do the appraisals of 0043.
--      Upkeep and rent already paid keep their days.
--   D. The motel (_motel_price, 0039): a night 100 → 300, a month 2 000 → 6 000 (still a third cheaper than 30 nights).
--      Even at ×1.2 a night's "Ngủ ngon" lifts the 200 casts/h stamina cap to 240 for a day, so it is priced by that
--      value, as the buffs are. Stays already paid keep their days.
--   E. eat_meal (0038): a fish dish's discount for giving up a fish is the 20–80 % of _fish_discount_pct, but at most
--      3 × the fish's stored price in xu (a 5 xu fish no longer buys 100+ xu of food); the answer gains 'discount'.
-- =========================================================

-- ---------- A. S1: the meal buffs ----------
insert into public.meal_buffs (meal_id, key, value, minutes) values
  ('com_tam', 'strength', 15, 30),
  ('pho_bo', 'stamina_regen', 30, 30),                                                 -- econ v2: was 50
  ('banh_mi', 'speed', 5, 15),
  ('bun_bo', 'strength', 20, 30),
  ('ca_kho_to', 'rare_fish', 4, 30),                                                   -- econ v2: was 10
  ('canh_chua', 'rare_fish', 6, 30),                                                   -- econ v2: was 15
  ('ca_chien', 'rare_fish', 5, 20),                                                    -- econ v2: was 12
  ('tra_da', 'stamina_regen', 10, 15),                                                 -- econ v2: was 20
  ('nuoc_mia', 'speed', 8, 15),
  ('cafe_sua', 'speed', 10, 20),
  ('cafe_sua', 'stamina_regen', 20, 20),                                               -- econ v2: was 30
  ('nuoc_dua', 'stamina_regen', 25, 20),                                               -- econ v2: was 40
  ('sinh_to', 'rare_fish', 2, 20)                                                      -- econ v2: was 5
on conflict (meal_id, key) do update set value = excluded.value, minutes = excluded.minutes;

-- ---------- B. S2: "Ngủ ngon" stamina regen ×1.2 ----------
create or replace function public._stamina_rate(p_account uuid, p_resting boolean) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select (100.0 / 600)
       * (1 + least(150, public._perk(p_account, 'stamina_regen_pct') + public._buff(p_account, 'stamina_regen')) / 100)
       * (case when public._rest_factor(p_account) < 1 then 1.2 else 1 end)                      -- econ v2: ×1.2 (was 1.5)
       * (case when p_resting then 3 else 1 end)
$$;

-- ---------- C. S4: housing ----------
-- The land (the first 30 days of upkeep included), the upkeep for 30 days, what the city pays back when the lot is given
-- back (50 % of the land) and, econ v2, what it pays back on a repossession (25 %).
create or replace function public._house_price(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what when 'land' then 40000 when 'upkeep' then 1500 when 'refund' then 20000 when 'repossess' then 10000 end $$;   -- econ v2: upkeep 500 → 1500, 'repossess' 10000 (new)

create or replace function public._house_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.house_tenancies; l public.house_lots;
begin
  for t in select * from public.house_tenancies where paid_until <= now() for update skip locked loop
    update public.furniture_items set lot_no = null, x = null, y = null, rot = 0 where lot_no = t.lot_no and account_id = t.tenant_id;
    delete from public.house_tenancies where lot_no = t.lot_no and room_no = t.room_no;
  end loop;
  for l in select * from public.house_lots
            where bought_at is not null and (owner_id is null or paid_until + interval '60 days' <= now())
              for update skip locked loop
    if l.owner_id is not null then
      perform public._wallet_lock(l.owner_id);
      perform public._pay(l.owner_id, public._house_price('repossess'), 'house_refund', 'house #' || l.no || ': repossessed');   -- econ v2: 'repossess' (10 000), was 'refund' (20 000)
    end if;
    perform public._house_free(l.no, true);
  end loop;
end $$;

-- Rent (30 days), buy (the list price), and what the city pays back for a bought unit (70 % of the list).
create or replace function public._apt_price(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what when 'rent' then 2000 when 'buy' then 25000 when 'sell' then 17500 end $$;   -- econ v2: rent 1500 → 2000

-- ---------- D. The motel ----------
-- Price (xu) of a plan: a night 300, a month 6000 (null: no such plan).
create or replace function public._motel_price(p_plan text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_plan when 'night' then 300 when 'month' then 6000 end $$;   -- econ v2: night 100 → 300, month 2000 → 6000

-- ---------- E. The fish dishes: the discount is at most 3 × the fish's price ----------
-- A fish dish (cá kho tộ, canh chua, cá chiên) takes one fish from the bag for 20–80 % off (_fish_discount_pct, by the
-- fish's rarity and weight). Fish are worth ≈ 5–60 xu since 0101, so the percentage alone turned a 5 xu fish into 100+ xu
-- of food; the xu off is now also at most 3 × the fish's stored price (its price at the catch). The answer gains
-- 'discount' (the xu off); 'discount_pct' stays the formula's percentage.
create or replace function public.eat_meal(p_session_token text, p_item text, p_fish_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid; m public.meal_catalog; v_rarity int; v_weight int; v_pct int := 0; v_price int; v_coins int; v_bal int; v_vitals jsonb;
  v_cured boolean := false;                                                                         -- v18.9
  v_fish_price int;                                                                                 -- econ v2
begin
  v_account := public._auth_account(p_session_token);
  select * into m from public.meal_catalog where id = p_item;
  if not found then raise exception 'unknown meal' using errcode = '22023'; end if;
  if p_fish_id is not null then
    if not m.fish_dish then raise exception 'not a fish dish' using errcode = '22023'; end if;
    select s.rarity, f.weight_g, f.price into v_rarity, v_weight, v_fish_price                    -- econ v2: + the fish's price
      from public.fish f join public.fish_species s on s.id = f.species_id
      where f.id = p_fish_id and f.account_id = v_account for update of f;
    if not found then raise exception 'fish not found' using errcode = '22023'; end if;
    v_pct := public._fish_discount_pct(v_rarity, v_weight);
  end if;
  v_price := m.price - least((m.price * v_pct) / 100, 3 * coalesce(v_fish_price, 0));              -- econ v2: ≤ 3 × the fish's price
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_price, 'meal', 'meal: ' || p_item);
  if p_fish_id is not null then delete from public.fish where id = p_fish_id and account_id = v_account; end if;
  v_vitals := public._vitals_restore(v_account, m.hunger, m.thirst);
  if p_item in ('pho_bo', 'bun_bo', 'canh_chua') then                                              -- v18.9: a hot dish
    update public.rain_state set cold_until = null, cold_wet_s = 0
     where account_id = v_account and cold_until > now();
    v_cured := found;
  end if;
  return jsonb_build_object('paid', v_price, 'discount_pct', v_pct, 'coins', v_bal, 'vitals', v_vitals,
                            'cured', v_cured, 'discount', m.price - v_price);                       -- v18.9; econ v2: + 'discount' (xu)
end; $$;

revoke all on function public._stamina_rate(uuid, boolean) from public, anon, authenticated;
revoke all on function public._house_price(text) from public, anon, authenticated;
revoke all on function public._house_sweep() from public, anon, authenticated;
revoke all on function public._apt_price(text) from public, anon, authenticated;
revoke all on function public._motel_price(text) from public, anon, authenticated;
revoke all on function public.eat_meal(text, text, uuid) from public;
grant execute on function public.eat_meal(text, text, uuid) to anon, authenticated;
