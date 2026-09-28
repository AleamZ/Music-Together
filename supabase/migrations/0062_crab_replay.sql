-- =========================================================
-- 0062_crab_replay.sql — anti-cheat v2 #9: the crab game is server-seeded and replayed (docs/superpowers/plans/
-- 2026-09-28-anticheat-v2-part2.md, part D). ADDITIVE and re-runnable. Run after 0061.
--   A. gather_cooldowns.visit_seed: crab_start (0018's) rolls it and answers it as visit.seed; the start is a claim at
--      the hole's use spot ('too far').
--   B. The game of lib/game/farm/minigames.ts, integer ticks: _crab_phases, _crab_replay, _crab_input_error.
--      tests/fixtures/crab-cases.json pins them (Vitest + tests/sql/anticheat-v2-farm-smoke.sql).
--   C. crab_finish(room, token, visit, grabs, ticks, hits): a claim at the hole again; the game replayed up to `ticks`
--      from the visit's seed — malformed → hard crab_bad_input, hits differing from the replay → hard crab_mismatch,
--      sooner than 0.9 × the replayed ticks after the visit began → hard crab_too_fast (each ends the visit with no
--      crab); else 0018's _gather_do_crab_finish with the replayed hits (its 3 s and 120 s gates). The old
--      crab_finish(…, hits) keeps 0 hits and raises 'outdated' for more.
-- =========================================================

-- ---------- A. The seed ----------
alter table public.gather_cooldowns add column if not exists visit_seed bigint;

-- ---------- B. The game (minigames.ts, statement for statement) ----------
-- Each try's phase in [0, P): u mod P for the periods 72, 57, 45 ticks (createCrabRound).
create or replace function public._crab_phases(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[] := '{}'; p integer;
begin
  foreach p in array array[72, 57, 45] loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || (r[1] % p)::integer;
  end loop;
  return o;
end $$;

-- The game from its grabs (replayCrab) up to p_ticks or its end: {hits, tries, ticks}. Lead-in 36 ticks, claws closed
-- when 10·((phase + t) mod P) ≥ 6P, a slip after 4 P, a 30-tick beat.
create or replace function public._crab_replay(p_seed bigint, p_grabs integer[], p_ticks integer) returns jsonb
language plpgsql immutable parallel safe
as $$
declare ph integer[] := public._crab_phases(p_seed); per integer[] := array[72, 57, 45]; stage integer := 0; t integer := 0;
        tick integer := 0; tries integer := 0; hits integer := 0; done boolean := false; g boolean; i integer := 1;
        n integer := coalesce(cardinality(p_grabs), 0); p integer; mark text;
begin
  while not done and tick < p_ticks loop
    g := false;
    while i <= n and p_grabs[i] = tick loop
      g := true;
      i := i + 1;
    end loop;
    tick := tick + 1;
    t := t + 1;
    if stage = 0 then
      if t >= 36 then stage := 1; t := t - 36; end if;
    elsif stage = 1 then
      p := per[tries + 1];
      mark := case when g then case when 10 * ((ph[tries + 1] + t) % p) >= 6 * p then 'hit' else 'pinch' end
                   when t >= 4 * p then 'slip' end;
      if mark is not null then
        tries := tries + 1;
        if mark = 'hit' then hits := hits + 1; end if;
        stage := 2;
        t := 0;
      end if;
    elsif t >= 30 then
      if tries >= 3 then done := true; else stage := 0; t := t - 30; end if;
    end if;
  end loop;
  return jsonb_build_object('hits', hits, 'tries', tries, 'ticks', tick);
end $$;

-- crabInputError: at most 60 grabs, 20 in any 60 ticks, within 7 200 ticks.
create or replace function public._crab_input_error(p_grabs integer[], p_ticks integer) returns text
language sql immutable parallel safe
as $$ select public._toggles_error(p_grabs, p_ticks, 7200, 60, 20) $$;
revoke all on function public._crab_phases(bigint) from public, anon, authenticated;
revoke all on function public._crab_replay(bigint, integer[], integer) from public, anon, authenticated;
revoke all on function public._crab_input_error(integer[], integer) from public, anon, authenticated;

-- ---------- C. The RPCs ----------
-- crab_start (0018's, verbatim but for the lines marked 0062): a claim at the hole; the visit gets a seed.
create or replace function public.crab_start(p_room_id uuid, p_session_token text, p_hole integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
        v_use integer[]; v_ac jsonb; v_res jsonb; v_seed bigint := floor(random() * 4294967296)::bigint;   -- 0062
begin
  if p_hole is null or p_hole not between 1 and 6 then
    return public._ac_flag(v_account, 'bad_spot', 'crab_start', jsonb_build_object('spot', p_hole), p_room_id, 'invalid spot');
  end if;
  -- 0062 {
  v_use := public._field_hole_use(p_hole);
  v_ac := public._pos_claim(v_account, 'field', v_use[1], v_use[2], 'crab_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  v_res := public._gather_do_crab_start(p_room_id, v_account, p_hole, now());
  update public.gather_cooldowns set visit_seed = v_seed
   where account_id = v_account and visit_id = (v_res->'visit'->>'id')::uuid;
  return v_res || jsonb_build_object('visit', (v_res->'visit') || jsonb_build_object('seed', v_seed));
  -- 0062 }
  return public._gather_do_crab_start(p_room_id, v_account, p_hole, now());
end $$;

-- crab_finish (0018's, verbatim but for the line marked 0062): the client's word is kept for no crab only.
create or replace function public.crab_finish(p_room_id uuid, p_session_token text, p_visit_id uuid, p_hits integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_hits is null or p_hits not between 0 and 3 then
    return public._ac_flag(v_account, 'bad_qty', 'crab_finish', jsonb_build_object('visit', p_visit_id, 'hits', p_hits),
                           p_room_id, 'invalid quantity');
  end if;
  if p_hits > 0 then raise exception 'outdated' using errcode = '22023'; end if;   -- 0062: a catch is replayed
  return public._gather_do_crab_finish(p_room_id, v_account, p_visit_id, p_hits, now());
end $$;

-- The replayed game. A refused input ends the visit with no crab and returns the flag's envelope with the answer.
create or replace function public.crab_finish(p_room_id uuid, p_session_token text, p_visit_id uuid, p_grabs integer[],
                                              p_ticks integer, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); g public.gather_cooldowns; v_use integer[];
        v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb;
begin
  select * into g from public.gather_cooldowns where account_id = v_account and visit_id = p_visit_id and visit_room = p_room_id;
  if not found then raise exception 'visit not found' using errcode = '22023'; end if;
  if g.visit_seed is null then raise exception 'outdated' using errcode = '22023'; end if;
  v_use := public._field_hole_use(substr(g.spot, 5)::integer);
  v_ac := public._pos_claim(v_account, 'field', v_use[1], v_use[2], 'crab_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  v_ev := jsonb_build_object('visit', p_visit_id, 'hits', p_hits, 'ticks', p_ticks, 'grabs', to_jsonb(p_grabs[1:60]));
  v_bad := coalesce(public._crab_input_error(p_grabs, p_ticks),
                    case when p_hits is null or p_hits not between 0 and 3 then 'hits' end);
  if v_bad is not null then
    v_code := 'crab_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._crab_replay(g.visit_seed, p_grabs, p_ticks);
    if (v_rep->>'hits')::int <> p_hits or (v_rep->>'ticks')::int <> p_ticks then
      v_code := 'crab_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', g.visit_seed, 'replay', v_rep);
    elsif p_hits > 0 and now() < g.visit_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'crab_too_fast';
      v_ev := v_ev || jsonb_build_object('visit_at', g.visit_at, 'finished_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'crab_finish', v_ev, p_room_id, 'invalid catch');
    return public._gather_do_crab_finish(p_room_id, v_account, p_visit_id, 0, now()) || v_ac;
  end if;
  return public._gather_do_crab_finish(p_room_id, v_account, p_visit_id, (v_rep->>'hits')::int, now());
end $$;
revoke all on function public.crab_start(uuid, text, integer) from public;
revoke all on function public.crab_finish(uuid, text, uuid, integer) from public;
revoke all on function public.crab_finish(uuid, text, uuid, integer[], integer, integer) from public;
grant execute on function public.crab_start(uuid, text, integer) to anon, authenticated;
grant execute on function public.crab_finish(uuid, text, uuid, integer) to anon, authenticated;
grant execute on function public.crab_finish(uuid, text, uuid, integer[], integer, integer) to anon, authenticated;
