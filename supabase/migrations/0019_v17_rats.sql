-- =========================================================
-- 0019_v17_rats.sql — v17 "Mùa chuột" (docs/superpowers/specs/2026-09-26-music-together-v17-rats-design.md): field
-- rats that come out of the bunds and eat ripe plots, the slingshot (ná) and its clay pellets, and the dog (chó cỏ) that
-- follows its owner and pounces on a rat every 5 minutes. Caught rats are sold to cô Út at the room's fish multiplier.
-- ADDITIVE (no data drop) and re-runnable. Requires 0013, 0015, 0016, 0017 and 0018: it re-creates functions they last
-- defined, each from its latest body with only the lines marked "v17" added (anti-cheat spec §11.3 rules 1 and 3). Every
-- function relies on `set search_path = public, extensions`. Time rules live in private functions that take p_now; the
-- public RPCs pass now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Catalog (§5.2, §8, C1) ----------
-- Rat food (D4): rice by its kind; of the hoa màu, khoai and bắp. Ớt never.
alter table public.upland_crops add column if not exists rat_food boolean not null default false;
update public.upland_crops set rat_food = true where id in ('khoai', 'bap');

-- The kinds in force after 0018 plus the pellets and the dog food (§16).
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food'));

-- anh Hai's three new items (§8, D29): the ná is a tool, bought once; pellets and food stack to 99.
insert into public.shop_items (id, kind, name, price, starter, sort_order) values
  ('tool_sling',  'tool',     'Ná',          3000, false, 30),
  ('ammo_pellet', 'ammo',     'Đạn đất',       10, false, 10),
  ('food_dog',    'pet_food', 'Thức ăn chó',  150, false, 20)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order;

-- The 21 reasons in force after 0018 plus the rat sale and the adoption (C1): 23. Anti-cheat §11.3 rule 4 keeps 'wipe'.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt'));

-- ---------- B. Tables (§10.2; private: RLS on, no policies — only the RPCs touch them) ----------
-- A crop's rats (D6): [{r, from, to}], one entry per rat that ate it; the entry opens at the sweep that found the rat.
alter table public.crops add column if not exists rat_log jsonb not null default '[]'::jsonb;

-- The room's rats: one per spawn candidate k (D1), alive while ended_at is null.
create table if not exists public.field_rats (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  plot_no smallint not null check (plot_no between 1 and 10),
  k bigint not null,
  seed integer not null,
  spawned_at timestamptz not null,
  ended_at timestamptz,
  how text check (how in ('sling', 'dog', 'fled')),
  caught_by uuid references public.accounts(id) on delete set null,
  price integer check (price > 0),
  unique (room_id, k)
);
create index if not exists idx_field_rats_room on public.field_rats (room_id, ended_at);

-- The last spawn candidate a room's sweep has evaluated (§5.3).
create table if not exists public.rat_clocks (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  last_k bigint not null
);

-- Caught rats, each at the price fixed at its catch (D11, D12), until cô Út buys them.
create table if not exists public.rat_bag (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  price integer not null check (price > 0),
  caught_at timestamptz not null,
  how text not null check (how in ('sling', 'dog'))
);
create index if not exists idx_rat_bag_account on public.rat_bag (account_id);

-- One dog per account (D22): named by its owner, fed daily, resting 5 minutes after a catch.
create table if not exists public.dogs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 16),
  coat text not null check (coat in ('vang', 'muc', 'ven', 'dom')),
  adopted_at timestamptz not null,
  fed_until timestamptz,
  next_hunt_at timestamptz,
  catches integer not null default 0 check (catches >= 0)
);

-- The slingshot's aim (D14): one per account, bound to a room and a rat.
create table if not exists public.sling_aims (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  rat_id bigint not null,
  started_at timestamptz not null,
  last_shot_at timestamptz,
  shots smallint not null default 0
);

alter table public.field_rats enable row level security;
alter table public.rat_clocks enable row level security;
alter table public.rat_bag enable row level security;
alter table public.dogs enable row level security;
alter table public.sling_aims enable row level security;
revoke all on public.field_rats, public.rat_clocks, public.rat_bag, public.dogs, public.sling_aims from anon, authenticated;

-- The catch caps (D13): the hourly window and the Vietnam day of each account.
alter table public.farm_profiles add column if not exists rat_win_start timestamptz;
alter table public.farm_profiles add column if not exists rat_win_count smallint not null default 0;
alter table public.farm_profiles add column if not exists rat_day_on date;
alter table public.farm_profiles add column if not exists rat_day_count smallint not null default 0;

-- ---------- C. The model (§5.2–§5.5, §7.1; private) ----------
-- u(k, s) in [0, 1): the first 32 bits of md5(room:k:s) (§5.3).
create or replace function public._rat_u(p_room uuid, p_k bigint, p_s text) returns double precision
language sql immutable set search_path = public, extensions
as $$ select (('x' || left(md5(p_room::text || ':' || p_k::text || ':' || p_s), 8))::bit(32)::bigint)::double precision / 4294967296 $$;

-- t(k): candidate k of a room is due at k·900 s + floor(u(k, 't')·300) s, whole seconds (D1).
create or replace function public._rat_t(p_room uuid, p_k bigint) returns timestamptz
language sql immutable set search_path = public, extensions
as $$ select to_timestamp((p_k * 900)::double precision + floor(public._rat_u(p_room, p_k, 't') * 300)) $$;

-- k(t): the last candidate due at or before t.
create or replace function public._rat_k(p_room uuid, p_t timestamptz) returns bigint
language sql stable set search_path = public, extensions
as $$
  select case when public._rat_t(p_room, x.k0) <= p_t then x.k0 else x.k0 - 1 end
    from (select floor(extract(epoch from p_t) / 900)::bigint as k0) x
$$;

-- Rat-hours of a crop's log at t (§5.5): each entry with from < t counts hrs(from, min(to ?? t, t)), added in log order
-- (lib/game/farm/rats.ts ratHours adds in the same order).
create or replace function public._rat_hours(p_log jsonb, p_t timestamptz) returns double precision
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; v_h double precision := 0; v_from timestamptz;
begin
  for e in select x from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) with ordinality w(x, n) order by n loop
    v_from := (e->>'from')::timestamptz;
    if v_from < p_t then
      v_h := v_h + public._hrs(v_from, least(coalesce((e->>'to')::timestamptz, p_t), p_t));
    end if;
  end loop;
  return v_h;
end $$;

-- Mrat = 1 − min(0.10, 0.02 · rat-hours) (D6).
create or replace function public._rat_factor(p_h double precision) returns double precision
language sql immutable set search_path = public, extensions
as $$ select 1 - least(0.10::double precision, 0.02::double precision * p_h) $$;

-- Closes a rat's open entry at t (never before it opened); the other entries stay as they are.
create or replace function public._rat_close(p_log jsonb, p_rat bigint, p_t timestamptz) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(case when (w.x->>'r')::bigint = p_rat and w.x->'to' = 'null'::jsonb
                                 then jsonb_set(w.x, '{to}', to_jsonb(greatest(p_t, (w.x->>'from')::timestamptz)))
                                 else w.x end order by w.n), '[]'::jsonb)
    from jsonb_array_elements(p_log) with ordinality w(x, n)
$$;

-- Is the crop rat food at t (§5.2)? Rice ripe or overripe with no harvester job started; khoai and bắp ripe or overripe.
create or replace function public._rat_food(c public.crops, p_t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare u public.upland_crops;
begin
  if c.kind = 'rice' then
    return public._crop_phase(c, public._variety(c.variety), p_t) in ('ripe', 'overripe')
       and not (c.harvester_at is not null and p_t >= c.harvester_at);
  end if;
  u := public._upland(c.upland);
  return coalesce(u.rat_food, false) and public._up_phase(c, u, p_t) in ('ripe', 'overripe');
end $$;

-- A dog's name (§7.1, D20): register's rules (0015) with 2–16 characters — NFC, trimmed, single spaces, no control,
-- odd-space, invisible or combining character, no reserved key. lib/game/dog.ts dogNameRefusal mirrors it.
create or replace function public._pet_name(p_name text) returns text
language plpgsql stable set search_path = public, extensions
as $$
declare v text := regexp_replace(btrim(normalize(coalesce(p_name, ''), NFC)), ' {2,}', ' ', 'g');
begin
  if char_length(v) not between 2 and 16
     or v ~ '[\u0001-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]'
     or public._name_key(v) in ('aoca', 'hoptacxa', 'hethong', 'quantri', 'quantrivien', 'admin', 'root', 'system') then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  return v;
end $$;

-- The harvest in kg (0013's body, §8.6), with its factors for tests and the plot panel; v17: Mrat, the rats' share at
-- p_now, is the last factor of the product (§5.5), and the JSON gains mrat.
create or replace function public._crop_yield(c public.crops, v public.rice_varieties, p_land double precision,
                                              p_qh double precision, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; care jsonb := public._crop_care(c, v); pe jsonb; v_pen double precision := 0;
        v_mcare double precision; v_mseed double precision; v_mwater double precision; v_mpest double precision := 1;
        v_mlate double precision; v_x double precision; v_kg integer;
        v_mrat double precision;                                                          -- v17
begin
  if not (care->>'manure')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if not (care->>'phosphate')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  v_pen := v_pen + (care->>'td1')::double precision;
  v_pen := v_pen + (care->>'td2')::double precision;
  if not (care->>'phoi')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if (care->>'excess')::boolean then v_pen := v_pen + 0.10::double precision; end if;
  v_mcare := 1 - v_pen;
  v_mseed := 1 - least(0.3::double precision, 0.03 * greatest(0::double precision, public._hrs(c.soak_at, c.sow_at) - 8))
               - least(0.3::double precision, 0.03 * greatest(0::double precision, public._hrs(c.sow_at, c.transplant_at) - 14 * s));
  v_mwater := 1 - least(0.2::double precision, 0.01 * public._water_off_hours(c, v, p_now));
  for pe in select x from jsonb_array_elements(public._crop_pests(c, v, p_now)) x loop
    v_mpest := v_mpest * (1 - least(0.3::double precision, 0.015 * public._pest_hours(c, pe, p_now)));
  end loop;
  v_mlate := 1 - least(0.6::double precision,
                       0.02 * greatest(0::double precision, public._hrs(c.transplant_at, p_now) - (48 * s + 12)));
  v_mrat := public._rat_factor(public._rat_hours(c.rat_log, p_now));                  -- v17
  v_x := v.base_kg * p_land * v_mcare * v_mseed * v_mwater * v_mpest * v_mlate * c.q_transplant * p_qh * v_mrat;   -- v17: · Mrat
  v_kg := greatest((v.base_kg + 9) / 10, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mseed', v_mseed, 'mwater', v_mwater, 'mpest', v_mpest,
                            'mlate', v_mlate, 'mrat', v_mrat);                                -- v17: mrat
end; $$;

-- Picking k at p_now in kg (0016's body, v15.2 §8.7), with its factors: every factor at the picking time, the products
-- left to right; v17: Mrat right after Mlate, before · pct / 100 (§5.5, §16), and the JSON gains mrat.
create or replace function public._up_yield(c public.crops, u public.upland_crops, p_land double precision, p_k integer,
                                            p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare care jsonb := public._up_care(c, u); s jsonb; pe jsonb; v_pen double precision := 0; v_end timestamptz;
        v_mcare double precision; v_mplant double precision := 1; v_mwater double precision; v_mrot double precision := 1;
        v_mpest double precision := 1; v_mlate double precision; v_x double precision; v_pct integer; v_kg integer;
        v_mrat double precision;                                                          -- v17
begin
  if not (care->>'manure')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if not (care->>'phosphate')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  for s in select x from jsonb_array_elements(care->'scores') x loop
    v_pen := v_pen + (s #>> '{}')::double precision;
  end loop;
  if (care->>'excess')::boolean then v_pen := v_pen + 0.10::double precision; end if;
  v_mcare := 1 - v_pen;
  if u.method = 'nursery' then
    v_mplant := 1 - least(0.3::double precision,
                          0.03::double precision * greatest(0::double precision, public._hrs(c.sow_at, c.plant_at) - u.nursery_old_h));
  end if;
  v_mwater := 1 - least(0.2::double precision, 0.01::double precision * public._up_off_hours(c, u, p_now));
  if u.rot_from_h is not null then
    v_mrot := 1 - least(u.rot_cap, u.rot_rate * public._up_rot_hours(c, u, p_now));
  end if;
  for pe in select x from jsonb_array_elements(public._up_pests(c, u, p_now)) x loop
    v_end := coalesce((pe->>'treated_at')::timestamptz, p_now);
    v_mpest := v_mpest * (1 - least(0.3::double precision, 0.015::double precision
               * case when v_end <= (pe->>'since')::timestamptz then 0::double precision
                      else public._hrs((pe->>'since')::timestamptz, v_end) end));
  end loop;
  v_mlate := 1 - least(0.6::double precision, u.over_rate * greatest(0::double precision,
               public._hrs(public._plus_h(c.plant_at, public._up_hours(u, p_k) + u.ripe_window_h), p_now)));
  v_mrat := public._rat_factor(public._rat_hours(c.rat_log, p_now));                  -- v17
  v_pct := (u.pickings->>(p_k - 1))::int;
  v_x := (((((((((u.base_kg * p_land) * v_mcare) * v_mplant) * v_mwater) * v_mrot) * v_mpest) * v_mlate) * v_mrat) * v_pct) / 100;
  v_kg := greatest((u.base_kg * v_pct + 999) / 1000, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mplant', v_mplant, 'mwater', v_mwater, 'mrot', v_mrot,
                            'mpest', v_mpest, 'mlate', v_mlate, 'mrat', v_mrat);          -- v17: mrat
end; $$;

revoke all on function public._rat_u(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public._rat_t(uuid, bigint) from public, anon, authenticated;
revoke all on function public._rat_k(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_hours(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_factor(double precision) from public, anon, authenticated;
revoke all on function public._rat_close(jsonb, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_food(public.crops, timestamptz) from public, anon, authenticated;
revoke all on function public._pet_name(text) from public, anon, authenticated;
revoke all on function public._crop_yield(public.crops, public.rice_varieties, double precision, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._up_yield(public.crops, public.upland_crops, double precision, integer, timestamptz)
  from public, anon, authenticated;
