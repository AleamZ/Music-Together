-- tests/sql/v20-3-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain (0004 … 0055,
-- 0014 before 0013), from the repo root, with the fight fixtures' absolute path:
--   psql -v cases=<repo>/tests/fixtures/fight-cases.json -f <this file>
-- It no longer re-applies 0051 (that would put back 0051's bodies over 0052's): the chain's re-runnability is
-- tests/sql/v20-rerun.sql. Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';

create temp table fx as select pg_read_file(:'cases')::jsonb j;
create or replace function pg_temp.ints(a jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(a) with ordinality t(x, o)
$$;
create or replace function pg_temp.enc(p_runs integer[], p_from integer, p_n integer) returns integer[] language sql as $$
  select public._fx_runs_encode(public._fx_runs_slice(p_runs, p_from, p_n))
$$;

-- ---------- 0. Six players in two rooms, each enrolled and in uniform ----------
create temp table tk (k text primary key, v text);
insert into tk select 'p' || n, token from generate_series(1, 6) n,
  lateral public.register('ring' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
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
create or replace function pg_temp.t(k text) returns text language sql as $$ select v from tk where k = $1 $$;
create or replace function pg_temp.a(k text) returns uuid language sql as $$ select public._auth_account(pg_temp.t(k)) $$;
insert into tk select 'room', room_id::text from public.create_room('Bãi đất', 'pw', pg_temp.t('p1'));
insert into tk select 'room2', room_id::text from public.create_room('Bãi khác', 'pw', pg_temp.t('p5'));
create or replace function pg_temp.r(k text default 'room') returns uuid language sql as $$ select v::uuid from tk where k = $1 $$;
do $$ declare n integer; begin
  for n in 2..4 loop perform public.join_room((select code from public.rooms where id = pg_temp.r()), 'pw', pg_temp.t('p' || n)); end loop;
  perform public.join_room((select code from public.rooms where id = pg_temp.r('room2')), 'pw', pg_temp.t('p6'));
end $$;
insert into public.characters (account_id, skin, hair, hair_color, shoes)
  select pg_temp.a('p' || n), 'warm', 'short', 'black', 'shoes_dep_blue' from generate_series(1, 6) n;
insert into public.vitals (account_id) select pg_temp.a('p' || n) from generate_series(1, 6) n on conflict do nothing;
-- lift the daily caps for the rules below (the caps get their own section)
update public.fight_config set max_pair_day = 100, max_friendly_pair_day = 100, max_staked_day = 100 where id;

create or replace function pg_temp.fighter(p text, p_style text, p_rank integer) returns void language plpgsql as $$
declare acc uuid := pg_temp.a(p);
begin
  insert into public.martial_enrollments (account_id, style, rank) values (acc, p_style, p_rank)
  on conflict (account_id, style) do update set rank = excluded.rank;
  insert into public.account_items (account_id, item_id)
  select acc, uniform from public.martial_styles where id = p_style on conflict do nothing;
  perform public.fight_wear_uniform(pg_temp.t(p), p_style);
  perform public._wallet_lock(acc);
  update public.wallets set coins = 50000 where account_id = acc;
  update public.vitals set hunger = 100, thirst = 100 where account_id = acc;
end $$;

-- ---------- 1. The belt on the world chibi (plan ruling P23) ----------
do $$ declare b smallint; begin
  perform pg_temp.fighter('p1', 'karate', 2);
  select belt into b from public.characters where account_id = pg_temp.a('p1');
  assert b = 2, format('belt after wearing: %s', b);
  update public.martial_enrollments set rank = 3 where account_id = pg_temp.a('p1') and style = 'karate';
  select belt into b from public.characters where account_id = pg_temp.a('p1');
  assert b = 3, format('belt after a promotion: %s', b);
  perform public.fight_unwear_uniform(pg_temp.t('p1'));
  select belt into b from public.characters where account_id = pg_temp.a('p1');
  assert b is null, 'no belt without the uniform';
  perform pg_temp.fighter('p1', 'karate', 2);
  perform pg_temp.fighter('p2', 'taekwondo', 1);
  perform pg_temp.fighter('p3', 'muaythai', 0);
  perform pg_temp.fighter('p4', 'judo', 4);
  perform pg_temp.fighter('p5', 'boxing', 1);
  perform pg_temp.fighter('p6', 'vinhxuan', 1);
  assert (select belt from public.characters where account_id = pg_temp.a('p4')) = 4, 'p4 belt';
  raise notice 'belt ok';
end $$;

-- ---------- 2. Corners ----------
do $$ declare j jsonb; ok boolean; acc uuid := pg_temp.a('p3'); begin
  -- no uniform: refused
  perform public.fight_unwear_uniform(pg_temp.t('p3'));
  begin perform public.ring_take(pg_temp.r(), pg_temp.t('p3'), 1, 'red'); ok := false;
  exception when others then ok := sqlerrm = 'no uniform'; end;
  assert ok, 'ring_take without a uniform';
  perform public.fight_wear_uniform(pg_temp.t('p3'), 'muaythai');
  -- too hungry
  update public.vitals set hunger = 5 where account_id = acc;
  begin perform public.ring_take(pg_temp.r(), pg_temp.t('p3'), 1, 'red'); ok := false;
  exception when others then ok := sqlerrm = 'too hungry to fight'; end;
  assert ok, 'ring_take hungry';
  update public.vitals set hunger = 100 where account_id = acc;
  -- not a member of room2
  begin perform public.ring_take(pg_temp.r('room2'), pg_temp.t('p3'), 1, 'red'); ok := false;
  exception when others then ok := true; end;
  assert ok, 'ring_take in a room I am not in';
  j := public.ring_take(pg_temp.r(), pg_temp.t('p3'), 1, 'red');
  assert (j->>'ok')::boolean and j->'rings'->0->'red'->>'name' like 'ring3_%', format('take: %s', j->'rings'->0);
  assert j->'rings'->0->'red'->>'style' = 'muaythai' and (j->'rings'->0->'red'->>'rank')::int = 0, 'fighter json';
  -- another corner elsewhere: refused
  begin perform public.ring_take(pg_temp.r(), pg_temp.t('p3'), 2, 'blue'); ok := false;
  exception when others then ok := sqlerrm = 'already in a corner'; end;
  assert ok, 'two corners';
  -- a taken corner is an answer
  j := public.ring_take(pg_temp.r(), pg_temp.t('p4'), 1, 'red');
  assert j->>'refused' = 'corner taken', format('taken: %s', j->>'refused');
  -- moving to the other corner of the same ring
  j := public.ring_take(pg_temp.r(), pg_temp.t('p3'), 1, 'blue');
  assert j->'rings'->0->'red' = 'null'::jsonb and j->'rings'->0->'blue'->>'style' = 'muaythai', 'moved';
  -- held 5 minutes alone: released lazily
  update public.fight_rings set blue_at = now() - interval '6 minutes' where room_id = pg_temp.r() and ring = 1;
  j := public.ring_state(pg_temp.r(), pg_temp.t('p4'));
  assert j->'rings'->0->'blue' = 'null'::jsonb, 'released after 5 minutes';
  assert jsonb_array_length(j->'rings') = 4 and (j->'config'->>'fee_pct')::int = 5, 'ring_state shape';
  raise notice 'corners ok';
end $$;

-- helpers: a match between two players at ring `ring` (red, blue), stake, both delays; returns the match id
create or replace function pg_temp.duel(p_red text, p_blue text, p_ring integer, p_stake integer, p_room text default 'room') returns uuid
language plpgsql as $$
declare j jsonb; v integer;
begin
  perform public.ring_take(pg_temp.r(p_room), pg_temp.t(p_red), p_ring, 'red');
  perform public.ring_take(pg_temp.r(p_room), pg_temp.t(p_blue), p_ring, 'blue');
  j := public.ring_offer(pg_temp.r(p_room), pg_temp.t(p_red), p_ring, p_stake, 3);
  assert (j->>'ok')::boolean, format('offer: %s', j->>'refused');
  v := (j->'rings'->(p_ring - 1)->'offer'->>'v')::int;
  assert (j->'rings'->(p_ring - 1)->'offer'->>'red_ok')::boolean and not (j->'rings'->(p_ring - 1)->'offer'->>'blue_ok')::boolean, 'proposer accepts';
  j := public.ring_accept(pg_temp.r(p_room), pg_temp.t(p_blue), p_ring, v, 5);
  assert j ? 'match', format('accept: %s %s', j->>'refused', j->>'who');
  return (j->'match'->>'id')::uuid;
end $$;

-- a fixture's two logs pushed by both players in interleaved 60-frame chunks (each also pushes what it saw of the
-- other: the other's frames already pushed); the match's clock moved back so the pacing holds
create or replace function pg_temp.feed(p_match uuid, p_case text, p_t1 text, p_t2 text) returns jsonb language plpgsql as $$
declare c jsonb; r1 integer[]; r2 integer[]; n integer; off integer := 0; len integer; j jsonb; s1 integer := 0; s2 integer := 0;
begin
  select e into c from fx, jsonb_array_elements(fx.j) e where e->>'name' = p_case;
  r1 := pg_temp.ints(c->'p1');
  r2 := pg_temp.ints(c->'p2');
  n := (c->>'frames')::int;
  update public.fight_matches set params = c->'params' || jsonb_build_object('delay', 3), sim = public._fx_new(c->'params'), sim_frame = 0,
    sim_hash = public._fx_hash(public._fx_new(c->'params')), started_at = now() - interval '11 minutes' where id = p_match;
  update public.fight_logs set last_push_at = now() where match_id = p_match;
  while off < n loop
    len := least(60, n - off);
    j := public.fight_push(p_t1, p_match, off, pg_temp.enc(r1, off, len), p_seen_from => s1, p_seen_runs => pg_temp.enc(r2, s1, off - s1));
    assert j->>'status' in ('live', 'done') and not j ? 'anticheat', format('push 1 at %s: %s', off, j);
    s1 := off;
    j := public.fight_push(p_t2, p_match, off, pg_temp.enc(r2, off, len), p_seen_from => s2, p_seen_runs => pg_temp.enc(r1, s2, off + len - s2));
    assert j->>'status' in ('live', 'done') and not j ? 'anticheat', format('push 2 at %s: %s', off, j);
    s2 := off + len;
    off := off + len;
  end loop;
  j := public.fight_push(p_t1, p_match, n, '{}', p_seen_from => s1, p_seen_runs => pg_temp.enc(r2, s1, n - s1));
  return c;
end $$;

-- ---------- 3. Escrow, the fee, settlement, records, vitals, the ledger ----------
do $$ declare m uuid; c jsonb; mt public.fight_matches; w1 integer; w2 integer; b1 integer; b2 integer; h integer; j jsonb; begin
  select coins into b1 from public.wallets where account_id = pg_temp.a('p1');
  select coins into b2 from public.wallets where account_id = pg_temp.a('p2');
  m := pg_temp.duel('p1', 'p2', 1, 1000);
  select * into mt from public.fight_matches where id = m;
  assert mt.kind = 'pvp' and mt.status = 'live' and mt.stake = 1000 and mt.ring = 1 and mt.p1 = pg_temp.a('p1') and mt.p2 = pg_temp.a('p2'), 'the row';
  assert (mt.params->>'delay')::int = 5 and (mt.params->>'rounds')::int = 3 and (mt.params->'p1'->>'style')::int = 3
     and (mt.params->'p1'->>'rank')::int = 2 and (mt.params->'p1'->>'movesMask')::int = 7 and (mt.params->'p2'->>'style')::int = 4, format('params %s', mt.params);
  assert mt.started_at between now() + interval '2 seconds' and now() + interval '4 seconds', 'frame 0 in 3 s';
  assert (select coins from public.wallets where account_id = pg_temp.a('p1')) = b1 - 1000, 'red escrowed';
  assert (select coins from public.wallets where account_id = pg_temp.a('p2')) = b2 - 1000, 'blue escrowed';
  assert (select count(*) from public.coin_ledger where reason = 'fight_stake' and delta = -1000
            and account_id in (pg_temp.a('p1'), pg_temp.a('p2'))) = 2, 'stake ledger';
  assert (select match_id from public.fight_rings where room_id = pg_temp.r() and ring = 1) = m, 'the ring holds the match';
  j := public.ring_state(pg_temp.r(), pg_temp.t('p3'));
  assert j->'rings'->0->'match'->>'id' = m::text and (j->'live_room')::int = 1, 'bystanders see it';
  assert (public.ring_state(pg_temp.r(), pg_temp.t('p1'))->'mine'->>'id') = m::text, 'mine (a reload)';
  select hunger into h from public.vitals where account_id = pg_temp.a('p1');
  c := pg_temp.feed(m, 'bots-karate-5-vs-taekwondo-5', pg_temp.t('p1'), pg_temp.t('p2'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'done' and mt.winner = 1 and mt.end_reason in ('ko', 'decision'), format('settled %s %s %s', mt.status, mt.winner, mt.end_reason);
  assert mt.sim_hash = (c->'expected'->>'hash')::bigint, format('replay hash %s vs %s', mt.sim_hash, c->'expected'->>'hash');
  assert mt.rounds = c->'expected'->'rounds', 'rounds';
  select coins into w1 from public.wallets where account_id = pg_temp.a('p1');
  select coins into w2 from public.wallets where account_id = pg_temp.a('p2');
  assert w1 = b1 - 1000 + 1900 and w2 = b2 - 1000, format('pay: %s %s (fee 5 %% of 2 000 burned)', w1 - b1, w2 - b2);
  assert (select count(*) from public.coin_ledger where reason = 'fight_win' and account_id = pg_temp.a('p1') and delta = 1900) = 1, 'win ledger';
  assert (mt.result->'pvp'->>'fee')::int = 100 and (mt.result->'pvp'->>'won')::int = 1900, format('result %s', mt.result->'pvp');
  assert (select wins from public.fight_profiles where account_id = pg_temp.a('p1')) = 1
     and (select losses from public.fight_profiles where account_id = pg_temp.a('p2')) = 1, 'records';
  assert (select hunger from public.vitals where account_id = pg_temp.a('p1')) <= h - 2 * (mt.result->>'rounds_played')::int, 'vitals cost';
  assert (select match_id from public.fight_rings where room_id = pg_temp.r() and ring = 1) is null, 'the ring is free';
  assert (select red from public.fight_rings where room_id = pg_temp.r() and ring = 1) = pg_temp.a('p1'), 'both stay in their corners';
  -- a push after the end is an answer, not a flag
  j := public.fight_push(pg_temp.t('p2'), m, 99999, '{}');
  assert j->>'status' = 'done' and not j ? 'anticheat', 'late push';
  raise notice 'settlement ok (hash %)', mt.sim_hash;
end $$;

-- ---------- 4. A draw refunds; the news for a big stake ----------
do $$ declare m uuid; mt public.fight_matches; b1 integer; b2 integer; begin
  select coins into b1 from public.wallets where account_id = pg_temp.a('p1');
  select coins into b2 from public.wallets where account_id = pg_temp.a('p2');
  m := pg_temp.duel('p1', 'p2', 1, 500);
  perform pg_temp.feed(m, 'time-up-draw', pg_temp.t('p1'), pg_temp.t('p2'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'done' and mt.winner = 0, format('draw %s %s', mt.status, mt.winner);
  assert (select coins from public.wallets where account_id = pg_temp.a('p1')) = b1
     and (select coins from public.wallets where account_id = pg_temp.a('p2')) = b2, 'refunded';
  assert (select count(*) from public.coin_ledger where reason = 'fight_refund' and delta = 500 and ref like 'pvp ' || left(m::text, 8) || '%') = 2, 'refund ledger';
  assert (select draws from public.fight_profiles where account_id = pg_temp.a('p1')) = 1, 'draw record';
  -- 5 000: the news
  m := pg_temp.duel('p1', 'p2', 1, 5000);
  perform pg_temp.feed(m, 'bots-boxing-6-vs-judo-7', pg_temp.t('p1'), pg_temp.t('p2'));
  select * into mt from public.fight_matches where id = m;
  assert mt.winner = 2 and (select count(*) from public.news_events where room_id = pg_temp.r() and kind = 'fight') = 1, 'the news';
  assert (select count(*) from public.coin_ledger where reason = 'fight_win' and account_id = pg_temp.a('p2') and delta = 9500) = 1, 'blue wins 9 500';
  raise notice 'draw and news ok';
end $$;

-- the records board: the room's top fighters by wins this week
do $$ declare j jsonb; begin
  j := public.ring_board(pg_temp.r(), pg_temp.t('p3'));
  assert jsonb_array_length(j->'rows') = 2, format('board: %s', j);
  assert (j->'rows'->0->>'wins')::int = 1 and (j->'rows'->0->>'draws')::int = 1 and (j->'rows'->1->>'wins')::int = 1
     and (j->'rows'->1->>'losses')::int = 1, format('board rows: %s', j->'rows');
  assert jsonb_array_length(public.ring_board(pg_temp.r('room2'), pg_temp.t('p5'))->'rows') = 0, 'room2 has none';
end $$;

-- ---------- 5. Surrender; claims; both absent; overtime ----------
do $$ declare m uuid; j jsonb; mt public.fight_matches; b1 integer; b2 integer; s integer[]; w integer; n integer; begin
  -- surrender: the opponent takes the pot less the fee
  select coins into b1 from public.wallets where account_id = pg_temp.a('p1');
  m := pg_temp.duel('p1', 'p2', 1, 100);
  j := public.fight_forfeit(pg_temp.t('p2'), m);
  assert j->>'status' = 'done' and (j->'result'->>'winner')::int = 1 and j->'result'->>'end_reason' = 'forfeit', format('forfeit %s', j);
  assert (select coins from public.wallets where account_id = pg_temp.a('p1')) = b1 + 90, 'surrender pays';
  -- a claim too early, then after 20 s
  m := pg_temp.duel('p1', 'p2', 1, 100);
  update public.fight_matches set started_at = now() - interval '5 seconds' where id = m;
  j := public.fight_push(pg_temp.t('p1'), m, 0, '{0,60}');
  j := public.fight_claim(pg_temp.t('p1'), m);
  assert not (j->>'claimed')::boolean and (j->>'wait_ms')::int > 10000 and j->>'status' = 'live', format('early claim %s', j);
  assert not exists (select 1 from public.anticheat_events where code like 'fight%' and detail->>'match' = m::text), 'an early claim is no flag';
  update public.fight_matches set started_at = now() - interval '30 seconds' where id = m;
  update public.fight_logs set last_push_at = now() - interval '2 seconds' where match_id = m and side = 1;
  -- the absentee cannot claim the present one
  j := public.fight_claim(pg_temp.t('p2'), m);
  assert not (j->>'claimed')::boolean, 'the absentee claims nothing';
  j := public.fight_claim(pg_temp.t('p1'), m);
  assert (j->>'claimed')::boolean and (j->'result'->>'winner')::int = 1 and j->'result'->>'end_reason' = 'timeout_claim', format('claim %s', j);
  -- both absent 120 s: void, refunds, soft fight_abandon to both
  select coins into b1 from public.wallets where account_id = pg_temp.a('p1');
  select coins into b2 from public.wallets where account_id = pg_temp.a('p2');
  m := pg_temp.duel('p1', 'p2', 1, 2000);
  update public.fight_matches set started_at = now() - interval '200 seconds' where id = m;
  update public.fight_logs set last_push_at = now() - interval '130 seconds' where match_id = m;
  j := public.ring_state(pg_temp.r(), pg_temp.t('p4'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'void' and mt.end_reason = 'abandon' and mt.winner is null, format('void %s %s', mt.status, mt.end_reason);
  assert (select coins from public.wallets where account_id = pg_temp.a('p1')) = b1
     and (select coins from public.wallets where account_id = pg_temp.a('p2')) = b2, 'void refunds';
  assert (select count(*) from public.anticheat_events where code = 'fight_abandon' and outcome = 'soft' and detail->>'match' = m::text) = 2, 'abandon flags';
  -- overtime: 20 minutes after frame 0, decided from the server's sim (rounds so far, then the round's HP‰)
  m := pg_temp.duel('p1', 'p2', 1, 1000);
  s := public._fx_run(public._fx_new((select e->'params' from fx, jsonb_array_elements(fx.j) e where e->>'name' = 'bots-karate-5-vs-taekwondo-5')),
                      public._fx_runs_slice(pg_temp.ints((select e->'p1' from fx, jsonb_array_elements(fx.j) e where e->>'name' = 'bots-karate-5-vs-taekwondo-5')), 0, 900),
                      public._fx_runs_slice(pg_temp.ints((select e->'p2' from fx, jsonb_array_elements(fx.j) e where e->>'name' = 'bots-karate-5-vs-taekwondo-5')), 0, 900),
                      public._fx_moves());
  assert s[2] = 1, 'mid-round';
  w := case when s[49 + 5] * 1000 / s[49 + 51] > s[113 + 5] * 1000 / s[113 + 51] then 1
            when s[49 + 5] * 1000 / s[49 + 51] < s[113 + 5] * 1000 / s[113 + 51] then 2 else 0 end;
  n := s[49 + 36] - s[113 + 36];
  update public.fight_matches set sim = s, sim_frame = 900, started_at = now() - interval '21 minutes' where id = m;
  update public.fight_logs set last_push_at = now() where match_id = m;
  perform public.ring_state(pg_temp.r(), pg_temp.t('p4'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'done' and mt.end_reason = 'overtime', format('overtime %s %s', mt.status, mt.end_reason);
  assert mt.winner = case when n > 0 then 1 when n < 0 then 2 else w end, format('overtime winner %s (hp winner %s, wins %s)', mt.winner, w, n);
  raise notice 'forfeit, claims, void, overtime ok';
end $$;

-- ---------- 6. Offers: the version race, lapses, not enough xu ----------
do $$ declare j jsonb; v1 integer; v2 integer; b1 integer; begin
  perform public.ring_take(pg_temp.r(), pg_temp.t('p3'), 2, 'red');
  perform public.ring_take(pg_temp.r(), pg_temp.t('p4'), 2, 'blue');
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 500, 3);
  v1 := (j->'rings'->1->'offer'->>'v')::int;
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 1000, 3);
  v2 := (j->'rings'->1->'offer'->>'v')::int;
  assert v2 = v1 + 1, 'the version moves';
  j := public.ring_accept(pg_temp.r(), pg_temp.t('p4'), 2, v1, 3);
  assert j->>'refused' = 'offer changed' and not j ? 'match', 'the race is an answer';
  -- the other side's counter-offer resets the acceptances
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p4'), 2, 100, 4);
  assert not (j->'rings'->1->'offer'->>'red_ok')::boolean and (j->'rings'->1->'offer'->>'blue_ok')::boolean, 'counter-offer';
  -- a lapsed offer (30 s) is swept
  update public.fight_rings set offer_at = now() - interval '40 seconds' where room_id = pg_temp.r() and ring = 2;
  j := public.ring_state(pg_temp.r(), pg_temp.t('p3'));
  assert j->'rings'->1->'offer' = 'null'::jsonb, 'lapsed';
  -- not enough xu: named, nothing moves
  update public.wallets set coins = 200 where account_id = pg_temp.a('p4');
  select coins into b1 from public.wallets where account_id = pg_temp.a('p3');
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 500, 3);
  j := public.ring_accept(pg_temp.r(), pg_temp.t('p4'), 2, (j->'rings'->1->'offer'->>'v')::int, 3);
  assert j->>'refused' = 'not enough xu' and j->>'who' = 'blue', format('xu: %s %s', j->>'refused', j->>'who');
  assert (select coins from public.wallets where account_id = pg_temp.a('p3')) = b1 and
         (select coins from public.wallets where account_id = pg_temp.a('p4')) = 200, 'nothing moved';
  assert not (j->'rings'->1->'offer'->>'red_ok')::boolean, 'acceptances cleared';
  update public.wallets set coins = 50000 where account_id = pg_temp.a('p4');
  -- bad stake / delay: malformed input raises
  begin perform public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 123, 3); assert false, 'bad stake';
  exception when others then assert sqlerrm = 'bad stake', sqlerrm; end;
  begin perform public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 100, 9); assert false, 'bad delay';
  exception when others then assert sqlerrm = 'bad delay', sqlerrm; end;
  raise notice 'offers ok';
end $$;

-- ---------- 7. The caps: per room, per project, per day, per pair ----------
do $$ declare m uuid; j jsonb; v integer; begin
  update public.fight_config set max_live_room = 1 where id;
  m := pg_temp.duel('p1', 'p2', 1, 0);
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 0, 3);
  j := public.ring_accept(pg_temp.r(), pg_temp.t('p4'), 2, (j->'rings'->1->'offer'->>'v')::int, 3);
  assert j->>'refused' = 'ring busy', format('room cap: %s', j->>'refused');
  update public.fight_config set max_live_room = 2, max_live_all = 1 where id;
  perform public.ring_take(pg_temp.r('room2'), pg_temp.t('p5'), 1, 'red');
  perform public.ring_take(pg_temp.r('room2'), pg_temp.t('p6'), 1, 'blue');
  j := public.ring_offer(pg_temp.r('room2'), pg_temp.t('p5'), 1, 0, 3);
  j := public.ring_accept(pg_temp.r('room2'), pg_temp.t('p6'), 1, (j->'rings'->0->'offer'->>'v')::int, 3);
  assert j->>'refused' = 'ring busy', format('project cap: %s', j->>'refused');
  update public.fight_config set max_live_all = 4 where id;
  perform public.fight_forfeit(pg_temp.t('p2'), m);
  -- per account per day (staked)
  update public.fight_config set max_staked_day = (select count(*) from public.fight_matches where kind = 'pvp' and stake > 0
    and created_at >= public._vn_day_start() and (p1 = pg_temp.a('p1') or p2 = pg_temp.a('p1'))) where id;
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p1'), 1, 100, 3);
  j := public.ring_accept(pg_temp.r(), pg_temp.t('p2'), 1, (j->'rings'->0->'offer'->>'v')::int, 3);
  assert j->>'refused' = 'daily fight limit', format('staked day cap: %s', j->>'refused');
  -- friendly is counted apart; the pair cap
  update public.fight_config set max_staked_day = 100, max_pair_day = 1 where id;
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p1'), 1, 100, 3);
  j := public.ring_accept(pg_temp.r(), pg_temp.t('p2'), 1, (j->'rings'->0->'offer'->>'v')::int, 3);
  assert j->>'refused' = 'daily fight limit', format('pair cap: %s', j->>'refused');
  update public.fight_config set max_friendly_pair_day = (select count(*) from public.fight_matches where kind = 'pvp' and stake = 0
    and created_at >= public._vn_day_start() and p1 = pg_temp.a('p1') and p2 = pg_temp.a('p2')) where id;
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p1'), 1, 0, 3);
  j := public.ring_accept(pg_temp.r(), pg_temp.t('p2'), 1, (j->'rings'->0->'offer'->>'v')::int, 3);
  assert j->>'refused' = 'daily fight limit', format('friendly pair cap: %s', j->>'refused');
  -- p5 / p6 in room2 are fine
  j := public.ring_offer(pg_temp.r('room2'), pg_temp.t('p5'), 1, 0, 3);
  j := public.ring_accept(pg_temp.r('room2'), pg_temp.t('p6'), 1, (j->'rings'->0->'offer'->>'v')::int, 3);
  assert j ? 'match', format('room2: %s', j->>'refused');
  perform public.fight_forfeit(pg_temp.t('p6'), (j->'match'->>'id')::uuid);
  update public.fight_config set max_live_room = 2, max_live_all = 4, max_staked_day = 100, max_pair_day = 100, max_friendly_pair_day = 100 where id;
  assert not exists (select 1 from public.anticheat_events where code in ('ring_busy', 'daily_fight_limit')), 'caps never flag';
  raise notice 'caps ok';
end $$;

-- ---------- 8. The hash check (deferred) and the mismatch pattern ----------
do $$ declare m uuid; j jsonb; c jsonb; r1 integer[]; r2 integer[]; h bigint; begin
  select e into c from fx, jsonb_array_elements(fx.j) e where e->>'name' = 'bots-karate-5-vs-taekwondo-5';
  r1 := pg_temp.ints(c->'p1');
  r2 := pg_temp.ints(c->'p2');
  m := pg_temp.duel('p1', 'p2', 1, 100);
  update public.fight_matches set params = c->'params', sim = public._fx_new(c->'params'), sim_frame = 0,
    sim_hash = public._fx_hash(public._fx_new(c->'params')), started_at = now() - interval '5 minutes' where id = m;
  update public.fight_logs set last_push_at = now() where match_id = m;
  h := public._fx_hash(public._fx_run(public._fx_new(c->'params'), public._fx_runs_slice(r1, 0, 120),
                                      public._fx_runs_slice(r2, 0, 120), public._fx_moves()));
  -- blue pushes a right hash for frame 120 first (pending), red then a wrong one for frame 60 with its seen
  j := public.fight_push(pg_temp.t('p2'), m, 0, pg_temp.enc(r2, 0, 120), p_seen_from => 0, p_seen_runs => '{}',
                         p_hash_frame => 120, p_hash => h);
  assert not (j->>'resync')::boolean and (j->>'sim_frame')::int = 0, format('blue waits %s', j);
  j := public.fight_push(pg_temp.t('p1'), m, 0, pg_temp.enc(r1, 0, 120), p_seen_from => 0, p_seen_runs => pg_temp.enc(r2, 0, 120),
                         p_hash_frame => 60, p_hash => 12345);
  assert (j->>'sim_frame')::int = 120, 'advanced';
  assert (j->>'resync')::boolean, format('red is told to resync: %s', j);
  assert (select count(*) from public.anticheat_events where code = 'fight_hash_mismatch' and outcome = 'soft'
            and account_id = pg_temp.a('p1') and detail->>'match' = m::text) = 1, 'soft mismatch';
  -- blue's hash for 120 was right, but blue's seen is not checked yet (it pushed none): no verdict either way
  assert (select bad_hashes from public.fight_logs where match_id = m and side = 2) = 0, 'blue clean';
  -- the resync flag is consumed by the answer (not told twice)
  assert not (public.fight_push(pg_temp.t('p1'), m, 120, '{}')->>'resync')::boolean, 'told once';
  perform public.fight_forfeit(pg_temp.t('p2'), m);
  -- a hash mismatch in 3 matches within 7 days turns hard
  insert into public.anticheat_events (account_id, username, code, outcome, rpc, detail)
  select pg_temp.a('p1'), 'x', 'fight_hash_mismatch', 'soft', 'fight_push', jsonb_build_object('match', gen_random_uuid()) from generate_series(1, 2);
  m := pg_temp.duel('p1', 'p2', 1, 100);
  update public.fight_matches set params = c->'params', sim = public._fx_new(c->'params'), sim_frame = 0,
    sim_hash = public._fx_hash(public._fx_new(c->'params')), started_at = now() - interval '5 minutes' where id = m;
  update public.fight_logs set last_push_at = now() where match_id = m;
  j := public.fight_push(pg_temp.t('p2'), m, 0, pg_temp.enc(r2, 0, 120));
  j := public.fight_push(pg_temp.t('p1'), m, 0, pg_temp.enc(r1, 0, 120), p_seen_from => 0, p_seen_runs => pg_temp.enc(r2, 0, 120),
                         p_hash_frame => 60, p_hash => 1);
  assert j ? 'anticheat' and j->'anticheat'->>'code' = 'fight_hash_mismatch', format('hard: %s', j);
  assert exists (select 1 from public.anticheat_events where code = 'fight_hash_mismatch' and outcome <> 'soft' and account_id = pg_temp.a('p1')), 'hard row';
  update public.anticheat_status set strikes = 0, locked_until = null where account_id = pg_temp.a('p1');
  perform public.fight_forfeit(pg_temp.t('p2'), m);
  -- bad input in a ring match is refused (hard), the match goes on
  m := pg_temp.duel('p1', 'p2', 1, 100);
  update public.fight_matches set started_at = now() - interval '5 minutes' where id = m;
  update public.fight_logs set last_push_at = now() where match_id = m;
  j := public.fight_push(pg_temp.t('p1'), m, 0, '{2000,5}');
  assert j->'anticheat'->>'code' = 'fight_bad_input' and j->>'status' = 'live', format('bad input: %s', j);
  j := public.fight_push(pg_temp.t('p1'), m, 0, '{0,10}', p_seen_from => 5, p_seen_runs => '{0,3}');
  assert j->'anticheat'->>'code' = 'fight_bad_input' and (j->'frontiers'->>0)::int = -1, 'seen gap';
  j := public.fight_push(pg_temp.t('p1'), m, 0, '{0,99999}');
  assert j->'anticheat'->>'code' = 'fight_bad_input', 'too long';
  perform public.fight_forfeit(pg_temp.t('p2'), m);
  update public.anticheat_status set strikes = 0, locked_until = null where account_id = pg_temp.a('p1');
  raise notice 'hash check ok';
end $$;

-- ---------- 9. Conflicts: a broadcast that differs from the push; the 2-conflict lock ----------
do $$ declare m uuid; j jsonb; b1 integer; b2 integer; mt public.fight_matches; k integer; begin
  for k in 1..2 loop
    select coins into b1 from public.wallets where account_id = pg_temp.a('p3');
    select coins into b2 from public.wallets where account_id = pg_temp.a('p4');
    perform public.ring_take(pg_temp.r(), pg_temp.t('p3'), 2, 'red');
    perform public.ring_take(pg_temp.r(), pg_temp.t('p4'), 2, 'blue');
    j := public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 1000, 3);
    j := public.ring_accept(pg_temp.r(), pg_temp.t('p4'), 2, (j->'rings'->1->'offer'->>'v')::int, 3);
    m := (j->'match'->>'id')::uuid;
    update public.fight_matches set started_at = now() - interval '5 minutes' where id = m;
  update public.fight_logs set last_push_at = now() where match_id = m;
    -- red pushes idle frames; blue says it saw a punch at frame 50
    j := public.fight_push(pg_temp.t('p3'), m, 0, '{0,120}');
    j := public.fight_push(pg_temp.t('p4'), m, 0, '{0,120}', p_seen_from => 0, p_seen_runs => '{0,50,16,1,0,69}');
    select * into mt from public.fight_matches where id = m;
    assert mt.status = 'disputed' and mt.end_reason = 'conflict', format('disputed %s', mt.status);
    assert j->>'status' = 'disputed' and (j->'result'->>'void')::boolean, 'the answer says so';
    assert (select coins from public.wallets where account_id = pg_temp.a('p3')) = b1
       and (select coins from public.wallets where account_id = pg_temp.a('p4')) = b2, 'conflict refunds';
    assert (select from_frame from public.fight_conflicts where match_id = m) = 50
       and (select reporter from public.fight_conflicts where match_id = m) = pg_temp.a('p4'), 'the conflict row';
    assert (select count(*) from public.anticheat_events where code = 'fight_log_conflict' and outcome = 'soft' and detail->>'match' = m::text) = 2, 'soft to both';
  end loop;
  assert (select pvp_locked_until from public.fight_profiles where account_id = pg_temp.a('p3')) > now() + interval '6 days', 'locked after 2';
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 500, 3);
  assert j->>'refused' = 'pvp locked', format('stakes locked: %s', j->>'refused');
  j := public.ring_offer(pg_temp.r(), pg_temp.t('p3'), 2, 0, 3);
  assert (j->>'ok')::boolean, 'friendly stays open';
  assert (j->>'locked_until_ms') is not null, 'shown';
  raise notice 'conflicts ok';
end $$;

-- ---------- 10. The shade, privileges, the wipe, the ledger ----------
do $$ begin
  assert public._in_shade('bai_dat', 150, 150) and public._in_shade('bai_dat', 699, 359), 'under the ring roofs';
  assert not public._in_shade('bai_dat', 400, 230) and not public._in_shade('bai_dat', 50, 50), 'the dirt is outdoors';
  assert public._in_shade('market', 900, 260) and not public._in_shade('market', 600, 220), '0050 kept';
  assert not has_function_privilege('anon', 'public._pvp_settle(uuid, smallint, text)', 'execute'), 'private';
  assert not has_function_privilege('anon', 'public._pvp_conflicts(uuid)', 'execute'), 'private';
  assert not has_function_privilege('anon', 'public._fx_forfeit_all(uuid)', 'execute'), 'private';
  assert has_function_privilege('anon', 'public.ring_accept(uuid, text, integer, integer, integer)', 'execute'), 'granted';
  assert has_function_privilege('anon', 'public.fight_claim(text, uuid)', 'execute'), 'granted';
  assert not has_table_privilege('anon', 'public.fight_rings', 'select'), 'rings private';
  -- the wallet-lock order: always least(), then greatest()
  assert pg_get_functiondef('public._pvp_settle(uuid, smallint, text)'::regprocedure) like '%_wallet_lock(least(mt.p1, mt.p2))%_wallet_lock(greatest(mt.p1, mt.p2))%', 'settle order';
  assert pg_get_functiondef('public._pvp_void(uuid, text, text)'::regprocedure) like '%_wallet_lock(least(mt.p1, mt.p2))%_wallet_lock(greatest(mt.p1, mt.p2))%', 'void order';
  assert pg_get_functiondef('public.ring_accept(uuid, text, integer, integer, integer)'::regprocedure) like '%_wallet_lock(least(r.red, r.blue))%_wallet_lock(greatest(r.red, r.blue))%', 'accept order';
end $$;

do $$ declare m uuid; j jsonb; b2 integer; begin
  -- p5 vs p6 in room2; p5 is wiped mid-match: p6 is paid first, p5's fight rows go
  select coins into b2 from public.wallets where account_id = pg_temp.a('p6');
  m := pg_temp.duel('p5', 'p6', 1, 1000, 'room2');
  perform public._ac_wipe(pg_temp.a('p5'), pg_temp.a('p1'));
  assert (select status from public.fight_matches where id = m) = 'done' and (select winner from public.fight_matches where id = m) = 2, 'wipe forfeits';
  assert (select coins from public.wallets where account_id = pg_temp.a('p6')) = b2 - 1000 + 1900, 'opponent paid';
  assert not exists (select 1 from public.martial_enrollments where account_id = pg_temp.a('p5')), 'enrollments gone';
  assert not exists (select 1 from public.fight_profiles where account_id = pg_temp.a('p5')), 'profile gone';
  assert not exists (select 1 from public.account_items where account_id = pg_temp.a('p5') and item_id like 'vp\_%'), 'uniforms gone';
  assert (select outfit from public.characters where account_id = pg_temp.a('p5')) is null, 'undressed';
  assert not exists (select 1 from public.fight_rings where red = pg_temp.a('p5') or blue = pg_temp.a('p5')), 'corner freed';
  -- the ledger has the three reasons (48 in all)
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check') like '%fight_stake%fight_win%fight_refund%', 'ledger';
  raise notice 'shade, privileges, wipe ok';
end $$;

-- ---------- 11. Account deletion settles first ----------
do $$ declare m uuid; b integer; acc uuid := pg_temp.a('p1'); gone uuid := pg_temp.a('p2'); begin
  perform public.ring_leave(pg_temp.r(), pg_temp.t('p4'), 2);
  perform public.ring_leave(pg_temp.r(), pg_temp.t('p3'), 2);
  assert (select red from public.fight_rings where room_id = pg_temp.r() and ring = 2) is null, 'left';
  select coins into b from public.wallets where account_id = acc;
  m := pg_temp.duel('p1', 'p2', 1, 500);
  delete from public.accounts where id = gone;
  assert (select coins from public.wallets where account_id = acc) = b - 500 + 950, 'deleted account forfeits: the opponent is paid';
  assert not exists (select 1 from public.fight_matches where id = m), 'its match rows go with it';
  raise notice 'deletion ok';
end $$;

select 'v20-3 smoke: all assertions passed' as result;
