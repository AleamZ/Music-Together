-- tests/sql/v21-professions-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0069 and
-- 0077, from the repo root. Re-runs 0077 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\i supabase/migrations/0077_professions.sql
\i supabase/migrations/0077_professions.sql
reset client_min_messages;

create temp table ps (k text primary key, v text);
insert into ps select 't', token from public.register('pf_' || floor(random() * 1e9)::text, 'pw123456');
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
insert into ps select 'a', public._auth_account(v)::text from ps where k = 't';

-- 1. catalog, privileges
do $$
begin
  -- 0096 adds tho_san and tieu_phu (on the full chain): 0077's eight, and six nodes for every nghề
  assert (select count(*) from public.profession_catalog where id not in ('tho_san', 'tieu_phu')) = 8, 'eight professions';
  assert (select count(*) from public.skill_nodes) = 6 * (select count(*) from public.profession_catalog), 'six nodes each';
  assert not exists (select prof from public.skill_nodes group by prof having count(*) <> 6), 'six per profession';
  assert not exists (select 1 from public.skill_nodes n join public.skill_nodes r on r.id = n.req where r.prof <> n.prof),
    'prerequisites stay in their tree';
  assert not has_function_privilege('anon', 'public._perk(uuid, text)', 'execute'), '_perk is internal';
  assert not has_function_privilege('anon', 'public._stamina_spend(uuid, numeric, text)', 'execute'), '_stamina_spend is internal';
  assert not has_function_privilege('anon', 'public._buff_grant(uuid, text, numeric, integer)', 'execute'), '_buff_grant is internal';
  assert has_function_privilege('anon', 'public.profession_choose(text, text)', 'execute'), 'choose is public';
  assert not has_table_privilege('anon', 'public.player_buffs', 'select'), 'buffs are private';
  assert public._prof_level(0) = 0 and public._prof_level(99) = 0 and public._prof_level(100) = 1
     and public._prof_level(300) = 2 and public._prof_level(5500) = 10 and public._prof_level(10000000) = 20, 'levels';
end $$;

-- 2. choose, xp from events, learn, perks, switch, reset
do $$
declare t text := (select v from ps where k = 't'); a uuid := (select v from ps where k = 'a')::uuid; j jsonb;
begin
  insert into public.wallets (account_id, coins) values (a, 5000) on conflict (account_id) do update set coins = 5000;
  j := public.profession_choose(t, 'ngu_dan');
  assert j->>'main' = 'ngu_dan', format('main %s', j);
  assert not exists (select 1 from public.coin_ledger where account_id = a and reason = 'profession'), 'first choice free';
  -- 30 catches ×15 (main) = 450 xp → level 2
  for i in 1 .. 30 loop perform public._game_event(a, 'fish_catch', 1, '{}'); end loop;
  assert (select xp from public.player_professions where account_id = a and prof = 'ngu_dan') = 450, 'main xp ×1.5';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'profession_level' and qty = 2), 'level event';
  -- a non-main nghề gets the plain xp
  perform public._game_event(a, 'fight_win', 1, '{}');
  assert (select xp from public.player_professions where account_id = a and prof = 'vo_si') = 15, 'side xp';
  -- earn by reason
  perform public._game_event(a, 'earn', 500, '{"reason":"rice_sell"}');
  assert (select xp from public.player_professions where account_id = a and prof = 'nong_dan') = 8, 'earn reason xp';
  -- the daily cap
  update public.player_professions set day_xp = 1995 where account_id = a and prof = 'vo_si';
  perform public._game_event(a, 'fight_win', 1, '{}');
  assert (select xp from public.player_professions where account_id = a and prof = 'vo_si') = 20, 'capped at 2000 a day';
  -- learn: 2 points
  begin perform public.skill_learn(t, 'f_eye'); assert false, 'prereq'; exception when sqlstate '53400' then assert sqlerrm = 'skill locked', sqlerrm; end;
  j := public.skill_learn(t, 'f_hand');
  j := public.skill_learn(t, 'f_sell');
  begin perform public.skill_learn(t, 'f_stam'); assert false, 'points'; exception when sqlstate '53400' then assert sqlerrm = 'not enough points', sqlerrm; end;
  assert public._perk(a, 'fish_effort_pct') = 15 and public._perk(a, 'fish_sell_pct') = 5, 'perks of the main';
  -- fish sale bonus 5 % through the ledger
  perform public._pay(a, 1000, 'sell', '3 con');
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'sell' and delta = 50 and ref = 'perk: fish_sell_pct'),
    'fish sell bonus';
  assert (select coins from public.wallets where account_id = a) = 6050, 'paid';
  -- fashion refunds are not fish
  perform public._pay(a, 1000, 'sell', 'fashion: x');
  assert (select count(*) from public.coin_ledger where account_id = a and ref like 'perk:%') = 1, 'fashion no bonus';
  -- the perk payment gave no merchant xp twice (the bonus is no deed)
  assert (select xp from public.player_professions where account_id = a and prof = 'thuong_nhan') = 4, 'merchant xp 2 per sale, not the bonus';
  -- fishing effort lowered 15 %
  insert into public.vitals (account_id, hunger, thirst) values (a, 50, 50) on conflict (account_id) do update set hunger = 50, thirst = 50, fainted_until = null;
  perform public._fishing_effort(a, 10, 10);
  assert (select hunger from public.vitals where account_id = a) = 41.5, 'effort perk';
  -- switch: cooldown, then a fee; perks follow the main
  begin perform public.profession_choose(t, 'vo_si'); assert false, 'cooldown'; exception when sqlstate '53400' then assert sqlerrm = 'switch cooldown', sqlerrm; end;
  update public.player_profession_main set chosen_at = now() - interval '25 hours' where account_id = a;
  j := public.profession_choose(t, 'vo_si');
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'profession' and delta = -500), 'switch fee';
  assert public._perk(a, 'fish_sell_pct') = 0, 'old perks off';
  -- reset
  j := public.skill_reset(t, 'ngu_dan');
  assert not exists (select 1 from public.player_skills where account_id = a), 'reset';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'skill_reset' and delta = -300), 'reset fee';
  -- rebate: dojo 10 % for vo_si with v_dojo (1 point from 20 xp? level 0) → give xp
  update public.player_professions set xp = 300 where account_id = a and prof = 'vo_si';
  j := public.skill_learn(t, 'v_dojo');
  perform public._pay(a, -1000, 'dojo_tuition', 'dojo');
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'dojo_tuition' and delta = 100), 'dojo rebate';
  -- the daily perk cap
  update public.perk_payouts set paid = 2990 where account_id = a;
  perform public._pay(a, -1000, 'dojo_tuition', 'dojo');
  assert (select paid from public.perk_payouts where account_id = a) = 3000, 'capped 3000';
  raise notice 'professions ok';
end $$;

-- 3. stamina and buffs
do $$
declare t text := (select v from ps where k = 't'); a uuid := (select v from ps where k = 'a')::uuid; j jsonb; v numeric;
        room uuid;
begin
  delete from public.player_stamina where account_id = a;
  v := public._stamina_spend(a, 30);
  assert v = 70, format('spend %s', v);
  begin perform public._stamina_spend(a, 80); assert false, 'tired'; exception when sqlstate '53400' then assert sqlerrm = 'too tired', sqlerrm; end;
  assert public._stamina_drain(a, 500) = 0, 'drain clamps';
  -- regen 100 per 10 min
  update public.player_stamina set value = 0, at = now() - interval '60 seconds' where account_id = a;
  assert (public._stamina_settle(a)).value between 9.99 and 10.01, 'regen 10 a minute';
  -- a fight perk: v_wind 25 % (vo_si main)
  update public.player_professions set xp = 5500 where account_id = a and prof = 'vo_si';
  perform public.skill_learn(t, 'v_wind');
  update public.player_stamina set value = 100, at = now() where account_id = a;
  assert public._stamina_spend(a, 8, 'fight') = 94, 'fight perk';
  -- food: a bún bò buys strength 20 for 30 min, which cuts the fight cost further
  insert into public.wallets (account_id, coins) values (a, 5000) on conflict (account_id) do update set coins = 5000;
  j := public.eat_meal(t, 'bun_bo');
  assert public._buff(a, 'strength') = 20, format('strength %s', public._buff(a, 'strength'));
  assert (select until from public.player_buffs where account_id = a and kind = 'strength') between now() + interval '29 minutes' and now() + interval '31 minutes', 'duration';
  update public.player_stamina set value = 100, at = now() where account_id = a;
  assert public._stamina_spend(a, 8, 'fight') = 95.6, 'fight perk + strength';
  -- the cap per key and the merge
  perform public._buff_grant(a, 'speed', 50, 10);
  assert public._buff(a, 'speed') = 10, 'speed capped';
  perform public._buff_grant(a, 'speed', 5, 60);
  assert (select count(*) from public.player_buffs where account_id = a and kind = 'speed') = 1, 'merged';
  -- motel sleep refills
  update public.player_stamina set value = 5, at = now() where account_id = a;
  insert into public.rest_state (account_id) values (a) on conflict do nothing;
  update public.rest_state set slept_at = now(), buff_until = now() + interval '24 hours' where account_id = a;
  assert (public._stamina_settle(a)).value = public._stamina_max(a), 'sleep refills';
  assert public._stamina_max(a) = 100, 'no stamina_max perk yet';
  assert round(public._stamina_rate(a, false), 6) = 0.25, format('rest x1.5 %s', public._stamina_rate(a, false));
  -- the tick: run drains ≤ elapsed; resting honoured only in the hall
  update public.player_stamina set value = 100, at = now(), tick_at = now() - interval '10 seconds' where account_id = a;
  j := public.stamina_tick(t, 60000, false);
  assert (j->>'value')::numeric between 89.9 and 90.2, format('run capped by elapsed %s', j);
  insert into public.player_pos (account_id, map, x, y) values (a, 'hall', 100, 100)
  on conflict (account_id) do update set map = 'hall';
  j := public.stamina_tick(t, 0, true);
  assert (j->>'resting')::boolean, 'resting in the hall';
  update public.player_pos set map = 'pond' where account_id = a;
  j := public.stamina_tick(t, 0, false);
  assert not (j->>'resting')::boolean, 'up';
  -- a cast: stamina and a guaranteed luck upgrade (rare_fish 30 + luck 30 → capped 40 %: run many)
  update public.player_stamina set value = 2, at = now() where account_id = a;
  begin
    insert into public.casts (account_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
    values (a, (select id from public.fish_species where rarity = 1 limit 1), 100, 2000, now(), now() + interval '1 minute');
    assert false, 'tired cast';
  exception when sqlstate '53400' then assert sqlerrm = 'too tired', sqlerrm;
  end;
  j := public.profession_state(t);
  assert j ? 'profs' and jsonb_array_length(j->'profs') = (select count(*) from public.profession_catalog) and j->'stamina' ? 'max', format('state %s', j);
  -- a wipe clears it
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot) values (a, 'x', a, '{}');
  assert not exists (select 1 from public.player_profession_main where account_id = a), 'wiped';
  raise notice 'stamina ok';
end $$;

-- 4. the rare-fish upgrade (statistical: 400 casts at 30 %)
do $$
declare a uuid := (select v from ps where k = 'a')::uuid; n int := 0; r smallint;
begin
  perform public._buff_grant(a, 'rare_fish', 30, 30);
  for i in 1 .. 400 loop
    update public.player_stamina set value = 100, at = now() where account_id = a;
    delete from public.casts where account_id = a;
    insert into public.casts (account_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
    values (a, (select id from public.fish_species where rarity = 1 order by id limit 1), 100, 2000, now(), now() + interval '1 minute');
    select s.rarity into r from public.casts c join public.fish_species s on s.id = c.species_id where c.account_id = a;
    if r = 2 then n := n + 1; end if;
  end loop;
  assert n between 75 and 170, format('upgrades %s / 400', n);
  delete from public.casts where account_id = a;
  raise notice 'luck ok (% / 400)', n;
end $$;

-- 5. a dig (0072's mine_digs, when present) costs 4 stamina
do $$
declare a uuid := (select v from ps where k = 'a')::uuid;
begin
  if to_regclass('public.mine_digs') is null then raise notice 'no mine_digs: skipped'; return; end if;
  update public.player_stamina set value = 1, at = now() where account_id = a;
  begin
    execute 'insert into public.mine_digs (account_id, room_id, node_no, item_id, tool_id, seed, need, win)
             values ($1, gen_random_uuid(), 1, (select id from public.craft_items limit 1), ''x'', 1, 1, 1)' using a;
    assert false, 'tired dig';
  exception when sqlstate '53400' then assert sqlerrm = 'too tired', sqlerrm;
  end;
  raise notice 'dig stamina ok';
end $$;
