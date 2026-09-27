-- =========================================================
-- 0029_fashion2.sql — v18.6 Thời trang 2: accessories (wrist, hairpin), 10 hats, the salon, optional top/bottom.
-- Additive and re-runnable. Run after 0028 in the Supabase SQL Editor.
--   A. item_catalog slot check gains 'wrist', 'hairpin'.
--   B. characters gains wrist + hairpin (nullable, references item_catalog); top and bottom drop not null.
--   C. 15 accessories + 10 hats (non-starter).
--   D. _hair_ok helper over the hair style / colour lists.
--   E. save_character gains p_wrist, p_hairpin; top/bottom optional; hair is never taken from the caller
--      (kept on an existing row, gender default on a new one). Body from 0024, guards otherwise unchanged.
--   F. sell_fashion_item / transfer_fashion_item (latest: 0024): a sold / given top or bottom becomes null,
--      a worn wrist / hairpin is cleared.
--   G. coin_ledger reason check gains 'salon'; salon_style RPC (cut 300, dye 500, both 700).
-- =========================================================

-- ---------- A. Catalog slots ----------
alter table public.item_catalog drop constraint if exists item_catalog_slot_check;
alter table public.item_catalog add constraint item_catalog_slot_check
  check (slot in ('hat','top','bottom','shoes','neck','hand','pet','outfit','wrist','hairpin'));

-- ---------- B. Characters: wrist, hairpin; optional top/bottom ----------
alter table public.characters add column if not exists wrist text references public.item_catalog(id);
alter table public.characters add column if not exists hairpin text references public.item_catalog(id);
alter table public.characters alter column top drop not null;
alter table public.characters alter column bottom drop not null;

-- ---------- C. 15 accessories + 10 hats ----------
insert into public.item_catalog (id, slot, name, price, starter, sort_order, gender) values
  ('acc_necklace_silver', 'neck',    'Dây chuyền bạc',     800, false, 823, 'unisex'),
  ('acc_necklace_gold',   'neck',    'Dây chuyền vàng',   2000, false, 824, 'unisex'),
  ('acc_necklace_pearl',  'neck',    'Chuỗi ngọc trai',   1500, false, 825, 'nu'),
  ('acc_necklace_jade',   'neck',    'Mặt dây ngọc bích', 1800, false, 826, 'unisex'),
  ('acc_bracelet_wood',   'wrist',   'Vòng tay gỗ',        300, false, 827, 'unisex'),
  ('acc_bracelet_silver', 'wrist',   'Lắc tay bạc',        700, false, 828, 'unisex'),
  ('acc_bracelet_beads',  'wrist',   'Vòng hạt nhiều màu', 400, false, 829, 'unisex'),
  ('acc_watch',           'wrist',   'Đồng hồ đeo tay',   1200, false, 830, 'unisex'),
  ('acc_bracelet_jade',   'wrist',   'Vòng cẩm thạch',    1600, false, 831, 'nu'),
  ('acc_clip_star',       'hairpin', 'Kẹp tóc ngôi sao',   250, false, 832, 'unisex'),
  ('acc_bow_red',         'hairpin', 'Nơ đỏ',              300, false, 833, 'nu'),
  ('acc_headband',        'hairpin', 'Bờm tóc',            350, false, 834, 'nu'),
  ('acc_bandana',         'hairpin', 'Băng đô thể thao',   400, false, 835, 'unisex'),
  ('acc_flower_clip',     'hairpin', 'Kẹp hoa sứ',         450, false, 836, 'nu'),
  ('acc_hair_tie',        'hairpin', 'Dây buộc tóc',       150, false, 837, 'unisex'),
  ('hat_cap',             'hat',     'Mũ lưỡi trai',       400, false, 838, 'unisex'),
  ('hat_beanie',          'hat',     'Mũ len',             450, false, 839, 'unisex'),
  ('hat_fedora',          'hat',     'Mũ phớt',            900, false, 840, 'unisex'),
  ('hat_sunhat',          'hat',     'Mũ rộng vành',       700, false, 841, 'unisex'),
  ('hat_helmet',          'hat',     'Mũ bảo hiểm',        600, false, 842, 'unisex'),
  ('hat_coi',             'hat',     'Mũ cối',             500, false, 843, 'unisex'),
  ('hat_bucket',          'hat',     'Mũ bucket',          450, false, 844, 'unisex'),
  ('hat_crown',           'hat',     'Vương miện',        5000, false, 845, 'unisex'),
  ('hat_antlers',         'hat',     'Sừng tuần lộc',      800, false, 846, 'unisex'),
  ('hat_straw_cowboy',    'hat',     'Mũ cao bồi cói',    1000, false, 847, 'unisex')
on conflict (id) do update set
  slot = excluded.slot, name = excluded.name, price = excluded.price,
  starter = excluded.starter, sort_order = excluded.sort_order, gender = excluded.gender;

-- ---------- D. Helper: is this a known hair style + colour? ----------
create or replace function public._hair_ok(p_hair text, p_color text)
returns boolean language sql immutable security definer set search_path = public, extensions
as $$
  select p_hair is not null and p_color is not null
     and p_hair in ('short','bob','long','buzz','undercut','curly','ponytail','twin_braids','bun','bangs')
     and p_color in ('black','darkbrown','brown','pink','blonde','red','blue','silver','purple','moss');
$$;
revoke all on function public._hair_ok(text, text) from public, anon, authenticated;

-- ---------- E. save_character with wrist + hairpin, optional top/bottom, hair not client-chosen ----------
-- The 11-argument version would make an 11-argument call ambiguous next to the defaulted 13-argument one: drop it.
drop function if exists public.save_character(text,text,text,text,text,text,text,text,text,text,text);

create or replace function public.save_character(
  p_session_token text, p_skin text, p_hair text, p_hair_color text,
  p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text,
  p_gender text default 'nam', p_outfit text default null,
  p_wrist text default null, p_hairpin text default null
) returns public.characters
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_row public.characters; v_hair text; v_color text;
begin
  v_account := public._auth_account(p_session_token);
  -- p_hair / p_hair_color are ignored: hair only changes through salon_style.
  if p_skin is null or p_skin not in ('light','warm','tan','deep')
     or p_gender is null or p_gender not in ('nam','nu') then
    raise exception 'invalid character option' using errcode = '22023';
  end if;
  if not public._item_ok(v_account, p_hat, 'hat', false)
     or not public._item_ok(v_account, p_top, 'top', false)
     or not public._item_ok(v_account, p_bottom, 'bottom', false)
     or not public._item_ok(v_account, p_shoes, 'shoes', true)
     or not public._item_ok(v_account, p_neck, 'neck', false)
     or not public._item_ok(v_account, p_outfit, 'outfit', false)
     or not public._item_ok(v_account, p_wrist, 'wrist', false)
     or not public._item_ok(v_account, p_hairpin, 'hairpin', false) then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if not public._item_gender_ok(p_hat, p_gender)
     or not public._item_gender_ok(p_top, p_gender)
     or not public._item_gender_ok(p_bottom, p_gender)
     or not public._item_gender_ok(p_shoes, p_gender)
     or not public._item_gender_ok(p_neck, p_gender)
     or not public._item_gender_ok(p_outfit, p_gender)
     or not public._item_gender_ok(p_wrist, p_gender)
     or not public._item_gender_ok(p_hairpin, p_gender) then
    raise exception 'item not for this gender' using errcode = '22023';
  end if;
  -- New rows get the gender default; the conflict branch below never touches hair.
  v_hair := case when p_gender = 'nu' then 'long' else 'short' end;
  v_color := 'black';
  insert into public.characters as c (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender, outfit, wrist, hairpin, updated_at)
  values (v_account, p_skin, v_hair, v_color, p_hat, p_top, p_bottom, p_shoes, p_neck, p_gender, p_outfit, p_wrist, p_hairpin, now())
  on conflict (account_id) do update set
    skin = excluded.skin,
    hat = excluded.hat, top = excluded.top, bottom = excluded.bottom, shoes = excluded.shoes,
    neck = excluded.neck, gender = excluded.gender, outfit = excluded.outfit,
    wrist = excluded.wrist, hairpin = excluded.hairpin, updated_at = now()
  returning c.* into v_row;
  return v_row;
end; $$;
grant execute on function public.save_character(text,text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- ---------- F. Sell / transfer: top/bottom -> null, wrist/hairpin cleared (bodies from 0024) ----------
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
      outfit = case when outfit = p_item_id then null else outfit end,
      wrist = case when wrist = p_item_id then null else wrist end,
      hairpin = case when hairpin = p_item_id then null else hairpin end,
      top = case when top = p_item_id then null else top end,
      bottom = case when bottom = p_item_id then null else bottom end,
      shoes = case when shoes = p_item_id then 'shoes_dep_blue' else shoes end,
      updated_at = now()
  where account_id = v_account;

  v_new_bal := public._pay(v_account, v_refund, 'sell', 'fashion: ' || p_item_id);

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'refund', v_refund, 'coins', v_new_bal);
end; $$;

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
      outfit = case when outfit = p_item_id then null else outfit end,
      wrist = case when wrist = p_item_id then null else wrist end,
      hairpin = case when hairpin = p_item_id then null else hairpin end,
      top = case when top = p_item_id then null else top end,
      bottom = case when bottom = p_item_id then null else bottom end,
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

grant execute on function public.sell_fashion_item(text, text) to anon, authenticated;
grant execute on function public.transfer_fashion_item(text, uuid, text) to anon, authenticated;

-- ---------- G. Ledger reason 'salon' + salon_style ----------
-- The 26 reasons in force after 0027 (0028 adds none) plus 'salon': 27.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon'));

create or replace function public.salon_style(p_session_token text, p_hair text, p_hair_color text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid;
  v_row public.characters;
  v_price integer;
  v_coins integer;
  v_new_bal integer;
begin
  v_account := public._auth_account(p_session_token);
  if not public._hair_ok(p_hair, p_hair_color) then
    raise exception 'invalid option' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);

  select * into v_row from public.characters where account_id = v_account for update;
  if not found then
    raise exception 'no character' using errcode = '22023';
  end if;

  -- cut 300, dye 500, both 700
  v_price := case
    when v_row.hair <> p_hair and v_row.hair_color <> p_hair_color then 700
    when v_row.hair <> p_hair then 300
    when v_row.hair_color <> p_hair_color then 500
    else 0 end;
  if v_price = 0 then
    raise exception 'no change' using errcode = '22023';
  end if;

  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;

  v_new_bal := public._pay(v_account, -v_price, 'salon', 'salon: ' || p_hair || '/' || p_hair_color);
  update public.characters set hair = p_hair, hair_color = p_hair_color, updated_at = now()
  where account_id = v_account;

  return jsonb_build_object('hair', p_hair, 'hair_color', p_hair_color, 'paid', v_price, 'coins', v_new_bal);
end; $$;
grant execute on function public.salon_style(text, text, text) to anon, authenticated;
