-- =========================================================
-- 0086_explore_minigames.sql — v22 group "explore" (owner 2026-09-29: every instant/waiting v21 action becomes a short
-- skill minigame; the boat sails out to a new map, Sông Cái). ADDITIVE and re-runnable. Run after 0082.
--   A. Sông Cái (map 'song_cai', 960 × 480, level 3): a big river reached only by boat. Its water (a band between the
--      banks, less four rocks and an island) and three shoals — lib/game/river/geometry.ts mirrors them (tests pin them).
--      _pos_maps is re-created with its row; there is NO portal to it: only river_row_finish moves the server position
--      onto the river (from Cầu ao's pier, boat owners only) and back to the pier, so walking there is 'no_path'.
--   B. The rowing minigame (lib/game/river/row.ts, statement for statement): _row_round, _row_replay,
--      _row_input_error; tests/fixtures/row-cases.json pins both. river_row_start (dir 'out' | 'home': the boat, the
--      storm, the level, the pier / the water; 4 stamina; a secret seed) → river_row_finish (the strokes, replayed: hard
--      row_bad_input / row_mismatch / row_too_fast; soft row_timing, the 5th in 24 h hard). A pass moves the position;
--      a missed row out drifts back (try again), the way home always arrives (nobody is stranded on the river).
--   C. Fishing on the river: start_river_cast(x, y) claims the boat's spot on the water and is 0076's start_boat_cast
--      from there (spot 'boat': the deep water's species, 0076's casts_zz_water; a shoal lifts a common roll to rarity 3
--      one time in three instead of five). The cast goes on through the unchanged hook_cast / finish_cast. Five river
--      species join the deep water. start_boat_cast and board_boat (the moored ghe in the pond) now refuse 'outdated'.
--   D. Treasure maps: the dig is a minigame. treasure_ping(x, y) — the metal detector — claims the position and answers
--      only a distance band (0 on the spot … 7 cold) for where I stand (≥ 0.4 s apart, ≤ 800 a map); treasure_dig_start
--      on the spot (band 0; one start per 4 s; 3 stamina) rolls the loot within 0076's bounds and a seed for the shovel
--      (0072's dig sim: _mine_round / _mine_replay / _mine_input_error / _mine_timing, need 3); treasure_dig_finish
--      replays it (hard treasure_bad_input / treasure_mismatch / treasure_too_fast; soft treasure_timing) and pays
--      'treasure' (a clean dig — no miss — +10 %, capped at 0076's 2 500; the 8 000 jackpot unchanged). A failed dig keeps
--      the map. 0076's dig_treasure now refuses 'outdated'.
--   E. The wipe: an AFTER INSERT trigger on anticheat_wipes clears this migration's rows.
-- Events emitted: 'river_row' (qty = beats hit, meta {dir}), 'treasure_found' (as 0076: qty = coins, meta map/spot),
-- 'xp_grant' (qty 50, meta {"source":"fishing"}, as 0076). Events consumed: none. Ledger reasons: 'treasure' only.
-- Re-created functions I did not create: public._pos_maps() (0072's, the newest, verbatim but for the row marked 0086);
-- public.start_boat_cast, public.board_boat, public.dig_treasure (0076's) are replaced by 'outdated' refusals.
-- =========================================================

-- ---------- A. Sông Cái ----------
-- _pos_maps (0072_mining_crafting.sql's, verbatim but for the row marked 0086)
create or replace function public._pos_maps() returns table (map text, w integer, h integer)
language sql immutable parallel safe
as $$
  values ('hall', 640, 400), ('pond', 640, 400), ('field', 800, 480), ('market', 1280, 400), ('khu_nha', 800, 400),
         ('bai_dat', 800, 400), ('ham_ngam', 480, 320),
         ('mo_da', 640, 400),                                                                            -- 0072
         ('song_cai', 960, 480)                                                                          -- 0086
$$;
revoke all on function public._pos_maps() from public, anon, authenticated;

-- 0070's level gate: the river opens at character level 3 (lib/game/progression/model.ts MAP_MIN_LEVEL).
insert into public.map_levels (map, min_level) values ('song_cai', 3) on conflict (map) do nothing;

-- The river's geometry (lib/game/river/geometry.ts RIVER): the water band, the rocks and the island (x, y, r), the
-- shoals (x, y, r), where the boat lands on the river and on the pond (Cầu ao's pier, 0076's _boat_geo).
create or replace function public._river_geo() returns jsonb
language sql immutable parallel safe
as $$ select '{"x0": 48, "y0": 80, "x1": 944, "y1": 400,
               "rocks": [[300, 150, 18], [520, 330, 22], [700, 120, 16], [820, 300, 20], [620, 230, 44]],
               "shoals": [[250, 300, 56], [560, 140, 56], [860, 210, 50]],
               "arrive_x": 80, "arrive_y": 240, "pier_x": 378, "pier_y": 206}'::jsonb $$;
revoke all on function public._river_geo() from public, anon, authenticated;

-- Is (x, y) on the river's water? Lenient by the hull (8 px): the band grown by 8, the rocks shrunk by 8 — the client
-- walks the exact water, so every point it stands on passes.
create or replace function public._river_water(p_x integer, p_y integer) returns boolean
language plpgsql immutable parallel safe
as $$
declare g jsonb := public._river_geo(); r jsonb;
begin
  if p_x is null or p_y is null
     or p_x < (g->>'x0')::int - 8 or p_x > (g->>'x1')::int + 8 or p_y < (g->>'y0')::int - 8 or p_y > (g->>'y1')::int + 8 then
    return false;
  end if;
  for r in select * from jsonb_array_elements(g->'rocks') loop
    if (p_x - (r->>0)::int) ^ 2 + (p_y - (r->>1)::int) ^ 2 < ((r->>2)::int - 8) ^ 2 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public._river_shoal(p_x integer, p_y integer) returns boolean
language sql immutable parallel safe
as $$ select exists (select 1 from jsonb_array_elements(public._river_geo()->'shoals') s
                      where (p_x - (s->>0)::int) ^ 2 + (p_y - (s->>1)::int) ^ 2 <= ((s->>2)::int) ^ 2) $$;
revoke all on function public._river_water(integer, integer) from public, anon, authenticated;
revoke all on function public._river_shoal(integer, integer) from public, anon, authenticated;

-- Move the server position (the boat's trip: no road links the pond and the river, so no claim could). The same writes
-- as _pos_claim's accepted branch (0058's tab track included).
create or replace function public._river_move(p_account uuid, p_map text, p_x integer, p_y integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_tab text := public._pos_tab();
begin
  insert into public.player_pos (account_id, map, x, y, at) values (p_account, p_map, p_x, p_y, now())
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at;
  update public.player_pos set tab = coalesce(v_tab, tab),
         tabs = case when v_tab is null then tabs else public._pos_tabs(tabs, v_tab, p_map, p_x, p_y) end
   where account_id = p_account;
end $$;
revoke all on function public._river_move(uuid, text, integer, integer) from public, anon, authenticated;

-- ---------- B. The rowing (lib/game/river/row.ts, statement for statement) ----------
-- 12 beats: [target 1 … target 12, side 1 … side 12]. Beat 1 comes after the 90-tick lead-in, each next one 34 + u mod 21
-- ticks later; the side (0 left, 1 right) alternates, except one beat in five (by u >> 8) repeats the last side.
create or replace function public._row_round(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; u bigint; t integer := 0; sd integer := 0;
        tg integer[] := '{}'; sides integer[] := '{}';
begin
  for b in 0 .. 11 loop
    r := public._reel_rand(st);
    u := r[1];
    st := r[2];
    if b = 0 then
      t := 90;
      sd := ((u >> 8) & 1)::int;
    else
      t := t + 34 + (u % 21)::int;
      if (u >> 8) % 5 <> 0 then sd := 1 - sd; end if;
    end if;
    tg := tg || t;
    sides := sides || sd;
  end loop;
  return tg || sides;
end $$;

-- The row from its strokes (each tick * 2 + side): {outcome pass|fail, ticks (the last beat's window + 1), hits, stray,
-- exact (hits within 1 tick)}. A stroke hits the first beat whose window (± 11 ticks) has not passed when it is on its
-- side and inside its window; else it is stray. Pass: hits ≥ need and stray ≤ 6.
create or replace function public._row_replay(p_seed bigint, p_need integer, p_strokes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := public._row_round(p_seed); b integer := 0; hits integer := 0; stray integer := 0;
        exact integer := 0; s integer; t integer; sd integer;
begin
  foreach s in array coalesce(p_strokes, '{}'::integer[]) loop
    t := s / 2;
    sd := s % 2;
    while b < 12 and rd[b + 1] + 11 < t loop b := b + 1; end loop;
    if b < 12 and abs(t - rd[b + 1]) <= 11 and sd = rd[b + 13] then
      if abs(t - rd[b + 1]) <= 1 then exact := exact + 1; end if;
      hits := hits + 1;
      b := b + 1;
    else
      stray := stray + 1;
    end if;
  end loop;
  return jsonb_build_object('outcome', case when hits >= p_need and stray <= 6 then 'pass' else 'fail' end,
                            'ticks', rd[12] + 12, 'hits', hits, 'stray', stray, 'exact', exact);
end $$;

-- rowInputError: at most 40 strokes, each in [0, ticks · 2), increasing, at most 3 in any 12 ticks; ticks 1 … 1 200.
create or replace function public._row_input_error(p_strokes integer[], p_ticks integer) returns text
language plpgsql immutable parallel safe
as $$
declare n integer := coalesce(cardinality(p_strokes), 0);
begin
  if p_ticks is null or p_ticks < 1 or p_ticks > 1200 then return 'ticks'; end if;
  if n > 40 then return 'too_many'; end if;
  if n = 0 then return null; end if;
  if array_ndims(p_strokes) <> 1 or array_lower(p_strokes, 1) <> 1 then return 'shape'; end if;
  for i in 1 .. n loop
    if p_strokes[i] is null or p_strokes[i] < 0 or p_strokes[i] >= p_ticks * 2 then return 'range'; end if;
    if i > 1 and p_strokes[i] <= p_strokes[i - 1] then return 'order'; end if;
    if i > 3 and p_strokes[i] / 2 - p_strokes[i - 3] / 2 < 12 then return 'rate'; end if;
  end loop;
  return null;
end $$;
revoke all on function public._row_round(bigint) from public, anon, authenticated;
revoke all on function public._row_replay(bigint, integer, integer[]) from public, anon, authenticated;
revoke all on function public._row_input_error(integer[], integer) from public, anon, authenticated;

create table if not exists public.river_rows (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  dir text not null check (dir in ('out', 'home')),
  seed bigint not null,
  need integer not null,
  x integer not null,                  -- where the row started (the pier, or the boat on the river)
  y integer not null,
  started_at timestamptz not null default now()
);
alter table public.river_rows enable row level security;
revoke all on public.river_rows from anon, authenticated;

create or replace function public.river_row_start(p_room_id uuid, p_session_token text, p_dir text,
                                                  p_x integer default null, p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); g jsonb := public._river_geo(); v_ac jsonb;
        v_seed bigint := floor(random() * 4294967296)::bigint; v_x integer; v_y integer; v_need integer;
begin
  if p_dir is null or p_dir not in ('out', 'home') then raise exception 'bad direction' using errcode = '22023'; end if;
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  if p_dir = 'out' then
    v_x := (g->>'pier_x')::int;
    v_y := (g->>'pier_y')::int;
    v_ac := public._pos_claim(v_account, 'pond', v_x, v_y, 'river_row_start', p_room_id, 'too far');
    if v_ac is not null then return v_ac; end if;
    if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
    if not public._map_unlocked(v_account, 'song_cai') then raise exception 'map locked' using errcode = '22023'; end if;
    v_need := 8;
  else
    if not public._river_water(p_x, p_y) then
      return public._ac_flag(v_account, 'bad_spot', 'river_row_start', jsonb_build_object('x', p_x, 'y', p_y), p_room_id, 'invalid spot');
    end if;
    v_x := p_x;
    v_y := p_y;
    v_ac := public._pos_claim(v_account, 'song_cai', v_x, v_y, 'river_row_start', p_room_id, 'too far');
    if v_ac is not null then return v_ac; end if;
    v_need := 6;
  end if;
  perform public._vitals_guard(v_account);
  perform public._stamina_spend(v_account, 4, 'fish');
  insert into public.river_rows (account_id, room_id, dir, seed, need, x, y, started_at)
  values (v_account, p_room_id, p_dir, v_seed, v_need, v_x, v_y, now())
  on conflict (account_id) do update set room_id = excluded.room_id, dir = excluded.dir, seed = excluded.seed,
    need = excluded.need, x = excluded.x, y = excluded.y, started_at = excluded.started_at;
  return jsonb_build_object('row', jsonb_build_object('dir', p_dir, 'seed', v_seed, 'need', v_need, 'started_at', now()));
end $$;

create or replace function public.river_row_finish(p_room_id uuid, p_session_token text, p_strokes integer[],
                                                   p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); w public.river_rows; g jsonb := public._river_geo();
        v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_n integer := coalesce(cardinality(p_strokes), 0);
        v_map text; v_to jsonb; v_exact boolean;
begin
  perform 1 from public.player_pos where account_id = v_account for update;
  delete from public.river_rows where account_id = v_account and room_id = p_room_id returning * into w;
  if not found then raise exception 'row not found' using errcode = '22023'; end if;
  v_map := case when w.dir = 'out' then 'pond' else 'song_cai' end;
  v_ac := public._pos_claim(v_account, v_map, w.x, w.y, 'river_row_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  if now() > w.started_at + interval '60 seconds' then
    return jsonb_build_object('result', 'drift', 'why', 'expired');
  end if;
  v_ev := jsonb_build_object('dir', w.dir, 'ticks', p_ticks, 'n', v_n, 'strokes', to_jsonb(p_strokes[1:40]));
  v_bad := public._row_input_error(p_strokes, p_ticks);
  if v_bad is not null then
    v_code := 'row_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._row_replay(w.seed, w.need, p_strokes);
    if (v_rep->>'ticks')::int <> p_ticks then
      v_code := 'row_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', w.seed, 'replay', v_rep);
    elsif now() < w.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'row_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', w.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  -- the strokes' timing (0065's harvest_timing): ten or more hits, every one within a tick of its beat, is soft; the 5th
  -- such row in 24 h is hard and goes nowhere
  if v_code is null then
    v_exact := (v_rep->>'hits')::int >= 10 and (v_rep->>'exact')::int = (v_rep->>'hits')::int;
    perform public._ac_stat(v_account, 'row', 1, case when v_rep->>'outcome' = 'pass' then 1 else 0 end,
                            case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'row_timing', 'river_row_finish', v_ev || jsonb_build_object('replay', v_rep),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'row_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'row_timing_repeat';
        v_ev := v_ev || jsonb_build_object('replay', v_rep, 'pattern', '5 in 24 h');
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'river_row_finish', v_ev, p_room_id, 'invalid row');
    return jsonb_build_object('result', 'drift', 'why', 'refused') || v_ac;
  end if;
  perform public._game_event(v_account, 'river_row', (v_rep->>'hits')::int, jsonb_build_object('dir', w.dir));
  -- a missed row out drifts back to the pier (try again); the way home always gets there (nobody is stranded)
  if v_rep->>'outcome' <> 'pass' and w.dir = 'out' then
    return jsonb_build_object('result', 'drift', 'why', 'missed', 'hits', (v_rep->>'hits')::int, 'need', w.need);
  end if;
  if w.dir = 'out' then
    perform public._river_move(v_account, 'song_cai', (g->>'arrive_x')::int, (g->>'arrive_y')::int);
    v_to := jsonb_build_object('map', 'song_cai', 'x', (g->>'arrive_x')::int, 'y', (g->>'arrive_y')::int, 'dir', 'right');
  else
    perform public._river_move(v_account, 'pond', (g->>'pier_x')::int, (g->>'pier_y')::int);
    v_to := jsonb_build_object('map', 'pond', 'x', (g->>'pier_x')::int, 'y', (g->>'pier_y')::int, 'dir', 'down');
  end if;
  return jsonb_build_object('result', 'arrived', 'hits', (v_rep->>'hits')::int, 'need', w.need, 'pass', v_rep->>'outcome' = 'pass',
                            'to', v_to);
end $$;

-- ---------- C. Fishing on the river ----------
insert into public.fish_species (id, name, rarity, min_g, max_g, price_per_kg, difficulty, sort_order, water) values
  ('ca_lang',          'Cá lăng',           3,   800,   6000, 150, 62, 230, 'deep'),
  ('ca_ngat',          'Cá ngát',           3,   600,   4000, 180, 61, 231, 'deep'),
  ('ca_dua',           'Cá dứa',            4,  1500,  10000, 170, 79, 232, 'deep'),
  ('ca_anh_vu',        'Cá anh vũ',         4,   500,   3500, 480, 81, 233, 'deep'),
  ('ca_vo_dem',        'Cá vồ đém',         5, 20000, 100000, 170, 97, 234, 'deep')
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, min_g = excluded.min_g, max_g = excluded.max_g,
  price_per_kg = excluded.price_per_kg, difficulty = excluded.difficulty, sort_order = excluded.sort_order,
  water = excluded.water;

-- start_river_cast: 0076's start_boat_cast from the boat's spot on Sông Cái (the claim is where the boat floats).
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
  if v_rarity < 3 and random() < (case when v_shoal then 1.0 / 3 else 0.2 end) then v_rarity := 3; end if;   -- the river
  select * into sp from public.fish_species
   where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);
  v_bite := greatest(1000, round(v_bite * v_boost)::int);
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod, reel_seed, reel_params)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          'boat', not (public._rain_cold(v_account) and random() < 0.3),
          sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),
                                     'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
  returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

-- The moored ghe of 0076 is now the dock: casting from it and boarding it are gone (a page from before 0086).
create or replace function public.start_boat_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;
create or replace function public.board_boat(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;

-- ---------- D. Treasure maps: the detector and the dig ----------
alter table public.treasure_maps add column if not exists last_ping_at timestamptz;
alter table public.treasure_maps add column if not exists pings integer not null default 0;

-- The detector's band for a distance (lib/game/river/treasure.ts DETECTOR_BANDS): 0 on the spot (the dig's 16 px) … 7.
create or replace function public._treasure_band(p_d numeric) returns integer
language sql immutable parallel safe
as $$ select case when p_d <= 16 then 0 when p_d <= 32 then 1 when p_d <= 48 then 2 when p_d <= 72 then 3
                  when p_d <= 96 then 4 when p_d <= 120 then 5 when p_d <= 180 then 6 else 7 end $$;
revoke all on function public._treasure_band(numeric) from public, anon, authenticated;

create table if not exists public.treasure_digs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  map_id uuid not null references public.treasure_maps(id) on delete cascade,
  map text not null,
  x integer not null,
  y integer not null,
  seed bigint not null,
  need integer not null,
  win integer not null,
  loot integer not null,               -- rolled at the start, within 0076's bounds
  started_at timestamptz not null default now()
);
alter table public.treasure_digs enable row level security;
revoke all on public.treasure_digs from anon, authenticated;

create or replace function public.treasure_ping(p_room_id uuid, p_session_token text, p_map_id uuid, p_map text,
                                                p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); t public.treasure_maps; s public.treasure_spots;
        v_ac jsonb;
begin
  select * into t from public.treasure_maps where id = p_map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if t.last_ping_at is not null and t.last_ping_at > now() - interval '400 milliseconds' then
    return jsonb_build_object('band', null, 'wait', true);
  end if;
  if t.pings >= 800 then raise exception 'detector tired' using errcode = '53400'; end if;
  v_ac := public._pos_claim(v_account, p_map, p_x, p_y, 'treasure_ping', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  update public.treasure_maps set last_ping_at = now(), pings = pings + 1 where id = t.id;
  select * into s from public.treasure_spots where id = t.spot;
  if s.map <> p_map then return jsonb_build_object('band', null, 'heat', 'wrong_map'); end if;
  return jsonb_build_object('band', public._treasure_band(sqrt((s.x - p_x) ^ 2 + (s.y - p_y) ^ 2)::numeric));
end $$;

create or replace function public.treasure_dig_start(p_room_id uuid, p_session_token text, p_map_id uuid, p_map text,
                                                     p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); t public.treasure_maps; s public.treasure_spots;
        v_ac jsonb; v_d numeric; v_loot integer; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  select * into t from public.treasure_maps where id = p_map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if t.last_dig_at is not null and t.last_dig_at > now() - interval '4 seconds' then
    raise exception 'dig cooldown' using errcode = '22023', detail = '4';
  end if;
  v_ac := public._pos_claim(v_account, p_map, p_x, p_y, 'treasure_dig_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  update public.treasure_maps set last_dig_at = now(), digs = digs + 1 where id = t.id;
  select * into s from public.treasure_spots where id = t.spot;
  if s.map <> p_map then
    return jsonb_build_object('result', 'miss', 'heat', 'wrong_map', 'map', public._treasure_json(t));
  end if;
  v_d := sqrt((s.x - p_x) ^ 2 + (s.y - p_y) ^ 2);
  if v_d > 16 then
    return jsonb_build_object('result', 'miss', 'heat', case when v_d <= 48 then 'hot' when v_d <= 120 then 'warm' else 'cold' end,
                              'band', public._treasure_band(v_d), 'map', public._treasure_json(t));
  end if;
  perform public._stamina_spend(v_account, 3, 'mine');
  perform public._fishing_effort(v_account, 0.6, 0.8);
  -- 0076's loot: 400–2 500 xu, one chest in twenty a jackpot of 8 000
  v_loot := case when random() < 0.05 then 8000 else 400 + floor(random() * 2101)::int end;
  insert into public.treasure_digs (account_id, room_id, map_id, map, x, y, seed, need, win, loot, started_at)
  values (v_account, p_room_id, t.id, p_map, p_x, p_y, v_seed, 3, 120, v_loot, now())
  on conflict (account_id) do update set room_id = excluded.room_id, map_id = excluded.map_id, map = excluded.map,
    x = excluded.x, y = excluded.y, seed = excluded.seed, need = excluded.need, win = excluded.win, loot = excluded.loot,
    started_at = excluded.started_at;
  return jsonb_build_object('result', 'dig', 'dig', jsonb_build_object('seed', v_seed, 'need', 3, 'win', 120,
                                                                       'started_at', now()));
end $$;

create or replace function public.treasure_dig_finish(p_room_id uuid, p_session_token text, p_strikes integer[],
                                                      p_ticks integer, p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); d public.treasure_digs; t public.treasure_maps;
        s public.treasure_spots; v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_tm jsonb;
        v_n integer := coalesce(cardinality(p_strikes), 0); v_loot integer; v_clean boolean; v_exact boolean;
begin
  perform 1 from public.player_pos where account_id = v_account for update;
  perform public._wallet_lock(v_account);
  delete from public.treasure_digs where account_id = v_account and room_id = p_room_id returning * into d;
  if not found then raise exception 'dig not found' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_account, d.map, d.x, d.y, 'treasure_dig_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into t from public.treasure_maps where id = d.map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if now() > d.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  v_ev := jsonb_build_object('map', d.map_id, 'pass', p_pass, 'ticks', p_ticks, 'n', v_n, 'strikes', to_jsonb(p_strikes[1:12]));
  v_bad := coalesce(public._mine_input_error(p_strikes, p_ticks), case when p_pass is null then 'pass' end);
  if v_bad is not null then
    v_code := 'treasure_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif p_pass then
    v_rep := public._mine_replay(d.seed, d.need, d.win, p_strikes);
    if v_rep->>'outcome' <> 'pass' or (v_rep->>'ticks')::int <> p_ticks or (v_rep->>'used')::int <> v_n then
      v_code := 'treasure_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', d.seed, 'need', d.need, 'win', d.win, 'replay', v_rep);
    elsif now() < d.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'treasure_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', d.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  if v_code is null and v_rep is not null then
    v_tm := public._mine_timing(d.seed, d.need, d.win, p_strikes);
    v_exact := (v_tm->>'used')::int = d.need and (v_tm->>'exact')::int = d.need;
    perform public._ac_stat(v_account, 'treasure', 1, 1, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'treasure_timing', 'treasure_dig_finish', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'treasure_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'treasure_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  elsif v_code is null and p_pass is false then
    perform public._ac_stat(v_account, 'treasure', 1, 0, 0);
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'treasure_dig_finish', v_ev, p_room_id, 'invalid dig');
    return jsonb_build_object('result', 'lost', 'why', 'refused') || v_ac;
  end if;
  if not p_pass then
    return jsonb_build_object('result', 'lost', 'why', 'gave_up');
  end if;
  v_clean := (v_rep->>'used')::int = d.need;
  v_loot := case when d.loot = 8000 then 8000 when v_clean then least(2500, round(d.loot * 1.1)::int) else d.loot end;
  select * into s from public.treasure_spots where id = t.spot;
  update public.treasure_maps set found_at = now(), loot = v_loot where id = t.id;
  perform public._pay(v_account, v_loot, 'treasure', 'map ' || t.id);
  perform public._game_event(v_account, 'treasure_found', v_loot, jsonb_build_object('map', s.map, 'spot', s.id));
  perform public._game_event(v_account, 'xp_grant', 50, '{"source":"fishing"}'::jsonb);
  return jsonb_build_object('result', 'found', 'loot', v_loot, 'jackpot', v_loot = 8000, 'clean', v_clean,
                            'coins', (select coins from public.wallets where account_id = v_account));
end $$;

-- 0076's one-shot dig: gone (a page from before 0086)
create or replace function public.dig_treasure(p_room_id uuid, p_session_token text, p_map_id uuid, p_map text,
                                               p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;

-- ---------- E. The wipe ----------
create or replace function public._explore_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.river_rows where account_id = new.account_id;
  delete from public.treasure_digs where account_id = new.account_id;
  return new;
end $$;
revoke all on function public._explore_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_explore on public.anticheat_wipes;
create trigger anticheat_wipes_explore after insert on public.anticheat_wipes for each row execute function public._explore_on_wipe();

-- ---------- Grants ----------
revoke all on function public.river_row_start(uuid, text, text, integer, integer) from public;
revoke all on function public.river_row_finish(uuid, text, integer[], integer) from public;
revoke all on function public.start_river_cast(uuid, text, integer, integer) from public;
revoke all on function public.treasure_ping(uuid, text, uuid, text, integer, integer) from public;
revoke all on function public.treasure_dig_start(uuid, text, uuid, text, integer, integer) from public;
revoke all on function public.treasure_dig_finish(uuid, text, integer[], integer, boolean) from public;
grant execute on function public.river_row_start(uuid, text, text, integer, integer) to anon, authenticated;
grant execute on function public.river_row_finish(uuid, text, integer[], integer) to anon, authenticated;
grant execute on function public.start_river_cast(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.treasure_ping(uuid, text, uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.treasure_dig_start(uuid, text, uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.treasure_dig_finish(uuid, text, integer[], integer, boolean) to anon, authenticated;
