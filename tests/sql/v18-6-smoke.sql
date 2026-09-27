-- tests/sql/v18-6-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0028 (see the plan),
-- from the repo root: it re-runs 0029 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0029_fashion2.sql
reset client_min_messages;

create temp table fs_acct (acct_id uuid, tok text);
insert into fs_acct (acct_id, tok)
  select public._auth_account(token), token from public.register('fash_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare a uuid := (select acct_id from fs_acct); begin
  perform public._wallet_lock(a);
  perform public._pay(a, 200000, 'daily', 'seed');
end $$;

-- 1) a new nam row gets short/black even when 'long'/'pink' is passed
do $$ declare t text := (select tok from fs_acct); r public.characters; begin
  r := public.save_character(t, 'light', 'long', 'pink', null, 'top_baba_yellow', 'bottom_jeans', 'shoes_dep_blue', null, 'nam');
  assert r.hair = 'short' and r.hair_color = 'black', 'new nam default hair';
end $$;
-- 2) a later save with another hair leaves hair unchanged
do $$ declare t text := (select tok from fs_acct); r public.characters; begin
  r := public.save_character(t, 'warm', 'bob', 'brown', null, 'top_baba_yellow', 'bottom_jeans', 'shoes_dep_blue', null, 'nam');
  assert r.hair = 'short' and r.hair_color = 'black' and r.skin = 'warm', 'hair kept';
end $$;
-- 3) no top, no bottom
do $$ declare t text := (select tok from fs_acct); r public.characters; begin
  r := public.save_character(t, 'light', 'short', 'black', null, null, null, 'shoes_dep_blue', null, 'nam');
  assert r.top is null and r.bottom is null, 'top/bottom null';
end $$;
-- 4) buy + wear a watch
do $$ declare t text := (select tok from fs_acct); r public.characters; begin
  perform public.buy_fashion_item(t, 'acc_watch');
  r := public.save_character(t, 'light', 'short', 'black', null, null, null, 'shoes_dep_blue', null, 'nam', null, p_wrist => 'acc_watch');
  assert r.wrist = 'acc_watch', 'wrist worn';
end $$;
-- 5) a nữ hairpin on a nam
do $$ declare t text := (select tok from fs_acct); ok boolean := false; begin
  perform public.buy_fashion_item(t, 'acc_bow_red');
  begin
    perform public.save_character(t, 'light', 'short', 'black', null, null, null, 'shoes_dep_blue', null, 'nam', null, p_hairpin => 'acc_bow_red');
  exception when others then ok := sqlerrm = 'item not for this gender'; end;
  assert ok, 'hairpin gender refused';
end $$;
-- 6) salon prices and refusals
do $$ declare a uuid := (select acct_id from fs_acct); t text := (select tok from fs_acct); c0 int; j jsonb; ok boolean := false; begin
  select coins into c0 from public.wallets where account_id = a;
  j := public.salon_style(t, 'curly', 'black');
  assert (j->>'paid')::int = 300 and (j->>'coins')::int = c0 - 300, 'cut 300';
  j := public.salon_style(t, 'curly', 'blue');
  assert (j->>'paid')::int = 500 and (j->>'coins')::int = c0 - 800, 'dye 500';
  j := public.salon_style(t, 'bun', 'red');
  assert (j->>'paid')::int = 700 and (j->>'coins')::int = c0 - 1500, 'both 700';
  assert j->>'hair' = 'bun' and j->>'hair_color' = 'red', 'salon result';
  assert (select hair || '/' || hair_color from public.characters where account_id = a) = 'bun/red', 'row updated';
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'salon') = 3, 'salon ledger rows';
  begin perform public.salon_style(t, 'bun', 'red'); exception when others then ok := sqlerrm = 'no change'; end;
  assert ok, 'no change';
  ok := false;
  begin perform public.salon_style(t, 'mohawk', 'red'); exception when others then ok := sqlerrm = 'invalid option'; end;
  assert ok, 'invalid option';
  assert (select coins from public.wallets where account_id = a) = c0 - 1500, 'refusals charge nothing';
end $$;
-- 7) selling a worn top leaves it null
do $$ declare a uuid := (select acct_id from fs_acct); t text := (select tok from fs_acct); begin
  perform public.buy_fashion_item(t, 'fm_hoodie');
  perform public.save_character(t, 'light', 'short', 'black', null, 'fm_hoodie', 'bottom_jeans', 'shoes_dep_blue', null, 'nam', null, p_wrist => 'acc_watch');
  perform public.sell_fashion_item(t, 'fm_hoodie');
  assert (select top from public.characters where account_id = a) is null, 'sold top -> null';
  perform public.sell_fashion_item(t, 'acc_watch');
  assert (select wrist from public.characters where account_id = a) is null, 'sold wrist cleared';
end $$;
-- 8) grants
do $$ begin
  assert has_function_privilege('anon', 'public.salon_style(text,text,text)', 'execute'), 'salon_style granted';
  assert not has_function_privilege('anon', 'public._hair_ok(text,text)', 'execute'), '_hair_ok private';
end $$;
\echo v18.6 smoke ok
