-- tests/sql/rod-builds-smoke.sql — 0115 (rods built one by one). Run as the superuser on the throwaway cluster after the
-- full chain (… 0114, 0115), from the repo root, with the reel fixtures' absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/reel-cases.json -f tests/sql/rod-builds-smoke.sql
-- It re-runs 0115 twice with \i (re-runnable, and the second run migrates the legacy profile made in 8). The race (11)
-- needs the dblink extension (contrib); it is created here and dropped at the end. Its accounts are deleted at the end.
--   1. Buying two of one rod → two bare instances (never equipped); parts stack in the bag; the kit is there.
--   2. Mounting binds: the unit leaves the bag, cannot go onto another rod; the kit's built-in slots are fixed.
--   3. Replacing destroys the old part; unmounting destroys it.
--   4. Equip: mine only, not broken; a bare rod is refused at the cast ('rod needs parts'), nothing spent.
--   5. A line snap wears the cast's instance's line (not the equipped one's when switched mid-cast).
--   6. Repair per instance (30 % of the price, ledger 'repair'); repair_rod(item) picks the worn one.
--   7. Rename, scrap.
--   8. The migration of a legacy profile (rods in the inventory, the profile's hook / line / reel / bobber).
--   9. A mailed rod becomes an instance on claim.
--  10. Someone else's rod is never mine.
--  11. Two parallel mounts of the last unit: one wins.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0115_rod_builds.sql
\i supabase/migrations/0115_rod_builds.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log';

create temp table rb (k text primary key, v text);
insert into rb select 'flag_rooms', enabled::text from public.app_flags where key = 'room_creation_open';
update public.app_flags set enabled = true where key = 'room_creation_open';
create temp table rf as select pg_read_file(:'fixtures')::jsonb j;
do $$
declare n text; r text;
begin
  foreach n in array array['a', 'b', 'l'] loop
    r := 'rb' || n || '_' || floor(random() * 1e9)::text;
    insert into rb select 't' || n, token from public.register(r, 'pw123456');
    insert into rb select n, public._auth_account((select v from rb where k = 't' || n))::text;
  end loop;
end $$;
insert into rb select 'room', room_id::text from public.create_room('rod builds', 'pw', (select v from rb where k = 'ta'));

create or replace function pg_temp.v(key text) returns text language sql stable as $$ select v from rb where k = key $$;
create or replace function pg_temp.u(key text) returns uuid language sql stable as $$ select v::uuid from rb where k = key $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlerrm;
end $$;
create or replace function pg_temp.qty(p uuid, p_item text) returns integer language sql stable as $$
  select coalesce((select qty from public.inventory where account_id = p and item_id = p_item), 0) $$;
create or replace function pg_temp.part(p_rod bigint, p_slot text) returns text language sql stable as $$
  select item_id from public.rod_parts where rod_id = p_rod and slot = p_slot $$;
create or replace function pg_temp.fresh(p uuid) returns void language plpgsql as $$
begin
  insert into public.vitals (account_id) values (p) on conflict (account_id) do update set hunger = 100, thirst = 100,
    fainted_until = null, starve_s = 0, last_tick = now();
  insert into public.player_stamina (account_id, value) values (p, 100) on conflict (account_id) do update set value = 100, at = now();
  insert into public.inventory (account_id, item_id, qty) values (p, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  delete from public.fish where account_id = p;
  delete from public.casts where account_id = p;
  insert into public.player_pos (account_id, map, x, y, at) values (p, 'pond', 300, 204, now() - interval '1 hour')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at, bad_count = 0,
                                         tab = null, tabs = '{}'::jsonb;
end $$;
-- a won reel of the fixtures with the given fish and line limit, on rod instance p_rod; finish_cast's answer
create or replace function pg_temp.land(a uuid, t text, p_rod bigint, w integer, p_line text, line_g integer) returns jsonb
language plpgsql as $$
declare won jsonb := (select x from rf, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'caught' limit 1);
        tg integer[]; cid uuid;
begin
  select array_agg(x::int order by o) into tg from jsonb_array_elements_text(won->'toggles') with ordinality q(x, o);
  delete from public.casts where account_id = a;
  delete from public.anticheat_events where account_id = a and code like 'reel_timing%';
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, reel_seed, reel_params,
                            hooked_at, rod, rod_id, line, line_g, rod_g)
  values (a, pg_temp.u('room'), 'ca_chep', w, (won->'params'->>'minReelMs')::int, now() - interval '61 seconds',
          now() + interval '30 seconds', (won->'params'->>'seed')::bigint,
          jsonb_build_object('zone_pct', won->'params'->'zonePct', 'difficulty', won->'params'->'difficulty',
                             'min_reel_ms', won->'params'->'minReelMs'), now() - interval '60 seconds',
          (select item_id from public.rods where id = p_rod), p_rod, p_line, line_g, 60000)
  returning id into cid;
  return public.finish_cast(t, cid, true, false, coalesce(tg, '{}'), (won->'expected'->>'ticks')::int);
end $$;

-- ---------- 1. Buying ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); r jsonb; v_kit bigint; ids bigint[];
begin
  perform public._fishing_profile(a);
  insert into public.wallets (account_id) values (a) on conflict do nothing;
  update public.wallets set coins = 100000 where account_id = a;
  v_kit := (select rod_id from public.fishing_profiles where account_id = a);
  assert (select item_id from public.rods where id = v_kit) = 'rod_wood', 'a new profile has its kit equipped';
  assert pg_temp.part(v_kit, 'bobber') = 'bobber_feather', 'the kit''s free phao';
  perform public.buy_item(t, 'rod_bamboo');
  perform public.buy_item(t, 'rod_bamboo');
  select array_agg(id order by id) into ids from public.rods where account_id = a and item_id = 'rod_bamboo';
  assert cardinality(ids) = 2, 'two instances of one model';
  assert (select durability from public.rods where id = ids[1]) = 120, 'full durability';
  assert (select rod_id from public.fishing_profiles where account_id = a) = v_kit, 'a bought rod is not equipped';
  assert not exists (select 1 from public.inventory where account_id = a and item_id = 'rod_bamboo'), 'rods are not inventory';
  perform public.buy_item(t, 'hook_small');
  perform public.buy_item(t, 'hook_small');
  perform public.buy_item(t, 'line_02');
  perform public.buy_item(t, 'line_02');
  assert pg_temp.qty(a, 'hook_small') = 2 and pg_temp.qty(a, 'line_02') = 2, 'parts stack';
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'buy') = 6, 'every buy via _pay';
  r := public.rod_list(t);
  assert jsonb_array_length(r->'rods') = 3 and (r->'rods'->0->>'kit')::boolean and (r->'rods'->0->>'equipped')::boolean,
    format('the bag %s', r);
  assert r->'rods'->1->'rig'->'missing' = '["hook", "line"]'::jsonb, 'bare';
  insert into rb values ('ra', ids[1]::text), ('rb', ids[2]::text), ('kit', v_kit::text);
  raise notice 'buy ok';
end $$;

-- ---------- 2. Binding ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); ra bigint := pg_temp.v('ra')::bigint;
        rb_ bigint := pg_temp.v('rb')::bigint; kit bigint := pg_temp.v('kit')::bigint; r jsonb;
begin
  r := public.rod_mount(t, ra, 'hook', 'hook_small');
  assert r->'destroyed' = 'null'::jsonb and pg_temp.part(ra, 'hook') = 'hook_small' and pg_temp.qty(a, 'hook_small') = 1, 'mounted';
  perform public.rod_mount(t, rb_, 'hook', 'hook_small');
  assert pg_temp.qty(a, 'hook_small') = 0 and not exists (select 1 from public.inventory where account_id = a and item_id = 'hook_small'),
    'the bag is empty';
  -- the unit on A cannot go to B: there is no way back to the bag, and the bag is empty
  delete from public.rod_parts where rod_id = rb_ and slot = 'hook';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, rb_, 'hook', 'hook_small')) = 'item not available',
    'bound to A';
  assert pg_temp.part(ra, 'hook') = 'hook_small', 'still on A';
  -- the kit: hook / line / reel fixed, the phao free
  perform public.buy_item(t, 'reel_1000');
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, kit, 'hook', 'hook_small')) = 'rod fixed', 'kit hook';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, kit, 'reel', 'reel_1000')) = 'rod fixed', 'kit reel';
  assert pg_temp.err(format('select public.rod_unmount(%L, %s, %L)', t, kit, 'line')) = 'rod fixed', 'kit line';
  assert pg_temp.qty(a, 'reel_1000') = 1, 'nothing taken';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, ra, 'hat', 'hook_small')) = 'bad slot', 'slot';
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', t, ra, 'line', 'hook_small')) = 'item not available', 'kind';
  -- a line keeps its snaps on the rod
  perform public.rod_mount(t, ra, 'line', 'line_02');
  assert (select durability from public.rod_parts where rod_id = ra and slot = 'line') = 3, 'a fresh line';
  raise notice 'bind ok';
end $$;

-- ---------- 3. Replace / unmount destroy ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); ra bigint := pg_temp.v('ra')::bigint; r jsonb;
begin
  perform public.buy_item(t, 'hook_large');
  r := public.rod_mount(t, ra, 'hook', 'hook_large');
  assert r->>'destroyed' = 'hook_small' and pg_temp.part(ra, 'hook') = 'hook_large' and pg_temp.qty(a, 'hook_small') = 0,
    format('the old hook destroyed %s', r->'destroyed');
  perform public.rod_mount(t, ra, 'reel', 'reel_1000');
  r := public.rod_unmount(t, ra, 'reel');
  assert r->>'destroyed' = 'reel_1000' and pg_temp.part(ra, 'reel') is null and pg_temp.qty(a, 'reel_1000') = 0, 'unmount destroys';
  assert pg_temp.err(format('select public.rod_unmount(%L, %s, %L)', t, ra, 'reel')) = 'slot empty', 'empty';
  raise notice 'destroy ok';
end $$;

-- ---------- 4. Equip and the bare rod ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); ra bigint := pg_temp.v('ra')::bigint;
        rb_ bigint := pg_temp.v('rb')::bigint; room uuid := pg_temp.u('room'); c jsonb; s jsonb;
begin
  perform public.rod_equip(t, rb_);
  assert (select (rod_id, rod) = (rb_, 'rod_bamboo'::text) from public.fishing_profiles where account_id = a), 'equipped (mirror)';
  perform pg_temp.fresh(a);
  assert pg_temp.err(format('select public.start_cast(%L, %L, 37, 25)', room, t)) = 'rod needs parts', 'bare refused';
  assert pg_temp.qty(a, 'bait_worm') = 20 and not exists (select 1 from public.casts where account_id = a), 'nothing spent';
  s := public.rod_equip(t, ra);
  assert s->'state'->'rig'->>'hook' = 'hook_large' and s->'state'->'rig'->>'line' = 'line_02'
     and (s->'state'->>'rod_id')::bigint = ra, format('the rig is the instance''s %s', s->'state'->'rig');
  c := public.start_cast(room, t, 37, 25);
  assert c ? 'cast_id' and (select rod_id from public.casts where id = (c->>'cast_id')::uuid) = ra, 'the cast keeps its instance';
  update public.rods set durability = 0 where id = rb_;
  assert pg_temp.err(format('select public.rod_equip(%L, %s)', t, rb_)) = 'rod broken', 'broken';
  update public.rods set durability = 120 where id = rb_;
  perform public.rod_equip(t, null);
  assert (select rod from public.fishing_profiles where account_id = a) = 'rod_wood', 'null → the kit';
  perform public.rod_equip(t, ra);
  delete from public.casts where account_id = a;
  raise notice 'equip ok';
end $$;

-- ---------- 5. The line snap wears the cast's instance ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); ra bigint := pg_temp.v('ra')::bigint;
        rb_ bigint := pg_temp.v('rb')::bigint; r jsonb;
begin
  perform public.rod_mount(t, rb_, 'line', 'line_02');   -- B gets the other line
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, ra, 5000, 'line_02', 4000);
  assert r->>'why' = 'line_snap', format('snap %s', r);
  assert (select durability from public.rod_parts where rod_id = ra and slot = 'line') = 2, 'A''s line worn';
  assert (select durability from public.rod_parts where rod_id = rb_ and slot = 'line') = 3, 'B''s untouched';
  -- cast with A, B equipped meanwhile: A's line still pays
  perform public.rod_equip(t, rb_);
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, ra, 5000, 'line_02', 4000);
  assert (select durability from public.rod_parts where rod_id = ra and slot = 'line') = 1
     and (select durability from public.rod_parts where rod_id = rb_ and slot = 'line') = 3, 'the cast''s rod pays';
  perform pg_temp.fresh(a);
  r := pg_temp.land(a, t, ra, 5000, 'line_02', 4000);
  assert (r->'snap'->>'line_gone')::boolean and pg_temp.part(ra, 'line') is null, 'gone from A';
  -- the hook attempt wore A, not B
  assert (select durability from public.rods where id = ra) < 120 and (select durability from public.rods where id = rb_) = 120, 'wear';
  perform public.rod_equip(t, ra);
  raise notice 'line snap ok';
end $$;

-- ---------- 6. Repair per instance ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); ra bigint := pg_temp.v('ra')::bigint;
        rb_ bigint := pg_temp.v('rb')::bigint; r jsonb; v_c integer;
begin
  update public.rods set durability = 10 where id = ra;
  update public.rods set durability = 50 where id = rb_;
  v_c := (select coins from public.wallets where account_id = a);
  r := public.rod_repair(t, rb_);
  assert (r->>'cost')::int = 90 and (select durability from public.rods where id = rb_) = 120
     and (select durability from public.rods where id = ra) = 10, format('only B %s', r->'cost');
  assert (select coins from public.wallets where account_id = a) = v_c - 90, 'paid';
  assert (select reason from public.coin_ledger where account_id = a order by id desc limit 1) = 'repair', 'ledger';
  assert pg_temp.err(format('select public.rod_repair(%L, %s)', t, rb_)) = 'not worn', 'full';
  assert pg_temp.err(format('select public.rod_repair(%L, %s)', t, pg_temp.v('kit'))) = 'item not available', 'the kit';
  r := public.repair_rod(t, 'rod_bamboo');                        -- the legacy form: the worn one (A)
  assert (select durability from public.rods where id = ra) = 120, 'repair_rod picks the worn instance';
  raise notice 'repair ok';
end $$;

-- ---------- 7. Rename, scrap ----------
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); ra bigint := pg_temp.v('ra')::bigint;
        rb_ bigint := pg_temp.v('rb')::bigint;
begin
  perform public.rod_rename(t, rb_, '  Cần săn lóc  ');
  assert (select name from public.rods where id = rb_) = 'Cần săn lóc', 'named';
  assert pg_temp.err(format('select public.rod_rename(%L, %s, %L)', t, rb_, repeat('x', 25))) = 'name too long', 'long';
  perform public.rod_rename(t, rb_, '');
  assert (select name from public.rods where id = rb_) is null, 'unnamed';
  assert pg_temp.err(format('select public.rod_scrap(%L, %s)', t, ra)) = 'rod equipped', 'equipped';
  assert pg_temp.err(format('select public.rod_scrap(%L, %s)', t, pg_temp.v('kit'))) = 'rod fixed', 'the kit';
  perform public.rod_scrap(t, rb_);
  assert not exists (select 1 from public.rods where id = rb_) and not exists (select 1 from public.rod_parts where rod_id = rb_),
    'scrapped with its parts';
  raise notice 'rename scrap ok';
end $$;

-- ---------- 10. Not mine ----------
do $$
declare tb text := pg_temp.v('tb'); ra bigint := pg_temp.v('ra')::bigint;
begin
  perform public._fishing_profile(pg_temp.u('b'));
  insert into public.inventory (account_id, item_id, qty) values (pg_temp.u('b'), 'hook_eel', 1);
  assert pg_temp.err(format('select public.rod_mount(%L, %s, %L, %L)', tb, ra, 'hook', 'hook_eel')) = 'rod not found', 'mount';
  assert pg_temp.err(format('select public.rod_unmount(%L, %s, %L)', tb, ra, 'hook')) = 'rod not found', 'unmount';
  assert pg_temp.err(format('select public.rod_equip(%L, %s)', tb, ra)) = 'rod not found', 'equip';
  assert pg_temp.err(format('select public.rod_repair(%L, %s)', tb, ra)) = 'rod not found', 'repair';
  assert pg_temp.err(format('select public.rod_scrap(%L, %s)', tb, ra)) = 'rod not found', 'scrap';
  assert pg_temp.qty(pg_temp.u('b'), 'hook_eel') = 1, 'nothing taken';
  assert not has_table_privilege('anon', 'public.rods', 'select') and not has_table_privilege('anon', 'public.rod_parts', 'select'),
    'the tables are not the client''s';
  assert not has_function_privilege('anon', 'public._rod_add(uuid, text)', 'execute'), 'private';
  raise notice 'ownership ok';
end $$;

-- ---------- 8. A legacy profile ----------
-- l owned a carbon (worn), a bamboo, a hook / a worn line / a reel, and the lamp phao, as 0110 kept them
do $$
declare l uuid := pg_temp.u('l');
begin
  delete from public.fishing_profiles where account_id = l;
  delete from public.rods where account_id = l;
  insert into public.fishing_profiles (account_id, rod, bobber, bait, hook, line, reel)
  values (l, 'rod_carbon', 'bobber_lamp', 'bait_worm', 'hook_large', 'line_braid', 'reel_3000');
  insert into public.inventory (account_id, item_id, qty, durability) values
    (l, 'rod_carbon', 1, 250), (l, 'rod_bamboo', 1, 120), (l, 'hook_large', 1, null), (l, 'line_braid', 1, 2),
    (l, 'reel_3000', 1, null), (l, 'bobber_lamp', 1, null), (l, 'hook_eel', 1, null);
end $$;
set client_min_messages = warning;
\i supabase/migrations/0115_rod_builds.sql
\i supabase/migrations/0115_rod_builds.sql
reset client_min_messages;
do $$
declare l uuid := pg_temp.u('l'); p public.fishing_profiles; v_c bigint;
begin
  select * into p from public.fishing_profiles where account_id = l;
  select id into v_c from public.rods where account_id = l and item_id = 'rod_carbon';
  assert (select count(*) from public.rods where account_id = l) = 3, 'carbon, bamboo and the kit — once, after two runs';
  assert p.rod_id = v_c and p.rod = 'rod_carbon', 'the carbon equipped';
  assert (select durability from public.rods where id = v_c) = 250, 'its wear kept';
  assert pg_temp.part(v_c, 'hook') = 'hook_large' and pg_temp.part(v_c, 'line') = 'line_braid' and pg_temp.part(v_c, 'reel') = 'reel_3000'
     and pg_temp.part(v_c, 'bobber') = 'bobber_lamp', 'the parts on it';
  assert (select durability from public.rod_parts where rod_id = v_c and slot = 'line') = 2, 'the line''s snaps kept';
  assert pg_temp.qty(l, 'hook_large') = 0 and pg_temp.qty(l, 'line_braid') = 0 and pg_temp.qty(l, 'reel_3000') = 0
     and pg_temp.qty(l, 'bobber_lamp') = 0, 'each moved, not copied';
  assert pg_temp.qty(l, 'hook_eel') = 1, 'an unmounted part stays in the bag';
  assert not exists (select 1 from public.inventory i join public.shop_items s on s.id = i.item_id
                      where i.account_id = l and s.kind = 'rod'), 'no rod left in the inventory';
  assert (public._fishing_rig(l)->>'ready')::boolean, 'ready to fish';
  raise notice 'legacy ok';
end $$;

-- ---------- 9. The mailbox ----------
do $$
declare b uuid := pg_temp.u('b'); tb text := pg_temp.v('tb'); v_mail bigint; r jsonb;
begin
  v_mail := public._mail_new(b, 'admin', null, 'admin', 'Quà', '', null, null);
  insert into public.mail_items (mail_id, kind, ref, qty, name, value) values (v_mail, 'item', 'rod_fiber', 2, 'Cần sợi thủy tinh', 0),
    (v_mail, 'item', 'hook_small', 3, 'Lưỡi đơn nhỏ', 0);
  r := public.mail_claim(tb, v_mail);
  assert (select count(*) from public.rods where account_id = b and item_id = 'rod_fiber') = 2, format('two instances %s', r);
  assert not exists (select 1 from public.inventory where account_id = b and item_id = 'rod_fiber'), 'not inventory';
  assert pg_temp.qty(b, 'hook_small') = 3, 'parts stack';
  assert (select array_agg(x order by x) from unnest(public._mail_gift_kinds()) x) @> array['rod', 'hook'], 'giftable';
  raise notice 'mail ok';
end $$;

-- ---------- 11. The race ----------
create extension if not exists dblink;
do $$
declare a uuid := pg_temp.u('a'); t text := pg_temp.v('ta'); r1 bigint; r2 bigint; cs text; n integer; e1 text; e2 text;
begin
  r1 := public._rod_add(a, 'rod_fiber');
  r2 := public._rod_add(a, 'rod_fiber');
  delete from public.inventory where account_id = a and item_id = 'hook_shrimp';
  insert into public.inventory (account_id, item_id, qty) values (a, 'hook_shrimp', 1);
  insert into rb values ('r1', r1::text), ('r2', r2::text);
end $$;
do $$
declare t text := pg_temp.v('ta'); cs text; ok integer := 0;
begin
  cs := format('dbname=%s port=%s host=%s user=%s', current_database(), current_setting('port'),
               split_part(current_setting('unix_socket_directories'), ',', 1), current_user);
  perform dblink_connect('rb1', cs);
  perform dblink_connect('rb2', cs);
  perform dblink_send_query('rb1', format('select public.rod_mount(%L, %s, %L, %L), pg_sleep(0.5)', t, pg_temp.v('r1'), 'hook', 'hook_shrimp'));
  perform pg_sleep(0.1);
  perform dblink_send_query('rb2', format('select public.rod_mount(%L, %s, %L, %L)', t, pg_temp.v('r2'), 'hook', 'hook_shrimp'));
  begin
    perform * from dblink_get_result('rb1') as q(a jsonb, b text);
    ok := ok + 1;
  exception when others then null;
  end;
  begin
    perform * from dblink_get_result('rb2') as q(a jsonb);
    ok := ok + 1;
  exception when others then null;
  end;
  perform dblink_disconnect('rb1');
  perform dblink_disconnect('rb2');
  assert ok = 1, format('%s of 2 parallel mounts won', ok);
end $$;
do $$
declare a uuid := pg_temp.u('a');
begin
  assert (select count(*) from public.rod_parts where rod_id in (pg_temp.v('r1')::bigint, pg_temp.v('r2')::bigint)
            and slot = 'hook' and item_id = 'hook_shrimp') = 1, 'one hook, one rod';
  assert pg_temp.qty(a, 'hook_shrimp') = 0, 'the bag spent once';
  raise notice 'race ok';
end $$;
drop extension dblink;

-- ---------- Clean up ----------
update public.app_flags set enabled = (select v::boolean from rb where k = 'flag_rooms') where key = 'room_creation_open';
delete from public.rooms where id = pg_temp.u('room');
delete from public.accounts where id in (pg_temp.u('a'), pg_temp.u('b'), pg_temp.u('l'));
select 'rod builds smoke: ok' as result;
