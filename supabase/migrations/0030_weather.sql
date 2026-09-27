-- =========================================================
-- 0030_weather.sql — v18.8 Thời tiết thật (docs/superpowers/plans/2026-09-27-v18-8-weather.md): each room's weather,
-- reported by the room owner's browser (Open-Meteo), and its gameplay effects, applied here on the server.
-- ADDITIVE (no data drop) and re-runnable. Run after 0029. Every re-created function is copied from its newest body with
-- only the lines marked "v18.8" added or changed. lib/game/weather/model.ts mirrors _weather_kind and _weather_effects
-- (tests/unit/weather-sql.test.ts pins them equal).
--   A. room_weather (one row per room) + the weather columns on crops and drying_slots.
--   B. _weather_kind, _weather_effects, _room_weather, _room_effects.
--   C. RPCs set_room_weather (owner only, 10 min rate limit) and room_weather_state (any member).
--   D. The field's weather clock _weather_sweep, run by _field_open (re-created from 0019): crop growth and drying run at
--      the weather's speed (the crop's anchor times shift), a storm re-wets drying rice once, thunder/storm take a share of
--      the yield once per spell, and each pest slot is stamped with the weather's pest multiplier when it comes due.
--   E. The yield and pest functions (re-created from 0019 / 0013 / 0016) read those stamps.
--   F. Fishing: _roll_rarity gains a weather overload; start_cast (re-created from 0025) refuses in a storm, scales the
--      bite wait and the big/rare weights.
--   G. Vitals: _vitals_apply gains a thirst-rate overload; vitals_tick gains a room overload (the client passes the room).
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.room_weather (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  code integer not null,
  kind text not null check (kind in ('clear', 'cloudy', 'fog', 'rain', 'thunder', 'storm')),
  is_day boolean not null,
  sunrise timestamptz,
  sunset timestamptz,
  rain_mm numeric not null default 0,
  wind_kmh numeric not null default 0,
  updated_at timestamptz not null default now(),
  storm_since timestamptz,          -- start of the current thunder/storm spell (null: no spell)
  storm_last_at timestamptz,        -- the last report inside the spell (a gap of more than 1 h ends it)
  accrued_at timestamptz            -- the field's weather clock: effects are applied up to this time
);
alter table public.room_weather enable row level security;
revoke all on public.room_weather from anon, authenticated;

alter table public.crops add column if not exists weather_loss double precision not null default 0;   -- share lost to storms
alter table public.crops add column if not exists weather_hit_at timestamptz;                         -- last storm/thunder hit
alter table public.drying_slots add column if not exists rewet_at timestamptz;                        -- last storm re-wet

-- ---------- B. The model (lib/game/weather/model.ts mirrors it) ----------
-- WMO code + wind → kind; null for a code outside the accepted set. Rain/thunder with wind ≥ 60 km/h is a storm.
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
                   when p_code between 71 and 77 or p_code in (85, 86) then 'cloudy'
                 end as k) x
$$;

-- The gameplay effects of a kind (the plan's table, exactly); at night crops don't grow.
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
      else                jsonb_build_object('bite', 1.1, 'bigRare', 1.0, 'dockOpen', true, 'growth', 1.0, 'drying', 1.0, 'pests', 1.0, 'ripeLossPct', 0, 'thirst', 1.0, 'rideSpeed', 1.0)  -- cloudy
    end as e) x
$$;

-- The room's weather: the stored row, or a synthesized cloudy day (updated_at null = stale) when it is missing or older
-- than 3 h.
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
  return w;
end $$;

-- The room's effects now.
create or replace function public._room_effects(p_room uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$ select public._weather_effects(w.kind, w.is_day) from public._room_weather(p_room) w $$;

revoke all on function public._weather_kind(integer, numeric) from public, anon, authenticated;
revoke all on function public._weather_effects(text, boolean) from public, anon, authenticated;
revoke all on function public._room_weather(uuid) from public, anon, authenticated;
revoke all on function public._room_effects(uuid) from public, anon, authenticated;

-- ---------- C. RPCs ----------
create or replace function public._weather_json(w public.room_weather) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'kind', w.kind, 'code', w.code, 'is_day', w.is_day,
    'sunrise_ms', (extract(epoch from w.sunrise) * 1000)::bigint,
    'sunset_ms', (extract(epoch from w.sunset) * 1000)::bigint,
    'rain_mm', w.rain_mm, 'wind_kmh', w.wind_kmh,
    'updated_at_ms', (extract(epoch from w.updated_at) * 1000)::bigint,
    'stale', w.updated_at is null)
$$;
revoke all on function public._weather_json(public.room_weather) from public, anon, authenticated;

-- The owner's browser reports the weather (at most once per 10 min). Coordinates never reach the server.
create or replace function public.set_room_weather(p_room_id uuid, p_session_token text, p_code integer, p_is_day boolean,
                                                   p_sunrise timestamptz, p_sunset timestamptz, p_rain_mm numeric,
                                                   p_wind_kmh numeric) returns jsonb
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
     or p_wind_kmh is null or p_wind_kmh not between 0 and 300 then
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
                                   storm_since, storm_last_at, accrued_at)
  values (p_room_id, p_code, v_kind, p_is_day, p_sunrise, p_sunset, p_rain_mm, p_wind_kmh, now(), v_since, v_last, now())
  on conflict (room_id) do update set
    code = excluded.code, kind = excluded.kind, is_day = excluded.is_day, sunrise = excluded.sunrise,
    sunset = excluded.sunset, rain_mm = excluded.rain_mm, wind_kmh = excluded.wind_kmh, updated_at = excluded.updated_at,
    storm_since = excluded.storm_since, storm_last_at = excluded.storm_last_at,
    accrued_at = greatest(coalesce(public.room_weather.accrued_at, excluded.accrued_at), excluded.accrued_at);
  return public._weather_json(public._room_weather(p_room_id));
end $$;

create or replace function public.room_weather_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  return public._weather_json(public._room_weather(p_room_id));
end $$;

revoke all on function public.set_room_weather(uuid, text, integer, boolean, timestamptz, timestamptz, numeric, numeric) from public;
revoke all on function public.room_weather_state(uuid, text) from public;
grant execute on function public.set_room_weather(uuid, text, integer, boolean, timestamptz, timestamptz, numeric, numeric)
  to anon, authenticated;
grant execute on function public.room_weather_state(uuid, text) to anon, authenticated;

-- ---------- D. The field's weather clock ----------
-- Runs in _field_open before _field_sweep (so ripening and drying completion see the shifted times), under the room's
-- plot locks. Nothing happens in a room without a weather row.
--  1. Growth and drying over (accrued_at, min(p_now, updated_at + 3 h)] at the stored weather's speed: a growing crop's
--     anchor times (soak, sow, transplant, plant) move by (1 − growth)·Δt, so its age advances at `growth`; a drying
--     batch's ready_at moves by (1 − drying)·Δt. Past the 3 h staleness the speeds are 1 (cloudy, day).
--  2. Pest stamps (after the shift): a slot that has come due gets w = the reported weather's pest multiplier if it came
--     due since the last run and before the report went stale, else 1; _crop_pests / _up_pests multiply its chance by w.
--  3. A live storm re-wets each drying batch once per spell: ready_at moves back by half its progress (of 3 h).
--  4. A live thunder (ripe plots) or storm (growing and ripe plots) takes ripeLossPct of the yield once per spell.
create or replace function public._weather_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.room_weather; fx jsonb; wfx jsonb; v_live boolean; v_from timestamptz; v_to timestamptz;
        v_secs double precision; v_grow double precision; v_dry double precision; v_loss double precision;
        v_pests double precision; v_shift interval; c public.crops; r jsonb; v_rolls jsonb; v_due timestamptz;
        v_s double precision; pe jsonb; u public.upland_crops; v_changed boolean;
begin
  select * into w from public.room_weather where room_id = p_room for update;
  if not found then return; end if;
  v_live := p_now < w.updated_at + interval '3 hours';
  wfx := public._weather_effects(w.kind, w.is_day);
  fx := case when v_live then wfx else public._weather_effects('cloudy', true) end;
  v_from := coalesce(w.accrued_at, p_now);
  v_to := least(p_now, w.updated_at + interval '3 hours');
  -- 1. growth and drying at the stored weather's speed
  if v_to > v_from then
    v_secs := extract(epoch from (v_to - v_from))::double precision;
    v_grow := (wfx->>'growth')::double precision;
    v_dry := (wfx->>'drying')::double precision;
    if v_grow <> 1 then
      v_shift := make_interval(secs => floor((1 - v_grow) * v_secs));
      update public.crops cr
         set soak_at = cr.soak_at + v_shift, sow_at = cr.sow_at + v_shift,
             transplant_at = cr.transplant_at + v_shift, plant_at = cr.plant_at + v_shift
       where cr.room_id = p_room and cr.harvester_until is null and cr.harvested_parts = 0
         and ((cr.kind = 'rice' and cr.sow_at is not null
               and public._crop_phase(cr, public._variety(cr.variety), v_from) not in ('ripe', 'overripe'))
              or (cr.kind = 'upland' and cr.upland is not null and coalesce(cr.sow_at, cr.plant_at) is not null
                  and public._up_phase(cr, public._upland(cr.upland), v_from) not in ('prepared', 'waiting', 'ripe', 'overripe', 'done')));
    end if;
    if v_dry <> 1 then
      update public.drying_slots ds
         set ready_at = ds.ready_at + make_interval(secs => floor((1 - v_dry)
                                      * extract(epoch from (least(v_to, ds.ready_at) - v_from))::double precision))
       where ds.room_id = p_room and ds.ready_at > v_from;
    end if;
  end if;
  -- 2. pest stamps, on the shifted timeline: a slot due since the last run takes the reported weather's multiplier if it
  --    came due before that report went stale (updated_at + 3 h), else 1 (cloudy)
  v_pests := (wfx->>'pests')::double precision;
  for c in select cr.* from public.crops cr
            where cr.room_id = p_room and cr.pest_rolls is not null
              and jsonb_path_exists(cr.pest_rolls, '$[*] ? (!exists(@.w))') loop
    v_rolls := '[]'::jsonb;
    v_changed := false;
    u := case when c.kind = 'upland' then public._upland(c.upland) end;
    for r in select x from jsonb_array_elements(c.pest_rolls) with ordinality q(x, n) order by n loop
      v_due := null;
      if not (r ? 'w') then
        if c.kind = 'rice' and c.transplant_at is not null then
          v_s := (public._variety(c.variety)).scale;
          v_due := case (r->>'slot')::int
                     when 1 then public._plus_h(c.transplant_at, (r->>'u_time')::double precision * 8 * v_s)
                     when 2 then public._plus_h(c.transplant_at, 6 * v_s + (r->>'u_time')::double precision * 20 * v_s)
                     else public._plus_h(c.transplant_at, 20 * v_s + (r->>'u_time')::double precision * 18 * v_s) end;
        elsif c.kind = 'upland' and c.plant_at is not null and u.id is not null then
          select x into pe from jsonb_array_elements(u.pests) x where (x->>'slot')::int = (r->>'slot')::int;
          if pe is not null then
            v_due := public._plus_h(c.plant_at, (pe->>'from_h')::double precision + (r->>'u_time')::double precision
                                                 * ((pe->>'to_h')::double precision - (pe->>'from_h')::double precision));
          end if;
        end if;
        if v_due is not null and v_due <= p_now then
          r := r || jsonb_build_object('w', case when v_due > v_from and v_due < w.updated_at + interval '3 hours'
                                                 then v_pests else 1 end);
          v_changed := true;
        end if;
      end if;
      v_rolls := v_rolls || jsonb_build_array(r);
    end loop;
    if v_changed then
      update public.crops set pest_rolls = v_rolls where room_id = p_room and plot_no = c.plot_no;
    end if;
  end loop;
  update public.room_weather set accrued_at = greatest(coalesce(accrued_at, p_now), p_now) where room_id = p_room;
  -- 3. storm re-wet, once per spell
  if v_live and w.kind = 'storm' and w.storm_since is not null then
    update public.drying_slots ds
       set ready_at = ds.ready_at + make_interval(secs => floor(0.5 * greatest(0::double precision,
                                    10800 - extract(epoch from (ds.ready_at - p_now))::double precision))),
           rewet_at = p_now
     where ds.room_id = p_room and ds.ready_at > p_now and (ds.rewet_at is null or ds.rewet_at < w.storm_since);
  end if;
  -- 4. thunder / storm loss, once per spell
  v_loss := (fx->>'ripeLossPct')::double precision / 100;
  if v_live and v_loss > 0 and w.storm_since is not null then
    update public.crops cr
       set weather_loss = 1 - (1 - cr.weather_loss) * (1 - v_loss), weather_hit_at = p_now
     where cr.room_id = p_room and (cr.weather_hit_at is null or cr.weather_hit_at < w.storm_since)
       and case when cr.kind = 'rice'
                then cr.transplant_at is not null
                     and (w.kind = 'storm' or public._crop_phase(cr, public._variety(cr.variety), p_now) in ('ripe', 'overripe'))
                else cr.upland is not null and cr.plant_at is not null
                     and (case when w.kind = 'storm'
                               then public._up_phase(cr, public._upland(cr.upland), p_now) <> 'done'
                               else public._up_phase(cr, public._upland(cr.upland), p_now) in ('ripe', 'overripe') end)
           end;
  end if;
end $$;
revoke all on function public._weather_sweep(uuid, timestamptz) from public, anon, authenticated;

-- Every field call starts here (0019's body): create the plots if needed, lock them, sweep, the rats' sweep; v18.8: the
-- weather clock between the two sweeps.
create or replace function public._field_open(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_init(p_room);
  perform 1 from public.field_plots where room_id = p_room order by plot_no for update;
  perform public._weather_sweep(p_room, p_now);                                     -- v18.8 (before the sweep reads the times)
  perform public._field_sweep(p_room, p_now);
  perform public._rat_sweep(p_room, p_now);                                         -- v17
end; $$;
revoke all on function public._field_open(uuid, timestamptz) from public, anon, authenticated;

-- ---------- E. Yield and pests ----------
-- The harvest in kg (0019's body); v18.8: × (1 − weather_loss) last.
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
  v_x := v_x * (1 - coalesce(c.weather_loss, 0));                                    -- v18.8: storm / thunder loss
  v_kg := greatest((v.base_kg + 9) / 10, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mseed', v_mseed, 'mwater', v_mwater, 'mpest', v_mpest,
                            'mlate', v_mlate, 'mrat', v_mrat);                                -- v17: mrat
end; $$;

-- Picking k at p_now in kg (0019's body); v18.8: × (1 − weather_loss) last.
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
  v_x := v_x * (1 - coalesce(c.weather_loss, 0));                                    -- v18.8: storm / thunder loss
  v_kg := greatest((u.base_kg * v_pct + 999) / 1000, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mplant', v_mplant, 'mwater', v_mwater, 'mrot', v_mrot,
                            'mpest', v_mpest, 'mlate', v_mlate, 'mrat', v_mrat);          -- v17: mrat
end; $$;

-- The pests revealed by p_now (0013's body); v18.8: a slot's chance × its weather stamp w.
create or replace function public._crop_pests(c public.crops, v public.rice_varieties, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; r jsonb; v_slot integer; u double precision; due timestamptz; p double precision;
        lvl integer; v_kind text; v_remedy text; tr timestamptz; v_out jsonb := '[]'::jsonb;
begin
  if c.transplant_at is null or c.pest_rolls is null then return v_out; end if;
  for r in select x from jsonb_array_elements(c.pest_rolls) x order by (x->>'slot')::int loop
    v_slot := (r->>'slot')::int;
    u := (r->>'u_time')::double precision;
    if v_slot = 1 then
      due := public._plus_h(c.transplant_at, u * 8 * s);
    elsif v_slot = 2 then
      due := public._plus_h(c.transplant_at, 6 * s + u * 20 * s);
    else
      due := public._plus_h(c.transplant_at, 20 * s + u * 18 * s);
    end if;
    if due > p_now then continue; end if;
    if v_slot = 1 then
      lvl := public._water_at(c.water_log, due);
      p := least(0.7::double precision,
                 0.35::double precision * (case when lvl = 3 then 2 when lvl <= 1 then 0 else 1 end));
      v_kind := 'snail';
    else
      p := case when v_slot = 2 then 0.45::double precision else 0.40::double precision end;
      if public._excess_n(c, v, due) then p := p * 1.5::double precision; end if;
      p := least(0.9::double precision, p);
      if (r->>'u_kind')::double precision < 0.4 * v.blast_mult then
        v_kind := case when v_slot = 2 then 'leaf_blast' else 'neck_blast' end;
      else
        v_kind := case when v_slot = 2 then 'leaf_folder' else 'hopper' end;
      end if;
    end if;
    p := least(0.9::double precision, p * coalesce((r->>'w')::double precision, 1));   -- v18.8: weather stamp
    if (r->>'u_hit')::double precision >= p then continue; end if;
    if v_kind = 'snail' then
      select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.picks) x
       where (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    else
      v_remedy := case v_kind when 'leaf_folder' then 'spray_insect' when 'hopper' then 'spray_hopper' else 'spray_fungus' end;
      select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.spray_log) x
       where x->>'item' = v_remedy and (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', v_slot, 'kind', v_kind, 'since', due, 'treated_at', tr));
  end loop;
  return v_out;
end; $$;

-- The hoa-màu pests revealed by p_now (0016's body); v18.8: a slot's chance × its weather stamp w, before the 0.9 cap.
create or replace function public._up_pests(c public.crops, u public.upland_crops, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare r jsonb; pe jsonb; due timestamptz; p double precision; lvl integer; tr timestamptz; v_out jsonb := '[]'::jsonb;
begin
  if c.plant_at is null or c.pest_rolls is null then return v_out; end if;
  for r in select x from jsonb_array_elements(c.pest_rolls) x order by (x->>'slot')::int loop
    select x into pe from jsonb_array_elements(u.pests) x where (x->>'slot')::int = (r->>'slot')::int;
    if pe is null then continue; end if;
    due := public._plus_h(c.plant_at, (pe->>'from_h')::double precision
                          + (r->>'u_time')::double precision
                            * ((pe->>'to_h')::double precision - (pe->>'from_h')::double precision));
    if due > p_now then continue; end if;
    p := (pe->>'chance')::double precision;
    if public._up_excess_n(c, u, due) then p := p * 1.5::double precision; end if;
    lvl := public._water_at(c.water_log, due);
    if lvl = 0 then p := p * (pe->>'dry_mult')::double precision; end if;
    if lvl >= 2 then p := p * (pe->>'wet_mult')::double precision; end if;
    p := p * coalesce((r->>'w')::double precision, 1);                                 -- v18.8: weather stamp
    p := least(0.9::double precision, p);
    if (r->>'u_hit')::double precision >= p then continue; end if;
    select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.spray_log) x
     where x->>'item' = pe->>'remedy' and (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', (r->>'slot')::int, 'kind', pe->>'kind', 'since', due,
                                                           'treated_at', tr));
  end loop;
  return v_out;
end; $$;

revoke all on function public._crop_yield(public.crops, public.rice_varieties, double precision, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._up_yield(public.crops, public.upland_crops, double precision, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public._crop_pests(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._up_pests(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;

-- ---------- F. Fishing ----------
-- Rarity 1–5 (0012's _roll_rarity body) with the weather: v18.8 multiplies the rarity ≥ 3 weights by p_big, and at night
-- the rarity ≥ 4 weights by 1.5 (the catalog has no nocturnal flag). The 2-argument version stays as it was.
create or replace function public._roll_rarity(p_rod text, p_bait text, p_big double precision, p_night boolean)
returns smallint
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare r public.shop_items; b public.shop_items; w3 double precision; w4 double precision; w5 double precision; v_roll double precision;
begin
  select * into r from public.shop_items where id = p_rod;
  select * into b from public.shop_items where id = p_bait;
  w5 := 0.3 * coalesce(b.mult_legend, 1) * coalesce(r.rare_mult, 1);
  w4 := 2.7 * coalesce(b.mult_quy, 1) * coalesce(r.rare_mult, 1);
  w3 := 9 * coalesce(b.mult_hiem, 1) * coalesce(r.rare_mult, 1);
  w5 := w5 * coalesce(p_big, 1); w4 := w4 * coalesce(p_big, 1); w3 := w3 * coalesce(p_big, 1);   -- v18.8: big/rare
  if p_night then w5 := w5 * 1.5; w4 := w4 * 1.5; end if;                                           -- v18.8: nocturnal
  v_roll := random() * 100;
  if v_roll < w5 then return 5; end if;
  if v_roll < w5 + w4 then return 4; end if;
  if v_roll < w5 + w4 + w3 then return 3; end if;
  if v_roll < w5 + w4 + w3 + 28 then return 2; end if;
  return 1;
end; $$;
revoke all on function public._roll_rarity(text, text, double precision, boolean) from public, anon, authenticated;

-- start_cast (0025's body); v18.8: the room's effects — a storm closes the dock ('storm'), the bite wait is divided by
-- bite, the rarity roll takes bigRare and the night.
create or replace function public.start_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
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
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90))
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
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.start_cast(uuid, text) to anon, authenticated;

-- ---------- G. Vitals ----------
-- _vitals_apply (0025's body) with a thirst-rate multiplier; v18.8 changes only the tr line. The 1-argument version
-- (rate 1) stays as it was and is what the guard and the restores use.
create or replace function public._vitals_apply(p_account uuid, p_thirst numeric) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400;
  tr constant numeric := 100.0 / 57600 * greatest(coalesce(p_thirst, 1), 0.1);         -- v18.8: × thirst
  dt numeric; zh numeric; zt numeric; nh numeric; nt numeric;
begin
  insert into public.vitals(account_id) values (p_account) on conflict do nothing;
  select * into v from public.vitals where account_id = p_account for update;
  if v.fainted_until is not null then
    if v.fainted_until <= now() then
      v.fainted_until := null; v.hunger := 30; v.thirst := 30; v.starve_s := 0;
    end if;
  else
    dt := least(120, greatest(0, extract(epoch from now() - v.last_tick)));
    if dt > 0 then
      nh := greatest(0, v.hunger - dt * hr);
      nt := greatest(0, v.thirst - dt * tr);
      zh := case when v.hunger <= 0 then dt else greatest(0, dt - v.hunger / hr) end;
      zt := case when v.thirst <= 0 then dt else greatest(0, dt - v.thirst / tr) end;
      v.starve_s := case when nh > 0 and nt > 0 then 0 else v.starve_s + greatest(zh, zt) end;
      v.hunger := nh; v.thirst := nt;
      if v.starve_s >= 600 then
        v.fainted_until := now() + interval '10 seconds'; v.starve_s := 0;
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account;
  return v;
end; $$;
revoke all on function public._vitals_apply(uuid, numeric) from public, anon, authenticated;

-- vitals_tick with the room the player is in (the client passes it): thirst drains at that room's rate. A room the
-- account is not a member of, or null, drains at rate 1.
-- Accepted (review): the client picks the room among its memberships (no server-side presence); factors differ by <= 0.5x.
create or replace function public.vitals_tick(p_session_token text, p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  return public._vitals_json(public._vitals_apply(v_account,
    case when p_room_id is not null
              and exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = v_account)
         then (public._room_effects(p_room_id)->>'thirst')::numeric else 1 end));
end; $$;
-- The legacy 1-argument tick would skip the weather factor: dropped (clients pass the room).
drop function if exists public.vitals_tick(text);
revoke all on function public.vitals_tick(text, uuid) from public;
grant execute on function public.vitals_tick(text, uuid) to anon, authenticated;
