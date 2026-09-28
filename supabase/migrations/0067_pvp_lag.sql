-- =========================================================
-- 0067_pvp_lag.sql — anti-cheat v2 #6 (docs/superpowers/plans/2026-09-28-anticheat-v2-part3.md, part P): a ring match's
-- lag and stall blame come from the server's clock, and a side that sees the opponent's inputs early is caught by its
-- reactions. ADDITIVE and re-runnable. Run after 0066.
--   A. fight_logs: lag_n, lag_sum, lag_max (server frames since started_at − the new frontier, per push that advances
--      it), late_frames (frames that arrived more than 30 frames behind the clock), rx {the opponent's last attack
--      start, fast = a new button or block 1–4 frames after it, control = 5–8 frames after it, flagged}.
--   B. _fx_react: one frame of a side's reaction count (0060's bot rule, for either side).
--   C. fight_push (0060's, verbatim but for the lines marked 0067): a ring push records its lag; every ring frame the
--      replay steps counts both sides' reactions; fast > 24 and > 3 × control + 8 is the hard 'fight_lookahead' and the
--      match is settled as that side's loss (forfeit). p_stall stays the client's claim (stall_frames, evidence only).
--   D. _pvp_settle (0051's, verbatim but for the lines marked 0067): the stall blame is the server's — a side whose
--      late_frames × 5 > max(frames, 600) and exceed the other side's.
-- Instead of commit-then-reveal: the opponent's inputs travel peer to peer every 100 ms, so a commit binds only after
-- they are seen, and holding mine back until the peer commits would add a batch of latency to every frame. With
-- rollback and an input delay of 2–6 frames an honest reaction lands ≥ 10 frames after the attack starts, so both
-- windows fill only by chance and alike; seeing the opponent's inputs early fills the fast one.
-- =========================================================

-- ---------- A. The columns ----------
alter table public.fight_logs add column if not exists lag_n integer not null default 0;
alter table public.fight_logs add column if not exists lag_sum bigint not null default 0;
alter table public.fight_logs add column if not exists lag_max integer not null default 0;
alter table public.fight_logs add column if not exists late_frames integer not null default 0;
alter table public.fight_logs add column if not exists rx integer[] not null default '{-1000,0,0,0}';

-- ---------- B. A reaction ----------
-- p_rx {attack start frame, fast, control, flagged}; the mask stepped this frame, the side's mask and facing before it,
-- and the frame after it.
create or replace function public._fx_react(p_rx integer[], p_mask integer, p_prev integer, p_face integer, p_frame integer)
returns integer[]
language plpgsql immutable parallel safe
as $$
declare v_new integer := p_mask & (~p_prev); v_dir integer := public._fx_dir(p_mask, p_face);
        v_dirp integer := public._fx_dir(p_prev, p_face);
begin
  if (v_new & (256 | 16 | 32 | 64 | 128)) <> 0 or (v_dir in (1, 4, 7) and v_dirp not in (1, 4, 7)) then
    if p_frame - p_rx[1] between 1 and 4 then p_rx[2] := p_rx[2] + 1;
    elsif p_frame - p_rx[1] between 5 and 8 then p_rx[3] := p_rx[3] + 1;
    end if;
  end if;
  return p_rx;
end $$;
revoke all on function public._fx_react(integer[], integer, integer, integer, integer) from public, anon, authenticated;

-- ---------- C. fight_push (0060's, verbatim but for the lines marked 0067) ----------
create or replace function public.fight_push(p_session_token text, p_match uuid, p_from integer, p_runs integer[],
                                             p_seen_from integer default null, p_seen_runs integer[] default null,
                                             p_hash_frame integer default null, p_hash bigint default null,
                                             p_stall integer default 0) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid := public._auth_account(p_session_token); mt public.fight_matches; lg public.fight_logs;
  v_side smallint; v_bad text; v_code text; v_masks integer[]; v_n integer := 0; v_over integer; v_tail integer[];
  v_front integer; v_allowed integer; v_ac jsonb; v_res jsonb; v_m integer[]; s integer[]; v_target integer;
  v_from integer; v_len integer; a integer[]; b integer[]; k integer; v_hash_at bigint; v_resync boolean := false;
  v_face integer; v_prev integer; v_mask integer; v_new integer; v_bot boolean; v_changes integer := 0; v_ev integer[];
  v_fr integer; v_dir integer; v_dirp integer; v_soft text; v_steps integer := 0; v_t integer[]; v_nr integer;
  v_seen integer[]; v_sn integer := 0; v_sover integer; v_stail integer[]; v_st integer[]; v_snr integer; j integer;   -- v20.3
  v_pf integer[] := array[null, null]::integer[]; v_ph bigint[] := array[null, null]::bigint[];                      -- v20.3
  v_pc bigint[] := array[null, null]::bigint[]; v_ck integer[] := array[-1, -1]; v_bh integer[] := array[0, 0];       -- v20.3
  v_pacc uuid; v_hard jsonb; v_x1 integer; v_x2 bigint; v_x3 integer; v_x4 integer;                                   -- v20.3
  v_secret boolean; v_rng integer; v_round integer; v_r integer[];                                                     -- 0060
  v_lag integer; v_rx1 integer[]; v_rx2 integer[]; v_face2 integer; v_prev2 integer; v_la integer; v_rx integer[];     -- 0067
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if mt.p1 = v_account then v_side := 1;
  elsif mt.p2 = v_account then v_side := 2;
  else raise exception 'not your match' using errcode = '22023'; end if;
  v_bot := mt.p2 is null;
  -- 0060 {
  -- a secret-bot match: the bots' stream stays here, the client's bot is a decoy (no hash to compare)
  v_secret := v_bot and coalesce((mt.params->>'secretBot')::boolean, false);
  v_rng := mt.bot_rng;
  v_round := mt.bot_round;
  if v_secret then p_hash := null; p_hash_frame := null; end if;
  -- 0060 }
  -- 1. a settled match answers its result; a bot match left alone for 60 s is settled first
  if mt.status = 'live' and v_bot then
    perform public._fx_sweep(v_account);
    select * into mt from public.fight_matches where id = p_match;
  end if;
  -- v20.3 {
  if mt.status = 'live' and not v_bot then
    perform public._pvp_sweep(p_match);
    select * into mt from public.fight_matches where id = p_match;
  end if;
  -- v20.3 }
  -- v20.4 {
  -- a called ug match (U2): the no-show past its call; until both are ready a push is only answered (never flagged)
  if mt.status = 'live' and mt.ready <> 3 then
    perform public._ug_sweep_match(p_match);
    select * into mt from public.fight_matches where id = p_match;
    if mt.status = 'live' then return public._fx_answer(p_match, v_side) || jsonb_build_object('waiting', true); end if;
  end if;
  -- v20.4 }
  if mt.status <> 'live' then return public._fx_answer(p_match, v_side); end if;
  select * into lg from public.fight_logs where match_id = p_match and side = v_side for update;
  -- 2–4. the runs, the frame they start at, the pacing
  v_bad := public._fx_runs_error(p_runs, 300);
  if v_bad is null and (p_from is null or p_from < 0) then v_bad := 'from'; end if;
  if v_bad is null then
    v_masks := public._fx_runs_decode(p_runs, 300);
    v_n := coalesce(cardinality(v_masks), 0);
    if p_from > lg.frontier + 1 then v_bad := 'gap'; end if;
  end if;
  if v_bad is null and v_n > 0 and p_from <= lg.frontier then
    -- a retry: the frames already stored must repeat identically; only the tail is new (plan ruling P4)
    v_over := least(v_n, lg.frontier + 1 - p_from);
    if public._fx_runs_slice(lg.runs, p_from, v_over) is distinct from v_masks[1:v_over] then v_bad := 'overlap'; end if;
    v_tail := v_masks[v_over + 1:v_n];
  elsif v_bad is null then
    v_tail := v_masks;
  end if;
  -- v20.3 {
  -- the opponent's inputs as I received them (a ring match): the same shape rules (its rate is the opponent's), no gap,
  -- a retry repeats what is stored
  if v_bad is null and not v_bot and p_seen_runs is not null and cardinality(p_seen_runs) > 0 then
    v_bad := nullif(public._fx_runs_error(p_seen_runs, 300), 'rate');
    if v_bad is null and (p_seen_from is null or p_seen_from < 0 or p_seen_from > coalesce(lg.seen_frontier, -1) + 1) then
      v_bad := 'seen_gap';
    end if;
    if v_bad is null then
      v_seen := public._fx_runs_decode(p_seen_runs, 300);
      v_sn := coalesce(cardinality(v_seen), 0);
      if v_sn > 0 and p_seen_from <= coalesce(lg.seen_frontier, -1) then
        v_sover := least(v_sn, lg.seen_frontier + 1 - p_seen_from);
        if public._fx_runs_slice(lg.seen_runs, p_seen_from, v_sover) is distinct from v_seen[1:v_sover] then v_bad := 'seen_overlap'; end if;
        v_stail := v_seen[v_sover + 1:v_sn];
      else
        v_stail := v_seen;
      end if;
    end if;
  end if;
  -- v20.3 }
  v_code := case when v_bad is not null then 'fight_bad_input' end;
  v_front := greatest(lg.frontier, coalesce(p_from, 0) + v_n - 1);
  v_allowed := floor(extract(epoch from now() - mt.started_at) * 60)::integer + 60;
  if v_code is null and v_front > lg.frontier and v_front > v_allowed then v_code := 'fight_too_fast'; end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'fight_push',
              jsonb_build_object('match', p_match, 'kind', mt.kind, 'error', coalesce(v_bad, 'pace'), 'from', p_from,
                                 'frontier', lg.frontier, 'frames', v_n, 'allowed', v_allowed,
                                 'runs', to_jsonb(p_runs[1:200])),
              mt.room_id);
    -- a bot match ends there as the player's loss (plan ruling P5)
    if v_bot then perform public._fx_settle(p_match, 2::smallint, 'forfeit'); end if;
    return public._fx_answer(p_match, v_side) || v_ac;
  end if;
  -- 5. append the new frames
  v_ev := lg.ac;
  if coalesce(cardinality(v_tail), 0) > 0 then
    -- the tail's runs join the log (its first run merges into the last one when the mask is the same)
    v_t := public._fx_runs_encode(v_tail);
    v_nr := coalesce(cardinality(lg.runs), 0);
    if v_nr >= 2 and lg.runs[v_nr - 1] = v_t[1] then
      lg.runs[v_nr] := lg.runs[v_nr] + v_t[2];
      lg.runs := lg.runs || v_t[3:cardinality(v_t)];
    else
      lg.runs := coalesce(lg.runs, '{}'::integer[]) || v_t;
    end if;
    lg.frontier := v_front;
    -- busy evidence: a long push with more than 18 changes per 60 frames (plan ruling P10)
    for k in 2..cardinality(v_tail) loop
      if v_tail[k] <> v_tail[k - 1] then v_changes := v_changes + 1; end if;
    end loop;
    if cardinality(v_tail) >= 60 and v_changes * 60 > 18 * cardinality(v_tail) then v_ev[3] := v_ev[3] + cardinality(v_tail);
    else v_ev[3] := 0; end if;
  end if;
  update public.fight_logs
     set runs = lg.runs, frontier = lg.frontier, last_push_at = now(), pushes = pushes + 1,
         stall_frames = stall_frames + greatest(0, least(coalesce(p_stall, 0), 100000))
   where match_id = p_match and side = v_side;
  -- 0067 {
  -- a ring push that brings new frames: how far behind the server's clock they arrive
  if not v_bot and coalesce(cardinality(v_tail), 0) > 0 then
    v_lag := floor(extract(epoch from now() - mt.started_at) * 60)::integer - lg.frontier;
    update public.fight_logs
       set lag_n = lag_n + 1, lag_sum = lag_sum + v_lag, lag_max = greatest(lag_max, v_lag),
           late_frames = late_frames + least(cardinality(v_tail), greatest(0, v_lag - 30))
     where match_id = p_match and side = v_side;
  end if;
  -- 0067 }
  -- v20.3 {
  if not v_bot then
    if coalesce(cardinality(v_stail), 0) > 0 then
      v_st := public._fx_runs_encode(v_stail);
      v_snr := coalesce(cardinality(lg.seen_runs), 0);
      if v_snr >= 2 and lg.seen_runs[v_snr - 1] = v_st[1] then
        lg.seen_runs[v_snr] := lg.seen_runs[v_snr] + v_st[2];
        lg.seen_runs := lg.seen_runs || v_st[3:cardinality(v_st)];
      else
        lg.seen_runs := coalesce(lg.seen_runs, '{}'::integer[]) || v_st;
      end if;
      lg.seen_frontier := greatest(coalesce(lg.seen_frontier, -1), p_seen_from + v_sn - 1);
      update public.fight_logs set seen_runs = lg.seen_runs, seen_frontier = lg.seen_frontier
       where match_id = p_match and side = v_side;
    end if;
    -- the broadcast against the pushed logs: a difference disputes and refunds the match
    if public._pvp_conflicts(p_match) then
      return public._fx_answer(p_match, v_side) || jsonb_build_object('resync', false);
    end if;
    -- my hash waits until the replay passes its frame
    if p_hash_frame is not null and p_hash is not null and p_hash_frame >= mt.sim_frame then
      update public.fight_logs set pend_hash_frame = p_hash_frame, pend_hash = p_hash where match_id = p_match and side = v_side;
    end if;
    p_hash_frame := null;
    for j in 1..2 loop
      select pend_hash_frame, pend_hash, seen_checked, bad_hashes into v_x1, v_x2, v_x3, v_x4
        from public.fight_logs where match_id = p_match and side = j;
      v_pf[j] := v_x1;
      v_ph[j] := v_x2;
      v_ck[j] := v_x3;
      v_bh[j] := v_x4;
      if v_pf[j] = mt.sim_frame then v_pc[j] := mt.sim_hash; end if;
    end loop;
  end if;
  -- v20.3 }
  -- 6. advance the sim over the frames both logs cover (a bot match: mine), at most 300 per call
  v_target := case when v_bot then lg.frontier + 1
                   else least((select frontier from public.fight_logs where match_id = p_match and side = 1),
                              (select frontier from public.fight_logs where match_id = p_match and side = 2)) + 1 end;
  v_target := least(v_target, mt.sim_frame + 300);
  s := mt.sim;
  v_from := mt.sim_frame;
  v_len := greatest(0, v_target - v_from);
  if p_hash_frame is not null and p_hash_frame = v_from then v_hash_at := mt.sim_hash; end if;
  if v_len > 0 and s[1 + 1] <> 3 then
    v_m := public._fx_moves();
    a := public._fx_runs_slice((select runs from public.fight_logs where match_id = p_match and side = 1), v_from, v_len);
    b := case when v_bot then array_fill(0, array[v_len])
              else public._fx_runs_slice((select runs from public.fight_logs where match_id = p_match and side = 2), v_from, v_len) end;
    if not v_bot then                                                                    -- 0067: both sides' reactions
      select rx into v_rx1 from public.fight_logs where match_id = p_match and side = 1;   -- 0067
      select rx into v_rx2 from public.fight_logs where match_id = p_match and side = 2;   -- 0067
    end if;                                                                              -- 0067
    for k in 1..v_len loop
      v_face := s[49 + 4];
      v_prev := s[49 + 19];
      v_face2 := s[113 + 4];                                                             -- 0067
      v_prev2 := s[113 + 19];                                                            -- 0067
      -- 0060 {
      if v_secret then
        if s[3 + 1] is distinct from v_round then
          v_round := s[3 + 1];
          v_rng := public._fx_bot_seed(p_match, v_round);
        end if;
        v_r := public._fx_step_secret(s, a[k], b[k], v_m, v_rng);
        s := v_r[1:176];
        v_rng := v_r[177];
      else
      -- 0060 }
      s := public._fx_step_bots(s, a[k], b[k], v_m);
      end if;                                                                              -- 0060
      v_fr := v_from + k;
      if v_bot then
        -- fast reactions: a new block or attack button 1–4 frames after the bot started a move (plan ruling P10)
        if (s[113 + 7] = 9 or s[113 + 7] = 10) and s[113 + 8] = 1 then v_ev[1] := s[0 + 1]; end if;
        v_mask := a[k];
        v_new := v_mask & (~v_prev);
        v_dir := public._fx_dir(v_mask, v_face);
        v_dirp := public._fx_dir(v_prev, v_face);
        if ((v_new & (256 | 16 | 32 | 64 | 128)) <> 0 or (v_dir in (1, 4, 7) and v_dirp not in (1, 4, 7)))
           and s[0 + 1] - v_ev[1] between 1 and 4 then
          v_ev[2] := v_ev[2] + 1;
        end if;
        -- 0060 {
        -- the control window: the same presses 5–8 frames after the bot's move start
        if ((v_new & (256 | 16 | 32 | 64 | 128)) <> 0 or (v_dir in (1, 4, 7) and v_dirp not in (1, 4, 7)))
           and s[0 + 1] - v_ev[1] between 5 and 8 then
          v_ev[5] := coalesce(v_ev[5], 0) + 1;
        end if;
        -- 0060 }
      end if;
      -- 0067 {
      -- a ring frame: each side's new button or block against the other side's attack start
      if not v_bot then
        if (s[113 + 7] = 9 or s[113 + 7] = 10) and s[113 + 8] = 1 then v_rx1[1] := s[0 + 1]; end if;
        if (s[49 + 7] = 9 or s[49 + 7] = 10) and s[49 + 8] = 1 then v_rx2[1] := s[0 + 1]; end if;
        v_rx1 := public._fx_react(v_rx1, a[k], v_prev, v_face, s[0 + 1]);
        v_rx2 := public._fx_react(v_rx2, b[k], v_prev2, v_face2, s[0 + 1]);
      end if;
      -- 0067 }
      if not v_bot and (v_pf[1] = v_fr or v_pf[2] = v_fr) then                                        -- v20.3
        for j in 1..2 loop if v_pf[j] = v_fr then v_pc[j] := public._fx_hash(s); end if; end loop;  -- v20.3
      end if;                                                                                          -- v20.3
      if p_hash_frame is not null and p_hash_frame = v_fr then v_hash_at := public._fx_hash(s); end if;
      v_steps := k;
      exit when s[1 + 1] = 3;
    end loop;
    mt.sim_frame := v_from + v_steps;
    update public.fight_matches set sim = s, sim_frame = mt.sim_frame, sim_hash = public._fx_hash(s) where id = p_match;
    if v_secret then update public.fight_matches set bot_rng = v_rng, bot_round = v_round where id = p_match; end if;   -- 0060
  end if;
  -- soft evidence, once per match
  if v_bot and v_ev[4] = 0 and (v_ev[2] > 12 or v_ev[3] >= 600) then
    v_ev[4] := 1;
    v_soft := public._ac_flag(v_account, 'fight_superhuman', 'fight_push',
                jsonb_build_object('match', p_match, 'fast_reactions', v_ev[2], 'busy_frames', v_ev[3], 'frame', v_target),
                mt.room_id, null, false)::text;
  end if;
  update public.fight_logs set ac = v_ev where match_id = p_match and side = v_side;
  -- 0060 {
  -- superhuman: fast reactions far above the control window (a masher hits both alike) — hard, and the player's loss
  if v_bot and coalesce(v_ev[6], 0) = 0 and v_ev[2] > 24 and v_ev[2] > 3 * coalesce(v_ev[5], 0) + 8 then
    v_ev[6] := 1;
    update public.fight_logs set ac = v_ev where match_id = p_match and side = v_side;
    v_ac := public._ac_flag(v_account, 'fight_superhuman', 'fight_push',
              jsonb_build_object('match', p_match, 'kind', mt.kind, 'fast_reactions', v_ev[2], 'control', coalesce(v_ev[5], 0),
                                 'frame', mt.sim_frame), mt.room_id);
    perform public._fx_settle(p_match, 2::smallint, 'forfeit');
    return public._fx_answer(p_match, v_side) || v_ac;
  end if;
  -- 0060 }
  -- 0067 {
  -- look-ahead: a side whose fast reactions far exceed its control window saw the opponent's inputs early — hard, and
  -- the match is that side's loss
  if v_rx1 is not null then
    update public.fight_logs set rx = v_rx1 where match_id = p_match and side = 1;
    update public.fight_logs set rx = v_rx2 where match_id = p_match and side = 2;
    for j in 1..2 loop
      v_rx := case j when 1 then v_rx1 else v_rx2 end;
      continue when v_rx[4] <> 0 or not (v_rx[2] > 24 and v_rx[2] > 3 * v_rx[3] + 8);
      v_rx[4] := 1;
      update public.fight_logs set rx = v_rx where match_id = p_match and side = j;
      v_hard := public._ac_flag(case j when 1 then mt.p1 else mt.p2 end, 'fight_lookahead', 'fight_push',
                  jsonb_build_object('match', p_match, 'kind', mt.kind, 'side', j, 'fast_reactions', v_rx[2], 'control', v_rx[3],
                                     'frame', mt.sim_frame,
                                     'lag', (select jsonb_agg(jsonb_build_object('side', l.side, 'pushes', l.lag_n,
                                                'avg', case when l.lag_n > 0 then round(l.lag_sum::numeric / l.lag_n, 1) end,
                                                'max', l.lag_max, 'late_frames', l.late_frames, 'stall_claimed', l.stall_frames)
                                                order by l.side)
                                               from public.fight_logs l where l.match_id = p_match)),
                  mt.room_id);
      if j = v_side then v_ac := v_hard; end if;
      v_la := j;
      exit;
    end loop;
    if v_la is not null then
      perform public._fx_settle(p_match, (3 - v_la)::smallint, 'forfeit');
      return public._fx_answer(p_match, v_side) || coalesce(v_ac, '{}'::jsonb);
    end if;
  end if;
  -- 0067 }
  -- 7. the client's hash against the replay's
  if p_hash is not null and v_hash_at is not null and v_hash_at <> p_hash then
    v_resync := true;
    update public.fight_logs set bad_hashes = bad_hashes + 1 where match_id = p_match and side = v_side;
    update public.fight_matches set resyncs = resyncs + 1 where id = p_match;
    v_soft := public._ac_flag(v_account, 'fight_hash_mismatch', 'fight_push',
                jsonb_build_object('match', p_match, 'frame', p_hash_frame, 'client', p_hash, 'server', v_hash_at),
                mt.room_id, null, false)::text;
  end if;
  -- v20.3 {
  -- a ring match: each side's pending hash once the replay passed it (and that side's seen is checked that far)
  if not v_bot then
    for j in 1..2 loop
      continue when v_pf[j] is null or v_pf[j] > mt.sim_frame;
      update public.fight_logs set pend_hash_frame = null, pend_hash = null where match_id = p_match and side = j;
      continue when v_pc[j] is null or v_pc[j] = v_ph[j] or v_ck[j] < v_pf[j] - 1;
      v_pacc := case j when 1 then mt.p1 else mt.p2 end;
      update public.fight_logs set bad_hashes = bad_hashes + 1, resync = true where match_id = p_match and side = j;
      update public.fight_matches set resyncs = resyncs + 1 where id = p_match;
      if v_bh[j] = 0 then
        v_soft := public._ac_flag(v_pacc, 'fight_hash_mismatch', 'fight_push',
                    jsonb_build_object('match', p_match, 'frame', v_pf[j], 'client', v_ph[j], 'server', v_pc[j]),
                    mt.room_id, null, false)::text;
        if (select count(distinct e.detail->>'match') from public.anticheat_events e
             where e.account_id = v_pacc and e.code = 'fight_hash_mismatch' and e.created_at > now() - interval '7 days') >= 3 then
          v_hard := public._ac_flag(v_pacc, 'fight_hash_mismatch', 'fight_push',
                      jsonb_build_object('match', p_match, 'frame', v_pf[j], 'pattern', '3 matches in 7 days'), mt.room_id);
          if j = v_side then v_ac := v_hard; end if;
        end if;
      end if;
    end loop;
    select resync into v_resync from public.fight_logs where match_id = p_match and side = v_side;
    if v_resync then update public.fight_logs set resync = false where match_id = p_match and side = v_side; end if;
  end if;
  -- v20.3 }
  -- 8. the end of the match settles it
  if s[1 + 1] = 3 then
    perform public._fx_settle(p_match, (case s[7 + 1] when 1 then 1 when 2 then 2 else 0 end)::smallint,
                              case when (s[6 + 1] >> 2) = 1 then 'ko' else 'decision' end);
  end if;
  -- 9.
  if v_secret then v_ac := coalesce(v_ac, '{}'::jsonb) || jsonb_build_object('sim', to_jsonb((select sim from public.fight_matches where id = p_match))); end if;   -- 0060: the public sim, to resync
  return public._fx_answer(p_match, v_side) || jsonb_build_object('resync', v_resync) || coalesce(v_ac, '{}'::jsonb);   -- v20.3
  return public._fx_answer(p_match, v_side) || jsonb_build_object('resync', v_resync);
end $$;
revoke all on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) from public;
grant execute on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) to anon, authenticated;

-- ---------- D. _pvp_settle (0051's, verbatim but for the lines marked 0067) ----------
create or replace function public._pvp_settle(p_match uuid, p_winner smallint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; cfg public.fight_config; v_pot integer; v_fee integer := 0; v_won integer := 0;
        v_ref text; v_wacc uuid; v_lacc uuid; j integer; v_acc uuid; v_opp_stall integer; n integer; d integer;
        v_late integer; v_olate integer;                                                  -- 0067
begin
  select * into mt from public.fight_matches where id = p_match;
  select * into cfg from public.fight_config where id;
  update public.fight_rings set match_id = null, v = v + 1 where match_id = p_match;
  v_pot := 2 * mt.stake;
  v_ref := 'pvp ' || left(p_match::text, 8);
  perform public._wallet_lock(least(mt.p1, mt.p2));
  perform public._wallet_lock(greatest(mt.p1, mt.p2));
  if p_winner in (1, 2) then
    v_wacc := case p_winner when 1 then mt.p1 else mt.p2 end;
    v_lacc := case p_winner when 1 then mt.p2 else mt.p1 end;
  end if;
  if mt.stake > 0 then
    if v_wacc is not null then
      v_fee := v_pot * coalesce(cfg.fee_pct, 5) / 100;
      v_won := v_pot - v_fee;
      perform public._pay(v_wacc, v_won, 'fight_win', v_ref || ': ' || p_reason || ', phí ' || v_fee);
    else
      perform public._pay(mt.p1, mt.stake, 'fight_refund', v_ref || ': draw');
      perform public._pay(mt.p2, mt.stake, 'fight_refund', v_ref || ': draw');
    end if;
  end if;
  insert into public.fight_profiles (account_id) values (mt.p1), (mt.p2) on conflict (account_id) do nothing;
  if v_wacc is null then
    update public.fight_profiles set draws = draws + 1 where account_id in (mt.p1, mt.p2);
  else
    update public.fight_profiles set wins = wins + 1 where account_id = v_wacc;
    update public.fight_profiles set losses = losses + 1 where account_id = v_lacc;
  end if;
  -- stall blame (plan ruling P18): the opponent reports more than 20 % of the match's frames waiting for me
  for j in 1..2 loop
    v_acc := case j when 1 then mt.p1 else mt.p2 end;
    select stall_frames into v_opp_stall from public.fight_logs where match_id = p_match and side = 3 - j;
    -- 0067: the server's clock decides, not the opponent's report: my frames arrived late, and later than theirs
    select late_frames into v_late from public.fight_logs where match_id = p_match and side = j;             -- 0067
    select late_frames into v_olate from public.fight_logs where match_id = p_match and side = 3 - j;        -- 0067
    if coalesce(v_late, 0) * 5 > greatest(mt.sim_frame, 600) and coalesce(v_late, 0) > coalesce(v_olate, 0) then   -- 0067 was: if coalesce(v_opp_stall, 0) * 5 > greatest(mt.sim_frame, 600) then
      update public.fight_logs set blamed = true where match_id = p_match and side = j;
      select count(*), count(distinct case when m.p1 = v_acc then m.p2 else m.p1 end) into n, d
        from public.fight_logs l join public.fight_matches m on m.id = l.match_id
       where l.account_id = v_acc and l.blamed and m.kind = 'pvp' and coalesce(m.ended_at, now()) > now() - interval '7 days';
      if n >= 3 and d >= 2 then
        perform public._ac_flag(v_acc, 'fight_stall_blame', 'fight_push',
                  jsonb_build_object('match', p_match, 'stall_frames', v_opp_stall, 'frames', mt.sim_frame, 'matches', n, 'opponents', d, 'late_frames', v_late, 'opponent_late_frames', v_olate),   -- 0067 was: jsonb_build_object('match', p_match, 'stall_frames', v_opp_stall, 'frames', mt.sim_frame, 'matches', n, 'opponents', d),
                  mt.room_id, null, false);
      end if;
    end if;
  end loop;
  if mt.stake >= 5000 and v_wacc is not null then
    perform public._news_event(mt.room_id, 'fight',
      format('⚔️ Trận thư hùng ở Bãi đất trống: %s hạ gục %s, ẵm %s xu tiền cược. Cả xóm kéo ra xem chật sân!',
             public._news_name(v_wacc), public._news_name(v_lacc), v_won),
      jsonb_build_object('match', p_match, 'winner', v_wacc, 'loser', v_lacc, 'stake', mt.stake, 'won', v_won));
  end if;
  return jsonb_build_object('pvp', jsonb_build_object('stake', mt.stake, 'pot', v_pot, 'fee', v_fee, 'won', v_won,
    'records', (select jsonb_object_agg(case when f.account_id = mt.p1 then '1' else '2' end,
                                        jsonb_build_object('wins', f.wins, 'losses', f.losses, 'draws', f.draws))
                  from public.fight_profiles f where f.account_id in (mt.p1, mt.p2))));
end $$;
revoke all on function public._pvp_settle(uuid, smallint, text) from public, anon, authenticated;
