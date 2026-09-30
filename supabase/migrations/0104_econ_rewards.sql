-- =========================================================
-- 0104_econ_rewards.sql — Kinh tế v2, the fixed faucets (spec docs/superpowers/specs/2026-09-30-economy-v2-design.md §7):
-- rewards, progression, quests, bosses, the dungeon, pets, travel fees. ADDITIVE and re-runnable. Run after 0103 (it touches
-- none of 0101–0103's functions, so it also applies right after 0100). Every re-created function is its newest body
-- verbatim but for the lines marked "econ v2". No coin_ledger reason is added.
--   A. Bosses (R1, R2). The raid (Vua Heo Rừng) pool 1 600 → 1 200 (_boss_defs). A raid or a weather boss (Thủy Quái,
--      Người Tuyết) pays boss_reward for at most 2 kills per account per Vietnam day; past that the hitter still gets the
--      XP and the boss_kill event (_boss_payout; _boss_paid_group, _boss_paid_today count today's boss_reward rows). The
--      raid's 1-hour summon cooldown holds per member, not per party id (boss_summon keeps each summon's crew in
--      boss_fights.crew): a party disbanded and re-formed under a new id no longer summons again at once.
--   B. The dungeon (R3). Entry fee 150 → 100 (_dg_pay_fee). A clear pays each paid member with some damage and under 3
--      paid clears today (was 5) 50 + floor(250 × n × share), n = the members this clear pays and share = their part of
--      the damage (was 120 + floor(380 × share)): a party of equal hitters now earns what a solo run earns, per head,
--      for less work each. _dg_clears_today is the cap helper (the day's other clears, as 0075 counted them).
--   C. Progression (R4, R5, R9). Level reward 50·L (150·L every 5th) → 20·L (60·L); levels 1→99 pay 136 980 (was 342 450).
--      Daily grant-XP cap 3 000 → 1 500. Achievements level_30 10 000 → 3 000, earn_1m and win_500 20 000 → 5 000; what
--      was earned stays earned. "Earned by work" (_pg_work_reason, _pg_work_earn: earn XP, earned_total and the earn_*
--      achievements, the earn quests) no longer counts 'daily', 'login_reward', 'song', 'pet_find', nor a 'sell' row whose
--      ref starts with 'vehicle:' or 'fashion:' (ông Tám's buy-back, the fashion refund). A fight win counts for the
--      fight_wins stat (win_* achievements) and the win quests only when something was at stake (_pg_counted_win: a PvP
--      bout with a stake, or one of a staked 2v2 arena series, an underground fight, a dojo exam); a friendly 0-stake
--      bout still earns its fight XP.
--   D. Quests (R5, R6, R9, R11). The company quest pays a pool of 3 000 xu per completion (company_pool.reward_coins),
--      split pro rata by contribution: a contributor with ≥ 1 % of the goal gets floor(3 000 × mine / total), at most
--      300, and the quest's XP; under 1 %, nothing (their row is closed at completion) — _company_share,
--      quest_company_claim, _quest_on_event. The farm dailies ask the farm's real numbers: d_rice 100 → 5 000 xu,
--      d_produce 80 → 5 000, d_critter 40 → 300 (rewards unchanged).
--   E. Pets (R7, R8). The sóc forages 150 xu a day at most (was 300) and only while its owner moves: each pet_tick samples
--      the server position (pet_owner.forage_pos) and a change within 5 minutes counts as moving (pet_owner.moved_at);
--      otherwise the answer says idle 'afk'. Pet / fish PvE: 5 paid wins a day (was 10, _pv2 'pve_paid'), prizes × 0.6
--      (pet_npc_catalog 24 / 42 / 54 / 90 / 150 / 270); pet / fish PvP: the winner takes the pot less 5 % (was 10 %).
--   F. Travel (R10). Teleport (waypoint_travel; progress_state's 'teleport_fee') and xe ôm (skip_trip) 20 → 50 xu.
-- lib/** mirrors: progression/model.ts, quests/model.ts, realm/model.ts (bosses, dungeon), pets/model.ts, catalog.ts,
-- v2.ts, travel/vehicles.ts; tests/unit/econ-rewards.test.ts pins them to this file.
-- =========================================================

-- ---------- A. Bosses ----------
alter table public.boss_fights add column if not exists crew uuid[];                -- the raid's summoning party, by member

-- _boss_defs (0075_world_bosses.sql's, verbatim but for the lines marked econ v2)
create or replace function public._boss_defs() returns table (id text, name text, kind text, map text, ax integer, ay integer,
                                                              aw integer, ah integer, hp integer, cap_pct integer, pool integer,
                                                              dur_min integer, xp integer)
language sql immutable parallel safe
as $$
  values ('trau_tinh',   'Trâu Tinh',    'world',   'bai_dat', 316, 60, 168, 316, 40000, 20, 3000, 30, 120),
         ('soi_ma',      'Sói Ma',       'night',   'bai_dat', 316, 60, 168, 316, 30000, 25, 2000, 30, 100),
         ('heo_rung',    'Vua Heo Rừng', 'raid',    'bai_dat', 316, 60, 168, 316, 24000, 25, 1200, 20,  90),   -- econ v2: pool 1 600 → 1 200
         ('thuy_quai',   'Thủy Quái',    'weather', 'pond',    490, 60, 140, 300, 15000, 34,  900, 20,  70),
         ('nguoi_tuyet', 'Người Tuyết',  'snow',    'pond',    490, 60, 140, 300, 15000, 34,  900, 20,  70)
$$;


-- Which daily paid-kill cap a boss falls under: 'raid' (Vua Heo Rừng), 'weather' (Thủy Quái, Người Tuyết), null (the
-- scheduled world and night bosses: no cap).
create or replace function public._boss_paid_group(p_boss text) returns text
language sql immutable parallel safe set search_path = public, extensions
as $$
  select case (select d.kind from public._boss_defs() d where d.id = p_boss)
           when 'raid' then 'raid' when 'weather' then 'weather' when 'snow' then 'weather' end
$$;

-- The account's boss_reward payments of today (Vietnam day) for the bosses of a group (the ledger's ref is the boss name).
create or replace function public._boss_paid_today(p_account uuid, p_group text) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select count(*)::integer from public.coin_ledger l
   where l.account_id = p_account and l.reason = 'boss_reward' and l.created_at >= public._vn_day_start()
     and l.ref in (select d.name from public._boss_defs() d where public._boss_paid_group(d.id) = p_group)
$$;

-- _boss_payout (0075_world_bosses.sql's, verbatim but for the lines marked econ v2)
create or replace function public._boss_payout(p_fight bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.boss_fights; d record; v_total numeric; r record; v_share numeric; v_coins integer; v_xp integer;
        v_grp text;                                                                              -- econ v2
begin
  select * into f from public.boss_fights where id = p_fight;
  select * into d from public._boss_defs() where id = f.boss;
  v_grp := public._boss_paid_group(f.boss);                                                      -- econ v2: raid | weather | null
  select sum(dmg) into v_total from public.boss_hits where fight_id = p_fight;
  if coalesce(v_total, 0) <= 0 then return; end if;
  for r in select account_id, dmg from public.boss_hits where fight_id = p_fight and dmg > 0 order by account_id loop
    v_share := r.dmg / v_total;
    v_coins := 0;
    if r.dmg * 100 >= f.max_hp then
      perform public._wallet_lock(r.account_id);                                                 -- econ v2: before the day's count (was below)
      -- econ v2: a raid or a weather boss pays an account for 2 kills a Vietnam day; after that, the XP only
      if v_grp is null or public._boss_paid_today(r.account_id, v_grp) < 2 then                  -- econ v2
        v_coins := greatest(20, floor(d.pool * v_share)::int) + case when r.account_id = f.killer then d.pool / 20 else 0 end;
        perform public._pay(r.account_id, v_coins, 'boss_reward', d.name);
      end if;                                                                                    -- econ v2
    end if;
    v_xp := round(d.xp * (0.25 + 0.75 * least(1, r.dmg::numeric * 100 / (f.max_hp * d.cap_pct))))::int;
    perform public._game_event(r.account_id, 'xp_grant', v_xp, jsonb_build_object('source', 'boss'));
    perform public._game_event(r.account_id, 'boss_kill', 1,
      jsonb_build_object('boss', f.boss, 'fight', f.id, 'dmg', r.dmg, 'coins', v_coins, 'killer', r.account_id = f.killer));
  end loop;
end $$;

-- boss_summon (0075_world_bosses.sql's, verbatim but for the lines marked econ v2)
create or replace function public.boss_summon(p_session_token text, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; v_party bigint; d record; v_in integer;
        v_crew uuid[];                                                                           -- econ v2
begin
  v_acc := public._ac_account(p_session_token);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'boss_summon', null, 'not in arena');
  if v_ac is not null then return v_ac; end if;
  select * into d from public._boss_defs() where id = 'heo_rung';
  perform pg_advisory_xact_lock(hashtext('boss:heo_rung'));
  select count(*) into v_in from public.party_members m join public.player_pos pp on pp.account_id = m.account_id
   where m.party_id = v_party and pp.map = d.map and pp.at > now() - interval '2 minutes'
     and pp.x between d.ax - 16 and d.ax + d.aw + 16 and pp.y between d.ay - 16 and d.ay + d.ah + 16;
  if not exists (select 1 from public.player_pos pp where pp.account_id = v_acc and pp.map = d.map
                    and pp.x between d.ax - 16 and d.ax + d.aw + 16 and pp.y between d.ay - 16 and d.ay + d.ah + 16) then
    raise exception 'not in arena' using errcode = '22023';
  end if;
  if v_in < 3 then raise exception 'need 3' using errcode = '53400'; end if;
  if exists (select 1 from public.boss_fights where boss = 'heo_rung' and status = 'up' and ends_at > now()) then
    raise exception 'raid up' using errcode = '53400';
  end if;
  -- econ v2: once an hour per member, not per party id (disbanding and re-forming under a new id reset the old cooldown)
  v_crew := array(select m.account_id from public.party_members m where m.party_id = v_party order by m.account_id);   -- econ v2
  if exists (select 1 from public.boss_fights where boss = 'heo_rung' and slot > now() - interval '1 hour'
                and (party_id = v_party or crew && v_crew)) then                                   -- econ v2 (was: party_id = v_party only)
    raise exception 'too soon' using errcode = '53400';
  end if;
  insert into public.boss_fights (boss, slot, announce_at, starts_at, ends_at, hp, max_hp, party_id, crew)   -- econ v2: + crew
  values ('heo_rung', now(), now(), now() + interval '20 seconds', now() + interval '20 seconds' + make_interval(mins => d.dur_min),
          d.hp, d.hp, v_party, v_crew);                                                              -- econ v2: + v_crew
  return jsonb_build_object('ok', true);
end $$;

-- ---------- B. The dungeon ----------
-- _dg_pay_fee (0075_world_bosses.sql's, verbatim but for the lines marked econ v2)
create or replace function public._dg_pay_fee(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if (public._wallet_lock(p_account)).coins < 100 then raise exception 'insufficient funds' using errcode = '22023'; end if;   -- econ v2: 150 → 100
  perform public._pay(p_account, -100, 'dungeon_entry', 'Hầm ngục');                              -- econ v2: 150 → 100
end $$;


-- The dungeon cap helper: the account's cleared runs of today (Vietnam day) other than p_except (0075's count, which the
-- run's panel shows as clears_today). A clear pays only while this is under 3.
create or replace function public._dg_clears_today(p_account uuid, p_except bigint) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select count(*)::integer from public.dungeon_members dm join public.dungeon_runs r on r.id = dm.run_id
   where dm.account_id = p_account and r.status = 'cleared' and r.id is distinct from p_except
     and (r.ended_at at time zone 'Asia/Ho_Chi_Minh')::date = public._vn_today()
$$;

-- _dg_payout (0075_world_bosses.sql's, verbatim but for the lines marked econ v2)
create or replace function public._dg_payout(p_run bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_total numeric; m record; v_share numeric; v_coins integer; v_done integer;
        v_paid integer;                                                                          -- econ v2
begin
  select sum(dmg) into v_total from public.dungeon_members where run_id = p_run;
  -- econ v2: the members this clear pays (the fee paid, some damage, under 3 paid clears today) — 250 xu each into the pot
  select count(*) into v_paid from public.dungeon_members dm
   where dm.run_id = p_run and dm.paid > 0 and dm.dmg > 0 and public._dg_clears_today(dm.account_id, p_run) < 3;   -- econ v2
  for m in select account_id, dmg, paid from public.dungeon_members where run_id = p_run order by account_id loop
    v_share := case when coalesce(v_total, 0) > 0 then m.dmg / v_total else 0 end;
    v_done := public._dg_clears_today(m.account_id, p_run);                                       -- econ v2 (the same count)
    v_coins := 0;
    if m.paid > 0 and m.dmg > 0 and v_done < 3 then                                             -- econ v2: 3 paid clears a day (was 5)
      v_coins := 50 + floor(250 * v_paid * v_share)::int;                                        -- econ v2 (was 120 + floor(380 * v_share))
      perform public._wallet_lock(m.account_id);
      perform public._pay(m.account_id, v_coins, 'dungeon_reward', 'Hầm ngục');
      if random() < 0.25 then
        insert into public.wild_bag (account_id, item, qty) values (m.account_id, 'da_soi', 1)
        on conflict (account_id, item) do update set qty = public.wild_bag.qty + 1;
      end if;
    end if;
    if m.dmg > 0 then
      perform public._game_event(m.account_id, 'xp_grant', 60 + round(140 * v_share)::int, jsonb_build_object('source', 'dungeon'));
      perform public._game_event(m.account_id, 'boss_kill', 1, jsonb_build_object('boss', 'doi_chua', 'dungeon', true, 'dmg', m.dmg));
    end if;
    perform public._game_event(m.account_id, 'dungeon_clear', 1, jsonb_build_object('run', p_run, 'dmg', m.dmg, 'coins', v_coins));
  end loop;
end $$;

-- ---------- C. Progression ----------
-- _pg_level_reward (0070_progression.sql's, verbatim but for the lines marked econ v2)
create or replace function public._pg_level_reward(p_level integer) returns integer
language sql immutable parallel safe
as $$ select case when p_level % 5 = 0 then 60 * p_level else 20 * p_level end $$;         -- econ v2: was 150 / 50

-- _pg_cap (0070_progression.sql's, verbatim but for the lines marked econ v2)
create or replace function public._pg_cap(p_bucket text) returns integer
language sql immutable parallel safe
as $$ select case p_bucket when 'fish' then 1500 when 'earn' then 400 when 'fight' then 400 when 'grant' then 1500 else 0 end $$;   -- econ v2: grant 3 000 → 1 500

-- _pg_work_reason (0070_progression.sql's, verbatim but for the lines marked econ v2)
create or replace function public._pg_work_reason(p_reason text) returns boolean
language sql immutable parallel safe
as $$ select p_reason in ('sell','rice_sell','produce_sell','critter_sell','rat_sell','ore_sell','gem_sell','wild_sell') $$;
-- econ v2: 'song', 'daily', 'login_reward' and 'pet_find' are rewards, not work


-- An 'earn' event (qty = the ledger row's delta) that counts as work: a work reason, and not a resale of a vehicle or of
-- fashion (their 'sell' rows carry the ref 'vehicle: …' / 'fashion: …'). The event only carries the reason, so the row is
-- the account's newest 'sell' row of this transaction with that delta (the ledger trigger emits the event right after it).
create or replace function public._pg_work_earn(p_account uuid, p_reason text, p_qty integer) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select public._pg_work_reason(p_reason)
     and (p_reason is distinct from 'sell' or not coalesce((
           select l.ref like 'vehicle:%' or l.ref like 'fashion:%'
             from public.coin_ledger l
            where l.account_id = p_account and l.created_at = now() and l.reason = 'sell' and l.delta = p_qty
            order by l.id desc limit 1), false))
$$;

-- A fight win that counts (the fight_wins stat, the win_* achievements, the win quests): something was at stake — a PvP
-- bout with a stake or one of a staked 2v2 arena series (0071's bouts list), an underground fight (entry or rating),
-- a dojo exam (a fee, once per belt). A friendly 0-stake bout does not (it can be repeated with a friend at no cost).
create or replace function public._pg_counted_win(p_meta jsonb) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when coalesce(p_meta->>'match', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then coalesce((
      select m.kind <> 'pvp' or m.stake > 0
          or exists (select 1 from public.arena_series s
                      where s.stake > 0 and s.bouts @> jsonb_build_array(jsonb_build_object('match', m.id)))
        from public.fight_matches m where m.id = (p_meta->>'match')::uuid), false)
    else coalesce(p_meta->>'kind', 'pvp') <> 'pvp' end
$$;

-- _pg_on_event (0078_v21_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public._pg_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_species text; v_w integer; v_rarity integer; v_reason text; v_new_species boolean := false; v_kind text;
begin
  if new.kind not in ('fish_catch', 'earn', 'fight_win', 'fight_done', 'xp_grant') then return new; end if;
  begin
    perform public._wallet_lock(new.account_id);   -- 0078: wallet → progress rows (a reward may pay), as the earn path
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
      if not public._pg_work_earn(new.account_id, v_reason, new.qty) then return new; end if;   -- econ v2 (was _pg_work_reason(v_reason))
      update public.player_stats
         set earned_total = earned_total + new.qty,
             farm_earned = farm_earned + case when v_reason in ('rice_sell', 'produce_sell') then new.qty else 0 end
       where account_id = new.account_id;
      perform public._pg_add_xp(new.account_id, 'earn', least(50, new.qty / 20));
    elsif new.kind = 'fight_win' then
      v_kind := coalesce(new.meta->>'kind', '');
      if public._pg_counted_win(new.meta) then                                             -- econ v2: a friendly bout keeps its XP only
        update public.player_stats set fight_wins = fight_wins + 1 where account_id = new.account_id;
      end if;                                                                             -- econ v2
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


-- Achievements: the three largest rewards shrink; a fight win needs something at stake (the text says so).
update public.achievement_catalog c set reward = v.reward, descr = v.descr
  from (values ('level_30', 3000, 'Đạt cấp 30'),
               ('earn_1m',  5000, 'Kiếm 1 000 000 xu bằng sức lao động'),
               ('win_1',     100, 'Thắng 1 trận đấu võ có cược, ở Hầm đấu ngầm hoặc thi lên đai'),
               ('win_50',   2000, 'Thắng 50 trận đấu võ có cược, ở Hầm đấu ngầm hoặc thi lên đai'),
               ('win_500',  5000, 'Thắng 500 trận đấu võ có cược, ở Hầm đấu ngầm hoặc thi lên đai')) v(id, reward, descr)
 where c.id = v.id and (c.reward, c.descr) is distinct from (v.reward, v.descr);

-- ---------- D. Quests ----------
-- The farm dailies ask the farm's real numbers (a harvest sells for tens of thousands; a gathering round ≈ 300 xu); the win
-- quests need a win with something at stake. Rewards unchanged.
update public.quest_defs q set goal = v.goal, descr = v.descr
  from (values ('d_rice',    5000, 'Kiếm 5 000 xu từ bán lúa gạo.'),
               ('d_produce', 5000, 'Kiếm 5 000 xu từ bán nông sản.'),
               ('d_critter',  300, 'Kiếm 300 xu từ bán cua, ốc.'),
               ('w_win5',       5, 'Thắng 5 trận có cược, ở Hầm đấu ngầm hoặc thi lên đai.'),
               ('n_lang_6',     2, 'Thắng 2 trận có cược, ở Hầm đấu ngầm hoặc thi lên đai.')) v(id, goal, descr)
 where q.id = v.id and (q.goal, q.descr) is distinct from (v.goal, v.descr);

-- The company quest: a pool of 3 000 per completion (the goals already open or done-but-unclaimed take it too), and the
-- contributors under 1 % of a finished goal have nothing to claim.
update public.company_pool set reward_coins = 3000 where reward_coins <> 3000;
update public.company_quests q set reward_coins = 3000
 where q.reward_coins <> 3000
   and (q.status = 'open' or exists (select 1 from public.company_contrib k where k.quest_id = q.id and k.claimed_at is null));
update public.company_contrib k set claimed_at = now()
  from public.company_quests q
 where q.id = k.quest_id and q.status = 'done' and k.claimed_at is null and k.qty * 100 < q.goal;

-- A contributor's share of a company goal's pool: floor(pool × mine / total) when mine ≥ 1 % of the goal, at most 300.
-- total = everyone's contribution (≥ the goal once done: the last one may pass it), so the shares never exceed the pool.
create or replace function public._company_share(p_quest bigint, p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((
    select case when k.qty * 100 < q.goal then 0
                else least(300, floor(q.reward_coins::numeric * k.qty
                                      / greatest(q.goal, (select sum(x.qty) from public.company_contrib x where x.quest_id = q.id)))::integer) end
      from public.company_quests q join public.company_contrib k on k.quest_id = q.id and k.account_id = p_account
     where q.id = p_quest), 0)
$$;

-- _quest_on_event (0078_v21_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public._quest_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare d record; v_q integer; v_day date := public._vn_today(); v_per text; c public.company_quests;
        v_used integer;                                                                  -- 0078
begin
  begin
    -- econ v2 { a friendly win and an earning that is not work (a reward, a vehicle or fashion resale) move no quest
    if new.kind = 'fight_win' and not public._pg_counted_win(new.meta) then return new; end if;
    if new.kind = 'earn' and not public._pg_work_earn(new.account_id, new.meta->>'reason', new.qty) then return new; end if;
    -- econ v2 }
    for d in select q.* from public.quest_defs q where q.kind = new.kind and q.active and new.meta @> q.filter loop
      v_q := case when d.use_qty then greatest(new.qty, 0) else 1 end;
      continue when v_q = 0;
      if d.cat in ('daily', 'weekly') then
        continue when d.id not in (select public._quest_offer(d.cat, v_day));
      end if;
      v_per := public._quest_period(d.cat, v_day);
      if d.cat = 'npc' then
        update public.quest_progress
           set progress = least(d.goal, progress + v_q),
               done_at = case when progress + v_q >= d.goal then now() end
         where account_id = new.account_id and quest_id = d.id and period = '' and done_at is null;
      else
        insert into public.quest_progress as p (account_id, quest_id, period, progress, done_at)
        values (new.account_id, d.id, v_per, least(d.goal, v_q), case when v_q >= d.goal then now() end)
        on conflict (account_id, quest_id, period) do update
          set progress = least(d.goal, p.progress + v_q),
              done_at = coalesce(p.done_at, case when p.progress + v_q >= d.goal then now() end);
      end if;
    end loop;

    select * into c from public.company_quests
     where status = 'open' and kind = new.kind and new.meta @> filter for update;
    if found then
      v_q := case when c.use_qty then greatest(new.qty, 0) else 1 end;
      -- 0078 {
      -- one account adds at most a tenth of the goal per Vietnam day
      insert into public.company_contrib (quest_id, account_id, qty, day, day_qty) values (c.id, new.account_id, 0, v_day, 0)
      on conflict (quest_id, account_id) do nothing;
      select case when k.day = v_day then k.day_qty else 0 end into v_used
        from public.company_contrib k where k.quest_id = c.id and k.account_id = new.account_id for update;
      v_q := least(v_q, greatest(0, greatest(1, c.goal / 10) - coalesce(v_used, 0)));
      -- 0078 }
      if v_q > 0 then
        insert into public.company_contrib as k (quest_id, account_id, qty) values (c.id, new.account_id, v_q)
        on conflict (quest_id, account_id) do update set qty = k.qty + v_q,
          day = v_day, day_qty = case when k.day = v_day then k.day_qty else 0 end + v_q;              -- 0078
        update public.company_quests set progress = least(goal, progress + v_q),
               status = case when progress + v_q >= goal then 'done' else 'open' end,
               done_at = case when progress + v_q >= goal then now() end
         where id = c.id;
        if c.progress + v_q >= c.goal then
          perform public._company_next(c.seq);
          -- econ v2: the pool is shared by the contributors with ≥ 1 % of the goal; the others have nothing to claim
          update public.company_contrib set claimed_at = now()
           where quest_id = c.id and claimed_at is null and qty * 100 < c.goal;                -- econ v2
        end if;                                                                                -- econ v2
      end if;
    end if;
  exception when others then
    -- a quest must never break the gameplay RPC that emitted the event
    raise warning '_quest_on_event: % (%)', sqlerrm, new.kind;
  end;
  return new;
end $$;

-- quest_company_claim (0078_v21_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public.quest_company_claim(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); r record; v_paid integer := 0; v_xp integer := 0;
        v_coins integer;                                                                        -- econ v2
begin
  perform public._wallet_lock(v_account);
  for r in select q.id, q.reward_coins, q.reward_xp from public.company_quests q
             join public.company_contrib x on x.quest_id = q.id
            where q.status = 'done' and x.account_id = v_account and x.qty > 0 and x.claimed_at is null
              and x.qty * 100 >= q.goal                                                          -- econ v2: ≥ 1 % of the goal
            order by q.id limit 20                                                      -- 0078: a bounded claim
            for update of x loop
    update public.company_contrib set claimed_at = now() where quest_id = r.id and account_id = v_account;
    v_coins := public._company_share(r.id, v_account);                                          -- econ v2: the pool pro rata, ≤ 300
    if v_coins > 0 then perform public._pay(v_account, v_coins, 'quest_reward', 'company:' || r.id); end if;   -- econ v2 (was r.reward_coins)
    if r.reward_xp > 0 then
      perform public._game_event(v_account, 'xp_grant', r.reward_xp, jsonb_build_object('source', 'quest', 'company', r.id));
    end if;
    perform public._game_event(v_account, 'quest_done', 1, jsonb_build_object('cat', 'company', 'quest', r.id::text));
    v_paid := v_paid + v_coins; v_xp := v_xp + r.reward_xp;                                      -- econ v2 (was + r.reward_coins)
  end loop;
  if v_paid = 0 and v_xp = 0 then raise exception 'nothing to claim' using errcode = '22023'; end if;
  return public._quest_state(v_account) || jsonb_build_object('paid', v_paid, 'xp', v_xp,
    'coins', (select coins from public.wallets where account_id = v_account));
end $$;

-- ---------- E. Pets ----------
alter table public.pet_owner add column if not exists forage_pos text;          -- the server position at the last pet_tick
alter table public.pet_owner add column if not exists moved_at timestamptz;     -- the last pet_tick that saw it change

-- pet_tick (0066_pet_song.sql's, verbatim but for the lines marked econ v2)
create or replace function public.pet_tick(p_session_token text, p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets; o public.pet_owner;
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_n int := 0; v_done int; v_bal int;
        v_idle text; v_beat timestamptz;
        v_pos text; v_moved timestamptz;                                                          -- econ v2
begin
  -- live: the newest accepted position claim or vitals_tick within 90 s, in a room I belong to
  v_beat := greatest((select at from public.player_pos where account_id = v_account),
                     (select last_seen from public.heat_state where account_id = v_account));
  if p_room_id is null or not exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = v_account) then
    v_idle := 'not_member';
  elsif v_beat is null or v_beat < now() - interval '90 seconds' then
    v_idle := 'no_heartbeat';
  end if;
  p := public._pet_following(v_account);
  if v_idle is null and p.id is not null and p.species = 'soc' and p.happy > 50 then
    select * into o from public.pet_owner where account_id = v_account for update;
    -- econ v2 { the sóc forages only while its owner moves: each tick samples the server position, and a change seen
    -- within 5 minutes is moving (a tab left open beats with vitals_tick only; a hammock or a fixed spot does not move)
    v_pos := (select pp.map || ':' || pp.x || ':' || pp.y from public.player_pos pp where pp.account_id = v_account);
    v_moved := case when o.forage_pos is not null and v_pos is distinct from o.forage_pos then now() else o.moved_at end;
    if v_pos is distinct from o.forage_pos or v_moved is distinct from o.moved_at then
      update public.pet_owner set forage_pos = v_pos, moved_at = v_moved where account_id = v_account;
    end if;
    if v_moved is null or v_moved < now() - interval '5 minutes' then v_idle := 'afk'; end if;
    -- econ v2 }
    v_done := case when o.forage_day = v_today then o.forage_today else 0 end;
    if v_idle is null and (o.forage_at is null or o.forage_at <= now() - interval '10 minutes') and v_done < 150 then   -- econ v2: moving; 150 a day (was 300)
      v_n := least(150 - v_done, 5 + floor(random() * 26)::int);                                  -- econ v2: was 300 - v_done
      perform public._wallet_lock(v_account);
      v_bal := public._pay(v_account, v_n, 'pet_find', 'soc');
      update public.pet_owner set forage_at = now(), forage_day = v_today, forage_today = v_done + v_n
       where account_id = v_account;
    end if;
  end if;
  perform public._ac_stats_maybe();
  return public._pets_state(v_account) || jsonb_build_object('found', v_n)
         || case when v_bal is not null then jsonb_build_object('coins', v_bal) else '{}'::jsonb end
         || case when v_idle is not null then jsonb_build_object('idle', v_idle) else '{}'::jsonb end;
end $$;

-- _pv2 (0074_pets_aquarium.sql's, verbatim but for the lines marked econ v2)
create or replace function public._pv2(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case p_what
    when 'gacha_price' then 1500 when 'pity' then 40 when 'max_pets' then 12 when 'max_level' then 50
    when 'day_xp' then 300 when 'max_fish' then 6 when 'fish_rarity' then 3 when 'pve_day' then 40
    when 'pve_paid' then 5 when 'max_stake' then 1000 when 'max_decor' then 4 when 'max_turns' then 30 end
$$;                                                                          -- econ v2: pve_paid 10 → 5


-- PvE prizes × 0.6 (the NPCs themselves are 0074's).
insert into public.pet_npc_catalog (id, name, kind, species, variant, level, hp, atk, def, spd, skills, reward, sort_order) values
  ('meo_hoang', 'Mèo hoang', 'wild', 'meo', 'den', 3, 60, 12, 9, 12, '{tackle,bite}', 24, 1),
  ('cho_co', 'Chó cỏ', 'wild', 'cho', 'vang', 6, 80, 15, 12, 11, '{tackle,bite,guard}', 42, 2),
  ('soc_nui', 'Sóc núi', 'wild', 'soc', 'do', 9, 85, 17, 12, 18, '{tackle,bite,guard}', 54, 3),
  ('thay_tu', 'Thầy Tư', 'trainer', 'cho', 'nau', 14, 120, 22, 17, 14, '{tackle,bite,guard,heal}', 90, 4),
  ('co_bay', 'Cô Bảy', 'trainer', 'vet', 'lam', 22, 160, 30, 22, 22, '{tackle,bite,heal,fury}', 150, 5),
  ('ho_than', 'Hổ thần', 'wild', 'meo', 'cam', 32, 240, 42, 32, 20, '{bite,fury,guard,heal}', 270, 6)
on conflict (id) do update set reward = excluded.reward;

-- _battle_finish (0078_v21_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public._battle_finish(p_id bigint, p_winner smallint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.pet_battles; s int; v_acc uuid; v_f jsonb; v_won boolean; v_reason text; v_xp int; v_npc public.pet_npc_catalog;
        o public.pet_owner; v_today date := public._vn_today(); v_reward int := 0; v_wins int;
        v_rewarded boolean := true;                                                          -- 0078
begin
  select * into b from public.pet_battles where id = p_id for update;
  if not found or b.status = 'done' then return; end if;
  if b.npc is not null then select * into v_npc from public.pet_npc_catalog where id = b.npc; end if;
  -- 0078 {
  -- PvP XP only for a contested battle (two turns resolved: turn ≥ 3), at most 3 a day for the pair and 10 a day for
  -- each side (the stakes still settle); a quick forfeit between friends earns nothing
  if b.mode = 'pvp' then
    v_rewarded := b.turn >= 3
      and (select count(*) from public.pet_battles x
            where x.mode = 'pvp' and x.status = 'done' and x.rewarded and x.finished_at >= public._vn_day_start()
              and ((x.p1 = b.p1 and x.p2 = b.p2) or (x.p1 = b.p2 and x.p2 = b.p1))) < 3
      and (select count(*) from public.pet_battles x
            where x.mode = 'pvp' and x.status = 'done' and x.rewarded and x.finished_at >= public._vn_day_start()
              and (x.p1 = b.p1 or x.p2 = b.p1)) < 10
      and (select count(*) from public.pet_battles x
            where x.mode = 'pvp' and x.status = 'done' and x.rewarded and x.finished_at >= public._vn_day_start()
              and (x.p1 = b.p2 or x.p2 = b.p2)) < 10;
  end if;
  -- 0078 }
  for s in 1..2 loop
    v_acc := case s when 1 then b.p1 else b.p2 end;
    v_f := case s when 1 then b.f1 else b.f2 end;
    continue when v_acc is null or v_f is null or v_f->>'kind' not in ('pet','fish');
    v_won := p_winner = s;
    v_reason := case v_f->>'kind' when 'pet' then 'pet_battle' else 'fish_battle' end;
    v_xp := case when b.mode = 'pve' then case when v_won then 10 + v_npc.level else 4 end
                 else case when v_won then 30 else 10 end end;
    if v_rewarded then perform public._fighter_gain_xp(v_f->>'kind', (v_f->>'id')::bigint, v_xp); end if;   -- 0078
    if b.mode = 'pve' and v_won then
      perform public._wallet_lock(v_acc);
      o := public._pet_owner_row(v_acc);
      v_wins := case when o.battle_day = v_today then o.wins_today else 0 end;
      if v_wins < public._pv2('pve_paid') then
        v_reward := v_npc.reward;
        perform public._pay(v_acc, v_reward, v_reason, 'pve ' || b.npc || ' #' || b.id);
      end if;
      update public.pet_owner set battle_day = v_today, wins_today = v_wins + 1,
        battles_today = case when o.battle_day = v_today then o.battles_today else 0 end
       where account_id = v_acc;
    elsif b.mode = 'pvp' and b.stake > 0 then
      if p_winner = 0 then
        perform public._wallet_lock(v_acc);
        perform public._pay(v_acc, b.stake, v_reason, 'pvp refund #' || b.id);
      elsif v_won then
        v_reward := 2 * b.stake - (2 * b.stake) / 20;                                   -- econ v2: the pot less 5 % (was / 10)
        perform public._wallet_lock(v_acc);
        perform public._pay(v_acc, v_reward, v_reason, 'pvp win #' || b.id);
      end if;
    end if;
    if v_won and v_rewarded then                                                                            -- 0078
      perform public._game_event(v_acc, case v_f->>'kind' when 'pet' then 'pet_battle_win' else 'fish_battle_win' end, 1,
                                 jsonb_build_object('mode', b.mode, 'npc', b.npc));
      perform public._game_event(v_acc, 'xp_grant', case b.mode when 'pve' then 15 else 25 end, '{"source":"pet"}'::jsonb);
    end if;
    if v_rewarded then                                                                                      -- 0078
      perform public._game_event(v_acc, 'pet_battle_done', 1, jsonb_build_object('mode', b.mode, 'won', v_won, 'kind', v_f->>'kind'));
    end if;                                                                                                 -- 0078
  end loop;
  update public.pet_battles set status = 'done', winner = p_winner, reward = v_reward, a1 = null, a2 = null,
    finished_at = now(), rewarded = v_rewarded where id = p_id;                                              -- 0078
end $$;

-- ---------- F. Travel ----------
-- waypoint_travel (0070_progression.sql's, verbatim but for the lines marked econ v2)
create or replace function public.waypoint_travel(p_session_token text, p_to text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); pp public.player_pos; w public.waypoints; v_from text;
        r public.player_progress; v_coins integer; v_bal integer; c_fee constant integer := 50;   -- econ v2: 20 → 50
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

-- skip_trip (0090_dual_mode.sql's, verbatim but for the lines marked econ v2)
create or replace function public.skip_trip(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins int; v_bal int;
begin
  v_account := public._auth_account(p_session_token);
  if public._app_flag('unified_world')                                                   -- 0089: vehicles ride the roads;
     and (select public._pos_mode_of(p.tabs, p.mode, public._pos_tab()) from public.player_pos p
           where p.account_id = v_account) = 'w' then                                    -- 0090: only in the world (3D)
    raise exception 'no road trips' using errcode = '22023';                             -- 0089: fast travel = waypoints
  end if;                                                                                -- 0089
  update public.player_pos set skip_at = now() where account_id = v_account;   -- 0057: the road may take no time (before the wallet: the lock order)
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < 50 then raise exception 'insufficient funds' using errcode = '22023'; end if;   -- econ v2: 20 → 50
  v_bal := public._pay(v_account, -50, 'skip', 'xe om');                                        -- econ v2: 20 → 50
  return jsonb_build_object('coins', v_bal);
end; $$;

-- progress_state (0070_progression.sql's, verbatim but for the lines marked econ v2)
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
    'teleport_fee', 50,                                                                 -- econ v2: waypoint_travel's fee
    'map_levels', coalesce((select jsonb_object_agg(map, min_level) from public.map_levels), '{}'::jsonb));
end $$;


-- ---------- Privileges (the re-created functions keep theirs) ----------
revoke all on function public._boss_paid_group(text) from public, anon, authenticated;
revoke all on function public._boss_paid_today(uuid, text) from public, anon, authenticated;
revoke all on function public._dg_clears_today(uuid, bigint) from public, anon, authenticated;
revoke all on function public._pg_work_earn(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._pg_counted_win(jsonb) from public, anon, authenticated;
revoke all on function public._company_share(bigint, uuid) from public, anon, authenticated;
