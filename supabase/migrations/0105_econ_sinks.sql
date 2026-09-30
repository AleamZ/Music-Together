-- =========================================================
-- 0105_econ_sinks.sql — Kinh tế v2, the sinks (spec docs/superpowers/specs/2026-09-30-economy-v2-design.md §8).
-- ADDITIVE and re-runnable. Run after 0104 (it also applies right after 0100: 0101–0104 re-create none of its
-- functions). The re-created functions are copied verbatim from their newest bodies (0077, 0042, 0041) with only the
-- lines marked "econ v2" changed. The potion fees (S3) are 0103's.
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

revoke all on function public._stamina_rate(uuid, boolean) from public, anon, authenticated;
revoke all on function public._house_price(text) from public, anon, authenticated;
revoke all on function public._house_sweep() from public, anon, authenticated;
revoke all on function public._apt_price(text) from public, anon, authenticated;
