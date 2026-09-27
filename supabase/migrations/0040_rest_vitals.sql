-- =========================================================
-- 0040_rest_vitals.sql — v19.1 "Ngủ ngon" (docs/superpowers/plans/2026-09-27-v19-1-motel.md).
-- Run after 0039 (_rest_factor). vitals_tick is 0038's body verbatim; only the lines marked "v19.1" are added or
-- changed: while the buff runs, the hunger and the thirst drain are ×0.7 (−30 %). tests/unit/motel.test.ts pins that the
-- rest of the body equals 0038's.
-- =========================================================

-- vitals_tick: 0038's body. v19.1: × _rest_factor on both drains.
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
