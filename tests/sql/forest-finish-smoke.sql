-- tests/sql/forest-finish-smoke.sql — 0121 (Săn bắt and Tiều phu finished: bow and pan tiers, wood / dish sales as work,
-- forest and rice in the Beta net worth, the forest dailies, the bow in _wild_json). Run as the superuser on the throwaway
-- cluster after the full chain (… 0120, 0121), from the repo root:
--   psql -f tests/sql/forest-finish-smoke.sql
-- It re-runs 0121 twice with \i, owns its accounts and room, and rolls them back (one transaction).
\set ON_ERROR_STOP on
set time zone 'UTC';
begin;
set local client_min_messages = warning;
\i supabase/migrations/0121_forest_finish.sql
\i supabase/migrations/0121_forest_finish.sql
set local client_min_messages = notice;

create temp table vx (k text primary key, v text);
insert into vx select 't' || i, token from generate_series(1, 3) i,
  lateral public.register('ff' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into vx select 'a' || substr(k, 2), public._auth_account(v)::text from vx where k like 't%';
update public.app_flags set enabled = true where key = 'room_creation_open';
insert into vx select 'room', room_id::text from public.create_room('Forest finish', 'pw', (select v from vx where k = 't1'));
update public.anticheat_config set mode = 'log', min_client_build = 0;
insert into public.wallets (account_id, coins) select v::uuid, 100000 from vx where k like 'a%'
  on conflict (account_id) do update set coins = 100000;

create or replace function pg_temp.t(p text) returns text language sql as $$ select v from vx where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql as $$ select v::uuid from vx where k = 'a' || p $$;
create or replace function pg_temp.put2(p uuid, p_map text, p_x integer, p_y integer) returns void language plpgsql as $$
begin
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb;
  update public.player_pos set mode = null where account_id = p;
end $$;
create or replace function pg_temp.fresh(p uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100, at = now();
  update public.cook_profile set last_at = null where account_id = p;
  update public.wild_profile set last_at = null, trap_at = null where account_id = p;
end $$;

-- ---------- the tiers' points ----------
do $$
begin
  assert public._bow_bonus(null) = 0 and public._bow_bonus(1) = 0 and public._bow_bonus(2) = 5 and public._bow_bonus(3) = 10, 'bow points';
  assert public._pan_bonus(null) = 0 and public._pan_bonus(1) = 0 and public._pan_bonus(2) = 4 and public._pan_bonus(3) = 8, 'pan points';
  -- the client's catalog (lib/game/forest/catalog.ts bowBonus / panBonus) pins the same rows
  assert (select count(*) from public._prof_tools_catalog() where kind = 'bow' and power between 1 and 3) = 4, 'four bows';
  assert not has_function_privilege('anon', 'public._bow_bonus(integer)', 'execute')
     and not has_function_privilege('anon', 'public._pan_bonus(integer)', 'execute'), 'private helpers';
  assert has_function_privilege('anon', 'public.wild_start(text, bigint, text, text, integer, integer)', 'execute')
     and has_function_privilege('anon', 'public.cook_start(text, text)', 'execute'), 'the RPCs keep their grants';
  assert (select prosrc from pg_proc where oid = 'public.wild_finish(text, integer[], integer[], integer)'::regprocedure)
         like '%public._bow_bonus((l.meta->>''bow'')::int)%', 'wild_finish adds the bow''s points';
  assert (select prosrc from pg_proc where oid = 'public.cook_finish(text, integer[], integer[])'::regprocedure)
         like '%least(100, v_score + public._pan_bonus((l.meta->>''pan'')::int))%', 'cook_finish adds the pan''s points';
end $$;

-- ---------- A. a hunt draws the best bow and keeps its tier ----------
do $$
declare acc uuid := pg_temp.a('1'); t text := pg_temp.t('1'); sp public.wild_spawns; o record; lx integer; ly integer; j jsonb;
begin
  select * into o from public._forest_origin();
  perform public._wild_fill('rung_tram');
  perform pg_temp.fresh(acc);
  select w.* into sp from public.wild_spawns w join public._wild_species() s on s.id = w.species
   where w.map = 'wild' and w.taken_at is null and w.expires_at > now() and s.hunt > 0
     and w.hx between o.ox + 64 and o.ox + 576 and w.hy between o.oy + 64 and o.oy + 320 order by w.id limit 1;
  if sp.id is null then                                                     -- none huntable in the window: make one
    insert into public.wild_spawns (map, species, hx, hy, seed, expires_at)
    values ('wild', 'rabbit', o.ox + 300, o.oy + 200, 7, now() + interval '10 minutes') returning * into sp;
  end if;
  update public.wild_spawns set born_at = now() where id = sp.id;
  select round(q.x)::int - o.ox, round(q.y)::int - o.oy into lx, ly
    from public._wild_species() s, public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, 0) q where s.id = sp.species;
  perform pg_temp.put2(acc, 'rung_tram', lx, ly);
  -- no bow: _wild_json says so before the hunt
  j := public.world_state(t, (select v::uuid from vx where k = 'room'), 'rung_tram');
  assert j->'wild' ? 'bow' and j->'wild'->'bow' = 'null', format('no bow yet: %s', j->'wild'->'bow');
  insert into public.prof_tools (account_id, item, durability, max_durability)
  values (acc, 'cung_tap_su', 60, 60), (acc, 'cung_go_cung', 180, 180);
  j := public.world_state(t, (select v::uuid from vx where k = 'room'), 'rung_tram');
  assert j->'wild'->'bow'->>'item' = 'cung_go_cung' and (j->'wild'->'bow'->>'bonus')::int = 10, format('the best bow %s', j->'wild'->'bow');
  j := public.wild_start(t, sp.id, 'hunt', 'rung_tram', lx, ly);
  assert j->'round'->>'game' = 'hunt', format('a hunt %s', j);
  assert j->'round'->>'bow' = 'cung_go_cung' and (j->'round'->>'bow_bonus')::int = 10, format('the round names the bow %s', j->'round');
  assert (select durability from public.prof_tools where account_id = acc and item = 'cung_go_cung') = 179, 'the best bow wore';
  assert (select durability from public.prof_tools where account_id = acc and item = 'cung_tap_su') = 60, 'not the starter';
  assert (select meta->>'bow' from public.mg_live where account_id = acc and game = 'world') = '3', 'the tier is kept in the round';
  -- a photo keeps no bow
  perform pg_temp.fresh(acc);
  delete from public.wild_photos where account_id = acc;
  j := public.wild_start(t, sp.id, 'photo', 'rung_tram', lx, ly);
  assert j->'round'->'bow' = 'null' and (select meta->'bow' from public.mg_live where account_id = acc and game = 'world') = 'null',
    format('a photo: no bow %s', j->'round');
  -- the worn-out best bow: the next one shoots
  update public.prof_tools set durability = 0 where account_id = acc and item = 'cung_go_cung';
  j := public.world_state(t, (select v::uuid from vx where k = 'room'), 'rung_tram');
  assert j->'wild'->'bow'->>'item' = 'cung_tap_su' and (j->'wild'->'bow'->>'bonus')::int = 0, 'a broken bow does not count';
  raise notice 'A bow tiers ok';
end $$;

-- ---------- B. a dish draws the best pan and keeps its tier ----------
do $$
declare acc uuid := pg_temp.a('2'); t text := pg_temp.t('2'); j jsonb;
begin
  perform pg_temp.fresh(acc);
  perform public.profession_choose(t, 'dau_bep');
  insert into public.prof_tools (account_id, item, durability, max_durability) values (acc, 'noi_gang', 210, 210);
  j := public.cook_start(t, 'com_tam_suon');
  assert j->'round'->>'pan' = 'noi_gang' and (j->'round'->>'pan_bonus')::int = 8, format('the best pan %s', j->'round');
  assert (select durability from public.prof_tools where account_id = acc and item = 'noi_gang') = 209, 'the best pan wore';
  assert (select durability from public.prof_tools where account_id = acc and item = 'chao_tap_su')
         = (select durability from public._prof_tools_catalog() where id = 'chao_tap_su'), 'not the starter';
  assert (select meta->>'pan' from public.mg_live where account_id = acc and game = 'cook') = '3', 'the tier is kept in the round';
  raise notice 'B pan tiers ok';
end $$;

-- ---------- C. wood and dish sales are work ----------
do $$
declare acc uuid := pg_temp.a('3'); x0 bigint; x1 bigint;
begin
  assert public._pg_work_reason('wood_sell') and public._pg_work_reason('dish_sell') and public._pg_work_reason('wild_sell'), 'work';
  assert not public._pg_work_reason('daily') and not public._pg_work_reason('song'), 'rewards are not work';
  select coalesce((select xp from public.player_progress where account_id = acc), 0) into x0;
  perform public._wallet_lock(acc);
  perform public._pay(acc, 400, 'wood_sell', 'go_tre x100');
  select coalesce((select xp from public.player_progress where account_id = acc), 0) into x1;
  assert x1 > x0, format('a log sale earns XP: %s → %s', x0, x1);
  raise notice 'C work ok';
end $$;

-- ---------- D. the Beta net worth counts rice and the forest ----------
do $$
declare acc uuid := pg_temp.a('3'); nw jsonb; nw0 jsonb;
begin
  nw0 := public._beta_net_worth(acc);
  assert nw0 ? 'rice' and nw0 ? 'forest', format('the parts %s', nw0);
  insert into public.wood_bag (account_id, item, qty, half) values (acc, 'go_tre', 10, 2);          -- 10 × 4 + 2 × 4 / 2 = 44
  insert into public.wild_bag (account_id, item, qty) values (acc, 'thit_tho', 2);                  -- 2 × 25 = 50
  insert into public.cooked_dishes (account_id, dish, quality, qty) values (acc, 'com_tam_suon', 2, 1);   -- 96 × 110 % = 105
  insert into public.prof_tools (account_id, item, durability, max_durability)
  values (acc, 'cung_tap_su', 60, 60), (acc, 'riu_sat', 10, 80);                                    -- 0 (starter) + its price (0123: 450)
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (acc, 'nep', 10, 10)
  on conflict (account_id, variety) do update set wet_kg = 10, dry_kg = 10;                        -- 9 500 + 6 650
  nw := public._beta_net_worth(acc);
  assert (nw->>'forest')::bigint - (nw0->>'forest')::bigint = 44 + 50 + 105 + (select price from public._prof_tools_catalog() where id = 'riu_sat'), format('forest %s', nw);
  assert (nw->>'rice')::bigint - (nw0->>'rice')::bigint = 16150, format('rice %s', nw);
  assert (nw->>'total')::bigint - (nw0->>'total')::bigint = 44 + 50 + 105 + (select price from public._prof_tools_catalog() where id = 'riu_sat') + 16150, format('the total %s', nw);
  raise notice 'D net worth ok';
end $$;

-- ---------- E. the forest dailies ----------
do $$
begin
  assert exists (select 1 from public.quest_defs where id = 'd_wood' and cat = 'daily' and kind = 'wood_chopped' and use_qty and goal = 10 and active),
    'd_wood';
  assert exists (select 1 from public.quest_defs where id = 'd_hunt' and cat = 'daily' and kind = 'wild_hunt' and not use_qty and goal = 2 and active),
    'd_hunt';
  raise notice 'forest-finish smoke ok';
end $$;
rollback;
