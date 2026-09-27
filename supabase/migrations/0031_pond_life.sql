-- =========================================================
-- 0031_pond_life.sql — v18.1 Ao sống động (docs/superpowers/plans/2026-09-27-v18-1-pond.md): casting from the pond's
-- shore, and a big fish that pulls the angler into the pond.
-- ADDITIVE (no data drop) and re-runnable. Run after 0030. start_cast is copied from 0030 and finish_cast from 0015
-- (their newest bodies) with only the lines marked "v18.1" added or changed; their old signatures are dropped (the new
-- parameters have defaults, so named calls from an older client still resolve).
--   A. shop_items.rating_g (a rod's weight rating) and the cast's spot / bite / size / rod.
--   B. The pond geometry (lib/game/maps/pond.ts, mirrored by lib/game/fishing/shore.ts): _pond_in, _pond_spot.
--   C. _overboard_outcome (pure; the roll is a parameter) and _rod_wear (v18.2's durability seam: a no-op for now).
--   D. start_cast(p_room_id, p_session_token, p_col, p_row): the spot's odds.
--   E. finish_cast(p_session_token, p_cast_id, p_success, p_hooked): no_bite and overboard.
-- =========================================================

-- ---------- A. Columns ----------
alter table public.shop_items add column if not exists rating_g integer;   -- rod: a heavier fish is "lớn" (null: never)
update public.shop_items set rating_g = 1500 where id = 'rod_wood';
update public.shop_items set rating_g = 3000 where id = 'rod_bamboo';
update public.shop_items set rating_g = 6000 where id = 'rod_carbon';

alter table public.casts add column if not exists spot text not null default 'dock';   -- 'dock' | 'shore'
alter table public.casts add column if not exists bites boolean not null default true; -- false: nothing bites (shore)
alter table public.casts add column if not exists big boolean not null default false;  -- rarity >= 3 or over the rating
alter table public.casts add column if not exists rod text;                            -- the rod at the cast

-- ---------- B. The pond's geometry ----------
-- Is (x, y) inside the pond grown by p_grow px? pond.ts inPond: an oval around (300, 180), radii 180 × 105, whose edge
-- wobbles by 1 + 0.04 sin(3a + 0.6) + 0.025 sin(5a + 2.1).
create or replace function public._pond_in(p_x double precision, p_y double precision, p_grow double precision)
returns boolean
language sql immutable set search_path = public, extensions
as $$
  select q.dx * q.dx + q.dy * q.dy < power(1 + 0.04 * sin(3 * atan2(q.dy, q.dx) + 0.6) + 0.025 * sin(5 * atan2(q.dy, q.dx) + 2.1), 2)
    from (select (p_x - 300) / (180 + p_grow) as dx, (p_y - 180) / (105 + p_grow) as dy) q
$$;

-- The kind of cast spot the 8-px cell (p_col, p_row) of the pond map is: 'dock' (on the Cầu ao platform), 'shore' (any
-- other walkable cell), each only with a 4-neighbour water cell; null otherwise. A cell is judged at its centre, like
-- buildPondMap: water = inside the pond grown by 6 and off the platform; walkable = not water and not touching one of
-- the pond's solids (POND_SOLIDS; the map is 80 × 50 cells).
create or replace function public._pond_spot(p_col integer, p_row integer) returns text
language plpgsql immutable set search_path = public, extensions
as $$
declare x double precision; y double precision; v_dock boolean; n integer;
begin
  if p_col is null or p_row is null or p_col < 0 or p_row < 0 or p_col >= 80 or p_row >= 50 then return null; end if;
  x := p_col * 8 + 4; y := p_row * 8 + 4;
  v_dock := (x >= 200 and x < 400 and y >= 200 and y < 224) or (x >= 288 and x < 312 and y >= 224 and y < 296);
  if not v_dock then
    if public._pond_in(x, y, 6) then return null; end if;                                   -- water
    if exists (select 1 from (values (0, 0, 640, 44), (516, 40, 116, 86), (516, 196, 116, 98), (496, 158, 24, 10),
                                     (345, 350, 14, 10), (184, 370, 14, 10), (34, 94, 12, 8), (620, 174, 12, 8),
                                     (18, 354, 12, 8), (114, 316, 12, 8), (464, 336, 12, 8),
                                     (250, 368, 12, 8)) s(sx, sy, sw, sh)                    -- the city-map signpost
                where p_col * 8 < s.sx + s.sw and s.sx < p_col * 8 + 8 and p_row * 8 < s.sy + s.sh and s.sy < p_row * 8 + 8)
    then return null; end if;                                                               -- a solid
  end if;
  select count(*) into n
    from (values (1, 0), (-1, 0), (0, 1), (0, -1)) d(dc, dr)
   where p_col + d.dc between 0 and 79 and p_row + d.dr between 0 and 49
     and public._pond_in((p_col + d.dc) * 8 + 4, (p_row + d.dr) * 8 + 4, 6)
     and not (((p_col + d.dc) * 8 + 4 >= 200 and (p_col + d.dc) * 8 + 4 < 400 and (p_row + d.dr) * 8 + 4 >= 200 and (p_row + d.dr) * 8 + 4 < 224)
           or ((p_col + d.dc) * 8 + 4 >= 288 and (p_col + d.dc) * 8 + 4 < 312 and (p_row + d.dr) * 8 + 4 >= 224 and (p_row + d.dr) * 8 + 4 < 296));
  if n = 0 then return null; end if;
  return case when v_dock then 'dock' else 'shore' end;
end; $$;
revoke all on function public._pond_in(double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public._pond_spot(integer, integer) from public, anon, authenticated;

-- ---------- C. The overboard outcome ----------
-- What falling in costs (spec §18.1): the rod wears by 3 (v18.2), hunger drops by 10, and a rod other than the default
-- rod_wood is lost when the roll (0 ≤ roll < 1) is under 0.1. Pure: finish_cast passes random(), the tests a fixed roll.
create or replace function public._overboard_outcome(p_rod text, p_roll double precision) returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select jsonb_build_object('wear', 3, 'hunger', 10,
                            'rod_lost', coalesce(p_rod, 'rod_wood') <> 'rod_wood' and coalesce(p_roll, 1) < 0.1)
$$;
revoke all on function public._overboard_outcome(text, double precision) from public, anon, authenticated;

-- v18.2's seam: rod durability does not exist yet. 18.2 re-creates this to take p_amount off the rod's durability.
create or replace function public._rod_wear(p_account uuid, p_rod text, p_amount integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform p_account, p_rod, p_amount;   -- no durability yet (v18.2)
end; $$;
revoke all on function public._rod_wear(uuid, text, integer) from public, anon, authenticated;

-- ---------- D. start_cast ----------
-- start_cast (0030's body); v18.1: the cast's cell. From the shore the bite wait is ×1.5 and only 40% of the casts get
-- a bite; the rarity roll is unchanged. The cast remembers its spot, its bite, whether the fish is lớn and the rod.
drop function if exists public.start_cast(uuid, text);
create or replace function public.start_cast(p_room_id uuid, p_session_token text, p_col integer default null,
                                             p_row integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
        v_spot text := 'dock'; v_bites boolean := true;                                  -- v18.1
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
  if v_spot = 'shore' then                                                                -- v18.1: the shore's odds
    v_bite := least(60000, round(v_bite * 1.5)::int);
    v_bites := random() < 0.4;
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

-- ---------- E. finish_cast ----------
-- finish_cast (0015's body); v18.1: a cast without a bite ends 'no_bite' (after the expiry check, before the others). A
-- lost reel (p_success false) that the client reports as hooked (p_hooked), on a biting lớn cast after its bite time,
-- throws the angler into the pond: 'overboard' — the fish is lost, _rod_wear(3), hunger −10, and the rod may be lost
-- (_overboard_outcome with random()). p_hooked is a client claim like p_success: leaving it out only avoids the fall.
drop function if exists public.finish_cast(text, uuid, boolean);
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,
                                              p_hooked boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
        v_out jsonb; v_rod text; v_vit public.vitals;                                     -- v18.1
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not c.bites then                                                                  -- v18.1: nothing bit
    v_why := 'no_bite';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
    if coalesce(p_hooked, false) and c.big and now() >= c.bite_at then                   -- v18.1: pulled in
      v_why := 'overboard';
    end if;
  elsif now() < c.bite_at + make_interval(secs => 0.9 * c.min_reel_ms / 1000.0) then   -- the existing gate, unchanged
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3)),
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  if v_why = 'overboard' then                                                             -- v18.1: the fall's cost
    v_rod := coalesce(c.rod, 'rod_wood');
    v_out := public._overboard_outcome(v_rod, random());
    perform public._rod_wear(v_account, v_rod, (v_out->>'wear')::int);
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - (v_out->>'hunger')::numeric)
     where account_id = v_account returning * into v_vit;
    if (v_out->>'rod_lost')::boolean then
      delete from public.inventory where account_id = v_account and item_id = v_rod;
      update public.fishing_profiles set rod = 'rod_wood' where account_id = v_account and rod = v_rod;
    end if;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', v_rod, 'rod_lost', (v_out->>'rod_lost')::boolean,
                                      'hunger', (v_out->>'hunger')::int),
      'vitals', public._vitals_json(v_vit),
      'state', public._fishing_state(v_account));
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'state', public._fishing_state(v_account))
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
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
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
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.finish_cast(text, uuid, boolean, boolean) to anon, authenticated;
