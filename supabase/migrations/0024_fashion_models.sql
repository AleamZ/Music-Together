-- =========================================================
-- 0024_fashion_models.sql — 20 shape-based garments + 3 shoes, the `outfit` slot, item gender.
-- Additive and re-runnable. Run after 0023 in the Supabase SQL Editor.
--   A. item_catalog.gender ('unisex' | 'nam' | 'nu', default 'unisex'); the slot check widened with 'outfit'.
--   B. characters.outfit (nullable, references item_catalog) — a full-body piece drawn over top + bottom.
--   C. The 23 catalog rows (docs/superpowers/fashion-models-contract.md).
--   D. _item_gender_ok helper.
--   E. save_character gains p_outfit (default null) and refuses an item made for the other gender.
--      Body copied from its latest definition (0023_character_gender.sql), guards unchanged.
--      Older 9- and 10-argument calls keep working through the defaults.
--   F. sell_fashion_item / transfer_fashion_item (latest: 0022) also take a sold / given outfit off.
--      buy_fashion_item (latest: 0022) needs no change: any gender may buy any item (e.g. to pass it on).
-- =========================================================

-- ---------- A. Catalog: gender column, outfit slot ----------
alter table public.item_catalog add column if not exists gender text not null default 'unisex';
alter table public.item_catalog drop constraint if exists item_catalog_gender_check;
alter table public.item_catalog add constraint item_catalog_gender_check check (gender in ('unisex','nam','nu'));

alter table public.item_catalog drop constraint if exists item_catalog_slot_check;
alter table public.item_catalog add constraint item_catalog_slot_check
  check (slot in ('hat','top','bottom','shoes','neck','hand','pet','outfit'));

-- ---------- B. Characters: outfit ----------
alter table public.characters add column if not exists outfit text references public.item_catalog(id);

-- ---------- C. The 23 fashion models ----------
insert into public.item_catalog (id, slot, name, price, starter, sort_order, gender) values
  ('fm_hoodie',        'top',    'Áo hoodie',            900, false, 800, 'unisex'),
  ('fm_denim_jacket',  'top',    'Áo khoác jean',       1200, false, 801, 'unisex'),
  ('fm_school_shirt',  'top',    'Sơ mi đồng phục',      600, false, 802, 'unisex'),
  ('fm_ao_dai',        'outfit', 'Áo dài',              2500, false, 803, 'nu'),
  ('fm_ao_ba_ba',      'top',    'Áo bà ba',             700, false, 804, 'unisex'),
  ('fm_sailor_top',    'top',    'Áo cổ thủy thủ',       800, false, 805, 'unisex'),
  ('fm_varsity',       'top',    'Áo bomber bóng chày', 1400, false, 806, 'unisex'),
  ('fm_cardigan',      'top',    'Áo cardigan',         1000, false, 807, 'unisex'),
  ('fm_tank_top',      'top',    'Áo ba lỗ',             400, false, 808, 'unisex'),
  ('fm_raincoat',      'top',    'Áo mưa',               900, false, 809, 'unisex'),
  ('fm_kimono',        'outfit', 'Áo kimono',           2200, false, 810, 'unisex'),
  ('fm_jersey',        'top',    'Áo đá banh',           800, false, 811, 'unisex'),
  ('fm_chef_coat',     'top',    'Áo đầu bếp',          1100, false, 812, 'unisex'),
  ('fm_suit',          'top',    'Áo vest',             1800, false, 813, 'unisex'),
  ('fm_puffer',        'top',    'Áo phao',             1600, false, 814, 'unisex'),
  ('fm_pleated_skirt', 'bottom', 'Váy xếp ly',           700, false, 815, 'nu'),
  ('fm_maxi_dress',    'outfit', 'Đầm maxi',            2000, false, 816, 'nu'),
  ('fm_overalls',      'outfit', 'Quần yếm',            1300, false, 817, 'unisex'),
  ('fm_cargo_shorts',  'bottom', 'Quần short túi hộp',   600, false, 818, 'unisex'),
  ('fm_rolled_jeans',  'bottom', 'Quần jean xắn gấu',    900, false, 819, 'unisex'),
  ('fm_boots',         'shoes',  'Giày bốt',            1000, false, 820, 'unisex'),
  ('fm_sneakers',      'shoes',  'Giày sneaker',         800, false, 821, 'unisex'),
  ('fm_sandals',       'shoes',  'Dép quai hậu',         300, false, 822, 'unisex')
on conflict (id) do update set
  slot = excluded.slot, name = excluded.name, price = excluded.price,
  starter = excluded.starter, sort_order = excluded.sort_order, gender = excluded.gender;

-- ---------- D. Helper: may this body type wear this item? (null item = nothing worn = fine) ----------
create or replace function public._item_gender_ok(p_item text, p_gender text)
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if p_item is null then return true; end if;
  return exists (
    select 1 from public.item_catalog c
    where c.id = p_item and (c.gender = 'unisex' or c.gender = p_gender)
  );
end; $$;
revoke all on function public._item_gender_ok(text, text) from public, anon, authenticated;

-- ---------- E. save_character with outfit + item gender ----------
-- The 10-argument version would make a 10-argument call ambiguous next to the defaulted 11-argument one: drop it.
drop function if exists public.save_character(text,text,text,text,text,text,text,text,text,text);

create or replace function public.save_character(
  p_session_token text, p_skin text, p_hair text, p_hair_color text,
  p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text,
  p_gender text default 'nam', p_outfit text default null
) returns public.characters
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_row public.characters;
begin
  v_account := public._auth_account(p_session_token);
  if p_skin is null or p_skin not in ('light','warm','tan','deep')
     or p_hair is null or p_hair not in ('short','bob','long')
     or p_hair_color is null or p_hair_color not in ('black','darkbrown','brown','pink')
     or p_gender is null or p_gender not in ('nam','nu') then
    raise exception 'invalid character option' using errcode = '22023';
  end if;
  if not public._item_ok(v_account, p_hat, 'hat', false)
     or not public._item_ok(v_account, p_top, 'top', true)
     or not public._item_ok(v_account, p_bottom, 'bottom', true)
     or not public._item_ok(v_account, p_shoes, 'shoes', true)
     or not public._item_ok(v_account, p_neck, 'neck', false)
     or not public._item_ok(v_account, p_outfit, 'outfit', false) then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if not public._item_gender_ok(p_hat, p_gender)
     or not public._item_gender_ok(p_top, p_gender)
     or not public._item_gender_ok(p_bottom, p_gender)
     or not public._item_gender_ok(p_shoes, p_gender)
     or not public._item_gender_ok(p_neck, p_gender)
     or not public._item_gender_ok(p_outfit, p_gender) then
    raise exception 'item not for this gender' using errcode = '22023';
  end if;
  insert into public.characters as c (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender, outfit, updated_at)
  values (v_account, p_skin, p_hair, p_hair_color, p_hat, p_top, p_bottom, p_shoes, p_neck, p_gender, p_outfit, now())
  on conflict (account_id) do update set
    skin = excluded.skin, hair = excluded.hair, hair_color = excluded.hair_color,
    hat = excluded.hat, top = excluded.top, bottom = excluded.bottom, shoes = excluded.shoes,
    neck = excluded.neck, gender = excluded.gender, outfit = excluded.outfit, updated_at = now()
  returning c.* into v_row;
  return v_row;
end; $$;
grant execute on function public.save_character(text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- ---------- F. Sell / transfer also take off a worn outfit (bodies from 0022, guards unchanged) ----------
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
      top = case when top = p_item_id then 'top_baba_yellow' else top end,
      bottom = case when bottom = p_item_id then 'bottom_jeans' else bottom end,
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

grant execute on function public.sell_fashion_item(text, text) to anon, authenticated;
grant execute on function public.transfer_fashion_item(text, uuid, text) to anon, authenticated;
grant select on public.characters to anon, authenticated;
grant select on public.item_catalog to anon, authenticated;
