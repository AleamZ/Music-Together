-- =========================================================
-- 0038_rain.sql — v18.9 Ô và ướt sũng + sét đánh (docs/superpowers/plans/2026-09-27-v18-9-rain.md).
-- ADDITIVE (no data drop) and re-runnable. Run after 0037. Every re-created function is copied from its newest body
-- (vitals_tick from 0036, eat_meal from 0026, start_cast from 0034) with only the lines marked "v18.9" added or changed.
--   A. umbrellas (the "Cầm tay" slot: one held at a time) and rain_state, one row per account.
--   B. Pure rules (lib/game/rain/model.ts mirrors them; tests/unit/rain.test.ts pins them).
--   C. _rain_json and the RPCs rain_state, umbrella_buy, umbrella_hold.
--   D. vitals_tick: wet / umbrella wear / fast hunger / cảm lạnh / cold faint / lightning. The answer carries `rain`.
--   E. eat_meal: a hot dish (phở bò, bún bò Huế, canh chua cá) cures cảm lạnh. start_cast: 30 % no bite while cảm lạnh.
--   F. The ledger gains 'umbrella'.
-- Outdoors is the v18.10 rule (a known spot out of `_in_shade`, not swimming, not cramping, not fainted).
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.umbrellas (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('o_giay', 'o_vai', 'o_gap')),
  left_s numeric not null check (left_s >= 0),     -- seconds of rain left
  held boolean not null default false,
  bought_at timestamptz not null default now()
);
create index if not exists umbrellas_account on public.umbrellas(account_id);
create unique index if not exists umbrellas_one_held on public.umbrellas(account_id) where held;
alter table public.umbrellas enable row level security;
revoke all on public.umbrellas from anon, authenticated;

create table if not exists public.rain_state (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  wet_s numeric not null default 0,          -- exposed to the rain this many seconds in a row (0 = dry)
  dry_s numeric not null default 0,          -- not exposed this many seconds since the last wetting
  cold_until timestamptz,                    -- cảm lạnh until
  cold_wet_s numeric not null default 0,     -- exposed seconds while cảm lạnh
  strike_cd_until timestamptz,               -- no lightning until
  struck_at timestamptz,                     -- the last lightning strike
  broke_at timestamptz,                      -- the held umbrella last broke
  last_seen timestamptz                      -- the last heartbeat that judged the rain
);
alter table public.rain_state enable row level security;
revoke all on public.rain_state from anon, authenticated;

-- ---------- B. Rules ----------
create or replace function public._umbrella_price(p_kind text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_kind when 'o_giay' then 300 when 'o_vai' then 800 when 'o_gap' then 2000 end $$;

-- durability in seconds of rain (30, 90, 240 min)
create or replace function public._umbrella_life_s(p_kind text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_kind when 'o_giay' then 1800 when 'o_vai' then 5400 when 'o_gap' then 14400 end $$;

create or replace function public._rain_kind(p_kind text) returns boolean
language sql immutable set search_path = public, extensions
as $$ select coalesce(p_kind in ('rain', 'thunder', 'storm'), false) $$;

-- The chance of a lightning strike over dt credited seconds: 1 % a minute.
create or replace function public._strike_chance(p_dt numeric) returns double precision
language sql immutable set search_path = public, extensions
as $$ select 1 - power(0.99::double precision, greatest(coalesce(p_dt, 0), 0)::double precision / 60) $$;

create or replace function public._rain_cold(p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select cold_until > now() from public.rain_state where account_id = p_account), false) $$;

revoke all on function public._umbrella_price(text) from public, anon, authenticated;
revoke all on function public._umbrella_life_s(text) from public, anon, authenticated;
revoke all on function public._rain_kind(text) from public, anon, authenticated;
revoke all on function public._strike_chance(numeric) from public, anon, authenticated;
revoke all on function public._rain_cold(uuid) from public, anon, authenticated;

-- ---------- C. State and RPCs ----------
create or replace function public._rain_row(p_account uuid) returns public.rain_state
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.rain_state;
begin
  insert into public.rain_state(account_id) values (p_account) on conflict do nothing;
  select * into r from public.rain_state where account_id = p_account for update;
  return r;
end $$;
revoke all on function public._rain_row(uuid) from public, anon, authenticated;

-- `exposed`: this heartbeat found me in the rain without a working umbrella (null outside a heartbeat).
create or replace function public._rain_json(p_account uuid, p_exposed boolean default null) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'wet', coalesce(r.wet_s > 0, false),
    'wet_s', floor(coalesce(r.wet_s, 0))::int,
    'drying', coalesce(r.wet_s > 0 and r.dry_s > 0, false),
    'cold_until_ms', case when r.cold_until > now() then (extract(epoch from r.cold_until) * 1000)::bigint end,
    'struck_at_ms', case when r.struck_at > now() - interval '60 seconds' then (extract(epoch from r.struck_at) * 1000)::bigint end,
    'broke_at_ms', case when r.broke_at > now() - interval '60 seconds' then (extract(epoch from r.broke_at) * 1000)::bigint end,
    'exposed', p_exposed,
    'umbrellas', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'left_s', floor(u.left_s)::int, 'held', u.held)
                                            order by u.held desc, u.id)
                             from public.umbrellas u where u.account_id = p_account), '[]'::jsonb),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
  from (select 1) one left join public.rain_state r on r.account_id = p_account
$$;
revoke all on function public._rain_json(uuid, boolean) from public, anon, authenticated;

create or replace function public.rain_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._rain_json(public._auth_account(p_session_token));
end $$;

-- Buy an umbrella (at most 6 owned); the first one is held at once.
create or replace function public.umbrella_buy(p_session_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_price integer := public._umbrella_price(p_kind);
        v_coins integer; v_bal integer;
begin
  if v_price is null then raise exception 'unknown umbrella' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  if (select count(*) from public.umbrellas where account_id = v_account) >= 6 then
    raise exception 'too many umbrellas' using errcode = '53400';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_price, 'umbrella', 'umbrella: ' || p_kind);
  insert into public.umbrellas(account_id, kind, left_s, held)
  values (v_account, p_kind, public._umbrella_life_s(p_kind),
          not exists (select 1 from public.umbrellas where account_id = v_account and held));
  return public._rain_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Hold umbrella p_id in the hand (null: put it away).
create or replace function public.umbrella_hold(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform 1 from public.umbrellas where account_id = v_account for update;
  if p_id is not null and not exists (select 1 from public.umbrellas where id = p_id and account_id = v_account) then
    raise exception 'umbrella not found' using errcode = '22023';
  end if;
  update public.umbrellas set held = false where account_id = v_account and held and id is distinct from p_id;
  if p_id is not null then update public.umbrellas set held = true where id = p_id; end if;
  return public._rain_json(v_account);
end $$;

revoke all on function public.rain_state(text) from public;
revoke all on function public.umbrella_buy(text, text) from public;
revoke all on function public.umbrella_hold(text, bigint) from public;
grant execute on function public.rain_state(text) to anon, authenticated;
grant execute on function public.umbrella_buy(text, text) to anon, authenticated;
grant execute on function public.umbrella_hold(text, bigint) to anon, authenticated;

-- ---------- D. The heartbeat ----------
-- vitals_tick: 0036's body. v18.9: in a rainy room, outdoors, a held umbrella wears (storm ×3) and keeps me dry; without
-- one I get wet. 300 s wet in a row → hunger ×24 while exposed; hunger 0 then → cảm lạnh (30 min); 300 s more exposed
-- while cảm lạnh → the faint. 120 s not exposed dries me. Outdoors in a rainy room (umbrella or not) lightning may strike
-- (_strike_chance of the credited seconds; 30 min cooldown) → the faint. The answer carries `rain`.
create or replace function public.vitals_tick(p_session_token text, p_room_id uuid, p_map text default null,
                                              p_x integer default null, p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
        v_member boolean; h public.heat_state; w public.room_weather; v_out boolean; v_hot boolean;   -- v18.10
        v_since timestamptz; v_fainted boolean; v_vit public.vitals;                                   -- v18.10
        v_cat numeric := public._pet_cat_factor(v_account);                                             -- v18.12
        rs public.rain_state; v_rainy boolean; v_dt numeric := 0; u public.umbrellas;                   -- v18.9
        v_exposed boolean := false; v_fast boolean := false; v_faint boolean := false;                   -- v18.9
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
  -- v18.9: the rain, over the seconds since the last heartbeat (at most 120)
  rs := public._rain_row(v_account);                                                     -- v18.9
  if rs.last_seen is not null then                                                       -- v18.9
    v_dt := least(120, greatest(0, extract(epoch from now() - rs.last_seen)));           -- v18.9
  end if;                                                                                -- v18.9
  v_rainy := v_member and w.updated_at is not null and public._rain_kind(w.kind);        -- v18.9
  if v_rainy and v_out then                                                              -- v18.9
    select * into u from public.umbrellas where account_id = v_account and held for update;
    if u.id is not null then                                                             -- v18.9: the umbrella wears
      u.left_s := u.left_s - v_dt * case when w.kind = 'storm' then 3 else 1 end;
      if u.left_s <= 0 then
        delete from public.umbrellas where id = u.id;
        rs.broke_at := now();
      else
        update public.umbrellas set left_s = u.left_s where id = u.id;
      end if;
    end if;
    v_exposed := u.id is null or u.left_s <= 0;                                          -- v18.9: a broken one is gone
  end if;
  if v_exposed then                                                                      -- v18.9: wet
    v_fast := rs.wet_s >= 300;
    rs.wet_s := rs.wet_s + v_dt; rs.dry_s := 0;
    if rs.cold_until > now() then rs.cold_wet_s := rs.cold_wet_s + v_dt; end if;
  elsif rs.wet_s > 0 then                                                                -- v18.9: drying
    rs.dry_s := rs.dry_s + v_dt;
    if rs.dry_s >= 120 then rs.wet_s := 0; rs.dry_s := 0; rs.cold_wet_s := 0; end if;
  end if;
  v_vit := public._vitals_apply(v_account,
    (case when v_member then (public._room_effects(p_room_id)->>'thirst')::numeric else 1 end)
    * case when h.shocked then 2 else 1 end                                              -- v18.10: ×2 heat-shocked
    * v_cat,                                                                             -- v18.12: the mèo
    v_cat * case when v_fast then 24 else 1 end);                                        -- v18.12: the mèo; v18.9: ×24 wet
  if v_fast and v_vit.hunger <= 0 and not coalesce(rs.cold_until > now(), false) then   -- v18.9: cảm lạnh
    rs.cold_until := now() + interval '30 minutes'; rs.cold_wet_s := 0;
  end if;
  if rs.cold_until > now() and rs.cold_wet_s >= 300 and v_vit.fainted_until is null then -- v18.9: the cold faint
    v_faint := true;
    rs.wet_s := 0; rs.dry_s := 0; rs.cold_wet_s := 0;
  end if;
  if v_rainy and v_out and v_vit.fainted_until is null and not v_faint                  -- v18.9: lightning
     and not coalesce(rs.strike_cd_until > now(), false) and v_dt > 0
     and random() < public._strike_chance(v_dt) then
    v_faint := true;
    rs.struck_at := now(); rs.strike_cd_until := now() + interval '30 minutes';
  end if;
  if v_faint then                                                                        -- v18.9: the v18.3 faint
    update public.vitals set fainted_until = now() + interval '10 seconds', starve_s = 0
     where account_id = v_account returning * into v_vit;
  end if;
  update public.rain_state set wet_s = rs.wet_s, dry_s = rs.dry_s, cold_until = rs.cold_until,          -- v18.9
    cold_wet_s = rs.cold_wet_s, strike_cd_until = rs.strike_cd_until, struck_at = rs.struck_at,
    broke_at = rs.broke_at, last_seen = now()
   where account_id = v_account;
  return public._vitals_json(v_vit) || jsonb_build_object('heat', public._heat_json(h))
         || jsonb_build_object('rain', public._rain_json(v_account, v_exposed));          -- v18.9
end; $$;
revoke all on function public.vitals_tick(text, uuid, text, integer, integer) from public;
grant execute on function public.vitals_tick(text, uuid, text, integer, integer) to anon, authenticated;

-- ---------- E. The cure, and the fewer bites ----------
-- eat_meal: 0026's body; v18.9: a hot dish cures cảm lạnh (`cured` in the answer).
create or replace function public.eat_meal(p_session_token text, p_item text, p_fish_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid; m public.meal_catalog; v_rarity int; v_weight int; v_pct int := 0; v_price int; v_coins int; v_bal int; v_vitals jsonb;
  v_cured boolean := false;                                                                         -- v18.9
begin
  v_account := public._auth_account(p_session_token);
  select * into m from public.meal_catalog where id = p_item;
  if not found then raise exception 'unknown meal' using errcode = '22023'; end if;
  if p_fish_id is not null then
    if not m.fish_dish then raise exception 'not a fish dish' using errcode = '22023'; end if;
    select s.rarity, f.weight_g into v_rarity, v_weight
      from public.fish f join public.fish_species s on s.id = f.species_id
      where f.id = p_fish_id and f.account_id = v_account for update of f;
    if not found then raise exception 'fish not found' using errcode = '22023'; end if;
    v_pct := public._fish_discount_pct(v_rarity, v_weight);
  end if;
  v_price := m.price - (m.price * v_pct) / 100;
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_price, 'meal', 'meal: ' || p_item);
  if p_fish_id is not null then delete from public.fish where id = p_fish_id and account_id = v_account; end if;
  v_vitals := public._vitals_restore(v_account, m.hunger, m.thirst);
  if p_item in ('pho_bo', 'bun_bo', 'canh_chua') then                                              -- v18.9: a hot dish
    update public.rain_state set cold_until = null, cold_wet_s = 0
     where account_id = v_account and cold_until > now();
    v_cured := found;
  end if;
  return jsonb_build_object('paid', v_price, 'discount_pct', v_pct, 'coins', v_bal, 'vitals', v_vitals,
                            'cured', v_cured);                                                      -- v18.9
end; $$;
revoke all on function public.eat_meal(text, text, uuid) from public;
grant execute on function public.eat_meal(text, text, uuid) to anon, authenticated;

-- start_cast (0034's body); v18.9: while cảm lạnh, 30 % of casts never bite.
create or replace function public.start_cast(p_room_id uuid, p_session_token text, p_col integer default null,
                                             p_row integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
        v_spot text := 'dock'; v_bites boolean := true;                                  -- v18.1
        v_boost real;                                                                    -- v18.2
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_col is not null or p_row is not null then                                         -- v18.1: null = an older client (docks only)
    v_spot := public._pond_spot(p_col, p_row);
    if v_spot is null then raise exception 'bad spot' using errcode = '22023'; end if;
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;   -- v18.8
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then                                       -- v18.2
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 1. hourly cap: a new window starts at the first cast after the previous one ended
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
  -- 1b. daily cap: the seconds until the next Vietnam midnight
  if p.day_on = v_today and p.day_casts >= 300 then
    raise exception 'daily cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  -- 2. a new cast abandons the previous one (its bait is already spent)
  delete from public.casts where account_id = v_account;
  -- 3. room for the catch
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  -- 4. one bait: the selected kind, else worms
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);    -- v18.2
  -- 5. roll the fish (v14 spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,          -- v18.8: weather
                                  not (public._room_weather(p_room_id)).is_day);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);   -- v18.8: fewer bites = longer wait
  v_bite := greatest(1000, round(v_bite * v_boost)::int);                                 -- v18.2: a boosting bait
  if v_spot = 'shore' then                                                                -- v18.1: the shore's odds
    v_bite := least(60000, round(v_bite * 1.5)::int);
    v_bites := random() < case when v_boost < 1 then 0.8 else 0.4 end;                    -- v18.2: 80% with a boost
  end if;
  if v_bites and public._rain_cold(v_account) and random() < 0.3 then                     -- v18.9: cảm lạnh
    v_bites := false;
  end if;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod)                                         -- v18.1
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          v_spot, v_bites, sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod)   -- v18.1
  returning id into v_id;
  update public.fishing_profiles
     set window_casts = window_casts + 1,
         day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
         day_on = v_today
   where account_id = v_account
  returning day_casts into v_day;
  if v_day = 300 then
    perform public._ac_flag(v_account, 'cast_daily_cap', 'start_cast', jsonb_build_object('day', v_today, 'casts', 300),
                            p_room_id, null, false);
  end if;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.start_cast(uuid, text, integer, integer) to anon, authenticated;

-- ---------- F. The ledger ----------
-- The 30 reasons in force after 0036 (0037 adds none) plus 'umbrella': 31.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella'));
