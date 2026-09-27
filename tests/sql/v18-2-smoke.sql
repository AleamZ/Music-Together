-- tests/sql/v18-2-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0033 (see the plan),
-- from the repo root: it re-runs 0034 twice with \i. Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0034_rods_nets.sql
\i supabase/migrations/0034_rods_nets.sql
reset client_min_messages;

create temp table rn (k text primary key, v text);
insert into rn select 'tok', token from public.register('rn_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into rn select 'room', room_id::text from public.create_room('Đồ câu', 'pw', (select v from rn where k = 'tok'));

-- 1) the catalog and the pure rules
do $$ begin
  assert (select durability from public.shop_items where id = 'rod_wood') is null, 'rod_wood unbreakable';
  assert (select array_agg(durability order by price) from public.shop_items where kind = 'rod' and price is not null)
         = array[120, 200, 300, 600], 'rod durabilities';
  assert (select rating_g from public.shop_items where id = 'rod_master') = (select max(rating_g) from public.shop_items), 'master heaviest';
  assert (select durability from public.shop_items where id = 'net_small') = 20
     and (select durability from public.shop_items where id = 'net_big') = 30, 'net throws';
  assert public._repair_price(300) = 90 and public._repair_price(1500) = 450 and public._repair_price(5000) = 1500
     and public._repair_price(700) = 210, 'repair price';
  assert public._net_quality(600) = 1 and public._net_quality(0) = 0, 'ring';
  assert public._net_catch(600, array[0, 0, 0, 0, 0], false) = 5, 'full charge, all hits';
  assert public._net_catch(0, array[0, 0, 0, 0, 0], false) = 2, 'no charge';
  assert public._net_catch(600, array[0, 200, 9999, -150, 150], false) = 3, 'two misses';
  assert public._net_catch(0, array[9999, 9999, 9999, 9999, 9999], false) = 0, 'floor 0';
  assert public._net_catch(0, array[0, 0, 0], true) = 1, 'short array: 2 misses; big +1';
  assert public._net_catch(600, array[0, 0, 0, 0, 0], true) = 5, 'big capped 5';
  assert public._net_beat_ms(0) = 550 and public._net_beat_ms(4) = 750 and public._net_beat_ms(7) = 650, 'beat';
end $$;

-- 2) buy a rod: full durability; wear per hook attempt; 0 unequips and blocks equip/cast; repair
do $$ declare r uuid := (select v from rn where k = 'room')::uuid; t text := (select v from rn where k = 'tok');
        a uuid := public._auth_account((select v from rn where k = 'tok')); j jsonb; cid uuid; ok boolean; c0 int; begin
  perform public._fishing_profile(a);
  perform public._wallet_lock(a);
  update public.wallets set coins = 100000 where account_id = a;
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  j := public.buy_item(t, 'rod_bamboo', 1);
  assert j->'state'->'loadout'->>'rod' = 'rod_bamboo', 'equipped';
  assert j->'state'->'wear'->'rod_bamboo' = '[120, 120]'::jsonb, 'full durability';
  -- a caught-or-lost attempt wears 1
  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set bites = true where id = cid;
  j := public.finish_cast(t, cid, false);
  assert j->>'why' = 'gave_up' and j->'state'->'wear'->'rod_bamboo' = '[119, 120]'::jsonb, 'wear 1';
  -- no_bite does not wear
  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set bites = false where id = cid;
  j := public.finish_cast(t, cid, false);
  assert j->>'why' = 'no_bite' and j->'state'->'wear'->'rod_bamboo' = '[119, 120]'::jsonb, 'no_bite free';
  -- the last point breaks it
  update public.inventory set durability = 1 where account_id = a and item_id = 'rod_bamboo';
  update public.fishing_profiles set window_casts = 0, day_casts = 0 where account_id = a;
  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set bites = true where id = cid;
  j := public.finish_cast(t, cid, false);
  assert (j->>'rod_broke')::boolean and j->'state'->'loadout'->>'rod' = 'rod_wood', 'broke → rod_wood';
  assert j->'state'->'owned' ? 'rod_bamboo', 'still in the bag';
  ok := false;
  begin perform public.set_loadout(t, 'rod_bamboo', 'bobber_feather', 'bait_worm'); exception when others then ok := sqlerrm = 'rod broken'; end;
  assert ok, 'equip blocked at 0';
  ok := false;
  update public.fishing_profiles set rod = 'rod_bamboo' where account_id = a;
  begin perform public.start_cast(r, t, 252 / 8, 204 / 8); exception when others then ok := sqlerrm = 'rod broken'; end;
  assert ok, 'cast blocked at 0';
  update public.fishing_profiles set rod = 'rod_wood' where account_id = a;
  ok := false;
  begin perform public.buy_item(t, 'rod_bamboo', 1); exception when others then ok := sqlerrm = 'already owned'; end;
  assert ok, 'rebuy refused';
  c0 := (select coins from public.wallets where account_id = a);
  j := public.repair_rod(t, 'rod_bamboo');
  assert (j->>'cost')::int = 90 and (select coins from public.wallets where account_id = a) = c0 - 90, 'repair charged';
  assert (select reason from public.coin_ledger where account_id = a order by id desc limit 1) = 'repair', 'ledger';
  assert j->'state'->'wear'->'rod_bamboo' = '[120, 120]'::jsonb, 'repaired';
  ok := false;
  begin perform public.repair_rod(t, 'rod_bamboo'); exception when others then ok := sqlerrm = 'not worn'; end;
  assert ok, 'not worn';
  ok := false;
  begin perform public.repair_rod(t, 'rod_wood'); exception when others then ok := sqlerrm = 'item not available'; end;
  assert ok, 'rod_wood not repairable';
  perform public.set_loadout(t, 'rod_bamboo', 'bobber_feather', 'bait_worm');
end $$;

-- 3) overboard: wear 3 and the v18.10 swim immunity
do $$ declare r uuid := (select v from rn where k = 'room')::uuid; t text := (select v from rn where k = 'tok');
        a uuid := public._auth_account((select v from rn where k = 'tok')); j jsonb; cid uuid; d int; begin
  update public.fishing_profiles set window_casts = 0, day_casts = 0 where account_id = a;
  update public.inventory set durability = 120 where account_id = a and item_id = 'rod_bamboo';
  j := public.start_cast(r, t, 252 / 8, 204 / 8);
  cid := (j->>'cast_id')::uuid;
  update public.casts set bites = true, big = true, bite_at = now() - interval '1 second' where id = cid;
  j := public.finish_cast(t, cid, false, true);
  assert j->>'why' = 'overboard', 'overboard';
  assert (select immune_until > now() + interval '9 minutes' from public.heat_state where account_id = a), 'immune';
  d := (select durability from public.inventory where account_id = a and item_id = 'rod_bamboo');
  assert d is null or d = 117, format('wear 3 (%s)', d);
end $$;

-- 4) nets: buy, throw, haul (score + roll), the tug (won: the fish; lost: into the pond), use-up
do $$ declare r uuid := (select v from rn where k = 'room')::uuid; t text := (select v from rn where k = 'tok');
        a uuid := public._auth_account((select v from rn where k = 'tok')); j jsonb; tid uuid; ok boolean; n0 int; begin
  delete from public.fish where account_id = a;
  perform public.buy_item(t, 'bucket_large', 1);
  j := public.buy_item(t, 'net_small', 1);
  assert j->'state'->'owned' ? 'net_small' and j->'state'->'wear'->'net_small' = '[20, 20]'::jsonb, 'net bought';
  ok := false;
  begin perform public.start_net(r, t, 37, 10, 'net_small'); exception when others then ok := sqlerrm = 'bad spot'; end;
  assert ok, 'water refused';
  update public.fishing_profiles set window_casts = 0, day_casts = 0 where account_id = a;
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  tid := (j->>'throw_id')::uuid;
  assert (j->>'beat_ms')::int between 550 and 750 and j->'state'->'wear'->'net_small' = '[19, 20]'::jsonb, 'throw spent';
  j := public.net_haul(t, tid, 600, array[0, 0, 0, 0, 0]);
  assert j->>'why' = 'too_early', 'too fast';
  -- a haul of 4 (one shadow got away), won after the tug
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '5 seconds' where id = tid;
  n0 := (select count(*) from public.fish where account_id = a);
  j := public.net_haul(t, tid, 600, array[0, 0, 0, 9999, 0]);
  assert j->>'result' = 'haul' and (j->>'count')::int = 4 and jsonb_array_length(j->'fish') = 4, format('4 fish (%s)', j->>'count');
  assert (select count(*) from public.fish where account_id = a) = n0, 'not in the bag yet';
  ok := false;
  begin perform public.net_haul(t, tid, 600, array[0, 0, 0, 0, 0]); exception when others then ok := sqlerrm = 'throw not found'; end;
  assert ok, 'one haul';
  j := public.finish_net(t, tid, true);
  assert j->>'why' = 'too_early', 'tug too short';
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '5 seconds' where id = tid;
  j := public.net_haul(t, tid, 600, array[0, 0, 0, 9999, 0]);
  update public.net_throws set hauled_at = now() - interval '3 seconds' where id = tid;
  j := public.finish_net(t, tid, true);
  assert j->>'result' = 'caught' and (j->>'count')::int = 4, 'won: 4 fish';
  assert (select count(*) from public.fish where account_id = a) = n0 + 4, 'fish stored';
  assert (select bool_and(s.rarity <= 2) from public.fish f join public.fish_species s on s.id = f.species_id
           where f.account_id = a), 'common/uncommon only';
  ok := false;
  begin perform public.finish_net(t, tid, true); exception when others then ok := sqlerrm = 'throw not found'; end;
  assert ok, 'single use';
  -- lost the tug: into the pond, no fish, the swim immunity
  update public.heat_state set immune_until = null where account_id = a;
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '5 seconds' where id = tid;
  n0 := (select count(*) from public.fish where account_id = a);
  j := public.net_haul(t, tid, 600, array[0, 0, 0, 0, 0]);
  j := public.finish_net(t, tid, false);
  assert j->>'why' = 'overboard' and (select count(*) from public.fish where account_id = a) = n0, 'lost: no fish';
  assert (select immune_until > now() + interval '9 minutes' from public.heat_state where account_id = a), 'lost: immune';
  -- nothing under the net: empty, no tug
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '5 seconds' where id = tid;
  j := public.net_haul(t, tid, 0, array[9999, 9999, 9999, 9999, 9999]);
  assert j->>'result' = 'empty' and not exists (select 1 from public.net_throws where id = tid), 'empty';
  -- the last throw removes the net
  update public.inventory set durability = 1 where account_id = a and item_id = 'net_small';
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_small');
  assert not (j->'state'->'owned' ? 'net_small'), 'used up';
  ok := false;
  begin perform public.start_net(r, t, 252 / 8, 204 / 8, 'net_small'); exception when others then ok := sqlerrm = 'no net'; end;
  assert ok, 'no net';
end $$;

-- 5) bait_gold and the RPC grants
do $$ begin
  assert (select bite_boost from public.shop_items where id = 'bait_gold') < 1, 'gold boosts';
  assert not has_function_privilege('anon', 'public._rod_wear(uuid, text, integer)', 'execute'), '_rod_wear private';
  assert has_function_privilege('anon', 'public.repair_rod(text, text)', 'execute')
     and has_function_privilege('anon', 'public.finish_net(text, uuid, boolean)', 'execute'), 'RPCs public';
  assert (select count(*) from pg_proc where proname = 'finish_cast') = 1, 'one finish_cast';
end $$;

select 'v18.2 smoke ok';
