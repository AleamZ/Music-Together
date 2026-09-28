-- =========================================================
-- 0051_bai_dat.sql — v20.3 Bãi đất trống: the four rings, challenges and stakes, the streamed PvP settlement (spec
-- docs/superpowers/specs/2026-09-28-v20-fight-design.md §v20.3 and the owner's rulings at its end: caps 2 live fights
-- per room and 4 overall; a 5 % burned fee on PvP stakes; plan docs/superpowers/plans/2026-09-28-v20-3-arena.md, rulings
-- P1–P25). ADDITIVE and re-runnable. Run after 0049 and 0050.
--   A. fight_config (the caps and the fee, one row), fight_rings (room × ring 1–4: the corners, the offer, the live
--      match), fight_conflicts (a broadcast log that differs from the pushed one); new columns on fight_logs (seen_checked,
--      the pending hash, resync, blamed).
--   B. characters.belt: the rank of the style whose uniform is worn (the world chibi draws that belt), kept by triggers.
--   C. The PvP rules: _pvp_void (refunds), _pvp_settle (the winner gets 2 × stake − 5 %, a draw refunds; records, news,
--      stall blame), _pvp_sweep (both absent 120 s: void; 20 minutes: overtime), _pvp_conflicts (seen ≠ canonical: the
--      match is disputed and refunded; 2 conflicts in 30 days lock stakes for 7 days; 3 with ≥ 2 opponents flag hard),
--      _pvp_caps, _ring_sweep, _ring_json, _fx_forfeit_all.
--   D. Re-created from 0049 (every added line marked "-- v20.3", blocks between "-- v20.3 {" and "-- v20.3 }"):
--      _fx_settle (kind pvp), _fx_answer (the seen frontiers), fight_push (seen, the conflict check, the deferred hash
--      check, the ring match's lazy rules), fight_state (the lazy rules, the resync flag).
--   E. RPCs ring_state, ring_take, ring_leave, ring_offer, ring_accept, fight_claim, ring_board ("Bảng thành tích");
--      admin_fight_list, admin_fight_log, admin_fight_config (root).
--   F. _in_shade: 0050's body plus bai_dat and its four ring roofs (R7).
--   G. The ledger: 0050's 45 reasons plus fight_stake, fight_win, fight_refund: 48.
--   H. _ac_wipe (0043's, the newest) settles live matches first and clears the fight and martial-arts rows; account
--      deletion settles them too (trigger fight_accounts_bd).
-- Anti-cheat (the 0015 envelope): hard fight_bad_input / fight_too_fast (as 0049; in PvP the push is refused, the match
-- goes on), soft fight_hash_mismatch (hard at 3 matches in 7 days), soft fight_log_conflict (hard
-- fight_log_conflict_pattern), soft fight_stall_blame, soft fight_abandon. Caps, busy rings, not enough xu, offer races,
-- early claims and settled matches are answers.
-- Lock order everywhere: match row → ring row → wallets in account-id order (plan ruling P19).
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.fight_config (
  id boolean primary key default true check (id),
  max_live_room integer not null default 2,
  max_live_all integer not null default 4,
  max_staked_day integer not null default 15,
  max_pair_day integer not null default 3,
  max_friendly_pair_day integer not null default 10,
  fee_pct integer not null default 5 check (fee_pct between 0 and 50)
);
insert into public.fight_config (id) values (true) on conflict (id) do nothing;
alter table public.fight_config enable row level security;
revoke all on public.fight_config from anon, authenticated;

create table if not exists public.fight_rings (
  room_id uuid not null references public.rooms(id) on delete cascade,
  ring smallint not null check (ring between 1 and 4),
  red uuid null references public.accounts(id) on delete set null,
  blue uuid null references public.accounts(id) on delete set null,
  red_at timestamptz null,
  blue_at timestamptz null,
  offer_stake integer null,
  offer_by smallint null check (offer_by in (1, 2)),
  offer_v integer not null default 0,
  offer_at timestamptz null,
  red_ok integer null,                                  -- the offer version red accepted
  blue_ok integer null,
  red_n smallint null,                                  -- the input delay each proposed (2–6)
  blue_n smallint null,
  match_id uuid null references public.fight_matches(id) on delete set null,
  v integer not null default 0,                         -- bumped on every change (the rg hint)
  primary key (room_id, ring)
);
create index if not exists fight_rings_red on public.fight_rings (red) where red is not null;
create index if not exists fight_rings_blue on public.fight_rings (blue) where blue is not null;
alter table public.fight_rings enable row level security;
revoke all on public.fight_rings from anon, authenticated;

create table if not exists public.fight_conflicts (
  id bigserial primary key,
  match_id uuid not null references public.fight_matches(id) on delete cascade,
  reporter uuid null references public.accounts(id) on delete set null,   -- whose seen log differs
  reported uuid null references public.accounts(id) on delete set null,   -- whose pushed log it differs from
  from_frame integer not null,
  to_frame integer not null,
  canonical integer[] not null,
  seen integer[] not null,
  created_at timestamptz not null default now()
);
create index if not exists fight_conflicts_reporter on public.fight_conflicts (reporter, created_at);
create index if not exists fight_conflicts_reported on public.fight_conflicts (reported, created_at);
alter table public.fight_conflicts enable row level security;
revoke all on public.fight_conflicts from anon, authenticated;

create index if not exists fight_matches_pvp_live on public.fight_matches (room_id) where status = 'live' and kind = 'pvp';
create index if not exists fight_matches_kind_created on public.fight_matches (kind, created_at);

alter table public.fight_logs add column if not exists seen_checked integer not null default -1;  -- seen compared up to
alter table public.fight_logs add column if not exists pend_hash_frame integer null;              -- the client's hash to check
alter table public.fight_logs add column if not exists pend_hash bigint null;
alter table public.fight_logs add column if not exists resync boolean not null default false;     -- told on the next push
alter table public.fight_logs add column if not exists blamed boolean not null default false;     -- caused > 20 % stall

-- ---------- B. The belt on the world chibi (plan ruling P23) ----------
alter table public.characters add column if not exists belt smallint null check (belt between 0 and 4);

create or replace function public._char_belt() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  new.belt := (select e.rank from public.martial_styles s
                 join public.martial_enrollments e on e.style = s.id and e.account_id = new.account_id
                where s.uniform = new.outfit);
  return new;
end $$;
drop trigger if exists characters_belt on public.characters;
create trigger characters_belt before insert or update of outfit on public.characters
  for each row execute function public._char_belt();

create or replace function public._enroll_belt() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid := coalesce(new.account_id, old.account_id);
begin
  update public.characters c
     set belt = (select e.rank from public.martial_styles s
                   join public.martial_enrollments e on e.style = s.id and e.account_id = c.account_id
                  where s.uniform = c.outfit)
   where c.account_id = v_acc and (c.outfit like 'vp\_%' or c.belt is not null);
  return null;
end $$;
drop trigger if exists martial_enrollments_belt on public.martial_enrollments;
create trigger martial_enrollments_belt after insert or update of rank or delete on public.martial_enrollments
  for each row execute function public._enroll_belt();

-- the belts of the uniforms worn today
update public.characters set outfit = outfit where outfit like 'vp\_%';

-- ---------- C. The PvP rules ----------
-- the Vietnam day's first instant (the daily caps)
create or replace function public._vn_day_start() returns timestamptz
language sql stable set search_path = public, extensions
as $$ select (public._vn_today()::timestamp at time zone 'Asia/Ho_Chi_Minh') $$;

-- A fighter as the rings show them: name, the worn uniform's style and rank, the PvP record
create or replace function public._ring_fighter(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select case when p_account is null then null else (
    select jsonb_build_object('id', a.id, 'name', a.username, 'style', s.id, 'idx', s.sort, 'rank', e.rank,
                              'wins', coalesce(f.wins, 0), 'losses', coalesce(f.losses, 0), 'draws', coalesce(f.draws, 0),
                              'locked_until_ms', case when f.pvp_locked_until > now() then public._dojo_ms(f.pvp_locked_until) end)
      from public.accounts a
      left join public.characters c on c.account_id = a.id
      left join public.martial_styles s on s.uniform = c.outfit
      left join public.martial_enrollments e on e.style = s.id and e.account_id = a.id
      left join public.fight_profiles f on f.account_id = a.id
     where a.id = p_account) end
$$;

-- A void (both absent, a conflict): no winner, both stakes refunded, no vitals cost; the ring is freed. The caller
-- holds the match row.
create or replace function public._pvp_void(p_match uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; v_res jsonb; v_ref text;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then return null; end if;
  if mt.status <> 'live' then return mt.result; end if;
  update public.fight_matches
     set status = p_status, winner = null, end_reason = p_reason, ended_at = now(), rounds = public._fx_rounds_json(mt.sim)
   where id = p_match;
  update public.fight_rings set match_id = null, v = v + 1 where match_id = p_match;
  if mt.stake > 0 then
    v_ref := 'pvp ' || left(p_match::text, 8);
    perform public._wallet_lock(least(mt.p1, mt.p2));
    perform public._wallet_lock(greatest(mt.p1, mt.p2));
    perform public._pay(mt.p1, mt.stake, 'fight_refund', v_ref || ': ' || p_reason);
    perform public._pay(mt.p2, mt.stake, 'fight_refund', v_ref || ': ' || p_reason);
  end if;
  v_res := jsonb_build_object('winner', null, 'void', true, 'status', p_status, 'end_reason', p_reason,
                              'rounds', public._fx_rounds_json(mt.sim), 'rounds_played', 0,
                              'vitals', jsonb_build_object('hunger', 0, 'thirst', 0),
                              'pvp', jsonb_build_object('stake', mt.stake, 'pot', 2 * mt.stake, 'fee', 0, 'won', 0, 'refund', mt.stake));
  update public.fight_matches set result = v_res where id = p_match;
  return v_res;
end $$;

-- 0049's _fx_settle for kind pvp (the match is already 'done' with its winner): the ring, the pay (a win takes the pot
-- less the burned fee; a draw refunds), the records, the stall blame, the news. Returns what the result adds.
create or replace function public._pvp_settle(p_match uuid, p_winner smallint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; cfg public.fight_config; v_pot integer; v_fee integer := 0; v_won integer := 0;
        v_ref text; v_wacc uuid; v_lacc uuid; j integer; v_acc uuid; v_opp_stall integer; n integer; d integer;
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
    if coalesce(v_opp_stall, 0) * 5 > greatest(mt.sim_frame, 600) then
      update public.fight_logs set blamed = true where match_id = p_match and side = j;
      select count(*), count(distinct case when m.p1 = v_acc then m.p2 else m.p1 end) into n, d
        from public.fight_logs l join public.fight_matches m on m.id = l.match_id
       where l.account_id = v_acc and l.blamed and m.kind = 'pvp' and coalesce(m.ended_at, now()) > now() - interval '7 days';
      if n >= 3 and d >= 2 then
        perform public._ac_flag(v_acc, 'fight_stall_blame', 'fight_push',
                  jsonb_build_object('match', p_match, 'stall_frames', v_opp_stall, 'frames', mt.sim_frame, 'matches', n, 'opponents', d),
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

-- A ring match's lazy rules (plan ruling P17): both absent 120 s voids it; 20 minutes after frame 0 it is decided from
-- the server's sim (the round in progress to the higher HP‰; the match to more round wins; a tie is a draw).
create or replace function public._pvp_sweep(p_match uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; a1 timestamptz; a2 timestamptz; w1 integer; w2 integer; h1 integer; h2 integer;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found or mt.status <> 'live' or mt.kind <> 'pvp' then return; end if;
  a1 := coalesce((select last_push_at from public.fight_logs where match_id = p_match and side = 1), mt.started_at);
  a2 := coalesce((select last_push_at from public.fight_logs where match_id = p_match and side = 2), mt.started_at);
  if greatest(a1, a2, mt.started_at) < now() - interval '120 seconds' then
    perform public._pvp_void(p_match, 'void', 'abandon');
    perform public._ac_flag(mt.p1, 'fight_abandon', 'fight_sweep', jsonb_build_object('match', p_match, 'frame', mt.sim_frame), mt.room_id, null, false);
    perform public._ac_flag(mt.p2, 'fight_abandon', 'fight_sweep', jsonb_build_object('match', p_match, 'frame', mt.sim_frame), mt.room_id, null, false);
    return;
  end if;
  if mt.started_at < now() - interval '20 minutes' then
    w1 := mt.sim[49 + 36];
    w2 := mt.sim[113 + 36];
    if mt.sim[1 + 1] = 1 then
      h1 := mt.sim[49 + 5] * 1000 / greatest(1, mt.sim[49 + 51]);
      h2 := mt.sim[113 + 5] * 1000 / greatest(1, mt.sim[113 + 51]);
      if h1 > h2 then w1 := w1 + 1; elsif h2 > h1 then w2 := w2 + 1; end if;
    end if;
    perform public._fx_settle(p_match, (case when w1 > w2 then 1 when w2 > w1 then 2 else 0 end)::smallint, 'overtime');
  end if;
end $$;

-- the corners: one held 5 minutes with the other empty is released; an offer lapses after 30 s (plan ruling P5)
create or replace function public._ring_sweep(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.fight_rings
     set red = case when red is not null and blue is null and red_at < now() - interval '5 minutes' then null else red end,
         blue = case when blue is not null and red is null and blue_at < now() - interval '5 minutes' then null else blue end,
         offer_stake = null, offer_by = null, offer_at = null, red_ok = null, blue_ok = null, v = v + 1
   where room_id = p_room and match_id is null
     and ((red is not null and blue is null and red_at < now() - interval '5 minutes')
       or (blue is not null and red is null and blue_at < now() - interval '5 minutes')
       or (offer_at is not null and offer_at < now() - interval '30 seconds'));
end $$;

-- every live ring match of the room, skipping one another call holds (it runs the rules itself)
create or replace function public._pvp_sweep_room(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  for v_id in select id from public.fight_matches where room_id = p_room and kind = 'pvp' and status = 'live'
               order by id for update skip locked loop
    perform public._pvp_sweep(v_id);
  end loop;
  perform public._ring_sweep(p_room);
end $$;

-- 2 conflicts in 30 days lock stakes for 7 days; 3 with at least 2 distinct opponents flag hard (plan ruling P16)
create or replace function public._pvp_conflict_pattern(p_account uuid, p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare n integer; d integer;
begin
  select count(*), count(distinct case when c.reporter = p_account then c.reported else c.reporter end) into n, d
    from public.fight_conflicts c
   where (c.reporter = p_account or c.reported = p_account) and c.created_at > now() - interval '30 days';
  if n >= 2 then
    insert into public.fight_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
    update public.fight_profiles set pvp_locked_until = greatest(coalesce(pvp_locked_until, now()), now() + interval '7 days')
     where account_id = p_account;
  end if;
  if n >= 3 and d >= 2 then
    perform public._ac_flag(p_account, 'fight_log_conflict_pattern', 'fight_push',
                            jsonb_build_object('conflicts', n, 'opponents', d), p_room, null, true);
  end if;
end $$;

-- Each side's seen log against the other side's canonical runs over the frames both cover (at most 1 200 a call). The
-- first difference disputes the match: refunds, a fight_conflicts row, soft flags to both. Returns true when it did.
create or replace function public._pvp_conflicts(p_match uuid) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; rep public.fight_logs; oth public.fight_logs; j integer; lo integer; hi integer;
        a integer[]; b integer[]; k integer; n integer; v_first integer;
begin
  select * into mt from public.fight_matches where id = p_match;
  for j in 1..2 loop
    select * into rep from public.fight_logs where match_id = p_match and side = j;
    select * into oth from public.fight_logs where match_id = p_match and side = 3 - j;
    lo := rep.seen_checked + 1;
    hi := least(coalesce(rep.seen_frontier, -1), oth.frontier, lo + 1199);
    continue when hi < lo;
    a := public._fx_runs_slice(rep.seen_runs, lo, hi - lo + 1);
    b := public._fx_runs_slice(oth.runs, lo, hi - lo + 1);
    if a is distinct from b then
      n := cardinality(a);
      k := 1;
      while k <= n and a[k] = b[k] loop k := k + 1; end loop;
      v_first := lo + k - 1;
      insert into public.fight_conflicts (match_id, reporter, reported, from_frame, to_frame, canonical, seen)
      values (p_match, rep.account_id, oth.account_id, v_first, hi,
              public._fx_runs_encode(b[k:least(n, k + 299)]), public._fx_runs_encode(a[k:least(n, k + 299)]));
      perform public._pvp_void(p_match, 'disputed', 'conflict');
      perform public._ac_flag(rep.account_id, 'fight_log_conflict', 'fight_push',
                jsonb_build_object('match', p_match, 'frame', v_first, 'role', 'reporter'), mt.room_id, null, false);
      perform public._ac_flag(oth.account_id, 'fight_log_conflict', 'fight_push',
                jsonb_build_object('match', p_match, 'frame', v_first, 'role', 'reported'), mt.room_id, null, false);
      perform public._pvp_conflict_pattern(rep.account_id, mt.room_id);
      perform public._pvp_conflict_pattern(oth.account_id, mt.room_id);
      return true;
    end if;
    update public.fight_logs set seen_checked = hi where match_id = p_match and side = j;
  end loop;
  return false;
end $$;

-- the caps (plan ruling P7): null when the match may start, else the refusal
create or replace function public._pvp_caps(p_room uuid, p_a uuid, p_b uuid, p_stake integer) returns text
language plpgsql stable security definer set search_path = public, extensions
as $$
declare cfg public.fight_config; v_day timestamptz := public._vn_day_start(); v_acc uuid; v_cap integer;
begin
  select * into cfg from public.fight_config where id;
  if (select count(*) from public.fight_matches where kind = 'pvp' and status = 'live' and room_id = p_room) >= cfg.max_live_room
     or (select count(*) from public.fight_matches where kind = 'pvp' and status = 'live') >= cfg.max_live_all then
    return 'ring busy';
  end if;
  if p_stake > 0 then
    foreach v_acc in array array[p_a, p_b] loop
      if (select count(*) from public.fight_matches
           where kind = 'pvp' and stake > 0 and created_at >= v_day and (p1 = v_acc or p2 = v_acc)) >= cfg.max_staked_day then
        return 'daily fight limit';
      end if;
    end loop;
  end if;
  v_cap := case when p_stake > 0 then cfg.max_pair_day else cfg.max_friendly_pair_day end;
  if (select count(*) from public.fight_matches
       where kind = 'pvp' and created_at >= v_day and (stake > 0) = (p_stake > 0)
         and ((p1 = p_a and p2 = p_b) or (p1 = p_b and p2 = p_a))) >= v_cap then
    return 'daily fight limit';
  end if;
  return null;
end $$;

-- What the rings of a room show (and the caller's own ring match, for a reload)
create or replace function public._ring_json(p_room uuid, p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'rings', (select jsonb_agg(jsonb_build_object(
        'ring', g.n, 'v', coalesce(r.v, 0),
        'red', public._ring_fighter(r.red), 'blue', public._ring_fighter(r.blue),
        'red_since_ms', public._dojo_ms(r.red_at), 'blue_since_ms', public._dojo_ms(r.blue_at),
        'offer', case when r.offer_stake is not null then jsonb_build_object(
            'stake', r.offer_stake, 'by', r.offer_by, 'v', r.offer_v, 'at_ms', public._dojo_ms(r.offer_at),
            'red_ok', coalesce(r.red_ok = r.offer_v, false), 'blue_ok', coalesce(r.blue_ok = r.offer_v, false),
            'red_n', r.red_n, 'blue_n', r.blue_n) end,
        'match', (select jsonb_build_object('id', mt.id, 'status', mt.status, 'stake', mt.stake,
                    'started_at_ms', public._dojo_ms(mt.started_at), 'round', mt.sim[3 + 1], 'phase', mt.sim[1 + 1],
                    'w1', mt.sim[49 + 36], 'w2', mt.sim[113 + 36])
                    from public.fight_matches mt where mt.id = r.match_id and mt.status = 'live'))
        order by g.n)
      from generate_series(1, 4) g(n)
      left join public.fight_rings r on r.room_id = p_room and r.ring = g.n),
    'mine', (select jsonb_build_object('id', mt.id, 'room_id', mt.room_id, 'ring', mt.ring,
                                       'side', case when mt.p1 = p_account then 1 else 2 end,
                                       'params', mt.params, 'stake', mt.stake, 'started_at_ms', public._dojo_ms(mt.started_at),
                                       'foe', public._ring_fighter(case when mt.p1 = p_account then mt.p2 else mt.p1 end))
               from public.fight_matches mt
              where mt.kind = 'pvp' and mt.status = 'live' and (mt.p1 = p_account or mt.p2 = p_account)
              order by mt.created_at desc limit 1),
    'locked_until_ms', (select case when f.pvp_locked_until > now() then public._dojo_ms(f.pvp_locked_until) end
                          from public.fight_profiles f where f.account_id = p_account),
    'live_room', (select count(*) from public.fight_matches where kind = 'pvp' and status = 'live' and room_id = p_room),
    'live_all', (select count(*) from public.fight_matches where kind = 'pvp' and status = 'live'),
    'config', (select to_jsonb(c) - 'id' from public.fight_config c where c.id),
    'server_now_ms', public._dojo_ms(now()))
$$;

-- An account's live matches settle as its forfeits (a wipe, a deletion: the opponent is paid first); its corners go
create or replace function public._fx_forfeit_all(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;
begin
  for r in select id, p1, p2 from public.fight_matches
            where status = 'live' and (p1 = p_account or p2 = p_account) order by id for update loop
    perform public._fx_settle(r.id, (case when r.p2 is null or r.p1 = p_account then 2 else 1 end)::smallint, 'forfeit');
  end loop;
  update public.fight_rings
     set red = case when red = p_account then null else red end,
         blue = case when blue = p_account then null else blue end,
         offer_stake = null, offer_by = null, offer_at = null, red_ok = null, blue_ok = null, v = v + 1
   where red = p_account or blue = p_account;
end $$;

-- ---------- D. The pipeline, re-created from 0049 ----------
-- 0049's _fx_settle plus the marked line: a ring match pays and records (_pvp_settle).
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
  if mt.kind = 'pvp' then v_extra := coalesce(public._pvp_settle(p_match, p_winner, p_reason), '{}'::jsonb); end if;   -- v20.3
  v_res := jsonb_build_object('winner', p_winner, 'end_reason', p_reason, 'rounds', public._fx_rounds_json(mt.sim),
                              'rounds_played', n, 'vitals', jsonb_build_object('hunger', 2 * n, 'thirst', 3 * n)) || v_extra;
  update public.fight_matches set result = v_res where id = p_match;
  return v_res;
end $$;

-- 0049's _fx_answer plus the marked line: the seen frontiers (PvP pushes resume from them).
create or replace function public._fx_answer(p_match uuid, p_side smallint) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', mt.id, 'kind', mt.kind, 'status', mt.status, 'side', p_side,
    'sim_frame', mt.sim_frame,
    'frontiers', jsonb_build_array((select l.frontier from public.fight_logs l where l.match_id = mt.id and l.side = 1),
                                   (select l.frontier from public.fight_logs l where l.match_id = mt.id and l.side = 2)),
    'seen', jsonb_build_array((select coalesce(l.seen_frontier, -1) from public.fight_logs l where l.match_id = mt.id and l.side = 1),   -- v20.3
                              (select coalesce(l.seen_frontier, -1) from public.fight_logs l where l.match_id = mt.id and l.side = 2)),  -- v20.3
    'result', mt.result,
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
  from public.fight_matches mt where mt.id = p_match
$$;

-- 0049's fight_push plus the marked lines and blocks (v20.3): a ring match's lazy rules; my `seen` log (the opponent's
-- inputs as I received them), validated and appended like my own runs; the conflict check; my hash kept as pending and
-- compared when the replay passes its frame, once that side's seen is checked (plan rulings P14–P17).
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
  -- v20.3 {
  if mt.status = 'live' and not v_bot then
    perform public._pvp_sweep(p_match);
    select * into mt from public.fight_matches where id = p_match;
  end if;
  -- v20.3 }
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
      if not v_bot and (v_pf[1] = v_fr or v_pf[2] = v_fr) then                                        -- v20.3
        for j in 1..2 loop if v_pf[j] = v_fr then v_pc[j] := public._fx_hash(s); end if; end loop;  -- v20.3
      end if;                                                                                          -- v20.3
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
  return public._fx_answer(p_match, v_side) || jsonb_build_object('resync', v_resync) || coalesce(v_ac, '{}'::jsonb);   -- v20.3
  return public._fx_answer(p_match, v_side) || jsonb_build_object('resync', v_resync);
end $$;

-- 0049's fight_state plus the marked lines: a ring match's lazy rules first, and a resync flag is consumed.
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
  if mt.status = 'live' and mt.p2 is not null then perform public._pvp_sweep(p_match); select * into mt from public.fight_matches where id = p_match; end if;   -- v20.3
  update public.fight_logs set resync = false where match_id = p_match and side = v_side and resync;                                                     -- v20.3
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

-- ---------- E. The ring RPCs ----------
create or replace function public.ring_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  perform public._pvp_sweep_room(p_room_id);
  return public._ring_json(p_room_id, v_account);
end $$;

-- Taking a corner (spec §v20.3 "Challenge flow" 1): a worn uniform of an enrolled style, fit to fight, not in another
-- corner or a live match. Moving to the other corner of the same ring is allowed.
create or replace function public.ring_take(p_room_id uuid, p_session_token text, p_ring integer, p_corner text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); r public.fight_rings;
begin
  if p_ring is null or p_ring not between 1 and 4 or p_corner is null or p_corner not in ('red', 'blue') then
    raise exception 'bad ring' using errcode = '22023';
  end if;
  perform public._pvp_sweep_room(p_room_id);
  perform public._fx_style_of(v_account);
  perform public._fx_vitals_ok(v_account);
  if exists (select 1 from public.fight_matches where status = 'live' and (p1 = v_account or p2 = v_account)) then
    raise exception 'in a match' using errcode = '53400';
  end if;
  if exists (select 1 from public.fight_rings where (red = v_account or blue = v_account)
                                                 and not (room_id = p_room_id and ring = p_ring)) then
    raise exception 'already in a corner' using errcode = '53400';
  end if;
  insert into public.fight_rings (room_id, ring) values (p_room_id, p_ring) on conflict (room_id, ring) do nothing;
  select * into r from public.fight_rings where room_id = p_room_id and ring = p_ring for update;
  if r.match_id is not null and exists (select 1 from public.fight_matches where id = r.match_id and status = 'live') then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('refused', 'ring busy');
  end if;
  if (p_corner = 'red' and r.red is not null and r.red <> v_account) or (p_corner = 'blue' and r.blue is not null and r.blue <> v_account) then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('refused', 'corner taken');
  end if;
  if (p_corner = 'red' and r.red is distinct from v_account) or (p_corner = 'blue' and r.blue is distinct from v_account) then
    update public.fight_rings
       set red = case when p_corner = 'red' then v_account when red = v_account then null else red end,
           red_at = case when p_corner = 'red' then now() when red = v_account then null else red_at end,
           blue = case when p_corner = 'blue' then v_account when blue = v_account then null else blue end,
           blue_at = case when p_corner = 'blue' then now() when blue = v_account then null else blue_at end,
           offer_stake = null, offer_by = null, offer_at = null, red_ok = null, blue_ok = null, match_id = null, v = v + 1
     where room_id = p_room_id and ring = p_ring;
  end if;
  return public._ring_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

-- Leaving my corner ("Rời sàn"); during a live match it is a surrender instead (fight_forfeit)
create or replace function public.ring_leave(p_room_id uuid, p_session_token text, p_ring integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token); r public.fight_rings;
begin
  perform public._pvp_sweep_room(p_room_id);
  select * into r from public.fight_rings where room_id = p_room_id and ring = p_ring for update;
  if found and (r.red = v_account or r.blue = v_account) then
    if r.match_id is not null and exists (select 1 from public.fight_matches where id = r.match_id and status = 'live') then
      raise exception 'in a match' using errcode = '53400';
    end if;
    update public.fight_rings
       set red = case when red = v_account then null else red end, red_at = case when red = v_account then null else red_at end,
           blue = case when blue = v_account then null else blue end, blue_at = case when blue = v_account then null else blue_at end,
           offer_stake = null, offer_by = null, offer_at = null, red_ok = null, blue_ok = null, v = v + 1
     where room_id = p_room_id and ring = p_ring;
  end if;
  return public._ring_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

-- An offer: the stake (a preset) and my input delay; I count as accepting it; the other must accept this version
create or replace function public.ring_offer(p_room_id uuid, p_session_token text, p_ring integer, p_stake integer, p_n integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); r public.fight_rings; v_side smallint;
begin
  if p_stake is null or p_stake not in (0, 100, 500, 1000, 2000, 5000, 10000) then raise exception 'bad stake' using errcode = '22023'; end if;
  if p_n is null or p_n not between 2 and 6 then raise exception 'bad delay' using errcode = '22023'; end if;
  perform public._pvp_sweep_room(p_room_id);
  select * into r from public.fight_rings where room_id = p_room_id and ring = p_ring for update;
  if not found or (r.red is distinct from v_account and r.blue is distinct from v_account) then
    raise exception 'not in ring' using errcode = '22023';
  end if;
  v_side := case when r.red = v_account then 1 else 2 end;
  if r.red is null or r.blue is null then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('refused', 'no opponent');
  end if;
  if r.match_id is not null and exists (select 1 from public.fight_matches where id = r.match_id and status = 'live') then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('refused', 'ring busy');
  end if;
  if p_stake > 0 and exists (select 1 from public.fight_profiles where account_id = v_account and pvp_locked_until > now()) then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('refused', 'pvp locked', 'who', case v_side when 1 then 'red' else 'blue' end);
  end if;
  update public.fight_rings
     set offer_stake = p_stake, offer_by = v_side, offer_v = offer_v + 1, offer_at = now(),
         red_ok = case when v_side = 1 then offer_v + 1 end, blue_ok = case when v_side = 2 then offer_v + 1 end,
         red_n = case when v_side = 1 then p_n else red_n end, blue_n = case when v_side = 2 then p_n else blue_n end,
         v = v + 1
   where room_id = p_room_id and ring = p_ring;
  return public._ring_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

-- Accepting offer version p_v with my input delay. When both have accepted, in one transaction: the fighters and the
-- caps re-checked, both stakes debited (fight_stake), the match created (frame 0 in 3 s). A refusal is an answer and
-- clears the acceptances (plan ruling P6).
create or replace function public.ring_accept(p_room_id uuid, p_session_token text, p_ring integer, p_v integer, p_n integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); r public.fight_rings; v_side smallint;
        v_code text; v_who text; s1 jsonb; s2 jsonb; v_params jsonb; v_match uuid; v_start timestamptz; c1 integer; c2 integer;
        v_refuse jsonb;
begin
  if p_n is null or p_n not between 2 and 6 then raise exception 'bad delay' using errcode = '22023'; end if;
  perform public._pvp_sweep_room(p_room_id);
  select * into r from public.fight_rings where room_id = p_room_id and ring = p_ring for update;
  if not found or (r.red is distinct from v_account and r.blue is distinct from v_account) then
    raise exception 'not in ring' using errcode = '22023';
  end if;
  v_side := case when r.red = v_account then 1 else 2 end;
  if r.match_id is not null and exists (select 1 from public.fight_matches where id = r.match_id and status = 'live') then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('refused', 'ring busy');
  end if;
  if r.offer_stake is null or r.offer_v is distinct from p_v or r.red is null or r.blue is null then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('refused', 'offer changed');
  end if;
  if v_side = 1 then r.red_ok := p_v; r.red_n := p_n; else r.blue_ok := p_v; r.blue_n := p_n; end if;
  update public.fight_rings set red_ok = r.red_ok, blue_ok = r.blue_ok, red_n = r.red_n, blue_n = r.blue_n, v = v + 1
   where room_id = p_room_id and ring = p_ring;
  if r.red_ok is distinct from r.offer_v or r.blue_ok is distinct from r.offer_v then
    return public._ring_json(p_room_id, v_account) || jsonb_build_object('ok', true);
  end if;
  -- both accepted: one start at a time project-wide (the caps count live matches)
  perform pg_advisory_xact_lock(hashtext('fight_rings_start'));
  begin
    v_who := 'red'; s1 := public._fx_style_of(r.red); perform public._fx_vitals_ok(r.red);
    v_who := 'blue'; s2 := public._fx_style_of(r.blue); perform public._fx_vitals_ok(r.blue);
    v_who := null;
  exception when others then
    v_code := sqlerrm;
  end;
  if v_code is null and r.offer_stake > 0 then
    if exists (select 1 from public.fight_profiles where account_id = r.red and pvp_locked_until > now()) then v_code := 'pvp locked'; v_who := 'red';
    elsif exists (select 1 from public.fight_profiles where account_id = r.blue and pvp_locked_until > now()) then v_code := 'pvp locked'; v_who := 'blue';
    end if;
  end if;
  if v_code is null then v_code := public._pvp_caps(p_room_id, r.red, r.blue, r.offer_stake); end if;
  if v_code is null then
    perform public._wallet_lock(least(r.red, r.blue));
    perform public._wallet_lock(greatest(r.red, r.blue));
    select coins into c1 from public.wallets where account_id = r.red;
    select coins into c2 from public.wallets where account_id = r.blue;
    if coalesce(c1, 0) < r.offer_stake then v_code := 'not enough xu'; v_who := 'red';
    elsif coalesce(c2, 0) < r.offer_stake then v_code := 'not enough xu'; v_who := 'blue';
    end if;
  end if;
  if v_code is not null then
    update public.fight_rings set red_ok = null, blue_ok = null, v = v + 1 where room_id = p_room_id and ring = p_ring;
    v_refuse := jsonb_build_object('refused', v_code, 'who', v_who);
    return public._ring_json(p_room_id, v_account) || v_refuse;
  end if;
  -- the match: red is p1, blue p2, each at the worn uniform's style and rank; the larger delay (plan ruling P8)
  v_params := jsonb_build_object('seed', floor(random() * 4294967296)::bigint, 'rounds', 3, 'maxRounds', 5,
    'delay', greatest(r.red_n, r.blue_n),
    'p1', jsonb_build_object('style', (s1->>'idx')::int, 'rank', (s1->>'rank')::int, 'movesMask', (1 << ((s1->>'rank')::int + 1)) - 1,
                             'hpPct', 100, 'bot', 0, 'en0', 0, 'atk', (s1->>'atk')::int, 'def', (s1->>'def')::int,
                             'walk', (s1->>'walk')::int, 'jump', (s1->>'jump')::int, 'energy', (s1->>'energy')::int),
    'p2', jsonb_build_object('style', (s2->>'idx')::int, 'rank', (s2->>'rank')::int, 'movesMask', (1 << ((s2->>'rank')::int + 1)) - 1,
                             'hpPct', 100, 'bot', 0, 'en0', 0, 'atk', (s2->>'atk')::int, 'def', (s2->>'def')::int,
                             'walk', (s2->>'walk')::int, 'jump', (s2->>'jump')::int, 'energy', (s2->>'energy')::int));
  v_start := now() + interval '3 seconds';
  insert into public.fight_matches (room_id, kind, p1, p2, params, stake, ring, started_at, sim)
  values (p_room_id, 'pvp', r.red, r.blue, v_params, r.offer_stake, p_ring, v_start, public._fx_new(v_params))
  returning id into v_match;
  update public.fight_matches set sim_hash = public._fx_hash(sim) where id = v_match;
  insert into public.fight_logs (match_id, side, account_id) values (v_match, 1, r.red), (v_match, 2, r.blue);
  if r.offer_stake > 0 then
    perform public._pay(r.red, -r.offer_stake, 'fight_stake', 'pvp ' || left(v_match::text, 8));
    perform public._pay(r.blue, -r.offer_stake, 'fight_stake', 'pvp ' || left(v_match::text, 8));
  end if;
  update public.fight_rings
     set match_id = v_match, offer_stake = null, offer_by = null, offer_at = null, red_ok = null, blue_ok = null, v = v + 1
   where room_id = p_room_id and ring = p_ring;
  return public._ring_json(p_room_id, v_account) || jsonb_build_object('ok', true, 'match', jsonb_build_object(
    'id', v_match, 'params', v_params, 'started_at_ms', public._dojo_ms(v_start), 'side', v_side, 'stake', r.offer_stake));
end $$;

-- "Đối thủ mất kết nối · Xử thắng": the opponent's last push older than 20 s while mine is within 10 s (plan ruling P17)
create or replace function public.fight_claim(p_session_token text, p_match uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); mt public.fight_matches; v_side smallint;
        v_mine timestamptz; v_theirs timestamptz;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if mt.p1 = v_account then v_side := 1;
  elsif mt.p2 = v_account then v_side := 2;
  else raise exception 'not your match' using errcode = '22023'; end if;
  if mt.kind <> 'pvp' then raise exception 'not a ring match' using errcode = '22023'; end if;
  perform public._pvp_sweep(p_match);
  select * into mt from public.fight_matches where id = p_match;
  if mt.status <> 'live' then return public._fx_answer(p_match, v_side) || jsonb_build_object('claimed', false); end if;
  v_mine := coalesce((select last_push_at from public.fight_logs where match_id = p_match and side = v_side), mt.started_at);
  v_theirs := coalesce((select last_push_at from public.fight_logs where match_id = p_match and side = 3 - v_side), mt.started_at);
  if v_theirs < now() - interval '20 seconds' and v_mine > now() - interval '10 seconds' then
    perform public._fx_settle(p_match, v_side, 'timeout_claim');
    return public._fx_answer(p_match, v_side) || jsonb_build_object('claimed', true);
  end if;
  return public._fx_answer(p_match, v_side) || jsonb_build_object('claimed', false,
    'wait_ms', greatest(0, ceil(extract(epoch from (v_theirs + interval '20 seconds' - now())) * 1000))::bigint);
end $$;

-- "Bảng thành tích": the room's top 10 ring fighters by wins over the last 7 days (settled matches only)
create or replace function public.ring_board(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._farm_auth(p_room_id, p_session_token);
  return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('name', public._news_name(t.acc), 'wins', t.wins,
                                                'losses', t.losses, 'draws', t.draws) order by t.wins desc, t.losses, t.acc)
    from (select x.acc, count(*) filter (where x.res = 1) as wins, count(*) filter (where x.res = -1) as losses,
                 count(*) filter (where x.res = 0) as draws
            from (select m.p1 as acc, case m.winner when 1 then 1 when 2 then -1 else 0 end as res
                    from public.fight_matches m
                   where m.room_id = p_room_id and m.kind = 'pvp' and m.status = 'done' and m.ended_at > now() - interval '7 days'
                  union all
                  select m.p2, case m.winner when 2 then 1 when 1 then -1 else 0 end
                    from public.fight_matches m
                   where m.room_id = p_room_id and m.kind = 'pvp' and m.status = 'done' and m.ended_at > now() - interval '7 days') x
           group by x.acc
           order by 2 desc, 3, 1
           limit 10) t), '[]'::jsonb),
    'server_now_ms', public._dojo_ms(now()));
end $$;

-- ---------- admin (root) ----------
create or replace function public.admin_fight_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return jsonb_build_object(
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'status', m.status, 'end_reason', m.end_reason, 'winner', m.winner, 'stake', m.stake, 'ring', m.ring,
        'p1', public._news_name(m.p1), 'p2', public._news_name(m.p2), 'created_at', m.created_at, 'ended_at', m.ended_at,
        'resyncs', m.resyncs, 'sim_frame', m.sim_frame) order by m.created_at desc)
      from (select * from public.fight_matches where kind = 'pvp' order by created_at desc limit 100) m), '[]'::jsonb),
    'conflicts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'match_id', c.match_id, 'reporter', public._news_name(c.reporter), 'reported', public._news_name(c.reported),
        'from_frame', c.from_frame, 'to_frame', c.to_frame, 'created_at', c.created_at) order by c.created_at desc)
      from (select * from public.fight_conflicts order by created_at desc limit 100) c), '[]'::jsonb),
    'config', (select to_jsonb(c) - 'id' from public.fight_config c where c.id));
end $$;

-- "Xem lại trận": a match's params and both logs (and what each side saw), for the read-only replay
create or replace function public.admin_fight_log(p_session_token text, p_match uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches;
begin
  perform public._auth_root(p_session_token);
  select * into mt from public.fight_matches where id = p_match;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  return jsonb_build_object('id', mt.id, 'kind', mt.kind, 'status', mt.status, 'params', mt.params, 'stake', mt.stake,
    'started_at', mt.started_at, 'ended_at', mt.ended_at, 'result', mt.result, 'sim_frame', mt.sim_frame, 'resyncs', mt.resyncs,
    'p1', public._news_name(mt.p1), 'p2', case when mt.p2 is null then null else public._news_name(mt.p2) end,
    'logs', coalesce((select jsonb_agg(jsonb_build_object('side', l.side, 'runs', to_jsonb(l.runs), 'frontier', l.frontier,
                        'seen_runs', to_jsonb(l.seen_runs), 'seen_frontier', l.seen_frontier, 'pushes', l.pushes,
                        'stall_frames', l.stall_frames, 'bad_hashes', l.bad_hashes, 'blamed', l.blamed) order by l.side)
                      from public.fight_logs l where l.match_id = p_match), '[]'::jsonb),
    'conflicts', coalesce((select jsonb_agg(jsonb_build_object('reporter', public._news_name(c.reporter),
                        'reported', public._news_name(c.reported), 'from_frame', c.from_frame, 'to_frame', c.to_frame,
                        'canonical', to_jsonb(c.canonical), 'seen', to_jsonb(c.seen), 'created_at', c.created_at) order by c.id)
                      from public.fight_conflicts c where c.match_id = p_match), '[]'::jsonb));
end $$;

-- the caps and the fee (spec §v20.3 "Caps": editable by an admin RPC)
create or replace function public.admin_fight_config(p_session_token text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  update public.fight_config set
    max_live_room = coalesce((p_patch->>'max_live_room')::int, max_live_room),
    max_live_all = coalesce((p_patch->>'max_live_all')::int, max_live_all),
    max_staked_day = coalesce((p_patch->>'max_staked_day')::int, max_staked_day),
    max_pair_day = coalesce((p_patch->>'max_pair_day')::int, max_pair_day),
    max_friendly_pair_day = coalesce((p_patch->>'max_friendly_pair_day')::int, max_friendly_pair_day),
    fee_pct = coalesce((p_patch->>'fee_pct')::int, fee_pct)
  where id;
  return (select to_jsonb(c) - 'id' from public.fight_config c where c.id);
end $$;

-- ---------- F. The shade ----------
-- 0050's _in_shade plus bai_dat (a known outdoor map) and its four tin-roofed rings (v20.3, R7).
create or replace function public._in_shade(p_map text, p_x integer, p_y integer) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select p_map is null or p_x is null or p_y is null or p_map not in ('hall', 'pond', 'field', 'market', 'khu_nha', 'bai_dat')
      or exists (select 1 from (values
           ('pond', 522, 64, 104, 90), ('pond', 522, 228, 104, 94),
           ('field', 588, 288, 84, 70), ('field', 700, 288, 88, 70),
           ('market', 100, 130, 80, 60), ('market', 460, 130, 80, 60), ('market', 244, 108, 152, 82),
           ('market', 640, 130, 80, 60), ('market', 40, 304, 80, 70), ('market', 680, 304, 80, 70),
           ('market', 860, 248, 120, 36),
           ('bai_dat', 100, 100, 200, 100), ('bai_dat', 500, 100, 200, 100),
           ('bai_dat', 100, 260, 200, 100), ('bai_dat', 500, 260, 200, 100)
         ) s(m, sx, sy, sw, sh)
         where s.m = p_map and p_x >= s.sx and p_x < s.sx + s.sw and p_y >= s.sy and p_y < s.sy + s.sh)
$$;
revoke all on function public._in_shade(text, integer, integer) from public, anon, authenticated;

-- ---------- G. The ledger ----------
-- 0050's 45 reasons (0051–0055 add none before this) plus the rings' three: 48.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture',
                    'house_land','house_upkeep','house_build','house_refund','house_rent_pay','house_rent_income',
                    'estate_sale','estate_buy',
                    'dojo_tuition','dojo_exam',
                    'fight_stake','fight_win','fight_refund'));

-- ---------- H. Wipes and deletions ----------
-- 0043's _ac_wipe plus the v20.3 lines: live matches settle first as the account's forfeits (the opponent is paid), then
-- its corners, exams, enrollments, fight profile and uniforms go (plan ruling P22).
create or replace function public._ac_wipe(p_account uuid, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_snap jsonb; v_id bigint; v_coins integer;
begin
  perform public._card_forfeit_all(p_account);
  perform public._fx_forfeit_all(p_account);                                         -- v20.3
  v_snap := public._ac_holdings(p_account);
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot)
  values (p_account, (select username from public.accounts where id = p_account), p_by, v_snap)
  returning id into v_id;
  select coins into v_coins from public.wallets where account_id = p_account;
  if found then
    insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, -v_coins, 0, 'wipe', 'wipe #' || v_id);
    delete from public.wallets where account_id = p_account;
  end if;
  delete from public.inventory where account_id = p_account;
  delete from public.casts where account_id = p_account;
  delete from public.fish where account_id = p_account;
  delete from public.fishing_profiles where account_id = p_account;
  delete from public.personal_bests where account_id = p_account;
  delete from public.rice_stock where account_id = p_account;
  delete from public.produce_stock where account_id = p_account;
  update public.farm_profiles set tank_item = null, tank_charges = 0 where account_id = p_account;
  delete from public.critters where account_id = p_account;                          -- v15.3
  delete from public.gather_cooldowns where account_id = p_account;                  -- v15.3
  delete from public.dogs where account_id = p_account;                              -- v17
  delete from public.rat_bag where account_id = p_account;                           -- v17
  delete from public.sling_aims where account_id = p_account;                        -- v17
  delete from public.fridge_fish where account_id = p_account;                       -- v19.2
  perform public._estate_wipe(p_account);                                            -- v19.4
  update public.apartments set owner_id = null where owner_id = p_account;           -- v19.2 (the sweep frees it)
  perform public._apt_sweep();                                                       -- v19.2
  perform public._house_wipe(p_account);                                             -- v19.3
  delete from public.furniture_items where account_id = p_account;                   -- v19.2
  delete from public.martial_exams where account_id = p_account;                     -- v20.3
  delete from public.martial_enrollments where account_id = p_account;               -- v20.3
  delete from public.fight_profiles where account_id = p_account;                    -- v20.3
  update public.characters set outfit = null where account_id = p_account and outfit like 'vp\_%';   -- v20.3
  delete from public.account_items where account_id = p_account and item_id like 'vp\_%';           -- v20.3
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;

-- an account about to be deleted: its live matches settle first (after the card seats: triggers fire by name)
create or replace function public._fight_accounts_bd() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._wallet_lock(old.id);
  perform public._fx_forfeit_all(old.id);
  return old;
end $$;
drop trigger if exists fight_accounts_bd on public.accounts;
create trigger fight_accounts_bd before delete on public.accounts for each row execute function public._fight_accounts_bd();

-- ---------- privileges ----------
revoke all on function public._char_belt() from public, anon, authenticated;
revoke all on function public._enroll_belt() from public, anon, authenticated;
revoke all on function public._vn_day_start() from public, anon, authenticated;
revoke all on function public._ring_fighter(uuid) from public, anon, authenticated;
revoke all on function public._pvp_void(uuid, text, text) from public, anon, authenticated;
revoke all on function public._pvp_settle(uuid, smallint, text) from public, anon, authenticated;
revoke all on function public._pvp_sweep(uuid) from public, anon, authenticated;
revoke all on function public._ring_sweep(uuid) from public, anon, authenticated;
revoke all on function public._pvp_sweep_room(uuid) from public, anon, authenticated;
revoke all on function public._pvp_conflict_pattern(uuid, uuid) from public, anon, authenticated;
revoke all on function public._pvp_conflicts(uuid) from public, anon, authenticated;
revoke all on function public._pvp_caps(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public._ring_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public._fx_forfeit_all(uuid) from public, anon, authenticated;
revoke all on function public._fx_settle(uuid, smallint, text) from public, anon, authenticated;
revoke all on function public._fx_answer(uuid, smallint) from public, anon, authenticated;
revoke all on function public._fight_accounts_bd() from public, anon, authenticated;
revoke all on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) from public;
revoke all on function public.fight_state(text, uuid) from public;
revoke all on function public.ring_state(uuid, text) from public;
revoke all on function public.ring_take(uuid, text, integer, text) from public;
revoke all on function public.ring_leave(uuid, text, integer) from public;
revoke all on function public.ring_offer(uuid, text, integer, integer, integer) from public;
revoke all on function public.ring_accept(uuid, text, integer, integer, integer) from public;
revoke all on function public.fight_claim(text, uuid) from public;
revoke all on function public.ring_board(uuid, text) from public;
revoke all on function public.admin_fight_list(text) from public;
revoke all on function public.admin_fight_log(text, uuid) from public;
revoke all on function public.admin_fight_config(text, jsonb) from public;
grant execute on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) to anon, authenticated;
grant execute on function public.fight_state(text, uuid) to anon, authenticated;
grant execute on function public.ring_state(uuid, text) to anon, authenticated;
grant execute on function public.ring_take(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.ring_leave(uuid, text, integer) to anon, authenticated;
grant execute on function public.ring_offer(uuid, text, integer, integer, integer) to anon, authenticated;
grant execute on function public.ring_accept(uuid, text, integer, integer, integer) to anon, authenticated;
grant execute on function public.fight_claim(text, uuid) to anon, authenticated;
grant execute on function public.ring_board(uuid, text) to anon, authenticated;
grant execute on function public.admin_fight_list(text) to anon, authenticated;
grant execute on function public.admin_fight_log(text, uuid) to anon, authenticated;
grant execute on function public.admin_fight_config(text, jsonb) to anon, authenticated;
