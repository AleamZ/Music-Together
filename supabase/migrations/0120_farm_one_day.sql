-- =========================================================
-- 0120_farm_one_day.sql — Trồng trọt: one crop cycle fits in one real day (owner request, 2026-10-07).
-- ADDITIVE and re-runnable. Run after 0119. Re-created functions (section E) are 0102's bodies verbatim but for the
-- lines marked 0120.
--
-- Before: a crop took 48–80 h (lúa ngắn ngày ≈ 52 h, nếp ≈ 58 h, lúa thơm ≈ 66 h from soaking; khoai 48 h, bắp 60 h,
-- ớt 10 h nursery + 46 h + two more pickings 12 h apart = 80 h), and a lease ended with its crop: one harvest per rent.
-- After: every crop is ready within 24 h of its first action, the order and the shape of each crop are kept:
--   crop             old → new (first action → ready, prompt play)   time factor   base_kg old → new
--   khoai lang        48 h →  8 h                                      1/6           200 → 43
--   lúa ngắn ngày   ≈ 52 h → ≈ 12 h   (scale 0.90 → 0.18)              0.20           90 → 27
--   bắp               60 h → 15 h                                      0.25          150 → 49
--   nếp             ≈ 58 h →   16 h   (scale 1.00 → 0.25)              0.25           75 → 27
--   lúa thơm        ≈ 66 h → ≈ 20 h   (scale 1.15 → 0.32)              0.278          60 → 23
--   ớt                80 h → 24 h  (ươm 3 h, lứa đầu 13.8 h, 3 lứa)     0.30           60 → 23
-- A. Rice: the variety's `scale` already drives every phase, fertilizer window, drainage mark and pest window (0013
--    _crop_phase / _crop_care / _crop_pests, the client's crop.ts), so only the catalog changes. Constants that are
--    real-time tolerances stay: soaking 2 h, sowing within 6 h of sprouting, the 12 h ripe window, the 2 %/h late loss,
--    24 h before sprouted seed rots, 60 h before a field of rice falls, water dropping one level per 12 h.
-- B. Hoa màu: every growth hour of upland_crops (stages, cares, pests, nursery, pick gap, rot start) × the factor. The
--    ripe windows / losses (ripe_window_h, lost_after_h, over_rate) stay in real hours, the ớt nursery tolerates 6 h
--    (old_h 9; scaled it would be 5.4).
-- C. Yield per harvest: base_kg = old × 1.3 × the time factor, so a plot replanted at once grosses ≈ 1.3× per real day;
--    with seeds, fertilizer and sprays still bought per crop, and the 10 000 xu rent now paid per 96 h instead of per
--    crop (E), that nets ≈ 1.1–1.3× the old day (prices per kg, seed, fertilizer, spray, rent and machine prices
--    unchanged; the thương lái does not buy farm goods — the 2-plot cap bounds the farm).
-- D. Crops already in the ground: their history is squeezed toward now by the same factor (t' = now − (now − t) × f
--    for soak, sow, transplant, plant and every water / fertilizer / spray / snail-pick / hand-job / picking time), so
--    a crop keeps its phase, its care marks and its pest rolls, and what was left of its growth shrinks by the factor
--    (never more than the new cycle). Water still drops one level per 12 real hours, so each drop that already happened
--    is written into the water log first (_farm_water_expand): the squeezed crop had the same water at every point of
--    its past. Rat logs, storm marks, the harvester job and the minigame clocks stay real-time.
--    The factor is new ÷ current, so a re-run (current = new) changes nothing.
-- E. A lease (village rent or an owner's sublease) runs its 96 h through as many crops as fit, instead of ending with the
--    first harvest (_farm_do_harvest_part, _farm_do_harvest, _field_sweep's harvester step).
-- =========================================================

-- A crop timestamp squeezed toward p_now by p_f (later than p_now: unchanged).
create or replace function public._farm_squeeze_t(p_t timestamptz, p_now timestamptz, p_f double precision)
returns timestamptz
language sql immutable set search_path = public, extensions
as $$ select case when p_t is null or p_t >= p_now then p_t else p_now - (p_now - p_t) * p_f end $$;

-- A crop log ([{t, …}]) with every entry's t squeezed.
create or replace function public._farm_squeeze_log(p_log jsonb, p_now timestamptz, p_f double precision)
returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(case when jsonb_typeof(e.x) = 'object' and e.x ? 't' and jsonb_typeof(e.x->'t') = 'string'
                                 then jsonb_set(e.x, '{t}', to_jsonb(public._farm_squeeze_t((e.x->>'t')::timestamptz, p_now, p_f)))
                                 else e.x end order by e.n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) with ordinality e(x, n)
$$;
-- Water drops one level per 12 real hours on its own (_water_at), and that stays. So that a squeezed crop keeps the water
-- it had at every moment of its past (a field drained by waiting stays drained), every drop that happened before p_now
-- is first written into the log as an entry of its own: {t: set + 12·k h, l: level − k}. When that would leave fewer than
-- 10 free entries of the 60 a log may hold, the log is kept as it is.
create or replace function public._farm_water_expand(p_log jsonb, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare v_out jsonb := '[]'::jsonb; e record; v_t timestamptz; v_l integer; k integer;
begin
  for e in select (x->>'t')::timestamptz as t, (x->>'l')::int as l, x,
                  lead((x->>'t')::timestamptz) over (order by (x->>'t')::timestamptz, n) as next_t
             from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) with ordinality w(x, n)
            order by (x->>'t')::timestamptz, n loop
    v_out := v_out || jsonb_build_array(e.x);
    if e.t is null or e.l is null then continue; end if;
    for k in 1 .. greatest(e.l, 0) loop
      v_t := e.t + make_interval(hours => 12 * k);
      exit when v_t >= least(coalesce(e.next_t, p_now), p_now);
      v_l := e.l - k;
      v_out := v_out || jsonb_build_array(jsonb_build_object('t', v_t, 'l', v_l));
    end loop;
  end loop;
  if jsonb_array_length(v_out) > 50 then return p_log; end if;
  return v_out;
end $$;
revoke all on function public._farm_squeeze_t(timestamptz, timestamptz, double precision) from public, anon, authenticated;
revoke all on function public._farm_squeeze_log(jsonb, timestamptz, double precision) from public, anon, authenticated;
revoke all on function public._farm_water_expand(jsonb, timestamptz) from public, anon, authenticated;

-- ---------- A. Rice ----------
do $$
declare r record; v_cur double precision; v_f double precision; v_now timestamptz := now();
begin
  for r in select * from (values ('short', 0.18::double precision, 27), ('nep', 0.25::double precision, 27),
                                 ('thom', 0.32::double precision, 23)) x(id, scale, base_kg) loop
    select scale into v_cur from public.rice_varieties where id = r.id;
    if v_cur is null then continue; end if;
    if v_cur <> r.scale then
      v_f := r.scale / v_cur;
      update public.crops
         set soak_at = public._farm_squeeze_t(soak_at, v_now, v_f),
             sow_at = public._farm_squeeze_t(sow_at, v_now, v_f),
             transplant_at = public._farm_squeeze_t(transplant_at, v_now, v_f),
             water_log = public._farm_squeeze_log(public._farm_water_expand(water_log, v_now), v_now, v_f),
             fert_log = public._farm_squeeze_log(fert_log, v_now, v_f),
             spray_log = public._farm_squeeze_log(spray_log, v_now, v_f),
             picks = public._farm_squeeze_log(picks, v_now, v_f)
       where kind = 'rice' and variety = r.id;
    end if;
    update public.rice_varieties set scale = r.scale, base_kg = r.base_kg
     where id = r.id and (scale <> r.scale or base_kg <> r.base_kg);
  end loop;
end $$;

-- ---------- B. Hoa màu ----------
create temporary table if not exists tmp_upland_0120 (
  id text primary key, base_kg integer, nursery_ready_h double precision, nursery_old_h double precision,
  stages jsonb, pick_gap_h double precision, rot_from_h double precision, cares jsonb, pests jsonb
);
delete from tmp_upland_0120 where true;
insert into tmp_upland_0120 values
  ('khoai', 43, null, null,
   '[{"id": "root", "name": "Bén rễ", "until_h": 1, "water": [1]}, {"id": "vine", "name": "Bò dây", "until_h": 3.67, "water": [0, 1]},
     {"id": "tuber", "name": "Tượng củ", "until_h": 6, "water": [0, 1]}, {"id": "bulk", "name": "Củ lớn", "until_h": 8, "water": [0, 1]}]',
   null, 3.67,
   '[{"id": "td", "kind": "fert", "name": "Bón thúc nuôi củ", "items": ["fert_potash", "fert_npk"], "half_items": ["fert_urea"],
      "from_h": 2.67, "to_h": 4.33, "half_from_h": 1, "half_to_h": 6, "pen_half": 0.10, "pen_missing": 0.20},
     {"id": "lat_day", "kind": "act", "name": "Lật dây", "items": [], "half_items": [],
      "from_h": 4, "to_h": 5.33, "half_from_h": 5.33, "half_to_h": 6.67, "pen_half": 0.05, "pen_missing": 0.10}]',
   '[{"slot": 1, "kind": "weevil", "name": "Sùng khoai", "from_h": 4, "to_h": 6.67, "chance": 0.40, "dry_mult": 2, "wet_mult": 1,
      "remedy": "spray_insect"}]'),
  ('bap', 49, null, null,
   '[{"id": "sprout", "name": "Nảy mầm", "until_h": 1.5, "water": [1]}, {"id": "leaf", "name": "Ra lá", "until_h": 6, "water": [1, 2]},
     {"id": "knee", "name": "Xoáy nõn", "until_h": 10, "water": [1, 2]},
     {"id": "tassel", "name": "Trổ cờ, phun râu", "until_h": 12.5, "water": [1, 2]},
     {"id": "fill", "name": "Chắc hạt", "until_h": 15, "water": [0, 1]}]',
   null, null,
   '[{"id": "td1", "kind": "fert", "name": "Bón thúc lần 1 (3–5 lá)", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"],
      "from_h": 2, "to_h": 4, "half_from_h": 1.5, "half_to_h": 6, "pen_half": 0.10, "pen_missing": 0.20},
     {"id": "vun_goc", "kind": "act", "name": "Vun gốc", "items": [], "half_items": [],
      "from_h": 4, "to_h": 7, "half_from_h": 7, "half_to_h": 10, "pen_half": 0.05, "pen_missing": 0.10},
     {"id": "td2", "kind": "fert", "name": "Bón thúc lần 2 (trổ cờ)", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 9.5, "to_h": 11.5, "half_from_h": 7.5, "half_to_h": 12.5, "pen_half": 0.10, "pen_missing": 0.20}]',
   '[{"slot": 1, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 2, "to_h": 6, "chance": 0.35, "dry_mult": 1, "wet_mult": 1,
      "remedy": "spray_insect"},
     {"slot": 2, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 6.5, "to_h": 11, "chance": 0.35, "dry_mult": 1, "wet_mult": 1,
      "remedy": "spray_insect"}]'),
  ('ot', 23, 3, 9,
   '[{"id": "root", "name": "Bén rễ", "until_h": 2.4, "water": [1]}, {"id": "grow", "name": "Phát triển thân lá", "until_h": 6.6, "water": [1, 2]},
     {"id": "flower", "name": "Ra hoa", "until_h": 10.2, "water": [1, 2]}, {"id": "fruit", "name": "Đậu trái", "until_h": 13.8, "water": [1, 2]}]',
   3.6, null,
   '[{"id": "td1", "kind": "fert", "name": "Bón thúc bén rễ", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"],
      "from_h": 1.2, "to_h": 3.6, "half_from_h": 0, "half_to_h": 6, "pen_half": 0.08, "pen_missing": 0.15},
     {"id": "td2", "kind": "fert", "name": "Bón thúc ra hoa", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 6.6, "to_h": 9, "half_from_h": 6, "half_to_h": 12, "pen_half": 0.08, "pen_missing": 0.15},
     {"id": "td3", "kind": "fert", "name": "Bón nuôi trái", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 13.8, "to_h": 16.8, "half_from_h": 12, "half_to_h": 19.2, "pen_half": 0.08, "pen_missing": 0.15}]',
   '[{"slot": 1, "kind": "thrips", "name": "Bọ trĩ", "from_h": 1.8, "to_h": 7.2, "chance": 0.40, "dry_mult": 1.5, "wet_mult": 1,
      "remedy": "spray_insect"},
     {"slot": 2, "kind": "anthracnose", "name": "Thán thư", "from_h": 12, "to_h": 19.2, "chance": 0.40, "dry_mult": 1, "wet_mult": 2,
      "remedy": "spray_fungus"}]');

do $$
declare r record; v_cur double precision; v_new double precision; v_f double precision; v_now timestamptz := now();
begin
  for r in select t.*, u.stages as cur_stages from tmp_upland_0120 t join public.upland_crops u on u.id = t.id loop
    v_cur := (r.cur_stages -> -1 ->> 'until_h')::double precision;
    v_new := (r.stages -> -1 ->> 'until_h')::double precision;
    if v_cur is not null and v_cur > 0 and v_cur <> v_new then
      v_f := v_new / v_cur;
      update public.crops
         set sow_at = public._farm_squeeze_t(sow_at, v_now, v_f),
             plant_at = public._farm_squeeze_t(plant_at, v_now, v_f),
             water_log = public._farm_squeeze_log(public._farm_water_expand(water_log, v_now), v_now, v_f),
             fert_log = public._farm_squeeze_log(fert_log, v_now, v_f),
             spray_log = public._farm_squeeze_log(spray_log, v_now, v_f),
             work_log = public._farm_squeeze_log(work_log, v_now, v_f),
             harvests = public._farm_squeeze_log(harvests, v_now, v_f)
       where kind = 'upland' and upland = r.id;
    end if;
  end loop;
  update public.upland_crops u
     set base_kg = t.base_kg, nursery_ready_h = t.nursery_ready_h, nursery_old_h = t.nursery_old_h, stages = t.stages,
         pick_gap_h = t.pick_gap_h, rot_from_h = t.rot_from_h, cares = t.cares, pests = t.pests
    from tmp_upland_0120 t
   where u.id = t.id
     and (u.base_kg, u.nursery_ready_h, u.nursery_old_h, u.stages, u.pick_gap_h, u.rot_from_h, u.cares, u.pests)
         is distinct from (t.base_kg, t.nursery_ready_h, t.nursery_old_h, t.stages, t.pick_gap_h, t.rot_from_h, t.cares, t.pests);
end $$;

drop table if exists tmp_upland_0120;

-- ---------- E. A lease is 96 hours of farming, not one crop ----------
-- Since v15 a village lease (10 000 xu) or an owner's sublease ended with its crop: the last rice part cut by hand, the
-- harvester's job paid, the last hoa-màu picking. With every crop now ready within a day, that would still be one crop per
-- lease, so the field still gave one harvest per rent (the owner's complaint). A lease now runs its whole 96 h: the
-- farmer replants the same plot as often as the crops allow, and only the lease's end (the sweep's step 1) frees it. A crop
-- still on the plot when the lease ends is lost as before (step 4); the plot panel warns before sowing or planting one that
-- would not be in by then. The three functions below are 0102's, verbatim but for the lines marked 0120.
-- _farm_do_harvest_part (0102_econ_farm.sql)
create or replace function public._farm_do_harvest_part(p_room uuid, p_account uuid, p_plot integer, p_success boolean,
                                                        p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v public.rice_varieties; f public.field_plots; v_y integer; v_i integer; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind <> 'rice' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  if not coalesce(p_success, false) then
    update public.crops set work = null, work_started_at = null where room_id = p_room and plot_no = p_plot;
    return public._field_view(p_room, p_account, p_now);
  end if;
  if c.work is distinct from 'harvest' or c.work_started_at is null or p_now - c.work_started_at < interval '8 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
  if p_now - c.work_started_at > interval '120 seconds' then
    raise exception 'work expired' using errcode = '22023';
  end if;
  v := public._variety(c.variety);
  perform public._work_check(c, v, 'harvest', p_now);
  f := public._plot_row(p_room, p_plot);
  v_y := (public._crop_yield(c, v, case when f.kind = 'private' then 1.1 else 1.0 end, 1.0, p_now)->>'kg')::int;
  v_i := c.harvested_parts + 1;
  v_kg := public._part_kg(v_i, v_y);
  perform public._rice_add(p_account, c.variety, v_kg, 0);
  if v_i = 6 then
    delete from public.crops where room_id = p_room and plot_no = p_plot;
    -- 0120: the lease runs on (was: delete from public.plot_leases where room_id = p_room and plot_no = p_plot;)
    perform public._game_event(p_account, 'crop_harvest', 1,                             -- econ v2 (A4): the plot's crop is in
                               jsonb_build_object('kind', 'rice', 'crop', c.variety, 'kg', c.harvested_kg + v_kg, 'via', 'hand'));   -- econ v2
  else
    update public.crops set harvested_parts = v_i, harvested_kg = harvested_kg + v_kg, work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest_part', jsonb_build_object('variety', c.variety, 'kg', v_kg, 'parts', v_i,
                                                                 'total', c.harvested_kg + v_kg, 'done', v_i = 6));
end; $$;

-- _farm_do_harvest (0102_econ_farm.sql)
create or replace function public._farm_do_harvest(p_room uuid, p_account uuid, p_plot integer, p_quality double precision,
                                                   p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; u public.upland_crops; f public.field_plots; v_k integer; v_n integer; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind <> 'upland' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  perform public._work_gate(c, 'harvest', p_now);
  perform public._work_check(c, null, 'harvest', p_now);
  u := public._upland(c.upland);
  f := public._plot_row(p_room, p_plot);
  v_k := public._up_next(c, u, p_now);
  v_n := jsonb_array_length(u.pickings);
  v_kg := (public._up_yield(c, u, case when f.kind = 'private' then 1.1 else 1.0 end, v_k, p_now)->>'kg')::int;
  perform public._produce_add(p_account, c.upland, v_kg);
  if v_k = v_n then
    delete from public.crops where room_id = p_room and plot_no = p_plot;
    -- 0120: the lease runs on (was: delete from public.plot_leases where room_id = p_room and plot_no = p_plot;)
    perform public._game_event(p_account, 'crop_harvest', 1,                             -- econ v2 (A4): the last picking
                               jsonb_build_object('kind', 'upland', 'crop', c.upland, 'via', 'hand',   -- econ v2
                                                  'kg', v_kg + coalesce((select sum((x->>'kg')::int)      -- econ v2
                                                                           from jsonb_array_elements(c.harvests) x), 0)));   -- econ v2
  else
    update public.crops
       set harvests = harvests || jsonb_build_array(jsonb_build_object('t', p_now, 'k', v_k, 'kg', v_kg)),
           work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest', jsonb_build_object('upland', c.upland, 'kg', v_kg, 'k', v_k, 'pickings', v_n,
                                                            'done', v_k = v_n));
end; $$;

-- _field_sweep (0102_econ_farm.sql)
create or replace function public._field_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots; d public.drying_slots; c public.crops; v_y integer;
begin
  -- 0a. banned accounts leave the land market: an anti-cheat ban (review pending or wiped) or a ban set by hand
  delete from public.land_offers lo
   where lo.room_id = p_room
     and (exists (select 1 from public.accounts a where a.id = lo.buyer_id and a.is_banned)
          or exists (select 1 from public.anticheat_status s where s.account_id = lo.buyer_id and s.ban_state is not null));
  update public.field_plots fp set sale_price = null, sublease_price = null
   where fp.room_id = p_room and (fp.sale_price is not null or fp.sublease_price is not null)
     and (exists (select 1 from public.accounts a where a.id = fp.owner_id and a.is_banned)
          or exists (select 1 from public.anticheat_status s where s.account_id = fp.owner_id and s.ban_state is not null));
  -- 0b. a wipe releases what the account held at the time of the wipe, without refund
  delete from public.plot_leases pl using public.anticheat_status s
   where pl.room_id = p_room and s.account_id = pl.farmer_id and s.wiped_at is not null and pl.starts_at <= s.wiped_at;
  update public.field_plots fp set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
    from public.anticheat_status s
   where fp.room_id = p_room and s.account_id = fp.owner_id and s.wiped_at is not null
     and (fp.owned_at is null or fp.owned_at <= s.wiped_at);
  delete from public.land_offers lo using public.anticheat_status s
   where lo.room_id = p_room and s.account_id = lo.buyer_id and s.wiped_at is not null and lo.created_at <= s.wiped_at;
  delete from public.drying_slots ds using public.anticheat_status s
   where ds.room_id = p_room and s.account_id = ds.account_id and s.wiped_at is not null
     and ds.ready_at <= s.wiped_at + interval '3 hours';
  -- 0c. offers on a plot that has no owner any more (a release above, or a deleted account)
  delete from public.land_offers lo using public.field_plots fp
   where lo.room_id = p_room and fp.room_id = lo.room_id and fp.plot_no = lo.plot_no and fp.owner_id is null;
  -- J. finished harvester jobs: lock the crop row, re-check it, pay the parts still uncut at the job's end (0120: the lease runs on)
  for c in select cr.* from public.crops cr
            where cr.room_id = p_room and cr.harvester_until is not null and cr.harvester_until <= p_now
            order by cr.plot_no for update loop
    if c.farmer_id = public._farmer(p_room, c.plot_no, c.harvester_at) then
      v_y := (public._crop_yield(c, public._variety(c.variety),
                                 case when (select fp.kind from public.field_plots fp
                                             where fp.room_id = p_room and fp.plot_no = c.plot_no) = 'private' then 1.1 else 1.0 end,
                                 1.0, c.harvester_until)->>'kg')::int;
      perform public._rice_add(c.farmer_id, c.variety, v_y - (c.harvested_parts * v_y) / 6, 0);   -- the parts left: R5
      -- 0120: the lease runs on (was: delete from public.plot_leases where room_id = p_room and plot_no = c.plot_no;)
      perform public._game_event(c.farmer_id, 'crop_harvest', 1,                           -- econ v2 (A4): the harvester finished it
                                 jsonb_build_object('kind', 'rice', 'crop', c.variety, 'via', 'harvester',   -- econ v2
                                                    'kg', c.harvested_kg + v_y - (c.harvested_parts * v_y) / 6));   -- econ v2
    end if;
    delete from public.crops where room_id = p_room and plot_no = c.plot_no;
  end loop;
  -- 1. leases end (the leaseholder's crop goes in step 4)
  delete from public.plot_leases where room_id = p_room and until <= p_now;
  -- 2. offers expire after 24 h
  delete from public.land_offers where room_id = p_room and created_at <= p_now - interval '24 hours';
  -- 3. reclaim: the owner left the room or has not visited it for 14 days, and the plot is not leased out (§7.6)
  for f in select fp.* from public.field_plots fp
            where fp.room_id = p_room and fp.owner_id is not null
              and not exists (select 1 from public.members m
                               where m.room_id = p_room and m.account_id = fp.owner_id
                                 and coalesce(m.last_seen_at, m.joined_at) > p_now - interval '14 days')
              and not exists (select 1 from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = fp.plot_no)
            order by fp.plot_no loop
    update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
     where room_id = p_room and plot_no = f.plot_no;
    delete from public.land_offers where room_id = p_room and plot_no = f.plot_no;
    perform public._wallet_lock(f.owner_id);
    perform public._pay(f.owner_id, 400000, 'land_refund', 'plot ' || f.plot_no);
  end loop;
  -- 4. a crop belongs to the plot's farmer: a crop left by an ended lease or a reclaim is lost, with its uncut parts and
  --    untaken pickings (R26)
  delete from public.crops cr
   where cr.room_id = p_room and cr.farmer_id is distinct from public._farmer(p_room, cr.plot_no, p_now);
  -- 5. sprouted seed not sown 24 h after sprouting (soak + 26 h) rots: the plot goes back to prepared, or to bare
  delete from public.crops
   where room_id = p_room and sow_at is null and prepared_at is null and p_now >= soak_at + interval '26 hours';
  update public.crops set rotted_at = soak_at + interval '26 hours', soak_at = null, variety = null
   where room_id = p_room and sow_at is null and p_now >= soak_at + interval '26 hours';
  -- 6. rice left 48 h after its ripe window has all fallen (not while a harvester runs: step J pays it first); hoa màu
  --    whose last picking is lost. The lease stays (R26).
  delete from public.crops cr using public.rice_varieties rv
   where cr.room_id = p_room and cr.kind = 'rice' and rv.id = cr.variety and cr.transplant_at is not null
     and cr.harvester_until is null and p_now >= public._plus_h(cr.transplant_at, 48 * rv.scale + 60);
  delete from public.crops cr using public.upland_crops u
   where cr.room_id = p_room and cr.kind = 'upland' and u.id = cr.upland and cr.plant_at is not null
     and public._up_next(cr, u, p_now) = 0;
  -- 7. a drying batch left 24 h after it is ready is collected for its owner
  for d in delete from public.drying_slots where room_id = p_room and ready_at <= p_now - interval '24 hours' returning * loop
    perform public._rice_add(d.account_id, d.variety, 0, d.kg);
  end loop;
end; $$;

revoke all on function public._farm_do_harvest_part(uuid, uuid, integer, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_harvest(uuid, uuid, integer, double precision, timestamptz) from public, anon, authenticated;
revoke all on function public._field_sweep(uuid, timestamptz) from public, anon, authenticated;
