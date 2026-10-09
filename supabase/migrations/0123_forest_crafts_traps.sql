-- =========================================================
-- 0123_forest_crafts_traps.sql — Rừng tràm, round two (owner request 2026-10-07): carpentry, traps as items, charcoal,
-- and the tool prices rebalanced against today's log / meat / dish prices. ADDITIVE and re-runnable. Run after 0122.
-- Every re-created function is its newest body (named above it) plus the lines marked "-- 0123" (an added or changed
-- line, "was:" quoting the old one) or "-- 0123 {" … "-- 0123 }" (an added block).
--   A. Tools rebalanced (_prof_tools_catalog): bows, pans and axes last several sessions and pay back in ≈ 4–6 of them
--      (the numbers and the reasoning are in docs; the table is in the PR). Tools already owned get the new maximum and
--      the difference in durability (nobody loses wear they paid for).
--   B. Forest items in the shop catalogue (kind 'forest', in `inventory`): bay_go (Bẫy gỗ: 120 xu or crafted, 6 catches),
--      bay_sat (Bẫy sắt: 450 xu, 15 catches, quicker), than_cui (Than củi: crafted only; worth 15). forest_buy sells the
--      two traps at the hunter's stall. Gift codes may carry them (_mail_gift_kinds).
--   C. Carpentry (Thợ mộc as the main nghề, a saw): carpenter_craft turns logs into furniture (the shop's wooden pieces,
--      to the account's storage — cheaper than the shop, so logs keep a value without minting xu), traps and charcoal.
--      2 stamina, 1 saw durability, a fee paid as 'furniture' (Thợ mộc's furniture perk applies); half-price logs are
--      used first. Emits furniture_crafted (Thợ mộc XP) and item_crafted.
--   D. Charcoal in the kitchen: cook_start burns one than củi when the cook has any; the dish gets +5 points
--      (_coal_bonus, after the perfect-timing check, like the pan's).
--   E. Traps: trap_place puts one in the forest (at most 3 per account, 32 px apart, on a forest cell, where I stand);
--      trap_check (beside it, at most every 30 s) rolls a catch on the server: 1 − e^(−minutes/τ) since its last catch
--      (τ 30 min for wood, 18 for iron; nothing before 5 min, at most 4 h counted), a trappable animal of the hour, the
--      day's 40 kills shared with hunting; each catch wears it one point and it breaks at 0. trap_take picks it up — back
--      to the bag only while unused. Checking more often does not catch more: the odds run on the clock, not the calls.
--   F. _forest_json carries my traps and my forest items; the anti-cheat wipe and the Beta reset clear the new tables.
-- =========================================================

-- ---------- A. Tools ----------
-- _prof_tools_catalog (0097_forest_complete.sql, verbatim but for the rows marked 0123)
create or replace function public._prof_tools_catalog() returns table (id text, prof text, name text, kind text, durability integer,
                                                                      power integer, price integer, starter boolean,
                                                                      repair_pp integer)
language sql immutable parallel safe
as $$
  values ('can_cau_tap_su', 'ngu_dan', 'Cần câu tập sự', 'rod', 60, 1, 60, true, 1),
         ('cuoc_tap_su', 'nong_dan', 'Cuốc tập sự', 'hoe', 60, 1, 60, true, 1),
         ('cuoc_chim_tap_su', 'tho_mo', 'Cuốc chim tập sự', 'pick', 60, 1, 80, true, 1),
         ('chao_tap_su', 'dau_bep', 'Chảo tập sự', 'pan', 80, 1, 80, true, 1),   -- 0123: was durability 60, price 80, repair 1 a point
         ('can_hang_tap_su', 'thuong_nhan', 'Cân hàng tập sự', 'scale', 60, 1, 60, true, 1),
         ('bua_ren_tap_su', 'tho_ren', 'Búa rèn tập sự', 'hammer', 60, 1, 80, true, 1),
         ('cua_tap_su', 'tho_moc', 'Cưa tập sự', 'saw', 100, 1, 80, true, 1),   -- 0123: was durability 60, price 80, repair 1 a point
         ('gang_tay_tap_su', 'vo_si', 'Găng tay tập sự', 'gloves', 60, 1, 60, true, 1),
         ('cung_tap_su', 'tho_san', 'Cung tập sự', 'bow', 80, 1, 100, true, 1),   -- 0123: was durability 60, price 100, repair 1 a point
         ('riu_tap_su', 'tieu_phu', 'Rìu tập sự', 'axe', 100, 1, 80, true, 1),   -- 0123: was durability 60, price 80, repair 1 a point
         ('cung_tre', 'tho_san', 'Cung tre', 'bow', 200, 1, 200, false, 1),   -- 0123: was durability 60, price 280, repair 2 a point
         ('cung_go_tram', 'tho_san', 'Cung gỗ tràm', 'bow', 200, 2, 700, false, 1),   -- 0123: was durability 110, price 850, repair 3 a point
         ('cung_go_cung', 'tho_san', 'Cung gỗ cứng', 'bow', 300, 3, 1500, false, 2),   -- 0123: was durability 180, price 1800, repair 4 a point
         ('noi_dat', 'dau_bep', 'Nồi đất', 'pan', 200, 1, 150, false, 1),   -- 0123: was durability 70, price 240, repair 1 a point
         ('chao_gang', 'dau_bep', 'Chảo gang', 'pan', 200, 2, 600, false, 1),   -- 0123: was durability 130, price 720, repair 2 a point
         ('noi_gang', 'dau_bep', 'Nồi gang', 'pan', 300, 3, 1200, false, 2),   -- 0123: was durability 210, price 1500, repair 3 a point
         ('riu_sat', 'tieu_phu', 'Rìu sắt', 'axe', 200, 2, 450, false, 1),   -- 0123: was durability 80, price 300, repair 2 a point
         ('riu_thep', 'tieu_phu', 'Rìu thép', 'axe', 300, 3, 900, false, 1),   -- 0123: was durability 140, price 900, repair 3 a point
         ('riu_thep_toi', 'tieu_phu', 'Rìu thép tôi', 'axe', 400, 4, 1300, false, 1),   -- 0123: was durability 220, price 1900, repair 4 a point
         ('riu_tinh_luyen', 'tieu_phu', 'Rìu tinh luyện', 'axe', 800, 4, 2000, false, 1)   -- 0123: was durability 300, price 4500, repair 4 a point
$$;
revoke all on function public._prof_tools_catalog() from public, anon, authenticated;

-- Tools already owned: the new maximum, and the difference added to what is left.
update public.prof_tools t set durability = t.durability + (c.durability - t.max_durability), max_durability = c.durability
  from public._prof_tools_catalog() c
 where c.id = t.item and t.max_durability < c.durability;

-- ---------- B. Forest items ----------
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food',
                  'net','fishing_kit',
                  'hook','line','reel','groundbait','fishbook',
                  'forest'));   -- 0123: traps and charcoal

insert into public.shop_items (id, kind, name, price, starter, sort_order, durability) values
  ('bay_go',   'forest', 'Bẫy gỗ',   120, false, 10, 6),
  ('bay_sat',  'forest', 'Bẫy sắt',  450, false, 20, 15),
  ('than_cui', 'forest', 'Than củi',  15, false, 30, null)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, durability = excluded.durability;

-- _mail_gift_kinds (0115_rod_builds.sql, verbatim but for the line marked 0123)
create or replace function public._mail_gift_kinds() returns text[]
language sql immutable parallel safe
as $$ select array['bait', 'seed', 'fertilizer', 'pesticide', 'ammo', 'pet_food', 'rod', 'hook', 'line', 'reel', 'bobber',
                   'forest'] $$;   -- 0123: + forest (0115 was: as $$ select array['bait', 'seed', 'fertilizer', 'pesticide', 'ammo', 'pet_food'] $$;)

revoke all on function public._mail_gift_kinds() from public, anon, authenticated;

-- The traps the stall sells (than củi is crafted only).
create or replace function public._forest_shop() returns text[]
language sql immutable parallel safe
as $$ select array['bay_go', 'bay_sat'] $$;
revoke all on function public._forest_shop() from public, anon, authenticated;

-- Buy traps at the hunter's stall: 1 … 10 at a time, at most 99 in the bag.
create or replace function public.forest_buy(p_session_token text, p_item text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; it public.shop_items; v_cost integer; v_coins integer; v_have integer; v_bal integer;
begin
  v_acc := public._ac_account(p_session_token);
  select * into it from public.shop_items where id = p_item and kind = 'forest' and id = any(public._forest_shop());
  if not found then raise exception 'invalid item' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'invalid quantity' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'forest_buy', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_acc);
  select qty into v_have from public.inventory where account_id = v_acc and item_id = it.id;
  if coalesce(v_have, 0) + p_qty > 99 then raise exception 'bag full' using errcode = '22023'; end if;
  v_cost := it.price * p_qty;
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < v_cost then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_acc, -v_cost, 'tool_buy', 'trap: ' || it.id || ' x' || p_qty);
  insert into public.inventory (account_id, item_id, qty) values (v_acc, it.id, p_qty)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  return jsonb_build_object('coins', v_bal, 'forest', public._forest_json(v_acc));
end $$;

-- ---------- C. Carpentry ----------
create table if not exists public.carpentry_profile (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_at timestamptz
);
alter table public.carpentry_profile enable row level security;
revoke all on public.carpentry_profile from anon, authenticated;

-- id, name, what it makes ('furniture' → furniture_catalog, 'item' → shop_items in the inventory) and how many, the logs
-- (wood_bag items and how many), the fee (nails, glue, varnish). A furniture piece costs ≈ 25–40 % of the shop's price in
-- logs (at their NPC price) and fee; a trap ≈ a third of the stall's.
create or replace function public._carpentry_recipes() returns table (id text, name text, out_kind text, out_id text,
                                                                      out_qty integer, logs jsonb, fee integer)
language sql immutable parallel safe
as $$
  values ('than_cui',   'Than củi',      'item',      'than_cui',   2, '{"go_tre": 3}'::jsonb,                      0),
         ('bay_go',     'Bẫy gỗ',        'item',      'bay_go',     1, '{"go_tre": 4, "go_keo": 2}'::jsonb,        10),
         ('chair_go',   'Ghế gỗ',        'furniture', 'chair_go',   1, '{"go_tre": 6, "go_keo": 4}'::jsonb,        20),
         ('floor_go',   'Sàn gỗ',        'furniture', 'floor_go',   1, '{"go_tre": 20}'::jsonb,                    30),
         ('shelf_go',   'Kệ sách gỗ',    'furniture', 'shelf_go',   1, '{"go_thong": 8}'::jsonb,                   30),
         ('table_go',   'Bàn gỗ',        'furniture', 'table_go',   1, '{"go_keo": 10, "go_thong": 6}'::jsonb,     40),
         ('cabinet_go', 'Tủ áo gỗ',      'furniture', 'cabinet_go', 1, '{"go_thong": 6, "go_soi": 10}'::jsonb,     80),
         ('bed_go',     'Giường gỗ',     'furniture', 'bed_go',     1, '{"go_keo": 10, "go_do": 8}'::jsonb,       100)
$$;
revoke all on function public._carpentry_recipes() from public, anon, authenticated;

-- Make one recipe: Thợ mộc (main) with a saw that still cuts; the logs (half-price ones first), the fee, 2 stamina.
create or replace function public.carpenter_craft(p_session_token text, p_recipe text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; cp public.carpentry_profile; v_saw text; e record; w public.wood_bag; v_half integer;
        v_coins integer; v_have integer;
begin
  v_acc := public._ac_account(p_session_token);
  if public._prof_main_level(v_acc, 'tho_moc') < 0 then raise exception 'not a carpenter' using errcode = '42501'; end if;
  select * into r from public._carpentry_recipes() c where c.id = p_recipe;
  if not found then raise exception 'invalid recipe' using errcode = '22023'; end if;
  perform public._vitals_guard(v_acc);
  perform public._wallet_lock(v_acc);
  insert into public.carpentry_profile (account_id) values (v_acc) on conflict do nothing;
  select * into cp from public.carpentry_profile where account_id = v_acc for update;
  if cp.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  select t.item into v_saw from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'saw'
   where t.account_id = v_acc and t.durability > 0 order by c.power desc, t.durability desc limit 1;
  if v_saw is null then raise exception 'no saw' using errcode = '22023'; end if;
  -- the logs
  for e in select key as item, value::int as n from jsonb_each_text(r.logs) loop
    select * into w from public.wood_bag where account_id = v_acc and item = e.item for update;
    if not found or w.qty + w.half < e.n then raise exception 'no ingredients' using errcode = '22023'; end if;
  end loop;
  if r.out_kind = 'item' then
    select qty into v_have from public.inventory where account_id = v_acc and item_id = r.out_id;
    if coalesce(v_have, 0) + r.out_qty > 99 then raise exception 'bag full' using errcode = '22023'; end if;
  end if;
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < r.fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  perform public._stamina_spend(v_acc, 2, null);
  for e in select key as item, value::int as n from jsonb_each_text(r.logs) loop
    select * into w from public.wood_bag where account_id = v_acc and item = e.item;
    v_half := least(w.half, e.n);
    update public.wood_bag set half = half - v_half, qty = qty - (e.n - v_half) where account_id = v_acc and item = e.item;
  end loop;
  update public.prof_tools set durability = durability - 1 where account_id = v_acc and item = v_saw;
  if r.fee > 0 then perform public._pay(v_acc, -r.fee, 'furniture', 'craft: ' || r.id); end if;
  if r.out_kind = 'furniture' then
    insert into public.furniture_items (account_id, item_id) values (v_acc, r.out_id);
    perform public._game_event(v_acc, 'furniture_crafted', 1, jsonb_build_object('item', r.out_id));
  else
    insert into public.inventory (account_id, item_id, qty) values (v_acc, r.out_id, r.out_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  end if;
  perform public._game_event(v_acc, 'item_crafted', 1, jsonb_build_object('source', 'carpentry', 'item', r.out_id));
  update public.carpentry_profile set last_at = now() where account_id = v_acc;
  return jsonb_build_object('result', 'ok', 'recipe', r.id, 'made', r.out_id, 'qty', r.out_qty, 'kind', r.out_kind,
                            'saw', (select durability from public.prof_tools where account_id = v_acc and item = v_saw),
                            'coins', (select coins from public.wallets where account_id = v_acc),
                            'forest', public._forest_json(v_acc));
end $$;

-- ---------- D. Charcoal in the kitchen ----------
create or replace function public._coal_bonus() returns integer
language sql immutable parallel safe
as $$ select 5 $$;
revoke all on function public._coal_bonus() from public, anon, authenticated;

-- cook_start (0121_forest_finish.sql, verbatim but for the lines marked 0123)
create or replace function public.cook_start(p_session_token text, p_recipe text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; cp public.cook_profile; v_have integer; v_coins integer; v_u bigint[] := '{}'; v_t integer := 60;
        v_step text; b1 integer; b2 integer; v_hold integer; v_per integer;
        v_pan record; v_fish uuid[];                                                                        -- 0097
        v_coal boolean := false;                                                                           -- 0123
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
  perform public._stamina_spend(v_acc, 2, 'cook');                                                              -- econ v2: a dish costs 2 stamina (was 0)
  -- 0097 { the pan (1 durability a dish) and the recipe's fish from the catch
  select t.item, c.power into v_pan from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'pan'   -- 0121: + c.power
   where t.account_id = v_acc and t.durability > 0 order by c.power desc, t.durability desc limit 1;   -- 0121: was order by t.durability desc
  if not found then raise exception 'no pan' using errcode = '22023'; end if;
  if r.fish is not null then
    v_fish := array(select f.id from public.fish f
                     where f.account_id = v_acc and f.species_id = r.fish
                       and not exists (select 1 from public.fish_fighters ff where ff.fish_id = f.id)
                     order by f.caught_at limit r.fish_qty for update of f);
    if cardinality(v_fish) < r.fish_qty then raise exception 'no ingredients' using errcode = '22023'; end if;
  end if;
  -- 0097 }
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < r.fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  if r.meat is not null then
    select qty into v_have from public.wild_bag where account_id = v_acc and item = r.meat for update;
    if coalesce(v_have, 0) < r.meat_qty then raise exception 'no ingredients' using errcode = '22023'; end if;
    update public.wild_bag set qty = qty - r.meat_qty where account_id = v_acc and item = r.meat;
  end if;
  if r.fish is not null then delete from public.fish where id = any(v_fish); end if;                  -- 0097
  update public.prof_tools set durability = durability - 1 where account_id = v_acc and item = v_pan.item;   -- 0097
  -- 0123 { a bag of than củi (charcoal, the carpenter's) burns hotter: one is used, the dish gets _coal_bonus() points
  update public.inventory set qty = qty - 1 where account_id = v_acc and item_id = 'than_cui' and qty > 0;
  v_coal := found;
  -- 0123 }
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
  perform public._mg_open(v_acc, 'cook', 'cook', v_u, 0, jsonb_build_object('recipe', r.id, 'pan', v_pan.power, 'coal', v_coal));   -- 0121: + the pan's tier (0123: + the charcoal)
  return jsonb_build_object('round', jsonb_build_object('game', 'cook', 'live', 'cook', 'recipe', r.id,
                                                        'steps', to_jsonb(r.steps), 'started_at', now(),   -- 0121: a comma
                                                        'pan', v_pan.item, 'pan_bonus', public._pan_bonus(v_pan.power),   -- 0121 (0123: a comma)
                                                        'coal', v_coal, 'coal_bonus', case when v_coal then public._coal_bonus() else 0 end),   -- 0123
                            'coins', (select coins from public.wallets where account_id = v_acc));
end $$;

-- cook_finish (0121_forest_finish.sql, verbatim but for the lines marked 0123)
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
  v_score := least(100, v_score + public._pan_bonus((l.meta->>'pan')::int)                          -- 0121: the pan's tier (0123: no ')')
                         + case when (l.meta->>'coal')::boolean then public._coal_bonus() else 0 end);   -- 0123: the charcoal
  v_q := public._cook_quality(v_score);
  insert into public.cooked_dishes (account_id, dish, quality, qty) values (v_acc, r.id, v_q, 1)
  on conflict (account_id, dish, quality) do update set qty = public.cooked_dishes.qty + 1;
  perform public._game_event(v_acc, 'food_cooked', 1, jsonb_build_object('recipe', r.id, 'quality', v_q, 'score', v_score));
  perform public._game_event(v_acc, 'item_crafted', 1, jsonb_build_object('source', 'cook', 'item', r.id));     -- econ v2
  perform public._game_event(v_acc, 'xp_grant', 2 + v_q * 2, jsonb_build_object('source', 'cook'));
  return jsonb_build_object('result', 'ok', 'dish', r.id, 'score', v_score, 'steps', v_rep->'steps', 'quality', v_q,
                            'pan_bonus', public._pan_bonus((l.meta->>'pan')::int),                     -- 0121
                            'coal_bonus', case when (l.meta->>'coal')::boolean then public._coal_bonus() else 0 end,   -- 0123
                            'forest', public._forest_json(v_acc));
end $$;

-- ---------- E. Traps ----------
create table if not exists public.forest_traps (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  item text not null references public.shop_items(id),
  durability integer not null check (durability >= 0),
  max_durability integer not null check (max_durability > 0),
  wx integer not null,
  wy integer not null,
  placed_at timestamptz not null default now(),
  last_check timestamptz,
  last_catch timestamptz
);
create index if not exists idx_forest_traps_account on public.forest_traps (account_id);
alter table public.forest_traps enable row level security;
revoke all on public.forest_traps from anon, authenticated;

-- A trap's time constant (minutes): the odds of a catch since the last one are 1 − e^(−minutes / τ).
create or replace function public._trap_tau(p_item text) returns double precision
language sql immutable parallel safe
as $$ select case p_item when 'bay_sat' then 18 else 30 end::double precision $$;
-- The odds (0 … 1) of a catch after p_min minutes: nothing before 5, at most 4 h counted.
create or replace function public._trap_odds(p_item text, p_min double precision) returns double precision
language sql immutable parallel safe
as $$ select case when p_min < 5 then 0 else 1 - exp(-least(p_min, 240) / public._trap_tau(p_item)) end $$;
revoke all on function public._trap_tau(text) from public, anon, authenticated;
revoke all on function public._trap_odds(text, double precision) from public, anon, authenticated;

-- Where I stand in world px after a position claim (the wild, or Rừng tràm's window); null off the forest.
create or replace function public._trap_here(p_acc uuid, out wx double precision, out wy double precision)
language plpgsql stable security definer set search_path = public, extensions
as $$
declare pp public.player_pos; w record;
begin
  select * into pp from public.player_pos where account_id = p_acc;
  select * into w from public._forest_xy(pp.map, pp.x, pp.y);
  if w.wx is not null and public._near_forest(w.wx, w.wy) then wx := w.wx; wy := w.wy; end if;
end $$;
revoke all on function public._trap_here(uuid) from public, anon, authenticated;

create or replace function public.trap_place(p_session_token text, p_item text, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; w record; it public.shop_items; v_n integer;
begin
  v_acc := public._ac_account(p_session_token);
  select * into it from public.shop_items where id = p_item and kind = 'forest' and durability is not null;
  if not found then raise exception 'invalid item' using errcode = '22023'; end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'trap_place', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into w from public._trap_here(v_acc);
  if w.wx is null then raise exception 'not in forest' using errcode = '22023'; end if;
  perform public._wallet_lock(v_acc);
  select count(*) into v_n from public.forest_traps where account_id = v_acc;
  if v_n >= 3 then raise exception 'trap limit' using errcode = '22023'; end if;
  if exists (select 1 from public.forest_traps t where sqrt(((t.wx - w.wx)::double precision) ^ 2 + ((t.wy - w.wy)::double precision) ^ 2) < 32) then
    raise exception 'too close' using errcode = '22023';
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_acc and item_id = it.id and qty > 0;
  if not found then raise exception 'not enough' using errcode = '22023'; end if;
  insert into public.forest_traps (account_id, item, durability, max_durability, wx, wy)
  values (v_acc, it.id, it.durability, it.durability, round(w.wx)::int, round(w.wy)::int);
  return jsonb_build_object('result', 'ok', 'forest', public._forest_json(v_acc));
end $$;

create or replace function public.trap_check(p_session_token text, p_trap bigint, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; w record; tr public.forest_traps; p public.wild_profile; s record; v_min double precision;
        v_odds double precision; v_qty integer := 0; v_broken boolean := false; v_why text;
begin
  v_acc := public._ac_account(p_session_token);
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'trap_check', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into tr from public.forest_traps where id = p_trap and account_id = v_acc for update;
  if not found then raise exception 'no trap' using errcode = '22023'; end if;
  select * into w from public._trap_here(v_acc);
  if w.wx is null or sqrt((tr.wx - w.wx) ^ 2 + (tr.wy - w.wy) ^ 2) > 64 then raise exception 'too far' using errcode = '22023'; end if;
  if tr.last_check > now() - interval '30 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  v_min := extract(epoch from now() - coalesce(tr.last_catch, tr.placed_at)) / 60;
  v_odds := public._trap_odds(tr.item, v_min);
  update public.forest_traps set last_check = now() where id = tr.id;
  if random() >= v_odds then
    return jsonb_build_object('result', 'empty', 'odds', round(v_odds * 100), 'forest', public._forest_json(v_acc));
  end if;
  insert into public.wild_profile (account_id) values (v_acc) on conflict do nothing;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;
  if p.kills >= 40 then
    update public.wild_profile set day = p.day, kills = p.kills where account_id = v_acc;
    return jsonb_build_object('result', 'empty', 'why', 'daily cap', 'forest', public._forest_json(v_acc));
  end if;
  select ws.* into s from public._wild_species() ws
   where ws.trap > 0 and (ws.active = 'any' or (ws.active = 'night') = public._world_night())
   order by -ln(1 - random()) / ws.weight limit 1;
  v_qty := s.drop_min + floor(random() * (s.drop_max - s.drop_min + 1))::int;
  insert into public.wild_bag (account_id, item, qty) values (v_acc, s.drop_item, v_qty)
  on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
  update public.wild_profile set day = p.day, kills = p.kills + 1 where account_id = v_acc;
  update public.forest_traps set durability = durability - 1, last_catch = now() where id = tr.id returning durability into tr.durability;
  if tr.durability <= 0 then
    delete from public.forest_traps where id = tr.id;
    v_broken := true;
  end if;
  perform public._game_event(v_acc, 'wild_trap', v_qty, jsonb_build_object('species', s.id, 'item', s.drop_item, 'via', 'set_trap'));
  perform public._game_event(v_acc, 'xp_grant', greatest(1, s.xp / 2), jsonb_build_object('source', 'wild'));
  return jsonb_build_object('result', 'caught', 'species', s.id, 'item', s.drop_item, 'qty', v_qty, 'xp', greatest(1, s.xp / 2),
                            'broken', v_broken, 'odds', round(v_odds * 100), 'forest', public._forest_json(v_acc));
end $$;

create or replace function public.trap_take(p_session_token text, p_trap bigint, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; w record; tr public.forest_traps; v_back boolean := false; v_have integer;
begin
  v_acc := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'trap_take', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into tr from public.forest_traps where id = p_trap and account_id = v_acc for update;
  if not found then raise exception 'no trap' using errcode = '22023'; end if;
  select * into w from public._trap_here(v_acc);
  if w.wx is null or sqrt((tr.wx - w.wx) ^ 2 + (tr.wy - w.wy) ^ 2) > 64 then raise exception 'too far' using errcode = '22023'; end if;
  delete from public.forest_traps where id = tr.id;
  if tr.durability >= tr.max_durability then
    select qty into v_have from public.inventory where account_id = v_acc and item_id = tr.item;
    if coalesce(v_have, 0) < 99 then
      insert into public.inventory (account_id, item_id, qty) values (v_acc, tr.item, 1)
      on conflict (account_id, item_id) do update set qty = public.inventory.qty + 1;
      v_back := true;
    end if;
  end if;
  return jsonb_build_object('result', 'ok', 'returned', v_back, 'forest', public._forest_json(v_acc));
end $$;

-- ---------- F. The state, the wipe, the Beta reset ----------
-- _forest_json (0097_forest_complete.sql, verbatim but for the lines marked 0123)
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
    'fish', coalesce((select jsonb_object_agg(x.species_id, x.n) from (select f.species_id, count(*) as n          -- 0097
                       from public.fish f where f.account_id = p_account group by f.species_id) x), '{}'::jsonb),     -- 0097
    'main', (select m.prof from public.player_profession_main m where m.account_id = p_account),
    'felled', coalesce((select jsonb_agg(jsonb_build_object('tree', f.tree_key,
                                                           'respawn_ms', (extract(epoch from f.respawn_at) * 1000)::bigint))
                          from public.forest_felled f where f.respawn_at > now()), '[]'::jsonb),
    'traps', coalesce((select jsonb_agg(jsonb_build_object('id', tr.id, 'item', tr.item, 'durability', tr.durability,   -- 0123 {
                                                          'max', tr.max_durability, 'x', tr.wx, 'y', tr.wy,
                                                          'since_ms', (extract(epoch from greatest(tr.placed_at, coalesce(tr.last_catch, tr.placed_at))) * 1000)::bigint,
                                                          'check_ms', (extract(epoch from tr.last_check) * 1000)::bigint)
                                       order by tr.id)
                         from public.forest_traps tr where tr.account_id = p_account), '[]'::jsonb),
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty) from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty > 0 and s.kind = 'forest'), '{}'::jsonb),   -- 0123 }
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;

-- _forest_on_wipe (0096_forest_professions.sql, verbatim but for the lines marked 0123)
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
  delete from public.forest_traps where account_id = new.account_id;                                  -- 0123
  delete from public.carpentry_profile where account_id = new.account_id;                             -- 0123
  return new;
end $$;
revoke all on function public._forest_on_wipe() from public, anon, authenticated;

insert into public.beta_reset_scope (tbl, action, ord, note) values
  ('forest_traps', 'wipe', 30, 'forest (0123)'),
  ('carpentry_profile', 'wipe', 30, 'forest (0123)')
on conflict (tbl) do update set action = excluded.action, ord = excluded.ord, note = excluded.note;

-- ---------- Grants ----------
revoke all on function public.forest_buy(text, text, integer) from public;
revoke all on function public.carpenter_craft(text, text) from public;
revoke all on function public.trap_place(text, text, text, integer, integer) from public;
revoke all on function public.trap_check(text, bigint, text, integer, integer) from public;
revoke all on function public.trap_take(text, bigint, text, integer, integer) from public;
grant execute on function public.forest_buy(text, text, integer) to anon, authenticated;
grant execute on function public.carpenter_craft(text, text) to anon, authenticated;
grant execute on function public.trap_place(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.trap_check(text, bigint, text, integer, integer) to anon, authenticated;
grant execute on function public.trap_take(text, bigint, text, integer, integer) to anon, authenticated;
