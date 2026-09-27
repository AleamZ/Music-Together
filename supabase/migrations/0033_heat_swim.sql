-- =========================================================
-- 0033_heat_swim.sql — v18.10 Sốc nhiệt & bơi chủ động (docs/superpowers/plans/2026-09-27-v18-10-heat.md).
-- ADDITIVE (no data drop) and re-runnable. Run after 0031 (0032 is independent of it). Every re-created function is
-- copied from its newest body (set_room_weather and _weather_json from 0030, vitals_tick from 0030) with only the lines
-- marked "v18.10" added or changed.
--   A. room_weather.temp_c, reported by the owner's browser; set_room_weather gains p_temp_c (default null).
--   B. Shade: _in_shade(map, x, y), a literal list of rects per map (lib/game/heat/shade.ts mirrors it;
--      tests/unit/heat.test.ts pins them equal).
--   C. heat_state, one row per account.
--   D. Pure rules: _heat_hot, _cramp_chance (lib/game/heat/model.ts mirrors them).
--   E. _heat_resolve (a cramp past its deadline drowns: the v18.3 faint) and _heat_json.
--   F. vitals_tick(token, room, map, x, y): heat accrual; thirst ×2 while heat-shocked.
--   G. RPCs heat_state, warm_up_start, warm_up_finish, jump_in, leave_water, rescue_swimmer.
-- Positions (the tick's x/y, the cells) are client claims like every position in the game: the server checks them
-- against the map geometry only. A rescuer's nearness to the victim is not checked (the server has no positions).
-- =========================================================

-- ---------- A. The temperature ----------
alter table public.room_weather add column if not exists temp_c numeric;   -- v18.10: °C (null: not reported)

create or replace function public._weather_json(w public.room_weather) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'kind', w.kind, 'code', w.code, 'is_day', w.is_day,
    'sunrise_ms', (extract(epoch from w.sunrise) * 1000)::bigint,
    'sunset_ms', (extract(epoch from w.sunset) * 1000)::bigint,
    'rain_mm', w.rain_mm, 'wind_kmh', w.wind_kmh,
    'temp_c', w.temp_c,                                                                 -- v18.10
    'updated_at_ms', (extract(epoch from w.updated_at) * 1000)::bigint,
    'stale', w.updated_at is null)
$$;
revoke all on function public._weather_json(public.room_weather) from public, anon, authenticated;

-- The owner's browser reports the weather (at most once per 10 min). Coordinates never reach the server.
drop function if exists public.set_room_weather(uuid, text, integer, boolean, timestamptz, timestamptz, numeric, numeric);
create or replace function public.set_room_weather(p_room_id uuid, p_session_token text, p_code integer, p_is_day boolean,
                                                   p_sunrise timestamptz, p_sunset timestamptz, p_rain_mm numeric,
                                                   p_wind_kmh numeric, p_temp_c numeric default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_kind text; w public.room_weather; v_bad boolean; v_since timestamptz; v_last timestamptz;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  if (select r.admin_member_id from public.rooms r where r.id = p_room_id) is distinct from v_member then
    raise exception 'not owner' using errcode = '42501';
  end if;
  v_kind := public._weather_kind(p_code, p_wind_kmh);
  if v_kind is null or p_is_day is null or p_rain_mm is null or p_rain_mm not between 0 and 200
     or p_wind_kmh is null or p_wind_kmh not between 0 and 300
     or (p_temp_c is not null and p_temp_c not between -50 and 60) then                  -- v18.10
    raise exception 'invalid weather' using errcode = '22023';
  end if;
  -- lock order as in _field_open: the room's plots, then the weather row (a placeholder row, stale, if none yet)
  perform 1 from public.field_plots where room_id = p_room_id order by plot_no for update;
  insert into public.room_weather (room_id, code, kind, is_day, updated_at)
  values (p_room_id, 3, 'cloudy', true, '-infinity') on conflict (room_id) do nothing;
  select * into w from public.room_weather where room_id = p_room_id for update;
  if w.updated_at > now() - interval '10 minutes' then
    raise exception 'too soon' using errcode = '53400';
  end if;
  -- bring the field up to now under the old weather first
  if exists (select 1 from public.field_plots fp where fp.room_id = p_room_id) then
    perform public._field_open(p_room_id, now());
  end if;
  select * into w from public.room_weather where room_id = p_room_id for update;
  v_bad := v_kind in ('thunder', 'storm');
  v_since := w.storm_since;
  v_last := w.storm_last_at;
  if v_since is not null and (v_last is null or v_last < now() - interval '1 hour') then
    v_since := null;                                   -- a gap of more than 1 h ends the spell
  end if;
  if v_bad then
    v_since := coalesce(v_since, now());
    v_last := now();
  end if;
  insert into public.room_weather (room_id, code, kind, is_day, sunrise, sunset, rain_mm, wind_kmh, updated_at,
                                   storm_since, storm_last_at, accrued_at, temp_c)                 -- v18.10: temp_c
  values (p_room_id, p_code, v_kind, p_is_day, p_sunrise, p_sunset, p_rain_mm, p_wind_kmh, now(), v_since, v_last, now(),
          p_temp_c)                                                                               -- v18.10
  on conflict (room_id) do update set
    code = excluded.code, kind = excluded.kind, is_day = excluded.is_day, sunrise = excluded.sunrise,
    sunset = excluded.sunset, rain_mm = excluded.rain_mm, wind_kmh = excluded.wind_kmh, updated_at = excluded.updated_at,
    storm_since = excluded.storm_since, storm_last_at = excluded.storm_last_at,
    temp_c = excluded.temp_c,                                                                     -- v18.10
    accrued_at = greatest(coalesce(public.room_weather.accrued_at, excluded.accrued_at), excluded.accrued_at);
  return public._weather_json(public._room_weather(p_room_id));
end $$;
revoke all on function public.set_room_weather(uuid, text, integer, boolean, timestamptz, timestamptz, numeric, numeric, numeric) from public;
grant execute on function public.set_room_weather(uuid, text, integer, boolean, timestamptz, timestamptz, numeric, numeric, numeric)
  to anon, authenticated;

-- ---------- B. Shade ----------
-- The porch of each shop, depot and the restaurant (the building's rect down to 14 px past where one stands to use it).
-- Anywhere else on a map is outdoors; an unknown map (or no position) counts as shade.
create or replace function public._in_shade(p_map text, p_x integer, p_y integer) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select p_map is null or p_x is null or p_y is null or p_map not in ('hall', 'pond', 'field', 'market')
      or exists (select 1 from (values
           ('pond', 522, 64, 104, 90), ('pond', 522, 228, 104, 94),
           ('field', 588, 288, 84, 70), ('field', 700, 288, 88, 70),
           ('market', 100, 130, 80, 60), ('market', 460, 130, 80, 60), ('market', 244, 108, 152, 82),
           ('market', 640, 130, 80, 60), ('market', 40, 304, 80, 70), ('market', 680, 304, 80, 70)
         ) s(m, sx, sy, sw, sh)
         where s.m = p_map and p_x >= s.sx and p_x < s.sx + s.sw and p_y >= s.sy and p_y < s.sy + s.sh)
$$;
revoke all on function public._in_shade(text, integer, integer) from public, anon, authenticated;

-- ---------- C. The heat state ----------
create table if not exists public.heat_state (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  outdoor_since timestamptz,      -- outdoors in the heat since (null: not now)
  shocked boolean not null default false,
  immune_until timestamptz,       -- after leaving the water
  warm_started_at timestamptz,    -- a warm-up in progress
  warm_until timestamptz,         -- warmed up until
  swimming boolean not null default false,
  swim_room uuid,
  cramp_until timestamptz,        -- cramping: drowns at this time unless rescued
  cramp_room uuid,
  last_seen timestamptz           -- the last heartbeat that judged the heat
);
alter table public.heat_state enable row level security;
revoke all on public.heat_state from anon, authenticated;

-- ---------- D. Rules (lib/game/heat/model.ts mirrors them) ----------
-- Hot: clear sky, day, 35 °C or more.
create or replace function public._heat_hot(p_kind text, p_is_day boolean, p_temp_c numeric) returns boolean
language sql immutable set search_path = public, extensions
as $$ select coalesce(p_kind = 'clear' and p_is_day and p_temp_c >= 35, false) $$;

-- The chance of a cramp when jumping in: 10% heat-shocked, 0.5% heat-shocked but warmed up, never otherwise.
create or replace function public._cramp_chance(p_shocked boolean, p_warmed boolean) returns numeric
language sql immutable set search_path = public, extensions
as $$ select case when not coalesce(p_shocked, false) then 0 when coalesce(p_warmed, false) then 0.005 else 0.10 end::numeric $$;
revoke all on function public._heat_hot(text, boolean, numeric) from public, anon, authenticated;
revoke all on function public._cramp_chance(boolean, boolean) from public, anon, authenticated;

-- ---------- E. Resolve and json ----------
create or replace function public._heat_row(p_account uuid) returns public.heat_state
language plpgsql security definer set search_path = public, extensions
as $$
declare h public.heat_state;
begin
  insert into public.heat_state(account_id) values (p_account) on conflict do nothing;
  select * into h from public.heat_state where account_id = p_account for update;
  return h;
end; $$;

-- A cramp past its deadline drowns the swimmer: the v18.3 faint (sent to the hall, revived after 10 s).
create or replace function public._heat_resolve(p_account uuid) returns public.heat_state
language plpgsql security definer set search_path = public, extensions
as $$
declare h public.heat_state;
begin
  h := public._heat_row(p_account);
  if h.cramp_until is not null and h.cramp_until <= now() then
    perform public._vitals_apply(p_account);
    update public.vitals set fainted_until = now() + interval '10 seconds', starve_s = 0 where account_id = p_account;
    update public.heat_state set cramp_until = null, cramp_room = null, swimming = false, swim_room = null,
      outdoor_since = null, shocked = false where account_id = p_account returning * into h;
  end if;
  return h;
end; $$;

create or replace function public._heat_json(h public.heat_state) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'shocked', h.shocked,
    'outdoor_s', case when h.outdoor_since is null then 0 else floor(extract(epoch from now() - h.outdoor_since))::int end,
    'immune_until_ms', case when h.immune_until > now() then (extract(epoch from h.immune_until) * 1000)::bigint end,
    'warm_until_ms', case when h.warm_until > now() then (extract(epoch from h.warm_until) * 1000)::bigint end,
    'swimming', h.swimming,
    'cramp_until_ms', case when h.cramp_until is not null then (extract(epoch from h.cramp_until) * 1000)::bigint end,
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;
revoke all on function public._heat_row(uuid) from public, anon, authenticated;
revoke all on function public._heat_resolve(uuid) from public, anon, authenticated;
revoke all on function public._heat_json(public.heat_state) from public, anon, authenticated;

-- ---------- F. The heartbeat ----------
-- vitals_tick (0030's body) with where the player stands. v18.10: a cramp past its deadline drowns first; then the heat:
-- outdoors (a known spot out of the shade, not swimming, not fainted) in a hot room without immunity, continuously
-- (a heartbeat gap over 120 s restarts the count), for 10 min → heat-shocked; anything else clears it. Thirst drains ×2
-- while heat-shocked. The answer carries `heat`.
drop function if exists public.vitals_tick(text, uuid);
create or replace function public.vitals_tick(p_session_token text, p_room_id uuid, p_map text default null,
                                              p_x integer default null, p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
        v_member boolean; h public.heat_state; w public.room_weather; v_out boolean; v_hot boolean;   -- v18.10
        v_since timestamptz; v_fainted boolean; v_vit public.vitals;                                   -- v18.10
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
  v_vit := public._vitals_apply(v_account,
    (case when v_member then (public._room_effects(p_room_id)->>'thirst')::numeric else 1 end)
    * case when h.shocked then 2 else 1 end);                                            -- v18.10: ×2 heat-shocked
  return public._vitals_json(v_vit) || jsonb_build_object('heat', public._heat_json(h));
end; $$;
revoke all on function public.vitals_tick(text, uuid, text, integer, integer) from public;
grant execute on function public.vitals_tick(text, uuid, text, integer, integer) to anon, authenticated;

-- ---------- G. RPCs ----------
-- A pond cell one may act from: a shore or dock cast cell (_pond_spot of 0031).
create or replace function public._heat_member(p_room_id uuid, p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  if not exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = v_account) then
    raise exception 'not member' using errcode = '42501';
  end if;
  return v_account;
end; $$;
revoke all on function public._heat_member(uuid, text) from public, anon, authenticated;

create or replace function public.heat_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token);
begin
  return public._heat_json(public._heat_resolve(v_account));
end; $$;

create or replace function public.warm_up_start(p_room_id uuid, p_session_token text, p_col integer, p_row integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token); h public.heat_state;
begin
  h := public._heat_resolve(v_account);
  perform public._vitals_guard(v_account);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if h.cramp_until is not null then raise exception 'cramp' using errcode = '53400'; end if;
  -- standing on the bank: a swim the server still remembers (a reload mid-swim) is over, without the immunity
  update public.heat_state set warm_started_at = now(), swimming = false, swim_room = null
   where account_id = v_account returning * into h;
  return public._heat_json(h);
end; $$;

create or replace function public.warm_up_finish(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token); h public.heat_state;
begin
  h := public._heat_resolve(v_account);
  if h.warm_started_at is null or h.warm_started_at > now() - interval '9.5 seconds'
     or h.warm_started_at < now() - interval '60 seconds' or h.swimming then
    update public.heat_state set warm_started_at = null where account_id = v_account;
    raise exception 'warm up' using errcode = '53400';
  end if;
  update public.heat_state set warm_started_at = null, warm_until = now() + interval '5 minutes'
   where account_id = v_account returning * into h;
  return public._heat_json(h);
end; $$;

-- Jump in from a shore or dock cell. Heat-shocked, the jump may cramp (_cramp_chance; warmed up 0.5%, else 10%): the
-- swimmer then has 10 s to be rescued. The water ends the heat shock.
create or replace function public.jump_in(p_room_id uuid, p_session_token text, p_col integer, p_row integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token); h public.heat_state; v_cramp boolean;
begin
  h := public._heat_resolve(v_account);
  perform public._vitals_guard(v_account);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if h.cramp_until is not null then raise exception 'cramp' using errcode = '53400'; end if;
  v_cramp := random() < public._cramp_chance(h.shocked, coalesce(h.warm_until > now(), false));
  update public.heat_state set swimming = true, swim_room = p_room_id, warm_started_at = null,
    outdoor_since = null, shocked = false,
    cramp_until = case when v_cramp then now() + interval '10 seconds' end,
    cramp_room = case when v_cramp then p_room_id end
   where account_id = v_account returning * into h;
  return public._heat_json(h) || jsonb_build_object('cramp', v_cramp);
end; $$;

-- Climb out: 10 min immunity to the heat. Not while cramping.
create or replace function public.leave_water(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token); h public.heat_state;
begin
  h := public._heat_resolve(v_account);
  if h.cramp_until is not null then raise exception 'cramp' using errcode = '53400'; end if;
  if not h.swimming then raise exception 'not swimming' using errcode = '53400'; end if;
  update public.heat_state set swimming = false, swim_room = null, immune_until = now() + interval '10 minutes',
    outdoor_since = null, shocked = false
   where account_id = v_account returning * into h;
  return public._heat_json(h);
end; $$;

-- Another member pulls a cramping swimmer of this room out: the victim is safe on the shore with the immunity. The
-- rescuer's cell must be on the pond (water or a cast cell); how near it is to the victim is the client's claim.
create or replace function public.rescue_swimmer(p_room_id uuid, p_session_token text, p_victim uuid,
                                                 p_col integer, p_row integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token); h public.heat_state;
begin
  if p_victim is null or p_victim = v_account then raise exception 'bad victim' using errcode = '22023'; end if;
  perform public._vitals_guard(v_account);
  if public._pond_spot(p_col, p_row) is null
     and not (p_col between 0 and 79 and p_row between 0 and 49
              and public._pond_in(p_col * 8 + 4, p_row * 8 + 4, 6)) then
    raise exception 'bad spot' using errcode = '22023';
  end if;
  if not exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = p_victim) then
    raise exception 'bad victim' using errcode = '22023';
  end if;
  h := public._heat_resolve(p_victim);
  if h.cramp_until is null or h.cramp_room is distinct from p_room_id then
    raise exception 'not cramping' using errcode = '53400';
  end if;
  update public.heat_state set cramp_until = null, cramp_room = null, swimming = false, swim_room = null,
    immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
   where account_id = p_victim;
  return jsonb_build_object('rescued', p_victim);
end; $$;

revoke all on function public.heat_state(uuid, text) from public;
revoke all on function public.warm_up_start(uuid, text, integer, integer) from public;
revoke all on function public.warm_up_finish(uuid, text) from public;
revoke all on function public.jump_in(uuid, text, integer, integer) from public;
revoke all on function public.leave_water(uuid, text) from public;
revoke all on function public.rescue_swimmer(uuid, text, uuid, integer, integer) from public;
grant execute on function public.heat_state(uuid, text) to anon, authenticated;
grant execute on function public.warm_up_start(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.warm_up_finish(uuid, text) to anon, authenticated;
grant execute on function public.jump_in(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.leave_water(uuid, text) to anon, authenticated;
grant execute on function public.rescue_swimmer(uuid, text, uuid, integer, integer) to anon, authenticated;
