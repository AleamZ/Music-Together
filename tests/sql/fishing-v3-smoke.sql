-- tests/sql/fishing-v3-smoke.sql — 0110 (Câu cá v3: modular gear). Run as the superuser on the throwaway cluster after the
-- full chain (… 0109, 0110), from the repo root, with the reel fixtures' absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/reel-cases.json -f tests/sql/fishing-v3-smoke.sql
-- It re-runs 0110 twice with \i (re-runnable), sets the room_creation_open and unified_world flags and Sông Cái's level
-- for its checks and puts them back; its accounts are deleted at the end. Every check is an ASSERT; the statistical ones
-- have generous bounds.
--   1. The catalog: the parts, the rods' limits, Cần gỗ the kit, the habits (not the client's to read), the new species.
--   2. A bare rod is refused ('rod needs parts') and nothing is spent; the parts bought fill their slots; a rod bought
--      waits for them.
--   3. fishing_equip: the slot, the kind, owning it, unmounting, a broken rod, the bait.
--   4. The species: hook-gated ones only with their hook; hours; ×2 bait / ×3 groundbait weighting; a lift respects them.
--   5. Thính: throw_groundbait spends a bag on my spot; 48 px, 10 minutes, mine only; the cast answers it.
--   6. The breaks: line_snap (3 snaps, then the line is gone), rod_snap (the rod to 0, unequipped, repairable).
--   7. Multi-hook: the extras' odds, landed within the rig and the bucket.
--   8. The reel and the phao in the cast's params.
--   9. The notebook: refused without it, the habits with it.
--  10. The nets: the new nets' rarity, never a hook-gated species; the throw keeps its spot; the new buckets and nets.
--  11. The river casts: the parts gate, the hook-gated deep species.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0110_fishing_v3.sql
\i supabase/migrations/0110_fishing_v3.sql
-- 0113 re-creates functions of this migration: re-run it after, as the chain does
\i supabase/migrations/0113_review_fixes.sql
\i supabase/migrations/0113_review_fixes.sql
-- 0115 re-creates the rig, the shop, fishing_equip and finish_cast per rod instance: re-run it after, as the chain does
\i supabase/migrations/0115_rod_builds.sql
\i supabase/migrations/0115_rod_builds.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log';

create temp table fv (k text primary key, v text);
insert into fv select 'flag_rooms', enabled::text from public.app_flags where key = 'room_creation_open';
insert into fv select 'flag_world', enabled::text from public.app_flags where key = 'unified_world';
insert into fv select 'song_cai', min_level::text from public.map_levels where map = 'song_cai';
update public.app_flags set enabled = true where key = 'room_creation_open';
create temp table rf as select pg_read_file(:'fixtures')::jsonb j;
do $$
declare n text; r text;
begin
  foreach n in array array['a', 'b'] loop
    r := 'fv' || n || '_' || floor(random() * 1e9)::text;
    insert into fv select 't' || n, token from public.register(r, 'pw123456');
    insert into fv select n, public._auth_account((select v from fv where k = 't' || n))::text;
  end loop;
end $$;
insert into fv select 'room', room_id::text from public.create_room('fishing v3', 'pw', (select v from fv where k = 'ta'));

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from fv where k = key $$;
create or replace function pg_temp.u(key text) returns uuid language sql stable as $$ select v::uuid from fv where k = key $$;
-- stand somewhere (an accepted claim an hour back)
create or replace function pg_temp.put(p uuid, p_map text, p_x integer, p_y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb
$$;
-- full vitals and stamina, 20 worms, empty hands, no cast, standing on Cầu ao's dock (cell 37, 25)
create or replace function pg_temp.fresh(p uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, starve_s = 0, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100, at = now();
  insert into public.inventory (account_id, item_id, qty) values (p, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  delete from public.fish where account_id = p;
  delete from public.casts where account_id = p;
  perform pg_temp.put(p, 'pond', 300, 204);
end $$;
create or replace function pg_temp.give(p uuid, p_item text) returns void language sql as $$
  insert into public.inventory (account_id, item_id, qty, durability)
  select p, id, 1, durability from public.shop_items where id = p_item
  on conflict (account_id, item_id) do update set qty = 1, durability = excluded.durability
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlerrm;
end $$;
-- 0115: the equipped rod instance; equip one of a model (made if none); put a part straight into its slot (a fixture)
create or replace function pg_temp.rod(p uuid) returns bigint language sql stable as $$
  select rod_id from public.fishing_profiles where account_id = p $$;
create or replace function pg_temp.equip(p uuid, p_model text) returns void language plpgsql as $$
declare v bigint;
begin
  if p_model = 'rod_wood' then v := public._rod_kit(p);
  else
    select id into v from public.rods where account_id = p and item_id = p_model order by id limit 1;
    if v is null then
      insert into public.rods (account_id, item_id, durability) select p, id, durability from public.shop_items where id = p_model
      returning id into v;
    end if;
  end if;
  update public.fishing_profiles set rod_id = v where account_id = p;
  perform public._rod_sync(p);
end $$;
create or replace function pg_temp.mount(p uuid, p_slot text, p_item text) returns void language plpgsql as $$
begin
  delete from public.rod_parts where rod_id = pg_temp.rod(p) and slot = p_slot;
  if p_item is not null then
    insert into public.rod_parts (rod_id, slot, item_id, durability)
    select pg_temp.rod(p), p_slot, id, case when kind = 'line' then durability end from public.shop_items where id = p_item;
  end if;
  perform public._rod_sync(p);
end $$;
-- a won reel of the fixtures, cast as the given fish with the given limits and extras; finish_cast's answer
create or replace function pg_temp.land(a uuid, t text, room uuid, sp text, w integer, p_line text, line_g integer,
                                        rod_g integer, p_rod text, extra jsonb) returns jsonb language plpgsql as $$
declare won jsonb := (select x from rf, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'caught' limit 1);
        tg integer[]; cid uuid;
begin
  select array_agg(x::int order by o) into tg from jsonb_array_elements_text(won->'toggles') with ordinality q(x, o);
  delete from public.casts where account_id = a;
  delete from public.anticheat_events where account_id = a and code like 'reel_timing%';   -- the fixture's reel, many times
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, reel_seed, reel_params,
                            hooked_at, rod, line, line_g, rod_g, extra)
  values (a, room, sp, w, (won->'params'->>'minReelMs')::int, now() - interval '61 seconds', now() + interval '30 seconds',
          (won->'params'->>'seed')::bigint,
          jsonb_build_object('zone_pct', won->'params'->'zonePct', 'difficulty', won->'params'->'difficulty',
                             'min_reel_ms', won->'params'->'minReelMs'), now() - interval '60 seconds',
          p_rod, p_line, line_g, rod_g, extra)
  returning id into cid;
  return public.finish_cast(t, cid, true, false, coalesce(tg, '{}'), (won->'expected'->>'ticks')::int);
end $$;

-- ---------- 1. The catalog ----------
do $$
begin
  assert (select count(*) from public.shop_items where kind = 'hook') = 6
     and (select count(*) from public.shop_items where kind = 'line') = 4
     and (select count(*) from public.shop_items where kind = 'reel') = 3
     and (select count(*) from public.shop_items where kind = 'groundbait') = 4
     and (select count(*) from public.shop_items where kind = 'fishbook') = 1, 'the parts';
  assert (select count(*) from public.shop_items where kind = 'bucket' and price is not null) = 5, 'five buckets for sale';
  assert (select count(*) from public.shop_items where kind = 'net' and price is not null) = 4, 'four nets for sale';
  assert (select jsonb_object_agg(id, hook_count) from public.shop_items where kind = 'hook' and hook_count > 1)
       = '{"hook_double": 2, "hook_triple": 3}'::jsonb, 'the multi-hooks';
  assert (select jsonb_object_agg(id, line_g) from public.shop_items where kind = 'line')
       = '{"line_02": 4000, "line_03": 12000, "line_braid": 30000, "line_pe": 60000}'::jsonb, 'the lines';
  assert not exists (select 1 from public.shop_items where kind = 'line' and durability <> 3), 'a line has 3 snaps';
  assert (select jsonb_object_agg(id, rating_g) from public.shop_items where kind = 'rod')
       = '{"rod_wood": 1500, "rod_bamboo": 6000, "rod_fiber": 12000, "rod_carbon": 30000, "rod_master": 60000}'::jsonb, 'the rods';
  assert (select (hook_class, hook_count, line_g) = ('small'::text, 1::smallint, 3000) and durability is null
            from public.shop_items where id = 'rod_wood'), 'Cần gỗ is the kit';
  assert not exists (select 1 from public.shop_items where kind = 'rod' and id <> 'rod_wood' and hook_class is not null), 'bare rods';
  -- the full mid kit (carbon, lưỡi lớn, dây dù, máy 3000, phao xốp) ≈ carbon + phao đèn before
  assert (select sum(price) from public.shop_items where id in ('rod_carbon', 'hook_large', 'line_braid', 'reel_3000', 'bobber_foam'))
         between 2200 and 2800, 'the mid kit';
  assert (select count(*) from public.fish_species) = 27, 'the 27 species';
  assert not exists (select 1 from public.fish_species s where not exists (select 1 from public.fish_habits h where h.species_id = s.id)),
    'every species has its habits';
  assert not exists (select 1 from public.fish_habits h where h.species_id in (select id from public.fish_species where rarity = 1)
                       and (h.hook is not null or h.hours is not null)), 'a Thường always bites';
  assert not has_table_privilege('anon', 'public.fish_habits', 'select')
     and not has_table_privilege('authenticated', 'public.fish_habits', 'select'), 'the habits are the notebook''s';
  assert not has_table_privilege('anon', 'public.fishing_groundbait', 'select'), 'the groundbait rows are private';
  -- the new species on 0101's scale: each rarity's cheapest mean fish (k = 2) above the dearest of the rarity below
  for r in 2 .. 5 loop
    assert (select min(price_per_kg * (min_g + (max_g - min_g + 1) / 3.0 - 0.5) / 1000) from public.fish_species where rarity = r)
         > (select max(price_per_kg * (min_g + (max_g - min_g + 1) / 3.0 - 0.5) / 1000) from public.fish_species where rarity = r - 1),
      format('rarity %s dearer', r);
  end loop;
  raise notice 'catalog ok';
end $$;

-- ---------- 2. A bare rod ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); c jsonb; s jsonb;
begin
  perform public._fishing_profile(a);
  insert into public.wallets (account_id) values (a) on conflict do nothing;
  update public.wallets set coins = 100000 where account_id = a;
  perform pg_temp.fresh(a);
  -- Cần gỗ casts as before (a kit)
  c := public.start_cast(room, t, 37, 25);
  assert c ? 'cast_id', format('the wooden rod casts %s', c);
  s := public._fishing_rig(a);
  assert (s->>'kit')::boolean and (s->>'ready')::boolean and s->>'hook_class' = 'small' and (s->>'line_g')::int = 3000
     and s->'rod_g' = 'null'::jsonb and (s->>'window_ms')::int = 1500, format('the kit %s', s);
  -- a rod bought waits for its parts (the wooden one stays)
  perform public.buy_item(t, 'rod_carbon');
  assert (select rod from public.fishing_profiles where account_id = a) = 'rod_wood', 'a bare rod is not mounted by the buy';
  perform public.fishing_equip(t, 'rod', 'rod_carbon');
  perform pg_temp.fresh(a);
  assert pg_temp.err(format('select public.start_cast(%L, %L, 37, 25)', room, t)) = 'rod needs parts', 'a bare rod is refused';
  assert (select qty from public.inventory where account_id = a and item_id = 'bait_worm') = 20, 'no bait spent';
  assert not exists (select 1 from public.casts where account_id = a), 'no cast';
  s := (public.fishing_state(t))->'rig';
  assert s->'missing' = '["hook", "line"]'::jsonb and not (s->>'ready')::boolean, format('missing %s', s);
  -- the parts go into the bag and are mounted on this rod (0115)
  perform public.buy_item(t, 'hook_large');
  perform public.rod_mount(t, pg_temp.rod(a), 'hook', 'hook_large');
  assert pg_temp.err(format('select public.start_cast(%L, %L, 37, 25)', room, t)) = 'rod needs parts', 'still no line';
  perform public.buy_item(t, 'line_03');
  perform public.buy_item(t, 'reel_3000');
  perform public.rod_mount(t, pg_temp.rod(a), 'line', 'line_03');
  perform public.rod_mount(t, pg_temp.rod(a), 'reel', 'reel_3000');
  assert (select (hook, line, reel) = ('hook_large'::text, 'line_03'::text, 'reel_3000'::text) from public.fishing_profiles where account_id = a),
    'the parts mounted';
  c := public.start_cast(room, t, 37, 25);
  assert c ? 'cast_id', format('the rigged rod casts %s', c);
  assert (select (line, line_g, rod_g) = ('line_03'::text, 12000, 30000) from public.casts where id = (c->>'cast_id')::uuid),
    'the cast keeps its line and limits';
  -- 0115: a part stacks in the bag (a second hook is one more there)
  perform public.buy_item(t, 'hook_large');
  assert (select qty from public.inventory where account_id = a and item_id = 'hook_large') = 1, 'stackable';
  perform public.buy_item(t, 'line_02', 2);                              -- flagged (bad_qty), nothing bought
  assert not exists (select 1 from public.inventory where account_id = a and item_id = 'line_02'), 'one part at a time';
  -- unmounting the line (destroyed, 0115): refused again
  perform public.rod_unmount(t, pg_temp.rod(a), 'line');
  perform pg_temp.fresh(a);
  assert pg_temp.err(format('select public.start_cast(%L, %L, 37, 25)', room, t)) = 'rod needs parts', 'no line, no cast';
  perform public.buy_item(t, 'line_03');
  perform public.rod_mount(t, pg_temp.rod(a), 'line', 'line_03');
  raise notice 'bare rod ok';
end $$;

-- ---------- 3. fishing_equip ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); s jsonb;
begin
  assert pg_temp.err(format('select public.fishing_equip(%L, %L, %L)', t, 'hat', 'hook_small')) = 'bad slot', 'a bad slot';
  assert pg_temp.err(format('select public.fishing_equip(%L, %L, %L)', t, 'hook', 'hook_large')) = 'rod build', 'parts are per rod (0115)';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, pg_temp.rod(a), 'hook', 'hook_eel')) = 'item not available', 'not owned';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, pg_temp.rod(a), 'hook', 'line_03')) = 'item not available', 'wrong kind';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, pg_temp.rod(a), 'line', 'bait_worm')) = 'item not available', 'a bait is no line';
  assert pg_temp.err(format('select public.fishing_equip(%L, %L, null)', t, 'bait')) = 'item not available', 'the bait is never empty';
  -- the bait may be one at 0 (as set_loadout allowed)
  perform public.fishing_equip(t, 'bait', 'bait_gold');
  assert (select bait from public.fishing_profiles where account_id = a) = 'bait_gold', 'bait chosen';
  perform public.fishing_equip(t, 'bait', 'bait_worm');
  -- no phao: a bare rod's 0.7 s window
  perform pg_temp.mount(a, 'bobber', null);
  s := public.fishing_state(t);
  assert s->'loadout'->'bobber' = 'null'::jsonb and (s->'rig'->>'window_ms')::int = 700, format('no bobber %s', s->'rig');
  perform public.rod_mount(t, pg_temp.rod(a), 'bobber', 'bobber_feather');   -- a starter: free
  assert (public._fishing_rig(a)->>'window_ms')::int = 1500, 'the feather';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, pg_temp.rod(a), 'bobber', 'bobber_lamp')) = 'item not available', 'lamp not owned';
  -- a broken rod is refused; the rod slot empty is Cần gỗ
  update public.rods set durability = 0 where account_id = a and item_id = 'rod_carbon';
  perform public.fishing_equip(t, 'rod', null);
  assert (select rod from public.fishing_profiles where account_id = a) = 'rod_wood', 'rod null → Cần gỗ';
  assert pg_temp.err(format('select public.fishing_equip(%L, %L, %L)', t, 'rod', 'rod_carbon')) = 'rod broken', 'broken';
  update public.rods set durability = 300 where account_id = a and item_id = 'rod_carbon';
  perform public.fishing_equip(t, 'rod', 'rod_carbon');
  -- someone else's part is not mine
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', pg_temp.v('tb'), pg_temp.rod(a), 'hook', 'hook_large')) = 'rod not found',
    'b does not own a''s rod';
  s := public.fishing_state(t);
  assert s->'loadout' @> '{"rod": "rod_carbon", "hook": "hook_large", "line": "line_03", "reel": "reel_3000"}'::jsonb
     and s->'owned' @> '["hook_large"]'::jsonb and s->'rig'->>'line' = 'line_03'
     and (select x->'parts'->'line'->>'durability' from jsonb_array_elements(s->'rods') x where (x->>'equipped')::boolean) = '3',
    format('the state %s', s->'loadout');
  raise notice 'equip ok';
end $$;

-- ---------- 4. The species ----------
do $$
declare sp public.fish_species; i integer; n integer; k integer; v_hour integer := public._vn_hour();
begin
  -- hook-gated: tôm càng only with lưỡi tôm; cá hô / ba ba only with lưỡi lớn; lươn only with lưỡi câu lươn
  n := 0;
  for i in 1 .. 300 loop
    sp := public._species_pick(3, false, 'small', null, null);
    assert sp.id <> 'tom_cang', 'tôm càng on a small hook';
  end loop;
  for i in 1 .. 300 loop
    sp := public._species_pick(3, false, 'shrimp', null, null);
    if sp.id = 'tom_cang' then n := n + 1; end if;
  end loop;
  assert n between 50 and 160, format('tôm càng with lưỡi tôm %s / 300', n);
  for i in 1 .. 200 loop
    sp := public._species_pick(5, false, 'small', null, null);
    assert sp.rarity < 5, format('no pond Huyền thoại on a small hook: %s', sp.id);
    assert not exists (select 1 from public.fish_habits where species_id = sp.id and hook is not null), 'a gated species';
  end loop;
  for i in 1 .. 50 loop
    sp := public._species_pick(5, false, 'large', null, null);
    assert sp.id in ('ca_ho', 'ba_ba'), format('lưỡi lớn: %s', sp.id);
    assert sp.id <> 'ba_ba' or v_hour = any(array[20, 21, 22, 23, 0, 1, 2, 3]), 'ba ba at night only';
  end loop;
  -- the deep water from Hiếm up: a boat's rarity 5 on lưỡi lớn is a deep one
  sp := public._species_pick(5, true, 'large', null, null);
  assert sp.water = 'deep' and sp.rarity = 5, format('deep %s', sp.id);
  -- hours: cá rô out of hours never bites, in hours it does
  update public.fish_habits set hours = array[((v_hour + 1) % 24)::smallint] where species_id = 'ca_ro';
  for i in 1 .. 200 loop
    sp := public._species_pick(1, false, 'small', null, null);
    assert sp.id <> 'ca_ro', 'cá rô out of its hours';
  end loop;
  assert not public._fish_ok('ca_ro', 'small'), '_fish_ok: the hour';
  update public.fish_habits set hours = array[v_hour::smallint] where species_id = 'ca_ro';
  n := 0;
  for i in 1 .. 300 loop
    sp := public._species_pick(1, false, 'small', null, null);
    if sp.id = 'ca_ro' then n := n + 1; end if;
  end loop;
  assert n between 60 and 150, format('cá rô in its hours %s / 300', n);
  update public.fish_habits set hours = null where species_id = 'ca_ro';
  assert public._fish_ok('ca_ro', 'small') and not public._fish_ok('tom_cang', 'small') and public._fish_ok('tom_cang', 'shrimp'), '_fish_ok';
  -- ×2 a liked bait: trùn chỉ is cá sặc's (of the three Thường) → ½ instead of ⅓
  n := 0;
  for i in 1 .. 900 loop
    sp := public._species_pick(1, false, 'small', 'bait_bloodworm', null);
    if sp.id = 'ca_sac' then n := n + 1; end if;
  end loop;
  assert n between 900 * 0.42 and 900 * 0.58, format('×2 bait: cá sặc %s / 900', n);
  -- ×3 a liked groundbait: thính tôm is cá lóc's (of the Khá a small hook takes: lóc, trê, chép) → 3/5 instead of ⅓
  n := 0; k := 0;
  for i in 1 .. 900 loop
    sp := public._species_pick(2, false, 'small', null, 'gb_tom');
    if sp.id = 'ca_loc' then n := n + 1; end if;
    if sp.id = 'luon_dong' then k := k + 1; end if;
  end loop;
  assert n between 900 * 0.52 and 900 * 0.68, format('×3 groundbait: cá lóc %s / 900', n);
  assert k = 0, 'lươn needs its hook';
  raise notice 'species ok';
end $$;

-- a lift goes one rarity up to a species the hook takes (the luck potion at full power)
do $$
declare a uuid := pg_temp.u('b'); o_sp text; o_w integer; i integer; n integer := 0;
begin
  perform public._fishing_profile(a);                                  -- b: Cần gỗ, a small hook
  insert into public.player_buffs (account_id, kind, power, until) values (a, 'luck', 5, now() + interval '1 hour')
  on conflict do nothing;
  for i in 1 .. 300 loop
    select l.o_species, l.o_weight into o_sp, o_w from public._cast_lift(a, 'rod_wood', 'ca_he_vang', 500, false) l;
    assert o_sp <> 'ca_ho' and o_sp <> 'ba_ba', format('a lift to %s on a small hook', o_sp);
    if o_sp <> 'ca_he_vang' then n := n + 1; end if;
  end loop;
  assert n = 0, format('no pond Huyền thoại takes a small hook: %s lifts', n);
  for i in 1 .. 300 loop
    select l.o_species into o_sp from public._cast_lift(a, 'rod_wood', 'ca_ro', 100, false) l;
    assert o_sp not in ('luon_dong'), 'lươn is not lifted into';
  end loop;
  delete from public.player_buffs where account_id = a;
  raise notice 'lift ok';
end $$;

-- ---------- 5. Thính ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); r jsonb; c jsonb;
        v_last bigint := coalesce((select max(id) from public.coin_ledger where account_id = pg_temp.u('a')), 0);
begin
  perform public.buy_item(t, 'gb_tom', 5);
  assert (select -delta from public.coin_ledger where account_id = a and id > v_last and reason = 'buy') = 75, 'five bags at 15';
  assert pg_temp.err(format('select public.buy_item(%L, %L, 95)', t, 'gb_tom')) = 'groundbait full', '99 of a kind';
  assert pg_temp.err(format('select public.throw_groundbait(%L, %L, %L, %L, 37, 25)', room, t, 'gb_cam', 'pond')) = 'no groundbait',
    'none of that kind';
  assert pg_temp.err(format('select public.throw_groundbait(%L, %L, %L, %L, 37, 25)', room, t, 'bait_worm', 'pond')) = 'item not available',
    'a bait is no groundbait';
  assert pg_temp.err(format('select public.throw_groundbait(%L, %L, %L, %L, 0, 0)', room, t, 'gb_tom', 'pond')) = 'bad spot', 'on land';
  perform pg_temp.fresh(a);
  r := public.throw_groundbait(room, t, 'gb_tom', 'pond', 37, 25);
  assert r->'groundbait'->>'item' = 'gb_tom' and (r->'groundbait'->>'x')::int = 300 and (r->'groundbait'->>'y')::int = 204, format('%s', r);
  assert (select qty from public.inventory where account_id = a and item_id = 'gb_tom') = 4, 'one bag spent';
  assert r->'state'->'groundbait'->>'gb_tom' = '4' and r->'state'->'groundbait_on'->>'item' = 'gb_tom', 'the state';
  assert public._groundbait_at(a, 'pond', 300, 204) = 'gb_tom' and public._groundbait_at(a, 'pond', 330, 230) = 'gb_tom', 'within 48 px';
  assert public._groundbait_at(a, 'pond', 360, 204) is null, 'too far';
  assert public._groundbait_at(a, 'song_cai', 300, 204) is null, 'another map';
  assert public._groundbait_at(pg_temp.u('b'), 'pond', 300, 204) is null, 'only mine';
  c := public.start_cast(room, t, 37, 25);
  assert c->>'groundbait' = 'gb_tom', format('the cast feels it %s', c);
  update public.fishing_groundbait set expires_at = now() - interval '1 second' where account_id = a;
  assert public._groundbait_at(a, 'pond', 300, 204) is null, 'after 10 minutes';
  perform pg_temp.fresh(a);
  c := public.start_cast(room, t, 37, 25);
  assert c->'groundbait' = 'null'::jsonb, 'gone';
  -- another throw replaces it
  perform public.throw_groundbait(room, t, 'gb_tom', 'pond', 37, 25);
  assert (select count(*) from public.fishing_groundbait where account_id = a) = 1
     and (select expires_at > now() + interval '9 minutes' from public.fishing_groundbait where account_id = a), 'one, 10 minutes';
  delete from public.fishing_groundbait where account_id = a;
  delete from public.casts where account_id = a;
  raise notice 'groundbait ok';
end $$;

-- ---------- 6. The breaks ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); r jsonb; i integer;
        v_p bigint; v_w bigint; v_x bigint;   -- 0113
begin
  -- the rig holds it: caught
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, room, 'ca_chep', 2900, 'line_02', 3000, 15000, 'rod_carbon', null);
  assert r->>'result' = 'caught', format('within the line %s', r);
  -- heavier than the line (the weaker part): line_snap, one snap worn
  perform pg_temp.mount(a, 'line', 'line_02');
  select coalesce(sum(plays), 0), coalesce(sum(wins), 0), coalesce(sum(exact), 0) into v_p, v_w, v_x
    from public.ac_play_stats where account_id = a and game = 'reel';   -- 0113
  for i in 1 .. 3 loop
    perform pg_temp.fresh(a);
    r := pg_temp.land(a, t, room, 'ca_chep', 3001, 'line_02', 3000, 15000, 'rod_carbon', null);
    assert r->>'result' = 'lost' and r->>'why' = 'line_snap', format('line_snap %s', r);
    assert (r->'snap'->>'weight_g')::int = 3001 and (r->'snap'->>'limit_g')::int = 3000 and r->'snap'->>'species_id' = 'ca_chep', 'snap';
    assert not exists (select 1 from public.fish where account_id = a), 'no fish';
    if i < 3 then
      assert (select durability from public.rod_parts where rod_id = pg_temp.rod(a) and slot = 'line') = 3 - i, 'a snap worn';
      assert not (r->'snap'->>'line_gone')::boolean, 'still there';
    else
      assert (r->'snap'->>'line_gone')::boolean, 'the third snap: gone';
      assert not exists (select 1 from public.rod_parts where rod_id = pg_temp.rod(a) and slot = 'line'), 'off the rod';
      assert (select line from public.fishing_profiles where account_id = a) is null, 'unmounted';
    end if;
  end loop;
  -- 0113: a snapped fish is a played round, never a won / exact one
  assert (select sum(plays) = v_p + 3 and sum(wins) = v_w and sum(exact) = v_x
            from public.ac_play_stats where account_id = a and game = 'reel'), 'a snap is a lost round';
  -- the rod the weaker part: rod_snap — the rod to 0, unequipped, rod_broke, repairable
  perform pg_temp.mount(a, 'line', 'line_03');
  perform pg_temp.equip(a, 'rod_fiber');
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, room, 'ca_ho', 9000, 'line_braid', 20000, 8000, 'rod_fiber', null);
  assert r->>'result' = 'lost' and r->>'why' = 'rod_snap' and (r->>'rod_broke')::boolean, format('rod_snap %s', r);
  assert (select durability from public.rods where account_id = a and item_id = 'rod_fiber') = 0, 'the rod at 0';
  assert (select rod from public.fishing_profiles where account_id = a) = 'rod_wood', 'back to Cần gỗ';
  r := public.repair_rod(t, 'rod_fiber');
  assert (r->>'cost')::int = 210 and (select durability from public.rods where account_id = a and item_id = 'rod_fiber') = 200,
    format('repaired %s', r);
  -- the wooden rod (its own line): line_snap, nothing worn
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, room, 'ca_tra', 3500, null, 3000, null, 'rod_wood', null);
  assert r->>'why' = 'line_snap' and not (r->'snap'->>'line_gone')::boolean, format('the kit''s line %s', r);
  -- a cast from before 0110 (no limits) never snaps
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, room, 'ca_tra', 5900, null, null, null, 'rod_wood', null);
  assert r->>'result' = 'caught', format('an old cast %s', r);
  raise notice 'breaks ok';
end $$;

-- ---------- 7. Multi-hook ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); r jsonb; i integer; n integer;
        x jsonb; c jsonb;
begin
  -- the odds: one extra with 12 % (2 points); 15 % + 6 % (3 points); none on one point
  n := 0;
  for i in 1 .. 2000 loop
    n := n + jsonb_array_length(public._cast_extras('{"hooks": 2, "hook_class": "small"}', 'rod_wood', 'bait_worm', 1, false, false, 0, null, 2));
  end loop;
  assert n between 2000 * 0.09 and 2000 * 0.15, format('2 points: %s extras / 2000', n);
  n := 0;
  for i in 1 .. 2000 loop
    x := public._cast_extras('{"hooks": 3, "hook_class": "large"}', 'rod_wood', 'bait_worm', 1, false, false, 0, null, 2);
    n := n + jsonb_array_length(x);
    assert jsonb_array_length(x) <= 2, 'at most two';
  end loop;
  assert n between 2000 * 0.16 and 2000 * 0.26, format('3 points: %s extras / 2000', n);
  assert public._cast_extras('{"hooks": 1, "hook_class": "small"}', 'rod_wood', 'bait_worm', 1, false, false, 0, null, 2) = '[]'::jsonb,
    'one point';
  -- a cast with lưỡi ba keeps its extras (random, not forced small)
  perform pg_temp.equip(a, 'rod_carbon');
  perform pg_temp.mount(a, 'hook', 'hook_triple');
  perform pg_temp.mount(a, 'line', 'line_03');
  n := 0;
  for i in 1 .. 200 loop
    perform pg_temp.fresh(a);
    c := public.start_cast(room, t, 37, 25);
    n := n + jsonb_array_length((select extra from public.casts where id = (c->>'cast_id')::uuid));
  end loop;
  assert n between 15 and 80, format('lưỡi ba at the cast: %s extras / 200', n);
  -- landing: the bucket's room (Xô nhỏ: 1 + 5), the rig's limit
  perform pg_temp.give(a, 'bucket_small');
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, room, 'ca_ro', 200, 'line_03', 8000, 15000, 'rod_carbon',
                    '[{"species_id": "ca_sac", "weight_g": 150}, {"species_id": "ca_chep", "weight_g": 9000}]');
  assert r->>'result' = 'caught' and jsonb_array_length(r->'extra') = 1 and r->'extra'->0->>'species_id' = 'ca_sac'
     and (r->'extra'->0->>'price')::int >= 1 and r->'extra'->0 ? 'id', format('one extra landed, the heavy one gone %s', r);
  assert (select count(*) from public.fish where account_id = a) = 2, 'two fish';
  perform pg_temp.fresh(a);
  insert into public.fish (account_id, species_id, weight_g, price) select a, 'ca_ro', 100, 4 from generate_series(1, 4);
  r := pg_temp.land(a, t, room, 'ca_ro', 200, 'line_03', 8000, 15000, 'rod_carbon',
                    '[{"species_id": "ca_sac", "weight_g": 150}, {"species_id": "ca_me_vinh", "weight_g": 150}]');
  assert r->>'result' = 'caught' and jsonb_array_length(r->'extra') = 1, format('the bucket holds one more %s', r);
  assert (select count(*) from public.fish where account_id = a) = 6, 'full';
  delete from public.inventory where account_id = a and item_id = 'bucket_small';
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, room, 'ca_ro', 200, 'line_03', 8000, 15000, 'rod_carbon', '[{"species_id": "ca_sac", "weight_g": 150}]');
  assert r->>'result' = 'caught' and r->'extra' = '[]'::jsonb, format('hands only: no extra %s', r);
  perform pg_temp.mount(a, 'hook', 'hook_large');
  raise notice 'multi-hook ok';
end $$;

-- ---------- 8. The reel and the phao ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); c jsonb; x public.casts;
        sp public.fish_species; i integer; v_d integer;
begin
  -- Máy xoay 5000: difficulty − 10, min_reel_ms × 0.8; the client is told what the server stored
  perform pg_temp.give(a, 'reel_5000');
  perform public.rod_mount(t, pg_temp.rod(a), 'reel', 'reel_5000');
  for i in 1 .. 20 loop
    perform pg_temp.fresh(a);
    c := public.start_cast(room, t, 37, 25);
    select * into x from public.casts where id = (c->>'cast_id')::uuid;
    select * into sp from public.fish_species where id = x.species_id;
    v_d := greatest(1, sp.difficulty - 10);
    assert (x.reel_params->>'difficulty')::int = v_d and x.min_reel_ms = round((2000 + 40 * v_d) * 0.8)
       and (x.reel_params->>'min_reel_ms')::int = x.min_reel_ms and (c->>'difficulty')::int = v_d
       and (c->>'min_reel_ms')::int = x.min_reel_ms, format('reel 5000 %s %s', sp.id, x.reel_params);
  end loop;
  -- no reel on a bare rod: difficulty + 5, × 1.15
  perform public.rod_unmount(t, pg_temp.rod(a), 'reel');
  perform pg_temp.fresh(a);
  c := public.start_cast(room, t, 37, 25);
  select * into x from public.casts where id = (c->>'cast_id')::uuid;
  select * into sp from public.fish_species where id = x.species_id;
  v_d := least(100, sp.difficulty + 5);
  assert x.min_reel_ms = round((2000 + 40 * v_d) * 1.15) and (x.reel_params->>'difficulty')::int = v_d, format('no reel %s', x.reel_params);
  -- no phao on a bare rod: 0.7 s to hook
  perform pg_temp.mount(a, 'bobber', null);
  perform pg_temp.fresh(a);
  c := public.start_cast(room, t, 37, 25);
  assert (c->>'window_ms')::int = 700 and c->'rarity' = 'null'::jsonb, format('no phao %s', c);
  -- Cần gỗ: the reel as before 0110
  perform public.fishing_equip(t, 'rod', 'rod_wood');
  perform pg_temp.give(a, 'reel_5000');
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, pg_temp.rod(a), 'reel', 'reel_5000')) = 'rod fixed',
    'the kit has its own (0115)';
  perform pg_temp.fresh(a);
  c := public.start_cast(room, t, 37, 25);
  select * into x from public.casts where id = (c->>'cast_id')::uuid;
  select * into sp from public.fish_species where id = x.species_id;
  assert x.min_reel_ms = 2000 + 40 * sp.difficulty and (c->>'window_ms')::int = 1500
     and x.line_g = 3000 and x.rod_g is null and x.line is null, format('the kit %s', c);
  assert not exists (select 1 from public.fish_habits h where h.species_id = sp.id and h.hook is not null), 'the kit''s small hook';
  delete from public.casts where account_id = a;
  raise notice 'reel ok';
end $$;

-- ---------- 9. The notebook ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); r jsonb;
begin
  assert pg_temp.err(format('select public.fishing_notebook(%L)', t)) = 'no notebook', 'without it';
  assert not (public.fishing_state(t)->>'notebook')::boolean, 'state: no notebook';
  perform public.buy_item(t, 'fishbook');
  r := public.fishing_notebook(t);
  assert jsonb_array_length(r->'species') = 27 and (r->>'hour')::int = public._vn_hour(), 'every species';
  assert (select x from jsonb_array_elements(r->'species') x where x->>'id' = 'tom_cang')
         @> '{"hook": "shrimp", "baits": ["bait_bloodworm"], "groundbaits": ["gb_tom"], "hours": null}'::jsonb, 'tôm càng';
  assert (select jsonb_array_length(x->'hours') from jsonb_array_elements(r->'species') x where x->>'id' = 'ca_tai_tuong') = 5, 'tai tượng''s morning';
  assert (public.fishing_state(t)->>'notebook')::boolean, 'state: the notebook';
  assert pg_temp.err(format('select public.buy_item(%L, %L)', t, 'fishbook')) = 'already owned', 'one notebook';
  raise notice 'notebook ok';
end $$;

-- ---------- 10. The nets, buckets ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); sp public.fish_species; i integer;
        n3 integer := 0; n4 integer := 0; r jsonb;
begin
  for i in 1 .. 500 loop
    sp := public._net_pick('net_small', null);
    assert sp.rarity <= 2 and sp.water = 'pond', format('a small net: %s', sp.id);
    assert not exists (select 1 from public.fish_habits where species_id = sp.id and hook is not null), 'a net takes no hooked species';
  end loop;
  for i in 1 .. 2000 loop
    sp := public._net_pick('net_cast', null);
    assert not exists (select 1 from public.fish_habits where species_id = sp.id and hook is not null), format('net_cast: %s', sp.id);
    if sp.rarity = 3 then n3 := n3 + 1; elsif sp.rarity = 4 then n4 := n4 + 1; end if;
  end loop;
  assert n3 between 2000 * 0.05 and 2000 * 0.13 and n4 between 2000 * 0.004 and 2000 * 0.04, format('Lưới chài cước: %s Hiếm, %s Quý', n3, n4);
  -- a net's groundbait ×3 (cá lóc of the six Thường / Khá: 1/6 → 3/8)
  n3 := 0;
  for i in 1 .. 1200 loop
    sp := public._net_pick('net_small', 'gb_tom');
    if sp.id = 'ca_loc' then n3 := n3 + 1; end if;
  end loop;
  assert n3 between 1200 * 0.28 and 1200 * 0.47, format('a net''s groundbait: cá lóc %s / 1200', n3);
  -- the throw keeps its spot
  perform pg_temp.fresh(a);
  perform public.buy_item(t, 'net_gill');
  r := public.start_net(room, t, 37, 25, 'net_gill');
  assert (select (x, y) = (300, 204) from public.net_throws where id = (r->>'throw_id')::uuid), 'the spot';
  assert (select durability from public.inventory where account_id = a and item_id = 'net_gill') = 30, 'Lưới rê: 30 throws';
  delete from public.net_throws where account_id = a;
  -- the new buckets
  perform public.buy_item(t, 'bucket_medium');
  assert (public.fishing_state(t)->>'fish_cap')::int = 11, 'Xô vừa: 10';
  perform public.buy_item(t, 'bucket_foam');
  assert (public.fishing_state(t)->>'fish_cap')::int = 31, 'Thùng xốp: 30';
  assert pg_temp.err(format('select public.buy_item(%L, %L)', t, 'bucket_small')) = 'already owned', 'a smaller bucket';
  raise notice 'nets ok';
end $$;

-- ---------- 11. The river ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); c jsonb; sp public.fish_species;
        i integer;
begin
  update public.app_flags set enabled = true where key = 'unified_world';
  update public.map_levels set min_level = 3 where map = 'song_cai';
  insert into public.player_progress (account_id, level) values (a, 3) on conflict (account_id) do update set level = 3;
  insert into public.boats (account_id) values (a) on conflict do nothing;
  perform public.fishing_equip(t, 'rod', 'rod_carbon');
  perform pg_temp.mount(a, 'line', null);
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', 424, 1900);
  update public.player_pos set mode = 'w' where account_id = a;
  assert pg_temp.err(format('select public.start_river_cast_w(%L, %L, %L, 424, 1900)', room, t, 'wild')) = 'rod needs parts',
    'the river too';
  perform pg_temp.mount(a, 'line', 'line_03');
end $$;
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); c jsonb; sp public.fish_species;
        i integer; n integer := 0;
begin
  update public.app_flags set enabled = true where key = 'unified_world';
  update public.map_levels set min_level = 3 where map = 'song_cai';
  insert into public.player_progress (account_id, level) values (a, 3) on conflict (account_id) do update set level = 3;
  insert into public.boats (account_id) values (a) on conflict do nothing;
  perform pg_temp.equip(a, 'rod_carbon');
  perform pg_temp.mount(a, 'hook', 'hook_small');
  perform pg_temp.mount(a, 'line', 'line_03');
  update public.fishing_profiles set bait = 'bait_worm' where account_id = a;
  -- a small hook on the river: never a lưỡi lớn species
  for i in 1 .. 150 loop
    perform pg_temp.fresh(a);
    perform pg_temp.put(a, 'wild', 424, 1900);
    update public.player_pos set mode = 'w' where account_id = a;
    c := public.start_river_cast_w(room, t, 'wild', 424, 1900);
    assert c->>'spot' = 'boat', format('a river cast %s', c);
    select s.* into sp from public.casts x join public.fish_species s on s.id = x.species_id where x.id = (c->>'cast_id')::uuid;
    assert not exists (select 1 from public.fish_habits h where h.species_id = sp.id and h.hook is not null and h.hook <> 'small'),
      format('a gated species on the river: %s', sp.id);
    if sp.water = 'deep' then n := n + 1; end if;
  end loop;
  assert n > 0, 'deep fish still bite';
  -- the groundbait on the wild river
  perform public.buy_item(t, 'gb_tanh', 2);
  perform pg_temp.put(a, 'wild', 424, 1900);
  update public.player_pos set mode = 'w' where account_id = a;
  perform public.throw_groundbait(room, t, 'gb_tanh', 'wild', 424, 1900);
  assert public._groundbait_at(a, 'wild', 430, 1900) = 'gb_tanh', 'the river''s groundbait';
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', 424, 1900);
  update public.player_pos set mode = 'w' where account_id = a;
  c := public.start_river_cast_w(room, t, 'wild', 424, 1900);
  assert c->>'groundbait' = 'gb_tanh', format('the river cast feels it %s', c);
  delete from public.casts where account_id = a;
  raise notice 'river ok (% deep of 150)', n;
end $$;

-- ---------- Clean up ----------
delete from public.fishing_groundbait where account_id in (pg_temp.u('a'), pg_temp.u('b'));
delete from public.rooms where id = pg_temp.u('room');
delete from public.accounts where id in (pg_temp.u('a'), pg_temp.u('b'));
update public.app_flags set enabled = (select v::boolean from fv where k = 'flag_rooms') where key = 'room_creation_open';
update public.app_flags set enabled = (select v::boolean from fv where k = 'flag_world') where key = 'unified_world';
update public.map_levels set min_level = (select v::int from fv where k = 'song_cai') where map = 'song_cai';
do $$ begin raise notice 'fishing v3 smoke ok'; end $$;
