-- tests/sql/anticheat-v2-tabs-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0058, from
-- the repo root. It re-runs 0058 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql. The tab
-- of a request is set as PostgREST would: request.headers = {"x-tab-id": …} (set_config, local to the DO block).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0058_pos_tabs.sql
\i supabase/migrations/0058_pos_tabs.sql
reset client_min_messages;

create temp table tx (k text primary key, v text);
insert into tx select 'ta', token from public.register('tx_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into tx select 'a', public._auth_account(v)::text from tx where k = 'ta';
update public.anticheat_config set mode = 'log';

create or replace function pg_temp.tab(p text) returns void language sql as $$
  select set_config('request.headers', case when p is null then '' else json_build_object('x-tab-id', p)::text end, true)
$$;
create or replace function pg_temp.pos() returns text language sql as $$
  select map || ':' || x || ',' || y || ':' || coalesce(tab, '-') from public.player_pos
   where account_id = (select v from tx where k = 'a')::uuid
$$;
create or replace function pg_temp.events() returns bigint language sql as $$
  select count(*) from public.anticheat_events where account_id = (select v from tx where k = 'a')::uuid and code like 'pos_%'
$$;

-- ---------- 1. The header ----------
do $$
begin
  perform pg_temp.tab('A');
  assert public._pos_tab() = 'A', 'the tab';
  perform set_config('request.headers', '{"x-tab-id": "  "}', true);
  assert public._pos_tab() is null, 'blank';
  perform set_config('request.headers', 'not json', true);
  assert public._pos_tab() is null, 'garbage';
  perform set_config('request.headers', json_build_object('x-tab-id', repeat('x', 100))::text, true);
  assert length(public._pos_tab()) = 64, 'capped';
  perform pg_temp.tab(null);
  assert public._pos_tab() is null, 'none';
  raise notice 'header ok';
end $$;

-- ---------- 2. Two windows: the newest is the primary, the older one is ignored and never flagged ----------
do $$
declare t text := (select v from tx where k = 'ta'); a uuid := (select v from tx where k = 'a')::uuid; j jsonb; n0 bigint;
begin
  delete from public.player_pos where account_id = a;
  perform pg_temp.tab('A');
  j := public.pos_report(t, 'pond', 300, 204);                                    -- window A, the first claim
  assert j->>'ok' = 'true' and pg_temp.pos() = 'pond:300,204:A', format('A first %s', j);
  perform pg_temp.tab('B');
  j := public.pos_report(t, 'hall', 612, 300);                                    -- window B opens at the spawn
  assert j->>'ok' = 'true' and pg_temp.pos() = 'hall:612,300:B', format('B is the primary %s', j);
  n0 := pg_temp.events();
  perform pg_temp.tab('A');
  j := public.pos_report(t, 'pond', 320, 204);                                    -- A walks on the pond: its own track
  assert j->>'ok' = 'true', format('A walks %s', j);
  assert pg_temp.pos() = 'hall:612,300:B', 'the account stays where B is';
  assert (select tabs->'A'->>'x' from public.player_pos where account_id = a) = '320', 'A''s track moved';
  j := public.pos_report(t, 'market', 80, 360);                                   -- A "teleports": refused, not logged
  assert j->'anticheat'->>'code' = 'pos_teleport' and (j->'anticheat'->>'strike')::int = 0, format('A refused %s', j);
  assert pg_temp.events() = n0, 'nothing logged';
  assert (select bad_count from public.player_pos where account_id = a) = 0, 'nothing counted';
  -- A's heartbeat does not move the account either
  perform public.vitals_tick(t, null, 'pond', 330, 204);
  assert pg_temp.pos() = 'hall:612,300:B', 'the heartbeat of A is A''s own';
  assert pg_temp.events() = n0, 'still nothing';
  -- B carries on as the primary, judged as in 0057
  perform pg_temp.tab('B');
  j := public.pos_report(t, 'hall', 640, 300);
  assert j->>'ok' = 'true' and pg_temp.pos() = 'hall:640,300:B', format('B walks %s', j);
  j := public.pos_report(t, 'market', 80, 360);                                   -- B teleports: soft, as in 0057
  assert j->'anticheat'->>'code' = 'pos_teleport' and pg_temp.events() = n0 + 1, format('B flagged %s', j);
  raise notice 'two windows ok';
end $$;

-- ---------- 3. A new tab that teleports is judged against the account; no tab is 0057's rule ----------
do $$
declare t text := (select v from tx where k = 'ta'); a uuid := (select v from tx where k = 'a')::uuid; j jsonb; n0 bigint;
begin
  update public.player_pos set map = 'hall', x = 612, y = 300, at = now(), tab = 'B', tabs = '{}'::jsonb, bad_count = 0,
         bad_since = null where account_id = a;
  n0 := pg_temp.events();
  perform pg_temp.tab('C');
  j := public.pos_report(t, 'market', 80, 360);
  assert j->'anticheat'->>'code' = 'pos_teleport' and pg_temp.events() = n0 + 1, format('a new tab is judged %s', j);
  assert pg_temp.pos() = 'hall:612,300:B', 'refused: the primary stays';
  perform pg_temp.tab(null);
  j := public.pos_report(t, 'hall', 620, 300);
  assert j->>'ok' = 'true' and pg_temp.pos() = 'hall:620,300:B', format('no tab %s', j);
  j := public.pos_report(t, 'market', 80, 360);
  assert j->'anticheat'->>'code' = 'pos_teleport' and pg_temp.events() = n0 + 2, format('no tab, flagged %s', j);
  raise notice 'new tab ok';
end $$;

-- ---------- 4. The tabs kept: at most 4, none older than an hour ----------
do $$
declare j jsonb;
begin
  j := public._pos_tabs('{"old": {"m": "hall", "x": 1, "y": 1, "at": "2000-01-01T00:00:00Z"}}'::jsonb, 'n1', 'hall', 1, 1);
  assert not (j ? 'old') and j ? 'n1', format('an hour old goes %s', j);
  j := public._pos_tabs(j, 'n2', 'hall', 2, 2);
  j := public._pos_tabs(j, 'n3', 'hall', 3, 3);
  j := public._pos_tabs(j, 'n4', 'hall', 4, 4);
  j := public._pos_tabs(j, 'n5', 'hall', 5, 5);
  assert (select count(*) from jsonb_object_keys(j)) = 4 and j ? 'n5', format('four kept %s', j);
  j := public._pos_tabs(j, 'n5', 'pond', 9, 9);
  assert j->'n5'->>'m' = 'pond' and (select count(*) from jsonb_object_keys(j)) = 4, 'replaced';
  raise notice 'tabs ok';
end $$;

select 'anticheat-v2 tabs smoke ok';
