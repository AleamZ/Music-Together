-- =========================================================
-- 0097_forest_complete.sql — the forest, finished (owner: "làm hết" — 0096's "not built" list). ADDITIVE and re-runnable.
-- Run after 0096.
--   A. Rừng tràm in 2D: a new 2D map 'rung_tram' (640 × 384) that IS a window of the world's forest — its px + the
--      origin (_forest_origin: 2112, 1600 = cells 33…42 × 25…30 of world_forest, the densest block) are world px.
--      _pos_maps (0088's) gains it; _pos_portals (0072's, so _world_portals too) join it to Bãi đất trống's south gate
--      (455, 368) ↔ (20, 224); map_levels 1. _forest_xy(map, x, y): world px for 'wild' (itself) and 'rung_tram'
--      (+ the origin), null elsewhere — every forest check below goes through it, so a 2D hunter / woodcutter in Rừng
--      tràm and a 3D one in the wild meet the same animals and the same trees.
--      _wild_cap: 'rung_tram' 24 too (world_state fills it); _wild_fill (0096's) turns 'rung_tram' into the wild's fill
--      plus _wild_window_fill (≥ 6 animals homed on core cells inside the window); _wild_json (0078's) answers the
--      window's wild animals in the map's px for 'rung_tram'.
--   B. The design's animals and meats: _wild_species (0075's) gains boar (heo rừng, any hour, danger 10) and pheasant
--      (chim trĩ, day); _wild_items (0075's) their drops and the meats; _wild_meat(species): a successful hunt / trap
--      also bags the animal's meat (thịt chim, chim trĩ, hươu, cáo, heo rừng, sói, gấu; a rabbit's drop already is).
--   C. Cooking as designed: _cook_recipes is dropped and re-made with ten dishes (meat, a common fish, the bought
--      rice / greens / mushrooms / herbs as the fee) and the buff dishes (hunt_stamina −1 a hunt, chop_stamina −1 a
--      chop, hunt_chance +5 / +10 points); player_buffs takes those kinds; cook_eat (0096's) grants the buff for the
--      recipe's minutes × the quality's % (the same buff replaced). wild_start / chop_start / wild_finish read them.
--   D. Tools matter: a hunt needs a bow with durability (−1 a hunt; 'no bow'), a dish a pan (−1 a dish; 'no pan');
--      _prof_tools_catalog (0096's) sells every starter tool; tool_repair at the stall ('repair'): half the tool's price
--      × the worn share (≥ 5 xu), back to full.
--   E. Thợ săn xp only for a Thợ săn: _prof_on_event (0078's) skips the tho_san rules unless it is the main nghề.
--   F. _forest_json (0096's): every meat and the common fish count (the kitchen's ingredients).
-- Felled trees and the chop/cook animations are client-side on 0096's server state (forest_felled via forest_state)
-- and the realtime `fa` codes 13 / 14 (lib/game/net/protocol.ts).
-- Re-created (each the NEWEST, verbatim but for the lines marked 0097): _pos_maps (0088), _pos_portals (0072),
--   _wild_species / _wild_items (0075), _wild_json (0078), _wild_fill / wild_start / wild_finish / chop_start /
--   cook_start / cook_eat / _forest_json / _prof_tools_catalog (0096), _prof_on_event (0078). Dropped and re-made:
--   _cook_recipes (0096's; new columns).
-- Codes: none new. Errors: 'no bow', 'no pan', 'nothing to repair'. Ledger: 'repair' (0069's).
-- =========================================================

-- ---------- A. Rừng tràm, the 2D window of the forest ----------
create or replace function public._forest_origin(out ox integer, out oy integer)
language sql immutable parallel safe
as $$ select 2112, 1600 $$;

create or replace function public._forest_xy(p_map text, p_x double precision, p_y double precision,
                                             out wx double precision, out wy double precision)
language sql immutable parallel safe
as $$
  select case p_map when 'wild' then p_x when 'rung_tram' then p_x + 2112 end,
         case p_map when 'wild' then p_y when 'rung_tram' then p_y + 1600 end
$$;
revoke all on function public._forest_origin() from public, anon, authenticated;
revoke all on function public._forest_xy(text, double precision, double precision) from public, anon, authenticated;

-- _pos_maps (0088_unified_world.sql's, verbatim but for the lines marked 0097)
create or replace function public._pos_maps() returns table (map text, w integer, h integer)
language sql immutable parallel safe
as $$
  values ('hall', 640, 400), ('pond', 640, 400), ('field', 800, 480), ('market', 1280, 400), ('khu_nha', 800, 400),
         ('bai_dat', 800, 400), ('ham_ngam', 480, 320),
         ('mo_da', 640, 400),                                                                            -- 0072
         ('song_cai', 960, 480),                                                                         -- 0086
         ('wild', 4160, 2240),                                                                           -- 0088
         ('rung_tram', 640, 384)                                                                         -- 0097
$$;

-- _pos_portals (0072_mining_crafting.sql's, verbatim but for the lines marked 0097)
create or replace function public._pos_portals() returns table (from_map text, to_map text, ux integer, uy integer,
                                                                ax integer, ay integer, road boolean)
language sql immutable parallel safe
as $$
  values ('hall', 'pond', 516, 334, 300, 356, false), ('hall', 'field', 62, 236, 60, 106, false),
         ('hall', 'market', 604, 200, 72, 252, true),
         ('pond', 'hall', 352, 374, 516, 334, false), ('pond', 'field', 190, 348, 760, 244, false),
         ('field', 'hall', 60, 106, 62, 236, false), ('field', 'pond', 760, 244, 190, 348, false),
         ('market', 'hall', 40, 244, 584, 224, true), ('market', 'khu_nha', 1236, 196, 68, 208, true),
         ('market', 'bai_dat', 1180, 358, 400, 48, false), ('market', 'ham_ngam', 640, 352, 48, 84, false),
         ('khu_nha', 'market', 40, 196, 1206, 204, true), ('bai_dat', 'market', 400, 36, 1180, 356, false),
         ('ham_ngam', 'market', 48, 52, 640, 350, false),
         ('bai_dat', 'mo_da', 748, 268, 44, 200, false), ('mo_da', 'bai_dat', 28, 200, 736, 268, false),  -- 0072
         ('bai_dat', 'rung_tram', 455, 368, 40, 224, false), ('rung_tram', 'bai_dat', 20, 224, 455, 360, false)   -- 0097
$$;

insert into public.map_levels (map, min_level) values ('rung_tram', 1) on conflict (map) do nothing;

-- _wild_cap (0096's, verbatim but for the line marked 0097)
create or replace function public._wild_cap(p_map text) returns integer
language sql immutable parallel safe
as $$ select case p_map when 'wild' then 24 when 'rung_tram' then 24 else 0 end $$;   -- 0097: rung_tram

-- At least 6 live animals homed inside Rừng tràm's window (on its core cells, a cell in from the edge).
create or replace function public._wild_window_fill() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_night boolean := public._world_night(); v_live integer; v_sp text; a record; o record;
begin
  select * into o from public._forest_origin();
  perform pg_advisory_xact_lock(hashtext('wild:window'));
  select count(*) into v_live from public.wild_spawns w
   where w.map = 'wild' and w.taken_at is null and w.expires_at > now()
     and w.hx between o.ox and o.ox + 640 and w.hy between o.oy and o.oy + 384;
  for i in 1 .. greatest(0, 6 - v_live) loop
    select s.id into v_sp from public._wild_species() s
     where s.active = 'any' or (s.active = 'night') = v_night
     order by -ln(1 - random()) / s.weight limit 1;
    exit when v_sp is null;
    select f.cx * 64 + 4 as x, f.cy * 64 + 4 as y into a from public.world_forest f
     where f.core and f.cx between o.ox / 64 + 1 and o.ox / 64 + 8 and f.cy between o.oy / 64 + 1 and o.oy / 64 + 4
     order by random() limit 1;
    exit when not found;
    insert into public.wild_spawns (map, species, hx, hy, seed, expires_at)
    values ('wild', v_sp, a.x + floor(random() * 56)::int, a.y + floor(random() * 56)::int, floor(random() * 1000000)::int,
            now() + make_interval(secs => 480 + floor(random() * 240)::int));
  end loop;
end $$;
revoke all on function public._wild_window_fill() from public, anon, authenticated;

-- _wild_fill (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public._wild_fill(p_map text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_night boolean := public._world_night(); v_live integer; v_sp text; a record;
begin
  -- 0097 { Rừng tràm (2D) is a window of the wild: fill the wild, and keep a few animals homed in the window
  if p_map = 'rung_tram' then
    perform public._wild_fill('wild');
    perform public._wild_window_fill();
    return;
  end if;
  -- 0097 }
  if public._wild_cap(p_map) = 0 then return; end if;
  perform pg_advisory_xact_lock(hashtext('wild:' || p_map));
  update public.wild_spawns set expires_at = now()
   where map = p_map and taken_at is null and expires_at > now()
     and species in (select s.id from public._wild_species() s where s.active = case when v_night then 'day' else 'night' end);
  select count(*) into v_live from public.wild_spawns where map = p_map and taken_at is null and expires_at > now();
  for i in 1 .. greatest(0, public._wild_cap(p_map) - v_live) loop
    v_sp := null;
    select s.id into v_sp from public._wild_species() s
     where (p_map = any(s.maps) or p_map = 'wild') and (s.active = 'any' or (s.active = 'night') = v_night)   -- 0096: all live in the forest
     order by -ln(1 - random()) / s.weight limit 1;                     -- a weighted draw
    exit when v_sp is null;
    -- 0096 { the wild: a home on a core cell of the rừng tràm (the wander, ≤ 60 px, stays in the forest)
    if p_map = 'wild' then
      select f.cx * 64 + 4 as x, f.cy * 64 + 4 as y, 56 as w, 56 as h into a from public.world_forest f where f.core
       order by random() limit 1;
      exit when not found;
    else
      select * into a from public._wild_areas() ar where ar.map = p_map order by random() limit 1;
    end if;
    -- 0096 }
    insert into public.wild_spawns (map, species, hx, hy, seed, expires_at)
    values (p_map, v_sp, a.x + floor(random() * a.w)::int, a.y + floor(random() * a.h)::int, floor(random() * 1000000)::int,
            now() + make_interval(secs => 480 + floor(random() * 240)::int));
  end loop;
  -- 0078: every map's old spawns and the day-old photos, in bounded batches (not only the polled map's)
  delete from public.wild_spawns where id in (select id from public.wild_spawns where expires_at < now() - interval '1 day'
                                              order by expires_at limit 200);
  delete from public.wild_photos where (account_id, spawn_id) in (select account_id, spawn_id from public.wild_photos
                                                                 where at < now() - interval '1 day' order by at limit 200);
end $$;

-- _wild_json (0078_v21_fixes.sql's, verbatim but for the lines marked 0097)
create or replace function public._wild_json(p_account uuid, p_map text) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'animals', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'species', w.species,
                                                             'hx', w.hx - case when p_map = 'rung_tram' then o.ox else 0 end,   -- 0097
                                                             'hy', w.hy - case when p_map = 'rung_tram' then o.oy else 0 end,   -- 0097
                                                             'seed', w.seed,
                                                             'born_ms', (extract(epoch from w.born_at) * 1000)::bigint,
                                                             'expires_ms', (extract(epoch from w.expires_at) * 1000)::bigint,
                                                             'photographed', exists (select 1 from public.wild_photos ph
                                                                                      where ph.account_id = p_account and ph.spawn_id = w.id))
                                          order by w.id)
                           from public.wild_spawns w, public._forest_origin() o                                   -- 0097
                          where (w.map = p_map                                                                     -- 0097 {
                                 or (p_map = 'rung_tram' and w.map = 'wild' and w.hx between o.ox and o.ox + 640
                                     and w.hy between o.oy and o.oy + 384))                                        -- 0097 }
                            and w.taken_at is null and w.expires_at > now()), '[]'::jsonb),
    'bag', coalesce((select jsonb_object_agg(b.item, b.qty) from public.wild_bag b where b.account_id = p_account and b.qty > 0), '{}'::jsonb),
    'album', coalesce((select jsonb_object_agg(x.species, x.n) from public.wild_album x                  -- 0078: the counter
                        where x.account_id = p_account and x.n > 0), '{}'::jsonb),
    'kills_today', coalesce((select case when p.day = public._vn_today() then p.kills else 0 end from public.wild_profile p
                              where p.account_id = p_account), 0))
$$;

-- ---------- B. The design's animals and meats ----------
-- _wild_species (0075_world_bosses.sql's, verbatim but for the lines marked 0097)
create or replace function public._wild_species() returns table (id text, active text, maps text[], weight integer, hunt integer,
                                                                 trap integer, danger integer, drop_item text, drop_min integer,
                                                                 drop_max integer, radius integer, xp integer)
language sql immutable parallel safe
as $$
  values ('rabbit',  'any',   array['field', 'pond', 'bai_dat'], 30, 70, 85,  0, 'thit_tho',  1, 2, 40,  6),
         ('bird',    'day',   array['field', 'pond'],            25, 35, 60,  0, 'long_vu',   1, 3, 60,  5),
         ('deer',    'day',   array['field', 'bai_dat'],         14, 45,  0,  0, 'sung_huou', 1, 1, 50, 12),
         ('fox',     'night', array['field', 'bai_dat'],         18, 45, 70,  0, 'da_cao',    1, 1, 45, 10),
         ('wolf',    'night', array['field', 'bai_dat'],         14, 40,  0, 10, 'da_soi',    1, 1, 55, 16),
         ('bear',    'night', array['bai_dat'],                   6, 25,  0, 20, 'vuot_gau',  1, 2, 35, 24),
         ('firefly', 'night', array['pond', 'field'],            22,  0, 90,  0, 'dom_dom',   1, 3, 30,  4),
         ('boar',    'any',   array['wild'],                     12, 40,  0, 10, 'nanh_heo',  1, 1, 45, 14),   -- 0097
         ('pheasant', 'day',  array['wild'],                     16, 50, 65,  0, 'long_tri',  1, 2, 50,  9)    -- 0097
$$;

-- _wild_items (0075_world_bosses.sql's, verbatim but for the lines marked 0097)
create or replace function public._wild_items() returns table (id text, price integer)
language sql immutable parallel safe
as $$ values ('thit_tho', 25), ('long_vu', 12), ('sung_huou', 90), ('da_cao', 70), ('da_soi', 120), ('vuot_gau', 220), ('dom_dom', 15),
          ('nanh_heo', 100), ('long_tri', 40), ('thit_chim', 20), ('thit_chim_tri', 35), ('thit_huou', 45),   -- 0097
          ('thit_cao', 40), ('thit_heo_rung', 50), ('thit_soi', 55), ('thit_gau', 90) $$;                     -- 0097

-- The meat a successful hunt / trap also bags (null: none beyond the old drop).
create or replace function public._wild_meat(p_species text) returns text
language sql immutable parallel safe
as $$
  select case p_species when 'bird' then 'thit_chim' when 'pheasant' then 'thit_chim_tri' when 'deer' then 'thit_huou'
                        when 'fox' then 'thit_cao' when 'boar' then 'thit_heo_rung' when 'wolf' then 'thit_soi'
                        when 'bear' then 'thit_gau' end
$$;
revoke all on function public._wild_species() from public, anon, authenticated;
revoke all on function public._wild_items() from public, anon, authenticated;
revoke all on function public._wild_meat(text) from public, anon, authenticated;

-- ---------- D. Tools ----------
-- _prof_tools_catalog (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public._prof_tools_catalog() returns table (id text, prof text, name text, kind text, durability integer,
                                                                      power integer, price integer, starter boolean)
language sql immutable parallel safe
as $$
  -- 0097: every starter tool is sold too (a worn bow or pan is replaced at the stall)
  values ('can_cau_tap_su', 'ngu_dan', 'Cần câu tập sự', 'rod', 60, 1, 60, true),
         ('cuoc_tap_su', 'nong_dan', 'Cuốc tập sự', 'hoe', 60, 1, 60, true),
         ('cuoc_chim_tap_su', 'tho_mo', 'Cuốc chim tập sự', 'pick', 60, 1, 80, true),
         ('chao_tap_su', 'dau_bep', 'Chảo tập sự', 'pan', 60, 1, 80, true),
         ('can_hang_tap_su', 'thuong_nhan', 'Cân hàng tập sự', 'scale', 60, 1, 60, true),
         ('bua_ren_tap_su', 'tho_ren', 'Búa rèn tập sự', 'hammer', 60, 1, 80, true),
         ('cua_tap_su', 'tho_moc', 'Cưa tập sự', 'saw', 60, 1, 80, true),
         ('gang_tay_tap_su', 'vo_si', 'Găng tay tập sự', 'gloves', 60, 1, 60, true),
         ('cung_tap_su', 'tho_san', 'Cung tập sự', 'bow', 60, 1, 100, true),
         ('riu_tap_su', 'tieu_phu', 'Rìu tập sự', 'axe', 60, 1, 80, true),
         ('riu_sat', 'tieu_phu', 'Rìu sắt', 'axe', 120, 2, 450, false),
         ('riu_thep', 'tieu_phu', 'Rìu thép', 'axe', 200, 3, 1600, false),
         ('riu_tinh_luyen', 'tieu_phu', 'Rìu tinh luyện', 'axe', 300, 4, 4500, false)
$$;

create or replace function public.tool_repair(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; t record; w public.prof_tools; v_cost integer; v_coins integer; v_bal integer;
begin
  v_acc := public._ac_account(p_session_token);
  select * into t from public._prof_tools_catalog() c where c.id = p_item and c.price > 0;
  if not found then raise exception 'invalid item' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'tool_repair', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_acc);
  select * into w from public.prof_tools where account_id = v_acc and item = p_item for update;
  if not found then raise exception 'not enough' using errcode = '22023'; end if;
  if w.durability >= w.max_durability then raise exception 'nothing to repair' using errcode = '22023'; end if;
  v_cost := greatest(5, ceil(t.price * (w.max_durability - w.durability)::numeric / w.max_durability / 2)::int);
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < v_cost then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_acc, -v_cost, 'repair', 'tool: ' || t.id);
  update public.prof_tools set durability = max_durability where account_id = v_acc and item = p_item;
  return jsonb_build_object('cost', v_cost, 'coins', v_bal, 'forest', public._forest_json(v_acc));
end $$;

-- ---------- C. Cooking as designed ----------
alter table public.player_buffs drop constraint if exists player_buffs_kind_check;
alter table public.player_buffs add constraint player_buffs_kind_check
  check (kind in ('luck', 'miner', 'speed', 'rare_fish', 'strength', 'stamina_regen',
                  'hunt_stamina', 'chop_stamina', 'hunt_chance'));                                      -- 0097

drop function if exists public._cook_recipes();
-- id, name, the meat (wild_bag) and how many, a common fish?, the fee (bought gạo 10, rau 10, nấm 15, thảo mộc 15), the
-- steps, the price (Đạt), stamina, the buff (kind, value, minutes; null: none)
create or replace function public._cook_recipes() returns table (id text, name text, meat text, meat_qty integer, fish boolean,
                                                                 fee integer, steps text[], price integer, stamina integer,
                                                                 buff text, buff_value integer, buff_min integer)
language sql immutable parallel safe
as $$
  values ('com_ca_nuong', 'Cơm cá nướng', null, 0, true, 10, array['slice', 'fire'], 110, 12, null, 0, 0),
         ('chao_ca_thao_moc', 'Cháo cá thảo mộc', null, 0, true, 25, array['slice', 'stir', 'fire'], 145, 16, null, 0, 0),
         ('com_thit_tho', 'Cơm thịt thỏ', 'thit_tho', 1, false, 10, array['slice', 'fire'], 140, 15, null, 0, 0),
         ('canh_nam_ga_rung', 'Canh nấm chim trĩ', 'thit_chim_tri', 1, false, 25, array['slice', 'stir', 'fire'], 180, 18, null, 0, 0),
         ('thit_huou_nuong', 'Thịt hươu nướng', 'thit_huou', 1, false, 15, array['slice', 'fire'], 210, 0, 'hunt_stamina', 1, 20),
         ('thit_heo_rung_kho', 'Thịt heo rừng kho', 'thit_heo_rung', 1, false, 25, array['slice', 'stir', 'fire'], 230, 0, 'chop_stamina', 1, 20),
         ('chao_chim_rung', 'Cháo chim rừng', 'thit_chim', 1, false, 10, array['slice', 'stir', 'fire'], 125, 14, null, 0, 0),
         ('com_rau_nam', 'Cơm rau nấm', null, 0, false, 60, array['slice', 'stir', 'fire'], 100, 12, null, 0, 0),
         ('canh_cao_thao_moc', 'Canh cáo thảo mộc', 'thit_cao', 1, false, 25, array['slice', 'stir', 'fire'], 190, 0, 'hunt_chance', 5, 15),
         ('thit_gau_ham_nam', 'Thịt gấu hầm nấm', 'thit_gau', 1, false, 30, array['slice', 'stir', 'fire'], 380, 0, 'hunt_chance', 10, 20)
$$;
revoke all on function public._cook_recipes() from public, anon, authenticated;

-- _forest_json (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public._forest_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'wood', coalesce((select jsonb_agg(jsonb_build_object('item', w.item, 'qty', w.qty, 'half', w.half) order by w.item)
                        from public.wood_bag w where w.account_id = p_account and w.qty + w.half > 0), '[]'::jsonb),
    'logs_today', coalesce((select case when c.day = public._vn_today() then c.logs else 0 end from public.chop_profile c
                             where c.account_id = p_account), 0),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('item', t.item, 'durability', t.durability, 'max', t.max_durability)
                                        order by t.item) from public.prof_tools t where t.account_id = p_account), '[]'::jsonb),
    'dishes', coalesce((select jsonb_agg(jsonb_build_object('dish', d.dish, 'quality', d.quality, 'qty', d.qty) order by d.dish, d.quality)
                          from public.cooked_dishes d where d.account_id = p_account and d.qty > 0), '[]'::jsonb),
    'meat', coalesce((select jsonb_object_agg(b.item, b.qty) from public.wild_bag b
                       where b.account_id = p_account and b.qty > 0 and b.item like 'thit\_%'), '{}'::jsonb),   -- 0097: every meat
    'fish_common', (select count(*) from public.fish f join public.fish_species s on s.id = f.species_id            -- 0097
                     where f.account_id = p_account and s.rarity = 1),                                               -- 0097
    'main', (select m.prof from public.player_profession_main m where m.account_id = p_account),
    'felled', coalesce((select jsonb_agg(jsonb_build_object('tree', f.tree_key,
                                                           'respawn_ms', (extract(epoch from f.respawn_at) * 1000)::bigint))
                          from public.forest_felled f where f.respawn_at > now()), '[]'::jsonb),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;

-- cook_start (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public.cook_start(p_session_token text, p_recipe text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; cp public.cook_profile; v_have integer; v_coins integer; v_u bigint[] := '{}'; v_t integer := 60;
        v_step text; b1 integer; b2 integer; v_hold integer; v_per integer;
        v_pan record; v_fish uuid;                                                                         -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  if public._prof_main_level(v_acc, 'dau_bep') < 0 then
    raise exception 'not a chef' using errcode = '42501';
  end if;
  select * into r from public._cook_recipes() c where c.id = p_recipe;
  if not found then raise exception 'invalid recipe' using errcode = '22023'; end if;
  perform public._vitals_guard(v_acc);
  perform public._wallet_lock(v_acc);
  insert into public.cook_profile (account_id) values (v_acc) on conflict do nothing;
  select * into cp from public.cook_profile where account_id = v_acc for update;
  if cp.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  -- 0097 { the pan (1 durability a dish) and a common fish for the fish dishes
  select t.item into v_pan from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'pan'
   where t.account_id = v_acc and t.durability > 0 order by t.durability desc limit 1;
  if not found then raise exception 'no pan' using errcode = '22023'; end if;
  if r.fish then
    select f.id into v_fish from public.fish f join public.fish_species s on s.id = f.species_id
     where f.account_id = v_acc and s.rarity = 1 and not exists (select 1 from public.fish_fighters ff where ff.fish_id = f.id)
     order by f.caught_at limit 1 for update of f;
    if not found then raise exception 'no ingredients' using errcode = '22023'; end if;
  end if;
  -- 0097 }
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < r.fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  if r.meat is not null then
    select qty into v_have from public.wild_bag where account_id = v_acc and item = r.meat for update;
    if coalesce(v_have, 0) < r.meat_qty then raise exception 'no ingredients' using errcode = '22023'; end if;
    update public.wild_bag set qty = qty - r.meat_qty where account_id = v_acc and item = r.meat;
  end if;
  if r.fish then delete from public.fish where id = v_fish; end if;                                   -- 0097
  update public.prof_tools set durability = durability - 1 where account_id = v_acc and item = v_pan.item;   -- 0097
  if r.fee > 0 then perform public._pay(v_acc, -r.fee, 'cook_fee', 'cook: ' || r.id); end if;
  update public.cook_profile set last_at = now() where account_id = v_acc;
  -- the round, step by step (lib/game/forest/cook.ts reads it back from the events)
  foreach v_step in array r.steps loop
    if v_step = 'slice' then
      b1 := v_t + 40 + floor(random() * 31)::int;
      b2 := b1 + 35 + floor(random() * 31)::int;
      v_u := v_u || array[1, v_t, b2 + 30, b1, b2, 0]::bigint[];
      v_t := b2 + 60;
    elsif v_step = 'stir' then
      v_hold := 60 + floor(random() * 61)::int;
      v_u := v_u || array[2, v_t, v_t + v_hold + 120, v_hold, 0, 0]::bigint[];
      v_t := v_t + v_hold + 150;
    else
      v_per := 80 + floor(random() * 61)::int;
      v_u := v_u || array[3, v_t, v_t + 240, v_per, floor(random() * v_per)::int, 25 + floor(random() * 51)::int]::bigint[];
      v_t := v_t + 270;
    end if;
  end loop;
  perform public._mg_open(v_acc, 'cook', 'cook', v_u, 0, jsonb_build_object('recipe', r.id));
  return jsonb_build_object('round', jsonb_build_object('game', 'cook', 'live', 'cook', 'recipe', r.id,
                                                        'steps', to_jsonb(r.steps), 'started_at', now()),
                            'coins', (select coins from public.wallets where account_id = v_acc));
end $$;

-- cook_eat (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public.cook_eat(p_session_token text, p_dish text, p_quality integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; v_have integer; s public.player_stamina; v_gain numeric;
begin
  v_acc := public._ac_account(p_session_token);
  select * into r from public._cook_recipes() c where c.id = p_dish;
  if not found or p_quality is null or p_quality not between 0 and 3 then raise exception 'invalid item' using errcode = '22023'; end if;
  select qty into v_have from public.cooked_dishes where account_id = v_acc and dish = p_dish and quality = p_quality for update;
  if coalesce(v_have, 0) < 1 then raise exception 'not enough' using errcode = '22023'; end if;
  update public.cooked_dishes set qty = qty - 1 where account_id = v_acc and dish = p_dish and quality = p_quality;
  v_gain := case when p_quality = 0 then 0 else floor(r.stamina * public._cook_pct(p_quality) / 100.0) end;
  s := public._stamina_settle(v_acc);
  update public.player_stamina set value = least(public._stamina_max(v_acc), s.value + v_gain) where account_id = v_acc;
  -- 0097 { a buff dish: its buff for the recipe's minutes × the quality's % (Hỏng: nothing); the same buff is replaced
  if r.buff is not null and p_quality > 0 then
    delete from public.player_buffs where account_id = v_acc and kind = r.buff;
    perform public._buff_grant(v_acc, r.buff, r.buff_value, floor(r.buff_min * public._cook_pct(p_quality) / 100.0)::int);
  end if;
  -- 0097 }
  return jsonb_build_object('gained', v_gain, 'buff', case when r.buff is not null and p_quality > 0 then r.buff end,   -- 0097
                            'stamina', public._stamina_json(v_acc), 'forest', public._forest_json(v_acc));
end $$;

-- ---------- the forest checks, 2D and 3D ----------
-- wild_start (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public.wild_start(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; sp public.wild_spawns; s record; p public.wild_profile; g public.world_mg;
        v_ax double precision; v_ay double precision; v_seed bigint := floor(random() * 4294967296)::bigint; v_danger boolean;
        v_u bigint[];                                                                                      -- 0087
        v_w record; bw record;                                                                             -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  if p_action is null or p_action not in ('hunt', 'trap', 'photo') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'wild_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  -- 0097 { the forest in either game: the wild (3D, world px) or Rừng tràm (2D, a window of the world)
  select * into v_w from public._forest_xy(pp.map, pp.x, pp.y);
  if v_w.wx is null or not public._near_forest(v_w.wx, v_w.wy) then
    raise exception 'not in forest' using errcode = '22023';
  end if;
  -- 0097 }
  g := public._wg_row(v_acc);
  if g.stun_until > now() then raise exception 'stunned' using errcode = '53400'; end if;
  select * into sp from public.wild_spawns where id = p_spawn for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    raise exception 'gone' using errcode = '22023';
  end if;
  select * into s from public._wild_species() ws where ws.id = sp.species;
  select q.x, q.y into v_ax, v_ay from public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, extract(epoch from now() - sp.born_at)) q;
  if sp.map is distinct from 'wild'                                                                   -- 0097: world px
     or sqrt((v_w.wx - v_ax) ^ 2 + (v_w.wy - v_ay) ^ 2) > (case when p_action = 'photo' then 140 else 64 end) then   -- 0097
    raise exception 'too far' using errcode = '22023';
  end if;
  insert into public.wild_profile (account_id) values (v_acc) on conflict do nothing;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;
  if p_action = 'photo' then
    if p.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
    if exists (select 1 from public.wild_photos where account_id = v_acc and spawn_id = sp.id) then
      raise exception 'already photographed' using errcode = '22023';
    end if;
  else
    if (p_action = 'hunt' and s.hunt = 0) or (p_action = 'trap' and s.trap = 0) then
      raise exception 'cannot' using errcode = '22023';
    end if;
    if (p_action = 'hunt' and p.last_at > now() - interval '4 seconds')
       or (p_action = 'trap' and p.trap_at > now() - interval '20 seconds') then
      raise exception 'cooldown' using errcode = '53400';
    end if;
    if p.kills >= 60 then raise exception 'daily cap' using errcode = '53400'; end if;
  end if;
  -- 0097 { a hunt needs a bow that still shoots (1 durability a hunt); a dish's hunt_stamina buff eases the cost
  if p_action = 'hunt' then
    select t.item, t.durability into bw from public.prof_tools t
      join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'bow'
     where t.account_id = v_acc and t.durability > 0 order by t.durability desc limit 1;
    if not found then raise exception 'no bow' using errcode = '22023'; end if;
    update public.prof_tools set durability = durability - 1 where account_id = v_acc and item = bw.item;
  end if;
  perform public._stamina_spend(v_acc, greatest(0, case when p_action = 'photo' then 0.5
                                                        else 1 - public._buff(v_acc, 'hunt_stamina') end),
                                case when p_action = 'photo' then null else 'hunt' end);   -- 0096: the hunt_stamina_pct perk
  -- 0097 }
  update public.wild_profile
     set last_at = case when p_action in ('hunt', 'photo') then now() else last_at end,
         trap_at = case when p_action = 'trap' then now() else trap_at end,
         day = p.day, kills = p.kills
   where account_id = v_acc;
  v_danger := p_action = 'hunt' and s.danger > 0 and public._world_night();
  insert into public.world_mg as w (account_id, kind, ref, target, species, danger, seed, started_at, open, last_start)
  values (v_acc, p_action, sp.id, 0, sp.species, v_danger, v_seed, now(), true, now())
  on conflict (account_id) do update
    set kind = excluded.kind, ref = excluded.ref, target = 0, species = excluded.species, danger = excluded.danger,
        seed = excluded.seed, started_at = excluded.started_at, open = true, last_start = excluded.last_start;
  -- 0087 { the round stays on the server: the hunt's aim sweep is all the client sees before the animal shows
  v_u := public._mg_u(case p_action when 'hunt' then 5 when 'trap' then 16 else 4 end);
  perform public._mg_open(v_acc, 'world', p_action, v_u, case when p_action = 'trap' then 0 else 30 + floor(random() * 31)::int end,
                          jsonb_build_object('species', sp.species, 'danger', v_danger));
  return jsonb_build_object('round', jsonb_build_object('game', p_action, 'spawn', sp.id, 'species', sp.species,
                                                        'danger', v_danger, 'live', 'world',
                                                        'reticle', case when p_action = 'hunt' then 100 + v_u[4] % 41 end,
                                                        'started_at', now()));
  -- 0087 }
end $$;

-- wild_finish (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public.wild_finish(p_session_token text, p_a integer[], p_b integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; sp public.wild_spawns; s record; p public.wild_profile; v_bad text; v_rep jsonb;
        v_code text; v_ev jsonb; v_ac jsonb; v_out text; v_rt integer; v_score integer := 0; v_chance integer := 0;
        v_ok boolean := false; v_qty integer := 0; v_knock boolean := false; v_faint boolean := false; v_saved boolean := false;
        v_xp integer := 0; v_gave_up boolean := false; v_n integer := coalesce(cardinality(p_a), 0);
        l public.mg_live;                                                                                  -- 0087
        pp public.player_pos; v_lv integer; v_extra integer := 0;                                          -- 0096
        v_w record; v_jm text := 'wild'; v_meat text; v_mq integer := 0;                                  -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  select * into g from public.world_mg where account_id = v_acc for update;
  if not found or not g.open or g.kind not in ('hunt', 'trap', 'photo') then
    raise exception 'round not found' using errcode = '22023';
  end if;
  update public.world_mg set open = false where account_id = v_acc;
  l := public._mg_close(v_acc, 'world', g.kind, p_a, p_b);                                                -- 0087
  if now() > g.started_at + interval '60 seconds' then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 { a round opened before 0087 has no live row: nothing is replayed, nothing flagged
  if l.account_id is null then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 }
  v_ev := jsonb_build_object('game', g.kind, 'species', g.species, 'ticks', p_ticks, 'a', to_jsonb(p_a[1:6]), 'b', to_jsonb(p_b[1:6]));
  v_bad := public._wg_input_error(g.kind, p_a, p_b, p_ticks);
  -- 0087 { the live list, and no shot / snap before the animal showed
  v_bad := coalesce(v_bad, l.meta->>'err',
                    case when g.kind in ('hunt', 'photo') and public._mg_early(l.started_at, p_a, l.seen[1]) then 'early' end);
  -- 0087 }
  if v_bad is not null then
    v_code := 'wild_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := case g.kind when 'hunt' then public._wg_hunt_u(l.params, g.species, g.danger, p_a, p_b)          -- 0087
                         when 'trap' then public._wg_trap_u(l.params, g.species, p_a)                        -- 0087
                         else public._wg_photo_u(l.params, g.species, p_a, p_b) end;                         -- 0087
    v_out := v_rep->>'outcome';
    v_rt := (v_rep->>'ticks')::int;
    if v_out = 'open' or p_ticks < v_rt then
      v_gave_up := g.kind <> 'photo';
      if g.kind = 'photo' then v_score := coalesce((v_rep->>'score')::int, 0); end if;
    elsif p_ticks <> v_rt or (v_rep->>'used')::int <> v_n then
      v_code := 'wild_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    else
      v_score := (v_rep->>'score')::int;
    end if;
    if v_code is null and now() < g.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'wild_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', g.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  -- 0087 { inputs not played live: the round is void (soft)
  if v_code is null and public._mg_late(l) then
    perform public._ac_flag(v_acc, 'wild_late', 'wild_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'late', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 }
  if v_code is not null then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    v_ac := public._ac_flag(v_acc, v_code, 'wild_finish', v_ev, null, 'invalid round');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'knocked', v_knock, 'fainted', v_faint) || v_ac;
  end if;
  if g.kind = 'hunt' and v_out = 'hit' and v_score >= 992 and not v_gave_up then
    perform public._ac_flag(v_acc, 'wild_timing', 'wild_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
  end if;

  select * into s from public._wild_species() ws where ws.id = g.species;
  -- the charge of a wolf / bear: taken unless the hunt hit first or the dodge was on time
  if g.danger and not (not v_gave_up and v_out = 'hit') and not (not v_gave_up and coalesce((v_rep->>'dodged')::boolean, false)) then
    v_knock := true;
    v_faint := public._wg_charge(v_acc, g.species);
  end if;

  select * into sp from public.wild_spawns where id = g.ref for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    return jsonb_build_object('result', 'lost', 'why', 'gone', 'outcome', v_out, 'score', v_score, 'knocked', v_knock,
                              'fainted', v_faint, 'wild', public._wild_json(v_acc, coalesce(sp.map, 'field')));
  end if;
  -- 0096 { still at the forest (a round lasts ≤ 60 s from a start that checked it)
  select * into pp from public.player_pos where account_id = v_acc;
  select * into v_w from public._forest_xy(pp.map, pp.x, pp.y);                                        -- 0097 {
  if pp.map = 'rung_tram' then v_jm := 'rung_tram'; end if;
  if v_w.wx is null or not public._near_forest(v_w.wx, v_w.wy) then                                     -- 0097 }
    return jsonb_build_object('result', 'lost', 'why', 'not in forest', 'outcome', v_out, 'score', v_score, 'knocked', v_knock,
                              'fainted', v_faint, 'wild', public._wild_json(v_acc, v_jm));                  -- 0097: v_jm
  end if;
  -- 0096 }
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;

  if g.kind = 'photo' then
    if v_score >= 250 then
      insert into public.wild_photos (account_id, spawn_id, species) values (v_acc, sp.id, sp.species) on conflict do nothing;
      v_saved := found;
    end if;
    if v_saved then
      v_xp := greatest(1, case when v_score >= 700 then s.xp / 2 else s.xp / 4 end);
      perform public._game_event(v_acc, 'wild_photo', 1, jsonb_build_object('species', sp.species, 'score', v_score));
      perform public._game_event(v_acc, 'xp_grant', v_xp, jsonb_build_object('source', 'wild'));
    end if;
    return jsonb_build_object('result', case when v_saved then 'ok' else 'fail' end, 'action', 'photo', 'species', sp.species,
                              'score', v_score, 'saved', v_saved, 'xp', v_xp, 'outcome', v_out,
                              'wild', public._wild_json(v_acc, v_jm));                             -- 0097: v_jm
  end if;

  v_chance := public._wg_chance(case when g.kind = 'hunt' then s.hunt else s.trap end, v_score,
                                not v_gave_up and v_out in ('hit', 'caught'));
  -- 0096 { Thợ săn (main nghề): + (5 + level) points; the skills' points (+ the night skill after dark); ≤ 95. A miss stays 0.
  v_lv := public._prof_main_level(v_acc, 'tho_san');
  if v_chance > 0 then
    v_chance := least(95, v_chance + case when v_lv >= 0 then 5 + v_lv else 0 end
                                   + floor(public._perk(v_acc, 'hunt_chance_pct'))::int
                                   + case when public._world_night() then floor(public._perk(v_acc, 'hunt_night_pct'))::int else 0 end
                                   + floor(public._buff(v_acc, 'hunt_chance'))::int);                -- 0097: a dish's buff
  end if;
  -- 0096 }
  v_ok := p.kills < 60 and random() * 100 < v_chance;
  if v_ok then
    update public.wild_spawns set taken_by = v_acc, taken_at = now() where id = sp.id;
    v_qty := s.drop_min + floor(random() * (s.drop_max - s.drop_min + 1))::int;
    -- 0096 { Thợ săn: one more drop (10 / 15 / 20 / 25 % by level, + the skill); one more from a wolf or a bear (skill)
    if v_lv >= 0 and random() * 100 < (case when v_lv <= 5 then 10 when v_lv <= 10 then 15 when v_lv <= 15 then 20 else 25 end)
                                        + public._perk(v_acc, 'hunt_drop_pct') then
      v_extra := v_extra + 1;
    end if;
    if sp.species in ('wolf', 'bear', 'boar') and public._perk(v_acc, 'hunt_big') > 0 then v_extra := v_extra + 1; end if;   -- 0097: boar
    v_qty := v_qty + v_extra;
    -- 0096 }
    insert into public.wild_bag (account_id, item, qty) values (v_acc, s.drop_item, v_qty)
    on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
    -- 0097 { the animal's meat besides its old drop (the cook's ingredient)
    v_meat := public._wild_meat(sp.species);
    if v_meat is not null then
      v_mq := 1;
      insert into public.wild_bag (account_id, item, qty) values (v_acc, v_meat, v_mq)
      on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
    end if;
    -- 0097 }
    p.kills := p.kills + 1;
    v_xp := s.xp;
    perform public._game_event(v_acc, case when g.kind = 'hunt' then 'wild_hunt' else 'wild_trap' end, v_qty,
                               jsonb_build_object('species', sp.species, 'item', s.drop_item, 'score', v_score));
    perform public._game_event(v_acc, 'xp_grant', s.xp, jsonb_build_object('source', 'wild'));
  elsif g.kind = 'hunt' and random() < 0.5 then
    update public.wild_spawns set expires_at = now() where id = sp.id;     -- it bolts
  end if;
  update public.wild_profile set day = p.day, kills = p.kills where account_id = v_acc;
  return jsonb_build_object('result', case when v_ok then 'ok' else 'fail' end, 'action', g.kind, 'species', sp.species,
                            'outcome', case when v_gave_up then 'gave_up' else v_out end, 'score', v_score, 'chance', v_chance,
                            'item', case when v_ok then s.drop_item end, 'qty', v_qty, 'extra', v_extra, 'xp', v_xp,   -- 0096: extra
                            'meat', v_meat, 'meat_qty', v_mq,                                       -- 0097
                            'knocked', v_knock, 'fainted', v_faint, 'wild', public._wild_json(v_acc, v_jm));   -- 0097: v_jm
end $$;

-- chop_start (0096_forest_professions.sql's, verbatim but for the lines marked 0097)
create or replace function public.chop_start(p_session_token text, p_cx integer, p_cy integer, p_k integer, p_map text,
                                             p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; v_key text; tr record; ax record; pr public.chop_profile;
        v_have integer; b1 integer; b2 integer; b3 integer; v_win integer;
        v_w record;                                                                                        -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  if p_k is null or p_k not between 0 and 7 or p_cx is null or p_cy is null then
    raise exception 'bad tree' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'chop_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  select * into v_w from public._forest_xy(pp.map, pp.x, pp.y);                                        -- 0097: either game
  if v_w.wx is null or not public._near_forest(v_w.wx, v_w.wy) then                                     -- 0097
    raise exception 'not in forest' using errcode = '22023';
  end if;
  if not exists (select 1 from public.world_forest f where f.cx = p_cx and f.cy = p_cy) then
    raise exception 'bad tree' using errcode = '22023';
  end if;
  if abs(floor(v_w.wx / 64) - p_cx) > 1 or abs(floor(v_w.wy / 64) - p_cy) > 1 then                    -- 0097
    raise exception 'too far' using errcode = '22023';
  end if;
  v_key := p_cx || ':' || p_cy || ':' || p_k;
  if exists (select 1 from public.forest_felled f where f.tree_key = v_key and f.respawn_at > now()) then
    raise exception 'felled' using errcode = '22023';
  end if;
  select * into tr from public._forest_trees() t where t.id = public._tree_of(p_cx, p_cy, p_k);
  -- the best axe that still cuts
  select c.id, c.power, t.durability into ax
    from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'axe'
   where t.account_id = v_acc and t.durability > 0
   order by c.power desc, t.durability desc limit 1;
  if not found then raise exception 'no axe' using errcode = '22023'; end if;
  insert into public.chop_profile (account_id) values (v_acc) on conflict do nothing;
  select * into pr from public.chop_profile where account_id = v_acc for update;
  if pr.last_at > now() - interval '1.5 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  perform public._stamina_spend(v_acc, greatest(0, 4 - public._buff(v_acc, 'chop_stamina')), 'chop');   -- 0097: a dish's buff
  update public.chop_profile set last_at = now() where account_id = v_acc;
  select coalesce((select c.hits from public.chop_progress c where c.account_id = v_acc and c.tree_key = v_key
                      and c.at > now() - interval '30 minutes'), 0) into v_have;
  b1 := 80 + floor(random() * 50)::int;
  b2 := b1 + 50 + floor(random() * 50)::int;
  b3 := b2 + 50 + floor(random() * 50)::int;
  v_win := case when public._perk(v_acc, 'chop_window_ms') > 0 then 13 else 11 end;
  perform public._mg_open(v_acc, 'chop', 'chop', array[b1, b2, b3]::bigint[], 0,
                          jsonb_build_object('tree', v_key, 'kind', tr.id, 'axe', ax.id, 'power', ax.power, 'win', v_win));
  return jsonb_build_object('round', jsonb_build_object('game', 'chop', 'live', 'chop', 'tree', v_key, 'kind', tr.id,
                                                        'need', tr.need, 'have', v_have, 'axe', ax.id, 'power', ax.power,
                                                        'durability', ax.durability, 'win', v_win, 'started_at', now()));
end $$;

-- ---------- E. Thợ săn xp ----------
-- _prof_on_event (0078_v21_fixes.sql's, verbatim but for the lines marked 0097)
create or replace function public._prof_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare r record; v_main text; v_gain int; v_today date := public._vn_today(); p public.player_professions; v_old int;
begin
  if coalesce(current_setting('mt.perk_pay', true), '') = '1' then return new; end if;   -- a perk payment is no deed
  -- 0078: a fight this side could not pay the stamina for earns no nghề XP
  if new.kind in ('fight_done', 'fight_win') and new.meta ? 'match'
     and exists (select 1 from public.fight_stamina_short f
                  where f.match_id = public._econ_uuid(new.meta->>'match') and f.account_id = new.account_id) then
    return new;
  end if;
  select prof into v_main from public.player_profession_main where account_id = new.account_id;
  for r in select x.prof, x.xp from public.profession_xp_rules x
            where x.kind = new.kind and (x.reason = '' or x.reason = coalesce(new.meta->>'reason', '')) loop
    continue when r.prof = 'tho_san' and v_main is distinct from 'tho_san';                       -- 0097: hunters only
    v_gain := case when r.prof = v_main then (r.xp * 3) / 2 else r.xp end;
    insert into public.player_professions (account_id, prof, day, day_xp) values (new.account_id, r.prof, v_today, 0)
    on conflict do nothing;
    select * into p from public.player_professions where account_id = new.account_id and prof = r.prof for update;
    if p.day is distinct from v_today then p.day_xp := 0; end if;
    v_gain := least(v_gain, 2000 - p.day_xp);
    if v_gain <= 0 then continue; end if;
    v_old := public._prof_level(p.xp);
    update public.player_professions set xp = xp + v_gain, day = v_today, day_xp = p.day_xp + v_gain
     where account_id = new.account_id and prof = r.prof;
    if public._prof_level(p.xp + v_gain) > v_old then
      perform public._game_event(new.account_id, 'profession_level', public._prof_level(p.xp + v_gain),
                                 jsonb_build_object('prof', r.prof));
    end if;
  end loop;
  return new;
end $$;

revoke all on function public.tool_repair(text, text) from public;
grant execute on function public.tool_repair(text, text) to anon, authenticated;
