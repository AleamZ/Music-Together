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

-- ---------- D. The field (§5.3, §5.6, §10.3, §10.5) ----------
-- The rats' lazy clock (§5.3), run by _field_open after _field_sweep, under the room's plot locks. It locks rat and crop
-- rows only, never the fish price index (v15.3 R12). R1: a live rat whose crop no longer carries its entry, or is no
-- longer rat food, flees, and its entry closes. R2: rats ended more than an hour ago go. R3: each candidate k after the
-- room's last_k and inside the last 30 minutes spawns a rat on a food plot while fewer than 3 are alive; a rat found late
-- keeps spawned_at = t(k) (its path) but eats only from this sweep (D3). A far-future last_k switches the room's rats off.
create or replace function public._rat_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.field_rats; c public.crops; v_found boolean; v_last bigint; v_hi bigint; v_k bigint; v_t timestamptz;
        v_plots integer[]; v_plot integer; v_id bigint;
begin
  -- R1. flee
  for r in select fr.* from public.field_rats fr where fr.room_id = p_room and fr.ended_at is null order by fr.id for update loop
    select * into c from public.crops cr
     where cr.room_id = p_room and cr.plot_no = r.plot_no and cr.rat_log @> jsonb_build_array(jsonb_build_object('r', r.id))
       for update;
    v_found := found;
    if not v_found or not public._rat_food(c, p_now) then
      update public.field_rats set ended_at = p_now, how = 'fled' where id = r.id;
      if v_found then
        update public.crops set rat_log = public._rat_close(rat_log, r.id, p_now) where room_id = p_room and plot_no = r.plot_no;
      end if;
    end if;
  end loop;
  -- R2. purge
  delete from public.field_rats where room_id = p_room and ended_at < p_now - interval '1 hour';
  -- R3. spawn: k(p_now − 1 800 s) < k ≤ k(p_now), and k > last_k
  select last_k into v_last from public.rat_clocks where room_id = p_room for update;
  v_hi := public._rat_k(p_room, p_now);
  v_k := greatest(public._rat_k(p_room, p_now - interval '1800 seconds'), coalesce(v_last, -1)) + 1;
  while v_k <= v_hi loop
    v_t := public._rat_t(p_room, v_k);
    if (select count(*) from public.field_rats fr
         where fr.room_id = p_room and fr.spawned_at <= v_t and (fr.ended_at is null or fr.ended_at > v_t)) < 3 then
      select array_agg(cr.plot_no::integer order by cr.plot_no) into v_plots from public.crops cr
       where cr.room_id = p_room and public._rat_food(cr, v_t) and jsonb_array_length(cr.rat_log) < 20;
      if v_plots is not null then
        v_plot := v_plots[1 + floor(public._rat_u(p_room, v_k, 'p') * cardinality(v_plots))::integer];
        insert into public.field_rats (room_id, plot_no, k, seed, spawned_at)
        values (p_room, v_plot, v_k, floor(public._rat_u(p_room, v_k, 's') * 2147483647)::integer, v_t)
        on conflict (room_id, k) do nothing
        returning id into v_id;
        if v_id is not null then
          update public.crops
             set rat_log = rat_log || jsonb_build_array(jsonb_build_object('r', v_id, 'from', p_now, 'to', null))
           where room_id = p_room and plot_no = v_plot;
        end if;
      end if;
    end if;
    v_k := v_k + 1;
  end loop;
  insert into public.rat_clocks (room_id, last_k) values (p_room, v_hi)
  on conflict (room_id) do update set last_k = greatest(public.rat_clocks.last_k, excluded.last_k);
end $$;

-- The catch caps (§5.6, D13), on the account's farm profile (created if missing, locked): 6 catches in an hourly window
-- (it starts at the first catch after the last one ended) and 24 a Vietnam day. At the cap it raises 'rat limit' or 'rat
-- daily limit' (53400, details = the seconds until the window or the day ends); with p_take it counts the catch, and the
-- catch that makes the day's 24 logs the soft rat_daily_cap once.
create or replace function public._rat_caps(p_account uuid, p_now timestamptz, p_take boolean, p_how text default null,
                                            p_room uuid default null) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare pr public.farm_profiles; v_day date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date; v_open boolean;
        v_win integer; v_n integer;
begin
  insert into public.farm_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into pr from public.farm_profiles where account_id = p_account for update;
  v_open := pr.rat_win_start is not null and p_now < pr.rat_win_start + interval '1 hour';
  v_win := case when v_open then pr.rat_win_count else 0 end;
  v_n := case when pr.rat_day_on = v_day then pr.rat_day_count else 0 end;
  if v_win >= 6 then
    raise exception 'rat limit' using errcode = '53400',
      detail = ceil(extract(epoch from (pr.rat_win_start + interval '1 hour' - p_now)))::int::text;
  end if;
  if v_n >= 24 then
    raise exception 'rat daily limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - p_now)))::int::text;
  end if;
  if p_take then
    update public.farm_profiles
       set rat_win_start = case when v_open then rat_win_start else p_now end, rat_win_count = v_win + 1,
           rat_day_on = v_day, rat_day_count = v_n + 1
     where account_id = p_account;
    if v_n + 1 = 24 then
      perform public._ac_flag(p_account, 'rat_daily_cap', case when p_how = 'dog' then 'dog_hunt' else 'sling_shoot' end,
                              jsonb_build_object('day', v_day, 'count', 24), p_room, null, false);
    end if;
  end if;
end $$;

-- What the caps leave at p_now (§10.5 mine.rat_caps): a read, no lock.
create or replace function public._rat_caps_view(p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'hour_left', case when x.open then greatest(0, 6 - x.win) else 6 end,
    'hour_resets_at', case when x.open then x.win_start + interval '1 hour' end,
    'day_left', case when x.day_on = (p_now at time zone 'Asia/Ho_Chi_Minh')::date then greatest(0, 24 - x.day_n) else 24 end)
    from (select coalesce(pr.rat_win_start is not null and p_now < pr.rat_win_start + interval '1 hour', false) as open,
                 pr.rat_win_count as win, pr.rat_win_start as win_start, pr.rat_day_on as day_on, pr.rat_day_count as day_n
            from (select 1) one left join public.farm_profiles pr on pr.account_id = p_account) x
$$;

-- A catch (§5.6), after the caller's wallet lock: the rat (bound to the room; missing or ended is 'rat gone'), the crop
-- that carries its entry, the caps (counted), then the price floor(150 × M) with M from the room's index at the catch —
-- that row is the last lock taken — and the rat ends, its entry closes and the bag gets it. Returns the price.
create or replace function public._rat_catch(p_room uuid, p_account uuid, p_rat bigint, p_how text, p_now timestamptz)
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.field_rats; v_price integer;
begin
  select * into r from public.field_rats where id = p_rat and room_id = p_room for update;
  if not found or r.ended_at is not null then
    raise exception 'rat gone' using errcode = '22023';
  end if;
  perform 1 from public.crops
   where room_id = p_room and plot_no = r.plot_no and rat_log @> jsonb_build_array(jsonb_build_object('r', r.id)) for update;
  perform public._rat_caps(p_account, p_now, true, p_how, p_room);
  v_price := public._critter_price(150, (public._fish_index(p_room, p_now)).mult);
  update public.field_rats set ended_at = p_now, how = p_how, caught_by = p_account, price = v_price where id = r.id;
  update public.crops set rat_log = public._rat_close(rat_log, r.id, p_now)
   where room_id = p_room and plot_no = r.plot_no and rat_log @> jsonb_build_array(jsonb_build_object('r', r.id));
  insert into public.rat_bag (account_id, price, caught_at, how) values (p_account, v_price, p_now, p_how);
  return v_price;
end $$;

-- The account's dog (§10.3), or null.
create or replace function public._dog_view(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('name', d.name, 'coat', d.coat, 'adopted_at', d.adopted_at, 'fed_until', d.fed_until,
                            'next_hunt_at', d.next_hunt_at, 'catches', d.catches)
    from public.dogs d where d.account_id = p_account
$$;

-- The field's rats (§10.5), a read that never writes: when the next candidate is due, the price a catch would fetch now
-- (_critter_prices: the period's snapshot or its preview), the live rats, the rats that ended in the last 10 s, and the
-- non-empty rat logs by plot. It judges each live rat itself: one whose crop entry is gone, or whose crop is no longer
-- food at p_now, is listed as fled even before a sweep ends it.
create or replace function public._rats_view(p_room uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  with r as (
    select fr.id, fr.plot_no, fr.seed, fr.spawned_at, fr.ended_at, fr.how, fr.caught_by,
           fr.ended_at is null and not exists (select 1 from public.crops cr
                                                where cr.room_id = p_room and cr.plot_no = fr.plot_no
                                                  and cr.rat_log @> jsonb_build_array(jsonb_build_object('r', fr.id))
                                                  and public._rat_food(cr, p_now)) as gone
      from public.field_rats fr
     where fr.room_id = p_room and (fr.ended_at is null or fr.ended_at > p_now - interval '10 seconds')
  )
  select jsonb_build_object(
    'next_at', public._rat_t(p_room, public._rat_k(p_room, p_now) + 1),
    'price', public._critter_price(150, (public._critter_prices(p_room, p_now)->>'mult')::numeric),
    'live', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'plot', r.plot_no, 'since', r.spawned_at, 'seed', r.seed)
                                       order by r.id)
                        from r where r.ended_at is null and not r.gone), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', r.id, 'plot', r.plot_no, 'since', r.spawned_at, 'seed', r.seed,
                                 'ended_at', coalesce(r.ended_at, p_now), 'how', coalesce(r.how, 'fled'),
                                 'by', public._who(r.caught_by),
                                 'dog', case when r.how = 'dog' then (select d.name from public.dogs d where d.account_id = r.caught_by) end)
                               order by coalesce(r.ended_at, p_now), r.id)
                          from r where r.ended_at is not null or r.gone), '[]'::jsonb),
    'plots', coalesce((select jsonb_object_agg(cr.plot_no::text, cr.rat_log order by cr.plot_no) from public.crops cr
                        where cr.room_id = p_room and jsonb_array_length(cr.rat_log) > 0), '{}'::jsonb))
$$;

-- Every field call starts here (0013's body): create the plots if needed, lock them (one field call per room at a time
-- — before any wallet lock, so a sale that pays the other party cannot deadlock with that party's own field call),
-- sweep; v17: then the rats' sweep (D28).
create or replace function public._field_open(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_init(p_room);
  perform 1 from public.field_plots where room_id = p_room order by plot_no for update;
  perform public._field_sweep(p_room, p_now);
  perform public._rat_sweep(p_room, p_now);                                         -- v17
end; $$;
-- The account's farm belongings (0018's body): v17 adds the kinds ammo and pet_food to the items, the rats in the bag
-- (count and what cô Út pays), what the catch caps leave and the dog (§10.5). Like the gathering part, the caps are read
-- on now().
create or replace function public._farm_mine(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty order by i.item_id)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food')), '{}'::jsonb),
    'rice', coalesce((select jsonb_object_agg(rs.variety, jsonb_build_object('wet', rs.wet_kg, 'dry', rs.dry_kg) order by rs.variety)
                        from public.rice_stock rs where rs.account_id = p_account and (rs.wet_kg > 0 or rs.dry_kg > 0)),
                     '{}'::jsonb),
    'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0),
    'gift_claimed', exists (select 1 from public.farm_profiles pr where pr.account_id = p_account and pr.gift_at is not null),
    'produce', coalesce((select jsonb_object_agg(ps.upland, ps.kg order by ps.upland)
                           from public.produce_stock ps where ps.account_id = p_account and ps.kg > 0), '{}'::jsonb),
    'tank', case when public._owns(p_account, 'tool_sprayer')
                 then coalesce((select jsonb_build_object('item', pr.tank_item, 'charges', pr.tank_charges)
                                  from public.farm_profiles pr where pr.account_id = p_account),
                               jsonb_build_object('item', null, 'charges', 0)) end,
    'critters', coalesce((select jsonb_object_agg(k.kind, jsonb_build_object('n', k.n, 'xu', k.xu) order by k.kind)
                            from (select cr.kind, count(*)::int as n, sum(cr.price)::int as xu
                                    from public.critters cr where cr.account_id = p_account group by cr.kind) k), '{}'::jsonb),
    'critter_cap', public._critter_cap(p_account),
    'gather', (select jsonb_build_object(
                 'ready_at', coalesce((select jsonb_object_agg(g.spot, g.ready_at order by g.spot) from public.gather_cooldowns g
                                        where g.account_id = p_account and g.ready_at > now()), '{}'::jsonb),
                 'left_today', d.left_today,
                 'day_resets_at', case when d.left_today = 0
                                       then (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end)
                 from (select coalesce((select case when pr.gather_on = public._vn_today() then greatest(0, 200 - pr.gather_count)
                                                    else 200 end
                                          from public.farm_profiles pr where pr.account_id = p_account), 200) as left_today) d),
    -- v17: the rats in the bag, the caps and the dog
    'rats', (select jsonb_build_object('count', count(*)::int, 'value', coalesce(sum(b.price), 0)::int)
               from public.rat_bag b where b.account_id = p_account),
    'rat_caps', public._rat_caps_view(p_account, now()),
    'dog', public._dog_view(p_account))
$$;

-- The whole field_state answer (0018's body); v17: plus the field's rats (§10.5, D28).
create or replace function public._field_view(p_room uuid, p_viewer uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now,
    'plots', (select jsonb_agg(public._plot_view(p_room, fp.plot_no, p_viewer, p_now) order by fp.plot_no)
                from public.field_plots fp where fp.room_id = p_room),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('slot', ds.slot, 'owner', public._who(ds.account_id),
                                                            'variety', ds.variety, 'kg', ds.kg, 'ready_at', ds.ready_at)
                                         order by ds.slot)
                          from public.drying_slots ds where ds.room_id = p_room), '[]'::jsonb),
    'mine', public._farm_mine(p_viewer) || jsonb_build_object(
      'owned_plot', (select fp.plot_no from public.field_plots fp where fp.room_id = p_room and fp.owner_id = p_viewer
                      order by fp.plot_no limit 1),
      'farming', coalesce((select jsonb_agg(fp.plot_no order by fp.plot_no) from public.field_plots fp
                            where fp.room_id = p_room and public._farmer(p_room, fp.plot_no, p_now) = p_viewer), '[]'::jsonb),
      'my_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no, 'price', lo.price,
                                                               'expires_at', lo.created_at + interval '24 hours')
                                              order by lo.created_at, lo.id)
                              from public.land_offers lo where lo.room_id = p_room and lo.buyer_id = p_viewer), '[]'::jsonb),
      'incoming_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no,
                                                                     'buyer', public._who(lo.buyer_id), 'price', lo.price,
                                                                     'expires_at', lo.created_at + interval '24 hours')
                                                    order by lo.plot_no, lo.price desc, lo.id)
                                    from public.land_offers lo
                                    join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
                                   where lo.room_id = p_room and fp.owner_id = p_viewer), '[]'::jsonb)),
    'critter_prices', public._critter_prices(p_room, p_now),
    'rats', public._rats_view(p_room, p_now))                                        -- v17
$$;

revoke all on function public._rat_sweep(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_caps(uuid, timestamptz, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public._rat_caps_view(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_catch(uuid, uuid, bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_view(uuid) from public, anon, authenticated;
revoke all on function public._rats_view(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._field_open(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
revoke all on function public._field_view(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------- E. RPCs (§6.1, §7.1, §7.2, §10.4, §10.7) ----------
-- Each public RPC runs its guard (_ac_play for the room RPCs, _ac_account for the account RPCs), then its private twin
-- with now(). A twin takes p_now: a room twin opens the field (the plot locks and both sweeps), then takes the wallet; an
-- account twin takes the wallet. Every refusal raises, so a refused call changes nothing, pellet included (D15).

-- The slingshot's aim (§6.1, D14): a ná, a pellet, a live rat of this room, room under the caps (checked, not counted);
-- one aim per account, replaced by a new one.
create or replace function public._rat_do_sling_start(p_room uuid, p_account uuid, p_rat bigint, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if not public._owns(p_account, 'tool_sling') then
    raise exception 'no sling' using errcode = '22023';
  end if;
  if not public._owns(p_account, 'ammo_pellet') then
    raise exception 'no pellets' using errcode = '22023';
  end if;
  if not exists (select 1 from public.field_rats where id = p_rat and room_id = p_room and ended_at is null) then
    raise exception 'rat gone' using errcode = '22023';
  end if;
  perform public._rat_caps(p_account, p_now, false);
  insert into public.sling_aims (account_id, room_id, rat_id, started_at, last_shot_at, shots)
  values (p_account, p_room, p_rat, p_now, null, 0)
  on conflict (account_id) do update
    set room_id = excluded.room_id, rat_id = excluded.rat_id, started_at = excluded.started_at, last_shot_at = null, shots = 0;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('aim', jsonb_build_object('rat', p_rat, 'started_at', p_now));
end $$;

-- A shot (§6.1, D14, D15): the aim at this room and rat, a live rat, 2–60 s after the aim or the previous shot, a pellet.
-- The pellet is used; a hit (null is a miss) catches the rat and ends the aim.
create or replace function public._rat_do_sling_shoot(p_room uuid, p_account uuid, p_rat bigint, p_hit boolean,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare a public.sling_aims; v_prev timestamptz; v_price integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into a from public.sling_aims where account_id = p_account for update;
  if not found or a.room_id is distinct from p_room or a.rat_id is distinct from p_rat then
    raise exception 'no aim' using errcode = '22023';
  end if;
  if not exists (select 1 from public.field_rats where id = p_rat and room_id = p_room and ended_at is null) then
    raise exception 'rat gone' using errcode = '22023';
  end if;
  v_prev := coalesce(a.last_shot_at, a.started_at);
  if p_now < v_prev + interval '2 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
  if p_now > v_prev + interval '60 seconds' then
    raise exception 'aim expired' using errcode = '22023';
  end if;
  if not public._owns(p_account, 'ammo_pellet') then
    raise exception 'no pellets' using errcode = '22023';
  end if;
  perform public._use_item(p_account, 'ammo_pellet');
  update public.sling_aims set last_shot_at = p_now, shots = shots + 1 where account_id = p_account;
  if coalesce(p_hit, false) then
    v_price := public._rat_catch(p_room, p_account, p_rat, 'sling', p_now);
    delete from public.sling_aims where account_id = p_account;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('shot', jsonb_build_object(
              'hit', coalesce(p_hit, false), 'price', v_price,
              'pellets', coalesce((select qty from public.inventory where account_id = p_account and item_id = 'ammo_pellet'), 0)));
end $$;

-- The dog's pounce (§7.2, D17, D18): a dog, fed, rested; then the catch, and 5 minutes' rest.
create or replace function public._dog_do_hunt(p_room uuid, p_account uuid, p_rat bigint, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare d public.dogs; v_price integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into d from public.dogs where account_id = p_account for update;
  if not found then
    raise exception 'no dog' using errcode = '22023';
  end if;
  if d.fed_until is null or d.fed_until <= p_now then
    raise exception 'dog hungry' using errcode = '22023';
  end if;
  if d.next_hunt_at > p_now then
    raise exception 'dog resting' using errcode = '22023', detail = ceil(extract(epoch from (d.next_hunt_at - p_now)))::int::text;
  end if;
  v_price := public._rat_catch(p_room, p_account, p_rat, 'dog', p_now);
  update public.dogs set next_hunt_at = p_now + interval '5 minutes', catches = catches + 1 where account_id = p_account;
  return public._field_view(p_room, p_account, p_now) || jsonb_build_object('dog_hunt', jsonb_build_object('price', v_price));
end $$;

-- What the dog calls answer (§10.4): the dog, the food_dog count and the wallet.
create or replace function public._dog_answer(p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('server_now', p_now, 'dog', public._dog_view(p_account),
    'food', coalesce((select i.qty from public.inventory i where i.account_id = p_account and i.item_id = 'food_dog'), 0),
    'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0))
$$;

-- Adoption at chú Tám's (§7.1, D19–D21, D29): a valid name and coat, one dog an account, 20 000 xu; it comes fed for 24 h.
create or replace function public._dog_do_adopt(p_account uuid, p_name text, p_coat text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; v_name text;
begin
  w := public._wallet_lock(p_account);
  v_name := public._pet_name(p_name);
  if p_coat is null or p_coat not in ('vang', 'muc', 'ven', 'dom') then
    raise exception 'invalid coat' using errcode = '22023';
  end if;
  if exists (select 1 from public.dogs where account_id = p_account) then
    raise exception 'already own dog' using errcode = '22023';
  end if;
  if w.coins < 20000 then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(p_account, -20000, 'dog_adopt', 'dog ' || p_coat);
  insert into public.dogs (account_id, name, coat, adopted_at, fed_until)
  values (p_account, v_name, p_coat, p_now, p_now + interval '24 hours');
  return public._dog_answer(p_account, p_now);
end $$;

-- A new name, free, any time (§7.1).
create or replace function public._dog_do_rename(p_account uuid, p_name text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_name text;
begin
  perform public._wallet_lock(p_account);
  v_name := public._pet_name(p_name);
  update public.dogs set name = v_name where account_id = p_account;
  if not found then
    raise exception 'no dog' using errcode = '22023';
  end if;
  return public._dog_answer(p_account, p_now);
end $$;

-- A meal (§7.1, D19): refused while more than 12 h of food remain; 1 bịch feeds 24 h from max(now, fed_until).
create or replace function public._dog_do_feed(p_account uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare d public.dogs;
begin
  perform public._wallet_lock(p_account);
  select * into d from public.dogs where account_id = p_account for update;
  if not found then
    raise exception 'no dog' using errcode = '22023';
  end if;
  if d.fed_until > p_now + interval '12 hours' then
    raise exception 'dog full' using errcode = '22023';
  end if;
  perform public._use_item(p_account, 'food_dog');
  update public.dogs set fed_until = greatest(d.fed_until, p_now) + interval '24 hours' where account_id = p_account;
  return public._dog_answer(p_account, p_now);
end $$;

-- cô Út buys every rat in the bag at its stored price (§5.6, D12): ledger reason rat_sell.
create or replace function public._rat_do_sell(p_account uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer; v_xu integer;
begin
  perform public._wallet_lock(p_account);
  with sold as (delete from public.rat_bag where account_id = p_account returning price)
  select count(*)::int, coalesce(sum(price), 0)::int into v_n, v_xu from sold;
  if v_n = 0 then
    raise exception 'nothing to sell' using errcode = '22023';
  end if;
  perform public._pay(p_account, v_xu, 'rat_sell', v_n || ' con');
  return jsonb_build_object('server_now', p_now, 'mine', public._farm_mine(p_account),
                            'sold', jsonb_build_object('count', v_n, 'xu', v_xu));
end $$;

-- The guarded RPCs (§10.7): no hard check after the guard — rat ids come from the state, names are typed.
create or replace function public.sling_start(p_room_id uuid, p_session_token text, p_rat_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._rat_do_sling_start(p_room_id, v_account, p_rat_id, now());
end $$;

create or replace function public.sling_shoot(p_room_id uuid, p_session_token text, p_rat_id bigint, p_hit boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._rat_do_sling_shoot(p_room_id, v_account, p_rat_id, p_hit, now());
end $$;

create or replace function public.dog_hunt(p_room_id uuid, p_session_token text, p_rat_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._dog_do_hunt(p_room_id, v_account, p_rat_id, now());
end $$;

create or replace function public.adopt_dog(p_session_token text, p_name text, p_coat text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._dog_do_adopt(v_account, p_name, p_coat, now());
end $$;

create or replace function public.rename_dog(p_session_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._dog_do_rename(v_account, p_name, now());
end $$;

create or replace function public.feed_dog(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._dog_do_feed(v_account, now());
end $$;

create or replace function public.sell_rats(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._rat_do_sell(v_account, now());
end $$;

-- The dog on entering the game (§7.3): a read, on the guard file's allowlist (D26).
create or replace function public.dog_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  return public._dog_answer(v_account, now());
end $$;

-- anh Hai's shop (0018's body, §8): v17 sells the pellets and the dog food too — the soft kind_mismatch allows the kinds
-- ammo and pet_food; the ná is a tool, bought once.
create or replace function public.buy_farm_item(p_session_token text, p_item_id text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; it public.shop_items; v_cost integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind not in ('seed', 'fertilizer', 'pesticide', 'tool', 'critter_box', 'ammo', 'pet_food') then   -- v17: ammo, pet_food
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_farm_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return public._ac_flag(v_account, 'bad_qty', 'buy_farm_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  if it.kind in ('tool', 'critter_box') and p_qty <> 1 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  if it.kind = 'tool' and public._owns(v_account, it.id) then
    raise exception 'already owned' using errcode = '22023';
  end if;
  if it.kind = 'critter_box' and public._critter_cap(v_account) - 3 >= it.capacity then
    raise exception 'already owned' using errcode = '22023';
  end if;
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + p_qty > 99 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  v_cost := it.price * p_qty;
  if w.coins < v_cost then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(v_account, -v_cost, 'farm_buy', it.id || ' x' || p_qty);
  insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

revoke all on function public._rat_do_sling_start(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_do_sling_shoot(uuid, uuid, bigint, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_hunt(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_answer(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_adopt(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_rename(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_feed(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_do_sell(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.sling_start(uuid, text, bigint) to anon, authenticated;
grant execute on function public.sling_shoot(uuid, text, bigint, boolean) to anon, authenticated;
grant execute on function public.dog_hunt(uuid, text, bigint) to anon, authenticated;
grant execute on function public.adopt_dog(text, text, text) to anon, authenticated;
grant execute on function public.rename_dog(text, text) to anon, authenticated;
grant execute on function public.feed_dog(text) to anon, authenticated;
grant execute on function public.sell_rats(text) to anon, authenticated;
grant execute on function public.dog_state(text) to anon, authenticated;
grant execute on function public.buy_farm_item(text, text, integer) to anon, authenticated;

-- ---------- F. Anti-cheat (§10.7, §16): the holdings and the wipe take the dog and the rats ----------
-- SHARED WITH 0018 (v15.3), which re-created both functions last. Each body below is 0018's with only the lines marked
-- "v17" added: _ac_holdings gains "dog" and "rats" after 0018's "critters" (0017's "cards" stays after "drying"), and
-- _ac_wipe keeps 0017's first step (the seats resolved, §6.3 of the v16 spec) and deletes the dog, the rat bag and the
-- aim after 0018's critters and cooldowns; the inventory delete already takes the ná, the pellets and the food.

-- What a wipe removes: 0018's snapshot also lists the dog and the rats in the bag (count and what cô Út pays).
create or replace function public._ac_holdings(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'wallet', (select jsonb_build_object('coins', w.coins, 'daily_on', w.daily_on, 'bonus_on', w.bonus_on,
                                         'bonus_count', w.bonus_count)
                 from public.wallets w where w.account_id = p_account),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'qty', i.qty) order by i.item_id)
                             from public.inventory i where i.account_id = p_account), '[]'::jsonb),
    'fishing_profile', (select jsonb_build_object('rod', p.rod, 'bobber', p.bobber, 'bait', p.bait)
                          from public.fishing_profiles p where p.account_id = p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('species_id', f.species_id, 'weight_g', f.weight_g, 'price', f.price,
                                                          'caught_at', f.caught_at) order by f.caught_at, f.id)
                        from public.fish f where f.account_id = p_account), '[]'::jsonb),
    'personal_bests', coalesce((select jsonb_agg(jsonb_build_object('species_id', b.species_id, 'weight_g', b.weight_g,
                                                                    'caught_at', b.caught_at) order by b.species_id)
                                  from public.personal_bests b where b.account_id = p_account), '[]'::jsonb),
    'rice', coalesce((select jsonb_agg(jsonb_build_object('variety', r.variety, 'wet_kg', r.wet_kg, 'dry_kg', r.dry_kg)
                                       order by r.variety)
                        from public.rice_stock r where r.account_id = p_account), '[]'::jsonb),
    'produce', coalesce((select jsonb_agg(jsonb_build_object('upland', ps.upland, 'kg', ps.kg) order by ps.upland)
                           from public.produce_stock ps where ps.account_id = p_account), '[]'::jsonb),
    'tank', (select jsonb_build_object('item', pr.tank_item, 'charges', pr.tank_charges)
               from public.farm_profiles pr where pr.account_id = p_account),
    -- v15.3: the critters held
    'critters', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n, 'xu', k.xu) order by k.kind)
                            from (select cr.kind, count(*)::int as n, sum(cr.price)::int as xu from public.critters cr
                                   where cr.account_id = p_account group by cr.kind) k), '[]'::jsonb),
    -- v17: the dog and the rats in the bag
    'dog', public._dog_view(p_account),
    'rats', (select jsonb_build_object('count', count(*)::int, 'value', coalesce(sum(b.price), 0)::int)
               from public.rat_bag b where b.account_id = p_account),
    'plots', coalesce((select jsonb_agg(jsonb_build_object('room_id', fp.room_id, 'plot_no', fp.plot_no, 'kind', fp.kind,
                                                           'owned_at', fp.owned_at, 'sale_price', fp.sale_price,
                                                           'sublease_price', fp.sublease_price) order by fp.room_id, fp.plot_no)
                         from public.field_plots fp where fp.owner_id = p_account), '[]'::jsonb),
    'leases', coalesce((select jsonb_agg(jsonb_build_object('room_id', pl.room_id, 'plot_no', pl.plot_no, 'source', pl.source,
                                                            'price', pl.price, 'until', pl.until) order by pl.room_id, pl.plot_no)
                          from public.plot_leases pl where pl.farmer_id = p_account), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('room_id', lo.room_id, 'plot_no', lo.plot_no, 'price', lo.price,
                                                            'created_at', lo.created_at) order by lo.created_at, lo.id)
                          from public.land_offers lo where lo.buyer_id = p_account), '[]'::jsonb),
    'crops', coalesce((select jsonb_agg(jsonb_build_object('room_id', c.room_id, 'plot_no', c.plot_no, 'kind', c.kind,
                                                           'variety', c.variety, 'upland', c.upland,
                                                           'transplant_at', c.transplant_at, 'plant_at', c.plant_at,
                                                           'parts', c.harvested_parts, 'harvester_until', c.harvester_until)
                                        order by c.room_id, c.plot_no)
                         from public.crops c where c.farmer_id = p_account), '[]'::jsonb),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('room_id', d.room_id, 'slot', d.slot, 'variety', d.variety,
                                                            'kg', d.kg, 'ready_at', d.ready_at) order by d.room_id, d.slot)
                          from public.drying_slots d where d.account_id = p_account), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('room_id', s.room_id, 'game', s.game, 'seat', s.seat, 'chips', s.chips,
                                                           'escrow', s.escrow) order by s.room_id, s.game)
                         from public.card_seats s where s.account_id = p_account), '[]'::jsonb),
    'announcements', (select count(*) from public.chat_messages m where m.system and m.about_account_id = p_account))
$$;

-- 0018's wipe (the seats first, so the xu they give back are part of the wiped balance; then the snapshot): v17 also
-- deletes the dog, the rat bag and the aim; the farm profile (the gift, the day's visits and catches) stays.
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
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

revoke all on function public._ac_holdings(uuid) from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
