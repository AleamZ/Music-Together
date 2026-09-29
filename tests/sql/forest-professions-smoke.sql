-- tests/sql/forest-professions-smoke.sql — 0096 (the forest's rule, Thợ săn and Tiều phu, the chef's kitchen, the
-- starter tools). Run as the superuser on the throwaway PostgreSQL cluster after the full chain (0004 … 0096), from the
-- repo root, with the fixtures' absolute path:
--   psql -v forest=<repo>/tests/fixtures/forest-cases.json -f tests/sql/forest-professions-smoke.sql
-- It re-runs 0096 twice with \i (re-runnable) and leaves the unified_world flag as it found it. The passing of time is
-- simulated as in v22-fixes-smoke.sql: pg_temp.warp moves an account's live round (its clock, reveals, stamps) back.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
-- 0097 re-made _cook_recipes with more columns: 0096's body cannot replace it, so it goes first (re-apply 0097 after)
drop function if exists public._cook_recipes();
\i supabase/migrations/0096_forest_professions.sql
\i supabase/migrations/0096_forest_professions.sql
reset client_min_messages;

create temp table fx as select pg_read_file(:'forest')::jsonb f;
create or replace function pg_temp.ints(v jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;
create or replace function pg_temp.bigs(v jsonb) returns bigint[] language sql immutable as $$
  select coalesce(array_agg(x::bigint order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;

-- ---------- 1. The rules = lib/game/forest (the fixtures) ----------
do $$
declare c jsonb; n integer := 0;
begin
  for c in select jsonb_array_elements(f->'chop') from fx loop
    assert public._chop_hits(pg_temp.bigs(c->'beats'), (c->>'win')::int, pg_temp.ints(c->'presses')) = c->'expected',
           format('chop %s: %s', c, public._chop_hits(pg_temp.bigs(c->'beats'), (c->>'win')::int, pg_temp.ints(c->'presses')));
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(f->'cook') from fx loop
    assert public._cook_score(pg_temp.bigs(c->'params'), pg_temp.ints(c->'a'), pg_temp.ints(c->'b')) = c->'expected',
           format('cook %s: %s', c, public._cook_score(pg_temp.bigs(c->'params'), pg_temp.ints(c->'a'), pg_temp.ints(c->'b')));
    n := n + 1;
  end loop;
  for c in select jsonb_array_elements(f->'trees') from fx loop
    assert public._tree_of((c->>'cx')::int, (c->>'cy')::int, (c->>'k')::int) = c->>'id', format('tree %s', c);
    n := n + 1;
  end loop;
  assert n = 140, format('%s cases', n);
end $$;

-- ---------- 2. The forest grid ----------
do $$
declare v_cells integer; f public.world_forest;
begin
  select sum(length(replace(bits, '0', ''))) into v_cells from public._forest_seed();
  assert (select count(*) from public.world_forest) = v_cells, 'one row per forest cell';
  assert (select count(*) from public._forest_seed()) = 35, '35 rows of 64 px';
  assert (select count(*) from public.world_forest where core) > 8, 'core cells';
  select * into f from public.world_forest where core order by cy, cx limit 1;
  assert public._in_forest(f.cx * 64 + 32, f.cy * 64 + 32) and public._near_forest(f.cx * 64 + 32, f.cy * 64 + 32), 'in';
  assert (select bool_and(exists (select 1 from public.world_forest n where n.cx = f.cx + dx and n.cy = f.cy + dy))
            from generate_series(-1, 1) dx, generate_series(-1, 1) dy), 'a core cell has 8 forest neighbours';
  assert not public._in_forest(-10, -10) and not public._near_forest(-200, -200), 'off the world';
  assert not public._near_forest(1000, 700), 'the zones band has no forest';
  assert not has_function_privilege('anon', 'public._near_forest(double precision, double precision)', 'execute'), 'private';
  assert not has_function_privilege('anon', 'public._chop_hits(bigint[], integer, integer[])', 'execute'), 'private';
  assert has_function_privilege('anon', 'public.chop_start(text, integer, integer, integer, text, integer, integer)', 'execute'), 'public';
  assert has_function_privilege('anon', 'public.cook_finish(text, integer[], integer[])', 'execute'), 'public';
  assert not has_table_privilege('anon', 'public.wood_bag', 'select'), 'wood_bag private';
  assert not has_table_privilege('anon', 'public.prof_tools', 'select'), 'prof_tools private';
end $$;

-- ---------- 3. The accounts and the clock ----------
create temp table vx (k text primary key, v text);
insert into vx select 'flag', enabled::text from public.app_flags where key = 'unified_world';
update public.app_flags set enabled = true where key = 'unified_world';
insert into vx select 't' || i, token from generate_series(1, 4) i,
  lateral public.register('fp' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into vx select 'a' || substr(k, 2), public._auth_account(v)::text from vx where k like 't%';
insert into vx select 'room', room_id::text from public.create_room('Forest', 'pw', (select v from vx where k = 't1'));
select count(*) from (select public.join_room((select code from public.rooms where id = (select v from vx where k = 'room')::uuid), 'pw', v)
  from vx where k in ('t2', 't3', 't4')) x;
update public.anticheat_config set mode = 'log', min_client_build = 0;
insert into public.wallets (account_id, coins) select v::uuid, 100000 from vx where k like 'a%'
  on conflict (account_id) do update set coins = 100000;
insert into vx select 'cell', cx || ',' || cy from public.world_forest where core order by cy, cx limit 1;

create or replace function pg_temp.t(p text) returns text language sql as $$ select v from vx where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql as $$ select v::uuid from vx where k = 'a' || p $$;
create or replace function pg_temp.room() returns uuid language sql as $$ select v::uuid from vx where k = 'room' $$;
create or replace function pg_temp.cx() returns integer language sql as $$ select split_part(v, ',', 1)::int from vx where k = 'cell' $$;
create or replace function pg_temp.cy() returns integer language sql as $$ select split_part(v, ',', 2)::int from vx where k = 'cell' $$;
-- stand there (a 3D client: mode 'w'), an hour after the last claim
create or replace function pg_temp.put(p uuid, p_map text, p_x integer, p_y integer) returns void language plpgsql as $$
begin
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb;
  update public.player_pos set mode = 'w' where account_id = p;
end $$;
create or replace function pg_temp.fresh(p uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100, at = now();
  update public.chop_profile set last_at = null where account_id = p;
  update public.cook_profile set last_at = null where account_id = p;
  update public.wild_profile set last_at = null, trap_at = null where account_id = p;
end $$;
create or replace function pg_temp.flags(p uuid, c text) returns bigint language sql stable as $$
  select count(*) from public.anticheat_events where account_id = p and code = c
$$;
create or replace function pg_temp.warp(p uuid, p_s numeric) returns void language plpgsql as $$
#variable_conflict use_variable
declare iv interval := make_interval(secs => p_s);
begin
  update public.mg_live set opened_at = opened_at - iv, started_at = started_at - iv,
         seen = coalesce((select array_agg(x - iv order by o) from unnest(seen) with ordinality u(x, o)), '{}'),
         a_at = coalesce((select array_agg(x - iv order by o) from unnest(a_at) with ordinality u(x, o)), '{}'),
         b_at = coalesce((select array_agg(x - iv order by o) from unnest(b_at) with ordinality u(x, o)), '{}')
   where account_id = p;
  update public.world_mg set started_at = started_at - iv, last_start = last_start - iv where account_id = p;
end $$;
create or replace function pg_temp.ev(r jsonb, i integer) returns jsonb language sql immutable as $$
  select e->'d' from jsonb_array_elements(r->'ev') e where (e->>'i')::int = i
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------- 4. The starter tools and the two nghề ----------
do $$
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); j jsonb;
begin
  assert (select count(*) from public.profession_catalog where id in ('tho_san', 'tieu_phu')) = 2, 'the two nghề';
  assert (select count(*) from public.skill_nodes where prof = 'tho_san') = 6 and (select count(*) from public.skill_nodes where prof = 'tieu_phu') = 6, 'nodes';
  assert public._prof_main_level(a, 'tieu_phu') = -1, 'no main yet';
  j := public.profession_choose(t, 'tieu_phu');
  assert j->'tools' @> '[{"item": "riu_tap_su", "durability": 60, "max": 60}]', format('the starter axe %s', j->'tools');
  assert public._prof_main_level(a, 'tieu_phu') = 0, 'main, level 0';
  assert (select count(*) from public.prof_starter_grants where account_id = a) = 1, 'one grant';
  -- switch to Đầu bếp (after the 24 h), then back: the pan once, no second axe
  update public.prof_tools set durability = 5 where account_id = a and item = 'riu_tap_su';
  update public.player_profession_main set chosen_at = now() - interval '25 hours' where account_id = a;
  j := public.profession_choose(t, 'dau_bep');
  assert j->'tools' @> '[{"item": "chao_tap_su", "durability": 60}]', 'the pan';
  update public.player_profession_main set chosen_at = now() - interval '25 hours' where account_id = a;
  j := public.profession_choose(t, 'tieu_phu');
  assert (select durability from public.prof_tools where account_id = a and item = 'riu_tap_su') = 5, 'no second starter axe';
  assert (select count(*) from public.prof_starter_grants where account_id = a) = 2, 'two grants, once each';
  assert not public._prof_grant_starter(a, 'tieu_phu') and not public._prof_grant_starter(a, 'dau_bep'), 'idempotent';
  update public.prof_tools set durability = 60 where account_id = a and item = 'riu_tap_su';
  -- the backfill path: a main nghề set without profession_choose
  insert into public.player_profession_main (account_id, prof) values (pg_temp.a('4'), 'tho_san');
  assert public._prof_grant_starter(pg_temp.a('4'), 'tho_san'), 'backfill grants';
  assert not public._prof_grant_starter(pg_temp.a('4'), 'tho_san'), 'once';
  assert (select item from public.prof_tools where account_id = pg_temp.a('4')) = 'cung_tap_su', 'the bow';
end $$;

-- ---------- 5. The wild lives in the forest ----------
do $$
declare a uuid := pg_temp.a('2'); t text := pg_temp.t('2'); j jsonb; sp public.wild_spawns; e text; bad integer;
begin
  assert public._wild_cap('field') = 0 and public._wild_cap('pond') = 0 and public._wild_cap('bai_dat') = 0, 'no zone map animals';
  assert public._wild_cap('wild') = 24, 'the forest';
  assert not exists (select 1 from public.wild_spawns where map <> 'wild' and taken_at is null and expires_at > now()), 'the old ones left';
  j := public.world_state(t, pg_temp.room(), 'field');
  assert j->'wild' = 'null'::jsonb or j->'wild' is null, format('no animals on the field %s', j->'wild');
  j := public.world_state(t, pg_temp.room(), 'wild');
  assert jsonb_array_length(j->'wild'->'animals') between 1 and 24, format('the forest filled: %s', j->'wild');
  -- every live animal's home on a core cell, and its wander path inside the forest
  select count(*) into bad from public.wild_spawns w
   where w.map = 'wild' and w.taken_at is null and w.expires_at > now()
     and not exists (select 1 from public.world_forest f where f.core and f.cx = floor(w.hx / 64) and f.cy = floor(w.hy / 64));
  assert bad = 0, format('%s animals off a core cell', bad);
  select count(*) into bad from public.wild_spawns w, public._wild_species() s, generate_series(0, 600, 7) tt,
         lateral public._wild_xy(w.hx, w.hy, w.seed, s.radius, tt) q
   where w.map = 'wild' and w.taken_at is null and w.expires_at > now() and s.id = w.species and not public._in_forest(q.x, q.y);
  assert bad = 0, format('%s path points out of the forest', bad);

  -- a hunt: refused outside the forest (a zone map, the wild's open land), allowed at the animal
  perform pg_temp.fresh(a);
  select * into sp from public.wild_spawns where map = 'wild' and taken_at is null and expires_at > now()
     and species in ('rabbit', 'fox', 'deer', 'wolf', 'bear', 'bird') order by id limit 1;
  update public.wild_spawns set born_at = now() where id = sp.id;
  perform pg_temp.put(a, 'bai_dat', 400, 200);
  e := pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, 400, 200)', t, sp.id, 'hunt', 'bai_dat'));
  assert e = 'not in forest', format('a zone map: %s', e);
  perform pg_temp.put(a, 'wild', 1100, 100);
  e := pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, 1100, 100)', t, sp.id, 'hunt', 'wild'));
  assert e = 'not in forest', format('open land: %s', e);
  perform pg_temp.put(a, 'wild', (select round(q.x)::int from public._wild_species() s, public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, 0) q where s.id = sp.species),
                                 (select round(q.y)::int from public._wild_species() s, public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, 0) q where s.id = sp.species));
  j := public.wild_start(t, sp.id, 'photo', 'wild', (select x from public.player_pos where account_id = a), (select y from public.player_pos where account_id = a));
  assert j->'round'->>'game' = 'photo', format('in the forest %s', j);
  -- moved out of the forest before the finish: nothing
  perform pg_temp.put(a, 'wild', 1100, 100);
  perform pg_temp.warp(a, 5);
  j := public.wild_finish(t, '{}', '{}', 60);
  assert j->>'why' = 'not in forest', format('left the forest %s', j);
  assert public._perk(a, 'hunt_chance_pct') = 0, 'no perk';
end $$;

-- ---------- 6. Chopping ----------
-- One round played by a client that reads only mg_sync: each beat pressed p_off ticks after it once that tick has come.
-- p_mode 'honest' | 'peek' (one sync at the start, then everything at the end) | 'fast' (finishes right after the last press).
create or replace function pg_temp.chop(p text, k integer, p_off integer, p_mode text) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare t text := pg_temp.t(p); a uuid := pg_temp.a(p); j jsonb; r jsonb; e integer; presses integer[] := '{}'; d jsonb;
        nb integer := 0; v_end integer; u bigint[];
begin
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', pg_temp.cx() * 64 + 32, pg_temp.cy() * 64 + 32);
  j := public.chop_start(t, pg_temp.cx(), pg_temp.cy(), k, 'wild', pg_temp.cx() * 64 + 32, pg_temp.cy() * 64 + 32);
  assert j->'round'->>'game' = 'chop' and position('beat' in j::text) = 0, format('nothing to precompute: %s', j);
  r := public.mg_sync(t, 'chop', '{}', '{}');
  assert jsonb_array_length(r->'ev') = 0, format('tick 0 reveals no beat: %s', r);
  if p_mode = 'peek' then
    select params into u from public.mg_live where account_id = a and game = 'chop';
    perform pg_temp.warp(a, (u[3] + 50) / 60.0);
    return public.chop_finish(t, array[u[1]::int, u[2]::int, u[3]::int]);
  end if;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'chop', presses, null);
    e := (r->>'t')::int;
    assert coalesce((select bool_and((x->'d'->>'beat')::int - 60 <= e) from jsonb_array_elements(r->'ev') x), true), format('no beat sooner than 1 s ahead: %s', r);
    d := pg_temp.ev(r, nb + 1);
    if nb < 3 and d is not null and (d->>'beat')::int + p_off <= e then
      presses := presses || ((d->>'beat')::int + p_off);
      nb := nb + 1;
      if nb = 3 then v_end := (d->>'beat')::int + 45; end if;
    end if;
    exit when p_mode = 'fast' and nb = 3;
    exit when v_end is not null and e >= v_end;
    exit when e > 600;
  end loop;
  r := public.mg_sync(t, 'chop', presses, null);
  return public.chop_finish(t, presses);
end $$;

do $$
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); j jsonb; k integer; v_kind text; e text; n integer;
        cx integer := pg_temp.cx(); cy integer := pg_temp.cy();
begin
  -- a Tre tree in the cell (3 strikes: one honest round with the starter axe fells it)
  select g into k from generate_series(0, 7) g where public._tree_of(cx, cy, g) = 'cay_tre' limit 1;
  if k is null then select g into k from generate_series(0, 7) g order by (select need from public._forest_trees() f where f.id = public._tree_of(cx, cy, g)) limit 1; end if;
  v_kind := public._tree_of(cx, cy, k);
  -- refusals
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', 1100, 100);
  e := pg_temp.err(format('select public.chop_start(%L, %s, %s, %s, %L, 1100, 100)', t, cx, cy, k, 'wild'));
  assert e = 'not in forest', format('open land: %s', e);
  perform pg_temp.put(a, 'wild', cx * 64 + 32, cy * 64 + 32);
  e := pg_temp.err(format('select public.chop_start(%L, %s, %s, 9, %L, %s, %s)', t, cx, cy, 'wild', cx * 64 + 32, cy * 64 + 32));
  assert e = 'bad tree', format('k 9: %s', e);
  e := pg_temp.err(format('select public.chop_start(%L, %s, %s, %s, %L, %s, %s)', t, cx + 3, cy, k, 'wild', cx * 64 + 32, cy * 64 + 32));
  assert e in ('too far', 'bad tree'), format('a far cell: %s', e);
  perform pg_temp.put(pg_temp.a('3'), 'wild', cx * 64 + 32, cy * 64 + 32);
  perform pg_temp.fresh(pg_temp.a('3'));
  e := pg_temp.err(format('select public.chop_start(%L, %s, %s, %s, %L, %s, %s)', pg_temp.t('3'), cx, cy, k, 'wild', cx * 64 + 32, cy * 64 + 32));
  assert e = 'no axe', format('no axe: %s', e);

  -- an honest round: three hits, 1 durability, stamina 4
  j := pg_temp.chop('1', k, 2, 'honest');
  assert j->>'result' in ('ok', 'felled') and (j->>'hits')::int = 3 and (j->>'blows')::int = 3, format('honest %s', j);
  assert (j->>'durability')::int = 59, 'the axe wore';
  assert (select value from public.player_stamina where account_id = a) between 95 and 97, 'stamina 4 (and a little regen)';
  if v_kind = 'cay_tre' then
    assert j->>'result' = 'felled' and j->>'log' = 'go_tre' and (j->>'qty')::int = 2 and (j->>'full')::int = 2, format('felled %s', j);
    assert (select qty from public.wood_bag where account_id = a and item = 'go_tre') = 2, 'two logs';
    assert exists (select 1 from public.forest_felled where tree_key = cx || ':' || cy || ':' || k and respawn_at > now()), 'down';
    perform pg_temp.fresh(a);
    e := pg_temp.err(format('select public.chop_start(%L, %s, %s, %s, %L, %s, %s)', t, cx, cy, k, 'wild', cx * 64 + 32, cy * 64 + 32));
    assert e = 'felled', format('felled: %s', e);
    assert exists (select 1 from public.game_events where account_id = a and kind = 'wood_chopped'), 'the event';
    assert (select xp from public.player_professions where account_id = a and prof = 'tieu_phu') > 0, 'tieu_phu xp';
    -- the soft cap: from the 41st log of the day, half price
    delete from public.forest_felled where tree_key = cx || ':' || cy || ':' || k;
    update public.chop_profile set logs = 39 where account_id = a;
    j := pg_temp.chop('1', k, 1, 'honest');
    assert j->>'result' = 'felled' and (j->>'full')::int = 1, format('capped %s', j);
    assert (select half from public.wood_bag where account_id = a and item = 'go_tre') = 1, 'one half-price log';
  end if;
  delete from public.forest_felled where tree_key = cx || ':' || cy || ':' || k;

  -- the cooldown
  perform pg_temp.fresh(a);
  perform public.chop_start(t, cx, cy, k, 'wild', cx * 64 + 32, cy * 64 + 32);
  e := pg_temp.err(format('select public.chop_start(%L, %s, %s, %s, %L, %s, %s)', t, cx, cy, k, 'wild', cx * 64 + 32, cy * 64 + 32));
  assert e = 'cooldown', format('cooldown: %s', e);
  -- never synced: nothing
  j := public.chop_finish(t, '{}');
  assert j->>'why' = 'not played', format('not played %s', j);

  -- the attacks: a peek (the beats known, pressed at once after the end) — hard chop_bad_input 'early'
  n := pg_temp.flags(a, 'chop_bad_input');
  j := pg_temp.chop('1', k, 0, 'peek');
  assert j->>'why' = 'refused' and pg_temp.flags(a, 'chop_bad_input') = n + 1, format('peek %s', j);
  -- finished before the round's end: chop_too_fast
  n := pg_temp.flags(a, 'chop_too_fast');
  j := pg_temp.chop('1', k, 3, 'fast');
  assert j->>'why' = 'refused' and pg_temp.flags(a, 'chop_too_fast') = n + 1, format('fast %s', j);
  -- three exact hits: the soft chop_timing (the round still counts)
  n := pg_temp.flags(a, 'chop_timing');
  delete from public.forest_felled where tree_key = cx || ':' || cy || ':' || k;
  j := pg_temp.chop('1', k, 0, 'honest');
  assert j->>'result' in ('ok', 'felled') and pg_temp.flags(a, 'chop_timing') = n + 1, format('timing %s', j);
  delete from public.forest_felled where tree_key = cx || ':' || cy || ':' || k;
end $$;

-- ---------- 7. The stall: logs and axes ----------
do $$
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); j jsonb; c0 integer; v_have integer; v_half integer;
begin
  select w.qty, w.half into v_have, v_half from public.wood_bag w where w.account_id = a and w.item = 'go_tre';
  if coalesce(v_have, 0) + coalesce(v_half, 0) > 0 then
    perform pg_temp.put(a, 'bai_dat', 460, 56);
    select coins into c0 from public.wallets where account_id = a;
    j := public.wood_sell(t, 'go_tre', v_have + v_half);
    assert (j->>'earned')::int = 12 * v_have + (12 * v_half) / 2, format('sold %s (%s full, %s half)', j, v_have, v_half);
    assert (select coins from public.wallets where account_id = a) = c0 + (j->>'earned')::int, 'paid';
    assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'wood_sell'), 'wood_sell';
  end if;
  perform pg_temp.put(a, 'bai_dat', 460, 56);
  j := public.tool_buy(t, 'riu_sat');
  assert j->'forest'->'tools' @> '[{"item": "riu_sat", "durability": 120}]', format('bought %s', j);
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'tool_buy' and delta = -450), 'tool_buy';
  assert pg_temp.err(format('select public.tool_buy(%L, %L)', t, 'cung_tap_su')) = 'invalid item', 'the bow is not sold';
end $$;

-- the better axe strikes harder
do $$
declare j jsonb; k integer;
begin
  select g into k from generate_series(0, 7) g
   where public._tree_of(pg_temp.cx(), pg_temp.cy(), g) <> 'cay_tre' order by g limit 1;
  if k is null then return; end if;
  j := pg_temp.chop('1', k, 2, 'honest');
  assert (j->>'blows')::int = 6 and j->>'result' in ('ok', 'felled'), format('iron axe %s', j);
  delete from public.forest_felled where tree_key = pg_temp.cx() || ':' || pg_temp.cy() || ':' || k;
end $$;

-- ---------- 8. Cooking: the Đầu bếp's only ----------
-- One dish played by a client that reads only mg_sync: thái on the beats (+1), khuấy held p_hold_off off the target,
-- canh lửa at the tick the revealed heat is nearest the band's centre. p_mode 'honest' | 'peek'.
create or replace function pg_temp.cook(p text, p_recipe text, p_mode text) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare t text := pg_temp.t(p); a uuid := pg_temp.a(p); j jsonb; r jsonb; e integer; pa integer[] := '{}'; pb integer[] := '{}';
        d jsonb; i integer := 1; n integer; st integer; en integer; v_end integer; done integer := 0; best integer; bt integer;
        u bigint[]; x integer; h integer;
begin
  perform pg_temp.fresh(a);
  j := public.cook_start(t, p_recipe);
  assert j->'round'->>'game' = 'cook' and position('p1' in j::text) = 0, format('nothing to precompute: %s', j);
  n := jsonb_array_length(j->'round'->'steps');
  if p_mode = 'peek' then
    perform public.mg_sync(t, 'cook', '{}', '{}');
    select params into u from public.mg_live where account_id = a and game = 'cook';
    perform pg_temp.warp(a, (u[6 * n - 3] + 20) / 60.0);
    return public.cook_finish(t, array[u[4]::int, u[5]::int], '{}');
  end if;
  r := public.mg_sync(t, 'cook', '{}', '{}');
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'cook', pa, pb);
    e := (r->>'t')::int;
    d := pg_temp.ev(r, i);
    if d is not null then
      st := (d->>'start')::int; en := (d->>'end')::int;
      if (d->>'kind')::int = 1 then
        if done = 0 and e >= (d->>'p1')::int + 1 then pa := pa || ((d->>'p1')::int + 1); done := 1; end if;
        if done = 1 and e >= (d->>'p2')::int + 1 then pa := pa || ((d->>'p2')::int + 1); done := 2; end if;
      elsif (d->>'kind')::int = 2 then
        if done = 0 and e >= st + 10 then pa := pa || (st + 10); done := 1; end if;
        if done = 1 and e >= st + 10 + (d->>'p1')::int then pb := pb || (st + 10 + (d->>'p1')::int); done := 2; end if;
      else
        -- the first tick ≥ st + 10 whose heat is within 2 of the centre
        if done = 0 then
          best := null;
          for bt in st + 10 .. en - 1 loop
            x := ((bt - st) + (d->>'p2')::int) % (d->>'p1')::int;
            h := case when 2 * x < (d->>'p1')::int then (200 * x) / (d->>'p1')::int else 200 - (200 * x) / (d->>'p1')::int end;
            if abs(h - (d->>'p3')::int) <= 1 then best := bt; exit; end if;
          end loop;
          if best is not null and e >= best then pa := pa || best; done := 2; end if;
        end if;
      end if;
      if done = 2 then i := i + 1; done := 0; v_end := en; end if;
    end if;
    exit when i > n and e >= v_end;
    exit when e > 2000;
  end loop;
  r := public.mg_sync(t, 'cook', pa, pb);
  return public.cook_finish(t, pa, pb);
end $$;

do $$
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); j jsonb; e text; c0 integer; n integer; s0 numeric;
begin
  -- account 2 is no chef
  perform pg_temp.fresh(pg_temp.a('2'));
  e := pg_temp.err(format('select public.cook_start(%L, %L)', pg_temp.t('2'), 'com_rau_nam'));
  assert e = 'not a chef', format('not a chef: %s', e);
  -- account 1 becomes the chef
  update public.player_profession_main set chosen_at = now() - interval '25 hours' where account_id = a;
  perform public.profession_choose(t, 'dau_bep');
  e := pg_temp.err(format('select public.cook_start(%L, %L)', t, 'com_thit_tho'));
  assert e = 'no ingredients', format('no meat: %s', e);
  insert into public.wild_bag (account_id, item, qty) values (a, 'thit_tho', 3)
  on conflict (account_id, item) do update set qty = 3;
  select coins into c0 from public.wallets where account_id = a;
  j := pg_temp.cook('1', 'com_thit_tho', 'honest');
  assert j->>'result' = 'ok' and (j->>'score')::int >= 90 and (j->>'quality')::int = 3, format('honest %s', j);
  assert (select qty from public.wild_bag where account_id = a and item = 'thit_tho') = 2, 'the meat used';
  assert (select coins from public.wallets where account_id = a) = c0 - 20, 'the fee paid';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'cook_fee'), 'cook_fee';
  assert (select qty from public.cooked_dishes where account_id = a and dish = 'com_thit_tho' and quality = 3) = 1, 'the dish';
  assert exists (select 1 from public.game_events where account_id = a and kind = 'food_cooked'), 'food_cooked';
  j := pg_temp.cook('1', 'com_rau_nam', 'honest');
  assert j->>'result' = 'ok' and jsonb_array_length(j->'steps') = 3 and (j->>'score')::int >= 90, format('three steps %s', j);
  -- a peek: the beats pressed after the end — hard cook_bad_input
  n := pg_temp.flags(a, 'cook_bad_input');
  j := pg_temp.cook('1', 'com_rau_nam', 'peek');
  assert j->>'why' = 'refused' and pg_temp.flags(a, 'cook_bad_input') = n + 1, format('peek %s', j);
  -- eat one: + 15 × 150 % stamina
  update public.player_stamina set value = 50, at = now() where account_id = a;
  j := public.cook_eat(t, 'com_thit_tho', 3);
  assert (j->>'gained')::numeric = 22, format('ate %s', j);
  assert (select value from public.player_stamina where account_id = a) between 72 and 73, 'stamina up';
  -- sell the other at the stall: 150 % of 140
  perform pg_temp.put(a, 'bai_dat', 460, 56);
  j := public.cook_sell(t, 'com_rau_nam', 3, 1);
  assert (j->>'earned')::int = 150, format('sold %s', j);
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'dish_sell'), 'dish_sell';
  assert pg_temp.err(format('select public.cook_eat(%L, %L, 3)', t, 'com_thit_tho')) = 'not enough', 'none left';
  j := public.forest_state(t);
  assert j->>'main' = 'dau_bep' and j ? 'wood' and j ? 'tools' and j ? 'dishes', format('state %s', j);
end $$;

-- ---------- 9. The wipe ----------
do $$
declare a uuid := pg_temp.a('1');
begin
  insert into public.anticheat_wipes (account_id, username, snapshot) values (a, 'x', '{}'::jsonb);
  assert not exists (select 1 from public.wood_bag where account_id = a) and not exists (select 1 from public.prof_tools where account_id = a)
     and not exists (select 1 from public.cooked_dishes where account_id = a), 'wiped';
  assert (select count(*) from public.prof_starter_grants where account_id = a) = 2, 'the grants stay (no new free tool)';
end $$;

update public.app_flags set enabled = (select v::boolean from vx where k = 'flag') where key = 'unified_world';
\echo forest-professions-smoke: ok
