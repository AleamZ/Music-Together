-- =========================================================
-- 0075_world_bosses.sql — v21 group "world": snow, day/night, wild animals, the party, bosses and the dungeon.
-- ADDITIVE and re-runnable. Run after 0069 (independent of 0070–0074). lib/game/world/model.ts mirrors the static tables
-- (species, items, areas, bosses, dungeon rooms, the wander path); tests/unit/world-sql.test.ts pins them equal.
--   A. Snow ('Tuyết'): room_weather.kind gains 'snow'; _weather_kind maps the WMO snow codes (71–77, 85, 86; 0030 had
--      them as cloudy); _weather_effects gains the snow row. world_snow: a room owner's (or root's) snow event, which
--      _room_weather overlays on the reported weather while it lasts (so every weather effect — bite, thirst, ride speed
--      — follows it; the field's stored weather clock does not). Re-created from 0030 (only the lines marked 0075):
--      _weather_kind, _weather_effects, _room_weather.
--   B. Day/night on the server by VN time: _world_night() (18:00–06:00). Night-only / day-only animals, the night boss,
--      the night market (wild drops sell for 30 % more after dark).
--   C. Wild animals: server spawns (per map, server RNG), a deterministic wander path the client draws and the server
--      re-computes for the range check, hunt / trap / photograph (wild_act), the bag and wild_sell ('wild_sell') at the
--      hunter's stall on Bãi đất trống. A failed hunt of a wolf or bear knocks you back (hunger/thirst −8) with a small
--      faint chance (the faint ladder of 0045).
--   D. The party (≤ 4): create / invite / accept / decline / leave / kick / say; world_state returns the members'
--      server positions for the minimap.
--   E. Bosses: the world boss (12:00, 20:00 VN), the night boss (22:00 VN), the raid boss (summoned by ≥ 3 party members
--      in the arena), the weather bosses (a room's rain / snow). boss_attack: damage is server-computed (40–60 ± the
--      rhythm combo), 0.9 s cooldown, the server position must be in the arena, a per-account cap per fight (so every
--      boss needs several players). Rewards by contribution ('boss_reward') on the killing blow.
--   F. The dungeon: a party instance behind the gate on Bãi đất trống, 4 rooms (the 4th a mini-boss), entry fee
--      ('dungeon_entry'), rewards by contribution ('dungeon_reward'), the same attack rules.
-- Events emitted (game_events): 'wild_hunt', 'wild_trap', 'wild_photo' (meta species, qty), 'boss_hit' (qty = damage,
--   meta boss, fight, combo), 'boss_kill' (meta boss, fight, dmg, coins, killer), 'dungeon_clear' (meta run, dmg, coins),
--   'xp_grant' (meta source 'wild' | 'boss' | 'dungeon'). Consumed: none.
-- Lock order: vitals → player_pos → the fight / run row → wallets.
-- Not in _ac_wipe (a wipe leaves the wild bag, the album and the party; they carry no coins).
-- =========================================================

-- ---------- A. Snow ----------
alter table public.room_weather drop constraint if exists room_weather_kind_check;
alter table public.room_weather add constraint room_weather_kind_check
  check (kind in ('clear', 'cloudy', 'fog', 'rain', 'thunder', 'storm', 'snow'));                     -- 0075: snow

-- 0030's, but the snow codes are 'snow' (were 'cloudy').
create or replace function public._weather_kind(p_code integer, p_wind numeric) returns text
language sql immutable set search_path = public, extensions
as $$
  select case when k in ('rain', 'thunder') and coalesce(p_wind, 0) >= 60 then 'storm' else k end
    from (select case
                   when p_code in (0, 1) then 'clear'
                   when p_code in (2, 3) then 'cloudy'
                   when p_code in (45, 48) then 'fog'
                   when p_code between 51 and 67 or p_code between 80 and 82 then 'rain'
                   when p_code = 95 then 'thunder'
                   when p_code in (96, 99) then 'storm'
                   when p_code between 71 and 77 or p_code in (85, 86) then 'snow'                     -- 0075
                 end as k) x
$$;

-- 0030's, plus the snow row.
create or replace function public._weather_effects(p_kind text, p_is_day boolean) returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select e || case when coalesce(p_is_day, true) then '{}'::jsonb else jsonb_build_object('growth', 0) end
    from (select case p_kind
      when 'clear'   then jsonb_build_object('bite', 1.0, 'bigRare', 1.0, 'dockOpen', true, 'growth', 1.0, 'drying', 1.5, 'pests', 1.0, 'ripeLossPct', 0, 'thirst', 1.3, 'rideSpeed', 1.0)
      when 'fog'     then jsonb_build_object('bite', 1.0, 'bigRare', 1.2, 'dockOpen', true, 'growth', 1.0, 'drying', 0.5, 'pests', 1.2, 'ripeLossPct', 0, 'thirst', 1.0, 'rideSpeed', 0.8)
      when 'rain'    then jsonb_build_object('bite', 0.7, 'bigRare', 1.5, 'dockOpen', true, 'growth', 1.1, 'drying', 0, 'pests', 1.5, 'ripeLossPct', 0, 'thirst', 0.8, 'rideSpeed', 0.9)
      when 'thunder' then jsonb_build_object('bite', 0.5, 'bigRare', 2.0, 'dockOpen', true, 'growth', 1.0, 'drying', 0, 'pests', 1.8, 'ripeLossPct', 10, 'thirst', 0.8, 'rideSpeed', 0.8)
      when 'storm'   then jsonb_build_object('bite', 0, 'bigRare', 1.0, 'dockOpen', false, 'growth', 0.8, 'drying', 0, 'pests', 2.0, 'ripeLossPct', 25, 'thirst', 0.8, 'rideSpeed', 0.6)
      when 'snow'    then jsonb_build_object('bite', 0.8, 'bigRare', 1.3, 'dockOpen', true, 'growth', 0.5, 'drying', 0.3, 'pests', 0.5, 'ripeLossPct', 0, 'thirst', 0.7, 'rideSpeed', 0.7)  -- 0075
      else                jsonb_build_object('bite', 1.1, 'bigRare', 1.0, 'dockOpen', true, 'growth', 1.0, 'drying', 1.0, 'pests', 1.0, 'ripeLossPct', 0, 'thirst', 1.0, 'rideSpeed', 1.0)  -- cloudy
    end as e) x
$$;

create table if not exists public.world_snow (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  started_at timestamptz not null default now(),
  until timestamptz not null,
  started_by uuid references public.accounts(id) on delete set null
);
alter table public.world_snow enable row level security;
revoke all on public.world_snow from anon, authenticated;

-- 0030's, plus the snow event over it (a stale room still snows: the event is live weather of its own).
create or replace function public._room_weather(p_room uuid) returns public.room_weather
language plpgsql stable security definer set search_path = public, extensions
as $$
declare w public.room_weather;
begin
  select * into w from public.room_weather where room_id = p_room;
  if not found or w.updated_at < now() - interval '3 hours' then
    w := null;
    w.room_id := p_room; w.code := 3; w.kind := 'cloudy'; w.is_day := true; w.rain_mm := 0; w.wind_kmh := 0;
  end if;
  -- 0075 {
  if exists (select 1 from public.world_snow s where s.room_id = p_room and s.until > now()) then
    w.kind := 'snow'; w.code := 73; w.temp_c := least(coalesce(w.temp_c, 1), 1);
    w.updated_at := coalesce(w.updated_at, now());
  end if;
  -- 0075 }
  return w;
end $$;
revoke all on function public._weather_kind(integer, numeric) from public, anon, authenticated;
revoke all on function public._weather_effects(text, boolean) from public, anon, authenticated;
revoke all on function public._room_weather(uuid) from public, anon, authenticated;

-- The room's snow event: owner (or root) only, 10–120 min, at most one start per room per 6 h (root: any time).
create or replace function public.snow_event_start(p_room_id uuid, p_session_token text, p_minutes integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_member uuid; v_root boolean;
begin
  v_acc := public._ac_account(p_session_token);
  v_member := public._auth(p_room_id, p_session_token, 'any');
  select coalesce(is_root, false) into v_root from public.accounts where id = v_acc;
  if (select r.admin_member_id from public.rooms r where r.id = p_room_id) is distinct from v_member and not v_root then
    raise exception 'not owner' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 10 and 120 then
    raise exception 'invalid minutes' using errcode = '22023';
  end if;
  if not v_root and exists (select 1 from public.world_snow s where s.room_id = p_room_id and s.started_at > now() - interval '6 hours') then
    raise exception 'too soon' using errcode = '53400';
  end if;
  insert into public.world_snow (room_id, started_at, until, started_by)
  values (p_room_id, now(), now() + make_interval(mins => p_minutes), v_acc)
  on conflict (room_id) do update set started_at = excluded.started_at, until = excluded.until, started_by = excluded.started_by;
  return public._weather_json(public._room_weather(p_room_id));
end $$;

create or replace function public.snow_event_stop(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_member uuid; v_root boolean;
begin
  v_acc := public._ac_account(p_session_token);
  v_member := public._auth(p_room_id, p_session_token, 'any');
  select coalesce(is_root, false) into v_root from public.accounts where id = v_acc;
  if (select r.admin_member_id from public.rooms r where r.id = p_room_id) is distinct from v_member and not v_root then
    raise exception 'not owner' using errcode = '42501';
  end if;
  update public.world_snow set until = least(until, now()) where room_id = p_room_id;
  return public._weather_json(public._room_weather(p_room_id));
end $$;
revoke all on function public.snow_event_start(uuid, text, integer) from public;
revoke all on function public.snow_event_stop(uuid, text) from public;
grant execute on function public.snow_event_start(uuid, text, integer) to anon, authenticated;
grant execute on function public.snow_event_stop(uuid, text) to anon, authenticated;

-- ---------- B. Day and night (VN time) ----------
create or replace function public._world_night(p_at timestamptz default now()) returns boolean
language sql stable set search_path = public, extensions
as $$ select extract(hour from p_at at time zone 'Asia/Ho_Chi_Minh') >= 18 or extract(hour from p_at at time zone 'Asia/Ho_Chi_Minh') < 6 $$;
revoke all on function public._world_night(timestamptz) from public, anon, authenticated;

-- ---------- C. Wild animals ----------
-- id, when it is out ('day' | 'night' | 'any'), its maps, the spawn weight, hunt % (0: cannot), trap % (0: cannot),
-- danger (faint % on a failed hunt; > 0 also knocks back), the drop and its range, the wander radius, the XP.
create or replace function public._wild_species() returns table (id text, active text, maps text[], weight integer, hunt integer,
                                                                 trap integer, danger integer, drop_item text, drop_min integer,
                                                                 drop_max integer, radius integer, xp integer)
language sql immutable parallel safe
as $$
  values ('rabbit',  'any',   array['field', 'pond', 'bai_dat'], 30, 70, 85,  0, 'thit_tho',  1, 2, 40,  6),
         ('bird',    'day',   array['field', 'pond'],            25, 35, 60,  0, 'long_vu',   1, 3, 60,  5),
         ('deer',    'day',   array['field', 'bai_dat'],         14, 45,  0,  0, 'sung_huou', 1, 1, 50, 12),
         ('fox',     'night', array['field', 'bai_dat'],         18, 45, 70,  0, 'da_cao',    1, 1, 45, 10),
         ('wolf',    'night', array['field', 'bai_dat'],         14, 40,  0, 10, 'da_soi',    1, 1, 55, 16),
         ('bear',    'night', array['bai_dat'],                   6, 25,  0, 20, 'vuot_gau',  1, 2, 35, 24),
         ('firefly', 'night', array['pond', 'field'],            22,  0, 90,  0, 'dom_dom',   1, 3, 30,  4)
$$;

-- The drops and their price (xu each; × 1.3 at night, the night market).
create or replace function public._wild_items() returns table (id text, price integer)
language sql immutable parallel safe
as $$ values ('thit_tho', 25), ('long_vu', 12), ('sung_huou', 90), ('da_cao', 70), ('da_soi', 120), ('vuot_gau', 220), ('dom_dom', 15) $$;

-- Where they spawn (the animal's home point is uniform in a rect) and how many live per map.
create or replace function public._wild_areas() returns table (map text, x integer, y integer, w integer, h integer)
language sql immutable parallel safe
as $$
  values ('field', 60, 48, 600, 22), ('field', 60, 448, 440, 20),
         ('pond', 500, 60, 110, 280), ('pond', 20, 60, 70, 280),
         ('bai_dat', 100, 215, 600, 30), ('bai_dat', 700, 60, 40, 300)
$$;
create or replace function public._wild_cap(p_map text) returns integer
language sql immutable parallel safe
as $$ select case p_map when 'field' then 6 when 'pond' then 4 when 'bai_dat' then 5 else 0 end $$;

-- The wander path (lib/game/world/model.ts wildXY mirrors it): t = seconds since the spawn.
create or replace function public._wild_xy(p_hx integer, p_hy integer, p_seed integer, p_radius integer, p_t double precision,
                                           out x double precision, out y double precision)
language sql immutable parallel safe
as $$
  select p_hx + p_radius * sin(p_t * 2 * pi() / (20 + (p_seed % 13)) + (p_seed % 628) / 100.0),
         p_hy + p_radius * 0.6 * sin(p_t * 2 * pi() / (27 + (p_seed % 11)) + (p_seed % 314) / 50.0)
$$;
revoke all on function public._wild_species() from public, anon, authenticated;
revoke all on function public._wild_items() from public, anon, authenticated;
revoke all on function public._wild_areas() from public, anon, authenticated;
revoke all on function public._wild_cap(text) from public, anon, authenticated;
revoke all on function public._wild_xy(integer, integer, integer, integer, double precision) from public, anon, authenticated;

create table if not exists public.wild_spawns (
  id bigint generated always as identity primary key,
  map text not null,
  species text not null,
  hx integer not null,
  hy integer not null,
  seed integer not null,
  born_at timestamptz not null default now(),
  expires_at timestamptz not null,
  taken_by uuid references public.accounts(id) on delete set null,
  taken_at timestamptz
);
create index if not exists wild_spawns_map on public.wild_spawns (map, expires_at);
create table if not exists public.wild_profile (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_at timestamptz,          -- the last hunt or photo
  trap_at timestamptz,          -- the last trap
  day date,
  kills integer not null default 0
);
create table if not exists public.wild_bag (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item text not null,
  qty integer not null default 0 check (qty >= 0),
  primary key (account_id, item)
);
create table if not exists public.wild_photos (
  account_id uuid not null references public.accounts(id) on delete cascade,
  spawn_id bigint not null,
  species text not null,
  at timestamptz not null default now(),
  primary key (account_id, spawn_id)
);
alter table public.wild_spawns enable row level security;
alter table public.wild_profile enable row level security;
alter table public.wild_bag enable row level security;
alter table public.wild_photos enable row level security;
revoke all on public.wild_spawns, public.wild_profile, public.wild_bag, public.wild_photos from anon, authenticated;

-- Top the map up to its cap with animals of the hour (server RNG); animals of the wrong hour leave.
create or replace function public._wild_fill(p_map text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_night boolean := public._world_night(); v_live integer; v_sp text; a record;
begin
  if public._wild_cap(p_map) = 0 then return; end if;
  perform pg_advisory_xact_lock(hashtext('wild:' || p_map));
  update public.wild_spawns set expires_at = now()
   where map = p_map and taken_at is null and expires_at > now()
     and species in (select s.id from public._wild_species() s where s.active = case when v_night then 'day' else 'night' end);
  select count(*) into v_live from public.wild_spawns where map = p_map and taken_at is null and expires_at > now();
  for i in 1 .. greatest(0, public._wild_cap(p_map) - v_live) loop
    v_sp := null;
    select s.id into v_sp from public._wild_species() s
     where p_map = any(s.maps) and (s.active = 'any' or (s.active = 'night') = v_night)
     order by -ln(1 - random()) / s.weight limit 1;                     -- a weighted draw
    exit when v_sp is null;
    select * into a from public._wild_areas() ar where ar.map = p_map order by random() limit 1;
    insert into public.wild_spawns (map, species, hx, hy, seed, expires_at)
    values (p_map, v_sp, a.x + floor(random() * a.w)::int, a.y + floor(random() * a.h)::int, floor(random() * 1000000)::int,
            now() + make_interval(secs => 480 + floor(random() * 240)::int));
  end loop;
  delete from public.wild_spawns where map = p_map and expires_at < now() - interval '1 day';
end $$;
revoke all on function public._wild_fill(text) from public, anon, authenticated;

create or replace function public._wild_json(p_account uuid, p_map text) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'animals', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'species', w.species, 'hx', w.hx, 'hy', w.hy, 'seed', w.seed,
                                                             'born_ms', (extract(epoch from w.born_at) * 1000)::bigint,
                                                             'expires_ms', (extract(epoch from w.expires_at) * 1000)::bigint,
                                                             'photographed', exists (select 1 from public.wild_photos ph
                                                                                      where ph.account_id = p_account and ph.spawn_id = w.id))
                                          order by w.id)
                           from public.wild_spawns w
                          where w.map = p_map and w.taken_at is null and w.expires_at > now()), '[]'::jsonb),
    'bag', coalesce((select jsonb_object_agg(b.item, b.qty) from public.wild_bag b where b.account_id = p_account and b.qty > 0), '{}'::jsonb),
    'album', coalesce((select jsonb_object_agg(x.species, x.n) from (select ph.species, count(*) as n from public.wild_photos ph
                                                                        where ph.account_id = p_account group by ph.species) x), '{}'::jsonb),
    'kills_today', coalesce((select case when p.day = public._vn_today() then p.kills else 0 end from public.wild_profile p
                              where p.account_id = p_account), 0))
$$;
revoke all on function public._wild_json(uuid, text) from public, anon, authenticated;

-- Hunt, trap or photograph an animal. The server re-computes where the animal is now and checks it against my server
-- position (hunt/trap ≤ 64 px, photo ≤ 140 px).
create or replace function public.wild_act(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; sp public.wild_spawns; s record; p public.wild_profile;
        v_ax double precision; v_ay double precision; v_ok boolean := false; v_qty integer := 0; v_knock boolean := false;
        v_faint boolean := false; v_len interval; v_night boolean := public._world_night();
begin
  v_acc := public._ac_account(p_session_token);
  if p_action is null or p_action not in ('hunt', 'trap', 'photo') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'wild_act', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  select * into sp from public.wild_spawns where id = p_spawn for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    raise exception 'gone' using errcode = '22023';
  end if;
  select * into s from public._wild_species() ws where ws.id = sp.species;
  select q.x, q.y into v_ax, v_ay from public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, extract(epoch from now() - sp.born_at)) q;
  if pp.map is distinct from sp.map
     or sqrt((pp.x - v_ax) ^ 2 + (pp.y - v_ay) ^ 2) > (case when p_action = 'photo' then 140 else 64 end) then
    raise exception 'too far' using errcode = '22023';
  end if;
  insert into public.wild_profile (account_id) values (v_acc) on conflict do nothing;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;

  if p_action = 'photo' then
    if p.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
    if exists (select 1 from public.wild_photos where account_id = v_acc and spawn_id = sp.id) then
      raise exception 'already photographed' using errcode = '22023';
    end if;
    insert into public.wild_photos (account_id, spawn_id, species) values (v_acc, sp.id, sp.species);
    update public.wild_profile set last_at = now(), day = p.day, kills = p.kills where account_id = v_acc;
    perform public._game_event(v_acc, 'wild_photo', 1, jsonb_build_object('species', sp.species));
    perform public._game_event(v_acc, 'xp_grant', greatest(1, s.xp / 2), jsonb_build_object('source', 'wild'));
    return jsonb_build_object('ok', true, 'action', 'photo', 'species', sp.species, 'wild', public._wild_json(v_acc, sp.map));
  end if;

  if (p_action = 'hunt' and s.hunt = 0) or (p_action = 'trap' and s.trap = 0) then
    raise exception 'cannot' using errcode = '22023';
  end if;
  if (p_action = 'hunt' and p.last_at > now() - interval '4 seconds')
     or (p_action = 'trap' and p.trap_at > now() - interval '20 seconds') then
    raise exception 'cooldown' using errcode = '53400';
  end if;
  if p.kills >= 60 then raise exception 'daily cap' using errcode = '53400'; end if;
  v_ok := random() * 100 < case when p_action = 'hunt' then s.hunt else s.trap end;
  if v_ok then
    update public.wild_spawns set taken_by = v_acc, taken_at = now() where id = sp.id;
    v_qty := s.drop_min + floor(random() * (s.drop_max - s.drop_min + 1))::int;
    insert into public.wild_bag (account_id, item, qty) values (v_acc, s.drop_item, v_qty)
    on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
    p.kills := p.kills + 1;
    perform public._game_event(v_acc, case when p_action = 'hunt' then 'wild_hunt' else 'wild_trap' end, v_qty,
                               jsonb_build_object('species', sp.species, 'item', s.drop_item));
    perform public._game_event(v_acc, 'xp_grant', s.xp, jsonb_build_object('source', 'wild'));
  else
    -- a miss: a dangerous animal at night strikes back; a hunted animal may bolt
    if s.danger > 0 and v_night then
      v_knock := true;
      update public.vitals set hunger = greatest(1, hunger - 8), thirst = greatest(1, thirst - 8) where account_id = v_acc;
      if random() * 100 < s.danger then
        v_len := public._faint(v_acc);
        update public.vitals set fainted_until = now() + v_len, starve_s = 0 where account_id = v_acc;
        v_faint := true;
      end if;
    end if;
    if p_action = 'hunt' and random() < 0.5 then
      update public.wild_spawns set expires_at = now() where id = sp.id;
    end if;
  end if;
  update public.wild_profile
     set last_at = case when p_action = 'hunt' then now() else last_at end,
         trap_at = case when p_action = 'trap' then now() else trap_at end,
         day = p.day, kills = p.kills
   where account_id = v_acc;
  return jsonb_build_object('ok', v_ok, 'action', p_action, 'species', sp.species, 'item', case when v_ok then s.drop_item end,
                            'qty', v_qty, 'knocked', v_knock, 'fainted', v_faint, 'wild', public._wild_json(v_acc, sp.map));
end $$;

-- Sell drops at the hunter's stall on Bãi đất trống (460, 56); after dark it is the night market (× 1.3).
create or replace function public.wild_sell(p_session_token text, p_item text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; v_price integer; v_have integer; v_pay integer; v_bal integer;
begin
  v_acc := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'wild_sell', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  select price into v_price from public._wild_items() where id = p_item;
  if v_price is null then raise exception 'invalid item' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 999 then
    return public._ac_flag(v_acc, 'bad_qty', 'wild_sell', jsonb_build_object('item', left(p_item, 16), 'qty', p_qty), null, 'invalid quantity');
  end if;
  select qty into v_have from public.wild_bag where account_id = v_acc and item = p_item for update;
  if coalesce(v_have, 0) < p_qty then raise exception 'not enough' using errcode = '22023'; end if;
  perform public._wallet_lock(v_acc);
  update public.wild_bag set qty = qty - p_qty where account_id = v_acc and item = p_item;
  v_pay := case when public._world_night() then (v_price * p_qty * 13) / 10 else v_price * p_qty end;
  v_bal := public._pay(v_acc, v_pay, 'wild_sell', p_item || ' x' || p_qty || case when public._world_night() then ' (chợ đêm)' else '' end);
  return jsonb_build_object('earned', v_pay, 'coins', v_bal, 'wild', public._wild_json(v_acc, 'bai_dat'));
end $$;
revoke all on function public.wild_act(text, bigint, text, text, integer, integer) from public;
revoke all on function public.wild_sell(text, text, integer) from public;
grant execute on function public.wild_act(text, bigint, text, text, integer, integer) to anon, authenticated;
grant execute on function public.wild_sell(text, text, integer) to anon, authenticated;

-- ---------- D. The party ----------
create table if not exists public.parties (
  id bigint generated always as identity primary key,
  leader uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.party_members (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  party_id bigint not null references public.parties(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists party_members_party on public.party_members (party_id);
create table if not exists public.party_invites (
  party_id bigint not null references public.parties(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  from_id uuid references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (party_id, account_id)
);
create table if not exists public.party_chat (
  id bigint generated always as identity primary key,
  party_id bigint not null references public.parties(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 120),
  created_at timestamptz not null default now()
);
create index if not exists party_chat_party on public.party_chat (party_id, id);
alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.party_invites enable row level security;
alter table public.party_chat enable row level security;
revoke all on public.parties, public.party_members, public.party_invites, public.party_chat from anon, authenticated;

create or replace function public._party_of(p_account uuid) returns bigint
language sql stable security definer set search_path = public, extensions
as $$ select party_id from public.party_members where account_id = p_account $$;
revoke all on function public._party_of(uuid) from public, anon, authenticated;

create or replace function public._party_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'party', (select jsonb_build_object('id', pa.id, 'leader', pa.leader,
                'members', (select jsonb_agg(jsonb_build_object('id', m.account_id, 'name', a.username,
                                   'map', case when pp.at > now() - interval '2 minutes' then pp.map end,
                                   'x', pp.x, 'y', pp.y) order by m.joined_at)
                              from public.party_members m join public.accounts a on a.id = m.account_id
                              left join public.player_pos pp on pp.account_id = m.account_id
                             where m.party_id = pa.id),
                'chat', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', ca.username, 'body', c.body,
                                                                     'at_ms', (extract(epoch from c.created_at) * 1000)::bigint) order by c.id)
                                    from (select * from public.party_chat c0 where c0.party_id = pa.id order by c0.id desc limit 30) c
                                    left join public.accounts ca on ca.id = c.account_id), '[]'::jsonb))
                from public.parties pa where pa.id = public._party_of(p_account)),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('party_id', i.party_id, 'from', fa.username) order by i.created_at)
                           from public.party_invites i left join public.accounts fa on fa.id = i.from_id
                          where i.account_id = p_account and i.created_at > now() - interval '10 minutes'), '[]'::jsonb))
$$;
revoke all on function public._party_json(uuid) from public, anon, authenticated;

create or replace function public.party_create(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_id bigint;
begin
  v_acc := public._ac_account(p_session_token);
  if public._party_of(v_acc) is not null then raise exception 'in party' using errcode = '22023'; end if;
  insert into public.parties (leader) values (v_acc) returning id into v_id;
  insert into public.party_members (account_id, party_id) values (v_acc, v_id);
  return public._party_json(v_acc);
end $$;

create or replace function public.party_invite(p_session_token text, p_username text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_party bigint; v_to uuid;
begin
  v_acc := public._ac_account(p_session_token);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  if (select leader from public.parties where id = v_party) <> v_acc then raise exception 'not leader' using errcode = '42501'; end if;
  perform 1 from public.parties where id = v_party for update;
  if (select count(*) from public.party_members where party_id = v_party) >= 4 then raise exception 'party full' using errcode = '22023'; end if;
  select id into v_to from public.accounts where lower(username) = lower(trim(coalesce(p_username, '')));
  if v_to is null then raise exception 'no such player' using errcode = '22023'; end if;
  if v_to = v_acc or public._party_of(v_to) = v_party then raise exception 'already in' using errcode = '22023'; end if;
  if (select count(*) from public.party_invites where party_id = v_party and created_at > now() - interval '1 minute') >= 6 then
    raise exception 'too fast' using errcode = '53400';
  end if;
  insert into public.party_invites (party_id, account_id, from_id) values (v_party, v_to, v_acc)
  on conflict (party_id, account_id) do update set created_at = now(), from_id = excluded.from_id;
  return public._party_json(v_acc);
end $$;

create or replace function public.party_accept(p_session_token text, p_party bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid;
begin
  v_acc := public._ac_account(p_session_token);
  if public._party_of(v_acc) is not null then raise exception 'in party' using errcode = '22023'; end if;
  perform 1 from public.parties where id = p_party for update;
  if not found then raise exception 'no party' using errcode = '22023'; end if;
  if not exists (select 1 from public.party_invites where party_id = p_party and account_id = v_acc
                                                     and created_at > now() - interval '10 minutes') then
    raise exception 'no invite' using errcode = '22023';
  end if;
  if (select count(*) from public.party_members where party_id = p_party) >= 4 then raise exception 'party full' using errcode = '22023'; end if;
  delete from public.party_invites where account_id = v_acc;
  insert into public.party_members (account_id, party_id) values (v_acc, p_party);
  return public._party_json(v_acc);
end $$;

create or replace function public.party_decline(p_session_token text, p_party bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid;
begin
  v_acc := public._ac_account(p_session_token);
  delete from public.party_invites where party_id = p_party and account_id = v_acc;
  return public._party_json(v_acc);
end $$;

-- Leave (or, p_kick, the leader removes a member). An empty party is gone; a leaderless one passes to the oldest member.
create or replace function public._party_remove(p_party bigint, p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_next uuid;
begin
  delete from public.party_members where account_id = p_account and party_id = p_party;
  select account_id into v_next from public.party_members where party_id = p_party order by joined_at limit 1;
  if v_next is null then
    delete from public.parties where id = p_party;
  elsif (select leader from public.parties where id = p_party) = p_account then
    update public.parties set leader = v_next where id = p_party;
  end if;
end $$;
revoke all on function public._party_remove(bigint, uuid) from public, anon, authenticated;

create or replace function public.party_leave(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_party bigint;
begin
  v_acc := public._ac_account(p_session_token);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  perform 1 from public.parties where id = v_party for update;
  perform public._party_remove(v_party, v_acc);
  return public._party_json(v_acc);
end $$;

create or replace function public.party_kick(p_session_token text, p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_party bigint;
begin
  v_acc := public._ac_account(p_session_token);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  perform 1 from public.parties where id = v_party for update;
  if (select leader from public.parties where id = v_party) <> v_acc then raise exception 'not leader' using errcode = '42501'; end if;
  if p_account = v_acc or public._party_of(p_account) is distinct from v_party then raise exception 'not member' using errcode = '22023'; end if;
  perform public._party_remove(v_party, p_account);
  return public._party_json(v_acc);
end $$;

create or replace function public.party_say(p_session_token text, p_body text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_party bigint; v_body text := trim(coalesce(p_body, ''));
begin
  v_acc := public._ac_account(p_session_token);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  if char_length(v_body) = 0 or char_length(v_body) > 120 then raise exception 'invalid message' using errcode = '22023'; end if;
  if exists (select 1 from public.party_chat where account_id = v_acc and created_at > now() - interval '1 second') then
    raise exception 'too fast' using errcode = '53400';
  end if;
  insert into public.party_chat (party_id, account_id, body) values (v_party, v_acc, v_body);
  delete from public.party_chat where party_id = v_party
     and id < (select min(id) from (select id from public.party_chat where party_id = v_party order by id desc limit 50) k);
  return public._party_json(v_acc);
end $$;
revoke all on function public.party_create(text) from public;
revoke all on function public.party_invite(text, text) from public;
revoke all on function public.party_accept(text, bigint) from public;
revoke all on function public.party_decline(text, bigint) from public;
revoke all on function public.party_leave(text) from public;
revoke all on function public.party_kick(text, uuid) from public;
revoke all on function public.party_say(text, text) from public;
grant execute on function public.party_create(text) to anon, authenticated;
grant execute on function public.party_invite(text, text) to anon, authenticated;
grant execute on function public.party_accept(text, bigint) to anon, authenticated;
grant execute on function public.party_decline(text, bigint) to anon, authenticated;
grant execute on function public.party_leave(text) to anon, authenticated;
grant execute on function public.party_kick(text, uuid) to anon, authenticated;
grant execute on function public.party_say(text, text) to anon, authenticated;

-- ---------- E. Bosses ----------
-- id, name, kind, the arena (map + rect), HP, the per-account cap (% of HP), the coin pool, minutes up, full XP.
create or replace function public._boss_defs() returns table (id text, name text, kind text, map text, ax integer, ay integer,
                                                              aw integer, ah integer, hp integer, cap_pct integer, pool integer,
                                                              dur_min integer, xp integer)
language sql immutable parallel safe
as $$
  values ('trau_tinh',   'Trâu Tinh',    'world',   'bai_dat', 316, 60, 168, 316, 40000, 20, 3000, 30, 120),
         ('soi_ma',      'Sói Ma',       'night',   'bai_dat', 316, 60, 168, 316, 30000, 25, 2000, 30, 100),
         ('heo_rung',    'Vua Heo Rừng', 'raid',    'bai_dat', 316, 60, 168, 316, 24000, 25, 1600, 20,  90),
         ('thuy_quai',   'Thủy Quái',    'weather', 'pond',    490, 60, 140, 300, 15000, 34,  900, 20,  70),
         ('nguoi_tuyet', 'Người Tuyết',  'snow',    'pond',    490, 60, 140, 300, 15000, 34,  900, 20,  70)
$$;
-- The schedule (VN time).
create or replace function public._boss_schedule() returns table (boss text, at time)
language sql immutable parallel safe
as $$ values ('trau_tinh', time '12:00'), ('trau_tinh', time '20:00'), ('soi_ma', time '22:00') $$;
revoke all on function public._boss_defs() from public, anon, authenticated;
revoke all on function public._boss_schedule() from public, anon, authenticated;

create table if not exists public.boss_fights (
  id bigint generated always as identity primary key,
  boss text not null,
  room_key uuid not null default '00000000-0000-0000-0000-000000000000',   -- a weather boss's room; zeros = the server's
  slot timestamptz not null,
  announce_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hp integer not null,
  max_hp integer not null,
  phase integer not null default 1,
  status text not null default 'up' check (status in ('up', 'dead', 'gone')),
  killed_at timestamptz,
  killer uuid references public.accounts(id) on delete set null,
  party_id bigint,                                                         -- the raid's summoning party
  unique (boss, room_key, slot)
);
create index if not exists boss_fights_live on public.boss_fights (status, ends_at);
create table if not exists public.boss_hits (
  fight_id bigint not null references public.boss_fights(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  dmg integer not null default 0,
  hits integer not null default 0,
  combo integer not null default 0,
  last_at timestamptz,
  primary key (fight_id, account_id)
);
alter table public.boss_fights enable row level security;
alter table public.boss_hits enable row level security;
revoke all on public.boss_fights, public.boss_hits from anon, authenticated;

-- The scheduled fights of now (announced 15 min ahead) and the room's weather boss (one per room per 2 h window).
create or replace function public._boss_ensure(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.room_weather; v_boss text; v_slot timestamptz; b record;
begin
  insert into public.boss_fights (boss, slot, announce_at, starts_at, ends_at, hp, max_hp)
  select s.boss, x.st, x.st - interval '15 minutes', x.st, x.st + make_interval(mins => d.dur_min), d.hp, d.hp
    from public._boss_schedule() s
    join public._boss_defs() d on d.id = s.boss
    cross join generate_series(-1, 1) g(dd)
    cross join lateral (select ((public._vn_today() + g.dd) + s.at) at time zone 'Asia/Ho_Chi_Minh' as st) x
   where now() between x.st - interval '15 minutes' and x.st + make_interval(mins => d.dur_min)
  on conflict do nothing;
  if p_room is not null then
    w := public._room_weather(p_room);
    v_boss := case when w.updated_at is null then null
                   when w.kind in ('rain', 'thunder', 'storm') then 'thuy_quai'
                   when w.kind = 'snow' then 'nguoi_tuyet' end;
    if v_boss is not null then
      select * into b from public._boss_defs() where id = v_boss;
      v_slot := to_timestamp(floor(extract(epoch from now()) / 7200) * 7200);
      insert into public.boss_fights (boss, room_key, slot, announce_at, starts_at, ends_at, hp, max_hp)
      values (v_boss, p_room, v_slot, now(), now() + interval '1 minute', now() + interval '1 minute' + make_interval(mins => b.dur_min),
              b.hp, b.hp)
      on conflict do nothing;
    end if;
  end if;
  update public.boss_fights set status = 'gone' where status = 'up' and ends_at < now();
end $$;
revoke all on function public._boss_ensure(uuid) from public, anon, authenticated;

create or replace function public._boss_json(p_account uuid, p_room uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'fights', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'boss', f.boss, 'name', d.name, 'kind', d.kind, 'map', d.map,
        'arena', jsonb_build_object('x', d.ax, 'y', d.ay, 'w', d.aw, 'h', d.ah),
        'hp', f.hp, 'max_hp', f.max_hp, 'phase', f.phase, 'status', f.status, 'cap', (f.max_hp * d.cap_pct) / 100,
        'starts_ms', (extract(epoch from f.starts_at) * 1000)::bigint, 'ends_ms', (extract(epoch from f.ends_at) * 1000)::bigint,
        'killer', (select username from public.accounts where id = f.killer),
        'my_dmg', coalesce((select h.dmg from public.boss_hits h where h.fight_id = f.id and h.account_id = p_account), 0),
        'my_combo', coalesce((select h.combo from public.boss_hits h where h.fight_id = f.id and h.account_id = p_account), 0),
        'fighters', (select count(*) from public.boss_hits h where h.fight_id = f.id),
        'top', coalesce((select jsonb_agg(jsonb_build_object('name', a.username, 'dmg', t.dmg) order by t.dmg desc)
                           from (select h.account_id, h.dmg from public.boss_hits h where h.fight_id = f.id
                                  order by h.dmg desc limit 5) t join public.accounts a on a.id = t.account_id), '[]'::jsonb))
        order by f.starts_at)
      from public.boss_fights f join public._boss_defs() d on d.id = f.boss
     where (f.room_key = '00000000-0000-0000-0000-000000000000' or f.room_key = p_room)
       and f.announce_at <= now() and f.ends_at > now() - interval '5 minutes'
       and (f.status = 'up' or coalesce(f.killed_at, f.ends_at) > now() - interval '5 minutes')), '[]'::jsonb),
    'next', coalesce((select jsonb_agg(jsonb_build_object('boss', n.boss, 'name', n.name, 'at_ms', (extract(epoch from n.st) * 1000)::bigint)
                                        order by n.st)
      from (select s.boss, d.name, ((public._vn_today() + g.dd) + s.at) at time zone 'Asia/Ho_Chi_Minh' as st
              from public._boss_schedule() s join public._boss_defs() d on d.id = s.boss cross join generate_series(0, 1) g(dd)) n
     where n.st > now() and n.st < now() + interval '24 hours'), '[]'::jsonb))
$$;
revoke all on function public._boss_json(uuid, uuid) from public, anon, authenticated;

-- Pay the pool by contribution (≥ 1 % of the HP to be paid; the killing blow + 5 %), XP by share of the cap.
create or replace function public._boss_payout(p_fight bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.boss_fights; d record; v_total numeric; r record; v_share numeric; v_coins integer; v_xp integer;
begin
  select * into f from public.boss_fights where id = p_fight;
  select * into d from public._boss_defs() where id = f.boss;
  select sum(dmg) into v_total from public.boss_hits where fight_id = p_fight;
  if coalesce(v_total, 0) <= 0 then return; end if;
  for r in select account_id, dmg from public.boss_hits where fight_id = p_fight and dmg > 0 order by account_id loop
    v_share := r.dmg / v_total;
    v_coins := 0;
    if r.dmg * 100 >= f.max_hp then
      v_coins := greatest(20, floor(d.pool * v_share)::int) + case when r.account_id = f.killer then d.pool / 20 else 0 end;
      perform public._wallet_lock(r.account_id);
      perform public._pay(r.account_id, v_coins, 'boss_reward', d.name);
    end if;
    v_xp := round(d.xp * (0.25 + 0.75 * least(1, r.dmg::numeric * 100 / (f.max_hp * d.cap_pct))))::int;
    perform public._game_event(r.account_id, 'xp_grant', v_xp, jsonb_build_object('source', 'boss'));
    perform public._game_event(r.account_id, 'boss_kill', 1,
      jsonb_build_object('boss', f.boss, 'fight', f.id, 'dmg', r.dmg, 'coins', v_coins, 'killer', r.account_id = f.killer));
  end loop;
end $$;
revoke all on function public._boss_payout(bigint) from public, anon, authenticated;

-- One strike at a boss. The client sends only where it stands; the server decides the damage.
create or replace function public.boss_attack(p_session_token text, p_fight bigint, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; f public.boss_fights; d record; h public.boss_hits;
        v_gap double precision; v_combo integer; v_cap integer; v_dmg integer; v_slam boolean := false;
begin
  v_acc := public._ac_account(p_session_token);
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'boss_attack', null, 'not in arena');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  select * into f from public.boss_fights where id = p_fight for update;
  if not found then raise exception 'no boss' using errcode = '22023'; end if;
  select * into d from public._boss_defs() where id = f.boss;
  if f.status <> 'up' or now() < f.starts_at or now() >= f.ends_at then raise exception 'boss not up' using errcode = '53400'; end if;
  if pp.map is distinct from d.map or pp.x not between d.ax - 16 and d.ax + d.aw + 16 or pp.y not between d.ay - 16 and d.ay + d.ah + 16 then
    raise exception 'not in arena' using errcode = '22023';
  end if;
  insert into public.boss_hits (fight_id, account_id) values (f.id, v_acc) on conflict do nothing;
  select * into h from public.boss_hits where fight_id = f.id and account_id = v_acc for update;
  v_gap := coalesce(extract(epoch from now() - h.last_at), 99);
  if v_gap < 0.3 then
    return public._ac_flag(v_acc, 'boss_spam', 'boss_attack', jsonb_build_object('gap', round(v_gap::numeric, 3)), null, 'cooldown', false);
  end if;
  if v_gap < 0.9 then raise exception 'cooldown' using errcode = '53400'; end if;
  v_cap := (f.max_hp * d.cap_pct) / 100;
  if h.dmg >= v_cap then raise exception 'damage cap' using errcode = '53400'; end if;
  v_combo := case when v_gap <= 2.0 then least(h.combo + 1, 5) else 0 end;   -- the rhythm: strike again 0.9–2 s later
  v_dmg := ((40 + floor(random() * 21)::int) * (100 + 15 * v_combo)) / 100;
  if f.phase = 3 then v_dmg := (v_dmg * 4) / 5; end if;                      -- enraged: thicker hide
  v_dmg := greatest(1, least(v_dmg, v_cap - h.dmg, f.hp));
  update public.boss_hits set dmg = dmg + v_dmg, hits = hits + 1, combo = v_combo, last_at = now()
   where fight_id = f.id and account_id = v_acc;
  f.hp := f.hp - v_dmg;
  f.phase := case when f.hp * 3 > f.max_hp * 2 then 1 when f.hp * 3 > f.max_hp then 2 else 3 end;
  if random() < (case f.phase when 1 then 0.10 when 2 then 0.18 else 0.28 end) then          -- the boss strikes back
    v_slam := true;
    update public.vitals set hunger = greatest(1, hunger - 3), thirst = greatest(1, thirst - 3) where account_id = v_acc;
  end if;
  perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', f.boss, 'fight', f.id, 'combo', v_combo));
  if f.hp <= 0 then
    update public.boss_fights set hp = 0, phase = 3, status = 'dead', killed_at = now(), killer = v_acc where id = f.id;
    perform public._boss_payout(f.id);
  else
    update public.boss_fights set hp = f.hp, phase = f.phase where id = f.id;
  end if;
  return jsonb_build_object('dmg', v_dmg, 'combo', v_combo, 'slam', v_slam, 'hp', greatest(0, f.hp), 'phase', f.phase,
                            'killed', f.hp <= 0, 'my_dmg', h.dmg + v_dmg, 'cap', v_cap);
end $$;

-- The raid boss: a party with ≥ 3 members standing in the arena (server positions of the last 2 min) calls it. One raid
-- at a time on the server; a party once an hour.
create or replace function public.boss_summon(p_session_token text, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; v_party bigint; d record; v_in integer;
begin
  v_acc := public._ac_account(p_session_token);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'boss_summon', null, 'not in arena');
  if v_ac is not null then return v_ac; end if;
  select * into d from public._boss_defs() where id = 'heo_rung';
  perform pg_advisory_xact_lock(hashtext('boss:heo_rung'));
  select count(*) into v_in from public.party_members m join public.player_pos pp on pp.account_id = m.account_id
   where m.party_id = v_party and pp.map = d.map and pp.at > now() - interval '2 minutes'
     and pp.x between d.ax - 16 and d.ax + d.aw + 16 and pp.y between d.ay - 16 and d.ay + d.ah + 16;
  if not exists (select 1 from public.player_pos pp where pp.account_id = v_acc and pp.map = d.map
                    and pp.x between d.ax - 16 and d.ax + d.aw + 16 and pp.y between d.ay - 16 and d.ay + d.ah + 16) then
    raise exception 'not in arena' using errcode = '22023';
  end if;
  if v_in < 3 then raise exception 'need 3' using errcode = '53400'; end if;
  if exists (select 1 from public.boss_fights where boss = 'heo_rung' and status = 'up' and ends_at > now()) then
    raise exception 'raid up' using errcode = '53400';
  end if;
  if exists (select 1 from public.boss_fights where boss = 'heo_rung' and party_id = v_party and slot > now() - interval '1 hour') then
    raise exception 'too soon' using errcode = '53400';
  end if;
  insert into public.boss_fights (boss, slot, announce_at, starts_at, ends_at, hp, max_hp, party_id)
  values ('heo_rung', now(), now(), now() + interval '20 seconds', now() + interval '20 seconds' + make_interval(mins => d.dur_min),
          d.hp, d.hp, v_party);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.boss_attack(text, bigint, text, integer, integer) from public;
revoke all on function public.boss_summon(text, text, integer, integer) from public;
grant execute on function public.boss_attack(text, bigint, text, integer, integer) to anon, authenticated;
grant execute on function public.boss_summon(text, text, integer, integer) to anon, authenticated;

-- ---------- F. The dungeon ----------
create or replace function public._dg_rooms() returns table (room integer, mob text, name text, hp integer, n integer)
language sql immutable parallel safe
as $$ values (1, 'doi', 'Dơi hang', 300, 3), (2, 'ran', 'Rắn hang', 450, 3), (3, 'nhen', 'Nhện độc', 700, 2), (4, 'doi_chua', 'Dơi Chúa', 3000, 1) $$;
revoke all on function public._dg_rooms() from public, anon, authenticated;

create table if not exists public.dungeon_runs (
  id bigint generated always as identity primary key,
  party_id bigint references public.parties(id) on delete set null,
  leader uuid references public.accounts(id) on delete set null,
  room integer not null default 1,
  mobs integer[] not null,
  scale numeric not null default 1,
  status text not null default 'open' check (status in ('open', 'cleared', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index if not exists dungeon_runs_party on public.dungeon_runs (party_id, status);
create table if not exists public.dungeon_members (
  run_id bigint not null references public.dungeon_runs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  dmg integer not null default 0,
  hits integer not null default 0,
  combo integer not null default 0,
  last_at timestamptz,
  paid integer not null default 0,
  primary key (run_id, account_id)
);
alter table public.dungeon_runs enable row level security;
alter table public.dungeon_members enable row level security;
revoke all on public.dungeon_runs, public.dungeon_members from anon, authenticated;

create or replace function public._dg_mobs(p_room integer, p_scale numeric) returns integer[]
language sql immutable set search_path = public, extensions
as $$ select array_fill(round(r.hp * p_scale)::int, array[r.n]) from public._dg_rooms() r where r.room = p_room $$;
revoke all on function public._dg_mobs(integer, numeric) from public, anon, authenticated;

-- The gate is at (60, 120) on Bãi đất trống; the fee is 150 xu a head; a run lasts 25 min.
create or replace function public._dg_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('run', (
    select jsonb_build_object('id', r.id, 'room', r.room, 'mobs', to_jsonb(r.mobs), 'mob_max', to_jsonb(public._dg_mobs(r.room, r.scale)),
             'status', r.status, 'expires_ms', (extract(epoch from r.expires_at) * 1000)::bigint, 'leader', r.leader,
             'joined', exists (select 1 from public.dungeon_members m where m.run_id = r.id and m.account_id = p_account),
             'members', coalesce((select jsonb_agg(jsonb_build_object('name', a.username, 'dmg', m.dmg) order by m.dmg desc)
                                    from public.dungeon_members m join public.accounts a on a.id = m.account_id
                                   where m.run_id = r.id), '[]'::jsonb))
      from public.dungeon_runs r
     where r.party_id = public._party_of(p_account)
       and (r.status = 'open' or r.ended_at > now() - interval '2 minutes')
     order by r.id desc limit 1),
    'clears_today', (select count(*) from public.dungeon_members m join public.dungeon_runs r on r.id = m.run_id
                      where m.account_id = p_account and r.status = 'cleared' and (r.ended_at at time zone 'Asia/Ho_Chi_Minh')::date = public._vn_today()))
$$;
revoke all on function public._dg_json(uuid) from public, anon, authenticated;

create or replace function public._dg_expire(p_party bigint) returns void
language sql security definer set search_path = public, extensions
as $$ update public.dungeon_runs set status = 'failed', ended_at = now() where party_id = p_party and status = 'open' and expires_at <= now() $$;
revoke all on function public._dg_expire(bigint) from public, anon, authenticated;

create or replace function public._dg_pay_fee(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if (public._wallet_lock(p_account)).coins < 150 then raise exception 'insufficient funds' using errcode = '22023'; end if;
  perform public._pay(p_account, -150, 'dungeon_entry', 'Hầm ngục');
end $$;
revoke all on function public._dg_pay_fee(uuid) from public, anon, authenticated;

create or replace function public.dungeon_start(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; v_party bigint; v_n integer; v_scale numeric; v_run bigint;
begin
  v_acc := public._ac_account(p_session_token);
  perform public._vitals_guard(v_acc);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_acc, 'bai_dat', 60, 120, 'dungeon_start', null, 'not at gate');
  if v_ac is not null then return v_ac; end if;
  perform 1 from public.parties where id = v_party for update;
  perform public._dg_expire(v_party);
  if exists (select 1 from public.dungeon_runs where party_id = v_party and status = 'open') then
    raise exception 'run open' using errcode = '22023';
  end if;
  select count(*) into v_n from public.party_members where party_id = v_party;
  v_scale := 1 + 0.5 * (v_n - 1);
  perform public._dg_pay_fee(v_acc);
  insert into public.dungeon_runs (party_id, leader, mobs, scale, expires_at)
  values (v_party, v_acc, public._dg_mobs(1, v_scale), v_scale, now() + interval '25 minutes') returning id into v_run;
  insert into public.dungeon_members (run_id, account_id, paid) values (v_run, v_acc, 150);
  return public._dg_json(v_acc);
end $$;

create or replace function public.dungeon_join(p_session_token text, p_run bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; r public.dungeon_runs;
begin
  v_acc := public._ac_account(p_session_token);
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 60, 120, 'dungeon_join', null, 'not at gate');
  if v_ac is not null then return v_ac; end if;
  select * into r from public.dungeon_runs where id = p_run for update;
  if not found or r.status <> 'open' or r.expires_at <= now() then raise exception 'run over' using errcode = '22023'; end if;
  if r.party_id is distinct from public._party_of(v_acc) then raise exception 'not member' using errcode = '42501'; end if;
  if exists (select 1 from public.dungeon_members where run_id = r.id and account_id = v_acc) then
    raise exception 'already in' using errcode = '22023';
  end if;
  perform public._dg_pay_fee(v_acc);
  insert into public.dungeon_members (run_id, account_id, paid) values (r.id, v_acc, 150);
  return public._dg_json(v_acc);
end $$;

-- Clear: each paying member with damage gets 120 + 380 × share (the first 5 clears of a VN day), XP, maybe a pelt.
create or replace function public._dg_payout(p_run bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_total numeric; m record; v_share numeric; v_coins integer; v_done integer;
begin
  select sum(dmg) into v_total from public.dungeon_members where run_id = p_run;
  for m in select account_id, dmg, paid from public.dungeon_members where run_id = p_run order by account_id loop
    v_share := case when coalesce(v_total, 0) > 0 then m.dmg / v_total else 0 end;
    select count(*) into v_done from public.dungeon_members dm join public.dungeon_runs r on r.id = dm.run_id
     where dm.account_id = m.account_id and r.status = 'cleared' and r.id <> p_run
       and (r.ended_at at time zone 'Asia/Ho_Chi_Minh')::date = public._vn_today();
    v_coins := 0;
    if m.paid > 0 and m.dmg > 0 and v_done < 5 then
      v_coins := 120 + floor(380 * v_share)::int;
      perform public._wallet_lock(m.account_id);
      perform public._pay(m.account_id, v_coins, 'dungeon_reward', 'Hầm ngục');
      if random() < 0.25 then
        insert into public.wild_bag (account_id, item, qty) values (m.account_id, 'da_soi', 1)
        on conflict (account_id, item) do update set qty = public.wild_bag.qty + 1;
      end if;
    end if;
    if m.dmg > 0 then
      perform public._game_event(m.account_id, 'xp_grant', 60 + round(140 * v_share)::int, jsonb_build_object('source', 'dungeon'));
      perform public._game_event(m.account_id, 'boss_kill', 1, jsonb_build_object('boss', 'doi_chua', 'dungeon', true, 'dmg', m.dmg));
    end if;
    perform public._game_event(m.account_id, 'dungeon_clear', 1, jsonb_build_object('run', p_run, 'dmg', m.dmg, 'coins', v_coins));
  end loop;
end $$;
revoke all on function public._dg_payout(bigint) from public, anon, authenticated;

-- One strike at monster p_target (1-based; a dead one → the first alive). The avatar stands at the gate.
create or replace function public.dungeon_attack(p_session_token text, p_run bigint, p_target integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; r public.dungeon_runs; m public.dungeon_members; v_gap double precision; v_combo integer;
        v_dmg integer; v_t integer; v_hit boolean := false; v_cleared boolean := false; v_mobs integer[];
begin
  v_acc := public._ac_account(p_session_token);
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 60, 120, 'dungeon_attack', null, 'not at gate');
  if v_ac is not null then return v_ac; end if;
  select * into r from public.dungeon_runs where id = p_run for update;
  if not found or r.status <> 'open' then raise exception 'run over' using errcode = '22023'; end if;
  if r.expires_at <= now() then
    update public.dungeon_runs set status = 'failed', ended_at = now() where id = r.id;
    return jsonb_build_object('expired', true) || public._dg_json(v_acc);
  end if;
  select * into m from public.dungeon_members where run_id = r.id and account_id = v_acc for update;
  if not found then raise exception 'not joined' using errcode = '42501'; end if;
  v_gap := coalesce(extract(epoch from now() - m.last_at), 99);
  if v_gap < 0.3 then
    return public._ac_flag(v_acc, 'dungeon_spam', 'dungeon_attack', jsonb_build_object('gap', round(v_gap::numeric, 3)), null, 'cooldown', false);
  end if;
  if v_gap < 0.9 then raise exception 'cooldown' using errcode = '53400'; end if;
  v_mobs := r.mobs;
  v_t := case when p_target between 1 and coalesce(array_length(v_mobs, 1), 0) and v_mobs[p_target] > 0 then p_target
              else (select min(i) from generate_subscripts(v_mobs, 1) i where v_mobs[i] > 0) end;
  v_combo := case when v_gap <= 2.0 then least(m.combo + 1, 5) else 0 end;
  v_dmg := ((40 + floor(random() * 21)::int) * (100 + 15 * v_combo)) / 100;
  v_dmg := greatest(1, least(v_dmg, v_mobs[v_t]));
  v_mobs[v_t] := v_mobs[v_t] - v_dmg;
  update public.dungeon_members set dmg = dmg + v_dmg, hits = hits + 1, combo = v_combo, last_at = now()
   where run_id = r.id and account_id = v_acc;
  if r.room = 4 then
    perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', 'doi_chua', 'dungeon', true, 'combo', v_combo));
  end if;
  if random() < (case when r.room = 4 then 0.25 else 0.15 end) then                   -- a monster bites back
    v_hit := true;
    update public.vitals set hunger = greatest(1, hunger - 3), thirst = greatest(1, thirst - 3) where account_id = v_acc;
  end if;
  if not exists (select 1 from unnest(v_mobs) x where x > 0) then
    if r.room >= 4 then
      update public.dungeon_runs set mobs = v_mobs, status = 'cleared', ended_at = now() where id = r.id;
      perform public._dg_payout(r.id);
      v_cleared := true;
    else
      update public.dungeon_runs set room = r.room + 1, mobs = public._dg_mobs(r.room + 1, r.scale) where id = r.id;
    end if;
  else
    update public.dungeon_runs set mobs = v_mobs where id = r.id;
  end if;
  return jsonb_build_object('dmg', v_dmg, 'target', v_t, 'combo', v_combo, 'bitten', v_hit, 'cleared', v_cleared) || public._dg_json(v_acc);
end $$;
revoke all on function public.dungeon_start(text) from public;
revoke all on function public.dungeon_join(text, bigint) from public;
revoke all on function public.dungeon_attack(text, bigint, integer) from public;
grant execute on function public.dungeon_start(text) to anon, authenticated;
grant execute on function public.dungeon_join(text, bigint) to anon, authenticated;
grant execute on function public.dungeon_attack(text, bigint, integer) to anon, authenticated;

-- ---------- G. The poll ----------
-- Everything the world HUD shows, in one call (the client polls it every few seconds while in game mode).
create or replace function public.world_state(p_session_token text, p_room_id uuid, p_map text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_party bigint;
begin
  v_acc := public._ac_account(p_session_token);
  perform public._auth(p_room_id, p_session_token, 'any');
  perform public._boss_ensure(p_room_id);
  v_party := public._party_of(v_acc);
  if v_party is not null then perform public._dg_expire(v_party); end if;
  if public._wild_cap(p_map) > 0 then perform public._wild_fill(p_map); end if;
  return jsonb_build_object(
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint,
    'night', public._world_night(),
    'snow_until_ms', (select (extract(epoch from s.until) * 1000)::bigint from public.world_snow s
                       where s.room_id = p_room_id and s.until > now()),
    'wild', case when public._wild_cap(p_map) > 0 then public._wild_json(v_acc, p_map) end,
    'bosses', public._boss_json(v_acc, p_room_id),
    'dungeon', public._dg_json(v_acc))
    || public._party_json(v_acc);
end $$;
revoke all on function public.world_state(text, uuid, text) from public;
grant execute on function public.world_state(text, uuid, text) to anon, authenticated;
