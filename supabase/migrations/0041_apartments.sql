-- =========================================================
-- 0041_apartments.sql — v19.2 Khu nhà + chung cư + nội thất (docs/superpowers/plans/2026-09-27-v19-2-apartments.md,
-- spec docs/superpowers/specs/2026-09-27-v19-housing-design.md §19.2).
-- ADDITIVE and re-runnable. Run after 0040.
--   A. Rules: _apt_price (lib/game/housing/apartment.ts mirrors them; tests/unit/apartment-sql.test.ts pins them).
--   B. furniture_catalog (+ rows), apartments (12 units), furniture_items (storage when apt_no is null), apt_guests,
--      apt_knocks, fridge_fish, apt_tv.
--   C. Helpers: the lazy sweep of lapsed rents, who may enter, the JSON shapes.
--   D. RPCs: the block (list, rent, buy, move out, visibility, knock, admit, enter), furniture (buy, place, pick up,
--      surfaces), the fridge, home_sleep, the TV.
--   E. _in_shade (0033 + 'khu_nha' as a known map: outdoors everywhere; interiors stay unlisted → shaded).
--   F. _ac_wipe (0019 verbatim + the v19.2 lines).
--   G. The ledger: 0039's 32 reasons + 'apartment', 'apartment_sell', 'furniture': 35.
-- =========================================================

-- ---------- A. Rules ----------
-- Rent (30 days), buy (the list price), and what the city pays back for a bought unit (70 % of the list).
create or replace function public._apt_price(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what when 'rent' then 1500 when 'buy' then 25000 when 'sell' then 17500 end $$;
revoke all on function public._apt_price(text) from public, anon, authenticated;

create or replace function public._apt_ms(p_at timestamptz) returns bigint
language sql immutable set search_path = public, extensions
as $$ select (extract(epoch from p_at) * 1000)::bigint $$;
revoke all on function public._apt_ms(timestamptz) from public, anon, authenticated;

-- ---------- B. Tables ----------
create table if not exists public.furniture_catalog (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('bed','table','chair','sofa','lamp','plant','rug','shelf','tv','fridge','wall','floor')),
  style text not null check (style in ('go','hien_dai','may_tre')),
  w smallint not null check (w between 0 and 4),
  h smallint not null check (h between 0 and 4),
  price integer not null check (price > 0),
  cap integer not null default 0 check (cap >= 0)      -- a fridge's slots
);
alter table public.furniture_catalog enable row level security;
revoke all on public.furniture_catalog from anon, authenticated;
insert into public.furniture_catalog (id, name, kind, style, w, h, price, cap) values
  ('bed_go', 'Giường gỗ', 'bed', 'go', 2, 3, 1200, 0),
  ('bed_hiendai', 'Giường hiện đại', 'bed', 'hien_dai', 2, 3, 1800, 0),
  ('bed_maytre', 'Giường mây', 'bed', 'may_tre', 2, 3, 1000, 0),
  ('table_go', 'Bàn gỗ', 'table', 'go', 2, 2, 400, 0),
  ('table_hiendai', 'Bàn kính', 'table', 'hien_dai', 2, 1, 500, 0),
  ('table_maytre', 'Bàn trà mây', 'table', 'may_tre', 2, 2, 350, 0),
  ('chair_go', 'Ghế gỗ', 'chair', 'go', 1, 1, 150, 0),
  ('chair_hiendai', 'Ghế bành', 'chair', 'hien_dai', 1, 1, 220, 0),
  ('chair_maytre', 'Ghế mây', 'chair', 'may_tre', 1, 1, 120, 0),
  ('sofa_go', 'Trường kỷ', 'sofa', 'go', 3, 1, 800, 0),
  ('sofa_hiendai', 'Sofa nỉ', 'sofa', 'hien_dai', 3, 1, 950, 0),
  ('lamp_go', 'Đèn dầu', 'lamp', 'go', 1, 1, 150, 0),
  ('lamp_hiendai', 'Đèn cây', 'lamp', 'hien_dai', 1, 1, 250, 0),
  ('lamp_maytre', 'Đèn lồng tre', 'lamp', 'may_tre', 1, 1, 180, 0),
  ('plant_mai', 'Chậu mai', 'plant', 'go', 1, 1, 300, 0),
  ('plant_trau', 'Cây trầu bà', 'plant', 'hien_dai', 1, 1, 200, 0),
  ('plant_tre', 'Tre cảnh', 'plant', 'may_tre', 1, 1, 200, 0),
  ('rug_do', 'Thảm đỏ', 'rug', 'hien_dai', 3, 2, 250, 0),
  ('rug_xanh', 'Thảm xanh', 'rug', 'hien_dai', 3, 2, 250, 0),
  ('rug_chieu', 'Chiếu cói', 'rug', 'may_tre', 3, 2, 150, 0),
  ('shelf_go', 'Kệ sách gỗ', 'shelf', 'go', 2, 1, 350, 0),
  ('shelf_hiendai', 'Kệ trắng', 'shelf', 'hien_dai', 2, 1, 450, 0),
  ('tv', 'Tivi', 'tv', 'hien_dai', 2, 1, 3000, 0),
  ('fridge', 'Tủ lạnh nhỏ', 'fridge', 'hien_dai', 1, 1, 2500, 20),
  ('fridge_big', 'Tủ lạnh lớn', 'fridge', 'hien_dai', 2, 1, 6000, 50),
  ('wall_kem', 'Sơn tường kem', 'wall', 'hien_dai', 0, 0, 300, 0),
  ('wall_xanh', 'Giấy dán tường xanh', 'wall', 'hien_dai', 0, 0, 300, 0),
  ('wall_hong', 'Giấy dán tường hồng', 'wall', 'hien_dai', 0, 0, 300, 0),
  ('wall_go', 'Ốp tường gỗ', 'wall', 'go', 0, 0, 400, 0),
  ('floor_gach', 'Sàn gạch bông', 'floor', 'go', 0, 0, 300, 0),
  ('floor_go', 'Sàn gỗ', 'floor', 'go', 0, 0, 400, 0),
  ('floor_da', 'Sàn đá hoa', 'floor', 'hien_dai', 0, 0, 400, 0)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, style = excluded.style, w = excluded.w,
  h = excluded.h, price = excluded.price, cap = excluded.cap;

create table if not exists public.apartments (
  no smallint primary key check (no between 1 and 12),
  owner_id uuid unique references public.accounts(id) on delete set null,
  tenure text check (tenure in ('rent','own')),
  paid_until timestamptz,                               -- rent: paid until then (a 7-day grace follows)
  visibility text not null default 'private' check (visibility in ('private','room','open')),
  wall text references public.furniture_catalog(id),
  floor text references public.furniture_catalog(id),
  since timestamptz
);
alter table public.apartments enable row level security;
revoke all on public.apartments from anon, authenticated;
insert into public.apartments (no) select g from generate_series(1, 12) g on conflict (no) do nothing;

create table if not exists public.furniture_items (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.furniture_catalog(id),
  apt_no smallint references public.apartments(no),     -- null: in storage
  x smallint, y smallint,
  rot smallint not null default 0 check (rot between 0 and 3),
  created_at timestamptz not null default now()
);
create index if not exists idx_furniture_items_account on public.furniture_items (account_id);
create index if not exists idx_furniture_items_apt on public.furniture_items (apt_no);
alter table public.furniture_items enable row level security;
revoke all on public.furniture_items from anon, authenticated;

create table if not exists public.apt_guests (
  apt_no smallint not null references public.apartments(no),
  account_id uuid not null references public.accounts(id) on delete cascade,
  until timestamptz not null,
  primary key (apt_no, account_id)
);
alter table public.apt_guests enable row level security;
revoke all on public.apt_guests from anon, authenticated;

create table if not exists public.apt_knocks (
  apt_no smallint not null references public.apartments(no),
  account_id uuid not null references public.accounts(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (apt_no, account_id)
);
alter table public.apt_knocks enable row level security;
revoke all on public.apt_knocks from anon, authenticated;

create table if not exists public.fridge_fish (
  id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null check (weight_g > 0),
  price integer not null check (price > 0),
  caught_at timestamptz not null,
  stored_at timestamptz not null default now()
);
create index if not exists idx_fridge_fish_account on public.fridge_fish (account_id, stored_at);
alter table public.fridge_fish enable row level security;
revoke all on public.fridge_fish from anon, authenticated;

create table if not exists public.apt_tv (
  apt_no smallint primary key references public.apartments(no),
  queue jsonb not null default '[]'::jsonb,
  current jsonb,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.apt_tv enable row level security;
revoke all on public.apt_tv from anon, authenticated;

-- ---------- C. Helpers ----------
-- Free every unit whose rent lapsed more than 7 days ago (or whose owner is gone): the furniture goes back to storage.
create or replace function public._apt_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_nos smallint[];
begin
  select coalesce(array_agg(no), '{}') into v_nos from public.apartments
   where tenure is not null and (owner_id is null or (tenure = 'rent' and paid_until + interval '7 days' <= now()));
  if cardinality(v_nos) = 0 then return; end if;
  update public.furniture_items set apt_no = null, x = null, y = null, rot = 0 where apt_no = any(v_nos);
  delete from public.apt_guests where apt_no = any(v_nos);
  delete from public.apt_knocks where apt_no = any(v_nos);
  delete from public.apt_tv where apt_no = any(v_nos);
  update public.apartments set owner_id = null, tenure = null, paid_until = null, visibility = 'private', wall = null,
         floor = null, since = null
   where no = any(v_nos);
end $$;
revoke all on function public._apt_sweep() from public, anon, authenticated;

-- My unit while it is lived in (bought, or the rent is paid), else null.
create or replace function public._apt_home(p_account uuid) returns smallint
language sql stable security definer set search_path = public, extensions
as $$
  select no from public.apartments where owner_id = p_account and (tenure = 'own' or paid_until > now())
$$;
revoke all on function public._apt_home(uuid) from public, anon, authenticated;

-- My active home, or the refusal: 'rent due' in the grace, 'no home' without one.
create or replace function public._apt_need_home(p_account uuid) returns smallint
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v smallint := public._apt_home(p_account);
begin
  if v is not null then return v; end if;
  if exists (select 1 from public.apartments where owner_id = p_account) then
    raise exception 'rent due' using errcode = '53400';
  end if;
  raise exception 'no home' using errcode = '53400';
end $$;
revoke all on function public._apt_need_home(uuid) from public, anon, authenticated;

-- May p_account enter unit p_no from music room p_room? The owner; anyone when open; members of that room (the owner
-- one too) when 'room'; a guest let in after a knock.
create or replace function public._apt_can_enter(p_account uuid, p_room uuid, p_no smallint) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.apartments a
     where a.no = p_no and a.owner_id is not null and (a.tenure = 'own' or a.paid_until > now())
       and (a.owner_id = p_account or a.visibility = 'open'
            or (a.visibility = 'room'
                and exists (select 1 from public.members m where m.room_id = p_room and m.account_id = a.owner_id)
                and exists (select 1 from public.members m where m.room_id = p_room and m.account_id = p_account))
            or exists (select 1 from public.apt_guests g where g.apt_no = a.no and g.account_id = p_account and g.until > now())))
$$;
revoke all on function public._apt_can_enter(uuid, uuid, smallint) from public, anon, authenticated;

create or replace function public._apt_list_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'units', (select jsonb_agg(jsonb_build_object(
                'no', a.no, 'status', case when a.owner_id is null then 'free' else a.tenure end, 'owner_name', acc.username,
                'visibility', a.visibility, 'mine', coalesce(a.owner_id = p_account, false)) order by a.no)
                from public.apartments a left join public.accounts acc on acc.id = a.owner_id),
    'mine', (select jsonb_build_object('no', a.no, 'tenure', a.tenure, 'paid_until_ms', public._apt_ms(a.paid_until),
                'grace_until_ms', public._apt_ms(a.paid_until + interval '7 days'), 'visibility', a.visibility,
                'wall', a.wall, 'floor', a.floor)
               from public.apartments a where a.owner_id = p_account),
    'storage', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'item', f.item_id) order by f.id)
                           from public.furniture_items f where f.account_id = p_account and f.apt_no is null), '[]'::jsonb),
    'knocks', coalesce((select jsonb_agg(jsonb_build_object('account_id', k.account_id, 'name', acc.username,
                                                            'at_ms', public._apt_ms(k.at)) order by k.at)
                          from public.apt_knocks k join public.apartments a on a.no = k.apt_no
                          join public.accounts acc on acc.id = k.account_id
                         where a.owner_id = p_account and k.at > now() - interval '10 minutes'), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._apt_list_json(uuid) from public, anon, authenticated;

create or replace function public._apt_layout(p_no smallint, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'no', a.no, 'owner_id', a.owner_id, 'owner_name', acc.username, 'can_edit', a.owner_id = p_viewer,
    'visibility', a.visibility, 'wall', a.wall, 'floor', a.floor,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'item', f.item_id, 'x', f.x, 'y', f.y, 'rot', f.rot) order by f.id)
                         from public.furniture_items f where f.apt_no = a.no), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
  from public.apartments a join public.accounts acc on acc.id = a.owner_id where a.no = p_no
$$;
revoke all on function public._apt_layout(smallint, uuid) from public, anon, authenticated;

-- The fridge: its slots are the placed fridges' in my active home.
create or replace function public._fridge_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(sum(c.cap), 0)::int from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
   where f.account_id = p_account and f.apt_no = public._apt_home(p_account) and c.kind = 'fridge'
$$;
revoke all on function public._fridge_cap(uuid) from public, anon, authenticated;

create or replace function public._fridge_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'cap', public._fridge_cap(p_account),
    'bag', (select count(*) from public.fish where account_id = p_account),
    'bag_cap', 1 + public._bucket_cap(p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'species_id', f.species_id, 'weight_g', f.weight_g,
                                                          'price', f.price) order by f.stored_at, f.id)
                        from public.fridge_fish f where f.account_id = p_account), '[]'::jsonb))
$$;
revoke all on function public._fridge_json(uuid) from public, anon, authenticated;

create or replace function public._tv_json(p_no smallint) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'current', (select t.current from public.apt_tv t where t.apt_no = p_no),
    'queue', coalesce((select t.queue from public.apt_tv t where t.apt_no = p_no), '[]'::jsonb),
    'started_at_ms', (select public._apt_ms(t.started_at) from public.apt_tv t where t.apt_no = p_no),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._tv_json(smallint) from public, anon, authenticated;

-- Play the next queued track (or stop when none). The caller holds the row lock.
create or replace function public._tv_advance(p_no smallint) returns void
language sql security definer set search_path = public, extensions
as $$
  update public.apt_tv set
    current = case when jsonb_array_length(queue) > 0 then queue->0 end,
    started_at = case when jsonb_array_length(queue) > 0 then now() end,
    queue = case when jsonb_array_length(queue) > 0 then queue - 0 else '[]'::jsonb end,
    updated_at = now()
  where apt_no = p_no
$$;
revoke all on function public._tv_advance(smallint) from public, anon, authenticated;

-- Inside the unit (it may be entered) and a TV is placed.
create or replace function public._tv_guard(p_account uuid, p_room uuid, p_no smallint) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public._apt_can_enter(p_account, p_room, p_no) then raise exception 'no access' using errcode = '42501'; end if;
  if not exists (select 1 from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
                  where f.apt_no = p_no and c.kind = 'tv') then
    raise exception 'no tv' using errcode = '53400';
  end if;
end $$;
revoke all on function public._tv_guard(uuid, uuid, smallint) from public, anon, authenticated;

-- ---------- G. The ledger ----------
-- The 32 reasons in force after 0039 plus 'apartment', 'apartment_sell', 'furniture': 35.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture'));

-- ---------- D. RPCs: the block ----------
create or replace function public.apt_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._apt_sweep();
  return public._apt_list_json(v_account);
end $$;

-- Rent unit p_no (or extend my rent of it): 30 days after my current end (from now when none), at most 60 days ahead.
create or replace function public.apt_rent(p_session_token text, p_no integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); a public.apartments; v_until timestamptz; v_coins int; v_bal int;
begin
  perform public._apt_sweep();
  perform public._wallet_lock(v_account);
  select * into a from public.apartments where no = p_no for update;
  if not found then raise exception 'unknown unit' using errcode = '22023'; end if;
  if a.owner_id is not null and a.owner_id <> v_account then raise exception 'taken' using errcode = '53400'; end if;
  if a.tenure = 'own' or (a.owner_id is null and exists (select 1 from public.apartments where owner_id = v_account)) then
    raise exception 'already have a home' using errcode = '53400';
  end if;
  v_until := greatest(now(), coalesce(a.paid_until, now())) + interval '30 days';
  if v_until > now() + interval '60 days' then raise exception 'too far ahead' using errcode = '53400'; end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < public._apt_price('rent') then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -public._apt_price('rent'), 'apartment', 'apartment #' || p_no || ': rent');
  update public.apartments set owner_id = v_account, tenure = 'rent', paid_until = v_until, since = coalesce(since, now())
   where no = p_no;
  return public._apt_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Buy unit p_no at the list price (my rented unit too: the rest of the rent is not refunded).
create or replace function public.apt_buy(p_session_token text, p_no integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); a public.apartments; v_coins int; v_bal int;
begin
  perform public._apt_sweep();
  perform public._wallet_lock(v_account);
  select * into a from public.apartments where no = p_no for update;
  if not found then raise exception 'unknown unit' using errcode = '22023'; end if;
  if a.owner_id is not null and a.owner_id <> v_account then raise exception 'taken' using errcode = '53400'; end if;
  if a.tenure = 'own' or (a.owner_id is null and exists (select 1 from public.apartments where owner_id = v_account)) then
    raise exception 'already have a home' using errcode = '53400';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < public._apt_price('buy') then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -public._apt_price('buy'), 'apartment', 'apartment #' || p_no || ': buy');
  update public.apartments set owner_id = v_account, tenure = 'own', paid_until = null, since = coalesce(since, now())
   where no = p_no;
  return public._apt_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Move out: a bought unit is sold back to the city for 70 % of the list; a rent just ends (no refund). The furniture goes
-- to storage.
create or replace function public.apt_move_out(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); a public.apartments; v_bal int;
begin
  perform public._apt_sweep();
  perform public._wallet_lock(v_account);
  select * into a from public.apartments where owner_id = v_account for update;
  if not found then raise exception 'no home' using errcode = '53400'; end if;
  if a.tenure = 'own' then
    v_bal := public._pay(v_account, public._apt_price('sell'), 'apartment_sell', 'apartment #' || a.no || ': sold back');
  end if;
  update public.apartments set owner_id = null where no = a.no;      -- the sweep frees it and stores the furniture
  perform public._apt_sweep();
  return public._apt_list_json(v_account)
      || case when v_bal is null then '{}'::jsonb else jsonb_build_object('coins', v_bal) end;
end $$;

create or replace function public.apt_set_visibility(p_session_token text, p_visibility text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  if p_visibility is null or p_visibility not in ('private','room','open') then
    raise exception 'bad visibility' using errcode = '22023';
  end if;
  update public.apartments set visibility = p_visibility where owner_id = v_account;
  if not found then raise exception 'no home' using errcode = '53400'; end if;
  return public._apt_list_json(v_account);
end $$;

-- Knock on unit p_no: the owner sees it (for 10 minutes) and may let me in. True when I may already enter.
create or replace function public.apt_knock(p_session_token text, p_room_id uuid, p_no integer) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._apt_sweep();
  if not exists (select 1 from public.apartments where no = p_no and owner_id is not null and (tenure = 'own' or paid_until > now())) then
    raise exception 'vacant' using errcode = '53400';
  end if;
  if public._apt_can_enter(v_account, p_room_id, p_no::smallint) then return true; end if;
  insert into public.apt_knocks (apt_no, account_id, at) values (p_no, v_account, now())
  on conflict (apt_no, account_id) do update set at = now();
  return true;
end $$;

-- The owner answers a knock (or revokes a pass): yes lets them in for 3 h, no clears the knock and any pass.
create or replace function public.apt_admit(p_session_token text, p_account uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint := public._apt_need_home(v_account);
begin
  delete from public.apt_knocks where apt_no = v_no and account_id = p_account;
  if coalesce(p_accept, false) and p_account <> v_account then
    insert into public.apt_guests (apt_no, account_id, until) values (v_no, p_account, now() + interval '3 hours')
    on conflict (apt_no, account_id) do update set until = excluded.until;
  else
    delete from public.apt_guests where apt_no = v_no and account_id = p_account;
  end if;
  return public._apt_list_json(v_account);
end $$;

-- Enter unit p_no from music room p_room_id: its layout (who may edit, the surfaces, the furniture as placed).
create or replace function public.apt_enter(p_session_token text, p_room_id uuid, p_no integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); a public.apartments;
begin
  perform public._apt_sweep();
  select * into a from public.apartments where no = p_no;
  if not found then raise exception 'unknown unit' using errcode = '22023'; end if;
  if a.owner_id is null then raise exception 'vacant' using errcode = '53400'; end if;
  if not (a.tenure = 'own' or a.paid_until > now()) then
    if a.owner_id = v_account then raise exception 'rent due' using errcode = '53400'; end if;
    raise exception 'vacant' using errcode = '53400';
  end if;
  if not public._apt_can_enter(v_account, p_room_id, p_no::smallint) then raise exception 'no access' using errcode = '42501'; end if;
  return public._apt_layout(p_no::smallint, v_account);
end $$;

-- ---------- D. RPCs: furniture ----------
-- Buy an item from cô Năm: it goes to my storage (a home is not needed).
create or replace function public.furniture_buy(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); c public.furniture_catalog; v_coins int; v_bal int;
begin
  select * into c from public.furniture_catalog where id = p_item;
  if not found then raise exception 'unknown item' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < c.price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -c.price, 'furniture', 'furniture: ' || c.id);
  insert into public.furniture_items (account_id, item_id) values (v_account, c.id);
  return public._apt_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Place (or move, or turn) one of my items in my home: inside the floor (not the wall rows), off the door and the cells
-- above it, not over another item (rugs only collide with rugs), at most 60 items.
create or replace function public.furniture_place(p_session_token text, p_id bigint, p_x integer, p_y integer, p_rot integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint := public._apt_need_home(v_account);
        f public.furniture_items; c public.furniture_catalog; v_w int; v_h int; v_rug boolean;
begin
  perform 1 from public.apartments where no = v_no for update;     -- one placement at a time per home
  select * into f from public.furniture_items where id = p_id and account_id = v_account for update;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  select * into c from public.furniture_catalog where id = f.item_id;
  if c.kind in ('wall','floor') then raise exception 'not placeable' using errcode = '22023'; end if;
  if p_x is null or p_y is null or p_rot is null or p_rot not between 0 and 3 then raise exception 'bounds' using errcode = '22023'; end if;
  v_w := case when p_rot % 2 = 0 then c.w else c.h end;
  v_h := case when p_rot % 2 = 0 then c.h else c.w end;
  if p_x < 0 or p_y < 2 or p_x + v_w > 14 or p_y + v_h > 10 then raise exception 'bounds' using errcode = '22023'; end if;
  if p_x < 8 and 6 < p_x + v_w and 8 < p_y + v_h then raise exception 'door' using errcode = '22023'; end if;
  if f.apt_no is distinct from v_no and (select count(*) from public.furniture_items where apt_no = v_no) >= 60 then
    raise exception 'too many' using errcode = '53400';
  end if;
  v_rug := c.kind = 'rug';
  if exists (select 1 from public.furniture_items o join public.furniture_catalog oc on oc.id = o.item_id
              where o.apt_no = v_no and o.id <> p_id and (oc.kind = 'rug') = v_rug
                and o.x < p_x + v_w and p_x < o.x + (case when o.rot % 2 = 0 then oc.w else oc.h end)
                and o.y < p_y + v_h and p_y < o.y + (case when o.rot % 2 = 0 then oc.h else oc.w end)) then
    raise exception 'overlap' using errcode = '22023';
  end if;
  update public.furniture_items set apt_no = v_no, x = p_x, y = p_y, rot = p_rot where id = p_id;
  return public._apt_layout(v_no, v_account);
end $$;

create or replace function public.furniture_pickup(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint := public._apt_need_home(v_account);
begin
  update public.furniture_items set apt_no = null, x = null, y = null, rot = 0
   where id = p_id and account_id = v_account and apt_no = v_no;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  return public._apt_layout(v_no, v_account);
end $$;

-- Apply a wallpaper or a floor I own (null: back to the plain one). Surfaces are not used up.
create or replace function public.apt_set_surface(p_session_token text, p_kind text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint := public._apt_need_home(v_account);
begin
  if p_kind is null or p_kind not in ('wall','floor') then raise exception 'bad surface' using errcode = '22023'; end if;
  if p_item is not null and not exists (
       select 1 from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
        where f.account_id = v_account and f.item_id = p_item and c.kind = p_kind) then
    raise exception 'not owned' using errcode = '42501';
  end if;
  if p_kind = 'wall' then update public.apartments set wall = p_item where no = v_no;
  else update public.apartments set floor = p_item where no = v_no; end if;
  return public._apt_layout(v_no, v_account);
end $$;

-- ---------- D. RPCs: the fridge ----------
create or replace function public.fridge_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._fridge_json(public._auth_account(p_session_token));
end $$;

-- Bag → fridge: needs my active home with a placed fridge with a free slot. The fish keeps its id, weight and price.
create or replace function public.fish_move_to_fridge(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_cap int; r public.fish;
begin
  perform public._apt_need_home(v_account);
  perform public._wallet_lock(v_account);                          -- the account's lock for bag and fridge moves
  v_cap := public._fridge_cap(v_account);
  if v_cap = 0 then raise exception 'no fridge' using errcode = '53400'; end if;
  if (select count(*) from public.fridge_fish where account_id = v_account) >= v_cap then
    raise exception 'fridge full' using errcode = '53400';
  end if;
  delete from public.fish where id = p_fish_id and account_id = v_account returning * into r;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  insert into public.fridge_fish (id, account_id, species_id, weight_g, price, caught_at)
  values (r.id, v_account, r.species_id, r.weight_g, r.price, r.caught_at);
  return public._fridge_json(v_account);
end $$;

-- Fridge → bag: needs my active home and a free place in the bag (1 + the bucket's capacity, as when catching).
create or replace function public.fish_move_to_bag(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); r public.fridge_fish;
begin
  perform public._apt_need_home(v_account);
  perform public._wallet_lock(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    raise exception 'bag full' using errcode = '53400';
  end if;
  delete from public.fridge_fish where id = p_fish_id and account_id = v_account returning * into r;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  insert into public.fish (id, account_id, species_id, weight_g, price, caught_at)
  values (r.id, v_account, r.species_id, r.weight_g, r.price, r.caught_at);
  return public._fridge_json(v_account);
end $$;

-- ---------- D. RPCs: sleep at home ----------
-- 'motel' is motel_sleep; 'apt' needs my active home p_id with a placed bed. One sleep per Vietnam day either way.
create or replace function public.home_sleep(p_session_token text, p_kind text, p_id integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint;
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; r public.rest_state;
begin
  if p_kind = 'motel' then return public.motel_sleep(p_session_token); end if;
  if p_kind is distinct from 'apt' then raise exception 'unknown kind' using errcode = '22023'; end if;
  v_no := public._apt_need_home(v_account);
  if v_no is distinct from p_id then raise exception 'no home' using errcode = '53400'; end if;
  if not exists (select 1 from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
                  where f.apt_no = v_no and c.kind = 'bed') then
    raise exception 'no bed' using errcode = '53400';
  end if;
  if coalesce((select fainted_until > now() from public.vitals where account_id = v_account), false) then
    raise exception 'fainted' using errcode = '53400';
  end if;
  insert into public.rest_state (account_id) values (v_account) on conflict do nothing;
  select * into r from public.rest_state where account_id = v_account for update;
  if r.slept_day = v_today then raise exception 'already slept' using errcode = '53400'; end if;
  update public.rest_state set slept_day = v_today, slept_at = now(), buff_until = now() + interval '24 hours'
   where account_id = v_account;
  return public._motel_json(v_account);
end $$;

-- ---------- D. RPCs: the TV (the unit's own YouTube queue) ----------
create or replace function public.tv_state(p_session_token text, p_room_id uuid, p_no integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._tv_guard(v_account, p_room_id, p_no::smallint);
  return public._tv_json(p_no::smallint);
end $$;

-- Anyone inside adds a video: it plays at once when the TV is idle, else it is queued (at most 30).
create or replace function public.tv_add(p_session_token text, p_room_id uuid, p_no integer, p_video text, p_title text,
                                         p_duration integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); t public.apt_tv; v_item jsonb;
begin
  perform public._tv_guard(v_account, p_room_id, p_no::smallint);
  if p_video is null or p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'bad video' using errcode = '22023'; end if;
  insert into public.apt_tv (apt_no) values (p_no) on conflict (apt_no) do nothing;
  select * into t from public.apt_tv where apt_no = p_no for update;
  v_item := jsonb_build_object('id', gen_random_uuid()::text, 'v', p_video,
    't', left(coalesce(nullif(btrim(p_title), ''), p_video), 120),
    'by', (select username from public.accounts where id = v_account), 'by_id', v_account,
    'd', case when p_duration between 1 and 36000 then p_duration end);
  if t.current is null then
    update public.apt_tv set current = v_item, started_at = now(), updated_at = now() where apt_no = p_no;
  else
    if jsonb_array_length(t.queue) >= 30 then raise exception 'queue full' using errcode = '53400'; end if;
    update public.apt_tv set queue = queue || jsonb_build_array(v_item), updated_at = now() where apt_no = p_no;
  end if;
  return public._tv_json(p_no::smallint);
end $$;

-- A viewer's player finished track p_expect: play the next one. Ignored when it is no longer the current track, or when
-- its known length has not run yet (5 s slack), so nobody skips by "finishing" early.
create or replace function public.tv_next(p_session_token text, p_room_id uuid, p_no integer, p_expect text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); t public.apt_tv;
begin
  perform public._tv_guard(v_account, p_room_id, p_no::smallint);
  select * into t from public.apt_tv where apt_no = p_no for update;
  if found and t.current->>'id' = p_expect
     and (t.current->>'d' is null or now() >= t.started_at + make_interval(secs => (t.current->>'d')::int - 5)) then
    perform public._tv_advance(p_no::smallint);
  end if;
  return public._tv_json(p_no::smallint);
end $$;

-- The owner, or whoever added the current track, skips it.
create or replace function public.tv_skip(p_session_token text, p_room_id uuid, p_no integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); t public.apt_tv;
begin
  perform public._tv_guard(v_account, p_room_id, p_no::smallint);
  select * into t from public.apt_tv where apt_no = p_no for update;
  if found and t.current is not null then
    if v_account is distinct from (select owner_id from public.apartments where no = p_no)
       and t.current->>'by_id' is distinct from v_account::text then
      raise exception 'not yours' using errcode = '42501';
    end if;
    perform public._tv_advance(p_no::smallint);
  end if;
  return public._tv_json(p_no::smallint);
end $$;

-- ---------- E. The shade ----------
-- 0033's _in_shade with 'khu_nha' known (it has no porches: outdoors everywhere). Interior maps are not listed → shade.
create or replace function public._in_shade(p_map text, p_x integer, p_y integer) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select p_map is null or p_x is null or p_y is null or p_map not in ('hall', 'pond', 'field', 'market', 'khu_nha')
      or exists (select 1 from (values
           ('pond', 522, 64, 104, 90), ('pond', 522, 228, 104, 94),
           ('field', 588, 288, 84, 70), ('field', 700, 288, 88, 70),
           ('market', 100, 130, 80, 60), ('market', 460, 130, 80, 60), ('market', 244, 108, 152, 82),
           ('market', 640, 130, 80, 60), ('market', 40, 304, 80, 70), ('market', 680, 304, 80, 70)
         ) s(m, sx, sy, sw, sh)
         where s.m = p_map and p_x >= s.sx and p_x < s.sx + s.sw and p_y >= s.sy and p_y < s.sy + s.sh)
$$;
revoke all on function public._in_shade(text, integer, integer) from public, anon, authenticated;

-- ---------- F. The wipe ----------
-- 0019's _ac_wipe verbatim plus the v19.2 lines: the fridge's fish, the furniture and the home go too.
create or replace function public._ac_wipe(p_account uuid, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_snap jsonb; v_id bigint; v_coins integer;
begin
  perform public._card_forfeit_all(p_account);
  v_snap := public._ac_holdings(p_account);
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot)
  values (p_account, (select username from public.accounts where id = p_account), p_by, v_snap)
  returning id into v_id;
  select coins into v_coins from public.wallets where account_id = p_account;
  if found then
    insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, -v_coins, 0, 'wipe', 'wipe #' || v_id);
    delete from public.wallets where account_id = p_account;
  end if;
  delete from public.inventory where account_id = p_account;
  delete from public.casts where account_id = p_account;
  delete from public.fish where account_id = p_account;
  delete from public.fishing_profiles where account_id = p_account;
  delete from public.personal_bests where account_id = p_account;
  delete from public.rice_stock where account_id = p_account;
  delete from public.produce_stock where account_id = p_account;
  update public.farm_profiles set tank_item = null, tank_charges = 0 where account_id = p_account;
  delete from public.critters where account_id = p_account;                          -- v15.3
  delete from public.gather_cooldowns where account_id = p_account;                  -- v15.3
  delete from public.dogs where account_id = p_account;                              -- v17
  delete from public.rat_bag where account_id = p_account;                           -- v17
  delete from public.sling_aims where account_id = p_account;                        -- v17
  delete from public.fridge_fish where account_id = p_account;                       -- v19.2
  update public.apartments set owner_id = null where owner_id = p_account;           -- v19.2 (the sweep frees it)
  perform public._apt_sweep();                                                       -- v19.2
  delete from public.furniture_items where account_id = p_account;                   -- v19.2
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;

-- ---------- grants ----------
revoke all on function public.apt_list(text) from public;
revoke all on function public.apt_rent(text, integer) from public;
revoke all on function public.apt_buy(text, integer) from public;
revoke all on function public.apt_move_out(text) from public;
revoke all on function public.apt_set_visibility(text, text) from public;
revoke all on function public.apt_knock(text, uuid, integer) from public;
revoke all on function public.apt_admit(text, uuid, boolean) from public;
revoke all on function public.apt_enter(text, uuid, integer) from public;
revoke all on function public.furniture_buy(text, text) from public;
revoke all on function public.furniture_place(text, bigint, integer, integer, integer) from public;
revoke all on function public.furniture_pickup(text, bigint) from public;
revoke all on function public.apt_set_surface(text, text, text) from public;
revoke all on function public.fridge_state(text) from public;
revoke all on function public.fish_move_to_fridge(text, uuid) from public;
revoke all on function public.fish_move_to_bag(text, uuid) from public;
revoke all on function public.home_sleep(text, text, integer) from public;
revoke all on function public.tv_state(text, uuid, integer) from public;
revoke all on function public.tv_add(text, uuid, integer, text, text, integer) from public;
revoke all on function public.tv_next(text, uuid, integer, text) from public;
revoke all on function public.tv_skip(text, uuid, integer) from public;
grant execute on function public.apt_list(text) to anon, authenticated;
grant execute on function public.apt_rent(text, integer) to anon, authenticated;
grant execute on function public.apt_buy(text, integer) to anon, authenticated;
grant execute on function public.apt_move_out(text) to anon, authenticated;
grant execute on function public.apt_set_visibility(text, text) to anon, authenticated;
grant execute on function public.apt_knock(text, uuid, integer) to anon, authenticated;
grant execute on function public.apt_admit(text, uuid, boolean) to anon, authenticated;
grant execute on function public.apt_enter(text, uuid, integer) to anon, authenticated;
grant execute on function public.furniture_buy(text, text) to anon, authenticated;
grant execute on function public.furniture_place(text, bigint, integer, integer, integer) to anon, authenticated;
grant execute on function public.furniture_pickup(text, bigint) to anon, authenticated;
grant execute on function public.apt_set_surface(text, text, text) to anon, authenticated;
grant execute on function public.fridge_state(text) to anon, authenticated;
grant execute on function public.fish_move_to_fridge(text, uuid) to anon, authenticated;
grant execute on function public.fish_move_to_bag(text, uuid) to anon, authenticated;
grant execute on function public.home_sleep(text, text, integer) to anon, authenticated;
grant execute on function public.tv_state(text, uuid, integer) to anon, authenticated;
grant execute on function public.tv_add(text, uuid, integer, text, text, integer) to anon, authenticated;
grant execute on function public.tv_next(text, uuid, integer, text) to anon, authenticated;
grant execute on function public.tv_skip(text, uuid, integer) to anon, authenticated;
