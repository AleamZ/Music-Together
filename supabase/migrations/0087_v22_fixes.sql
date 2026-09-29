-- =========================================================
-- 0087_v22_fixes.sql — the v22 review fixes (.superpowers/v22-fixlist.md, .local-agent-tasks/review-v22-*.result.md).
-- ADDITIVE and re-runnable. Run after 0086. Every function re-created here is the NEWEST definition (0072 / 0078 / 0083 /
-- 0084 / 0085 / 0086) copied verbatim but for the lines marked "-- 0087" (a block "-- 0087 {" … "-- 0087 }").
--
-- CROSS-CUTTING — no minigame hands its outcome to the client any more. Before 0087 every v22 *_start (and 0072's
-- mine_start) returned the round's 32-bit seed: the client re-derived the whole round from it, so a bot could compute the
-- perfect inputs at once (and a 32-bit mulberry seed is brute-forced from a few revealed values, so no "reveal part of a
-- seed-derived round" would do). Now:
--   A. The round's secret parameters are rolled one by one with random() (the same distributions as the _X_round(seed)
--      of 0072/0083–0086, which stay as the fixtures' reference) and kept on the server in public.mg_live. The seed
--      columns of the round tables still get a random value nobody reads.
--   B. mg_sync(token, game, a[], b[]) — the one live RPC of every minigame (like 0060's dojo_kata_notes, polled every
--      ~0.2 s by the client): the FIRST call starts the round's clock (clock_timestamp: the client's tick 0 is when that
--      answer arrives); every call stamps the inputs made since the last one with the server's time (an input list may
--      only grow, and never ahead of the server's tick + 6) and answers the events revealed so far. An event is revealed
--      from its tick `at` on, i.e. a bounded time before it matters (0.5–2 s: the arrows, the drift, the grains, the
--      treats, the strokes, the trail), and its first reveal time is recorded (mg_live.seen). A "gate" (the hunt's and
--      the photo's animal, the anvil's glow, the power meter's sweet spot, a dig's next vein) is revealed at a secret
--      tick (0.3–1 s in) or — a vein — when the strike that uncovers it has been stamped.
--   C. Every *_finish takes the live row (single use), stamps the inputs not yet synced, and refuses:
--      - an input list that rewrote a synced one, or ran ahead of the server's clock → the hard <x>_bad_input
--        ('rewrite' / 'future' / …);
--      - an input claimed less than 0.1 s after the reveal of the gate it acts on (or with the gate never revealed) —
--        a human cannot react before seeing it → hard <x>_bad_input 'early';
--      - an input stamped more than 2 s after the time it claims (the client did not play live: a replay computed after
--        the fact) → the soft <x>_late and the round is void (no reward; a legit client syncs every 0.2 s).
--      So a start answer holds nothing to precompute with; the future is known at most a bounded time ahead, and the
--      inputs have to be committed while the round runs. tests/sql/v22-fixes-smoke.sql plays the attack.
--   Games: world (hunt | trap | photo | combo), brew, anvil, sort, care (feed | pat | play), row, dig (treasure), mine
--   (0072's dig) and press (the battle's power meter: battle_press_open starts it, battle_act_press is its finish).
--   The parameter-driven sims (_wg_hunt_u, _wg_trap_u, _wg_photo_u, _wg_combo_u, _brew_replay_p, _anvil_replay_p,
--   _sort_replay_p, _pcare_*_p, _ppress_*_p, _row_replay_p, _mine_replay_p, _mine_timing_p) are the old seed sims
--   statement for statement with the rolled parameters given (the smoke checks both agree on every fixture);
--   lib/game/*/ mirror them as *From(params) functions.
-- The review findings (verified against the code; the rejected ones are in .superpowers/v22-fixes-report.md):
--   D. world  — combo_finish: the round must reach its end tick (p_ticks = end; no early finish that skips the slam);
--               the soft combo_timing also fires for six "perfect" arrows with one steady offset (±1 tick).
--   E. craft  — brew/upgrade/process_sort finish: the position, then the wallet, then the round (the start's order: no
--               start/finish deadlock); sort_timing from 11 right (the full 5 %) instead of 12; anvil_timing also for five
--               strikes on one steady offset from the peak (±1 tick).
--   F. pets   — pet_care_start / _finish serialize on the account row (the 1 s start limit held under concurrency);
--               battle_act_press: the meter runs from battle_press_open's first sync, not from the turn's acted_at, and
--               _battle_json no longer shows a press seed.
--   G. explore — treasure_dig_finish always replays the strikes and checks the time (a give-up too); the chest is rolled
--               ONCE per map (treasure_maps.dig_loot), so neither a give-up nor a restart re-rolls the jackpot;
--               the wallet first in treasure_dig_finish (the start's order); a failed row home drifts like a row out,
--               and each failed row home lowers the next one's need by 2 (6 → 4 → 2 → 0: never stranded, but no free
--               ride home by a deliberate miss).
-- Codes: <x>_late (soft) for x in wild, combo, brew, anvil, sort, pet_care, battle_press, row, treasure, mine.
-- Events: unchanged. Ledger reasons: unchanged.
-- NOTE (tests/sql/README.md): the v22 group smokes and v21-crafting / v21-fixes re-apply 0072 / 0078 / 0083–0086 (the
-- seed-returning bodies): re-apply 0087 after them.
-- =========================================================

-- ---------- A. The live rounds ----------
create table if not exists public.mg_live (
  account_id uuid not null references public.accounts(id) on delete cascade,
  game text not null check (game in ('world', 'brew', 'anvil', 'sort', 'care', 'row', 'dig', 'mine', 'press')),
  kind text not null,                  -- world: hunt | trap | photo | combo; care: feed | pat | play; row: out | home
  params bigint[] not null,            -- the secret round (rolled with random())
  gate integer not null default 0,     -- the tick the gate is revealed at (hunt, photo, anvil, press, dig, mine)
  meta jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  started_at timestamptz,              -- the first mg_sync: tick 0
  a integer[] not null default '{}',   -- the inputs, as the finish RPC takes them, and their server stamps
  a_at timestamptz[] not null default '{}',
  b integer[] not null default '{}',
  b_at timestamptz[] not null default '{}',
  seen timestamptz[] not null default '{}',  -- seen[i]: event i's first reveal
  syncs integer not null default 0,
  primary key (account_id, game)
);
alter table public.mg_live enable row level security;
revoke all on public.mg_live from anon, authenticated;

-- n independent 32-bit draws (the u of _wg_draws, without a seed to brute-force).
create or replace function public._mg_u(p_n integer) returns bigint[]
language sql volatile
as $$ select coalesce(array_agg(floor(random() * 4294967296)::bigint), '{}') from generate_series(1, p_n) $$;

-- Open (replace) the live round of a game.
create or replace function public._mg_open(p_account uuid, p_game text, p_kind text, p_params bigint[], p_gate integer,
                                           p_meta jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.mg_live (account_id, game, kind, params, gate, meta, opened_at, started_at, a, a_at, b, b_at, seen, syncs)
  values (p_account, p_game, p_kind, p_params, coalesce(p_gate, 0), coalesce(p_meta, '{}'::jsonb), now(), null, '{}', '{}',
          '{}', '{}', array_fill(null::timestamptz, array[24]), 0)
  on conflict (account_id, game) do update
    set kind = excluded.kind, params = excluded.params, gate = excluded.gate, meta = excluded.meta, opened_at = excluded.opened_at,
        started_at = null, a = '{}', a_at = '{}', b = '{}', b_at = '{}', seen = excluded.seen, syncs = 0;
end $$;

-- An input value's tick: the combo's keys are tick·4 + dir, the feed / pat moves tick·8 + lane, the strokes tick·2 + side,
-- the sorts tick·2 + basket.
create or replace function public._mg_tick(p_game text, p_kind text, p_ch integer, p_v integer) returns integer
language sql immutable parallel safe
as $$ select case when p_ch = 1 and p_kind = 'combo' then p_v / 4
                  when p_ch = 1 and p_kind in ('feed', 'pat') then p_v / 8
                  when p_ch = 1 and p_game in ('row', 'sort') then p_v / 2
                  else p_v end $$;

-- Grow a stamped list: p_new must start with the stamped list; the new values are stamped p_now and may not be ahead of
-- the server's tick p_e (+ 6). o_err: rewrite | future | range | shape | too_many.
create or replace function public._mg_append(p_old integer[], p_old_at timestamptz[], p_new integer[], p_game text, p_kind text,
                                             p_ch integer, p_e integer, p_now timestamptz,
                                             out o_list integer[], out o_at timestamptz[], out o_err text)
language plpgsql immutable
as $$
declare n_old integer := coalesce(cardinality(p_old), 0); n integer := coalesce(cardinality(p_new), 0);
begin
  o_list := coalesce(p_old, '{}');
  o_at := coalesce(p_old_at, '{}');
  if p_new is null then return; end if;
  if n > 200 then o_err := 'too_many'; return; end if;
  if n > 0 and (array_ndims(p_new) <> 1 or array_lower(p_new, 1) <> 1) then o_err := 'shape'; return; end if;
  if n < n_old or (n_old > 0 and p_new[1:n_old] is distinct from o_list) then o_err := 'rewrite'; return; end if;
  for i in n_old + 1 .. n loop
    if p_new[i] is null or p_new[i] < 0 then o_err := 'range'; return; end if;
    if p_e is not null and public._mg_tick(p_game, p_kind, p_ch, p_new[i]) > p_e + 6 then o_err := 'future'; return; end if;
    o_list := o_list || p_new[i];
    o_at := o_at || p_now;
  end loop;
end $$;

-- The round's events, all of them: [{i, at (the tick it is revealed from; null = not yet), d}] (lib/game/mglive.ts).
create or replace function public._mg_events(l public.mg_live) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare u bigint[] := l.params; o jsonb := '[]'::jsonb; sp text := l.meta->>'species'; per integer; ph integer; v_chg integer;
        mul integer; tv integer[] := array[-3, 0, 0, 4, 5, 6, 7, 8]; s integer := 0; len integer; b integer; slam integer;
        k integer; need integer; win integer; hits integer := 0; t integer; pose integer;
begin
  if l.game = 'world' and l.kind = 'hunt' then
    per := ((150 + u[1] % 91) * 100) / public._wg_speed(sp);
    ph := (u[2] % per)::int;
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('period', per, 'phase', ph, 'wind', (u[3] % 121) - 60));
    if (l.meta->>'danger')::boolean then
      v_chg := (150 + u[5] % 151)::int;
      o := o || jsonb_build_object('i', 2, 'at', v_chg - 60, 'd', jsonb_build_object('charge', v_chg));
    end if;
  elsif l.game = 'world' and l.kind = 'trap' then
    mul := case when public._wg_speed(sp) >= 150 then 3 else 2 end;
    for i in 0 .. 7 loop
      len := (30 + u[2 * i + 1] % 41)::int;
      o := o || jsonb_build_object('i', i + 1, 'at', s - 30,
                                   'd', jsonb_build_object('len', len, 'v', (tv[(u[2 * i + 2] % 8)::integer + 1] * mul) / 2));
      s := s + len;
    end loop;
  elsif l.game = 'world' and l.kind = 'photo' then
    per := ((180 + u[1] % 121) * 100) / public._wg_speed(sp);
    pose := (150 + u[3] % 91)::int;
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('period', per, 'phase', u[2] % per, 'pose', pose,
                                                                                  'pose_at', u[4] % pose));
  elsif l.game = 'world' and l.kind = 'combo' then
    b := (90 + u[1] % 31)::int;
    for j in 0 .. 5 loop
      if j > 0 then b := b + (54 + u[2 * j + 1] % 19)::int; end if;
      o := o || jsonb_build_object('i', j + 1, 'at', b - 120, 'd', jsonb_build_object('beat', b, 'dir', u[2 * j + 2] % 4));
    end loop;
    k := 1 + (u[13] % 3)::integer;
    slam := ((o->k->'d'->>'beat')::int) + 27;
    o := o || jsonb_build_object('i', 7, 'at', slam - 90, 'd', jsonb_build_object('slam', slam));
  elsif l.game = 'brew' then
    for i in 1 .. 20 loop
      o := o || jsonb_build_object('i', i, 'at', 30 * (i - 1) - 60, 'd', jsonb_build_object('drift', u[i + 1]));
    end loop;
  elsif l.game = 'anvil' then
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('period', u[1], 'phase', u[2]));
  elsif l.game = 'sort' then
    for i in 1 .. 12 loop
      o := o || jsonb_build_object('i', i, 'at', 40 + 45 * (i - 1) - 60, 'd', jsonb_build_object('kind', u[i]));
    end loop;
  elsif l.game = 'care' and l.kind = 'feed' then
    for i in 1 .. 12 loop
      o := o || jsonb_build_object('i', i, 'at', 30 + 40 * (i - 1) - 30, 'd', jsonb_build_object('lane', u[i]));
    end loop;
  elsif l.game = 'care' and l.kind = 'pat' then
    for i in 1 .. 5 loop
      o := o || jsonb_build_object('i', i, 'at', 30 + 100 * (i - 1) - 30, 'd', jsonb_build_object('like', u[i]));
    end loop;
  elsif l.game = 'care' and l.kind = 'play' then
    for i in 1 .. 8 loop
      o := o || jsonb_build_object('i', i, 'at', 20 + 100 * (i - 1) - 30, 'd', jsonb_build_object('flight', u[i]));
    end loop;
  elsif l.game = 'row' then
    for i in 1 .. 12 loop
      o := o || jsonb_build_object('i', i, 'at', u[i] - 90, 'd', jsonb_build_object('t', u[i], 'side', u[i + 12]));
    end loop;
  elsif l.game = 'press' then
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('centre', u[2]));
  elsif l.game in ('dig', 'mine') then
    -- vein 1 at the gate; vein j + 1 once the strike that hit vein j is stamped (a stamped strike is at a tick ≤ now)
    need := cardinality(u) - 1;
    win := (l.meta->>'win')::int;
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('c', u[2]));
    foreach t in array l.a loop
      exit when hits >= need;
      if abs(public._mine_pos(u[1]::int, t) - u[hits + 2]) <= win then
        hits := hits + 1;
        if hits < need then
          o := o || jsonb_build_object('i', hits + 1, 'at', greatest(t, l.gate), 'd', jsonb_build_object('c', u[hits + 2]));
        end if;
      end if;
    end loop;
  end if;
  return o;
end $$;

-- The live RPC (B): stamp my new inputs, answer {t (the server's tick), ev [{i, d}] (every event revealed so far)}.
create or replace function public.mg_sync(p_session_token text, p_game text, p_a integer[] default null, p_b integer[] default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid := public._ac_account(p_session_token); l public.mg_live; v_now timestamptz := clock_timestamp(); e integer;
        r record; x jsonb; v_out jsonb := '[]'::jsonb; v_i integer;
begin
  select * into l from public.mg_live where account_id = v_acc and game = p_game for update;
  if not found or l.opened_at < now() - interval '10 minutes' then raise exception 'round not found' using errcode = '22023'; end if;
  if l.syncs >= 600 then raise exception 'too many syncs' using errcode = '53400'; end if;
  l.started_at := coalesce(l.started_at, v_now);
  e := floor(extract(epoch from v_now - l.started_at) * 60)::integer;
  select * into r from public._mg_append(l.a, l.a_at, p_a, l.game, l.kind, 1, e, v_now);
  if r.o_err is not null then raise exception 'bad inputs' using errcode = '22023', detail = r.o_err; end if;
  l.a := r.o_list;
  l.a_at := r.o_at;
  select * into r from public._mg_append(l.b, l.b_at, p_b, l.game, l.kind, 2, e, v_now);
  if r.o_err is not null then raise exception 'bad inputs' using errcode = '22023', detail = r.o_err; end if;
  l.b := r.o_list;
  l.b_at := r.o_at;
  for x in select * from jsonb_array_elements(public._mg_events(l)) loop
    continue when x->>'at' is null or (x->>'at')::int > e;
    v_i := (x->>'i')::int;
    if l.seen[v_i] is null then l.seen[v_i] := v_now; end if;
    v_out := v_out || jsonb_build_object('i', v_i, 'd', x->'d');
  end loop;
  update public.mg_live set started_at = l.started_at, a = l.a, a_at = l.a_at, b = l.b, b_at = l.b_at, seen = l.seen,
                            syncs = syncs + 1
   where account_id = v_acc and game = p_game;
  return jsonb_build_object('t', e, 'ev', v_out);
end $$;

-- The finish's take (C): the live row (single use) with the inputs not yet synced stamped now; meta.err on a bad list
-- ('kind' when the row belongs to another round kind). Null (no row) when the round was never opened.
create or replace function public._mg_close(p_account uuid, p_game text, p_kind text, p_a integer[], p_b integer[])
returns public.mg_live
language plpgsql security definer set search_path = public, extensions
as $$
declare l public.mg_live; v_now timestamptz := clock_timestamp(); e integer; r record; v_err text;
begin
  delete from public.mg_live where account_id = p_account and game = p_game returning * into l;
  if not found then return null; end if;
  if l.kind is distinct from p_kind then
    l.meta := l.meta || jsonb_build_object('err', 'kind');
    return l;
  end if;
  e := case when l.started_at is null then null else floor(extract(epoch from v_now - l.started_at) * 60)::integer end;
  select * into r from public._mg_append(l.a, l.a_at, coalesce(p_a, '{}'), l.game, l.kind, 1, e, v_now);
  v_err := r.o_err;
  l.a := r.o_list;
  l.a_at := r.o_at;
  if v_err is null then
    select * into r from public._mg_append(l.b, l.b_at, coalesce(p_b, '{}'), l.game, l.kind, 2, e, v_now);
    v_err := r.o_err;
    l.b := r.o_list;
    l.b_at := r.o_at;
  end if;
  if v_err is not null then l.meta := l.meta || jsonb_build_object('err', v_err); end if;
  return l;
end $$;

-- Late (C): an input stamped more than 2 s after the time it claims, or inputs on a round whose clock never started.
create or replace function public._mg_late(l public.mg_live) returns boolean
language plpgsql immutable
as $$
begin
  if coalesce(cardinality(l.a), 0) + coalesce(cardinality(l.b), 0) = 0 then return false; end if;
  if l.started_at is null then return true; end if;
  for i in 1 .. coalesce(cardinality(l.a), 0) loop
    if l.a_at[i] > l.started_at + make_interval(secs => public._mg_tick(l.game, l.kind, 1, l.a[i]) / 60.0 + 2) then return true; end if;
  end loop;
  for i in 1 .. coalesce(cardinality(l.b), 0) loop
    if l.b_at[i] > l.started_at + make_interval(secs => public._mg_tick(l.game, l.kind, 2, l.b[i]) / 60.0 + 2) then return true; end if;
  end loop;
  return false;
end $$;

-- Early (C): an input tick claimed less than 0.1 s after the gate's reveal (or the gate never revealed).
create or replace function public._mg_early(p_started timestamptz, p_ticks integer[], p_seen timestamptz) returns boolean
language sql immutable
as $$ select coalesce(cardinality(p_ticks), 0) > 0
             and (p_seen is null or p_started is null
                  or exists (select 1 from unnest(p_ticks) t
                              where p_started + make_interval(secs => t / 60.0) < p_seen + interval '100 milliseconds')) $$;

-- The dig's strikes (mine and treasure): each strike claimed ≥ 0.1 s after its vein's reveal (the vein it aims at is the
-- one after the hits so far).
create or replace function public._mg_dig_early(l public.mg_live, p_win integer) returns boolean
language plpgsql immutable
as $$
declare u bigint[] := l.params; need integer := cardinality(l.params) - 1; hits integer := 0; t integer;
begin
  if coalesce(cardinality(l.a), 0) = 0 then return false; end if;
  if l.started_at is null then return true; end if;
  foreach t in array l.a loop
    exit when hits >= need;
    if l.seen[hits + 1] is null or l.started_at + make_interval(secs => t / 60.0) < l.seen[hits + 1] + interval '100 milliseconds' then
      return true;
    end if;
    if abs(public._mine_pos(u[1]::int, t) - u[hits + 2]) <= p_win then hits := hits + 1; end if;
  end loop;
  return false;
end $$;

revoke all on function public._mg_u(integer) from public, anon, authenticated;
revoke all on function public._mg_open(uuid, text, text, bigint[], integer, jsonb) from public, anon, authenticated;
revoke all on function public._mg_tick(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public._mg_append(integer[], timestamptz[], integer[], text, text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._mg_events(public.mg_live) from public, anon, authenticated;
revoke all on function public._mg_close(uuid, text, text, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._mg_late(public.mg_live) from public, anon, authenticated;
revoke all on function public._mg_early(timestamptz, integer[], timestamptz) from public, anon, authenticated;
revoke all on function public._mg_dig_early(public.mg_live, integer) from public, anon, authenticated;
revoke all on function public.mg_sync(text, text, integer[], integer[]) from public;
grant execute on function public.mg_sync(text, text, integer[], integer[]) to anon, authenticated;

-- ---------- The parameter-driven sims (the seed sims statement for statement, the round given) ----------
-- _wg_hunt (0083's) with its 5 draws given
create or replace function public._wg_hunt_u(p_u bigint[], p_species text, p_danger boolean, p_shots integer[], p_dodges integer[])
returns jsonb
language plpgsql immutable parallel safe
as $$
declare u bigint[] := p_u; per integer; ph integer; wind integer; ret integer; chg integer;                -- 0087
        v_dodged boolean; cend integer; used integer := 0; s integer; land integer; err integer;
begin
  per := ((150 + u[1] % 91) * 100) / public._wg_speed(p_species);
  ph := u[2] % per;
  wind := (u[3] % 121) - 60;
  ret := 100 + u[4] % 41;
  chg := 150 + u[5] % 151;
  v_dodged := not p_danger or exists (select 1 from unnest(coalesce(p_dodges, '{}'::integer[])) d where d between chg - 24 and chg);
  cend := case when v_dodged then null else chg end;
  foreach s in array coalesce(p_shots, '{}'::integer[]) loop
    exit when cend is not null and s >= cend;
    used := used + 1;
    land := s + 20;
    exit when cend is not null and land > cend;
    err := abs(public._wg_tri(ret, s) + wind - (100 + (public._wg_tri(per, land + ph) * 8) / 10));
    if err <= 70 then
      return jsonb_build_object('outcome', 'hit', 'ticks', land + 1, 'score', 1000 - (err * 600) / 70, 'used', used,
                                'dodged', p_danger and v_dodged);
    end if;
    if used >= 3 then
      return jsonb_build_object('outcome', 'miss', 'ticks', land + 1, 'score', 0, 'used', used, 'dodged', p_danger and v_dodged);
    end if;
  end loop;
  if cend is not null then
    return jsonb_build_object('outcome', 'charged', 'ticks', cend + 1, 'score', 0, 'used', used, 'dodged', false);
  end if;
  return jsonb_build_object('outcome', 'open', 'ticks', null, 'score', 0, 'used', used, 'dodged', p_danger);
end $$;

-- _wg_trap (0083's) with its 16 draws given
create or replace function public._wg_trap_u(p_u bigint[], p_species text, p_pulls integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare mul integer := case when public._wg_speed(p_species) >= 150 then 3 else 2 end; u bigint[] := p_u;   -- 0087
        tv integer[] := array[-3, 0, 0, 4, 5, 6, 7, 8]; lens integer[] := '{}'; vs integer[] := '{}'; zone integer; tail integer;
        x integer := 0; seg integer := 1; v_left integer; v integer; esc integer; at_pull integer; pull integer; d integer;
begin
  zone := case when mul = 3 then 60 else 40 end;
  tail := 3 * mul;
  for i in 0 .. 7 loop
    lens := lens || (30 + u[2 * i + 1] % 41)::integer;
    vs := vs || ((tv[(u[2 * i + 2] % 8)::integer + 1] * mul) / 2);
  end loop;
  pull := case when coalesce(cardinality(p_pulls), 0) > 0 then p_pulls[1] end;
  if pull = 0 then at_pull := 0; end if;
  v_left := lens[1];
  for t in 1 .. 900 loop
    while seg <= 8 and v_left <= 0 loop
      seg := seg + 1;
      v_left := case when seg <= 8 then lens[seg] else 0 end;
    end loop;
    v := case when seg <= 8 then vs[seg] else tail end;
    v_left := v_left - 1;
    x := least(1000, greatest(0, x + v));
    if t = pull then at_pull := x; end if;
    if x = 1000 and esc is null then esc := t; end if;
    exit when esc is not null and (pull is null or t >= pull);
  end loop;
  if pull is not null and (esc is null or pull < esc) then
    d := abs(at_pull - 500);
    if d <= zone then
      return jsonb_build_object('outcome', 'caught', 'ticks', pull + 1, 'score', 1000 - (d * 600) / zone, 'used', 1, 'dodged', false);
    end if;
    return jsonb_build_object('outcome', 'miss', 'ticks', pull + 1, 'score', 0, 'used', 1, 'dodged', false);
  end if;
  if esc is not null then
    return jsonb_build_object('outcome', 'escaped', 'ticks', esc + 1, 'score', 0, 'used', 0, 'dodged', false);
  end if;
  return jsonb_build_object('outcome', 'open', 'ticks', null, 'score', 0, 'used', 0, 'dodged', false);
end $$;

-- _wg_photo (0083's) with its 4 draws given
create or replace function public._wg_photo_u(p_u bigint[], p_species text, p_snaps integer[], p_zooms integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare u bigint[] := p_u; per integer; ph integer; pose integer; pat integer; s integer;                   -- 0087
        used integer := 0; best integer := 0; zoom boolean; tol integer; c integer; sc integer;
begin
  per := ((180 + u[1] % 121) * 100) / public._wg_speed(p_species);
  ph := u[2] % per;
  pose := 150 + u[3] % 91;
  pat := u[4] % pose;
  foreach s in array coalesce(p_snaps, '{}'::integer[]) loop
    used := used + 1;
    zoom := (select count(*) from unnest(coalesce(p_zooms, '{}'::integer[])) z where z <= s) % 2 = 1;
    tol := case when zoom then 180 else 360 end;
    c := abs(public._wg_tri(per, s + ph) - 500);
    sc := 0;
    if c <= tol then
      sc := ((600 - (c * 600) / tol) * case when zoom then 100 else 70 end) / 100
          + case when (s + pat) % pose < 30 then case when zoom then 400 else 280 end else 0 end;
    end if;
    best := greatest(best, sc);
    if used >= 3 then
      return jsonb_build_object('outcome', 'done', 'ticks', s + 1, 'score', best, 'used', used, 'dodged', false);
    end if;
  end loop;
  return jsonb_build_object('outcome', 'open', 'ticks', null, 'score', best, 'used', used, 'dodged', false);
end $$;

-- _wg_combo (0083's) with its 13 draws given; + 'offs' (the signed offsets of the right-direction arrows, in key order)
create or replace function public._wg_combo_u(p_u bigint[], p_keys integer[], p_dodges integer[], p_ticks integer) returns jsonb
language plpgsql immutable parallel safe
as $$
declare u bigint[] := p_u; beats integer[] := '{}'; dirs integer[] := '{}'; b integer; k integer;           -- 0087
        slam integer; v_end integer; judges text[] := array_fill('miss'::text, array[6]); done boolean[] := array_fill(false, array[6]);
        streaks integer[] := array_fill(0, array[6]); streak integer := 0; best integer := 0; perfect integer := 0; good integer := 0;
        exact integer := 0; key integer; t integer; dir integer; i integer; dt integer; v_dodged boolean;
        offs integer[] := '{}';                                                                          -- 0087
begin
  b := 90 + (u[1] % 31)::integer;
  for j in 0 .. 5 loop
    if j > 0 then b := b + 54 + (u[2 * j + 1] % 19)::integer; end if;
    beats := beats || b;
    dirs := dirs || (u[2 * j + 2] % 4)::integer;
  end loop;
  k := 1 + (u[13] % 3)::integer;
  slam := beats[k + 1] + 27;
  v_end := beats[6] + 11;
  foreach key in array coalesce(p_keys, '{}'::integer[]) loop
    t := key / 4;
    dir := key % 4;
    exit when t >= p_ticks;
    i := null;
    for j in 1 .. 6 loop
      if not done[j] and abs(t - beats[j]) <= 10 then i := j; exit; end if;
    end loop;
    if i is null then streak := 0; continue; end if;
    done[i] := true;
    dt := abs(t - beats[i]);
    if dir <> dirs[i] then streak := 0; continue; end if;
    offs := offs || (t - beats[i]);                                                                      -- 0087
    if dt <= 1 then exact := exact + 1; end if;
    if dt <= 3 then judges[i] := 'perfect'; perfect := perfect + 1; else judges[i] := 'good'; good := good + 1; end if;
    streak := streak + 1;
    streaks[i] := streak;
    best := greatest(best, streak);
  end loop;
  v_dodged := slam >= p_ticks or exists (select 1 from unnest(coalesce(p_dodges, '{}'::integer[])) d
                                          where d between slam - 20 and slam and d < p_ticks);
  return jsonb_build_object('judges', to_jsonb(judges), 'streaks', to_jsonb(streaks), 'perfect', perfect, 'good', good,
                            'best', best, 'dodged', v_dodged, 'exact', exact, 'slam', slam, 'end', v_end,
                            'offs', to_jsonb(offs));                                                     -- 0087
end $$;

-- _brew_replay (0084's) with the round given
create or replace function public._brew_replay_p(p_rd integer[], p_toggles integer[]) returns integer
language plpgsql immutable parallel safe
as $$
declare rd integer[] := p_rd; h integer := 200; fan boolean := false; k integer := 1;                    -- 0087
        n integer := coalesce(cardinality(p_toggles), 0); score integer := 0;
begin
  for t in 0 .. 599 loop
    if k <= n and p_toggles[k] = t then fan := not fan; k := k + 1; end if;
    h := least(1000, greatest(0, h + case when fan then 7 else -4 end + rd[2 + t / 30]));
    if abs(h - rd[1]) <= 120 then score := score + 1; end if;
  end loop;
  return score;
end $$;

-- _anvil_replay (0084's) with the round given; + 'spread' (the strikes' offsets from the glow's peak, max − min, in
-- half-ticks; null under 5 strikes)
create or replace function public._anvil_replay_p(p_rd integer[], p_strikes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := p_rd; tol integer; g integer; s integer; score integer := 0; exact integer := 0;      -- 0087
        n integer := coalesce(cardinality(p_strikes), 0);
        o integer; lo integer; hi integer;                                                               -- 0087
begin
  tol := 1000 - ceil(2000.0 / rd[1])::integer;
  foreach s in array coalesce(p_strikes, '{}'::integer[]) loop
    g := public._mine_pos(rd[1], s + rd[2]);
    score := score + case when g >= 880 then 2 when g >= 700 then 1 else 0 end;
    if g >= tol then exact := exact + 1; end if;
    o := 2 * ((s + rd[2]) % rd[1]) - rd[1];                                                              -- 0087
    lo := least(coalesce(lo, o), o);                                                                     -- 0087
    hi := greatest(coalesce(hi, o), o);                                                                  -- 0087
  end loop;
  return jsonb_build_object('score', score, 'ticks', case when n >= 5 then p_strikes[5] + 1 else 1800 end, 'exact', exact,
                            'spread', case when n >= 5 then hi - lo end);                                 -- 0087
end $$;

-- _sort_replay (0084's) with the grains given
create or replace function public._sort_replay_p(p_kinds integer[], p_ticks integer[], p_dirs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare kinds integer[] := p_kinds; done boolean[] := array_fill(false, array[12]); t integer; i integer;   -- 0087
        score integer := 0; rmin integer; rmax integer; re integer;
begin
  for k in 1 .. coalesce(cardinality(p_ticks), 0) loop
    t := p_ticks[k];
    continue when t < 40;
    i := (t - 40) / 45;
    continue when i >= 12 or t - (40 + 45 * i) >= 40 or done[i + 1];
    done[i + 1] := true;
    if p_dirs[k] = kinds[i + 1] then
      score := score + 1;
      re := t - (40 + 45 * i);
      rmin := least(coalesce(rmin, re), re);
      rmax := greatest(coalesce(rmax, re), re);
    end if;
  end loop;
  return jsonb_build_object('score', score, 'rmin', rmin, 'rmax', rmax);
end $$;

-- _pcare_feed / _pcare_rub / _pcare_fetch (0085's) with the round given
create or replace function public._pcare_feed_p(p_lanes integer[], p_inputs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare lanes integer[] := p_lanes; n integer := coalesce(cardinality(p_inputs), 0);                       -- 0087
        bowl integer := 2; j integer := 1; caught integer := 0; quick integer := 0; land integer; t integer; since integer;
begin
  for i in 0 .. 11 loop
    land := 30 + i * 40 + 80;
    while j <= n and p_inputs[j] / 8 <= land loop
      bowl := p_inputs[j] % 8;
      j := j + 1;
    end loop;
    if bowl = lanes[i + 1] then caught := caught + 1; end if;
  end loop;
  for k in 1 .. n loop
    t := p_inputs[k] / 8;
    if t >= 30 then
      since := (t - 30) % 40;
      if since < 4 and t - since < 30 + 12 * 40 then quick := quick + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('score', caught, 'permille', (caught * 1000) / 12, 'quick', quick,
                            'suspicious', caught = 12 and n >= 6 and quick * 10 >= n * 8);
end $$;

create or replace function public._pcare_rub_p(p_likes integer[], p_inputs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare likes integer[] := p_likes; n integer := coalesce(cardinality(p_inputs), 0);                       -- 0087
        zone integer := 0; j integer := 1; good integer := 0; quick integer := 0; s integer; hit boolean;
begin
  for t in 0 .. 529 loop
    while j <= n and p_inputs[j] / 8 <= t loop
      zone := p_inputs[j] % 8;
      j := j + 1;
    end loop;
    if t >= 30 and zone = likes[(t - 30) / 100 + 1] + 1 then good := good + 1; end if;
  end loop;
  for k in 0 .. 4 loop
    s := 30 + k * 100;
    hit := false;
    for m in 1 .. n loop
      if p_inputs[m] / 8 between s and s + 3 and p_inputs[m] % 8 = likes[k + 1] + 1 then hit := true; end if;
    end loop;
    if hit then quick := quick + 1; end if;
  end loop;
  return jsonb_build_object('score', good, 'permille', least(1000, (good * 1000) / 400), 'quick', quick, 'suspicious', quick >= 4);
end $$;

create or replace function public._pcare_fetch_p(p_flights integer[], p_inputs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare fl integer[] := p_flights; n integer := coalesce(cardinality(p_inputs), 0);                        -- 0087
        pts integer := 0; exact integer := 0; s integer; p integer; d integer;
begin
  for i in 0 .. 7 loop
    s := 20 + i * 100;
    p := null;
    for m in 1 .. n loop
      if p_inputs[m] >= s and p_inputs[m] < s + 100 then p := p_inputs[m]; exit; end if;
    end loop;
    continue when p is null;
    d := abs(p - (s + fl[i + 1]));
    pts := pts + case when d <= 6 then 2 when d <= 13 then 1 else 0 end;
    if d = 0 then exact := exact + 1; end if;
  end loop;
  return jsonb_build_object('score', pts, 'permille', (pts * 1000) / 16, 'quick', exact, 'suspicious', exact >= 8);
end $$;

create or replace function public._pcare_replay_p(p_kind text, p_round integer[], p_inputs integer[]) returns jsonb
language sql immutable parallel safe
as $$
  select case p_kind when 'feed' then public._pcare_feed_p(p_round, p_inputs) when 'pat' then public._pcare_rub_p(p_round, p_inputs)
                     else public._pcare_fetch_p(p_round, p_inputs) end
$$;

-- _ppress_off / _ppress_power (0085's) with the meter [period, centre] given
create or replace function public._ppress_off_p(p_rd integer[], p_press integer) returns integer
language sql immutable parallel safe
as $$ select abs(public._mine_pos(p_rd[1], p_press) - p_rd[2]) $$;
create or replace function public._ppress_power_p(p_rd integer[], p_press integer) returns integer
language sql immutable parallel safe
as $$ select case when p_press is null then 850 else 1150 - (300 * least(public._ppress_off_p(p_rd, p_press), 400)) / 400 end $$;

-- _row_replay (0086's) with the beats given
create or replace function public._row_replay_p(p_rd integer[], p_need integer, p_strokes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := p_rd; b integer := 0; hits integer := 0; stray integer := 0;                     -- 0087
        exact integer := 0; s integer; t integer; sd integer;
begin
  foreach s in array coalesce(p_strokes, '{}'::integer[]) loop
    t := s / 2;
    sd := s % 2;
    while b < 12 and rd[b + 1] + 11 < t loop b := b + 1; end loop;
    if b < 12 and abs(t - rd[b + 1]) <= 11 and sd = rd[b + 13] then
      if abs(t - rd[b + 1]) <= 1 then exact := exact + 1; end if;
      hits := hits + 1;
      b := b + 1;
    else
      stray := stray + 1;
    end if;
  end loop;
  return jsonb_build_object('outcome', case when hits >= p_need and stray <= 6 then 'pass' else 'fail' end,
                            'ticks', rd[12] + 12, 'hits', hits, 'stray', stray, 'exact', exact);
end $$;

-- _mine_replay (0072's) and _mine_timing (0078's) with the round [period, centre 1 … need] given
create or replace function public._mine_replay_p(p_rd integer[], p_need integer, p_win integer, p_strikes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := p_rd; hits integer := 0; used integer := 0; s integer;                            -- 0087
        outcome text; ticks integer;
begin
  foreach s in array coalesce(p_strikes, '{}'::integer[]) loop
    used := used + 1;
    if abs(public._mine_pos(rd[1], s) - rd[hits + 2]) <= p_win then hits := hits + 1; end if;
    if hits >= p_need then outcome := 'pass'; ticks := s + 1; exit; end if;
    if used >= p_need + 3 then outcome := 'fail'; ticks := s + 1; exit; end if;
  end loop;
  return jsonb_build_object('outcome', coalesce(outcome, 'open'), 'ticks', ticks, 'hits', hits, 'used', used);
end $$;

create or replace function public._mine_timing_p(p_rd integer[], p_need integer, p_win integer, p_strikes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := p_rd; hits integer := 0; used integer := 0; s integer;                            -- 0087
        d integer; v_exact integer := 0; v_tol integer := ceil(1000.0 / rd[1])::int;
begin
  foreach s in array coalesce(p_strikes, '{}'::integer[]) loop
    used := used + 1;
    d := abs(public._mine_pos(rd[1], s) - rd[hits + 2]);
    if d <= p_win then
      if d <= v_tol then v_exact := v_exact + 1; end if;
      hits := hits + 1;
    end if;
    exit when hits >= p_need or used >= p_need + 3;
  end loop;
  return jsonb_build_object('hits', hits, 'used', used, 'exact', v_exact, 'tol', v_tol);
end $$;

-- The rolls (the distributions of _brew_round / _anvil_round / _sort_round / _pcare_*s / _ppress_round / _row_round /
-- _mine_round, each value independent)
create or replace function public._mg_roll(p_game text, p_kind text default null, p_need integer default 3) returns bigint[]
language plpgsql volatile
as $$
declare o bigint[] := '{}'; p integer; t integer := 90; sd integer; x integer;
begin
  if p_game = 'brew' then
    o := array[400 + floor(random() * 201)::bigint];
    for i in 1 .. 20 loop o := o || (floor(random() * 7)::bigint - 3); end loop;
  elsif p_game = 'anvil' then
    p := 50 + floor(random() * 31)::int;
    o := array[p, floor(random() * p)::int]::bigint[];
  elsif p_game = 'sort' then
    for i in 1 .. 12 loop o := o || case when floor(random() * 3) = 0 then 1::bigint else 0::bigint end; end loop;
  elsif p_game = 'care' and p_kind = 'feed' then
    for i in 1 .. 12 loop o := o || floor(random() * 5)::bigint; end loop;
  elsif p_game = 'care' and p_kind = 'pat' then
    for i in 1 .. 5 loop
      x := floor(random() * 5)::int;
      if i > 1 and x = o[i - 1] then x := (x + 1) % 5; end if;
      o := o || x::bigint;
    end loop;
  elsif p_game = 'care' then
    for i in 1 .. 8 loop o := o || (45 + floor(random() * 41))::bigint; end loop;
  elsif p_game = 'press' then
    o := array[60 + floor(random() * 41), 200 + floor(random() * 601)]::bigint[];
  elsif p_game = 'row' then
    declare tg bigint[] := '{}'; sides bigint[] := '{}';
    begin
      for b in 0 .. 11 loop
        if b = 0 then
          sd := floor(random() * 2)::int;
        else
          t := t + 34 + floor(random() * 21)::int;
          if floor(random() * 5) <> 0 then sd := 1 - sd; end if;
        end if;
        tg := tg || t::bigint;
        sides := sides || sd::bigint;
      end loop;
      o := tg || sides;
    end;
  elsif p_game in ('dig', 'mine') then
    o := array[80 + floor(random() * 61)::bigint];
    for i in 1 .. p_need loop o := o || (150 + floor(random() * 701))::bigint; end loop;
  end if;
  return o;
end $$;

revoke all on function public._wg_hunt_u(bigint[], text, boolean, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._wg_trap_u(bigint[], text, integer[]) from public, anon, authenticated;
revoke all on function public._wg_photo_u(bigint[], text, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._wg_combo_u(bigint[], integer[], integer[], integer) from public, anon, authenticated;
revoke all on function public._brew_replay_p(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._anvil_replay_p(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._sort_replay_p(integer[], integer[], integer[]) from public, anon, authenticated;
revoke all on function public._pcare_feed_p(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._pcare_rub_p(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._pcare_fetch_p(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._pcare_replay_p(text, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._ppress_off_p(integer[], integer) from public, anon, authenticated;
revoke all on function public._ppress_power_p(integer[], integer) from public, anon, authenticated;
revoke all on function public._row_replay_p(integer[], integer, integer[]) from public, anon, authenticated;
revoke all on function public._mine_replay_p(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._mine_timing_p(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._mg_roll(text, text, integer) from public, anon, authenticated;

-- ---------- D. The world (0083) ----------
-- wild_start (0083_world_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.wild_start(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; sp public.wild_spawns; s record; p public.wild_profile; g public.world_mg;
        v_ax double precision; v_ay double precision; v_seed bigint := floor(random() * 4294967296)::bigint; v_danger boolean;
        v_u bigint[];                                                                                      -- 0087
begin
  v_acc := public._ac_account(p_session_token);
  if p_action is null or p_action not in ('hunt', 'trap', 'photo') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'wild_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  g := public._wg_row(v_acc);
  if g.stun_until > now() then raise exception 'stunned' using errcode = '53400'; end if;
  select * into sp from public.wild_spawns where id = p_spawn for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    raise exception 'gone' using errcode = '22023';
  end if;
  select * into s from public._wild_species() ws where ws.id = sp.species;
  select q.x, q.y into v_ax, v_ay from public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, extract(epoch from now() - sp.born_at)) q;
  if pp.map is distinct from sp.map
     or sqrt((pp.x - v_ax) ^ 2 + (pp.y - v_ay) ^ 2) > (case when p_action = 'photo' then 140 else 64 end) then
    raise exception 'too far' using errcode = '22023';
  end if;
  insert into public.wild_profile (account_id) values (v_acc) on conflict do nothing;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;
  if p_action = 'photo' then
    if p.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
    if exists (select 1 from public.wild_photos where account_id = v_acc and spawn_id = sp.id) then
      raise exception 'already photographed' using errcode = '22023';
    end if;
  else
    if (p_action = 'hunt' and s.hunt = 0) or (p_action = 'trap' and s.trap = 0) then
      raise exception 'cannot' using errcode = '22023';
    end if;
    if (p_action = 'hunt' and p.last_at > now() - interval '4 seconds')
       or (p_action = 'trap' and p.trap_at > now() - interval '20 seconds') then
      raise exception 'cooldown' using errcode = '53400';
    end if;
    if p.kills >= 60 then raise exception 'daily cap' using errcode = '53400'; end if;
  end if;
  perform public._stamina_spend(v_acc, case when p_action = 'photo' then 0.5 else 1 end, null);
  update public.wild_profile
     set last_at = case when p_action in ('hunt', 'photo') then now() else last_at end,
         trap_at = case when p_action = 'trap' then now() else trap_at end,
         day = p.day, kills = p.kills
   where account_id = v_acc;
  v_danger := p_action = 'hunt' and s.danger > 0 and public._world_night();
  insert into public.world_mg as w (account_id, kind, ref, target, species, danger, seed, started_at, open, last_start)
  values (v_acc, p_action, sp.id, 0, sp.species, v_danger, v_seed, now(), true, now())
  on conflict (account_id) do update
    set kind = excluded.kind, ref = excluded.ref, target = 0, species = excluded.species, danger = excluded.danger,
        seed = excluded.seed, started_at = excluded.started_at, open = true, last_start = excluded.last_start;
  -- 0087 { the round stays on the server: the hunt's aim sweep is all the client sees before the animal shows
  v_u := public._mg_u(case p_action when 'hunt' then 5 when 'trap' then 16 else 4 end);
  perform public._mg_open(v_acc, 'world', p_action, v_u, case when p_action = 'trap' then 0 else 30 + floor(random() * 31)::int end,
                          jsonb_build_object('species', sp.species, 'danger', v_danger));
  return jsonb_build_object('round', jsonb_build_object('game', p_action, 'spawn', sp.id, 'species', sp.species,
                                                        'danger', v_danger, 'live', 'world',
                                                        'reticle', case when p_action = 'hunt' then 100 + v_u[4] % 41 end,
                                                        'started_at', now()));
  -- 0087 }
end $$;

-- wild_finish (0083_world_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.wild_finish(p_session_token text, p_a integer[], p_b integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; sp public.wild_spawns; s record; p public.wild_profile; v_bad text; v_rep jsonb;
        v_code text; v_ev jsonb; v_ac jsonb; v_out text; v_rt integer; v_score integer := 0; v_chance integer := 0;
        v_ok boolean := false; v_qty integer := 0; v_knock boolean := false; v_faint boolean := false; v_saved boolean := false;
        v_xp integer := 0; v_gave_up boolean := false; v_n integer := coalesce(cardinality(p_a), 0);
        l public.mg_live;                                                                                  -- 0087
begin
  v_acc := public._ac_account(p_session_token);
  select * into g from public.world_mg where account_id = v_acc for update;
  if not found or not g.open or g.kind not in ('hunt', 'trap', 'photo') then
    raise exception 'round not found' using errcode = '22023';
  end if;
  update public.world_mg set open = false where account_id = v_acc;
  l := public._mg_close(v_acc, 'world', g.kind, p_a, p_b);                                                -- 0087
  if now() > g.started_at + interval '60 seconds' then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 { a round opened before 0087 has no live row: nothing is replayed, nothing flagged
  if l.account_id is null then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 }
  v_ev := jsonb_build_object('game', g.kind, 'species', g.species, 'ticks', p_ticks, 'a', to_jsonb(p_a[1:6]), 'b', to_jsonb(p_b[1:6]));
  v_bad := public._wg_input_error(g.kind, p_a, p_b, p_ticks);
  -- 0087 { the live list, and no shot / snap before the animal showed
  v_bad := coalesce(v_bad, l.meta->>'err',
                    case when g.kind in ('hunt', 'photo') and public._mg_early(l.started_at, p_a, l.seen[1]) then 'early' end);
  -- 0087 }
  if v_bad is not null then
    v_code := 'wild_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := case g.kind when 'hunt' then public._wg_hunt_u(l.params, g.species, g.danger, p_a, p_b)          -- 0087
                         when 'trap' then public._wg_trap_u(l.params, g.species, p_a)                        -- 0087
                         else public._wg_photo_u(l.params, g.species, p_a, p_b) end;                         -- 0087
    v_out := v_rep->>'outcome';
    v_rt := (v_rep->>'ticks')::int;
    if v_out = 'open' or p_ticks < v_rt then
      v_gave_up := g.kind <> 'photo';
      if g.kind = 'photo' then v_score := coalesce((v_rep->>'score')::int, 0); end if;
    elsif p_ticks <> v_rt or (v_rep->>'used')::int <> v_n then
      v_code := 'wild_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    else
      v_score := (v_rep->>'score')::int;
    end if;
    if v_code is null and now() < g.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'wild_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', g.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  -- 0087 { inputs not played live: the round is void (soft)
  if v_code is null and public._mg_late(l) then
    perform public._ac_flag(v_acc, 'wild_late', 'wild_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'late', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 }
  if v_code is not null then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    v_ac := public._ac_flag(v_acc, v_code, 'wild_finish', v_ev, null, 'invalid round');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'knocked', v_knock, 'fainted', v_faint) || v_ac;
  end if;
  if g.kind = 'hunt' and v_out = 'hit' and v_score >= 992 and not v_gave_up then
    perform public._ac_flag(v_acc, 'wild_timing', 'wild_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
  end if;

  select * into s from public._wild_species() ws where ws.id = g.species;
  -- the charge of a wolf / bear: taken unless the hunt hit first or the dodge was on time
  if g.danger and not (not v_gave_up and v_out = 'hit') and not (not v_gave_up and coalesce((v_rep->>'dodged')::boolean, false)) then
    v_knock := true;
    v_faint := public._wg_charge(v_acc, g.species);
  end if;

  select * into sp from public.wild_spawns where id = g.ref for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    return jsonb_build_object('result', 'lost', 'why', 'gone', 'outcome', v_out, 'score', v_score, 'knocked', v_knock,
                              'fainted', v_faint, 'wild', public._wild_json(v_acc, coalesce(sp.map, 'field')));
  end if;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;

  if g.kind = 'photo' then
    if v_score >= 250 then
      insert into public.wild_photos (account_id, spawn_id, species) values (v_acc, sp.id, sp.species) on conflict do nothing;
      v_saved := found;
    end if;
    if v_saved then
      v_xp := greatest(1, case when v_score >= 700 then s.xp / 2 else s.xp / 4 end);
      perform public._game_event(v_acc, 'wild_photo', 1, jsonb_build_object('species', sp.species, 'score', v_score));
      perform public._game_event(v_acc, 'xp_grant', v_xp, jsonb_build_object('source', 'wild'));
    end if;
    return jsonb_build_object('result', case when v_saved then 'ok' else 'fail' end, 'action', 'photo', 'species', sp.species,
                              'score', v_score, 'saved', v_saved, 'xp', v_xp, 'outcome', v_out,
                              'wild', public._wild_json(v_acc, sp.map));
  end if;

  v_chance := public._wg_chance(case when g.kind = 'hunt' then s.hunt else s.trap end, v_score,
                                not v_gave_up and v_out in ('hit', 'caught'));
  v_ok := p.kills < 60 and random() * 100 < v_chance;
  if v_ok then
    update public.wild_spawns set taken_by = v_acc, taken_at = now() where id = sp.id;
    v_qty := s.drop_min + floor(random() * (s.drop_max - s.drop_min + 1))::int;
    insert into public.wild_bag (account_id, item, qty) values (v_acc, s.drop_item, v_qty)
    on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
    p.kills := p.kills + 1;
    v_xp := s.xp;
    perform public._game_event(v_acc, case when g.kind = 'hunt' then 'wild_hunt' else 'wild_trap' end, v_qty,
                               jsonb_build_object('species', sp.species, 'item', s.drop_item, 'score', v_score));
    perform public._game_event(v_acc, 'xp_grant', s.xp, jsonb_build_object('source', 'wild'));
  elsif g.kind = 'hunt' and random() < 0.5 then
    update public.wild_spawns set expires_at = now() where id = sp.id;     -- it bolts
  end if;
  update public.wild_profile set day = p.day, kills = p.kills where account_id = v_acc;
  return jsonb_build_object('result', case when v_ok then 'ok' else 'fail' end, 'action', g.kind, 'species', sp.species,
                            'outcome', case when v_gave_up then 'gave_up' else v_out end, 'score', v_score, 'chance', v_chance,
                            'item', case when v_ok then s.drop_item end, 'qty', v_qty, 'xp', v_xp,
                            'knocked', v_knock, 'fainted', v_faint, 'wild', public._wild_json(v_acc, sp.map));
end $$;

-- combo_start (0083_world_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.combo_start(p_session_token text, p_kind text, p_ref bigint, p_target integer, p_map text,
                                              p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; g public.world_mg; f public.boss_fights; d record; r public.dungeon_runs;
        v_mine integer; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  v_acc := public._ac_account(p_session_token);
  if p_kind is null or p_kind not in ('boss', 'dungeon') then raise exception 'bad kind' using errcode = '22023'; end if;
  perform public._vitals_guard(v_acc);
  if p_kind = 'boss' then
    v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'combo_start', null, 'not in arena');
  else
    v_ac := public._pos_claim(v_acc, 'bai_dat', 60, 120, 'combo_start', null, 'not at gate');
  end if;
  if v_ac is not null then return v_ac; end if;
  g := public._wg_row(v_acc);
  if g.stun_until > now() then raise exception 'stunned' using errcode = '53400'; end if;
  if g.last_start > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  if p_kind = 'boss' then
    select * into pp from public.player_pos where account_id = v_acc;
    select * into f from public.boss_fights where id = p_ref;
    if not found then raise exception 'no boss' using errcode = '22023'; end if;
    select * into d from public._boss_defs() where id = f.boss;
    if f.status <> 'up' or now() < f.starts_at or now() >= f.ends_at then raise exception 'boss not up' using errcode = '53400'; end if;
    if f.room_key <> '00000000-0000-0000-0000-000000000000'::uuid
       and not exists (select 1 from public.members m where m.room_id = f.room_key and m.account_id = v_acc) then
      raise exception 'not in room' using errcode = '42501';
    end if;
    if pp.map is distinct from d.map or pp.x not between d.ax - 16 and d.ax + d.aw + 16 or pp.y not between d.ay - 16 and d.ay + d.ah + 16 then
      raise exception 'not in arena' using errcode = '22023';
    end if;
    select h.dmg into v_mine from public.boss_hits h where h.fight_id = f.id and h.account_id = v_acc;
    if coalesce(v_mine, 0) >= (f.max_hp * d.cap_pct) / 100 then raise exception 'damage cap' using errcode = '53400'; end if;
  else
    select * into r from public.dungeon_runs where id = p_ref;
    if not found or r.status <> 'open' or r.expires_at <= now() then raise exception 'run over' using errcode = '22023'; end if;
    if not exists (select 1 from public.dungeon_members where run_id = r.id and account_id = v_acc) then
      raise exception 'not joined' using errcode = '42501';
    end if;
    if public._party_of(v_acc) is distinct from r.party_id then raise exception 'not in party' using errcode = '42501'; end if;
  end if;
  perform public._stamina_spend(v_acc, 2, 'fight');
  insert into public.world_mg as w (account_id, kind, ref, target, species, danger, seed, started_at, open, last_start)
  values (v_acc, p_kind, p_ref, coalesce(p_target, 0), null, false, v_seed, now(), true, now())
  on conflict (account_id) do update
    set kind = excluded.kind, ref = excluded.ref, target = excluded.target, species = null, danger = false,
        seed = excluded.seed, started_at = excluded.started_at, open = true, last_start = excluded.last_start;
  -- 0087 { the chart stays on the server; mg_sync reveals each arrow 2 s before its beat
  perform public._mg_open(v_acc, 'world', 'combo', public._mg_u(13), 0, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('round', jsonb_build_object('kind', p_kind, 'ref', p_ref, 'target', coalesce(p_target, 0),
                                                        'live', 'world', 'started_at', now()));
  -- 0087 }
end $$;

-- combo_finish (0083_world_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.combo_finish(p_session_token text, p_keys integer[], p_dodges integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_ac jsonb; v_dmg integer := 0;
        v_stun boolean := false; f public.boss_fights; d record; h public.boss_hits; v_cap integer; v_hits integer := 0;
        r public.dungeon_runs; m public.dungeon_members; v_mobs integer[]; v_t integer; v_cleared boolean := false;
        v_judge text; v_streak integer;
        l public.mg_live; v_steady boolean;                                                                -- 0087
begin
  v_acc := public._ac_account(p_session_token);
  select * into g from public.world_mg where account_id = v_acc for update;
  if not found or not g.open or g.kind not in ('boss', 'dungeon') then
    raise exception 'round not found' using errcode = '22023';
  end if;
  update public.world_mg set open = false where account_id = v_acc;
  l := public._mg_close(v_acc, 'world', 'combo', p_keys, p_dodges);                                      -- 0087
  if now() > g.started_at + interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  if l.account_id is null then return jsonb_build_object('result', 'lost', 'why', 'outdated'); end if;  -- 0087
  v_ev := jsonb_build_object('kind', g.kind, 'ref', g.ref, 'ticks', p_ticks, 'keys', to_jsonb(p_keys[1:12]), 'dodges', to_jsonb(p_dodges[1:3]));
  v_bad := coalesce(public._wg_combo_error(p_keys, p_dodges, p_ticks), l.meta->>'err');                 -- 0087
  if v_bad is null then
    v_rep := public._wg_combo_u(l.params, p_keys, p_dodges, p_ticks);                                    -- 0087
    -- 0087: the round runs to its end (the sixth beat's window closed, the slam past): no early finish
    if p_ticks <> (v_rep->>'end')::int then v_bad := 'ticks'; end if;
  end if;
  if v_bad is not null then
    v_code := 'combo_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif now() < g.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
    v_code := 'combo_too_fast';
    v_ev := v_ev || jsonb_build_object('started_at', g.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
  -- 0087 { not played live: void (soft)
  elsif public._mg_late(l) then
    perform public._ac_flag(v_acc, 'combo_late', 'combo_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    return jsonb_build_object('result', 'lost', 'why', 'late');
  -- 0087 }
  else
    -- 0087: six arrows on one steady offset (±1 tick) are as machine-like as six on the beat
    v_steady := jsonb_array_length(v_rep->'offs') >= 6
                and (select max(x::int) - min(x::int) from jsonb_array_elements_text(v_rep->'offs') x) <= 1;
    if (v_rep->>'exact')::int >= 6 or v_steady then                                                      -- 0087
      perform public._ac_flag(v_acc, 'combo_timing', 'combo_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_acc and e.code = 'combo_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'combo_timing_repeat';
        v_ev := v_ev || jsonb_build_object('pattern', '5 in 24 h');
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_acc, v_code, 'combo_finish', v_ev, null, 'invalid round');
    return jsonb_build_object('result', 'lost', 'why', 'refused') || v_ac;
  end if;
  -- the slam: not dodged → the old strike-back and a 3 s stun
  if not (v_rep->>'dodged')::boolean then
    v_stun := true;
    update public.world_mg set stun_until = now() + interval '3 seconds' where account_id = v_acc;
    update public.vitals set hunger = greatest(1, hunger - 3), thirst = greatest(1, thirst - 3) where account_id = v_acc;
  end if;
  -- the arrows' damage: the old strike (40–60 × the streak's +15 %, ×1.75 max), a "good" arrow 75 %
  for i in 1 .. 6 loop
    v_judge := v_rep->'judges'->>(i - 1);
    continue when v_judge = 'miss';
    v_streak := (v_rep->'streaks'->>(i - 1))::int;
    v_hits := v_hits + 1;
    v_dmg := v_dmg + ((((40 + floor(random() * 21)::int) * (100 + 15 * least(v_streak - 1, 5))) / 100)
                      * case when v_judge = 'perfect' then 100 else 75 end) / 100;
  end loop;

  if g.kind = 'boss' then
    select * into f from public.boss_fights where id = g.ref for update;
    select * into d from public._boss_defs() where id = f.boss;
    if f.status <> 'up' or now() >= f.ends_at then
      return jsonb_build_object('result', 'lost', 'why', 'boss not up', 'judges', v_rep->'judges', 'stunned', v_stun);
    end if;
    insert into public.boss_hits (fight_id, account_id) values (f.id, v_acc) on conflict do nothing;
    select * into h from public.boss_hits where fight_id = f.id and account_id = v_acc for update;
    v_cap := (f.max_hp * d.cap_pct) / 100;
    if f.phase = 3 then v_dmg := (v_dmg * 4) / 5; end if;                       -- enraged: thicker hide
    v_dmg := greatest(0, least(v_dmg, v_cap - h.dmg, f.hp));
    if v_dmg > 0 then
      update public.boss_hits set dmg = dmg + v_dmg, hits = hits + v_hits, combo = (v_rep->>'best')::int, last_at = now()
       where fight_id = f.id and account_id = v_acc;
      f.hp := f.hp - v_dmg;
      f.phase := case when f.hp * 3 > f.max_hp * 2 then 1 when f.hp * 3 > f.max_hp then 2 else 3 end;
      perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', f.boss, 'fight', f.id, 'combo', (v_rep->>'best')::int));
      if f.hp <= 0 then
        update public.boss_fights set hp = 0, phase = 3, status = 'dead', killed_at = now(), killer = v_acc where id = f.id;
        perform public._boss_payout(f.id);
      else
        update public.boss_fights set hp = f.hp, phase = f.phase where id = f.id;
      end if;
    end if;
    return jsonb_build_object('result', 'ok', 'dmg', v_dmg, 'judges', v_rep->'judges', 'best', (v_rep->>'best')::int,
                              'dodged', not v_stun, 'stunned', v_stun, 'hp', greatest(0, f.hp), 'phase', f.phase,
                              'killed', f.hp <= 0, 'my_dmg', h.dmg + v_dmg, 'cap', v_cap);
  end if;

  select * into r from public.dungeon_runs where id = g.ref for update;
  if not found or r.status <> 'open' or r.expires_at <= now() then
    return jsonb_build_object('result', 'lost', 'why', 'run over', 'judges', v_rep->'judges', 'stunned', v_stun) || public._dg_json(v_acc);
  end if;
  select * into m from public.dungeon_members where run_id = r.id and account_id = v_acc for update;
  if not found or public._party_of(v_acc) is distinct from r.party_id then raise exception 'not in party' using errcode = '42501'; end if;
  v_mobs := r.mobs;
  v_t := case when g.target between 1 and coalesce(array_length(v_mobs, 1), 0) and v_mobs[g.target] > 0 then g.target
              else (select min(i) from generate_subscripts(v_mobs, 1) i where v_mobs[i] > 0) end;
  v_dmg := greatest(0, least(v_dmg, v_mobs[v_t]));
  if v_dmg > 0 then
    v_mobs[v_t] := v_mobs[v_t] - v_dmg;
    update public.dungeon_members set dmg = dmg + v_dmg, hits = hits + v_hits, combo = (v_rep->>'best')::int, last_at = now()
     where run_id = r.id and account_id = v_acc;
    if r.room = 4 then
      perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', 'doi_chua', 'dungeon', true, 'combo', (v_rep->>'best')::int));
    end if;
    if not exists (select 1 from unnest(v_mobs) x where x > 0) then
      if r.room >= 4 then
        update public.dungeon_runs set mobs = v_mobs, status = 'cleared', ended_at = now() where id = r.id;
        perform public._dg_payout(r.id);
        v_cleared := true;
      else
        update public.dungeon_runs set room = r.room + 1, mobs = public._dg_mobs(r.room + 1, r.scale) where id = r.id;
      end if;
    else
      update public.dungeon_runs set mobs = v_mobs where id = r.id;
    end if;
  end if;
  return jsonb_build_object('result', 'ok', 'dmg', v_dmg, 'target', v_t, 'judges', v_rep->'judges', 'best', (v_rep->>'best')::int,
                            'dodged', not v_stun, 'stunned', v_stun, 'bitten', v_stun, 'cleared', v_cleared) || public._dg_json(v_acc);
end $$;

-- ---------- E. Crafting (0084) and the mine's state ----------
-- _mine_state (0084_craft_minigames.sql's, verbatim but for the line marked 0087: a dig shows its bar, not its seed)
create or replace function public._mine_state(p_room uuid, p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', now(),
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'nodes', case when p_room is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('no', n.node_no, 'item', n.item_id, 'ready_at', n.ready_at) order by n.node_no)
        from public.mine_nodes n where n.room_id = p_room), '[]'::jsonb) end,
    'bag', coalesce((select jsonb_object_agg(b.item_id, b.qty) from public.craft_bag b
                      where b.account_id = p_account and b.qty > 0), '{}'::jsonb),
    'fish', (select count(*) from public.fish f where f.account_id = p_account),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('id', t.tool_id, 'durability', t.durability,
                                                           'max', public._upgrade_max(k.durability, public._upgrade_level(p_account, t.tool_id)),
                                                           'level', public._upgrade_level(p_account, t.tool_id)) order by k.tier)
                         from public.mine_tools t join public.pickaxe_kinds k on k.id = t.tool_id
                        where t.account_id = p_account), '[]'::jsonb),
    'gear', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name, 'price', s.price,
                                                          'durability', i.durability,
                                                          'max', public._upgrade_max(s.durability, public._upgrade_level(p_account, s.id)),
                                                          'level', public._upgrade_level(p_account, s.id)) order by s.kind, s.sort_order)
                        from public.shop_items s
                        left join public.inventory i on i.item_id = s.id and i.account_id = p_account and i.qty >= 1
                       where s.kind in ('rod', 'net') and (i.account_id is not null or s.starter)), '[]'::jsonb),
    'buffs', coalesce((select jsonb_agg(jsonb_build_object('kind', b.kind, 'power', b.power, 'until', b.until))
                         from public.player_buffs b where b.account_id = p_account and b.until > now()), '[]'::jsonb),
    'dig', (select jsonb_build_object('node', d.node_no, 'item', d.item_id, 'tool', d.tool_id,
                                      'period', (select l.params[1] from public.mg_live l
                                                  where l.account_id = p_account and l.game = 'mine'),     -- 0087
                                      'need', d.need, 'win', d.win, 'started_at', d.started_at)
              from public.mine_digs d where d.account_id = p_account and (p_room is null or d.room_id = p_room)),
    'quality', coalesce((select jsonb_agg(jsonb_build_object('item', q.item_id, 'tier', q.tier, 'qty', q.qty) order by q.item_id, q.tier)
                           from public.potion_quality q where q.account_id = p_account and q.qty > 0), '[]'::jsonb))
$$;
revoke all on function public._mine_state(uuid, uuid) from public, anon, authenticated;

-- brew_start (0084_craft_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.brew_start(p_session_token text, p_recipe text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('cauldron');
        r public.potion_recipes; w public.wallets; mp public.mining_profiles; e record; v_need integer;
        v_seed bigint := floor(random() * 4294967296)::bigint;
        v_rd bigint[] := public._mg_roll('brew');                                                          -- 0087
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'brew_start', null, 'not at the cauldron');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  select * into r from public.potion_recipes where id = p_recipe;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 5 then
    return public._ac_flag(v_account, 'bad_qty', 'brew_start', jsonb_build_object('recipe', left(p_recipe, 32), 'qty', p_qty), null,
                           'invalid quantity', false);
  end if;
  w := public._wallet_lock(v_account);
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  if w.coins < r.fee * p_qty then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * p_qty;
    if e.key = 'fish' then
      if (select count(*) from public.fish where account_id = v_account) < v_need then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    elsif coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < v_need then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  delete from public.craft_rounds where account_id = v_account and game = 'brew';
  insert into public.craft_rounds (account_id, game, seed, meta)
  values (v_account, 'brew', v_seed, jsonb_build_object('recipe', r.id, 'qty', p_qty));
  -- 0087 { the drift stays on the server (mg_sync: each 0.5 s segment 1 s ahead); the band is on screen
  perform public._mg_open(v_account, 'brew', 'brew', v_rd, 0);
  return jsonb_build_object('round', jsonb_build_object('game', 'brew', 'recipe', r.id, 'qty', p_qty, 'centre', v_rd[1],
                                                        'live', 'brew', 'started_at', now()),
                            'state', public._mine_state(null, v_account));
  -- 0087 }
end $$;

-- brew_finish (0084_craft_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.brew_finish(p_session_token text, p_toggles integer[], p_score integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('cauldron');
        c public.craft_rounds; r public.potion_recipes; it public.craft_items; w public.wallets; e record; v_need integer;
        v_fee integer; v_rows integer; v_qty integer; v_rep integer; v_code text; v_ev jsonb; v_bad text; v_q integer;
        v_regular boolean;
        l public.mg_live;                                                                                  -- 0087
begin
  -- 0087 { the start's lock order: the position, the wallet, then the round
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'brew_finish', null, 'not at the cauldron');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_account);
  c := public._craft_take(v_account, 'brew');
  l := public._mg_close(v_account, 'brew', 'brew', p_toggles, null);
  -- 0087 }
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._mine_state(null, v_account));
  end if;
  if l.account_id is null then                                                                             -- 0087
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'state', public._mine_state(null, v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'n', coalesce(cardinality(p_toggles), 0), 'toggles', to_jsonb(p_toggles[1:40]));
  v_bad := coalesce(public._toggles_error(p_toggles, 600, 600, 120, 10), case when p_score is null then 'score' end,
                    l.meta->>'err');                                                                       -- 0087
  if v_bad is not null then
    v_code := 'brew_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._brew_replay_p(l.params::integer[], p_toggles);                                        -- 0087
    if v_rep <> p_score then
      v_code := 'brew_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    elsif now() < c.started_at + interval '9 seconds' then
      v_code := 'brew_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'brew_late', 'brew_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              null, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late', 'state', public._mine_state(null, v_account));
    -- 0087 }
    else
      v_regular := public._craft_regular(p_toggles, 10);
      perform public._ac_stat(v_account, 'brew', 1, case when public._brew_quality(v_rep) = 3 then 1 else 0 end,
                              case when v_regular then 1 else 0 end);
      if v_regular then v_code := public._craft_timing(v_account, 'brew_timing', 'brew_finish', v_ev); end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'brew_finish', v_ev, null, 'invalid brew');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'state', public._mine_state(null, v_account)) || v_ac;
  end if;
  -- 0078's brew_potion from here (the recipe and quantity of the start)
  select * into r from public.potion_recipes where id = c.meta->>'recipe';
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = r.id;
  v_qty := (c.meta->>'qty')::int;
  w := public._wallet_lock(v_account);
  v_fee := r.fee * v_qty;
  if w.coins < v_fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * v_qty;
    if e.key = 'fish' then
      if (select count(*) from public.fish where account_id = v_account) < v_need then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    elsif coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < v_need then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  perform public._stamina_spend(v_account, 2);
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * v_qty;
    if e.key = 'fish' then
      delete from public.fish where id in (select id from public.fish where account_id = v_account
                                            order by price, caught_at limit v_need);
      get diagnostics v_rows = row_count;
      if v_rows < v_need then raise exception 'not enough items' using errcode = '22023'; end if;
    else
      if not public._bag_take(v_account, e.key, v_need) then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_fee > 0 then perform public._pay(v_account, -v_fee, 'potion', r.id || ' x' || v_qty); end if;
  perform public._bag_add(v_account, r.id, v_qty);
  v_q := public._brew_quality(v_rep);
  if v_q >= 2 then
    insert into public.potion_quality (account_id, item_id, tier, qty) values (v_account, r.id, v_q, v_qty)
    on conflict (account_id, item_id, tier) do update set qty = public.potion_quality.qty + excluded.qty;
  end if;
  perform public._game_event(v_account, 'potion_brewed', v_qty,
                             jsonb_build_object('potion', r.id, 'rarity', it.rarity, 'quality', v_q, 'score', v_rep));
  perform public._game_event(v_account, 'xp_grant', 3 * it.rarity * v_qty, '{"source":"alchemy"}'::jsonb);
  return jsonb_build_object('result', 'brewed',
                            'brewed', jsonb_build_object('potion', r.id, 'qty', v_qty, 'quality', v_q, 'score', v_rep,
                                                         'bonus', public._brew_bonus(v_q)),
                            'state', public._mine_state(null, v_account));
end $$;

-- upgrade_start (0084_craft_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.upgrade_start(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('anvil');
        mp public.mining_profiles; v_plan jsonb; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'upgrade_start', null, 'not at the anvil');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  perform public._wallet_lock(v_account);
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  v_plan := public._upgrade_plan(v_account, p_item);
  delete from public.craft_rounds where account_id = v_account and game = 'anvil';
  insert into public.craft_rounds (account_id, game, seed, meta)
  values (v_account, 'anvil', v_seed, jsonb_build_object('item', p_item, 'level', v_plan->'level'));
  -- 0087 { the glow shows (period and phase) at a secret tick 0.5–1 s in
  perform public._mg_open(v_account, 'anvil', 'anvil', public._mg_roll('anvil'), 30 + floor(random() * 31)::int);
  return jsonb_build_object('round', jsonb_build_object('game', 'anvil', 'item', p_item, 'level', v_plan->'level',
                                                        'chance', v_plan->'chance', 'live', 'anvil', 'started_at', now()),
                            'state', public._mine_state(null, v_account));
  -- 0087 }
end $$;

-- upgrade_finish (0084_craft_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.upgrade_finish(p_session_token text, p_strikes integer[], p_ticks integer, p_score integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('anvil');
        c public.craft_rounds; v_plan jsonb; v_item text; v_kind text; v_base integer; v_level integer; v_cost integer;
        e record; v_ok boolean; v_rep jsonb; v_code text; v_ev jsonb; v_bad text; v_nudge integer; v_chance integer;
        v_n integer := coalesce(cardinality(p_strikes), 0);
        l public.mg_live; v_machine boolean;                                                               -- 0087
begin
  -- 0087 { the start's lock order: the position, the wallet, then the round
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'upgrade_finish', null, 'not at the anvil');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_account);
  c := public._craft_take(v_account, 'anvil');
  l := public._mg_close(v_account, 'anvil', 'anvil', p_strikes, null);
  -- 0087 }
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._mine_state(null, v_account));
  end if;
  if l.account_id is null then                                                                             -- 0087
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'state', public._mine_state(null, v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'ticks', p_ticks, 'strikes', to_jsonb(p_strikes[1:5]));
  v_bad := coalesce(public._toggles_error(p_strikes, p_ticks, 1800, 5, 2), case when p_score is null then 'score' end,
                    l.meta->>'err',                                                                        -- 0087
                    case when public._mg_early(l.started_at, p_strikes, l.seen[1]) then 'early' end);      -- 0087
  if v_bad is not null then
    v_code := 'anvil_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._anvil_replay_p(l.params::integer[], p_strikes);                                       -- 0087
    if (v_rep->>'score')::int <> p_score or (v_rep->>'ticks')::int <> p_ticks then
      v_code := 'anvil_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    elsif now() < c.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'anvil_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'anvil_late', 'upgrade_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              null, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late', 'state', public._mine_state(null, v_account));
    -- 0087 }
    else
      -- 0087: five strikes on the peak, or on one steady offset from it (±1 tick), are a metronome
      v_machine := v_n = 5 and ((v_rep->>'exact')::int = 5 or (v_rep->>'spread')::int <= 2);
      perform public._ac_stat(v_account, 'anvil', 1, case when p_score = 10 then 1 else 0 end,
                              case when v_machine then 1 else 0 end);                                     -- 0087
      if v_machine then                                                                                    -- 0087
        v_code := public._craft_timing(v_account, 'anvil_timing', 'upgrade_finish', v_ev || jsonb_build_object('replay', v_rep));
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'upgrade_finish', v_ev, null, 'invalid upgrade');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'state', public._mine_state(null, v_account)) || v_ac;
  end if;
  -- 0078's upgrade_item from here
  v_item := c.meta->>'item';
  perform public._wallet_lock(v_account);
  v_plan := public._upgrade_plan(v_account, v_item);
  v_kind := v_plan->>'kind';
  v_base := (v_plan->>'base')::int;
  v_level := (v_plan->>'level')::int;
  v_cost := (v_plan->>'cost')::int;
  perform public._stamina_spend(v_account, 3);
  for e in select key, value::int as q from jsonb_each_text(v_plan->'mats') loop
    if not public._bag_take(v_account, e.key, e.q) then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  perform public._pay(v_account, -v_cost, 'upgrade', v_item || ' +' || (v_level + 1));
  v_nudge := public._anvil_nudge(p_score);
  v_chance := least(1000, greatest(0, public._upgrade_chance(v_level) + v_nudge));
  v_ok := floor(random() * 1000) < v_chance;
  if v_ok then
    insert into public.item_upgrades (account_id, item_id, level) values (v_account, v_item, v_level + 1)
    on conflict (account_id, item_id) do update set level = excluded.level;
    if v_kind = 'pickaxe' then
      update public.mine_tools set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and tool_id = v_item;
    elsif v_base is not null then
      update public.inventory set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and item_id = v_item and durability is not null;
    end if;
    perform public._game_event(v_account, 'xp_grant', 5 * (v_level + 1), '{"source":"upgrade"}'::jsonb);
  end if;
  perform public._game_event(v_account, 'item_upgraded', case when v_ok then v_level + 1 else v_level end,
                             jsonb_build_object('item', v_item, 'ok', v_ok, 'from', v_level, 'score', p_score, 'nudge', v_nudge));
  return jsonb_build_object('result', 'done',
                            'upgrade', jsonb_build_object('item', v_item, 'ok', v_ok,
                                                          'level', case when v_ok then v_level + 1 else v_level end,
                                                          'cost', v_cost, 'chance', public._upgrade_chance(v_level),
                                                          'nudge', v_nudge, 'final', v_chance, 'score', p_score),
                            'state', public._mine_state(null, v_account));
end $$;

-- process_sort_start (0084_craft_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.process_sort_start(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); j public.processor_jobs;
        v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  perform public._owns_machine(v_account, 'processor');
  perform public._wallet_lock(v_account);
  select * into j from public.processor_jobs where account_id = v_account;
  if not found then raise exception 'no job' using errcode = '22023'; end if;
  if now() < j.ready_at then raise exception 'not ready' using errcode = '22023'; end if;
  if exists (select 1 from public.craft_rounds where account_id = v_account and game = 'sort' and started_at > now() - interval '1 second') then
    raise exception 'too fast' using errcode = '53400';
  end if;
  delete from public.craft_rounds where account_id = v_account and game = 'sort';
  insert into public.craft_rounds (account_id, game, seed, meta)
  values (v_account, 'sort', v_seed, jsonb_build_object('recipe', j.recipe, 'batches', j.batches, 'job', j.started_at));
  -- 0087 { each grain is revealed 1 s before it is in reach
  perform public._mg_open(v_account, 'sort', 'sort', public._mg_roll('sort'), 0);
  return jsonb_build_object('round', jsonb_build_object('game', 'sort', 'recipe', j.recipe, 'batches', j.batches,
                                                        'live', 'sort', 'started_at', now()),
                            'extras', public._fx_extras_state(v_account));
  -- 0087 }
end $$;

-- process_sort_finish (0084_craft_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.process_sort_finish(p_session_token text, p_ticks integer[], p_dirs integer[], p_score integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); c public.craft_rounds; j public.processor_jobs;
        r public.processor_recipes; v_ac jsonb; v_rep jsonb; v_code text; v_ev jsonb; v_bad text; v_pct integer;
        v_bonus integer := 0; v_regular boolean;
        l public.mg_live;                                                                                  -- 0087
begin
  perform public._wallet_lock(v_account);                                                                  -- 0087: the start's order
  c := public._craft_take(v_account, 'sort');
  l := public._mg_close(v_account, 'sort', 'sort',                                                         -- 0087: tick·2 + basket
                        (select coalesce(array_agg(x.t * 2 + x.d order by x.o), '{}') from unnest(p_ticks, p_dirs) with ordinality as x(t, d, o)),
                        null);
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'extras', public._fx_extras_state(v_account));
  end if;
  if l.account_id is null then                                                                             -- 0087
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'extras', public._fx_extras_state(v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'n', coalesce(cardinality(p_ticks), 0), 'ticks', to_jsonb(p_ticks[1:24]),
                             'dirs', to_jsonb(p_dirs[1:24]));
  v_bad := coalesce(public._sort_input_error(p_ticks, p_dirs), case when p_score is null then 'score' end,
                    l.meta->>'err');                                                                       -- 0087
  if v_bad is not null then
    v_code := 'sort_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._sort_replay_p(l.params::integer[], p_ticks, p_dirs);                                  -- 0087
    if (v_rep->>'score')::int <> p_score then
      v_code := 'sort_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    elsif now() < c.started_at + interval '8.7 seconds' then
      v_code := 'sort_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'sort_late', 'process_sort_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              null, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late', 'extras', public._fx_extras_state(v_account));
    -- 0087 }
    else
      v_regular := p_score >= 11 and (v_rep->>'rmax')::int - (v_rep->>'rmin')::int <= 1;                  -- 0087: the full 5 % from 11
      perform public._ac_stat(v_account, 'sort', 1, case when p_score >= 11 then 1 else 0 end, case when v_regular then 1 else 0 end);
      if v_regular then
        v_code := public._craft_timing(v_account, 'sort_timing', 'process_sort_finish', v_ev || jsonb_build_object('replay', v_rep));
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'process_sort_finish', v_ev, null, 'invalid sort');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'extras', public._fx_extras_state(v_account)) || v_ac;
  end if;
  -- 0076's process_collect from here (the job the round was started on)
  perform public._wallet_lock(v_account);
  select * into j from public.processor_jobs where account_id = v_account for update;
  if not found or j.started_at <> (c.meta->>'job')::timestamptz then raise exception 'no job' using errcode = '22023'; end if;
  if now() < j.ready_at then raise exception 'not ready' using errcode = '22023'; end if;
  perform public._stamina_spend(v_account, 2);
  delete from public.processor_jobs where account_id = v_account;
  insert into public.processed_goods (account_id, recipe, qty) values (v_account, j.recipe, j.batches)
  on conflict (account_id, recipe) do update set qty = public.processed_goods.qty + excluded.qty;
  select * into r from public.processor_recipes where id = j.recipe;
  v_pct := public._sort_bonus(p_score);
  v_bonus := (r.value * j.batches * v_pct) / 100;
  if v_bonus > 0 then perform public._pay(v_account, v_bonus, 'produce_sell', 'sort bonus ' || j.recipe || ' x' || j.batches); end if;
  perform public._game_event(v_account, 'crop_processed', j.batches, jsonb_build_object('recipe', j.recipe, 'sort', p_score));
  perform public._game_event(v_account, 'xp_grant', 10 * j.batches, '{"source":"fishing"}'::jsonb);
  return jsonb_build_object('result', 'collected', 'score', p_score, 'bonus_pct', v_pct, 'bonus', v_bonus,
                            'extras', public._fx_extras_state(v_account));
end $$;

-- ---------- F. Pets (0085) ----------
-- pet_care_start (0085_pet_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.pet_care_start(p_session_token text, p_pet bigint, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  if p_kind is null or p_kind not in ('feed','pat','play') then raise exception 'bad kind' using errcode = '22023'; end if;
  perform 1 from public.accounts where id = v_account for update;                                          -- 0087: one start at a time
  if exists (select 1 from public.pet_care_rounds where account_id = v_account and started_at > now() - interval '1 second') then
    raise exception 'too soon' using errcode = '53400';
  end if;
  p := public._pet_mine(v_account, p_pet);
  if p_kind = 'feed' then
    if not exists (select 1 from public.pet_items where account_id = v_account and item_id = 'food_' || p.species and qty > 0) then
      raise exception 'no food' using errcode = '53400';
    end if;
  elsif p_kind = 'pat' then
    if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
    if p.pat_at > now() - interval '60 seconds' then raise exception 'too soon' using errcode = '53400'; end if;
    update public.pets set pat_at = now() where id = p.id;
  else
    if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
    if not exists (select 1 from public.pet_items i join public.pet_item_catalog c on c.id = i.item_id
                    where i.account_id = v_account and i.qty > 0 and c.kind = 'toy' and c.species = p.species) then
      raise exception 'no toy' using errcode = '53400';
    end if;
    if p.played_at > now() - interval '10 minutes' then raise exception 'too soon' using errcode = '53400'; end if;
    perform public._stamina_spend(v_account, 1, null);
    update public.pets set played_at = now() where id = p.id;
  end if;
  insert into public.pet_care_rounds (account_id, pet_id, kind, seed, started_at)
  values (v_account, p.id, p_kind, v_seed, now())
  on conflict (account_id) do update set pet_id = excluded.pet_id, kind = excluded.kind, seed = excluded.seed,
                                         started_at = excluded.started_at;
  -- 0087 { each treat / liked spot / throw is revealed 0.5 s before it shows
  perform public._mg_open(v_account, 'care', p_kind, public._mg_roll('care', p_kind), 0);
  return public._pets_state(v_account)
         || jsonb_build_object('round', jsonb_build_object('pet', p.id, 'kind', p_kind, 'live', 'care',
                                                           'ticks', public._pcare_ticks(p_kind)));
  -- 0087 }
end $$;

-- pet_care_finish (0085_pet_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.pet_care_finish(p_session_token text, p_inputs integer[], p_ticks integer, p_score integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); r public.pet_care_rounds; p public.pets; v_bad text;
        v_rep jsonb; v_code text; v_ev jsonb; v_ac jsonb; v_pm integer; v_aff integer; v_xp integer; v_got integer;
        v_base_aff integer; v_base_xp integer;
        l public.mg_live;                                                                                  -- 0087
begin
  perform 1 from public.accounts where id = v_account for update;                                          -- 0087: as the start
  delete from public.pet_care_rounds where account_id = v_account returning * into r;
  if not found then raise exception 'no round' using errcode = '22023'; end if;
  l := public._mg_close(v_account, 'care', r.kind, p_inputs, null);                                         -- 0087
  if now() > r.started_at + interval '120 seconds' then
    return public._pets_state(v_account) || jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  if l.account_id is null then                                                                             -- 0087
    return public._pets_state(v_account) || jsonb_build_object('result', 'lost', 'why', 'outdated');
  end if;
  v_ev := jsonb_build_object('kind', r.kind, 'pet', r.pet_id, 'ticks', p_ticks, 'score', p_score,
                             'n', coalesce(cardinality(p_inputs), 0), 'inputs', to_jsonb(p_inputs[1:80]));
  v_bad := coalesce(public._pcare_input_error(r.kind, p_inputs, p_ticks), case when p_score is null then 'score' end,
                    l.meta->>'err');                                                                       -- 0087
  if v_bad is not null then
    v_code := 'pet_care_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._pcare_replay_p(r.kind, l.params::integer[], p_inputs);                                -- 0087
    if (v_rep->>'score')::int <> p_score then
      v_code := 'pet_care_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    elsif now() < r.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'pet_care_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', r.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'pet_care_late', 'pet_care_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              null, null, false);
      return public._pets_state(v_account) || jsonb_build_object('result', 'lost', 'why', 'late');
    -- 0087 }
    elsif (v_rep->>'suspicious')::boolean then
      perform public._ac_flag(v_account, 'pet_care_timing', 'pet_care_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'pet_care_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'pet_care_timing_repeat';
        v_ev := v_ev || jsonb_build_object('replay', v_rep, 'pattern', '5 in 24 h');
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'pet_care_finish', v_ev, null, 'invalid round');
    return public._pets_state(v_account) || jsonb_build_object('result', 'lost', 'why', 'refused') || v_ac;
  end if;
  select * into p from public.pets where id = r.pet_id and account_id = v_account for update;
  if not found then raise exception 'not your pet' using errcode = '22023'; end if;
  p := public._pet_now(p);
  v_pm := (v_rep->>'permille')::int;
  v_base_aff := case r.kind when 'feed' then 3 when 'pat' then 2 else 5 end;
  v_base_xp := case r.kind when 'feed' then 5 when 'pat' then 3 else 10 end;
  v_aff := public._pcare_gain(v_base_aff, v_pm);
  v_xp := public._pcare_gain(v_base_xp, v_pm);
  if r.kind = 'feed' then
    update public.pet_items set qty = qty - 1
     where account_id = v_account and item_id = 'food_' || p.species and qty > 0;
    if not found then raise exception 'no food' using errcode = '53400'; end if;
    update public.pets set fullness = least(100, p.fullness + 40), happy = least(100, p.happy + 5), stats_at = now(),
      affection = least(100, p.affection + v_aff) where id = p.id;
  elsif r.kind = 'pat' then
    update public.pets set affection = least(100, p.affection + v_aff) where id = p.id;
  else
    update public.pets set fullness = p.fullness, happy = least(100, p.happy + 25), stats_at = now(),
      affection = least(100, p.affection + v_aff) where id = p.id;
  end if;
  v_got := public._pet_care_xp(v_account, p.id, v_xp);
  perform public._game_event(v_account, 'pet_care', 1, jsonb_build_object('kind', r.kind, 'score', p_score, 'permille', v_pm));
  return public._pets_state(v_account)
         || jsonb_build_object('result', 'done', 'kind', r.kind, 'score', p_score, 'permille', v_pm,
                               'affection', v_aff, 'xp', v_got);
end $$;

-- _battle_json (0085_pet_minigames.sql's, verbatim but for the lines marked 0087: no press seed — the meter is
-- battle_press_open's)
create or replace function public._battle_json(b public.pet_battles, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('id', b.id, 'mode', b.mode, 'status', b.status, 'side', case when b.p1 = p_viewer then 1 else 2 end,
    'npc', b.npc, 'turn', b.turn, 'f1', b.f1, 'f2', b.f2, 'hp1', b.hp1, 'hp2', b.hp2, 'log', b.log, 'stake', b.stake,
    'winner', b.winner, 'reward', b.reward,
    'p1_name', (select username from public.accounts where id = b.p1),
    'p2_name', (select username from public.accounts where id = b.p2),
    'acted', case when b.p1 = p_viewer then b.a1 is not null else b.a2 is not null end,
    'foe_acted', case when b.p1 = p_viewer then b.a2 is not null else b.a1 is not null end,
    'deadline_ms', (extract(epoch from b.acted_at + interval '120 seconds') * 1000)::bigint)
    || jsonb_build_object('press_seed', null::bigint)                                                      -- 0087
$$;
revoke all on function public._battle_json(public.pet_battles, uuid) from public, anon, authenticated;

-- The power meter of my pick this turn (0087): a fresh meter [period 60–100, sweet spot 200–800 ‰] kept on the server;
-- the period now, the sweet spot via mg_sync('press') at a secret tick 0.3–0.8 s in. The meter's tick 0 is that game's
-- first sync.
create or replace function public.battle_press_open(p_session_token text, p_battle bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); b public.pet_battles; v_rd bigint[] := public._mg_roll('press');
begin
  select * into b from public.pet_battles where id = p_battle;
  if not found or b.status <> 'active' or (b.p1 <> v_account and b.p2 is distinct from v_account) then
    raise exception 'no battle' using errcode = '22023';
  end if;
  if (case when b.p1 = v_account then b.a1 else b.a2 end) is not null then raise exception 'already acted' using errcode = '53400'; end if;
  if exists (select 1 from public.mg_live where account_id = v_account and game = 'press' and opened_at > now() - interval '500 milliseconds') then
    raise exception 'too soon' using errcode = '53400';
  end if;
  perform public._mg_open(v_account, 'press', 'press', v_rd, 20 + floor(random() * 31)::int,
                          jsonb_build_object('battle', b.id, 'turn', b.turn));
  return jsonb_build_object('press', jsonb_build_object('battle', b.id, 'turn', b.turn, 'period', v_rd[1], 'live', 'press'));
end $$;
revoke all on function public.battle_press_open(text, bigint) from public;
grant execute on function public.battle_press_open(text, bigint) to anon, authenticated;

-- battle_act_press (0085_pet_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.battle_act_press(p_session_token text, p_battle bigint, p_skill text, p_press integer,
                                                   p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); b public.pet_battles; v_side int; v_bad text; v_code text;
        v_ev jsonb; v_ac jsonb; v_seed bigint; v_pw int; v_exact int;
        l public.mg_live; v_rd integer[]; v_t0 timestamptz;                                                -- 0087
begin
  perform public._battle_sweep();
  select * into b from public.pet_battles where id = p_battle for update;
  if not found or b.status <> 'active' or (b.p1 <> v_account and b.p2 is distinct from v_account) then
    raise exception 'no battle' using errcode = '22023';
  end if;
  v_side := case when b.p1 = v_account then 1 else 2 end;
  if not ((case v_side when 1 then b.f1 else b.f2 end)->'skills' ? p_skill) then
    raise exception 'unknown skill' using errcode = '22023';
  end if;
  if (case v_side when 1 then b.a1 else b.a2 end) is not null then raise exception 'already acted' using errcode = '53400'; end if;
  if b.mode = 'pve' and b.acted_at > now() - interval '300 milliseconds' then raise exception 'too soon' using errcode = '53400'; end if;
  -- 0087 { this turn's meter (battle_press_open); another battle's or turn's is no meter. A pick without a press (a
  -- guard, a heal, a hit let go: 850 ‰) needs none.
  l := public._mg_close(v_account, 'press', 'press', case when p_press is not null then array[p_press] end, null);
  if l.account_id is not null and ((l.meta->>'battle')::bigint is distinct from b.id or (l.meta->>'turn')::int is distinct from b.turn) then
    l := null;
  end if;
  if l.account_id is null and p_press is not null then raise exception 'press not open' using errcode = '22023'; end if;
  v_rd := l.params::integer[];
  v_t0 := coalesce(l.started_at, l.opened_at, b.acted_at);
  -- 0087 }
  v_ev := jsonb_build_object('battle', b.id, 'turn', b.turn, 'press', p_press, 'ticks', p_ticks);
  v_bad := coalesce(public._ppress_input_error(p_press, p_ticks), case when p_press is not null then l.meta->>'err' end,  -- 0087
                    case when p_press is not null and public._mg_early(l.started_at, array[p_press], l.seen[1]) then 'early' end);
  if v_bad is not null then
    v_code := 'battle_press_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif now() < v_t0 + make_interval(secs => 0.9 * p_ticks / 60.0) then                                   -- 0087: the meter's clock
    v_code := 'battle_press_too_fast';
    v_ev := v_ev || jsonb_build_object('acted_at', v_t0, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'battle_act_press', v_ev, null, 'invalid press');
    return public._battle_state(v_account, null) || v_ac;
  end if;
  -- 0087 { a press not made live (stamped > 2 s after its tick): the pick stands, the press is void (no press: 850 ‰)
  if p_press is not null and public._mg_late(l) then
    perform public._ac_flag(v_account, 'battle_press_late', 'battle_act_press', v_ev || jsonb_build_object('started_at', l.started_at),
                            null, null, false);
    p_press := null;
  end if;
  v_pw := public._ppress_power_p(v_rd, p_press);
  v_exact := case when p_press is not null and public._ppress_off_p(v_rd, p_press) <= 3 then 1 else 0 end;
  -- 0087 }
  if v_side = 1 then
    update public.pet_battles set a1 = p_skill, pw1 = v_pw, px1 = px1 + v_exact,
      a2 = case when b.mode = 'pve' then public._battle_ai(b.f2, b.hp2, b.heals2) else a2 end where id = b.id;
  else
    update public.pet_battles set a2 = p_skill, pw2 = v_pw, px2 = px2 + v_exact where id = b.id;
  end if;
  if v_exact = 1 and (case v_side when 1 then b.px1 else b.px2 end) + 1 = 6 then
    perform public._ac_flag(v_account, 'battle_press_timing', 'battle_act_press',
                            v_ev || jsonb_build_object('exact', 6, 'params', to_jsonb(v_rd)), null, null, false);  -- 0087
  end if;
  perform public._battle_turn(b.id);
  return public._battle_state(v_account, null)
         || jsonb_build_object('battle_now', (select public._battle_json(x, v_account) from public.pet_battles x where x.id = b.id),
                               'power', v_pw);
end $$;

-- ---------- G. Explore (0086) ----------
alter table public.boats add column if not exists home_fails smallint not null default 0;
alter table public.treasure_maps add column if not exists dig_loot integer;

-- river_row_start (0086_explore_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.river_row_start(p_room_id uuid, p_session_token text, p_dir text,
                                                  p_x integer default null, p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); g jsonb := public._river_geo(); v_ac jsonb;
        v_seed bigint := floor(random() * 4294967296)::bigint; v_x integer; v_y integer; v_need integer;
begin
  if p_dir is null or p_dir not in ('out', 'home') then raise exception 'bad direction' using errcode = '22023'; end if;
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  if p_dir = 'out' then
    v_x := (g->>'pier_x')::int;
    v_y := (g->>'pier_y')::int;
    v_ac := public._pos_claim(v_account, 'pond', v_x, v_y, 'river_row_start', p_room_id, 'too far');
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

-- river_row_finish (0086_explore_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.river_row_finish(p_room_id uuid, p_session_token text, p_strokes integer[],
                                                   p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); w public.river_rows; g jsonb := public._river_geo();
        v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_n integer := coalesce(cardinality(p_strokes), 0);
        v_map text; v_to jsonb; v_exact boolean;
        l public.mg_live;                                                                                  -- 0087
begin
  perform 1 from public.player_pos where account_id = v_account for update;
  delete from public.river_rows where account_id = v_account and room_id = p_room_id returning * into w;
  if not found then raise exception 'row not found' using errcode = '22023'; end if;
  l := public._mg_close(v_account, 'row', w.dir, p_strokes, null);                                         -- 0087
  v_map := case when w.dir = 'out' then 'pond' else 'song_cai' end;
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
  if w.dir = 'out' then
    perform public._river_move(v_account, 'song_cai', (g->>'arrive_x')::int, (g->>'arrive_y')::int);
    v_to := jsonb_build_object('map', 'song_cai', 'x', (g->>'arrive_x')::int, 'y', (g->>'arrive_y')::int, 'dir', 'right');
  else
    perform public._river_move(v_account, 'pond', (g->>'pier_x')::int, (g->>'pier_y')::int);
    v_to := jsonb_build_object('map', 'pond', 'x', (g->>'pier_x')::int, 'y', (g->>'pier_y')::int, 'dir', 'down');
  end if;
  return jsonb_build_object('result', 'arrived', 'hits', (v_rep->>'hits')::int, 'need', w.need, 'pass', v_rep->>'outcome' = 'pass',
                            'to', v_to);
end $$;

-- treasure_dig_start (0086_explore_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.treasure_dig_start(p_room_id uuid, p_session_token text, p_map_id uuid, p_map text,
                                                     p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); t public.treasure_maps; s public.treasure_spots;
        v_ac jsonb; v_d numeric; v_loot integer; v_seed bigint := floor(random() * 4294967296)::bigint;
        v_rd bigint[];                                                                                     -- 0087
begin
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  select * into t from public.treasure_maps where id = p_map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if t.last_dig_at is not null and t.last_dig_at > now() - interval '4 seconds' then
    raise exception 'dig cooldown' using errcode = '22023', detail = '4';
  end if;
  v_ac := public._pos_claim(v_account, p_map, p_x, p_y, 'treasure_dig_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  update public.treasure_maps set last_dig_at = now(), digs = digs + 1 where id = t.id;
  select * into s from public.treasure_spots where id = t.spot;
  if s.map <> p_map then
    return jsonb_build_object('result', 'miss', 'heat', 'wrong_map', 'map', public._treasure_json(t));
  end if;
  v_d := sqrt((s.x - p_x) ^ 2 + (s.y - p_y) ^ 2);
  if v_d > 16 then
    return jsonb_build_object('result', 'miss', 'heat', case when v_d <= 48 then 'hot' when v_d <= 120 then 'warm' else 'cold' end,
                              'band', public._treasure_band(v_d), 'map', public._treasure_json(t));
  end if;
  perform public._stamina_spend(v_account, 3, 'mine');
  perform public._fishing_effort(v_account, 0.6, 0.8);
  -- 0076's loot: 400–2 500 xu, one chest in twenty a jackpot of 8 000
  -- 0087 { rolled ONCE per map: a give-up or a restart digs up the same chest
  v_loot := coalesce(t.dig_loot, case when random() < 0.05 then 8000 else 400 + floor(random() * 2101)::int end);
  if t.dig_loot is null then update public.treasure_maps set dig_loot = v_loot where id = t.id; end if;
  v_rd := public._mg_roll('dig', null, 3);
  -- 0087 }
  insert into public.treasure_digs (account_id, room_id, map_id, map, x, y, seed, need, win, loot, started_at)
  values (v_account, p_room_id, t.id, p_map, p_x, p_y, v_seed, 3, 120, v_loot, now())
  on conflict (account_id) do update set room_id = excluded.room_id, map_id = excluded.map_id, map = excluded.map,
    x = excluded.x, y = excluded.y, seed = excluded.seed, need = excluded.need, win = excluded.win, loot = excluded.loot,
    started_at = excluded.started_at;
  -- 0087 { the veins stay on the server: the first at a secret tick, each next one when the strike that found the last
  -- one is stamped (mg_sync('dig'))
  perform public._mg_open(v_account, 'dig', 'dig', v_rd, 20 + floor(random() * 21)::int, jsonb_build_object('win', 120));
  return jsonb_build_object('result', 'dig', 'dig', jsonb_build_object('need', 3, 'win', 120, 'period', v_rd[1], 'live', 'dig',
                                                                       'started_at', now()));
  -- 0087 }
end $$;

-- treasure_dig_finish (0086_explore_minigames.sql's, verbatim but for the lines marked 0087)
create or replace function public.treasure_dig_finish(p_room_id uuid, p_session_token text, p_strikes integer[],
                                                      p_ticks integer, p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); d public.treasure_digs; t public.treasure_maps;
        s public.treasure_spots; v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_tm jsonb;
        v_n integer := coalesce(cardinality(p_strikes), 0); v_loot integer; v_clean boolean; v_exact boolean;
        l public.mg_live;                                                                                  -- 0087
begin
  perform public._wallet_lock(v_account);                                                                  -- 0087: the start's order
  perform 1 from public.player_pos where account_id = v_account for update;
  delete from public.treasure_digs where account_id = v_account and room_id = p_room_id returning * into d;
  if not found then raise exception 'dig not found' using errcode = '22023'; end if;
  l := public._mg_close(v_account, 'dig', 'dig', p_strikes, null);                                         -- 0087
  v_ac := public._pos_claim(v_account, d.map, d.x, d.y, 'treasure_dig_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into t from public.treasure_maps where id = d.map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if now() > d.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  if l.account_id is null then return jsonb_build_object('result', 'lost', 'why', 'outdated'); end if;   -- 0087
  v_ev := jsonb_build_object('map', d.map_id, 'pass', p_pass, 'ticks', p_ticks, 'n', v_n, 'strikes', to_jsonb(p_strikes[1:12]));
  v_bad := coalesce(public._mine_input_error(p_strikes, p_ticks), case when p_pass is null then 'pass' end,
                    l.meta->>'err', case when public._mg_dig_early(l, d.win) then 'early' end);            -- 0087
  if v_bad is not null then
    v_code := 'treasure_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  -- 0087 { every finish is replayed, a give-up too (it may not claim a pass it did not dig, nor end sooner than its ticks)
  else
    v_rep := public._mine_replay_p(l.params::integer[], d.need, d.win, p_strikes);
    if (p_pass and (v_rep->>'outcome' <> 'pass' or (v_rep->>'ticks')::int <> p_ticks or (v_rep->>'used')::int <> v_n))
       or (not p_pass and v_rep->>'outcome' = 'pass') then
      v_code := 'treasure_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'need', d.need, 'win', d.win, 'replay', v_rep);
    elsif now() < d.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'treasure_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', d.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'treasure_late', 'treasure_dig_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              p_room_id, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late');
    end if;
  end if;
  if v_code is null and p_pass then
  -- 0087 }
    v_tm := public._mine_timing_p(l.params::integer[], d.need, d.win, p_strikes);                          -- 0087
    v_exact := (v_tm->>'used')::int = d.need and (v_tm->>'exact')::int = d.need;
    perform public._ac_stat(v_account, 'treasure', 1, 1, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'treasure_timing', 'treasure_dig_finish', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'treasure_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'treasure_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  elsif v_code is null and p_pass is false then
    perform public._ac_stat(v_account, 'treasure', 1, 0, 0);
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'treasure_dig_finish', v_ev, p_room_id, 'invalid dig');
    return jsonb_build_object('result', 'lost', 'why', 'refused') || v_ac;
  end if;
  if not p_pass then
    return jsonb_build_object('result', 'lost', 'why', 'gave_up');
  end if;
  v_clean := (v_rep->>'used')::int = d.need;
  v_loot := case when d.loot = 8000 then 8000 when v_clean then least(2500, round(d.loot * 1.1)::int) else d.loot end;
  select * into s from public.treasure_spots where id = t.spot;
  update public.treasure_maps set found_at = now(), loot = v_loot where id = t.id;
  perform public._pay(v_account, v_loot, 'treasure', 'map ' || t.id);
  perform public._game_event(v_account, 'treasure_found', v_loot, jsonb_build_object('map', s.map, 'spot', s.id));
  perform public._game_event(v_account, 'xp_grant', 50, '{"source":"fishing"}'::jsonb);
  return jsonb_build_object('result', 'found', 'loot', v_loot, 'jackpot', v_loot = 8000, 'clean', v_clean,
                            'coins', (select coins from public.wallets where account_id = v_account));
end $$;

-- ---------- H. Mining (0072 / 0078) ----------
-- mine_start (0078_v21_fixes.sql's, verbatim but for the lines marked 0087)
create or replace function public.mine_start(p_room_id uuid, p_session_token text, p_node integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_use integer[]; v_ac jsonb; mp public.mining_profiles;
        n public.mine_nodes; it public.craft_items; v_tool text; v_tier integer; v_level integer; v_win integer;
        v_seed bigint := floor(random() * 4294967296)::bigint; v_today date := public._vn_today();
        v_rd bigint[];                                                                                     -- 0087
begin
  if p_node is null or p_node not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_spot', 'mine_start', jsonb_build_object('node', p_node), p_room_id, 'invalid spot');
  end if;
  v_use := public._mine_node_use(p_node);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'mine_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  perform public._vitals_guard(v_account);
  mp := public._mining_profile(v_account);
  if mp.day_on = v_today and mp.day_digs >= 400 then
    raise exception 'daily dig limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  delete from public.mine_digs where account_id = v_account;   -- 0078: the dig before the node, as mine_finish
  n := public._mine_node(p_room_id, p_node);
  if n.ready_at > now() then raise exception 'node empty' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = n.item_id;
  select t.tool_id, k.tier into v_tool, v_tier
    from public.mine_tools t join public.pickaxe_kinds k on k.id = t.tool_id
   where t.account_id = v_account and t.durability > 0 and k.tier >= it.min_tier
   order by k.tier desc limit 1;
  if v_tool is null then
    if exists (select 1 from public.mine_tools where account_id = v_account and durability > 0) then
      raise exception 'pickaxe too weak' using errcode = '22023';
    end if;
    raise exception 'no pickaxe' using errcode = '22023';
  end if;
  v_level := public._upgrade_level(v_account, v_tool);
  v_win := public._mine_win(v_tier, v_level);
  insert into public.mine_digs (account_id, room_id, node_no, item_id, tool_id, seed, need, win)
  values (v_account, p_room_id, p_node, it.id, v_tool, v_seed, it.hardness, v_win);
  update public.mining_profiles
     set day_digs = case when day_on = v_today then day_digs + 1 else 1 end, day_on = v_today
   where account_id = v_account;
  -- 0087 { the veins stay on the server (as the treasure dig's)
  v_rd := public._mg_roll('mine', null, it.hardness);
  perform public._mg_open(v_account, 'mine', 'mine', v_rd, 20 + floor(random() * 21)::int, jsonb_build_object('win', v_win));
  return jsonb_build_object('dig', jsonb_build_object('node', p_node, 'item', it.id, 'tool', v_tool, 'period', v_rd[1],
                                                      'need', it.hardness, 'win', v_win, 'live', 'mine', 'started_at', now()),
                            'state', public._mine_state(p_room_id, v_account));
  -- 0087 }
end $$;

-- mine_finish (0078_v21_fixes.sql's, verbatim but for the lines marked 0087)
create or replace function public.mine_finish(p_room_id uuid, p_session_token text, p_strikes integer[], p_ticks integer,
                                              p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); d public.mine_digs; v_use integer[]; v_ac jsonb;
        v_bad text; v_rep jsonb; v_code text; v_ev jsonb; n public.mine_nodes; it public.craft_items; v_qty integer;
        v_perfect boolean; v_buff integer; v_dur integer; v_vit jsonb; v_n integer := coalesce(cardinality(p_strikes), 0);
        v_tm jsonb; v_exact boolean;                                                           -- 0078
        l public.mg_live;                                                                                  -- 0087
begin
  perform 1 from public.player_pos where account_id = v_account for update;   -- 0078: pos → dig → node, as mine_start
  delete from public.mine_digs where account_id = v_account and room_id = p_room_id returning * into d;
  if not found then raise exception 'dig not found' using errcode = '22023'; end if;
  l := public._mg_close(v_account, 'mine', 'mine', p_strikes, null);                                       -- 0087
  v_use := public._mine_node_use(d.node_no);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'mine_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  -- the wear of any finished dig
  update public.mine_tools set durability = greatest(0, durability - 1)
   where account_id = v_account and tool_id = d.tool_id
     and durability > 0                                                               -- 0078
  returning durability into v_dur;
  -- 0078 {
  -- the pickaxe the dig started with must still be there, with durability left
  if not found then
    return jsonb_build_object('result', 'lost', 'why', 'no_pickaxe', 'tool_broke', true,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  -- 0078 }
  if now() > d.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  if l.account_id is null then                                                                             -- 0087
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  v_ev := jsonb_build_object('node', d.node_no, 'pass', p_pass, 'ticks', p_ticks, 'n', v_n, 'strikes', to_jsonb(p_strikes[1:12]));
  v_bad := coalesce(public._mine_input_error(p_strikes, p_ticks), case when p_pass is null then 'pass' end,
                    l.meta->>'err', case when public._mg_dig_early(l, d.win) then 'early' end);            -- 0087
  if v_bad is not null then
    v_code := 'mine_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif p_pass then
    v_rep := public._mine_replay_p(l.params::integer[], d.need, d.win, p_strikes);                         -- 0087
    if v_rep->>'outcome' <> 'pass' or (v_rep->>'ticks')::int <> p_ticks or (v_rep->>'used')::int <> v_n then
      v_code := 'mine_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'need', d.need, 'win', d.win, 'replay', v_rep);  -- 0087
    elsif now() < d.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'mine_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', d.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'mine_late', 'mine_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              p_room_id, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late', 'tool_broke', coalesce(v_dur, 0) = 0,
                                'state', public._mine_state(p_room_id, v_account));
    -- 0087 }
    end if;
  end if;
  -- 0078 {
  -- the dig's timing (0065's harvest_timing): every strike a hit on the marker's best tick, over ≥ 3 hits, is soft; the
  -- 5th such dig in 24 h is hard and mines nothing
  if v_code is null and v_rep is not null then
    v_tm := public._mine_timing_p(l.params::integer[], d.need, d.win, p_strikes);                          -- 0087
    v_exact := d.need >= 3 and (v_tm->>'used')::int = d.need and (v_tm->>'exact')::int = d.need;
    perform public._ac_stat(v_account, 'mine', 1, 1, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'mine_timing', 'mine_finish', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'mine_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'mine_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  elsif v_code is null and p_pass is false then
    perform public._ac_stat(v_account, 'mine', 1, 0, 0);
  end if;
  -- 0078 }
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'mine_finish', v_ev, p_room_id, 'invalid dig');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account)) || v_ac;
  end if;
  if not p_pass then
    return jsonb_build_object('result', 'lost', 'why', 'gave_up', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  n := public._mine_node(p_room_id, d.node_no);
  if n.ready_at > now() or n.item_id <> d.item_id then
    return jsonb_build_object('result', 'lost', 'why', 'taken', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  select * into it from public.craft_items where id = d.item_id;
  v_perfect := (v_rep->>'used')::int = d.need;
  v_buff := public._buff_power(v_account, 'miner');
  v_qty := 1 + case when v_perfect then 1 else 0 end + case when v_buff > 0 then 1 else 0 end;
  update public.mine_nodes set item_id = public._mine_roll(d.node_no, random()),
                               ready_at = now() + make_interval(secs => it.respawn_s)
   where room_id = p_room_id and node_no = d.node_no;
  perform public._bag_add(v_account, it.id, v_qty);
  v_vit := public._fishing_effort(v_account, 1.5, 2.0);
  perform public._game_event(v_account, 'ore_mined', v_qty,
    jsonb_build_object('item', it.id, 'rarity', it.rarity, 'node', d.node_no, 'perfect', v_perfect));
  perform public._game_event(v_account, 'xp_grant', it.xp * v_qty, '{"source":"mining"}'::jsonb);
  return jsonb_build_object('result', 'mined', 'item', it.id, 'qty', v_qty, 'perfect', v_perfect, 'buff', v_buff > 0,
                            'xp', it.xp * v_qty, 'tool_broke', coalesce(v_dur, 0) = 0, 'vitals', v_vit,
                            'state', public._mine_state(p_room_id, v_account));
end $$;

-- ---------- I. The wipe ----------
create or replace function public._mg_live_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.mg_live where account_id = new.account_id;
  return new;
end $$;
revoke all on function public._mg_live_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_mg_live on public.anticheat_wipes;
create trigger anticheat_wipes_mg_live after insert on public.anticheat_wipes for each row execute function public._mg_live_on_wipe();
