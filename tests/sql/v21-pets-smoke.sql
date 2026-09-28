-- tests/sql/v21-pets-smoke.sql — v21 group "pets" (0074_pets_aquarium.sql). Run as the superuser on the throwaway
-- PostgreSQL cluster after the full chain (0004 … 0069, 0074), from the repo root. It re-runs 0074 with \i (re-runnable).
-- Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0074_pets_aquarium.sql
\i supabase/migrations/0074_pets_aquarium.sql
reset client_min_messages;

create temp table v2_acct (n int, acct_id uuid, tok text);
insert into v2_acct select 1, public._auth_account(token), token from public.register('pv2a_' || floor(random() * 1e9)::text, 'pw123456');
insert into v2_acct select 2, public._auth_account(token), token from public.register('pv2b_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare r record; begin
  for r in select * from v2_acct loop
    perform public._wallet_lock(r.acct_id);
    perform public._pay(r.acct_id, 200000, 'daily', 'seed');
  end loop;
end $$;

-- 1) gacha: 1500 xu, a pet with a rarity, the ledger reason, the event; too soon; pity forces a Legendary+
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  c0 int; j jsonb; ok boolean; begin
  select coins into c0 from public.wallets where account_id = a;
  j := public.pet_gacha_roll(t);
  assert (j->>'coins')::int = c0 - 1500, 'egg costs 1500';
  assert (j->'rolled'->>'rarity')::int between 1 and 5, 'rarity';
  assert jsonb_array_length(j->'pets') = 1 and (j->'pets'->0->>'level')::int = 1, 'one pet, level 1';
  assert (j->>'active')::bigint = (j->>'pet_id')::bigint, 'first pet follows';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'pet_gacha'), 'ledger pet_gacha';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'pet_gacha'), 'event pet_gacha';
  ok := false; begin perform public.pet_gacha_roll(t); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'gacha rate limit';
  update public.pet_owner set gacha_at = null, pity = 39 where account_id = a;
  j := public.pet_gacha_roll(t);
  assert (j->'rolled'->>'rarity')::int >= 4, 'pity gives Legendary+';
  assert (j->>'pity')::int = 0, 'pity resets';
  assert public._gacha_tier(0.001) = 5 and public._gacha_tier(0.01) = 4 and public._gacha_tier(0.1) = 3
     and public._gacha_tier(0.3) = 2 and public._gacha_tier(0.9) = 1, 'tiers';
end $$;

-- 2) care: pat (+2 affection, +3 xp, cooldown), feed (+3 affection, +5 xp), the daily cap
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  pid bigint; j jsonb; ok boolean; p public.pets; begin
  select id into pid from public.pets where account_id = a order by id limit 1;
  j := public.pet_pat(t, pid);
  select * into p from public.pets where id = pid;
  assert p.affection = 2 and p.xp = 3, 'pat: ' || p.affection || '/' || p.xp;
  ok := false; begin perform public.pet_pat(t, pid); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'pat cooldown';
  insert into public.pet_items (account_id, item_id, qty) values (a, 'food_' || p.species, 5)
  on conflict (account_id, item_id) do update set qty = 5;
  perform public.pet_feed(t, pid);
  select * into p from public.pets where id = pid;
  assert p.affection = 5 and p.xp = 8, 'feed: ' || p.affection || '/' || p.xp;
  -- the cap: 300 a day
  update public.pet_owner set xp_day = public._vn_today(), xp_today = 299 where account_id = a;
  assert public._pet_care_xp(a, pid, 10) = 1, 'cap leaves 1';
  assert public._pet_care_xp(a, pid, 10) = 0, 'cap reached';
  update public.pet_owner set xp_today = 0 where account_id = a;
end $$;

-- 3) levels and events: 20 × level per level, pet_levelup and xp_grant {"source":"pet"}
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); pid bigint; p public.pets; begin
  select id into pid from public.pets where account_id = a order by id limit 1;
  update public.pets set level = 1, xp = 0 where id = pid;
  perform public._fighter_gain_xp('pet', pid, 20 + 40 + 5);        -- 1→2 (20), 2→3 (40), 5 left
  select * into p from public.pets where id = pid;
  assert p.level = 3 and p.xp = 5, 'level 3: ' || p.level || '/' || p.xp;
  assert exists (select 1 from public.game_events where account_id = a and kind = 'pet_levelup' and qty = 3), 'pet_levelup';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'pet' and qty = 20), 'xp_grant';
end $$;

-- 4) evolution: level and affection gates, form 1, pet_evolved
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  pid bigint; ok boolean; j jsonb; begin
  select id into pid from public.pets where account_id = a order by id limit 1;
  ok := false; begin perform public.pet_evolve(t, pid); exception when others then ok := sqlerrm = 'level too low'; end;
  assert ok, 'evolve needs level 10';
  update public.pets set level = 10 where id = pid;
  ok := false; begin perform public.pet_evolve(t, pid); exception when others then ok := sqlerrm = 'affection too low'; end;
  assert ok, 'evolve needs affection 40';
  update public.pets set affection = 40 where id = pid;
  j := public.pet_evolve(t, pid);
  assert (select form from public.pets where id = pid) = 1, 'form 1';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'pet_evolved' and qty = 1), 'pet_evolved';
  assert (j->'pets'->0->'stats'->>'hp')::int > 0, 'stats in the state';
end $$;

-- 5) following XP: an activity event gives the following pet 2 XP, at most once per 5 s; own kinds do not
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); pid bigint; x0 int; x1 int; begin
  select active_pet into pid from public.pet_owner where account_id = a;
  update public.pets set fullness = 90, stats_at = now() where id = pid;
  update public.pet_owner set follow_at = null where account_id = a;
  select xp + 1000 * level into x0 from public.pets where id = pid;
  perform public._game_event(a, 'ore_mined', 1, '{}');
  select xp + 1000 * level into x1 from public.pets where id = pid;
  assert x1 = x0 + 2, 'follow xp ' || x0 || ' → ' || x1;
  perform public._game_event(a, 'ore_mined', 1, '{}');
  assert (select xp + 1000 * level from public.pets where id = pid) = x1, '5 s throttle';
  update public.pet_owner set follow_at = null where account_id = a;
  perform public._game_event(a, 'pet_levelup', 1, '{}');
  perform public._game_event(a, 'earn', 10, '{}');
  assert (select xp + 1000 * level from public.pets where id = pid) = x1, 'own kinds ignored';
end $$;

-- 6) battle fish: rarity ≥ 3 only, max 6, leaves the bag
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid(); ok boolean; j jsonb; begin
  insert into public.fish (id, account_id, species_id, weight_g, price) values (f1, a, 'ca_ro', 200, 10), (f2, a, 'ca_ho', 20000, 4000);
  ok := false; begin perform public.fish_to_fighter(t, f1); exception when others then ok := sqlerrm = 'not rare'; end;
  assert ok, 'common fish refused';
  j := public.fish_to_fighter(t, f2);
  assert jsonb_array_length(j->'fish') = 1 and j->'fish'->0->>'species_id' = 'ca_ho', 'fighter kept';
  assert j->'fish'->0->'skills' ? 'bite', 'rarity 5 knows bite';
  assert not exists (select 1 from public.fish where id = f2), 'left the bag';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'fish_fighter_new'), 'event';
end $$;

-- 7) training and skills: costs, reasons, cooldown, caps, gates
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  pid bigint; fid bigint; c0 int; j jsonb; ok boolean; begin
  select active_pet into pid from public.pet_owner where account_id = a;
  select id into fid from public.fish_fighters where account_id = a;
  select coins into c0 from public.wallets where account_id = a;
  j := public.fighter_train(t, 'pet', pid, 'atk');
  assert (j->>'coins')::int = c0 - 100, 'first point 100';
  assert (select trn_atk from public.pets where id = pid) = 1, 'atk +1';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'pet_train'), 'pet_train reason';
  ok := false; begin perform public.fighter_train(t, 'pet', pid, 'atk'); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'train cooldown';
  update public.pets set train_at = null, trn_def = 5 + level where id = pid;
  ok := false; begin perform public.fighter_train(t, 'pet', pid, 'def'); exception when others then ok := sqlerrm = 'train cap'; end;
  assert ok, 'train cap';
  j := public.fighter_train(t, 'fish', fid, 'hp');
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'fish_battle'), 'fish training reason';
  ok := false; begin perform public.fighter_learn(t, 'pet', pid, 'ultimate'); exception when others then ok := sqlerrm = 'level too low'; end;
  assert ok, 'ultimate needs level 15';
  ok := false; begin perform public.fighter_learn(t, 'fish', fid, 'heal'); exception when others then ok := sqlerrm = 'wrong kind'; end;
  assert ok, 'fish cannot heal';
  j := public.fighter_learn(t, 'pet', pid, 'bite');
  assert (select 'bite' = any(skills) from public.pets where id = pid), 'bite learnt';
  ok := false; begin perform public.fighter_learn(t, 'pet', pid, 'bite'); exception when others then ok := sqlerrm = 'already known'; end;
  assert ok, 'known';
end $$;

-- 8) PvE: the damage formula, a full battle to the end, the reward and the events
do $$ begin
  assert public._battle_dmg(10, 10, 10, 0.5, false, false) = 11, 'dmg ' || public._battle_dmg(10, 10, 10, 0.5, false, false);
  assert public._battle_dmg(10, 10, 10, 0.5, true, false) = 17, 'crit';
  assert public._battle_dmg(10, 10, 10, 0.5, false, true) = 4, 'guarded';
  assert public._battle_dmg(1, 1, 1000, 0, false, true) = 1, 'at least 1';
end $$;
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  pid bigint; j jsonb; bid bigint; k int := 0; ok boolean; c0 int; b public.pet_battles; begin
  select active_pet into pid from public.pet_owner where account_id = a;
  update public.pets set fullness = 100, happy = 100, stats_at = now(), level = 30, trn_atk = 20 where id = pid;
  ok := false; begin perform public.battle_start_pve(t, 'pet', pid, 'rong_lua'); exception when others then ok := sqlerrm = 'unknown npc'; end;
  assert ok, 'unknown npc';
  select coins into c0 from public.wallets where account_id = a;
  j := public.battle_start_pve(t, 'pet', pid, 'meo_hoang');
  bid := (j->'battle'->>'id')::bigint;
  assert j->'battle'->>'mode' = 'pve' and (j->'battle'->>'side')::int = 1, 'pve started';
  assert (select fullness from public.pets where id = pid) between 91 and 92.1, 'the battle costs 8 no';
  ok := false; begin perform public.battle_start_pve(t, 'pet', pid, 'meo_hoang'); exception when others then ok := sqlerrm = 'in battle'; end;
  assert ok, 'one battle at a time';
  ok := false; begin perform public.battle_act(t, bid, 'fury'); exception when others then ok := sqlerrm = 'unknown skill'; end;
  assert ok, 'only known skills';
  loop
    k := k + 1;
    update public.pet_battles set acted_at = now() - interval '1 second' where id = bid;
    j := public.battle_act(t, bid, 'bite');
    exit when j->'battle_now'->>'status' = 'done' or k > 40;
    assert jsonb_array_length(j->'battle_now'->'log') between 1 and 2, 'turn log';
  end loop;
  select * into b from public.pet_battles where id = bid;
  assert b.status = 'done' and b.winner = 1, 'a level-30 pet beats the wild cat (winner ' || coalesce(b.winner, -1) || ')';
  assert b.reward = 40 and (select coins from public.wallets where account_id = a) = c0 + 40, 'reward 40';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'pet_battle' and delta = 40), 'pet_battle reason';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'pet_battle_win'), 'pet_battle_win';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'xp_grant' and qty = 15), 'xp_grant 15';
  -- paid wins stop after 10 a day
  update public.pet_owner set wins_today = 10 where account_id = a;
  update public.pets set fullness = 100, stats_at = now() where id = pid;
  j := public.battle_start_pve(t, 'pet', pid, 'meo_hoang');
  bid := (j->'battle'->>'id')::bigint;
  perform public._battle_finish(bid, 1::smallint);
  assert (select reward from public.pet_battles where id = bid) = 0, 'no pay after 10 wins';
  -- an idle battle ends as a loss
  update public.pets set fullness = 100, stats_at = now() where id = pid;
  j := public.battle_start_pve(t, 'pet', pid, 'meo_hoang');
  bid := (j->'battle'->>'id')::bigint;
  update public.pet_battles set acted_at = now() - interval '3 minutes' where id = bid;
  j := public.battle_state(t, null);
  assert (select status = 'done' and winner = 2 from public.pet_battles where id = bid), 'timeout loss';
end $$;

-- 9) PvP: same room, escrow at accept, both pick, the pot less 10 %
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); ta text := (select tok from v2_acct where n = 1);
  b2 uuid := (select acct_id from v2_acct where n = 2); tb text := (select tok from v2_acct where n = 2);
  v_room uuid; pa bigint; pb bigint; j jsonb; bid bigint; ok boolean; ca int; cb int; k int := 0; bt public.pet_battles; begin
  select r.room_id into v_room from public.create_room('pv2 room', 'pw', ta) r;
  if v_room is null then select room_id into v_room from public.members where account_id = a limit 1; end if;
  insert into public.members (room_id, account_id) values (v_room, b2) on conflict do nothing;
  select active_pet into pa from public.pet_owner where account_id = a;
  perform public.pet_buy(tb, 'cho', 'vang');
  select id into pb from public.pets where account_id = b2 limit 1;
  update public.pets set fullness = 100, stats_at = now() where id in (pa, pb);
  ok := false; begin perform public.battle_challenge(ta, v_room, a, 'pet', pa, 100); exception when others then ok := sqlerrm = 'bad target'; end;
  assert ok, 'no self challenge';
  ok := false; begin perform public.battle_challenge(ta, v_room, b2, 'pet', pa, 5000); exception when others then ok := sqlerrm = 'bad stake'; end;
  assert ok, 'stake cap';
  j := public.battle_challenge(ta, v_room, b2, 'pet', pa, 500);
  assert j->'outgoing'->>'stake' = '500', 'outgoing';
  j := public.battle_state(tb, v_room);
  assert jsonb_array_length(j->'incoming') = 1, 'incoming';
  assert j->'rivals' @> jsonb_build_array(jsonb_build_object('id', a)), 'rival listed';
  bid := (j->'incoming'->0->>'id')::bigint;
  select coins into ca from public.wallets where account_id = a;
  select coins into cb from public.wallets where account_id = b2;
  j := public.battle_accept(tb, bid, 'pet', pb);
  assert (select coins from public.wallets where account_id = a) = ca - 500 and (select coins from public.wallets where account_id = b2) = cb - 500, 'escrow';
  j := public.battle_act(ta, bid, 'tackle');
  assert (j->'battle_now'->>'acted')::boolean and not (j->'battle_now'->>'foe_acted')::boolean, 'waiting for the foe';
  j := public.battle_state(tb, null);
  assert (j->'battle'->>'foe_acted')::boolean and j->'battle' ? 'f1' and not (j->'battle' ? 'a1'), 'the pick stays hidden';
  loop
    k := k + 1;
    j := public.battle_act(tb, bid, 'tackle');
    exit when j->'battle_now'->>'status' = 'done' or k > 40;
    j := public.battle_act(ta, bid, 'bite');
    exit when j->'battle_now'->>'status' = 'done';
  end loop;
  select * into bt from public.pet_battles where id = bid;
  assert bt.status = 'done' and bt.winner in (0, 1, 2), 'pvp done';
  if bt.winner = 1 then
    assert (select coins from public.wallets where account_id = a) = ca - 500 + 900, 'pot less 10 %';
  elsif bt.winner = 2 then
    assert (select coins from public.wallets where account_id = b2) = cb - 500 + 900, 'pot less 10 % (b)';
  end if;
  -- a forfeit
  update public.pets set fullness = 100, stats_at = now() where id in (pa, pb);
  j := public.battle_challenge(tb, v_room, a, 'pet', pb, 0);
  j := public.battle_state(ta, null);
  bid := (j->'incoming'->0->>'id')::bigint;
  perform public.battle_accept(ta, bid, 'pet', pa);
  perform public.battle_forfeit(ta, bid);
  assert (select winner from public.pet_battles where id = bid) = 1, 'forfeit: the challenger (side 1) wins';
end $$;

-- 10) the aquarium: placed tank, capacity, bag moves, decor, the visitor's view
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  tb text := (select tok from v2_acct where n = 2); tank bigint; fx uuid := gen_random_uuid(); j jsonb; ok boolean; v_room uuid; begin
  delete from public.furniture_items where apt_no = 7;                -- re-runnable
  update public.apartments set owner_id = a, tenure = 'own', visibility = 'private' where no = 7;
  j := public.furniture_buy(t, 'aquarium');
  select id into tank from public.furniture_items where account_id = a and item_id = 'aquarium' order by id desc limit 1;
  insert into public.fish (id, account_id, species_id, weight_g, price) values (fx, a, 'ca_he_vang', 900, 150);
  ok := false; begin perform public.aquarium_put(t, tank, fx); exception when others then ok := sqlerrm = 'not placed'; end;
  assert ok, 'a stored tank takes no fish';
  update public.furniture_items set apt_no = 7, x = 1, y = 3 where id = tank;
  j := public.aquarium_put(t, tank, fx);
  assert jsonb_array_length(j->'tanks'->0->'fish') = 1 and (j->'tanks'->0->>'cap')::int = 4, 'fish in the tank';
  assert not exists (select 1 from public.fish where id = fx), 'out of the bag';
  j := public.aquarium_decor(t, tank, 'lau_dai', true);
  assert j->'tanks'->0->'decor' = '["lau_dai"]'::jsonb, 'decor';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'aquarium' and delta = -400), 'aquarium reason';
  -- a visitor: refused while private, sees the showcase once admitted (no fish ids)
  select room_id into v_room from public.members where account_id = a limit 1;
  ok := false; begin perform public.aquarium_view(tb, v_room, 'apt', 7); exception when others then ok := sqlerrm = 'no access'; end;
  assert ok, 'private home';
  update public.apartments set visibility = 'open' where no = 7;
  j := public.aquarium_view(tb, v_room, 'apt', 7);
  assert jsonb_array_length(j->'tanks') = 1 and j->'tanks'->0->'fish'->0->'id' = 'null'::jsonb, 'visitor view';
  assert j->'showcase'->0->>'species_id' = 'ca_he_vang', 'rare showcase';
  delete from public.fish where account_id = a;                      -- the bag holds 1 without a bucket
  j := public.aquarium_take(t, fx);
  assert exists (select 1 from public.fish where id = fx and account_id = a), 'back in the bag';
  ok := false; begin perform public.aquarium_put(tb, tank, fx); exception when others then ok := sqlerrm = 'not your tank'; end;
  assert ok, 'not your tank';
  update public.apartments set owner_id = null, tenure = null where no = 7;
end $$;

-- 11) houses: knock → admit → enter
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); t text := (select tok from v2_acct where n = 1);
  b2 uuid := (select acct_id from v2_acct where n = 2); tb text := (select tok from v2_acct where n = 2); j jsonb; begin
  update public.house_lots set owner_id = a, grid = coalesce(grid, repeat('.', 280)), visibility = 'private' where no = 1;
  assert not public._house_can_enter(b2, null, 1::smallint), 'private house';
  assert public.house_knock(tb, null, 1), 'knock';
  j := public.house_knocks(t);
  assert jsonb_array_length(j->'knocks') = 1, 'the owner sees the knock';
  j := public.house_admit(t, b2, true);
  assert jsonb_array_length(j->'knocks') = 0 and jsonb_array_length(j->'guests') = 1, 'admitted';
  assert public._house_can_enter(b2, null, 1::smallint), 'guest may enter';
  j := public.house_admit(t, b2, false);
  assert not public._house_can_enter(b2, null, 1::smallint), 'pass revoked';
  update public.house_lots set owner_id = null where no = 1;
end $$;

-- 12) the catalogs and the guards: skills, NPCs, new furniture kinds; every new RPC calls the lock gate
do $$ begin
  assert (select count(*) from public.pet_skill_catalog) = 7 and (select count(*) from public.pet_npc_catalog) = 6, 'catalogs';
  assert (select cap from public.furniture_catalog where id = 'aquarium_big') = 8, 'big tank 8';
  assert (select count(*) from public.furniture_catalog where kind in ('cabinet','painting')) = 6, 'new kinds';
  assert not exists (
    select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname in ('pet_gacha_roll','pet_release','pet_pat','pet_feed','pet_play','pet_evolve','fish_to_fighter',
                        'fish_fighter_release','fighter_train','fighter_learn','battle_state','battle_start_pve',
                        'battle_challenge','battle_accept','battle_decline','battle_act','battle_forfeit','aquarium_mine',
                        'aquarium_put','aquarium_take','aquarium_decor','aquarium_view','house_knock','house_knocks','house_admit')
      and p.prosrc !~ '_ac_account\('), 'every v21 pets RPC is gated';
  assert not exists (
    select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_%'
      and p.proname in ('_pv2','_pet_stats','_fighter_gain_xp','_pet_care_xp','_battle_turn','_battle_finish','_battle_state',
                        '_fighter_snap','_aqua_mine','_house_knocks_json','_pet_ev_follow','_pets_v2_wipe')
      and has_function_privilege('anon', p.oid, 'execute')), 'helpers are private';
end $$;

-- 13) a wipe clears the fish fighters and the battles
do $$ declare a uuid := (select acct_id from v2_acct where n = 1); begin
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot) values (a, 'x', null, '{}');
  assert not exists (select 1 from public.fish_fighters where account_id = a), 'fighters wiped';
  assert not exists (select 1 from public.pet_battles where p1 = a or p2 = a), 'battles wiped';
end $$;

\echo 'v21-pets smoke: all passed'
