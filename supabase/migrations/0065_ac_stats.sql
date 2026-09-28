-- =========================================================
-- 0065_ac_stats.sql — anti-cheat v2, part 3 (docs/superpowers/plans/2026-09-28-anticheat-v2-part3.md, part A): the
-- statistics and the auto-blacklist. ADDITIVE and re-runnable. Run after 0064.
--   A. ac_play_stats (per account, Vietnam day and game: plays, wins, exact = perfect-input rounds), _ac_stat.
--   B. The farm's timing statistics: _harvest_timing (cuts within 14 ‰ of the band's centre), _crab_timing (hits on
--      the first open tick). The sling's is inline (the rat within 1 500 mpx of the aim at landing).
--   C. The auto-blacklist (0055): 8 hard events (log_only, in_lock, strike_1, strike_2) within 30 days on 2 Vietnam days
--      put a non-root account on blacklisted_accounts (after the last manual unblacklist); a trigger on anticheat_events.
--   D. The job: _ac_stats_run (win / exact rates over 7 days against the others' rate, income over 24 h against the
--      others' p95 and median, marathons) into ac_stat_flags with a soft 'stat_outlier' a day; _ac_stats_maybe runs it
--      at most every stats_every_min minutes, one caller at a time (0066's pet heartbeat calls it).
--   E. The replayed RPCs record their rounds (each verbatim but for the lines marked 0065): finish_cast (0059), net_haul
--      (0056), harvest_part (0061), crab_finish (0062), sling_shoot (0063). The farm's rounds also judge the timing:
--      soft harvest_timing / crab_timing / sling_timing; the 5th harvest_timing or crab_timing in 24 h, the 3rd
--      sling_timing in 7 days is hard (*_timing_repeat) and voids that round.
--   F. Admin (root): admin_anticheat_stats, admin_anticheat_stats_run, admin_blacklist_set, admin_stat_review.
-- =========================================================

-- ---------- A. The rounds ----------
create table if not exists public.ac_play_stats (
  account_id uuid not null references public.accounts(id) on delete cascade,
  day date not null,
  game text not null,
  plays integer not null default 0,
  wins integer not null default 0,
  exact integer not null default 0,
  primary key (account_id, day, game)
);
create index if not exists idx_ac_play_stats_day on public.ac_play_stats (day, game);
alter table public.ac_play_stats enable row level security;
revoke all on public.ac_play_stats from anon, authenticated;

create or replace function public._ac_stat(p_account uuid, p_game text, p_plays integer, p_wins integer, p_exact integer)
returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.ac_play_stats as s (account_id, day, game, plays, wins, exact)
  values (p_account, public._vn_today(), p_game, p_plays, p_wins, p_exact)
  on conflict (account_id, day, game) do update
    set plays = s.plays + excluded.plays, wins = s.wins + excluded.wins, exact = s.exact + excluded.exact
$$;
revoke all on function public._ac_stat(uuid, text, integer, integer, integer) from public, anon, authenticated;

-- ---------- B. The farm's timing ----------
-- The harvest round of _harvest_replay (0061), statement for statement, counting the cuts and the exact ones: a cut
-- within 14 ‰ of its band's centre (the best tick, sometimes the next one; a hand does it about 1 time in 3).
create or replace function public._harvest_timing(p_seed bigint, p_toggles integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare c integer[] := public._harvest_centres(p_seed); bundle integer := 0; charge integer := 0; lv integer := 0;
        charging boolean := false; armed boolean := true; beat integer := 0; score2 integer := 0; tick integer := 0;
        outcome text; hold boolean := false; i integer := 1; n integer := coalesce(cardinality(p_toggles), 0);
        cut integer; d integer; v_exact integer := 0;
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
      if d <= 14 then v_exact := v_exact + 1; end if;
      bundle := bundle + 1;
      charge := 0;
      lv := 0;
      charging := false;
      beat := 21;
    end if;
    if outcome is null and tick >= 7200 then outcome := 'fail'; end if;
    exit when outcome is not null;
  end loop;
  return jsonb_build_object('cuts', bundle, 'exact', v_exact);
end $$;

-- The crab game of _crab_replay (0062), counting the hits and those on the first open tick of the claws (a hand that
-- watches them open reacts ≥ 10 ticks later; one that times the rhythm lands there about 1 time in 10).
create or replace function public._crab_timing(p_seed bigint, p_grabs integer[], p_ticks integer) returns jsonb
language plpgsql immutable parallel safe
as $$
declare ph integer[] := public._crab_phases(p_seed); per integer[] := array[72, 57, 45]; stage integer := 0; t integer := 0;
        tick integer := 0; tries integer := 0; hits integer := 0; done boolean := false; g boolean; i integer := 1;
        n integer := coalesce(cardinality(p_grabs), 0); p integer; mark text; v_exact integer := 0; x integer;
        v_first integer;                                            -- the tick the claws opened in this try, while open
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
      x := (ph[tries + 1] + t) % p;
      if 10 * x >= 6 * p then v_first := coalesce(v_first, tick); else v_first := null; end if;
      mark := case when g then case when 10 * x >= 6 * p then 'hit' else 'pinch' end
                   when t >= 4 * p then 'slip' end;
      if mark is not null then
        tries := tries + 1;
        if mark = 'hit' then
          hits := hits + 1;
          if v_first = tick then v_exact := v_exact + 1; end if;          -- the first tick it could be grabbed
        end if;
        stage := 2;
        t := 0;
        v_first := null;
      end if;
    elsif t >= 30 then
      if tries >= 3 then done := true; else stage := 0; t := t - 30; end if;
    end if;
  end loop;
  return jsonb_build_object('hits', hits, 'exact', v_exact);
end $$;
revoke all on function public._harvest_timing(bigint, integer[]) from public, anon, authenticated;
revoke all on function public._crab_timing(bigint, integer[], integer) from public, anon, authenticated;

-- ---------- C. The auto-blacklist ----------
create or replace function public._ac_auto_blacklist(p_account uuid) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.anticheat_config; v_from timestamptz; v_n integer; v_d integer; v_name text; v_root boolean;
begin
  select * into c from public.anticheat_config where id;
  if not coalesce(c.auto_blacklist, false) then return false; end if;
  select username, is_root into v_name, v_root from public.accounts where id = p_account;
  if v_name is null or coalesce(v_root, false) then return false; end if;
  if exists (select 1 from public.blacklisted_accounts where account_id = p_account) then return false; end if;
  v_from := greatest(now() - interval '30 days',
                     coalesce((select blacklist_cleared_at from public.anticheat_status where account_id = p_account), '-infinity'));
  select count(*), count(distinct (e.created_at at time zone 'Asia/Ho_Chi_Minh')::date) into v_n, v_d
    from public.anticheat_events e
   where e.account_id = p_account and e.created_at > v_from and e.outcome in ('log_only', 'in_lock', 'strike_1', 'strike_2');
  if v_n < c.auto_blacklist_hard or v_d < 2 then return false; end if;
  insert into public.blacklisted_accounts (account_id, note)
  values (p_account, format('auto %s: %s vi phạm cứng trong 30 ngày (%s ngày)', public._vn_today(), v_n, v_d))
  on conflict (account_id) do nothing;
  insert into public.anticheat_events (account_id, username, code, outcome, rpc, detail)
  values (p_account, v_name, 'auto_blacklist', 'soft', 'auto',
          jsonb_build_object('hard', v_n, 'days', v_d, 'threshold', c.auto_blacklist_hard, 'since', v_from));
  return true;
end $$;
revoke all on function public._ac_auto_blacklist(uuid) from public, anon, authenticated;

create or replace function public._ac_events_auto_bl() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_auto_blacklist(new.account_id);
  return null;
end $$;
revoke all on function public._ac_events_auto_bl() from public, anon, authenticated;
drop trigger if exists anticheat_events_auto_bl on public.anticheat_events;
create trigger anticheat_events_auto_bl after insert on public.anticheat_events
  for each row when (new.outcome in ('log_only', 'in_lock', 'strike_1', 'strike_2'))
  execute function public._ac_events_auto_bl();

-- ---------- D. The job ----------
create table if not exists public.ac_stat_flags (
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null,                  -- stat_win_rate, stat_exact_rate, stat_earnings, stat_marathon
  key text not null,                   -- the game or the income source ('' for a marathon)
  value numeric not null,              -- the account's rate, xu or hours
  baseline numeric,                    -- the others' rate, p95 or null
  n integer not null default 0,        -- plays, earners or hours behind it
  detail jsonb not null default '{}'::jsonb,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  hits integer not null default 1,     -- runs that found it
  evented_at timestamptz,              -- the last soft stat_outlier written for it
  reviewed_at timestamptz,             -- root looked at it (it reopens when it still holds a week later)
  primary key (account_id, kind, key)
);
alter table public.ac_stat_flags enable row level security;
revoke all on public.ac_stat_flags from anon, authenticated;

create table if not exists public.ac_stats_state (   -- exactly one row: the last run
  id boolean primary key default true check (id),
  run_at timestamptz,
  took_ms integer,
  flagged integer
);
insert into public.ac_stats_state (id) values (true) on conflict (id) do nothing;
alter table public.ac_stats_state enable row level security;
revoke all on public.ac_stats_state from anon, authenticated;

-- One outlier: upserted; a soft stat_outlier at most once a day per flag.
create or replace function public._ac_stat_flag(p_account uuid, p_kind text, p_key text, p_value numeric, p_base numeric,
                                                p_n integer, p_detail jsonb) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.ac_stat_flags;
begin
  insert into public.ac_stat_flags as x (account_id, kind, key, value, baseline, n, detail)
  values (p_account, p_kind, p_key, p_value, p_base, p_n, coalesce(p_detail, '{}'::jsonb))
  on conflict (account_id, kind, key) do update
    set value = excluded.value, baseline = excluded.baseline, n = excluded.n, detail = excluded.detail,
        last_at = now(), hits = x.hits + 1,
        reviewed_at = case when x.reviewed_at < now() - interval '7 days' then null else x.reviewed_at end
  returning * into f;
  if f.evented_at is null or f.evented_at < now() - interval '24 hours' then
    update public.ac_stat_flags set evented_at = now() where account_id = p_account and kind = p_kind and key = p_key;
    perform public._ac_flag(p_account, 'stat_outlier', 'stats',
              jsonb_build_object('kind', p_kind, 'key', p_key, 'value', p_value, 'baseline', p_base, 'n', p_n)
              || coalesce(p_detail, '{}'::jsonb), null, null, false);
  end if;
end $$;
revoke all on function public._ac_stat_flag(uuid, text, text, numeric, numeric, integer, jsonb) from public, anon, authenticated;

-- Every account's rounds of the last 7 Vietnam days per game: the recorded ones, the kata attempts (30 days: they are
-- rare) and the finished fights (each side of a ring, a ranked or a cup match; the player of an exam or ladder match).
create or replace function public._ac_games() returns table (account_id uuid, game text, n bigint, w bigint, e bigint)
language sql stable security definer set search_path = public, extensions
as $$
  select s.account_id, s.game, sum(s.plays)::bigint, sum(s.wins)::bigint, sum(s.exact)::bigint
    from public.ac_play_stats s where s.day >= public._vn_today() - 6 group by 1, 2
  union all
  select x.account_id, 'kata', count(*), count(*) filter (where x.kata_score * 100 >= b.kata_pass_pct * 2 * b.kata_notes),
         count(*) filter (where x.kata_score >= 2 * b.kata_notes)
    from public.martial_exams x join public.martial_belts b on b.style = x.style and b.rank = x.target_rank
   where x.kata_score is not null and x.started_at > now() - interval '30 days' group by 1
  union all
  select sd.acc, 'fight_' || m.kind, count(*), count(*) filter (where m.winner = sd.side), 0
    from public.fight_matches m
    cross join lateral (values (m.p1, 1::smallint), (m.p2, 2::smallint)) sd(acc, side)
   where m.status = 'done' and m.ended_at > now() - interval '7 days' and sd.acc is not null
   group by 1, 2
$$;
revoke all on function public._ac_games() from public, anon, authenticated;

-- The income sources the job compares (game earnings; transfers, refunds and sales of property are not).
create or replace function public._ac_income_reasons() returns text[]
language sql immutable parallel safe
as $$ select array['sell', 'rice_sell', 'produce_sell', 'critter_sell', 'rat_sell', 'pet_find', 'song', 'fight_win', 'ug_prize'] $$;
revoke all on function public._ac_income_reasons() from public, anon, authenticated;

-- The job. Returns {flagged, took_ms}.
create or replace function public._ac_stats_run() returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare t0 timestamptz := clock_timestamp(); r record; v_n integer := 0; v_min_w integer; v_min_e integer; p numeric;
        z numeric; v_ms integer;
begin
  -- 1. win and exact rates against everyone else's (leave-one-out), binomial z
  for r in
    with g as (select * from public._ac_games()),
         tot as (select game, sum(n) tn, sum(w) tw, sum(e) te from g group by game)
    select g.account_id, g.game, g.n, g.w, g.e, t.tn - g.n as on_, t.tw - g.w as ow, t.te - g.e as oe
      from g join tot t using (game)
     where g.n > 0
  loop
    -- too few others to compare
    continue when r.on_ < case when r.game = 'kata' then 10 when r.game like 'fight\_%' then 30 else 50 end;
    v_min_w := case when r.game = 'kata' then 5 when r.game like 'fight\_%' then 20 else 40 end;
    v_min_e := case when r.game = 'kata' then 5 else 30 end;
    if r.n >= v_min_w then
      p := least(0.98, greatest(0.02, r.ow::numeric / r.on_));
      z := (r.w - r.n * p) / sqrt(r.n * p * (1 - p));
      if z >= 4 and r.w::numeric / r.n >= p + 0.15 then
        perform public._ac_stat_flag(r.account_id, 'stat_win_rate', r.game, round(r.w::numeric / r.n, 4), round(p, 4), r.n::int,
                  jsonb_build_object('wins', r.w, 'plays', r.n, 'z', round(z, 2)));
        v_n := v_n + 1;
      end if;
    end if;
    if r.n >= v_min_e and r.game not like 'fight\_%' then
      p := least(0.98, greatest(0.02, r.oe::numeric / r.on_));
      z := (r.e - r.n * p) / sqrt(r.n * p * (1 - p));
      if z >= 4 and r.e::numeric / r.n >= greatest(p + 0.2, 2 * p) then
        perform public._ac_stat_flag(r.account_id, 'stat_exact_rate', r.game, round(r.e::numeric / r.n, 4), round(p, 4), r.n::int,
                  jsonb_build_object('exact', r.e, 'plays', r.n, 'z', round(z, 2)));
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  -- 2. income per source over 24 h against the other earners' p95 and median; the detail carries xu per active hour
  for r in
    with e as (select l.account_id, l.reason, sum(l.delta)::bigint xu
                 from public.coin_ledger l
                where l.delta > 0 and l.created_at > now() - interval '24 hours' and l.reason = any (public._ac_income_reasons())
                group by 1, 2)
    select e.*, o.others, o.p95, o.med
      from e cross join lateral (
        select count(*) others, percentile_cont(0.95) within group (order by x.xu) p95,
               percentile_cont(0.5) within group (order by x.xu) med
          from e x where x.reason = e.reason and x.account_id <> e.account_id) o
     where o.others >= 5 and e.xu >= 5000 and e.xu >= 3 * o.p95 and e.xu >= 10 * o.med
  loop
    perform public._ac_stat_flag(r.account_id, 'stat_earnings', r.reason, r.xu, round(r.p95::numeric, 1), r.others::int,
              jsonb_build_object('median', round(r.med::numeric, 1), 'xu_per_hour', round(r.xu::numeric / greatest(1, (
                select count(distinct date_trunc('hour', l.created_at)) from public.coin_ledger l
                 where l.account_id = r.account_id and l.created_at > now() - interval '24 hours'
                   and l.delta > 0 and l.reason = any (public._ac_income_reasons()))), 1)));
    v_n := v_n + 1;
  end loop;
  -- 3. marathons: game income in ≥ 20 distinct hours of the last 24 (the pet's forage and the song bonus do not count)
  for r in
    select l.account_id, count(distinct date_trunc('hour', l.created_at)) h
      from public.coin_ledger l
     where l.delta > 0 and l.created_at > now() - interval '24 hours'
       and l.reason = any (public._ac_income_reasons()) and l.reason not in ('pet_find', 'song')
     group by 1 having count(distinct date_trunc('hour', l.created_at)) >= 20
  loop
    perform public._ac_stat_flag(r.account_id, 'stat_marathon', '', r.h, null, r.h::int, jsonb_build_object('hours', r.h));
    v_n := v_n + 1;
  end loop;
  -- 4. the auto-blacklist, for anyone whose hard events reached it before it was switched on
  for r in select distinct e.account_id from public.anticheat_events e
            where e.created_at > now() - interval '30 days' and e.outcome in ('log_only', 'in_lock', 'strike_1', 'strike_2') loop
    perform public._ac_auto_blacklist(r.account_id);
  end loop;
  v_ms := (extract(epoch from clock_timestamp() - t0) * 1000)::integer;
  update public.ac_stats_state set took_ms = v_ms, flagged = v_n where id;
  return jsonb_build_object('flagged', v_n, 'took_ms', v_ms);
end $$;
revoke all on function public._ac_stats_run() from public, anon, authenticated;

-- Lazily, from a heartbeat: at most every stats_every_min minutes, and never two at once.
create or replace function public._ac_stats_maybe() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.anticheat_config; st public.ac_stats_state;
begin
  select * into c from public.anticheat_config where id;
  if not coalesce(c.stats_enabled, false) then return; end if;
  select * into st from public.ac_stats_state where id for update skip locked;
  if not found then return; end if;
  if st.run_at is not null and st.run_at > now() - make_interval(mins => c.stats_every_min) then return; end if;
  update public.ac_stats_state set run_at = now() where id;
  perform public._ac_stats_run();
exception when others then
  raise warning 'ac stats skipped: %', sqlerrm;   -- the heartbeat must not fail because of the job
end $$;
revoke all on function public._ac_stats_maybe() from public, anon, authenticated;

-- ---------- E. The replayed RPCs record their rounds ----------
-- finish_cast (0059's, verbatim but for the lines marked 0065): a hooked reel is a round.
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,
                                              p_hooked boolean default false,
                                              p_inputs integer[] default null,             -- 0046: the toggle ticks
                                              p_ticks integer default null) returns jsonb  -- 0046: the tick it ended on
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
        v_out jsonb; v_rod text; v_vit public.vitals;                                     -- v18.1
        v_broke boolean := false;                                                         -- v18.2
        v_bad text; v_replay jsonb;                                                       -- 0046
        v_hooked boolean; v_t jsonb;                                                      -- 0059
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  v_hooked := c.hooked_at is not null;                                                    -- 0059: the server's hook (p_hooked is ignored)
  -- 0046: a won reel is replayed from the cast's seed and params; the client's word alone lands nothing
  if coalesce(p_success, false) and c.reel_seed is not null and p_inputs is not null and p_ticks is not null then
    v_bad := public._reel_input_error(p_inputs, p_ticks);
    if v_bad is null then
      v_replay := public._reel_replay(c.reel_params, c.reel_seed, p_inputs);
    end if;
  end if;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not c.bites then                                                                  -- v18.1: nothing bit
    v_why := 'no_bite';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
    if v_hooked and c.big then                                                            -- 0059 was: if coalesce(p_hooked, false) and c.big and now() >= c.bite_at then                   -- v18.1: pulled in
      v_why := 'overboard';
    end if;
  elsif c.reel_seed is null or p_inputs is null or p_ticks is null then                     -- 0046: a page before the replay
    v_why := 'outdated';
  elsif not v_hooked then                                                                 -- 0059: a won reel needs the hook
    v_why := 'reel_invalid';                                                              -- 0059
    v_ac := public._ac_flag(v_account, 'reel_unhooked', 'finish_cast',                   -- 0059
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'ticks', p_ticks), c.room_id);   -- 0059
  elsif v_bad is not null then                                                            -- 0046: input no reel can make
    v_why := 'reel_invalid';
    v_ac := public._ac_flag(v_account, 'reel_bad_input', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'error', v_bad, 'ticks', p_ticks,
                                 'toggles', cardinality(p_inputs), 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif v_replay->>'outcome' is distinct from 'caught' or (v_replay->>'ticks')::int <> p_ticks then   -- 0046
    v_why := 'reel_invalid';                                                              -- the reel did not land it
    v_ac := public._ac_flag(v_account, 'reel_mismatch', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'seed', c.reel_seed, 'params', c.reel_params,
                                 'claimed_ticks', p_ticks, 'replay', v_replay, 'toggles', cardinality(p_inputs),
                                 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif now() < c.hooked_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then   -- 0059 was: elsif now() < c.bite_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then
    -- the existing gate, and (0046) no sooner in real time than the replayed ticks took
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3),
                                 'ticks', p_ticks),                                       -- 0046
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  -- 0059 {
  -- a won reel's timing: flips faster than a finger, or a metronome (soft); the 5th within 24 h voids the catch (hard)
  if v_why is null then
    v_t := public._reel_timing(p_inputs);
    if public._reel_timing_suspect(v_t) then
      perform public._ac_flag(v_account, 'reel_timing', 'finish_cast',
                jsonb_build_object('cast_id', c.id, 'timing', v_t, 'ticks', p_ticks, 'inputs', to_jsonb(p_inputs[1:200])),
                c.room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'reel_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_why := 'reel_invalid';
        v_ac := public._ac_flag(v_account, 'reel_timing_repeat', 'finish_cast',
                  jsonb_build_object('cast_id', c.id, 'timing', v_t, 'pattern', '5 in 24 h'), c.room_id);
      end if;
    end if;
  end if;
  -- 0059 }
  -- 0065 {
  -- a hooked reel is a round: won when caught, exact when never out of the zone (the replay's fewest ticks)
  if v_hooked and c.bites then
    perform public._ac_stat(v_account, 'reel', 1, case when v_why is null then 1 else 0 end,
                            case when v_why is null and p_ticks <= ceil(c.min_reel_ms * 0.06) + 2 then 1 else 0 end);
  end if;
  -- 0065 }
  v_rod := coalesce(c.rod, 'rod_wood');                                                   -- v18.2 (was in the branch below)
  if v_why = 'overboard' then                                                             -- v18.1: the fall's cost
    v_out := public._overboard_outcome(v_rod, random());
    perform public._rod_wear(v_account, v_rod, (v_out->>'wear')::int);
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - (v_out->>'hunger')::numeric)
     where account_id = v_account returning * into v_vit;
    v_broke := not public._rod_usable(v_account, v_rod);                                  -- v18.2
    if (v_out->>'rod_lost')::boolean then
      delete from public.inventory where account_id = v_account and item_id = v_rod;
      update public.fishing_profiles set rod = 'rod_wood' where account_id = v_account and rod = v_rod;
      v_broke := false;                                                                   -- v18.2: lost, not broken
    end if;
    perform public._heat_row(v_account);                                                  -- v18.2: the swim's immunity
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', v_rod, 'rod_lost', (v_out->>'rod_lost')::boolean,
                                      'hunger', (v_out->>'hunger')::int),
      'rod_broke', v_broke,                                                               -- v18.2
      'vitals', public._vitals_json(v_vit),
      'state', public._fishing_state(v_account));
  end if;
  if v_why is distinct from 'no_bite' then                                                -- v18.2: a hook attempt
    perform public._rod_wear(v_account, v_rod, 1);
    v_broke := not public._rod_usable(v_account, v_rod);
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'rod_broke', v_broke,        -- v18.2: rod_broke
                              'state', public._fishing_state(v_account))
           || case when v_why = 'outdated' then jsonb_build_object('message', 'Cập nhật trang để câu tiếp')   -- 0046
                   else '{}'::jsonb end
           || coalesce(v_ac, '{}'::jsonb);
  end if;
  select * into sp from public.fish_species where id = c.species_id;
  -- the room's fish price index at the catch (economy spec §5.7); a cast whose room is gone keeps the base price
  if c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    r := public._fish_index(c.room_id, now());
    v_mult := r.mult;
    v_factor := public._fish_factor(c.room_id, sp.id, r.period);
  end if;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0 * v_mult * v_factor)::int);
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  if v_ratio < 1.05 then
    perform public._ac_hug(v_account, round(v_ratio, 3), c.room_id);
  end if;
  -- rare+ catches are announced in the room's chat (v14 spec §8.5), as a system line about the catcher
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]),
            true, v_account);
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'rod_broke', v_broke,                                                                 -- v18.2
    'state', public._fishing_state(v_account));
end; $$;

-- net_haul (0056's, verbatim but for the lines marked 0065): a replayed throw is a round.
create or replace function public.net_haul(p_session_token text, p_throw_id uuid, p_press integer, p_release integer,
                                           p_aim_x integer, p_aim_y integer, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_n integer; v_free integer; sp public.fish_species;
        v_w integer; v_price integer; r public.fish_price_index; v_mult numeric := 1; v_room boolean;
        v_haul jsonb := '[]'::jsonb; v_d integer; v_vitals jsonb; v_bad text; v_rep jsonb; v_ac jsonb;
        v_radius integer; v_in jsonb;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select * into t from public.net_throws where account_id = v_account and id = p_throw_id for update;
  if not found or t.haul is not null then raise exception 'throw not found' using errcode = '22023'; end if;
  if t.arrow_seed is null then                                                            -- rolled before 0056
    delete from public.net_throws where id = t.id;
    return public._net_outdated(v_account);
  end if;
  -- the throw is spent: one use of the net (a net at 0 is removed) and the throw's effort
  select durability into v_d from public.inventory where account_id = v_account and item_id = t.net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  if v_d <= 1 then
    delete from public.inventory where account_id = v_account and item_id = t.net;
  else
    update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = t.net;
  end if;
  perform public._vitals_apply(v_account);
  v_vitals := public._fishing_effort(v_account, 3, 3.5);
  v_in := jsonb_build_object('press', p_press, 'release', p_release, 'aim_x', p_aim_x, 'aim_y', p_aim_y, 'hits', p_hits);
  if now() > t.started_at + interval '120 seconds' then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'vitals', v_vitals, 'state', public._fishing_state(v_account));
  end if;
  v_bad := coalesce(public._net_throw_error(p_press, p_release, p_aim_x, p_aim_y),
                    case when p_hits is null or p_hits < 0 or p_hits > 5 then 'hits' end);
  if v_bad is not null then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_bad_input', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'error', v_bad, 'inputs', v_in), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  v_radius := coalesce((select radius_px from public.shop_items where id = t.net), 24);
  v_rep := public._net_haul_replay(t.seed, v_radius, p_press, p_release, p_aim_x, p_aim_y);
  if (v_rep->>'hits')::int <> p_hits then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_mismatch', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'seed', t.seed, 'radius', v_radius, 'inputs', v_in, 'replay', v_rep), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  if now() < t.started_at + make_interval(secs => 0.9 * (p_release + 42 + 90) / 60.0) then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_too_fast', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'started_at', t.started_at, 'hauled_at', now(), 'inputs', v_in,
                                 'need_s', round(0.9 * (p_release + 42 + 90) / 60.0, 3)), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  perform public._ac_stat(v_account, 'net', 1, case when (v_rep->>'hits')::int >= 3 then 1 else 0 end,   -- 0065: the round
                          case when (v_rep->>'hits')::int = 5 then 1 else 0 end);                             -- 0065
  v_n := (v_rep->>'count')::int;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  v_n := least(v_n, v_free);
  if v_n = 0 then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'empty', 'count', 0, 'fish', '[]'::jsonb, 'vitals', v_vitals,
                              'state', public._fishing_state(v_account));
  end if;
  v_room := t.room_id is not null and exists (select 1 from public.rooms where id = t.room_id);
  if v_room then
    r := public._fish_index(t.room_id, now());
    v_mult := r.mult;
  end if;
  for i in 1 .. v_n loop
    select * into sp from public.fish_species where rarity in (1, 2) order by random() limit 1;
    v_w := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), 2.0))::int);
    v_price := greatest(1, round(sp.price_per_kg * v_w / 1000.0 * v_mult
                                 * case when v_room then public._fish_factor(t.room_id, sp.id, r.period) else 1 end)::int);
    v_haul := v_haul || jsonb_build_array(jsonb_build_object('species_id', sp.id, 'weight_g', v_w, 'price', v_price,
                                                             'rarity', sp.rarity));
  end loop;
  update public.net_throws set haul = v_haul, hauled_at = now(), land_tick = (v_rep->>'land_tick')::int, inputs = v_in
   where id = t.id;
  return jsonb_build_object('result', 'haul', 'count', v_n, 'fish', v_haul, 'quality', (v_rep->>'quality')::int,
    'arrow_seed', t.arrow_seed, 'vitals', v_vitals, 'state', public._fishing_state(v_account));
end; $$;

-- harvest_part (0061's, verbatim but for the lines marked 0065): the round and its timing.
create or replace function public.harvest_part(p_room_id uuid, p_session_token text, p_plot integer, p_toggles integer[],
                                               p_ticks integer, p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_use integer[]; v_ac jsonb; c public.crops;
        v_bad text; v_rep jsonb; v_code text; v_ev jsonb;
        v_tm jsonb; v_exact boolean;                                                      -- 0065
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
  -- 0065 {
  -- the round, and its timing: 7 of 8 cuts on the band's centre is soft; the 5th such round in 24 h is hard and cuts nothing
  if v_code is null and v_rep is not null then
    v_tm := public._harvest_timing(c.work_seed, p_toggles);
    v_exact := (v_tm->>'cuts')::int = 8 and (v_tm->>'exact')::int >= 7;
    perform public._ac_stat(v_account, 'harvest', 1, case when p_pass then 1 else 0 end, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'harvest_timing', 'harvest_part', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'harvest_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'harvest_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  end if;
  -- 0065 }
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'harvest_part', v_ev, p_room_id, 'invalid harvest');
    return public._farm_do_harvest_part(p_room_id, v_account, p_plot, false, now()) || v_ac;
  end if;
  return public._farm_do_harvest_part(p_room_id, v_account, p_plot, coalesce(p_pass, false) and c.work_seed is not null, now());
end $$;

-- crab_finish (0062's, verbatim but for the lines marked 0065): the game and its timing.
create or replace function public.crab_finish(p_room_id uuid, p_session_token text, p_visit_id uuid, p_grabs integer[],
                                              p_ticks integer, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); g public.gather_cooldowns; v_use integer[];
        v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb;
        v_tm jsonb; v_exact boolean;                                                      -- 0065
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
  -- 0065 {
  -- the game, and its timing: 3 crabs each on the first open tick is soft; the 5th such game in 24 h is hard, no crab
  if v_code is null then
    v_tm := public._crab_timing(g.visit_seed, p_grabs, p_ticks);
    v_exact := (v_tm->>'hits')::int = 3 and (v_tm->>'exact')::int = 3;
    perform public._ac_stat(v_account, 'crab', 1, case when p_hits = 3 then 1 else 0 end, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'crab_timing', 'crab_finish', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'crab_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'crab_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  end if;
  -- 0065 }
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'crab_finish', v_ev, p_room_id, 'invalid catch');
    return public._gather_do_crab_finish(p_room_id, v_account, p_visit_id, 0, now()) || v_ac;
  end if;
  return public._gather_do_crab_finish(p_room_id, v_account, p_visit_id, (v_rep->>'hits')::int, now());
end $$;

-- sling_shoot (0063's, verbatim but for the lines marked 0065): the shot and its aim.
create or replace function public.sling_shoot(p_room_id uuid, p_session_token text, p_rat_id bigint, p_press integer,
                                              p_release integer, p_aim integer, p_hit boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); a public.sling_aims; v_bad text; v_rat bigint[];
        v_mark text; v_code text; v_ev jsonb; v_ac jsonb;
        v_exact boolean; st public.ac_play_stats;                                         -- 0065
begin
  perform public._field_open(p_room_id, now());
  perform public._wallet_lock(v_account);
  select * into a from public.sling_aims where account_id = v_account for update;
  if not found or a.room_id is distinct from p_room_id or a.rat_id is distinct from p_rat_id then
    raise exception 'no aim' using errcode = '22023';
  end if;
  if a.seed is null then raise exception 'outdated' using errcode = '22023'; end if;
  v_ev := jsonb_build_object('rat', p_rat_id, 'press', p_press, 'release', p_release, 'aim', p_aim, 'hit', p_hit,
                             'last', a.last_tick);
  v_bad := coalesce(public._sling_input_error(p_press, p_release, p_aim, a.last_tick), case when p_hit is null then 'hit' end);
  if v_bad is not null then
    v_code := 'sling_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif now() < a.started_at + make_interval(secs => 0.9 * (p_release + 18) / 60.0) then
    v_code := 'sling_too_fast';
    v_ev := v_ev || jsonb_build_object('started_at', a.started_at, 'shot_at', now(), 'need_s', round(0.9 * (p_release + 18) / 60.0, 3));
  else
    v_rat := public._sling_rat_advance(a.rat_state, p_release + 18 - a.last_tick);
    v_mark := public._sling_mark(v_rat, p_press, p_release, p_aim);
    if (v_mark = 'hit') <> p_hit then
      v_code := 'sling_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', a.seed, 'mark', v_mark, 'rat_x', v_rat[1]);
    end if;
  end if;
  -- 0065 {
  -- the shot, and its aim: ≥ 20 shots today with ≥ 70 % on the rat's spot is soft (once a day); the 3rd such day in 7
  -- is hard and the shot catches nothing
  if v_code is null then
    v_exact := v_mark = 'hit' and abs(v_rat[1] - p_aim) <= 1500;
    perform public._ac_stat(v_account, 'sling', 1, case when v_mark = 'hit' then 1 else 0 end, case when v_exact then 1 else 0 end);
    select * into st from public.ac_play_stats where account_id = v_account and day = public._vn_today() and game = 'sling';
    if v_exact and st.plays >= 20 and 10 * st.exact >= 7 * st.plays
       and not exists (select 1 from public.anticheat_events e where e.account_id = v_account and e.code = 'sling_timing'
                         and e.created_at >= public._vn_day_start()) then
      perform public._ac_flag(v_account, 'sling_timing', 'sling_shoot',
                              v_ev || jsonb_build_object('shots', st.plays, 'exact', st.exact, 'miss_mpx', abs(v_rat[1] - p_aim)),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'sling_timing' and e.created_at > now() - interval '7 days') >= 3 then
        v_code := 'sling_timing_repeat';
        v_ev := v_ev || jsonb_build_object('shots', st.plays, 'exact', st.exact, 'pattern', '3 days in 7');
      end if;
    end if;
  end if;
  -- 0065 }
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'sling_shoot', v_ev, p_room_id, 'invalid shot');
    return public._field_view(p_room_id, v_account, now()) || v_ac;
  end if;
  update public.sling_aims set rat_state = v_rat, last_tick = p_release + 18 where account_id = v_account;
  return public._rat_do_sling_shoot(p_room_id, v_account, p_rat_id, v_mark = 'hit', now());
end $$;
revoke all on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer) from public;
revoke all on function public.net_haul(text, uuid, integer, integer, integer, integer, integer) from public;
revoke all on function public.harvest_part(uuid, text, integer, integer[], integer, boolean) from public;
revoke all on function public.crab_finish(uuid, text, uuid, integer[], integer, integer) from public;
revoke all on function public.sling_shoot(uuid, text, bigint, integer, integer, integer, boolean) from public;
grant execute on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer) to anon, authenticated;
grant execute on function public.net_haul(text, uuid, integer, integer, integer, integer, integer) to anon, authenticated;
grant execute on function public.harvest_part(uuid, text, integer, integer[], integer, boolean) to anon, authenticated;
grant execute on function public.crab_finish(uuid, text, uuid, integer[], integer, integer) to anon, authenticated;
grant execute on function public.sling_shoot(uuid, text, bigint, integer, integer, integer, boolean) to anon, authenticated;

-- ---------- F. Admin ----------
-- Every account with an open statistics flag or on the blacklist (at most 200): its flags, its 7-day games, its 24-h
-- income, its hard events of 30 days.
create or replace function public.admin_anticheat_stats(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return jsonb_build_object(
    'config', public._ac_config_json(),
    'run_at', (select run_at from public.ac_stats_state where id),
    'took_ms', (select took_ms from public.ac_stats_state where id),
    'server_now', now(),
    'accounts', coalesce((
      select jsonb_agg(x.j order by x.last_at desc nulls last)
        from (select jsonb_build_object(
                'account_id', a.id, 'username', a.username, 'is_root', a.is_root, 'is_banned', a.is_banned,
                'blacklisted', bl.account_id is not null, 'blacklist_note', bl.note, 'blacklisted_at', bl.created_at,
                'flags', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'key', f.key, 'value', f.value,
                                     'baseline', f.baseline, 'n', f.n, 'detail', f.detail, 'first_at', f.first_at,
                                     'last_at', f.last_at, 'hits', f.hits) order by f.last_at desc)
                                     from public.ac_stat_flags f where f.account_id = a.id and f.reviewed_at is null), '[]'::jsonb),
                'games', coalesce((select jsonb_agg(jsonb_build_object('game', g.game, 'plays', g.n, 'wins', g.w, 'exact', g.e)
                                                    order by g.game)
                                     from public._ac_games() g where g.account_id = a.id), '[]'::jsonb),
                'income', coalesce((select jsonb_object_agg(i.reason, i.xu) from (
                                      select l.reason, sum(l.delta) xu from public.coin_ledger l
                                       where l.account_id = a.id and l.delta > 0 and l.created_at > now() - interval '24 hours'
                                       group by 1) i), '{}'::jsonb),
                'hard_30d', (select count(*) from public.anticheat_events e where e.account_id = a.id
                               and e.created_at > now() - interval '30 days'
                               and e.outcome in ('log_only', 'in_lock', 'strike_1', 'strike_2'))) j,
                     greatest(bl.created_at, (select max(f.last_at) from public.ac_stat_flags f
                                               where f.account_id = a.id and f.reviewed_at is null)) last_at
                from public.accounts a
                left join public.blacklisted_accounts bl on bl.account_id = a.id
               where bl.account_id is not null
                  or exists (select 1 from public.ac_stat_flags f where f.account_id = a.id and f.reviewed_at is null)
               order by last_at desc nulls last
               limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.admin_anticheat_stats_run(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  update public.ac_stats_state set run_at = now() where id;
  perform public._ac_stats_run();
  return public.admin_anticheat_stats(p_session_token);
end $$;

-- The blacklist by hand: on (a note), or off (the auto-blacklist then counts only hard events after this).
create or replace function public.admin_blacklist_set(p_session_token text, p_account_id uuid, p_on boolean,
                                                      p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token);
begin
  if p_account_id is null or p_on is null or not exists (select 1 from public.accounts where id = p_account_id) then
    raise exception 'invalid account' using errcode = '22023';
  end if;
  if p_on then
    insert into public.blacklisted_accounts (account_id, note)
    values (p_account_id, coalesce(nullif(btrim(left(p_note, 200)), ''), 'admin ' || public._vn_today()))
    on conflict (account_id) do update set note = excluded.note;
  else
    delete from public.blacklisted_accounts where account_id = p_account_id;
    insert into public.anticheat_status (account_id, blacklist_cleared_at) values (p_account_id, now())
    on conflict (account_id) do update set blacklist_cleared_at = now();
  end if;
  return jsonb_build_object('account_id', p_account_id,
                            'blacklisted', exists (select 1 from public.blacklisted_accounts where account_id = p_account_id));
end $$;

-- Root looked at an account's statistics flags: they leave the list (a flag that still holds a week later comes back).
create or replace function public.admin_stat_review(p_session_token text, p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer;
begin
  perform public._auth_root(p_session_token);
  update public.ac_stat_flags set reviewed_at = now() where account_id = p_account_id and reviewed_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('account_id', p_account_id, 'reviewed', v_n);
end $$;
revoke all on function public.admin_anticheat_stats(text) from public;
revoke all on function public.admin_anticheat_stats_run(text) from public;
revoke all on function public.admin_blacklist_set(text, uuid, boolean, text) from public;
revoke all on function public.admin_stat_review(text, uuid) from public;
grant execute on function public.admin_anticheat_stats(text) to anon, authenticated;
grant execute on function public.admin_anticheat_stats_run(text) to anon, authenticated;
grant execute on function public.admin_blacklist_set(text, uuid, boolean, text) to anon, authenticated;
grant execute on function public.admin_stat_review(text, uuid) to anon, authenticated;
