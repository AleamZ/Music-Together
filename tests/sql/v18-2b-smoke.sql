-- tests/sql/v18-2b-smoke.sql — after 0004–0034 on the throwaway cluster; re-runs 0037 twice. ASSERTs stop psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0037_net_arrows.sql
\i supabase/migrations/0037_net_arrows.sql
reset client_min_messages;

create temp table na (k text primary key, v text);
insert into na select 'tok', token from public.register('na_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into na select 'room', room_id::text from public.create_room('Chài', 'pw', (select v from na where k = 'tok'));

do $$ begin
  assert public._net_rounds('[{"rarity":1,"weight_g":300}]') = 2, 'one common: 2';
  assert public._net_rounds('[{"rarity":1,"weight_g":300},{"rarity":1,"weight_g":300}]') = 2, 'two common: 2';
  assert public._net_rounds('[{"rarity":2,"weight_g":1500},{"rarity":2,"weight_g":1500},{"rarity":2,"weight_g":1500},{"rarity":2,"weight_g":1500},{"rarity":2,"weight_g":1500}]') = 5, 'big haul: 5';
  assert public._net_rounds('[{"rarity":2,"weight_g":1000},{"rarity":2,"weight_g":1000}]') = 4, 'd 6 → 4';
  assert (select count(*) from pg_proc where proname = 'finish_net') = 1, 'one finish_net';
end $$;

-- a throw hauled with 5 fish (charge 600, all shadows) → finish with n mistakes
create or replace function pg_temp.haul(t text, r uuid) returns uuid language plpgsql as $$
declare j jsonb; tid uuid; a uuid := public._auth_account(t); begin
  update public.fishing_profiles set window_casts = 0, day_casts = 0 where account_id = a;
  j := public.start_net(r, t, 252 / 8, 204 / 8, 'net_big');
  tid := (j->>'throw_id')::uuid;
  update public.net_throws set started_at = now() - interval '5 seconds' where id = tid;
  j := public.net_haul(t, tid, 600, array[0, 0, 0, 0, 0]);
  assert (j->>'count')::int = 5, format('haul 5 (%s)', j->>'count');
  update public.net_throws set hauled_at = now() - interval '10 seconds' where id = tid;
  return tid;
end $$;

do $$ declare r uuid := (select v from na where k = 'room')::uuid; t text := (select v from na where k = 'tok');
        a uuid := public._auth_account((select v from na where k = 'tok')); j jsonb; tid uuid; ok boolean; n0 int; begin
  perform public._fishing_profile(a);
  perform public._wallet_lock(a);
  update public.wallets set coins = 100000 where account_id = a;
  perform public.buy_item(t, 'bucket_large', 1);
  perform public.buy_item(t, 'net_big', 1);
  -- 0 mistakes: all 5
  tid := pg_temp.haul(t, r);
  j := public.finish_net(t, tid, 0);
  assert (j->>'count')::int = 5 and (j->>'escaped')::int = 0, 'perfect';
  delete from public.fish where account_id = a;
  -- 2 mistakes: 3
  tid := pg_temp.haul(t, r);
  j := public.finish_net(t, tid, 2);
  assert (j->>'count')::int = 3 and (j->>'escaped')::int = 2 and (select count(*) from public.fish where account_id = a) = 3, '2 escape';
  delete from public.fish where account_id = a;
  -- 4 mistakes: kéo hụt
  update public.heat_state set immune_until = null where account_id = a;
  tid := pg_temp.haul(t, r);
  j := public.finish_net(t, tid, 4);
  assert j->>'why' = 'overboard' and not exists (select 1 from public.fish where account_id = a), 'pulled in';
  assert (select immune_until > now() + interval '9 minutes' from public.heat_state where account_id = a), 'immune';
  -- too fast: 5 rounds need 4 s
  tid := pg_temp.haul(t, r);
  update public.net_throws set hauled_at = now() - interval '2 seconds' where id = tid;
  j := public.finish_net(t, tid, 0);
  assert j->>'why' = 'too_early', 'too fast';
  -- out of range
  tid := pg_temp.haul(t, r);
  ok := false;
  begin perform public.finish_net(t, tid, 5); exception when others then ok := sqlerrm = 'invalid mistakes'; end;
  assert ok, 'invalid';
  assert has_function_privilege('anon', 'public.finish_net(text, uuid, integer)', 'execute')
     and not has_function_privilege('anon', 'public._net_rounds(jsonb)', 'execute'), 'grants';
end $$;

select 'v18.2b smoke ok';
