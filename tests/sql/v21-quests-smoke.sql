-- tests/sql/v21-quests-smoke.sql — run as the superuser on the throwaway cluster after 0004–0069 and 0071, from the repo
-- root. Re-applies 0071 (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0071_quests.sql
\i supabase/migrations/0071_quests.sql
reset client_min_messages;

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;

update public.anticheat_config set min_client_build = 0;
create temp table qk (k text primary key, v text);
insert into qk select 't1', token from public.register('q1_' || floor(random() * 1e9)::text, 'pw123456');
insert into qk select 't2', token from public.register('q2_' || floor(random() * 1e9)::text, 'pw123456');
insert into qk select 't3', token from public.register('q3_' || floor(random() * 1e9)::text, 'pw123456');
insert into qk select 't4', token from public.register('q4_' || floor(random() * 1e9)::text, 'pw123456');
-- v21 (0070): this smoke checks exact balances, and progression pays rewards on its own (achievements, collections,
-- level-ups — e.g. 'earn_10k' on a 'daily' +100 000). Every account starts with them all unlocked and today's XP
-- buckets full (no XP, no level-up; the level board is untouched).
do $$
begin
  if to_regclass('public.player_progress') is not null then
    insert into public.player_achievements (account_id, achievement)
    select a.id, c.id from public.accounts a cross join public.achievement_catalog c on conflict do nothing;
    insert into public.player_collections (account_id, collection)
    select a.id, c.id from public.accounts a cross join public.collection_catalog c on conflict do nothing;
    insert into public.player_progress (account_id, xp_day, xp_fish, xp_earn, xp_fight, xp_grant)
    select a.id, public._vn_today(), 1000000000, 1000000000, 1000000000, 1000000000 from public.accounts a
    on conflict (account_id) do update set xp_day = excluded.xp_day, xp_fish = excluded.xp_fish, xp_earn = excluded.xp_earn,
                                           xp_fight = excluded.xp_fight, xp_grant = excluded.xp_grant;
  end if;
end $$;
insert into qk select 'a' || substr(k, 2), public._auth_account(v)::text from qk where k like 't_';

-- ---------- 1. Daily / weekly offers, progress only from game_events ----------
do $$
declare t text := (select v from qk where k = 't1'); a uuid := (select v from qk where k = 'a1')::uuid; j jsonb;
        v_daily text[]; v_id text; v_bal integer; n integer;
begin
  select array_agg(x) into v_daily from public._quest_offer('daily', public._vn_today()) x;
  assert array_length(v_daily, 1) = 4, 'four dailies';
  assert (select count(*) from public._quest_offer('weekly', public._vn_today())) = 3, 'three weeklies';
  -- the offer is stable within the day
  assert v_daily = (select array_agg(x) from public._quest_offer('daily', public._vn_today()) x), 'stable offer';
  -- make d_fight part of the day for the test when it is not (swap in a deterministic way: use whatever fish quest is on)
  v_id := v_daily[1];
  j := public.quest_state(t);
  assert jsonb_array_length(j->'quests') >= 7, 'quests listed';
  -- an unknown kind is ignored
  perform public._game_event(a, 'no_such_kind_yet', 5, '{}');
  assert not exists (select 1 from public.quest_progress where account_id = a), 'unknown kind ignored';
  -- feed the first daily until done
  select goal into n from public.quest_defs where id = v_id;
  for i in 1 .. n loop
    perform public._game_event(a, (select kind from public.quest_defs where id = v_id), 1000,
                               (select filter from public.quest_defs where id = v_id));
  end loop;
  assert (select done_at is not null and progress = goal from public.quest_progress p join public.quest_defs d on d.id = p.quest_id
           where account_id = a and quest_id = v_id and period = public._vn_today()::text), 'daily done';
  -- claim pays quest_reward and emits xp_grant + quest_done
  perform public._wallet_lock(a);
  select coins into v_bal from public.wallets where account_id = a;
  j := public.quest_claim(t, v_id);
  assert (j->>'paid')::int = (select reward_coins from public.quest_defs where id = v_id), 'paid';
  assert (select coins from public.wallets where account_id = a) = v_bal + (j->>'paid')::int, 'wallet';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'quest_reward' and ref = v_id), 'ledger';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'quest'), 'xp';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'quest_done' and meta->>'cat' = 'daily'), 'done ev';
  assert pg_temp.err(format('select public.quest_claim(%L, %L)', t, v_id)) = 'already claimed', 'twice';
  assert pg_temp.err(format('select public.quest_claim(%L, %L)', t, v_daily[2])) = 'not done', 'not done';
  -- weekly w_daily10 counted the quest_done when it is on offer this week
  if 'w_daily10' in (select public._quest_offer('weekly', public._vn_today())) then
    assert (select progress from public.quest_progress where account_id = a and quest_id = 'w_daily10') = 1, 'weekly counts';
  end if;
end $$;

-- ---------- 2. NPC chain: accept beside the giver, locked steps, hand in ----------
do $$
declare t text := (select v from qk where k = 't2'); a uuid := (select v from qk where k = 'a2')::uuid; j jsonb;
begin
  assert pg_temp.err(format('select public.quest_accept(%L, %L, 368, 216)', t, 'n_lang_2')) = 'quest locked', 'locked';
  j := public.quest_accept(t, 'n_lang_1', 368, 216);
  assert (select status from jsonb_to_recordset(j->'quests') x(id text, status text) where id = 'n_lang_1') = 'active', 'active';
  -- progress before accept does not count for other npc quests
  perform public._game_event(a, 'fish_catch', 1, '{}');
  perform public._game_event(a, 'fish_catch', 1, '{}');
  perform public._game_event(a, 'fish_catch', 1, '{}');
  assert (select done_at is not null from public.quest_progress where account_id = a and quest_id = 'n_lang_1'), 'npc done';
  -- hand in far from the giver: refused
  assert pg_temp.err(format('select public.quest_claim(%L, %L, 368, 380)', t, 'n_lang_1')) = 'too far', 'far';
  j := public.quest_claim(t, 'n_lang_1', 368, 216);
  assert (j->>'paid')::int = 60, 'npc paid';
  assert (select status from jsonb_to_recordset(j->'quests') x(id text, status text) where id = 'n_lang_2') = 'available', 'next';
  -- a quest of another feature's kind waits for its events
  perform public.quest_accept(t, 'n_lang_2', 368, 216);
end $$;

-- ---------- 3. Explore: the first landing on a map ----------
do $$
declare a uuid := (select v from qk where k = 'a3')::uuid;
begin
  insert into public.player_pos (account_id, map, x, y) values (a, 'hall', 612, 300);
  update public.player_pos set map = 'pond', x = 300, y = 356 where account_id = a;
  update public.player_pos set map = 'hall' where account_id = a;
  update public.player_pos set map = 'pond' where account_id = a;
  assert (select count(*) from public.game_events where account_id = a and kind = 'area_discovered') = 1, 'one discovery';
  assert (select done_at is not null from public.quest_progress where account_id = a and quest_id = 'e_pond'), 'e_pond';
  assert (select progress from public.quest_progress where account_id = a and quest_id = 'e_all') = 1, 'e_all';
end $$;

-- ---------- 4. Company quest ----------
do $$
declare t1 text := (select v from qk where k = 't1'); a1 uuid := (select v from qk where k = 'a1')::uuid;
        a2 uuid := (select v from qk where k = 'a2')::uuid; t4 text := (select v from qk where k = 't4');
        c public.company_quests; j jsonb;
begin
  select * into c from public.company_quests where status = 'open';
  assert c.id is not null, 'an open company quest';
  update public.company_quests set progress = goal - 2 where id = c.id;
  perform public._game_event(a1, c.kind, 1000, c.filter);
  perform public._game_event(a2, c.kind, 1000, c.filter);
  assert (select status from public.company_quests where id = c.id) = 'done', 'company done';
  assert (select count(*) from public.company_quests where status = 'open') = 1, 'next opened';
  j := public.quest_company_claim(t1);
  assert (j->>'paid')::int = c.reward_coins, 'company paid';
  assert pg_temp.err(format('select public.quest_company_claim(%L)', t1)) = 'nothing to claim', 'claimed once';
  assert pg_temp.err(format('select public.quest_company_claim(%L)', t4)) = 'nothing to claim', 'non-contributor';
end $$;

-- ---------- 5. Login calendar ----------
do $$
declare t text := (select v from qk where k = 't3'); a uuid := (select v from qk where k = 'a3')::uuid; j jsonb; v_bal int;
begin
  perform public._wallet_lock(a);
  select coins into v_bal from public.wallets where account_id = a;
  j := public.claim_login_reward(t);
  assert (j->>'claimed')::boolean and (j->>'amount')::int = 20 and (j->>'streak')::int = 1, j::text;
  j := public.claim_login_reward(t);
  assert not (j->>'claimed')::boolean, 'once a day';
  -- the old claim_daily shares the day
  j := public.claim_daily(t);
  assert not (j->>'claimed')::boolean, 'claim_daily shares the day';
  -- a streak: yesterday claimed → day 2
  update public.login_streaks set last_day = public._vn_today() - 1, streak = 6 where account_id = a;
  update public.wallets set daily_on = null where account_id = a;
  j := public.claim_login_reward(t);
  assert (j->>'slot')::int = 7 and (j->>'amount')::int = 150, j::text;
  -- a gap resets
  update public.login_streaks set last_day = public._vn_today() - 3 where account_id = a;
  update public.wallets set daily_on = public._vn_today() where account_id = a;   -- claim_daily already paid today
  j := public.claim_login_reward(t);
  assert (j->>'slot')::int = 1 and (j->>'paid')::int = 0, j::text;
  assert (select coins from public.wallets where account_id = a) = v_bal + 20 + 150, 'streak coins';
end $$;

-- ---------- 6. Album ----------
do $$
declare t text := (select v from qk where k = 't4'); j jsonb; v_id bigint;
begin
  j := public.photo_save(t, 'data:image/jpeg;base64,QUJD', 320, 200, 'hall', 'Sảnh');
  assert jsonb_array_length(j->'photos') = 1, 'saved';
  v_id := (j->'photos'->0->>'id')::bigint;
  assert (public.photo_get(t, v_id))->>'data' = 'data:image/jpeg;base64,QUJD', 'get';
  assert pg_temp.err(format('select public.photo_save(%L, %L, 320, 200, %L)', t, 'data:text/html;base64,QUJD', 'hall')) = 'bad photo', 'mime';
  assert pg_temp.err(format('select public.photo_save(%L, %L, 320, 200, %L)', t, 'data:image/jpeg;base64,' || repeat('A', 150000), 'hall')) = 'bad photo', 'size';
  assert pg_temp.err(format('select public.photo_get(%L, %s)', (select v from qk where k = 't1'), v_id)) = 'unknown photo', 'owner only';
  for i in 1 .. 11 loop perform public.photo_save(t, 'data:image/jpeg;base64,QUJD', 320, 200, 'hall'); end loop;
  assert pg_temp.err(format('select public.photo_save(%L, %L, 320, 200, %L)', t, 'data:image/jpeg;base64,QUJD', 'hall')) = 'too many photos', 'rate';
  update public.photo_album set created_at = now() - interval '1 hour' where account_id = (select v from qk where k = 'a4')::uuid;
  for i in 1 .. 12 loop perform public.photo_save(t, 'data:image/jpeg;base64,QUJD', 320, 200, 'hall'); end loop;
  assert pg_temp.err(format('select public.photo_save(%L, %L, 320, 200, %L)', t, 'data:image/jpeg;base64,QUJD', 'hall')) = 'album full', 'cap';
  j := public.photo_delete(t, v_id);
  assert jsonb_array_length(j->'photos') = 23, 'deleted';
end $$;

-- ---------- 7. 2v2 tag team ----------
do $$
declare t1 text := (select v from qk where k = 't1'); t2 text := (select v from qk where k = 't2');
        t3 text := (select v from qk where k = 't3'); t4 text := (select v from qk where k = 't4');
        a1 uuid := (select v from qk where k = 'a1')::uuid; a2 uuid := (select v from qk where k = 'a2')::uuid;
        a3 uuid := (select v from qk where k = 'a3')::uuid; a4 uuid := (select v from qk where k = 'a4')::uuid;
        j jsonb; ta uuid; tb uuid; s uuid; m uuid; b1 int; b3 int; b4 int;
begin
  update public.wallets set coins = 1000 where account_id in (a1, a2, a3, a4);
  j := public.arena_team_create(t1, 'Đội Rồng');
  ta := (j->'team'->>'id')::uuid;
  perform public.arena_team_join(t2, j->'team'->>'code');
  j := public.arena_team_create(t3, 'Đội Hổ');
  tb := (j->'team'->>'id')::uuid;
  assert pg_temp.err(format('select public.arena_challenge(%L, %L, 100)', t1, tb)) = 'team not full', 'full';
  perform public.arena_team_join(t4, j->'team'->>'code');
  assert pg_temp.err(format('select public.arena_team_join(%L, %L)', t4, j->'team'->>'code')) = 'already in a team', 'one team';
  j := public.arena_challenge(t1, tb, 100);
  s := (j->'series'->0->>'id')::uuid;
  assert (select coins from public.wallets where account_id = a1) = 900, 'stake a';
  assert pg_temp.err(format('select public.arena_accept(%L, %L)', t1, s)) = 'not your challenge', 'own';
  perform public.arena_accept(t3, s);
  assert (select coins from public.wallets where account_id = a3) = 900, 'stake b';
  -- bout 1: A1 beats B1; a match between a wrong pair is ignored
  insert into public.fight_matches (kind, p1, p2, params, started_at, sim, ring) values ('pvp', a2, a3, '{}', now(), '{}', 1) returning id into m;
  update public.fight_matches set status = 'done', winner = 1 where id = m;
  assert (select bout from public.arena_series where id = s) = 1, 'wrong pair ignored';
  insert into public.fight_matches (kind, p1, p2, params, started_at, sim, ring) values ('pvp', a3, a1, '{}', now(), '{}', 1) returning id into m;
  update public.fight_matches set status = 'done', winner = 2 where id = m;
  assert (select score_a from public.arena_series where id = s) = 1, 'bout 1';
  -- bout 2: B2 beats A2; bout 3: A1 beats B2
  insert into public.fight_matches (kind, p1, p2, params, started_at, sim, ring) values ('pvp', a2, a4, '{}', now(), '{}', 1) returning id into m;
  update public.fight_matches set status = 'done', winner = 2 where id = m;
  insert into public.fight_matches (kind, p1, p2, params, started_at, sim, ring) values ('pvp', a1, a4, '{}', now(), '{}', 1) returning id into m;
  update public.fight_matches set status = 'done', winner = 1 where id = m;
  assert (select status = 'done' and winner = ta from public.arena_series where id = s), 'series won';
  assert (select coins from public.wallets where account_id = a1) = 995, 'win a1';
  assert (select coins from public.wallets where account_id = a2) = 1095, 'win a2';
  assert (select rating from public.arena_teams where id = ta) = 1016, 'rating';
  -- an open challenge that is declined is refunded
  j := public.arena_challenge(t3, ta, 50);
  s := (select id from public.arena_series where status = 'open');
  b3 := (select coins from public.wallets where account_id = a3);
  perform public.arena_cancel(t1, s);
  assert (select coins from public.wallets where account_id = a3) = b3 + 50, 'refund';
  -- expiry refunds
  j := public.arena_challenge(t3, ta, 50);
  s := (select id from public.arena_series where status = 'open');
  update public.arena_series set created_at = now() - interval '31 minutes' where id = s;
  perform public.arena_state(t1);
  assert (select status from public.arena_series where id = s) = 'void', 'expired';
  assert (select coins from public.wallets where account_id = a3) = b3 + 50, 'expiry refund';
end $$;

-- ---------- 8. Grants ----------
do $$
begin
  assert not has_table_privilege('anon', 'public.quest_progress', 'select'), 'table private';
  assert not has_table_privilege('anon', 'public.photo_album', 'select'), 'album private';
  assert not has_function_privilege('anon', 'public._quest_on_event()', 'execute'), 'trigger fn private';
  assert not has_function_privilege('anon', 'public._arena_void(uuid, text)', 'execute'), 'void private';
  assert has_function_privilege('anon', 'public.quest_claim(text, text, integer, integer)', 'execute'), 'rpc';
end $$;
select 'v21-quests-smoke ok';
