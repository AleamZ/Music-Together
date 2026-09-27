-- =========================================================
-- 0042_houses.sql — v19.3 Đất + xây nhà + cho thuê phòng (docs/superpowers/plans/2026-09-27-v19-3-land.md,
-- spec docs/superpowers/specs/2026-09-27-v19-housing-design.md §19.3).
-- ADDITIVE and re-runnable. Run after 0041.
--   A. Rules: _house_price, _house_tile_price (lib/game/housing/house.ts mirrors them; tests/unit/house-sql.test.ts pins them).
--   B. house_lots (8 lots), house_room_rents, house_tenancies, furniture_items.lot_no.
--   C. Helpers: the design checks (_house_check, as checkDesign in TS), the build cost, where an item fits, the lazy
--      sweep (lapsed tenancies, repossessions), freeing a lot, who may enter or furnish, the JSON shapes, sleeping.
--   D. RPCs: the street (list, buy, upkeep, give back), the builder, the door, the surfaces, renting rooms, entering,
--      placing and picking up furniture.
--   E. Re-created from 0041 with the lines marked v19.3 (one home per account across flats, lots and rented rooms; a
--      fridge or a bed in a house): _apt_list_json, apt_rent, apt_buy, _fridge_cap, fish_move_to_fridge,
--      fish_move_to_bag, home_sleep.
--   F. _ac_wipe (0041 + the v19.3 line).
--   G. The ledger: 0041's 35 reasons + 6 house reasons: 41.
-- =========================================================

-- ---------- A. Rules ----------
-- The land (the first 30 days of upkeep included), the upkeep for 30 days, and what the city pays back (50 % of the land).
create or replace function public._house_price(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what when 'land' then 40000 when 'upkeep' then 500 when 'refund' then 20000 end $$;
revoke all on function public._house_price(text) from public, anon, authenticated;

-- The builder's price per cell: floor, wall, door, window (the yard is free).
create or replace function public._house_tile_price(p_cell text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_cell when 'f' then 10 when 'w' then 20 when 'd' then 150 when 'n' then 100 else 0 end $$;
revoke all on function public._house_tile_price(text) from public, anon, authenticated;

-- ---------- B. Tables ----------
create table if not exists public.house_lots (
  no smallint primary key check (no between 1 and 8),
  owner_id uuid unique references public.accounts(id) on delete set null,
  bought_at timestamptz,
  paid_until timestamptz,                               -- the upkeep is paid until then
  grid text check (grid is null or (length(grid) = 280 and grid ~ '^[.fwdn]*$')),   -- 20 × 14, row-major; null: bare land
  rooms smallint[],                                     -- each cell's room (1…6, 0 for the rest), from _house_check
  roof text not null default 'ngoi' check (roof in ('ngoi','tole','la','bang')),
  wall text references public.furniture_catalog(id),
  floor text references public.furniture_catalog(id),
  visibility text not null default 'private' check (visibility in ('private','room','open')),
  build_cost integer not null default 0 check (build_cost >= 0)
);
alter table public.house_lots enable row level security;
revoke all on public.house_lots from anon, authenticated;
insert into public.house_lots (no) select g from generate_series(1, 8) g on conflict (no) do nothing;

create table if not exists public.house_room_rents (
  lot_no smallint not null references public.house_lots(no),
  room_no smallint not null check (room_no between 1 and 6),
  price integer not null check (price between 300 and 5000),   -- xu per 30 days
  primary key (lot_no, room_no)
);
alter table public.house_room_rents enable row level security;
revoke all on public.house_room_rents from anon, authenticated;

create table if not exists public.house_tenancies (
  lot_no smallint not null references public.house_lots(no),
  room_no smallint not null check (room_no between 1 and 6),
  tenant_id uuid not null unique references public.accounts(id) on delete cascade,   -- one tenancy per account
  price integer not null check (price > 0),                                         -- the last 30 days' price
  paid_until timestamptz not null,
  since timestamptz not null default now(),
  primary key (lot_no, room_no)                                                     -- one tenant per room
);
alter table public.house_tenancies enable row level security;
revoke all on public.house_tenancies from anon, authenticated;

alter table public.furniture_items add column if not exists lot_no smallint references public.house_lots(no);   -- placed in a house
create index if not exists idx_furniture_items_lot on public.furniture_items (lot_no);

-- ---------- C. Helpers: the design ----------
-- The cell at (row, col), '' outside the lot.
create or replace function public._house_at(p_grid text, p_r integer, p_c integer) returns text
language sql immutable set search_path = public, extensions
as $$ select case when p_r < 0 or p_r > 13 or p_c < 0 or p_c > 19 then '' else substr(p_grid, p_r * 20 + p_c + 1, 1) end $$;
revoke all on function public._house_at(text, integer, integer) from public, anon, authenticated;

-- Each cell's room: the 4-connected floor areas, numbered by their first cell (row-major); 0 for the rest.
create or replace function public._house_rooms(p_grid text) returns smallint[]
language plpgsql immutable set search_path = public, extensions
as $$
declare v smallint[] := array_fill(0::smallint, array[280]); n smallint := 0; st integer[]; i integer; j integer; k integer;
        r integer; c integer;
begin
  for i in 0..279 loop
    if substr(p_grid, i + 1, 1) = 'f' and v[i + 1] = 0 then
      n := n + 1; v[i + 1] := n; st := array[i];
      while cardinality(st) > 0 loop
        j := st[cardinality(st)]; st := st[1:cardinality(st) - 1];
        r := j / 20; c := j % 20;
        foreach k in array array[case when r > 0 then j - 20 else -1 end, case when r < 13 then j + 20 else -1 end,
                                 case when c > 0 then j - 1 else -1 end, case when c < 19 then j + 1 else -1 end] loop
          if k >= 0 and substr(p_grid, k + 1, 1) = 'f' and v[k + 1] = 0 then v[k + 1] := n; st := st || k; end if;
        end loop;
      end loop;
    end if;
  end loop;
  return v;
end $$;
revoke all on function public._house_rooms(text) from public, anon, authenticated;

-- A door's open axis: 'v' / 'h' (an inner door), 'V' / 'H' (a front door: yard on one side); null when it is no door.
create or replace function public._house_door(p_grid text, p_r integer, p_c integer) returns text
language plpgsql immutable set search_path = public, extensions
as $$
declare u text := public._house_at(p_grid, p_r - 1, p_c); d text := public._house_at(p_grid, p_r + 1, p_c);
        l text := public._house_at(p_grid, p_r, p_c - 1); rt text := public._house_at(p_grid, p_r, p_c + 1);
begin
  if u in ('f','.') and d in ('f','.') and 'f' in (u, d) and l in ('','w','n','d') and rt in ('','w','n','d') then
    return case when '.' in (u, d) then 'V' else 'v' end;
  end if;
  if l in ('f','.') and rt in ('f','.') and 'f' in (l, rt) and u in ('','w','n','d') and d in ('','w','n','d') then
    return case when '.' in (l, rt) then 'H' else 'h' end;
  end if;
  return null;
end $$;
revoke all on function public._house_door(text, integer, integer) from public, anon, authenticated;

-- Is the design a house? Its rooms (null for bare land), or the refusal. The same checks, in the same order, as
-- checkDesign in lib/game/housing/house.ts.
create or replace function public._house_check(p_grid text) returns smallint[]
language plpgsql immutable set search_path = public, extensions
as $$
declare v_rooms smallint[]; n integer; i integer; r integer; c integer; t text; reached boolean[]; links integer[] := '{}';
        v_front boolean := false; a integer; b integer; ra integer; rb integer; pass integer; j integer;
begin
  if p_grid is null or length(p_grid) <> 280 or p_grid !~ '^[.fwdn]*$' then raise exception 'bad grid' using errcode = '22023'; end if;
  if p_grid !~ '[fwdn]' then return null; end if;                                    -- bare land
  for i in 0..279 loop
    r := i / 20; c := i % 20;
    if substr(p_grid, i + 1, 1) = 'f'
       and exists (select 1 from unnest(array[public._house_at(p_grid, r - 1, c), public._house_at(p_grid, r + 1, c),
                                              public._house_at(p_grid, r, c - 1), public._house_at(p_grid, r, c + 1)]) x
                    where x in ('', '.')) then
      raise exception 'open floor' using errcode = '22023';
    end if;
  end loop;
  for i in 0..279 loop
    if substr(p_grid, i + 1, 1) = 'd' and public._house_door(p_grid, i / 20, i % 20) is null then
      raise exception 'bad door' using errcode = '22023';
    end if;
  end loop;
  for i in 0..279 loop
    r := i / 20; c := i % 20;
    if substr(p_grid, i + 1, 1) = 'n'
       and not exists (select 1 from unnest(array[public._house_at(p_grid, r - 1, c), public._house_at(p_grid, r + 1, c),
                                                  public._house_at(p_grid, r, c - 1), public._house_at(p_grid, r, c + 1)]) x
                        where x in ('', '.')) then
      raise exception 'bad window' using errcode = '22023';
    end if;
  end loop;
  v_rooms := public._house_rooms(p_grid);
  n := coalesce((select max(x) from unnest(v_rooms) x), 0);
  if n = 0 then raise exception 'no room' using errcode = '22023'; end if;
  if n > 6 then raise exception 'too many rooms' using errcode = '22023'; end if;
  if exists (select 1 from generate_series(1, n) k where (select count(*) from unnest(v_rooms) x where x = k) < 4) then
    raise exception 'small room' using errcode = '22023';
  end if;
  -- the rooms reached from the front doors, through the inner doors
  reached := array_fill(false, array[n]);
  for i in 0..279 loop
    if substr(p_grid, i + 1, 1) <> 'd' then continue; end if;
    r := i / 20; c := i % 20;
    t := public._house_door(p_grid, r, c);
    if t in ('v', 'V') then a := i - 20; b := i + 20; else a := i - 1; b := i + 1; end if;
    ra := case when a between 0 and 279 and substr(p_grid, a + 1, 1) = 'f' then v_rooms[a + 1] else 0 end;
    rb := case when b between 0 and 279 and substr(p_grid, b + 1, 1) = 'f' then v_rooms[b + 1] else 0 end;
    if t in ('V', 'H') then v_front := true; reached[greatest(ra, rb)] := true;
    else links := links || array[ra, rb]; end if;
  end loop;
  if not v_front then raise exception 'no front door' using errcode = '22023'; end if;
  for pass in 1..n loop
    for j in 1..(cardinality(links) / 2) loop
      a := links[2 * j - 1]; b := links[2 * j];
      if reached[a] <> reached[b] then reached[a] := true; reached[b] := true; end if;
    end loop;
  end loop;
  if false = any(reached) then raise exception 'unreachable' using errcode = '22023'; end if;
  return v_rooms;
end $$;
revoke all on function public._house_check(text) from public, anon, authenticated;

-- What a save costs: every cell that changes to a built type pays that type's price (clearing is free).
create or replace function public._house_cost(p_old text, p_new text) returns integer
language sql immutable set search_path = public, extensions
as $$
  select coalesce(sum(public._house_tile_price(substr(p_new, i, 1))), 0)::int from generate_series(1, 280) i
   where substr(p_new, i, 1) <> substr(coalesce(p_old, repeat('.', 280)), i, 1)
$$;
revoke all on function public._house_cost(text, text) from public, anon, authenticated;

-- The room a w × h footprint at (x, y) stands in, or why not: -1 bounds, -2 not on the floor, -3 across two rooms,
-- -4 on the floor cell just inside a door. Same order as roomAt in TS.
create or replace function public._house_fit(p_grid text, p_rooms smallint[], p_x integer, p_y integer, p_w integer, p_h integer)
returns integer
language plpgsql immutable set search_path = public, extensions
as $$
declare v_room integer := 0; i integer; xx integer; yy integer;
begin
  if p_x < 0 or p_y < 0 or p_x + p_w > 20 or p_y + p_h > 14 then return -1; end if;
  for yy in p_y..p_y + p_h - 1 loop
    for xx in p_x..p_x + p_w - 1 loop
      i := yy * 20 + xx;
      if substr(p_grid, i + 1, 1) <> 'f' then return -2; end if;
      if v_room = 0 then v_room := p_rooms[i + 1]; elsif p_rooms[i + 1] <> v_room then return -3; end if;
      if 'd' in (public._house_at(p_grid, yy - 1, xx), public._house_at(p_grid, yy + 1, xx),
                 public._house_at(p_grid, yy, xx - 1), public._house_at(p_grid, yy, xx + 1)) then return -4; end if;
    end loop;
  end loop;
  return v_room;
end $$;
revoke all on function public._house_fit(text, smallint[], integer, integer, integer, integer) from public, anon, authenticated;

create or replace function public._house_room_count(p_rooms smallint[]) returns integer
language sql immutable set search_path = public, extensions
as $$ select coalesce((select max(x) from unnest(p_rooms) x), 0)::int $$;
revoke all on function public._house_room_count(smallint[]) from public, anon, authenticated;

-- ---------- C. Helpers: homes, sweeping, access ----------
-- Does p_account hold a lot or a room tenancy (v19.2's one home now spans flats, lots and rooms)?
create or replace function public._house_home(p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (select 1 from public.house_lots where owner_id = p_account)
      or exists (select 1 from public.house_tenancies where tenant_id = p_account)
$$;
revoke all on function public._house_home(uuid) from public, anon, authenticated;

-- The lot I live on (as its owner, or renting a room there), else null.
create or replace function public._house_of(p_account uuid) returns smallint
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select no from public.house_lots where owner_id = p_account),
                  (select lot_no from public.house_tenancies where tenant_id = p_account and paid_until > now()))
$$;
revoke all on function public._house_of(uuid) from public, anon, authenticated;

-- Any home (a lot, a rented room, or v19.2's active flat), else v19.2's refusal ('rent due' / 'no home').
create or replace function public._home_need(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if public._house_of(p_account) is not null then return; end if;
  perform public._apt_need_home(p_account);
end $$;
revoke all on function public._home_need(uuid) from public, anon, authenticated;

-- Free lot p_no: the tenancies end (refunded pro rata when p_refund), the listings go, every item placed in it goes
-- back to its owner's storage, and the house is gone.
create or replace function public._house_free(p_no smallint, p_refund boolean) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.house_tenancies; v_back integer;
begin
  for t in select * from public.house_tenancies where lot_no = p_no loop
    if p_refund and t.paid_until > now() then
      v_back := least(t.price * 2, floor(t.price * extract(epoch from (t.paid_until - now())) / extract(epoch from interval '30 days')))::int;
      if v_back > 0 then
        perform public._wallet_lock(t.tenant_id);
        perform public._pay(t.tenant_id, v_back, 'house_refund', 'house #' || p_no || ' room ' || t.room_no || ': refunded');
      end if;
    end if;
  end loop;
  delete from public.house_tenancies where lot_no = p_no;
  delete from public.house_room_rents where lot_no = p_no;
  update public.furniture_items set lot_no = null, x = null, y = null, rot = 0 where lot_no = p_no;
  update public.house_lots set owner_id = null, bought_at = null, paid_until = null, grid = null, rooms = null, roof = 'ngoi',
         wall = null, floor = null, visibility = 'private', build_cost = 0
   where no = p_no;
end $$;
revoke all on function public._house_free(smallint, boolean) from public, anon, authenticated;

-- The lazy sweep: tenancies whose time ran out end (the tenant's items go back to storage); a lot whose upkeep ran out
-- 60 days ago (or whose owner is gone) goes back to the city, paying the owner 50 % of the land.
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
      perform public._pay(l.owner_id, public._house_price('refund'), 'house_refund', 'house #' || l.no || ': repossessed');
    end if;
    perform public._house_free(l.no, true);
  end loop;
end $$;
revoke all on function public._house_sweep() from public, anon, authenticated;

-- May p_account enter lot p_lot's house from music room p_room? The owner; a tenant; anyone when open; members of that
-- room (the owner one too) when 'room'.
create or replace function public._house_can_enter(p_account uuid, p_room uuid, p_lot smallint) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.house_lots l
     where l.no = p_lot and l.owner_id is not null and l.grid is not null
       and (l.owner_id = p_account or l.visibility = 'open'
            or exists (select 1 from public.house_tenancies t where t.lot_no = l.no and t.tenant_id = p_account and t.paid_until > now())
            or (l.visibility = 'room'
                and exists (select 1 from public.members m where m.room_id = p_room and m.account_id = l.owner_id)
                and exists (select 1 from public.members m where m.room_id = p_room and m.account_id = p_account))))
$$;
revoke all on function public._house_can_enter(uuid, uuid, smallint) from public, anon, authenticated;

-- May p_account furnish room p_room of lot p_lot? A tenant their own room only; the owner every room without a tenant.
create or replace function public._house_may_furnish(p_lot smallint, p_account uuid, p_room integer) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when exists (select 1 from public.house_tenancies t where t.lot_no = p_lot and t.tenant_id = p_account and t.paid_until > now())
      then exists (select 1 from public.house_tenancies t
                    where t.lot_no = p_lot and t.tenant_id = p_account and t.room_no = p_room and t.paid_until > now())
    when exists (select 1 from public.house_lots l where l.no = p_lot and l.owner_id = p_account)
      then not exists (select 1 from public.house_tenancies t where t.lot_no = p_lot and t.room_no = p_room and t.paid_until > now())
    else false end
$$;
revoke all on function public._house_may_furnish(smallint, uuid, integer) from public, anon, authenticated;

create or replace function public._house_list_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'lots', (select jsonb_agg(jsonb_build_object(
               'no', l.no, 'owned', l.owner_id is not null, 'owner_name', acc.username, 'mine', coalesce(l.owner_id = p_account, false),
               'grid', l.grid, 'roof', l.roof, 'visibility', l.visibility,
               'rooms', coalesce((select jsonb_agg(jsonb_build_object(
                                    'no', k, 'cells', (select count(*) from unnest(l.rooms) x where x = k), 'price', rr.price,
                                    'taken', t.tenant_id is not null, 'mine', coalesce(t.tenant_id = p_account, false)) order by k)
                                    from generate_series(1, public._house_room_count(l.rooms)) k
                                    left join public.house_room_rents rr on rr.lot_no = l.no and rr.room_no = k
                                    left join public.house_tenancies t on t.lot_no = l.no and t.room_no = k and t.paid_until > now()),
                                 '[]'::jsonb)) order by l.no)
               from public.house_lots l left join public.accounts acc on acc.id = l.owner_id),
    'mine', (select jsonb_build_object(
               'no', l.no, 'paid_until_ms', public._apt_ms(l.paid_until), 'repossess_ms', public._apt_ms(l.paid_until + interval '60 days'),
               'build_cost', l.build_cost, 'visibility', l.visibility, 'wall', l.wall, 'floor', l.floor,
               'rooms', coalesce((select jsonb_agg(jsonb_build_object(
                                    'no', k, 'cells', (select count(*) from unnest(l.rooms) x where x = k), 'price', rr.price,
                                    'tenant_name', ta.username, 'until_ms', public._apt_ms(t.paid_until)) order by k)
                                    from generate_series(1, public._house_room_count(l.rooms)) k
                                    left join public.house_room_rents rr on rr.lot_no = l.no and rr.room_no = k
                                    left join public.house_tenancies t on t.lot_no = l.no and t.room_no = k and t.paid_until > now()
                                    left join public.accounts ta on ta.id = t.tenant_id), '[]'::jsonb))
               from public.house_lots l where l.owner_id = p_account),
    'tenancy', (select jsonb_build_object(
                  'lot', t.lot_no, 'room', t.room_no, 'paid_until_ms', public._apt_ms(t.paid_until), 'price', t.price,
                  'owner_name', acc.username,
                  'listed', exists (select 1 from public.house_room_rents rr where rr.lot_no = t.lot_no and rr.room_no = t.room_no))
                  from public.house_tenancies t join public.house_lots l on l.no = t.lot_no
                  left join public.accounts acc on acc.id = l.owner_id
                 where t.tenant_id = p_account and t.paid_until > now()),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._house_list_json(uuid) from public, anon, authenticated;

create or replace function public._house_layout(p_lot smallint, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'lot', l.no, 'owner_id', l.owner_id, 'owner_name', acc.username, 'can_edit', l.owner_id = p_viewer,
    'my_room', (select t.room_no from public.house_tenancies t where t.lot_no = l.no and t.tenant_id = p_viewer and t.paid_until > now()),
    'visibility', l.visibility, 'grid', l.grid, 'roof', l.roof, 'wall', l.wall, 'floor', l.floor,
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('no', k, 'price', rr.price, 'tenant_name', ta.username,
                                                           'until_ms', public._apt_ms(t.paid_until)) order by k)
                         from generate_series(1, public._house_room_count(l.rooms)) k
                         left join public.house_room_rents rr on rr.lot_no = l.no and rr.room_no = k
                         left join public.house_tenancies t on t.lot_no = l.no and t.room_no = k and t.paid_until > now()
                         left join public.accounts ta on ta.id = t.tenant_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'item', f.item_id, 'x', f.x, 'y', f.y, 'rot', f.rot,
                                                           'mine', f.account_id = p_viewer) order by f.id)
                         from public.furniture_items f where f.lot_no = l.no), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
  from public.house_lots l join public.accounts acc on acc.id = l.owner_id where l.no = p_lot
$$;
revoke all on function public._house_layout(smallint, uuid) from public, anon, authenticated;

-- Sleep in a house: a tenant needs a bed in their room; the owner a bed in a room that is not rented out.
create or replace function public._house_sleep(p_account uuid, p_lot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare l public.house_lots; v_room smallint; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; r public.rest_state;
begin
  select * into l from public.house_lots where no = p_lot;
  if not found or l.grid is null then raise exception 'no home' using errcode = '53400'; end if;
  select room_no into v_room from public.house_tenancies where lot_no = l.no and tenant_id = p_account and paid_until > now();
  if v_room is not null then
    if not exists (select 1 from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
                    where f.lot_no = l.no and c.kind = 'bed' and l.rooms[f.y * 20 + f.x + 1] = v_room) then
      raise exception 'no bed' using errcode = '53400';
    end if;
  elsif l.owner_id = p_account then
    if not exists (select 1 from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
                    where f.lot_no = l.no and c.kind = 'bed'
                      and not exists (select 1 from public.house_tenancies t
                                       where t.lot_no = l.no and t.room_no = l.rooms[f.y * 20 + f.x + 1] and t.paid_until > now())) then
      raise exception 'no bed' using errcode = '53400';
    end if;
  else
    raise exception 'no home' using errcode = '53400';
  end if;
  if coalesce((select fainted_until > now() from public.vitals where account_id = p_account), false) then
    raise exception 'fainted' using errcode = '53400';
  end if;
  insert into public.rest_state (account_id) values (p_account) on conflict do nothing;
  select * into r from public.rest_state where account_id = p_account for update;
  if r.slept_day = v_today then raise exception 'already slept' using errcode = '53400'; end if;
  update public.rest_state set slept_day = v_today, slept_at = now(), buff_until = now() + interval '24 hours'
   where account_id = p_account;
  return public._motel_json(p_account);
end $$;
revoke all on function public._house_sleep(uuid, integer) from public, anon, authenticated;

-- The wipe's part: the account's tenancy ends; its lot goes back (no refund to it; its tenants are refunded).
create or replace function public._house_wipe(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_no smallint;
begin
  delete from public.house_tenancies where tenant_id = p_account;
  select no into v_no from public.house_lots where owner_id = p_account;
  if v_no is not null then perform public._house_free(v_no, true); end if;
end $$;
revoke all on function public._house_wipe(uuid) from public, anon, authenticated;

-- ---------- G. The ledger ----------
-- The 35 reasons in force after 0041 plus the six house reasons: 41.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture',
                    'house_land','house_upkeep','house_build','house_refund','house_rent_pay','house_rent_income'));

-- ---------- D. RPCs: the street ----------
create or replace function public.house_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._house_sweep();
  return public._house_list_json(v_account);
end $$;

-- Buy lot p_lot from the city (the first 30 days of upkeep included). One home per account.
create or replace function public.lot_buy(p_session_token text, p_lot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots; v_coins int; v_bal int;
begin
  perform public._house_sweep();
  perform public._apt_sweep();
  perform public._wallet_lock(v_account);
  select * into l from public.house_lots where no = p_lot for update;
  if not found then raise exception 'unknown lot' using errcode = '22023'; end if;
  if l.owner_id is not null then raise exception 'taken' using errcode = '53400'; end if;
  if public._house_home(v_account) or exists (select 1 from public.apartments where owner_id = v_account) then
    raise exception 'already have a home' using errcode = '53400';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < public._house_price('land') then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -public._house_price('land'), 'house_land', 'house #' || p_lot || ': land');
  update public.house_lots set owner_id = v_account, bought_at = now(), paid_until = now() + interval '30 days', grid = null,
         rooms = null, roof = 'ngoi', wall = null, floor = null, visibility = 'private', build_cost = 0
   where no = p_lot;
  return public._house_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Pay 30 more days of upkeep (after the current end), at most 60 days ahead.
create or replace function public.lot_upkeep(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots; v_until timestamptz; v_coins int; v_bal int;
begin
  perform public._house_sweep();
  perform public._wallet_lock(v_account);
  select * into l from public.house_lots where owner_id = v_account for update;
  if not found then raise exception 'no lot' using errcode = '53400'; end if;
  v_until := greatest(now(), l.paid_until) + interval '30 days';
  if v_until > now() + interval '60 days' then raise exception 'too far ahead' using errcode = '53400'; end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < public._house_price('upkeep') then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -public._house_price('upkeep'), 'house_upkeep', 'house #' || l.no || ': upkeep');
  update public.house_lots set paid_until = v_until where no = l.no;
  return public._house_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Give the lot back to the city for 50 % of the land (not while a room is rented). The house goes; the furniture is stored.
create or replace function public.lot_sell(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots; v_bal int;
begin
  perform public._house_sweep();
  perform public._wallet_lock(v_account);
  select * into l from public.house_lots where owner_id = v_account for update;
  if not found then raise exception 'no lot' using errcode = '53400'; end if;
  if exists (select 1 from public.house_tenancies where lot_no = l.no and paid_until > now()) then
    raise exception 'has tenants' using errcode = '53400';
  end if;
  v_bal := public._pay(v_account, public._house_price('refund'), 'house_refund', 'house #' || l.no || ': given back');
  perform public._house_free(l.no, false);
  return public._house_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- ---------- D. RPCs: the builder, the door, the surfaces ----------
-- Save my house's design and roof. The server re-checks the design and re-prices it: every cell that changes to a
-- built type is paid (clearing is free). The design cannot change while a room is rented; a change drops the room
-- listings and stores the items that no longer stand on a room's floor.
create or replace function public.house_build(p_session_token text, p_grid text, p_roof text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots; v_rooms smallint[]; v_new text;
        v_cost int := 0; v_coins int; v_bal int; f record; v_w int; v_h int;
begin
  perform public._house_sweep();
  perform public._wallet_lock(v_account);
  select * into l from public.house_lots where owner_id = v_account for update;
  if not found then raise exception 'no lot' using errcode = '53400'; end if;
  if l.paid_until <= now() then raise exception 'upkeep due' using errcode = '53400'; end if;
  if p_roof is null or p_roof not in ('ngoi','tole','la','bang') then raise exception 'bad roof' using errcode = '22023'; end if;
  v_rooms := public._house_check(p_grid);
  v_new := case when p_grid ~ '[fwdn]' then p_grid end;
  if v_new is distinct from l.grid then
    if exists (select 1 from public.house_tenancies where lot_no = l.no and paid_until > now()) then
      raise exception 'has tenants' using errcode = '53400';
    end if;
    v_cost := public._house_cost(l.grid, p_grid);
    select coins into v_coins from public.wallets where account_id = v_account;
    if coalesce(v_coins, 0) < v_cost then raise exception 'insufficient funds' using errcode = '22023'; end if;
    if v_cost > 0 then v_bal := public._pay(v_account, -v_cost, 'house_build', 'house #' || l.no || ': build'); end if;
    delete from public.house_room_rents where lot_no = l.no;
    for f in select fi.id, fi.x, fi.y, fi.rot, fc.w, fc.h from public.furniture_items fi
               join public.furniture_catalog fc on fc.id = fi.item_id where fi.lot_no = l.no loop
      v_w := case when f.rot % 2 = 0 then f.w else f.h end;
      v_h := case when f.rot % 2 = 0 then f.h else f.w end;
      if v_new is null or public._house_fit(v_new, v_rooms, f.x, f.y, v_w, v_h) <= 0 then
        update public.furniture_items set lot_no = null, x = null, y = null, rot = 0 where id = f.id;
      end if;
    end loop;
    update public.house_lots set grid = v_new, rooms = v_rooms, build_cost = build_cost + v_cost where no = l.no;
  end if;
  update public.house_lots set roof = p_roof where no = l.no;
  return public._house_list_json(v_account)
      || case when v_bal is null then '{}'::jsonb else jsonb_build_object('coins', v_bal) end;
end $$;

create or replace function public.house_set_visibility(p_session_token text, p_visibility text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  if p_visibility is null or p_visibility not in ('private','room','open') then
    raise exception 'bad visibility' using errcode = '22023';
  end if;
  update public.house_lots set visibility = p_visibility where owner_id = v_account;
  if not found then raise exception 'no lot' using errcode = '53400'; end if;
  return public._house_list_json(v_account);
end $$;

-- Apply a wallpaper or a floor I own to my whole house (null: the plain one).
create or replace function public.house_set_surface(p_session_token text, p_kind text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint;
begin
  select no into v_no from public.house_lots where owner_id = v_account and grid is not null;
  if v_no is null then raise exception 'no lot' using errcode = '53400'; end if;
  if p_kind is null or p_kind not in ('wall','floor') then raise exception 'bad surface' using errcode = '22023'; end if;
  if p_item is not null and not exists (
       select 1 from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
        where f.account_id = v_account and f.item_id = p_item and c.kind = p_kind) then
    raise exception 'not owned' using errcode = '42501';
  end if;
  if p_kind = 'wall' then update public.house_lots set wall = p_item where no = v_no;
  else update public.house_lots set floor = p_item where no = v_no; end if;
  return public._house_layout(v_no, v_account);
end $$;

-- ---------- D. RPCs: renting rooms ----------
-- The owner lists room p_room at p_price xu per 30 days (null: not for rent any more; a tenant stays until paid up).
create or replace function public.house_room_price(p_session_token text, p_room integer, p_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots;
begin
  perform public._house_sweep();
  select * into l from public.house_lots where owner_id = v_account for update;
  if not found then raise exception 'no lot' using errcode = '53400'; end if;
  if p_room is null or p_room < 1 or p_room > public._house_room_count(l.rooms) then raise exception 'unknown room' using errcode = '22023'; end if;
  if p_price is null then
    delete from public.house_room_rents where lot_no = l.no and room_no = p_room;
  else
    if p_price not between 300 and 5000 then raise exception 'bad price' using errcode = '22023'; end if;
    if l.paid_until <= now() then raise exception 'upkeep due' using errcode = '53400'; end if;
    insert into public.house_room_rents (lot_no, room_no, price) values (l.no, p_room, p_price)
    on conflict (lot_no, room_no) do update set price = excluded.price;
  end if;
  return public._house_list_json(v_account);
end $$;

-- Rent room p_room of lot p_lot (or extend my tenancy of it) for 30 days, at most 60 days ahead. The owner gets 95 %;
-- 5 % is the fee.
create or replace function public.house_room_rent(p_session_token text, p_lot integer, p_room integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots; t public.house_tenancies; v_had boolean;
        v_price int; v_until timestamptz; v_coins int; v_bal int;
begin
  perform public._house_sweep();
  perform public._apt_sweep();
  select * into l from public.house_lots where no = p_lot for update;
  if not found or l.owner_id is null or l.grid is null or p_room is null or p_room < 1
     or p_room > public._house_room_count(l.rooms) then
    raise exception 'unknown room' using errcode = '22023';
  end if;
  if l.owner_id = v_account then raise exception 'own house' using errcode = '53400'; end if;
  if l.paid_until <= now() then raise exception 'upkeep due' using errcode = '53400'; end if;
  select price into v_price from public.house_room_rents where lot_no = l.no and room_no = p_room;
  if v_price is null then raise exception 'not for rent' using errcode = '53400'; end if;
  select * into t from public.house_tenancies where lot_no = l.no and room_no = p_room for update;
  v_had := found;
  if v_had and t.tenant_id <> v_account then raise exception 'taken' using errcode = '53400'; end if;
  if not v_had and (public._house_home(v_account) or exists (select 1 from public.apartments where owner_id = v_account)) then
    raise exception 'already have a home' using errcode = '53400';
  end if;
  v_until := greatest(now(), coalesce(t.paid_until, now())) + interval '30 days';
  if v_until > now() + interval '60 days' then raise exception 'too far ahead' using errcode = '53400'; end if;
  -- both wallets, in account order
  if v_account < l.owner_id then perform public._wallet_lock(v_account); perform public._wallet_lock(l.owner_id);
  else perform public._wallet_lock(l.owner_id); perform public._wallet_lock(v_account); end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_price, 'house_rent_pay', 'house #' || l.no || ' room ' || p_room || ': rent');
  perform public._pay(l.owner_id, (v_price * 95) / 100, 'house_rent_income', 'house #' || l.no || ' room ' || p_room || ': rent');
  insert into public.house_tenancies (lot_no, room_no, tenant_id, price, paid_until) values (l.no, p_room, v_account, v_price, v_until)
  on conflict (lot_no, room_no) do update set paid_until = excluded.paid_until, price = excluded.price;
  return public._house_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Leave my rented room early (no refund): my items there go back to storage.
create or replace function public.house_room_leave(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); t public.house_tenancies;
begin
  delete from public.house_tenancies where tenant_id = v_account returning * into t;
  if not found then raise exception 'no tenancy' using errcode = '53400'; end if;
  update public.furniture_items set lot_no = null, x = null, y = null, rot = 0 where lot_no = t.lot_no and account_id = v_account;
  return public._house_list_json(v_account);
end $$;

-- ---------- D. RPCs: inside ----------
create or replace function public.house_enter(p_session_token text, p_room_id uuid, p_lot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots;
begin
  perform public._house_sweep();
  select * into l from public.house_lots where no = p_lot;
  if not found then raise exception 'unknown lot' using errcode = '22023'; end if;
  if l.owner_id is null or l.grid is null then raise exception 'vacant' using errcode = '53400'; end if;
  if not public._house_can_enter(v_account, p_room_id, p_lot::smallint) then raise exception 'no access' using errcode = '42501'; end if;
  return public._house_layout(p_lot::smallint, v_account);
end $$;

-- Place (or move, or turn) one of my items in lot p_lot's house: on the floor of one room I may furnish, off the door
-- fronts, not over another item (rugs only collide with rugs), at most 80 items per house.
create or replace function public.house_place(p_session_token text, p_lot integer, p_id bigint, p_x integer, p_y integer,
                                              p_rot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots; f public.furniture_items;
        c public.furniture_catalog; v_w int; v_h int; v_room int; v_rug boolean;
begin
  select * into l from public.house_lots where no = p_lot for update;          -- one placement at a time per house
  if not found or l.grid is null then raise exception 'vacant' using errcode = '53400'; end if;
  if l.owner_id is distinct from v_account
     and not exists (select 1 from public.house_tenancies where lot_no = l.no and tenant_id = v_account and paid_until > now()) then
    raise exception 'no access' using errcode = '42501';
  end if;
  select * into f from public.furniture_items where id = p_id and account_id = v_account for update;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  select * into c from public.furniture_catalog where id = f.item_id;
  if c.kind in ('wall','floor') then raise exception 'not placeable' using errcode = '22023'; end if;
  if p_x is null or p_y is null or p_rot is null or p_rot not between 0 and 3 then raise exception 'bounds' using errcode = '22023'; end if;
  v_w := case when p_rot % 2 = 0 then c.w else c.h end;
  v_h := case when p_rot % 2 = 0 then c.h else c.w end;
  v_room := public._house_fit(l.grid, l.rooms, p_x, p_y, v_w, v_h);
  if v_room = -1 then raise exception 'bounds' using errcode = '22023'; end if;
  if v_room = -2 then raise exception 'not floor' using errcode = '22023'; end if;
  if v_room = -3 then raise exception 'two rooms' using errcode = '22023'; end if;
  if v_room = -4 then raise exception 'door' using errcode = '22023'; end if;
  if not public._house_may_furnish(l.no, v_account, v_room) then raise exception 'not your room' using errcode = '42501'; end if;
  -- moving an item out of a room I may not touch (the owner's item in a rented room stays)
  if f.lot_no = l.no and not public._house_may_furnish(l.no, v_account, l.rooms[f.y * 20 + f.x + 1]) then
    raise exception 'not your room' using errcode = '42501';
  end if;
  if f.lot_no is distinct from l.no and (select count(*) from public.furniture_items where lot_no = l.no) >= 80 then
    raise exception 'too many' using errcode = '53400';
  end if;
  v_rug := c.kind = 'rug';
  if exists (select 1 from public.furniture_items o join public.furniture_catalog oc on oc.id = o.item_id
              where o.lot_no = l.no and o.id <> p_id and (oc.kind = 'rug') = v_rug
                and o.x < p_x + v_w and p_x < o.x + (case when o.rot % 2 = 0 then oc.w else oc.h end)
                and o.y < p_y + v_h and p_y < o.y + (case when o.rot % 2 = 0 then oc.h else oc.w end)) then
    raise exception 'overlap' using errcode = '22023';
  end if;
  update public.furniture_items set apt_no = null, lot_no = l.no, x = p_x, y = p_y, rot = p_rot where id = p_id;
  return public._house_layout(l.no, v_account);
end $$;

create or replace function public.house_pickup(p_session_token text, p_lot integer, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); l public.house_lots; f public.furniture_items;
begin
  select * into l from public.house_lots where no = p_lot for update;
  if not found or l.grid is null then raise exception 'vacant' using errcode = '53400'; end if;
  select * into f from public.furniture_items where id = p_id and account_id = v_account and lot_no = l.no for update;
  if not found then raise exception 'not owned' using errcode = '42501'; end if;
  if not public._house_may_furnish(l.no, v_account, l.rooms[f.y * 20 + f.x + 1]) then
    raise exception 'not your room' using errcode = '42501';
  end if;
  update public.furniture_items set lot_no = null, x = null, y = null, rot = 0 where id = p_id;
  return public._house_layout(l.no, v_account);
end $$;

-- ---------- E. Re-created from 0041 (the v19.3 lines) ----------
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
                           from public.furniture_items f where f.account_id = p_account and f.apt_no is null and f.lot_no is null), '[]'::jsonb),   -- v19.3
    'knocks', coalesce((select jsonb_agg(jsonb_build_object('account_id', k.account_id, 'name', acc.username,
                                                            'at_ms', public._apt_ms(k.at)) order by k.at)
                          from public.apt_knocks k join public.apartments a on a.no = k.apt_no
                          join public.accounts acc on acc.id = k.account_id
                         where a.owner_id = p_account and k.at > now() - interval '10 minutes'), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._apt_list_json(uuid) from public, anon, authenticated;

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
  perform public._house_sweep();                                                                          -- v19.3
  if public._house_home(v_account) then raise exception 'already have a home' using errcode = '53400'; end if;   -- v19.3
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
  perform public._house_sweep();                                                                          -- v19.3
  if public._house_home(v_account) then raise exception 'already have a home' using errcode = '53400'; end if;   -- v19.3
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < public._apt_price('buy') then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -public._apt_price('buy'), 'apartment', 'apartment #' || p_no || ': buy');
  update public.apartments set owner_id = v_account, tenure = 'own', paid_until = null, since = coalesce(since, now())
   where no = p_no;
  return public._apt_list_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- The fridge: its slots are the placed fridges' in my active home.
create or replace function public._fridge_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(sum(c.cap), 0)::int from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
   where f.account_id = p_account and f.apt_no = public._apt_home(p_account) and c.kind = 'fridge'
      or f.account_id = p_account and f.lot_no = public._house_of(p_account) and c.kind = 'fridge'   -- v19.3
$$;
revoke all on function public._fridge_cap(uuid) from public, anon, authenticated;

-- Bag → fridge: needs my active home with a placed fridge with a free slot. The fish keeps its id, weight and price.
create or replace function public.fish_move_to_fridge(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_cap int; r public.fish;
begin
  perform public._home_need(v_account);                                                -- v19.3
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
  perform public._home_need(v_account);                                                -- v19.3
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

-- 'motel' is motel_sleep; 'apt' needs my active home p_id with a placed bed. One sleep per Vietnam day either way.
create or replace function public.home_sleep(p_session_token text, p_kind text, p_id integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint;
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; r public.rest_state;
begin
  if p_kind = 'motel' then return public.motel_sleep(p_session_token); end if;
  if p_kind = 'house' then return public._house_sleep(v_account, p_id); end if;                -- v19.3
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

-- ---------- F. The wipe ----------
-- 0041's _ac_wipe plus the v19.3 line: the tenancy ends, the lot goes back (its tenants refunded), before the items go.
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
  perform public._house_wipe(p_account);                                             -- v19.3
  delete from public.furniture_items where account_id = p_account;                   -- v19.2
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;

-- ---------- grants ----------
revoke all on function public.house_list(text) from public;
revoke all on function public.lot_buy(text, integer) from public;
revoke all on function public.lot_upkeep(text) from public;
revoke all on function public.lot_sell(text) from public;
revoke all on function public.house_build(text, text, text) from public;
revoke all on function public.house_set_visibility(text, text) from public;
revoke all on function public.house_set_surface(text, text, text) from public;
revoke all on function public.house_room_price(text, integer, integer) from public;
revoke all on function public.house_room_rent(text, integer, integer) from public;
revoke all on function public.house_room_leave(text) from public;
revoke all on function public.house_enter(text, uuid, integer) from public;
revoke all on function public.house_place(text, integer, bigint, integer, integer, integer) from public;
revoke all on function public.house_pickup(text, integer, bigint) from public;
grant execute on function public.house_list(text) to anon, authenticated;
grant execute on function public.lot_buy(text, integer) to anon, authenticated;
grant execute on function public.lot_upkeep(text) to anon, authenticated;
grant execute on function public.lot_sell(text) to anon, authenticated;
grant execute on function public.house_build(text, text, text) to anon, authenticated;
grant execute on function public.house_set_visibility(text, text) to anon, authenticated;
grant execute on function public.house_set_surface(text, text, text) to anon, authenticated;
grant execute on function public.house_room_price(text, integer, integer) to anon, authenticated;
grant execute on function public.house_room_rent(text, integer, integer) to anon, authenticated;
grant execute on function public.house_room_leave(text) to anon, authenticated;
grant execute on function public.house_enter(text, uuid, integer) to anon, authenticated;
grant execute on function public.house_place(text, integer, bigint, integer, integer, integer) to anon, authenticated;
grant execute on function public.house_pickup(text, integer, bigint) to anon, authenticated;
