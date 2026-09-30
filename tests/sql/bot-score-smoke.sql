-- tests/sql/bot-score-smoke.sql — 0109 (the silent bot score). Run as the superuser on the throwaway cluster after the
-- full chain, from the repo root. It re-runs 0109 twice with \i (re-runnable) and deletes its accounts at the end.
--   1. A: _ac_rate tracks the session (a 15-minute gap restarts it) and one ac_hours row per clock hour.
--   2. B: the score from each signal; keep_pct at bot_soft / bot_hard; one soft bot_score a day; root is never scaled.
--   3. C: _pay scales a faucet (at least 1 xu), never a refund, a trade or a debit; the ledger follows the wallet;
--      admin_bot_clear exempts the account; bot_enabled off keeps 100 %.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0109_bot_score.sql
\i supabase/migrations/0109_bot_score.sql
reset client_min_messages;

create temp table bs (k text primary key, v text);
do $$
declare n text; r text;
begin
  foreach n in array array['a', 'b'] loop
    r := 'bs' || n || '_' || floor(random() * 1e9)::text;
    insert into bs select 't' || n, token from public.register(r, 'pw123456');
    insert into bs select n, public._auth_account((select v from bs where k = 't' || n))::text;
  end loop;
end $$;
create or replace function pg_temp.u(key text) returns uuid language sql stable as $$ select v::uuid from bs where k = key $$;

-- ---------- 1. A ----------
do $$
declare a uuid := pg_temp.u('a');
begin
  delete from public.ac_rate where account_id = a;
  perform public._ac_guard(a);
  assert (select active_since is not null and last_at is not null and hour_mark = date_trunc('hour', now())
            from public.ac_rate where account_id = a), 'the session starts';
  assert (select count(*) from public.ac_hours where account_id = a and hour = date_trunc('hour', now())) = 1, 'the hour';
  update public.ac_rate set active_since = now() - interval '3 hours', last_at = now() - interval '5 minutes' where account_id = a;
  perform public._ac_guard(a);
  assert (select active_since < now() - interval '170 minutes' from public.ac_rate where account_id = a), 'no gap: the session goes on';
  update public.ac_rate set last_at = now() - interval '16 minutes' where account_id = a;
  perform public._ac_guard(a);
  assert (select active_since > now() - interval '1 second' from public.ac_rate where account_id = a), 'a gap restarts it';
  raise notice 'session ok';
end $$;

-- ---------- 2. B ----------
do $$
declare a uuid := pg_temp.u('a'); b public.ac_bot;
begin
  delete from public.ac_hours where account_id = a;
  delete from public.anticheat_events where account_id = a;
  update public.ac_rate set active_since = now() - interval '2 hours', last_at = now() where account_id = a;
  b := public._ac_bot_score(a);
  assert b.score = 0 and b.keep_pct = 100, format('clean %s', to_jsonb(b));
  -- 11 h without a break (+4), 21 of the last 24 hours (+4), silent (+1): 9 = hard
  update public.ac_rate set active_since = now() - interval '11 hours' where account_id = a;
  insert into public.ac_hours select a, date_trunc('hour', now()) - make_interval(hours => h) from generate_series(0, 20) h
  on conflict do nothing;
  b := public._ac_bot_score(a);
  assert b.score = 9 and b.keep_pct = 20 and (b.signals->>'silent')::boolean, format('hard %s', to_jsonb(b));
  assert (select count(*) from public.anticheat_events where account_id = a and code = 'bot_score' and outcome = 'soft') = 1, 'evented';
  b := public._ac_bot_score(a);
  assert (select count(*) from public.anticheat_events where account_id = a and code = 'bot_score') = 1, 'once a day';
  -- a chat line takes the silent point off: 8 = soft
  insert into public.chat_messages (room_id, account_id, username, body)
  select r.id, a, 'x', 'chào' from public.rooms r limit 1;
  if found then
    b := public._ac_bot_score(a);
    assert b.score = 8 and b.keep_pct = 50, format('soft %s', to_jsonb(b));
    delete from public.chat_messages where account_id = a;
  end if;
  -- the timing and rate signals
  insert into public.anticheat_events (account_id, username, code, outcome, rpc)
  select a, 'x', 'reel_timing', 'soft', 'finish_cast' from generate_series(1, 10);
  insert into public.anticheat_events (account_id, username, code, outcome, rpc)
  select a, 'x', 'rate_high', 'soft', 'rate' from generate_series(1, 3);
  b := public._ac_bot_score(a);
  assert b.score = 13 and b.signals->>'timing' = '10' and b.signals->>'rate' = '3', format('all %s', to_jsonb(b));
  -- root is scored but never scaled
  update public.accounts set is_root = true where id = a;
  b := public._ac_bot_score(a);
  assert b.keep_pct = 100, 'root';
  update public.accounts set is_root = false where id = a;
  perform public._ac_bot_score(a);
  raise notice 'score ok';
end $$;

-- ---------- 3. C ----------
do $$
declare a uuid := pg_temp.u('a'); v0 integer;
begin
  insert into public.wallets (account_id) values (a) on conflict do nothing;
  update public.wallets set coins = 1000 where account_id = a;
  assert public._ac_keep_pct(a) = 20, 'hard keeps 20 %';
  perform public._pay(a, 500, 'ore_sell', 't');
  assert (select coins from public.wallets where account_id = a) = 1100, 'a faucet: 20 %';
  assert (select delta from public.coin_ledger where account_id = a order by id desc limit 1) = 100, 'the ledger';
  perform public._pay(a, 3, 'sell', 't');
  assert (select coins from public.wallets where account_id = a) = 1101, 'at least 1 xu';
  perform public._pay(a, 500, 'market_refund', 't');
  perform public._pay(a, 500, 'trade', 't');
  assert (select coins from public.wallets where account_id = a) = 2101, 'refunds and trades in full';
  perform public._pay(a, -300, 'buy', 't');
  assert (select coins from public.wallets where account_id = a) = 1801, 'a debit in full';
  update public.anticheat_config set bot_enabled = false;
  perform public._ac_bot_score(a);
  assert public._ac_keep_pct(a) = 100, 'switched off';
  update public.anticheat_config set bot_enabled = true;
  perform public._ac_bot_score(a);
  update public.ac_bot set exempt_until = now() + interval '7 days' where account_id = a;   -- admin_bot_clear's write
  assert public._ac_keep_pct(a) = 100, 'cleared';
  v0 := (select coins from public.wallets where account_id = a);
  perform public._pay(a, 500, 'ore_sell', 't');
  assert (select coins from public.wallets where account_id = a) = v0 + 500, 'cleared: in full';
  assert public._ac_keep_pct(pg_temp.u('b')) = 100, 'an unscored account';
  raise notice 'pay ok';
end $$;

delete from public.accounts where id in (pg_temp.u('a'), pg_temp.u('b'));
do $$ begin raise notice 'bot score smoke ok'; end $$;
