-- =========================================================
-- 0022_fashion_store.sql — 100 Fashion Outfits & Store System:
-- 1. Table account_items for wardrobe ownership
-- 2. 100 new fashion catalog items across hats, tops, bottoms, shoes, neckwear
-- 3. Updated _item_ok allowing owned items or starter items
-- 4. Store RPCs: buy_fashion_item, sell_fashion_item, transfer_fashion_item (P2P pass đồ)
-- 5. get_my_wardrobe helper RPC
-- ADDITIVE & re-runnable.
-- =========================================================

-- ---------- A. Wardrobe Ownership Table ----------
create table if not exists public.account_items (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.item_catalog(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (account_id, item_id)
);
create index if not exists idx_account_items_account on public.account_items (account_id);

alter table public.account_items enable row level security;
drop policy if exists account_items_select on public.account_items;
create policy account_items_select on public.account_items for select to anon using (true);
revoke insert, update, delete on public.account_items from anon, authenticated;

-- ---------- B. Seed 100 Fashion Items into item_catalog ----------
insert into public.item_catalog (id, slot, name, price, starter, sort_order) values
  -- Mũ (20 items)
  ('hat_nonla_hue',      'hat', 'Nón bài thơ xứ Huế',       150,  false, 100),
  ('hat_nonla_gold',     'hat', 'Nón lá hoàng kim',          500,  false, 105),
  ('hat_nonquaitao',     'hat', 'Nón quai thao Quan Họ',     250,  false, 110),
  ('hat_taibeo_camo',    'hat', 'Nón tai bèo rằn ri',        120,  false, 115),
  ('hat_taibeo_blue',    'hat', 'Nón tai bèo xanh biển',      80,  false, 120),
  ('hat_taibeo_black',   'hat', 'Nón tai bèo đen huyền',      90,  false, 125),
  ('hat_cap_red',        'hat', 'Mũ lưỡi trai đỏ',           100,  false, 130),
  ('hat_cap_black',      'hat', 'Mũ snapback đen',           110,  false, 135),
  ('hat_cap_white',      'hat', 'Mũ lưỡi trai trắng',        100,  false, 140),
  ('hat_cap_yellow',     'hat', 'Mũ lưỡi trai vàng',         100,  false, 145),
  ('hat_beret_brown',    'hat', 'Mũ beret hoạ sĩ nâu',       180,  false, 150),
  ('hat_beret_black',    'hat', 'Mũ beret đen Paris',        190,  false, 155),
  ('hat_beanie_grey',    'hat', 'Mũ len xám ấm áp',          130,  false, 160),
  ('hat_beanie_orange',  'hat', 'Mũ len cam nổi bật',        130,  false, 165),
  ('hat_straw_summer',   'hat', 'Mũ cói đi biển',            160,  false, 170),
  ('hat_straw_ribbon',   'hat', 'Mũ cói nơ hồng',            180,  false, 175),
  ('hat_bandana_red',    'hat', 'Khăn bandana đỏ hiphop',    140,  false, 180),
  ('hat_crown_gold',     'hat', 'Vương miện hoàng kim',     1000,  false, 185),
  ('hat_headband_ninja', 'hat', 'Băng đô nhẫn giả đỏ',       120,  false, 190),
  ('hat_flower_lotus',   'hat', 'Hoa sen cài tóc',           200,  false, 195),

  -- Áo (25 items)
  ('top_baba_blue',      'top', 'Áo bà ba xanh ngọc',        120,  false, 200),
  ('top_baba_purple',    'top', 'Áo bà ba tím hoa cà',       130,  false, 205),
  ('top_baba_red',       'top', 'Áo bà ba đỏ may mắn',       150,  false, 210),
  ('top_baba_brown',     'top', 'Áo bà ba nâu phù sa',       100,  false, 215),
  ('top_baba_black',     'top', 'Áo bà ba lụa đen',          140,  false, 220),
  ('top_baba_cyan',      'top', 'Áo bà ba xanh ngọc bích',   130,  false, 225),
  ('top_tee_red',        'top', 'Áo thun đỏ năng động',       80,  false, 230),
  ('top_tee_black',      'top', 'Áo thun đen basic',          85,  false, 235),
  ('top_tee_white',      'top', 'Áo thun trắng tinh khôi',    80,  false, 240),
  ('top_tee_yellow',     'top', 'Áo thun vàng chanh',         85,  false, 245),
  ('top_tee_orange',     'top', 'Áo thun cam hoàng hôn',      85,  false, 250),
  ('top_tee_purple',     'top', 'Áo thun tím khói',           90,  false, 255),
  ('top_tee_striped',    'top', 'Áo thun sọc thủy thủ',      120,  false, 260),
  ('top_tee_camo',       'top', 'Áo thun rằn ri lính',       130,  false, 265),
  ('top_polo_navy',      'top', 'Áo polo xanh navy',         150,  false, 270),
  ('top_polo_white',     'top', 'Áo polo trắng công sở',     150,  false, 275),
  ('top_shirt_denim',    'top', 'Áo sơ mi bò denim',         180,  false, 280),
  ('top_shirt_flannel',  'top', 'Áo sơ mi caro đỏ flannel',  190,  false, 285),
  ('top_school_boy',     'top', 'Áo đồng phục học sinh',     140,  false, 290),
  ('top_hoodie_grey',    'top', 'Áo hoodie xám thể thao',    220,  false, 295),
  ('top_hoodie_pink',    'top', 'Áo hoodie hồng pastel',     220,  false, 300),
  ('top_vest_tuxedo',    'top', 'Áo vest tuxedo dạ hội',     500,  false, 305),
  ('top_aodai_tet',      'top', 'Áo dài gấm đỏ đón Tết',     600,  false, 310),
  ('top_aodai_yellow',   'top', 'Áo dài hoàng gia gấm vàng', 650,  false, 315),
  ('top_jacket_leather', 'top', 'Áo khoác biker da ngầu',    450,  false, 320),

  -- Quần (25 items)
  ('bottom_pants_white',      'bottom', 'Quần tây trắng lịch lãm',    120, false, 400),
  ('bottom_pants_grey',       'bottom', 'Quần tây xám tro',           110, false, 405),
  ('bottom_pants_navy',       'bottom', 'Quần tây xanh navy',         120, false, 410),
  ('bottom_pants_brown',      'bottom', 'Quần kaki nâu bò',           130, false, 415),
  ('bottom_jeans_light',      'bottom', 'Quần jeans xanh nhạt',       160, false, 420),
  ('bottom_jeans_black',      'bottom', 'Quần jeans đen ôm dáng',     160, false, 425),
  ('bottom_cargo_green',      'bottom', 'Quần túi hộp cargo rêu',     180, false, 430),
  ('bottom_cargo_sand',       'bottom', 'Quần túi hộp màu cát',       180, false, 435),
  ('bottom_pants_jogger',     'bottom', 'Quần jogger thun thể thao',  140, false, 440),
  ('bottom_pants_tet',        'bottom', 'Quần lụa vàng mặc Tết',      300, false, 445),
  ('bottom_shorts_blue',      'bottom', 'Quần đùi jean xanh biển',     90, false, 450),
  ('bottom_shorts_black',     'bottom', 'Quần đùi thun đen thể thao',  80, false, 455),
  ('bottom_shorts_white',     'bottom', 'Quần đùi trắng bãi biển',     85, false, 460),
  ('bottom_shorts_yellow',    'bottom', 'Quần đùi vàng hoa cúc',       85, false, 465),
  ('bottom_shorts_green',     'bottom', 'Quần đùi xanh bơ',            85, false, 470),
  ('bottom_shorts_pink',      'bottom', 'Quần đùi hồng phấn',          85, false, 475),
  ('bottom_shorts_camo',      'bottom', 'Quần đùi rằn ri dã ngoại',   110, false, 480),
  ('bottom_swim_hawaii',      'bottom', 'Quần bơi Hawaii rực rỡ',     120, false, 485),
  ('bottom_skirt_pleated',    'bottom', 'Chân váy xếp ly nữ sinh',    170, false, 490),
  ('bottom_skirt_denim',      'bottom', 'Chân váy bò năng động',      180, false, 495),
  ('bottom_skirt_black',      'bottom', 'Chân váy chữ A đen',         160, false, 500),
  ('bottom_skirt_red',        'bottom', 'Váy dạ hội đỏ quyến rũ',     350, false, 505),
  ('bottom_pants_silk_white', 'bottom', 'Quần lụa trắng thướt tha',   250, false, 510),
  ('bottom_pants_silk_black', 'bottom', 'Quần lụa đen truyền thống',  200, false, 515),
  ('bottom_pants_royal',      'bottom', 'Quần hoàng gia nhung tím',   500, false, 520),

  -- Dép & Giày (15 items)
  ('shoes_dep_toong',      'shoes', 'Dép tổ ong huyền thoại',       50,  false, 600),
  ('shoes_dep_green',      'shoes', 'Dép lào xanh lá mạ',           60,  false, 605),
  ('shoes_dep_yellow',     'shoes', 'Dép lào vàng chói',            60,  false, 610),
  ('shoes_dep_black',      'shoes', 'Dép quai ngang đen',           80,  false, 615),
  ('shoes_dep_pink',       'shoes', 'Dép quai ngang hồng',          80,  false, 620),
  ('shoes_sandal_brown',   'shoes', 'Sandal da nâu học sinh',      110,  false, 625),
  ('shoes_sandal_black',   'shoes', 'Sandal chiến binh đen',       120,  false, 630),
  ('shoes_sneaker_white',  'shoes', 'Giày sneaker trắng phố',      180,  false, 635),
  ('shoes_sneaker_red',    'shoes', 'Giày thể thao đỏ phong cách', 190,  false, 640),
  ('shoes_sneaker_black',  'shoes', 'Giày sneaker đen classic',    180,  false, 645),
  ('shoes_sneaker_neon',   'shoes', 'Giày chạy bộ neon rực rỡ',    220,  false, 650),
  ('shoes_oxford_black',   'shoes', 'Giày tây Oxford đen bóng',    250,  false, 655),
  ('shoes_oxford_brown',   'shoes', 'Giày da nâu quý ông',         250,  false, 660),
  ('shoes_boots_combat',   'shoes', 'Bốt chiến binh đen hầm hố',   280,  false, 665),
  ('shoes_boots_yellow',   'shoes', 'Ủng vàng làm nông chống nước',120,  false, 670),

  -- Khăn (15 items)
  ('neck_khanran_blue',   'neck', 'Khăn rằn xanh sông nước',     90,   false, 700),
  ('neck_khanran_green',  'neck', 'Khăn rằn xanh đồng quê',      90,   false, 705),
  ('neck_khanran_purple', 'neck', 'Khăn rằn tím chung thủy',     95,   false, 710),
  ('neck_khanran_yellow', 'neck', 'Khăn rằn vàng óng ả',         95,   false, 715),
  ('neck_khanran_pink',   'neck', 'Khăn rằn hồng duyên dáng',    95,   false, 720),
  ('neck_khanran_brown',  'neck', 'Khăn rằn nâu phù sa',         90,   false, 725),
  ('neck_scarf_red',      'neck', 'Khăn len đỏ ấm áp',          140,   false, 730),
  ('neck_scarf_white',    'neck', 'Khăn len trắng tuyết',       140,   false, 735),
  ('neck_scarf_grey',     'neck', 'Khăn len xám Hàn Quốc',      140,   false, 740),
  ('neck_scarf_plaid',    'neck', 'Khăn choàng caro đỏ đen',    160,   false, 745),
  ('neck_tie_black',      'neck', 'Cà vạt đen công sở',         150,   false, 750),
  ('neck_tie_red',        'neck', 'Cà vạt đỏ quyền lực',        160,   false, 755),
  ('neck_bowtie_black',   'neck', 'Nơ cổ đen dạ tiệc',          130,   false, 760),
  ('neck_choker_heart',   'neck', 'Choker trái tim quyến rũ',   180,   false, 765),
  ('neck_gold_chain',     'neck', 'Dây chuyền vàng đại gia',    888,   false, 770)
on conflict (id) do update set
  slot = excluded.slot,
  name = excluded.name,
  price = excluded.price,
  starter = excluded.starter,
  sort_order = excluded.sort_order;

-- ---------- C. Upgraded _item_ok allowing owned items ----------
create or replace function public._item_ok(p_account uuid, p_item text, p_slot text, p_required boolean)
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if p_item is null then return not p_required; end if;
  return exists (
    select 1 from public.item_catalog c
    where c.id = p_item and c.slot = p_slot
      and (
        c.starter
        or (p_account is not null and exists (
          select 1 from public.account_items a
          where a.account_id = p_account and a.item_id = p_item
        ))
      )
  );
end; $$;
revoke all on function public._item_ok(uuid, text, text, boolean) from public, anon, authenticated;

-- Overload for backwards compatibility if needed
create or replace function public._item_ok(p_item text, p_slot text, p_required boolean)
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  return public._item_ok(null, p_item, p_slot, p_required);
end; $$;
revoke all on function public._item_ok(text, text, boolean) from public, anon, authenticated;

-- ---------- D. Updated save_character using upgraded _item_ok ----------
create or replace function public.save_character(
  p_session_token text, p_skin text, p_hair text, p_hair_color text,
  p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text
) returns public.characters
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_row public.characters;
begin
  v_account := public._auth_account(p_session_token);
  if p_skin is null or p_skin not in ('light','warm','tan','deep')
     or p_hair is null or p_hair not in ('short','bob','long')
     or p_hair_color is null or p_hair_color not in ('black','darkbrown','brown','pink') then
    raise exception 'invalid character option' using errcode = '22023';
  end if;
  if not public._item_ok(v_account, p_hat, 'hat', false)
     or not public._item_ok(v_account, p_top, 'top', true)
     or not public._item_ok(v_account, p_bottom, 'bottom', true)
     or not public._item_ok(v_account, p_shoes, 'shoes', true)
     or not public._item_ok(v_account, p_neck, 'neck', false) then
    raise exception 'item not available' using errcode = '22023';
  end if;
  insert into public.characters as c (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, updated_at)
  values (v_account, p_skin, p_hair, p_hair_color, p_hat, p_top, p_bottom, p_shoes, p_neck, now())
  on conflict (account_id) do update set
    skin = excluded.skin, hair = excluded.hair, hair_color = excluded.hair_color,
    hat = excluded.hat, top = excluded.top, bottom = excluded.bottom, shoes = excluded.shoes,
    neck = excluded.neck, updated_at = now()
  returning c.* into v_row;
  return v_row;
end; $$;

-- ---------- E. Store RPCs: Buy, Sell, Transfer, My Wardrobe ----------

-- 1. Buy fashion item
create or replace function public.buy_fashion_item(p_session_token text, p_item_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid;
  v_item public.item_catalog;
  v_coins integer;
  v_new_bal integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found then
    raise exception 'item not found' using errcode = '22023';
  end if;
  if v_item.starter then
    raise exception 'item is free starter' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_items where account_id = v_account and item_id = p_item_id) then
    raise exception 'already owned' using errcode = '22023';
  end if;

  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_item.price then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;

  v_new_bal := public._pay(v_account, -v_item.price, 'buy', 'fashion: ' || p_item_id);
  insert into public.account_items (account_id, item_id, acquired_at)
  values (v_account, p_item_id, now());

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'coins', v_new_bal);
end; $$;

-- 2. Sell fashion item back to store (50% refund value)
create or replace function public.sell_fashion_item(p_session_token text, p_item_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid;
  v_item public.item_catalog;
  v_refund integer;
  v_new_bal integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);

  if not exists (select 1 from public.account_items where account_id = v_account and item_id = p_item_id) then
    raise exception 'not owned' using errcode = '22023';
  end if;

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found or v_item.starter then
    raise exception 'cannot sell item' using errcode = '22023';
  end if;

  v_refund := greatest(1, (v_item.price * 50) / 100);

  delete from public.account_items where account_id = v_account and item_id = p_item_id;

  -- Revert currently worn item to null or default starter
  update public.characters
  set hat = case when hat = p_item_id then null else hat end,
      neck = case when neck = p_item_id then null else neck end,
      top = case when top = p_item_id then 'top_baba_yellow' else top end,
      bottom = case when bottom = p_item_id then 'bottom_jeans' else bottom end,
      shoes = case when shoes = p_item_id then 'shoes_dep_blue' else shoes end,
      updated_at = now()
  where account_id = v_account;

  v_new_bal := public._pay(v_account, v_refund, 'sell', 'fashion: ' || p_item_id);

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'refund', v_refund, 'coins', v_new_bal);
end; $$;

-- 3. Transfer / Pass item between 2 users
create or replace function public.transfer_fashion_item(
  p_session_token text, p_target_account_id uuid, p_item_id text
) returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_sender uuid;
  v_item public.item_catalog;
begin
  v_sender := public._auth_account(p_session_token);
  if p_target_account_id is null or p_target_account_id = v_sender then
    raise exception 'invalid target account' using errcode = '22023';
  end if;

  if not exists (select 1 from public.accounts where id = p_target_account_id) then
    raise exception 'target account not found' using errcode = '22023';
  end if;

  if not exists (select 1 from public.account_items where account_id = v_sender and item_id = p_item_id) then
    raise exception 'not owned' using errcode = '22023';
  end if;

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found or v_item.starter then
    raise exception 'cannot transfer item' using errcode = '22023';
  end if;

  if exists (select 1 from public.account_items where account_id = p_target_account_id and item_id = p_item_id) then
    raise exception 'recipient already owns item' using errcode = '22023';
  end if;

  -- Revert sender's character look if wearing this item
  update public.characters
  set hat = case when hat = p_item_id then null else hat end,
      neck = case when neck = p_item_id then null else neck end,
      top = case when top = p_item_id then 'top_baba_yellow' else top end,
      bottom = case when bottom = p_item_id then 'bottom_jeans' else bottom end,
      shoes = case when shoes = p_item_id then 'shoes_dep_blue' else shoes end,
      updated_at = now()
  where account_id = v_sender;

  -- Atomic transfer
  delete from public.account_items where account_id = v_sender and item_id = p_item_id;
  insert into public.account_items (account_id, item_id, acquired_at)
  values (p_target_account_id, p_item_id, now());

  return jsonb_build_object(
    'ok', true,
    'item_id', p_item_id,
    'sender_id', v_sender,
    'recipient_id', p_target_account_id
  );
end; $$;

-- 4. Get player's wardrobe and coins
create or replace function public.get_my_wardrobe(p_session_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid;
  v_coins integer;
  v_items jsonb;
begin
  v_account := public._auth_account(p_session_token);
  select coins into v_coins from public.wallets where account_id = v_account;
  select coalesce(jsonb_agg(item_id), '[]'::jsonb) into v_items from public.account_items where account_id = v_account;
  return jsonb_build_object('coins', coalesce(v_coins, 0), 'items', v_items);
end; $$;

grant execute on function public.buy_fashion_item(text, text) to anon, authenticated;
grant execute on function public.sell_fashion_item(text, text) to anon, authenticated;
grant execute on function public.transfer_fashion_item(text, uuid, text) to anon, authenticated;
grant execute on function public.get_my_wardrobe(text) to anon, authenticated;
grant select on public.account_items to anon, authenticated;
