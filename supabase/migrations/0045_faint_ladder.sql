-- =========================================================
-- 0045_faint_ladder.sql — the faint ladder (owner rule, docs/superpowers/specs/2026-09-27-v18-design.md addendum).
-- Run after 0044. Per Vietnam calendar day (_vn_today(), the same day as the v19.1 one-sleep rule) the Nth faint lasts
-- 10 s, 5 min, 15 min, 1 h; the 5th lasts until the next VN midnight and locks game mode ("exhausted") until then.
-- Every place that sets vitals.fainted_until now goes through _faint(account):
--   * _vitals_apply (all three overloads: 0025 1-arg, 0030 2-arg, 0036 3-arg) — the v18.3 starvation faint
--   * _heat_resolve (0033) — the v18.10 drowning
--   * vitals_tick (0040) — the v18.9 cold faint and lightning
-- Each is re-created from its newest migration verbatim; only lines marked "faint ladder" change.
-- The revive (30 hunger / 30 thirst when fainted_until passes) is unchanged.
-- _vitals_guard (0025) gains the _not_exhausted check, so every RPC that already calls it refuses with 'exhausted'.
-- =========================================================

alter table public.vitals add column if not exists faint_day date;
alter table public.vitals add column if not exists faint_count integer not null default 0;

-- Today's faints so far (0 when the last one was on an earlier VN day).
create or replace function public._faint_today(v public.vitals) returns integer
language sql stable set search_path = public, extensions
as $$ select case when v.faint_day = public._vn_today() then coalesce(v.faint_count, 0) else 0 end $$;

-- The next VN midnight.
create or replace function public._vn_midnight() returns timestamptz
language sql stable set search_path = public, extensions
as $$ select (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' $$;

-- How long the Nth faint of the day lasts (n >= 5: until the next VN midnight).
create or replace function public._faint_len(p_n integer) returns interval
language sql stable set search_path = public, extensions
as $$
  select case when p_n <= 1 then interval '10 seconds'
              when p_n = 2 then interval '5 minutes'
              when p_n = 3 then interval '15 minutes'
              when p_n = 4 then interval '1 hour'
              else greatest(interval '10 seconds', public._vn_midnight() - now()) end
$$;

-- Counts one more faint today and returns how long it lasts. The caller sets fainted_until = now() + the result.
create or replace function public._faint(p_account uuid) returns interval
language plpgsql security definer set search_path = public, extensions
as $$
declare v_today date := public._vn_today(); v_n integer;
begin
  insert into public.vitals(account_id) values (p_account) on conflict do nothing;
  update public.vitals
     set faint_count = case when faint_day = v_today then faint_count + 1 else 1 end, faint_day = v_today
   where account_id = p_account returning faint_count into v_n;
  return public._faint_len(v_n);
end; $$;

-- True while the player has fainted 5 times today.
create or replace function public._exhausted(p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select public._faint_today(v) >= 5 from public.vitals v where v.account_id = p_account), false) $$;

create or replace function public._not_exhausted(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if public._exhausted(p_account) then raise exception 'exhausted' using errcode = '53400'; end if;
end; $$;

-- _vitals_json (0025) + the ladder's fields.
create or replace function public._vitals_json(v public.vitals) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'hunger', round(v.hunger, 3), 'thirst', round(v.thirst, 3),
    'fainted_until_ms', case when v.fainted_until is null then null
                             else (extract(epoch from v.fainted_until) * 1000)::bigint end,
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint,
    'faint_count', public._faint_today(v),                                                              -- faint ladder
    'next_faint_s', case when public._faint_today(v) >= 4 then null                                      -- faint ladder
                         else extract(epoch from public._faint_len(public._faint_today(v) + 1))::int end,
    'locked_until_ms', case when public._faint_today(v) >= 5                                             -- faint ladder
                            then (extract(epoch from public._vn_midnight()) * 1000)::bigint end);
$$;

-- _vitals_guard (0025) + the lockout.
create or replace function public._vitals_guard(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.vitals;
begin
  v := public._vitals_apply(p_account);
  perform public._not_exhausted(p_account);                                                            -- faint ladder
  if v.fainted_until is not null then raise exception 'fainted' using errcode = '53400'; end if;
  if v.hunger <= 0 then raise exception 'too hungry' using errcode = '53400'; end if;
  if v.thirst <= 0 then raise exception 'too thirsty' using errcode = '53400'; end if;
end; $$;

-- _vitals_apply, 1 argument (0025).
create or replace function public._vitals_apply(p_account uuid) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400;
  tr constant numeric := 100.0 / 57600;
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
        v.fainted_until := now() + public._faint(p_account); v.starve_s := 0;                        -- faint ladder
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account
    returning * into v;                                                                                 -- faint ladder
  return v;
end; $$;

-- _vitals_apply, 2 arguments (0030).
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
        v.fainted_until := now() + public._faint(p_account); v.starve_s := 0;                        -- faint ladder
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account
    returning * into v;                                                                                 -- faint ladder
  return v;
end; $$;

-- _vitals_apply, 3 arguments (0036).
create or replace function public._vitals_apply(p_account uuid, p_thirst numeric, p_hunger numeric) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400 * greatest(coalesce(p_hunger, 1), 0.1);          -- v18.12: × hunger
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
        v.fainted_until := now() + public._faint(p_account); v.starve_s := 0;                        -- faint ladder
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account
    returning * into v;                                                                                 -- faint ladder
  return v;
end; $$;

-- _heat_resolve (0033). The drowning counts once, and never shortens a faint already running.
create or replace function public._heat_resolve(p_account uuid) returns public.heat_state
language plpgsql security definer set search_path = public, extensions
as $$
declare h public.heat_state; v public.vitals; v_len interval;                                          -- faint ladder
begin
  h := public._heat_row(p_account);
  if h.cramp_until is not null and h.cramp_until <= now() then
    v := public._vitals_apply(p_account);                                                              -- faint ladder
    if v.fainted_until is null then                                                                    -- faint ladder
      v_len := public._faint(p_account);                                                               -- faint ladder
      update public.vitals set fainted_until = now() + v_len, starve_s = 0 where account_id = p_account;
    end if;                                                                                            -- faint ladder
    update public.heat_state set cramp_until = null, cramp_room = null, swimming = false, swim_room = null,
      outdoor_since = null, shocked = false where account_id = p_account returning * into h;
  end if;
  return h;
end; $$;

-- vitals_tick: 0040's body. Faint ladder: the cold faint / lightning go through _faint; the row is re-read before the
-- JSON so today's count is fresh.
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
        v_rest numeric := public._rest_factor(v_account);                                                -- v19.1
        v_len interval;                                                                                  -- faint ladder
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
    * v_cat                                                                              -- v18.12: the mèo
    * v_rest,                                                                            -- v19.1: Ngủ ngon
    v_cat * case when v_fast then 24 else 1 end                                          -- v18.12: the mèo; v18.9: ×24 wet
    * v_rest);                                                                           -- v19.1: Ngủ ngon
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
    v_len := public._faint(v_account);                                                   -- faint ladder
    update public.vitals set fainted_until = now() + v_len, starve_s = 0                 -- faint ladder
     where account_id = v_account returning * into v_vit;
  end if;
  update public.rain_state set wet_s = rs.wet_s, dry_s = rs.dry_s, cold_until = rs.cold_until,          -- v18.9
    cold_wet_s = rs.cold_wet_s, strike_cd_until = rs.strike_cd_until, struck_at = rs.struck_at,
    broke_at = rs.broke_at, last_seen = now()
   where account_id = v_account;
  return public._vitals_json(v_vit) || jsonb_build_object('heat', public._heat_json(h))
         || jsonb_build_object('rain', public._rain_json(v_account, v_exposed));          -- v18.9
end; $$;

-- card_sit (0021) + the lockout: an exhausted player cannot take a card seat.
create or replace function public.card_sit(p_room_id uuid, p_session_token text, p_game text, p_seat integer, p_stake integer,
                                           p_buyin integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  perform public._not_exhausted(v_account);                                                            -- faint ladder
  if p_game is null or p_game not in ('tienlen', 'cao', 'poker', 'xidach') then
    return public._ac_flag(v_account, 'bad_game', 'card_sit', jsonb_build_object('game', p_game), p_room_id, 'invalid game');
  end if;
  if p_seat is null or p_seat not between 1 and public._card_max(p_game) then
    return public._ac_flag(v_account, 'bad_seat', 'card_sit', jsonb_build_object('game', p_game, 'seat', p_seat), p_room_id,
                           'invalid seat');
  end if;
  if p_stake is null or p_stake not in (100, 1000, 10000) then
    return public._ac_flag(v_account, 'bad_stake', 'card_sit', jsonb_build_object('game', p_game, 'stake', p_stake), p_room_id,
                           'invalid stake');
  end if;
  if (p_game = 'poker' and (p_buyin is null or p_buyin not between 50 * p_stake and 200 * p_stake))
     or (p_game <> 'poker' and p_buyin is not null) then
    return public._ac_flag(v_account, 'bad_qty', 'card_sit',
                           jsonb_build_object('game', p_game, 'stake', p_stake, 'buyin', p_buyin), p_room_id, 'invalid quantity');
  end if;
  return public._card_sit(p_room_id, v_account, p_game, p_seat, p_stake, p_buyin, now());
end $$;
grant execute on function public.card_sit(uuid, text, text, integer, integer, integer) to anon, authenticated;

revoke all on function public._faint_today(public.vitals) from public, anon, authenticated;
revoke all on function public._vn_midnight() from public, anon, authenticated;
revoke all on function public._faint_len(integer) from public, anon, authenticated;
revoke all on function public._faint(uuid) from public, anon, authenticated;
revoke all on function public._exhausted(uuid) from public, anon, authenticated;
revoke all on function public._not_exhausted(uuid) from public, anon, authenticated;
revoke all on function public._vitals_json(public.vitals) from public, anon, authenticated;
revoke all on function public._vitals_guard(uuid) from public, anon, authenticated;
revoke all on function public._vitals_apply(uuid) from public, anon, authenticated;
revoke all on function public._vitals_apply(uuid, numeric) from public, anon, authenticated;
revoke all on function public._vitals_apply(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public._heat_resolve(uuid) from public, anon, authenticated;
revoke all on function public.vitals_tick(text, uuid, text, integer, integer) from public;
grant execute on function public.vitals_tick(text, uuid, text, integer, integer) to anon, authenticated;
