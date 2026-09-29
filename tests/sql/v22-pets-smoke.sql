-- tests/sql/v22-pets-smoke.sql — v22 group "pets" (0085_pet_minigames.sql: the care minigames and the battle's power
-- press). Run as the superuser on the throwaway PostgreSQL cluster after the full chain (… 0074, 0077, 0085), from the
-- repo root, with the fixtures:
--   psql -v fixtures=<repo>/tests/fixtures/pet-care-cases.json -f tests/sql/v22-pets-smoke.sql
-- It re-runs 0085 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0085_pet_minigames.sql
\i supabase/migrations/0085_pet_minigames.sql
reset client_min_messages;

create temp table px as select pg_read_file(:'fixtures')::jsonb j;
create or replace function pg_temp.ints(p jsonb) returns integer[] language sql immutable as
$$ select coalesce(array(select jsonb_array_elements_text(p)::integer), '{}'::integer[]) $$;

-- 1) the fixtures: the TS rounds = the SQL replays
do $$ declare c jsonb; r jsonb; n int := 0; e text; begin
  for c in select jsonb_array_elements(j->'care') from px loop
    e := public._pcare_input_error(c->>'kind', pg_temp.ints(c->'inputs'), (c->>'ticks')::int);
    assert e is not distinct from c->'expected'->>'error', format('%s: error %s', c->>'name', e);
    if e is null then
      r := public._pcare_replay(c->>'kind', (c->>'seed')::bigint, pg_temp.ints(c->'inputs'));
      assert (r->>'score')::int = (c->'expected'->>'score')::int, format('%s: score %s', c->>'name', r);
      assert (r->>'permille')::int = (c->'expected'->>'permille')::int, format('%s: permille %s', c->>'name', r);
      assert (r->>'quick')::int = (c->'expected'->>'quick')::int, format('%s: quick %s', c->>'name', r);
      assert (r->>'suspicious')::boolean = (c->'expected'->>'suspicious')::boolean, format('%s: suspicious %s', c->>'name', r);
      assert array[public._pcare_gain(2, (r->>'permille')::int), public._pcare_gain(3, (r->>'permille')::int),
                   public._pcare_gain(5, (r->>'permille')::int), public._pcare_gain(10, (r->>'permille')::int)]
             = pg_temp.ints(c->'expected'->'gains'), format('%s: gains', c->>'name');
    end if;
    n := n + 1;
  end loop;
  assert n >= 60, format('%s care cases', n);
  n := 0;
  for c in select jsonb_array_elements(j->'press') from px loop
    assert public._ppress_round((c->>'seed')::bigint) = pg_temp.ints(c->'round'), format('%s: round', c->>'name');
    assert public._ppress_power((c->>'seed')::bigint, (c->>'press')::int) = (c->>'power')::int, format('%s: power', c->>'name');
    n := n + 1;
  end loop;
  assert n = 24, 'press cases';
  raise notice 'pet care fixtures ok';
end $$;

-- accounts: one honest player, one that sends bad rounds (its hard flags lock it)
create temp table v22 (n int, acct_id uuid, tok text);
insert into v22 select 1, public._auth_account(token), token from public.register('pv22a_' || floor(random() * 1e9)::text, 'pw123456');
insert into v22 select 2, public._auth_account(token), token from public.register('pv22b_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare r record; begin
  for r in select * from v22 loop
    perform public._wallet_lock(r.acct_id);
    perform public._pay(r.acct_id, 50000, 'daily', 'seed');
    perform public.pet_gacha_roll(r.tok);
  end loop;
end $$;

-- 2) the old instant buttons refuse
do $$ declare t text := (select tok from v22 where n = 1); pid bigint; e text; begin
  select id into pid from public.pets where account_id = (select acct_id from v22 where n = 1);
  foreach e in array array[format('select public.pet_pat(%L, %s)', t, pid), format('select public.pet_feed(%L, %s)', t, pid),
                            format('select public.pet_play(%L, %s)', t, pid), format('select public.battle_act(%L, 1, %L)', t, 'tackle')] loop
    begin execute e; assert false, 'no outdated: ' || e; exception when others then assert sqlerrm = 'outdated', e || ': ' || sqlerrm; end;
  end loop;
end $$;

-- 3) PAT: start (cooldown set), too soon, a finish before the round could end is refused… (account 2), an honest one
do $$ declare a uuid := (select acct_id from v22 where n = 1); t text := (select tok from v22 where n = 1);
  pid bigint; j jsonb; seed bigint; likes int[]; inp int[] := '{}'; p public.pets; ok boolean; sc int; begin
  select id into pid from public.pets where account_id = a;
  update public.pets set affection = 0, xp = 0, level = 1 where id = pid;
  update public.pet_owner set xp_today = 0 where account_id = a;
  j := public.pet_care_start(t, pid, 'pat');
  assert j->'round'->>'kind' = 'pat' and (j->'round'->>'ticks')::int = 530, 'pat round';
  seed := (j->'round'->>'seed')::bigint;
  assert (select pat_at from public.pets where id = pid) is not null, 'pat cooldown set at the start';
  likes := public._pcare_rub_likes(seed);
  for k in 0 .. 4 loop inp := inp || ((30 + k * 100 + 8) * 8 + likes[k + 1] + 1); end loop;
  sc := (public._pcare_rub(seed, inp)->>'score')::int;
  assert sc = 460, 'rub score ' || sc;
  update public.pet_care_rounds set started_at = now() - interval '10 seconds' where account_id = a;
  j := public.pet_care_finish(t, inp, 530, sc);
  assert j->>'result' = 'done' and (j->>'affection')::int = 2 and (j->>'xp')::int = 3, 'pat paid in full: ' || j;
  select * into p from public.pets where id = pid;
  assert p.affection = 2 and p.xp = 3, 'pat applied';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'pet_care' and meta->>'kind' = 'pat'), 'pet_care event';
  ok := false; begin perform public.pet_care_finish(t, inp, 530, sc); exception when others then ok := sqlerrm = 'no round'; end;
  assert ok, 'single use';
  ok := false; begin perform public.pet_care_start(t, pid, 'pat'); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'pat cooldown';
end $$;

-- 4) FEED: needs food (eaten at the end), a weak round still pays 40 %; PLAY: a toy, stamina, the cooldown
do $$ declare a uuid := (select acct_id from v22 where n = 1); t text := (select tok from v22 where n = 1);
  pid bigint; j jsonb; p public.pets; ok boolean; toy text; q int; begin
  select * into p from public.pets where account_id = a;
  pid := p.id;
  ok := false; begin perform public.pet_care_start(t, pid, 'feed'); exception when others then ok := sqlerrm = 'no food'; end;
  assert ok, 'feed needs food';
  insert into public.pet_items (account_id, item_id, qty) values (a, 'food_' || p.species, 2)
  on conflict (account_id, item_id) do update set qty = 2;
  update public.pet_care_rounds set started_at = now() - interval '5 seconds' where account_id = a;
  j := public.pet_care_start(t, pid, 'feed');
  update public.pet_care_rounds set started_at = now() - interval '10 seconds' where account_id = a;
  j := public.pet_care_finish(t, '{}', 551, (public._pcare_feed((j->'round'->>'seed')::bigint, '{}')->>'score')::int);
  assert j->>'result' = 'done', 'feed done ' || j;
  assert (j->>'affection')::int = public._pcare_gain(3, (j->>'permille')::int), 'feed scaled';
  select qty into q from public.pet_items where account_id = a and item_id = 'food_' || p.species;
  assert q = 1, 'food eaten';
  select c.id into toy from public.pet_item_catalog c where c.kind = 'toy' and c.species = p.species limit 1;
  insert into public.pet_items (account_id, item_id, qty) values (a, toy, 1) on conflict (account_id, item_id) do update set qty = 1;
  update public.pet_care_rounds set started_at = now() - interval '5 seconds' where account_id = a;
  j := public.pet_care_start(t, pid, 'play');
  assert (select played_at from public.pets where id = pid) > now() - interval '5 seconds', 'play cooldown set';
  update public.pet_care_rounds set started_at = now() - interval '20 seconds' where account_id = a;
  j := public.pet_care_finish(t, '{}', 820, 0);
  assert j->>'result' = 'done' and (j->>'affection')::int = 2 and (j->>'xp')::int = 4, 'play with no catch pays 40 %: ' || j;
  -- expired
  update public.pets set played_at = null, pat_at = null where id = pid;
  perform public.pet_care_start(t, pid, 'pat');
  update public.pet_care_rounds set started_at = now() - interval '5 minutes' where account_id = a;
  j := public.pet_care_finish(t, '{}', 530, 0);
  assert j->>'why' = 'expired', 'expired';
end $$;

-- 5) the hard flags (account 2): too fast, a mismatch, bad input — each refused, evidence written
do $$ declare a uuid := (select acct_id from v22 where n = 2); t text := (select tok from v22 where n = 2);
  pid bigint; j jsonb; begin
  select id into pid from public.pets where account_id = a;
  update public.anticheat_config set mode = 'log';
  j := public.pet_care_start(t, pid, 'pat');
  j := public.pet_care_finish(t, '{}', 530, 0);
  assert j->>'why' = 'refused', 'too fast refused';
  assert exists (select 1 from public.anticheat_events where account_id = a and code = 'pet_care_too_fast'), 'too_fast evidence';
  update public.pets set pat_at = null where id = pid;
  perform public.pet_care_start(t, pid, 'pat');
  update public.pet_care_rounds set started_at = now() - interval '10 seconds' where account_id = a;
  j := public.pet_care_finish(t, '{}', 530, 400);
  assert j->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'pet_care_mismatch'), 'mismatch';
  update public.pets set pat_at = null where id = pid;
  perform public.pet_care_start(t, pid, 'pat');
  update public.pet_care_rounds set started_at = now() - interval '10 seconds' where account_id = a;
  j := public.pet_care_finish(t, array[246], 530, 0);
  assert j->>'why' = 'refused' and exists (select 1 from public.anticheat_events where account_id = a and code = 'pet_care_bad_input'), 'bad input';
  -- a machine-perfect round: soft
  update public.pets set pat_at = null where id = pid;
  j := public.pet_care_start(t, pid, 'pat');
  update public.pet_care_rounds set started_at = now() - interval '10 seconds' where account_id = a;
  j := public.pet_care_finish(t, (select array_agg((30 + k * 100) * 8 + (public._pcare_rub_likes((j->'round'->>'seed')::bigint))[k + 1] + 1 order by k)
                                    from generate_series(0, 4) k), 530, 500);
  assert j->>'result' = 'done', 'soft only';
  assert exists (select 1 from public.anticheat_events where account_id = a and code = 'pet_care_timing' and outcome = 'soft'), 'soft timing';
end $$;

-- 6) the power press: seeds per side, the power in the log, fresh seeds each turn; bad / too fast presses refused
do $$ declare a uuid := (select acct_id from v22 where n = 1); t text := (select tok from v22 where n = 1);
  pid bigint; j jsonb; b public.pet_battles; s0 bigint; pw int; l jsonb; ok boolean; begin
  select id into pid from public.pets where account_id = a;
  update public.pets set fullness = 100, stats_at = now() where id = pid;
  j := public.battle_start_pve(t, 'pet', pid, (select id from public.pet_npc_catalog order by sort_order limit 1));
  select * into b from public.pet_battles where p1 = a and status = 'active';
  assert b.ps1 is not null and b.ps2 is not null and b.pw1 = 1000, 'seeded';
  assert (j->'battle'->>'press_seed')::bigint = b.ps1, 'my own seed only';
  -- too fast: 180 ticks need 2.7 s
  update public.pet_battles set acted_at = now() - interval '1 second' where id = b.id;
  j := public.battle_act_press(t, b.id, 'tackle', 40, 180);
  assert j->>'code' is not null or exists (select 1 from public.anticheat_events where account_id = a and code = 'battle_press_too_fast'), 'too fast';
  assert (select a1 from public.pet_battles where id = b.id) is null, 'no pick on a refused press';
  update public.pet_battles set acted_at = now() - interval '10 seconds' where id = b.id;
  s0 := b.ps1;
  pw := public._ppress_power(s0, 40);
  j := public.battle_act_press(t, b.id, 'tackle', 40, 180);
  assert (j->>'power')::int = pw and pw between 850 and 1150, 'power ' || j->>'power';
  select * into b from public.pet_battles where id = b.id;
  for l in select jsonb_array_elements(b.log) loop
    if (l->>'who')::int = 1 and l ? 'dmg' then assert (l->>'power')::int = pw, format('logged power %s ≠ %s (%s)', l, pw, b); end if;
    if (l->>'who')::int = 2 and l ? 'dmg' then assert (l->>'power')::int = 1000, 'the NPC keeps its roll'; end if;
  end loop;
  if b.status = 'active' then
    assert b.ps1 is distinct from s0 and b.pw1 = 1000 and b.turn = 2, 'a fresh meter each turn';
  end if;
  -- no press: 850
  assert public._ppress_power(123, null) = 850, 'no press';
  update public.anticheat_config set mode = 'log';
  if b.status = 'active' then
    update public.pet_battles set acted_at = now() - interval '10 seconds' where id = b.id;
    j := public.battle_act_press(t, b.id, 'tackle', 500, 180);
    assert exists (select 1 from public.anticheat_events where account_id = a and code = 'battle_press_bad_input'), 'bad press';
    perform public.battle_forfeit(t, b.id);
  end if;
end $$;

-- 7) privileges and the wipe
do $$ declare a uuid := (select acct_id from v22 where n = 1); t text := (select tok from v22 where n = 1); pid bigint; begin
  assert not has_function_privilege('anon', 'public._pcare_replay(text, bigint, integer[])', 'execute'), 'helper private';
  assert not has_function_privilege('anon', 'public._ppress_power(bigint, integer)', 'execute'), 'helper private';
  assert has_function_privilege('anon', 'public.pet_care_finish(text, integer[], integer, integer)', 'execute'), 'rpc public';
  assert has_function_privilege('anon', 'public.battle_act_press(text, bigint, text, integer, integer)', 'execute'), 'rpc public';
  select id into pid from public.pets where account_id = a;
  update public.pets set pat_at = null where id = pid;
  perform public.pet_care_start(t, pid, 'pat');
  insert into public.anticheat_wipes (account_id, username, snapshot) values (a, 'smoke', '{}');
  assert not exists (select 1 from public.pet_care_rounds where account_id = a), 'wiped';
end $$;

\echo 'v22-pets-smoke ok'
