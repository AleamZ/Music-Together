-- tests/sql/story-quests-smoke.sql — the story chain (0114). Run as the superuser on the throwaway cluster after the full
-- chain, from the repo root. Re-applies 0114 (re-runnable). Every check is an ASSERT; its own accounts are deleted at
-- the end.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0114_story_quests.sql
\i supabase/migrations/0114_story_quests.sql
reset client_min_messages;

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;

-- stand beside an NPC: no known position (the first claim is free), then hand in at its spot
create or replace function pg_temp.turn_in(t text, q text) returns jsonb language plpgsql as $$
declare n public.story_npcs;
begin
  delete from public.player_pos where account_id = public._auth_account(t);
  select s.* into n from public.story_npcs s join public.story_quests d on d.turnin = s.id where d.id = q;
  return public.story_turn_in(t, q, n.x, n.y);
end $$;
-- one DO block is one transaction (one now()): age what happened so far, as a later accept would see it
create or replace function pg_temp.age(a uuid) returns void language sql as $$
  update public.coin_ledger set created_at = created_at - interval '1 minute' where account_id = a;
  update public.game_events set created_at = created_at - interval '1 minute' where account_id = a;
$$;
create or replace function pg_temp.st(j jsonb, q text) returns text language sql as $$
  select x.status from jsonb_to_recordset(j->'quests') x(id text, status text) where x.id = q
$$;

update public.anticheat_config set min_client_build = 0;
create temp table sk (k text primary key, v text);
insert into sk select 't1', token from public.register('sq1_' || floor(random() * 1e9)::text, 'pw123456');
insert into sk select 't2', token from public.register('sq2_' || floor(random() * 1e9)::text, 'pw123456');
insert into sk select 'a' || substr(k, 2), public._auth_account(v)::text from sk where k like 't_';

-- ---------- 1. The chain, step by step ----------
do $$
declare t text := (select v from sk where k = 't1'); a uuid := (select v from sk where k = 'a1')::uuid; j jsonb;
        v_bal integer; v_mail bigint;
begin
  j := public.story_state(t);
  assert jsonb_array_length(j->'quests') = 11, 'eleven steps';
  assert jsonb_array_length(j->'npcs') = 5, 'five npcs';
  assert j->>'current' = 's01_chao' and pg_temp.st(j, 's01_chao') = 'available', 'first offered';
  assert pg_temp.st(j, 's02_can') = 'locked', 'second locked';
  assert not (j->>'finished')::boolean and not (j->>'veteran')::boolean, 'fresh';
  assert pg_temp.err(format('select public.story_accept(%L, %L)', t, 's02_can')) = 'quest locked', 'locked';
  assert pg_temp.err(format('select public.story_accept(%L, %L)', t, 'nope')) = 'unknown quest', 'unknown';

  -- s01: talk — handed in at cô Ba (the pond), not at bác Ba
  j := public.story_accept(t, 's01_chao');
  assert pg_temp.st(j, 's01_chao') = 'done', 'talk is done at once';
  assert pg_temp.err(format('select public.story_accept(%L, %L)', t, 's01_chao')) = 'already accepted', 'twice';
  delete from public.player_pos where account_id = a;
  assert pg_temp.err(format('select public.story_turn_in(%L, %L, 570, 300)', t, 's01_chao')) = 'too far', 'too far';
  delete from public.player_pos where account_id = a;
  select coalesce(coins, 0) into v_bal from public.wallets where account_id = a;
  j := pg_temp.turn_in(t, 's01_chao');
  assert (j->>'paid')::int = 20, 'paid 20';
  assert (select coins from public.wallets where account_id = a) = coalesce(v_bal, 0) + 20, 'wallet';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'quest_reward' and ref = 'story:s01_chao'), 'ledger';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'xp_grant' and meta->>'source' = 'story'), 'xp';
  assert pg_temp.err(format('select pg_temp.turn_in(%L, %L)', t, 's01_chao')) = 'already claimed', 'claimed once';
  assert pg_temp.st(j, 's02_can') = 'available', 'next';

  perform public.story_accept(t, 's02_can');
  perform pg_temp.turn_in(t, 's02_can');

  -- s03: buy bait — only a bait purchase after the accept counts
  perform public._pay(a, -1, 'buy', 'bait_shrimp x1');                                -- before: not counted
  update public.coin_ledger set created_at = now() - interval '1 minute' where account_id = a and ref = 'bait_shrimp x1';
  perform public.story_accept(t, 's03_moi');
  assert pg_temp.err(format('select public.story_accept(%L, %L)', t, 's04_cau')) = 'story busy', 'one at a time';
  assert pg_temp.err(format('select pg_temp.turn_in(%L, %L)', t, 's03_moi')) = 'not done', 'not bought yet';
  perform public._pay(a, -3, 'buy', 'hook_small x1');                                  -- not bait
  assert pg_temp.st(public.story_state(t), 's03_moi') = 'active', 'hook is no bait';
  perform public._pay(a, -1, 'buy', 'bait_shrimp x1');
  assert pg_temp.st(public.story_state(t), 's03_moi') = 'done', 'bait bought';
  perform pg_temp.turn_in(t, 's03_moi');
  assert (select qty from public.inventory where account_id = a and item_id = 'gb_cam') = 2, 'thính reward';

  -- s04: one catch, handed in to cô Ba
  perform pg_temp.age(a);
  perform public.story_accept(t, 's04_cau');
  perform public._game_event(a, 'fish_catch', 1, '{}');
  perform pg_temp.turn_in(t, 's04_cau');

  -- s05: sold at cô Ba's, not at Chợ Lớn
  perform pg_temp.age(a);
  perform public.story_accept(t, 's05_ban');
  perform public._pay(a, 12, 'sell', '1 con (Chợ Lớn)');
  assert pg_temp.st(public.story_state(t), 's05_ban') = 'active', 'Chợ Lớn is not cô Ba';
  perform public._pay(a, 10, 'sell', '1 con');
  perform pg_temp.turn_in(t, 's05_ban');
  assert (select qty from public.inventory where account_id = a and item_id = 'bucket_small') = 1, 'the bucket';

  -- s06: three catches
  perform pg_temp.age(a);
  perform public.story_accept(t, 's06_xo');
  perform public._game_event(a, 'fish_catch', 1, '{}');
  perform public._game_event(a, 'fish_catch', 1, '{}');
  j := public.story_state(t);
  assert (select x.progress from jsonb_to_recordset(j->'quests') x(id text, progress int) where x.id = 's06_xo') = 2, '2/3';
  perform public._game_event(a, 'fish_catch', 1, '{}');
  perform pg_temp.turn_in(t, 's06_xo');

  -- s07: the letter — sent once at the accept, done when read
  perform public.story_accept(t, 's07_thu');
  select id into v_mail from public.mail where account_id = a and ref = 'story:s07_thu';
  assert v_mail is not null, 'letter sent';
  assert (select count(*) from public.mail_items where mail_id = v_mail) = 1, 'letter gift';
  assert pg_temp.st(public.story_state(t), 's07_thu') = 'active', 'unread';
  perform public.mail_read(t, v_mail);
  perform pg_temp.turn_in(t, 's07_thu');

  -- s08, s09: the field
  perform public.story_accept(t, 's08_dong');
  perform pg_temp.turn_in(t, 's08_dong');
  perform public.story_accept(t, 's09_qua');
  assert pg_temp.err(format('select pg_temp.turn_in(%L, %L)', t, 's09_qua')) = 'not done', 'no gift yet';
  insert into public.farm_profiles (account_id) values (a) on conflict do nothing;
  update public.farm_profiles set gift_at = now() where account_id = a;
  perform pg_temp.turn_in(t, 's09_qua');

  -- s10: Chợ Lớn; s11: home
  perform pg_temp.age(a);
  perform public.story_accept(t, 's10_cho');
  perform public._pay(a, 10, 'sell', '1 con');
  assert pg_temp.st(public.story_state(t), 's10_cho') = 'active', 'cô Ba is not Chợ Lớn';
  perform public._pay(a, 11, 'sell', '1 con (Chợ Lớn)');
  perform pg_temp.turn_in(t, 's10_cho');
  perform public.story_accept(t, 's11_ve');
  j := pg_temp.turn_in(t, 's11_ve');
  assert (j->>'finished')::boolean and j->>'current' is null, 'finished';
  assert (select sum(delta) from public.coin_ledger where account_id = a and reason = 'quest_reward' and ref like 'story:%') = 330,
    'modest total';
end $$;

-- ---------- 2. Guards and veterans ----------
do $$
declare t text := (select v from sk where k = 't2'); a uuid := (select v from sk where k = 'a2')::uuid;
begin
  assert pg_temp.err(format('select public.story_accept(%L, %L)', 'bad-token', 's01_chao')) <> 'no error', 'bad token';
  -- a locked account is refused
  insert into public.anticheat_status (account_id, locked_until) values (a, now() + interval '5 minutes')
  on conflict (account_id) do update set locked_until = excluded.locked_until;
  assert pg_temp.err(format('select public.story_accept(%L, %L)', t, 's01_chao')) like 'account locked%', 'locked account';
  update public.anticheat_status set locked_until = null where account_id = a;
  -- a veteran (≥ 10 catches before 0114): the chain is closed, unpaid
  for i in 1 .. 10 loop perform public._game_event(a, 'fish_catch', 1, '{}'); end loop;
end $$;
set client_min_messages = warning;
\i supabase/migrations/0114_story_quests.sql
reset client_min_messages;
do $$
declare t text := (select v from sk where k = 't2'); a uuid := (select v from sk where k = 'a2')::uuid; j jsonb;
        a1 uuid := (select v from sk where k = 'a1')::uuid;
begin
  j := public.story_state(t);
  assert (j->>'finished')::boolean and (j->>'veteran')::boolean, 'veteran closed';
  assert not exists (select 1 from public.coin_ledger where account_id = a and reason = 'quest_reward'), 'veteran unpaid';
  assert pg_temp.err(format('select pg_temp.turn_in(%L, %L)', t, 's01_chao')) = 'already claimed', 'no re-reward';
  -- the re-run left the first account's paid chain alone
  assert (select bool_and(paid) from public.story_progress where account_id = a1), 'paid chain kept';
  assert not has_function_privilege('anon', 'public._story_count(uuid, text, timestamptz)', 'execute'), 'private';
end $$;

delete from public.accounts where id in (select v::uuid from sk where k like 'a_');
select 'story quests ok' as result;
