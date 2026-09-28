-- tests/sql/anticheat-v2-net-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0056, from
-- the repo root, with the fixture's absolute path:  psql -v fixtures=<repo>/tests/fixtures/net-cases.json -f <this file>
-- It re-runs 0056 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\i supabase/migrations/0056_net_replay.sql
\i supabase/migrations/0056_net_replay.sql
reset client_min_messages;

-- ---------- 1. The shared fixtures: the SQL sim = lib/game/fishing/net.ts ----------
create temp table fx as select pg_read_file(:'fixtures')::jsonb j;

create or replace function pg_temp.ints(v jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;

do $$
declare c jsonb; r jsonb; nh integer := 0; na integer := 0; i jsonb; plan integer[];
begin
  for c in select jsonb_array_elements(j) from fx loop
    if c->>'kind' = 'haul' then
      i := c->'input';
      assert public._net_throw_error((i->>'press')::int, (i->>'release')::int, (i->>'aimX')::int, (i->>'aimY')::int) is null,
        format('%s: an honest throw is refused', c->>'name');
      r := public._net_haul_replay((c->>'seed')::bigint, (c->>'radiusPx')::int, (i->>'press')::int, (i->>'release')::int,
                                   (i->>'aimX')::int, (i->>'aimY')::int);
      assert (r->>'quality')::int = (c->'expected'->>'quality')::int
         and (r->>'land_tick')::int = (c->'expected'->>'landTick')::int
         and r->'caught' = c->'expected'->'caught'
         and (r->>'hits')::int = (c->'expected'->>'hits')::int
         and (r->>'count')::int = (c->'expected'->>'count')::int,
        format('%s: sql %s, ts %s', c->>'name', r, c->'expected');
      nh := nh + 1;
    else
      plan := public._net_plan(jsonb_build_array() || (select coalesce(jsonb_agg(jsonb_build_object(
                'rarity', f->'rarity', 'weight_g', f->'weightG')), '[]'::jsonb) from jsonb_array_elements(c->'fish') f));
      assert plan = array[(c->'plan'->>'rounds')::int, (c->'plan'->>'keys')::int, (c->'plan'->>'timer')::int],
        format('%s: plan sql %s, ts %s', c->>'name', plan, c->'plan');
      assert public._net_keys_error(pg_temp.ints(c->'keys'), (c->'expected'->>'ticks')::int) is null,
        format('%s: honest keys refused (%s)', c->>'name', public._net_keys_error(pg_temp.ints(c->'keys'), (c->'expected'->>'ticks')::int));
      r := public._net_arrow_replay((c->>'seed')::bigint, plan, pg_temp.ints(c->'keys'));
      assert r = c->'expected', format('%s: sql %s, ts %s', c->>'name', r, c->'expected');
      na := na + 1;
    end if;
  end loop;
  assert nh >= 12 and na >= 10, format('fixtures: %s hauls, %s pulls', nh, na);
  raise notice 'fixtures ok: % hauls, % pulls', nh, na;
end $$;

-- the pieces: isin's quarters, the power's peak, the checks of keys no client sends
do $$
begin
  assert public._net_isin(0, 400) = 0 and public._net_isin(100, 400) = 1000 and public._net_isin(300, 400) = -1000
     and public._net_isin(50, 400) = 750, 'isin';
  assert public._net_q(36, 72) = 1000 and public._net_q(18, 72) = 750 and public._net_q(0, 72) = 0, 'quality';
  assert public._net_aim_error(80000, 40000) is null and public._net_aim_error(80000, 75000) = 'aim'
     and public._net_aim_error(10000, 8000) = 'aim', 'aim';
  assert public._net_keys_error(array[8, 4], 10) = 'order' and public._net_keys_error(array[-1], 10) = 'range'
     and public._net_keys_error(array[44], 10) = 'range' and public._net_keys_error('{}', 3601) = 'ticks'
     and public._net_keys_error((select array_agg(g * 4) from generate_series(0, 20) g), 100) = 'rate'
     and public._net_keys_error((select array_agg(g * 40) from generate_series(0, 64) g), 3000) = 'too_many', 'keys';
  assert public._net_arrow_replay(1, array[2, 4, 200], array[400 * 4]) = '{"error": "late"}'::jsonb, 'a key after the end';
  assert public._net_arrow_replay(1, array[2, 4, 200], '{}') = '{"mistakes": 2, "ticks": 400}'::jsonb, 'no keys';
  raise notice 'pieces ok';
end $$;

-- ---------- 2. The RPCs ----------
create temp table ns (k text primary key, v text);
insert into ns select 't', token from public.register('ns_' || floor(random() * 1e9)::text, 'pw123456');
insert into ns select 'a', public._auth_account(v)::text from ns where k = 't';
insert into ns select 'room', room_id::text from public.create_room('Net smoke', 'pw', (select v from ns where k = 't'));
update public.anticheat_config set mode = 'log';

-- a fresh throw with bars and the net topped up; the answer
create or replace function pg_temp.throw() returns jsonb language plpgsql as $$
declare t text := (select v from ns where k = 't'); a uuid := (select v from ns where k = 'a')::uuid;
        room uuid := (select v from ns where k = 'room')::uuid;
begin
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  delete from public.fish where account_id = a;
  insert into public.inventory (account_id, item_id, qty, durability) values (a, 'net_big', 1, 30)
  on conflict (account_id, item_id) do update set qty = 1, durability = 30;
  insert into public.vitals (account_id) values (a) on conflict do nothing;
  update public.vitals set hunger = 80, thirst = 80, starve_s = 0, fainted_until = null, last_tick = now() where account_id = a;
  return public.start_net(room, t, 252 / 8, 204 / 8, 'net_big');
end $$;

-- an honest throw at the seed's school: full power over a shadow; {press, release, x, y, hits, count}
create or replace function pg_temp.aim(p_seed bigint) returns jsonb language plpgsql as $$
declare sch bigint[] := public._net_school(p_seed); s bigint[]; rep jsonb;
begin
  for rel in 60 .. 3000 by 30 loop
    for i in 0 .. 4 loop
      s := public._net_shadow(sch, rel + 42, i);
      if public._net_aim_error(s[1]::int, s[2]::int) is null then
        rep := public._net_haul_replay(p_seed, 36, rel - (sch[1] / 2)::int, rel, s[1]::int, s[2]::int);
        if (rep->>'count')::int >= 1 then
          return jsonb_build_object('press', rel - sch[1] / 2, 'release', rel, 'x', s[1], 'y', s[2], 'hits', rep->'hits',
                                    'count', rep->'count');
        end if;
      end if;
    end loop;
  end loop;
  return null;
end $$;

-- clean typing of kéo lưới for a throw's arrow seed and haul: {keys, ticks}
create or replace function pg_temp.clean_keys(p_seed bigint, p_haul jsonb) returns jsonb language plpgsql as $$
declare plan integer[] := public._net_plan(p_haul); seq integer[]; keys integer[] := '{}'; tk integer := 20;
begin
  for r in 0 .. plan[1] - 1 loop
    seq := public._net_arrow_seq(p_seed, r, plan[2]);
    for k in 1 .. plan[2] loop
      keys := keys || (tk * 4 + seq[k]);
      tk := tk + 10;
    end loop;
  end loop;
  return jsonb_build_object('keys', to_jsonb(keys), 'ticks', tk - 10);
end $$;

-- 2a. start_net opens the aim: nothing spent, the arrow seed kept back
do $$
declare a uuid := (select v from ns where k = 'a')::uuid; j jsonb; v public.vitals;
begin
  j := pg_temp.throw();
  assert j ? 'throw_id' and j ? 'seed' and not (j ? 'arrow_seed'), format('start %s', j);
  assert (select durability from public.inventory where account_id = a and item_id = 'net_big') = 30, 'no use spent at start';
  select * into v from public.vitals where account_id = a;
  assert v.hunger > 79.9 and v.thirst > 79.9, format('no effort at start %s / %s', v.hunger, v.thirst);
  assert (select arrow_seed from public.net_throws where id = (j->>'throw_id')::uuid) is not null, 'arrow seed stored';
  j := pg_temp.throw();                                                    -- Esc and again: still nothing spent
  assert (select durability from public.inventory where account_id = a and item_id = 'net_big') = 30, 'reopen spends nothing';
  assert (select count(*) from public.net_throws where account_id = a) = 1, 'one throw per account';
  raise notice 'start ok';
end $$;

-- 2b. an honest haul and pull: the replay's count, spent at the haul, the arrow seed in the answer; clean keys → all fish
do $$
declare t text := (select v from ns where k = 't'); a uuid := (select v from ns where k = 'a')::uuid; j jsonb; h jsonb;
        tid uuid; x jsonb; k jsonb; v public.vitals;
begin
  j := pg_temp.throw();
 tid := (j->>'throw_id')::uuid;
  x := pg_temp.aim((j->>'seed')::bigint);
  assert x is not null, 'an aim over the school';
  update public.net_throws set started_at = now() - interval '70 seconds' where id = tid;
  h := public.net_haul(t, tid, (x->>'press')::int, (x->>'release')::int, (x->>'x')::int, (x->>'y')::int, (x->>'hits')::int);
  assert h->>'result' = 'haul' and (h->>'count')::int = least((x->>'count')::int, 1 + public._bucket_cap(a)) and h ? 'arrow_seed' and not (h ? 'anticheat'),
    format('haul %s (expected %s)', h, x);
  assert (select durability from public.inventory where account_id = a and item_id = 'net_big') = 29, 'one use spent at the haul';
  select * into v from public.vitals where account_id = a;
  assert v.hunger between 76.9 and 77 and v.thirst between 76.4 and 76.5, format('effort at the haul %s / %s', v.hunger, v.thirst);
  assert (select land_tick from public.net_throws where id = tid) = (x->>'release')::int + 42, 'land tick kept';
  k := pg_temp.clean_keys((h->>'arrow_seed')::bigint, h->'fish');
  update public.net_throws set hauled_at = now() - interval '30 seconds' where id = tid;
  j := public.finish_net(t, tid, pg_temp.ints(k->'keys'), (k->>'ticks')::int, 0);
  assert j->>'result' = 'caught' and (j->>'count')::int = (h->>'count')::int and (j->>'escaped')::int = 0,
    format('clean pull %s', j);
  assert (select count(*) from public.fish where account_id = a) = (h->>'count')::int, 'the fish are in the bag';
  raise notice 'honest haul and pull ok (% fish)', h->>'count';
end $$;

-- 2c. the hard flags: too fast, a mismatch, an input no client makes (log mode: recorded, strike 0)
do $$
declare t text := (select v from ns where k = 't'); a uuid := (select v from ns where k = 'a')::uuid; j jsonb; h jsonb;
        tid uuid; x jsonb; n0 integer;
begin
  n0 := (select count(*) from public.anticheat_events where account_id = a);
  -- too fast: the haul right after start_net
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid; x := pg_temp.aim((j->>'seed')::bigint);
  h := public.net_haul(t, tid, (x->>'press')::int, (x->>'release')::int, (x->>'x')::int, (x->>'y')::int, (x->>'hits')::int);
  assert h->>'why' = 'too_early' and h->'anticheat'->>'code' = 'net_too_fast', format('too fast %s', h);
  assert not exists (select 1 from public.net_throws where id = tid), 'the throw is gone';
  assert (select durability from public.inventory where account_id = a and item_id = 'net_big') = 29, 'still spent';
  -- a mismatch: one more hit than the replay
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid; x := pg_temp.aim((j->>'seed')::bigint);
  update public.net_throws set started_at = now() - interval '70 seconds' where id = tid;
  h := public.net_haul(t, tid, (x->>'press')::int, (x->>'release')::int, (x->>'x')::int, (x->>'y')::int, (x->>'hits')::int + 1);
  assert h->>'why' = 'net_invalid' and h->'anticheat'->>'code' = 'net_mismatch' and (h->'anticheat'->>'strike')::int = 0,
    format('mismatch %s', h);
  -- an aim off the water; a release before the press; a null
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '70 seconds' where id = tid;
  h := public.net_haul(t, tid, 0, 30, 0, 0, 0);
  assert h->>'why' = 'net_invalid' and h->'anticheat'->>'code' = 'net_bad_input', format('bad aim %s', h);
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid;
  h := public.net_haul(t, tid, 50, 30, 80000, 40000, 0);
  assert h->'anticheat'->>'code' = 'net_bad_input', format('release before press %s', h);
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid;
  h := public.net_haul(t, tid, 0, 30, 80000, 40000, null);
  assert h->'anticheat'->>'code' = 'net_bad_input', format('null hits %s', h);
  assert (select count(*) from public.anticheat_events where account_id = a and outcome = 'log_only'
            and code in ('net_too_fast', 'net_mismatch', 'net_bad_input')) = n0 + 5, 'five events';
  raise notice 'haul flags ok';
end $$;

-- 2d. kéo lưới's flags: a wrong mistake count, keys out of order, too fast; the 4th mistake pulls me in
do $$
declare t text := (select v from ns where k = 't'); a uuid := (select v from ns where k = 'a')::uuid; j jsonb; h jsonb;
        tid uuid; x jsonb; k jsonb; seq integer[]; hu numeric;
begin
  for step in 1 .. 4 loop
    j := pg_temp.throw();tid := (j->>'throw_id')::uuid; x := pg_temp.aim((j->>'seed')::bigint);
    update public.net_throws set started_at = now() - interval '70 seconds' where id = tid;
    h := public.net_haul(t, tid, (x->>'press')::int, (x->>'release')::int, (x->>'x')::int, (x->>'y')::int, (x->>'hits')::int);
    assert h->>'result' = 'haul', format('haul %s', h);
    k := pg_temp.clean_keys((h->>'arrow_seed')::bigint, h->'fish');
    if step = 1 then
      update public.net_throws set hauled_at = now() - interval '30 seconds' where id = tid;
      j := public.finish_net(t, tid, pg_temp.ints(k->'keys'), (k->>'ticks')::int, 1);
      assert j->>'why' = 'net_invalid' and j->'anticheat'->>'code' = 'net_mismatch', format('mistakes mismatch %s', j);
    elsif step = 2 then
      update public.net_throws set hauled_at = now() - interval '30 seconds' where id = tid;
      j := public.finish_net(t, tid, array[80, 40], 30, 0);
      assert j->'anticheat'->>'code' = 'net_bad_input', format('order %s', j);
    elsif step = 3 then                                                    -- hauled just now: the keys took seconds
      j := public.finish_net(t, tid, pg_temp.ints(k->'keys'), (k->>'ticks')::int, 0);
      assert j->>'why' = 'too_early' and j->'anticheat'->>'code' = 'net_too_fast', format('pull too fast %s', j);
    else                                                                   -- four wrong keys at once: kéo hụt
      seq := public._net_arrow_seq((h->>'arrow_seed')::bigint, 0, (public._net_plan(h->'fish'))[2]);
      hu := (select hunger from public.vitals where account_id = a);
      j := public.finish_net(t, tid, array[(30 * 4 + (seq[1] + 1) % 4), (31 * 4 + (seq[1] + 1) % 4),
                                          (32 * 4 + (seq[1] + 1) % 4), (33 * 4 + (seq[1] + 1) % 4)], 33, 4);
      assert j->>'why' = 'overboard' and not (j ? 'anticheat'), format('kéo hụt %s', j);
      assert (select hunger from public.vitals where account_id = a) between hu - 10.01 and hu - 9.9, 'hunger −10';
    end if;
    assert not exists (select 1 from public.net_throws where id = tid), 'single use';
  end loop;
  raise notice 'pull flags ok';
end $$;

-- 2e. the old page: net_haul with charge/offsets and finish_net with a bare count → outdated, nothing spent, no flag
do $$
declare t text := (select v from ns where k = 't'); a uuid := (select v from ns where k = 'a')::uuid; j jsonb; tid uuid;
        n0 integer := (select count(*) from public.anticheat_events where account_id = (select v from ns where k = 'a')::uuid);
begin
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '70 seconds' where id = tid;
  j := public.net_haul(t, tid, 600, array[0, 0, 0, 0, 0]);
  assert j->>'why' = 'outdated' and j->>'message' = 'Cập nhật trang để quăng lưới tiếp', format('old haul %s', j);
  assert not exists (select 1 from public.net_throws where id = tid), 'old haul drops the throw';
  assert (select durability from public.inventory where account_id = a and item_id = 'net_big') = 30, 'old haul spends nothing';
  j := public.finish_net(t, tid, 0);
  assert j->>'why' = 'outdated', format('old finish %s', j);
  -- a throw rolled before 0056 (no arrow seed)
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid;
  update public.net_throws set arrow_seed = null, started_at = now() - interval '70 seconds' where id = tid;
  j := public.net_haul(t, tid, 0, 30, 80000, 40000, 0);
  assert j->>'why' = 'outdated', format('pre-0056 throw %s', j);
  assert (select count(*) from public.anticheat_events where account_id = a) = n0, 'no flag for an old page';
  raise notice 'outdated ok';
end $$;

-- 2f. expired: over 120 s after start_net
do $$
declare t text := (select v from ns where k = 't'); j jsonb; tid uuid;
begin
  j := pg_temp.throw();tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '121 seconds' where id = tid;
  j := public.net_haul(t, tid, 0, 30, 80000, 40000, 0);
  assert j->>'why' = 'expired', format('expired %s', j);
  raise notice 'expired ok';
end $$;

-- ---------- 3. Privileges ----------
do $$
begin
  assert has_function_privilege('anon', 'public.net_haul(text, uuid, integer, integer, integer, integer, integer)', 'execute')
     and has_function_privilege('anon', 'public.finish_net(text, uuid, integer[], integer, integer)', 'execute')
     and has_function_privilege('anon', 'public.net_haul(text, uuid, integer, integer[])', 'execute')
     and has_function_privilege('anon', 'public.finish_net(text, uuid, integer)', 'execute')
     and has_function_privilege('anon', 'public.start_net(uuid, text, integer, integer, text)', 'execute'), 'RPCs public';
  assert not has_function_privilege('anon', 'public._net_haul_replay(bigint, integer, integer, integer, integer, integer)', 'execute')
     and not has_function_privilege('anon', 'public._net_arrow_replay(bigint, integer[], integer[])', 'execute')
     and not has_function_privilege('anon', 'public._net_school(bigint)', 'execute')
     and not has_function_privilege('anon', 'public._net_outdated(uuid)', 'execute'), 'helpers private';
  raise notice 'privileges ok';
end $$;

select 'anticheat v2 net smoke ok';
