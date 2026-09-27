-- tests/sql/salon-gender-smoke.sql — run as the superuser on the throwaway cluster after 0004–0035, from the repo root.
\set ON_ERROR_STOP on
set time zone 'UTC';

create temp table sg_acct (acct_id uuid, tok text);
insert into sg_acct (acct_id, tok)
  select public._auth_account(token), token from public.register('sg_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare a uuid := (select acct_id from sg_acct); begin
  perform public._wallet_lock(a);
  perform public._pay(a, 200000, 'daily', 'seed');
end $$;

do $$ declare a uuid := (select acct_id from sg_acct); t text := (select tok from sg_acct); r public.characters; j jsonb;
  ok boolean; c0 int; begin
  r := public.save_character(t, 'light', 'short', 'black', null, null, null, 'shoes_dep_blue', null, 'nam');
  assert r.hair = 'short', 'nam default';
  -- nam: nữ-only style refused, nam-only and shared accepted
  ok := false;
  begin perform public.salon_style(t, 'bun', 'black'); exception when others then ok := sqlerrm = 'hair not for this gender'; end;
  assert ok, 'nam refused bun';
  j := public.salon_style(t, 'buzz', 'black');
  assert j->>'hair' = 'buzz', 'nam buzz';
  -- switching to nu resets buzz to long, colour kept
  perform public.salon_style(t, 'buzz', 'red');
  r := public.save_character(t, 'light', 'short', 'black', null, null, null, 'shoes_dep_blue', null, 'nu');
  assert r.hair = 'long' and r.hair_color = 'red', 'nu reset to long';
  ok := false;
  begin perform public.salon_style(t, 'undercut', 'red'); exception when others then ok := sqlerrm = 'hair not for this gender'; end;
  assert ok, 'nu refused undercut';
  j := public.salon_style(t, 'curly', 'red');
  assert j->>'hair' = 'curly', 'nu curly';
  -- shared style kept across a body switch
  r := public.save_character(t, 'light', 'short', 'black', null, null, null, 'shoes_dep_blue', null, 'nam');
  assert r.hair = 'curly', 'curly kept';
  -- a legacy disallowed style (set directly) survives a same-body save and a dye-only visit
  update public.characters set hair = 'ponytail' where account_id = a;
  r := public.save_character(t, 'warm', 'short', 'black', null, null, null, 'shoes_dep_blue', null, 'nam');
  assert r.hair = 'ponytail', 'legacy kept on same body';
  select coins into c0 from public.wallets where account_id = a;
  j := public.salon_style(t, 'ponytail', 'blue');
  assert (j->>'paid')::int = 500 and j->>'hair' = 'ponytail', 'legacy dye-only';
  ok := false;
  begin perform public.salon_style(t, 'mohawk', 'red'); exception when others then ok := sqlerrm = 'invalid option'; end;
  assert ok, 'invalid option';
  assert not has_function_privilege('anon', 'public._hair_gender_ok(text,text)', 'execute'), 'helper private';
end $$;
\echo salon gender smoke ok
