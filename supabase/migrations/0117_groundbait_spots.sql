-- =========================================================
-- 0117_groundbait_spots.sql — Ổ thính: groundbait belongs to the SPOT, not to the angler.
-- ADDITIVE and re-runnable. Run after 0115 (0116 is another change's).
--   A. groundbait_spots: one row per ổ thính — the room, the map ('pond' cell centre px, 'song_cai' px, 'wild' world
--      px), the kind (a shop_items 'groundbait'), who threw it first, when, until when, and how many bags are in it
--      (stacks 1 … 3). Private (RLS on, nothing granted): the client reads it through groundbait_spots().
--   B. _groundbait_at(account, map, x, y, room): the groundbait working at a point for ANYONE in that room — the
--      nearest active spot of that room and map within 48 px (a tie: the newest). The 4-argument 0110 form (per
--      account) is left as it was and no longer called. start_cast, start_river_cast, start_river_cast_w and net_haul
--      pass their room (the net: its throw's room); _fishing_state's groundbait_on is my newest spot.
--   C. throw_groundbait(room, token, item, map, x, y) — same arguments, same position check (_pos_claim) — now:
--        * a spot of the SAME kind within 48 px in this room and map (the nearest, locked FOR UPDATE) is refreshed:
--          +10 minutes on what it has left, capped at 20 minutes from now; stacks + 1, capped at 3. A bag that would
--          add less than a minute is refused ('spot full', nothing spent).
--        * otherwise a NEW spot (a different kind nearby is a separate spot: nothing is replaced, nobody's thính is
--          taken away; where two overlap the nearest centre works), 10 minutes, stacks 1 — if the room+map has fewer
--          than 8 active spots ('too many spots') and I have fewer than 2 active spots I threw first anywhere
--          ('spot limit'). Refreshing anyone's spot is always allowed (it is not a new spot).
--      One advisory lock per room+map serialises the throws there; the spent rows of that room+map are swept.
--   D. groundbait_spots(room, token, map | null): the room's active spots — id, item, name, map, x, y, stacks,
--      until, left_ms (server-side, so the client's clock does not matter), by (the first thrower's name), mine.
-- Re-created from their newest bodies, only the lines marked 0117 changed: start_cast (0110), start_river_cast (0110),
-- start_river_cast_w (0110), net_haul (0110, the overload the client calls), _fishing_state (0115).
-- New: groundbait_spots (table + read RPC), the 5-argument _groundbait_at (private). throw_groundbait is rewritten.
-- fishing_groundbait (0110) is left in place, unused.
-- =========================================================

-- ---------- A. The spots ----------
create table if not exists public.groundbait_spots (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  map text not null check (map in ('pond', 'song_cai', 'wild')),
  x integer not null,                                   -- 'pond': the cell's centre; 'song_cai' map px; 'wild' world px
  y integer not null,
  item text not null references public.shop_items(id),
  thrown_by uuid references public.accounts(id) on delete set null,   -- the first thrower (a refresh keeps them)
  thrown_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stacks smallint not null default 1 check (stacks between 1 and 3)
);
create index if not exists groundbait_spots_room_map on public.groundbait_spots (room_id, map, expires_at);
create index if not exists groundbait_spots_by on public.groundbait_spots (thrown_by, expires_at);
alter table public.groundbait_spots enable row level security;
revoke all on public.groundbait_spots from anon, authenticated;

-- ---------- B. _groundbait_at ----------
-- The groundbait working at this point for anyone in this room (its item), or null: the nearest active spot of the
-- room and map within 48 px (a tie: the newest). p_account is kept for the callers' symmetry with 0110's form.
create or replace function public._groundbait_at(p_account uuid, p_map text, p_x integer, p_y integer, p_room uuid) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select g.item from public.groundbait_spots g
   where g.room_id = p_room and g.map = p_map and g.expires_at > now()
     and p_x is not null and p_y is not null and (g.x - p_x)::bigint * (g.x - p_x) + (g.y - p_y)::bigint * (g.y - p_y) <= 48 * 48
   order by (g.x - p_x)::bigint * (g.x - p_x) + (g.y - p_y)::bigint * (g.y - p_y), g.thrown_at desc
   limit 1
$$;
revoke all on function public._groundbait_at(uuid, text, integer, integer, uuid) from public, anon, authenticated;

-- ---------- C. throw_groundbait ----------
-- One bag of p_item on the spot I stand at: p_map 'pond' with p_x / p_y the cell (col, row) as start_cast takes it, or
-- 'song_cai' / 'wild' with the px of the boat as the river casts take them. The spot is claimed like a cast's. The
-- same kind within 48 px is refreshed (+10 min, at most 20 min left; stacks ≤ 3); else a new spot of 10 minutes
-- (≤ 8 per room and map, ≤ 2 thrown first by me).
create or replace function public.throw_groundbait(p_room_id uuid, p_session_token text, p_item text, p_map text,
                                                   p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_ac jsonb; v_x integer; v_y integer; g public.groundbait_spots;
        v_until timestamptz; v_refreshed boolean := false;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if not exists (select 1 from public.shop_items where id = p_item and kind = 'groundbait') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if p_x is null or p_y is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if p_map = 'pond' then
    if public._pond_spot(p_x, p_y) is null then raise exception 'bad spot' using errcode = '22023'; end if;
    v_x := p_x * 8 + 4;
    v_y := p_y * 8 + 4;
  elsif p_map = 'song_cai' then
    if not public._river_water(p_x, p_y) then raise exception 'bad spot' using errcode = '22023'; end if;
    v_x := p_x;
    v_y := p_y;
  elsif p_map = 'wild' then
    if not public._river_world_water(p_x, p_y)
       or not exists (select 1 from public._world_to_zone(p_x, p_y) z where z.zone = 'wild') then
      raise exception 'bad spot' using errcode = '22023';
    end if;
    v_x := p_x;
    v_y := p_y;
  else
    raise exception 'bad spot' using errcode = '22023';
  end if;
  if p_map <> 'pond' then
    if not exists (select 1 from public.boats where account_id = v_account) then
      raise exception 'no boat' using errcode = '22023';
    end if;
    if not public._map_unlocked(v_account, 'song_cai') then raise exception 'map locked' using errcode = '22023'; end if;
  end if;
  v_ac := public._pos_claim(v_account, p_map, v_x, v_y, 'throw_groundbait', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_account);
  -- the room+map's throws one at a time; the long-spent spots there swept
  perform pg_advisory_xact_lock(hashtextextended('groundbait:' || p_room_id::text || ':' || p_map, 0));
  delete from public.groundbait_spots where room_id = p_room_id and map = p_map and expires_at < now() - interval '1 minute';
  select * into g from public.groundbait_spots s
   where s.room_id = p_room_id and s.map = p_map and s.item = p_item and s.expires_at > now()
     and (s.x - v_x)::bigint * (s.x - v_x) + (s.y - v_y)::bigint * (s.y - v_y) <= 48 * 48
   order by (s.x - v_x)::bigint * (s.x - v_x) + (s.y - v_y)::bigint * (s.y - v_y), s.thrown_at desc
   limit 1 for update;
  if found then
    v_until := least(now() + interval '20 minutes', greatest(g.expires_at, now()) + interval '10 minutes');
    if v_until < g.expires_at + interval '1 minute' then raise exception 'spot full' using errcode = '22023'; end if;
    v_refreshed := true;
  else
    if (select count(*) from public.groundbait_spots where room_id = p_room_id and map = p_map and expires_at > now()) >= 8 then
      raise exception 'too many spots' using errcode = '22023';
    end if;
    if (select count(*) from public.groundbait_spots where thrown_by = v_account and expires_at > now()) >= 2 then
      raise exception 'spot limit' using errcode = '22023';
    end if;
    v_until := now() + interval '10 minutes';
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p_item and qty >= 1;
  if not found then raise exception 'no groundbait' using errcode = '22023'; end if;
  if v_refreshed then
    update public.groundbait_spots set expires_at = v_until, stacks = least(3, stacks + 1) where id = g.id
    returning * into g;
  else
    insert into public.groundbait_spots (room_id, map, x, y, item, thrown_by, thrown_at, expires_at, stacks)
    values (p_room_id, p_map, v_x, v_y, p_item, v_account, now(), v_until, 1)
    returning * into g;
  end if;
  return jsonb_build_object('groundbait', jsonb_build_object('id', g.id, 'item', g.item, 'map', g.map, 'x', g.x, 'y', g.y,
                                                             'until', g.expires_at, 'stacks', g.stacks, 'refreshed', v_refreshed),
                            'state', public._fishing_state(v_account));
end $$;
revoke all on function public.throw_groundbait(uuid, text, text, text, integer, integer) from public;
grant execute on function public.throw_groundbait(uuid, text, text, text, integer, integer) to anon, authenticated;

-- ---------- D. groundbait_spots ----------
-- The room's active spots (one map, or all with null), newest first: what the 2D / 3D views, the minimap and the HUD
-- draw. left_ms is the server's count, so a client's wrong clock does not matter.
create or replace function public.groundbait_spots(p_room_id uuid, p_session_token text, p_map text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'item', g.item, 'name', i.name, 'map', g.map, 'x', g.x, 'y', g.y, 'stacks', g.stacks,
             'until', g.expires_at, 'left_ms', greatest(0, floor(extract(epoch from (g.expires_at - now())) * 1000))::bigint,
             'by', a.username, 'mine', g.thrown_by is not distinct from v_account)
           order by g.thrown_at desc)
      from public.groundbait_spots g
      join public.shop_items i on i.id = g.item
      left join public.accounts a on a.id = g.thrown_by
     where g.room_id = p_room_id and g.expires_at > now() and (p_map is null or g.map = p_map)), '[]'::jsonb);
end $$;
revoke all on function public.groundbait_spots(uuid, text, text) from public;
grant execute on function public.groundbait_spots(uuid, text, text) to anon, authenticated;

-- ---------- The callers: their room's spots ----------

create or replace function public.start_cast(p_room_id uuid, p_session_token text, p_col integer default null,
                                             p_row integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
        v_spot text := 'dock'; v_bites boolean := true;                                  -- v18.1
        v_boost real;                                                                    -- v18.2
        v_seed bigint := floor(random() * 4294967296)::bigint;                           -- 0046: the reel's seed (u32)
        v_vitals jsonb;                                                                  -- 0047
        v_ac jsonb;                                                                      -- 0057
        v_abandoned jsonb;                                                               -- 0059
        v_lift text;                                                                     -- econ v2
        v_rig jsonb; v_gb text; v_diff integer; v_extra jsonb;                          -- 0110
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_col is null or p_row is null then raise exception 'bad spot' using errcode = '22023'; end if;   -- 0057: the cell is where I stand (every client since v18.1)
  if p_col is not null or p_row is not null then                                         -- v18.1: null = an older client (docks only)
    v_spot := public._pond_spot(p_col, p_row);
    if v_spot is null then raise exception 'bad spot' using errcode = '22023'; end if;
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;   -- v18.8
  perform public._vitals_guard(v_account);
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'start_cast', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                     -- 0057
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);                                  -- 0059: a hooked cast replaced is given up
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then                                       -- v18.2
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 0110 {
  -- a bare rod casts only with a hook and a line mounted (Cần gỗ is a kit); the groundbait on this spot
  v_rig := public._fishing_rig(v_account);
  if not (v_rig->>'ready')::boolean then
    raise exception 'rod needs parts' using errcode = '22023', detail = (v_rig->'missing')::text;
  end if;
  v_gb := public._groundbait_at(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, p_room_id);   -- 0117 was: v_gb := public._groundbait_at(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4);
  -- 0110 }
  -- 1. / 1b. 0047: no hourly or daily cast cap (casts cost hunger and thirst instead, step 6)
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
  sp := public._species_pick(v_rarity, false, v_rig->>'hook_class', p.bait, v_gb);   -- 0110 was: select * into sp from public.fish_species where rarity = v_rarity and water = 'pond' order by random() limit 1;   -- econ v2 was: select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, false) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
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
  v_window := (v_rig->>'window_ms')::int;   -- 0110 was: v_window := coalesce(bob.window_ms, 1500);
  v_diff := greatest(1, least(100, sp.difficulty + (v_rig->>'reel_ease')::int));   -- the reel   -- 0110
  v_min_reel := round((2000 + 40 * v_diff) * (v_rig->>'reel_speed')::numeric)::int;   -- 0110 was: v_min_reel := 2000 + 40 * sp.difficulty;
  v_extra := public._cast_extras(v_rig, p.rod, p.bait, (v_fx->>'bigRare')::double precision,   -- 0110
                                 not (public._room_weather(p_room_id)).is_day, false, 0, v_gb, rod.weight_k);   -- 0110
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod,                                         -- v18.1
                            reel_seed, reel_params, line, line_g, rod_g, extra)   -- 0110 was: reel_seed, reel_params)                                        -- 0046
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          v_spot, v_bites, sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,   -- v18.1
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),                        -- 0046
                                     'difficulty', v_diff, 'min_reel_ms', v_min_reel),   -- 0110 was: 'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
          v_rig->>'line', (v_rig->>'line_g')::int, (v_rig->>'rod_g')::int, v_extra)   -- 0110
  returning id into v_id;
  -- 6. 0047: the effort — hunger 1.8, thirst 2.2 (no cap counters, no cast_daily_cap flag)
  -- econ v2 (F6): hunger 0.35, thirst 0.45
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', v_diff,   -- 0110 was: 'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'groundbait', v_gb,   -- 0110
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'abandoned', v_abandoned,                                                             -- 0059 was: 'reel_seed', v_seed,                                                                  -- 0046
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;

create or replace function public.start_river_cast(p_room_id uuid, p_session_token text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);
        v_boost real;
        v_seed bigint := floor(random() * 4294967296)::bigint;
        v_vitals jsonb; v_ac jsonb; v_abandoned jsonb; v_shoal boolean;
        v_lift text;                                                                     -- econ v2
        v_rig jsonb; v_gb text; v_diff integer; v_extra jsonb;                          -- 0110
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if not public._river_water(p_x, p_y) then
    return public._ac_flag(v_account, 'bad_spot', 'start_river_cast', jsonb_build_object('x', p_x, 'y', p_y), p_room_id, 'bad spot');
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  v_ac := public._pos_claim(v_account, 'song_cai', p_x, p_y, 'start_river_cast', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  v_shoal := public._river_shoal(p_x, p_y);
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 0110 {
  -- a bare rod casts only with a hook and a line mounted (Cần gỗ is a kit); the groundbait on this spot
  v_rig := public._fishing_rig(v_account);
  if not (v_rig->>'ready')::boolean then
    raise exception 'rod needs parts' using errcode = '22023', detail = (v_rig->'missing')::text;
  end if;
  v_gb := public._groundbait_at(v_account, 'song_cai', p_x, p_y, p_room_id);   -- 0117 was: v_gb := public._groundbait_at(v_account, 'song_cai', p_x, p_y);
  -- 0110 }
  delete from public.casts where account_id = v_account;
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
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
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,
                                  not (public._room_weather(p_room_id)).is_day);
  if v_rarity < 3 and random() < (case when v_shoal then 0.10 else 0.05 end) then v_rarity := 3; end if;   -- econ v2 was: if v_rarity < 3 and random() < (case when v_shoal then 1.0 / 3 else 0.2 end) then v_rarity := 3; end if;   -- the river
  sp := public._species_pick(v_rarity, true, v_rig->>'hook_class', p.bait, v_gb);   -- 0110 was: select * into sp from public.fish_species
   -- 0110 was: where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   -- 0110 was: order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, true) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);
  v_bite := greatest(1000, round(v_bite * v_boost)::int);
  v_window := (v_rig->>'window_ms')::int;   -- 0110 was: v_window := coalesce(bob.window_ms, 1500);
  v_diff := greatest(1, least(100, sp.difficulty + (v_rig->>'reel_ease')::int));   -- the reel   -- 0110
  v_min_reel := round((2000 + 40 * v_diff) * (v_rig->>'reel_speed')::numeric)::int;   -- 0110 was: v_min_reel := 2000 + 40 * sp.difficulty;
  v_extra := public._cast_extras(v_rig, p.rod, p.bait, (v_fx->>'bigRare')::double precision,   -- 0110
                                 not (public._room_weather(p_room_id)).is_day, true, (case when v_shoal then 0.10 else 0.05 end), v_gb, rod.weight_k);   -- 0110
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod, reel_seed, reel_params, line, line_g, rod_g, extra)   -- 0110 was: spot, bites, big, rod, reel_seed, reel_params)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          'boat', not (public._rain_cold(v_account) and random() < 0.3),
          sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),
                                     'difficulty', v_diff, 'min_reel_ms', v_min_reel),   -- 0110 was: 'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
          v_rig->>'line', (v_rig->>'line_g')::int, (v_rig->>'rod_g')::int, v_extra)   -- 0110
  returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', v_diff,   -- 0110 was: 'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'groundbait', v_gb,   -- 0110
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

create or replace function public.start_river_cast_w(p_room_id uuid, p_session_token text, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);
        v_boost real;
        v_seed bigint := floor(random() * 4294967296)::bigint;
        v_vitals jsonb; v_ac jsonb; v_abandoned jsonb; v_shoal boolean;
        v_lift text;                                                                     -- econ v2
        v_rig jsonb; v_gb text; v_diff integer; v_extra jsonb;                          -- 0110
begin
  -- 0095: Sông Cái's own water is 0086's cast, zone-local
  if p_map = 'song_cai' then return public.start_river_cast(p_room_id, p_session_token, p_x, p_y); end if;
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_map is distinct from 'wild' or not public._river_world_water(p_x, p_y)   -- 0095: the wild's water only
     or not exists (select 1 from public._world_to_zone(p_x, p_y) z where z.zone = 'wild') then
    return public._ac_flag(v_account, 'bad_spot', 'start_river_cast_w', jsonb_build_object('map', left(p_map, 16), 'x', p_x, 'y', p_y), p_room_id, 'bad spot');
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  -- econ v2 (F3): the river needs Sông Cái unlocked (level 3), like the row out
  if not public._map_unlocked(v_account, 'song_cai') then raise exception 'map locked' using errcode = '22023'; end if;   -- econ v2
  v_ac := public._pos_claim(v_account, 'wild', p_x, p_y, 'start_river_cast_w',   -- 0095
                           p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  v_shoal := false;                                                    -- 0095: the shoals are Sông Cái's
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 0110 {
  -- a bare rod casts only with a hook and a line mounted (Cần gỗ is a kit); the groundbait on this spot
  v_rig := public._fishing_rig(v_account);
  if not (v_rig->>'ready')::boolean then
    raise exception 'rod needs parts' using errcode = '22023', detail = (v_rig->'missing')::text;
  end if;
  v_gb := public._groundbait_at(v_account, 'wild', p_x, p_y, p_room_id);   -- 0117 was: v_gb := public._groundbait_at(v_account, 'wild', p_x, p_y);
  -- 0110 }
  delete from public.casts where account_id = v_account;
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
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
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,
                                  not (public._room_weather(p_room_id)).is_day);
  if v_rarity < 3 and random() < (case when v_shoal then 0.10 else 0.05 end) then v_rarity := 3; end if;   -- econ v2 was: if v_rarity < 3 and random() < (case when v_shoal then 1.0 / 3 else 0.2 end) then v_rarity := 3; end if;   -- the river
  sp := public._species_pick(v_rarity, true, v_rig->>'hook_class', p.bait, v_gb);   -- 0110 was: select * into sp from public.fish_species
   -- 0110 was: where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   -- 0110 was: order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, true) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);
  v_bite := greatest(1000, round(v_bite * v_boost)::int);
  v_window := (v_rig->>'window_ms')::int;   -- 0110 was: v_window := coalesce(bob.window_ms, 1500);
  v_diff := greatest(1, least(100, sp.difficulty + (v_rig->>'reel_ease')::int));   -- the reel   -- 0110
  v_min_reel := round((2000 + 40 * v_diff) * (v_rig->>'reel_speed')::numeric)::int;   -- 0110 was: v_min_reel := 2000 + 40 * sp.difficulty;
  v_extra := public._cast_extras(v_rig, p.rod, p.bait, (v_fx->>'bigRare')::double precision,   -- 0110
                                 not (public._room_weather(p_room_id)).is_day, true, (case when v_shoal then 0.10 else 0.05 end), v_gb, rod.weight_k);   -- 0110
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod, reel_seed, reel_params, line, line_g, rod_g, extra)   -- 0110 was: spot, bites, big, rod, reel_seed, reel_params)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          'boat', not (public._rain_cold(v_account) and random() < 0.3),
          sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),
                                     'difficulty', v_diff, 'min_reel_ms', v_min_reel),   -- 0110 was: 'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
          v_rig->>'line', (v_rig->>'line_g')::int, (v_rig->>'rod_g')::int, v_extra)   -- 0110
  returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', v_diff,   -- 0110 was: 'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'groundbait', v_gb,   -- 0110
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

create or replace function public.net_haul(p_session_token text, p_throw_id uuid, p_press integer, p_release integer,
                                           p_aim_x integer, p_aim_y integer, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_n integer; v_free integer; sp public.fish_species;
        v_w integer; v_price integer; r public.fish_price_index; v_mult numeric := 1; v_room boolean;
        v_haul jsonb := '[]'::jsonb; v_d integer; v_vitals jsonb; v_bad text; v_rep jsonb; v_ac jsonb;
        v_radius integer; v_in jsonb;
        v_gb text;   -- 0110
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select * into t from public.net_throws where account_id = v_account and id = p_throw_id for update;
  if not found or t.haul is not null then raise exception 'throw not found' using errcode = '22023'; end if;
  if t.arrow_seed is null then                                                            -- rolled before 0056
    delete from public.net_throws where id = t.id;
    return public._net_outdated(v_account);
  end if;
  -- the throw is spent: one use of the net (a net at 0 is removed) and the throw's effort
  select durability into v_d from public.inventory where account_id = v_account and item_id = t.net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  if v_d <= 1 then
    delete from public.inventory where account_id = v_account and item_id = t.net;
  else
    update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = t.net;
  end if;
  perform public._vitals_apply(v_account);
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 3, 3.5);
  v_in := jsonb_build_object('press', p_press, 'release', p_release, 'aim_x', p_aim_x, 'aim_y', p_aim_y, 'hits', p_hits);
  if now() > t.started_at + interval '120 seconds' then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'vitals', v_vitals, 'state', public._fishing_state(v_account));
  end if;
  v_bad := coalesce(public._net_throw_error(p_press, p_release, p_aim_x, p_aim_y),
                    case when p_hits is null or p_hits < 0 or p_hits > 5 then 'hits' end);
  if v_bad is not null then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_bad_input', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'error', v_bad, 'inputs', v_in), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  v_radius := coalesce((select radius_px from public.shop_items where id = t.net), 24);
  v_rep := public._net_haul_replay(t.seed, v_radius, p_press, p_release, p_aim_x, p_aim_y);
  if (v_rep->>'hits')::int <> p_hits then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_mismatch', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'seed', t.seed, 'radius', v_radius, 'inputs', v_in, 'replay', v_rep), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  if now() < t.started_at + make_interval(secs => 0.9 * (p_release + 42 + 90) / 60.0) then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_too_fast', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'started_at', t.started_at, 'hauled_at', now(), 'inputs', v_in,
                                 'need_s', round(0.9 * (p_release + 42 + 90) / 60.0, 3)), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  perform public._ac_stat(v_account, 'net', 1, case when (v_rep->>'hits')::int >= 3 then 1 else 0 end,   -- 0065: the round
                          case when (v_rep->>'hits')::int = 5 then 1 else 0 end);                             -- 0065
  v_n := (v_rep->>'count')::int;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  v_n := least(v_n, v_free);
  if v_n = 0 then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'empty', 'count', 0, 'fish', '[]'::jsonb, 'vitals', v_vitals,
                              'state', public._fishing_state(v_account));
  end if;
  v_room := t.room_id is not null and exists (select 1 from public.rooms where id = t.room_id);
  if v_room then
    r := public._fish_index(t.room_id, now());
    v_mult := r.mult;
  end if;
  v_gb := public._groundbait_at(v_account, 'pond', t.x, t.y, t.room_id);   -- the room's spot   -- 0117 was: v_gb := public._groundbait_at(v_account, 'pond', t.x, t.y);   -- the thrower's groundbait   -- 0110
  for i in 1 .. v_n loop
    sp := public._net_pick(t.net, v_gb);   -- 0110 was: select * into sp from public.fish_species where rarity in (1, 2) order by random() limit 1;
    v_w := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), 2.0))::int);
    v_price := greatest(1, round(sp.price_per_kg * v_w / 1000.0 * v_mult
                                 * case when v_room then public._fish_factor(t.room_id, sp.id, r.period) else 1 end)::int);
    v_haul := v_haul || jsonb_build_array(jsonb_build_object('species_id', sp.id, 'weight_g', v_w, 'price', v_price,
                                                             'rarity', sp.rarity));
  end loop;
  update public.net_throws set haul = v_haul, hauled_at = now(), land_tick = (v_rep->>'land_tick')::int, inputs = v_in
   where id = t.id;
  return jsonb_build_object('result', 'haul', 'count', v_n, 'fish', v_haul, 'quality', (v_rep->>'quality')::int,
    'arrow_seed', t.arrow_seed, 'vitals', v_vitals, 'state', public._fishing_state(v_account));
end; $$;

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
                        from public.groundbait_spots g where g.thrown_by = p_account and g.expires_at > now() order by g.thrown_at desc limit 1),   -- 0117 was: from public.fishing_groundbait g where g.account_id = p_account and g.expires_at > now()),   -- 0110
    'notebook', public._owns(p_account, 'fishbook'),   -- 0110
    'rig', public._fishing_rig(p_account),   -- 0110
    'rod_id', p.rod_id,   -- 0115
    'rods', public._rod_list_json(p_account),   -- 0115
    'parts', coalesce((select jsonb_object_agg(i.item_id, i.qty) from public.inventory i join public.shop_items s on s.id = i.item_id   -- 0115
                        where i.account_id = p_account and i.qty >= 1 and s.kind in ('hook', 'line', 'reel', 'bobber')), '{}'::jsonb),   -- 0115
    'lock', public._ac_lock_state(p_account)
  );
end; $$;
