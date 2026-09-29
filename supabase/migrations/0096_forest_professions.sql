-- =========================================================
-- 0096_forest_professions.sql — the forest's rule, two new nghề and the chef's kitchen (owner: "thú hoang chỉ ở rừng tràm;
-- nghề Thợ săn, Tiều phu; nấu ăn chỉ Đầu bếp; mỗi nghề có dụng cụ nhập môn"). ADDITIVE and re-runnable. Run after 0094
-- (0095 is the river's; nothing here touches it). The 2D and the 3D game share every rule below; only the drawing differs.
-- Design: .local-agent-tasks/prof-design.result.md (the woodcutter's trees and axes, the hunter's perks, the chef's
-- quality bands, the starter tools), cut down to what the game already has (see "Not built").
--   A. The forest grid: public.world_forest — the rừng tràm as 64 px cells of world px (a cell is forest when its centre
--      is: lib/game/world/scenery.ts inTramForest), seeded from _forest_seed() (lib/game/world/forest-grid.data.ts, the
--      same rows; tests/unit/forest-grid.test.ts pins both to the scenery). core = the cell and its 8 neighbours are
--      forest. _in_forest(x, y) (the point's cell), _near_forest(x, y) (the cell or a neighbour: where a hunter or a
--      woodcutter may stand).
--   B. Wild animals only in the forest: _wild_cap is 24 for 'wild' and 0 for every zone map (the fields, the pond and
--      Bãi đất trống have none any more; their live spawns leave now); _wild_fill (0078's) homes an animal on a random
--      core cell. wild_start (0087's) refuses 'not in forest' unless my server position is in the wild and near the
--      forest, and charges the hunt's stamina as kind 'hunt'; wild_finish (0087's) checks the forest again and applies
--      the Thợ săn perks (C). world_state is unchanged: a client in the wild polls map 'wild'.
--   C. Two nghề: tho_san (Thợ săn) and tieu_phu (Tiều phu) in profession_catalog, their six skill nodes each, xp rules
--      (wild_hunt 10, wild_trap 8 → tho_san; wood_chopped 8 → tieu_phu). Thợ săn as the MAIN nghề: + (5 + level)
--      points on a hit/caught hunt or trap's chance (≤ 95), one more drop at 10/15/20/25 % by level band. Perk keys:
--      hunt_chance_pct, hunt_night_pct, hunt_drop_pct, hunt_big (one more drop from a wolf/bear), hunt_stamina_pct
--      (_stamina_cost's '<kind>_stamina_pct'), chop_miss_bonus, chop_window_ms, chop_stamina_pct, axe_save_pct,
--      wood_extra_pct, wood_sell_pct. _prof_main_level(account, prof): the main nghề's level, else −1.
--   D. The starter tools: _prof_tools_catalog (a starter "tập sự" tool per nghề, durability 60, and the three bought
--      axes), public.prof_tools (account, item, durability), public.prof_starter_grants (account, nghề: ONE grant per
--      account per nghề, ever). profession_choose (0077's) grants the chosen nghề's starter tool (idempotent: switching
--      back does not grant it again); every account that already has a main nghề gets its grant now (backfill).
--      _prof_json (0077's) lists the tools. tool_buy: an axe at the hunter's stall (Bãi đất 460, 56), 'tool_buy'; a
--      bought axe is a full one (buying again replaces a worn one).
--   E. Chopping (Tiều phu; anyone with an axe may chop, the nghề's perks are the woodcutter's): a tree is a forest cell
--      and an index 0…7 ("cx:cy:k"); its kind is _tree_of(cx, cy, k) (7 kinds, rarer deeper in the hash: tre … thần mộc;
--      lib/game/forest/trees.ts mirrors it). chop_start: stand near the forest, the tree's cell within one of mine, the
--      tree up, an axe with durability, 1.5 s between rounds, 4 stamina ('chop'); opens the live round (mg_live 'chop':
--      three beats rolled with random(), each revealed 1 s ahead by mg_sync). chop_finish: the presses; a beat is hit by
--      a press within ±11 ticks (±180 ms; ±13 with chop_window_ms); a hit strikes with the axe's power, a miss 1 (+1
--      once with chop_miss_bonus); −1 durability (axe_save_pct may keep it). The tree's strikes add up per player; at
--      its need the tree falls for everyone until its respawn and drops its logs (+1 with wood_extra_pct) into
--      public.wood_bag — the first 40 logs a VN day at full price, the rest at half (wood_bag.half). Refused hard:
--      chop_bad_input (a synced list rewritten, too many presses, a hit claimed < 0.1 s after its beat's reveal),
--      chop_too_fast (finished before 0.9 × the round); soft: chop_late (not played live: void), chop_timing (three
--      hits within ±1 tick; the 5th in 24 h the hard chop_timing_repeat, the round void). wood_sell at the stall
--      ('wood_sell'; + wood_sell_pct, ≤ 20 %).
--   F. Cooking — the Đầu bếp's only (cook_start refuses 'not a chef' for anyone else): _cook_recipes (cơm thịt thỏ from
--      the hunter's thịt thỏ; cơm rau nấm from bought greens), ingredients and the fee ('cook_fee') taken at the START.
--      The live round (mg_live 'cook'): 2–3 steps — thái (two beats), khuấy (hold, release at the target), canh lửa (stop
--      the swinging heat in the band) — each revealed 0.5 s before it; _cook_score scores each step 0–100, the dish is
--      their mean: 0–39 Hỏng (20 % price, no stamina), 40–69 Đạt, 70–89 Ngon (125 %), 90–100 Tuyệt phẩm (150 %).
--      cook_finish: the same hard/soft checks as chopping (cook_bad_input, cook_too_fast, cook_late, cook_timing on a
--      perfect 100); the dish goes to public.cooked_dishes (by quality); 'food_cooked' (dau_bep xp, 0077's rule).
--      cook_sell at the stall ('dish_sell'); cook_eat restores stamina (the recipe's × the quality's %).
--   G. mg_live takes the games 'chop' and 'cook'; _mg_events (0087's) reveals their events. mg_sync is unchanged.
--   H. forest_state: my wood, the day's logs, tools, dishes, meat, whether I am a chef.
--   I. The ledger: 0069's reason check, verbatim, plus 'wood_sell', 'tool_buy', 'cook_fee', 'dish_sell'.
--   J. A wipe clears the wood, the dishes, the chop progress and the tools (not the starter grants: no new free tool).
-- Not built (the game has no such items yet): the design's new animal species and meats (the existing species keep their
--   drops), the fish/rice/herb ingredients (two recipes use what exists), the dish buffs other than stamina, the axe's
--   repair, a hunter's bow / a chef's pan being REQUIRED (they are granted; chopping needs the axe), the "XP only for
--   Thợ săn" rule (0077's event trigger gives any nghề's xp to anyone, the main nghề × 1.5).
-- Re-created functions I did not create (each the NEWEST, verbatim but for the lines marked 0096): _mg_events (0087),
--   wild_start (0087), wild_finish (0087), _wild_fill (0078), _wild_cap (0075), profession_choose (0077),
--   _prof_json (0077). Codes: chop_/cook_ bad_input, too_fast (hard); chop_/cook_ late, timing (soft), *_timing_repeat.
-- Events: 'wood_chopped' (qty logs, meta tree), 'food_cooked' (meta recipe, quality, score), 'xp_grant' (source 'wood',
--   'cook'). Ledger reasons: wood_sell, tool_buy, cook_fee, dish_sell.
-- Lock order: vitals → player_pos → wallets → wood_bag / forest rows.
-- =========================================================

-- ---------- A. The forest grid ----------
create table if not exists public.world_forest (
  cx smallint not null,
  cy smallint not null,
  core boolean not null default false,
  primary key (cx, cy)
);
alter table public.world_forest enable row level security;
revoke all on public.world_forest from anon, authenticated;

-- One row per 64 px row of the world (cy), a '1' per forest cell (cx = the character's index) — forest-grid.data.ts.
create or replace function public._forest_seed() returns table (cy integer, bits text)
language sql immutable parallel safe
as $$
  values
  (0, '00000000000111000000000000011000000000000000111111100000011111111'),
  (1, '00000000001000000000000011111100000000000000111111100000011111111'),
  (2, '00000100011000000000000111111110000000110000001111100000001111111'),
  (3, '00000111111000000000001111111110000001110000100111100000011111111'),
  (4, '00000111110000000000001111111110000011111111111111110000011100111'),
  (5, '11100001100000000000000000000000000000000000000000000000000000001'),
  (6, '00000000000000000000000000000000000000000000000000000000000000000'),
  (7, '00000000000000000000000000000000000000000000000000000000000000000'),
  (8, '00000000000000000000000000000000000000000000000000000000000000000'),
  (9, '00000000000000000000000000000000000000000000000000000000000000000'),
  (10, '00000000000000000000000000000000000000000000000000000000000000000'),
  (11, '00000000000000000000000000000000000000000000000000000000000000000'),
  (12, '00000000000000000000000000000000000000000000000000000000000000000'),
  (13, '00000000000000000000000000000000000000000000000000000000000000000'),
  (14, '00000000000000000000000000000000000000000000000000000000000000000'),
  (15, '00000000000000000000000000000000000000000000000000000000000000000'),
  (16, '00000000000000000000000000000011111000000000000000000000000000000'),
  (17, '00000000000000000000000000000011111000000000000000000000000000000'),
  (18, '00000000000000000000000000000001111000000000000000000000000000000'),
  (19, '11000000000100000000000000000011111000000000000000000000000000000'),
  (20, '11000000000100000000000000000011111000000000000000000000000000100'),
  (21, '10000000000100000000000000000011111000000000000000000000000001100'),
  (22, '10000000000100000000000000000011111000000000000000000000001111110'),
  (23, '10000000111110000000000000000000111000000000000000000000001111111'),
  (24, '00000000110000000000000000000000111100000000000000000000011111111'),
  (25, '00000000100000000000000000000000011111111100000000000000011111111'),
  (26, '00000000000000000000000000000000011111111100000000000000001111111'),
  (27, '00000001100000000000000000000000011111111100000000000000001111111'),
  (28, '00000111100000000000000000000000011111111110000000000000000011111'),
  (29, '00001111100000000000000000000000011111111100000000000000000011111'),
  (30, '00001111100000000000000000000000011111111100011000000000000000111'),
  (31, '00000111100000000000000000000000011111000000111111111100000000000'),
  (32, '00011111000000000000000000000000011110000000111111111110000000000'),
  (33, '00111110000000000000000000000000111110000001111111111110000000000'),
  (34, '00001110000000000000000000000000111110000000111111111110000000000')
$$;

delete from public.world_forest;
insert into public.world_forest (cx, cy, core)
select g.i - 1, s.cy, false
  from public._forest_seed() s
  cross join lateral generate_series(1, length(s.bits)) g(i)
 where substr(s.bits, g.i, 1) = '1';
update public.world_forest f
   set core = (select count(*) from public.world_forest n
                where n.cx between f.cx - 1 and f.cx + 1 and n.cy between f.cy - 1 and f.cy + 1) = 9;

create or replace function public._in_forest(p_x double precision, p_y double precision) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.world_forest f where f.cx = floor(p_x / 64) and f.cy = floor(p_y / 64)) $$;

create or replace function public._near_forest(p_x double precision, p_y double precision) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.world_forest f
                      where f.cx between floor(p_x / 64) - 1 and floor(p_x / 64) + 1
                        and f.cy between floor(p_y / 64) - 1 and floor(p_y / 64) + 1) $$;
revoke all on function public._forest_seed() from public, anon, authenticated;
revoke all on function public._in_forest(double precision, double precision) from public, anon, authenticated;
revoke all on function public._near_forest(double precision, double precision) from public, anon, authenticated;

-- ---------- G. The live rounds: chop and cook ----------
alter table public.mg_live drop constraint if exists mg_live_game_check;
alter table public.mg_live add constraint mg_live_game_check
  check (game in ('world', 'brew', 'anvil', 'sort', 'care', 'row', 'dig', 'mine', 'press', 'chop', 'cook'));   -- 0096: chop, cook

-- _mg_events (0087_v22_fixes.sql's, verbatim but for the lines marked 0096)
create or replace function public._mg_events(l public.mg_live) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare u bigint[] := l.params; o jsonb := '[]'::jsonb; sp text := l.meta->>'species'; per integer; ph integer; v_chg integer;
        mul integer; tv integer[] := array[-3, 0, 0, 4, 5, 6, 7, 8]; s integer := 0; len integer; b integer; slam integer;
        k integer; need integer; win integer; hits integer := 0; t integer; pose integer;
begin
  if l.game = 'world' and l.kind = 'hunt' then
    per := ((150 + u[1] % 91) * 100) / public._wg_speed(sp);
    ph := (u[2] % per)::int;
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('period', per, 'phase', ph, 'wind', (u[3] % 121) - 60));
    if (l.meta->>'danger')::boolean then
      v_chg := (150 + u[5] % 151)::int;
      o := o || jsonb_build_object('i', 2, 'at', v_chg - 60, 'd', jsonb_build_object('charge', v_chg));
    end if;
  elsif l.game = 'world' and l.kind = 'trap' then
    mul := case when public._wg_speed(sp) >= 150 then 3 else 2 end;
    for i in 0 .. 7 loop
      len := (30 + u[2 * i + 1] % 41)::int;
      o := o || jsonb_build_object('i', i + 1, 'at', s - 30,
                                   'd', jsonb_build_object('len', len, 'v', (tv[(u[2 * i + 2] % 8)::integer + 1] * mul) / 2));
      s := s + len;
    end loop;
  elsif l.game = 'world' and l.kind = 'photo' then
    per := ((180 + u[1] % 121) * 100) / public._wg_speed(sp);
    pose := (150 + u[3] % 91)::int;
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('period', per, 'phase', u[2] % per, 'pose', pose,
                                                                                  'pose_at', u[4] % pose));
  elsif l.game = 'world' and l.kind = 'combo' then
    b := (90 + u[1] % 31)::int;
    for j in 0 .. 5 loop
      if j > 0 then b := b + (54 + u[2 * j + 1] % 19)::int; end if;
      o := o || jsonb_build_object('i', j + 1, 'at', b - 120, 'd', jsonb_build_object('beat', b, 'dir', u[2 * j + 2] % 4));
    end loop;
    k := 1 + (u[13] % 3)::integer;
    slam := ((o->k->'d'->>'beat')::int) + 27;
    o := o || jsonb_build_object('i', 7, 'at', slam - 90, 'd', jsonb_build_object('slam', slam));
  elsif l.game = 'brew' then
    for i in 1 .. 20 loop
      o := o || jsonb_build_object('i', i, 'at', 30 * (i - 1) - 60, 'd', jsonb_build_object('drift', u[i + 1]));
    end loop;
  elsif l.game = 'anvil' then
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('period', u[1], 'phase', u[2]));
  elsif l.game = 'sort' then
    for i in 1 .. 12 loop
      o := o || jsonb_build_object('i', i, 'at', 40 + 45 * (i - 1) - 60, 'd', jsonb_build_object('kind', u[i]));
    end loop;
  elsif l.game = 'care' and l.kind = 'feed' then
    for i in 1 .. 12 loop
      o := o || jsonb_build_object('i', i, 'at', 30 + 40 * (i - 1) - 30, 'd', jsonb_build_object('lane', u[i]));
    end loop;
  elsif l.game = 'care' and l.kind = 'pat' then
    for i in 1 .. 5 loop
      o := o || jsonb_build_object('i', i, 'at', 30 + 100 * (i - 1) - 30, 'd', jsonb_build_object('like', u[i]));
    end loop;
  elsif l.game = 'care' and l.kind = 'play' then
    for i in 1 .. 8 loop
      o := o || jsonb_build_object('i', i, 'at', 20 + 100 * (i - 1) - 30, 'd', jsonb_build_object('flight', u[i]));
    end loop;
  elsif l.game = 'row' then
    for i in 1 .. 12 loop
      o := o || jsonb_build_object('i', i, 'at', u[i] - 90, 'd', jsonb_build_object('t', u[i], 'side', u[i + 12]));
    end loop;
  elsif l.game = 'press' then
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('centre', u[2]));
  elsif l.game in ('dig', 'mine') then
    -- vein 1 at the gate; vein j + 1 once the strike that hit vein j is stamped (a stamped strike is at a tick ≤ now)
    need := cardinality(u) - 1;
    win := (l.meta->>'win')::int;
    o := o || jsonb_build_object('i', 1, 'at', l.gate, 'd', jsonb_build_object('c', u[2]));
    foreach t in array l.a loop
      exit when hits >= need;
      if abs(public._mine_pos(u[1]::int, t) - u[hits + 2]) <= win then
        hits := hits + 1;
        if hits < need then
          o := o || jsonb_build_object('i', hits + 1, 'at', greatest(t, l.gate), 'd', jsonb_build_object('c', u[hits + 2]));
        end if;
      end if;
    end loop;
  -- 0096 {
  elsif l.game = 'chop' then
    -- the axe's three beats, each revealed 1 s before it (lib/game/forest/chop.ts)
    for i in 1 .. 3 loop
      o := o || jsonb_build_object('i', i, 'at', u[i] - 60, 'd', jsonb_build_object('beat', u[i]));
    end loop;
  elsif l.game = 'cook' then
    -- a step (6 params: kind 1 thái / 2 khuấy / 3 canh lửa, start, end, p1, p2, p3) revealed 0.5 s before it starts
    for i in 1 .. cardinality(u) / 6 loop
      o := o || jsonb_build_object('i', i, 'at', u[6 * i - 4] - 30,
                                   'd', jsonb_build_object('kind', u[6 * i - 5], 'start', u[6 * i - 4], 'end', u[6 * i - 3],
                                                           'p1', u[6 * i - 2], 'p2', u[6 * i - 1], 'p3', u[6 * i]));
    end loop;
  -- 0096 }
  end if;
  return o;
end $$;

-- ---------- C. The two nghề ----------
insert into public.profession_catalog (id, name, icon, sort_order) values
  ('tho_san', 'Thợ săn', '🏹', 9),
  ('tieu_phu', 'Tiều phu', '🪓', 10)
on conflict (id) do update set name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.profession_xp_rules (kind, reason, prof, xp) values
  ('wild_hunt', '', 'tho_san', 10),
  ('wild_trap', '', 'tho_san', 8),
  ('wood_chopped', '', 'tieu_phu', 8)
on conflict (kind, reason, prof) do update set xp = excluded.xp;

insert into public.skill_nodes (id, prof, name, perk, value, cost, req, sort_order) values
  ('h_track', 'tho_san', 'Dấu vết rõ ràng', 'hunt_chance_pct', 5, 1, null, 1),
  ('h_quiet', 'tho_san', 'Bước chân êm', 'hunt_stamina_pct', 50, 1, null, 2),
  ('h_loot', 'tho_san', 'Thu nhặt khéo', 'hunt_drop_pct', 10, 2, 'h_track', 3),
  ('h_night', 'tho_san', 'Thợ săn ban đêm', 'hunt_night_pct', 10, 2, 'h_track', 4),
  ('h_body', 'tho_san', 'Học từ rừng', 'stamina_max', 15, 2, 'h_quiet', 5),
  ('h_big', 'tho_san', 'Đối đầu thú lớn', 'hunt_big', 1, 3, 'h_loot', 6),
  ('l_steady', 'tieu_phu', 'Chặt đều tay', 'chop_miss_bonus', 1, 1, null, 1),
  ('l_grain', 'tieu_phu', 'Mắt nhìn thớ gỗ', 'chop_window_ms', 40, 1, null, 2),
  ('l_breath', 'tieu_phu', 'Giữ lực', 'chop_stamina_pct', 20, 2, 'l_steady', 3),
  ('l_edge', 'tieu_phu', 'Giữ lưỡi rìu', 'axe_save_pct', 25, 2, 'l_grain', 4),
  ('l_gather', 'tieu_phu', 'Gom gỗ khéo', 'wood_extra_pct', 10, 2, 'l_steady', 5),
  ('l_deep', 'tieu_phu', 'Người rừng sâu', 'wood_sell_pct', 10, 3, 'l_gather', 6)
on conflict (id) do update set prof = excluded.prof, name = excluded.name, perk = excluded.perk, value = excluded.value,
  cost = excluded.cost, req = excluded.req, sort_order = excluded.sort_order;

-- The main nghề's level when it is p_prof, else −1.
create or replace function public._prof_main_level(p_account uuid, p_prof text) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select public._prof_level(coalesce(p.xp, 0))
                     from public.player_profession_main m
                     left join public.player_professions p on p.account_id = m.account_id and p.prof = m.prof
                    where m.account_id = p_account and m.prof = p_prof), -1)
$$;
revoke all on function public._prof_main_level(uuid, text) from public, anon, authenticated;

-- ---------- D. Tools and the starter grant ----------
-- id, nghề, name, kind, durability, power (an axe's strike), price (0: not sold), starter (the nghề's tập sự tool)
create or replace function public._prof_tools_catalog() returns table (id text, prof text, name text, kind text, durability integer,
                                                                      power integer, price integer, starter boolean)
language sql immutable parallel safe
as $$
  values ('can_cau_tap_su', 'ngu_dan', 'Cần câu tập sự', 'rod', 60, 1, 0, true),
         ('cuoc_tap_su', 'nong_dan', 'Cuốc tập sự', 'hoe', 60, 1, 0, true),
         ('cuoc_chim_tap_su', 'tho_mo', 'Cuốc chim tập sự', 'pick', 60, 1, 0, true),
         ('chao_tap_su', 'dau_bep', 'Chảo tập sự', 'pan', 60, 1, 0, true),
         ('can_hang_tap_su', 'thuong_nhan', 'Cân hàng tập sự', 'scale', 60, 1, 0, true),
         ('bua_ren_tap_su', 'tho_ren', 'Búa rèn tập sự', 'hammer', 60, 1, 0, true),
         ('cua_tap_su', 'tho_moc', 'Cưa tập sự', 'saw', 60, 1, 0, true),
         ('gang_tay_tap_su', 'vo_si', 'Găng tay tập sự', 'gloves', 60, 1, 0, true),
         ('cung_tap_su', 'tho_san', 'Cung tập sự', 'bow', 60, 1, 0, true),
         ('riu_tap_su', 'tieu_phu', 'Rìu tập sự', 'axe', 60, 1, 80, true),
         ('riu_sat', 'tieu_phu', 'Rìu sắt', 'axe', 120, 2, 450, false),
         ('riu_thep', 'tieu_phu', 'Rìu thép', 'axe', 200, 3, 1600, false),
         ('riu_tinh_luyen', 'tieu_phu', 'Rìu tinh luyện', 'axe', 300, 4, 4500, false)
$$;
revoke all on function public._prof_tools_catalog() from public, anon, authenticated;

create table if not exists public.prof_tools (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item text not null,
  durability integer not null check (durability >= 0),
  max_durability integer not null check (max_durability > 0),
  primary key (account_id, item)
);
create table if not exists public.prof_starter_grants (
  account_id uuid not null references public.accounts(id) on delete cascade,
  prof text not null references public.profession_catalog(id),
  item text not null,
  granted_at timestamptz not null default now(),
  primary key (account_id, prof)
);
alter table public.prof_tools enable row level security;
alter table public.prof_starter_grants enable row level security;
revoke all on public.prof_tools, public.prof_starter_grants from anon, authenticated;

-- The nghề's starter tool, once per account per nghề (the grant row is the "once"); true when granted now.
create or replace function public._prof_grant_starter(p_account uuid, p_prof text) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare t record;
begin
  select * into t from public._prof_tools_catalog() c where c.prof = p_prof and c.starter;
  if not found then return false; end if;
  insert into public.prof_starter_grants (account_id, prof, item) values (p_account, p_prof, t.id) on conflict do nothing;
  if not found then return false; end if;
  insert into public.prof_tools (account_id, item, durability, max_durability) values (p_account, t.id, t.durability, t.durability)
  on conflict (account_id, item) do update set durability = greatest(public.prof_tools.durability, excluded.durability),
                                               max_durability = excluded.max_durability;
  return true;
end $$;
revoke all on function public._prof_grant_starter(uuid, text) from public, anon, authenticated;

-- profession_choose (0077_professions.sql's, verbatim but for the line marked 0096)
create or replace function public.profession_choose(p_session_token text, p_prof text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); m public.player_profession_main; v_coins int;
begin
  if not exists (select 1 from public.profession_catalog where id = p_prof) then
    raise exception 'unknown profession' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);
  select * into m from public.player_profession_main where account_id = v_account for update;
  if found then
    if m.prof = p_prof then raise exception 'same profession' using errcode = '22023'; end if;
    if m.chosen_at > now() - interval '24 hours' then raise exception 'switch cooldown' using errcode = '53400'; end if;
    select coins into v_coins from public.wallets where account_id = v_account;
    if coalesce(v_coins, 0) < 500 then raise exception 'insufficient funds' using errcode = '22023'; end if;
    perform public._pay(v_account, -500, 'profession', 'profession: ' || m.prof || ' -> ' || p_prof);
    update public.player_profession_main set prof = p_prof, chosen_at = now() where account_id = v_account;
  else
    insert into public.player_profession_main (account_id, prof) values (v_account, p_prof);
  end if;
  perform public._prof_grant_starter(v_account, p_prof);                              -- 0096: the starter tool, once
  return public._prof_json(v_account);
end $$;

-- _prof_json (0077_professions.sql's, verbatim but for the lines marked 0096)
create or replace function public._prof_json(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.player_profession_main;
begin
  select * into m from public.player_profession_main where account_id = p_account;
  return jsonb_build_object(
    'main', m.prof,
    'switch_at_ms', case when m.prof is not null then (extract(epoch from m.chosen_at + interval '24 hours') * 1000)::bigint end,
    'switch_fee', 500, 'reset_fee', 300,
    'profs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'xp', coalesce(p.xp, 0), 'level', public._prof_level(p.xp),
        'spent', coalesce((select sum(n.cost) from public.player_skills s join public.skill_nodes n on n.id = s.node
                            where s.account_id = p_account and n.prof = c.id), 0)) order by c.sort_order)
        from public.profession_catalog c
        left join public.player_professions p on p.account_id = p_account and p.prof = c.id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(node order by node) from public.player_skills where account_id = p_account), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('item', t.item, 'durability', t.durability, 'max', t.max_durability)  -- 0096
                                        order by t.item) from public.prof_tools t where t.account_id = p_account), '[]'::jsonb),  -- 0096
    'buffs', coalesce((select jsonb_agg(jsonb_build_object('key', b.kind, 'value', b.power,
                                                           'until_ms', (extract(epoch from b.until) * 1000)::bigint) order by b.kind)
        from public.player_buffs b where b.account_id = p_account and b.until > now()), '[]'::jsonb),
    'stamina', public._stamina_json(p_account),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint);
end $$;

-- the accounts that chose a nghề before 0096 get its starter tool now (re-runnable: the grant row is the once)
select public._prof_grant_starter(m.account_id, m.prof) from public.player_profession_main m;

-- ---------- B. The wild lives in the forest ----------
-- _wild_cap (0075_world_bosses.sql's, verbatim but for the line marked 0096)
create or replace function public._wild_cap(p_map text) returns integer
language sql immutable parallel safe
as $$ select case p_map when 'wild' then 24 else 0 end $$;   -- 0096: was field 6, pond 4, bai_dat 5 — the forest only

-- _wild_fill (0078_v21_fixes.sql's, verbatim but for the lines marked 0096)
create or replace function public._wild_fill(p_map text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_night boolean := public._world_night(); v_live integer; v_sp text; a record;
begin
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

-- the zone maps' animals leave (their maps have none now)
update public.wild_spawns set expires_at = now() where map <> 'wild' and taken_at is null and expires_at > now();

-- wild_start (0087_v22_fixes.sql's, verbatim but for the lines marked 0096)
create or replace function public.wild_start(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; sp public.wild_spawns; s record; p public.wild_profile; g public.world_mg;
        v_ax double precision; v_ay double precision; v_seed bigint := floor(random() * 4294967296)::bigint; v_danger boolean;
        v_u bigint[];                                                                                      -- 0087
begin
  v_acc := public._ac_account(p_session_token);
  if p_action is null or p_action not in ('hunt', 'trap', 'photo') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'wild_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  -- 0096 { the wild animals live in the rừng tràm only: the hunter stands at the forest (the wild, world px)
  if pp.map is distinct from 'wild' or not public._near_forest(pp.x, pp.y) then
    raise exception 'not in forest' using errcode = '22023';
  end if;
  -- 0096 }
  g := public._wg_row(v_acc);
  if g.stun_until > now() then raise exception 'stunned' using errcode = '53400'; end if;
  select * into sp from public.wild_spawns where id = p_spawn for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    raise exception 'gone' using errcode = '22023';
  end if;
  select * into s from public._wild_species() ws where ws.id = sp.species;
  select q.x, q.y into v_ax, v_ay from public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, extract(epoch from now() - sp.born_at)) q;
  if pp.map is distinct from sp.map
     or sqrt((pp.x - v_ax) ^ 2 + (pp.y - v_ay) ^ 2) > (case when p_action = 'photo' then 140 else 64 end) then
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
  perform public._stamina_spend(v_acc, case when p_action = 'photo' then 0.5 else 1 end,
                                case when p_action = 'photo' then null else 'hunt' end);   -- 0096: the hunt_stamina_pct perk
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

-- wild_finish (0087_v22_fixes.sql's, verbatim but for the lines marked 0096)
create or replace function public.wild_finish(p_session_token text, p_a integer[], p_b integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; sp public.wild_spawns; s record; p public.wild_profile; v_bad text; v_rep jsonb;
        v_code text; v_ev jsonb; v_ac jsonb; v_out text; v_rt integer; v_score integer := 0; v_chance integer := 0;
        v_ok boolean := false; v_qty integer := 0; v_knock boolean := false; v_faint boolean := false; v_saved boolean := false;
        v_xp integer := 0; v_gave_up boolean := false; v_n integer := coalesce(cardinality(p_a), 0);
        l public.mg_live;                                                                                  -- 0087
        pp public.player_pos; v_lv integer; v_extra integer := 0;                                          -- 0096
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
  if pp.map is distinct from 'wild' or not public._near_forest(pp.x, pp.y) then
    return jsonb_build_object('result', 'lost', 'why', 'not in forest', 'outcome', v_out, 'score', v_score, 'knocked', v_knock,
                              'fainted', v_faint, 'wild', public._wild_json(v_acc, sp.map));
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
                              'wild', public._wild_json(v_acc, sp.map));
  end if;

  v_chance := public._wg_chance(case when g.kind = 'hunt' then s.hunt else s.trap end, v_score,
                                not v_gave_up and v_out in ('hit', 'caught'));
  -- 0096 { Thợ săn (main nghề): + (5 + level) points; the skills' points (+ the night skill after dark); ≤ 95. A miss stays 0.
  v_lv := public._prof_main_level(v_acc, 'tho_san');
  if v_chance > 0 then
    v_chance := least(95, v_chance + case when v_lv >= 0 then 5 + v_lv else 0 end
                                   + floor(public._perk(v_acc, 'hunt_chance_pct'))::int
                                   + case when public._world_night() then floor(public._perk(v_acc, 'hunt_night_pct'))::int else 0 end);
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
    if sp.species in ('wolf', 'bear') and public._perk(v_acc, 'hunt_big') > 0 then v_extra := v_extra + 1; end if;
    v_qty := v_qty + v_extra;
    -- 0096 }
    insert into public.wild_bag (account_id, item, qty) values (v_acc, s.drop_item, v_qty)
    on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
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
                            'knocked', v_knock, 'fainted', v_faint, 'wild', public._wild_json(v_acc, sp.map));
end $$;

-- ---------- E. Chopping ----------
-- id, name, strikes needed, respawn (min), the log, logs, price per log, rare (Hiếm+), upto (the kind hash < upto of 1000)
create or replace function public._forest_trees() returns table (id text, name text, need integer, respawn_min integer, log text,
                                                                 logs integer, price integer, rare boolean, upto integer)
language sql immutable parallel safe
as $$
  values ('cay_tre', 'Tre', 3, 2, 'go_tre', 2, 12, false, 350),
         ('cay_keo', 'Keo', 4, 3, 'go_keo', 2, 18, false, 650),
         ('cay_thong', 'Thông', 5, 5, 'go_thong', 2, 28, false, 820),
         ('cay_soi', 'Sồi', 7, 8, 'go_soi', 2, 45, true, 920),
         ('cay_go_do', 'Gõ đỏ', 9, 15, 'go_do', 2, 75, true, 970),
         ('cay_tram_huong', 'Trầm hương', 12, 45, 'go_tram_huong', 1, 220, true, 993),
         ('cay_than_moc', 'Thần mộc', 16, 120, 'go_than_moc', 1, 480, true, 1000)
$$;
-- The kind of the tree k of cell (cx, cy) (lib/game/forest/trees.ts treeOf).
create or replace function public._tree_of(p_cx integer, p_cy integer, p_k integer) returns text
language sql immutable parallel safe
as $$
  select t.id from public._forest_trees() t
   where ((p_cx::bigint * 7919 + p_cy::bigint * 104729 + p_k::bigint * 1543) % 1000) < t.upto
   order by t.upto limit 1
$$;
revoke all on function public._forest_trees() from public, anon, authenticated;
revoke all on function public._tree_of(integer, integer, integer) from public, anon, authenticated;

create table if not exists public.forest_felled (
  tree_key text primary key,
  account_id uuid references public.accounts(id) on delete set null,
  felled_at timestamptz not null default now(),
  respawn_at timestamptz not null
);
create table if not exists public.chop_progress (
  account_id uuid not null references public.accounts(id) on delete cascade,
  tree_key text not null,
  hits integer not null default 0,
  at timestamptz not null default now(),
  primary key (account_id, tree_key)
);
create table if not exists public.chop_profile (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_at timestamptz,
  day date,
  logs integer not null default 0
);
create table if not exists public.wood_bag (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item text not null,
  qty integer not null default 0 check (qty >= 0),       -- full price
  half integer not null default 0 check (half >= 0),     -- beyond the day's 40: half price
  primary key (account_id, item)
);
alter table public.forest_felled enable row level security;
alter table public.chop_progress enable row level security;
alter table public.chop_profile enable row level security;
alter table public.wood_bag enable row level security;
revoke all on public.forest_felled, public.chop_progress, public.chop_profile, public.wood_bag from anon, authenticated;

-- The beats hit (lib/game/forest/chop.ts chopHits): beat by beat, the first unused press within ±p_win ticks.
create or replace function public._chop_hits(p_beats bigint[], p_win integer, p_presses integer[]) returns jsonb
language plpgsql immutable
as $$
declare used boolean[] := array_fill(false, array[greatest(1, coalesce(cardinality(p_presses), 0))]); hits integer := 0;
        o jsonb := '[]'::jsonb;
begin
  for i in 1 .. 3 loop
    for j in 1 .. coalesce(cardinality(p_presses), 0) loop
      if not used[j] and abs(p_presses[j] - p_beats[i]) <= p_win then
        used[j] := true;
        hits := hits + 1;
        o := o || jsonb_build_object('beat', i, 'press', j, 'off', p_presses[j] - p_beats[i]);
        exit;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('hits', hits, 'pairs', o);
end $$;
revoke all on function public._chop_hits(bigint[], integer, integer[]) from public, anon, authenticated;

-- the kitchen's tables (F; _forest_json reads them)
create table if not exists public.cooked_dishes (
  account_id uuid not null references public.accounts(id) on delete cascade,
  dish text not null,
  quality smallint not null check (quality between 0 and 3),   -- 0 Hỏng, 1 Đạt, 2 Ngon, 3 Tuyệt phẩm
  qty integer not null default 0 check (qty >= 0),
  primary key (account_id, dish, quality)
);
create table if not exists public.cook_profile (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_at timestamptz
);
alter table public.cooked_dishes enable row level security;
alter table public.cook_profile enable row level security;
revoke all on public.cooked_dishes, public.cook_profile from anon, authenticated;
-- The shared forest shape of the state answer (the stall panel and the HUD).
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
                       where b.account_id = p_account and b.qty > 0 and b.item = 'thit_tho'), '{}'::jsonb),
    'main', (select m.prof from public.player_profession_main m where m.account_id = p_account),
    'felled', coalesce((select jsonb_agg(jsonb_build_object('tree', f.tree_key,
                                                           'respawn_ms', (extract(epoch from f.respawn_at) * 1000)::bigint))
                          from public.forest_felled f where f.respawn_at > now()), '[]'::jsonb),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;

revoke all on function public._forest_json(uuid) from public, anon, authenticated;

create or replace function public.chop_start(p_session_token text, p_cx integer, p_cy integer, p_k integer, p_map text,
                                             p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; v_key text; tr record; ax record; pr public.chop_profile;
        v_have integer; b1 integer; b2 integer; b3 integer; v_win integer;
begin
  v_acc := public._ac_account(p_session_token);
  if p_k is null or p_k not between 0 and 7 or p_cx is null or p_cy is null then
    raise exception 'bad tree' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'chop_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  if pp.map is distinct from 'wild' or not public._near_forest(pp.x, pp.y) then
    raise exception 'not in forest' using errcode = '22023';
  end if;
  if not exists (select 1 from public.world_forest f where f.cx = p_cx and f.cy = p_cy) then
    raise exception 'bad tree' using errcode = '22023';
  end if;
  if abs(floor(pp.x / 64) - p_cx) > 1 or abs(floor(pp.y / 64) - p_cy) > 1 then
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
  perform public._stamina_spend(v_acc, 4, 'chop');
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

create or replace function public.chop_finish(p_session_token text, p_presses integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; l public.mg_live; u bigint[]; v_win integer; v_bad text; v_code text; v_ev jsonb; v_rep jsonb; x jsonb;
        v_hits integer; v_blows integer; v_end integer; tr record; v_key text; v_have integer; v_felled boolean := false;
        v_qty integer := 0; v_full integer := 0; pr public.chop_profile; v_dur integer; v_axe text; v_power integer;
        v_regular boolean := true; v_xp integer := 0;
begin
  v_acc := public._ac_account(p_session_token);
  l := public._mg_close(v_acc, 'chop', 'chop', p_presses, null);
  if l.account_id is null then raise exception 'round not found' using errcode = '22023'; end if;
  if l.opened_at < now() - interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  u := l.params;
  v_win := (l.meta->>'win')::int;
  v_key := l.meta->>'tree';
  v_axe := l.meta->>'axe';
  v_power := (l.meta->>'power')::int;
  v_end := u[3]::int + 45;
  v_ev := jsonb_build_object('tree', v_key, 'presses', to_jsonb(l.a[1:8]));
  v_bad := l.meta->>'err';
  if v_bad is null and coalesce(cardinality(l.a), 0) > 6 then v_bad := 'too_many'; end if;
  if v_bad is null and l.started_at is null then
    return jsonb_build_object('result', 'lost', 'why', 'not played');
  end if;
  v_rep := public._chop_hits(u, v_win, l.a);
  -- a hit claimed less than 0.1 s after its beat's reveal: nobody reacts that fast
  if v_bad is null then
    for x in select * from jsonb_array_elements(v_rep->'pairs') loop
      if l.seen[(x->>'beat')::int] is null
         or l.started_at + make_interval(secs => l.a[(x->>'press')::int] / 60.0) < l.seen[(x->>'beat')::int] + interval '100 milliseconds' then
        v_bad := 'early';
      end if;
      if abs((x->>'off')::int) > 1 then v_regular := false; end if;
    end loop;
  end if;
  if v_bad is not null then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'chop_bad_input', 'chop_finish', v_ev || jsonb_build_object('error', v_bad), null, 'invalid round');
  end if;
  if now() < l.started_at + make_interval(secs => 0.9 * v_end / 60.0) then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'chop_too_fast', 'chop_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, 'invalid round');
  end if;
  if public._mg_late(l) then
    perform public._ac_flag(v_acc, 'chop_late', 'chop_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    return jsonb_build_object('result', 'lost', 'why', 'late');
  end if;
  v_hits := (v_rep->>'hits')::int;
  if v_hits = 3 and v_regular then
    v_code := public._craft_timing(v_acc, 'chop_timing', 'chop_finish', v_ev || jsonb_build_object('replay', v_rep));
    if v_code is not null then
      return jsonb_build_object('result', 'lost', 'why', 'refused')
             || public._ac_flag(v_acc, v_code, 'chop_finish', v_ev, null, 'invalid round');
    end if;
  end if;

  v_blows := v_hits * v_power + (3 - v_hits)
           + case when v_hits < 3 and public._perk(v_acc, 'chop_miss_bonus') > 0 then 1 else 0 end;
  -- the axe wears (Giữ lưỡi rìu may keep the edge)
  if not (random() * 100 < least(50, public._perk(v_acc, 'axe_save_pct'))) then
    update public.prof_tools set durability = greatest(0, durability - 1) where account_id = v_acc and item = v_axe
    returning durability into v_dur;
  else
    select durability into v_dur from public.prof_tools where account_id = v_acc and item = v_axe;
  end if;

  select * into tr from public._forest_trees() t where t.id = l.meta->>'kind';
  perform pg_advisory_xact_lock(hashtext('tree:' || v_key));
  if exists (select 1 from public.forest_felled f where f.tree_key = v_key and f.respawn_at > now()) then
    return jsonb_build_object('result', 'lost', 'why', 'felled', 'hits', v_hits, 'durability', v_dur);
  end if;
  insert into public.chop_progress (account_id, tree_key, hits, at) values (v_acc, v_key, v_blows, now())
  on conflict (account_id, tree_key) do update
    set hits = case when public.chop_progress.at > now() - interval '30 minutes' then public.chop_progress.hits else 0 end
               + excluded.hits,
        at = now()
  returning hits into v_have;
  if v_have >= tr.need then
    v_felled := true;
    delete from public.chop_progress where tree_key = v_key;
    insert into public.forest_felled (tree_key, account_id, felled_at, respawn_at)
    values (v_key, v_acc, now(), now() + make_interval(mins => tr.respawn_min))
    on conflict (tree_key) do update set account_id = excluded.account_id, felled_at = excluded.felled_at, respawn_at = excluded.respawn_at;
    v_qty := tr.logs + case when random() * 100 < least(50, public._perk(v_acc, 'wood_extra_pct')) then 1 else 0 end;
    insert into public.chop_profile (account_id) values (v_acc) on conflict do nothing;
    select * into pr from public.chop_profile where account_id = v_acc for update;
    if pr.day is distinct from public._vn_today() then pr.day := public._vn_today(); pr.logs := 0; end if;
    v_full := greatest(0, least(v_qty, 40 - pr.logs));
    update public.chop_profile set day = pr.day, logs = pr.logs + v_qty where account_id = v_acc;
    insert into public.wood_bag (account_id, item, qty, half) values (v_acc, tr.log, v_full, v_qty - v_full)
    on conflict (account_id, item) do update set qty = public.wood_bag.qty + excluded.qty, half = public.wood_bag.half + excluded.half;
    v_xp := greatest(1, (2 * v_full + (v_qty - v_full)) * case when tr.rare then 2 else 1 end);
    perform public._game_event(v_acc, 'wood_chopped', v_qty, jsonb_build_object('tree', tr.id, 'log', tr.log, 'hits', v_hits));
    perform public._game_event(v_acc, 'xp_grant', v_xp, jsonb_build_object('source', 'wood'));
  end if;
  -- the day-old progress of anyone, in a bounded batch
  delete from public.chop_progress where (account_id, tree_key) in
    (select c.account_id, c.tree_key from public.chop_progress c where c.at < now() - interval '1 day' limit 100);
  return jsonb_build_object('result', case when v_felled then 'felled' else 'ok' end, 'hits', v_hits, 'blows', v_blows,
                            'have', case when v_felled then tr.need else v_have end, 'need', tr.need, 'kind', tr.id,
                            'log', case when v_felled then tr.log end, 'qty', v_qty, 'full', v_full, 'xp', v_xp,
                            'durability', v_dur, 'forest', public._forest_json(v_acc));
end $$;

-- Sell logs at the hunter's stall: the full-price ones first, then the half-price ones.
create or replace function public.wood_sell(p_session_token text, p_item text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; v_price integer; w public.wood_bag; v_full integer; v_half integer; v_pay integer; v_bal integer;
begin
  v_acc := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'wood_sell', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  select t.price into v_price from public._forest_trees() t where t.log = p_item;
  if v_price is null then raise exception 'invalid item' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 999 then
    return public._ac_flag(v_acc, 'bad_qty', 'wood_sell', jsonb_build_object('item', left(p_item, 16), 'qty', p_qty), null, 'invalid quantity');
  end if;
  perform public._wallet_lock(v_acc);
  select * into w from public.wood_bag where account_id = v_acc and item = p_item for update;
  if not found or w.qty + w.half < p_qty then raise exception 'not enough' using errcode = '22023'; end if;
  v_full := least(w.qty, p_qty);
  v_half := p_qty - v_full;
  update public.wood_bag set qty = qty - v_full, half = half - v_half where account_id = v_acc and item = p_item;
  v_pay := (v_price * v_full + (v_price * v_half) / 2) * (100 + least(20, floor(public._perk(v_acc, 'wood_sell_pct'))::int)) / 100;
  v_bal := public._pay(v_acc, v_pay, 'wood_sell', p_item || ' x' || p_qty || case when v_half > 0 then ' (' || v_half || ' nửa giá)' else '' end);
  return jsonb_build_object('earned', v_pay, 'coins', v_bal, 'forest', public._forest_json(v_acc));
end $$;

-- Buy an axe at the stall (a full one: buying again replaces a worn one).
create or replace function public.tool_buy(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; t record; v_coins integer; v_bal integer;
begin
  v_acc := public._ac_account(p_session_token);
  select * into t from public._prof_tools_catalog() c where c.id = p_item and c.price > 0;
  if not found then raise exception 'invalid item' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'tool_buy', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_acc);
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < t.price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_acc, -t.price, 'tool_buy', 'tool: ' || t.id);
  insert into public.prof_tools (account_id, item, durability, max_durability) values (v_acc, t.id, t.durability, t.durability)
  on conflict (account_id, item) do update set durability = excluded.durability, max_durability = excluded.max_durability;
  return jsonb_build_object('coins', v_bal, 'forest', public._forest_json(v_acc));
end $$;

create or replace function public.forest_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid := public._ac_account(p_session_token);
begin
  return public._forest_json(v_acc);
end $$;

-- ---------- F. Cooking ----------
-- id, name, the meat (wild_bag) and how many, the fee (bought rice, greens, spices), the steps, the price (Đạt), stamina
create or replace function public._cook_recipes() returns table (id text, name text, meat text, meat_qty integer, fee integer,
                                                                 steps text[], price integer, stamina integer)
language sql immutable parallel safe
as $$
  values ('com_thit_tho', 'Cơm thịt thỏ', 'thit_tho', 1, 20, array['slice', 'fire'], 140, 15),
         ('com_rau_nam', 'Cơm rau nấm', null, 0, 60, array['slice', 'stir', 'fire'], 100, 12)
$$;
-- The quality from the score, and its % of the price / the stamina.
create or replace function public._cook_quality(p_score integer) returns integer
language sql immutable parallel safe
as $$ select case when p_score >= 90 then 3 when p_score >= 70 then 2 when p_score >= 40 then 1 else 0 end $$;
create or replace function public._cook_pct(p_quality integer) returns integer
language sql immutable parallel safe
as $$ select case p_quality when 3 then 150 when 2 then 125 when 1 then 100 else 20 end $$;

-- The steps' scores and the dish's (lib/game/forest/cook.ts cookScore): u = 6 params a step (kind, start, end, p1, p2,
-- p3); a = presses, b = releases (ticks). Thái: two beats p1, p2 — each 100 − 4 × the nearest press's distance (in the
-- step); khuấy: the first press in the step, the first release after it (≤ end) — 100 − 2 × |hold − p1|; canh lửa: the
-- first press in the step stops the heat, a triangle 0…100…0 of period p1 and phase p2 — 100 − 3 × |heat − p3|.
create or replace function public._cook_score(u bigint[], p_a integer[], p_b integer[]) returns jsonb
language plpgsql immutable
as $$
declare n integer := cardinality(u) / 6; k integer; st integer; en integer; sc integer; tot integer := 0; o jsonb := '[]'::jsonb;
        best integer; bt integer; p integer; r integer; t integer; x integer; heat integer;
begin
  for i in 1 .. n loop
    k := u[6 * i - 5]; st := u[6 * i - 4]; en := u[6 * i - 3];
    sc := 0;
    if k = 1 then
      for q in 1 .. 2 loop
        bt := u[6 * i - 3 + q];
        best := null;
        foreach t in array coalesce(p_a, '{}') loop
          if t >= st and t < en then best := least(coalesce(best, abs(t - bt)), abs(t - bt)); end if;
        end loop;
        sc := sc + greatest(0, 100 - 4 * coalesce(best, 1000));
      end loop;
      sc := sc / 2;
    elsif k = 2 then
      p := null; r := null;
      foreach t in array coalesce(p_a, '{}') loop
        if t >= st and t < en then p := t; exit; end if;
      end loop;
      if p is not null then
        foreach t in array coalesce(p_b, '{}') loop
          if t > p and t <= en then r := t; exit; end if;
        end loop;
      end if;
      if r is not null then sc := greatest(0, 100 - 2 * abs((r - p) - u[6 * i - 2]::int)); end if;
    else
      p := null;
      foreach t in array coalesce(p_a, '{}') loop
        if t >= st and t < en then p := t; exit; end if;
      end loop;
      if p is not null then
        x := ((p - st) + u[6 * i - 1]::int) % u[6 * i - 2]::int;
        heat := case when 2 * x < u[6 * i - 2] then (200 * x) / u[6 * i - 2]::int else 200 - (200 * x) / u[6 * i - 2]::int end;
        sc := greatest(0, 100 - 3 * abs(heat - u[6 * i]::int));
      end if;
    end if;
    tot := tot + sc;
    o := o || to_jsonb(sc);
  end loop;
  return jsonb_build_object('steps', o, 'score', case when n > 0 then tot / n else 0 end);
end $$;
revoke all on function public._cook_recipes() from public, anon, authenticated;
revoke all on function public._cook_quality(integer) from public, anon, authenticated;
revoke all on function public._cook_pct(integer) from public, anon, authenticated;
revoke all on function public._cook_score(bigint[], integer[], integer[]) from public, anon, authenticated;

create or replace function public.cook_start(p_session_token text, p_recipe text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; cp public.cook_profile; v_have integer; v_coins integer; v_u bigint[] := '{}'; v_t integer := 60;
        v_step text; b1 integer; b2 integer; v_hold integer; v_per integer;
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
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < r.fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  if r.meat is not null then
    select qty into v_have from public.wild_bag where account_id = v_acc and item = r.meat for update;
    if coalesce(v_have, 0) < r.meat_qty then raise exception 'no ingredients' using errcode = '22023'; end if;
    update public.wild_bag set qty = qty - r.meat_qty where account_id = v_acc and item = r.meat;
  end if;
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

create or replace function public.cook_finish(p_session_token text, p_a integer[], p_b integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; l public.mg_live; u bigint[]; n integer; v_end integer; v_bad text; v_ev jsonb; v_rep jsonb; v_score integer;
        v_q integer; v_code text; r record; t integer; st integer; en integer;
begin
  v_acc := public._ac_account(p_session_token);
  l := public._mg_close(v_acc, 'cook', 'cook', p_a, p_b);
  if l.account_id is null then raise exception 'round not found' using errcode = '22023'; end if;
  if l.opened_at < now() - interval '90 seconds' then return jsonb_build_object('result', 'lost', 'why', 'expired'); end if;
  if l.started_at is null then return jsonb_build_object('result', 'lost', 'why', 'not played'); end if;
  u := l.params;
  n := cardinality(u) / 6;
  v_end := u[6 * n - 3]::int;
  select * into r from public._cook_recipes() c where c.id = l.meta->>'recipe';
  v_ev := jsonb_build_object('recipe', r.id, 'a', to_jsonb(l.a[1:12]), 'b', to_jsonb(l.b[1:12]));
  v_bad := l.meta->>'err';
  if v_bad is null and (coalesce(cardinality(l.a), 0) > 12 or coalesce(cardinality(l.b), 0) > 6) then v_bad := 'too_many'; end if;
  -- an input in a step claimed less than 0.1 s after the step's reveal
  if v_bad is null then
    for i in 1 .. n loop
      st := u[6 * i - 4]; en := u[6 * i - 3];
      foreach t in array (l.a || l.b) loop
        if t >= st and t <= en and (l.seen[i] is null
            or l.started_at + make_interval(secs => t / 60.0) < l.seen[i] + interval '100 milliseconds') then
          v_bad := 'early';
        end if;
      end loop;
    end loop;
  end if;
  if v_bad is not null then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'cook_bad_input', 'cook_finish', v_ev || jsonb_build_object('error', v_bad), null, 'invalid round');
  end if;
  if now() < l.started_at + make_interval(secs => 0.9 * v_end / 60.0) then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'cook_too_fast', 'cook_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, 'invalid round');
  end if;
  if public._mg_late(l) then
    perform public._ac_flag(v_acc, 'cook_late', 'cook_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    return jsonb_build_object('result', 'lost', 'why', 'late');
  end if;
  v_rep := public._cook_score(u, l.a, l.b);
  v_score := (v_rep->>'score')::int;
  if v_score >= 100 then
    v_code := public._craft_timing(v_acc, 'cook_timing', 'cook_finish', v_ev || jsonb_build_object('replay', v_rep));
    if v_code is not null then
      return jsonb_build_object('result', 'lost', 'why', 'refused')
             || public._ac_flag(v_acc, v_code, 'cook_finish', v_ev, null, 'invalid round');
    end if;
  end if;
  v_q := public._cook_quality(v_score);
  insert into public.cooked_dishes (account_id, dish, quality, qty) values (v_acc, r.id, v_q, 1)
  on conflict (account_id, dish, quality) do update set qty = public.cooked_dishes.qty + 1;
  perform public._game_event(v_acc, 'food_cooked', 1, jsonb_build_object('recipe', r.id, 'quality', v_q, 'score', v_score));
  perform public._game_event(v_acc, 'xp_grant', 2 + v_q * 2, jsonb_build_object('source', 'cook'));
  return jsonb_build_object('result', 'ok', 'dish', r.id, 'score', v_score, 'steps', v_rep->'steps', 'quality', v_q,
                            'forest', public._forest_json(v_acc));
end $$;

create or replace function public.cook_sell(p_session_token text, p_dish text, p_quality integer, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; r record; v_have integer; v_pay integer; v_bal integer;
begin
  v_acc := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'cook_sell', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  select * into r from public._cook_recipes() c where c.id = p_dish;
  if not found or p_quality is null or p_quality not between 0 and 3 then raise exception 'invalid item' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return public._ac_flag(v_acc, 'bad_qty', 'cook_sell', jsonb_build_object('dish', left(p_dish, 16), 'qty', p_qty), null, 'invalid quantity');
  end if;
  perform public._wallet_lock(v_acc);
  select qty into v_have from public.cooked_dishes where account_id = v_acc and dish = p_dish and quality = p_quality for update;
  if coalesce(v_have, 0) < p_qty then raise exception 'not enough' using errcode = '22023'; end if;
  update public.cooked_dishes set qty = qty - p_qty where account_id = v_acc and dish = p_dish and quality = p_quality;
  v_pay := (r.price * public._cook_pct(p_quality) / 100) * p_qty;
  v_bal := public._pay(v_acc, v_pay, 'dish_sell', p_dish || ' q' || p_quality || ' x' || p_qty);
  return jsonb_build_object('earned', v_pay, 'coins', v_bal, 'forest', public._forest_json(v_acc));
end $$;

-- Eat a dish: the recipe's stamina × the quality's % (a Hỏng dish fills nothing), capped at the bar.
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
  return jsonb_build_object('gained', v_gain, 'stamina', public._stamina_json(v_acc), 'forest', public._forest_json(v_acc));
end $$;

-- ---------- I. The ledger ----------
-- 0069_v21_events.sql's reason check, verbatim but for the lines marked 0096
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture',
                    'house_land','house_upkeep','house_build','house_refund','house_rent_pay','house_rent_income',
                    'estate_sale','estate_buy',
                    'dojo_tuition','dojo_exam',
                    'fight_stake','fight_win','fight_refund',
                    'ug_entry','ug_prize','ug_refund',
                    -- v21
                    'login_reward','level_reward','quest_reward','achievement_reward','collection_reward',
                    'ore_sell','mine_tool','potion','upgrade','gem_sell',
                    'trade','market_list','market_sell','market_buy','market_refund','auction_bid','auction_refund',
                    'auction_sell','shop_rent','shop_sell','shop_buy',
                    'pet_gacha','pet_train','pet_battle','aquarium','fish_battle',
                    'boss_reward','dungeon_entry','dungeon_reward','wild_sell',
                    'fishing_battle_entry','fishing_battle_prize','fishing_battle_refund','boat','treasure','machine',
                    'profession','skill_reset','buff_food',
                    'teleport','photo','arena_team_stake','arena_team_win','arena_team_refund',
                    -- 0096
                    'wood_sell','tool_buy','cook_fee','dish_sell'));

-- ---------- J. The wipe ----------
create or replace function public._forest_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.wood_bag where account_id = new.account_id;
  delete from public.cooked_dishes where account_id = new.account_id;
  delete from public.chop_progress where account_id = new.account_id;
  delete from public.chop_profile where account_id = new.account_id;
  delete from public.cook_profile where account_id = new.account_id;
  delete from public.prof_tools where account_id = new.account_id;
  return new;
end $$;
revoke all on function public._forest_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_forest on public.anticheat_wipes;
create trigger anticheat_wipes_forest after insert on public.anticheat_wipes for each row execute function public._forest_on_wipe();

-- ---------- Grants ----------
revoke all on function public.chop_start(text, integer, integer, integer, text, integer, integer) from public;
revoke all on function public.chop_finish(text, integer[]) from public;
revoke all on function public.wood_sell(text, text, integer) from public;
revoke all on function public.tool_buy(text, text) from public;
revoke all on function public.forest_state(text) from public;
revoke all on function public.cook_start(text, text) from public;
revoke all on function public.cook_finish(text, integer[], integer[]) from public;
revoke all on function public.cook_sell(text, text, integer, integer) from public;
revoke all on function public.cook_eat(text, text, integer) from public;
grant execute on function public.chop_start(text, integer, integer, integer, text, integer, integer) to anon, authenticated;
grant execute on function public.chop_finish(text, integer[]) to anon, authenticated;
grant execute on function public.wood_sell(text, text, integer) to anon, authenticated;
grant execute on function public.tool_buy(text, text) to anon, authenticated;
grant execute on function public.forest_state(text) to anon, authenticated;
grant execute on function public.cook_start(text, text) to anon, authenticated;
grant execute on function public.cook_finish(text, integer[], integer[]) to anon, authenticated;
grant execute on function public.cook_sell(text, text, integer, integer) to anon, authenticated;
grant execute on function public.cook_eat(text, text, integer) to anon, authenticated;
