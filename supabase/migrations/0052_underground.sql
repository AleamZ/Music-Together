-- =========================================================
-- 0052_underground.sql — v20.4 Khu bí mật + giải ngầm: the hatch and the hidden map ham_ngam, the underground rating and
-- tiers, Kèo ngầm (the rated queue), Tầng hầm (the 10-floor bot ladder), Giải đêm (the 4-player cup), spectating the
-- cage (spec docs/superpowers/specs/2026-09-28-v20-fight-design.md §v20.4 and the owner's rulings at its end: the
-- ladder's first-clear prizes halved; the realtime caps; a 5 % burned fee on PvP money; plan
-- docs/superpowers/plans/2026-09-28-v20-4-underground.md, rulings U1–U18). ADDITIVE and re-runnable. Run after 0051.
--   A. Tables: ug_profiles (the unlock, the rating, the season, titles, the day's counters), ug_seasons (closed seasons),
--      ug_bosses (seeded; pinned against lib/game/fight/underground.ts), ug_ladder, ug_queue, ug_cups, ug_cup_entries;
--      new columns fight_matches.entry / ready / call_until (a called match: U2), characters.ug_title (the name tag).
--   B. The rules: the unlock (U6), seasons and titles (U8), Elo (U5), the queue and its pairing (U3, U9, U10), called
--      matches and no-shows, settlement per kind (the fee U1), the cup's bracket and pool (U4), the lazy sweeps.
--   C. Re-created from their newest versions (every added line marked "-- v20.4", added blocks between "-- v20.4 {" and
--      "-- v20.4 }", a changed line ends "-- v20.4 was: <the old line>"):
--        _fx_reset, _fx_new (0048: styleByRound, U12); _fx_settle, _pvp_void, _pvp_sweep, _pvp_caps, fight_push,
--        fight_state, fight_claim, _fight_accounts_bd, _ac_wipe (0051); dojo_state (0050: the unlock, thầy Lâm's hint);
--        admin_anticheat_resolve (0015: the lock order, U14).
--   D. RPCs ug_status, ug_enter, ug_queue_join, ug_queue_leave, ug_ready, ug_ladder_start, ug_cup_join, ug_cup_leave,
--      ug_cup_state, ug_board.
--   E. The ledger: 0051's 48 reasons plus ug_entry, ug_prize, ug_refund: 51.
-- Anti-cheat (the 0015 envelope): soft ug_pair_farm (one-sided rated results between one pair). Limits, busy states, not
-- enough xu, locked floors, early or settled matches are answers.
-- Lock order everywhere: match rows → cup row → queue rows → ug profiles → wallets in account-id order (U14); a wipe or
-- a deletion locks the account's live matches before its wallet (the v20.3 follow-up).
-- =========================================================

-- ---------- A. Tables ----------
alter table public.fight_matches add column if not exists entry integer not null default 0 check (entry >= 0);
alter table public.fight_matches add column if not exists ready smallint not null default 3;   -- bit 1 p1, bit 2 p2
alter table public.fight_matches add column if not exists call_until timestamptz null;          -- a called match's deadline
create index if not exists fight_matches_ug_live on public.fight_matches (room_id) where status = 'live' and kind in ('ug_rated', 'ug_cup');

alter table public.characters add column if not exists ug_title text null;   -- the newest season title (the name tag)

create table if not exists public.ug_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  unlocked_at timestamptz null,
  hint_at timestamptz null,                           -- thầy Lâm's line was shown (once)
  rating integer not null default 1000,
  rated integer not null default 0,                   -- rated and cup matches played (K)
  season integer not null default 0,
  peak integer not null default 1000,                 -- the season's highest rating
  best_tier text not null default 'tep_riu',
  titles text[] not null default '{}',
  day_on date null,
  rated_today integer not null default 0,
  ladder_today integer not null default 0,
  cups_today integer not null default 0
);
create index if not exists ug_profiles_season on public.ug_profiles (season, rating desc);
alter table public.ug_profiles enable row level security;
revoke all on public.ug_profiles from anon, authenticated;

create table if not exists public.ug_seasons (
  season integer primary key,
  closed_at timestamptz not null default now()
);
alter table public.ug_seasons enable row level security;
revoke all on public.ug_seasons from anon, authenticated;

create table if not exists public.ug_bosses (
  floor smallint primary key check (floor between 1 and 10),
  name text not null,
  style text not null references public.martial_styles(id),
  level smallint not null,
  hp_pct smallint not null,
  entry integer not null,
  prize integer not null,                             -- the season's first clear (halved: owner ruling)
  style_by_round text[] null
);
insert into public.ug_bosses (floor, name, style, level, hp_pct, entry, prize, style_by_round) values
  (1, 'Cu Tí Lì Lợm', 'boxing', 1, 100, 100, 200, null),
  (2, 'Bảy Chợ Cá', 'vovinam', 2, 100, 200, 350, null),
  (3, 'Mèo Muay', 'muaythai', 3, 100, 300, 500, null),
  (4, 'Hắc Đai Lùn', 'karate', 4, 105, 500, 750, null),
  (5, 'Cước Phong', 'taekwondo', 5, 105, 800, 1200, null),
  (6, 'Găng Đồng', 'boxing', 5, 110, 1000, 1500, null),
  (7, 'Gấu Quật', 'judo', 6, 115, 1500, 2250, null),
  (8, 'Mộc Nhân', 'vinhxuan', 7, 115, 2000, 3000, null),
  (9, 'Ba Mù', 'karate', 7, 125, 3000, 4500, null),
  (10, 'Trùm Hầm', 'muaythai', 8, 130, 5000, 7500, array['muaythai', 'judo', 'vinhxuan', 'muaythai', 'judo'])
on conflict (floor) do update set
  name = excluded.name, style = excluded.style, level = excluded.level, hp_pct = excluded.hp_pct, entry = excluded.entry,
  prize = excluded.prize, style_by_round = excluded.style_by_round;
alter table public.ug_bosses enable row level security;
revoke all on public.ug_bosses from anon, authenticated;

create table if not exists public.ug_ladder (
  account_id uuid not null references public.accounts(id) on delete cascade,
  season integer not null,
  floor smallint not null check (floor between 1 and 10),
  cleared_at timestamptz null,                        -- the season's first clear
  clears integer not null default 0,
  attempts integer not null default 0,
  primary key (account_id, season, floor)
);
alter table public.ug_ladder enable row level security;
revoke all on public.ug_ladder from anon, authenticated;

create table if not exists public.ug_queue (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  tier integer not null check (tier in (500, 2000, 5000)),
  rating integer not null,
  style jsonb not null,                               -- the worn uniform at join (_fx_style_of)
  joined_at timestamptz not null default now(),
  head boolean not null default false                 -- back at the head after the other one's no-show (U3)
);
create index if not exists ug_queue_room on public.ug_queue (room_id, tier, joined_at);
alter table public.ug_queue enable row level security;
revoke all on public.ug_queue from anon, authenticated;

create table if not exists public.ug_cups (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  tier integer not null check (tier in (1000, 5000)),
  status text not null default 'open' check (status in ('open', 'running', 'done', 'void')),
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  ended_at timestamptz null,
  bracket jsonb null,                                 -- {seeds: [4 ids], semis: [{a, b, match, winner}, …], final: {…}}
  current_match uuid null references public.fight_matches(id) on delete set null
);
create unique index if not exists ug_cups_open on public.ug_cups (room_id, tier) where status = 'open';
create index if not exists ug_cups_room on public.ug_cups (room_id, status);
alter table public.ug_cups enable row level security;
revoke all on public.ug_cups from anon, authenticated;

create table if not exists public.ug_cup_entries (
  cup_id uuid not null references public.ug_cups(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  rating integer not null,
  style jsonb not null,
  seed smallint null,
  placed smallint null,                               -- 1 champion, 2 runner-up, 3 semifinal
  joined_at timestamptz not null default now(),
  primary key (cup_id, account_id)
);
create index if not exists ug_cup_entries_account on public.ug_cup_entries (account_id);
alter table public.ug_cup_entries enable row level security;
revoke all on public.ug_cup_entries from anon, authenticated;

-- ---------- B. The rules ----------
-- the season (U8): 28 VN days from 2026-10-01, season 0 before it
create or replace function public._ug_season() returns integer
language sql stable set search_path = public, extensions
as $$ select greatest(0, public._vn_today() - date '2026-10-01') / 28 $$;

create or replace function public._ug_tier(r integer) returns text
language sql immutable set search_path = public, extensions
as $$
  select case when r >= 1550 then 'thuy_quai' when r >= 1400 then 'ca_map' when r >= 1250 then 'ca_loc'
              when r >= 1100 then 'ca_ro' else 'tep_riu' end
$$;

-- The unlock (U6): rank ≥ 2 in any style and 5 refereed wins (passed exams + ring wins); set once, lazily.
create or replace function public._ug_unlocked(p_account uuid) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_account is null then return false; end if;
  if exists (select 1 from public.ug_profiles where account_id = p_account and unlocked_at is not null) then return true; end if;
  if exists (select 1 from public.martial_enrollments where account_id = p_account and rank >= 2)
     and (select count(*) from public.martial_exams where account_id = p_account and status = 'passed')
         + coalesce((select wins from public.fight_profiles where account_id = p_account), 0) >= 5 then
    insert into public.ug_profiles (account_id, season, unlocked_at) values (p_account, public._ug_season(), now())
    on conflict (account_id) do update set unlocked_at = coalesce(public.ug_profiles.unlocked_at, now());
    return true;
  end if;
  return false;
end $$;

-- A season closes once (U8): "Thủy quái mùa N" to everyone whose peak that season was Thủy quái, "Trùm hầm mùa N" to
-- each room's no. 1 among its rated and cup fighters; the newest title goes on the name tag. Runs before any profile
-- rolls into the next season.
create or replace function public._ug_close_season(p_season integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer; v_from timestamptz; v_to timestamptz; r record; v_t text;
begin
  insert into public.ug_seasons (season) values (p_season) on conflict (season) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;
  v_from := (date '2026-10-01' + p_season * 28)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (date '2026-10-01' + (p_season + 1) * 28)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  if p_season = 0 then v_from := '-infinity'; end if;
  v_t := 'Thủy quái mùa ' || (p_season + 1);
  update public.ug_profiles set titles = titles || v_t
   where season = p_season and peak >= 1550 and not (v_t = any (titles));
  v_t := 'Trùm hầm mùa ' || (p_season + 1);
  for r in select distinct on (m.room_id) m.room_id, p.account_id
             from public.fight_matches m
             cross join lateral unnest(array[m.p1, m.p2]) x(acc)
             join public.ug_profiles p on p.account_id = x.acc and p.season = p_season
            where m.kind in ('ug_rated', 'ug_cup') and m.status = 'done' and m.room_id is not null
              and m.created_at >= v_from and m.created_at < v_to
            order by m.room_id, p.rating desc, p.account_id loop
    update public.ug_profiles set titles = titles || v_t where account_id = r.account_id and not (v_t = any (titles));
  end loop;
  update public.characters c set ug_title = p.titles[cardinality(p.titles)]
    from public.ug_profiles p
   where p.account_id = c.account_id and p.season = p_season and cardinality(p.titles) > 0
     and c.ug_title is distinct from p.titles[cardinality(p.titles)];
end $$;

create or replace function public._ug_close_due() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_cur integer := public._ug_season(); v_s integer;
begin
  if v_cur = 0 or exists (select 1 from public.ug_seasons where season = v_cur - 1) then return; end if;
  perform pg_advisory_xact_lock(hashtext('ug_close_season'));
  for v_s in coalesce((select max(season) + 1 from public.ug_seasons), 0) .. v_cur - 1 loop
    perform public._ug_close_season(v_s);
  end loop;
end $$;

-- My profile, locked: a new season soft-resets the rating (U8), a new VN day resets the counters (U9)
create or replace function public._ug_profile(p_account uuid) returns public.ug_profiles
language plpgsql security definer set search_path = public, extensions
as $$
declare p public.ug_profiles; v_season integer := public._ug_season(); v_today date := public._vn_today();
begin
  perform public._ug_close_due();
  insert into public.ug_profiles (account_id, season) values (p_account, v_season) on conflict (account_id) do nothing;
  select * into p from public.ug_profiles where account_id = p_account for update;
  if p.season < v_season then
    p.rating := greatest(800, 1000 + (p.rating - 1000) / 2);
    p.season := v_season;
    p.peak := p.rating;
    p.best_tier := public._ug_tier(p.rating);
  end if;
  if p.day_on is distinct from v_today then
    p.day_on := v_today;
    p.rated_today := 0;
    p.ladder_today := 0;
    p.cups_today := 0;
  end if;
  update public.ug_profiles
     set rating = p.rating, season = p.season, peak = p.peak, best_tier = p.best_tier, day_on = p.day_on,
         rated_today = p.rated_today, ladder_today = p.ladder_today, cups_today = p.cups_today
   where account_id = p_account;
  return p;
end $$;

-- The gate of every ug_* action: a member of the room, not locked by the anti-cheat, and unlocked
create or replace function public._ug_auth(p_room uuid, p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room, p_token);
begin
  if not public._ug_unlocked(v_account) then raise exception 'underground locked' using errcode = '42501'; end if;
  return v_account;
end $$;

-- Elo (U5): my change for score s (1, 0.5, 0) against rating rb, with my K and the pair factor
create or replace function public._ug_elo(ra integer, rb integer, s numeric, k integer, f numeric) returns integer
language sql immutable set search_path = public, extensions
as $$ select round(k * f * (s - 1.0 / (1.0 + power(10.0, (rb - ra)::numeric / 400.0))))::integer $$;

-- Both fighters' ratings after a rated or cup match (p_winner 1, 2, 0 = draw); the profiles are locked in account-id
-- order. Returns {"1": {rating, delta, tier}, "2": {…}, "factor"}.
create or replace function public._ug_rate(p_match uuid, p_winner smallint, p_factor numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; a public.ug_profiles; b public.ug_profiles; da integer; db integer; sa numeric;
begin
  select * into mt from public.fight_matches where id = p_match;
  if mt.p1 < mt.p2 then a := public._ug_profile(mt.p1); b := public._ug_profile(mt.p2);
  else b := public._ug_profile(mt.p2); a := public._ug_profile(mt.p1); end if;
  sa := case p_winner when 1 then 1 when 2 then 0 else 0.5 end;
  da := public._ug_elo(a.rating, b.rating, sa, case when a.rated < 10 then 40 else 24 end, p_factor);
  db := public._ug_elo(b.rating, a.rating, 1 - sa, case when b.rated < 10 then 40 else 24 end, p_factor);
  update public.ug_profiles set rating = greatest(800, rating + da), rated = rated + 1,
                                peak = greatest(peak, greatest(800, rating + da)),
                                best_tier = public._ug_tier(greatest(peak, greatest(800, rating + da)))
   where account_id = mt.p1;
  update public.ug_profiles set rating = greatest(800, rating + db), rated = rated + 1,
                                peak = greatest(peak, greatest(800, rating + db)),
                                best_tier = public._ug_tier(greatest(peak, greatest(800, rating + db)))
   where account_id = mt.p2;
  return jsonb_build_object('factor', p_factor,
    '1', (select jsonb_build_object('rating', rating, 'delta', rating - a.rating, 'tier', public._ug_tier(rating)) from public.ug_profiles where account_id = mt.p1),
    '2', (select jsonb_build_object('rating', rating, 'delta', rating - b.rating, 'tier', public._ug_tier(rating)) from public.ug_profiles where account_id = mt.p2));
end $$;

-- the realtime caps (U10): true when the room or the project has no room for another live PvP match
create or replace function public._ug_live_full(p_room uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select (select count(*) from public.fight_matches where kind in ('pvp', 'ug_rated', 'ug_cup') and status = 'live' and room_id = p_room)
           >= (select max_live_room from public.fight_config where id)
      or (select count(*) from public.fight_matches where kind in ('pvp', 'ug_rated', 'ug_cup') and status = 'live')
           >= (select max_live_all from public.fight_config where id)
$$;

-- A called match (U2): the row at once, both fighters' worn styles at call time, frame 0 set when both are ready
create or replace function public._ug_call(p_room uuid, p_kind text, p_a uuid, p_b uuid, sa jsonb, sb jsonb, p_entry integer,
                                           p_ref text, p_secs integer) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_params jsonb; v_match uuid;
begin
  v_params := jsonb_build_object('seed', floor(random() * 4294967296)::bigint, 'rounds', 3, 'maxRounds', 5, 'delay', 4,
    'p1', jsonb_build_object('style', (sa->>'idx')::int, 'rank', (sa->>'rank')::int, 'movesMask', (1 << ((sa->>'rank')::int + 1)) - 1,
                             'hpPct', 100, 'bot', 0, 'en0', 0, 'atk', (sa->>'atk')::int, 'def', (sa->>'def')::int,
                             'walk', (sa->>'walk')::int, 'jump', (sa->>'jump')::int, 'energy', (sa->>'energy')::int),
    'p2', jsonb_build_object('style', (sb->>'idx')::int, 'rank', (sb->>'rank')::int, 'movesMask', (1 << ((sb->>'rank')::int + 1)) - 1,
                             'hpPct', 100, 'bot', 0, 'en0', 0, 'atk', (sb->>'atk')::int, 'def', (sb->>'def')::int,
                             'walk', (sb->>'walk')::int, 'jump', (sb->>'jump')::int, 'energy', (sb->>'energy')::int));
  insert into public.fight_matches (room_id, kind, p1, p2, params, entry, ref, started_at, sim, ready, call_until)
  values (p_room, p_kind, p_a, p_b, v_params, p_entry, p_ref, now() + make_interval(secs => p_secs + 3),
          public._fx_new(v_params), 0, now() + make_interval(secs => p_secs))
  returning id into v_match;
  update public.fight_matches set sim_hash = public._fx_hash(sim) where id = v_match;
  insert into public.fight_logs (match_id, side, account_id) values (v_match, 1, p_a), (v_match, 2, p_b);
  return v_match;
end $$;

-- Kèo ngầm's pairing (U3, U9, U10), lazily at every queue call and poll: timeouts refunded; then, oldest first (a
-- no-show's victim at the head), the nearest rating of the same room and tier within the waiter's window (±150, +50
-- every 15 s, ±400 at most), the pair's daily limit respected, while the realtime caps have room.
create or replace function public._ug_pair(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare q record; o record; w integer; v_found boolean; v_match uuid; v_a public.ug_queue; v_b public.ug_queue;
begin
  perform pg_advisory_xact_lock(hashtext('ug_pair:' || p_room::text));
  for q in select * from public.ug_queue where room_id = p_room and joined_at < now() - interval '300 seconds'
            order by account_id for update loop
    perform public._wallet_lock(q.account_id);
    perform public._pay(q.account_id, q.tier, 'ug_refund', 'ug queue: timeout');
    delete from public.ug_queue where account_id = q.account_id;
  end loop;
  loop
    v_found := false;
    exit when public._ug_live_full(p_room);
    for q in select * from public.ug_queue where room_id = p_room order by head desc, joined_at, account_id loop
      w := least(400, 150 + 50 * floor(extract(epoch from now() - q.joined_at) / 15)::integer);
      select * into o from public.ug_queue x
       where x.room_id = p_room and x.tier = q.tier and x.account_id <> q.account_id and abs(x.rating - q.rating) <= w
         and (select count(*) from public.fight_matches m
               where m.kind = 'ug_rated' and m.created_at >= public._vn_day_start()
                 and ((m.p1 = q.account_id and m.p2 = x.account_id) or (m.p1 = x.account_id and m.p2 = q.account_id))) < 2
       order by abs(x.rating - q.rating), x.head desc, x.joined_at, x.account_id
       limit 1;
      if found then
        -- both rows locked (account-id order) and still there: a leave may have come first
        perform 1 from public.ug_queue where account_id in (q.account_id, o.account_id) order by account_id for update;
        select * into v_a from public.ug_queue where account_id = q.account_id;
        select * into v_b from public.ug_queue where account_id = o.account_id;
        if v_a.account_id is null or v_b.account_id is null then v_found := true; exit; end if;
        perform public._ug_profile(least(v_a.account_id, v_b.account_id));
        perform public._ug_profile(greatest(v_a.account_id, v_b.account_id));
        v_match := public._ug_call(p_room, 'ug_rated', v_a.account_id, v_b.account_id, v_a.style, v_b.style, v_a.tier, null, 30);
        update public.ug_profiles set rated_today = rated_today + 1 where account_id in (v_a.account_id, v_b.account_id);
        delete from public.ug_queue where account_id in (v_a.account_id, v_b.account_id);
        v_found := true;
        exit;
      end if;
    end loop;
    exit when not v_found;
  end loop;
end $$;

-- A cup's refunds (U4: a void cup or one that did not fill): every entry back, the current match freed
create or replace function public._ug_cup_void(p_cup uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.ug_cups; r record;
begin
  select * into c from public.ug_cups where id = p_cup for update;
  if not found or c.status not in ('open', 'running') then return; end if;
  update public.ug_cups set status = 'void', ended_at = now(), current_match = null where id = p_cup;
  for r in select account_id from public.ug_cup_entries where cup_id = p_cup order by account_id loop
    perform public._wallet_lock(r.account_id);
    perform public._pay(r.account_id, c.tier, 'ug_refund', 'ug cup ' || left(p_cup::text, 8) || ': ' || p_reason);
  end loop;
end $$;

-- The cup's next match (U2): semifinal 1, then 2, then the final, called while the realtime caps have room
create or replace function public._ug_cup_tick(p_cup uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.ug_cups; k text; j integer; slot jsonb; a uuid; b uuid; sa jsonb; sb jsonb; v_match uuid; v_path text[];
begin
  select * into c from public.ug_cups where id = p_cup for update;
  if not found or c.status <> 'running' or c.current_match is not null then return; end if;
  for j in 0..2 loop
    v_path := case j when 0 then array['semis', '0'] when 1 then array['semis', '1'] else array['final'] end;
    slot := c.bracket #> v_path;
    continue when slot->>'winner' is not null;
    if slot->>'a' is null or slot->>'b' is null then return; end if;
    if public._ug_live_full(c.room_id) then return; end if;
    a := (slot->>'a')::uuid;
    b := (slot->>'b')::uuid;
    select style into sa from public.ug_cup_entries where cup_id = p_cup and account_id = a;
    select style into sb from public.ug_cup_entries where cup_id = p_cup and account_id = b;
    v_match := public._ug_call(c.room_id, 'ug_cup', a, b, sa, sb, 0, p_cup::text, 60);
    update public.ug_cups set current_match = v_match, bracket = jsonb_set(bracket, v_path || array['match'], to_jsonb(v_match::text))
     where id = p_cup;
    return;
  end loop;
end $$;

-- Four signed up: the draw by rating (1 v 4, 2 v 3), the day's cup counted, the first semifinal called
create or replace function public._ug_cup_start(p_cup uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_ids uuid[]; r record; k integer := 0; v_id uuid;
begin
  for r in select account_id from public.ug_cup_entries where cup_id = p_cup order by account_id loop
    perform public._ug_profile(r.account_id);
  end loop;
  select array_agg(e.account_id order by p.rating desc, e.account_id) into v_ids
    from public.ug_cup_entries e join public.ug_profiles p on p.account_id = e.account_id where e.cup_id = p_cup;
  foreach v_id in array v_ids loop
    k := k + 1;
    update public.ug_cup_entries set seed = k, rating = (select rating from public.ug_profiles where account_id = v_id)
     where cup_id = p_cup and account_id = v_id;
  end loop;
  update public.ug_profiles set cups_today = cups_today + 1 where account_id = any (v_ids);
  update public.ug_cups set status = 'running', started_at = now(),
    bracket = jsonb_build_object('seeds', to_jsonb(v_ids::text[]),
      'semis', jsonb_build_array(jsonb_build_object('a', v_ids[1], 'b', v_ids[4], 'match', null, 'winner', null),
                                 jsonb_build_object('a', v_ids[2], 'b', v_ids[3], 'match', null, 'winner', null)),
      'final', jsonb_build_object('a', null, 'b', null, 'match', null, 'winner', null))
   where id = p_cup;
  perform public._ug_cup_tick(p_cup);
end $$;

-- A cup match is over (the caller holds the match row): the winner advances; after the final, the pool is paid —
-- 4 × entry less the burned fee, 70 % to the champion, the rest to the runner-up (U1) — and Tin làng hears of it.
create or replace function public._ug_cup_advance(p_cup uuid, p_match uuid, p_winner uuid, p_loser uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.ug_cups; v_path text[]; j integer; k integer; v_pot integer; v_fee integer; v_pool integer; v_champ integer;
        v_round text; v_fee_pct integer := coalesce((select fee_pct from public.fight_config where id), 5);
begin
  select * into c from public.ug_cups where id = p_cup for update;
  if not found or c.status <> 'running' then return '{}'::jsonb; end if;
  for k in 0..2 loop
    v_path := case k when 0 then array['semis', '0'] when 1 then array['semis', '1'] else array['final'] end;
    j := k;
    exit when c.bracket #>> (v_path || array['match']) = p_match::text;
  end loop;
  if c.bracket #>> (v_path || array['match']) is distinct from p_match::text then return '{}'::jsonb; end if;
  c.bracket := jsonb_set(c.bracket, v_path || array['winner'], to_jsonb(p_winner::text));
  v_round := case when j = 2 then 'final' else 'semi' end;
  if j < 2 then
    update public.ug_cup_entries set placed = 3 where cup_id = p_cup and account_id = p_loser;
    c.bracket := jsonb_set(c.bracket, array['final', case j when 0 then 'a' else 'b' end], to_jsonb(p_winner::text));
    update public.ug_cups set bracket = c.bracket, current_match = null where id = p_cup;
    perform public._ug_cup_tick(p_cup);
    return jsonb_build_object('cup', p_cup, 'round', v_round, 'advanced', p_winner);
  end if;
  update public.ug_cup_entries set placed = 1 where cup_id = p_cup and account_id = p_winner;
  update public.ug_cup_entries set placed = 2 where cup_id = p_cup and account_id = p_loser;
  update public.ug_cups set bracket = c.bracket, current_match = null, status = 'done', ended_at = now() where id = p_cup;
  v_pot := 4 * c.tier;
  v_fee := v_pot * v_fee_pct / 100;
  v_pool := v_pot - v_fee;
  v_champ := v_pool * 70 / 100;
  perform public._wallet_lock(least(p_winner, p_loser));
  perform public._wallet_lock(greatest(p_winner, p_loser));
  perform public._pay(p_winner, v_champ, 'ug_prize', 'ug cup ' || left(p_cup::text, 8) || ': vô địch, phí ' || v_fee);
  perform public._pay(p_loser, v_pool - v_champ, 'ug_prize', 'ug cup ' || left(p_cup::text, 8) || ': á quân');
  perform public._news_event(c.room_id, 'fight',
    format('🏆 %s vừa vô địch một giải đấu kín, ẵm %s xu.', public._news_name(p_winner), v_champ),
    jsonb_build_object('cup', p_cup, 'winner', p_winner, 'won', v_champ));
  return jsonb_build_object('cup', p_cup, 'round', v_round, 'champion', p_winner, 'pot', v_pot, 'fee', v_fee, 'pool', v_pool,
                            'champion_won', v_champ, 'runner_up_won', v_pool - v_champ);
end $$;

-- A called match's no-show (U3; the caller holds the match row): nobody ready voids it (rated: refunds; cup: the cup is
-- void); else the absent one loses — rated: the present one takes the absent entry less the fee and goes back to the
-- queue's head with its own entry still held; cup: the present one advances. No vitals cost, no rating.
create or replace function public._ug_noshow(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; v_w smallint; v_wacc uuid; v_lacc uuid; v_res jsonb; v_pay integer := 0; v_q jsonb;
        v_fee_pct integer := coalesce((select fee_pct from public.fight_config where id), 5); v_rating integer;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found or mt.status <> 'live' or mt.ready = 3 then return null; end if;
  if mt.ready = 0 then return public._pvp_void(p_match, 'void', 'abandon'); end if;
  v_w := case when mt.ready = 1 then 1 else 2 end;
  v_wacc := case v_w when 1 then mt.p1 else mt.p2 end;
  v_lacc := case v_w when 1 then mt.p2 else mt.p1 end;
  update public.fight_matches set status = 'done', winner = v_w, end_reason = 'forfeit', ended_at = now(), rounds = '[]'::jsonb
   where id = p_match;
  if mt.kind = 'ug_rated' then
    v_pay := mt.entry - mt.entry * v_fee_pct / 100;
    perform public._wallet_lock(v_wacc);
    perform public._pay(v_wacc, v_pay, 'ug_prize', 'ug ' || left(p_match::text, 8) || ': đối thủ vắng mặt, phí ' || (mt.entry - v_pay));
    select rating into v_rating from public.ug_profiles where account_id = v_wacc;
    select jsonb_build_object('idx', (mt.params->(case v_w when 1 then 'p1' else 'p2' end)->>'style')::int,
                              'rank', (mt.params->(case v_w when 1 then 'p1' else 'p2' end)->>'rank')::int,
                              'atk', (mt.params->(case v_w when 1 then 'p1' else 'p2' end)->>'atk')::int,
                              'def', (mt.params->(case v_w when 1 then 'p1' else 'p2' end)->>'def')::int,
                              'walk', (mt.params->(case v_w when 1 then 'p1' else 'p2' end)->>'walk')::int,
                              'jump', (mt.params->(case v_w when 1 then 'p1' else 'p2' end)->>'jump')::int,
                              'energy', (mt.params->(case v_w when 1 then 'p1' else 'p2' end)->>'energy')::int) into v_q;
    insert into public.ug_queue (account_id, room_id, tier, rating, style, joined_at, head)
    values (v_wacc, mt.room_id, mt.entry, coalesce(v_rating, 1000), v_q, now(), true)
    on conflict (account_id) do nothing;
  elsif mt.kind = 'ug_cup' then
    perform public._ug_cup_advance(mt.ref::uuid, p_match, v_wacc, v_lacc);
  end if;
  v_res := jsonb_build_object('winner', v_w, 'end_reason', 'forfeit', 'noshow', true, 'rounds', '[]'::jsonb, 'rounds_played', 0,
                              'vitals', jsonb_build_object('hunger', 0, 'thirst', 0),
                              'ug', jsonb_build_object('kind', mt.kind, 'entry', mt.entry, 'won', v_pay, 'noshow', true,
                                                       'requeued', mt.kind = 'ug_rated'));
  update public.fight_matches set result = v_res where id = p_match;
  return v_res;
end $$;

-- A void's money (called by _pvp_void for the ug kinds): rated refunds both entries; a cup is voided whole (U4)
create or replace function public._ug_void(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches;
begin
  select * into mt from public.fight_matches where id = p_match;
  if mt.kind = 'ug_rated' and mt.entry > 0 then
    perform public._wallet_lock(least(mt.p1, mt.p2));
    perform public._wallet_lock(greatest(mt.p1, mt.p2));
    perform public._pay(mt.p1, mt.entry, 'ug_refund', 'ug ' || left(p_match::text, 8) || ': ' || mt.end_reason);
    perform public._pay(mt.p2, mt.entry, 'ug_refund', 'ug ' || left(p_match::text, 8) || ': ' || mt.end_reason);
    return jsonb_build_object('ug', jsonb_build_object('kind', mt.kind, 'entry', mt.entry, 'refund', mt.entry));
  elsif mt.kind = 'ug_cup' then
    perform public._ug_cup_void(mt.ref::uuid, 'void');
    return jsonb_build_object('ug', jsonb_build_object('kind', mt.kind, 'cup', mt.ref, 'cup_void', true));
  end if;
  return '{}'::jsonb;
end $$;

-- 0049/0051's _fx_settle for the ug kinds (the match is already 'done' with its winner)
create or replace function public._ug_settle(p_match uuid, p_winner smallint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; b public.ug_bosses; v_season integer; v_first boolean; v_prize integer := 0; v_rate jsonb;
        v_pot integer; v_fee integer := 0; v_won integer := 0; v_meet integer; v_f numeric := 1; v_wacc uuid; v_lacc uuid;
        v_fee_pct integer := coalesce((select fee_pct from public.fight_config where id), 5); v_cup jsonb; n integer; w integer;
begin
  select * into mt from public.fight_matches where id = p_match;
  if mt.kind = 'ug_ladder' then
    select * into b from public.ug_bosses where floor = mt.ref::int;
    v_season := public._ug_season();
    perform public._ug_profile(mt.p1);
    insert into public.ug_ladder (account_id, season, floor) values (mt.p1, v_season, b.floor) on conflict do nothing;
    if p_winner = 1 then
      select cleared_at is null into v_first from public.ug_ladder where account_id = mt.p1 and season = v_season and floor = b.floor for update;
      v_prize := case when v_first then b.prize else b.prize / 10 end;
      update public.ug_ladder set cleared_at = coalesce(cleared_at, now()), clears = clears + 1
       where account_id = mt.p1 and season = v_season and floor = b.floor;
      perform public._wallet_lock(mt.p1);
      perform public._pay(mt.p1, v_prize, 'ug_prize', 'ug tầng ' || b.floor || case when v_first then ': lần đầu' else ': lần sau (10 %)' end);
    end if;
    return jsonb_build_object('ug', jsonb_build_object('kind', mt.kind, 'floor', b.floor, 'boss', b.name, 'entry', mt.entry,
                                                       'won', v_prize, 'first', coalesce(v_first, false)));
  end if;
  if p_winner in (1, 2) then
    v_wacc := case p_winner when 1 then mt.p1 else mt.p2 end;
    v_lacc := case p_winner when 1 then mt.p2 else mt.p1 end;
  end if;
  if mt.kind = 'ug_rated' then
    -- the pair's 4th and later rated meetings in 7 days move the rating × 0.5 (U5)
    select count(*) into v_meet from public.fight_matches m
     where m.kind = 'ug_rated' and m.id <> p_match and m.status = 'done' and m.end_reason <> 'forfeit'
       and m.created_at > now() - interval '7 days' and ((m.p1 = mt.p1 and m.p2 = mt.p2) or (m.p1 = mt.p2 and m.p2 = mt.p1));
    if v_meet >= 3 then v_f := 0.5; end if;
    v_rate := public._ug_rate(p_match, p_winner, v_f);
    v_pot := 2 * mt.entry;
    perform public._wallet_lock(least(mt.p1, mt.p2));
    perform public._wallet_lock(greatest(mt.p1, mt.p2));
    if v_wacc is not null then
      v_fee := v_pot * v_fee_pct / 100;
      v_won := v_pot - v_fee;
      perform public._pay(v_wacc, v_won, 'ug_prize', 'ug ' || left(p_match::text, 8) || ': ' || p_reason || ', phí ' || v_fee);
    else
      perform public._pay(mt.p1, mt.entry, 'ug_refund', 'ug ' || left(p_match::text, 8) || ': draw');
      perform public._pay(mt.p2, mt.entry, 'ug_refund', 'ug ' || left(p_match::text, 8) || ': draw');
    end if;
    -- soft ug_pair_farm: ≥ 6 rated matches in 14 days, ≥ 80 % one-sided (flagged once per pair per 14 days)
    select count(*), count(*) filter (where (m.winner = 1 and m.p1 = mt.p1) or (m.winner = 2 and m.p2 = mt.p1)) into n, w
      from public.fight_matches m
     where m.kind = 'ug_rated' and m.status = 'done' and m.created_at > now() - interval '14 days'
       and ((m.p1 = mt.p1 and m.p2 = mt.p2) or (m.p1 = mt.p2 and m.p2 = mt.p1));
    if n >= 6 and (w * 5 >= 4 * n or (n - w) * 5 >= 4 * n)
       and not exists (select 1 from public.anticheat_events e where e.account_id = mt.p1 and e.code = 'ug_pair_farm'
                         and e.created_at > now() - interval '14 days' and e.detail->>'opponent' = mt.p2::text) then
      perform public._ac_flag(mt.p1, 'ug_pair_farm', 'fight_push', jsonb_build_object('opponent', mt.p2, 'matches', n, 'wins', w), mt.room_id, null, false);
      perform public._ac_flag(mt.p2, 'ug_pair_farm', 'fight_push', jsonb_build_object('opponent', mt.p1, 'matches', n, 'wins', n - w), mt.room_id, null, false);
    end if;
    return jsonb_build_object('ug', jsonb_build_object('kind', mt.kind, 'entry', mt.entry, 'pot', v_pot, 'fee', v_fee,
                                                       'won', v_won, 'refund', case when v_wacc is null then mt.entry else 0 end,
                                                       'rating', v_rate));
  end if;
  if mt.kind = 'ug_cup' then
    perform 1 from public.ug_cups where id = mt.ref::uuid for update;          -- the cup before the profiles (U14)
    v_rate := public._ug_rate(p_match, p_winner, 1);
    if v_wacc is null then
      -- a draw: the higher seed advances (U4)
      select case when a.seed < b2.seed then mt.p1 else mt.p2 end, case when a.seed < b2.seed then mt.p2 else mt.p1 end
        into v_wacc, v_lacc
        from public.ug_cup_entries a, public.ug_cup_entries b2
       where a.cup_id = mt.ref::uuid and a.account_id = mt.p1 and b2.cup_id = mt.ref::uuid and b2.account_id = mt.p2;
    end if;
    v_cup := public._ug_cup_advance(mt.ref::uuid, p_match, v_wacc, v_lacc);
    return jsonb_build_object('ug', jsonb_build_object('kind', mt.kind, 'rating', v_rate) || coalesce(v_cup, '{}'::jsonb));
  end if;
  return '{}'::jsonb;
end $$;

-- A called or live ug PvP match's lazy rules: the no-show past its call; then the v20.3 rules (_pvp_sweep)
create or replace function public._ug_sweep_match(p_match uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found or mt.status <> 'live' or mt.kind not in ('ug_rated', 'ug_cup') then return; end if;
  if mt.ready <> 3 then
    if mt.call_until < now() then perform public._ug_noshow(p_match); end if;
    return;
  end if;
  perform public._pvp_sweep(p_match);
end $$;

-- The room's lazy rules: its live ug matches (skipping one another call holds), its cups, the queue
create or replace function public._ug_sweep_room(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid; c record;
begin
  for v_id in select id from public.fight_matches where room_id = p_room and kind in ('ug_rated', 'ug_cup') and status = 'live'
               order by id for update skip locked loop
    perform public._ug_sweep_match(v_id);
  end loop;
  for c in select id, status, created_at from public.ug_cups where room_id = p_room and status in ('open', 'running') order by id loop
    if c.status = 'open' and c.created_at < now() - interval '15 minutes' then
      perform public._ug_cup_void(c.id, 'not filled');
    elsif c.status = 'running' then
      perform public._ug_cup_tick(c.id);
    end if;
  end loop;
  perform public._ug_pair(p_room);
end $$;

-- An account's live matches, locked before anything of its own (the lock order: the v20.3 follow-up, U14)
create or replace function public._fx_lock_live(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform 1 from public.fight_matches where status = 'live' and (p1 = p_account or p2 = p_account) order by id for update;
end $$;

-- What busy means underground: a live match, the queue, a cup I have not been knocked out of
create or replace function public._ug_busy(p_account uuid) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when exists (select 1 from public.fight_matches where status = 'live' and (p1 = p_account or p2 = p_account)) then 'in a match'
    when exists (select 1 from public.ug_queue where account_id = p_account) then 'already queued'
    when exists (select 1 from public.ug_cup_entries e join public.ug_cups c on c.id = e.cup_id
                  where e.account_id = p_account and c.status in ('open', 'running') and e.placed is null) then 'already in a cup'
  end
$$;

-- thầy Lâm's line (U7): once, the first dojo visit after the unlock
create or replace function public._ug_hint(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer;
begin
  if not public._ug_unlocked(p_account) then return jsonb_build_object('ug_unlocked', false); end if;
  update public.ug_profiles set hint_at = now() where account_id = p_account and hint_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ug_unlocked', true, 'ug_hint', v_n > 0);
end $$;

-- Everything the underground panel shows
create or replace function public._ug_json(p_room uuid, p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'unlocked', true,
    'season', public._ug_season(),
    'season_ends_ms', public._dojo_ms((date '2026-10-01' + (public._ug_season() + 1) * 28)::timestamp at time zone 'Asia/Ho_Chi_Minh'),
    'me', (select jsonb_build_object('rating', p.rating, 'rated', p.rated, 'tier', public._ug_tier(p.rating), 'peak', p.peak,
                                     'best_tier', p.best_tier, 'titles', to_jsonb(p.titles), 'rated_today', p.rated_today,
                                     'ladder_today', p.ladder_today, 'cups_today', p.cups_today)
             from public.ug_profiles p where p.account_id = p_account),
    'queue', (select jsonb_build_object('tier', q.tier, 'rating', q.rating, 'joined_at_ms', public._dojo_ms(q.joined_at), 'head', q.head)
                from public.ug_queue q where q.account_id = p_account),
    'queued', (select jsonb_build_object('500', count(*) filter (where tier = 500), '2000', count(*) filter (where tier = 2000),
                                         '5000', count(*) filter (where tier = 5000))
                 from public.ug_queue where room_id = p_room),
    'bosses', (select jsonb_agg(jsonb_build_object('floor', b.floor, 'name', b.name, 'style', b.style, 'level', b.level,
                                                   'hp_pct', b.hp_pct, 'entry', b.entry, 'prize', b.prize,
                                                   'style_by_round', to_jsonb(b.style_by_round),
                                                   'cleared', l.cleared_at is not null, 'clears', coalesce(l.clears, 0),
                                                   'attempts', coalesce(l.attempts, 0)) order by b.floor)
                 from public.ug_bosses b
                 left join public.ug_ladder l on l.account_id = p_account and l.season = public._ug_season() and l.floor = b.floor),
    'cups', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tier', c.tier, 'status', c.status,
                  'created_at_ms', public._dojo_ms(c.created_at), 'bracket', c.bracket, 'current_match', c.current_match,
                  'entries', (select jsonb_agg(jsonb_build_object('id', e.account_id, 'name', public._news_name(e.account_id),
                                'seed', e.seed, 'placed', e.placed, 'rating', e.rating) order by coalesce(e.seed, 9), e.joined_at)
                                from public.ug_cup_entries e where e.cup_id = c.id)) order by c.created_at desc)
               from public.ug_cups c
              where c.room_id = p_room and (c.status in ('open', 'running') or c.ended_at > now() - interval '10 minutes')), '[]'::jsonb),
    'mine', (select jsonb_build_object('id', mt.id, 'kind', mt.kind, 'room_id', mt.room_id, 'side', case when mt.p1 = p_account then 1 else 2 end,
                    'params', mt.params, 'entry', mt.entry, 'ready', mt.ready, 'started_at_ms', public._dojo_ms(mt.started_at),
                    'call_until_ms', public._dojo_ms(mt.call_until), 'ref', mt.ref,
                    'foe', case when mt.p2 is null then null else jsonb_build_object(
                      'id', case when mt.p1 = p_account then mt.p2 else mt.p1 end,
                      'name', public._news_name(case when mt.p1 = p_account then mt.p2 else mt.p1 end),
                      'rating', (select rating from public.ug_profiles where account_id = case when mt.p1 = p_account then mt.p2 else mt.p1 end)) end)
               from public.fight_matches mt
              where mt.status = 'live' and mt.kind like 'ug\_%' and (mt.p1 = p_account or mt.p2 = p_account)
              order by mt.created_at desc limit 1),
    'live', coalesce((select jsonb_agg(jsonb_build_object('id', mt.id, 'kind', mt.kind, 'p1', mt.p1, 'p2', mt.p2,
                  'p1_name', public._news_name(mt.p1), 'p2_name', public._news_name(mt.p2), 'ready', mt.ready,
                  'round', mt.sim[3 + 1], 'w1', mt.sim[49 + 36], 'w2', mt.sim[113 + 36], 'params', mt.params,
                  'started_at_ms', public._dojo_ms(mt.started_at)) order by mt.created_at)
               from public.fight_matches mt
              where mt.room_id = p_room and mt.status = 'live' and mt.kind in ('ug_rated', 'ug_cup')), '[]'::jsonb),
    'server_now_ms', public._dojo_ms(now()))
$$;

-- ---------- C. Re-created from their newest versions ----------
-- 0048's _fx_reset plus the marked lines: a style change at the round's start (styleByRound, U12).
create or replace function public._fx_reset(s integer[], b integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare d integer;
  v integer; m integer[];                                          -- v20.4
begin
  s[b + 0] := case when b = 49 then 34816 else 63488 end;       -- START_X1 / START_X2 (136 / 248 px)
  s[b + 1] := 0;
  s[b + 2] := 0;
  s[b + 3] := 0;
  s[b + 4] := case when b = 49 then 1 else -1 end;
  s[b + 5] := s[b + 51];
  s[b + 7] := 0;
  s[b + 8] := 0;
  s[b + 9] := 0;
  s[b + 10] := 0;
  s[b + 11] := 0;
  s[b + 12] := 0;
  s[b + 13] := 0;
  s[b + 14] := 0;
  s[b + 15] := 0;
  s[b + 16] := 0;
  s[b + 17] := 0;
  s[b + 18] := 100;
  s[b + 20] := 0;
  s[b + 21] := -1000;
  for d in 0..8 loop s[b + 22 + d] := -1000; end loop;
  s[b + 31] := -1000;
  s[b + 32] := -1000;
  s[b + 33] := -1000;
  s[b + 34] := 5;
  s[b + 35] := 0;
  s[b + 37] := 0;
  s[b + 38] := -1000;
  s[b + 39] := -1000;
  s[b + 40] := 0;
  s[b + 41] := -1000;
  s[b + 42] := 0;
  s[b + 43] := 0;
  s[b + 44] := 0;
  s[b + 45] := 0;
  s[b + 46] := 0;
  -- v20.4 {
  -- styleByRound (U12): the round's style (slot 32 + side × 5 + round − 1 holds style + 1) and that style row's stats
  v := s[32 + ((b - 49) / 64) * 5 + s[3 + 1] - 1 + 1];
  if v > 0 then
    m := public._fx_moves();
    s[b + 48] := v - 1;
    s[b + 52] := public._fx_sf(m, v - 1, 0);
    s[b + 53] := public._fx_sf(m, v - 1, 1);
    s[b + 54] := public._fx_sf(m, v - 1, 2);
    s[b + 55] := public._fx_sf(m, v - 1, 3);
    s[b + 56] := public._fx_sf(m, v - 1, 4);
  end if;
  -- v20.4 }
  return s;
end $$;

-- 0048's _fx_new plus the marked lines: the styleByRound slots (U12).
create or replace function public._fx_new(p_params jsonb) returns integer[]
language plpgsql immutable parallel safe
as $$
declare
  s integer[] := array_fill(0, array[176]);
  seed bigint;
  f jsonb;
  b integer;
  side integer;
  k integer;                                                                             -- v20.4
begin
  seed := trunc(coalesce((p_params->>'seed')::numeric, 1))::bigint & 4294967295;      -- seed | 0
  if seed >= 2147483648 then seed := seed - 4294967296; end if;
  s[1 + 1] := 0;                                                                         -- G_PHASE intro
  s[2 + 1] := 90;
  s[3 + 1] := 1;
  s[4 + 1] := 5940;
  s[5 + 1] := seed::integer;
  s[8 + 1] := case when coalesce((p_params->>'rounds')::numeric, 3) = 1 then 1 else 2 end;
  s[9 + 1] := public._fx_ji(p_params, 'maxRounds', 5, 1, 5);
  s[10 + 1] := seed::integer;
  s[11 + 1] := 1;                                                                        -- ENGINE_VERSION
  for side in 0..1 loop
    b := 49 + side * 64;
    f := coalesce(p_params -> (case when side = 0 then 'p1' else 'p2' end), '{}'::jsonb);
    s[b + 48] := public._fx_ji(f, 'style', 0, 0, 7);
    s[b + 49] := public._fx_ji(f, 'rank', 0, 0, 4);
    s[b + 50] := public._fx_ji(f, 'movesMask', 1, 0, 31);
    s[b + 51] := (1000 * public._fx_ji(f, 'hpPct', 100, 1, 300)) / 100;
    s[b + 52] := public._fx_ji(f, 'atk', 100, 50, 200);
    s[b + 53] := public._fx_ji(f, 'def', 100, 50, 200);
    s[b + 54] := public._fx_ji(f, 'walk', 100, 50, 200);
    s[b + 55] := public._fx_ji(f, 'jump', 100, 50, 200);
    s[b + 56] := public._fx_ji(f, 'energy', 100, 50, 200);
    s[b + 57] := public._fx_ji(f, 'bot', 0, 0, 9);
    s[b + 6] := public._fx_ji(f, 'en0', 0, 0, 1000);
    s[b + 19] := 0;
    -- v20.4 {
    if jsonb_typeof(f->'styleByRound') = 'array' then
      for k in 0..least(4, jsonb_array_length(f->'styleByRound') - 1) loop
        s[32 + side * 5 + k + 1] := least(7, greatest(0, trunc((f->'styleByRound'->>k)::numeric)::integer)) + 1;
      end loop;
    end if;
    -- v20.4 }
    s := public._fx_reset(s, b);
  end loop;
  return s;
end $$;

-- 0051's _fx_settle plus the marked line: the underground's kinds (_ug_settle).
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
  if mt.kind like 'ug\_%' then v_extra := coalesce(public._ug_settle(p_match, p_winner, p_reason), '{}'::jsonb); end if;   -- v20.4
  v_res := jsonb_build_object('winner', p_winner, 'end_reason', p_reason, 'rounds', public._fx_rounds_json(mt.sim),
                              'rounds_played', n, 'vitals', jsonb_build_object('hunger', 2 * n, 'thirst', 3 * n)) || v_extra;
  update public.fight_matches set result = v_res where id = p_match;
  return v_res;
end $$;

-- 0051's _pvp_void plus the marked line: an underground void's money (_ug_void: refunds, a void cup).
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
  if mt.kind like 'ug\_%' then v_res := v_res || coalesce(public._ug_void(p_match), '{}'::jsonb); end if;   -- v20.4
  update public.fight_matches set result = v_res where id = p_match;
  return v_res;
end $$;

-- 0051's _pvp_sweep plus the changed line: the ug PvP kinds once both are ready (U2).
create or replace function public._pvp_sweep(p_match uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare mt public.fight_matches; a1 timestamptz; a2 timestamptz; w1 integer; w2 integer; h1 integer; h2 integer;
begin
  select * into mt from public.fight_matches where id = p_match for update;
  if not found or mt.status <> 'live' or mt.kind not in ('pvp', 'ug_rated', 'ug_cup') or mt.ready <> 3 then return; end if;   -- v20.4 was: if not found or mt.status <> 'live' or mt.kind <> 'pvp' then return; end if;
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

-- 0051's _pvp_caps plus the changed lines: live ug PvP matches count against the realtime caps (U10).
create or replace function public._pvp_caps(p_room uuid, p_a uuid, p_b uuid, p_stake integer) returns text
language plpgsql stable security definer set search_path = public, extensions
as $$
declare cfg public.fight_config; v_day timestamptz := public._vn_day_start(); v_acc uuid; v_cap integer;
begin
  select * into cfg from public.fight_config where id;
  if (select count(*) from public.fight_matches where kind in ('pvp', 'ug_rated', 'ug_cup') and status = 'live' and room_id = p_room) >= cfg.max_live_room   -- v20.4 was: if (select count(*) from public.fight_matches where kind = 'pvp' and status = 'live' and room_id = p_room) >= cfg.max_live_room
     or (select count(*) from public.fight_matches where kind in ('pvp', 'ug_rated', 'ug_cup') and status = 'live') >= cfg.max_live_all then   -- v20.4 was: or (select count(*) from public.fight_matches where kind = 'pvp' and status = 'live') >= cfg.max_live_all then
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

-- 0051's fight_push plus the marked block: a called ug match's no-show, and no push before frame 0 is set (U2).
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

-- 0051's fight_state plus the marked lines: a spectator of a ug match (side 0: both runs up to min(frontiers), U13), and
-- a called match's no-show.
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
  elsif mt.kind in ('ug_rated', 'ug_cup') and public._ug_unlocked(v_account) then v_side := 0;                                             -- v20.4
  else raise exception 'not your match' using errcode = '22023'; end if;
  if mt.status = 'live' and mt.p2 is null then
    perform public._fx_sweep(v_account);
    select * into mt from public.fight_matches where id = p_match;
  end if;
  if mt.status = 'live' and mt.p2 is not null then perform public._pvp_sweep(p_match); select * into mt from public.fight_matches where id = p_match; end if;   -- v20.3
  if mt.status = 'live' and mt.ready <> 3 then perform public._ug_sweep_match(p_match); select * into mt from public.fight_matches where id = p_match; end if;   -- v20.4
  update public.fight_logs set resync = false where match_id = p_match and side = v_side and resync;                                                     -- v20.3
  select runs into v_mine from public.fight_logs where match_id = p_match and side = v_side;
  if mt.p2 is not null then
    v_min := least((select frontier from public.fight_logs where match_id = p_match and side = 1),
                   (select frontier from public.fight_logs where match_id = p_match and side = 2));
    select public._fx_runs_encode(public._fx_runs_slice(runs, 0, v_min + 1)) into v_theirs
      from public.fight_logs where match_id = p_match and side = 3 - v_side;
  end if;
  -- v20.4 {
  if v_side = 0 then
    return public._fx_answer(p_match, v_side) || jsonb_build_object(
      'params', mt.params, 'started_at_ms', (extract(epoch from mt.started_at) * 1000)::bigint, 'spectator', true, 'ready', mt.ready,
      'runs', to_jsonb((select public._fx_runs_encode(public._fx_runs_slice(l.runs, 0, v_min + 1)) from public.fight_logs l where l.match_id = p_match and l.side = 1)),
      'opp_runs', to_jsonb((select public._fx_runs_encode(public._fx_runs_slice(l.runs, 0, v_min + 1)) from public.fight_logs l where l.match_id = p_match and l.side = 2)),
      'sim', to_jsonb(mt.sim), 'sim_hash', mt.sim_hash);
  end if;
  -- v20.4 }
  return public._fx_answer(p_match, v_side) || jsonb_build_object(
    'params', mt.params, 'started_at_ms', (extract(epoch from mt.started_at) * 1000)::bigint,
    'runs', to_jsonb(coalesce(v_mine, '{}'::integer[])), 'opp_runs', to_jsonb(v_theirs),
    'sim', to_jsonb(mt.sim), 'sim_hash', mt.sim_hash);
end $$;

-- 0051's fight_claim plus the changed line: the ug PvP kinds, once both are ready.
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
  if mt.kind not in ('pvp', 'ug_rated', 'ug_cup') or mt.ready <> 3 then raise exception 'not a ring match' using errcode = '22023'; end if;   -- v20.4 was: if mt.kind <> 'pvp' then raise exception 'not a ring match' using errcode = '22023'; end if;
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

-- 0051's _fight_accounts_bd plus the marked line: the matches before the wallet (U14; its trigger now fires first).
create or replace function public._fight_accounts_bd() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._fx_lock_live(old.id);                                                -- v20.4
  perform public._wallet_lock(old.id);
  perform public._fx_forfeit_all(old.id);
  return old;
end $$;

-- 0051's _ac_wipe plus the marked lines: the matches locked first (U14); the underground rows go.
create or replace function public._ac_wipe(p_account uuid, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_snap jsonb; v_id bigint; v_coins integer;
begin
  perform public._fx_lock_live(p_account);                                          -- v20.4
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
  -- v20.4 {
  delete from public.ug_queue where account_id = p_account;
  delete from public.ug_cup_entries e using public.ug_cups c where e.cup_id = c.id and c.status = 'open' and e.account_id = p_account;
  delete from public.ug_ladder where account_id = p_account;
  delete from public.ug_profiles where account_id = p_account;
  update public.characters set ug_title = null where account_id = p_account;
  -- v20.4 }
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

-- 0050's dojo_state plus the changed line: the unlock, and thầy Lâm's line once (U6, U7).
create or replace function public.dojo_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._fx_sweep(v_account);
  perform public._dojo_sweep(v_account);
  -- lazy retention: logs 14 days after the match ended, match rows after 90 days
  delete from public.fight_logs where match_id in (select id from public.fight_matches
    where ended_at < now() - interval '14 days' order by ended_at limit 200);
  delete from public.fight_matches where id in (select id from public.fight_matches
    where ended_at < now() - interval '90 days' order by ended_at limit 200);
  return public._dojo_json(v_account) || public._ug_hint(v_account);   -- v20.4 was: return public._dojo_json(v_account);
end $$;

-- 0015's admin_anticheat_resolve plus the marked line: a wipe locks the account's live matches before its wallet
-- (the v20.3 follow-up: fight_push locks match → wallets; U14).
create or replace function public.admin_anticheat_resolve(p_session_token text, p_account_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); s public.anticheat_status;
begin
  if p_action is null or p_action not in ('wipe', 'pardon') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  if p_action = 'wipe' then
    if not exists (select 1 from public.accounts where id = p_account_id) then
      raise exception 'not pending' using errcode = '22023';
    end if;
    perform public._fx_lock_live(p_account_id);                                        -- v20.4
    perform public._wallet_lock(p_account_id);
    select * into s from public.anticheat_status where account_id = p_account_id for update;
    if not found or s.ban_state is distinct from 'pending_wipe' then
      raise exception 'not pending' using errcode = '22023';
    end if;
    perform public._ac_wipe(p_account_id, v_root);
  else
    perform public._ac_pardon(p_account_id, v_root);
  end if;
  return public._ac_case(p_account_id);
end $$;

-- ---------- D. The RPCs ----------
-- a room member with the unlock (reads, leaving the queue or a cup: allowed while the anti-cheat lock runs)
create or replace function public._ug_member(p_room uuid, p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room, p_token);
begin
  if not public._ug_unlocked(v_account) then raise exception 'underground locked' using errcode = '42501'; end if;
  return v_account;
end $$;

-- What the client needs on Chợ Lớn (is the hatch there?) and in the hầm (the panel). Not unlocked: only that.
create or replace function public.ug_status(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  if not public._ug_unlocked(v_account) then
    return jsonb_build_object('unlocked', false, 'server_now_ms', public._dojo_ms(now()));
  end if;
  perform public._ug_sweep_room(p_room_id);
  perform public._ug_profile(v_account);
  return public._ug_json(p_room_id, v_account);
end $$;

-- "E · Gõ cửa": the knock is the client's; the door opens only for the unlocked
create or replace function public.ug_enter(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_auth(p_room_id, p_session_token);
begin
  perform public._ug_sweep_room(p_room_id);
  perform public._ug_profile(v_account);
  return public._ug_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

-- Kèo ngầm: the entry is held at join (ug_entry); the pairing runs at once and at every poll
create or replace function public.ug_queue_join(p_room_id uuid, p_session_token text, p_tier integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_auth(p_room_id, p_session_token); v_style jsonb; p public.ug_profiles; v_coins integer;
        v_busy text;
begin
  if p_tier is null or p_tier not in (500, 2000, 5000) then raise exception 'bad tier' using errcode = '22023'; end if;
  perform public._ug_sweep_room(p_room_id);
  v_style := public._fx_style_of(v_account);
  perform public._fx_vitals_ok(v_account);
  v_busy := public._ug_busy(v_account);
  if v_busy is not null then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', v_busy); end if;
  p := public._ug_profile(v_account);
  if p.rated_today >= 10 then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'daily ug limit'); end if;
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < p_tier then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'not enough xu'); end if;
  perform public._pay(v_account, -p_tier, 'ug_entry', 'ug kèo ' || p_tier);
  insert into public.ug_queue (account_id, room_id, tier, rating, style) values (v_account, p_room_id, p_tier, p.rating, v_style);
  perform public._ug_pair(p_room_id);
  return public._ug_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

create or replace function public.ug_queue_leave(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_member(p_room_id, p_session_token); q public.ug_queue;
begin
  perform public._ug_sweep_room(p_room_id);
  select * into q from public.ug_queue where account_id = v_account for update;
  if found then
    perform public._wallet_lock(v_account);
    perform public._pay(v_account, q.tier, 'ug_refund', 'ug kèo: rời hàng');
    delete from public.ug_queue where account_id = v_account;
  end if;
  return public._ug_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

-- "Sẵn sàng" for a called match (U2) with my input delay; the second one sets frame 0 (3 s) and the larger delay
create or replace function public.ug_ready(p_room_id uuid, p_session_token text, p_match uuid, p_n integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_auth(p_room_id, p_session_token); mt public.fight_matches; v_side smallint;
begin
  if p_n is null or p_n not between 2 and 6 then raise exception 'bad delay' using errcode = '22023'; end if;
  perform public._ug_sweep_match(p_match);
  select * into mt from public.fight_matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = '22023'; end if;
  if mt.p1 = v_account then v_side := 1;
  elsif mt.p2 = v_account then v_side := 2;
  else raise exception 'not your match' using errcode = '22023'; end if;
  if mt.kind not in ('ug_rated', 'ug_cup') then raise exception 'not a called match' using errcode = '22023'; end if;
  if mt.status = 'live' and mt.ready <> 3 then
    mt.params := jsonb_set(mt.params, array['n' || v_side], to_jsonb(p_n));
    mt.ready := mt.ready | (case v_side when 1 then 1 else 2 end);
    if mt.ready = 3 then
      mt.started_at := now() + interval '3 seconds';
      mt.params := jsonb_set(mt.params, '{delay}', to_jsonb(greatest(coalesce((mt.params->>'n1')::int, 2), coalesce((mt.params->>'n2')::int, 2))));
    end if;
    update public.fight_matches set ready = mt.ready, params = mt.params, started_at = mt.started_at where id = p_match;
  end if;
  return public._ug_json(p_room_id, v_account) || jsonb_build_object('ok', true, 'match', jsonb_build_object(
    'id', mt.id, 'kind', mt.kind, 'status', mt.status, 'ready', mt.ready, 'params', mt.params, 'side', v_side,
    'started_at_ms', public._dojo_ms(mt.started_at), 'call_until_ms', public._dojo_ms(mt.call_until), 'entry', mt.entry));
end $$;

-- Tầng hầm: floor k needs floor k − 1 cleared this season; the entry is paid at start (no refund); a bot match through
-- the v20.2 pipeline with the boss's HP, level and specials (floor 10: its style list)
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
  v_params := jsonb_build_object('seed', floor(random() * 4294967296)::bigint, 'rounds', 3, 'maxRounds', 5,
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

-- Giải đêm: sign up at a tier (the entry held); the 4th sign-up draws the bracket and calls the first semifinal
create or replace function public.ug_cup_join(p_room_id uuid, p_session_token text, p_tier integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_auth(p_room_id, p_session_token); s jsonb; p public.ug_profiles; v_coins integer;
        v_busy text; c public.ug_cups; n integer; k integer;
begin
  if p_tier is null or p_tier not in (1000, 5000) then raise exception 'bad tier' using errcode = '22023'; end if;
  perform public._ug_sweep_room(p_room_id);
  s := public._fx_style_of(v_account);
  perform public._fx_vitals_ok(v_account);
  v_busy := public._ug_busy(v_account);
  if v_busy is not null then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', v_busy); end if;
  for k in 1..3 loop
    insert into public.ug_cups (room_id, tier) values (p_room_id, p_tier) on conflict (room_id, tier) where status = 'open' do nothing;
    select * into c from public.ug_cups where room_id = p_room_id and tier = p_tier and status = 'open' for update;
    exit when found;
  end loop;
  if c.id is null then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'ring busy'); end if;
  p := public._ug_profile(v_account);
  if p.cups_today >= 3 then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'daily ug limit'); end if;
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < p_tier then return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'not enough xu'); end if;
  perform public._pay(v_account, -p_tier, 'ug_entry', 'ug cup ' || left(c.id::text, 8));
  insert into public.ug_cup_entries (cup_id, account_id, rating, style) values (c.id, v_account, p.rating, s);
  select count(*) into n from public.ug_cup_entries where cup_id = c.id;
  if n >= 4 then perform public._ug_cup_start(c.id); end if;
  return public._ug_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

-- Leaving an open cup refunds the entry; a running cup cannot be left (its matches are forfeited by not showing)
create or replace function public.ug_cup_leave(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_member(p_room_id, p_session_token); r record; v_left boolean := false;
begin
  perform public._ug_sweep_room(p_room_id);
  for r in select c.id, c.tier from public.ug_cup_entries e join public.ug_cups c on c.id = e.cup_id
            where e.account_id = v_account and c.room_id = p_room_id and c.status = 'open' order by c.id loop
    perform 1 from public.ug_cups where id = r.id and status = 'open' for update;
    continue when not found;
    perform public._wallet_lock(v_account);
    perform public._pay(v_account, r.tier, 'ug_refund', 'ug cup ' || left(r.id::text, 8) || ': rút tên');
    delete from public.ug_cup_entries where cup_id = r.id and account_id = v_account;
    v_left := true;
  end loop;
  if not v_left and exists (select 1 from public.ug_cup_entries e join public.ug_cups c on c.id = e.cup_id
                             where e.account_id = v_account and c.status = 'running' and e.placed is null) then
    return public._ug_json(p_room_id, v_account) || jsonb_build_object('refused', 'cup running');
  end if;
  return public._ug_json(p_room_id, v_account) || jsonb_build_object('ok', true);
end $$;

create or replace function public.ug_cup_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_member(p_room_id, p_session_token);
begin
  perform public._ug_sweep_room(p_room_id);
  return public._ug_json(p_room_id, v_account);
end $$;

-- Bảng xếp hạng ngầm: the season's top 10 of the room (its rated and cup fighters) and of the whole town
create or replace function public.ug_board(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ug_member(p_room_id, p_session_token); v_season integer := public._ug_season();
        v_from timestamptz;
begin
  perform public._ug_close_due();
  v_from := case when v_season = 0 then '-infinity'::timestamptz
                 else (date '2026-10-01' + v_season * 28)::timestamp at time zone 'Asia/Ho_Chi_Minh' end;
  return jsonb_build_object('season', v_season,
    'global', coalesce((select jsonb_agg(jsonb_build_object('name', public._news_name(t.account_id), 'rating', t.rating,
                  'tier', public._ug_tier(t.rating), 'me', t.account_id = v_account) order by t.rating desc, t.account_id)
      from (select p.account_id, p.rating from public.ug_profiles p
             where p.season = v_season and exists (select 1 from public.fight_matches m
                     where m.kind in ('ug_rated', 'ug_cup') and m.status = 'done' and m.created_at >= v_from
                       and (m.p1 = p.account_id or m.p2 = p.account_id))
             order by p.rating desc, p.account_id limit 10) t), '[]'::jsonb),
    'room', coalesce((select jsonb_agg(jsonb_build_object('name', public._news_name(t.account_id), 'rating', t.rating,
                  'tier', public._ug_tier(t.rating), 'me', t.account_id = v_account) order by t.rating desc, t.account_id)
      from (select p.account_id, p.rating from public.ug_profiles p
             where p.season = v_season and exists (select 1 from public.fight_matches m
                     where m.room_id = p_room_id and m.kind in ('ug_rated', 'ug_cup') and m.status = 'done' and m.created_at >= v_from
                       and (m.p1 = p.account_id or m.p2 = p.account_id))
             order by p.rating desc, p.account_id limit 10) t), '[]'::jsonb),
    'server_now_ms', public._dojo_ms(now()));
end $$;

-- ---------- E. The ledger ----------
-- 0051's 48 reasons (0052–0055 add none before this) plus the underground's three: 51.
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
                    'fight_stake','fight_win','fight_refund',
                    'ug_entry','ug_prize','ug_refund'));

-- ---------- the account trigger fires before card_accounts_bd (which locks the wallet): matches first (U14) ----------
drop trigger if exists fight_accounts_bd on public.accounts;
drop trigger if exists accounts_bd_fight on public.accounts;
create trigger accounts_bd_fight before delete on public.accounts for each row execute function public._fight_accounts_bd();

-- ---------- privileges ----------
revoke all on function public._ug_season() from public, anon, authenticated;
revoke all on function public._ug_tier(integer) from public, anon, authenticated;
revoke all on function public._ug_unlocked(uuid) from public, anon, authenticated;
revoke all on function public._ug_close_season(integer) from public, anon, authenticated;
revoke all on function public._ug_close_due() from public, anon, authenticated;
revoke all on function public._ug_profile(uuid) from public, anon, authenticated;
revoke all on function public._ug_auth(uuid, text) from public, anon, authenticated;
revoke all on function public._ug_member(uuid, text) from public, anon, authenticated;
revoke all on function public._ug_elo(integer, integer, numeric, integer, numeric) from public, anon, authenticated;
revoke all on function public._ug_rate(uuid, smallint, numeric) from public, anon, authenticated;
revoke all on function public._ug_live_full(uuid) from public, anon, authenticated;
revoke all on function public._ug_call(uuid, text, uuid, uuid, jsonb, jsonb, integer, text, integer) from public, anon, authenticated;
revoke all on function public._ug_pair(uuid) from public, anon, authenticated;
revoke all on function public._ug_cup_void(uuid, text) from public, anon, authenticated;
revoke all on function public._ug_cup_tick(uuid) from public, anon, authenticated;
revoke all on function public._ug_cup_start(uuid) from public, anon, authenticated;
revoke all on function public._ug_cup_advance(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._ug_noshow(uuid) from public, anon, authenticated;
revoke all on function public._ug_void(uuid) from public, anon, authenticated;
revoke all on function public._ug_settle(uuid, smallint, text) from public, anon, authenticated;
revoke all on function public._ug_sweep_match(uuid) from public, anon, authenticated;
revoke all on function public._ug_sweep_room(uuid) from public, anon, authenticated;
revoke all on function public._fx_lock_live(uuid) from public, anon, authenticated;
revoke all on function public._ug_busy(uuid) from public, anon, authenticated;
revoke all on function public._ug_hint(uuid) from public, anon, authenticated;
revoke all on function public._ug_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public._fx_reset(integer[], integer) from public, anon, authenticated;
revoke all on function public._fx_new(jsonb) from public, anon, authenticated;
revoke all on function public._fx_settle(uuid, smallint, text) from public, anon, authenticated;
revoke all on function public._pvp_void(uuid, text, text) from public, anon, authenticated;
revoke all on function public._pvp_sweep(uuid) from public, anon, authenticated;
revoke all on function public._pvp_caps(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public._fight_accounts_bd() from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) from public;
revoke all on function public.fight_state(text, uuid) from public;
revoke all on function public.fight_claim(text, uuid) from public;
revoke all on function public.dojo_state(text) from public;
revoke all on function public.admin_anticheat_resolve(text, uuid, text) from public;
revoke all on function public.ug_status(uuid, text) from public;
revoke all on function public.ug_enter(uuid, text) from public;
revoke all on function public.ug_queue_join(uuid, text, integer) from public;
revoke all on function public.ug_queue_leave(uuid, text) from public;
revoke all on function public.ug_ready(uuid, text, uuid, integer) from public;
revoke all on function public.ug_ladder_start(uuid, text, integer) from public;
revoke all on function public.ug_cup_join(uuid, text, integer) from public;
revoke all on function public.ug_cup_leave(uuid, text) from public;
revoke all on function public.ug_cup_state(uuid, text) from public;
revoke all on function public.ug_board(uuid, text) from public;
grant execute on function public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer) to anon, authenticated;
grant execute on function public.fight_state(text, uuid) to anon, authenticated;
grant execute on function public.fight_claim(text, uuid) to anon, authenticated;
grant execute on function public.dojo_state(text) to anon, authenticated;
grant execute on function public.admin_anticheat_resolve(text, uuid, text) to anon, authenticated;
grant execute on function public.ug_status(uuid, text) to anon, authenticated;
grant execute on function public.ug_enter(uuid, text) to anon, authenticated;
grant execute on function public.ug_queue_join(uuid, text, integer) to anon, authenticated;
grant execute on function public.ug_queue_leave(uuid, text) to anon, authenticated;
grant execute on function public.ug_ready(uuid, text, uuid, integer) to anon, authenticated;
grant execute on function public.ug_ladder_start(uuid, text, integer) to anon, authenticated;
grant execute on function public.ug_cup_join(uuid, text, integer) to anon, authenticated;
grant execute on function public.ug_cup_leave(uuid, text) to anon, authenticated;
grant execute on function public.ug_cup_state(uuid, text) to anon, authenticated;
grant execute on function public.ug_board(uuid, text) to anon, authenticated;
