-- =========================================================
-- 0098_fishing_kit.sql — Bộ câu cá (hotfix): tiệm chú Tư sells a kit for 50.000 xu that grants a 100-bait box
-- ("Hộp mồi 100") and a 100-fish crate ("Thùng cá 100"). ADDITIVE (no data drop) and re-runnable. Run after 0089
-- (0088–0097 are reserved by feat/world-p4 / feat/public-rooms). buy_item is copied verbatim from its newest body
-- (0034) with only the lines marked "kit" added or changed.
--   A. kind 'fishing_kit'; stock: bait_box_100 / bucket_100 (not sold alone, price null) and fishing_kit (50.000 xu).
--   B. buy_item: a kit is owned once both caps are ≥ its capacity; buying it pays once and grants both items.
-- =========================================================

-- ---------- A. Kind and stock ----------
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food',
                  'net','fishing_kit'));                                                    -- kit

insert into public.shop_items (id, kind, name, price, starter, sort_order, capacity) values
  ('bait_box_100', 'bait_box',    'Hộp mồi 100', null,  false, 20, 100),
  ('bucket_100',   'bucket',      'Thùng cá 100', null, false, 30, 100),
  ('fishing_kit',  'fishing_kit', 'Bộ câu cá',   50000, false, 10, 100)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, capacity = excluded.capacity;

-- ---------- B. buy_item ----------
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
  if it.kind not in ('rod','bobber','bait','bait_box','bucket','net','fishing_kit') then      -- v18.2: nets; kit
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
       or (it.kind = 'bucket' and public._bucket_cap(v_account) >= it.capacity)
       or (it.kind = 'fishing_kit' and public._bait_cap(v_account) >= it.capacity                     -- kit
           and public._bucket_cap(v_account) >= it.capacity) then                                     -- kit
      raise exception 'already owned' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    if it.kind = 'fishing_kit' then                                                              -- kit: grants its contents
      insert into public.inventory (account_id, item_id, qty) values (v_account, 'bait_box_100', 1), (v_account, 'bucket_100', 1)  -- kit
      on conflict (account_id, item_id) do update set qty = 1;                                   -- kit
    else                                                                                         -- kit
    insert into public.inventory (account_id, item_id, qty, durability) values (v_account, it.id, 1, it.durability)   -- v18.2
    on conflict (account_id, item_id) do update set qty = 1, durability = excluded.durability;                      -- v18.2
    end if;                                                                                      -- kit
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
