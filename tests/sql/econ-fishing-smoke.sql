-- tests/sql/econ-fishing-smoke.sql — 0101 (Kinh tế v2, fishing). Run as the superuser on the throwaway cluster after the
-- full chain (… 0100, 0101), from the repo root, with the reel fixtures' absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/reel-cases.json -f tests/sql/econ-fishing-smoke.sql
-- It re-runs 0101 twice with \i (re-runnable), sets the room_creation_open and unified_world flags and Sông Cái's level
-- (3) for its checks and puts them back. Every check is an ASSERT. Time passing is simulated by moving timestamps back.
--   1. F1 the catalog: the new prices and the cut deep weights; no fish under 2 xu; each rarity dearer than the one below.
--   2. F5 the lift: _cast_lift (none without a source; ≤ 20 % with them all; one rarity up in the cast's water, the weight
--      in place; never from Huyền thoại); the cast triggers no longer lift; start_cast with every source reels each fish
--      at its own difficulty and shows its own rarity.
--   3. F2 / F3 the river: the bump's odds, the wild river's level gate, the boat's price.
--   4. F6 the effort: a cast 0.35 / 0.45 (the perk still cuts it), an overboard 5, the net's numbers.
--   5. F4 treasure: the drops' chances, 3 finds a day (no drop, no dig), the chest's range, honest digs.
--   6. F7 thương lái: sell_fish / sell_fish_market pay through _npc_sale and answer earned / npc_cut / npc; the board's npc.
--   7. H a fishing battle scores only its room's catches.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0101_econ_fishing.sql
\i supabase/migrations/0101_econ_fishing.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log';

create temp table ef (k text primary key, v text);
insert into ef select 'flag_rooms', enabled::text from public.app_flags where key = 'room_creation_open';
insert into ef select 'flag_world', enabled::text from public.app_flags where key = 'unified_world';
insert into ef select 'song_cai', min_level::text from public.map_levels where map = 'song_cai';   -- other smokes open it
update public.map_levels set min_level = 3 where map = 'song_cai';
update public.app_flags set enabled = true where key = 'room_creation_open';
create temp table rf as select pg_read_file(:'fixtures')::jsonb j;
do $$
declare n text; r text;
begin
  foreach n in array array['a', 'b', 'c'] loop
    r := 'ef' || n || '_' || floor(random() * 1e9)::text;
    insert into ef select 't' || n, token from public.register(r, 'pw123456');
    insert into ef select n, public._auth_account((select v from ef where k = 't' || n))::text;
  end loop;
end $$;
insert into ef select 'room', room_id::text from public.create_room('econ fishing', 'pw', (select v from ef where k = 'ta'));
insert into ef select 'room2', room_id::text from public.create_room('econ fishing 2', 'pw', (select v from ef where k = 'tb'));
select public.join_room((select code from public.rooms where id = (select v from ef where k = 'room2')::uuid), 'pw',
                         (select v from ef where k = 'ta'));
select public.join_room((select code from public.rooms where id = (select v from ef where k = 'room')::uuid), 'pw',
                         (select v from ef where k = 'tb'));

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from ef where k = key $$;
create or replace function pg_temp.u(key text) returns uuid language sql stable as $$ select v::uuid from ef where k = key $$;
-- stand somewhere (an accepted claim an hour back)
create or replace function pg_temp.put(p uuid, p_map text, p_x integer, p_y integer) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (p, p_map, p_x, p_y, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb
$$;
-- full vitals and stamina, a bucket of worms, empty hands, no cast
create or replace function pg_temp.fresh(p uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, starve_s = 0, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100, at = now();
  insert into public.inventory (account_id, item_id, qty) values (p, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  delete from public.fish where account_id = p;
  delete from public.casts where account_id = p;
end $$;
-- p_s seconds pass for the account's live rounds (the treasure dig)
create or replace function pg_temp.warp(p uuid, p_s numeric) returns void language plpgsql as $$
#variable_conflict use_variable
declare iv interval := make_interval(secs => p_s);
begin
  update public.mg_live set opened_at = opened_at - iv, started_at = started_at - iv,
         seen = coalesce((select array_agg(x - iv order by o) from unnest(seen) with ordinality u(x, o)), '{}'),
         a_at = coalesce((select array_agg(x - iv order by o) from unnest(a_at) with ordinality u(x, o)), '{}'),
         b_at = coalesce((select array_agg(x - iv order by o) from unnest(b_at) with ordinality u(x, o)), '{}')
   where account_id = p;
  update public.treasure_digs set started_at = started_at - iv where account_id = p;
end $$;
create or replace function pg_temp.ev(r jsonb, i integer) returns jsonb language sql immutable as $$
  select e->'d' from jsonb_array_elements(r->'ev') e where (e->>'i')::int = i
$$;
create or replace function pg_temp.nev(r jsonb) returns integer language sql immutable as $$ select jsonb_array_length(r->'ev') $$;
-- the honest shovel on a map (0087's live veins, as tests/sql/v22-fixes-smoke.sql digs): returns treasure_dig_finish's answer
create or replace function pg_temp.dig(a uuid, t text, room uuid, mid uuid) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare sp public.treasure_spots; j jsonb; r jsonb; e integer; per integer; strikes integer[] := '{}'; hits integer := 0;
        c integer; s integer; need integer := 3;
begin
  select s2.* into sp from public.treasure_spots s2 join public.treasure_maps m on m.spot = s2.id where m.id = mid;
  update public.treasure_maps set last_dig_at = null where id = mid;
  perform pg_temp.put(a, sp.map, sp.x, sp.y);
  perform pg_temp.fresh(a);
  j := public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
  assert j->>'result' = 'dig', format('dig start %s', j);
  per := (j->'dig'->>'period')::int;
  r := public.mg_sync(t, 'dig');
  s := null;
  loop
    perform pg_temp.warp(a, 0.1);
    r := public.mg_sync(t, 'dig', strikes, null);
    e := (r->>'t')::int;
    if s is null and pg_temp.ev(r, hits + 1) is not null then
      c := (pg_temp.ev(r, hits + 1)->>'c')::int;
      s := e + 8;
      while abs(public._mine_pos(per, s) - c) > 60
            or (cardinality(strikes) >= 4 and s - strikes[cardinality(strikes) - 3] < 60) loop s := s + 1; end loop;
    end if;
    if s is not null and s <= e then
      strikes := strikes || s; hits := hits + 1; s := null;
    end if;
    exit when hits = need;
  end loop;
  perform pg_temp.warp(a, 0.1);
  return public.treasure_dig_finish(room, t, strikes, strikes[need] + 1, true);
end $$;
-- the wooden rod's mean fish of a species (k = 2), ×1.00
create or replace function pg_temp.mean2(s public.fish_species) returns numeric language sql immutable as $$
  select s.price_per_kg * (s.min_g + (s.max_g - s.min_g + 1) / 3.0 - 0.5) / 1000
$$;

-- ---------- 1. F1 the catalog ----------
do $$
declare r integer; lo numeric; hi numeric;
begin
  assert (select count(*) from public.fish_species) = 23, 'the 23 species';
  assert (select jsonb_object_agg(id, price_per_kg) from public.fish_species)
       = '{"ca_ro": 40, "ca_sac": 38, "ca_me_vinh": 30, "ca_loc": 10, "ca_tre": 15, "ca_chep": 9, "ca_tra": 8, "ca_that_lat": 27,
           "tom_cang": 129, "ca_leo": 9, "ca_bong_tuong": 27, "ca_lang": 12, "ca_ngat": 16, "ca_bong_lau": 16, "ca_he_vang": 45,
           "ca_chien": 8, "ca_duoi_song": 6, "ca_dua": 12, "ca_anh_vu": 35, "ca_ho": 21, "ca_tra_dau": 28, "rua_mai_vang": 49,
           "ca_vo_dem": 36}'::jsonb, 'the new prices';
  assert (select (min_g, max_g) = (12000, 45000) from public.fish_species where id = 'ca_tra_dau'), 'cá tra dầu 12–45 kg';
  assert (select (min_g, max_g) = (10000, 35000) from public.fish_species where id = 'ca_vo_dem'), 'cá vồ đém 10–35 kg';
  assert (select (min_g, max_g) = (10000, 40000) from public.fish_species where id = 'ca_ho'), 'the other weights stay';
  -- no fish under 2 xu: the lightest at the lowest season factor (×0.80), fish_mult 1
  assert not exists (select 1 from public.fish_species where round(price_per_kg * min_g / 1000.0 * 0.80) < 2), 'a fish under 2 xu';
  -- rarer is dearer: each rarity's cheapest mean fish (the wooden rod) above the dearest of the rarity below
  for r in 2 .. 5 loop
    select min(pg_temp.mean2(s)) into lo from public.fish_species s where rarity = r;
    select max(pg_temp.mean2(s)) into hi from public.fish_species s where rarity = r - 1;
    assert lo > hi, format('rarity %s: %s ≤ %s', r, lo, hi);
  end loop;
  -- the deep water is dearer than the pond at the same rarity
  for r in 3 .. 5 loop
    assert (select avg(pg_temp.mean2(s)) from public.fish_species s where rarity = r and water = 'deep')
         > (select avg(pg_temp.mean2(s)) from public.fish_species s where rarity = r and water = 'pond'), format('deep %s', r);
  end loop;
  raise notice 'catalog ok';
end $$;

-- ---------- 2. F5 the lift ----------
do $$
declare a uuid := pg_temp.u('a'); l record; sp public.fish_species; up integer := 0; i integer; n integer := 4000;
        cid uuid;
begin
  delete from public.player_buffs where account_id = a;
  delete from public.item_upgrades where account_id = a;
  delete from public.player_skills where account_id = a;
  -- no source: never
  for i in 1 .. 300 loop
    select * into l from public._cast_lift(a, 'rod_master', 'ca_ro', 175, false);
    assert l.o_species = 'ca_ro' and l.o_weight = 175, format('no source, no lift %s', l);
  end loop;
  -- every source at once (luck 2 = 40 %, rod +5 = 15 %, perk 10 %, meal 15 %): one lift at most 20 % of the time
  insert into public.player_buffs (account_id, kind, power, until) values (a, 'luck', 2, now() + interval '1 hour'),
                                                                        (a, 'rare_fish', 15, now() + interval '1 hour')
  on conflict (account_id, kind) do update set power = excluded.power, until = excluded.until;
  insert into public.item_upgrades (account_id, item_id, level) values (a, 'rod_master', 5)
  on conflict (account_id, item_id) do update set level = 5;
  insert into public.player_profession_main (account_id, prof) values (a, 'ngu_dan')
  on conflict (account_id) do update set prof = excluded.prof;
  insert into public.player_skills (account_id, node) select a, id from public.skill_nodes where perk = 'rare_fish_pct'
  on conflict do nothing;
  assert public._perk(a, 'rare_fish_pct') = 10 and public._buff(a, 'rare_fish') = 15 and public._buff_power(a, 'luck') = 2, 'sources';
  for i in 1 .. n loop
    select * into l from public._cast_lift(a, 'rod_master', 'ca_ro', 175, false);
    if l.o_species <> 'ca_ro' then
      up := up + 1;
      select * into sp from public.fish_species where id = l.o_species;
      assert sp.rarity = 2 and sp.water = 'pond', format('one rarity up, in the pond: %s', sp.id);
      assert l.o_weight = sp.min_g + round(0.5 * (sp.max_g - sp.min_g)), format('the weight in place %s %s', sp.id, l.o_weight);
    end if;
  end loop;
  assert up between n * 0.17 and n * 0.23, format('the lift rate %s / %s', up, n);
  -- from the river's Khá the lift goes into the deep water; a pond cast stays in the pond; Huyền thoại never lifts
  up := 0;
  for i in 1 .. 400 loop
    select * into l from public._cast_lift(a, 'rod_master', 'ca_loc', 1400, true);
    if l.o_species <> 'ca_loc' then
      up := up + 1;
      assert (select rarity = 3 and water = 'deep' from public.fish_species where id = l.o_species), format('river lift %s', l);
    end if;
    select * into l from public._cast_lift(a, 'rod_master', 'ca_loc', 1400, false);
    assert l.o_species = 'ca_loc' or (select rarity = 3 and water = 'pond' from public.fish_species where id = l.o_species),
      format('pond lift %s', l);
    select * into l from public._cast_lift(a, 'rod_master', 'ca_ho', 20000, false);
    assert l.o_species = 'ca_ho' and l.o_weight = 20000, 'Huyền thoại stays';
  end loop;
  assert up > 0, 'the river lifts too';
  assert not has_function_privilege('anon', 'public._cast_lift(uuid, text, text, integer, boolean)', 'execute'), 'private';
  -- the cast triggers no longer lift: a cast row keeps its fish, whatever the buffs
  for i in 1 .. 200 loop
    insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, rod)
    values (a, pg_temp.u('room'), 'ca_ro', 175, 2600, now(), now() + interval '1 minute', 'rod_master') returning id into cid;
    assert (select species_id = 'ca_ro' and weight_g = 175 from public.casts where id = cid), 'no trigger lift';
    delete from public.casts where id = cid;
    insert into public.player_stamina (account_id, value) values (a, 100) on conflict (account_id) do update set value = 100, at = now();
  end loop;
  raise notice 'lift ok';
end $$;

-- start_cast with every source: each fish is reeled at its own difficulty, and the lamp shows its own rarity
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); c jsonb; x public.casts;
        sp public.fish_species; i integer; nr integer[] := array[0, 0, 0, 0, 0];
begin
  insert into public.inventory (account_id, item_id, qty, durability) values (a, 'rod_master', 1, 600), (a, 'bobber_lamp', 1, null)
  on conflict (account_id, item_id) do update set qty = 1, durability = excluded.durability;
  insert into public.fishing_profiles (account_id) values (a) on conflict do nothing;
  update public.fishing_profiles set rod = 'rod_master', bobber = 'bobber_lamp', bait = 'bait_worm' where account_id = a;
  for i in 1 .. 150 loop
    perform pg_temp.fresh(a);
    perform pg_temp.put(a, 'pond', 300, 204);
    c := public.start_cast(room, t, 37, 25);
    assert c ? 'cast_id', format('a cast %s', c);
    select * into x from public.casts where id = (c->>'cast_id')::uuid;
    select * into sp from public.fish_species where id = x.species_id;
    assert sp.water = 'pond', format('a pond cast lands a pond fish %s', sp.id);
    assert x.min_reel_ms = 2000 + 40 * sp.difficulty and (x.reel_params->>'difficulty')::int = sp.difficulty
           and (x.reel_params->>'min_reel_ms')::int = x.min_reel_ms, format('the reel is the fish''s own %s %s', sp.id, x.reel_params);
    assert (c->>'difficulty')::int = sp.difficulty and (c->>'min_reel_ms')::int = x.min_reel_ms, format('the answer %s', c);
    assert (c->>'rarity')::int = sp.rarity, format('the lamp shows the fish''s rarity %s %s', c->>'rarity', sp.rarity);
    assert x.big = (sp.rarity >= 3 or x.weight_g > 10000), 'big';
    nr[sp.rarity] := nr[sp.rarity] + 1;
  end loop;
  -- master × worms: Thường 55 % before the lift, ≈ 44 % after it
  assert nr[1] between 45 and 90, format('the mix %s', nr);
  delete from public.casts where account_id = a;
  delete from public.player_buffs where account_id = a;
  delete from public.item_upgrades where account_id = a;
  delete from public.player_skills where account_id = a;
  raise notice 'start_cast lift ok %', nr;
end $$;

-- ---------- 3. F2 / F3 the river and the boat ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); c jsonb; sp public.fish_species;
        i integer; hi integer := 0; n integer := 400; v_before integer;
begin
  assert (public._boat_geo()->>'price')::int = 25000, 'the boat costs 25 000';
  assert (select prosrc like '%(case when v_shoal then 0.10 else 0.05 end) then v_rarity := 3;%'
            from pg_proc where proname = 'start_river_cast'),
    'Sông Cái''s bump';
  assert (select prosrc like '%(case when v_shoal then 0.10 else 0.05 end) then v_rarity := 3;%'
            from pg_proc where proname = 'start_river_cast_w'),
    'the wild river''s bump';
  -- buy the ghe at the pier
  delete from public.boats where account_id = a;
  insert into public.wallets (account_id) values (a) on conflict do nothing;
  update public.wallets set coins = 30000 where account_id = a;
  perform pg_temp.put(a, 'pond', 378, 206);
  perform public.buy_boat(room, t);
  assert (select coins from public.wallets where account_id = a) = 5000, 'paid 25 000';
  assert (select delta from public.coin_ledger where account_id = a and reason = 'boat' order by id desc limit 1) = -25000, 'boat ledger';
  -- the wild river needs Sông Cái unlocked (level 3)
  update public.app_flags set enabled = true where key = 'unified_world';
  update public.fishing_profiles set rod = 'rod_wood', bobber = 'bobber_feather', bait = 'bait_worm' where account_id = a;
  insert into public.player_progress (account_id, level) values (a, 2) on conflict (account_id) do update set level = 2;
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'wild', 424, 1900);
  update public.player_pos set mode = 'w' where account_id = a;
  begin
    perform public.start_river_cast_w(room, t, 'wild', 424, 1900);
    assert false, 'level 2 cast';
  exception when sqlstate '22023' then assert sqlerrm = 'map locked', sqlerrm;
  end;
  update public.player_progress set level = 3 where account_id = a;
  -- the odds: the wooden rod and worms roll Hiếm+ 12 % (night 13.5 %), and the river adds 5 % of the rest (was 20 %)
  for i in 1 .. n loop
    perform pg_temp.fresh(a);
    perform pg_temp.put(a, 'wild', 424, 1900);
    update public.player_pos set mode = 'w' where account_id = a;
    c := public.start_river_cast_w(room, t, 'wild', 424, 1900);
    assert c->>'spot' = 'boat', format('a river cast %s', c);
    select s.* into sp from public.casts x join public.fish_species s on s.id = x.species_id where x.id = (c->>'cast_id')::uuid;
    assert (sp.rarity >= 3) = (sp.water = 'deep'), format('the water %s', sp.id);
    if sp.rarity >= 3 then hi := hi + 1; end if;
  end loop;
  assert hi between n * 0.08 and n * 0.24, format('Hiếm+ on the river %s / %s', hi, n);
  delete from public.casts where account_id = a;
  update public.app_flags set enabled = (select v::boolean from ef where k = 'flag_world') where key = 'unified_world';
  raise notice 'river ok: % / % Hiếm+', hi, n;
end $$;

-- ---------- 4. F6 the effort ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); c jsonb; v public.vitals;
        cid uuid; r jsonb;
begin
  update public.fishing_profiles set rod = 'rod_wood', bobber = 'bobber_feather', bait = 'bait_worm' where account_id = a;
  delete from public.player_skills where account_id = a;
  perform pg_temp.fresh(a);
  perform pg_temp.put(a, 'pond', 300, 204);
  c := public.start_cast(room, t, 37, 25);
  select * into v from public.vitals where account_id = a;
  assert v.hunger between 99.64 and 99.66 and v.thirst between 99.54 and 99.56, format('a cast 0.35 / 0.45: %s / %s', v.hunger, v.thirst);
  -- the perk fish_effort_pct (15 %) still cuts it
  insert into public.player_profession_main (account_id, prof) values (a, 'ngu_dan') on conflict (account_id) do update set prof = 'ngu_dan';
  insert into public.player_skills (account_id, node) select a, id from public.skill_nodes where perk = 'fish_effort_pct' on conflict do nothing;
  perform pg_temp.fresh(a);
  c := public.start_cast(room, t, 37, 25);
  select * into v from public.vitals where account_id = a;
  assert v.hunger between 99.70 and 99.71 and v.thirst between 99.61 and 99.62, format('the perk: %s / %s', v.hunger, v.thirst);
  delete from public.player_skills where account_id = a;
  -- a fall overboard costs 5 hunger (the rod and the net)
  assert (public._overboard_outcome('rod_carbon', 0.5)->>'hunger')::int = 5, 'the rod''s overboard';
  assert (select prosrc like '%set hunger = greatest(0, hunger - 5) where account_id = v_account returning * into v_vit;%'
                 and prosrc like '%''rod_lost'', false, ''hunger'', 5),%'
            from pg_proc where proname = 'finish_net' and pronargs = 5), 'the net''s overboard';
  assert (select prosrc like '%_fishing_effort(v_account, 0.6, 0.7)%' from pg_proc where proname = 'net_haul' and pronargs = 7), 'the haul';
  perform pg_temp.fresh(a);
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, spot, bites, big, rod,
                            reel_seed, reel_params, hooked_at)
  values (a, room, 'ca_tra', 3000, 4080, now() - interval '5 seconds', now() + interval '60 seconds', 'dock', true, true, 'rod_wood',
          7, '{"zone_pct": 25, "difficulty": 52, "min_reel_ms": 4080}', now() - interval '4 seconds') returning id into cid;
  r := public.finish_cast(t, cid, false);
  assert r->>'why' = 'overboard' and (r->'overboard'->>'hunger')::int = 5, format('overboard %s', r);
  assert (select hunger from public.vitals where account_id = a) between 94.99 and 95.01, 'overboard: 5 hunger';
  raise notice 'effort ok';
end $$;

-- ---------- 5. F4 treasure ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); i integer; l integer;
        mid uuid; r jsonb; sp public.treasure_spots; big integer := 0;
begin
  assert (select prosrc like '%case when v_boat then 0.02 else 0.01 end%' from pg_proc where proname = '_fx_on_fish'), 'catch drops 1 / 2 %';
  assert (select prosrc like '%_treasure_drop(new.account_id, ''dig'', 0.005)%' from pg_proc where proname = '_fx_on_dig'), 'dig drop 0.5 %';
  delete from public.treasure_maps where account_id = a;
  -- a drop: at most 3 unfound, and none once 3 were found today
  perform public._treasure_drop(a, 'fishing', 1.0);
  assert (select count(*) from public.treasure_maps where account_id = a) = 1, 'a drop';
  update public.treasure_maps set found_at = now() - interval '1 minute', loot = 500 where account_id = a;
  insert into public.treasure_maps (account_id, spot, source, found_at, loot)
    select a, 1, 'fishing', now() - interval '1 minute', 500 from generate_series(1, 2);
  perform public._treasure_drop(a, 'fishing', 1.0);
  assert (select count(*) from public.treasure_maps where account_id = a and found_at is null) = 0, 'no drop after 3 finds today';
  update public.treasure_maps set found_at = public._vn_day_start() - interval '1 minute' where account_id = a;
  perform public._treasure_drop(a, 'fishing', 1.0);
  perform public._treasure_drop(a, 'boat', 1.0);
  assert (select count(*) from public.treasure_maps where account_id = a and found_at is null) = 2, 'yesterday''s finds do not count';
  -- the chest: 150–800, or a 3 000 jackpot (rolled at the first dig of a map)
  delete from public.treasure_maps where account_id = a;
  select * into sp from public.treasure_spots where id = 1;
  insert into public.treasure_maps (account_id, spot, source) values (a, 1, 'fishing') returning id into mid;
  for i in 1 .. 300 loop
    update public.treasure_maps set dig_loot = null, last_dig_at = null where id = mid;
    perform pg_temp.put(a, sp.map, sp.x, sp.y);
    perform pg_temp.fresh(a);
    r := public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
    assert r->>'result' = 'dig', format('dig %s', r);
    l := (select dig_loot from public.treasure_maps where id = mid);
    assert l between 150 and 800 or l = 3000, format('a chest of %s', l);
    if l > 700 then big := big + 1; end if;
  end loop;
  assert big > 0, 'the whole range';
  delete from public.treasure_digs where account_id = a;
  -- a chest rolled before 0101 re-rolls (the migration's update), an 8 000 jackpot becomes 3 000
  update public.treasure_maps set dig_loot = 2400 where id = mid;
  insert into public.treasure_maps (account_id, spot, source, dig_loot) values (a, 2, 'fishing', 8000);
  update public.treasure_maps set dig_loot = case when dig_loot = 8000 then 3000 end
   where found_at is null and dig_loot is not null and dig_loot > 800 and dig_loot <> 3000;
  assert (select dig_loot from public.treasure_maps where id = mid) is null, 'an old chest re-rolls';
  assert (select dig_loot from public.treasure_maps where account_id = a and spot = 2) = 3000, 'an old jackpot stays one';
  -- honest digs: a clean dig ×1.1 up to 800; the jackpot; a chest rolled at 8 000 in flight pays 3 000
  update public.treasure_maps set dig_loot = 780 where id = mid;
  r := pg_temp.dig(a, t, room, mid);
  assert r->>'result' = 'found' and (r->>'loot')::int = 800 and (r->>'clean')::boolean and not (r->>'jackpot')::boolean,
    format('780 → 800 %s', r);
  select id into mid from public.treasure_maps where account_id = a and spot = 2;
  r := pg_temp.dig(a, t, room, mid);
  assert r->>'result' = 'found' and (r->>'loot')::int = 3000 and (r->>'jackpot')::boolean, format('the jackpot %s', r);
  insert into public.treasure_maps (account_id, spot, source, dig_loot) values (a, 3, 'fishing', 500) returning id into mid;
  r := pg_temp.dig(a, t, room, mid);
  assert r->>'result' = 'found' and (r->>'loot')::int = 550, format('500 → 550 %s', r);
  -- three found today: the fourth map waits for tomorrow
  insert into public.treasure_maps (account_id, spot, source, dig_loot) values (a, 4, 'fishing', 500) returning id into mid;
  select * into sp from public.treasure_spots where id = 4;
  perform pg_temp.put(a, sp.map, sp.x, sp.y);
  perform pg_temp.fresh(a);
  begin
    perform public.treasure_dig_start(room, t, mid, sp.map, sp.x, sp.y);
    assert false, 'a fourth dig today';
  exception when sqlstate '53400' then assert sqlerrm = 'treasure day cap', sqlerrm;
  end;
  assert exists (select 1 from public.treasure_maps where id = mid and found_at is null), 'the map waits';
  update public.treasure_maps set found_at = found_at - interval '1 day' where account_id = a and found_at is not null;
  r := pg_temp.dig(a, t, room, mid);
  assert r->>'result' = 'found' and (r->>'loot')::int = 550, format('the next day %s', r);
  delete from public.treasure_maps where account_id = a;
  raise notice 'treasure ok';
end $$;

-- ---------- 6. F7 thương lái ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room'); r jsonb; v_before integer;
        ids uuid[]; v_last bigint;
begin
  delete from public.econ_npc_days where account_id = a;
  delete from public.fish where account_id = a;
  insert into public.inventory (account_id, item_id, qty) values (a, 'bucket_large', 1) on conflict (account_id, item_id) do update set qty = 1;
  -- 3 fish at 10 000 (an old catch): 20 000 at full price, 10 000 at half
  insert into public.fish (account_id, species_id, weight_g, price) select a, 'ca_ho', 30000, 10000 from generate_series(1, 3);
  select array_agg(id) into ids from public.fish where account_id = a;
  v_before := (select coins from public.wallets where account_id = a);
  v_last := coalesce((select max(id) from public.coin_ledger where account_id = a), 0);
  r := public.sell_fish(t, ids);
  assert (r->>'sold')::int = 3 and (r->>'earned')::int = 25000 and (r->>'npc_cut')::int = 5000, format('sell %s', r);
  assert (r->'npc'->>'gross')::int = 30000 and (r->'npc'->>'full')::int = 20000, format('npc %s', r->'npc');
  assert (select delta from public.coin_ledger where account_id = a and id > v_last and reason = 'sell' and ref = '3 con') = 25000,
    'the sale pays 25 000';
  -- (anything else in the wallet is the sale's side effects: a level reward, a perk)
  assert (select coins from public.wallets where account_id = a)
       = v_before + (select sum(delta) from public.coin_ledger where account_id = a and id > v_last), 'the wallet follows the ledger';
  assert not exists (select 1 from public.coin_ledger where account_id = a and id > v_last and reason = 'sell' and ref <> '3 con'
                        and ref not like 'perk:%'), 'one sale row';
  -- Chợ Lớn: the gross is ×1.10, then the thương lái (50 % now: 30 000 → 40 000)
  insert into public.fish (account_id, species_id, weight_g, price) values (a, 'ca_ho', 30000, 1000);
  select array_agg(id) into ids from public.fish where account_id = a;
  perform pg_temp.put(a, 'market', 80, 360);
  r := public.sell_fish_market(t, ids);
  assert (r->>'earned')::int = 550 and (r->>'npc_cut')::int = 550 and (r->'npc'->>'gross')::int = 31100, format('market %s', r);
  -- the board carries the day's line
  r := public.fishing_board(room, t);
  assert (r->'npc'->>'gross')::int = 31100 and r ? 'prices', format('board %s', r->'npc');
  delete from public.econ_npc_days where account_id = a;
  raise notice 'thương lái ok';
end $$;

-- ---------- 7. H a fishing battle scores only its room's catches ----------
do $$
declare a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); t text := pg_temp.v('ta'); room uuid := pg_temp.u('room');
        room2 uuid := pg_temp.u('room2'); bid uuid; cid uuid; r jsonb; tg integer[]; rm uuid;
        won jsonb := (select x from rf, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'caught' limit 1);
begin
  select array_agg(x::int order by o) into tg from jsonb_array_elements_text(won->'toggles') with ordinality q(x, o);
  insert into public.fishing_battles (room_id, host, fee, duration_s, status, starts_at, ends_at, pot)
  values (room, a, 100, 180, 'live', now() - interval '10 seconds', now() + interval '170 seconds', 200) returning id into bid;
  insert into public.fishing_battle_players (battle_id, account_id) values (bid, a), (bid, b);
  foreach rm in array array[room2, room] loop
    delete from public.fish where account_id = a;
    delete from public.casts where account_id = a;
    insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, reel_seed, reel_params, hooked_at)
    values (a, rm, 'ca_ro', 200, (won->'params'->>'minReelMs')::int, now() - interval '61 seconds', now() + interval '30 seconds',
            (won->'params'->>'seed')::bigint,
            jsonb_build_object('zone_pct', won->'params'->'zonePct', 'difficulty', won->'params'->'difficulty',
                               'min_reel_ms', won->'params'->'minReelMs'), now() - interval '60 seconds')
    returning id into cid;
    r := public.finish_cast(t, cid, true, false, coalesce(tg, '{}'), (won->'expected'->>'ticks')::int);
    assert r->>'result' = 'caught', format('an honest catch %s', r);
    if rm = room2 then
      assert (select score from public.fishing_battle_players where battle_id = bid and account_id = a) = 0, 'another room: no score';
    else
      assert (select score from public.fishing_battle_players where battle_id = bid and account_id = a) = (r->'fish'->>'price')::int,
        'the battle''s room: scored';
    end if;
    assert coalesce(current_setting('mt.catch_room', true), '') = '', 'the room flag is cleared';
  end loop;
  delete from public.fishing_battles where id = bid;
  delete from public.fish where account_id = a;
  raise notice 'battle room ok';
end $$;

update public.app_flags set enabled = (select v::boolean from ef where k = 'flag_rooms') where key = 'room_creation_open';
update public.app_flags set enabled = (select v::boolean from ef where k = 'flag_world') where key = 'unified_world';
update public.map_levels set min_level = (select v::int from ef where k = 'song_cai') where map = 'song_cai';
do $$ begin raise notice 'econ fishing smoke ok'; end $$;
