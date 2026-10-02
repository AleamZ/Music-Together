-- =========================================================
-- 0115_rod_builds.sql — Cần câu lắp theo từng cây (spec docs/superpowers/specs/2026-09-30-fishing-v3-design.md §9).
-- ADDITIVE and re-runnable. Run after 0114. Every re-created function is its newest body plus the lines marked
-- "-- 0115" (an added line), "-- 0115 {" … "-- 0115 }" (an added block) or "… -- 0115 was: <old line>" (a changed or
-- removed line; a removed one is the whole comment).
--   A. Rod INSTANCES (public.rods): a player owns any number of rods, several of one model too. Buying a rod adds a
--      bare instance to the bag (never auto-equipped). Cần gỗ is one free kit instance per account (its hook, line and
--      no-reel are built in and fixed; only its phao slot can be changed). Rods leave public.inventory for good.
--   B. Per-rod slots (public.rod_parts): hook / line / reel / bobber. rod_mount moves ONE unit of a part from the
--      stackable bag (inventory) into that rod's slot, BOUND: it never comes off onto another rod. Replacing a mounted
--      part destroys the old one; rod_unmount (removal without replacement) is allowed and destroys it too. A starter
--      part (Phao lông gà) is free and never taken from the bag. Parts are now stackable in the bag (≤ 99 of a kind).
--   C. fishing_profiles.rod_id = the equipped instance (null never after _fishing_profile). The old columns rod / hook /
--      line / reel / bobber stay as a DERIVED MIRROR of the equipped instance, written only by _rod_sync, so the
--      start_* bodies (which read p.rod / p.bobber) need no change; _fishing_rig reads the instance's own parts.
--      casts.rod_id (filled by a trigger from the locked profile) pins the instance a cast was made with: its wear,
--      its rod_snap, its line_snap and an overboard loss hit that instance even if another rod is equipped mid-cast.
--   D. RPCs: rod_list, rod_mount, rod_unmount, rod_equip, rod_rename, rod_scrap (no refund: a sink to tidy the bag),
--      rod_repair (per instance, 30 % of the rod's price as before; repair_rod(item) repairs the equipped / most worn
--      instance of that model). No rod_sell: rods are not resold. fishing_equip keeps 'rod' (an instance of that
--      model) and 'bait'; its part slots answer 'rod build' (use rod_mount).
--   E. Old data (once per profile: rod_id null): every inventory rod row becomes qty instances (its durability), the
--      rows are removed; the profile's equipped rod becomes that model's instance (Cần gỗ → the kit). Its phao is moved
--      onto the equipped instance; on a bare equipped rod its hook / line (with the line's wear) / reel too. Each moved
--      part takes one unit out of the bag (the old model kept exactly that unit there); a part not in the bag is
--      skipped; a starter phao costs nothing. Parts of a player on Cần gỗ stay in the bag, free to mount.
--   F. The mailbox (0111): a gifted rod becomes instances on claim; parts may be gifted (stackable).
-- =========================================================

-- ---------- A. The tables ----------
create table if not exists public.rods (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  durability integer,                                   -- null: unbreakable (the kit)
  name text check (name is null or char_length(name) between 1 and 24),
  legacy boolean not null default false,                -- made from a pre-0115 inventory row
  created_at timestamptz not null default now()
);
create index if not exists rods_account_idx on public.rods (account_id);
create unique index if not exists rods_kit_one on public.rods (account_id) where item_id = 'rod_wood';
alter table public.rods enable row level security;
revoke all on public.rods from anon, authenticated;

create table if not exists public.rod_parts (
  rod_id bigint not null references public.rods(id) on delete cascade,
  slot text not null check (slot in ('hook', 'line', 'reel', 'bobber')),
  item_id text not null references public.shop_items(id),
  durability integer,                                   -- a line's snaps left (null: never wears)
  mounted_at timestamptz not null default now(),
  primary key (rod_id, slot)
);
alter table public.rod_parts enable row level security;
revoke all on public.rod_parts from anon, authenticated;

alter table public.fishing_profiles add column if not exists rod_id bigint references public.rods(id) on delete set null;
alter table public.casts add column if not exists rod_id bigint;      -- the instance cast with (no FK: it may be scrapped)

-- ---------- B. The helpers ----------
-- The account's Cần gỗ instance (made once, with a free Phao lông gà).
create or replace function public._rod_kit(p_account uuid) returns bigint
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_id bigint;
begin
  insert into public.rods (account_id, item_id) values (p_account, 'rod_wood')
  on conflict (account_id) where item_id = 'rod_wood' do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.rod_parts (rod_id, slot, item_id) values (v_id, 'bobber', 'bobber_feather');
    return v_id;
  end if;
  select id into v_id from public.rods where account_id = p_account and item_id = 'rod_wood';
  return v_id;
end $$;
revoke all on function public._rod_kit(uuid) from public, anon, authenticated;

-- The profile's old columns mirror the equipped instance (start_* read p.rod / p.bobber). A broken or foreign rod_id
-- falls back to the kit.
create or replace function public._rod_sync(p_account uuid) returns void
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_rod bigint; ro public.rods;
begin
  select rod_id into v_rod from public.fishing_profiles where account_id = p_account;
  if not found then return; end if;
  select * into ro from public.rods where id = v_rod and account_id = p_account;
  if ro.id is null or coalesce(ro.durability, 1) <= 0 then
    v_rod := public._rod_kit(p_account);
    select * into ro from public.rods where id = v_rod;
  end if;
  update public.fishing_profiles f set
    rod_id = ro.id, rod = ro.item_id,
    hook = (select item_id from public.rod_parts where rod_id = ro.id and slot = 'hook'),
    line = (select item_id from public.rod_parts where rod_id = ro.id and slot = 'line'),
    reel = (select item_id from public.rod_parts where rod_id = ro.id and slot = 'reel'),
    bobber = (select item_id from public.rod_parts where rod_id = ro.id and slot = 'bobber')
   where f.account_id = p_account;
end $$;
revoke all on function public._rod_sync(uuid) from public, anon, authenticated;

-- One rod instance's rig (0110's _fishing_rig, per instance). p_rod null → the kit with a Phao lông gà.
create or replace function public._rod_rig(p_rod bigint) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare ro public.rods; rod public.shop_items; h public.shop_items; l public.shop_items; r public.shop_items;
        b public.shop_items; v_kit boolean; v_missing text[] := '{}';
begin
  select * into ro from public.rods where id = p_rod;
  select * into rod from public.shop_items where id = coalesce(ro.item_id, 'rod_wood');
  v_kit := rod.hook_class is not null;
  if ro.id is null then
    select * into b from public.shop_items where id = 'bobber_feather';
  else
    select s.* into b from public.rod_parts x join public.shop_items s on s.id = x.item_id
     where x.rod_id = ro.id and x.slot = 'bobber' and s.kind = 'bobber';
  end if;
  if not v_kit then
    select s.* into h from public.rod_parts x join public.shop_items s on s.id = x.item_id
     where x.rod_id = ro.id and x.slot = 'hook' and s.kind = 'hook';
    select s.* into l from public.rod_parts x join public.shop_items s on s.id = x.item_id
     where x.rod_id = ro.id and x.slot = 'line' and s.kind = 'line' and coalesce(x.durability, 1) > 0;
    select s.* into r from public.rod_parts x join public.shop_items s on s.id = x.item_id
     where x.rod_id = ro.id and x.slot = 'reel' and s.kind = 'reel';
    if h.id is null then v_missing := v_missing || 'hook'::text; end if;
    if l.id is null then v_missing := v_missing || 'line'::text; end if;
  end if;
  return jsonb_build_object(
    'rod', rod.id, 'rod_id', ro.id, 'kit', v_kit, 'ready', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing),
    'durability', ro.durability, 'max_durability', rod.durability,
    'hook', h.id, 'hook_class', case when v_kit then rod.hook_class else h.hook_class end,
    'hooks', case when v_kit then coalesce(rod.hook_count, 1) else coalesce(h.hook_count, 1) end,
    'line', l.id, 'line_g', case when v_kit then rod.line_g else l.line_g end,
    'rod_g', case when rod.durability is null then null else rod.rating_g end,
    'reel', r.id,
    'reel_speed', case when v_kit then 1 else round(coalesce(r.reel_speed, 1.15)::numeric, 2) end,
    'reel_ease', case when v_kit then 0 else coalesce(r.reel_ease, 5) end,
    'bobber', b.id, 'window_ms', coalesce(b.window_ms, case when v_kit then 1500 else 700 end),
    'bite_min_ms', coalesce(b.bite_min_ms, 3000), 'bite_max_ms', coalesce(b.bite_max_ms, 10000),
    'shows_rarity', coalesce(b.shows_rarity, false),
    'zone_pct', coalesce(rod.zone_pct, 25), 'rare_mult', rod.rare_mult);
end $$;
revoke all on function public._rod_rig(bigint) from public, anon, authenticated;

-- 0110's _fishing_rig now reads the equipped instance (0115): same keys, plus rod_id / durability.
create or replace function public._fishing_rig(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select public._rod_rig((select r.id from public.fishing_profiles p join public.rods r on r.id = p.rod_id
                           where p.account_id = p_account and r.account_id = p_account))
$$;
revoke all on function public._fishing_rig(uuid) from public, anon, authenticated;

-- The bag's rods: each with its parts and its rig.
create or replace function public._rod_list_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'item', r.item_id, 'name', r.name, 'durability', r.durability, 'max_durability', s.durability,
           'kit', r.item_id = 'rod_wood', 'equipped', r.id = p.rod_id, 'created_at', r.created_at,
           'parts', coalesce((select jsonb_object_agg(x.slot, jsonb_build_object('item', x.item_id, 'durability', x.durability,
                                                                                 'max_durability', xs.durability))
                                from public.rod_parts x join public.shop_items xs on xs.id = x.item_id
                               where x.rod_id = r.id), '{}'::jsonb),
           'rig', public._rod_rig(r.id))
         order by r.item_id <> 'rod_wood', r.created_at, r.id), '[]'::jsonb)
    from public.rods r join public.shop_items s on s.id = r.item_id
    left join public.fishing_profiles p on p.account_id = r.account_id
   where r.account_id = p_account
$$;
revoke all on function public._rod_list_json(uuid) from public, anon, authenticated;

-- A new instance of rod p_item in the bag (≤ 20 rods an account, the kit counted).
create or replace function public._rod_add(p_account uuid, p_item text) returns bigint
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare it public.shop_items; v_id bigint;
begin
  select * into it from public.shop_items where id = p_item and kind = 'rod';
  if not found or it.id = 'rod_wood' then raise exception 'item not available' using errcode = '22023'; end if;
  if (select count(*) from public.rods where account_id = p_account) >= 20 then
    raise exception 'bag full' using errcode = '22023';
  end if;
  insert into public.rods (account_id, item_id, durability) values (p_account, it.id, it.durability) returning id into v_id;
  return v_id;
end $$;
revoke all on function public._rod_add(uuid, text) from public, anon, authenticated;

-- The instance a cast was made with: casts.rod_id, or (a cast from before 0115) the equipped one of that model.
-- Null: Cần gỗ / gone.
create or replace function public._rod_of_cast(p_account uuid, p_rod bigint, p_model text) returns bigint
language sql stable security definer set search_path = public, extensions
as $$
  select case when p_rod is not null
              then (select id from public.rods where id = p_rod and account_id = p_account)
              else (select r.id from public.fishing_profiles p join public.rods r on r.id = p.rod_id
                     where p.account_id = p_account and r.account_id = p_account and r.item_id = p_model) end
$$;
revoke all on function public._rod_of_cast(uuid, bigint, text) from public, anon, authenticated;

-- p_amount off that instance's durability (floor 0; the kit never wears). At 0 an equipped rod falls back to the kit.
create or replace function public._rod_inst_wear(p_account uuid, p_rod bigint, p_model text, p_amount integer) returns void
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_id bigint := public._rod_of_cast(p_account, p_rod, p_model); v_d integer;
begin
  if v_id is null then return; end if;
  update public.rods set durability = greatest(0, durability - greatest(0, coalesce(p_amount, 0)))
   where id = v_id and durability is not null
  returning durability into v_d;
  if v_d = 0 then perform public._rod_sync(p_account); end if;
end $$;
revoke all on function public._rod_inst_wear(uuid, bigint, text, integer) from public, anon, authenticated;

create or replace function public._rod_inst_usable(p_account uuid, p_rod bigint, p_model text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select coalesce(durability, 1) > 0 from public.rods
                    where id = public._rod_of_cast(p_account, p_rod, p_model)), true)
$$;
revoke all on function public._rod_inst_usable(uuid, bigint, text) from public, anon, authenticated;

-- Overboard: the instance is gone (its bound parts with it).
create or replace function public._rod_lose(p_account uuid, p_rod bigint, p_model text) returns void
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_id bigint := public._rod_of_cast(p_account, p_rod, p_model);
begin
  if v_id is null or exists (select 1 from public.rods where id = v_id and item_id = 'rod_wood') then return; end if;
  delete from public.rods where id = v_id;
  perform public._rod_sync(p_account);
end $$;
revoke all on function public._rod_lose(uuid, bigint, text) from public, anon, authenticated;

-- A line snapped on that instance: one of its snaps is spent; at 0 it is in pieces (unmounted, gone). True when gone.
-- Only the very line cast with (a line replaced mid-cast was destroyed already).
create or replace function public._rod_line_wear(p_account uuid, p_rod bigint, p_model text, p_line text) returns boolean
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_id bigint := public._rod_of_cast(p_account, p_rod, p_model); v_d integer;
begin
  if v_id is null or p_line is null then return false; end if;
  update public.rod_parts set durability = greatest(0, coalesce(durability, 1) - 1)
   where rod_id = v_id and slot = 'line' and item_id = p_line
  returning durability into v_d;
  if v_d is null or v_d > 0 then return false; end if;
  delete from public.rod_parts where rod_id = v_id and slot = 'line';
  perform public._rod_sync(p_account);
  return true;
end $$;
revoke all on function public._rod_line_wear(uuid, bigint, text, text) from public, anon, authenticated;

-- 0034's seams, now on the equipped instance (start_* / start_net still call _rod_usable(account, p.rod)).
create or replace function public._rod_usable(p_account uuid, p_rod text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(p_rod, 'rod_wood') = 'rod_wood'
      or exists (select 1 from public.fishing_profiles p join public.rods r on r.id = p.rod_id
                  where p.account_id = p_account and r.account_id = p_account and r.item_id = p_rod
                    and coalesce(r.durability, 1) > 0)
$$;
revoke all on function public._rod_usable(uuid, text) from public, anon, authenticated;

create or replace function public._rod_wear(p_account uuid, p_rod text, p_amount integer) returns void
language sql volatile security definer set search_path = public, extensions
as $$ select public._rod_inst_wear(p_account, null, p_rod, p_amount) $$;
revoke all on function public._rod_wear(uuid, text, integer) from public, anon, authenticated;

create or replace function public._line_wear(p_account uuid, p_line text) returns boolean
language sql volatile security definer set search_path = public, extensions
as $$ select public._rod_line_wear(p_account, (select rod_id from public.fishing_profiles where account_id = p_account),
                                   null, p_line) $$;
revoke all on function public._line_wear(uuid, text) from public, anon, authenticated;

-- casts.rod_id: the equipped instance, read under the profile's row lock (start_* lock it first).
create or replace function public._casts_rod_id() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.rod_id is null then
    select rod_id into new.rod_id from public.fishing_profiles where account_id = new.account_id;
  end if;
  return new;
end $$;
revoke all on function public._casts_rod_id() from public, anon, authenticated;
drop trigger if exists casts_rod_id on public.casts;
create trigger casts_rod_id before insert on public.casts for each row execute function public._casts_rod_id();

-- ---------- C. The profile (0012_v14_fishing.sql's _fishing_profile, verbatim but for the lines marked 0115) ----------
create or replace function public._fishing_profile(p_account uuid) returns public.fishing_profiles
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.fishing_profiles;
begin
  insert into public.fishing_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into v from public.fishing_profiles where account_id = p_account for update;
  -- 0115 {
  -- a new profile gets its Cần gỗ instance, equipped
  if v.rod_id is null then
    update public.fishing_profiles set rod_id = public._rod_kit(p_account) where account_id = p_account;
    perform public._rod_sync(p_account);
    select * into v from public.fishing_profiles where account_id = p_account;
  end if;
  -- 0115 }
  return v;
end; $$;
revoke all on function public._fishing_profile(uuid) from public, anon, authenticated;

-- ---------- E. Old data → instances (once per profile; see the header) ----------
-- 1. every owned rod row becomes instances (moved: the rows go, so a re-run adds none)
insert into public.rods (account_id, item_id, durability, legacy)
select i.account_id, i.item_id, least(coalesce(i.durability, s.durability), s.durability), true
  from public.inventory i join public.shop_items s on s.id = i.item_id
  cross join lateral generate_series(1, greatest(i.qty, 0)) g
 where s.kind = 'rod' and s.id <> 'rod_wood' and i.qty >= 1;
delete from public.inventory i using public.shop_items s where s.id = i.item_id and s.kind = 'rod';

-- 2. each profile not yet moved: the equipped instance and its parts
do $$
declare p public.fishing_profiles; v_eq bigint; v_kit boolean; v_slot text; v_item text; it public.shop_items;
        v_qty integer; v_d integer;
begin
  for p in select * from public.fishing_profiles where rod_id is null order by account_id for update loop
    v_eq := null;
    if coalesce(p.rod, 'rod_wood') <> 'rod_wood' then
      select id into v_eq from public.rods where account_id = p.account_id and item_id = p.rod and legacy
                                            and coalesce(durability, 1) > 0 order by id limit 1;
    end if;
    v_kit := v_eq is null;
    if v_kit then v_eq := public._rod_kit(p.account_id); else perform public._rod_kit(p.account_id); end if;
    foreach v_slot in array array['bobber', 'hook', 'line', 'reel'] loop
      v_item := case v_slot when 'bobber' then p.bobber when 'hook' then p.hook when 'line' then p.line else p.reel end;
      continue when v_item is null or (v_kit and v_slot <> 'bobber');
      select * into it from public.shop_items where id = v_item and kind = v_slot;
      continue when not found;
      v_d := null;
      if not it.starter then
        update public.inventory set qty = qty - 1
         where account_id = p.account_id and item_id = v_item and qty >= 1 and coalesce(durability, 1) > 0
        returning qty, durability into v_qty, v_d;
        continue when not found;
        if v_qty = 0 then delete from public.inventory where account_id = p.account_id and item_id = v_item;
        elsif v_slot = 'line' then update public.inventory set durability = null where account_id = p.account_id and item_id = v_item;
        end if;
      end if;
      insert into public.rod_parts (rod_id, slot, item_id, durability)
      values (v_eq, v_slot, v_item, case when v_slot = 'line' then least(coalesce(v_d, it.durability), it.durability) end)
      on conflict (rod_id, slot) do update set item_id = excluded.item_id, durability = excluded.durability, mounted_at = now();
    end loop;
    update public.fishing_profiles set rod_id = v_eq where account_id = p.account_id;
    perform public._rod_sync(p.account_id);
  end loop;
end $$;

-- ---------- D. The RPCs ----------
create or replace function public.rod_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  perform public._fishing_profile(v_account);
  return jsonb_build_object('rods', public._rod_list_json(v_account));
end $$;
revoke all on function public.rod_list(text) from public;
grant execute on function public.rod_list(text) to anon, authenticated;

-- My rod p_rod, locked (after the profile's lock: every rod writer takes the profile first).
create or replace function public._rod_mine(p_account uuid, p_rod bigint) returns public.rods
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare ro public.rods;
begin
  select * into ro from public.rods where id = p_rod and account_id = p_account for update;
  if not found then raise exception 'rod not found' using errcode = '22023'; end if;
  return ro;
end $$;
revoke all on function public._rod_mine(uuid, bigint) from public, anon, authenticated;

-- Mount one unit of p_item from the bag into p_rod's p_slot, bound for good. An occupied slot's part is destroyed
-- (the client asks first: "Lưỡi cũ sẽ bị bỏ"). The kit's hook / line / reel are fixed.
create or replace function public.rod_mount(p_session_token text, p_rod bigint, p_slot text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.fishing_profiles; ro public.rods;
        it public.shop_items; v_qty integer; v_d integer; v_old text;
begin
  p := public._fishing_profile(v_account);
  if p_slot is null or p_slot not in ('hook', 'line', 'reel', 'bobber') then
    raise exception 'bad slot' using errcode = '22023';
  end if;
  select * into it from public.shop_items where id = p_item;
  if not found or it.kind <> p_slot then raise exception 'item not available' using errcode = '22023'; end if;
  ro := public._rod_mine(v_account, p_rod);
  if ro.item_id = 'rod_wood' and p_slot <> 'bobber' then raise exception 'rod fixed' using errcode = '22023'; end if;
  if not it.starter then
    update public.inventory set qty = qty - 1
     where account_id = v_account and item_id = it.id and qty >= 1 and coalesce(durability, 1) > 0
    returning qty, durability into v_qty, v_d;
    if not found then raise exception 'item not available' using errcode = '22023'; end if;
    if v_qty = 0 then
      delete from public.inventory where account_id = v_account and item_id = it.id;
    elsif p_slot = 'line' then
      update public.inventory set durability = null where account_id = v_account and item_id = it.id;   -- the worn one went first
    end if;
  end if;
  select item_id into v_old from public.rod_parts where rod_id = ro.id and slot = p_slot;
  insert into public.rod_parts (rod_id, slot, item_id, durability)
  values (ro.id, p_slot, it.id, case when p_slot = 'line' then least(coalesce(v_d, it.durability), it.durability) end)
  on conflict (rod_id, slot) do update set item_id = excluded.item_id, durability = excluded.durability, mounted_at = now();
  perform public._rod_sync(v_account);
  return jsonb_build_object('destroyed', v_old, 'rods', public._rod_list_json(v_account),
                            'state', public._fishing_state(v_account));
end $$;
revoke all on function public.rod_mount(text, bigint, text, text) from public;
grant execute on function public.rod_mount(text, bigint, text, text) to anon, authenticated;

-- Take a part off: it is destroyed (bound parts never return to the bag). The kit's built-in parts are fixed.
create or replace function public.rod_unmount(p_session_token text, p_rod bigint, p_slot text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); ro public.rods; v_old text;
begin
  perform public._fishing_profile(v_account);
  if p_slot is null or p_slot not in ('hook', 'line', 'reel', 'bobber') then
    raise exception 'bad slot' using errcode = '22023';
  end if;
  ro := public._rod_mine(v_account, p_rod);
  if ro.item_id = 'rod_wood' and p_slot <> 'bobber' then raise exception 'rod fixed' using errcode = '22023'; end if;
  delete from public.rod_parts where rod_id = ro.id and slot = p_slot returning item_id into v_old;
  if v_old is null then raise exception 'slot empty' using errcode = '22023'; end if;
  perform public._rod_sync(v_account);
  return jsonb_build_object('destroyed', v_old, 'rods', public._rod_list_json(v_account),
                            'state', public._fishing_state(v_account));
end $$;
revoke all on function public.rod_unmount(text, bigint, text) from public;
grant execute on function public.rod_unmount(text, bigint, text) to anon, authenticated;

-- Equip a rod (null: the kit). A broken one is refused; a bare one may be equipped (start_* say 'rod needs parts').
create or replace function public.rod_equip(p_session_token text, p_rod bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); ro public.rods;
begin
  perform public._fishing_profile(v_account);
  if p_rod is null then p_rod := public._rod_kit(v_account); end if;
  ro := public._rod_mine(v_account, p_rod);
  if coalesce(ro.durability, 1) <= 0 then raise exception 'rod broken' using errcode = '22023'; end if;
  update public.fishing_profiles set rod_id = ro.id where account_id = v_account;
  perform public._rod_sync(v_account);
  return jsonb_build_object('rods', public._rod_list_json(v_account), 'state', public._fishing_state(v_account));
end $$;
revoke all on function public.rod_equip(text, bigint) from public;
grant execute on function public.rod_equip(text, bigint) to anon, authenticated;

-- A rod's own name (1–24 printable characters; empty: none).
create or replace function public.rod_rename(p_session_token text, p_rod bigint, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); ro public.rods; v_name text;
begin
  perform public._fishing_profile(v_account);
  ro := public._rod_mine(v_account, p_rod);
  v_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g')), '');
  if char_length(v_name) > 24 then raise exception 'name too long' using errcode = '22023'; end if;
  update public.rods set name = v_name where id = ro.id;
  return jsonb_build_object('rods', public._rod_list_json(v_account), 'state', public._fishing_state(v_account));
end $$;
revoke all on function public.rod_rename(text, bigint, text) from public;
grant execute on function public.rod_rename(text, bigint, text) to anon, authenticated;

-- Throw a rod away with its bound parts (no refund). Not the kit, not the equipped one.
create or replace function public.rod_scrap(p_session_token text, p_rod bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.fishing_profiles; ro public.rods;
begin
  p := public._fishing_profile(v_account);
  ro := public._rod_mine(v_account, p_rod);
  if ro.item_id = 'rod_wood' then raise exception 'rod fixed' using errcode = '22023'; end if;
  if ro.id = p.rod_id then raise exception 'rod equipped' using errcode = '22023'; end if;
  delete from public.rods where id = ro.id;
  return jsonb_build_object('rods', public._rod_list_json(v_account), 'state', public._fishing_state(v_account));
end $$;
revoke all on function public.rod_scrap(text, bigint) from public;
grant execute on function public.rod_scrap(text, bigint) to anon, authenticated;

-- Repair one instance back to its max for _repair_price (30 % of the rod's price), paid via _pay('repair').
create or replace function public._rod_repair(p_account uuid, p_rod bigint) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare w public.wallets; ro public.rods; it public.shop_items; v_cost integer;
begin
  w := public._wallet_lock(p_account);
  perform public._fishing_profile(p_account);
  ro := public._rod_mine(p_account, p_rod);
  select * into it from public.shop_items where id = ro.item_id;
  if it.durability is null or it.price is null or ro.durability is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if ro.durability >= it.durability then raise exception 'not worn' using errcode = '22023'; end if;
  v_cost := public._repair_price(it.price);
  if w.coins < v_cost then raise exception 'not enough coins' using errcode = '22023'; end if;
  perform public._pay(p_account, -v_cost, 'repair', it.id || ' #' || ro.id);
  update public.rods set durability = it.durability where id = ro.id;
  return jsonb_build_object('cost', v_cost, 'rods', public._rod_list_json(p_account), 'state', public._fishing_state(p_account));
end $$;
revoke all on function public._rod_repair(uuid, bigint) from public, anon, authenticated;

create or replace function public.rod_repair(p_session_token text, p_rod bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._rod_repair(v_account, p_rod);
end $$;
revoke all on function public.rod_repair(text, bigint) from public;
grant execute on function public.rod_repair(text, bigint) to anon, authenticated;

-- 0034's repair_rod(item): the equipped instance of that model if worn, else its most worn one.
create or replace function public.repair_rod(p_session_token text, p_item_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_rod bigint;
begin
  select r.id into v_rod from public.rods r join public.shop_items s on s.id = r.item_id
    left join public.fishing_profiles p on p.account_id = r.account_id
   where r.account_id = v_account and r.item_id = p_item_id and r.durability < s.durability
   order by r.id = p.rod_id desc, r.durability, r.id limit 1;
  if v_rod is null then
    if exists (select 1 from public.rods where account_id = v_account and item_id = p_item_id and durability is not null) then
      raise exception 'not worn' using errcode = '22023';
    end if;
    raise exception 'item not available' using errcode = '22023';
  end if;
  return public._rod_repair(v_account, v_rod);
end $$;
revoke all on function public.repair_rod(text, text) from public;
grant execute on function public.repair_rod(text, text) to anon, authenticated;

-- 0110's fishing_equip: 'rod' equips an instance of that model (the equipped one stays, else the best kept), null /
-- rod_wood the kit; 'bait' as before; the part slots are per rod now ('rod build': rod_mount / rod_unmount).
create or replace function public.fishing_equip(p_session_token text, p_slot text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.fishing_profiles; it public.shop_items; v_rod bigint;
begin
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if p_slot is null or p_slot not in ('rod', 'hook', 'line', 'reel', 'bobber', 'bait') then
    raise exception 'bad slot' using errcode = '22023';
  end if;
  if p_slot in ('hook', 'line', 'reel', 'bobber') then raise exception 'rod build' using errcode = '22023'; end if;
  if p_slot = 'bait' then
    select * into it from public.shop_items where id = p_item;
    if p_item is null or not found or it.kind <> 'bait' then raise exception 'item not available' using errcode = '22023'; end if;
    update public.fishing_profiles set bait = p_item where account_id = v_account;
  else
    if coalesce(p_item, 'rod_wood') = 'rod_wood' then
      v_rod := public._rod_kit(v_account);
    else
      select r.id into v_rod from public.rods r where r.account_id = v_account and r.item_id = p_item
       order by r.id = p.rod_id desc, coalesce(r.durability, 1) > 0 desc, r.durability desc nulls first, r.id limit 1;
      if v_rod is null then raise exception 'item not available' using errcode = '22023'; end if;
      if not exists (select 1 from public.rods where id = v_rod and coalesce(durability, 1) > 0) then
        raise exception 'rod broken' using errcode = '22023';
      end if;
    end if;
    update public.fishing_profiles set rod_id = v_rod where account_id = v_account;
    perform public._rod_sync(v_account);
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end $$;
revoke all on function public.fishing_equip(text, text, text) from public;
grant execute on function public.fishing_equip(text, text, text) to anon, authenticated;

-- The mailbox may carry rods (instances on claim) and parts (stackable) — 0111's list plus 'rod' and the parts.
create or replace function public._mail_gift_kinds() returns text[]
language sql immutable parallel safe
as $$ select array['bait', 'seed', 'fertilizer', 'pesticide', 'ammo', 'pet_food', 'rod', 'hook', 'line', 'reel', 'bobber'] $$;   -- 0115 was: as $$ select array['bait', 'seed', 'fertilizer', 'pesticide', 'ammo', 'pet_food'] $$;
revoke all on function public._mail_gift_kinds() from public, anon, authenticated;

-- ---------- The state (0110_fishing_v3.sql's _fishing_state, verbatim but for the lines marked 0115) ----------
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
    'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', case when p.account_id is null then 'bobber_feather' else p.bobber end,   -- 0110 was: 'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', coalesce(p.bobber, 'bobber_feather'),
                                  'bait', coalesce(p.bait, 'bait_worm'), 'hook', p.hook, 'line', p.line, 'reel', p.reel),   -- 0110 was: 'bait', coalesce(p.bait, 'bait_worm')),
    'owned', coalesce((select jsonb_agg(i.item_id order by s.kind, s.sort_order)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('rod','bobber','bait_box','bucket','net','hook','line','reel','fishbook')),   -- 0110 was: and s.kind in ('rod','bobber','bait_box','bucket','net')),              -- v18.2: nets
                      '[]'::jsonb),
    'wear', coalesce((select jsonb_object_agg(i.item_id, jsonb_build_array(i.durability, s.durability))   -- v18.2
                        from public.inventory i join public.shop_items s on s.id = i.item_id
                       where i.account_id = p_account and i.qty >= 1 and i.durability is not null
                         and s.kind in ('rod', 'net', 'line')), '{}'::jsonb),   -- 0110 was: and s.kind in ('rod', 'net')), '{}'::jsonb),
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
    'groundbait', (select jsonb_object_agg(s.id, coalesce(i.qty, 0)) from public.shop_items s   -- 0110
                     left join public.inventory i on i.item_id = s.id and i.account_id = p_account where s.kind = 'groundbait'),   -- 0110
    'groundbait_on', (select jsonb_build_object('item', g.item, 'map', g.map, 'x', g.x, 'y', g.y, 'until', g.expires_at)   -- 0110
                        from public.fishing_groundbait g where g.account_id = p_account and g.expires_at > now()),   -- 0110
    'notebook', public._owns(p_account, 'fishbook'),   -- 0110
    'rig', public._fishing_rig(p_account),   -- 0110
    'rod_id', p.rod_id,   -- 0115
    'rods', public._rod_list_json(p_account),   -- 0115
    'parts', coalesce((select jsonb_object_agg(i.item_id, i.qty) from public.inventory i join public.shop_items s on s.id = i.item_id   -- 0115
                        where i.account_id = p_account and i.qty >= 1 and s.kind in ('hook', 'line', 'reel', 'bobber')), '{}'::jsonb),   -- 0115
    'lock', public._ac_lock_state(p_account)
  );
end; $$;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- ---------- The shop (0110_fishing_v3.sql's buy_item, verbatim but for the lines marked 0115) ----------
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
  if it.kind not in ('rod','bobber','bait','bait_box','bucket','net','fishing_kit','hook','line','reel','groundbait','fishbook') then   -- 0110 was: if it.kind not in ('rod','bobber','bait','bait_box','bucket','net','fishing_kit') then      -- v18.2: nets; kit
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if (it.kind in ('bait', 'groundbait') and (p_qty is null or p_qty < 1 or p_qty > 99)) or (it.kind not in ('bait', 'groundbait') and p_qty is distinct from 1) then   -- 0110 was: if (it.kind = 'bait' and (p_qty is null or p_qty < 1 or p_qty > 99)) or (it.kind <> 'bait' and p_qty is distinct from 1) then
    return public._ac_flag(v_account, 'bad_qty', 'buy_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  -- 0110 {
  -- a groundbait: bags, at most 99 of a kind (the bait box does not hold them)
  if it.kind = 'groundbait' then
    if coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + p_qty > 99 then
      raise exception 'groundbait full' using errcode = '22023';
    end if;
    v_cost := it.price * p_qty;
    if w.coins < v_cost then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -v_cost, 'buy', it.id || ' x' || p_qty);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  -- 0110 }
  -- 0115 {
  -- a rod: a new bare instance in the bag (never equipped by the buy); a part: one more in the stackable bag (≤ 99)
  elsif it.kind = 'rod' then
    if (select count(*) from public.rods where account_id = v_account) >= 20 then
      raise exception 'bag full' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    perform public._rod_add(v_account, it.id);
  elsif it.kind in ('hook', 'line', 'reel', 'bobber') then
    if coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + 1 > 99 then
      raise exception 'bag full' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, 1)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + 1;
  -- 0115 }
  elsif it.kind = 'bait' then   -- 0110 was: if it.kind = 'bait' then
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
      if it.price > coalesce(v_equipped, 0) and (it.kind <> 'rod' or it.hook_class is not null or (p.hook is not null and p.line is not null)) then   -- 0110 was: if it.price > coalesce(v_equipped, 0) then
        if it.kind = 'rod' then
          update public.fishing_profiles set rod = it.id where account_id = v_account;
        else
          update public.fishing_profiles set bobber = it.id where account_id = v_account;
        end if;
      end if;
    end if;
    -- 0110 {
    -- a part fills its empty slot right away (a bare rod above waits for its hook and line)
    if it.kind = 'hook' and p.hook is null then
      update public.fishing_profiles set hook = it.id where account_id = v_account;
    elsif it.kind = 'line' and p.line is null then
      update public.fishing_profiles set line = it.id where account_id = v_account;
    elsif it.kind = 'reel' and p.reel is null then
      update public.fishing_profiles set reel = it.id where account_id = v_account;
    end if;
    -- 0110 }
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

-- ---------- The catch (0113_review_fixes.sql's 6-argument finish_cast, verbatim but for the lines marked 0115) ----------
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,
                                              p_hooked boolean default false,
                                              p_inputs integer[] default null,             -- 0046: the toggle ticks
                                              p_ticks integer default null) returns jsonb  -- 0046: the tick it ended on
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
        v_out jsonb; v_rod text; v_vit public.vitals;                                     -- v18.1
        v_broke boolean := false;                                                         -- v18.2
        v_bad text; v_replay jsonb;                                                       -- 0046
        v_hooked boolean; v_t jsonb;                                                      -- 0059
        v_limit integer; v_line_gone boolean; e jsonb; xs public.fish_species; v_xid uuid; v_xp integer;   -- 0110
        v_extra jsonb := '[]'::jsonb;   -- 0110
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  v_hooked := c.hooked_at is not null;                                                    -- 0059: the server's hook (p_hooked is ignored)
  -- 0046: a won reel is replayed from the cast's seed and params; the client's word alone lands nothing
  if coalesce(p_success, false) and c.reel_seed is not null and p_inputs is not null and p_ticks is not null then
    v_bad := public._reel_input_error(p_inputs, p_ticks);
    if v_bad is null then
      v_replay := public._reel_replay(c.reel_params, c.reel_seed, p_inputs);
    end if;
  end if;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not c.bites then                                                                  -- v18.1: nothing bit
    v_why := 'no_bite';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
    if v_hooked and c.big then                                                            -- 0059 was: if coalesce(p_hooked, false) and c.big and now() >= c.bite_at then                   -- v18.1: pulled in
      v_why := 'overboard';
    end if;
  elsif c.reel_seed is null or p_inputs is null or p_ticks is null then                     -- 0046: a page before the replay
    v_why := 'outdated';
  elsif not v_hooked then                                                                 -- 0059: a won reel needs the hook
    v_why := 'reel_invalid';                                                              -- 0059
    v_ac := public._ac_flag(v_account, 'reel_unhooked', 'finish_cast',                   -- 0059
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'ticks', p_ticks), c.room_id);   -- 0059
  elsif v_bad is not null then                                                            -- 0046: input no reel can make
    v_why := 'reel_invalid';
    v_ac := public._ac_flag(v_account, 'reel_bad_input', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'error', v_bad, 'ticks', p_ticks,
                                 'toggles', cardinality(p_inputs), 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif v_replay->>'outcome' is distinct from 'caught' or (v_replay->>'ticks')::int <> p_ticks then   -- 0046
    v_why := 'reel_invalid';                                                              -- the reel did not land it
    v_ac := public._ac_flag(v_account, 'reel_mismatch', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'seed', c.reel_seed, 'params', c.reel_params,
                                 'claimed_ticks', p_ticks, 'replay', v_replay, 'toggles', cardinality(p_inputs),
                                 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif now() < c.hooked_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then   -- 0059 was: elsif now() < c.bite_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then
    -- the existing gate, and (0046) no sooner in real time than the replayed ticks took
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3),
                                 'ticks', p_ticks),                                       -- 0046
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  -- 0059 {
  -- a won reel's timing: flips faster than a finger, or a metronome (soft); the 5th within 24 h voids the catch (hard)
  if v_why is null then
    v_t := public._reel_timing(p_inputs);
    if public._reel_timing_suspect(v_t) then
      perform public._ac_flag(v_account, 'reel_timing', 'finish_cast',
                jsonb_build_object('cast_id', c.id, 'timing', v_t, 'ticks', p_ticks, 'inputs', to_jsonb(p_inputs[1:200])),
                c.room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'reel_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_why := 'reel_invalid';
        v_ac := public._ac_flag(v_account, 'reel_timing_repeat', 'finish_cast',
                  jsonb_build_object('cast_id', c.id, 'timing', v_t, 'pattern', '5 in 24 h'), c.room_id);
      end if;
    end if;
  end if;
  -- 0059 }
-- 0113 was:   -- 0065 {
-- 0113 was:   -- a hooked reel is a round: won when caught, exact when never out of the zone (the replay's fewest ticks)
-- 0113 was:   if v_hooked and c.bites then
-- 0113 was:     perform public._ac_stat(v_account, 'reel', 1, case when v_why is null then 1 else 0 end,
-- 0113 was:                             case when v_why is null and p_ticks <= ceil(c.min_reel_ms * 0.06) + 2 then 1 else 0 end);
-- 0113 was:   end if;
-- 0113 was:   -- 0065 }
  -- 0110 {
  -- a landed fish heavier than the rig holds breaks its weakest part: the line (line_snap) or the rod (rod_snap)
  v_limit := least(coalesce(c.line_g, 2147483647), coalesce(c.rod_g, 2147483647));
  if v_why is null and c.weight_g > v_limit then
    v_why := case when coalesce(c.line_g, 2147483647) <= coalesce(c.rod_g, 2147483647) then 'line_snap' else 'rod_snap' end;
  end if;
  -- 0110 }
  -- 0113 {
  -- the reel's round (0065's block, moved below the snap: a snapped fish is a lost round, never won / exact)
  if v_hooked and c.bites then
    perform public._ac_stat(v_account, 'reel', 1, case when v_why is null then 1 else 0 end,
                            case when v_why is null and p_ticks <= ceil(c.min_reel_ms * 0.06) + 2 then 1 else 0 end);
  end if;
  -- 0113 }
  v_rod := coalesce(c.rod, 'rod_wood');                                                   -- v18.2 (was in the branch below)
  if v_why = 'overboard' then                                                             -- v18.1: the fall's cost
    v_out := public._overboard_outcome(v_rod, random());
    perform public._rod_inst_wear(v_account, c.rod_id, v_rod, (v_out->>'wear')::int);   -- 0115 was: perform public._rod_wear(v_account, v_rod, (v_out->>'wear')::int);
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - (v_out->>'hunger')::numeric)
     where account_id = v_account returning * into v_vit;
    v_broke := not public._rod_inst_usable(v_account, c.rod_id, v_rod);   -- 0115 was: v_broke := not public._rod_usable(v_account, v_rod);                                  -- v18.2
    if (v_out->>'rod_lost')::boolean then
      perform public._rod_lose(v_account, c.rod_id, v_rod);   -- 0115 was: delete from public.inventory where account_id = v_account and item_id = v_rod;
      -- 0115 was: update public.fishing_profiles set rod = 'rod_wood' where account_id = v_account and rod = v_rod;
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
    perform public._rod_inst_wear(v_account, c.rod_id, v_rod, 1);   -- 0115 was: perform public._rod_wear(v_account, v_rod, 1);
    v_broke := not public._rod_inst_usable(v_account, c.rod_id, v_rod);   -- 0115 was: v_broke := not public._rod_usable(v_account, v_rod);
  end if;
  -- 0110 {
  -- the snap's cost: the rod to 0 (unequipped, repairable), or one of the line's snaps (the last one: gone)
  if v_why = 'rod_snap' then
    perform public._rod_inst_wear(v_account, c.rod_id, v_rod, 1000000);   -- 0115 was: perform public._rod_wear(v_account, v_rod, 1000000);
    v_broke := not public._rod_inst_usable(v_account, c.rod_id, v_rod);   -- 0115 was: v_broke := not public._rod_usable(v_account, v_rod);
  elsif v_why = 'line_snap' then
    v_line_gone := public._rod_line_wear(v_account, c.rod_id, v_rod, c.line);   -- 0115 was: v_line_gone := public._line_wear(v_account, c.line);
  end if;
  -- 0110 }
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'rod_broke', v_broke,        -- v18.2: rod_broke
                              'state', public._fishing_state(v_account))
           || case when v_why = 'outdated' then jsonb_build_object('message', 'Cập nhật trang để câu tiếp')   -- 0046
                   else '{}'::jsonb end
           || case when v_why in ('line_snap', 'rod_snap') then jsonb_build_object('snap', jsonb_build_object(   -- 0110
                'species_id', c.species_id, 'weight_g', c.weight_g, 'limit_g', v_limit,   -- 0110
                'line_gone', coalesce(v_line_gone, false))) else '{}'::jsonb end   -- 0110
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
  perform set_config('mt.catch', '1', true);                                        -- 0078: a verified catch
  perform set_config('mt.catch_room', coalesce(c.room_id::text, ''), true);   -- econ v2 (H: a battle counts its room's catches)
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  perform set_config('mt.catch', '', true);                                         -- 0078
  perform set_config('mt.catch_room', '', true);   -- econ v2
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  -- 0110 {
  -- the extra hooks' fish, rolled at the cast: each one the rig holds, while the bucket has room, priced like the first
  for e in select value from jsonb_array_elements(coalesce(c.extra, '[]'::jsonb)) loop
    exit when (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account);
    select * into xs from public.fish_species where id = e->>'species_id';
    continue when not found or (e->>'weight_g')::int > v_limit;
    v_xp := greatest(1, round(xs.price_per_kg * (e->>'weight_g')::int / 1000.0 * v_mult
                              * case when r.period is not null then public._fish_factor(c.room_id, xs.id, r.period) else 1 end)::int);
    perform set_config('mt.catch', '1', true);
    perform set_config('mt.catch_room', coalesce(c.room_id::text, ''), true);
    insert into public.fish (account_id, species_id, weight_g, price) values (v_account, xs.id, (e->>'weight_g')::int, v_xp)
    returning id into v_xid;
    perform set_config('mt.catch', '', true);
    perform set_config('mt.catch_room', '', true);
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, xs.id, (e->>'weight_g')::int, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at
      where public.personal_bests.weight_g < excluded.weight_g;
    v_extra := v_extra || jsonb_build_array(jsonb_build_object('id', v_xid, 'species_id', xs.id,
                 'weight_g', (e->>'weight_g')::int, 'price', v_xp, 'rarity', xs.rarity));
  end loop;
  -- 0110 }
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
    'extra', v_extra,   -- 0110
    'rod_broke', v_broke,                                                                 -- v18.2
    'state', public._fishing_state(v_account));
end; $$;

-- ---------- The claim (0111_mailbox.sql's _mail_claim_one, verbatim but for the lines marked 0115) ----------
create or replace function public._mail_claim_one(p_account uuid, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.mail; r record; v_n integer; v_bait integer; v_p2p boolean; v_skipped jsonb := '[]'::jsonb;
begin
  select * into m from public.mail where id = p_id and account_id = p_account and deleted_at is null for update;
  if not found then raise exception 'no mail' using errcode = '53400'; end if;
  if m.claimed_at is not null then raise exception 'already claimed' using errcode = '53400'; end if;
  if m.expires_at <= now() then raise exception 'mail expired' using errcode = '53400'; end if;
  perform public._wallet_lock(p_account);
  v_p2p := m.kind in ('trade', 'market', 'return');
  -- room, before anything moves
  select count(*) into v_n from public.mail_fish where mail_id = m.id;
  if v_n > 0 and (select count(*) from public.fish where account_id = p_account) + v_n > 1 + public._bucket_cap(p_account) then
    raise exception 'bucket full' using errcode = '53400';
  end if;
  select coalesce(sum(i.qty), 0) into v_bait from public.mail_items i join public.shop_items s on s.id = i.ref
   where i.mail_id = m.id and i.kind = 'item' and s.kind = 'bait';
  if v_bait > 0 and public._bait_total(p_account) + v_bait > public._bait_cap(p_account) then
    raise exception 'bait full' using errcode = '53400';
  end if;
  if exists (select 1 from public.mail_items i join public.shop_items s on s.id = i.ref
              where i.mail_id = m.id and i.kind = 'item' and s.kind not in ('bait', 'rod')   -- 0115 was: where i.mail_id = m.id and i.kind = 'item' and s.kind <> 'bait'
                and coalesce((select v.qty from public.inventory v where v.account_id = p_account and v.item_id = i.ref), 0) + i.qty > 99) then
    raise exception 'bag full' using errcode = '53400';
  end if;
  -- 0115 {
  if (select count(*) from public.rods where account_id = p_account)
     + coalesce((select sum(i.qty) from public.mail_items i join public.shop_items s on s.id = i.ref
                  where i.mail_id = m.id and i.kind = 'item' and s.kind = 'rod'), 0) > 20 then
    raise exception 'bag full' using errcode = '53400';
  end if;
  -- 0115 }
  if v_p2p and exists (select 1 from public.mail_items i where i.mail_id = m.id and i.kind = 'fashion'
                         and exists (select 1 from public.account_items a where a.account_id = p_account and a.item_id = i.ref)) then
    raise exception 'already owned' using errcode = '53400';
  end if;
  -- the move
  for r in select * from public.mail_items where mail_id = m.id order by id loop
    -- 0115 {
    -- a rod: that many instances in the bag
    if r.kind = 'item' and exists (select 1 from public.shop_items where id = r.ref and kind = 'rod') then
      perform public._rod_add(p_account, r.ref) from generate_series(1, r.qty);
    -- 0115 }
    elsif r.kind = 'item' then   -- 0115 was: if r.kind = 'item' then
      insert into public.inventory (account_id, item_id, qty) values (p_account, r.ref, r.qty)
      on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
    elsif r.kind = 'fashion' then
      insert into public.account_items (account_id, item_id, acquired_at) values (p_account, r.ref, now())
      on conflict (account_id, item_id) do nothing;
      if not found then v_skipped := v_skipped || jsonb_build_array(r.name); end if;   -- a gift already owned
    elsif r.kind = 'fish' then
      -- the same row back (same id, old caught_at): not a catch (mt.catch is not set)
      insert into public.fish (id, account_id, species_id, weight_g, price, caught_at)
      select f.id, p_account, f.species_id, f.weight_g, f.price, f.caught_at from public.mail_fish f
       where f.id = public._econ_uuid(r.ref) and f.mail_id = m.id;
      if not found then raise exception 'asset gone' using errcode = '53400'; end if;
      delete from public.mail_fish where id = public._econ_uuid(r.ref);
    elsif r.kind = 'produce' then
      insert into public.produce_stock (account_id, upland, kg) values (p_account, r.ref, r.qty)
      on conflict (account_id, upland) do update set kg = public.produce_stock.kg + excluded.kg;
    end if;
  end loop;
  if m.xu > 0 then
    perform public._pay(p_account, m.xu, m.xu_reason, 'mail #' || m.id);
  end if;
  update public.mail set claimed_at = now(), read_at = coalesce(read_at, now()) where id = m.id;
  return jsonb_build_object('id', m.id, 'xu', m.xu, 'items', public._mail_items_json(m.id), 'skipped', v_skipped);
end $$;
revoke all on function public._mail_claim_one(uuid, bigint) from public, anon, authenticated;
