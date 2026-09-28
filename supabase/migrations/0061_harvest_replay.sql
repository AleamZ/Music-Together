-- =========================================================
-- 0061_harvest_replay.sql — anti-cheat v2 #8: the rice harvest round is server-seeded and replayed
-- (docs/superpowers/plans/2026-09-28-anticheat-v2-part2.md, part D). ADDITIVE and re-runnable. Run after 0060.
--   A. crops.work_seed: begin_work (0025's) rolls it and answers 'work_seed'.
--   B. The field's use spots (lib/game/maps/field.ts; tests/unit/anticheat-v2-part2.test.ts pins them): _field_plot_use,
--      _field_plot_rect, _field_hole_use (0062 and 0063 claim them too). _toggles_error: the shape rule of a replayed
--      minigame's tick list (lib/game/farm/minigames.ts togglesError).
--   C. The round of lib/game/farm/minigames.ts, integer ticks: _harvest_centres, _harvest_replay, _harvest_input_error.
--      tests/fixtures/harvest-cases.json pins them (Vitest + tests/sql/anticheat-v2-farm-smoke.sql).
--   D. harvest_part(room, token, plot, toggles, ticks, pass): a claim at the plot's use spot ('too far'); the round
--      replayed from the record's seed — malformed → hard harvest_bad_input, the client's pass or end tick differing from
--      the replay → hard harvest_mismatch, sooner than 0.9 × the replayed ticks after begin_work → hard harvest_too_fast
--      (each clears the record and cuts nothing); a replayed fail clears the record as before; a replayed pass cuts the
--      part through 0016's _farm_do_harvest_part (its 8–120 s gates). The old harvest_part(…, success) keeps a failure
--      and raises 'outdated' for a success.
-- =========================================================

-- ---------- A. The seed ----------
alter table public.crops add column if not exists work_seed bigint;

-- ---------- B. The field's spots and the tick lists ----------
-- A plot's use spot (field.ts plotUse): plots 1–4 north of the canal (use below them), 5–10 south (use above them).
create or replace function public._field_plot_use(p_plot integer) returns integer[]
language sql immutable parallel safe
as $$
  select case when p_plot between 1 and 4 then array[(array[72, 224, 376, 528])[p_plot] + 64, 52 + 96 + 16]
              when p_plot between 5 and 10 then array[(array[72, 224, 376])[(p_plot - 5) % 3 + 1] + 64,
                                                      (array[228, 328])[(p_plot - 5) / 3 + 1] - 10] end
$$;
-- A plot's rect {x, y, w, h} (field.ts FIELD_PLOTS).
create or replace function public._field_plot_rect(p_plot integer) returns integer[]
language sql immutable parallel safe
as $$
  select case when p_plot between 1 and 4 then array[(array[72, 224, 376, 528])[p_plot], 52, 128, 96]
              when p_plot between 5 and 10 then array[(array[72, 224, 376])[(p_plot - 5) % 3 + 1],
                                                      (array[228, 328])[(p_plot - 5) / 3 + 1], 128, 76] end
$$;
-- A crab hole's use spot (field.ts gatherUse): on the bank, north (y 164) or south (y 220) of the canal.
create or replace function public._field_hole_use(p_hole integer) returns integer[]
language sql immutable parallel safe
as $$
  select case when p_hole between 1 and 6 then array[(array[96, 250, 364, 500, 700, 640])[p_hole],
                                                     case when p_hole % 2 = 1 then 176 - 12 else 176 + 32 + 12 end] end
$$;

-- Why a tick list is one no minigame makes (null = fine): ticks 1 … p_max_ticks, at most p_max entries, each inside
-- [0, ticks), strictly increasing, at most p_rate in any 60 ticks.
create or replace function public._toggles_error(p_list integer[], p_ticks integer, p_max_ticks integer, p_max integer,
                                                 p_rate integer) returns text
language plpgsql immutable parallel safe
as $$
declare n integer := coalesce(cardinality(p_list), 0);
begin
  if p_ticks is null or p_ticks < 1 or p_ticks > p_max_ticks then return 'ticks'; end if;
  if n > p_max then return 'too_many'; end if;
  if n = 0 then return null; end if;
  if array_ndims(p_list) <> 1 or array_lower(p_list, 1) <> 1 then return 'shape'; end if;
  for i in 1 .. n loop
    if p_list[i] is null or p_list[i] < 0 or p_list[i] >= p_ticks then return 'range'; end if;
    if i > 1 and p_list[i] <= p_list[i - 1] then return 'order'; end if;
    if i > p_rate and p_list[i] - p_list[i - p_rate] < 60 then return 'rate'; end if;
  end loop;
  return null;
end $$;
revoke all on function public._field_plot_use(integer) from public, anon, authenticated;
revoke all on function public._field_plot_rect(integer) from public, anon, authenticated;
revoke all on function public._field_hole_use(integer) from public, anon, authenticated;
revoke all on function public._toggles_error(integer[], integer, integer, integer, integer) from public, anon, authenticated;

-- ---------- C. The round (minigames.ts, statement for statement) ----------
-- The 8 bands' centres ‰: 620 + u mod 161 (createHarvestRound).
create or replace function public._harvest_centres(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[] := '{}';
begin
  for i in 1 .. 8 loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || (620 + r[1] % 161)::integer;
  end loop;
  return o;
end $$;

-- The round from its toggles (replayHarvest): {outcome, ticks, score2}. The hold starts released and flips before each
-- listed tick is stepped; the bar fills in 72 ticks; a cut beat is 21 ticks; 8 half points pass; 7 200 ticks fail.
create or replace function public._harvest_replay(p_seed bigint, p_toggles integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare c integer[] := public._harvest_centres(p_seed); bundle integer := 0; charge integer := 0; lv integer := 0;
        charging boolean := false; armed boolean := true; beat integer := 0; score2 integer := 0; tick integer := 0;
        outcome text; hold boolean := false; i integer := 1; n integer := coalesce(cardinality(p_toggles), 0);
        cut integer; d integer;
begin
  loop
    while i <= n and p_toggles[i] = tick loop
      hold := not hold;
      i := i + 1;
    end loop;
    tick := tick + 1;
    armed := armed or not hold;
    cut := null;
    if beat > 0 then
      beat := beat - 1;
      if beat = 0 and bundle >= 8 then outcome := case when score2 >= 8 then 'pass' else 'fail' end; end if;
    elsif not charging then
      if hold and armed then charging := true; charge := 0; lv := 0; end if;
    elsif not hold then
      cut := lv;
      armed := true;
    else
      charge := charge + 1;
      if charge >= 72 then
        cut := 1000;
        armed := false;
      else
        lv := (charge * 1000) / 72;
      end if;
    end if;
    if cut is not null then
      d := abs(cut - c[bundle + 1]);
      score2 := score2 + case when d <= 70 then 2 when d <= 170 then 1 else 0 end;
      bundle := bundle + 1;
      charge := 0;
      lv := 0;
      charging := false;
      beat := 21;
    end if;
    if outcome is null and tick >= 7200 then outcome := 'fail'; end if;
    exit when outcome is not null;
  end loop;
  return jsonb_build_object('outcome', outcome, 'ticks', tick, 'score2', score2);
end $$;

-- harvestInputError: at most 400 toggles, 45 in any 60 ticks, within 7 200 ticks.
create or replace function public._harvest_input_error(p_toggles integer[], p_ticks integer) returns text
language sql immutable parallel safe
as $$ select public._toggles_error(p_toggles, p_ticks, 7200, 400, 45) $$;
revoke all on function public._harvest_centres(bigint) from public, anon, authenticated;
revoke all on function public._harvest_replay(bigint, integer[]) from public, anon, authenticated;
revoke all on function public._harvest_input_error(integer[], integer) from public, anon, authenticated;

-- ---------- D. The RPCs ----------
-- begin_work (0025's, verbatim but for the lines marked 0061): the record gets a seed, and the answer carries it.
create or replace function public.begin_work(p_room_id uuid, p_session_token text, p_plot integer, p_work text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
        v_seed bigint := floor(random() * 4294967296)::bigint; v_res jsonb;               -- 0061
begin
  perform public._vitals_guard(v_account);
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'begin_work', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_work is null or p_work not in ('transplant', 'harvest') then
    return public._ac_flag(v_account, 'bad_work', 'begin_work', jsonb_build_object('plot', p_plot, 'work', left(p_work, 32)),
                           p_room_id, 'invalid work');
  end if;
  v_res := public._farm_do_begin_work(p_room_id, v_account, p_plot, p_work, now());   -- 0061 was: return public._farm_do_begin_work(p_room_id, v_account, p_plot, p_work, now());
  -- 0061 {
  update public.crops set work_seed = v_seed where room_id = p_room_id and plot_no = p_plot;
  return v_res || jsonb_build_object('work_seed', v_seed);
  -- 0061 }
end $$;

-- harvest_part (0016's, verbatim but for the line marked 0061): the client's word is kept for a failure only.
create or replace function public.harvest_part(p_room_id uuid, p_session_token text, p_plot integer, p_success boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'harvest_part', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if coalesce(p_success, false) then raise exception 'outdated' using errcode = '22023'; end if;   -- 0061: a pass is replayed
  return public._farm_do_harvest_part(p_room_id, v_account, p_plot, p_success, now());
end $$;

-- The replayed round. Every refusal of the input clears the record (a failure) and returns the flag's envelope with the
-- field; a replayed pass goes through 0016's gates and cuts the part.
create or replace function public.harvest_part(p_room_id uuid, p_session_token text, p_plot integer, p_toggles integer[],
                                               p_ticks integer, p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_use integer[]; v_ac jsonb; c public.crops;
        v_bad text; v_rep jsonb; v_code text; v_ev jsonb;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'harvest_part', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  v_use := public._field_plot_use(p_plot);
  v_ac := public._pos_claim(v_account, 'field', v_use[1], v_use[2], 'harvest_part', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into c from public.crops where room_id = p_room_id and plot_no = p_plot;
  if found and c.work = 'harvest' and c.work_seed is null then raise exception 'outdated' using errcode = '22023'; end if;
  v_ev := jsonb_build_object('plot', p_plot, 'pass', p_pass, 'ticks', p_ticks, 'n', coalesce(cardinality(p_toggles), 0),
                             'toggles', to_jsonb(p_toggles[1:200]));
  v_bad := coalesce(public._harvest_input_error(p_toggles, p_ticks), case when p_pass is null then 'pass' end);
  if v_bad is not null then
    v_code := 'harvest_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif c.work_seed is not null then
    v_rep := public._harvest_replay(c.work_seed, p_toggles);
    if (v_rep->>'outcome' = 'pass') <> p_pass or (v_rep->>'ticks')::int <> p_ticks then
      v_code := 'harvest_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', c.work_seed, 'replay', v_rep);
    elsif p_pass and now() < c.work_started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'harvest_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.work_started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'harvest_part', v_ev, p_room_id, 'invalid harvest');
    return public._farm_do_harvest_part(p_room_id, v_account, p_plot, false, now()) || v_ac;
  end if;
  return public._farm_do_harvest_part(p_room_id, v_account, p_plot, coalesce(p_pass, false) and c.work_seed is not null, now());
end $$;
revoke all on function public.begin_work(uuid, text, integer, text) from public;
revoke all on function public.harvest_part(uuid, text, integer, boolean) from public;
revoke all on function public.harvest_part(uuid, text, integer, integer[], integer, boolean) from public;
grant execute on function public.begin_work(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.harvest_part(uuid, text, integer, boolean) to anon, authenticated;
grant execute on function public.harvest_part(uuid, text, integer, integer[], integer, boolean) to anon, authenticated;
