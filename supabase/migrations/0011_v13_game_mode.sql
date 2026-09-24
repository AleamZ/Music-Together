-- =========================================================
-- 0011_v13_game_mode.sql — v13: game-mode characters + starter item catalog.
-- ADDITIVE (no data drop) and re-runnable. Every function relies on `set search_path = public, extensions`.
-- =========================================================

-- ---------- A. Item catalog (public read) ----------
create table if not exists public.item_catalog (
  id text primary key,
  slot text not null check (slot in ('hat','top','bottom','shoes','neck','hand','pet')),
  name text not null,
  price integer not null default 0 check (price >= 0),
  starter boolean not null default false,
  sort_order integer not null default 0
);
alter table public.item_catalog enable row level security;
drop policy if exists item_catalog_select on public.item_catalog;
create policy item_catalog_select on public.item_catalog for select to anon using (true);

insert into public.item_catalog (id, slot, name, price, starter, sort_order) values
  ('hat_nonla',          'hat',    'Nón lá',             0, true, 10),
  ('hat_taibeo_green',   'hat',    'Mũ tai bèo xanh',    0, true, 20),
  ('top_baba_yellow',    'top',    'Áo bà ba vàng',      0, true, 10),
  ('top_baba_white',     'top',    'Áo bà ba trắng',     0, true, 20),
  ('top_baba_pink',      'top',    'Áo bà ba hồng',      0, true, 30),
  ('top_tee_blue',       'top',    'Áo thun xanh dương', 0, true, 40),
  ('top_tee_green',      'top',    'Áo thun xanh lá',    0, true, 50),
  ('bottom_shorts_red',  'bottom', 'Quần đùi đỏ',        0, true, 10),
  ('bottom_pants_black', 'bottom', 'Quần dài đen',       0, true, 20),
  ('bottom_jeans',       'bottom', 'Quần jean',          0, true, 30),
  ('shoes_dep_blue',     'shoes',  'Dép xanh',           0, true, 10),
  ('shoes_dep_brown',    'shoes',  'Dép nâu',            0, true, 20),
  ('shoes_dep_red',      'shoes',  'Dép đỏ',             0, true, 30),
  ('neck_khanran',       'neck',   'Khăn rằn',           0, true, 10),
  ('neck_khanran_red',   'neck',   'Khăn rằn đỏ',        0, true, 20)
on conflict (id) do update set
  slot = excluded.slot, name = excluded.name, price = excluded.price,
  starter = excluded.starter, sort_order = excluded.sort_order;

-- ---------- B. Characters: one per account (public read, like accounts.username) ----------
create table if not exists public.characters (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  skin text not null,
  hair text not null,
  hair_color text not null,
  hat text references public.item_catalog(id),
  top text not null references public.item_catalog(id),
  bottom text not null references public.item_catalog(id),
  shoes text not null references public.item_catalog(id),
  neck text references public.item_catalog(id),
  hand text references public.item_catalog(id),
  pet text references public.item_catalog(id),
  updated_at timestamptz not null default now()
);
alter table public.characters enable row level security;
drop policy if exists characters_select on public.characters;
create policy characters_select on public.characters for select to anon using (true);

-- ---------- C. Helper: may this item be worn in this slot? (v13: starter items only; v14 adds "or owned") ----------
create or replace function public._item_ok(p_item text, p_slot text, p_required boolean)
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if p_item is null then return not p_required; end if;
  return exists (select 1 from public.item_catalog c where c.id = p_item and c.slot = p_slot and c.starter);
end; $$;
revoke all on function public._item_ok(text, text, boolean) from public, anon, authenticated;

-- ---------- D. RPC: save_character (create or replace my look) ----------
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
  if not public._item_ok(p_hat, 'hat', false)
     or not public._item_ok(p_top, 'top', true)
     or not public._item_ok(p_bottom, 'bottom', true)
     or not public._item_ok(p_shoes, 'shoes', true)
     or not public._item_ok(p_neck, 'neck', false) then
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
