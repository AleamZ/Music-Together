-- tests/sql/econ-rewards-smoke.sql — 0104 (economy v2, the fixed faucets). Run as the superuser on the throwaway cluster
-- after the full chain, from the repo root. It re-runs 0104 twice with \i, switches room_creation_open on for the rooms it
-- creates and puts it back. Every check is an ASSERT; only accounts it registers are paid.
--   1. Progression: level rewards 20·L / 60·L (1→99 = 136 980), real level-ups under the 1 500 grant cap, achievements.
--   2. Earned by work: 'daily', 'login_reward', 'song', 'pet_find' and a vehicle / fashion resale move neither the stats,
--      the earn XP nor an earn quest; a fish sale does.
--   3. Fight wins: a friendly 0-stake bout keeps its XP but is no win (stat, quest); a staked bout, an underground fight,
--      a dojo exam and a bout of a staked 2v2 series are.
--   4. The company quest: a 3 000 pool split by contribution (≥ 1 % of the goal, ≤ 300 each); the others closed at once.
--   5. Quests: the farm dailies' goals and the win quests' text.
--   6. Bosses: the raid pool 1 200; 2 paid raid kills and 2 paid weather kills a day per account (XP after that), the world
--      boss uncapped; the raid summon's cooldown per member (a re-formed party waits, a new crew does not).
--   7. The dungeon: fee 100; 50 + 250 × n × share; 3 paid clears a day; the capped and the idle are not in n.
--   8. Pets: the sóc forages only while its owner moves, 150 a day; PvE 5 paid wins and prizes × 0.6; PvP pot less 5 %.
--   9. Travel: teleport and xe ôm 50; progress_state says 50.
--  10. The new helpers are private.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0104_econ_rewards.sql
\i supabase/migrations/0104_econ_rewards.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log', min_client_build = 0;

create temp table rw (k text primary key, v text);
insert into rw select 'rooms_flag', enabled::text from public.app_flags where key = 'room_creation_open';
update public.app_flags set enabled = true where key = 'room_creation_open';
insert into rw select 't' || i, token from generate_series(1, 9) i,
  lateral public.register('rw' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into rw select 'a' || substr(k, 2), public._auth_account(v)::text from rw where k ~ '^t[0-9]$';
insert into public.wallets (account_id, coins) select v::uuid, 100000 from rw where k ~ '^a[0-9]$'
  on conflict (account_id) do update set coins = 100000;

create or replace function pg_temp.t(p integer) returns text language sql as $$ select v from rw where k = 't' || p $$;
create or replace function pg_temp.a(p integer) returns uuid language sql as $$ select v::uuid from rw where k = 'a' || p $$;
create or replace function pg_temp.coins(p integer) returns integer language sql as $$
  select coins from public.wallets where account_id = pg_temp.a(p) $$;
-- put an account at (map, x, y) long ago (any claim is then reachable)
create or replace function pg_temp.put(p integer, p_map text, p_x integer, p_y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (pg_temp.a(p), p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
-- a party of the given accounts, the first leading
create or replace function pg_temp.party(p_who integer[]) returns bigint language plpgsql as $$
declare j jsonb; p bigint; u text;
begin
  j := public.party_create(pg_temp.t(p_who[1]));
  p := (j->'party'->>'id')::bigint;
  for i in 2 .. coalesce(array_length(p_who, 1), 1) loop
    select username into u from public.accounts where id = pg_temp.a(p_who[i]);
    perform public.party_invite(pg_temp.t(p_who[1]), u);
    perform public.party_accept(pg_temp.t(p_who[i]), p);
  end loop;
  return p;
end $$;
-- a cleared dungeon run of these accounts with this damage (each paid the fee), paid out; its id
create or replace function pg_temp.clear(p_who integer[], p_dmg integer[]) returns bigint language plpgsql as $$
declare r bigint;
begin
  insert into public.dungeon_runs (leader, room, mobs, scale, status, expires_at, ended_at)
  values (pg_temp.a(p_who[1]), 4, array[0], 1, 'cleared', now() + interval '25 minutes', now()) returning id into r;
  insert into public.dungeon_members (run_id, account_id, dmg, paid)
  select r, pg_temp.a(p_who[i]), p_dmg[i], 100 from generate_subscripts(p_who, 1) i;
  perform public._dg_payout(r);
  return r;
end $$;
-- what a dungeon run paid an account (its dungeon_clear event)
create or replace function pg_temp.dg_paid(p_run bigint, p integer) returns integer language sql as $$
  select (meta->>'coins')::integer from public.game_events
   where kind = 'dungeon_clear' and account_id = pg_temp.a(p) and meta->>'run' = p_run::text $$;
-- an account's boss_reward xu today for one boss
create or replace function pg_temp.boss_paid(p integer, p_boss text) returns integer language sql as $$
  select coalesce(sum(delta), 0)::integer from public.coin_ledger
   where account_id = pg_temp.a(p) and reason = 'boss_reward' and ref = (select name from public._boss_defs() where id = p_boss) $$;
-- a dead boss fight hit by the given accounts (dmg each), the first one the killer, paid out
create or replace function pg_temp.kill(p_boss text, p_who integer[], p_dmg integer, p_ago integer) returns bigint language plpgsql as $$
declare f bigint; d record;
begin
  select * into d from public._boss_defs() where id = p_boss;
  insert into public.boss_fights (boss, slot, announce_at, starts_at, ends_at, hp, max_hp, status, killed_at, killer)
  values (p_boss, now() - make_interval(mins => p_ago), now(), now(), now() + interval '20 minutes', 0, d.hp, 'dead', now(),
          pg_temp.a(p_who[1]))
  returning id into f;
  insert into public.boss_hits (fight_id, account_id, dmg, hits) select f, pg_temp.a(i), p_dmg, 20 from unnest(p_who) i;
  perform public._boss_payout(f);
  return f;
end $$;

-- ---------- 1. Progression ----------
do $$
declare a uuid := pg_temp.a(1); v0 integer;
begin
  assert (select sum(public._pg_level_reward(l)) from generate_series(2, 99) l) = 136980, 'levels 1→99 pay 136 980';
  assert public._pg_level_reward(4) = 80 and public._pg_level_reward(5) = 300 and public._pg_level_reward(99) = 1980, 'level rewards';
  assert public._pg_cap('grant') = 1500 and public._pg_cap('fish') = 1500 and public._pg_cap('earn') = 400
     and public._pg_cap('fight') = 400, 'caps';
  assert (select reward from public.achievement_catalog where id = 'level_30') = 3000
     and (select reward from public.achievement_catalog where id = 'earn_1m') = 5000
     and (select reward from public.achievement_catalog where id = 'win_500') = 5000
     and (select reward from public.achievement_catalog where id = 'win_50') = 2000
     and (select reward from public.achievement_catalog where id = 'fish_1000') = 5000, 'achievement rewards';
  -- three grants of 500 reach level 7 (1 350 XP) and pay 40 + 60 + 80 + 300 + 120 + 140; a fourth is past the cap
  v0 := pg_temp.coins(1);
  for i in 1 .. 4 loop perform public._game_event(a, 'xp_grant', 500, '{"source":"quest"}'); end loop;
  assert (select level from public.player_progress where account_id = a) = 7, 'level 7';
  assert (select xp from public.player_progress where account_id = a) = 1500
     and (select xp_grant from public.player_progress where account_id = a) = 1500, 'grant cap 1 500';
  assert (select coalesce(sum(delta), 0) from public.coin_ledger where account_id = a and reason = 'level_reward') = 740, 'level rewards paid';
  assert pg_temp.coins(1) = v0 + 740, 'wallet';
  raise notice 'progression ok';
end $$;

-- ---------- 2. Earned by work ----------
do $$
declare a uuid := pg_temp.a(2);
begin
  insert into public.quest_progress (account_id, quest_id, period) values (a, 'n_lang_2', '');   -- as accepted beside bác Ba
  assert not public._pg_work_reason('daily') and not public._pg_work_reason('login_reward') and not public._pg_work_reason('song')
     and not public._pg_work_reason('pet_find') and public._pg_work_reason('sell') and public._pg_work_reason('rice_sell'), 'reasons';
  perform public._wallet_lock(a);
  perform public._pay(a, 20, 'daily', public._vn_today()::text);
  perform public._pay(a, 1000, 'login_reward', public._vn_today()::text || '#7');
  perform public._pay(a, 10, 'song', 'a song');
  perform public._pay(a, 30, 'pet_find', 'soc');
  perform public._pay(a, 2500, 'sell', 'vehicle: bike');
  perform public._pay(a, 600, 'sell', 'fashion: top_ao_dai');
  assert coalesce((select earned_total from public.player_stats where account_id = a), 0) = 0, 'rewards and resales are not work';
  assert coalesce((select xp_earn from public.player_progress where account_id = a), 0) = 0, 'no earn XP';
  assert (select progress from public.quest_progress where account_id = a and quest_id = 'n_lang_2') = 0, 'no earn quest';
  -- a fish sale is work
  perform public._pay(a, 1000, 'sell', '12 con');
  assert (select earned_total from public.player_stats where account_id = a) = 1000, 'fish sale counted';
  assert (select xp_earn from public.player_progress where account_id = a) = 50, 'earn XP 50';
  assert (select done_at is not null from public.quest_progress where account_id = a and quest_id = 'n_lang_2'), 'n_lang_2 done';
  -- a resale right after a fish sale of the same amount is still a resale
  perform public._pay(a, 1000, 'sell', 'vehicle: moto');
  assert (select earned_total from public.player_stats where account_id = a) = 1000, 'the newest row decides';
  raise notice 'earned by work ok';
end $$;

-- ---------- 3. Fight wins ----------
do $$
declare a uuid := pg_temp.a(3); b uuid := pg_temp.a(4); m uuid; ta uuid; tb uuid;
begin
  insert into public.quest_progress (account_id, quest_id, period) values (a, 'n_lang_6', '');
  -- a friendly bout: its XP (40 + 5), no win
  insert into public.fight_matches (kind, p1, p2, params, stake, started_at, sim) values ('pvp', a, b, '{}', 0, now(), '{}')
  returning id into m;
  update public.fight_matches set status = 'done', winner = 1, ended_at = now() where id = m;
  assert coalesce((select fight_wins from public.player_stats where account_id = a), 0) = 0, 'a friendly win is not counted';
  assert (select xp_fight from public.player_progress where account_id = a) = 45, 'the friendly bout keeps its XP';
  assert (select progress from public.quest_progress where account_id = a and quest_id = 'n_lang_6') = 0, 'no win quest';
  assert not public._pg_counted_win(jsonb_build_object('kind', 'pvp', 'match', m)), 'friendly';
  -- a staked bout counts
  insert into public.fight_matches (kind, p1, p2, params, stake, started_at, sim) values ('pvp', a, b, '{}', 100, now(), '{}')
  returning id into m;
  update public.fight_matches set status = 'done', winner = 1, ended_at = now() where id = m;
  assert (select fight_wins from public.player_stats where account_id = a) = 1, 'staked';
  assert (select progress from public.quest_progress where account_id = a and quest_id = 'n_lang_6') = 1, 'win quest 1';
  -- an underground fight and a dojo exam count
  insert into public.fight_matches (kind, p1, p2, params, stake, entry, started_at, sim) values ('ug_rated', a, b, '{}', 0, 500, now(), '{}')
  returning id into m;
  update public.fight_matches set status = 'done', winner = 1, ended_at = now() where id = m;
  insert into public.fight_matches (kind, p1, p2, params, stake, started_at, sim) values ('exam', a, null, '{}', 0, now(), '{}')
  returning id into m;
  update public.fight_matches set status = 'done', winner = 1, ended_at = now() where id = m;
  assert (select fight_wins from public.player_stats where account_id = a) = 3, 'underground and exam';
  assert (select done_at is not null from public.quest_progress where account_id = a and quest_id = 'n_lang_6'), 'win quest done';
  -- a 0-stake bout of a staked 2v2 series counts; of an unstaked one, not
  insert into public.arena_teams (name, code, a, b) values ('Đội A', 'RWA' || floor(random() * 1e6)::text, a, pg_temp.a(5))
  returning id into ta;
  insert into public.arena_teams (name, code, a, b) values ('Đội B', 'RWB' || floor(random() * 1e6)::text, b, pg_temp.a(6))
  returning id into tb;
  insert into public.fight_matches (kind, p1, p2, params, stake, ring, started_at, sim) values ('pvp', a, b, '{}', 0, 1, now(), '{}')
  returning id into m;
  insert into public.arena_series (team_a, team_b, stake, payer_a, payer_b, a1, a2, b1, b2, status, accepted_at, bouts)
  values (ta, tb, 100, a, b, a, pg_temp.a(5), b, pg_temp.a(6), 'done', now() - interval '1 minute',
          jsonb_build_array(jsonb_build_object('bout', 1, 'match', m, 'side', 'a')));
  update public.fight_matches set status = 'done', winner = 1, ended_at = now() where id = m;
  assert (select fight_wins from public.player_stats where account_id = a) = 4, 'a staked series bout';
  update public.arena_series set stake = 0 where team_a = ta;
  assert not public._pg_counted_win(jsonb_build_object('kind', 'pvp', 'match', m)), 'an unstaked series';
  assert public._pg_counted_win('{"kind":"exam"}') and not public._pg_counted_win('{"kind":"pvp"}'), 'no match id: by kind';
  raise notice 'fight wins ok';
end $$;

-- ---------- 4. The company quest ----------
do $$
declare c public.company_quests; j jsonb;
begin
  select * into c from public.company_quests where status = 'open';
  update public.company_quests set kind = 'fish_catch', filter = '{}', use_qty = false, goal = 500, progress = 0,
         reward_coins = 3000, reward_xp = 150 where id = c.id;
  delete from public.company_contrib where quest_id = c.id;
  assert (select bool_and(reward_coins = 3000) from public.company_pool), 'the pool is 3 000';
  -- 7: 50 fish (a tenth of the goal, the day's cap), 8: 25, 9: 5 (1 %), 1: 4 (0.8 %); 2 fills the bar with 1
  for i in 1 .. 50 loop perform public._game_event(pg_temp.a(7), 'fish_catch', 1, '{}'); end loop;
  for i in 1 .. 25 loop perform public._game_event(pg_temp.a(8), 'fish_catch', 1, '{}'); end loop;
  for i in 1 .. 5 loop perform public._game_event(pg_temp.a(9), 'fish_catch', 1, '{}'); end loop;
  for i in 1 .. 4 loop perform public._game_event(pg_temp.a(1), 'fish_catch', 1, '{}'); end loop;
  update public.company_quests set progress = goal - 1 where id = c.id;
  perform public._game_event(pg_temp.a(2), 'fish_catch', 1, '{}');
  assert (select status from public.company_quests where id = c.id) = 'done', 'done';
  assert (select count(*) from public.company_contrib where quest_id = c.id and claimed_at is not null) = 2, 'under 1 % closed';
  assert public._company_share(c.id, pg_temp.a(7)) = 300 and public._company_share(c.id, pg_temp.a(8)) = 150
     and public._company_share(c.id, pg_temp.a(9)) = 30 and public._company_share(c.id, pg_temp.a(1)) = 0
     and public._company_share(c.id, pg_temp.a(5)) = 0, 'shares';
  j := public.quest_company_claim(pg_temp.t(7));
  assert (j->>'paid')::int = 300 and (j->>'xp')::int = 150, format('7 %s', j);
  j := public.quest_company_claim(pg_temp.t(8));
  assert (j->>'paid')::int = 150, format('8 %s', j);
  j := public.quest_company_claim(pg_temp.t(9));
  assert (j->>'paid')::int = 30 and (j->>'xp')::int = 150, format('9 %s', j);
  assert pg_temp.err(format('select public.quest_company_claim(%L)', pg_temp.t(1))) = 'nothing to claim', 'under 1 %';
  assert pg_temp.err(format('select public.quest_company_claim(%L)', pg_temp.t(2))) = 'nothing to claim', 'the last fish';
  assert pg_temp.err(format('select public.quest_company_claim(%L)', pg_temp.t(7))) = 'nothing to claim', 'once';
  assert (select sum(delta) from public.coin_ledger where reason = 'quest_reward' and ref = 'company:' || c.id) = 480, 'the pool split';
  assert (select count(*) from public.company_quests where status = 'open' and reward_coins = 3000) = 1, 'the next goal opened';
  raise notice 'company ok';
end $$;

-- ---------- 5. Quests ----------
do $$
begin
  assert (select goal from public.quest_defs where id = 'd_rice') = 5000
     and (select goal from public.quest_defs where id = 'd_produce') = 5000
     and (select goal from public.quest_defs where id = 'd_critter') = 300, 'farm dailies';
  assert (select reward_coins from public.quest_defs where id = 'd_rice') = 50
     and (select reward_coins from public.quest_defs where id = 'd_critter') = 40, 'rewards unchanged';
  assert (select descr from public.quest_defs where id = 'd_rice') = 'Kiếm 5 000 xu từ bán lúa gạo.', 'the text';
  assert (select descr from public.quest_defs where id = 'w_win5') like '%có cược%', 'win quests say so';
  raise notice 'quests ok';
end $$;

-- ---------- 6. Bosses ----------
do $$
declare f bigint;
begin
  assert (select pool from public._boss_defs() where id = 'heo_rung') = 1200, 'raid pool';
  assert public._boss_paid_group('heo_rung') = 'raid' and public._boss_paid_group('thuy_quai') = 'weather'
     and public._boss_paid_group('nguoi_tuyet') = 'weather' and public._boss_paid_group('trau_tinh') is null, 'groups';
  -- three raid kills by 1–4 (6 000 each, 1 the killer): 300 (+60) twice, then XP only
  for k in 1 .. 3 loop f := pg_temp.kill('heo_rung', array[1, 2, 3, 4], 6000, 10 * k); end loop;
  assert pg_temp.boss_paid(1, 'heo_rung') = 720 and pg_temp.boss_paid(2, 'heo_rung') = 600
     and pg_temp.boss_paid(4, 'heo_rung') = 600, 'two paid raids';
  assert (select count(*) from public.game_events where account_id = pg_temp.a(2) and kind = 'boss_kill' and meta->>'boss' = 'heo_rung') = 3
     and (select (meta->>'coins')::int from public.game_events
           where account_id = pg_temp.a(2) and kind = 'boss_kill' and meta->>'fight' = f::text) = 0, 'the third: XP and the event, 0 xu';
  assert (select count(*) from public.game_events where account_id = pg_temp.a(2) and kind = 'xp_grant' and meta->>'source' = 'boss') = 3, 'XP each time';
  -- the weather bosses share one cap: two Thủy Quái pay, the Người Tuyết after them does not
  f := pg_temp.kill('thuy_quai', array[5, 6, 7], 5000, 11);
  f := pg_temp.kill('thuy_quai', array[5, 6, 7], 5000, 21);
  f := pg_temp.kill('nguoi_tuyet', array[5, 6, 7], 5000, 31);
  -- a third of 900 is floor(900 × 0.333…) = 299 (+45 to the killer)
  assert pg_temp.boss_paid(5, 'thuy_quai') = 688 and pg_temp.boss_paid(6, 'thuy_quai') = 598
     and pg_temp.boss_paid(6, 'nguoi_tuyet') = 0, 'two paid weather bosses';
  -- the world boss is not capped
  for k in 1 .. 3 loop f := pg_temp.kill('trau_tinh', array[1, 2, 3, 4, 5], 8000, 40 + k); end loop;
  assert pg_temp.boss_paid(2, 'trau_tinh') = 1800 and pg_temp.boss_paid(1, 'trau_tinh') = 2250, 'the world boss pays each time';
  raise notice 'boss payouts ok';
end $$;

-- the raid summon: once an hour per member (one transaction per summon: a summon's slot is its now())
do $$
declare p bigint; j jsonb;
begin
  perform pg_temp.put(7, 'bai_dat', 400, 200);
  perform pg_temp.put(8, 'bai_dat', 400, 210);
  perform pg_temp.put(9, 'bai_dat', 420, 220);
  p := pg_temp.party(array[7, 8, 9]);
  update public.player_pos set at = now() where account_id in (pg_temp.a(8), pg_temp.a(9));
  j := public.boss_summon(pg_temp.t(7), 'bai_dat', 400, 200);
  assert j->>'ok' = 'true', format('summoned %s', j);
  assert (select crew from public.boss_fights where boss = 'heo_rung' and status = 'up')
         = (select array_agg(x order by x) from unnest(array[pg_temp.a(7), pg_temp.a(8), pg_temp.a(9)]) x), 'the crew';
  update public.boss_fights set status = 'dead', killed_at = now() where boss = 'heo_rung' and status = 'up';
end $$;
do $$
declare p bigint; e text;
begin
  -- the same three re-formed under a new party id wait
  perform public.party_leave(pg_temp.t(9));
  perform public.party_leave(pg_temp.t(8));
  perform public.party_leave(pg_temp.t(7));
  p := pg_temp.party(array[8, 7, 9]);
  perform pg_temp.put(8, 'bai_dat', 400, 210);
  update public.player_pos set at = now() where account_id in (pg_temp.a(7), pg_temp.a(9));
  e := pg_temp.err(format('select public.boss_summon(%L, %L, 400, 210)', pg_temp.t(8), 'bai_dat'));
  assert e = 'too soon', format('re-formed %s', e);
  perform public.party_leave(pg_temp.t(7));
  perform public.party_leave(pg_temp.t(9));
  perform public.party_leave(pg_temp.t(8));
end $$;
do $$
declare p bigint; j jsonb;
begin
  -- a crew that has not summoned may
  perform pg_temp.put(4, 'bai_dat', 400, 200);
  perform pg_temp.put(5, 'bai_dat', 400, 210);
  perform pg_temp.put(6, 'bai_dat', 420, 220);
  p := pg_temp.party(array[4, 5, 6]);
  update public.player_pos set at = now() where account_id in (pg_temp.a(5), pg_temp.a(6));
  j := public.boss_summon(pg_temp.t(4), 'bai_dat', 400, 200);
  assert j->>'ok' = 'true', format('a new crew %s', j);
  update public.boss_fights set status = 'dead', killed_at = now() where boss = 'heo_rung' and status = 'up';
  perform public.party_leave(pg_temp.t(5));
  perform public.party_leave(pg_temp.t(6));
  perform public.party_leave(pg_temp.t(4));
  raise notice 'raid summon ok';
end $$;

-- ---------- 7. The dungeon ----------
do $$
declare r bigint; j jsonb; v0 integer; p bigint;
begin
  -- the fee: 100, through dungeon_start (a party of one at the gate)
  p := pg_temp.party(array[1]);
  perform pg_temp.put(1, 'bai_dat', 60, 120);
  v0 := pg_temp.coins(1);
  j := public.dungeon_start(pg_temp.t(1));
  assert pg_temp.coins(1) = v0 - 100, 'fee 100';
  assert exists (select 1 from public.coin_ledger where account_id = pg_temp.a(1) and reason = 'dungeon_entry' and delta = -100), 'ledger';
  update public.dungeon_runs set status = 'failed', ended_at = now() where id = (j->'run'->>'id')::bigint;
  perform public.party_leave(pg_temp.t(1));
  update public.wallets set coins = 99 where account_id = pg_temp.a(1);
  assert pg_temp.err(format('select public._dg_pay_fee(%L)', pg_temp.a(1))) = 'insufficient funds', 'short of 100';
  update public.wallets set coins = 100000 where account_id = pg_temp.a(1);
  -- solo: 50 + 250; an equal pair: 300 each; 3 : 1 → 425 / 175; an idle member is not in n and gets nothing
  r := pg_temp.clear(array[2], array[6650]);
  assert pg_temp.dg_paid(r, 2) = 300, 'solo 300';
  r := pg_temp.clear(array[3, 4], array[5000, 5000]);
  assert pg_temp.dg_paid(r, 3) = 300 and pg_temp.dg_paid(r, 4) = 300, 'a pair: 300 each';
  r := pg_temp.clear(array[5, 6], array[7500, 2500]);
  assert pg_temp.dg_paid(r, 5) = 425 and pg_temp.dg_paid(r, 6) = 175, '3 : 1';
  r := pg_temp.clear(array[7, 8], array[6650, 0]);
  assert pg_temp.dg_paid(r, 7) = 300 and pg_temp.dg_paid(r, 8) = 0, 'the idle one';
  -- 3 paid clears a day: 2's second and third pay, the fourth does not
  r := pg_temp.clear(array[2], array[6650]);
  assert pg_temp.dg_paid(r, 2) = 300, 'second';
  r := pg_temp.clear(array[2], array[6650]);
  assert pg_temp.dg_paid(r, 2) = 300, 'third';
  r := pg_temp.clear(array[2], array[6650]);
  assert pg_temp.dg_paid(r, 2) = 0, 'the fourth pays nothing';
  assert (select count(*) from public.coin_ledger where account_id = pg_temp.a(2) and reason = 'dungeon_reward') = 3, 'three paid';
  -- a capped member is not in n: 9 alone is paid 50 + 250 × 1 × 0.5
  r := pg_temp.clear(array[2, 9], array[5000, 5000]);
  assert pg_temp.dg_paid(r, 2) = 0 and pg_temp.dg_paid(r, 9) = 175, 'capped out of n';
  assert public._dg_clears_today(pg_temp.a(2), null) = 5, 'five clears today';
  raise notice 'dungeon ok';
end $$;

-- ---------- 8. Pets ----------
do $$
declare a uuid := pg_temp.a(1); t text := pg_temp.t(1); room uuid; pid bigint; pb bigint; j jsonb; bid bigint; v integer;
begin
  -- the sóc: a heartbeat, a room, and a move
  room := (select room_id from public.create_room('Sóc', 'pw', t));
  insert into public.pets (account_id, species, variant, name, fullness, happy) values (a, 'soc', 'nau', 'Sóc', 90, 90)
  returning id into pid;
  insert into public.pet_owner (account_id, active_pet) values (a, pid)
  on conflict (account_id) do update set active_pet = pid, forage_at = null, forage_today = 0, forage_pos = null, moved_at = null;
  insert into public.player_pos (account_id, map, x, y, at) values (a, 'hall', 612, 300, now())
  on conflict (account_id) do update set map = 'hall', x = 612, y = 300, at = now();
  j := public.pet_tick(t, room);
  assert (j->>'found')::int = 0 and j->>'idle' = 'afk', format('the first tick only samples %s', j);
  update public.player_pos set x = 640, at = now() where account_id = a;
  v := pg_temp.coins(1);
  j := public.pet_tick(t, room);
  assert (j->>'found')::int between 5 and 30 and j->'idle' is null, format('moving %s', j);
  assert pg_temp.coins(1) = v + (j->>'found')::int, 'paid';
  j := public.pet_tick(t, room);
  assert (j->>'found')::int = 0 and j->'idle' is null, format('the 10-minute pace %s', j);
  update public.pet_owner set forage_at = now() - interval '11 minutes', forage_today = 145 where account_id = a;
  j := public.pet_tick(t, room);
  assert (j->>'found')::int = 5 and (j->>'forage_today')::int = 150, format('150 a day %s', j);
  update public.pet_owner set forage_at = now() - interval '11 minutes' where account_id = a;
  assert (public.pet_tick(t, room)->>'found')::int = 0, 'nothing past 150';
  -- a new day, but standing still for more than 5 minutes: nothing
  update public.pet_owner set forage_at = now() - interval '11 minutes', forage_day = forage_day - 1,
         moved_at = now() - interval '6 minutes' where account_id = a;
  j := public.pet_tick(t, room);
  assert (j->>'found')::int = 0 and j->>'idle' = 'afk', format('still %s', j);
  -- moving again
  update public.player_pos set x = 600, at = now() where account_id = a;
  assert (public.pet_tick(t, room)->>'found')::int > 0, 'moving again';
  -- PvE: the wild cat pays 24 (was 40); after 5 paid wins, nothing
  assert public._pv2('pve_paid') = 5, 'pve_paid';
  assert (select array_agg(reward order by sort_order) from public.pet_npc_catalog) = array[24, 42, 54, 90, 150, 270], 'prizes × 0.6';
  perform public.pet_buy(pg_temp.t(3), 'meo', 'cam');
  select id into pid from public.pets where account_id = pg_temp.a(3) order by id desc limit 1;
  update public.pets set fullness = 100, happy = 100, stats_at = now() where id = pid;
  j := public.battle_start_pve(pg_temp.t(3), 'pet', pid, 'meo_hoang');
  bid := (j->'battle'->>'id')::bigint;
  v := pg_temp.coins(3);
  perform public._battle_finish(bid, 1::smallint);
  assert (select reward from public.pet_battles where id = bid) = 24, 'prize 24';
  assert exists (select 1 from public.coin_ledger where account_id = pg_temp.a(3) and reason = 'pet_battle' and delta = 24
                   and ref = 'pve meo_hoang #' || bid), 'paid 24';
  update public.pet_owner set wins_today = 5 where account_id = pg_temp.a(3);
  update public.pets set fullness = 100, stats_at = now() where id = pid;
  j := public.battle_start_pve(pg_temp.t(3), 'pet', pid, 'meo_hoang');
  bid := (j->'battle'->>'id')::bigint;
  perform public._battle_finish(bid, 1::smallint);
  assert (select reward from public.pet_battles where id = bid) = 0, 'no prize after 5 wins';
  -- PvP: the winner takes the pot less 5 %
  perform public.pet_buy(pg_temp.t(4), 'cho', 'vang');
  select id into pb from public.pets where account_id = pg_temp.a(4) order by id desc limit 1;
  update public.pets set fullness = 100, happy = 100, stats_at = now() where id in (pid, pb);
  room := (select room_id from public.create_room('Đấu thú', 'pw', pg_temp.t(3)));
  insert into public.members (room_id, account_id) values (room, pg_temp.a(4)) on conflict do nothing;
  j := public.battle_challenge(pg_temp.t(3), room, pg_temp.a(4), 'pet', pid, 500);
  bid := (select id from public.pet_battles where p1 = pg_temp.a(3) and status = 'pending');
  v := pg_temp.coins(3);
  perform public.battle_accept(pg_temp.t(4), bid, 'pet', pb);
  perform public.battle_forfeit(pg_temp.t(4), bid);
  assert (select winner from public.pet_battles where id = bid) = 1, 'the challenger wins';
  assert pg_temp.coins(3) = v - 500 + 950, format('pot less 5 %%: %s', pg_temp.coins(3) - v);
  raise notice 'pets ok';
end $$;

-- ---------- 9. Travel ----------
do $$
declare a uuid := pg_temp.a(9); t text := pg_temp.t(9); v0 integer; j jsonb;
begin
  insert into public.player_waypoints (account_id, waypoint) values (a, 'wp_hall'), (a, 'wp_pond') on conflict do nothing;
  perform pg_temp.put(9, 'hall', 612, 300);
  v0 := pg_temp.coins(9);
  j := public.waypoint_travel(t, 'wp_pond');
  assert (j->>'ok')::boolean and pg_temp.coins(9) = v0 - 50, format('teleport %s', j);
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'teleport' and delta = -50), 'teleport ledger';
  assert (public.progress_state(t)->>'teleport_fee')::int = 50, 'the fee shown';
  v0 := pg_temp.coins(9);
  j := public.skip_trip(t);
  assert (j->>'coins')::int = v0 - 50, format('xe ôm %s', j);
  update public.wallets set coins = 49 where account_id = a;
  assert pg_temp.err(format('select public.skip_trip(%L)', t)) = 'insufficient funds', 'short of 50';
  update public.wallets set coins = 100000 where account_id = a;
  raise notice 'travel ok';
end $$;

-- ---------- 10. Privileges ----------
do $$
declare f text;
begin
  foreach f in array array['_boss_paid_group(text)', '_boss_paid_today(uuid,text)', '_dg_clears_today(uuid,bigint)',
                           '_pg_work_earn(uuid,text,integer)', '_pg_counted_win(jsonb)', '_company_share(bigint,uuid)'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' is private';
    assert not has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' is private';
  end loop;
  foreach f in array array['quest_company_claim(text)', 'boss_summon(text,text,integer,integer)', 'pet_tick(text,uuid)',
                           'waypoint_travel(text,text)', 'skip_trip(text)', 'progress_state(text)'] loop
    assert has_function_privilege('anon', 'public.' || f, 'execute'), f || ' is callable';
  end loop;
  raise notice 'privileges ok';
end $$;

update public.app_flags set enabled = (select v::boolean from rw where k = 'rooms_flag') where key = 'room_creation_open';
