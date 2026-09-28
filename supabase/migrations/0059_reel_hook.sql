-- =========================================================
-- 0059_reel_hook.sql — anti-cheat v2 #4: the reel's seed stays secret until the bite (docs/superpowers/plans/
-- 2026-09-28-anticheat-v2-part2.md, part A). ADDITIVE and re-runnable. Run after 0058.
--   A. casts.hooked_at: when the server-timed hook was accepted.
--   B. hook_cast(token, cast): the hook, judged on the server's clock — refused before bite_at ('too_early', soft
--      reel_early_hook), after the bobber's window + 3 s ('missed'), or when nothing bites ('no_bite'); accepted, the
--      answer carries the reel's seed. The reel's tick 0 is that answer.
--   C. start_cast (0057's) no longer answers reel_seed (a page before 0059 sends no reel input: 0046's 'outdated');
--      start_cast and start_net (0057's) first settle a hooked cast they replace (_cast_settle_hooked: the hook's wear
--      and, for a big fish, 0034's overboard cost without the fall) and answer it as 'abandoned'.
--   D. finish_cast (0046's): hooked is the server's (hooked_at; p_hooked is ignored); a won reel needs the hook (else
--      'reel_invalid', hard reel_unhooked) and its real-time gate counts from hooked_at; the toggles' timing statistics
--      (_reel_timing): flips faster than a finger (≥ 10 flips, a quarter within 2 ticks) or a metronome (≥ 12 flips,
--      sd of the gaps < 0.5 tick) log the soft reel_timing; the 5th within 24 h and after is the hard
--      reel_timing_repeat and voids that catch ('reel_invalid').
-- =========================================================

-- ---------- A. The cast row ----------
alter table public.casts add column if not exists hooked_at timestamptz;

-- ---------- B. The statistics and the settlement ----------
-- The toggles' timing (lib/game/fishing/reel.ts reelTiming): {n flips, fast = gaps ≤ 2 ticks, var = the gaps' variance}.
create or replace function public._reel_timing(p_inputs integer[]) returns jsonb
language sql immutable parallel safe
as $$
  select jsonb_build_object('n', coalesce(cardinality(p_inputs), 0),
                            'fast', count(*) filter (where g <= 2),
                            'var', coalesce(round(var_pop(g), 4), 0))
    from (select p_inputs[i] - p_inputs[i - 1] as g
            from generate_series(2, coalesce(cardinality(p_inputs), 0)) i) x
$$;
revoke all on function public._reel_timing(integer[]) from public, anon, authenticated;

-- Suspicious timing (reelTimingSuspect): too many flips within 2 ticks, or a metronome.
create or replace function public._reel_timing_suspect(p_t jsonb) returns boolean
language sql immutable parallel safe
as $$
  select ((p_t->>'n')::int >= 10 and 4 * (p_t->>'fast')::int >= (p_t->>'n')::int)
      or ((p_t->>'n')::int >= 12 and (p_t->>'var')::numeric < 0.25)
$$;
revoke all on function public._reel_timing_suspect(jsonb) from public, anon, authenticated;

-- A hooked cast being replaced (a new start_cast or start_net) is a reel given up: the hook's wear, or for a big fish
-- 0034's overboard cost (rod wear or loss, hunger) without the fall. The caller holds the wallet lock. Returns what it
-- cost, or null.
create or replace function public._cast_settle_hooked(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.casts; v_rod text; v_out jsonb; v_lost boolean := false; v_hunger integer := 0;
begin
  delete from public.casts where account_id = p_account and hooked_at is not null returning * into c;
  if not found then return null; end if;
  v_rod := coalesce(c.rod, 'rod_wood');
  if not c.big then
    perform public._rod_wear(p_account, v_rod, 1);
  else
    v_out := public._overboard_outcome(v_rod, random());
    perform public._rod_wear(p_account, v_rod, (v_out->>'wear')::int);
    v_hunger := (v_out->>'hunger')::int;
    perform public._vitals_apply(p_account);
    update public.vitals set hunger = greatest(0, hunger - v_hunger) where account_id = p_account;
    v_lost := (v_out->>'rod_lost')::boolean;
    if v_lost then
      delete from public.inventory where account_id = p_account and item_id = v_rod;
      update public.fishing_profiles set rod = 'rod_wood' where account_id = p_account and rod = v_rod;
    end if;
  end if;
  return jsonb_build_object('rod', v_rod, 'big', c.big, 'rod_lost', v_lost, 'hunger', v_hunger,
                            'rod_broke', not v_lost and not public._rod_usable(p_account, v_rod));
end $$;
revoke all on function public._cast_settle_hooked(uuid) from public, anon, authenticated;

-- ---------- C. The hook ----------
-- Accepted at or after bite_at and until the bobber's window (expires_at − 90 s) + 3 s: hooked_at is set once (a retry
-- gets the same answer). A refusal leaves the cast for finish_cast (a miss, as before).
create or replace function public.hook_cast(p_session_token text, p_cast_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; v_ac jsonb;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select * into c from public.casts where account_id = v_account and id = p_cast_id for update;
  if not found then raise exception 'cast not found' using errcode = '22023'; end if;
  if c.hooked_at is null then
    if not c.bites then
      return jsonb_build_object('result', 'lost', 'why', 'no_bite', 'state', public._fishing_state(v_account));
    end if;
    if c.reel_seed is null then                                                           -- rolled before 0046
      return jsonb_build_object('result', 'lost', 'why', 'outdated', 'message', 'Cập nhật trang để câu tiếp',
                                'state', public._fishing_state(v_account));
    end if;
    if now() < c.bite_at then
      v_ac := public._ac_flag(v_account, 'reel_early_hook', 'hook_cast',
                jsonb_build_object('cast_id', c.id, 'bite_at', c.bite_at, 'hooked_at', now()), c.room_id, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'too_early', 'state', public._fishing_state(v_account)) || v_ac;
    end if;
    if now() > c.expires_at - interval '90 seconds' + interval '3 seconds' then
      return jsonb_build_object('result', 'lost', 'why', 'missed', 'state', public._fishing_state(v_account));
    end if;
    update public.casts set hooked_at = now() where id = c.id returning * into c;
  end if;
  return jsonb_build_object('result', 'hooked', 'reel_seed', c.reel_seed, 'hooked_at', c.hooked_at,
                            'state', public._fishing_state(v_account));
end $$;
revoke all on function public.hook_cast(text, uuid) from public;
grant execute on function public.hook_cast(text, uuid) to anon, authenticated;

-- ---------- D. start_cast (0057's, verbatim but for the lines marked 0059) ----------

create or replace function public.start_cast(p_room_id uuid, p_session_token text, p_col integer default null,
                                             p_row integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
        v_spot text := 'dock'; v_bites boolean := true;                                  -- v18.1
        v_boost real;                                                                    -- v18.2
        v_seed bigint := floor(random() * 4294967296)::bigint;                           -- 0046: the reel's seed (u32)
        v_vitals jsonb;                                                                  -- 0047
        v_ac jsonb;                                                                      -- 0057
        v_abandoned jsonb;                                                               -- 0059
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_col is null or p_row is null then raise exception 'bad spot' using errcode = '22023'; end if;   -- 0057: the cell is where I stand (every client since v18.1)
  if p_col is not null or p_row is not null then                                         -- v18.1: null = an older client (docks only)
    v_spot := public._pond_spot(p_col, p_row);
    if v_spot is null then raise exception 'bad spot' using errcode = '22023'; end if;
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;   -- v18.8
  perform public._vitals_guard(v_account);
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'start_cast', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                     -- 0057
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);                                  -- 0059: a hooked cast replaced is given up
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then                                       -- v18.2
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 1. / 1b. 0047: no hourly or daily cast cap (casts cost hunger and thirst instead, step 6)
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
  -- 6. 0047: the effort — hunger 1.8, thirst 2.2 (no cap counters, no cast_daily_cap flag)
  v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'abandoned', v_abandoned,                                                             -- 0059 was: 'reel_seed', v_seed,                                                                  -- 0046
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;

-- ---------- E. start_net (0057's, verbatim but for the lines marked 0059) ----------
create or replace function public.start_net(p_room_id uuid, p_session_token text, p_col integer, p_row integer,
                                            p_net text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_d integer; v_seed integer;
        v_id uuid; v_beat integer; v_bucket integer;
        v_vitals jsonb;                                                                  -- 0047
        v_arrow bigint := floor(random() * 2147483648)::bigint;                          -- 0056: kéo lưới's seed, kept until the haul
        v_ac jsonb;                                                                      -- 0057
        v_abandoned jsonb;                                                               -- 0059
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'start_net', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                    -- 0057
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);                                  -- 0059: a hooked cast replaced is given up
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
    'abandoned', v_abandoned,                                                             -- 0059
    'state', public._fishing_state(v_account));
end; $$;

-- ---------- F. finish_cast (0046's, verbatim but for the lines marked 0059) ----------
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
        v_hooked boolean; v_t jsonb;                                                      -- 0059
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  v_hooked := c.hooked_at is not null;                                                    -- 0059: the server's hook (p_hooked is ignored)
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
    if v_hooked and c.big then                                                            -- 0059 was: if coalesce(p_hooked, false) and c.big and now() >= c.bite_at then                   -- v18.1: pulled in
      v_why := 'overboard';
    end if;
  elsif c.reel_seed is null or p_inputs is null or p_ticks is null then                     -- 0046: a page before the replay
    v_why := 'outdated';
  elsif not v_hooked then                                                                 -- 0059: a won reel needs the hook
    v_why := 'reel_invalid';                                                              -- 0059
    v_ac := public._ac_flag(v_account, 'reel_unhooked', 'finish_cast',                   -- 0059
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'ticks', p_ticks), c.room_id);   -- 0059
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
  elsif now() < c.hooked_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then   -- 0059 was: elsif now() < c.bite_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then
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
  -- 0059 {
  -- a won reel's timing: flips faster than a finger, or a metronome (soft); the 5th within 24 h voids the catch (hard)
  if v_why is null then
    v_t := public._reel_timing(p_inputs);
    if public._reel_timing_suspect(v_t) then
      perform public._ac_flag(v_account, 'reel_timing', 'finish_cast',
                jsonb_build_object('cast_id', c.id, 'timing', v_t, 'ticks', p_ticks, 'inputs', to_jsonb(p_inputs[1:200])),
                c.room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'reel_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_why := 'reel_invalid';
        v_ac := public._ac_flag(v_account, 'reel_timing_repeat', 'finish_cast',
                  jsonb_build_object('cast_id', c.id, 'timing', v_t, 'pattern', '5 in 24 h'), c.room_id);
      end if;
    end if;
  end if;
  -- 0059 }
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
grant execute on function public.start_cast(uuid, text, integer, integer) to anon, authenticated;
revoke all on function public.start_net(uuid, text, integer, integer, text) from public;
grant execute on function public.start_net(uuid, text, integer, integer, text) to anon, authenticated;
revoke all on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer) from public;
grant execute on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer) to anon, authenticated;