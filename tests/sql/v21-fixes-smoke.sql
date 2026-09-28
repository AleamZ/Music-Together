-- tests/sql/v21-fixes-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain (0004 …
-- 0078), from the repo root, with the reel fixtures' absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/reel-cases.json -f tests/sql/v21-fixes-smoke.sql
-- It re-runs 0078 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql. Time passing is simulated
-- by moving timestamps back (each DO block is one transaction: now() stands still).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0078_v21_fixes.sql
\i supabase/migrations/0078_v21_fixes.sql
reset client_min_messages;

create temp table rf as select pg_read_file(:'fixtures')::jsonb j;
create temp table fx (k text primary key, v text);
do $$
declare n text; r text;
begin
  foreach n in array array['a', 'b', 'c', 'd', 'e', 'm', 'p', 'q', 'h', 'i', 'w', 'z', 'k', 'x'] loop
    r := 'v78' || n || '_' || floor(random() * 1e9)::text;
    insert into fx select 't' || n, token from public.register(r, 'pw123456');
    insert into fx select n, public._auth_account((select v from fx where k = 't' || n))::text;
  end loop;
end $$;
insert into fx select 'room', room_id::text from public.create_room('v21 fixes', 'pw', (select v from fx where k = 'ta'));
insert into fx select 'room2', room_id::text from public.create_room('v21 fixes 2', 'pw', (select v from fx where k = 'tb'));
select public.join_room((select code from public.rooms where id = (select v from fx where k = 'room')::uuid), 'pw',
                         (select v from fx where k = 'tm'));
update public.anticheat_config set mode = 'log';

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from fx where k = key $$;
create or replace function pg_temp.u(key text) returns uuid language sql stable as $$ select v::uuid from fx where k = key $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;
-- stand somewhere (an accepted claim `ago` seconds back)
create or replace function pg_temp.stand(acc uuid, m text, x integer, y integer, ago integer default 3600) returns void
language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (acc, m, x, y, now() - make_interval(secs => ago))
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, tab = null, tabs = '{}'
$$;
create or replace function pg_temp.fresh(acc uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (acc) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  delete from public.player_stamina where account_id = acc;
end $$;
create or replace function pg_temp.catches(acc uuid) returns bigint language sql stable as $$
  select count(*) from public.game_events where account_id = acc and kind = 'fish_catch'
$$;

-- ---------- A. Only a verified catch is a catch ----------
do $$
declare v text[];
begin
  -- every live function that inserts a fish row, and the ones that mark it a catch
  select array_agg(distinct p.proname::text order by p.proname::text) into v from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosrc ~* 'insert\s+into\s+public\.fish\s*\(';
  assert v = array['aquarium_take', 'finish_cast', 'finish_net', 'fish_move_to_bag'], format('fish inserters %s', v);
  select array_agg(distinct p.proname::text order by p.proname::text) into v from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosrc like '%set_config(''mt.catch'', ''1'', true)%';
  assert v = array['finish_cast', 'finish_net'], format('catch paths %s', v);
  raise notice 'catch paths ok';
end $$;

do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); room uuid := pg_temp.u('room');
        won jsonb := (select x from rf, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'caught' limit 1);
        r jsonb; n0 bigint; bid uuid; cid uuid; fid uuid := gen_random_uuid(); tank bigint; apt smallint; s0 integer;
        tg integer[];
begin
  delete from public.fish where account_id = a;
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  -- a live fishing battle of a and b
  insert into public.fishing_battles (room_id, host, fee, duration_s, status, starts_at, ends_at, pot)
  values (room, a, 100, 180, 'live', now() - interval '10 seconds', now() + interval '170 seconds', 200) returning id into bid;
  insert into public.fishing_battle_players (battle_id, account_id) values (bid, a), (bid, b);
  -- 1) a plain insert (a moved fish, whatever its caught_at) is no catch
  n0 := pg_temp.catches(a);
  insert into public.fish (account_id, species_id, weight_g, price) values (a, 'ca_loc', 1000, 300);
  assert pg_temp.catches(a) = n0, 'a plain insert emits nothing';
  assert (select score from public.fishing_battle_players where battle_id = bid and account_id = a) = 0, 'no battle score';
  delete from public.fish where account_id = a;
  -- 2) the aquarium: a fish taken back, even with a fresh caught_at
  insert into public.furniture_items (account_id, item_id) values (a, 'aquarium') returning id into tank;
  insert into public.aquarium_fish (id, tank, species_id, weight_g, price, caught_at) values (fid, tank, 'ca_loc', 900, 250, now());
  r := public.aquarium_take(t, fid);
  assert exists (select 1 from public.fish where id = fid and account_id = a), 'taken back';
  assert pg_temp.catches(a) = n0, 'aquarium_take emits no fish_catch';
  assert (select score from public.fishing_battle_players where battle_id = bid and account_id = a) = 0, 'aquarium: no score';
  delete from public.fish where account_id = a;
  -- 3) the fridge
  select no into apt from public.apartments where owner_id is null order by no desc limit 1;
  update public.apartments set owner_id = a, tenure = 'own' where no = apt;
  fid := gen_random_uuid();
  insert into public.fridge_fish (id, account_id, species_id, weight_g, price, caught_at) values (fid, a, 'ca_loc', 900, 250, now());
  r := public.fish_move_to_bag(t, fid);
  assert exists (select 1 from public.fish where id = fid), 'out of the fridge';
  assert pg_temp.catches(a) = n0, 'fish_move_to_bag emits no fish_catch';
  assert (select score from public.fishing_battle_players where battle_id = bid and account_id = a) = 0, 'fridge: no score';
  delete from public.fish where account_id = a;
  -- 4) an honest reel through finish_cast is a catch: one event, the battle score, the Fishdex
  select array_agg(x::int order by o) into tg from jsonb_array_elements_text(won->'toggles') with ordinality q(x, o);
  delete from public.casts where account_id = a;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, reel_seed, reel_params, hooked_at)
  values (a, room, 'ca_ro', 100, (won->'params'->>'minReelMs')::int, now() - interval '61 seconds', now() + interval '30 seconds',
          (won->'params'->>'seed')::bigint,
          jsonb_build_object('zone_pct', won->'params'->'zonePct', 'difficulty', won->'params'->'difficulty',
                             'min_reel_ms', won->'params'->'minReelMs'), now() - interval '60 seconds')
  returning id into cid;
  r := public.finish_cast(t, cid, true, false, coalesce(tg, '{}'), (won->'expected'->>'ticks')::int);
  assert r->>'result' = 'caught', format('honest catch %s', r);
  assert pg_temp.catches(a) = n0 + 1, 'finish_cast: one fish_catch';
  s0 := (select price from public.fish where account_id = a order by caught_at desc limit 1);
  assert (select score from public.fishing_battle_players where battle_id = bid and account_id = a) = s0, 'finish_cast: scored';
  assert coalesce(current_setting('mt.catch', true), '') = '', 'the flag is cleared after the insert';
  -- 5) the flag itself (what finish_cast / finish_net set) is what counts
  perform set_config('mt.catch', '1', true);
  insert into public.fish (account_id, species_id, weight_g, price) values (a, 'ca_loc', 1000, 300);
  perform set_config('mt.catch', '', true);
  assert pg_temp.catches(a) = n0 + 2, 'flagged insert: a catch';
  update public.apartments set owner_id = null, tenure = null where no = apt;
  delete from public.fishing_battles where id = bid;
  raise notice 'catch provenance ok';
end $$;

-- ---------- B. Progression: a locked map on ordinary travel; the leaderboard ----------
do $$
declare e uuid := pg_temp.u('e'); x uuid := pg_temp.u('x'); r jsonb; tx text := pg_temp.v('tx'); n integer;
begin
  -- 0072's seed (an earlier smoke may have changed it)
  insert into public.map_levels (map, min_level) values ('mo_da', 5) on conflict (map) do update set min_level = 5;
  delete from public.player_progress where account_id = e;
  perform pg_temp.stand(e, 'bai_dat', 748, 268);
  r := public._pos_claim(e, 'mo_da', 44, 200, 'pos_report');
  assert r->'anticheat'->>'why' = 'map_locked' and (r->'anticheat'->>'strike')::int = 0, format('locked %s', r);
  assert (select map from public.player_pos where account_id = e) = 'bai_dat', 'the position stays';
  assert not exists (select 1 from public.anticheat_events where account_id = e), 'not logged';
  insert into public.player_progress (account_id, level, xp) values (e, 5, public._pg_xp_at(5))
  on conflict (account_id) do update set level = 5, xp = excluded.xp;
  assert public._pos_claim(e, 'mo_da', 44, 200, 'pos_report') is null, 'level 5: open';
  assert (select map from public.player_pos where account_id = e) = 'mo_da', 'moved';
  -- the board: the metric's top, banned accounts left out
  n := coalesce((select max(fish_total) from public.player_stats), 0) + 1;
  insert into public.player_stats (account_id, fish_total) values (x, n)
  on conflict (account_id) do update set fish_total = n;
  delete from public.leaderboard_cache;
  r := public.progress_leaderboard(tx, 'fish');
  assert r->'rows'->0->>'id' = x::text and (r->'rows'->0->>'value')::bigint = n, format('top %s', r->'rows'->0);
  update public.accounts set is_banned = true where id = x;
  delete from public.leaderboard_cache;
  r := public.progress_leaderboard(pg_temp.v('ta'), 'fish');
  assert not exists (select 1 from jsonb_array_elements(r->'rows') q where q->>'id' = x::text), 'banned: left out';
  assert jsonb_array_length(r->'rows') <= 20, 'twenty at most';
  update public.accounts set is_banned = false where id = x;
  delete from public.leaderboard_cache;
  assert pg_temp.err(format('select public.progress_leaderboard(%L, %L)', tx, 'nope')) = 'bad board', 'bad board';
  raise notice 'progression ok';
end $$;

-- ---------- C. Quests ----------
do $$
declare a uuid := pg_temp.u('a'); c uuid := pg_temp.u('c'); d uuid := pg_temp.u('d'); q uuid := pg_temp.u('q');
        tc text := pg_temp.v('tc'); td text := pg_temp.v('td'); tq text := pg_temp.v('tq'); cq bigint; i integer; r jsonb;
        code text; dteam uuid; ok boolean;
begin
  -- the company quest: a tenth of the goal per account per day
  update public.company_quests set status = 'done', done_at = now() where status = 'open';
  insert into public.company_quests (seq, title, kind, filter, use_qty, goal, reward_coins, reward_xp)
  values (999, 'smoke', 'smoke_kind', '{}', false, 100, 0, 0) returning id into cq;
  for i in 1 .. 15 loop perform public._game_event(a, 'smoke_kind', 1, '{}'); end loop;
  assert (select qty from public.company_contrib where quest_id = cq and account_id = a) = 10, 'capped at 10 a day';
  assert (select progress from public.company_quests where id = cq) = 10, 'the bar too';
  update public.company_contrib set day = public._vn_today() - 1 where quest_id = cq and account_id = a;   -- a new day
  perform public._game_event(a, 'smoke_kind', 1, '{}');
  assert (select qty from public.company_contrib where quest_id = cq and account_id = a) = 11, 'a new day: more';
  update public.company_quests set status = 'done', done_at = now() where id = cq;
  perform public._company_next(0);
  -- one team per account, across both columns
  delete from public.arena_teams x where x.a in (c, d, q) or x.b in (c, d, q);
  r := public.arena_team_create(tc, 'Team C');
  r := public.arena_team_create(td, 'Team D');
  select id, arena_teams.code into dteam, code from public.arena_teams where arena_teams.a = d;
  assert pg_temp.err(format('select public.arena_team_join(%L, %L)', tc, code)) = 'already in a team', 'a leader cannot join another';
  ok := false;
  begin update public.arena_teams set b = c where id = dteam; exception when others then ok := sqlerrm = 'already in a team'; end;
  assert ok, 'the trigger holds on a direct write too';
  -- the photo log: deleting photos does not reset the window
  for i in 1 .. 12 loop
    r := public.photo_save(tq, 'data:image/jpeg;base64,AAAA', 16, 16, 'hall');
    delete from public.photo_album where account_id = q;
  end loop;
  assert pg_temp.err(format('select public.photo_save(%L, %L, 16, 16, %L)', tq, 'data:image/jpeg;base64,AAAA', 'hall')) = 'too many photos',
    'save-delete does not bypass the limit';
  -- the wipe: quest rows and the team go
  insert into public.quest_progress (account_id, quest_id, period, progress) values (q, 'd_fish5', 'x', 1) on conflict do nothing;
  r := public.arena_team_create(tq, 'Team Q');
  perform public._ac_wipe(q, q);
  assert not exists (select 1 from public.quest_progress where account_id = q), 'wiped quests';
  assert not exists (select 1 from public.photo_save_log where account_id = q), 'wiped log';
  assert not exists (select 1 from public.arena_teams x where x.a = q or x.b = q), 'left the team';
  raise notice 'quests ok';
end $$;

-- ---------- D. Crafting: the dig's timing, the pickaxe at the finish ----------
create or replace function pg_temp.bot(p_seed bigint, p_need integer) returns integer[] language plpgsql as $$
declare rd integer[] := public._mine_round(p_seed, p_need); s integer[] := '{}'; prev integer := 0; best integer; bd integer; d integer;
begin
  for k in 0 .. p_need - 1 loop
    best := null;
    for t in prev + 1 .. prev + rd[1] loop
      d := abs(public._mine_pos(rd[1], t) - rd[k + 2]);
      if best is null or d < bd then best := t; bd := d; end if;
    end loop;
    s := s || best;
    prev := best + 60;                                 -- keeps the rate (4 strikes per 60 ticks) far away
  end loop;
  return s;
end $$;
do $$
declare m uuid := pg_temp.u('m'); t text := pg_temp.v('tm'); room uuid := pg_temp.u('room'); r jsonb; s integer[]; k integer;
        tm jsonb;
begin
  insert into public.player_progress (account_id, level, xp) values (m, 5, public._pg_xp_at(5))
  on conflict (account_id) do update set level = 5, xp = excluded.xp;
  perform public._wallet_lock(m);
  update public.wallets set coins = 100000 where account_id = m;
  perform pg_temp.stand(m, 'mo_da', 120, 282);
  perform public.buy_pickaxe(t, 'pick_da');
  -- the helper: a bot's strikes are all exact, a hand's are not
  tm := public._mine_timing(12345, 3, 90, pg_temp.bot(12345, 3));
  assert (tm->>'hits')::int = 3 and (tm->>'exact')::int = 3, format('bot %s', tm);
  delete from public.anticheat_events where account_id = m;
  for k in 1 .. 5 loop
    perform pg_temp.fresh(m);
    perform pg_temp.stand(m, 'mo_da', 100, 124);
    perform public.mine_state(room, t);
    update public.mine_nodes set item_id = 'ore_dong', ready_at = now() where room_id = room and node_no = 1;
    r := public.mine_start(room, t, 1);
    assert (r->'dig'->>'need')::int = 3, format('a copper dig %s', r->'dig');
    s := pg_temp.bot((r->'dig'->>'seed')::bigint, 3);
    update public.mine_digs set started_at = now() - interval '90 seconds' where account_id = m;
    r := public.mine_finish(room, t, s, s[3] + 1, true);
    if k < 5 then
      assert r->>'result' = 'mined', format('soft %s: %s', k, r - 'state');
    else
      assert r->>'result' = 'lost' and r->'anticheat'->>'code' = 'mine_timing_repeat', format('the 5th %s', r - 'state');
    end if;
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = m and code = 'mine_timing') = 5, 'five soft';
  assert (select plays from public.ac_play_stats where account_id = m and game = 'mine' and day = public._vn_today()) = 5, 'stats';
  -- a pickaxe gone during the dig: nothing mined
  perform pg_temp.fresh(m);
  update public.mine_nodes set item_id = 'ore_da', ready_at = now() where room_id = room and node_no = 1;
  r := public.mine_start(room, t, 1);
  update public.mine_tools set durability = 0 where account_id = m;
  update public.mine_digs set started_at = now() - interval '90 seconds' where account_id = m;
  r := public.mine_finish(room, t, '{}'::int[], 30, false);
  assert r->>'result' = 'lost' and r->>'why' = 'no_pickaxe', format('no pickaxe %s', r - 'state');
  raise notice 'crafting ok';
end $$;

-- ---------- E. Economy: the sweep still runs; listings are serialized per seller ----------
do $$
declare r jsonb;
begin
  r := public.econ_state(pg_temp.v('ta'));
  assert r is not null, 'econ_state';
  assert (select prosrc from pg_proc where proname = '_econ_can_list') like '%pg_advisory_xact_lock%', 'per-seller lock';
  assert (select prosrc from pg_proc where proname = 'shop_rent') ~ 'econ_listings where stall_no = p_stall and status = ''open'' order by id for update',
    'rent: listings before the wallet';
  raise notice 'economy ok';
end $$;

-- ---------- F. Pets: PvP XP only when contested and capped; a pass needs a knock ----------
do $$
declare a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); bid bigint; i integer; lot smallint; n0 bigint;
begin
  delete from public.pet_battles where p1 in (a, b) or p2 in (a, b);
  n0 := (select count(*) from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'pet');
  -- a forfeit before any turn resolved: nothing
  insert into public.pet_battles (mode, status, p1, p2, f1, f2, hp1, hp2, turn)
  values ('pvp', 'active', a, b, '{"kind":"pet","id":0}', '{"kind":"pet","id":0}', 10, 10, 1) returning pet_battles.id into bid;
  perform public._battle_finish(bid, 1::smallint);
  assert (select not rewarded from public.pet_battles where pet_battles.id = bid), 'not rewarded';
  assert (select count(*) from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'pet') = n0, 'no xp';
  -- contested: rewarded, three a day for the pair
  for i in 1 .. 4 loop
    insert into public.pet_battles (mode, status, p1, p2, f1, f2, hp1, hp2, turn)
    values ('pvp', 'active', a, b, '{"kind":"pet","id":0}', '{"kind":"pet","id":0}', 10, 10, 5) returning pet_battles.id into bid;
    perform public._battle_finish(bid, 1::smallint);
    assert (select rewarded from public.pet_battles where pet_battles.id = bid) = (i <= 3), format('pair cap %s', i);
  end loop;
  assert (select count(*) from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'pet') = n0 + 3, 'three';
  -- house_admit: a knock first
  select no into lot from public.house_lots where owner_id is null order by no limit 1;
  update public.house_lots set owner_id = a where no = lot;
  assert pg_temp.err(format('select public.house_admit(%L, %L, true)', pg_temp.v('ta'), b)) = 'no knock', 'no knock, no pass';
  insert into public.house_knocks (lot_no, account_id, at) values (lot, b, now()) on conflict (lot_no, account_id) do update set at = now();
  perform public.house_admit(pg_temp.v('ta'), b, true);
  assert exists (select 1 from public.house_guests where lot_no = lot and account_id = b and until > now()), 'admitted';
  delete from public.house_guests where lot_no = lot;
  update public.house_lots set owner_id = null where no = lot;
  raise notice 'pets ok';
end $$;

-- ---------- G. Fishing battles: the wipe cancels a hosted battle and refunds the others ----------
do $$
declare h uuid := pg_temp.u('h'); i uuid := pg_temp.u('i'); room uuid := pg_temp.u('room'); bid uuid; c0 integer;
begin
  perform public._wallet_lock(i);
  c0 := (select coins from public.wallets where account_id = i);
  insert into public.fishing_battles (room_id, host, fee, duration_s, pot) values (room, h, 100, 180, 200) returning id into bid;
  insert into public.fishing_battle_players (battle_id, account_id) values (bid, h), (bid, i);
  perform public._ac_wipe(h, h);
  assert (select status from public.fishing_battles where id = bid) = 'cancelled', 'the hosted battle is cancelled';
  assert (select coins from public.wallets where account_id = i) = c0 + 100, 'the other player is refunded';
  raise notice 'fishing ok';
end $$;

-- ---------- H. World: a weather boss is its room's; a dungeon run is its party's ----------
do $$
declare w uuid := pg_temp.u('w'); z uuid := pg_temp.u('z'); tw text := pg_temp.v('tw'); tz text := pg_temp.v('tz');
        room2 uuid := pg_temp.u('room2'); f bigint; p bigint; run bigint; r jsonb;
begin
  perform pg_temp.fresh(w);
  perform pg_temp.stand(w, 'pond', 520, 100);
  insert into public.boss_fights (boss, room_key, slot, announce_at, starts_at, ends_at, hp, max_hp)
  values ('thuy_quai', room2, now() - interval '3 hours', now() - interval '2 minutes', now() - interval '1 minute',
          now() + interval '10 minutes', 15000, 15000) returning id into f;
  assert pg_temp.err(format('select public.boss_attack(%L, %s, %L, 520, 100)', tw, f, 'pond')) = 'not in room', 'not a member';
  perform public.join_room((select code from public.rooms where id = room2), 'pw', tw);
  r := public.boss_attack(tw, f, 'pond', 520, 100);
  assert (r->>'dmg')::int > 0, format('a member hits %s', r);
  -- the dungeon: a member who left the party stops
  perform pg_temp.fresh(z);
  perform pg_temp.stand(z, 'bai_dat', 60, 120);
  insert into public.parties (leader) values (w) returning id into p;
  insert into public.party_members (account_id, party_id) values (w, p), (z, p);
  insert into public.dungeon_runs (party_id, leader, mobs, expires_at) values (p, w, '{100}', now() + interval '10 minutes')
  returning id into run;
  insert into public.dungeon_members (run_id, account_id) values (run, z);
  delete from public.party_members where account_id = z;
  assert pg_temp.err(format('select public.dungeon_attack(%L, %s, 1)', tz, run)) = 'not in party', 'left the party';
  raise notice 'world ok';
end $$;

-- ---------- I. Professions: no nghề XP for a fight without stamina; the hammock is claimed ----------
do $$
declare k uuid := pg_temp.u('k'); tk text := pg_temp.v('tk'); mid uuid; r jsonb;
begin
  insert into public.player_stamina (account_id, value, at) values (k, 0, now())
  on conflict (account_id) do update set value = 0, at = now();
  insert into public.fight_matches (kind, p1, params, started_at, sim) values ('exam', k, '{}', now(), '{}') returning id into mid;
  assert exists (select 1 from public.fight_stamina_short where match_id = mid and account_id = k), 'short recorded';
  update public.fight_matches set status = 'done', winner = 1, ended_at = now() where id = mid;
  assert exists (select 1 from public.game_events where account_id = k and kind = 'fight_done' and meta->>'match' = mid::text), 'meta.match';
  assert coalesce((select xp from public.player_professions where account_id = k and prof = 'vo_si'), 0) = 0, 'no nghề xp';
  -- with stamina: the xp comes
  delete from public.player_stamina where account_id = k;
  insert into public.fight_matches (kind, p1, params, started_at, sim) values ('exam', k, '{}', now(), '{}') returning id into mid;
  update public.fight_matches set status = 'done', winner = 1, ended_at = now() where id = mid;
  assert (select xp from public.player_professions where account_id = k and prof = 'vo_si') > 0, 'nghề xp';
  -- resting: only at the hammock
  perform pg_temp.stand(k, 'pond', 300, 356, 0);
  r := public.stamina_tick(tk, 0, true);
  assert not (r->>'resting')::boolean, format('not at the hammock %s', r);
  perform pg_temp.stand(k, 'hall', 140, 220);
  r := public.stamina_tick(tk, 0, true);
  assert (r->>'resting')::boolean, format('at the hammock %s', r);
  raise notice 'professions ok';
end $$;
