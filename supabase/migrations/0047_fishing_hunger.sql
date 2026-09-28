-- =========================================================
-- 0047_fishing_hunger.sql — no more cast caps; fishing costs hunger and thirst instead (owner rule 2026-09-28).
-- Run after 0046.
--   * start_cast (0046) and start_net (0034) re-created verbatim but for the lines marked 0047:
--       - the hourly cap (40 per window, 'cast limit') and the daily cap (300 per VN day, 'daily cast limit') are gone,
--         with the cast_daily_cap anti-cheat flag; the window/day counters are no longer bumped (the columns stay, so
--         _fishing_state's casts_left stays full and an older client never blocks itself);
--       - after every other check passes, the cast costs hunger 1.8 / thirst 2.2 and a net throw hunger 3 / thirst 3.5
--         (clamped at 0). With the time drain (4.2 hunger/h, 6.25 thirst/h) ~40 casts an hour empty a full hunger bar in
--         ~1.3 h and a full thirst bar in ~1.05 h. At 0 the existing _vitals_guard refuses ('too hungry' /
--         'too thirsty'), and _vitals_apply's starvation clock (→ the faint ladder) runs as before;
--       - both answers carry 'vitals' (_vitals_json) so the HUD updates at once.
-- =========================================================

-- The cost of one fishing action: after _vitals_guard (which applied the time drain and holds the row). Returns the
-- vitals JSON.
create or replace function public._fishing_effort(p_account uuid, p_hunger numeric, p_thirst numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.vitals;
begin
  update public.vitals
     set hunger = greatest(0, hunger - p_hunger), thirst = greatest(0, thirst - p_thirst)
   where account_id = p_account and fainted_until is null
  returning * into v;
  if not found then
    select * into v from public.vitals where account_id = p_account;
  end if;
  return public._vitals_json(v);
end; $$;
revoke all on function public._fishing_effort(uuid, numeric, numeric) from public, anon, authenticated;

-- ---------- start_cast (0046's, verbatim but for the lines marked 0047) ----------
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
                            spot, bites, big, rod,                                         -- v18.1
                            reel_seed, reel_params)                                        -- 0046
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          v_spot, v_bites, sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,   -- v18.1
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),                        -- 0046
                                     'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
  returning id into v_id;
  -- 6. 0047: the effort — hunger 1.8, thirst 2.2 (no cap counters, no cast_daily_cap flag)
  v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'reel_seed', v_seed,                                                                  -- 0046
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.start_cast(uuid, text, integer, integer) to anon, authenticated;

-- ---------- start_net (0034's, verbatim but for the lines marked 0047) ----------
create or replace function public.start_net(p_room_id uuid, p_session_token text, p_col integer, p_row integer,
                                            p_net text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_d integer; v_seed integer;
        v_id uuid; v_beat integer; v_bucket integer;
        v_vitals jsonb;                                                                  -- 0047
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_net and kind = 'net') then
    raise exception 'no net' using errcode = '22023';
  end if;
  select durability into v_d from public.inventory where account_id = v_account and item_id = p_net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  -- 0047: no hourly or daily cast cap
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then raise exception 'hands full' using errcode = '22023'; end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  delete from public.casts where account_id = v_account;
  delete from public.net_throws where account_id = v_account;
  if v_d <= 1 then
    delete from public.inventory where account_id = v_account and item_id = p_net;
  else
    update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = p_net;
  end if;
  v_seed := floor(random() * 2147483647)::int;
  v_beat := public._net_beat_ms(v_seed);
  insert into public.net_throws (account_id, room_id, net, seed, beat_ms)
  values (v_account, p_room_id, p_net, v_seed, v_beat) returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 3, 3.5);                                 -- 0047: a throw's effort
  return jsonb_build_object('throw_id', v_id, 'seed', v_seed, 'beat_ms', v_beat,
    'radius_px', (select radius_px from public.shop_items where id = p_net),
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;
revoke all on function public.start_net(uuid, text, integer, integer, text) from public;
grant execute on function public.start_net(uuid, text, integer, integer, text) to anon, authenticated;
