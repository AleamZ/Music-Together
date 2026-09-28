-- =========================================================
-- 0046_reel_verify.sql — the reel becomes server-authoritative (owner's report 2026-09-28: a modified client enlarged the
-- green zone and always landed the fish). ADDITIVE and re-runnable. Run after 0045.
--   A. casts.reel_seed / reel_params: the server rolls the reel's seed at start_cast and keeps the reel's params
--      (zone_pct from the rod, difficulty and min_reel_ms from the species) on the cast row.
--   B. _reel_imul / _reel_rand / _reel_replay / _reel_input_error: the reel of lib/game/fishing/reel.ts step for step —
--      60 Hz ticks, integer math, mulberry32 on u32s. tests/fixtures/reel-cases.json pins both (Vitest + the SQL smoke).
--   C. start_cast (0038's body): rolls the seed, stores it with the params, answers 'reel_seed'.
--   D. finish_cast (0034's body, now 6 args): a won reel must come with its input (p_inputs: the ticks where the hold
--      flipped; p_ticks: the tick it ended on). The server validates and replays it, and lands the fish only when the
--      replay is caught on exactly that tick, and no sooner in real time than the ticks took (0.9 × ticks / 60 s after
--      the bite, besides the old 0.9 × min_reel_ms gate).
--        no input (a page before 0046, or a cast rolled before it) → lost, why 'outdated', message
--          'Cập nhật trang để câu tiếp' (no flag);
--        input no reel can make → lost, why 'reel_invalid', hard flag 'reel_bad_input';
--        replay not caught on p_ticks → lost, why 'reel_invalid', hard flag 'reel_mismatch';
--        too fast in real time → lost, why 'too_early', hard flag 'reel_too_fast' (as before).
--      A lost reel (p_success false) is still the client's word: losing only costs the player.
-- =========================================================

-- ---------- A. The cast row ----------
alter table public.casts add column if not exists reel_seed bigint;
alter table public.casts add column if not exists reel_params jsonb;

-- ---------- B. The reel ----------
-- Math.imul on u32s: the low 32 bits of a × b, without overflowing bigint (a < 2^32, b split in 16-bit halves).
create or replace function public._reel_imul(a bigint, b bigint) returns bigint
language sql immutable parallel safe
as $$
  select ((a * (b & 65535)) + (((a * (b >> 16)) & 65535) << 16)) & 4294967295
$$;

-- mulberry32 (lib/game/fishing/reel.ts rand32): {output u32, next state u32}.
create or replace function public._reel_rand(p_state bigint) returns bigint[]
language plpgsql immutable parallel safe
as $$
declare s bigint; t bigint;
begin
  s := (p_state + 1831565813) & 4294967295;                                              -- 0x6d2b79f5
  t := public._reel_imul(s # (s >> 15), s | 1);
  t := t # ((t + public._reel_imul(t # (t >> 7), t | 61)) & 4294967295);
  return array[t # (t >> 14), s];
end $$;

-- The whole reel from its toggle ticks (lib/game/fishing/reel.ts replayReel): {outcome, ticks, progress}. Holding starts
-- released and flips before each listed tick is stepped. Positions in millionths of the bar, progress in billionths.
create or replace function public._reel_replay(p_params jsonb, p_seed bigint, p_inputs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare
  h bigint := least(90, greatest(5, trunc(coalesce((p_params->>'zone_pct')::numeric, 25))))::bigint * 10000;
  d bigint := least(100, greatest(0, trunc(coalesce((p_params->>'difficulty')::numeric, 0))))::bigint;
  m bigint := least(60000, greatest(1000, trunc(coalesce((p_params->>'min_reel_ms')::numeric, 2000))))::bigint;
  fl bigint; thr bigint; spread bigint; step bigint; gain bigint; loss bigint;
  r bigint[]; rng bigint; zone bigint := 0; v bigint := 0; fish bigint; target bigint; prog bigint := 300000000;
  tick integer := 0; hold boolean := false; i integer := 1; n integer := coalesce(cardinality(p_inputs), 0);
  gap bigint; v_outcome text;
begin
  fl := least(500000, h + 50000);
  thr := ((300 + 12 * d) * 4294967296) / 60000;
  spread := 250000 + 6000 * d;
  step := (180000 + 6200 * d) / 60;
  gain := 700000000000 / (60 * m);
  loss := (75000000 + 700000 * d) / 60;
  r := public._reel_rand(p_seed & 4294967295);
  rng := r[2];
  fish := greatest(450000, fl);
  target := fl + (r[1] * (1000000 - fl)) / 4294967296;
  loop
    while i <= n and p_inputs[i] = tick loop
      hold := not hold;
      i := i + 1;
    end loop;
    v := greatest(-23333, least(23333, v + case when hold then 833 else -611 end));
    zone := zone + v;
    if zone < 0 then
      zone := 0;
      if v < 0 then v := (-v * 35) / 100; end if;
    end if;
    if zone > 1000000 - h then
      zone := 1000000 - h;
      v := 0;
    end if;
    r := public._reel_rand(rng);
    rng := r[2];
    if abs(target - fish) < 20000 or r[1] < thr then
      r := public._reel_rand(rng);
      rng := r[2];
      target := least(1000000, greatest(fl, fish + ((r[1] - 2147483648) * spread) / 4294967296));
    end if;
    gap := target - fish;
    if abs(gap) <= step then
      fish := target;
    elsif gap > 0 then
      fish := fish + step;
    else
      fish := fish - step;
    end if;
    tick := tick + 1;
    if fish >= zone and fish <= zone + h then prog := prog + gain; else prog := prog - loss; end if;
    if prog >= 1000000000 then
      prog := 1000000000;
      v_outcome := 'caught';
    elsif prog <= 0 then
      prog := 0;
      v_outcome := 'escaped';
    elsif tick >= 3600 then
      v_outcome := 'escaped';
    end if;
    exit when v_outcome is not null;
  end loop;
  return jsonb_build_object('outcome', v_outcome, 'ticks', tick, 'progress', prog);
end $$;

-- Why a reel's input is one no reel can make (null = fine): ticks 1 … 3600 (60 s), toggles strictly increasing inside
-- [0, ticks), and at most 45 flips in any 60 ticks (22 presses a second — past any hand; a person manages ~10).
create or replace function public._reel_input_error(p_inputs integer[], p_ticks integer) returns text
language plpgsql immutable parallel safe
as $$
declare n integer := coalesce(cardinality(p_inputs), 0);
begin
  if p_ticks is null or p_ticks < 1 or p_ticks > 3600 then return 'ticks'; end if;
  if n = 0 then return null; end if;
  if array_ndims(p_inputs) <> 1 or array_lower(p_inputs, 1) <> 1 then return 'shape'; end if;
  if n > 3600 then return 'too_many'; end if;
  for i in 1 .. n loop
    if p_inputs[i] is null or p_inputs[i] < 0 or p_inputs[i] >= p_ticks then return 'range'; end if;
    if i > 1 and p_inputs[i] <= p_inputs[i - 1] then return 'order'; end if;
    if i > 45 and p_inputs[i] - p_inputs[i - 45] < 60 then return 'rate'; end if;
  end loop;
  return null;
end $$;

revoke all on function public._reel_imul(bigint, bigint) from public, anon, authenticated;
revoke all on function public._reel_rand(bigint) from public, anon, authenticated;
revoke all on function public._reel_replay(jsonb, bigint, integer[]) from public, anon, authenticated;
revoke all on function public._reel_input_error(integer[], integer) from public, anon, authenticated;

-- ---------- C. start_cast ----------
-- 0038's start_cast, verbatim but for the lines marked 0046 (0038's header: "start_cast (0034's body); v18.9: while cảm
-- lạnh, 30 % of casts never bite.").
create or replace function public.start_cast(p_room_id uuid, p_session_token text, p_col integer default null,
                                             p_row integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
        v_spot text := 'dock'; v_bites boolean := true;                                  -- v18.1
        v_boost real;                                                                    -- v18.2
        v_seed bigint := floor(random() * 4294967296)::bigint;                           -- 0046: the reel's seed (u32)
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_col is not null or p_row is not null then                                         -- v18.1: null = an older client (docks only)
    v_spot := public._pond_spot(p_col, p_row);
    if v_spot is null then raise exception 'bad spot' using errcode = '22023'; end if;
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;   -- v18.8
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then                                       -- v18.2
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 1. hourly cap: a new window starts at the first cast after the previous one ended
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
  -- 1b. daily cap: the seconds until the next Vietnam midnight
  if p.day_on = v_today and p.day_casts >= 300 then
    raise exception 'daily cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  -- 2. a new cast abandons the previous one (its bait is already spent)
  delete from public.casts where account_id = v_account;
  -- 3. room for the catch
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  -- 4. one bait: the selected kind, else worms
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);    -- v18.2
  -- 5. roll the fish (v14 spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,          -- v18.8: weather
                                  not (public._room_weather(p_room_id)).is_day);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);   -- v18.8: fewer bites = longer wait
  v_bite := greatest(1000, round(v_bite * v_boost)::int);                                 -- v18.2: a boosting bait
  if v_spot = 'shore' then                                                                -- v18.1: the shore's odds
    v_bite := least(60000, round(v_bite * 1.5)::int);
    v_bites := random() < case when v_boost < 1 then 0.8 else 0.4 end;                    -- v18.2: 80% with a boost
  end if;
  if v_bites and public._rain_cold(v_account) and random() < 0.3 then                     -- v18.9: cảm lạnh
    v_bites := false;
  end if;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod,                                         -- v18.1
                            reel_seed, reel_params)                                        -- 0046
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          v_spot, v_bites, sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,   -- v18.1
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),                        -- 0046
                                     'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
  returning id into v_id;
  update public.fishing_profiles
     set window_casts = window_casts + 1,
         day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
         day_on = v_today
   where account_id = v_account
  returning day_casts into v_day;
  if v_day = 300 then
    perform public._ac_flag(v_account, 'cast_daily_cap', 'start_cast', jsonb_build_object('day', v_today, 'casts', 300),
                            p_room_id, null, false);
  end if;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'reel_seed', v_seed,                                                                  -- 0046
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.start_cast(uuid, text, integer, integer) to anon, authenticated;

-- ---------- D. finish_cast ----------
-- 0034's finish_cast, verbatim but for the lines marked 0046; 0034's header: finish_cast (0031's body, 4 args); v18.2: every hook attempt wears the cast's rod by 1 (caught, gave_up, too_early,
-- full, expired — not no_bite, where nothing bit, nor overboard, which wears 3). Overboard also grants the v18.10 swim
-- immunity, as climbing out of the water does (leave_water: 10 min, the heat shock cleared). Answers carry rod_broke.
drop function if exists public.finish_cast(text, uuid, boolean, boolean);                 -- 0046: two more args
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,
                                              p_hooked boolean default false,
                                              p_inputs integer[] default null,             -- 0046: the toggle ticks
                                              p_ticks integer default null) returns jsonb  -- 0046: the tick it ended on
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
        v_out jsonb; v_rod text; v_vit public.vitals;                                     -- v18.1
        v_broke boolean := false;                                                         -- v18.2
        v_bad text; v_replay jsonb;                                                       -- 0046
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  -- 0046: a won reel is replayed from the cast's seed and params; the client's word alone lands nothing
  if coalesce(p_success, false) and c.reel_seed is not null and p_inputs is not null and p_ticks is not null then
    v_bad := public._reel_input_error(p_inputs, p_ticks);
    if v_bad is null then
      v_replay := public._reel_replay(c.reel_params, c.reel_seed, p_inputs);
    end if;
  end if;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not c.bites then                                                                  -- v18.1: nothing bit
    v_why := 'no_bite';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
    if coalesce(p_hooked, false) and c.big and now() >= c.bite_at then                   -- v18.1: pulled in
      v_why := 'overboard';
    end if;
  elsif c.reel_seed is null or p_inputs is null or p_ticks is null then                     -- 0046: a page before the replay
    v_why := 'outdated';
  elsif v_bad is not null then                                                            -- 0046: input no reel can make
    v_why := 'reel_invalid';
    v_ac := public._ac_flag(v_account, 'reel_bad_input', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'error', v_bad, 'ticks', p_ticks,
                                 'toggles', cardinality(p_inputs), 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif v_replay->>'outcome' is distinct from 'caught' or (v_replay->>'ticks')::int <> p_ticks then   -- 0046
    v_why := 'reel_invalid';                                                              -- the reel did not land it
    v_ac := public._ac_flag(v_account, 'reel_mismatch', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'seed', c.reel_seed, 'params', c.reel_params,
                                 'claimed_ticks', p_ticks, 'replay', v_replay, 'toggles', cardinality(p_inputs),
                                 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif now() < c.bite_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then
    -- the existing gate, and (0046) no sooner in real time than the replayed ticks took
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3),
                                 'ticks', p_ticks),                                       -- 0046
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  v_rod := coalesce(c.rod, 'rod_wood');                                                   -- v18.2 (was in the branch below)
  if v_why = 'overboard' then                                                             -- v18.1: the fall's cost
    v_out := public._overboard_outcome(v_rod, random());
    perform public._rod_wear(v_account, v_rod, (v_out->>'wear')::int);
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - (v_out->>'hunger')::numeric)
     where account_id = v_account returning * into v_vit;
    v_broke := not public._rod_usable(v_account, v_rod);                                  -- v18.2
    if (v_out->>'rod_lost')::boolean then
      delete from public.inventory where account_id = v_account and item_id = v_rod;
      update public.fishing_profiles set rod = 'rod_wood' where account_id = v_account and rod = v_rod;
      v_broke := false;                                                                   -- v18.2: lost, not broken
    end if;
    perform public._heat_row(v_account);                                                  -- v18.2: the swim's immunity
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', v_rod, 'rod_lost', (v_out->>'rod_lost')::boolean,
                                      'hunger', (v_out->>'hunger')::int),
      'rod_broke', v_broke,                                                               -- v18.2
      'vitals', public._vitals_json(v_vit),
      'state', public._fishing_state(v_account));
  end if;
  if v_why is distinct from 'no_bite' then                                                -- v18.2: a hook attempt
    perform public._rod_wear(v_account, v_rod, 1);
    v_broke := not public._rod_usable(v_account, v_rod);
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'rod_broke', v_broke,        -- v18.2: rod_broke
                              'state', public._fishing_state(v_account))
           || case when v_why = 'outdated' then jsonb_build_object('message', 'Cập nhật trang để câu tiếp')   -- 0046
                   else '{}'::jsonb end
           || coalesce(v_ac, '{}'::jsonb);
  end if;
  select * into sp from public.fish_species where id = c.species_id;
  -- the room's fish price index at the catch (economy spec §5.7); a cast whose room is gone keeps the base price
  if c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    r := public._fish_index(c.room_id, now());
    v_mult := r.mult;
    v_factor := public._fish_factor(c.room_id, sp.id, r.period);
  end if;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0 * v_mult * v_factor)::int);
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  if v_ratio < 1.05 then
    perform public._ac_hug(v_account, round(v_ratio, 3), c.room_id);
  end if;
  -- rare+ catches are announced in the room's chat (v14 spec §8.5), as a system line about the catcher
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]),
            true, v_account);
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'rod_broke', v_broke,                                                                 -- v18.2
    'state', public._fishing_state(v_account));
end; $$;
revoke all on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer) from public;
grant execute on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer) to anon, authenticated;
