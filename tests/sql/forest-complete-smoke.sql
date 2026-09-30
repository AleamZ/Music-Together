-- tests/sql/forest-complete-smoke.sql — 0097 (Rừng tràm in 2D, the design's animals and meats, the ten dishes and their
-- buffs, the bow / pan / axe repair, Thợ săn xp for hunters only). Run as the superuser on the throwaway cluster after the
-- full chain (0004 … 0097), from the repo root:
--   psql -f tests/sql/forest-complete-smoke.sql
-- It re-runs 0097 twice with \i and leaves the unified_world flag as it found it.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0097_forest_complete.sql
\i supabase/migrations/0097_forest_complete.sql
reset client_min_messages;

create temp table vx (k text primary key, v text);
insert into vx select 'flag', enabled::text from public.app_flags where key = 'unified_world';
insert into vx select 't' || i, token from generate_series(1, 3) i,
  lateral public.register('fc' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into vx select 'a' || substr(k, 2), public._auth_account(v)::text from vx where k like 't%';
insert into vx select 'room', room_id::text from public.create_room('Forest2', 'pw', (select v from vx where k = 't1'));
select count(*) from (select public.join_room((select code from public.rooms where id = (select v from vx where k = 'room')::uuid), 'pw', v)
  from vx where k in ('t2', 't3')) x;
update public.anticheat_config set mode = 'log', min_client_build = 0;
insert into public.wallets (account_id, coins) select v::uuid, 100000 from vx where k like 'a%'
  on conflict (account_id) do update set coins = 100000;

create or replace function pg_temp.t(p text) returns text language sql as $$ select v from vx where k = 't' || p $$;
create or replace function pg_temp.a(p text) returns uuid language sql as $$ select v::uuid from vx where k = 'a' || p $$;
create or replace function pg_temp.room() returns uuid language sql as $$ select v::uuid from vx where k = 'room' $$;
-- a 2D client (no mode) standing on a map, an hour after its last claim
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
  update public.chop_profile set last_at = null where account_id = p;
  update public.cook_profile set last_at = null where account_id = p;
  update public.wild_profile set last_at = null, trap_at = null where account_id = p;
end $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------- 1. Rừng tràm: the map, the portal, the window ----------
do $$
declare o record; n integer;
begin
  assert exists (select 1 from public._pos_maps() where map = 'rung_tram' and w = 640 and h = 384), 'the map';
  assert exists (select 1 from public._pos_portals() where from_map = 'bai_dat' and to_map = 'rung_tram'), 'in';
  assert exists (select 1 from public._pos_portals() where from_map = 'rung_tram' and to_map = 'bai_dat'), 'out';
  assert exists (select 1 from public._world_portals() where from_map = 'bai_dat' and to_map = 'rung_tram'), 'the 3D model knows it too';
  assert (select min_level from public.map_levels where map = 'rung_tram') = 1, 'level 1';
  select * into o from public._forest_origin();
  assert (select wx from public._forest_xy('rung_tram', 10, 20)) = o.ox + 10 and (select wy from public._forest_xy('rung_tram', 10, 20)) = o.oy + 20, 'shifted';
  assert (select wx from public._forest_xy('wild', 10, 20)) = 10, 'the wild is itself';
  assert (select wx from public._forest_xy('bai_dat', 10, 20)) is null, 'a zone is no forest';
  select count(*) into n from generate_series(0, 9) gx(i), generate_series(0, 5) gy(j)
   where exists (select 1 from public.world_forest f where f.cx = o.ox / 64 + gx.i and f.cy = o.oy / 64 + gy.j);
  assert n >= 50, format('the window is mostly forest: %s / 60', n);
  assert public._near_forest(o.ox + 40, o.oy + 224), 'the arrival is at the forest';
  assert not has_function_privilege('anon', 'public._forest_xy(text, double precision, double precision)', 'execute'), 'private';
  assert has_function_privilege('anon', 'public.tool_repair(text, text)', 'execute'), 'repair public';
end $$;

-- the 2D world_state of Rừng tràm: the window's animals, in the map's px
do $$
declare j jsonb; o record; bad integer;
begin
  select * into o from public._forest_origin();
  j := public.world_state(pg_temp.t('1'), pg_temp.room(), 'rung_tram');
  assert jsonb_array_length(j->'wild'->'animals') >= 6, format('the window has animals: %s', j->'wild');
  select count(*) into bad from jsonb_array_elements(j->'wild'->'animals') a
   where (a->>'hx')::int not between 0 and 640 or (a->>'hy')::int not between 0 and 384;
  assert bad = 0, 'in the map''s px';
  assert (select count(*) from public.wild_spawns where map = 'rung_tram') = 0, 'no separate 2D animals: the wild''s';
end $$;

-- ---------- 2. A 2D hunter: the bow, the meat ----------
do $$
declare a uuid := pg_temp.a('1'); t text := pg_temp.t('1'); sp public.wild_spawns; o record; lx integer; ly integer; e text; j jsonb;
begin
  select * into o from public._forest_origin();
  perform pg_temp.fresh(a);
  select * into sp from public.wild_spawns where map = 'wild' and taken_at is null and expires_at > now()
     and hx between o.ox + 64 and o.ox + 576 and hy between o.oy + 64 and o.oy + 320 order by id limit 1;
  update public.wild_spawns set born_at = now() where id = sp.id;
  select round(q.x)::int - o.ox, round(q.y)::int - o.oy into lx, ly
    from public._wild_species() s, public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, 0) q where s.id = sp.species;
  perform pg_temp.put2(a, 'rung_tram', lx, ly);
  e := pg_temp.err(format('select public.wild_start(%L, %s, %L, %L, %s, %s)', t, sp.id, 'hunt', 'rung_tram', lx, ly));
  assert e in ('no bow', 'cannot'), format('no bow: %s', e);
  insert into public.prof_tools (account_id, item, durability, max_durability) values (a, 'cung_tap_su', 60, 60);
  j := public.wild_start(t, sp.id, 'photo', 'rung_tram', lx, ly);
  assert j->'round'->>'game' = 'photo', format('a 2D photo in Rừng tràm: %s', j);
  if (select hunt from public._wild_species() where id = sp.species) > 0 then
    perform pg_temp.fresh(a);
    j := public.wild_start(t, sp.id, 'hunt', 'rung_tram', lx, ly);
    assert j->'round'->>'game' = 'hunt', format('a 2D hunt: %s', j);
    assert (select durability from public.prof_tools where account_id = a and item = 'cung_tap_su') = 59, 'the bow wore';
  end if;
  -- the forest's animals: three for the pot, three for the album only
  assert (select count(*) from public._wild_species() where id in ('chuot_dong', 'ga_rung', 'ran_ri_ca') and hunt > 0 and drop_item like 'thit_%') = 3, 'huntable';
  assert (select count(*) from public._wild_species() where id in ('cay_huong', 'co_trang', 'rua_hop_lung_den') and hunt = 0 and trap = 0) = 3, 'photo only';
  assert (select count(*) from public._wild_species() s where s.drop_item is not null
           and not exists (select 1 from public._wild_items() i where i.id = s.drop_item)) = 0, 'every drop is sold';
end $$;

-- ---------- 3. A 2D woodcutter in Rừng tràm ----------
do $$
declare a uuid := pg_temp.a('2'); t text := pg_temp.t('2'); o record; j jsonb; cx integer; cy integer;
begin
  select * into o from public._forest_origin();
  select f.cx, f.cy into cx, cy from public.world_forest f where f.core and f.cx between o.ox / 64 + 1 and o.ox / 64 + 8
     and f.cy between o.oy / 64 + 1 and o.oy / 64 + 4 order by f.cy, f.cx limit 1;
  perform pg_temp.fresh(a);
  insert into public.prof_tools (account_id, item, durability, max_durability) values (a, 'riu_tap_su', 60, 60);
  perform pg_temp.put2(a, 'rung_tram', cx * 64 + 32 - o.ox, cy * 64 + 32 - o.oy);
  j := public.chop_start(t, cx, cy, 0, 'rung_tram', cx * 64 + 32 - o.ox, cy * 64 + 32 - o.oy);
  assert j->'round'->>'game' = 'chop', format('a 2D chop: %s', j);
  -- the axe's repair at the stall: its repair price a point × the missing points
  update public.prof_tools set durability = 30 where account_id = a and item = 'riu_tap_su';
  perform pg_temp.put2(a, 'bai_dat', 460, 56);
  j := public.tool_repair(t, 'riu_tap_su');
  assert (j->>'cost')::int = 30, format('repair %s', j);
  assert (select durability from public.prof_tools where account_id = a and item = 'riu_tap_su') = 60, 'as new';
  assert exists (select 1 from public.coin_ledger where account_id = a and reason = 'repair' and delta = -30), 'repair paid';
  assert pg_temp.err(format('select public.tool_repair(%L, %L)', t, 'riu_tap_su')) = 'nothing to repair', 'full';
  j := public.tool_buy(t, 'chao_gang');
  assert j->'forest'->'tools' @> '[{"item": "chao_gang", "durability": 130}]', 'a tier-2 pan';
  j := public.tool_buy(t, 'cung_go_tram');
  assert j->'forest'->'tools' @> '[{"item": "cung_go_tram", "durability": 110}]', 'a tier-2 bow';
end $$;

-- ---------- 4. The kitchen: the pan, the fish, the buff dishes ----------
do $$
declare a uuid := pg_temp.a('3'); t text := pg_temp.t('3'); e text; j jsonb; n integer;
begin
  perform pg_temp.fresh(a);
  perform public.profession_choose(t, 'dau_bep');
  assert exists (select 1 from public.prof_tools where account_id = a and item = 'chao_tap_su'), 'the starter pan';
  update public.prof_tools set durability = 0 where account_id = a and item = 'chao_tap_su';
  e := pg_temp.err(format('select public.cook_start(%L, %L)', t, 'com_tam_suon'));
  assert e = 'no pan', format('no pan: %s', e);
  update public.prof_tools set durability = 60 where account_id = a and item = 'chao_tap_su';
  -- a fish dish takes its fish from the catch (cá rô kho tiêu: two cá rô)
  e := pg_temp.err(format('select public.cook_start(%L, %L)', t, 'ca_ro_kho_tieu'));
  assert e = 'no ingredients', format('no fish: %s', e);
  insert into public.fish (account_id, species_id, weight_g, price) values (a, 'ca_ro', 100, 10), (a, 'ca_ro', 120, 10), (a, 'ca_loc', 900, 50);
  perform pg_temp.fresh(a);
  j := public.cook_start(t, 'ca_ro_kho_tieu');
  assert j->'round'->>'recipe' = 'ca_ro_kho_tieu', format('fish dish %s', j);
  assert (select count(*) from public.fish where account_id = a) = 1 and exists (select 1 from public.fish where account_id = a and species_id = 'ca_loc'), 'the two cá rô used';
  assert (select durability from public.prof_tools where account_id = a and item = 'chao_tap_su') = 59, 'the pan wore';
  -- a buff dish, eaten: the buff for its minutes × the quality's %, replacing the old one
  insert into public.cooked_dishes (account_id, dish, quality, qty) values (a, 'chao_ran_dau_xanh', 1, 1), (a, 'chuot_dong_nuong_sa', 3, 1);
  j := public.cook_eat(t, 'chao_ran_dau_xanh', 1);
  assert j->>'buff' = 'hunt_chance' and public._buff(a, 'hunt_chance') = 5, format('buff %s', j);
  j := public.cook_eat(t, 'chuot_dong_nuong_sa', 3);
  assert public._buff(a, 'hunt_chance') = 3, 'replaced, not stacked';
  -- 12 min × the Tuyệt phẩm % (_cook_pct: 150 % in 0096, 125 % from 0103's econ v2)
  assert (select until from public.player_buffs where account_id = a and kind = 'hunt_chance')
         between now() + make_interval(mins => floor(12 * public._cook_pct(3) / 100.0)::int - 1)
             and now() + make_interval(mins => floor(12 * public._cook_pct(3) / 100.0)::int + 1), '12 min × the quality''s %';
  assert (select count(*) from public._cook_recipes()) = 10, 'ten dishes';
  assert (select count(*) from public._cook_recipes() r where r.fish is not null and not exists (select 1 from public.fish_species f where f.id = r.fish)) = 0, 'every fish is a catch';
  j := public.forest_state(t);
  assert j->'fish'->>'ca_loc' = '1', format('the kitchen sees the catch %s', j->'fish');
end $$;

-- ---------- 5. Thợ săn xp for hunters only ----------
do $$
declare a uuid := pg_temp.a('2'); before integer;
begin
  before := coalesce((select xp from public.player_professions where account_id = a and prof = 'tho_san'), 0);
  perform public._game_event(a, 'wild_hunt', 1, '{}');
  assert coalesce((select xp from public.player_professions where account_id = a and prof = 'tho_san'), 0) = before, 'no hunter xp for a non-hunter';
  delete from public.player_profession_main where account_id = a;
  insert into public.player_profession_main (account_id, prof) values (a, 'tho_san');
  perform public._game_event(a, 'wild_hunt', 1, '{}');
  assert (select xp from public.player_professions where account_id = a and prof = 'tho_san') = before + 15, 'the hunter gets it (× 1.5)';
  perform public._game_event(a, 'fish_catch', 1, '{}');
  assert (select xp from public.player_professions where account_id = a and prof = 'ngu_dan') = 10, 'other nghề unchanged';
end $$;

update public.app_flags set enabled = (select v::boolean from vx where k = 'flag') where key = 'unified_world';
\echo forest-complete-smoke: ok
