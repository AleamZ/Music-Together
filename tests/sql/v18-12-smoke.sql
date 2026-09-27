-- tests/sql/v18-12-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0035 (see the plan),
-- from the repo root: it re-runs 0036 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0036_pets.sql
\i supabase/migrations/0036_pets.sql
reset client_min_messages;

create temp table pt_acct (acct_id uuid, tok text);
insert into pt_acct (acct_id, tok)
  select public._auth_account(token), token from public.register('pet_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare a uuid := (select acct_id from pt_acct); begin
  perform public._wallet_lock(a);
  perform public._pay(a, 50000, 'daily', 'seed');
end $$;

-- 1) empty state
do $$ declare t text := (select tok from pt_acct); j jsonb; begin
  j := public.pets_state(t);
  assert j->'pets' = '[]'::jsonb and j->'active' = 'null'::jsonb and j->'items' = '{}'::jsonb, 'empty state';
  assert (j->>'forage_today')::int = 0, 'forage 0';
end $$;
-- 2) buy a cat: -3000, active, 80/80, default name; a sanitised custom name for the second
do $$ declare a uuid := (select acct_id from pt_acct); t text := (select tok from pt_acct); c0 int; j jsonb; p jsonb; begin
  select coins into c0 from public.wallets where account_id = a;
  j := public.pet_buy(t, 'meo', 'cam');
  assert (j->>'coins')::int = c0 - 3000, 'cat costs 3000';
  p := j->'pets'->0;
  assert p->>'species' = 'meo' and p->>'name' = 'Mèo' and (p->>'fullness')::numeric = 80 and (p->>'happy')::numeric = 80, 'new cat';
  assert (j->>'active')::bigint = (p->>'id')::bigint, 'first pet is active';
  j := public.pet_buy(t, 'soc', 'do', E'  Bé\t<b>Hạt</b>  Dẻ ');
  assert j->'pets'->1->>'name' = 'BébHạt/b Dẻ', 'sanitised name: ' || (j->'pets'->1->>'name');
  assert (j->>'active')::bigint = (p->>'id')::bigint, 'second pet does not take over';
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'pet_buy') = 2, 'ledger pet_buy';
end $$;
-- 3) refusals: unknown species / variant, bad names, too many, poor
do $$ declare a uuid := (select acct_id from pt_acct); t text := (select tok from pt_acct); ok boolean; c int; begin
  ok := false; begin perform public.pet_buy(t, 'rong', 'vang'); exception when others then ok := sqlerrm = 'unknown pet'; end;
  assert ok, 'unknown species';
  ok := false; begin perform public.pet_buy(t, 'cho', 'tim'); exception when others then ok := sqlerrm = 'unknown pet'; end;
  assert ok, 'unknown variant';
  ok := false; begin perform public.pet_buy(t, 'cho', 'vang', repeat('a', 17)); exception when others then ok := sqlerrm = 'bad name'; end;
  assert ok, 'name too long';
  ok := false; begin perform public.pet_rename(t, (select id from public.pets where account_id = a order by id limit 1), ' <> ');
    exception when others then ok := sqlerrm = 'bad name'; end;
  assert ok, 'empty name';
  perform public.pet_buy(t, 'hamster', 'vang'); perform public.pet_buy(t, 'hamster', 'xam');
  perform public.pet_buy(t, 'tho', 'nau'); perform public.pet_buy(t, 'hamster', 'trang');
  select coins into c from public.wallets where account_id = a;
  ok := false; begin perform public.pet_buy(t, 'hamster', 'vang'); exception when others then ok := sqlerrm = 'too many pets'; end;
  assert ok, 'max 6';
  assert (select coins from public.wallets where account_id = a) = c, 'nothing charged';
end $$;
-- 4) rename, items, feed, play, equip
do $$ declare a uuid := (select acct_id from pt_acct); t text := (select tok from pt_acct); cat bigint; ok boolean; j jsonb; c0 int; begin
  cat := (select id from public.pets where account_id = a and species = 'meo');
  j := public.pet_rename(t, cat, 'Mướp');
  assert (select name from public.pets where id = cat) = 'Mướp', 'renamed';
  ok := false; begin perform public.pet_feed(t, cat); exception when others then ok := sqlerrm = 'no food'; end;
  assert ok, 'no food';
  select coins into c0 from public.wallets where account_id = a;
  j := public.pet_buy_item(t, 'food_meo', 3);
  assert (j->>'coins')::int = c0 - 90 and (j->'items'->>'food_meo')::int = 3, '3 cat food for 90';
  update public.pets set fullness = 10, happy = 10, stats_at = now() where id = cat;
  j := public.pet_feed(t, cat);
  assert (select fullness from public.pets where id = cat) between 49.9 and 50 and (select happy from public.pets where id = cat) between 14.9 and 15, 'fed +40/+5';
  assert (j->'items'->>'food_meo')::int = 2, 'one food used';
  ok := false; begin perform public.pet_feed(t, (select id from public.pets where account_id = a and species = 'soc'));
    exception when others then ok := sqlerrm = 'no food'; end;
  assert ok, 'cat food is not squirrel food';
  ok := false; begin perform public.pet_play(t, cat); exception when others then ok := sqlerrm = 'no toy'; end;
  assert ok, 'no toy';
  ok := false; begin perform public.pet_buy_item(t, 'toy_ball'); perform public.pet_play(t, cat); exception when others then ok := sqlerrm = 'no toy'; end;
  assert ok, 'a dog toy does not play with a cat';
  perform public.pet_buy_item(t, 'toy_wand');
  ok := false; begin perform public.pet_buy_item(t, 'toy_wand'); exception when others then ok := sqlerrm = 'already owned'; end;
  assert ok, 'toy once';
  j := public.pet_play(t, cat);
  assert (select happy from public.pets where id = cat) between 39.9 and 40, 'play +25';
  assert (j->'pets'->0->>'play_ready_ms') is not null, 'cooldown shown';
  ok := false; begin perform public.pet_play(t, cat); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'cooldown';
  ok := false; begin perform public.pet_equip(t, cat, 'head', 'meo_bow'); exception when others then ok := sqlerrm = 'not owned'; end;
  assert ok, 'equip needs owning';
  perform public.pet_buy_item(t, 'meo_bow');
  ok := false; begin perform public.pet_equip(t, cat, 'neck', 'meo_bow'); exception when others then ok := sqlerrm = 'wrong species'; end;
  assert ok, 'wrong slot';
  perform public.pet_buy_item(t, 'cho_party');
  ok := false; begin perform public.pet_equip(t, cat, 'head', 'cho_party'); exception when others then ok := sqlerrm = 'wrong species'; end;
  assert ok, 'wrong species';
  perform public.pet_equip(t, cat, 'head', 'meo_bow');
  assert (select head from public.pets where id = cat) = 'meo_bow', 'equipped';
  perform public.pet_equip(t, cat, 'head', null);
  assert (select head from public.pets where id = cat) is null, 'cleared';
end $$;
-- 5) decay, sulking, set_active
do $$ declare a uuid := (select acct_id from pt_acct); t text := (select tok from pt_acct); cat bigint; ham bigint; ok boolean; j jsonb; p jsonb; begin
  cat := (select id from public.pets where account_id = a and species = 'meo');
  ham := (select id from public.pets where account_id = a and species = 'hamster' order by id limit 1);
  update public.pets set fullness = 100, happy = 100, stats_at = now() - interval '24 hours' where id in (cat, ham);
  j := public.pets_state(t);
  select x into p from jsonb_array_elements(j->'pets') x where (x->>'id')::bigint = cat;
  assert (p->>'fullness')::numeric between 49.9 and 50.1 and (p->>'happy')::numeric between 33.2 and 33.4, 'cat decay: ' || p::text;
  select x into p from jsonb_array_elements(j->'pets') x where (x->>'id')::bigint = ham;
  assert (p->>'happy')::numeric between 66.6 and 66.7, 'hamster vui half speed: ' || p::text;
  update public.pets set fullness = 10, stats_at = now() - interval '10 hours' where id = cat;
  j := public.pets_state(t);
  select x into p from jsonb_array_elements(j->'pets') x where (x->>'id')::bigint = cat;
  assert (p->>'sulking')::boolean and (p->>'fullness')::numeric = 0, 'sulking at 0';
  ok := false; begin perform public.pet_set_active(t, cat); exception when others then ok := sqlerrm = 'sulking'; end;
  assert ok, 'a sulking pet will not come';
  j := public.pet_set_active(t, ham);
  assert (j->>'active')::bigint = ham, 'hamster out';
  j := public.pet_set_active(t, null);
  assert j->'active' = 'null'::jsonb, 'all in the shop';
  ok := false; begin perform public.pet_set_active(t, 999999999); exception when others then ok := sqlerrm = 'not your pet'; end;
  assert ok, 'not your pet';
  perform public.pet_feed(t, cat);
  j := public.pet_set_active(t, cat);
  assert (j->>'active')::bigint = cat, 'fed: comes again';
end $$;
-- 6) the cat's buff in vitals_tick: 0.9 × drain while happy; 1 when unhappy
do $$ declare a uuid := (select acct_id from pt_acct); t text := (select tok from pt_acct); cat bigint; h numeric; begin
  cat := (select id from public.pets where account_id = a and species = 'meo');
  update public.pets set fullness = 100, happy = 100, stats_at = now() where id = cat;
  assert public._pet_cat_factor(a) = 0.9, 'cat factor';
  perform public.vitals_tick(t, null);
  update public.vitals set hunger = 100, thirst = 100, last_tick = now() - interval '100 seconds', fainted_until = null where account_id = a;
  perform public.vitals_tick(t, null);
  select hunger into h from public.vitals where account_id = a;
  assert abs((100 - h) - 100 * 100.0 / 86400 * 0.9) < 0.01, 'hunger drain x0.9: ' || h;
  update public.pets set happy = 40, stats_at = now() where id = cat;
  assert public._pet_cat_factor(a) = 1, 'unhappy cat: no buff';
  update public.vitals set hunger = 100, thirst = 100, last_tick = now() - interval '100 seconds' where account_id = a;
  perform public.vitals_tick(t, null);
  select hunger into h from public.vitals where account_id = a;
  assert abs((100 - h) - 100 * 100.0 / 86400) < 0.01, 'hunger drain x1: ' || h;
end $$;
-- 7) the squirrel forages 5–30 once per 10 min, capped at 300 a day; not while in the shop or unhappy
do $$ declare a uuid := (select acct_id from pt_acct); t text := (select tok from pt_acct); sq bigint; j jsonb; c0 int; n int; begin
  sq := (select id from public.pets where account_id = a and species = 'soc');
  j := public.pet_tick(t);
  assert (j->>'found')::int = 0, 'the cat finds nothing';
  update public.pets set fullness = 100, happy = 100, stats_at = now() where id = sq;
  perform public.pet_set_active(t, sq);
  select coins into c0 from public.wallets where account_id = a;
  j := public.pet_tick(t);
  n := (j->>'found')::int;
  assert n between 5 and 30 and (j->>'coins')::int = c0 + n, 'found ' || n;
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'pet_find') = 1, 'ledger pet_find';
  j := public.pet_tick(t);
  assert (j->>'found')::int = 0, 'not again within 10 min';
  update public.pet_owner set forage_at = now() - interval '11 minutes', forage_today = 295 where account_id = a;
  j := public.pet_tick(t);
  assert (j->>'found')::int = 5 and (j->>'forage_today')::int = 300, 'capped at 300';
  update public.pet_owner set forage_at = now() - interval '11 minutes' where account_id = a;
  assert (public.pet_tick(t)->>'found')::int = 0, 'nothing over the cap';
  update public.pet_owner set forage_at = now() - interval '11 minutes', forage_day = forage_day - 1 where account_id = a;
  assert (public.pet_tick(t)->>'found')::int > 0, 'a new day';
  update public.pet_owner set forage_at = now() - interval '11 minutes' where account_id = a;
  update public.pets set happy = 50, stats_at = now() where id = sq;
  assert (public.pet_tick(t)->>'found')::int = 0, 'vui 50: nothing';
end $$;
-- 8) grants
do $$ begin
  assert has_function_privilege('anon', 'public.pets_state(text)', 'execute'), 'pets_state granted';
  assert has_function_privilege('anon', 'public.pet_buy(text,text,text,text)', 'execute'), 'pet_buy granted';
  assert has_function_privilege('anon', 'public.pet_tick(text)', 'execute'), 'pet_tick granted';
  assert has_function_privilege('anon', 'public.pet_equip(text,bigint,text,text)', 'execute'), 'pet_equip granted';
  assert not has_function_privilege('anon', 'public._pets_state(uuid)', 'execute'), '_pets_state private';
  assert not has_function_privilege('anon', 'public._pet_mine(uuid,bigint)', 'execute'), '_pet_mine private';
  assert not has_function_privilege('anon', 'public._pet_cat_factor(uuid)', 'execute'), '_pet_cat_factor private';
  assert not has_function_privilege('anon', 'public._vitals_apply(uuid,numeric,numeric)', 'execute'), '_vitals_apply private';
  assert not has_table_privilege('anon', 'public.pets', 'select'), 'pets table private';
end $$;
\echo v18.12 smoke ok
