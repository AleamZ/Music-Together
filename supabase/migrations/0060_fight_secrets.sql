-- =========================================================
-- 0060_fight_secrets.sql — anti-cheat v2 #5 and #7: the bots' RNG and the kata's chart stay on the server
-- (docs/superpowers/plans/2026-09-28-anticheat-v2-part2.md, parts B and C). ADDITIVE and re-runnable. Run after 0059.
--   A. ac_secrets: one random server secret (no grants). fight_matches.bot_rng / bot_round: a secret-bot match's stream.
--   B. _fx_bot_seed(match, round): the first 32 bits of md5(secret ‖ match ‖ round), as an int32 — the bot's rolls of
--      that round. _fx_step_secret(s, a, b, m, rng): one frame with the stream put into G_RNG for the bots' rolls and
--      taken out again (G_RNG stays 0 in every state kept or answered): s' ‖ rng'. lib/game/fight/bot.ts
--      stepWithSecretBots mirrors it (tests/fixtures/fight-secret-cases.json).
--   C. The kata: _kata_reveal(chart, upto) (the notes up to a tick), _kata_offsets(chart, presses) (the signed Δ of every
--      judged press: _kata_score's matching), _kata_robotic(offsets) (≥ 24 judged and sd < 0.75 tick). dojo_kata_notes:
--      the notes up to the server's elapsed ticks since the exam started + 240.
--   E–G. _dojo_json and dojo_exam_start answer the chart's length (and the first notes) instead of the seed;
--      dojo_kata_submit: the soft kata_robotic, the 3rd within 30 days the hard kata_robotic_repeat (the attempt fails);
--      the sparring match is a secret-bot match (seed 0, secretBot).
--   H. ug_ladder_start: the boss match is a secret-bot match.
--   I. fight_push: a secret-bot match steps with _fx_step_secret (re-seeded when the round changes; the stream kept in
--      bot_rng), compares no hash and answers its public sim on every push; a control window (5–8 frames after the bot's
--      move start, ac[5]) beside the fast reactions (1–4): fast > 24 and fast > 3·control + 8 is the hard
--      fight_superhuman (once, ac[6]) and the match is the player's loss ('forfeit').
-- =========================================================

-- ---------- A. The secret and the stream ----------
create table if not exists public.ac_secrets (
  id boolean primary key default true check (id),
  secret text not null
);
alter table public.ac_secrets enable row level security;
revoke all on public.ac_secrets from anon, authenticated;
insert into public.ac_secrets (id, secret)
values (true, replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

alter table public.fight_matches add column if not exists bot_rng integer;
alter table public.fight_matches add column if not exists bot_round integer;

-- ---------- B. The bots' secret stream ----------
create or replace function public._fx_bot_seed(p_match uuid, p_round integer) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select ('x' || substr(md5(s.secret || ':' || p_match::text || ':' || p_round::text), 1, 8))::bit(32)::integer
    from public.ac_secrets s where s.id
$$;
revoke all on function public._fx_bot_seed(uuid, integer) from public, anon, authenticated;

-- One frame of a secret-bot match (bot.ts stepWithSecretBots): the stream in G_RNG for the bots, then out again.
create or replace function public._fx_step_secret(s integer[], a integer, b integer, m integer[], p_rng integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare v_rng integer;
begin
  s[5 + 1] := p_rng;
  s := public._fx_step_bots(s, a, b, m);
  v_rng := s[5 + 1];
  s[5 + 1] := 0;
  return s || v_rng;
end $$;
revoke all on function public._fx_step_secret(integer[], integer, integer, integer[], integer) from public, anon, authenticated;

-- ---------- C. The kata ----------
-- The notes of a chart up to tick p_upto (kata.ts kataReveal).
create or replace function public._kata_reveal(p_chart integer[], p_upto integer) returns integer[]
language sql immutable parallel safe
as $$
  select coalesce(array_agg(v order by i), '{}'::integer[])
    from unnest(p_chart) with ordinality u(v, i)
   where p_chart[2 * ((i::integer + 1) / 2) - 1] <= p_upto
$$;

-- The signed Δ (press − note) of every judged press, in press order (kata.ts kataOffsets; _kata_score's matching).
create or replace function public._kata_offsets(p_chart integer[], p_presses integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare notes integer := coalesce(cardinality(p_chart), 0) / 2; judged boolean[]; i integer; k integer; t integer;
        l integer; best integer; best_d integer; d integer; out_ integer[] := '{}';
begin
  judged := array_fill(false, array[greatest(notes, 1)]);
  for i in 1..coalesce(cardinality(p_presses), 0) by 2 loop
    t := p_presses[i];
    l := p_presses[i + 1];
    best := -1;
    best_d := 10;
    for k in 1..notes loop
      if judged[k] or p_chart[2 * k] <> l then continue; end if;
      d := abs(p_chart[2 * k - 1] - t);
      if d < best_d then best := k; best_d := d; end if;
    end loop;
    if best < 0 then continue; end if;
    judged[best] := true;
    out_ := out_ || (t - p_chart[2 * best - 1]);
  end loop;
  return out_;
end $$;

-- Timing without a hand's noise (kata.ts kataRobotic): ≥ 24 judged presses whose Δ spread under 0.75 tick.
create or replace function public._kata_robotic(p_off integer[]) returns boolean
language sql immutable parallel safe
as $$
  select n >= 24 and 16 * (n * sq - sm * sm) < 9 * n * n
    from (select count(*)::bigint n, coalesce(sum(d), 0)::bigint sm, coalesce(sum(d::bigint * d), 0)::bigint sq
            from unnest(p_off) d) x
$$;
revoke all on function public._kata_reveal(integer[], integer) from public, anon, authenticated;
revoke all on function public._kata_offsets(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._kata_robotic(integer[]) from public, anon, authenticated;

-- The notes revealed so far: up to the server's ticks since the exam started + 240 (4 s ahead). A settled or stale
-- exam answers its status only.
create or replace function public.dojo_kata_notes(p_session_token text, p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); ex public.martial_exams; b public.martial_belts;
        v_chart integer[]; v_upto integer;
begin
  select * into ex from public.martial_exams where id = p_exam and account_id = v_account;
  if not found then raise exception 'exam not found' using errcode = '22023'; end if;
  if ex.status <> 'kata' or ex.expires_at < now() then
    return jsonb_build_object('exam_id', ex.id, 'status', ex.status, 'server_now_ms', public._dojo_ms(now()));
  end if;
  select * into b from public.martial_belts where style = ex.style and rank = ex.target_rank;
  v_chart := public._kata_chart(ex.kata_seed, b.kata_notes, b.kata_tpb, ex.target_rank >= 3);
  v_upto := floor(extract(epoch from now() - ex.started_at) * 60)::integer + 240;
  return jsonb_build_object('exam_id', ex.id, 'status', ex.status, 'chart', to_jsonb(public._kata_reveal(v_chart, v_upto)),
                            'upto', v_upto, 'length', v_chart[2 * b.kata_notes - 1] + 30, 'total', b.kata_notes,
                            'server_now_ms', public._dojo_ms(now()));
end $$;
revoke all on function public.dojo_kata_notes(text, uuid) from public;
grant execute on function public.dojo_kata_notes(text, uuid) to anon, authenticated;
-- ---------- E. _dojo_json (0050's, verbatim but for the lines marked 0060) ----------
create or replace function public._dojo_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'styles', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'idx', s.sort, 'name', s.name, 'atk', s.atk, 'def', s.def, 'walk', s.walk, 'jump', s.jump,
        'energy', s.energy, 'uniform', s.uniform,
        'belts', (select jsonb_agg(jsonb_build_object('rank', b.rank, 'name', b.name, 'color', b.color, 'exam_fee', b.exam_fee,
                    'min_hours', b.min_hours, 'fail_cooldown_min', b.fail_cooldown_min, 'kata_notes', b.kata_notes,
                    'kata_tpb', b.kata_tpb, 'kata_pass_pct', b.kata_pass_pct, 'bot_level', b.bot_level) order by b.rank)
                    from public.martial_belts b where b.style = s.id)) order by s.sort), '[]'::jsonb)
      from public.martial_styles s),
    'tuition', 2000,
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object(
        'style', e.style, 'rank', e.rank, 'rank_at_ms', public._dojo_ms(e.rank_at), 'enrolled_at_ms', public._dojo_ms(e.enrolled_at),
        'cooldown_until_ms', case when e.exam_cooldown_until > now() then public._dojo_ms(e.exam_cooldown_until) end,
        'next_exam_ms', case when e.rank < 4 then public._dojo_ms(greatest(
            e.rank_at + make_interval(hours => (select b.min_hours from public.martial_belts b where b.style = e.style and b.rank = e.rank + 1)),
            coalesce(e.exam_cooldown_until, e.rank_at))) end) order by e.enrolled_at, e.style), '[]'::jsonb)
      from public.martial_enrollments e where e.account_id = p_account),
    'uniforms', (select coalesce(jsonb_agg(i.item_id order by i.item_id), '[]'::jsonb)
      from public.account_items i where i.account_id = p_account and i.item_id like 'vp\_%'),
    'wearing', (select c.outfit from public.characters c where c.account_id = p_account),
    'prev_outfit', (select f.prev_outfit from public.fight_profiles f where f.account_id = p_account),
    'exam', (select jsonb_build_object('id', x.id, 'style', x.style, 'target_rank', x.target_rank, 'fee', x.fee,
        'kata_length', (select (public._kata_chart(x.kata_seed, b.kata_notes, b.kata_tpb, x.target_rank >= 3))[2 * b.kata_notes - 1] + 30 from public.martial_belts b where b.style = x.style and b.rank = x.target_rank), 'status', x.status, 'started_at_ms', public._dojo_ms(x.started_at),   -- 0060 was: 'kata_seed', x.kata_seed, 'status', x.status, 'started_at_ms', public._dojo_ms(x.started_at),
        'expires_at_ms', public._dojo_ms(x.expires_at),
        'match', (select jsonb_build_object('id', mt.id, 'status', mt.status, 'params', mt.params,
                    'started_at_ms', public._dojo_ms(mt.started_at), 'sim_frame', mt.sim_frame)
                    from public.fight_matches mt where mt.id = x.match_id))
      from public.martial_exams x where x.account_id = p_account and x.status in ('kata', 'spar')),
    'server_now_ms', public._dojo_ms(now()))
$$;

-- ---------- F. dojo_exam_start (0050's, verbatim but for the lines marked 0060) ----------
create or replace function public.dojo_exam_start(p_session_token text, p_style text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_style public.martial_styles; e public.martial_enrollments;
        b public.martial_belts; v_coins integer; v_bal integer; v_id uuid; v_seed bigint; v_outfit text;
        v_chart integer[];                                                               -- 0060
begin
  perform public._fx_sweep(v_account);
  perform public._dojo_sweep(v_account);
  select * into v_style from public.martial_styles where id = p_style;
  if not found then raise exception 'unknown style' using errcode = '22023'; end if;
  perform public._fx_vitals_ok(v_account);
  perform public._wallet_lock(v_account);
  select * into e from public.martial_enrollments where account_id = v_account and style = p_style for update;
  if not found then raise exception 'not enrolled' using errcode = '22023'; end if;
  if e.rank >= 4 then raise exception 'max rank' using errcode = '22023'; end if;
  select * into b from public.martial_belts where style = p_style and rank = e.rank + 1;
  if exists (select 1 from public.martial_exams where account_id = v_account and status in ('kata', 'spar')) then
    raise exception 'exam in progress' using errcode = '53400';
  end if;
  if now() < e.rank_at + make_interval(hours => b.min_hours) then raise exception 'too soon' using errcode = '53400'; end if;
  if e.exam_cooldown_until > now() then raise exception 'exam cooldown' using errcode = '53400'; end if;
  select outfit into v_outfit from public.characters where account_id = v_account;
  if v_outfit is distinct from v_style.uniform then raise exception 'no uniform' using errcode = '22023'; end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < b.exam_fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -b.exam_fee, 'dojo_exam', 'exam: ' || p_style || ' ' || (e.rank + 1));
  v_seed := floor(random() * 4294967296)::bigint;
  insert into public.martial_exams (account_id, style, target_rank, fee, kata_seed, expires_at)
  values (v_account, p_style, e.rank + 1, b.exam_fee, v_seed, now() + interval '20 minutes')
  returning id into v_id;
  v_chart := public._kata_chart(v_seed, b.kata_notes, b.kata_tpb, e.rank + 1 >= 3);     -- 0060: the seed stays here
  return jsonb_build_object('exam_id', v_id, 'kata_length', v_chart[2 * b.kata_notes - 1] + 30, 'chart', to_jsonb(public._kata_reveal(v_chart, 240)), 'notes', b.kata_notes, 'ticks_per_beat', b.kata_tpb,   -- 0060 was: return jsonb_build_object('exam_id', v_id, 'kata_seed', v_seed, 'notes', b.kata_notes, 'ticks_per_beat', b.kata_tpb,
                            'half', e.rank + 1 >= 3, 'pass_pct', b.kata_pass_pct,
                            'expires_at_ms', public._dojo_ms(now() + interval '20 minutes'), 'coins', v_bal,
                            'state', public._dojo_json(v_account), 'server_now_ms', public._dojo_ms(now()));
end $$;

-- ---------- G. dojo_kata_submit (0050's, verbatim but for the lines marked 0060) ----------
create or replace function public.dojo_kata_submit(p_session_token text, p_exam uuid, p_presses integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); ex public.martial_exams; v_style public.martial_styles;
        b public.martial_belts; e public.martial_enrollments; v_chart integer[]; v_len integer; v_bad text; v_code text;
        v_score integer[]; v_ac jsonb; v_until timestamptz; v_params jsonb; v_match uuid; v_start timestamptz;
        v_outfit text; v_notes integer; v_pass boolean; v_fail jsonb;
        v_off integer[];                                                                 -- 0060
begin
  select * into ex from public.martial_exams where id = p_exam and account_id = v_account for update;
  if not found then raise exception 'exam not found' using errcode = '22023'; end if;
  if ex.status <> 'kata' or ex.expires_at < now() then
    perform public._dojo_sweep(v_account);
    return jsonb_build_object('status', (select status from public.martial_exams where id = p_exam),
                              'state', public._dojo_json(v_account), 'server_now_ms', public._dojo_ms(now()));
  end if;
  select * into v_style from public.martial_styles where id = ex.style;
  select * into b from public.martial_belts where style = ex.style and rank = ex.target_rank;
  select * into e from public.martial_enrollments where account_id = v_account and style = ex.style for update;
  -- the uniform is checked first: nothing is consumed without it (plan ruling P8)
  select outfit into v_outfit from public.characters where account_id = v_account;
  if v_outfit is distinct from v_style.uniform then raise exception 'no uniform' using errcode = '22023'; end if;
  v_chart := public._kata_chart(ex.kata_seed, b.kata_notes, b.kata_tpb, ex.target_rank >= 3);
  v_notes := b.kata_notes;
  v_len := v_chart[2 * v_notes - 1] + 30;
  v_bad := public._kata_input_error(v_chart, p_presses);
  if v_bad is not null then v_code := 'kata_bad_input';
  elsif now() < ex.started_at + make_interval(secs => 0.95 * v_len / 60.0) then v_code := 'kata_too_fast';
  end if;
  if v_code is null then v_score := public._kata_score(v_chart, p_presses); end if;
  -- 0060 {
  -- timing without a hand's noise: soft; the 3rd within 30 days fails the attempt (hard)
  if v_code is null then
    v_off := public._kata_offsets(v_chart, p_presses);
    if public._kata_robotic(v_off) then
      perform public._ac_flag(v_account, 'kata_robotic', 'dojo_kata_submit',
                jsonb_build_object('exam', ex.id, 'style', ex.style, 'target', ex.target_rank, 'offsets', to_jsonb(v_off)),
                null, null, false);
      if (select count(*) from public.anticheat_events ev
           where ev.account_id = v_account and ev.code = 'kata_robotic' and ev.created_at > now() - interval '30 days') >= 3 then
        v_code := 'kata_robotic_repeat';
        v_bad := 'robotic';
      end if;
    end if;
  end if;
  -- 0060 }
  v_pass := v_code is null and v_score[1] * 100 >= b.kata_pass_pct * 2 * v_notes;
  update public.martial_exams set kata_score = v_score[1] where id = ex.id;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'dojo_kata_submit',
              jsonb_build_object('exam', ex.id, 'style', ex.style, 'target', ex.target_rank, 'error', coalesce(v_bad, 'pace'),
                                 'started_at', ex.started_at, 'submitted_at', now(), 'chart_ticks', v_len,
                                 'presses', coalesce(cardinality(p_presses), 0) / 2, 'head', to_jsonb(p_presses[1:200])));
  elsif v_notes >= 24 and v_score[4] = 0 and v_score[6] <= 1 then
    perform public._ac_flag(v_account, 'kata_perfect', 'dojo_kata_submit',
              jsonb_build_object('exam', ex.id, 'style', ex.style, 'target', ex.target_rank, 'notes', v_notes,
                                 'score', to_jsonb(v_score)), null, null, false);
  end if;
  if not v_pass then
    v_until := now() + make_interval(mins => b.fail_cooldown_min);
    update public.martial_exams set status = 'failed' where id = ex.id;
    update public.martial_enrollments set exam_cooldown_until = v_until where account_id = v_account and style = ex.style;
    v_fail := jsonb_build_object('passed', false, 'score', to_jsonb(v_score), 'max', 2 * v_notes, 'pass_pct', b.kata_pass_pct,
                                 'cooldown_until_ms', public._dojo_ms(v_until), 'state', public._dojo_json(v_account),
                                 'server_now_ms', public._dojo_ms(now()));
    return v_fail || coalesce(v_ac, '{}'::jsonb);
  end if;
  -- the sparring match: me at my rank's unlocks, the master at the target rank's, 3 rounds, frame 0 in 8 s
  v_params := jsonb_build_object('seed', 0, 'secretBot', true, 'rounds', 3, 'maxRounds', 5,   -- 0060 was: v_params := jsonb_build_object('seed', floor(random() * 4294967296)::bigint, 'rounds', 3, 'maxRounds', 5,
    'p1', jsonb_build_object('style', v_style.sort, 'rank', e.rank, 'movesMask', (1 << (e.rank + 1)) - 1, 'hpPct', 100,
                             'bot', 0, 'en0', 0, 'atk', v_style.atk, 'def', v_style.def, 'walk', v_style.walk,
                             'jump', v_style.jump, 'energy', v_style.energy),
    'p2', jsonb_build_object('style', v_style.sort, 'rank', ex.target_rank, 'movesMask', (1 << (ex.target_rank + 1)) - 1,
                             'hpPct', 100, 'bot', b.bot_level, 'en0', 0, 'atk', v_style.atk, 'def', v_style.def,
                             'walk', v_style.walk, 'jump', v_style.jump, 'energy', v_style.energy));
  v_start := now() + interval '8 seconds';
  insert into public.fight_matches (kind, p1, p2, params, ref, started_at, sim)
  values ('exam', v_account, null, v_params, ex.id::text, v_start, public._fx_new(v_params))
  returning id into v_match;
  update public.fight_matches set sim_hash = public._fx_hash(sim) where id = v_match;
  insert into public.fight_logs (match_id, side, account_id) values (v_match, 1, v_account);
  update public.martial_exams set status = 'spar', match_id = v_match where id = ex.id;
  return jsonb_build_object('passed', true, 'score', to_jsonb(v_score), 'max', 2 * v_notes, 'pass_pct', b.kata_pass_pct,
                            'match', jsonb_build_object('id', v_match, 'params', v_params, 'started_at_ms', public._dojo_ms(v_start)),
                            'state', public._dojo_json(v_account), 'server_now_ms', public._dojo_ms(now()));
end $$;

-- ---------- H. ug_ladder_start (0052's, verbatim but for the lines marked 0060) ----------
create or replace function public.ug_ladder_start(p_room_id uuid, p_session_token text, p_floor integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_auth(p_room_id, p_session_token); b public.ug_bosses; st public.martial_styles; s jsonb;
        p public.ug_profiles; v_coins integer; v_busy text; v_season integer := public._ug_season(); v_params jsonb;
        v_sbr jsonb; v_match uuid; v_start timestamptz;
begin
  if p_floor is null or p_floor not between 1 and 10 then raise exception 'bad floor' using errcode = '22023'; end if;
  perform public._ug_sweep_room(p_room_id);
  perform public._fx_sweep(v_account);
  select * into b from public.ug_bosses where floor = p_floor;
  s := public._fx_style_of(v_account);
  perform public._fx_vitals_ok(v_account);
  v_busy := public._ug_busy(v_account);
  if v_busy is not null then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', v_busy); end if;
  if p_floor > 1 and not exists (select 1 from public.ug_ladder where account_id = v_account and season = v_season
                                     and floor = p_floor - 1 and cleared_at is not null) then
    return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'floor locked');
  end if;
  p := public._ug_profile(v_account);
  if p.ladder_today >= 6 then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'daily ug limit'); end if;
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < b.entry then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'not enough xu'); end if;
  perform public._pay(v_account, -b.entry, 'ug_entry', 'ug tầng ' || p_floor);
  update public.ug_profiles set ladder_today = ladder_today + 1 where account_id = v_account;
  insert into public.ug_ladder (account_id, season, floor, attempts) values (v_account, v_season, p_floor, 1)
  on conflict (account_id, season, floor) do update set attempts = public.ug_ladder.attempts + 1;
  select * into st from public.martial_styles where id = b.style;
  select jsonb_agg(ms.sort order by x.o) into v_sbr
    from unnest(b.style_by_round) with ordinality x(sid, o) join public.martial_styles ms on ms.id = x.sid;
  v_params := jsonb_build_object('seed', 0, 'secretBot', true, 'rounds', 3, 'maxRounds', 5,   -- 0060 was: v_params := jsonb_build_object('seed', floor(random() * 4294967296)::bigint, 'rounds', 3, 'maxRounds', 5,
    'p1', jsonb_build_object('style', (s->>'idx')::int, 'rank', (s->>'rank')::int, 'movesMask', (1 << ((s->>'rank')::int + 1)) - 1,
                             'hpPct', 100, 'bot', 0, 'en0', 0, 'atk', (s->>'atk')::int, 'def', (s->>'def')::int,
                             'walk', (s->>'walk')::int, 'jump', (s->>'jump')::int, 'energy', (s->>'energy')::int),
    'p2', jsonb_build_object('style', st.sort, 'rank', 4, 'movesMask', 31, 'hpPct', b.hp_pct, 'bot', b.level, 'en0', 0,
                             'atk', st.atk, 'def', st.def, 'walk', st.walk, 'jump', st.jump, 'energy', st.energy));
  if v_sbr is not null then v_params := jsonb_set(v_params, '{p2,styleByRound}', v_sbr); end if;
  v_start := now() + interval '8 seconds';
  insert into public.fight_matches (room_id, kind, p1, p2, params, entry, ref, started_at, sim)
  values (p_room_id, 'ug_ladder', v_account, null, v_params, b.entry, p_floor::text, v_start, public._fx_new(v_params))
  returning id into v_match;
  update public.fight_matches set sim_hash = public._fx_hash(sim) where id = v_match;
  insert into public.fight_logs (match_id, side, account_id) values (v_match, 1, v_account);
  return public._ug_json(p_room_id, v_account) || jsonb_build_object('ok', true, 'match', jsonb_build_object(
    'id', v_match, 'kind', 'ug_ladder', 'params', v_params, 'started_at_ms', public._dojo_ms(v_start), 'side', 1,
    'entry', b.entry, 'floor', p_floor));
end $$;

-- ---------- I. fight_push (0052's, verbatim but for the lines marked 0060) ----------
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
    for k in 1..v_len loop
      v_face := s[49 + 4];
      v_prev := s[49 + 19];
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
revoke all on function public.dojo_exam_start(text, text) from public;
revoke all on function public.dojo_kata_submit(text, uuid, integer[]) from public;
revoke all on function public.ug_ladder_start(uuid, text, integer) from public;
revoke all on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) from public;
grant execute on function public.dojo_exam_start(text, text) to anon, authenticated;
grant execute on function public.dojo_kata_submit(text, uuid, integer[]) to anon, authenticated;
grant execute on function public.ug_ladder_start(uuid, text, integer) to anon, authenticated;
grant execute on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) to anon, authenticated;