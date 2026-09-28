-- =========================================================
-- 0056_net_replay.sql — anti-cheat v2 #1, #2: the net becomes server-replayed (docs/superpowers/plans/
-- 2026-09-28-anticheat-v2-part1.md, part A). ADDITIVE and re-runnable. Run after 0055.
--   A. net_throws.arrow_seed (secret until the haul), land_tick, inputs (evidence).
--   B. The sim of lib/game/fishing/net.ts step for step — integer math, 60 Hz ticks, the reel's mulberry32 (_reel_rand):
--      _net_isin, _net_school, _net_shadow, _net_q, _net_aim_error, _net_throw_error, _net_haul_replay, _net_plan,
--      _net_arrow_seq, _net_arrow_replay, _net_keys_error. tests/fixtures/net-cases.json pins both (Vitest + the SQL
--      smoke tests/sql/anticheat-v2-net-smoke.sql).
--   C. start_net (0047's body): opens the aim — checks as before, rolls the school seed (answered) and the arrow seed
--      (kept), and spends nothing (N1): the net's use and the throw's effort move to net_haul.
--   D. net_haul(token, throw, press, release, aim_x, aim_y, hits): spends the throw, then replays it from the seed and
--      decides the catch itself. finish_net(token, throw, keys, ticks, mistakes): replays kéo lưới from the arrow seed.
--        input no client can make → lost 'net_invalid', hard flag 'net_bad_input';
--        the replay disagrees with the client's count → lost 'net_invalid', hard flag 'net_mismatch';
--        sooner in real time than the replayed ticks (× 0.9) → lost 'too_early', hard flag 'net_too_fast';
--        the old signatures (net_haul with charge/offsets, finish_net with a bare mistake count) and a throw from before
--        0056 → lost 'outdated', 'Cập nhật trang để quăng lưới tiếp' (no flag, nothing spent).
--      0037's 0.8 s-per-round gate is replaced by the replay's tick gate (a quick honest typist could beat it).
-- =========================================================

-- ---------- A. The throw row ----------
alter table public.net_throws add column if not exists arrow_seed bigint;
alter table public.net_throws add column if not exists land_tick integer;
alter table public.net_throws add column if not exists inputs jsonb;

-- ---------- B. The sim ----------
-- ≈ 1000·sin(2πt/p): a parabola per half period (p a multiple of 4, t ≥ 0). net.ts isin.
create or replace function public._net_isin(t bigint, p bigint) returns bigint
language plpgsql immutable parallel safe
as $$
declare half bigint := p / 2; ph bigint := t % p; u bigint; m bigint;
begin
  u := case when ph < half then ph else ph - half end;
  m := (4000 * u * (half - u)) / (half * half);
  return case when ph < half then m else -m end;
end $$;

-- The school a seed makes (net.ts netSchool), flat: [period, cx, cy, ax, ay, pw, pwy, ph] then per fish
-- [ox, oy, rx, ry, pf, pfy, ph, size] × 5 — 48 draws of mulberry32 in that order.
create or replace function public._net_school(p_seed bigint) returns bigint[]
language plpgsql immutable parallel safe
as $$
declare s bigint := p_seed & 4294967295; r bigint[]; u bigint[] := '{}'; o bigint[]; b integer;
begin
  for i in 1 .. 48 loop
    r := public._reel_rand(s);
    s := r[2];
    u := u || r[1];
  end loop;
  o := array[2 * (33 + u[1] % 7), 50000 + u[2] % 60001, 30000 + u[3] % 20001, 20000 + u[4] % 20001, 6000 + u[5] % 8001,
             4 * (190 + u[6] % 190), 4 * (110 + u[7] % 110), u[8] % 1000];
  for i in 0 .. 4 loop
    b := 8 + 8 * i;
    o := o || array[(u[b + 1] % 60001) - 30000, (u[b + 2] % 30001) - 15000, 4000 + u[b + 3] % 10001, 2000 + u[b + 4] % 5001,
                    4 * (48 + u[b + 5] % 70), 4 * (37 + u[b + 6] % 54), u[b + 7] % 1000,
                    case when u[b + 8] % 10 < 3 then 2 else 1 end];
  end loop;
  return o;
end $$;

-- Shadow i (0 … 4) at tick t: {x, y} in milli-px (net.ts netShadowsAt).
create or replace function public._net_shadow(p_school bigint[], t bigint, i integer) returns bigint[]
language plpgsql immutable parallel safe
as $$
declare b integer := 8 + 8 * i; sx bigint; sy bigint; a bigint;
begin
  sx := p_school[2] + (p_school[4] * public._net_isin(t + p_school[8], p_school[6])) / 1000;
  sy := p_school[3] + (p_school[5] * public._net_isin(t + p_school[8] + 250, p_school[7])) / 1000;
  a := t + p_school[b + 7];
  return array[
    least(154000, greatest(6000, sx + p_school[b + 1] + (p_school[b + 3] * public._net_isin(a + p_school[b + 5] / 4, p_school[b + 5])) / 1000)),
    least(74000, greatest(8000, sy + p_school[b + 2] + (p_school[b + 4] * public._net_isin(a, p_school[b + 6])) / 1000))];
end $$;

-- The power ‰ after holding `charge` ticks with the school's period (net.ts netQuality).
create or replace function public._net_q(p_charge bigint, p_period bigint) returns bigint
language sql immutable parallel safe
as $$
  select case when p_charge <= 0 then 0
              else (4000 * (p_charge % p_period) * (p_period - p_charge % p_period)) / (p_period * p_period) end
$$;

-- An aim (milli-px) the client never sends (net.ts netAimError): off the water or out of the hands' range.
create or replace function public._net_aim_error(p_x integer, p_y integer) returns text
language sql immutable parallel safe
as $$
  select case when p_x is null or p_y is null or p_x < 4000 or p_x > 156000 or p_y < 8000 or p_y > 74000
                   or (p_x - 80000)::bigint * (p_x - 80000) + (p_y - 84000)::bigint * (p_y - 84000) > 70000::bigint * 70000
              then 'aim' end
$$;

-- A throw's input no client can make (net.ts netThrowError).
create or replace function public._net_throw_error(p_press integer, p_release integer, p_x integer, p_y integer) returns text
language sql immutable parallel safe
as $$
  select case when p_press is null or p_release is null or p_press < 0 or p_release < p_press or p_release > 3600 then 'range'
              else public._net_aim_error(p_x, p_y) end
$$;

-- The throw replayed (net.ts netHaulReplay): {quality, land_tick, land_x, land_y, r, caught[5], hits, count}.
create or replace function public._net_haul_replay(p_seed bigint, p_radius integer, p_press integer, p_release integer,
                                                   p_x integer, p_y integer) returns jsonb
language plpgsql immutable parallel safe
as $$
declare sch bigint[] := public._net_school(p_seed); q bigint; k bigint; lx bigint; ly bigint; fr bigint; r bigint;
        lt bigint := p_release + 42; sh bigint[]; dx bigint; dy bigint; v_in boolean; caught jsonb := '[]'::jsonb;
        hits integer := 0; base integer;
begin
  q := public._net_q(p_release - p_press, sch[1]);
  k := case when q >= 850 then 1000 else 450 + (550 * q) / 850 end;
  lx := 80000 + ((p_x - 80000) * k) / 1000;
  ly := least(76000, 84000 + ((p_y - 84000) * k) / 1000);
  fr := 14000 + (greatest(24, coalesce(p_radius, 24)) - 24) * 500;
  r := (fr * (4000 + 6 * least(1000, greatest(0, q)))) / 10000;
  for i in 0 .. 4 loop
    sh := public._net_shadow(sch, lt, i);
    dx := sh[1] - lx;
    dy := sh[2] - ly;
    v_in := 9 * dx * dx + 25 * dy * dy <= 9 * r * r;
    caught := caught || to_jsonb(v_in);
    if v_in then hits := hits + 1; end if;
  end loop;
  base := least(5, 2 + ((3 * q + 500) / 1000)::int + case when coalesce(p_radius, 24) >= 32 then 1 else 0 end);
  return jsonb_build_object('quality', q, 'land_tick', lt, 'land_x', lx, 'land_y', ly, 'r', r, 'caught', caught,
                            'hits', hits, 'count', greatest(0, base - (5 - hits)));
end $$;

-- Kéo lưới's plan from the haul (net.ts netArrowPlan): {rounds, keys, timer ticks}; dg = Σ(rarity·1000 + grams).
create or replace function public._net_plan(p_haul jsonb) returns integer[]
language sql immutable parallel safe
as $$
  select array[least(5, greatest(2, (d + 1000) / 2000 + 1)), least(9, greatest(4, 4 + d / 3000)),
               least(252, greatest(180, 252 - (d * 48) / 10000))]::integer[]
    from (select coalesce(sum((f->>'rarity')::bigint * 1000 + (f->>'weight_g')::bigint), 0)::bigint d
            from jsonb_array_elements(coalesce(p_haul, '[]'::jsonb)) f) x
$$;

-- Round r's sequence (net.ts netArrowSeq): codes 0 … 3 (up, down, left, right) = the top two bits of mulberry32.
create or replace function public._net_arrow_seq(p_seed bigint, p_round integer, p_n integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare s bigint := (p_seed + 7919 * p_round) & 4294967295; r bigint[]; o integer[] := '{}';
begin
  for i in 1 .. p_n loop
    r := public._reel_rand(s);
    s := r[2];
    o := o || (r[1] >> 30)::integer;
  end loop;
  return o;
end $$;

-- Kéo lưới replayed from its keys (tick·4 + code; net.ts netArrowReplay): {mistakes 0 … 4, ticks: the end tick}, or
-- {error: 'late'} for a key after the end. A round times out at start + timer (its wrong keys + 1, the next starts
-- there); a right key advances (the last ends the round at that tick); a wrong one is a mistake; the 4th ends it.
create or replace function public._net_arrow_replay(p_seed bigint, p_plan integer[], p_keys integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rounds integer := p_plan[1]; nk integer := p_plan[2]; timer integer := p_plan[3];
        rnd integer := 0; seq integer[]; at integer := 0; wrongs integer := 0; mist integer := 0; st integer := 0;
        done boolean := false; fin integer := 0; tick integer; code integer; k integer; add integer; t_at integer;
begin
  seq := public._net_arrow_seq(p_seed, 0, nk);
  foreach k in array coalesce(p_keys, '{}'::integer[]) loop
    tick := k / 4;
    code := k % 4;
    while not done and tick >= st + timer loop                                   -- the time-outs up to this key
      t_at := st + timer;
      mist := mist + wrongs + 1;
      rnd := rnd + 1;
      if mist > 3 or rnd >= rounds then
        done := true; fin := t_at;
      else
        seq := public._net_arrow_seq(p_seed, rnd, nk); at := 0; wrongs := 0; st := t_at;
      end if;
    end loop;
    if done then return jsonb_build_object('error', 'late'); end if;
    if seq[at + 1] <> code then
      wrongs := wrongs + 1;
      if mist + wrongs > 3 then
        mist := mist + wrongs; done := true; fin := tick;
      end if;
    else
      at := at + 1;
      if at >= nk then
        add := wrongs;
        mist := mist + add;
        rnd := rnd + 1;
        if mist > 3 or rnd >= rounds then
          done := true; fin := tick;
        else
          seq := public._net_arrow_seq(p_seed, rnd, nk); at := 0; wrongs := 0; st := tick;
        end if;
      end if;
    end if;
  end loop;
  while not done loop                                                            -- no more keys: the rest time out
    t_at := st + timer;
    mist := mist + wrongs + 1;
    rnd := rnd + 1;
    if mist > 3 or rnd >= rounds then
      done := true; fin := t_at;
    else
      seq := public._net_arrow_seq(p_seed, rnd, nk); at := 0; wrongs := 0; st := t_at;
    end if;
  end loop;
  return jsonb_build_object('mistakes', least(4, mist), 'ticks', fin);
end $$;

-- Kéo lưới's keys no client sends (net.ts netKeysError): the end tick 0 … 3 600, at most 64 keys, each at or before the
-- end, ticks never going back, at most 20 keys in any 60 ticks.
create or replace function public._net_keys_error(p_keys integer[], p_ticks integer) returns text
language plpgsql immutable parallel safe
as $$
declare n integer := coalesce(cardinality(p_keys), 0);
begin
  if p_ticks is null or p_ticks < 0 or p_ticks > 3600 then return 'ticks'; end if;
  if n > 64 then return 'too_many'; end if;
  if n = 0 then return null; end if;
  if array_ndims(p_keys) <> 1 or array_lower(p_keys, 1) <> 1 then return 'shape'; end if;
  for i in 1 .. n loop
    if p_keys[i] is null or p_keys[i] < 0 or p_keys[i] / 4 > p_ticks then return 'range'; end if;
    if i > 1 and p_keys[i] / 4 < p_keys[i - 1] / 4 then return 'order'; end if;
    if i > 20 and p_keys[i] / 4 - p_keys[i - 20] / 4 < 60 then return 'rate'; end if;
  end loop;
  return null;
end $$;

revoke all on function public._net_isin(bigint, bigint) from public, anon, authenticated;
revoke all on function public._net_school(bigint) from public, anon, authenticated;
revoke all on function public._net_shadow(bigint[], bigint, integer) from public, anon, authenticated;
revoke all on function public._net_q(bigint, bigint) from public, anon, authenticated;
revoke all on function public._net_aim_error(integer, integer) from public, anon, authenticated;
revoke all on function public._net_throw_error(integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._net_haul_replay(bigint, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._net_plan(jsonb) from public, anon, authenticated;
revoke all on function public._net_arrow_seq(bigint, integer, integer) from public, anon, authenticated;
revoke all on function public._net_arrow_replay(bigint, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._net_keys_error(integer[], integer) from public, anon, authenticated;

-- ---------- C. start_net (0047's, verbatim but for the lines marked 0056) ----------
create or replace function public.start_net(p_room_id uuid, p_session_token text, p_col integer, p_row integer,
                                            p_net text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_d integer; v_seed integer;
        v_id uuid; v_beat integer; v_bucket integer;
        v_vitals jsonb;                                                                  -- 0047
        v_arrow bigint := floor(random() * 2147483648)::bigint;                          -- 0056: kéo lưới's seed, kept until the haul
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_net and kind = 'net') then
    raise exception 'no net' using errcode = '22023';
  end if;
  select durability into v_d from public.inventory where account_id = v_account and item_id = p_net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  -- 0047: no hourly or daily cast cap
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then raise exception 'hands full' using errcode = '22023'; end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  delete from public.casts where account_id = v_account;
  delete from public.net_throws where account_id = v_account;
  -- 0056 was: if v_d <= 1 then
  -- 0056 was:   delete from public.inventory where account_id = v_account and item_id = p_net;
  -- 0056 was: else
  -- 0056 was:   update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = p_net;
  -- 0056 was: end if;
  v_seed := floor(random() * 2147483647)::int;
  v_beat := public._net_beat_ms(v_seed);
  insert into public.net_throws (account_id, room_id, net, seed, beat_ms, arrow_seed)   -- 0056 was: insert into public.net_throws (account_id, room_id, net, seed, beat_ms)
  values (v_account, p_room_id, p_net, v_seed, v_beat, v_arrow) returning id into v_id;   -- 0056 was: values (v_account, p_room_id, p_net, v_seed, v_beat) returning id into v_id;
  -- 0056 was: v_vitals := public._fishing_effort(v_account, 3, 3.5);                                 -- 0047: a throw's effort
  return jsonb_build_object('throw_id', v_id, 'seed', v_seed, 'beat_ms', v_beat,
    'radius_px', (select radius_px from public.shop_items where id = p_net),
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;
revoke all on function public.start_net(uuid, text, integer, integer, text) from public;
grant execute on function public.start_net(uuid, text, integer, integer, text) to anon, authenticated;

-- ---------- D. The haul and the pull ----------
-- The old answer for a page before 0056 (or a throw rolled before it): nothing is spent, no fish.
create or replace function public._net_outdated(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('result', 'lost', 'why', 'outdated', 'message', 'Cập nhật trang để quăng lưới tiếp',
                            'state', public._fishing_state(p_account))
$$;
revoke all on function public._net_outdated(uuid) from public, anon, authenticated;

-- 0034's net_haul (charge + offsets) and 0037's finish_net (a bare mistake count): the client's word only — no fish.
create or replace function public.net_haul(p_session_token text, p_throw_id uuid, p_charge_ms integer,
                                           p_offsets integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  delete from public.net_throws where account_id = v_account and id = p_throw_id;
  return public._net_outdated(v_account);
end; $$;

create or replace function public.finish_net(p_session_token text, p_throw_id uuid, p_mistakes integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  delete from public.net_throws where account_id = v_account and id = p_throw_id;
  return public._net_outdated(v_account);
end; $$;

-- The net sank (0034's net_haul, now replayed). The throw is spent first (the net's use, hunger 3 / thirst 3.5: 0047's
-- effort, N1), then judged: expired (over 120 s after start_net), a bad input, a mismatch or too fast → lost (the throw is
-- gone); no fish → 'empty'; else the catch — the replay's count, clipped to the free room, each a common or uncommon
-- species at the room's price index — is kept on the row for kéo lưới, and the answer carries it with the arrow seed.
create or replace function public.net_haul(p_session_token text, p_throw_id uuid, p_press integer, p_release integer,
                                           p_aim_x integer, p_aim_y integer, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_n integer; v_free integer; sp public.fish_species;
        v_w integer; v_price integer; r public.fish_price_index; v_mult numeric := 1; v_room boolean;
        v_haul jsonb := '[]'::jsonb; v_d integer; v_vitals jsonb; v_bad text; v_rep jsonb; v_ac jsonb;
        v_radius integer; v_in jsonb;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select * into t from public.net_throws where account_id = v_account and id = p_throw_id for update;
  if not found or t.haul is not null then raise exception 'throw not found' using errcode = '22023'; end if;
  if t.arrow_seed is null then                                                            -- rolled before 0056
    delete from public.net_throws where id = t.id;
    return public._net_outdated(v_account);
  end if;
  -- the throw is spent: one use of the net (a net at 0 is removed) and the throw's effort
  select durability into v_d from public.inventory where account_id = v_account and item_id = t.net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  if v_d <= 1 then
    delete from public.inventory where account_id = v_account and item_id = t.net;
  else
    update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = t.net;
  end if;
  perform public._vitals_apply(v_account);
  v_vitals := public._fishing_effort(v_account, 3, 3.5);
  v_in := jsonb_build_object('press', p_press, 'release', p_release, 'aim_x', p_aim_x, 'aim_y', p_aim_y, 'hits', p_hits);
  if now() > t.started_at + interval '120 seconds' then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'vitals', v_vitals, 'state', public._fishing_state(v_account));
  end if;
  v_bad := coalesce(public._net_throw_error(p_press, p_release, p_aim_x, p_aim_y),
                    case when p_hits is null or p_hits < 0 or p_hits > 5 then 'hits' end);
  if v_bad is not null then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_bad_input', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'error', v_bad, 'inputs', v_in), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  v_radius := coalesce((select radius_px from public.shop_items where id = t.net), 24);
  v_rep := public._net_haul_replay(t.seed, v_radius, p_press, p_release, p_aim_x, p_aim_y);
  if (v_rep->>'hits')::int <> p_hits then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_mismatch', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'seed', t.seed, 'radius', v_radius, 'inputs', v_in, 'replay', v_rep), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  if now() < t.started_at + make_interval(secs => 0.9 * (p_release + 42 + 90) / 60.0) then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_too_fast', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'started_at', t.started_at, 'hauled_at', now(), 'inputs', v_in,
                                 'need_s', round(0.9 * (p_release + 42 + 90) / 60.0, 3)), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  v_n := (v_rep->>'count')::int;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  v_n := least(v_n, v_free);
  if v_n = 0 then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'empty', 'count', 0, 'fish', '[]'::jsonb, 'vitals', v_vitals,
                              'state', public._fishing_state(v_account));
  end if;
  v_room := t.room_id is not null and exists (select 1 from public.rooms where id = t.room_id);
  if v_room then
    r := public._fish_index(t.room_id, now());
    v_mult := r.mult;
  end if;
  for i in 1 .. v_n loop
    select * into sp from public.fish_species where rarity in (1, 2) order by random() limit 1;
    v_w := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), 2.0))::int);
    v_price := greatest(1, round(sp.price_per_kg * v_w / 1000.0 * v_mult
                                 * case when v_room then public._fish_factor(t.room_id, sp.id, r.period) else 1 end)::int);
    v_haul := v_haul || jsonb_build_array(jsonb_build_object('species_id', sp.id, 'weight_g', v_w, 'price', v_price,
                                                             'rarity', sp.rarity));
  end loop;
  update public.net_throws set haul = v_haul, hauled_at = now(), land_tick = (v_rep->>'land_tick')::int, inputs = v_in
   where id = t.id;
  return jsonb_build_object('result', 'haul', 'count', v_n, 'fish', v_haul, 'quality', (v_rep->>'quality')::int,
    'arrow_seed', t.arrow_seed, 'vitals', v_vitals, 'state', public._fishing_state(v_account));
end; $$;

-- Kéo lưới ended (0037's finish_net, now replayed; single use). The keys are replayed from the arrow seed and the haul's
-- plan; the replay's mistakes decide as 0037's did: 0 = all the fish, 1–3 = one random fish escapes per mistake, 4 = kéo
-- hụt (pulled into the pond: hunger −10 and the v18.10 swim immunity). Late (60 s after the haul): 'expired'.
create or replace function public.finish_net(p_session_token text, p_throw_id uuid, p_keys integer[], p_ticks integer,
                                             p_mistakes integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_free integer; f jsonb; v_id uuid; v_fish jsonb := '[]'::jsonb;
        v_vit public.vitals; v_n integer := 0; v_keep jsonb; v_bad text; v_plan integer[]; v_rep jsonb; v_ac jsonb;
        v_m integer; v_ev jsonb;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  delete from public.net_throws where account_id = v_account and id = p_throw_id returning * into t;
  if not found or t.haul is null then raise exception 'throw not found' using errcode = '22023'; end if;
  if t.arrow_seed is null then return public._net_outdated(v_account); end if;           -- hauled before 0056
  if now() > t.hauled_at + interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._fishing_state(v_account));
  end if;
  v_ev := jsonb_build_object('throw_id', t.id, 'ticks', p_ticks, 'mistakes', p_mistakes,
                             'n', coalesce(cardinality(p_keys), 0), 'keys', to_jsonb(p_keys[1:64]));
  v_bad := coalesce(public._net_keys_error(p_keys, p_ticks),
                    case when p_mistakes is null or p_mistakes < 0 or p_mistakes > 4 then 'mistakes' end);
  v_plan := public._net_plan(t.haul);
  if v_bad is null then
    v_rep := public._net_arrow_replay(t.arrow_seed, v_plan, p_keys);
    v_bad := v_rep->>'error';
  end if;
  if v_bad is not null then
    v_ac := public._ac_flag(v_account, 'net_bad_input', 'finish_net', v_ev || jsonb_build_object('error', v_bad), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'state', public._fishing_state(v_account)) || v_ac;
  end if;
  if (v_rep->>'mistakes')::int <> p_mistakes or (v_rep->>'ticks')::int <> p_ticks then
    v_ac := public._ac_flag(v_account, 'net_mismatch', 'finish_net',
              v_ev || jsonb_build_object('seed', t.arrow_seed, 'plan', to_jsonb(v_plan), 'replay', v_rep), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'state', public._fishing_state(v_account)) || v_ac;
  end if;
  v_m := (v_rep->>'mistakes')::int;
  if v_m >= 4 then                                                                        -- kéo hụt (0037)
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - 10) where account_id = v_account returning * into v_vit;
    perform public._heat_row(v_account);
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', null, 'rod_lost', false, 'hunger', 10),
      'vitals', public._vitals_json(v_vit), 'state', public._fishing_state(v_account));
  end if;
  if now() < t.hauled_at + make_interval(secs => 0.9 * p_ticks / 60.0) then               -- sooner than the ticks took
    v_ac := public._ac_flag(v_account, 'net_too_fast', 'finish_net',
              v_ev || jsonb_build_object('hauled_at', t.hauled_at, 'finished_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3)),
              t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'state', public._fishing_state(v_account)) || v_ac;
  end if;
  -- one random fish escapes per mistake (0037)
  select coalesce(jsonb_agg(x.v), '[]'::jsonb) into v_keep
    from (select value v from jsonb_array_elements(t.haul) order by random()
          offset least(v_m, jsonb_array_length(t.haul))) x;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  for f in select value from jsonb_array_elements(v_keep) loop
    exit when v_n >= v_free;
    insert into public.fish (account_id, species_id, weight_g, price)
    values (v_account, f->>'species_id', (f->>'weight_g')::int, (f->>'price')::int) returning id into v_id;
    v_fish := v_fish || jsonb_build_array(f || jsonb_build_object('id', v_id));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('result', 'caught', 'count', v_n, 'fish', v_fish,
    'escaped', jsonb_array_length(t.haul) - jsonb_array_length(v_keep),
    'state', public._fishing_state(v_account));
end; $$;

revoke all on function public.net_haul(text, uuid, integer, integer[]) from public;
revoke all on function public.finish_net(text, uuid, integer) from public;
revoke all on function public.net_haul(text, uuid, integer, integer, integer, integer, integer) from public;
revoke all on function public.finish_net(text, uuid, integer[], integer, integer) from public;
grant execute on function public.net_haul(text, uuid, integer, integer[]) to anon, authenticated;
grant execute on function public.finish_net(text, uuid, integer) to anon, authenticated;
grant execute on function public.net_haul(text, uuid, integer, integer, integer, integer, integer) to anon, authenticated;
grant execute on function public.finish_net(text, uuid, integer[], integer, integer) to anon, authenticated;
