-- =========================================================
-- 0049_fight_matches.sql — v20.2 Võ đài: the refereed-match pipeline (spec docs/superpowers/specs/
-- 2026-09-28-v20-fight-design.md §v20.2 "The refereed-match pipeline", plan docs/superpowers/plans/
-- 2026-09-28-v20-2-dojo.md). ADDITIVE and re-runnable. Run after 0048, together with 0050 (a few bodies below read
-- 0050's tables or call _dojo_exam_settle; plpgsql binds them at call time — plan ruling P1).
--   A. Tables: fight_matches (one row per refereed match: params, the server's sim, the outcome), fight_logs (each
--      side's canonical inputs as RLE runs), fight_profiles (the outfit a uniform replaced; PvP records for v20.3).
--   B. The bot mirror (lib/game/fight/bot.ts, statement for statement; TS index i is SQL index i + 1):
--        _fx_bot_script(id)          the bot's input scripts (SCRIPTS, motionScript), relative masks
--        _fx_rng(state)              one mulberry32 step (0046's _reel_rand) on the int32 PRNG state: {u32, next}
--        _fx_bot(s, side, m)         botInput: the state with the bot's memory and the PRNG advanced, then the mask
--                                    (element 177)
--        _fx_step_bots(s, a, b, m)   stepWithBots: a bot side's mask comes from _fx_bot, then 0048's _fx_step
--        _fx_run_bots(s, a[], b[], m) steps over per-frame masks with the bots (a missing mask is 0)
--        _fx_runs_slice(runs, f, n)  frames [f, f + n) of RLE runs as per-frame masks (0 past the end)
--        _fx_runs_encode(masks)      per-frame masks → RLE runs (log.ts encodeRuns)
--      tests/fixtures/fight-bot-cases.json pins them to the TS (tests/sql/v20-2-smoke.sql).
--   C. Settlement: _fx_rounds_json, _fx_settle (dispatching on kind: 'exam' → 0050's _dojo_exam_settle), the vitals
--      cost (2 hunger and 3 thirst per round played, R6), _fx_sweep (a bot match with no push for 60 s is the player's
--      loss, 'abandon'), _fx_vitals_ok (R6's entry gate), _fx_style_of (the worn uniform's style and rank).
--   D. RPCs: fight_push (the streamed replay, R3), fight_state, fight_forfeit, fight_wear_uniform, fight_unwear_uniform.
-- Anti-cheat (0015 envelope, never a raise for the input itself): hard fight_bad_input (malformed runs, a gap, an
-- overlap that differs), hard fight_too_fast (the frontier more than 60 frames ahead of the wall clock) — in a bot match
-- either also settles the match as the player's loss (plan ruling P5); soft fight_hash_mismatch (the client's sim
-- disagrees with the replay: resync), soft fight_superhuman (plan ruling P10). A settled or stale match is an answer.
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.fight_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid null references public.rooms(id) on delete set null,
  kind text not null check (kind in ('exam', 'pvp', 'ug_rated', 'ug_ladder', 'ug_cup')),
  status text not null default 'live' check (status in ('live', 'done', 'void', 'disputed')),
  p1 uuid not null references public.accounts(id) on delete cascade,     -- red
  p2 uuid null references public.accounts(id) on delete cascade,         -- blue; null = a bot
  params jsonb not null,                                                 -- the full MatchParams (camelCase)
  stake integer not null default 0 check (stake >= 0),
  ring smallint null,
  ref text null,                                                         -- the exam id, ladder floor or cup id
  created_at timestamptz not null default now(),
  started_at timestamptz not null,                                       -- frame 0 in server time
  ended_at timestamptz null,
  sim integer[] not null,                                                -- the server's state after sim_frame frames
  sim_frame integer not null default 0,
  sim_hash bigint null,
  rounds jsonb null,
  winner smallint null check (winner in (0, 1, 2)),
  end_reason text null check (end_reason in ('ko', 'decision', 'forfeit', 'timeout_claim', 'abandon', 'conflict', 'overtime')),
  result jsonb null,                                                     -- the settlement's answer (kept for fight_state)
  resyncs smallint not null default 0
);
create index if not exists fight_matches_p1_live on public.fight_matches (p1) where status = 'live';
create index if not exists fight_matches_p2_live on public.fight_matches (p2) where status = 'live';
create index if not exists fight_matches_ended on public.fight_matches (ended_at);
alter table public.fight_matches enable row level security;
revoke all on public.fight_matches from anon, authenticated;

create table if not exists public.fight_logs (
  match_id uuid not null references public.fight_matches(id) on delete cascade,
  side smallint not null check (side in (1, 2)),
  account_id uuid not null references public.accounts(id) on delete cascade,
  runs integer[] not null default '{}',              -- the canonical own inputs, RLE [mask, count, …]
  frontier integer not null default -1,              -- the last frame covered
  seen_runs integer[] null,                          -- the opponent's inputs as received (PvP, v20.3)
  seen_frontier integer null,
  last_push_at timestamptz null,
  pushes integer not null default 0,
  stall_frames integer not null default 0,
  bad_hashes integer not null default 0,
  ac integer[] not null default '{-1000,0,0,0}',     -- {foe's last move start, fast reactions, busy frames, flagged}
  primary key (match_id, side)
);
alter table public.fight_logs enable row level security;
revoke all on public.fight_logs from anon, authenticated;

create table if not exists public.fight_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  prev_outfit text null references public.item_catalog(id) on delete set null,   -- what a uniform replaced
  wins integer not null default 0,                    -- refereed PvP only (v20.3)
  losses integer not null default 0,
  draws integer not null default 0,
  day_on date null,
  staked_today integer not null default 0,
  pvp_locked_until timestamptz null
);
alter table public.fight_profiles enable row level security;
revoke all on public.fight_profiles from anon, authenticated;

-- ---------- B. The bot mirror ----------
-- bot.ts SCRIPTS (1 throw/tech, 2 cr.HP, 3 LK, 4 cr.LK, 5 LP, 6 HP, 7 sweep, 8 jump-in) and, for 100 + motion × 8 +
-- button class, motionScript. Relative masks: 1 back, 2 forward, 4 up, 8 down, 16 LP, 32 HP, 64 LK, 128 HK.
create or replace function public._fx_bot_script(id integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare mo integer; bt integer; k integer;
begin
  if id >= 100 then
    mo := (id - 100) >> 3;
    bt := (id - 100) & 7;
    k := case bt when 1 then 16 when 2 then 64 when 3 then 32 when 4 then 128 else 16 end;
    return case mo
      when 1 then array[8, 10, 2 | k]
      when 2 then array[8, 9, 1 | k]
      when 3 then array[2, 8, 10, 10 | k]
      when 4 then array[8, 0, 8 | k]
      when 5 then array[8, 10, 2, 8, 10, 2 | k]
      else array[k] end;
  end if;
  return case id
    when 1 then array[80]
    when 2 then array[40, 8, 8, 8]
    when 3 then array[64]
    when 4 then array[72, 8, 8]
    when 5 then array[16]
    when 6 then array[32]
    when 7 then array[136, 8, 8]
    when 8 then array[6, 6, 6, 6] || array_fill(0, array[29]) || array[128]
    else '{}'::integer[] end;
end $$;

-- one mulberry32 step on the state's int32 PRNG: {output u32, next state as int32}
create or replace function public._fx_rng(st integer) returns bigint[]
language sql immutable parallel safe
as $$
  select array[r[1], case when r[2] >= 2147483648 then r[2] - 4294967296 else r[2] end]
    from (select public._reel_rand(st::bigint & 4294967295) r) x
$$;

-- bot.ts BOT_LEVELS[level]: {d, block, aa, special, tech, combo}
create or replace function public._fx_bot_level(level integer) returns integer[]
language sql immutable parallel safe
as $$
  select case level
    when 1 then array[24, 15, 10, 10, 0, 0]
    when 2 then array[20, 30, 25, 15, 10, 1]
    when 3 then array[16, 45, 40, 20, 20, 2]
    when 4 then array[13, 55, 55, 25, 30, 3]
    when 5 then array[11, 62, 65, 30, 40, 4]
    when 6 then array[9, 70, 72, 35, 50, 4]
    when 7 then array[8, 76, 80, 40, 60, 5]
    when 8 then array[7, 82, 88, 45, 70, 5] end
$$;

-- specialScript: the script id of special `slot` when unlocked and affordable, else 0
create or replace function public._fx_bot_special(s integer[], b integer, slot integer, m integer[]) returns integer
language plpgsql immutable parallel safe
as $$
declare id integer := s[b + 48] * 18 + 12 + slot;
begin
  if m[id * 32 + 0 + 1] = 0 or (s[b + 50] & (1 << (slot - 1))) = 0 then return 0; end if;
  if s[b + 6] < m[id * 32 + 22 + 1] then return 0; end if;
  return 100 + m[id * 32 + 2 + 1] * 8 + m[id * 32 + 3 + 1];
end $$;

-- botInput (b = the bot's 1-based base 49 / 113, o the foe's): returns s || the absolute mask
create or replace function public._fx_bot(s integer[], side integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare
  b integer := 49 + side * 64; o integer := 49 + (1 - side) * 64; level integer := s[b + 57]; lv integer[];
  f integer; a integer; rel integer := 0; sc integer[]; rr bigint[]; r integer; r2 integer; dist integer;
  foe_air boolean; oa integer; id integer; af integer; act integer; foe_startup boolean := false;
  foe_recovery boolean := false; foe_low boolean := false; foe_special boolean := false; dp integer; tk integer;
  s1 integer; sp integer; slot integer; decided boolean; mk integer; face integer;
begin
  if level <= 0 or level = 9 or s[1 + 1] <> 1 then return s || 0; end if;
  lv := public._fx_bot_level(level);
  if lv is null then return s || 0; end if;
  f := s[0 + 1] + 1;
  a := s[b + 7];
  -- thrown: one tech roll per throw
  if a = 16 then
    if (s[b + 63] & 2) = 0 then
      s[b + 63] := s[b + 63] | 2;
      rr := public._fx_rng(s[5 + 1]); s[5 + 1] := rr[2]::integer;
      if rr[1] % 100 < lv[5] then s[b + 58] := 1; s[b + 59] := 0; s[b + 62] := 0; end if;
    end if;
  else
    s[b + 63] := s[b + 63] & (~2);
  end if;
  -- a poke that connected cancels into a special
  if (s[b + 63] & 1) <> 0 and a = 9 and s[b + 10] > 0 and s[b + 58] = 0 then
    s[b + 63] := s[b + 63] & (~1);
    sp := public._fx_bot_special(s, b, 1, m);
    if sp <> 0 then s[b + 58] := sp; s[b + 59] := 0; s[b + 62] := 0; end if;
  end if;
  if s[b + 58] <> 0 then
    sc := public._fx_bot_script(s[b + 58]);
    rel := coalesce(sc[s[b + 59] + 1], 0);
    s[b + 59] := s[b + 59] + 1;
    if s[b + 59] >= coalesce(cardinality(sc), 0) then s[b + 58] := 0; end if;
  elsif s[b + 62] > 0 then
    rel := s[b + 61];
    s[b + 62] := s[b + 62] - 1;
  elsif f >= s[b + 60] and (public._fx_free(s, b, m) or a = 12 or a = 7) then
    if a <> 7 then
      -- decide
      decided := false;
      dist := abs(s[o + 0] - s[b + 0]) / 256;
      foe_air := public._fx_air(s, o);
      oa := s[o + 7];
      if oa = 9 or oa = 10 then
        id := s[o + 9] - 1;
        af := s[o + 8];
        act := m[id * 32 + 4 + 1] + m[id * 32 + 5 + 1];
        foe_startup := coalesce(af <= act, false);
        foe_recovery := coalesce(af > act, false);
        foe_low := coalesce(m[id * 32 + 15 + 1] = 2, false);
        foe_special := coalesce(m[id * 32 + 1 + 1] > 0, false);
      end if;
      s[b + 60] := f + lv[1];
      rr := public._fx_rng(s[5 + 1]); s[5 + 1] := rr[2]::integer; r := (rr[1] % 100)::integer;
      if foe_air and dist < 100 and r < lv[3] then
        dp := case when level >= 3 then public._fx_bot_special(s, b, 3, m) else 0 end;
        s[b + 58] := case when dp <> 0 and ((dp - 100) >> 3) = 3 then dp else 2 end; s[b + 59] := 0; s[b + 62] := 0;
        decided := true;
      end if;
      if not decided and foe_startup and dist < 80 and r < lv[2] then
        s[b + 58] := 0; s[b + 61] := case when foe_low then 9 else 1 end; s[b + 62] := lv[1];
        decided := true;
      end if;
      if not decided and lv[6] >= 4 and s[b + 6] >= 1000 and dist < 70 then
        tk := public._fx_bot_special(s, b, 5, m);
        if tk <> 0 then s[b + 58] := tk; s[b + 59] := 0; s[b + 62] := 0; decided := true; end if;
      end if;
      if not decided and lv[6] >= 5 and foe_recovery and foe_special and dist < 90 then
        s1 := public._fx_bot_special(s, b, 1, m);
        s[b + 58] := case when s1 <> 0 then s1 else 6 end; s[b + 59] := 0; s[b + 62] := 0;
        decided := true;
      end if;
      if not decided then
        rr := public._fx_rng(s[5 + 1]); s[5 + 1] := rr[2]::integer; r2 := (rr[1] % 100)::integer;
        if dist > 44 then
          s1 := public._fx_bot_special(s, b, 1, m);
          if r2 < lv[4] and s1 <> 0 then s[b + 58] := s1; s[b + 59] := 0; s[b + 62] := 0;
          elsif r2 < lv[4] + 20 and level >= 2 then s[b + 58] := 8; s[b + 59] := 0; s[b + 62] := 0;
          else s[b + 58] := 0; s[b + 61] := 2; s[b + 62] := lv[1];
          end if;
          decided := true;
        end if;
        if not decided and dist < 30 and r2 < 15 and level >= 2 then
          s[b + 58] := 1; s[b + 59] := 0; s[b + 62] := 0;
          decided := true;
        end if;
        if not decided and r2 < lv[4] then
          rr := public._fx_rng(s[5 + 1]); s[5 + 1] := rr[2]::integer;
          slot := 1 + ((rr[1] % 100)::integer % 4);
          sp := public._fx_bot_special(s, b, slot, m);
          if sp = 0 then sp := public._fx_bot_special(s, b, 1, m); end if;
          if sp <> 0 then s[b + 58] := sp; s[b + 59] := 0; s[b + 62] := 0; decided := true; end if;
        end if;
        if not decided and r2 < lv[4] + 45 then
          rr := public._fx_rng(s[5 + 1]); s[5 + 1] := rr[2]::integer;
          s[b + 58] := 3 + ((rr[1] % 100)::integer % 5); s[b + 59] := 0; s[b + 62] := 0;
          if lv[6] >= 1 then s[b + 63] := s[b + 63] | 1; end if;
          decided := true;
        end if;
        if not decided and r2 < lv[4] + 55 then
          s[b + 58] := 0; s[b + 61] := 1; s[b + 62] := lv[1] >> 1;
          decided := true;
        end if;
        if not decided then
          s[b + 58] := 0; s[b + 61] := 2; s[b + 62] := lv[1] >> 1;
        end if;
      end if;
      if s[b + 58] <> 0 then
        sc := public._fx_bot_script(s[b + 58]);
        rel := coalesce(sc[1], 0);
        s[b + 59] := 1;
        if coalesce(cardinality(sc), 0) <= 1 then s[b + 58] := 0; end if;
      elsif s[b + 62] > 0 then
        rel := s[b + 61];
        s[b + 62] := s[b + 62] - 1;
      end if;
    end if;
  end if;
  -- absolute: back / forward → left / right for the bot's facing
  face := s[b + 4];
  mk := rel & (~3);
  if (rel & 1) <> 0 then mk := mk | case when face > 0 then 1 else 2 end; end if;
  if (rel & 2) <> 0 then mk := mk | case when face > 0 then 2 else 1 end; end if;
  return s || mk;
end $$;

-- stepWithBots
create or replace function public._fx_step_bots(s integer[], a integer, b integer, m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare r integer[];
begin
  if s[49 + 57] > 0 then
    r := public._fx_bot(s, 0, m);
    a := r[177];
    s := r[1:176];
  end if;
  if s[113 + 57] > 0 then
    r := public._fx_bot(s, 1, m);
    b := r[177];
    s := r[1:176];
  end if;
  return public._fx_step(s, a, b, m);
end $$;

create or replace function public._fx_run_bots(s integer[], a integer[], b integer[], m integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare k integer; n integer := greatest(coalesce(cardinality(a), 0), coalesce(cardinality(b), 0));
begin
  for k in 1..n loop
    s := public._fx_step_bots(s, coalesce(a[k], 0), coalesce(b[k], 0), m);
  end loop;
  return s;
end $$;

-- frames [p_from, p_from + p_n) of RLE runs, one mask per frame (0 past the log's end)
create or replace function public._fx_runs_slice(p_runs integer[], p_from integer, p_n integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare out_ integer[] := '{}'; pos integer := 0; i integer; c integer; lo integer; hi integer; n integer := coalesce(cardinality(p_runs), 0);
begin
  if p_n <= 0 then return out_; end if;
  i := 1;
  while i < n and pos < p_from + p_n loop
    c := p_runs[i + 1];
    lo := greatest(pos, p_from);
    hi := least(pos + c, p_from + p_n);
    if hi > lo then out_ := out_ || array_fill(p_runs[i], array[hi - lo]); end if;
    pos := pos + c;
    i := i + 2;
  end loop;
  if coalesce(cardinality(out_), 0) < p_n then out_ := out_ || array_fill(0, array[p_n - coalesce(cardinality(out_), 0)]); end if;
  return out_;
end $$;

-- per-frame masks → RLE runs
create or replace function public._fx_runs_encode(p_masks integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare out_ integer[] := '{}'; v integer; cur integer; c integer := 0;
begin
  foreach v in array coalesce(p_masks, '{}'::integer[]) loop
    if c > 0 and v = cur then c := c + 1;
    else
      if c > 0 then out_ := out_ || array[cur, c]; end if;
      cur := v;
      c := 1;
    end if;
  end loop;
  if c > 0 then out_ := out_ || array[cur, c]; end if;
  return out_;
end $$;

-- ---------- C. Settlement ----------
-- the per-round results of a state: [{reason, winner, hp1, hp2, frame}] (engine.ts roundResults)
create or replace function public._fx_rounds_json(s integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare out_ jsonb := '[]'; r integer; code integer;
begin
  for r in 0..4 loop
    code := s[12 + r * 4 + 1];
    exit when code is null or code = 0;
    out_ := out_ || jsonb_build_array(jsonb_build_object('reason', code >> 2, 'winner', code & 3,
      'hp1', s[12 + r * 4 + 2], 'hp2', s[12 + r * 4 + 3], 'frame', s[12 + r * 4 + 4]));
  end loop;
  return out_;
end $$;

-- R6: refereed fights need _vitals_guard and hunger and thirst of at least 10
create or replace function public._fx_vitals_ok(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.vitals;
begin
  perform public._vitals_guard(p_account);
  select * into v from public.vitals where account_id = p_account;
  if coalesce(v.hunger, 0) < 10 then raise exception 'too hungry to fight' using errcode = '53400'; end if;
  if coalesce(v.thirst, 0) < 10 then raise exception 'too thirsty to fight' using errcode = '53400'; end if;
end $$;

-- the fighter a worn uniform makes: {engine style id, rank, style row id} — 'no uniform' when none is worn, or it is
-- the uniform of a style not enrolled (0050's martial_styles / martial_enrollments)
create or replace function public._fx_style_of(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_outfit text; v jsonb;
begin
  select outfit into v_outfit from public.characters where account_id = p_account;
  select jsonb_build_object('style', s.id, 'idx', s.sort, 'rank', e.rank, 'atk', s.atk, 'def', s.def, 'walk', s.walk,
                            'jump', s.jump, 'energy', s.energy)
    into v
    from public.martial_styles s join public.martial_enrollments e on e.style = s.id and e.account_id = p_account
   where s.uniform = v_outfit;
  if v is null then raise exception 'no uniform' using errcode = '22023'; end if;
  return v;
end $$;

-- A match's outcome: status 'done', the winner (1, 2, 0 = draw), the reason, the rounds, the vitals cost for each
-- player (R6: 2 hunger and 3 thirst per round played, plan ruling P9), and what the kind adds (an exam: the belt).
-- The caller holds the match row's lock. Returns the result (also kept on the row).
create or replace function public._fx_settle(p_match uuid, p_winner smallint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; n integer; v_acc uuid; v_res jsonb; v_extra jsonb := '{}'::jsonb;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then return null; end if;
  if mt.status <> 'live' then return mt.result; end if;
  n := greatest(1, coalesce(mt.sim[3 + 1], 1));
  update public.fight_matches
     set status = 'done', winner = p_winner, end_reason = p_reason, ended_at = now(), rounds = public._fx_rounds_json(mt.sim)
   where id = p_match;
  foreach v_acc in array array_remove(array[mt.p1, mt.p2], null) loop
    perform public._vitals_apply(v_acc);
    update public.vitals set hunger = greatest(0, hunger - 2 * n), thirst = greatest(0, thirst - 3 * n)
     where account_id = v_acc;
  end loop;
  if mt.kind = 'exam' then v_extra := coalesce(public._dojo_exam_settle(p_match, p_winner), '{}'::jsonb); end if;
  v_res := jsonb_build_object('winner', p_winner, 'end_reason', p_reason, 'rounds', public._fx_rounds_json(mt.sim),
                              'rounds_played', n, 'vitals', jsonb_build_object('hunger', 2 * n, 'thirst', 3 * n)) || v_extra;
  update public.fight_matches set result = v_res where id = p_match;
  return v_res;
end $$;

-- lazily: my bot matches with no push for 60 s are my losses ('abandon')
create or replace function public._fx_sweep(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  for v_id in
    select mt.id from public.fight_matches mt
     where mt.p1 = p_account and mt.p2 is null and mt.status = 'live'
       and coalesce((select l.last_push_at from public.fight_logs l where l.match_id = mt.id and l.side = 1), mt.started_at)
           < now() - interval '60 seconds'
       and mt.started_at < now() - interval '60 seconds'
     order by mt.id
     for update
  loop
    perform public._fx_settle(v_id, 2::smallint, 'abandon');
  end loop;
end $$;

-- what a client gets back from the pipeline RPCs
create or replace function public._fx_answer(p_match uuid, p_side smallint) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', mt.id, 'kind', mt.kind, 'status', mt.status, 'side', p_side,
    'sim_frame', mt.sim_frame,
    'frontiers', jsonb_build_array((select l.frontier from public.fight_logs l where l.match_id = mt.id and l.side = 1),
                                   (select l.frontier from public.fight_logs l where l.match_id = mt.id and l.side = 2)),
    'result', mt.result,
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
  from public.fight_matches mt where mt.id = p_match
$$;

-- ---------- D. RPCs ----------
-- The streamed replay (R3). Each push appends my own confirmed inputs from frame p_from (RLE, at most 300 frames),
-- advances the server's sim over the frames now covered (a bot match: up to my frontier), compares my hash, and
-- settles the match when the sim reaches its end. Steps 1–9 of the spec's §v20.2 "fight_push".
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
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if mt.p1 = v_account then v_side := 1;
  elsif mt.p2 = v_account then v_side := 2;
  else raise exception 'not your match' using errcode = '22023'; end if;
  v_bot := mt.p2 is null;
  -- 1. a settled match answers its result; a bot match left alone for 60 s is settled first
  if mt.status = 'live' and v_bot then
    perform public._fx_sweep(v_account);
    select * into mt from public.fight_matches where id = p_match;
  end if;
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
      s := public._fx_step_bots(s, a[k], b[k], v_m);
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
      end if;
      if p_hash_frame is not null and p_hash_frame = v_fr then v_hash_at := public._fx_hash(s); end if;
      v_steps := k;
      exit when s[1 + 1] = 3;
    end loop;
    mt.sim_frame := v_from + v_steps;
    update public.fight_matches set sim = s, sim_frame = mt.sim_frame, sim_hash = public._fx_hash(s) where id = p_match;
  end if;
  -- soft evidence, once per match
  if v_bot and v_ev[4] = 0 and (v_ev[2] > 12 or v_ev[3] >= 600) then
    v_ev[4] := 1;
    v_soft := public._ac_flag(v_account, 'fight_superhuman', 'fight_push',
                jsonb_build_object('match', p_match, 'fast_reactions', v_ev[2], 'busy_frames', v_ev[3], 'frame', v_target),
                mt.room_id, null, false)::text;
  end if;
  update public.fight_logs set ac = v_ev where match_id = p_match and side = v_side;
  -- 7. the client's hash against the replay's
  if p_hash is not null and v_hash_at is not null and v_hash_at <> p_hash then
    v_resync := true;
    update public.fight_logs set bad_hashes = bad_hashes + 1 where match_id = p_match and side = v_side;
    update public.fight_matches set resyncs = resyncs + 1 where id = p_match;
    v_soft := public._ac_flag(v_account, 'fight_hash_mismatch', 'fight_push',
                jsonb_build_object('match', p_match, 'frame', p_hash_frame, 'client', p_hash, 'server', v_hash_at),
                mt.room_id, null, false)::text;
  end if;
  -- 8. the end of the match settles it
  if s[1 + 1] = 3 then
    perform public._fx_settle(p_match, (case s[7 + 1] when 1 then 1 when 2 then 2 else 0 end)::smallint,
                              case when (s[6 + 1] >> 2) = 1 then 'ko' else 'decision' end);
  end if;
  -- 9.
  return public._fx_answer(p_match, v_side) || jsonb_build_object('resync', v_resync);
end $$;

-- What a client needs to resume after a reload or a resync: the params and the clock, its own runs, the opponent's up
-- to the frames both cover, the server's sim, the status and the result.
create or replace function public.fight_state(p_session_token text, p_match uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); mt public.fight_matches; v_side smallint;
        v_mine integer[]; v_theirs integer[]; v_min integer;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if mt.p1 = v_account then v_side := 1;
  elsif mt.p2 = v_account then v_side := 2;
  else raise exception 'not your match' using errcode = '22023'; end if;
  if mt.status = 'live' and mt.p2 is null then
    perform public._fx_sweep(v_account);
    select * into mt from public.fight_matches where id = p_match;
  end if;
  select runs into v_mine from public.fight_logs where match_id = p_match and side = v_side;
  if mt.p2 is not null then
    v_min := least((select frontier from public.fight_logs where match_id = p_match and side = 1),
                   (select frontier from public.fight_logs where match_id = p_match and side = 2));
    select public._fx_runs_encode(public._fx_runs_slice(runs, 0, v_min + 1)) into v_theirs
      from public.fight_logs where match_id = p_match and side = 3 - v_side;
  end if;
  return public._fx_answer(p_match, v_side) || jsonb_build_object(
    'params', mt.params, 'started_at_ms', (extract(epoch from mt.started_at) * 1000)::bigint,
    'runs', to_jsonb(coalesce(v_mine, '{}'::integer[])), 'opp_runs', to_jsonb(v_theirs),
    'sim', to_jsonb(mt.sim), 'sim_hash', mt.sim_hash);
end $$;

-- "Đầu hàng": the caller loses at once
create or replace function public.fight_forfeit(p_session_token text, p_match uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); mt public.fight_matches; v_side smallint;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if mt.p1 = v_account then v_side := 1;
  elsif mt.p2 = v_account then v_side := 2;
  else raise exception 'not your match' using errcode = '22023'; end if;
  if mt.status = 'live' then perform public._fx_settle(p_match, (3 - v_side)::smallint, 'forfeit'); end if;
  return public._fx_answer(p_match, v_side);
end $$;

-- Wear a style's uniform in one tap (plan ruling P16): the outfit it replaces is remembered unless it is a uniform.
create or replace function public.fight_wear_uniform(p_session_token text, p_style text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_uniform text; v_cur text;
begin
  select uniform into v_uniform from public.martial_styles where id = p_style;
  if v_uniform is null then raise exception 'unknown style' using errcode = '22023'; end if;
  if not exists (select 1 from public.martial_enrollments where account_id = v_account and style = p_style) then
    raise exception 'not enrolled' using errcode = '22023';
  end if;
  if not exists (select 1 from public.account_items where account_id = v_account and item_id = v_uniform) then
    raise exception 'no uniform' using errcode = '22023';
  end if;
  select outfit into v_cur from public.characters where account_id = v_account for update;
  if not found then raise exception 'no character' using errcode = '22023'; end if;
  insert into public.fight_profiles (account_id) values (v_account) on conflict (account_id) do nothing;
  if v_cur is null or v_cur not like 'vp\_%' then
    update public.fight_profiles set prev_outfit = v_cur where account_id = v_account;
  end if;
  update public.characters set outfit = v_uniform, updated_at = now() where account_id = v_account;
  return jsonb_build_object('outfit', v_uniform,
                            'prev_outfit', (select prev_outfit from public.fight_profiles where account_id = v_account));
end $$;

-- Take the uniform off: the remembered outfit comes back when still owned (else none)
create or replace function public.fight_unwear_uniform(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_cur text; v_prev text;
begin
  select outfit into v_cur from public.characters where account_id = v_account for update;
  if not found then raise exception 'no character' using errcode = '22023'; end if;
  if v_cur is null or v_cur not like 'vp\_%' then
    return jsonb_build_object('outfit', v_cur, 'prev_outfit', null);
  end if;
  select prev_outfit into v_prev from public.fight_profiles where account_id = v_account;
  if v_prev is not null and not public._item_ok(v_account, v_prev, 'outfit', false) then v_prev := null; end if;
  update public.characters set outfit = v_prev, updated_at = now() where account_id = v_account;
  update public.fight_profiles set prev_outfit = null where account_id = v_account;
  return jsonb_build_object('outfit', v_prev, 'prev_outfit', null);
end $$;

-- ---------- privileges ----------
revoke all on function public._fx_bot_script(integer) from public, anon, authenticated;
revoke all on function public._fx_rng(integer) from public, anon, authenticated;
revoke all on function public._fx_bot_level(integer) from public, anon, authenticated;
revoke all on function public._fx_bot_special(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_bot(integer[], integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_step_bots(integer[], integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._fx_run_bots(integer[], integer[], integer[], integer[]) from public, anon, authenticated;
revoke all on function public._fx_runs_slice(integer[], integer, integer) from public, anon, authenticated;
revoke all on function public._fx_runs_encode(integer[]) from public, anon, authenticated;
revoke all on function public._fx_rounds_json(integer[]) from public, anon, authenticated;
revoke all on function public._fx_vitals_ok(uuid) from public, anon, authenticated;
revoke all on function public._fx_style_of(uuid) from public, anon, authenticated;
revoke all on function public._fx_settle(uuid, smallint, text) from public, anon, authenticated;
revoke all on function public._fx_sweep(uuid) from public, anon, authenticated;
revoke all on function public._fx_answer(uuid, smallint) from public, anon, authenticated;
revoke all on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) from public;
revoke all on function public.fight_state(text, uuid) from public;
revoke all on function public.fight_forfeit(text, uuid) from public;
revoke all on function public.fight_wear_uniform(text, text) from public;
revoke all on function public.fight_unwear_uniform(text) from public;
grant execute on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) to anon, authenticated;
grant execute on function public.fight_state(text, uuid) to anon, authenticated;
grant execute on function public.fight_forfeit(text, uuid) to anon, authenticated;
grant execute on function public.fight_wear_uniform(text, text) to anon, authenticated;
grant execute on function public.fight_unwear_uniform(text) to anon, authenticated;
