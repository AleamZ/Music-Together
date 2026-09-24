-- tests/sql/v14-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0012 (see the plan).
-- Every check is an ASSERT inside a DO block; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on

create temp table smoke (k text primary key, v text);
insert into smoke select 't1', token from public.register('smoke14_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('smoke14_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('smoke14_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Ao test', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'code', code from public.rooms where id = (select v from smoke where k = 'room')::uuid;
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't2'));

-- ---------- account RPCs ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); a1 uuid := (select v from smoke where k = 'a1')::uuid;
        s jsonb; r jsonb;
begin
  s := public.fishing_state(t1);
  assert (s->>'coins')::int = 0, 'coins start at 0';
  assert s->'loadout' = '{"rod":"rod_wood","bobber":"bobber_feather","bait":"bait_worm"}'::jsonb, 'starter loadout';
  assert (s->'bait'->>'bait_worm')::int = 0 and (s->>'bait_cap')::int = 20 and (s->>'fish_cap')::int = 1, 'empty bag';
  assert (s->>'casts_left')::int = 40 and s->'window_resets_at' = 'null'::jsonb and s->'dig_ready_at' = 'null'::jsonb, 'fresh timers';

  r := public.claim_daily(t1);
  assert (r->>'claimed')::boolean and (r->'state'->>'coins')::int = 20, 'daily +20';
  r := public.claim_daily(t1);
  assert not (r->>'claimed')::boolean and (r->'state'->>'coins')::int = 20, 'daily only once';

  r := public.dig_worms(t1);
  assert (r->>'gained')::int between 1 and 3, 'dig gains 1-3';
  assert (r->'state'->'bait'->>'bait_worm')::int = (r->>'gained')::int, 'worms stored';
  assert r->'state'->>'dig_ready_at' is not null, 'cooldown shown';
  begin
    perform public.dig_worms(t1);
    raise exception 'expected dig cooldown';
  exception when others then
    assert sqlerrm = 'dig cooldown', sqlerrm;
  end;
  -- bait full: 20 worms, cooldown over
  update public.inventory set qty = 20 where account_id = a1 and item_id = 'bait_worm';
  update public.fishing_profiles set last_dig_at = now() - interval '1 minute' where account_id = a1;
  begin
    perform public.dig_worms(t1);
    raise exception 'expected bait full';
  exception when others then
    assert sqlerrm = 'bait full', sqlerrm;
  end;
  update public.inventory set qty = 5 where account_id = a1 and item_id = 'bait_worm';

  -- buying
  begin
    perform public.buy_item(t1, 'rod_bamboo', 1);
    raise exception 'expected not enough coins';
  exception when others then
    assert sqlerrm = 'not enough coins', sqlerrm;
  end;
  begin
    perform public.buy_item(t1, 'rod_wood', 1);
    raise exception 'expected item not available';
  exception when others then
    assert sqlerrm = 'item not available', sqlerrm;
  end;
  begin
    perform public.buy_item(t1, 'bait_shrimp', 0);
    raise exception 'expected invalid quantity';
  exception when others then
    assert sqlerrm = 'invalid quantity', sqlerrm;
  end;
  r := public.buy_item(t1, 'bait_shrimp', 2);
  assert (r->'state'->>'coins')::int = 10 and (r->'state'->'bait'->>'bait_shrimp')::int = 2, 'bought 2 shrimp for 10';
  assert r->'state'->'loadout'->>'bait' = 'bait_worm', 'selection kept while worms remain';
  begin
    perform public.buy_item(t1, 'bait_shrimp', 20);
    raise exception 'expected bait full';
  exception when others then
    assert sqlerrm = 'bait full', sqlerrm;
  end;

  update public.wallets set coins = 2000 where account_id = a1;
  r := public.buy_item(t1, 'rod_bamboo', 1);
  assert r->'state'->'loadout'->>'rod' = 'rod_bamboo', 'a better rod is equipped';
  assert r->'state'->'owned' ? 'rod_bamboo', 'rod owned';
  begin
    perform public.buy_item(t1, 'rod_bamboo', 1);
    raise exception 'expected already owned';
  exception when others then
    assert sqlerrm = 'already owned', sqlerrm;
  end;
  r := public.buy_item(t1, 'bucket_large', 1);
  assert (r->'state'->>'fish_cap')::int = 16, 'large bucket: 1 + 15';
  begin
    perform public.buy_item(t1, 'bucket_small', 1);
    raise exception 'expected already owned (smaller bucket)';
  exception when others then
    assert sqlerrm = 'already owned', sqlerrm;
  end;
  r := public.buy_item(t1, 'bait_box', 1);
  assert (r->'state'->>'bait_cap')::int = 60, 'bait box: 60';
  assert (r->'state'->>'coins')::int = 2000 - 300 - 800 - 250, 'paid 1350';
  assert (select count(*) from public.coin_ledger where account_id = a1) = 5, 'ledger: daily + 4 buys';
  assert (select balance from public.coin_ledger where account_id = a1 order by id desc limit 1) = 650, 'ledger balance';

  -- loadout
  r := public.set_loadout(t1, 'rod_wood', 'bobber_feather', 'bait_shrimp');
  assert r->'state'->'loadout' = '{"rod":"rod_wood","bobber":"bobber_feather","bait":"bait_shrimp"}'::jsonb, 'loadout set';
  begin
    perform public.set_loadout(t1, 'rod_carbon', 'bobber_feather', 'bait_worm');
    raise exception 'expected item not available (not owned)';
  exception when others then
    assert sqlerrm = 'item not available', sqlerrm;
  end;
  begin
    perform public.set_loadout(t1, 'bobber_foam', 'bobber_feather', 'bait_worm');
    raise exception 'expected item not available (wrong kind)';
  exception when others then
    assert sqlerrm = 'item not available', sqlerrm;
  end;
end $$;

-- ---------- casts ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        t3 text := (select v from smoke where k = 't3');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        c jsonb; f jsonb; before_casts int; fish_id uuid; v_msgs int;
begin
  begin
    perform public.start_cast(room, t3);
    raise exception 'expected not a member';
  exception when others then
    assert sqlerrm <> 'expected not a member', 'non-members cannot cast';
  end;

  -- shrimp selected (2 left): cast, give up
  c := public.start_cast(room, t1);
  assert (c->>'bite_ms')::int between 3000 and 10000 and (c->>'window_ms')::int = 1500, 'feather bobber timings';
  assert (c->>'zone_pct')::int = 25 and c->'rarity' = 'null'::jsonb, 'wooden rod, rarity hidden';
  assert (c->>'min_reel_ms')::int = 2000 + 40 * (c->>'difficulty')::int, 'min reel from difficulty';
  assert (c->'state'->'bait'->>'bait_shrimp')::int = 1 and not (c->>'bait_switched')::boolean, 'one shrimp used';
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, false);
  assert f->>'result' = 'lost' and f->>'why' = 'gave_up', 'gave up';
  begin
    perform public.finish_cast(t1, (c->>'cast_id')::uuid, true);
    raise exception 'expected cast not found';
  exception when others then
    assert sqlerrm = 'cast not found', sqlerrm;
  end;

  -- a success reported before the reel could have finished is lost
  c := public.start_cast(room, t1);
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, true);
  assert f->>'why' = 'too_early', 'time gate';

  -- shrimp gone → falls back to worms
  c := public.start_cast(room, t1);
  assert (c->>'bait_switched')::boolean and c->'state'->'loadout'->>'bait' = 'bait_worm', 'worm fallback';
  -- a new cast abandons the open one
  perform public.start_cast(room, t1);
  assert (select count(*) from public.casts where account_id = a1) = 1, 'one open cast';
  begin
    perform public.finish_cast(t1, (c->>'cast_id')::uuid, true);
    raise exception 'expected cast not found (abandoned)';
  exception when others then
    assert sqlerrm = 'cast not found', sqlerrm;
  end;

  -- a caught fish (the reel time has passed)
  c := public.start_cast(room, t1);
  update public.casts set species_id = 'ca_tra', weight_g = 3150, bite_at = now() - interval '20 seconds',
                          expires_at = now() + interval '60 seconds' where account_id = a1;
  select count(*) into v_msgs from public.chat_messages where room_id = room;
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, true);
  assert f->>'result' = 'caught' and f->'fish'->>'species_id' = 'ca_tra', 'caught';
  assert (f->'fish'->>'price')::int = 221 and (f->'fish'->>'rarity')::int = 3, 'price 70 xu/kg × 3.15 kg';
  assert (f->>'record')::boolean, 'first catch is a personal best';
  assert jsonb_array_length(f->'state'->'fish') = 1, 'fish held';
  assert (select count(*) from public.chat_messages where room_id = room) = v_msgs + 1, 'announced';
  assert (select body from public.chat_messages where room_id = room order by created_at desc limit 1)
         like '[catch:' || a1::text || '|ca_tra|3150] 🎣 % vừa câu được Cá tra 3,2 kg (Hiếm)!', 'announcement text';
  assert (select account_id is null and username = 'Ao cá' from public.chat_messages where room_id = room order by created_at desc limit 1),
         'announcement author';

  -- expired
  c := public.start_cast(room, t1);
  update public.casts set expires_at = now() - interval '1 second' where account_id = a1;
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, true);
  assert f->>'why' = 'expired', 'expired';

  -- hands full (bucket removed), then the hourly cap
  delete from public.inventory where account_id = a1 and item_id = 'bucket_large';
  begin
    perform public.start_cast(room, t1);
    raise exception 'expected hands full';
  exception when others then
    assert sqlerrm = 'hands full', sqlerrm;
  end;
  fish_id := (select id from public.fish where account_id = a1 limit 1);
  update public.fishing_profiles set window_casts = 40 where account_id = a1;
  begin
    perform public.start_cast(room, t1);
    raise exception 'expected cast limit';
  exception when others then
    assert sqlerrm = 'cast limit', sqlerrm;
  end;
  update public.fishing_profiles set window_start = now() - interval '61 minutes' where account_id = a1;
  f := public.release_fish(t1, fish_id);
  assert jsonb_array_length(f->'state'->'fish') = 0, 'released';
  c := public.start_cast(room, t1);
  assert (c->'state'->>'casts_left')::int = 39, 'a new hourly window';
  perform public.finish_cast(t1, (c->>'cast_id')::uuid, false);

  -- selling
  insert into public.fish (account_id, species_id, weight_g, price) values (a1, 'ca_ro', 200, 9), (a1, 'ca_loc', 1000, 60);
  before_casts := (select coins from public.wallets where account_id = a1);
  begin
    perform public.sell_fish(t2, array(select id from public.fish where account_id = a1));
    raise exception 'expected fish not found';
  exception when others then
    assert sqlerrm = 'fish not found', sqlerrm;
  end;
  f := public.sell_fish(t1, array(select id from public.fish where account_id = a1));
  assert (f->>'sold')::int = 2 and (f->>'earned')::int = 69, 'sold 2 for 69';
  assert (f->'state'->>'coins')::int = before_casts + 69, 'coins added';
  begin
    perform public.release_fish(t1, gen_random_uuid());
    raise exception 'expected fish not found';
  exception when others then
    assert sqlerrm = 'fish not found', sqlerrm;
  end;
end $$;

-- ---------- board ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); room uuid := (select v from smoke where k = 'room')::uuid;
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        b jsonb;
begin
  insert into public.personal_bests (account_id, species_id, weight_g) values (a2, 'ca_tra', 5000), (a3, 'ca_tra', 5900);
  insert into public.wallets (account_id, coins) values (a2, 99999), (a3, 500000)
  on conflict (account_id) do update set coins = excluded.coins;
  b := public.fishing_board(room, t1);
  assert (select r->>'username' from jsonb_array_elements(b->'records') r where r->>'species_id' = 'ca_tra')
         = (select username from public.accounts where id = a2), 'room record holder (a non-member is ignored)';
  assert jsonb_array_length(b->'richest') = 2 and (b->'richest'->0->>'coins')::int = 99999, 'richest = members only';
  assert (b->>'my_rank')::int = 2, 'my rank';
  assert jsonb_array_length(b->'mine') = 1, 'my bests';
end $$;

-- ---------- song bonus ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        coins0 int;
begin
  update public.wallets set coins = 0, bonus_on = null, bonus_count = 0 where account_id = a2;
  perform public.add_queue_item(room, t2, 'vid1', 'Song one', null, 240);
  perform public.add_queue_item(room, t2, 'vid2', 'Song two', null, 240);
  perform public.add_queue_item(room, t2, 'vid3', 'Song three', null, 240);
  perform public.add_queue_item(room, t2, 'vid4', 'Short', null, 30);
  perform public.add_queue_item(room, t2, 'vid5', 'Song five', null, 240);
  perform public.advance_queue(room, t1);                                           -- Song one starts
  assert (select item_began_at is not null from public.rooms where id = room), 'item clock set';
  update public.rooms set item_began_at = now() - interval '1 minute' where id = room;
  perform public.advance_queue(room, t1);                                           -- skipped at 25 % → nothing
  assert (select coins from public.wallets where account_id = a2) = 0, 'no bonus for a skip';
  update public.rooms set item_began_at = now() - interval '3 minutes 30 seconds' where id = room;
  perform public.advance_queue(room, t1);                                           -- Song two played → +10
  assert (select coins from public.wallets where account_id = a2) = 10, 'song bonus +10';
  assert (select reason = 'song' and ref = 'Song two' from public.coin_ledger where account_id = a2 order by id desc limit 1), 'ledger';
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  update public.wallets set bonus_count = 10 where account_id = a2;
  perform public.advance_queue(room, t1);                                           -- Song three: daily cap reached
  assert (select coins from public.wallets where account_id = a2) = 10, 'cap of 10 bonuses per day';
  update public.wallets set bonus_count = 0 where account_id = a2;
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  perform public.advance_queue(room, t1);                                           -- Short (30 s) → nothing
  assert (select coins from public.wallets where account_id = a2) = 10, 'short songs never pay';
  assert (select current_item_id is not null from public.rooms where id = room), 'advance_queue still works';
end $$;

-- ---------- odds (worms + wooden rod): Thường 60 · Khá 28 · Hiếm 9 · Quý 2.7 · Huyền thoại 0.3 ----------
do $$
declare n int := 20000; c1 int; c2 int; c5 int;
begin
  create temp table rolls as select public._roll_rarity('rod_wood', 'bait_worm') as r from generate_series(1, n);
  select count(*) filter (where r = 1), count(*) filter (where r = 2), count(*) filter (where r = 5) into c1, c2, c5 from rolls;
  assert abs(c1 * 100.0 / n - 60) < 1.5, format('Thường %s%%', c1 * 100.0 / n);
  assert abs(c2 * 100.0 / n - 28) < 1.5, format('Khá %s%%', c2 * 100.0 / n);
  assert c5 * 100.0 / n < 1, format('Huyền thoại %s%%', c5 * 100.0 / n);
  drop table rolls;
end $$;

select 'v14 smoke ok' as result;
