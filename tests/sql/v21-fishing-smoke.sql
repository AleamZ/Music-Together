-- tests/sql/v21-fishing-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0069 and 0076,
-- from the repo root: psql -f tests/sql/v21-fishing-smoke.sql. It re-runs 0076 with \i (re-runnable). Every check is an
-- ASSERT; the first failure stops psql. Time passing is simulated by moving timestamps back.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0076_fishing_extras.sql
\i supabase/migrations/0076_fishing_extras.sql
reset client_min_messages;

create temp table fx (k text primary key, v text);
insert into fx select 'ta', token from public.register('fxa_' || floor(random() * 1e9)::text, 'pw123456');
insert into fx select 'tb', token from public.register('fxb_' || floor(random() * 1e9)::text, 'pw123456');
insert into fx select 'a', public._auth_account(v)::text from fx where k = 'ta';
insert into fx select 'b', public._auth_account(v)::text from fx where k = 'tb';
insert into fx select 'room', room_id::text from public.create_room('Fishing extras', 'pw', (select v from fx where k = 'ta'));
insert into fx select 'join', (public.join_room((select code from public.rooms where id = (select v from fx where k = 'room')::uuid), 'pw', (select v from fx where k = 'tb'))).room_id::text;
update public.anticheat_config set mode = 'log';

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from fx where k = key $$;
-- stand somewhere, long enough ago that any claim is reachable
create or replace function pg_temp.stand(acc uuid, m text, x integer, y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (acc, m, x, y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, tab = null, tabs = '{}'
$$;
create or replace function pg_temp.coins(acc uuid) returns integer language sql stable as $$
  select coalesce((select coins from public.wallets where account_id = acc), 0)
$$;
create or replace function pg_temp.fresh(acc uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (acc) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  if to_regclass('public.player_stamina') is not null then                   -- v21 (0077): a cast costs stamina
    execute 'delete from public.player_stamina where account_id = $1' using acc;
  end if;
end $$;

-- ---------- 1. The deep water: pond casts never land a deep fish ----------
do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid; c jsonb;
        d integer[]; i integer;
begin
  -- 0076's six (0086 adds five river species to the deep water)
  assert (select count(*) from public.fish_species where water = 'deep'
           and id not in ('ca_lang', 'ca_ngat', 'ca_dua', 'ca_anh_vu', 'ca_vo_dem')) = 6, 'six deep species';
  assert not exists (select 1 from public.fish_species where water = 'deep' and rarity < 3), 'deep species are rare+';
  assert (select count(distinct rarity) from public.fish_species where water = 'deep') = 3, 'deep 3, 4, 5';
  assert exists (select 1 from pg_trigger where tgname = 'casts_zz_water'), 'the water trigger';
  -- a deep species on a dock cast (a luck trigger's lift) comes back to the pond, the same rarity
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, spot)
  values (a, room, 'ca_tra_dau', 150000, 5000, now(), now() + interval '1 minute', 'dock');
  assert (select s.water = 'pond' and s.rarity = 5 and x.weight_g = s.max_g from public.casts x join public.fish_species s on s.id = x.species_id
           where x.account_id = a), 'dock keeps to the pond';
  delete from public.casts where account_id = a;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, spot)
  values (a, room, 'ca_ho', 10000, 5000, now(), now() + interval '1 minute', 'boat');
  assert (select s.water = 'deep' and s.rarity = 5 and x.weight_g = s.min_g from public.casts x join public.fish_species s on s.id = x.species_id
           where x.account_id = a), 'boat 3+ keeps to the deep';
  delete from public.casts where account_id = a;
  select array[c2, r2] into d from generate_series(0, 79) c2, generate_series(0, 49) r2 where public._pond_spot(c2, r2) = 'dock'
   order by r2, c2 limit 1;
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 99)
  on conflict (account_id, item_id) do update set qty = 99;
  perform pg_temp.stand(a, 'pond', d[1] * 8 + 4, d[2] * 8 + 4);
  for i in 1 .. 60 loop
    perform pg_temp.fresh(a);
    update public.inventory set qty = 99 where account_id = a and item_id = 'bait_worm';
    delete from public.casts where account_id = a;
    c := public.start_cast(room, t, d[1], d[2]);
    assert (select s.water from public.casts x join public.fish_species s on s.id = x.species_id where x.account_id = a) = 'pond',
      format('a pond cast %s', c);
  end loop;
  delete from public.casts where account_id = a;
  raise notice 'pond ok';
end $$;

-- ---------- 2. The boat ----------
do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid; s jsonb; c jsonb;
        h jsonb; f jsonb; i integer; x public.casts; g jsonb := public._boat_geo();
begin
  insert into public.wallets (account_id, coins) values (a, 100) on conflict (account_id) do update set coins = 100;
  perform pg_temp.stand(a, 'pond', 378, 206);
  begin
    perform public.buy_boat(room, t);
    assert false, 'poor';
  exception when others then assert sqlerrm = 'not enough coins', sqlerrm;
  end;
  update public.wallets set coins = 10000 where account_id = a;
  s := public.buy_boat(room, t);
  assert (s->'boat'->>'owned')::boolean and not (s->'boat'->>'aboard')::boolean, format('bought %s', s);
  assert pg_temp.coins(a) = 6000, 'paid 4000';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'boat' and delta = -4000), 'ledger boat';
  begin
    perform public.buy_boat(room, t);
    assert false, 'twice';
  exception when others then assert sqlerrm = 'already owned', sqlerrm;
  end;
  begin
    perform public.start_boat_cast(room, t);
    assert false, 'not aboard';
  exception when others then assert sqlerrm = 'not aboard', sqlerrm;
  end;
  perform pg_temp.fresh(a);
  s := public.board_boat(room, t);
  assert (s->'boat'->>'aboard')::boolean, format('aboard %s', s);
  assert (select pp.map = 'pond' and pp.x = (g->>'deck_x')::int and pp.y = (g->>'deck_y')::int from public.player_pos pp where pp.account_id = a),
    'on the deck';
  for i in 1 .. 40 loop
    perform pg_temp.fresh(a);
    update public.inventory set qty = 99 where account_id = a and item_id = 'bait_worm';
    c := public.start_boat_cast(room, t);
    assert c->>'spot' = 'boat' and not (c ? 'reel_seed'), format('a boat cast %s', c);
    select * into x from public.casts where id = (c->>'cast_id')::uuid;
    assert x.spot = 'boat' and x.reel_seed is not null, 'the cast row';
    assert (select case when rarity >= 3 then water = 'deep' else water = 'pond' end from public.fish_species where id = x.species_id),
      format('the deep roll %s', x.species_id);
  end loop;
  -- the same hook and reel verification: a made-up reel is refused
  update public.casts set bites = true, bite_at = now() - interval '0.5 seconds' where id = x.id;
  h := public.hook_cast(t, x.id);
  assert h->>'result' = 'hooked', format('hooked %s', h);
  update public.casts set hooked_at = now() - interval '30 seconds' where id = x.id;
  f := public.finish_cast(t, x.id, true, false, '{1,2,3}'::integer[], 5);
  assert f->>'result' = 'lost' and f->>'why' = 'reel_invalid', format('a made-up reel %s', f);
  assert not exists (select 1 from public.fish where account_id = a), 'no fish';
  -- walking off the deck ends the trip
  update public.player_pos set x = 300, y = 300 where account_id = a;
  assert not public._boat_aboard(a), 'walked off';
  assert not exists (select 1 from public.boat_trips where account_id = a), 'trip gone';
  perform public.board_boat(room, t);
  s := public.leave_boat(room, t);
  assert not (s->'boat'->>'aboard')::boolean, format('left %s', s);
  delete from public.casts where account_id = a;
  raise notice 'boat ok';
end $$;

-- ---------- 3. Fishing battles ----------
do $$
declare ta text := pg_temp.v('ta'); tb text := pg_temp.v('tb'); a uuid := pg_temp.v('a')::uuid; b uuid := pg_temp.v('b')::uuid;
        room uuid := pg_temp.v('room')::uuid; s jsonb; bid uuid; ca integer; cb integer; bt public.fishing_battles;
begin
  insert into public.wallets (account_id, coins) values (a, 5000) on conflict (account_id) do update set coins = 5000;
  insert into public.wallets (account_id, coins) values (b, 5000) on conflict (account_id) do update set coins = 5000;
  delete from public.fish where account_id in (a, b);
  -- not at the pond
  perform pg_temp.stand(a, 'field', 400, 300);
  begin
    perform public.fb_create(room, ta, 500, 300);
    assert false, 'at the field';
  exception when others then assert sqlerrm = 'not at pond', sqlerrm;
  end;
  update public.player_pos set map = 'pond', at = now() where account_id = a;
  -- a bad fee is a flag, not a battle
  s := public.fb_create(room, ta, 5, 300);
  assert s ? 'anticheat' and not exists (select 1 from public.fishing_battles where host = a), format('bad fee %s', s);
  s := public.fb_create(room, ta, 500, 300);
  bid := (s->'battles'->0->>'id')::uuid;
  assert pg_temp.coins(a) = 4500 and s->'battles'->0->>'status' = 'open', format('created %s', s);
  begin
    perform public.fb_start(room, ta, bid);
    assert false, 'alone';
  exception when others then assert sqlerrm = 'need players', sqlerrm;
  end;
  insert into public.player_pos (account_id, map, x, y, at) values (b, 'pond', 300, 300, now())
  on conflict (account_id) do update set map = 'pond', at = now();
  s := public.fb_join(room, tb, bid);
  assert pg_temp.coins(b) = 4500 and (select pot from public.fishing_battles where id = bid) = 1000, 'joined';
  begin
    perform public.fb_start(room, tb, bid);
    assert false, 'not host';
  exception when others then assert sqlerrm = 'not host', sqlerrm;
  end;
  s := public.fb_start(room, ta, bid);
  assert s->'battles'->0->>'status' = 'live', 'live';
  -- before the start: not counted
  insert into public.fish (account_id, species_id, weight_g, price) values (b, 'ca_ro', 100, 999);
  assert (select score from public.fishing_battle_players where battle_id = bid and account_id = b) = 0, 'before the start';
  update public.fishing_battles set starts_at = now() - interval '1 minute', ends_at = now() + interval '4 minutes' where id = bid;
  insert into public.fish (account_id, species_id, weight_g, price) values (a, 'ca_loc', 1000, 300), (a, 'ca_tra', 2000, 400);
  insert into public.fish (account_id, species_id, weight_g, price) values (b, 'ca_ro', 100, 200);
  -- a fish back from the fridge (its old caught_at) does not count
  insert into public.fish (account_id, species_id, weight_g, price, caught_at) values (b, 'ca_ho', 20000, 5000, now() - interval '2 days');
  assert (select score from public.fishing_battle_players where battle_id = bid and account_id = a) = 700, 'a 700';
  assert (select score from public.fishing_battle_players where battle_id = bid and account_id = b) = 200, 'b 200';
  assert (select best_species from public.fishing_battle_players where battle_id = bid and account_id = a) = 'ca_tra', 'best';
  -- still live: fb_state does not settle
  s := public.fb_state(room, ta);
  assert (select status from public.fishing_battles where id = bid) = 'live', 'still live';
  update public.fishing_battles set ends_at = now() - interval '1 second' where id = bid;
  ca := pg_temp.coins(a); cb := pg_temp.coins(b);
  s := public.fb_state(room, tb);
  select * into bt from public.fishing_battles where id = bid;
  assert bt.status = 'done' and bt.winners = array[a] and bt.prize = 900 and bt.burned = 100, format('settled %s', to_jsonb(bt));
  -- (an xp_grant may pay a v21 level reward on top: count the prize rows)
  assert pg_temp.coins(a) >= ca + 900 and not exists (select 1 from public.coin_ledger where account_id = b and reason = 'fishing_battle_prize'),
    'paid the winner';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'fishing_battle_prize' and delta = 900), 'prize';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'fishing_battle_win' and qty = 900), 'win event';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'fishing'), 'xp';
  -- settled once
  s := public.fb_state(room, tb);
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'fishing_battle_prize') = 1, 'once';
  -- a battle nobody scores in is refunded
  ca := pg_temp.coins(a); cb := pg_temp.coins(b);
  s := public.fb_create(room, ta, 300, 180);
  bid := (select id from public.fishing_battles where host = a and status = 'open');
  perform public.fb_join(room, tb, bid);
  perform public.fb_start(room, ta, bid);
  update public.fishing_battles set starts_at = now() - interval '4 minutes', ends_at = now() - interval '1 second' where id = bid;
  perform public.fb_state(room, ta);
  assert (select status from public.fishing_battles where id = bid) = 'cancelled', 'no catch = cancelled';
  assert pg_temp.coins(a) = ca and pg_temp.coins(b) = cb, 'refunded';
  -- the host leaving cancels; a player leaving gets the fee back
  s := public.fb_create(room, ta, 300, 180);
  bid := (select id from public.fishing_battles where host = a and status = 'open');
  perform public.fb_join(room, tb, bid);
  perform public.fb_leave(room, tb, bid);
  assert pg_temp.coins(b) = cb and (select pot from public.fishing_battles where id = bid) = 300, 'b left';
  perform public.fb_leave(room, ta, bid);
  assert pg_temp.coins(a) = ca and (select status from public.fishing_battles where id = bid) = 'cancelled', 'host left';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'fishing_battle_refund'), 'refund reason';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'fishing_battle_entry'), 'entry reason';
  delete from public.fish where account_id in (a, b);
  raise notice 'battle ok';
end $$;

-- ---------- 4. Treasure maps ----------
do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid; s jsonb; m jsonb;
        mid uuid; sp public.treasure_spots; c0 integer; r jsonb;
begin
  delete from public.treasure_maps where account_id = a;
  perform public._treasure_drop(a, 'fishing', 1.0);
  perform public._treasure_drop(a, 'fishing', 1.0);
  perform public._treasure_drop(a, 'fishing', 1.0);
  perform public._treasure_drop(a, 'fishing', 1.0);
  assert (select count(*) from public.treasure_maps where account_id = a) = 3, 'three at most';
  delete from public.treasure_maps where account_id = a and id <> (select id from public.treasure_maps where account_id = a limit 1);
  s := public.fishing_extras_state(t);
  m := s->'maps'->0;
  assert m ? 'landmark' and m ? 'cell' and not (m ? 'x') and not (m ? 'spot') and m::text not like '%"x"%', format('a hint only %s', m);
  mid := (m->>'id')::uuid;
  select sp2.* into sp from public.treasure_spots sp2 join public.treasure_maps t2 on t2.spot = sp2.id where t2.id = mid;
  -- far away on the right map: cold
  perform pg_temp.fresh(a);
  perform pg_temp.stand(a, sp.map, sp.x, sp.y);
  r := public.dig_treasure(room, t, mid, sp.map, case when sp.x > 300 then sp.x - 200 else sp.x + 200 end, sp.y);
  assert r->>'result' = 'miss' and r->>'heat' = 'cold', format('cold %s', r);
  begin
    perform public.dig_treasure(room, t, mid, sp.map, sp.x, sp.y);
    assert false, 'cooldown';
  exception when others then assert sqlerrm = 'dig cooldown', sqlerrm;
  end;
  update public.treasure_maps set last_dig_at = now() - interval '5 seconds' where id = mid;
  perform pg_temp.stand(a, sp.map, sp.x, sp.y);
  r := public.dig_treasure(room, t, mid, sp.map, sp.x + 30, sp.y);
  assert r->>'heat' = 'hot', format('hot %s', r);
  update public.treasure_maps set last_dig_at = now() - interval '5 seconds' where id = mid;
  perform pg_temp.stand(a, sp.map, sp.x, sp.y);
  c0 := pg_temp.coins(a);
  r := public.dig_treasure(room, t, mid, sp.map, sp.x + 5, sp.y - 5);
  assert r->>'result' = 'found' and (r->>'loot')::int between 400 and 8000, format('found %s', r);
  assert pg_temp.coins(a) >= c0 + (r->>'loot')::int, 'paid';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'treasure'), 'treasure reason';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'treasure_found'), 'treasure event';
  begin
    perform public.dig_treasure(room, t, mid, sp.map, sp.x, sp.y);
    assert false, 'dug up';
  exception when others then assert sqlerrm = 'no map', sqlerrm;
  end;
  -- another's map is not mine
  perform public._treasure_drop(pg_temp.v('b')::uuid, 'dig', 1.0);
  begin
    perform public.dig_treasure(room, t, (select id from public.treasure_maps where account_id = pg_temp.v('b')::uuid limit 1), 'pond', 1, 1);
    assert false, 'not mine';
  exception when others then assert sqlerrm = 'no map', sqlerrm;
  end;
  -- a worm dig can drop one (the trigger on last_dig_at)
  assert exists (select 1 from pg_trigger where tgname = 'fishing_profiles_fx_dig'), 'dig trigger';
  raise notice 'treasure ok';
end $$;

-- ---------- 5. Farming machines ----------
do $$
declare t text := pg_temp.v('ta'); a uuid := pg_temp.v('a')::uuid; room uuid := pg_temp.v('room')::uuid; s jsonb; c0 integer;
begin
  update public.wallets set coins = 50000 where account_id = a;
  perform pg_temp.stand(a, 'pond', 300, 300);
  begin
    perform public.buy_machine(t, 'processor');
    assert false, 'at the pond';
  exception when others then assert sqlerrm = 'not at field', sqlerrm;
  end;
  update public.player_pos set map = 'field', at = now() where account_id = a;
  s := public.buy_machine(t, 'processor');
  assert s->'machines' = '["processor"]'::jsonb and pg_temp.coins(a) = 40000, format('bought %s', s);
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'machine' and delta = -10000), 'machine reason';
  begin
    perform public.machine_water(room, t, 1, 2);
    assert false, 'no sprinkler';
  exception when others then assert sqlerrm = 'no machine', sqlerrm;
  end;
  s := public.machine_water(room, t, 99, 2);
  assert s ? 'anticheat', 'bad plot flagged';
  perform public.buy_machine(t, 'sprinkler');
  perform public.buy_machine(t, 'harvester');
  begin
    perform public.machine_water(room, t, 1, 2);
    assert false, 'not farmed';
  exception when others then assert sqlerrm = 'not your plot', sqlerrm;
  end;
  begin
    perform public.machine_harvest(room, t, 1);
    assert false, 'not farmed';
  exception when others then assert sqlerrm = 'not your plot', sqlerrm;
  end;
  -- the processor
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (a, 'thom', 0, 25)
  on conflict (account_id, variety) do update set dry_kg = 25;
  begin
    perform public.process_start(t, 'gao_thom', 3);
    assert false, 'not enough';
  exception when others then assert sqlerrm = 'not enough crop', sqlerrm;
  end;
  s := public.process_start(t, 'gao_thom', 2);
  assert s->'job'->>'recipe' = 'gao_thom' and (select dry_kg from public.rice_stock where account_id = a and variety = 'thom') = 5,
    format('started %s', s);
  begin
    perform public.process_start(t, 'gao_thom', 1);
    assert false, 'busy';
  exception when others then assert sqlerrm = 'machine busy', sqlerrm;
  end;
  begin
    perform public.process_collect(t);
    assert false, 'not ready';
  exception when others then assert sqlerrm = 'not ready', sqlerrm;
  end;
  update public.processor_jobs set ready_at = now() - interval '1 second' where account_id = a;
  s := public.process_collect(t);
  assert (s->'goods'->>'gao_thom')::int = 2 and s->'job' = 'null'::jsonb, format('collected %s', s);
  assert exists (select 1 from public.game_events where account_id = a and kind = 'crop_processed' and qty = 2), 'processed event';
  c0 := pg_temp.coins(a);
  s := public.sell_goods(t, 'gao_thom', 2);
  assert pg_temp.coins(a) >= c0 + 2 * 19600 and s->'goods' = '{}'::jsonb                -- (0077's perks may add on top)
     and exists (select 1 from public.coin_ledger where account_id = a and reason = 'produce_sell' and delta = 39200), format('sold %s', s);
  s := public.sell_goods(t, 'gao_thom', 0);
  assert s ? 'anticheat', 'bad qty flagged';
  raise notice 'machines ok';
end $$;

-- ---------- 6. The wipe clears these rows; privileges ----------
do $$
declare a uuid := pg_temp.v('a')::uuid;
begin
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot) values (a, 'x', null, '{}'::jsonb);
  assert not exists (select 1 from public.boats where account_id = a), 'boat wiped';
  assert not exists (select 1 from public.farm_machines where account_id = a), 'machines wiped';
  assert not has_table_privilege('anon', 'public.treasure_spots', 'select'), 'spots private';
  assert not has_table_privilege('anon', 'public.treasure_maps', 'select'), 'maps private';
  assert not has_function_privilege('anon', 'public._treasure_drop(uuid, text, double precision)', 'execute'), 'drop private';
  assert not has_function_privilege('anon', 'public._fb_settle(uuid)', 'execute'), 'settle private';
  assert has_function_privilege('anon', 'public.start_boat_cast(uuid, text)', 'execute'), 'boat cast public';
  raise notice 'wipe ok';
end $$;
