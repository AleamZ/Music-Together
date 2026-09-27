-- =========================================================
-- 0036_pets.sql — v18.12 Thú cưng (docs/superpowers/plans/2026-09-27-v18-12-pets.md, spec §18.12).
-- ADDITIVE and re-runnable. Run after 0034 (the ledger reasons) and 0033 (vitals_tick).
--   A. The catalog: pet_item_catalog (food, toys, fashion); species prices and variants as pure functions.
--      lib/game/pets/catalog.ts mirrors them (tests/unit/pets.test.ts pins the rows equal).
--   B. pets, pet_items, pet_owner.
--   C. Rules: _pet_name, _pet_rates, _pet_now (lazy decay from stats_at, like the v18.3 vitals), _pet_json.
--   D. RPCs pets_state, pet_buy, pet_buy_item, pet_feed, pet_play, pet_set_active, pet_rename, pet_equip, pet_tick
--      (the sóc's forage).
--   E. The ledger: the 28 reasons of 0034 plus 'pet_buy' and 'pet_find': 30.
--   F. The mèo: _vitals_apply(uuid, numeric, numeric) with a hunger factor, and vitals_tick (0033's body) with the
--      cat factor. Only the lines marked "v18.12" differ from 0033 / 0030.
-- The pet's position is never on the server: following is drawn by the clients. "Following" on the server means the
-- active pet, not sulking.
-- =========================================================

-- ---------- A. Catalog ----------
create table if not exists public.pet_item_catalog (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('food','toy','head','neck','body')),
  species text not null check (species in ('hamster','tho','soc','meo','cho','vet')),
  price int not null check (price > 0),
  sort_order int not null
);
alter table public.pet_item_catalog enable row level security;
revoke all on public.pet_item_catalog from anon, authenticated;
insert into public.pet_item_catalog (id, name, kind, species, price, sort_order) values
  ('food_cho', 'Pate cho chó', 'food', 'cho', 30, 1),
  ('food_meo', 'Cá khô cho mèo', 'food', 'meo', 30, 2),
  ('food_vet', 'Hạt kê', 'food', 'vet', 20, 3),
  ('food_soc', 'Hạt dẻ', 'food', 'soc', 20, 4),
  ('food_tho', 'Cà rốt', 'food', 'tho', 15, 5),
  ('food_hamster', 'Hạt hướng dương', 'food', 'hamster', 10, 6),
  ('toy_ball', 'Bóng cao su', 'toy', 'cho', 200, 7),
  ('toy_wand', 'Cần câu mèo', 'toy', 'meo', 200, 8),
  ('toy_bell', 'Chuông', 'toy', 'vet', 250, 9),
  ('toy_cone', 'Quả thông gỗ', 'toy', 'soc', 200, 10),
  ('toy_tunnel', 'Đường hầm cỏ', 'toy', 'tho', 250, 11),
  ('toy_wheel', 'Bánh xe', 'toy', 'hamster', 300, 12),
  ('cho_collar', 'Vòng cổ đỏ', 'neck', 'cho', 150, 13),
  ('cho_bandana', 'Khăn bandana', 'neck', 'cho', 250, 14),
  ('cho_sweater', 'Áo len', 'body', 'cho', 400, 15),
  ('cho_party', 'Nón sinh nhật', 'head', 'cho', 300, 16),
  ('meo_bow', 'Nơ hồng', 'head', 'meo', 200, 17),
  ('meo_bell', 'Vòng chuông', 'neck', 'meo', 200, 18),
  ('meo_sweater', 'Áo len', 'body', 'meo', 400, 19),
  ('vet_tophat', 'Nón chóp', 'head', 'vet', 350, 20),
  ('vet_bowtie', 'Nơ cổ', 'neck', 'vet', 200, 21),
  ('soc_scarf', 'Khăn quàng', 'neck', 'soc', 200, 22),
  ('soc_nonla', 'Nón lá mini', 'head', 'soc', 300, 23),
  ('tho_bow', 'Nơ tai', 'head', 'tho', 200, 24),
  ('tho_vest', 'Áo yếm', 'body', 'tho', 350, 25),
  ('hamster_beanie', 'Nón len', 'head', 'hamster', 200, 26),
  ('hamster_scarf', 'Khăn quàng', 'neck', 'hamster', 200, 27)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, species = excluded.species,
  price = excluded.price, sort_order = excluded.sort_order;

-- The species' prices (null: no such species).
create or replace function public._pet_species_price(p_species text) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case p_species when 'hamster' then 800 when 'tho' then 1500 when 'soc' then 2500
                        when 'meo' then 3000 when 'cho' then 3500 when 'vet' then 5000 end
$$;

-- The colour variants of each species.
create or replace function public._pet_variant_ok(p_species text, p_variant text) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select coalesce(case p_species
    when 'hamster' then p_variant in ('vang','trang','xam')
    when 'tho' then p_variant in ('trang','nau','xam')
    when 'soc' then p_variant in ('nau','do','xam')
    when 'meo' then p_variant in ('cam','den','trang')
    when 'cho' then p_variant in ('vang','nau','trang')
    when 'vet' then p_variant in ('xanh','do','lam') end, false)
$$;

create or replace function public._pet_species_name(p_species text) returns text
language sql immutable set search_path = public, extensions
as $$
  select case p_species when 'hamster' then 'Hamster' when 'tho' then 'Thỏ' when 'soc' then 'Sóc'
                        when 'meo' then 'Mèo' when 'cho' then 'Chó' when 'vet' then 'Vẹt' end
$$;
revoke all on function public._pet_species_price(text) from public, anon, authenticated;
revoke all on function public._pet_variant_ok(text, text) from public, anon, authenticated;
revoke all on function public._pet_species_name(text) from public, anon, authenticated;

-- ---------- B. Tables ----------
create table if not exists public.pets (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  species text not null check (species in ('hamster','tho','soc','meo','cho','vet')),
  variant text not null,
  name text not null check (char_length(name) between 1 and 16),
  fullness numeric not null default 80 check (fullness between 0 and 100),
  happy numeric not null default 80 check (happy between 0 and 100),
  stats_at timestamptz not null default now(),   -- fullness/happy as of this time (decay is applied lazily)
  played_at timestamptz,
  head text references public.pet_item_catalog(id),
  neck text references public.pet_item_catalog(id),
  body text references public.pet_item_catalog(id),
  created_at timestamptz not null default now()
);
create index if not exists pets_account_idx on public.pets(account_id);
alter table public.pets enable row level security;
revoke all on public.pets from anon, authenticated;

create table if not exists public.pet_items (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.pet_item_catalog(id),
  qty int not null check (qty >= 0),
  primary key (account_id, item_id)
);
alter table public.pet_items enable row level security;
revoke all on public.pet_items from anon, authenticated;

create table if not exists public.pet_owner (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  active_pet bigint references public.pets(id) on delete set null,
  forage_at timestamptz,          -- the sóc's last forage
  forage_day date,                -- the Vietnam day forage_today counts
  forage_today int not null default 0
);
alter table public.pet_owner enable row level security;
revoke all on public.pet_owner from anon, authenticated;

-- ---------- C. Rules (lib/game/pets/model.ts mirrors them) ----------
-- A pet's name: control characters and <> removed, spaces collapsed, trimmed; 1–16 characters or 'bad name'.
create or replace function public._pet_name(p_name text) returns text
language plpgsql immutable set search_path = public, extensions
as $$
declare v text;
begin
  v := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g'), '\s+', ' ', 'g'));
  if char_length(v) < 1 or char_length(v) > 16 then raise exception 'bad name' using errcode = '22023'; end if;
  return v;
end $$;

-- Per second: fullness 100 → 0 in 48 h (172800 s); happiness 100 → 0 in 36 h (129600 s), a hamster's at half speed.
create or replace function public._pet_rates(p_species text, out no_per_s numeric, out vui_per_s numeric)
language sql immutable set search_path = public, extensions
as $$ select 100.0 / 172800, 100.0 / 129600 * case when p_species = 'hamster' then 0.5 else 1 end $$;

-- The pet as of now (not written back; callers that change a stat write fullness/happy/stats_at together).
create or replace function public._pet_now(p public.pets) returns public.pets
language plpgsql stable set search_path = public, extensions
as $$
declare r record; dt numeric;
begin
  select * into r from public._pet_rates(p.species);
  dt := greatest(0, extract(epoch from now() - p.stats_at));
  p.fullness := greatest(0, p.fullness - dt * r.no_per_s);
  p.happy := greatest(0, p.happy - dt * r.vui_per_s);
  p.stats_at := now();
  return p;
end $$;

create or replace function public._pet_json(p public.pets) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p.id, 'species', p.species, 'variant', p.variant, 'name', p.name,
    'fullness', round(p.fullness, 2), 'happy', round(p.happy, 2), 'sulking', p.fullness <= 0,
    'head', p.head, 'neck', p.neck, 'body', p.body,
    'play_ready_ms', case when p.played_at > now() - interval '10 minutes'
                          then (extract(epoch from p.played_at + interval '10 minutes') * 1000)::bigint end)
$$;

-- Everything the panel shows.
create or replace function public._pets_state(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'pets', coalesce((select jsonb_agg(public._pet_json(public._pet_now(p)) order by p.id)
                      from public.pets p where p.account_id = p_account), '[]'::jsonb),
    'active', (select o.active_pet from public.pet_owner o where o.account_id = p_account),
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty) from public.pet_items i
                       where i.account_id = p_account and i.qty > 0), '{}'::jsonb),
    'forage_today', coalesce((select case when o.forage_day = (now() at time zone 'Asia/Ho_Chi_Minh')::date
                                          then o.forage_today else 0 end
                              from public.pet_owner o where o.account_id = p_account), 0),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;

-- The caller's pet, locked and brought up to now.
create or replace function public._pet_mine(p_account uuid, p_pet bigint) returns public.pets
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.pets;
begin
  select * into p from public.pets where id = p_pet and account_id = p_account for update;
  if not found then raise exception 'not your pet' using errcode = '22023'; end if;
  return public._pet_now(p);
end $$;

-- The active pet that follows its owner (not sulking), brought up to now; null without one.
create or replace function public._pet_following(p_account uuid) returns public.pets
language plpgsql stable security definer set search_path = public, extensions
as $$
declare p public.pets;
begin
  select pe.* into p from public.pet_owner o join public.pets pe on pe.id = o.active_pet
   where o.account_id = p_account;
  if not found then return null; end if;
  p := public._pet_now(p);
  if p.fullness <= 0 then return null; end if;
  return p;
end $$;

revoke all on function public._pet_name(text) from public, anon, authenticated;
revoke all on function public._pet_rates(text) from public, anon, authenticated;
revoke all on function public._pet_now(public.pets) from public, anon, authenticated;
revoke all on function public._pet_json(public.pets) from public, anon, authenticated;
revoke all on function public._pets_state(uuid) from public, anon, authenticated;
revoke all on function public._pet_mine(uuid, bigint) from public, anon, authenticated;
revoke all on function public._pet_following(uuid) from public, anon, authenticated;

-- ---------- E. The ledger ----------
-- The 28 reasons in force after 0034 (0035 adds none) plus 'pet_buy' and 'pet_find': 30.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find'));

-- ---------- D. RPCs ----------
create or replace function public.pets_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._pets_state(public._auth_account(p_session_token));
end $$;

-- Buy a pet (max 6). It starts at 80/80 and follows at once when no other pet does.
create or replace function public.pet_buy(p_session_token text, p_species text, p_variant text,
                                          p_name text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_price int; v_name text; v_coins int; v_bal int;
        v_id bigint;
begin
  v_price := public._pet_species_price(p_species);
  if v_price is null or not public._pet_variant_ok(p_species, p_variant) then
    raise exception 'unknown pet' using errcode = '22023';
  end if;
  v_name := public._pet_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), public._pet_species_name(p_species)));
  perform public._wallet_lock(v_account);
  if (select count(*) from public.pets where account_id = v_account) >= 6 then
    raise exception 'too many pets' using errcode = '53400';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_price, 'pet_buy', 'pet: ' || p_species || '/' || p_variant);
  insert into public.pets (account_id, species, variant, name) values (v_account, p_species, p_variant, v_name)
  returning id into v_id;
  insert into public.pet_owner (account_id, active_pet) values (v_account, v_id)
  on conflict (account_id) do update set active_pet = coalesce(public.pet_owner.active_pet, excluded.active_pet);
  return public._pets_state(v_account) || jsonb_build_object('coins', v_bal, 'pet_id', v_id);
end $$;

-- Buy food (1–20 at a time) or a toy / a fashion item (once).
create or replace function public.pet_buy_item(p_session_token text, p_item text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); c public.pet_item_catalog; v_coins int; v_bal int;
        v_qty int := coalesce(p_qty, 1);
begin
  select * into c from public.pet_item_catalog where id = p_item;
  if not found then raise exception 'unknown item' using errcode = '22023'; end if;
  if c.kind <> 'food' then v_qty := 1; end if;
  if v_qty < 1 or v_qty > 20 then raise exception 'bad qty' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  if c.kind <> 'food' and exists (select 1 from public.pet_items where account_id = v_account and item_id = p_item and qty > 0) then
    raise exception 'already owned' using errcode = '22023';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < c.price * v_qty then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -(c.price * v_qty), 'pet_buy', 'pet item: ' || p_item || ' x' || v_qty);
  insert into public.pet_items (account_id, item_id, qty) values (v_account, p_item, v_qty)
  on conflict (account_id, item_id) do update set qty = public.pet_items.qty + excluded.qty;
  return public._pets_state(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- One meal of the species' food: +40 no, +5 vui (a sulking pet stops sulking).
create or replace function public.pet_feed(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); p public.pets;
begin
  p := public._pet_mine(v_account, p_pet);
  update public.pet_items set qty = qty - 1
   where account_id = v_account and item_id = 'food_' || p.species and qty > 0;
  if not found then raise exception 'no food' using errcode = '53400'; end if;
  update public.pets set fullness = least(100, p.fullness + 40), happy = least(100, p.happy + 5), stats_at = now()
   where id = p.id;
  return public._pets_state(v_account);
end $$;

-- Play with the species' toy: +25 vui, once per 10 min per pet. Not while sulking.
create or replace function public.pet_play(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); p public.pets;
begin
  p := public._pet_mine(v_account, p_pet);
  if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
  if not exists (select 1 from public.pet_items i join public.pet_item_catalog c on c.id = i.item_id
                  where i.account_id = v_account and i.qty > 0 and c.kind = 'toy' and c.species = p.species) then
    raise exception 'no toy' using errcode = '53400';
  end if;
  if p.played_at > now() - interval '10 minutes' then raise exception 'too soon' using errcode = '53400'; end if;
  update public.pets set fullness = p.fullness, happy = least(100, p.happy + 25), stats_at = now(), played_at = now()
   where id = p.id;
  return public._pets_state(v_account);
end $$;

-- Take a pet out (it follows) or, with null, leave the active one in the shop. A sulking pet will not come.
create or replace function public.pet_set_active(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); p public.pets;
begin
  if p_pet is not null then
    p := public._pet_mine(v_account, p_pet);
    if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
  end if;
  insert into public.pet_owner (account_id, active_pet) values (v_account, p_pet)
  on conflict (account_id) do update set active_pet = excluded.active_pet;
  return public._pets_state(v_account);
end $$;

create or replace function public.pet_rename(p_session_token text, p_pet bigint, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); p public.pets; v_name text;
begin
  v_name := public._pet_name(p_name);
  p := public._pet_mine(v_account, p_pet);
  update public.pets set name = v_name where id = p.id;
  return public._pets_state(v_account);
end $$;

-- Put an owned fashion item of the pet's species on its slot, or clear the slot (null item).
create or replace function public.pet_equip(p_session_token text, p_pet bigint, p_slot text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); p public.pets; c public.pet_item_catalog;
begin
  if p_slot is null or p_slot not in ('head','neck','body') then raise exception 'unknown slot' using errcode = '22023'; end if;
  p := public._pet_mine(v_account, p_pet);
  if p_item is not null then
    select * into c from public.pet_item_catalog where id = p_item;
    if not found then raise exception 'unknown item' using errcode = '22023'; end if;
    if c.kind <> p_slot or c.species <> p.species then raise exception 'wrong species' using errcode = '22023'; end if;
    if not exists (select 1 from public.pet_items where account_id = v_account and item_id = p_item and qty > 0) then
      raise exception 'not owned' using errcode = '22023';
    end if;
  end if;
  update public.pets set head = case when p_slot = 'head' then p_item else head end,
                         neck = case when p_slot = 'neck' then p_item else neck end,
                         body = case when p_slot = 'body' then p_item else body end
   where id = p.id;
  return public._pets_state(v_account);
end $$;

-- The client's minute heartbeat while in game mode. A following, happy (vui > 50) sóc finds 5–30 xu once per 10 min,
-- at most 300 xu per Vietnam day. The answer carries `found` (0 = nothing this time).
create or replace function public.pet_tick(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); p public.pets; o public.pet_owner;
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_n int := 0; v_done int; v_bal int;
begin
  p := public._pet_following(v_account);
  if p.id is not null and p.species = 'soc' and p.happy > 50 then
    select * into o from public.pet_owner where account_id = v_account for update;
    v_done := case when o.forage_day = v_today then o.forage_today else 0 end;
    if (o.forage_at is null or o.forage_at <= now() - interval '10 minutes') and v_done < 300 then
      v_n := least(300 - v_done, 5 + floor(random() * 26)::int);
      perform public._wallet_lock(v_account);
      v_bal := public._pay(v_account, v_n, 'pet_find', 'soc');
      update public.pet_owner set forage_at = now(), forage_day = v_today, forage_today = v_done + v_n
       where account_id = v_account;
    end if;
  end if;
  return public._pets_state(v_account) || jsonb_build_object('found', v_n)
         || case when v_bal is not null then jsonb_build_object('coins', v_bal) else '{}'::jsonb end;
end $$;

revoke all on function public.pets_state(text) from public;
revoke all on function public.pet_buy(text, text, text, text) from public;
revoke all on function public.pet_buy_item(text, text, integer) from public;
revoke all on function public.pet_feed(text, bigint) from public;
revoke all on function public.pet_play(text, bigint) from public;
revoke all on function public.pet_set_active(text, bigint) from public;
revoke all on function public.pet_rename(text, bigint, text) from public;
revoke all on function public.pet_equip(text, bigint, text, text) from public;
revoke all on function public.pet_tick(text) from public;
grant execute on function public.pets_state(text) to anon, authenticated;
grant execute on function public.pet_buy(text, text, text, text) to anon, authenticated;
grant execute on function public.pet_buy_item(text, text, integer) to anon, authenticated;
grant execute on function public.pet_feed(text, bigint) to anon, authenticated;
grant execute on function public.pet_play(text, bigint) to anon, authenticated;
grant execute on function public.pet_set_active(text, bigint) to anon, authenticated;
grant execute on function public.pet_rename(text, bigint, text) to anon, authenticated;
grant execute on function public.pet_equip(text, bigint, text, text) to anon, authenticated;
grant execute on function public.pet_tick(text) to anon, authenticated;

-- ---------- F. The mèo ----------
-- _vitals_apply (0030's 2-argument body) with a hunger-rate factor as well; v18.12 changes only the hr line. The 1- and
-- 2-argument versions stay as they were.
create or replace function public._vitals_apply(p_account uuid, p_thirst numeric, p_hunger numeric) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400 * greatest(coalesce(p_hunger, 1), 0.1);          -- v18.12: × hunger
  tr constant numeric := 100.0 / 57600 * greatest(coalesce(p_thirst, 1), 0.1);         -- v18.8: × thirst
  dt numeric; zh numeric; zt numeric; nh numeric; nt numeric;
begin
  insert into public.vitals(account_id) values (p_account) on conflict do nothing;
  select * into v from public.vitals where account_id = p_account for update;
  if v.fainted_until is not null then
    if v.fainted_until <= now() then
      v.fainted_until := null; v.hunger := 30; v.thirst := 30; v.starve_s := 0;
    end if;
  else
    dt := least(120, greatest(0, extract(epoch from now() - v.last_tick)));
    if dt > 0 then
      nh := greatest(0, v.hunger - dt * hr);
      nt := greatest(0, v.thirst - dt * tr);
      zh := case when v.hunger <= 0 then dt else greatest(0, dt - v.hunger / hr) end;
      zt := case when v.thirst <= 0 then dt else greatest(0, dt - v.thirst / tr) end;
      v.starve_s := case when nh > 0 and nt > 0 then 0 else v.starve_s + greatest(zh, zt) end;
      v.hunger := nh; v.thirst := nt;
      if v.starve_s >= 600 then
        v.fainted_until := now() + interval '10 seconds'; v.starve_s := 0;
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account;
  return v;
end; $$;
revoke all on function public._vitals_apply(uuid, numeric, numeric) from public, anon, authenticated;

-- The owner's drain factor from a following, happy (vui > 50) mèo: 0.9; else 1.
create or replace function public._pet_cat_factor(p_account uuid) returns numeric
language plpgsql stable security definer set search_path = public, extensions
as $$
declare p public.pets;
begin
  p := public._pet_following(p_account);
  return case when p.id is not null and p.species = 'meo' and p.happy > 50 then 0.9 else 1 end;
end $$;
revoke all on function public._pet_cat_factor(uuid) from public, anon, authenticated;

-- vitals_tick: 0033's body; v18.12 multiplies the hunger and the thirst drain by the cat factor.
create or replace function public.vitals_tick(p_session_token text, p_room_id uuid, p_map text default null,
                                              p_x integer default null, p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
        v_member boolean; h public.heat_state; w public.room_weather; v_out boolean; v_hot boolean;   -- v18.10
        v_since timestamptz; v_fainted boolean; v_vit public.vitals;                                   -- v18.10
        v_cat numeric := public._pet_cat_factor(v_account);                                             -- v18.12
begin
  v_member := p_room_id is not null
              and exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = v_account);
  h := public._heat_resolve(v_account);                                                  -- v18.10: drowning
  v_fainted := coalesce((select fainted_until > now() from public.vitals where account_id = v_account), false);
  if v_member then w := public._room_weather(p_room_id); end if;
  v_hot := v_member and w.updated_at is not null and public._heat_hot(w.kind, w.is_day, w.temp_c);
  -- a swimmer who reports a spot out of the pond's water (a reload mid-swim, another map) is not swimming any more
  if h.swimming and h.cramp_until is null and p_map is not null and p_x is not null and p_y is not null
     and not (p_map = 'pond' and public._pond_in(p_x, p_y, 6)) then
    update public.heat_state set swimming = false, swim_room = null where account_id = v_account returning * into h;
  end if;
  v_out := not public._in_shade(p_map, p_x, p_y) and not h.swimming and h.cramp_until is null and not v_fainted;
  if v_hot and v_out and not coalesce(h.immune_until > now(), false) then
    v_since := case when h.outdoor_since is null or h.last_seen is null or h.last_seen < now() - interval '120 seconds'
                    then now() else h.outdoor_since end;
  end if;
  update public.heat_state set outdoor_since = v_since,
    shocked = v_since is not null and v_since <= now() - interval '10 minutes', last_seen = now()
   where account_id = v_account returning * into h;
  v_vit := public._vitals_apply(v_account,
    (case when v_member then (public._room_effects(p_room_id)->>'thirst')::numeric else 1 end)
    * case when h.shocked then 2 else 1 end                                              -- v18.10: ×2 heat-shocked
    * v_cat,                                                                             -- v18.12: the mèo
    v_cat);                                                                              -- v18.12: the mèo
  return public._vitals_json(v_vit) || jsonb_build_object('heat', public._heat_json(h));
end; $$;
revoke all on function public.vitals_tick(text, uuid, text, integer, integer) from public;
grant execute on function public.vitals_tick(text, uuid, text, integer, integer) to anon, authenticated;
