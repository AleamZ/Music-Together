-- =========================================================
-- 0034_rods_nets.sql — v18.2 Đồ câu có độ bền, lưới cá (docs/superpowers/plans/2026-09-27-v18-2-rods.md).
-- ADDITIVE (no data drop) and re-runnable. Run after 0033. Every re-created function is copied from its newest body
-- (_fishing_state, buy_item and set_loadout from 0015; start_cast and finish_cast from 0031 — 0032/0033 do not
-- redefine them) with only the lines marked "v18.2" added or changed.
--   A. Columns and the new stock: shop_items.durability / radius_px / bite_boost, kind 'net', inventory.durability.
--   B. _rod_wear (fills 0031's seam) and _rod_usable.
--   C. _fishing_state: nets owned, and the wear of rods and nets.
--   D. buy_item, set_loadout, repair_rod; ledger reason 'repair'.
--   E. start_cast: a broken rod is refused; the bait's bite_boost.
--   F. finish_cast: wear 1 per hook attempt; overboard grants the v18.10 swim immunity.
--   G. Nets: net_throws, _net_quality, _net_catch, start_net, net_haul, finish_net (the tug-of-war).
-- =========================================================

-- ---------- A. Columns and stock ----------
alter table public.shop_items add column if not exists durability integer;            -- v18.2: max (null = unbreakable)
alter table public.shop_items add column if not exists radius_px smallint;            -- v18.2: a net's radius
alter table public.shop_items add column if not exists bite_boost real not null default 1;   -- v18.2: bait: bite wait ×

alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food',
                  'net'));

insert into public.shop_items (id, kind, name, price, starter, sort_order, zone_pct, weight_k, rare_mult,
                               window_ms, bite_min_ms, bite_max_ms, shows_rarity, mult_hiem, mult_quy, mult_legend, capacity,
                               rating_g, durability, radius_px, bite_boost) values
  ('rod_fiber',  'rod',  'Cần sợi thủy tinh',  700, false, 25, 33, 1.5, 1.1, null, null, null, false, 1,   1,   1,   null, 4500,  200, null, 1),
  ('rod_master', 'rod',  'Cần thủ',           5000, false, 40, 40, 1.3, 1.4, null, null, null, false, 1,   1,   1,   null, 10000, 600, null, 1),
  ('net_small',  'net',  'Lưới nhỏ',           250, false, 10, null, null, 1, null, null, null, false, 1,   1,   1,   null, null,  20,  24,   1),
  ('net_big',    'net',  'Lưới lớn',           600, false, 20, null, null, 1, null, null, null, false, 1,   1,   1,   null, null,  30,  36,   1),
  ('bait_gold',  'bait', 'Mồi vàng',            25, false, 40, null, null, 1, null, null, null, false, 1.5, 1.5, 1.5, null, null,  null, null, 0.6)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter, sort_order = excluded.sort_order,
  zone_pct = excluded.zone_pct, weight_k = excluded.weight_k, rare_mult = excluded.rare_mult,
  mult_hiem = excluded.mult_hiem, mult_quy = excluded.mult_quy, mult_legend = excluded.mult_legend,
  rating_g = excluded.rating_g, durability = excluded.durability, radius_px = excluded.radius_px, bite_boost = excluded.bite_boost;
update public.shop_items set durability = 120 where id = 'rod_bamboo';
update public.shop_items set durability = 300 where id = 'rod_carbon';
update public.shop_items set durability = null where id = 'rod_wood';

alter table public.inventory add column if not exists durability integer;   -- v18.2: rods and nets (null: none)
update public.inventory i set durability = s.durability
  from public.shop_items s
 where s.id = i.item_id and s.kind in ('rod', 'net') and s.durability is not null and i.durability is null;

-- ---------- B. Wear ----------
-- 0031's seam: p_amount off the rod's durability (floor 0). An unbreakable rod (rod_wood, no durability) is untouched.
-- At 0 the rod stays in the bag but is unequipped (the profile falls back to rod_wood).
create or replace function public._rod_wear(p_account uuid, p_rod text, p_amount integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_d integer;
begin
  update public.inventory set durability = greatest(0, durability - greatest(0, coalesce(p_amount, 0)))
   where account_id = p_account and item_id = p_rod and durability is not null
  returning durability into v_d;
  if v_d = 0 then
    update public.fishing_profiles set rod = 'rod_wood' where account_id = p_account and rod = p_rod;
  end if;
end; $$;
revoke all on function public._rod_wear(uuid, text, integer) from public, anon, authenticated;

-- A rod may be equipped and cast with: not at durability 0.
create or replace function public._rod_usable(p_account uuid, p_rod text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select not exists (select 1 from public.inventory i
                      where i.account_id = p_account and i.item_id = p_rod and i.durability is not null and i.durability <= 0)
$$;
revoke all on function public._rod_usable(uuid, text) from public, anon, authenticated;

-- ---------- C. The fishing state ----------
create or replace function public._fishing_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare w public.wallets; p public.fishing_profiles; v_resets timestamptz; v_left integer; v_dig timestamptz;
        v_today date := public._vn_today(); v_day_left integer;
begin
  select * into w from public.wallets where account_id = p_account;
  select * into p from public.fishing_profiles where account_id = p_account;
  if p.window_start is not null and now() < p.window_start + interval '1 hour' then
    v_resets := p.window_start + interval '1 hour';
    v_left := greatest(0, 40 - p.window_casts);
  else
    v_resets := null;
    v_left := 40;
  end if;
  if p.last_dig_at is not null and now() < p.last_dig_at + interval '45 seconds' then
    v_dig := p.last_dig_at + interval '45 seconds';
  else
    v_dig := null;
  end if;
  v_day_left := case when p.day_on = v_today then greatest(0, 300 - p.day_casts) else 300 end;
  return jsonb_build_object(
    'coins', coalesce(w.coins, 0),
    'daily_claimed', coalesce(w.daily_on = v_today, false),
    'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', coalesce(p.bobber, 'bobber_feather'),
                                  'bait', coalesce(p.bait, 'bait_worm')),
    'owned', coalesce((select jsonb_agg(i.item_id order by s.kind, s.sort_order)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('rod','bobber','bait_box','bucket','net')),              -- v18.2: nets
                      '[]'::jsonb),
    'wear', coalesce((select jsonb_object_agg(i.item_id, jsonb_build_array(i.durability, s.durability))   -- v18.2
                        from public.inventory i join public.shop_items s on s.id = i.item_id
                       where i.account_id = p_account and i.qty >= 1 and i.durability is not null
                         and s.kind in ('rod', 'net')), '{}'::jsonb),
    'bait', (select jsonb_object_agg(s.id, coalesce(i.qty, 0))
               from public.shop_items s
               left join public.inventory i on i.item_id = s.id and i.account_id = p_account
              where s.kind = 'bait'),
    'bait_cap', public._bait_cap(p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'species_id', f.species_id, 'weight_g', f.weight_g,
                                                          'price', f.price, 'caught_at', f.caught_at) order by f.caught_at, f.id)
                        from public.fish f where f.account_id = p_account), '[]'::jsonb),
    'fish_cap', 1 + public._bucket_cap(p_account),
    'casts_left', v_left,
    'window_resets_at', v_resets,
    'dig_ready_at', v_dig,
    'server_now', now(),
    'casts_today_left', v_day_left,
    'day_resets_at', case when v_day_left = 0 then (v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end,
    'lock', public._ac_lock_state(p_account)
  );
end; $$;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- ---------- D. Buying, equipping, repairing ----------
-- The 27 reasons in force after 0029 (0030–0033 add none) plus 'repair': 28.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair'));

create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind not in ('rod','bobber','bait','bait_box','bucket','net') then                    -- v18.2: nets
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if (it.kind = 'bait' and (p_qty is null or p_qty < 1 or p_qty > 99)) or (it.kind <> 'bait' and p_qty is distinct from 1) then
    return public._ac_flag(v_account, 'bad_qty', 'buy_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  if it.kind = 'bait' then
    if public._bait_total(v_account) + p_qty > public._bait_cap(v_account) then
      raise exception 'bait full' using errcode = '22023';
    end if;
    v_cost := it.price * p_qty;
    if w.coins < v_cost then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -v_cost, 'buy', it.id || ' x' || p_qty);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
    -- the selected bait ran out → the bought bait becomes the selection
    if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) = 0 then
      update public.fishing_profiles set bait = it.id where account_id = v_account;
    end if;
  else
    if public._owns(v_account, it.id)
       or (it.kind = 'bait_box' and public._bait_cap(v_account) >= it.capacity)
       or (it.kind = 'bucket' and public._bucket_cap(v_account) >= it.capacity) then
      raise exception 'already owned' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    insert into public.inventory (account_id, item_id, qty, durability) values (v_account, it.id, 1, it.durability)   -- v18.2
    on conflict (account_id, item_id) do update set qty = 1, durability = excluded.durability;                      -- v18.2
    -- a better rod / bobber (by price; starter = 0) is equipped right away
    if it.kind in ('rod', 'bobber') then
      select coalesce(price, 0) into v_equipped from public.shop_items where id = case when it.kind = 'rod' then p.rod else p.bobber end;
      if it.price > coalesce(v_equipped, 0) then
        if it.kind = 'rod' then
          update public.fishing_profiles set rod = it.id where account_id = v_account;
        else
          update public.fishing_profiles set bobber = it.id where account_id = v_account;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

create or replace function public.set_loadout(p_session_token text, p_rod text, p_bobber text, p_bait text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  perform public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_rod and kind = 'rod') or not public._owns(v_account, p_rod)
     or not exists (select 1 from public.shop_items where id = p_bobber and kind = 'bobber') or not public._owns(v_account, p_bobber)
     or not exists (select 1 from public.shop_items where id = p_bait and kind = 'bait') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if not public._rod_usable(v_account, p_rod) then                                          -- v18.2
    raise exception 'rod broken' using errcode = '22023';
  end if;
  update public.fishing_profiles set rod = p_rod, bobber = p_bobber, bait = p_bait where account_id = v_account;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

-- The repair price: 30% of the rod's shop price, rounded up.
create or replace function public._repair_price(p_price integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select ceil(coalesce(p_price, 0) * 0.3)::int $$;
revoke all on function public._repair_price(integer) from public, anon, authenticated;

-- Sửa cần at chú Tư's: an owned rod below its max goes back to max for _repair_price. Where the player stands is not
-- checked (the shop panel is the only caller, like buy_item).
create or replace function public.repair_rod(p_session_token text, p_item_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; it public.shop_items; v_d integer; v_cost integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  perform public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id and kind = 'rod';
  if not found or it.durability is null or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  select durability into v_d from public.inventory where account_id = v_account and item_id = it.id and qty >= 1;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  if coalesce(v_d, it.durability) >= it.durability then
    raise exception 'not worn' using errcode = '22023';
  end if;
  v_cost := public._repair_price(it.price);
  if w.coins < v_cost then raise exception 'not enough coins' using errcode = '22023'; end if;
  perform public._pay(v_account, -v_cost, 'repair', it.id);
  update public.inventory set durability = it.durability where account_id = v_account and item_id = it.id;
  return jsonb_build_object('cost', v_cost, 'state', public._fishing_state(v_account));
end; $$;
revoke all on function public.repair_rod(text, text) from public;
grant execute on function public.repair_rod(text, text) to anon, authenticated;

-- ---------- E. start_cast ----------
-- start_cast (0031's body); v18.2: a broken equipped rod is refused, and the bait's bite_boost shortens the wait and,
-- from the shore, raises the bite chance (40% → 80% at bite_boost 0.6).
create or replace function public.start_cast(p_room_id uuid, p_session_token text, p_col integer default null,
                                             p_row integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
        v_spot text := 'dock'; v_bites boolean := true;                                  -- v18.1
        v_boost real;                                                                    -- v18.2
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_col is not null or p_row is not null then                                         -- v18.1: null = an older client (docks only)
    v_spot := public._pond_spot(p_col, p_row);
    if v_spot is null then raise exception 'bad spot' using errcode = '22023'; end if;
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;   -- v18.8
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then                                       -- v18.2
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 1. hourly cap: a new window starts at the first cast after the previous one ended
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
  -- 1b. daily cap: the seconds until the next Vietnam midnight
  if p.day_on = v_today and p.day_casts >= 300 then
    raise exception 'daily cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  -- 2. a new cast abandons the previous one (its bait is already spent)
  delete from public.casts where account_id = v_account;
  -- 3. room for the catch
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  -- 4. one bait: the selected kind, else worms
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);    -- v18.2
  -- 5. roll the fish (v14 spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,          -- v18.8: weather
                                  not (public._room_weather(p_room_id)).is_day);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);   -- v18.8: fewer bites = longer wait
  v_bite := greatest(1000, round(v_bite * v_boost)::int);                                 -- v18.2: a boosting bait
  if v_spot = 'shore' then                                                                -- v18.1: the shore's odds
    v_bite := least(60000, round(v_bite * 1.5)::int);
    v_bites := random() < case when v_boost < 1 then 0.8 else 0.4 end;                    -- v18.2: 80% with a boost
  end if;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod)                                         -- v18.1
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          v_spot, v_bites, sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod)   -- v18.1
  returning id into v_id;
  update public.fishing_profiles
     set window_casts = window_casts + 1,
         day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
         day_on = v_today
   where account_id = v_account
  returning day_casts into v_day;
  if v_day = 300 then
    perform public._ac_flag(v_account, 'cast_daily_cap', 'start_cast', jsonb_build_object('day', v_today, 'casts', 300),
                            p_room_id, null, false);
  end if;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.start_cast(uuid, text, integer, integer) to anon, authenticated;

-- ---------- F. finish_cast ----------
-- finish_cast (0031's body, 4 args); v18.2: every hook attempt wears the cast's rod by 1 (caught, gave_up, too_early,
-- full, expired — not no_bite, where nothing bit, nor overboard, which wears 3). Overboard also grants the v18.10 swim
-- immunity, as climbing out of the water does (leave_water: 10 min, the heat shock cleared). Answers carry rod_broke.
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,
                                              p_hooked boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
        v_out jsonb; v_rod text; v_vit public.vitals;                                     -- v18.1
        v_broke boolean := false;                                                         -- v18.2
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not c.bites then                                                                  -- v18.1: nothing bit
    v_why := 'no_bite';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
    if coalesce(p_hooked, false) and c.big and now() >= c.bite_at then                   -- v18.1: pulled in
      v_why := 'overboard';
    end if;
  elsif now() < c.bite_at + make_interval(secs => 0.9 * c.min_reel_ms / 1000.0) then   -- the existing gate, unchanged
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3)),
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  v_rod := coalesce(c.rod, 'rod_wood');                                                   -- v18.2 (was in the branch below)
  if v_why = 'overboard' then                                                             -- v18.1: the fall's cost
    v_out := public._overboard_outcome(v_rod, random());
    perform public._rod_wear(v_account, v_rod, (v_out->>'wear')::int);
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - (v_out->>'hunger')::numeric)
     where account_id = v_account returning * into v_vit;
    v_broke := not public._rod_usable(v_account, v_rod);                                  -- v18.2
    if (v_out->>'rod_lost')::boolean then
      delete from public.inventory where account_id = v_account and item_id = v_rod;
      update public.fishing_profiles set rod = 'rod_wood' where account_id = v_account and rod = v_rod;
      v_broke := false;                                                                   -- v18.2: lost, not broken
    end if;
    perform public._heat_row(v_account);                                                  -- v18.2: the swim's immunity
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', v_rod, 'rod_lost', (v_out->>'rod_lost')::boolean,
                                      'hunger', (v_out->>'hunger')::int),
      'rod_broke', v_broke,                                                               -- v18.2
      'vitals', public._vitals_json(v_vit),
      'state', public._fishing_state(v_account));
  end if;
  if v_why is distinct from 'no_bite' then                                                -- v18.2: a hook attempt
    perform public._rod_wear(v_account, v_rod, 1);
    v_broke := not public._rod_usable(v_account, v_rod);
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'rod_broke', v_broke,        -- v18.2: rod_broke
                              'state', public._fishing_state(v_account))
           || coalesce(v_ac, '{}'::jsonb);
  end if;
  select * into sp from public.fish_species where id = c.species_id;
  -- the room's fish price index at the catch (economy spec §5.7); a cast whose room is gone keeps the base price
  if c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    r := public._fish_index(c.room_id, now());
    v_mult := r.mult;
    v_factor := public._fish_factor(c.room_id, sp.id, r.period);
  end if;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0 * v_mult * v_factor)::int);
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  if v_ratio < 1.05 then
    perform public._ac_hug(v_account, round(v_ratio, 3), c.room_id);
  end if;
  -- rare+ catches are announced in the room's chat (v14 spec §8.5), as a system line about the catcher
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]),
            true, v_account);
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'rod_broke', v_broke,                                                                 -- v18.2
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.finish_cast(text, uuid, boolean, boolean) to anon, authenticated;

-- ---------- G. Nets ----------
-- One throw in progress per account: start_net (the release: the throw is spent) → net_haul (the net sank: scored and
-- the catch rolled, kept on the row) → finish_net (the tug-of-war: won = the fish, lost = pulled into the pond).
-- lib/game/fishing/net.ts mirrors the scoring. The seed sets the server's pace (beat_ms): a haul faster than 0.9 × five
-- beats after the throw is refused.
-- Client trust (like v18.1's p_hooked): the shadows the net covered (p_offsets) and the tug's outcome (p_won) are client
-- claims; the server bounds them — at most 5 fish of rarity 1–2, the charge sets the ceiling, the free room clips it, a
-- haul needs 0.9 × 5 beats and a win 1.5 s of tug — and claiming a loss only costs the claimant.
create table if not exists public.net_throws (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  room_id uuid,
  net text not null references public.shop_items(id),
  seed integer not null,
  beat_ms integer not null,
  started_at timestamptz not null default now(),
  haul jsonb,                -- the rolled catch: [{species_id, weight_g, price, rarity}] (net_haul)
  hauled_at timestamptz
);
alter table public.net_throws add column if not exists haul jsonb;
alter table public.net_throws add column if not exists hauled_at timestamptz;
alter table public.net_throws enable row level security;
revoke all on public.net_throws from anon, authenticated;

-- The power at release (0 … 1): (1 − cos 2πt/1200) / 2, t = the hold in ms.
create or replace function public._net_quality(p_charge_ms integer) returns double precision
language sql immutable set search_path = public, extensions
as $$ select (1 - cos(2 * pi() * greatest(0, coalesce(p_charge_ms, 0)) / 1200.0)) / 2 $$;

-- The fish a throw brings in: 2 + round-half-up(3 × quality) (+1 for a big net), at most 5, then −1 per miss: five
-- entries, one per fish shadow; a hit is an offset within ±150 (the client sends 0 for a shadow under the net, 9999 for
-- one that got away); a missing entry is a miss.
create or replace function public._net_catch(p_charge_ms integer, p_offsets integer[], p_big boolean) returns integer
language sql immutable set search_path = public, extensions
as $$
  select greatest(0,
    least(5, 2 + floor(3 * public._net_quality(p_charge_ms) + 0.5)::int + case when coalesce(p_big, false) then 1 else 0 end)
    - (5 - (select count(*)::int from generate_series(1, 5) g
             where p_offsets is not null and g <= coalesce(array_length(p_offsets, 1), 0)
               and p_offsets[g] is not null and abs(p_offsets[g]) <= 150)))
$$;
revoke all on function public._net_quality(integer) from public, anon, authenticated;
revoke all on function public._net_catch(integer, integer[], boolean) from public, anon, authenticated;

-- The server's pace: 550 … 750 ms per beat.
create or replace function public._net_beat_ms(p_seed integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select 550 + 50 * (abs(coalesce(p_seed, 0)) % 5) $$;
revoke all on function public._net_beat_ms(integer) from public, anon, authenticated;

-- Throw a net from a dock or shore cell. The same gates as a cast (spot, storm, vitals, the hourly and daily caps — a
-- throw counts as a cast), a free slot for at least one fish, and an owned net with throws left. The throw is spent
-- here (a net at 0 is removed).
create or replace function public.start_net(p_room_id uuid, p_session_token text, p_col integer, p_row integer,
                                            p_net text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_today date := public._vn_today(); v_d integer; v_seed integer;
        v_id uuid; v_beat integer; v_bucket integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_net and kind = 'net') then
    raise exception 'no net' using errcode = '22023';
  end if;
  select durability into v_d from public.inventory where account_id = v_account and item_id = p_net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
  if p.day_on = v_today and p.day_casts >= 300 then
    raise exception 'daily cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then raise exception 'hands full' using errcode = '22023'; end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  delete from public.casts where account_id = v_account;
  delete from public.net_throws where account_id = v_account;
  if v_d <= 1 then
    delete from public.inventory where account_id = v_account and item_id = p_net;
  else
    update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = p_net;
  end if;
  update public.fishing_profiles
     set window_casts = window_casts + 1,
         day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
         day_on = v_today
   where account_id = v_account;
  v_seed := floor(random() * 2147483647)::int;
  v_beat := public._net_beat_ms(v_seed);
  insert into public.net_throws (account_id, room_id, net, seed, beat_ms)
  values (v_account, p_room_id, p_net, v_seed, v_beat) returning id into v_id;
  return jsonb_build_object('throw_id', v_id, 'seed', v_seed, 'beat_ms', v_beat,
    'radius_px', (select radius_px from public.shop_items where id = p_net),
    'state', public._fishing_state(v_account));
end; $$;

-- The net sank: score it and roll the catch (kept on the throw until the tug ends). Lost (the throw is gone): expired
-- (over 120 s), too_early (faster than 0.9 × five beats). No fish: 'empty' (the throw is gone). Otherwise the fish —
-- _net_catch of them, clipped to the free room, each a common or uncommon species at the room's price index — are
-- returned for the tug (without ids: they are not in the bag yet).
create or replace function public.net_haul(p_session_token text, p_throw_id uuid, p_charge_ms integer,
                                           p_offsets integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_n integer; v_free integer; v_big boolean; sp public.fish_species;
        v_w integer; v_price integer; r public.fish_price_index; v_mult numeric := 1; v_room boolean;
        v_haul jsonb := '[]'::jsonb;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select * into t from public.net_throws where account_id = v_account and id = p_throw_id for update;
  if not found or t.haul is not null then raise exception 'throw not found' using errcode = '22023'; end if;
  if now() > t.started_at + interval '120 seconds' then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._fishing_state(v_account));
  end if;
  if p_charge_ms is null or p_charge_ms < 0 or p_charge_ms > 10000
     or now() < t.started_at + make_interval(secs => 0.9 * 5 * t.beat_ms / 1000.0) then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'state', public._fishing_state(v_account));
  end if;
  v_big := coalesce((select radius_px from public.shop_items where id = t.net), 0) >= 32;
  v_n := public._net_catch(p_charge_ms, p_offsets, v_big);
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  v_n := least(v_n, v_free);
  if v_n = 0 then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'empty', 'count', 0, 'fish', '[]'::jsonb, 'state', public._fishing_state(v_account));
  end if;
  v_room := t.room_id is not null and exists (select 1 from public.rooms where id = t.room_id);
  if v_room then
    r := public._fish_index(t.room_id, now());
    v_mult := r.mult;
  end if;
  for i in 1 .. v_n loop
    select * into sp from public.fish_species where rarity in (1, 2) order by random() limit 1;
    v_w := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), 2.0))::int);
    v_price := greatest(1, round(sp.price_per_kg * v_w / 1000.0 * v_mult
                                 * case when v_room then public._fish_factor(t.room_id, sp.id, r.period) else 1 end)::int);
    v_haul := v_haul || jsonb_build_array(jsonb_build_object('species_id', sp.id, 'weight_g', v_w, 'price', v_price,
                                                             'rarity', sp.rarity));
  end loop;
  update public.net_throws set haul = v_haul, hauled_at = now() where id = t.id;
  return jsonb_build_object('result', 'haul', 'count', v_n, 'fish', v_haul,
    'quality', round(public._net_quality(p_charge_ms)::numeric, 3), 'state', public._fishing_state(v_account));
end; $$;

-- The tug-of-war ended (single use). Won (after at least 1.5 s of tug, within 60 s of the haul): the rolled fish go into
-- the bag (clipped to the room left). Lost: pulled into the pond like v18.1's overboard — no fish, hunger −10, and the
-- v18.10 swim immunity. A win claimed too fast is 'too_early' (no fish, no fall); a late one 'expired'.
drop function if exists public.finish_net(text, uuid, integer, integer[]);
create or replace function public.finish_net(p_session_token text, p_throw_id uuid, p_won boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_free integer; f jsonb; v_id uuid; v_fish jsonb := '[]'::jsonb;
        v_vit public.vitals; v_n integer := 0;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  delete from public.net_throws where account_id = v_account and id = p_throw_id returning * into t;
  if not found or t.haul is null then raise exception 'throw not found' using errcode = '22023'; end if;
  if now() > t.hauled_at + interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._fishing_state(v_account));
  end if;
  if not coalesce(p_won, false) then
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - 10) where account_id = v_account returning * into v_vit;
    perform public._heat_row(v_account);
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', null, 'rod_lost', false, 'hunger', 10),
      'vitals', public._vitals_json(v_vit), 'state', public._fishing_state(v_account));
  end if;
  if now() < t.hauled_at + interval '1.5 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'state', public._fishing_state(v_account));
  end if;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  for f in select value from jsonb_array_elements(t.haul) loop
    exit when v_n >= v_free;
    insert into public.fish (account_id, species_id, weight_g, price)
    values (v_account, f->>'species_id', (f->>'weight_g')::int, (f->>'price')::int) returning id into v_id;
    v_fish := v_fish || jsonb_build_array(f || jsonb_build_object('id', v_id));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('result', 'caught', 'count', v_n, 'fish', v_fish, 'state', public._fishing_state(v_account));
end; $$;
revoke all on function public.start_net(uuid, text, integer, integer, text) from public;
revoke all on function public.net_haul(text, uuid, integer, integer[]) from public;
revoke all on function public.finish_net(text, uuid, boolean) from public;
grant execute on function public.start_net(uuid, text, integer, integer, text) to anon, authenticated;
grant execute on function public.net_haul(text, uuid, integer, integer[]) to anon, authenticated;
grant execute on function public.finish_net(text, uuid, boolean) to anon, authenticated;
