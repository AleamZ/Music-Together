-- =========================================================
-- 0116_song_cai_route.sql — the road out to Sông Cái (lib/game/world/routes.ts). ADDITIVE and re-runnable. Run after 0115.
-- The world's road from Ao cá now runs on south from the hall–pond road's corner below the pond (the signpost
-- "→ Sông Cái (cấp 3)") to Bến đò Sông Cái on the river's north bank, a dock out over the reeds. One boards the ghe
-- THERE: before, the only boarding was Cầu ao's pier, and a player who walked the visible road was refused 'too far'.
--   A. _song_cai_landing(): the landing (world px, the wild: routes.ts SONG_CAI_ROUTE.landing), how near one must stand
--      (LANDING_NEAR) and the dock's foot on Sông Cái (zone-local: SONG_CAI_DOCK_LOCAL), where the row lands you.
--      tests/unit/song-cai-route.test.ts pins them equal to the client's.
--   B. river_row_start: the row out is claimed at the landing ('wild') when the account's server position is within r
--      px of it (world mode); otherwise at the pier as before. The level gate (map_levels song_cai, lv3), the storm and
--      the boat checks are unchanged.
--   C. river_row_finish: a row out from the landing is claimed back there and lands at the dock's foot; from the pier,
--      as before (the jetty). The row home is unchanged (Cầu ao's pier).
-- The walk itself needs no change: the wild is adjacent to every zone (_world_adjacent), so the road (pond → wild →
-- landing) is judged at its straight distance, which the road (straight down) equals.
-- Re-created functions I did not create: river_row_start, river_row_finish (0087's) — verbatim but for the lines marked 0116.
-- =========================================================

-- ---------- A. The landing ----------
create or replace function public._song_cai_landing() returns jsonb
language sql immutable parallel safe
as $$ select '{"x": 1312, "y": 1568, "r": 48, "foot_x": 352, "foot_y": 104}'::jsonb $$;
revoke all on function public._song_cai_landing() from public, anon, authenticated;

-- ---------- B, C. The row ----------
-- river_row_start (0087_v22_fixes.sql's, verbatim but for the lines marked 0116)
create or replace function public.river_row_start(p_room_id uuid, p_session_token text, p_dir text,
                                                  p_x integer default null, p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); g jsonb := public._river_geo(); v_ac jsonb;
        v_seed bigint := floor(random() * 4294967296)::bigint; v_x integer; v_y integer; v_need integer;
        l jsonb := public._song_cai_landing();                                                          -- 0116
begin
  if p_dir is null or p_dir not in ('out', 'home') then raise exception 'bad direction' using errcode = '22023'; end if;
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  if p_dir = 'out' then
    -- 0116 { at Bến đò (the road's end, in the wild) the claim is there; else at Cầu ao's pier as before
    if public._pos_on_zone(v_account, 'wild', (l->>'x')::int, (l->>'y')::int, (l->>'r')::int) then
      v_x := (l->>'x')::int;
      v_y := (l->>'y')::int;
      v_ac := public._pos_claim(v_account, 'wild', v_x, v_y, 'river_row_start', p_room_id, 'too far');
    else
    -- 0116 }
    v_x := (g->>'pier_x')::int;
    v_y := (g->>'pier_y')::int;
    v_ac := public._pos_claim(v_account, 'pond', v_x, v_y, 'river_row_start', p_room_id, 'too far');
    end if;                                                                                              -- 0116
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
    -- 0087: each failed row home lowers the next one's need by 2 (6, 4, 2, 0): nobody is stranded, nobody rides free
    v_need := greatest(0, 6 - 2 * coalesce((select home_fails from public.boats where account_id = v_account), 0));
  end if;
  perform public._vitals_guard(v_account);
  perform public._stamina_spend(v_account, 4, 'fish');
  insert into public.river_rows (account_id, room_id, dir, seed, need, x, y, started_at)
  values (v_account, p_room_id, p_dir, v_seed, v_need, v_x, v_y, now())
  on conflict (account_id) do update set room_id = excluded.room_id, dir = excluded.dir, seed = excluded.seed,
    need = excluded.need, x = excluded.x, y = excluded.y, started_at = excluded.started_at;
  -- 0087 { the beats stay on the server: each one 1.5 s ahead via mg_sync
  perform public._mg_open(v_account, 'row', p_dir, public._mg_roll('row'), 0);
  return jsonb_build_object('row', jsonb_build_object('dir', p_dir, 'need', v_need, 'live', 'row', 'started_at', now()));
  -- 0087 }
end $$;

-- river_row_finish (0087_v22_fixes.sql's, verbatim but for the lines marked 0116)
create or replace function public.river_row_finish(p_room_id uuid, p_session_token text, p_strokes integer[],
                                                   p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); w public.river_rows; g jsonb := public._river_geo();
        v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_n integer := coalesce(cardinality(p_strokes), 0);
        v_map text; v_to jsonb; v_exact boolean;
        l public.mg_live;                                                                                  -- 0087
        v_ld jsonb := public._song_cai_landing(); v_landed boolean;                                        -- 0116
begin
  perform 1 from public.player_pos where account_id = v_account for update;
  delete from public.river_rows where account_id = v_account and room_id = p_room_id returning * into w;
  if not found then raise exception 'row not found' using errcode = '22023'; end if;
  l := public._mg_close(v_account, 'row', w.dir, p_strokes, null);                                         -- 0087
  v_landed := w.dir = 'out' and w.x = (v_ld->>'x')::int and w.y = (v_ld->>'y')::int;                    -- 0116
  v_map := case when v_landed then 'wild' when w.dir = 'out' then 'pond' else 'song_cai' end;           -- 0116
  v_ac := public._pos_claim(v_account, v_map, w.x, w.y, 'river_row_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  if now() > w.started_at + interval '60 seconds' then
    return jsonb_build_object('result', 'drift', 'why', 'expired');
  end if;
  if l.account_id is null then return jsonb_build_object('result', 'drift', 'why', 'outdated'); end if;   -- 0087
  v_ev := jsonb_build_object('dir', w.dir, 'ticks', p_ticks, 'n', v_n, 'strokes', to_jsonb(p_strokes[1:40]));
  v_bad := coalesce(public._row_input_error(p_strokes, p_ticks), l.meta->>'err');                         -- 0087
  if v_bad is not null then
    v_code := 'row_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._row_replay_p(l.params::integer[], w.need, p_strokes);                                  -- 0087
    if (v_rep->>'ticks')::int <> p_ticks then
      v_code := 'row_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    elsif now() < w.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'row_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', w.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    -- 0087 { not played live: void (soft), the boat drifts
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'row_late', 'river_row_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              p_room_id, null, false);
      return jsonb_build_object('result', 'drift', 'why', 'late');
    -- 0087 }
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
  -- 0087 { a missed row drifts, out or home; the way home needs 2 fewer beats after each miss, none after the third
  if v_rep->>'outcome' <> 'pass' and not (w.dir = 'home' and w.need = 0) then
    if w.dir = 'home' then update public.boats set home_fails = home_fails + 1 where account_id = v_account; end if;
    return jsonb_build_object('result', 'drift', 'why', 'missed', 'hits', (v_rep->>'hits')::int, 'need', w.need);
  end if;
  if w.dir = 'home' then update public.boats set home_fails = 0 where account_id = v_account; end if;
  -- 0087 }
  if v_landed then                                                                                       -- 0116 {
    perform public._river_move(v_account, 'song_cai', (v_ld->>'foot_x')::int, (v_ld->>'foot_y')::int);
    v_to := jsonb_build_object('map', 'song_cai', 'x', (v_ld->>'foot_x')::int, 'y', (v_ld->>'foot_y')::int, 'dir', 'down');
  -- 0116 }
  elsif w.dir = 'out' then
    perform public._river_move(v_account, 'song_cai', (g->>'arrive_x')::int, (g->>'arrive_y')::int);
    v_to := jsonb_build_object('map', 'song_cai', 'x', (g->>'arrive_x')::int, 'y', (g->>'arrive_y')::int, 'dir', 'right');
  else
    perform public._river_move(v_account, 'pond', (g->>'pier_x')::int, (g->>'pier_y')::int);
    v_to := jsonb_build_object('map', 'pond', 'x', (g->>'pier_x')::int, 'y', (g->>'pier_y')::int, 'dir', 'down');
  end if;
  return jsonb_build_object('result', 'arrived', 'hits', (v_rep->>'hits')::int, 'need', w.need, 'pass', v_rep->>'outcome' = 'pass',
                            'to', v_to);
end $$;

revoke all on function public.river_row_start(uuid, text, text, integer, integer) from public;
revoke all on function public.river_row_finish(uuid, text, integer[], integer) from public;
grant execute on function public.river_row_start(uuid, text, text, integer, integer) to anon, authenticated;
grant execute on function public.river_row_finish(uuid, text, integer[], integer) to anon, authenticated;
