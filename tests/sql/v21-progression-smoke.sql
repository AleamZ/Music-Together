-- tests/sql/v21-progression-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0069, from the
-- repo root. It re-runs 0070 twice with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0070_progression.sql
\i supabase/migrations/0070_progression.sql
reset client_min_messages;

create temp table px (k text primary key, v text);
insert into px select 'ta', token from public.register('pg_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into px select 'a', public._auth_account(v)::text from px where k = 'ta';
insert into public.wallets (account_id) select v::uuid from px where k = 'a' on conflict do nothing;

-- ---------- 1. Pure helpers ----------
do $$
begin
  assert public._pg_xp_at(1) = 0 and public._pg_xp_at(2) = 100 and public._pg_xp_at(3) = 250 and public._pg_xp_at(10) = 2700, 'curve';
  assert public._pg_level_for(0) = 1 and public._pg_level_for(99) = 1 and public._pg_level_for(100) = 2
     and public._pg_level_for(2699) = 9 and public._pg_level_for(2700) = 10 and public._pg_level_for(10000000) = 99, 'level_for';
  assert public._pg_level_reward(2) = 100 and public._pg_level_reward(5) = 750, 'rewards';
  assert public._pg_work_reason('sell') and not public._pg_work_reason('level_reward')
     and not public._pg_work_reason('achievement_reward') and not public._pg_work_reason('trade'), 'work reasons';
  raise notice 'helpers ok';
end $$;

-- ---------- 2. A catch: stats, Fishdex, XP, the first achievement ----------
do $$
declare a uuid := (select v from px where k = 'a')::uuid; r public.player_progress; s public.player_stats;
begin
  perform public._game_event(a, 'fish_catch', 1, '{"species":"ca_ro","weight_g":200,"price":9}');
  select * into r from public.player_progress where account_id = a;
  select * into s from public.player_stats where account_id = a;
  assert r.xp = 4 and r.level = 1, format('xp %s', r.xp);
  assert s.fish_total = 1 and s.biggest_g = 200 and s.biggest_species = 'ca_ro', 'stats';
  assert (select caught from public.player_fishdex where account_id = a and species = 'ca_ro') = 1, 'fishdex';
  assert exists (select 1 from public.player_achievements where account_id = a and achievement = 'fish_1'), 'fish_1';
  assert (select coins from public.wallets where account_id = a) = 50, 'fish_1 reward';
  -- the reward is not work: no XP, no earned
  assert (select earned_total from public.player_stats where account_id = a) = 0, 'reward not earned';
  raise notice 'catch ok';
end $$;

-- ---------- 3. xp_grant: level-ups pay, the daily cap holds ----------
do $$
declare a uuid := (select v from px where k = 'a')::uuid; r public.player_progress; i integer;
begin
  perform public._game_event(a, 'xp_grant', 9999, '{"source":"smoke"}');     -- clamped to 500
  select * into r from public.player_progress where account_id = a;
  assert r.xp = 504 and r.level = 4, format('grant %s / %s', r.xp, r.level);
  assert (select coins from public.wallets where account_id = a) = 50 + 100 + 150 + 200, 'level rewards';
  assert (select count(*) from public.game_events where account_id = a and kind = 'level_up') = 3, 'level_up events';
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'level_reward') = 3, 'ledger';
  for i in 1 .. 8 loop perform public._game_event(a, 'xp_grant', 500, '{"source":"smoke"}'); end loop;
  select * into r from public.player_progress where account_id = a;
  assert r.xp_grant = 3000 and r.xp = 3004, format('grant cap %s', r.xp_grant);
  perform public._game_event(a, 'xp_grant', -50, '{}');
  assert (select xp from public.player_progress where account_id = a) = 3004, 'negative grant';
  raise notice 'grant ok';
end $$;

-- ---------- 4. earn: work reasons only, capped ----------
do $$
declare a uuid := (select v from px where k = 'a')::uuid; x0 bigint := (select xp from public.player_progress where account_id = (select v from px where k = 'a')::uuid);
begin
  perform public._pay(a, 1000, 'sell', 'smoke');
  assert (select xp from public.player_progress where account_id = a) = x0 + 50, 'sell xp';
  assert (select earned_total from public.player_stats where account_id = a) = 1000, 'earned';
  perform public._pay(a, 1000, 'rice_sell', 'smoke');
  assert (select farm_earned from public.player_stats where account_id = a) = 1000, 'farm';
  perform public._pay(a, 1000, 'trade', 'smoke');
  assert (select earned_total from public.player_stats where account_id = a) = 2000, 'trade is not work';
  raise notice 'earn ok';
end $$;

-- ---------- 5. Fights ----------
do $$
declare a uuid := (select v from px where k = 'a')::uuid; x0 bigint := (select xp from public.player_progress where account_id = (select v from px where k = 'a')::uuid);
begin
  perform public._game_event(a, 'fight_win', 1, '{"kind":"pvp"}');
  perform public._game_event(a, 'fight_done', 1, '{"kind":"pvp"}');
  assert (select xp from public.player_progress where account_id = a) = x0 + 45, 'fight xp';
  assert (select fight_wins from public.player_stats where account_id = a) = 1, 'wins';
  assert exists (select 1 from public.player_achievements where account_id = a and achievement = 'win_1'), 'win_1';
  raise notice 'fight ok';
end $$;

-- ---------- 6. Collections, a bad event never blocks ----------
do $$
declare a uuid := (select v from px where k = 'a')::uuid; sp text; c0 integer;
begin
  for sp in select id from public.fish_species where rarity = 1 loop
    perform public._game_event(a, 'fish_catch', 1, jsonb_build_object('species', sp, 'weight_g', 100));
  end loop;
  assert exists (select 1 from public.player_collections where account_id = a and collection = 'fish_common'), 'collection';
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'collection_reward') = 1, 'paid once';
  c0 := (select coins from public.wallets where account_id = a);
  perform public._game_event(a, 'fish_catch', 1, '{"species":"ca_ro","weight_g":100}');
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'collection_reward') = 1, 'still once';
  perform public._game_event(a, 'fish_catch', 1, '{"species":"ca_ro","weight_g":"abc"}');   -- swallowed
  assert (select count(*) from public.game_events where account_id = a and kind = 'fish_catch') >= 5, 'event kept';
  raise notice 'collections ok';
end $$;

-- ---------- 7. Titles ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid; j jsonb; ok boolean := false;
begin
  begin
    perform public.progress_set_title(t, 'fish_100');
  exception when others then ok := sqlerrm = 'title locked';
  end;
  assert ok, 'locked title';
  update public.player_stats set fish_total = 99 where account_id = a;
  perform public._game_event(a, 'fish_catch', 1, '{"species":"ca_sac","weight_g":100}');
  j := public.progress_set_title(t, 'fish_100');
  assert (select title from public.player_progress where account_id = a) = 'fish_100' and j->>'title' = 'fish_100', 'title set';
  j := public.progress_set_title(t, null);
  assert (select title from public.player_progress where account_id = a) is null, 'title off';
  raise notice 'titles ok';
end $$;

-- ---------- 8. Map unlocks & waypoints ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid; j jsonb; ok boolean;
        c0 integer;
begin
  assert public._map_unlocked(a, 'hall') and public._map_unlocked(a, 'nowhere'), 'open maps';
  insert into public.map_levels values ('smoke_map', 50);
  assert not public._map_unlocked(a, 'smoke_map'), 'locked map';
  delete from public.map_levels where map = 'smoke_map';

  delete from public.player_pos where account_id = a;
  perform public.pos_report(t, 'pond', 300, 356);
  assert exists (select 1 from public.player_waypoints where account_id = a and waypoint = 'wp_pond'), 'discovered pond';
  j := public.progress_state(t);
  assert j->>'at_waypoint' = 'wp_pond', format('at %s', j->>'at_waypoint');
  ok := false;
  begin perform public.waypoint_travel(t, 'wp_hall'); exception when others then ok := sqlerrm = 'waypoint unknown'; end;
  assert ok, 'unknown target';
  insert into public.player_waypoints (account_id, waypoint) values (a, 'wp_hall'), (a, 'wp_bai_dat');
  update public.map_levels set min_level = 50 where map = 'bai_dat';                -- level 10 by now: gate the map
  ok := false;
  begin perform public.waypoint_travel(t, 'wp_bai_dat'); exception when others then ok := sqlerrm = 'level too low'; end;
  update public.map_levels set min_level = 1 where map = 'bai_dat';
  assert ok, 'level gate';
  c0 := (select coins from public.wallets where account_id = a);
  j := public.waypoint_travel(t, 'wp_hall');
  assert j->'to'->>'map' = 'hall' and (select map || x || ',' || y from public.player_pos where account_id = a) = 'hall612,300', 'moved';
  assert (select coins from public.wallets where account_id = a) = c0 - 20, 'fee';
  ok := false;
  begin perform public.waypoint_travel(t, 'wp_pond'); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'cooldown';
  update public.player_progress set tp_at = now() - interval '1 minute' where account_id = a;
  update public.player_pos set map = 'field', x = 400, y = 300 where account_id = a;
  ok := false;
  begin perform public.waypoint_travel(t, 'wp_pond'); exception when others then ok := sqlerrm = 'not at waypoint'; end;
  assert ok, 'not at a waypoint';
  raise notice 'waypoints ok';
end $$;

-- ---------- 9. Leaderboards ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid; j jsonb; ok boolean := false;
begin
  delete from public.leaderboard_cache;
  j := public.progress_leaderboard(t, 'level');
  assert jsonb_array_length(j->'rows') between 1 and 20 and exists (select 1 from jsonb_array_elements(j->'rows') e where e->>'id' = a::text), 'level board';
  j := public.progress_leaderboard(t, 'biggest');
  assert exists (select 1 from public.leaderboard_cache where board = 'biggest'), 'cached';
  begin perform public.progress_leaderboard(t, 'hax'); exception when others then ok := sqlerrm = 'bad board'; end;
  assert ok, 'bad board';
  raise notice 'boards ok';
end $$;

-- ---------- 10. Privileges ----------
do $$
begin
  assert not has_table_privilege('anon', 'public.player_progress', 'select'), 'progress hidden';
  assert not has_table_privilege('anon', 'public.game_events', 'select'), 'events hidden';
  assert not has_table_privilege('anon', 'public.player_waypoints', 'insert'), 'waypoints hidden';
  assert has_function_privilege('anon', 'public.progress_state(text)', 'execute'), 'state';
  assert has_function_privilege('anon', 'public.waypoint_travel(text, text)', 'execute'), 'travel';
  assert not has_function_privilege('anon', 'public._map_unlocked(uuid, text)', 'execute'), 'helper private';
  assert not has_function_privilege('anon', 'public._pg_add_xp(uuid, text, integer)', 'execute'), 'xp private';
  raise notice 'privileges ok';
end $$;

-- ---------- 11. The wipe ----------
do $$
declare a uuid := (select v from px where k = 'a')::uuid;
begin
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot) values (a, 'x', a, '{}');
  assert not exists (select 1 from public.player_progress where account_id = a), 'progress wiped';
  assert not exists (select 1 from public.player_fishdex where account_id = a), 'fishdex wiped';
  assert not exists (select 1 from public.game_events where account_id = a), 'events wiped';
  raise notice 'wipe ok';
end $$;

\echo v21-progression-smoke: all ok
