-- =========================================================
-- 0121_forest_finish.sql — Săn bắt and Tiều phu, the unfinished parts (owner request 2026-10-07: "thợ săn, tiều phu
-- chưa hoàn thiện"). ADDITIVE and re-runnable. Run after 0120.
-- Every re-created function is its newest body (named above it) plus the lines marked "-- 0121" (an added or changed
-- line) or "-- 0121 {" … "-- 0121 }" (an added block).
--   A. Bow tiers: the stall sells Cung tre / gỗ tràm / gỗ cứng (280–1 800 xu) as tiers, but a hunt only wore the bow
--      with the most durability and never read its tier. wild_start now draws the best bow (tier, then durability) and
--      keeps its tier in the round (mg_live.meta 'bow'); wild_finish adds _bow_bonus(tier) = 5 points per tier above
--      the first to the hunt's chance on a hit (still ≤ 95; a miss stays 0). The round's answer names the bow and its
--      bonus, and _wild_json carries 'bow' (the one a hunt would draw, or null) so the HUD can say "no bow" before a
--      hunt instead of after it.
--   B. Pan tiers: the same for cooking. cook_start draws the best pan (tier, then durability) and keeps its tier
--      (meta 'pan'); cook_finish adds _pan_bonus(tier) = 4 points per tier above the first to the dish's score (≤ 100)
--      after the perfect-timing check, so Chảo gang / Nồi gang lift a dish toward Ngon / Tuyệt phẩm.
--   C. Work: selling logs (wood_sell) and dishes (dish_sell) is work like selling fish, ore or wild goods —
--      _pg_work_reason adds them (the earn XP, earned_total and the "earned by work" achievements and quests).
--   D. Kỷ niệm Beta: _beta_net_worth also values rice (dry kg at the price, wet at 70 %) and the forest (logs at
--      their price — half-price logs at half —, wild goods at the stall's price, dishes at their sale value, bought
--      tools at their price; the free starter tools count 0). Only matters for a snapshot taken after this.
--   E. Quests: two dailies for the forest — d_wood "Đốn 10 khúc gỗ" (wood_chopped, by logs) and d_hunt "Đi săn"
--      (2 hunts that bag their animal) — in the daily pool.
-- Not changed (checked, they already work): every forest RPC keeps its grant; chop / hunt / cook / sell / buy /
-- repair answer in 2D (Rừng tràm) and 3D (the wild); the Beta reset wipes every forest table but forest_felled and
-- wild_spawns (world state) and wipes prof_starter_grants with the tools, so picking a nghề again re-grants its starter
-- tool after the reset.
-- =========================================================
-- ---------- A. Bow tiers ----------
-- The points a bow of tier p adds to a hunt's chance (tier 1 or none: 0).
create or replace function public._bow_bonus(p_tier integer) returns integer
language sql immutable parallel safe
as $$ select 5 * greatest(0, coalesce(p_tier, 1) - 1) $$;
-- The points a pan of tier p adds to a dish's score.
create or replace function public._pan_bonus(p_tier integer) returns integer
language sql immutable parallel safe
as $$ select 4 * greatest(0, coalesce(p_tier, 1) - 1) $$;
revoke all on function public._bow_bonus(integer) from public, anon, authenticated;
revoke all on function public._pan_bonus(integer) from public, anon, authenticated;

-- wild_start (0103_econ_crafts.sql, verbatim but for the lines marked 0121)
create or replace function public.wild_start(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; sp public.wild_spawns; s record; p public.wild_profile; g public.world_mg;
        v_ax double precision; v_ay double precision; v_seed bigint := floor(random() * 4294967296)::bigint; v_danger boolean;
        v_u bigint[];                                                                                      -- 0087
        v_w record; bw record;                                                                             -- 0097
        v_bow integer; v_bow_item text;                                                                    -- 0121
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
    if p.kills >= 40 then raise exception 'daily cap' using errcode = '53400'; end if;                          -- econ v2: 40 a day (was 60)
  end if;
  -- 0097 { a hunt needs a bow that still shoots (1 durability a hunt)
  if p_action = 'hunt' then
    select t.item, t.durability, c.power into bw from public.prof_tools t                            -- 0121: + c.power
      join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'bow'
     where t.account_id = v_acc and t.durability > 0 order by c.power desc, t.durability desc limit 1;   -- 0121: was order by t.durability desc
    if not found then raise exception 'no bow' using errcode = '22023'; end if;
    v_bow := bw.power; v_bow_item := bw.item;                                                         -- 0121
    update public.prof_tools set durability = durability - 1 where account_id = v_acc and item = bw.item;
  end if;
  -- 0097 }
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
                          jsonb_build_object('species', sp.species, 'danger', v_danger,           -- 0121: a comma
                                             'bow', v_bow));                                        -- 0121: the bow's tier
  return jsonb_build_object('round', jsonb_build_object('game', p_action, 'spawn', sp.id, 'species', sp.species,
                                                        'danger', v_danger, 'live', 'world',
                                                        'reticle', case when p_action = 'hunt' then 100 + v_u[4] % 41 end,
                                                        'bow', v_bow_item, 'bow_bonus', public._bow_bonus(v_bow),   -- 0121
                                                        'started_at', now()));
  -- 0087 }
end $$;

-- wild_finish (0103_econ_crafts.sql, verbatim but for the lines marked 0121)
create or replace function public.wild_finish(p_session_token text, p_a integer[], p_b integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; sp public.wild_spawns; s record; p public.wild_profile; v_bad text; v_rep jsonb;
        v_code text; v_ev jsonb; v_ac jsonb; v_out text; v_rt integer; v_score integer := 0; v_chance integer := 0;
        v_ok boolean := false; v_qty integer := 0; v_knock boolean := false; v_faint boolean := false; v_saved boolean := false;
        v_xp integer := 0; v_gave_up boolean := false; v_n integer := coalesce(cardinality(p_a), 0);
        l public.mg_live;                                                                                  -- 0087
        pp public.player_pos; v_lv integer; v_extra integer := 0;                                          -- 0096
        v_w record; v_jm text := 'wild';                                                                   -- 0097
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
                                   + floor(public._buff(v_acc, 'hunt_chance'))::int                  -- 0097: a dish's buff (0121: no ')')
                                   + case when g.kind = 'hunt' then public._bow_bonus((l.meta->>'bow')::int) else 0 end);   -- 0121: the bow's tier
  end if;
  -- 0096 }
  v_ok := p.kills < 40 and random() * 100 < v_chance;                                                           -- econ v2: 40 a day (was 60)
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
                            'knocked', v_knock, 'fainted', v_faint, 'wild', public._wild_json(v_acc, v_jm));   -- 0097: v_jm
end $$;

-- _wild_json (0097_forest_complete.sql, verbatim but for the lines marked 0121): the bow a hunt would use
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
                              where p.account_id = p_account), 0),                                   -- 0121: a comma
    'bow', (select jsonb_build_object('item', t.item, 'durability', t.durability, 'max', t.max_durability,   -- 0121 {
                                      'power', c.power, 'bonus', public._bow_bonus(c.power))
              from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'bow'
             where t.account_id = p_account and t.durability > 0
             order by c.power desc, t.durability desc limit 1))                                   -- 0121 }
$$;

-- ---------- B. Pan tiers ----------
-- cook_start (0103_econ_crafts.sql, verbatim but for the lines marked 0121)
create or replace function public.cook_start(p_session_token text, p_recipe text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; cp public.cook_profile; v_have integer; v_coins integer; v_u bigint[] := '{}'; v_t integer := 60;
        v_step text; b1 integer; b2 integer; v_hold integer; v_per integer;
        v_pan record; v_fish uuid[];                                                                        -- 0097
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
  perform public._mg_open(v_acc, 'cook', 'cook', v_u, 0, jsonb_build_object('recipe', r.id, 'pan', v_pan.power));   -- 0121: + the pan's tier
  return jsonb_build_object('round', jsonb_build_object('game', 'cook', 'live', 'cook', 'recipe', r.id,
                                                        'steps', to_jsonb(r.steps), 'started_at', now(),   -- 0121: a comma
                                                        'pan', v_pan.item, 'pan_bonus', public._pan_bonus(v_pan.power)),   -- 0121
                            'coins', (select coins from public.wallets where account_id = v_acc));
end $$;

-- cook_finish (0103_econ_crafts.sql, verbatim but for the lines marked 0121)
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
  v_score := least(100, v_score + public._pan_bonus((l.meta->>'pan')::int));                          -- 0121: the pan's tier
  v_q := public._cook_quality(v_score);
  insert into public.cooked_dishes (account_id, dish, quality, qty) values (v_acc, r.id, v_q, 1)
  on conflict (account_id, dish, quality) do update set qty = public.cooked_dishes.qty + 1;
  perform public._game_event(v_acc, 'food_cooked', 1, jsonb_build_object('recipe', r.id, 'quality', v_q, 'score', v_score));
  perform public._game_event(v_acc, 'item_crafted', 1, jsonb_build_object('source', 'cook', 'item', r.id));     -- econ v2
  perform public._game_event(v_acc, 'xp_grant', 2 + v_q * 2, jsonb_build_object('source', 'cook'));
  return jsonb_build_object('result', 'ok', 'dish', r.id, 'score', v_score, 'steps', v_rep->'steps', 'quality', v_q,
                            'pan_bonus', public._pan_bonus((l.meta->>'pan')::int),                     -- 0121
                            'forest', public._forest_json(v_acc));
end $$;

-- ---------- C. Work ----------
-- _pg_work_reason (0104_econ_rewards.sql, verbatim but for the line marked 0121)
create or replace function public._pg_work_reason(p_reason text) returns boolean
language sql immutable parallel safe
as $$ select p_reason in ('sell','rice_sell','produce_sell','critter_sell','rat_sell','ore_sell','gem_sell','wild_sell',
                         'wood_sell','dish_sell') $$;   -- 0121: + wood_sell, dish_sell

-- ---------- D. Kỷ niệm Beta: rice and the forest in the net worth ----------
-- _beta_net_worth (0118_beta_reset.sql, verbatim but for the lines marked 0121)
--   rice       rice_stock dry kg × price + wet kg × price × 70 % (0121)
--   forest     logs × price (half-price logs at half), wild goods × the stall price, dishes at their sale value, bought
--              tools at their price (0121)
create or replace function public._beta_net_worth(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  with p as (
    select
      coalesce((select coins from public.wallets where account_id = p_account), 0)::bigint xu,
      coalesce((select sum(i.qty::bigint * coalesce(s.price, 0)) from public.inventory i join public.shop_items s on s.id = i.item_id
                 where i.account_id = p_account), 0)::bigint items,
      (coalesce((select sum(coalesce(s.price, 0)) from public.rods r join public.shop_items s on s.id = r.item_id where r.account_id = p_account), 0)
       + coalesce((select sum(coalesce(s.price, 0)) from public.rods r join public.rod_parts rp on rp.rod_id = r.id
                    join public.shop_items s on s.id = rp.item_id where r.account_id = p_account), 0))::bigint rods,
      (coalesce((select sum(price) from public.fish where account_id = p_account), 0)
       + coalesce((select sum(price) from public.fridge_fish where account_id = p_account), 0)
       + coalesce((select sum(af.price) from public.aquarium_fish af join public.furniture_items f on f.id = af.tank
                    where f.account_id = p_account), 0))::bigint fish,
      coalesce((select sum(c.price) from public.account_items a join public.item_catalog c on c.id = a.item_id
                 where a.account_id = p_account and not c.exclusive), 0)::bigint fashion,
      coalesce((select sum(c.price) from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
                 where f.account_id = p_account and not c.exclusive), 0)::bigint furniture,
      coalesce((select sum(v.price) from public.owned_vehicles o join public.vehicle_catalog v on v.id = o.vehicle_id
                 where o.account_id = p_account), 0)::bigint vehicles,
      coalesce((select sum(coalesce(public._pet_species_price(species), 0)) from public.pets where account_id = p_account), 0)::bigint pets,
      (select count(*) * 800000 from public.field_plots where owner_id = p_account)::bigint land,
      (coalesce((select sum(public._house_price('land') + build_cost::bigint * public._estate_rule('build') / 100)
                   from public.house_lots where owner_id = p_account), 0)
       + coalesce((select count(*) * public._apt_price('buy') from public.apartments where owner_id = p_account and tenure = 'own'), 0))::bigint houses,
      coalesce((select sum(ps.kg::bigint * u.price_per_kg) from public.produce_stock ps join public.upland_crops u on u.id = ps.upland
                 where ps.account_id = p_account), 0)::bigint produce,                                  -- 0121: a comma
      coalesce((select sum(rs.dry_kg::bigint * v.price_per_kg + (rs.wet_kg::bigint * v.price_per_kg * 7) / 10)   -- 0121 {
                  from public.rice_stock rs join public.rice_varieties v on v.id = rs.variety
                 where rs.account_id = p_account), 0)::bigint rice,
      (coalesce((select sum(w.qty::bigint * t.price + (w.half::bigint * t.price) / 2)
                   from public.wood_bag w join public._forest_trees() t on t.log = w.item where w.account_id = p_account), 0)
       + coalesce((select sum(b.qty::bigint * i.price) from public.wild_bag b join public._wild_items() i on i.id = b.item
                    where b.account_id = p_account), 0)
       + coalesce((select sum(d.qty::bigint * ((r.price * public._cook_pct(d.quality)) / 100))
                     from public.cooked_dishes d join public._cook_recipes() r on r.id = d.dish where d.account_id = p_account), 0)
       + coalesce((select sum(c.price) from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item
                    where t.account_id = p_account and not c.starter), 0))::bigint forest                -- 0121 }
  )
  select jsonb_build_object('xu', xu, 'items', items, 'rods', rods, 'fish', fish, 'fashion', fashion, 'furniture', furniture,
                            'vehicles', vehicles, 'pets', pets, 'land', land, 'houses', houses, 'produce', produce,
                            'rice', rice, 'forest', forest,                                                 -- 0121
                            'total', xu + items + rods + fish + fashion + furniture + vehicles + pets + land + houses + produce
                                     + rice + forest)                                                     -- 0121
    from p
$$;
revoke all on function public._beta_net_worth(uuid) from public, anon, authenticated;

-- ---------- E. Forest dailies ----------
insert into public.quest_defs (id, cat, title, descr, kind, filter, use_qty, goal, reward_coins, reward_xp, chain, needs, sort) values
  ('d_wood', 'daily', 'Tiều phu chăm chỉ', 'Đốn được 10 khúc gỗ ở rừng tràm.', 'wood_chopped', '{}', true, 10, 50, 40, null, null, 9),
  ('d_hunt', 'daily', 'Đi săn', 'Săn được 2 con thú ở rừng tràm (cần cung).', 'wild_hunt', '{}', false, 2, 50, 40, null, null, 10)
on conflict (id) do update set cat = excluded.cat, title = excluded.title, descr = excluded.descr, kind = excluded.kind,
  filter = excluded.filter, use_qty = excluded.use_qty, goal = excluded.goal, reward_coins = excluded.reward_coins,
  reward_xp = excluded.reward_xp, chain = excluded.chain, needs = excluded.needs, sort = excluded.sort;
