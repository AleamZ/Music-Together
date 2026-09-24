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

select 'v14 account smoke ok' as result;
