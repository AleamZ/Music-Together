-- =========================================================
-- 0070_progression.sql — v21 "progression" group (#48 level/EXP, #54 achievements, #55 titles, #56 leaderboards,
-- #14/#57 Fishdex + collections, #92 map unlocks by level, #93 teleport waypoints). ADDITIVE and re-runnable. After 0069.
--
-- Everything here is derived from public.game_events (0069) by ONE after-insert trigger (_pg_on_event) — no gameplay RPC is
-- re-created. Only server code writes game_events, so levels, achievements and collections are as trustworthy as the RPCs
-- behind the events. A failure inside the progression trigger is swallowed (a warning), so it can never block a catch,
-- a sale or a fight.
--
-- ---------- EVENTS CONSUMED ----------
--   'fish_catch' (meta.species, meta.weight_g)   → XP 4 × rarity + min(10, weight_g / 500); Fishdex; stats
--   'earn'       (qty = coins, meta.reason)      → only the "work" reasons of _pg_work_reason(): XP min(50, qty / 20),
--                                                  capped per VN day (see below); stats earned_total / farm_earned
--   'fight_win'  (meta.kind)                     → XP pvp 40, exam 25, ug_* 30; stats fight_wins
--   'fight_done' (meta.kind)                     → XP 5 (a loss still teaches something)
--   'xp_grant'   (qty = XP, meta.source)         → THE GENERIC HOOK FOR OTHER v21 AGENTS. From your SECURITY DEFINER RPC:
--                    perform public._game_event(v_account, 'xp_grant', 120, jsonb_build_object('source', 'quest'));
--                  qty is clamped to 1…500 per event; meta.source is a short tag ('quest', 'mine', 'boss', …) shown in
--                  the XP log. Never emit it from anything a client can call freely without server-side validation.
-- Daily XP caps per VN day (bucket → cap): fish 1500, earn 400, fight 400, grant 3000.
--
-- ---------- EVENTS EMITTED ----------
--   'level_up'    (qty = new level)            — after the level reward is paid
--   'achievement' (qty = 1, meta.id)           — after the achievement reward is paid
--   'collection'  (qty = 1, meta.id)           — after the collection reward is paid
--   'teleport'    (qty = fee, meta.from/to)    — a waypoint fast travel
--
-- ---------- LEVEL CURVE ----------
--   XP to go from level L to L+1 = 100 + 50 × (L − 1); total XP at level L = 100(L−1) + 25(L−1)(L−2). Max level 99.
--   Level reward (reason 'level_reward'): 50 × L xu, 150 × L on every 5th level. lib/game/progression/model.ts mirrors it.
--
-- ---------- MAP UNLOCKS (#92) ----------
--   public.map_levels(map pk, min_level). Every existing map is level 1. A NEW MAP: add a row in your migration
--     insert into public.map_levels (map, min_level) values ('mo_da', 10) on conflict (map) do update set min_level = excluded.min_level;
--   and mirror it in lib/game/progression/model.ts MAP_MIN_LEVEL (the client's portal gate reads it). Server check:
--     if not public._map_unlocked(v_account, 'mo_da') then raise exception 'map locked' using errcode = '22023'; end if;
--   A map not in the table is open.
--
-- ---------- WAYPOINTS (#93) ----------
--   Discovered by standing near one: a trigger on player_pos (0057's accepted claims) records every waypoint within
--   160 px of an accepted position. waypoint_travel(token, to) needs the server position within 160 px of a discovered
--   waypoint, the target discovered, its level and its map unlocked; it charges 20 xu ('teleport') and MOVES the server
--   position to the target (so the next claim from there is accepted and nothing else can be skipped). 15 s cooldown.
--
-- Lock order: player_pos → wallet → player_progress (a ledger row fires the progression trigger under the wallet lock).
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.player_progress (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  level integer not null default 1 check (level between 1 and 99),
  title text,                                   -- the chosen achievement id whose title is worn (null = none)
  xp_day date,                                  -- the VN day the buckets count
  xp_fish integer not null default 0,
  xp_earn integer not null default 0,
  xp_fight integer not null default 0,
  xp_grant integer not null default 0,
  tp_at timestamptz,                            -- the last teleport
  updated_at timestamptz not null default now()
);
create index if not exists idx_player_progress_level on public.player_progress (level desc, xp desc);

create table if not exists public.player_stats (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  fish_total integer not null default 0,
  biggest_g integer not null default 0,
  biggest_species text,
  earned_total bigint not null default 0,
  farm_earned bigint not null default 0,
  fight_wins integer not null default 0
);

create table if not exists public.player_fishdex (
  account_id uuid not null references public.accounts(id) on delete cascade,
  species text not null,
  caught integer not null default 0,
  best_g integer not null default 0,
  first_at timestamptz not null default now(),
  primary key (account_id, species)
);

create table if not exists public.achievement_catalog (
  id text primary key,
  name text not null,
  descr text not null,
  stat text not null check (stat in ('fish_total','species','biggest_g','earned_total','farm_earned','fight_wins','level')),
  goal bigint not null check (goal > 0),
  reward integer not null default 0 check (reward >= 0),
  title text,                                   -- unlocks this title (null = none)
  sort_order integer not null default 0
);
create table if not exists public.player_achievements (
  account_id uuid not null references public.accounts(id) on delete cascade,
  achievement text not null references public.achievement_catalog(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (account_id, achievement)
);

create table if not exists public.collection_catalog (
  id text primary key,
  name text not null,
  rarity_min smallint not null,
  rarity_max smallint not null,
  reward integer not null check (reward >= 0),
  sort_order integer not null default 0
);
create table if not exists public.player_collections (
  account_id uuid not null references public.accounts(id) on delete cascade,
  collection text not null references public.collection_catalog(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (account_id, collection)
);

create table if not exists public.map_levels (
  map text primary key,
  min_level integer not null default 1 check (min_level between 1 and 99)
);

create table if not exists public.waypoints (
  id text primary key,
  name text not null,
  map text not null,
  x integer not null,
  y integer not null,
  dir text not null default 'down',
  min_level integer not null default 1,
  sort_order integer not null default 0
);
create table if not exists public.player_waypoints (
  account_id uuid not null references public.accounts(id) on delete cascade,
  waypoint text not null references public.waypoints(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (account_id, waypoint)
);

create table if not exists public.leaderboard_cache (
  board text primary key,
  rows jsonb not null,
  at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['player_progress','player_stats','player_fishdex','achievement_catalog','player_achievements',
                           'collection_catalog','player_collections','map_levels','waypoints','player_waypoints',
                           'leaderboard_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- The name tag (characters is readable by everyone; only these functions write the two columns).
alter table public.characters add column if not exists pg_level smallint null;
alter table public.characters add column if not exists pg_title text null;

-- ---------- B. Seeds (lib/game/progression/model.ts mirrors them; tests pin them) ----------
insert into public.achievement_catalog (id, name, descr, stat, goal, reward, title, sort_order) values
  ('fish_1',     'Mẻ cá đầu tiên',   'Câu được 1 con cá',              'fish_total',   1,       50,    null,               10),
  ('fish_100',   'Tay câu khá',      'Câu được 100 con cá',            'fish_total',   100,     500,   'Thợ câu',          20),
  ('fish_1000',  'Lão ngư',          'Câu được 1000 con cá',           'fish_total',   1000,    5000,  'Lão ngư',          30),
  ('species_6',  'Biết mặt cá',      'Câu được 6 loài cá khác nhau',   'species',      6,       300,   null,               40),
  ('species_12', 'Nhà sưu tầm',      'Câu được 12 loài cá khác nhau',  'species',      12,      2000,  'Nhà sưu tầm cá',   50),
  ('big_5kg',    'Cá to',            'Câu được con cá nặng từ 5 kg',   'biggest_g',    5000,    500,   null,               60),
  ('big_20kg',   'Thủy quái',        'Câu được con cá nặng từ 20 kg',  'biggest_g',    20000,   3000,  'Săn thủy quái',    70),
  ('earn_10k',   'Có của ăn của để', 'Kiếm 10 000 xu bằng sức lao động', 'earned_total', 10000,  300,   null,               80),
  ('earn_1m',    'Đại gia',          'Kiếm 1 000 000 xu bằng sức lao động', 'earned_total', 1000000, 20000, 'Đại gia',      90),
  ('farm_50k',   'Lão nông',         'Bán nông sản được 50 000 xu',    'farm_earned',  50000,   2000,  'Lão nông',         100),
  ('win_1',      'Trận thắng đầu',   'Thắng 1 trận đấu võ',            'fight_wins',   1,       100,   null,               110),
  ('win_50',     'Võ sĩ',            'Thắng 50 trận đấu võ',           'fight_wins',   50,      2000,  'Võ sĩ',            120),
  ('win_500',    'Vô địch',          'Thắng 500 trận đấu võ',          'fight_wins',   500,     20000, 'Vô địch',          130),
  ('level_10',   'Dân làng',         'Đạt cấp 10',                     'level',        10,      1000,  'Dân làng kỳ cựu',  140),
  ('level_30',   'Huyền thoại',      'Đạt cấp 30',                     'level',        30,      10000, 'Huyền thoại',      150)
on conflict (id) do update set name = excluded.name, descr = excluded.descr, stat = excluded.stat, goal = excluded.goal,
  reward = excluded.reward, title = excluded.title, sort_order = excluded.sort_order;

insert into public.collection_catalog (id, name, rarity_min, rarity_max, reward, sort_order) values
  ('fish_common', 'Cá đồng quê',     1, 1, 200,  10),
  ('fish_river',  'Cá sông rạch',    2, 2, 500,  20),
  ('fish_rare',   'Cá hiếm',          3, 3, 1000, 30),
  ('fish_legend', 'Cá quý & huyền thoại', 4, 5, 3000, 40),
  ('fish_all',    'Trọn bộ Fishdex', 1, 5, 5000, 50)
on conflict (id) do update set name = excluded.name, rarity_min = excluded.rarity_min, rarity_max = excluded.rarity_max,
  reward = excluded.reward, sort_order = excluded.sort_order;

insert into public.map_levels (map, min_level) values
  ('hall', 1), ('pond', 1), ('field', 1), ('market', 1), ('khu_nha', 1), ('bai_dat', 1), ('ham_ngam', 1)
on conflict (map) do nothing;

-- On each map's arrival spot (lib/game/maps/arrivals.ts; the hall's is its spawn), so arriving discovers it.
insert into public.waypoints (id, name, map, x, y, dir, min_level, sort_order) values
  ('wp_hall',    'Sảnh chính',       'hall',    612, 300, 'down',  1, 10),
  ('wp_pond',    'Ao cá',            'pond',    300, 356, 'up',    1, 20),
  ('wp_field',   'Đồng ruộng',       'field',    60, 106, 'right', 1, 30),
  ('wp_market',  'Chợ Lớn',          'market',   72, 252, 'right', 2, 40),
  ('wp_khu_nha', 'Khu nhà',          'khu_nha',  68, 208, 'right', 4, 50),
  ('wp_bai_dat', 'Bãi đất trống',    'bai_dat', 400,  48, 'down',  6, 60)
on conflict (id) do update set name = excluded.name, map = excluded.map, x = excluded.x, y = excluded.y, dir = excluded.dir,
  min_level = excluded.min_level, sort_order = excluded.sort_order;

-- ---------- C. Pure helpers ----------
create or replace function public._pg_xp_at(p_level integer) returns bigint
language sql immutable parallel safe
as $$ select (100 * (p_level - 1) + 25 * (p_level - 1) * (p_level - 2))::bigint $$;

create or replace function public._pg_level_for(p_xp bigint) returns integer
language sql immutable parallel safe
as $$ select coalesce(max(l), 1) from generate_series(1, 99) l where public._pg_xp_at(l) <= p_xp $$;

create or replace function public._pg_level_reward(p_level integer) returns integer
language sql immutable parallel safe
as $$ select case when p_level % 5 = 0 then 150 * p_level else 50 * p_level end $$;

-- Coins earned by work (XP and the earned stats). Rewards, refunds, stakes and player-to-player transfers are not work.
create or replace function public._pg_work_reason(p_reason text) returns boolean
language sql immutable parallel safe
as $$ select p_reason in ('song','sell','rice_sell','produce_sell','critter_sell','rat_sell','ore_sell','gem_sell','wild_sell',
                          'daily','login_reward','pet_find') $$;

create or replace function public._pg_cap(p_bucket text) returns integer
language sql immutable parallel safe
as $$ select case p_bucket when 'fish' then 1500 when 'earn' then 400 when 'fight' then 400 when 'grant' then 3000 else 0 end $$;

do $$
declare f text;
begin
  foreach f in array array['_pg_xp_at(integer)','_pg_level_for(bigint)','_pg_level_reward(integer)','_pg_work_reason(text)',
                           '_pg_cap(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------- D. Map unlocks ----------
create or replace function public._pg_level(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select level from public.player_progress where account_id = p_account), 1) $$;
revoke all on function public._pg_level(uuid) from public, anon, authenticated;

-- Is this map open to the account? (A map not in map_levels is open.) For other agents' gated RPCs.
create or replace function public._map_unlocked(p_account uuid, p_map_id text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select public._pg_level(p_account) >= coalesce((select min_level from public.map_levels where map = p_map_id), 1) $$;
revoke all on function public._map_unlocked(uuid, text) from public, anon, authenticated;

-- ---------- E. Rewards, XP, achievements ----------
create or replace function public._pg_reward(p_account uuid, p_coins integer, p_reason text, p_ref text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_coins <= 0 then return; end if;
  insert into public.wallets (account_id) values (p_account) on conflict (account_id) do nothing;
  perform public._pay(p_account, p_coins, p_reason, left(p_ref, 80));
end $$;
revoke all on function public._pg_reward(uuid, integer, text, text) from public, anon, authenticated;

-- The progress row, locked (created at level 1).
create or replace function public._pg_row(p_account uuid) returns public.player_progress
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.player_progress;
begin
  insert into public.player_progress (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into r from public.player_progress where account_id = p_account for update;
  if r.xp_day is distinct from public._vn_today() then
    update public.player_progress set xp_day = public._vn_today(), xp_fish = 0, xp_earn = 0, xp_fight = 0, xp_grant = 0
     where account_id = p_account returning * into r;
  end if;
  return r;
end $$;
revoke all on function public._pg_row(uuid) from public, anon, authenticated;

-- Unlock every achievement whose goal is met (pays each once).
create or replace function public._pg_check_achievements(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.player_stats; v_species integer; v_level integer; a record;
begin
  select * into s from public.player_stats where account_id = p_account;
  select count(*) into v_species from public.player_fishdex where account_id = p_account;
  v_level := public._pg_level(p_account);
  for a in
    insert into public.player_achievements (account_id, achievement)
    select p_account, c.id from public.achievement_catalog c
     where case c.stat when 'fish_total' then coalesce(s.fish_total, 0) when 'species' then v_species
                       when 'biggest_g' then coalesce(s.biggest_g, 0) when 'earned_total' then coalesce(s.earned_total, 0)
                       when 'farm_earned' then coalesce(s.farm_earned, 0) when 'fight_wins' then coalesce(s.fight_wins, 0)
                       when 'level' then v_level else 0 end >= c.goal
    on conflict do nothing
    returning achievement
  loop
    perform public._pg_reward(p_account, (select reward from public.achievement_catalog where id = a.achievement),
                              'achievement_reward', 'thành tựu ' || a.achievement);
    perform public._game_event(p_account, 'achievement', 1, jsonb_build_object('id', a.achievement));
  end loop;
end $$;
revoke all on function public._pg_check_achievements(uuid) from public, anon, authenticated;

-- Complete every fish collection whose species are all in the Fishdex.
create or replace function public._pg_check_collections(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare c record;
begin
  for c in
    insert into public.player_collections (account_id, collection)
    select p_account, k.id from public.collection_catalog k
     where exists (select 1 from public.fish_species f where f.rarity between k.rarity_min and k.rarity_max)
       and not exists (select 1 from public.fish_species f where f.rarity between k.rarity_min and k.rarity_max
                          and not exists (select 1 from public.player_fishdex d where d.account_id = p_account and d.species = f.id))
    on conflict do nothing
    returning collection
  loop
    perform public._pg_reward(p_account, (select reward from public.collection_catalog where id = c.collection),
                              'collection_reward', 'bộ sưu tập ' || c.collection);
    perform public._game_event(p_account, 'collection', 1, jsonb_build_object('id', c.collection));
  end loop;
end $$;
revoke all on function public._pg_check_collections(uuid) from public, anon, authenticated;

-- Add XP in a bucket (clamped by the bucket's daily cap); level-ups pay their rewards. Returns the XP really added.
create or replace function public._pg_add_xp(p_account uuid, p_bucket text, p_xp integer) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.player_progress; v_used integer; v_add integer; v_new integer; l integer;
begin
  if p_xp <= 0 then return 0; end if;
  r := public._pg_row(p_account);
  v_used := case p_bucket when 'fish' then r.xp_fish when 'earn' then r.xp_earn when 'fight' then r.xp_fight
                          when 'grant' then r.xp_grant else 0 end;
  v_add := greatest(0, least(p_xp, public._pg_cap(p_bucket) - v_used));
  if v_add = 0 then return 0; end if;
  v_new := public._pg_level_for(r.xp + v_add);
  update public.player_progress
     set xp = xp + v_add, level = v_new, updated_at = now(),
         xp_fish = xp_fish + case when p_bucket = 'fish' then v_add else 0 end,
         xp_earn = xp_earn + case when p_bucket = 'earn' then v_add else 0 end,
         xp_fight = xp_fight + case when p_bucket = 'fight' then v_add else 0 end,
         xp_grant = xp_grant + case when p_bucket = 'grant' then v_add else 0 end
   where account_id = p_account;
  if v_new > r.level then
    update public.characters set pg_level = v_new where account_id = p_account;
    for l in r.level + 1 .. v_new loop
      perform public._pg_reward(p_account, public._pg_level_reward(l), 'level_reward', 'lên cấp ' || l);
      perform public._game_event(p_account, 'level_up', l, '{}'::jsonb);
    end loop;
  end if;
  return v_add;
end $$;
revoke all on function public._pg_add_xp(uuid, text, integer) from public, anon, authenticated;

-- ---------- F. The subscriber ----------
create or replace function public._pg_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_species text; v_w integer; v_rarity integer; v_reason text; v_new_species boolean := false; v_kind text;
begin
  if new.kind not in ('fish_catch', 'earn', 'fight_win', 'fight_done', 'xp_grant') then return new; end if;
  begin
    insert into public.player_stats (account_id) values (new.account_id) on conflict (account_id) do nothing;
    if new.kind = 'fish_catch' then
      v_species := left(coalesce(new.meta->>'species', ''), 40);
      v_w := greatest(0, coalesce((new.meta->>'weight_g')::integer, 0));
      select rarity into v_rarity from public.fish_species where id = v_species;
      update public.player_stats
         set fish_total = fish_total + 1,
             biggest_species = case when v_w > biggest_g then v_species else biggest_species end,
             biggest_g = greatest(biggest_g, v_w)
       where account_id = new.account_id;
      if v_species <> '' then
        insert into public.player_fishdex (account_id, species, caught, best_g) values (new.account_id, v_species, 1, v_w)
        on conflict (account_id, species) do update set caught = player_fishdex.caught + 1,
                                                        best_g = greatest(player_fishdex.best_g, excluded.best_g)
        returning (xmax = 0) into v_new_species;
      end if;
      perform public._pg_add_xp(new.account_id, 'fish', 4 * coalesce(v_rarity, 1) + least(10, v_w / 500));
      if v_new_species then perform public._pg_check_collections(new.account_id); end if;
    elsif new.kind = 'earn' then
      v_reason := new.meta->>'reason';
      if not public._pg_work_reason(v_reason) then return new; end if;
      update public.player_stats
         set earned_total = earned_total + new.qty,
             farm_earned = farm_earned + case when v_reason in ('rice_sell', 'produce_sell') then new.qty else 0 end
       where account_id = new.account_id;
      perform public._pg_add_xp(new.account_id, 'earn', least(50, new.qty / 20));
    elsif new.kind = 'fight_win' then
      v_kind := coalesce(new.meta->>'kind', '');
      update public.player_stats set fight_wins = fight_wins + 1 where account_id = new.account_id;
      perform public._pg_add_xp(new.account_id, 'fight', case when v_kind = 'pvp' then 40 when v_kind = 'exam' then 25 else 30 end);
    elsif new.kind = 'fight_done' then
      perform public._pg_add_xp(new.account_id, 'fight', 5);
    elsif new.kind = 'xp_grant' then
      perform public._pg_add_xp(new.account_id, 'grant', least(500, greatest(0, new.qty)));
    end if;
    perform public._pg_check_achievements(new.account_id);
  exception when others then
    raise warning 'progression: % (%)', sqlerrm, new.kind;
  end;
  return new;
end $$;
revoke all on function public._pg_on_event() from public, anon, authenticated;
drop trigger if exists game_events_progression on public.game_events;
create trigger game_events_progression after insert on public.game_events for each row execute function public._pg_on_event();

-- Waypoint discovery from the server position (0057's accepted claims only; a refused claim never writes the row).
create or replace function public._pg_on_pos() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  begin
    insert into public.player_waypoints (account_id, waypoint)
    select new.account_id, w.id from public.waypoints w
     where w.map = new.map and (w.x - new.x) ^ 2 + (w.y - new.y) ^ 2 <= 160 ^ 2
    on conflict do nothing;
  exception when others then
    raise warning 'progression waypoints: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public._pg_on_pos() from public, anon, authenticated;
drop trigger if exists player_pos_waypoints on public.player_pos;
create trigger player_pos_waypoints after insert or update of map, x, y on public.player_pos
  for each row execute function public._pg_on_pos();

-- The anti-cheat wipe (0015/0052's _ac_wipe writes anticheat_wipes first): my rows and the account's event feed go too.
-- A trigger instead of re-creating _ac_wipe, so no other agent's copy of it is overwritten.
create or replace function public._pg_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.player_progress where account_id = new.account_id;
  delete from public.player_stats where account_id = new.account_id;
  delete from public.player_fishdex where account_id = new.account_id;
  delete from public.player_achievements where account_id = new.account_id;
  delete from public.player_collections where account_id = new.account_id;
  delete from public.player_waypoints where account_id = new.account_id;
  delete from public.game_events where account_id = new.account_id;
  update public.characters set pg_level = null, pg_title = null where account_id = new.account_id;
  delete from public.leaderboard_cache;
  return new;
end $$;
revoke all on function public._pg_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_progression on public.anticheat_wipes;
create trigger anticheat_wipes_progression after insert on public.anticheat_wipes
  for each row execute function public._pg_on_wipe();

-- ---------- G. Backfill (once: only accounts without stats yet) ----------
insert into public.player_fishdex (account_id, species, caught, best_g, first_at)
select pb.account_id, pb.species_id, 1, pb.weight_g, pb.caught_at from public.personal_bests pb
on conflict do nothing;
insert into public.player_stats (account_id, fish_total, biggest_g, biggest_species, earned_total, farm_earned, fight_wins)
select a.id,
       greatest((select count(*) from public.player_fishdex d where d.account_id = a.id), (select count(*) from public.fish f where f.account_id = a.id)),
       coalesce((select max(best_g) from public.player_fishdex d where d.account_id = a.id), 0),
       (select species from public.player_fishdex d where d.account_id = a.id order by best_g desc limit 1),
       coalesce((select sum(delta) from public.coin_ledger l where l.account_id = a.id and l.delta > 0 and public._pg_work_reason(l.reason)), 0),
       coalesce((select sum(delta) from public.coin_ledger l where l.account_id = a.id and l.delta > 0 and l.reason in ('rice_sell','produce_sell')), 0),
       coalesce((select count(*) from public.fight_matches m where m.status = 'done'
                   and ((m.winner = 1 and m.p1 = a.id) or (m.winner = 2 and m.p2 = a.id))), 0)
  from public.accounts a
on conflict (account_id) do nothing;

update public.characters c set pg_level = coalesce((select p.level from public.player_progress p where p.account_id = c.account_id), 1)
 where c.pg_level is null;

-- ---------- H. Read RPCs ----------
-- Everything the "Hồ sơ" panel shows.
create or replace function public.progress_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); r public.player_progress; s public.player_stats;
        v_species integer; v_at text; pp public.player_pos;
begin
  select * into r from public.player_progress where account_id = v_account;
  select * into s from public.player_stats where account_id = v_account;
  select count(*) into v_species from public.player_fishdex where account_id = v_account;
  select * into pp from public.player_pos where account_id = v_account;
  select w.id into v_at from public.waypoints w join public.player_waypoints pw on pw.waypoint = w.id and pw.account_id = v_account
   where pp.account_id is not null and w.map = pp.map and (w.x - pp.x) ^ 2 + (w.y - pp.y) ^ 2 <= 160 ^ 2
   order by (w.x - pp.x) ^ 2 + (w.y - pp.y) ^ 2 limit 1;
  return jsonb_build_object(
    'level', coalesce(r.level, 1), 'xp', coalesce(r.xp, 0), 'title', r.title,
    'today', jsonb_build_object(
      'fish', case when r.xp_day = public._vn_today() then r.xp_fish else 0 end,
      'earn', case when r.xp_day = public._vn_today() then r.xp_earn else 0 end,
      'fight', case when r.xp_day = public._vn_today() then r.xp_fight else 0 end,
      'grant', case when r.xp_day = public._vn_today() then r.xp_grant else 0 end),
    'stats', jsonb_build_object('fish_total', coalesce(s.fish_total, 0), 'species', v_species,
      'biggest_g', coalesce(s.biggest_g, 0), 'biggest_species', s.biggest_species,
      'earned_total', coalesce(s.earned_total, 0), 'farm_earned', coalesce(s.farm_earned, 0),
      'fight_wins', coalesce(s.fight_wins, 0), 'level', coalesce(r.level, 1)),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'descr', c.descr, 'stat', c.stat,
        'goal', c.goal, 'reward', c.reward, 'title', c.title, 'at', pa.at) order by c.sort_order)
      from public.achievement_catalog c
      left join public.player_achievements pa on pa.achievement = c.id and pa.account_id = v_account), '[]'::jsonb),
    'fishdex', coalesce((select jsonb_agg(jsonb_build_object('species', f.id, 'name', f.name, 'rarity', f.rarity,
        'caught', coalesce(d.caught, 0), 'best_g', coalesce(d.best_g, 0)) order by f.sort_order)
      from public.fish_species f left join public.player_fishdex d on d.species = f.id and d.account_id = v_account), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'reward', k.reward,
        'have', (select count(*) from public.fish_species f join public.player_fishdex d on d.species = f.id and d.account_id = v_account
                  where f.rarity between k.rarity_min and k.rarity_max),
        'total', (select count(*) from public.fish_species f where f.rarity between k.rarity_min and k.rarity_max),
        'at', pc.at) order by k.sort_order)
      from public.collection_catalog k
      left join public.player_collections pc on pc.collection = k.id and pc.account_id = v_account), '[]'::jsonb),
    'other', jsonb_build_object(
      'pets', jsonb_build_object('have', (select count(distinct species) from public.pets where account_id = v_account), 'total', 6),
      'outfits', jsonb_build_object('have', (select count(*) from public.account_items where account_id = v_account),
                                    'total', (select count(*) from public.item_catalog where not starter)),
      'crops', jsonb_build_object(
        'have', (select count(*) from public.rice_stock where account_id = v_account)
              + (select count(*) from public.produce_stock where account_id = v_account),
        'total', (select count(*) from public.rice_varieties) + (select count(*) from public.upland_crops))),
    'waypoints', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'map', w.map, 'min_level',
        greatest(w.min_level, coalesce(ml.min_level, 1)), 'found', pw.at is not null) order by w.sort_order)
      from public.waypoints w
      left join public.map_levels ml on ml.map = w.map
      left join public.player_waypoints pw on pw.waypoint = w.id and pw.account_id = v_account), '[]'::jsonb),
    'at_waypoint', v_at,
    'teleport_fee', 20,
    'map_levels', coalesce((select jsonb_object_agg(map, min_level) from public.map_levels), '{}'::jsonb));
end $$;
revoke all on function public.progress_state(text) from public;
grant execute on function public.progress_state(text) to anon, authenticated;

-- A leaderboard (top 20), cached 60 s. Boards: level, rich, fish, biggest, farmer, fights.
create or replace function public.progress_leaderboard(p_session_token text, p_board text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); c public.leaderboard_cache; v_rows jsonb;
begin
  if p_board not in ('level', 'rich', 'fish', 'biggest', 'farmer', 'fights') then
    raise exception 'bad board' using errcode = '22023';
  end if;
  select * into c from public.leaderboard_cache where board = p_board;
  if c.board is not null and c.at > now() - interval '60 seconds' then
    return jsonb_build_object('board', p_board, 'rows', c.rows, 'at', c.at, 'me', v_account);
  end if;
  with ranked as (
    select a.id, a.username,
           case p_board
             when 'level' then (select p.xp from public.player_progress p where p.account_id = a.id)
             when 'rich' then (select w.coins from public.wallets w where w.account_id = a.id)
             when 'fish' then (select s.fish_total from public.player_stats s where s.account_id = a.id)
             when 'biggest' then (select s.biggest_g from public.player_stats s where s.account_id = a.id)
             when 'farmer' then (select s.farm_earned from public.player_stats s where s.account_id = a.id)
             when 'fights' then (select s.fight_wins from public.player_stats s where s.account_id = a.id)
           end::bigint as v
      from public.accounts a where not a.is_banned
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.username, 'value', t.v,
           'level', coalesce(p.level, 1),
           'extra', case when p_board = 'biggest' then (select s.biggest_species from public.player_stats s where s.account_id = t.id) end)
           order by t.v desc, t.username), '[]'::jsonb)
    into v_rows
    from (select * from ranked where v > 0 order by v desc, username limit 20) t
    left join public.player_progress p on p.account_id = t.id;
  insert into public.leaderboard_cache (board, rows, at) values (p_board, v_rows, now())
  on conflict (board) do update set rows = excluded.rows, at = excluded.at;
  return jsonb_build_object('board', p_board, 'rows', v_rows, 'at', now(), 'me', v_account);
end $$;
revoke all on function public.progress_leaderboard(text, text) from public;
grant execute on function public.progress_leaderboard(text, text) to anon, authenticated;

-- ---------- I. Game RPCs ----------
-- Wear an unlocked title (an achievement id with a title), or none (null).
create or replace function public.progress_set_title(p_session_token text, p_achievement text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_title text;
begin
  if p_achievement is not null then
    select c.title into v_title from public.achievement_catalog c
      join public.player_achievements pa on pa.achievement = c.id and pa.account_id = v_account
     where c.id = p_achievement and c.title is not null;
    if v_title is null then raise exception 'title locked' using errcode = '22023'; end if;
  end if;
  perform public._pg_row(v_account);
  update public.player_progress set title = p_achievement, updated_at = now() where account_id = v_account;
  update public.characters set pg_title = v_title, pg_level = public._pg_level(v_account) where account_id = v_account;
  return public.progress_state(p_session_token);
end $$;
revoke all on function public.progress_set_title(text, text) from public;
grant execute on function public.progress_set_title(text, text) to anon, authenticated;

-- Fast travel from the waypoint I stand at (server position) to a discovered one.
create or replace function public.waypoint_travel(p_session_token text, p_to text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); pp public.player_pos; w public.waypoints; v_from text;
        r public.player_progress; v_coins integer; v_bal integer; c_fee constant integer := 20;
begin
  select * into w from public.waypoints where id = p_to;
  if w.id is null then raise exception 'bad waypoint' using errcode = '22023'; end if;
  select * into pp from public.player_pos where account_id = v_account for update;
  if pp.account_id is null then raise exception 'not at waypoint' using errcode = '22023'; end if;
  select x.id into v_from from public.waypoints x
    join public.player_waypoints pw on pw.waypoint = x.id and pw.account_id = v_account
   where x.map = pp.map and (x.x - pp.x) ^ 2 + (x.y - pp.y) ^ 2 <= 160 ^ 2
   order by (x.x - pp.x) ^ 2 + (x.y - pp.y) ^ 2 limit 1;
  if v_from is null then raise exception 'not at waypoint' using errcode = '22023'; end if;
  if v_from = w.id then raise exception 'same waypoint' using errcode = '22023'; end if;
  if not exists (select 1 from public.player_waypoints where account_id = v_account and waypoint = w.id) then
    raise exception 'waypoint unknown' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);   -- pos → wallet → progress (the trigger path takes wallet → progress too)
  r := public._pg_row(v_account);
  if r.level < w.min_level or not public._map_unlocked(v_account, w.map) then
    raise exception 'level too low' using errcode = '22023';
  end if;
  if r.tp_at is not null and r.tp_at > now() - interval '15 seconds' then
    raise exception 'too soon' using errcode = '22023';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < c_fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -c_fee, 'teleport', v_from || ' → ' || w.id);
  update public.player_progress set tp_at = now() where account_id = v_account;
  -- the server moves me: the next claim is judged from the target
  update public.player_pos set map = w.map, x = w.x, y = w.y, at = now() where account_id = v_account;
  perform public._game_event(v_account, 'teleport', c_fee, jsonb_build_object('from', v_from, 'to', w.id));
  return jsonb_build_object('ok', true, 'coins', v_bal, 'to', jsonb_build_object('id', w.id, 'map', w.map, 'x', w.x, 'y', w.y, 'dir', w.dir));
end $$;
revoke all on function public.waypoint_travel(text, text) from public;
grant execute on function public.waypoint_travel(text, text) to anon, authenticated;
