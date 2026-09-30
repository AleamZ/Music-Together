-- =========================================================
-- 0113_review_fixes.sql — review fixes for 0108–0112. ADDITIVE and re-runnable. Run after 0112.
-- Every re-created function is its newest body plus the lines marked "-- 0113" (an added line), "-- 0113 {" … "-- 0113 }"
-- (an added block) or "… -- 0113 was: <old line>" (a changed or removed line; a removed one is the whole comment).
--   1. account_link_auth (0112) needs the legacy password too: a leaked game session token alone no longer takes the
--      account (and deletes its password). The 1-argument form is dropped; the 2-argument one checks p_password against
--      account_secrets, 5 tries per 15 minutes per account (wrong ones answer as data, so the count persists).
--   2. finish_cast (0110, 6 arguments): the reel round's _ac_stat moves below the line_snap / rod_snap check, so a
--      snapped fish counts as a lost round, never a won / exact one.
--   3. finish_cast (0108, 7 arguments) counted the call twice in the budget (_ac_account, then the 6-argument form's
--      _ac_account): it sets mt.ac_counted before calling on, and _ac_rate skips (and clears) that one count.
--   4. mail_list (0111) runs the global _mail_sweep at most once a minute server-wide (mail_sweep_state, one row,
--      for update skip locked) instead of on every poll.
--   5. _ac_rate (0109): active_since / last_at / hour_mark / scored_at are written by the one upsert (the old values
--      read first, row-locked) instead of up to 3 more UPDATEs; ac_hours on an hour change and the score every
--      10 minutes as before.
-- =========================================================

-- ---------- 1. Linking needs the legacy password ----------
drop function if exists public.account_link_auth(text);
create or replace function public.account_link_auth(p_session_token text, p_password text) returns jsonb   -- 0113 was: create function public.account_link_auth(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_uid uuid; v_email text; v_acc uuid; v_other uuid;
        v_hash text;   -- 0113
begin
  select e.auth_user_id, e.email into v_uid, v_email from public._auth_email_user() e;
  perform public._auth_rate_hit('link', v_uid, 10, interval '1 hour');
  begin
    v_acc := public._auth_account(p_session_token);
  exception when sqlstate '42501' then
    return jsonb_build_object('ok', false, 'error', case when sqlerrm = 'account banned' then 'account banned' else 'invalid session' end);
  end;
  select l.auth_user_id into v_other from public.account_auth l where l.account_id = v_acc;
  if v_other = v_uid then
    return jsonb_build_object('ok', true, 'account_id', v_acc, 'linked', false);
  elsif v_other is not null then
    return jsonb_build_object('ok', false, 'error', 'account already linked');
  end if;
  -- 0113 {
  -- the legacy password proves the account (a session token alone may have leaked): 5 tries per 15 minutes
  select s.password_hash into v_hash from public.account_secrets s where s.account_id = v_acc;
  if v_hash is null then return jsonb_build_object('ok', false, 'error', 'no legacy password'); end if;
  perform public._auth_rate_hit('link_password', v_acc, 5, interval '15 minutes');
  if crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'wrong password');
  end if;
  -- 0113 }
  if exists (select 1 from public.account_auth l where l.auth_user_id = v_uid or l.email = v_email) then
    return jsonb_build_object('ok', false, 'error', 'email already linked');
  end if;
  begin
    insert into public.account_auth (account_id, auth_user_id, email) values (v_acc, v_uid, v_email);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'email already linked');
  end;
  delete from public.account_secrets where account_id = v_acc;
  return jsonb_build_object('ok', true, 'account_id', v_acc, 'linked', true);
end; $$;
revoke all on function public.account_link_auth(text, text) from public, anon;
grant execute on function public.account_link_auth(text, text) to authenticated;

-- ---------- 2. The reel round after the snap (0110_fishing_v3.sql's 6-argument finish_cast) ----------
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
        v_limit integer; v_line_gone boolean; e jsonb; xs public.fish_species; v_xid uuid; v_xp integer;   -- 0110
        v_extra jsonb := '[]'::jsonb;   -- 0110
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
-- 0113 was:   -- 0065 {
-- 0113 was:   -- a hooked reel is a round: won when caught, exact when never out of the zone (the replay's fewest ticks)
-- 0113 was:   if v_hooked and c.bites then
-- 0113 was:     perform public._ac_stat(v_account, 'reel', 1, case when v_why is null then 1 else 0 end,
-- 0113 was:                             case when v_why is null and p_ticks <= ceil(c.min_reel_ms * 0.06) + 2 then 1 else 0 end);
-- 0113 was:   end if;
-- 0113 was:   -- 0065 }
  -- 0110 {
  -- a landed fish heavier than the rig holds breaks its weakest part: the line (line_snap) or the rod (rod_snap)
  v_limit := least(coalesce(c.line_g, 2147483647), coalesce(c.rod_g, 2147483647));
  if v_why is null and c.weight_g > v_limit then
    v_why := case when coalesce(c.line_g, 2147483647) <= coalesce(c.rod_g, 2147483647) then 'line_snap' else 'rod_snap' end;
  end if;
  -- 0110 }
  -- 0113 {
  -- the reel's round (0065's block, moved below the snap: a snapped fish is a lost round, never won / exact)
  if v_hooked and c.bites then
    perform public._ac_stat(v_account, 'reel', 1, case when v_why is null then 1 else 0 end,
                            case when v_why is null and p_ticks <= ceil(c.min_reel_ms * 0.06) + 2 then 1 else 0 end);
  end if;
  -- 0113 }
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
  -- 0110 {
  -- the snap's cost: the rod to 0 (unequipped, repairable), or one of the line's snaps (the last one: gone)
  if v_why = 'rod_snap' then
    perform public._rod_wear(v_account, v_rod, 1000000);
    v_broke := not public._rod_usable(v_account, v_rod);
  elsif v_why = 'line_snap' then
    v_line_gone := public._line_wear(v_account, c.line);
  end if;
  -- 0110 }
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'rod_broke', v_broke,        -- v18.2: rod_broke
                              'state', public._fishing_state(v_account))
           || case when v_why = 'outdated' then jsonb_build_object('message', 'Cập nhật trang để câu tiếp')   -- 0046
                   else '{}'::jsonb end
           || case when v_why in ('line_snap', 'rod_snap') then jsonb_build_object('snap', jsonb_build_object(   -- 0110
                'species_id', c.species_id, 'weight_g', c.weight_g, 'limit_g', v_limit,   -- 0110
                'line_gone', coalesce(v_line_gone, false))) else '{}'::jsonb end   -- 0110
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
  perform set_config('mt.catch', '1', true);                                        -- 0078: a verified catch
  perform set_config('mt.catch_room', coalesce(c.room_id::text, ''), true);   -- econ v2 (H: a battle counts its room's catches)
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  perform set_config('mt.catch', '', true);                                         -- 0078
  perform set_config('mt.catch_room', '', true);   -- econ v2
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  -- 0110 {
  -- the extra hooks' fish, rolled at the cast: each one the rig holds, while the bucket has room, priced like the first
  for e in select value from jsonb_array_elements(coalesce(c.extra, '[]'::jsonb)) loop
    exit when (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account);
    select * into xs from public.fish_species where id = e->>'species_id';
    continue when not found or (e->>'weight_g')::int > v_limit;
    v_xp := greatest(1, round(xs.price_per_kg * (e->>'weight_g')::int / 1000.0 * v_mult
                              * case when r.period is not null then public._fish_factor(c.room_id, xs.id, r.period) else 1 end)::int);
    perform set_config('mt.catch', '1', true);
    perform set_config('mt.catch_room', coalesce(c.room_id::text, ''), true);
    insert into public.fish (account_id, species_id, weight_g, price) values (v_account, xs.id, (e->>'weight_g')::int, v_xp)
    returning id into v_xid;
    perform set_config('mt.catch', '', true);
    perform set_config('mt.catch_room', '', true);
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, xs.id, (e->>'weight_g')::int, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at
      where public.personal_bests.weight_g < excluded.weight_g;
    v_extra := v_extra || jsonb_build_array(jsonb_build_object('id', v_xid, 'species_id', xs.id,
                 'weight_g', (e->>'weight_g')::int, 'price', v_xp, 'rarity', xs.rarity));
  end loop;
  -- 0110 }
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
    'extra', v_extra,   -- 0110
    'rod_broke', v_broke,                                                                 -- v18.2
    'state', public._fishing_state(v_account));
end; $$;

-- ---------- 3. One budget count per finish (0108_anticheat_v3.sql's 7-argument finish_cast) ----------
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,
                                              p_hooked boolean, p_inputs integer[], p_ticks integer,
                                              p_client jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); c public.casts; v_diff jsonb; v_ac jsonb;
begin
  perform public._wallet_lock(v_account);
  select * into c from public.casts where account_id = v_account and id = p_cast_id for update;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_diff := public._reel_claim_diff(c.reel_params, p_client);
  if v_diff is null then
    perform set_config('mt.ac_counted', v_account::text, true);   -- 0113: this call is counted; the 6-arg form's _ac_rate skips
    return public.finish_cast(p_session_token, p_cast_id, p_success, p_hooked, p_inputs, p_ticks);
  end if;
  -- the page simulated another reel than the server's: the cast is spent and nothing lands
  delete from public.casts where account_id = v_account and id = p_cast_id;
  v_ac := public._ac_flag(v_account, 'client_tamper', 'finish_cast',
            jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'diff', v_diff, 'success', p_success,
                               'ticks', p_ticks),
            c.room_id);
  return jsonb_build_object('result', 'lost', 'why', 'reel_invalid', 'state', public._fishing_state(v_account)) || v_ac;
end $$;

-- ---------- 3 + 5. _ac_rate (0109_bot_score.sql's, verbatim but for the lines marked 0113) ----------
create or replace function public._ac_rate(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.ac_rate; c public.anticheat_config;
        v_old public.ac_rate;   -- 0113
begin
  if p_account is null then return; end if;
  -- 0113 {
  -- a call already counted by its caller (0108's 7-argument finish_cast): skip this one count, once
  if current_setting('mt.ac_counted', true) = p_account::text then
    perform set_config('mt.ac_counted', '', true);
    return;
  end if;
  -- 0113 }
  select * into c from public.anticheat_config where id;
  select * into v_old from public.ac_rate where account_id = p_account for update;   -- 0113: the old marks
  insert into public.ac_rate as x (account_id, calls, active_since, last_at, hour_mark, scored_at)   -- 0113 was: insert into public.ac_rate as x (account_id, calls) values (p_account, 1)
    values (p_account, 1, now(), now(), date_trunc('hour', now()), now())   -- 0113
  on conflict (account_id) do update
    set calls = case when x.win_at <= now() - interval '1 minute' then 1 else x.calls + 1 end,
        win_at = case when x.win_at <= now() - interval '1 minute' then now() else x.win_at end,   -- 0113 was: win_at = case when x.win_at <= now() - interval '1 minute' then now() else x.win_at end
        active_since = case when x.last_at is null or x.last_at < now() - interval '15 minutes' then now() else x.active_since end,   -- 0113
        last_at = now(),   -- 0113
        hour_mark = date_trunc('hour', now()),   -- 0113
        scored_at = case when x.scored_at is null or x.scored_at < now() - interval '10 minutes' then now() else x.scored_at end   -- 0113
  returning * into r;
  if r.calls > coalesce(c.rate_block_per_min, 1200) then
    -- the counter's increment rolls back with the raise: it stays at the block until the minute is over
    raise exception 'rate limited' using errcode = '53400', hint = 'rate',
      detail = ceil(extract(epoch from (r.win_at + interval '1 minute' - now())))::int::text;
  end if;
  if r.calls = coalesce(c.rate_block_per_min, 1200) or
     (r.calls > coalesce(c.rate_soft_per_min, 900) and (r.flagged_at is null or r.flagged_at < now() - interval '1 minute')) then
    update public.ac_rate set flagged_at = now() where account_id = p_account;
    perform public._ac_flag(p_account, case when r.calls >= coalesce(c.rate_block_per_min, 1200) then 'rate_block' else 'rate_high' end,
              'rate', jsonb_build_object('calls', r.calls, 'since', r.win_at,
                                         'soft', c.rate_soft_per_min, 'block', c.rate_block_per_min),
              null, null, false);
  end if;
  -- 0109 {
  -- the session (no gap of 15 minutes), the clock hour, and the score every 10 minutes
-- 0113 was:   update public.ac_rate
-- 0113 was:      set active_since = case when last_at is null or last_at < now() - interval '15 minutes' then now() else active_since end,
-- 0113 was:          last_at = now()
-- 0113 was:    where account_id = p_account;
  if v_old.hour_mark is distinct from date_trunc('hour', now()) then   -- 0113 was: if r.hour_mark is distinct from date_trunc('hour', now()) then
-- 0113 was:     update public.ac_rate set hour_mark = date_trunc('hour', now()) where account_id = p_account;
    insert into public.ac_hours (account_id, hour) values (p_account, date_trunc('hour', now())) on conflict do nothing;
    delete from public.ac_hours where account_id = p_account and hour < now() - interval '3 days';
  end if;
  if v_old.scored_at is null or v_old.scored_at < now() - interval '10 minutes' then   -- 0113 was: if r.scored_at is null or r.scored_at < now() - interval '10 minutes' then
-- 0113 was:     update public.ac_rate set scored_at = now() where account_id = p_account;
    perform public._ac_bot_score(p_account);
  end if;
  -- 0109 }
end $$;

-- ---------- 4. The mail sweep, once a minute server-wide ----------
create table if not exists public.mail_sweep_state (
  id boolean primary key default true check (id),
  swept_at timestamptz
);
insert into public.mail_sweep_state (id) values (true) on conflict (id) do nothing;
alter table public.mail_sweep_state enable row level security;
revoke all on public.mail_sweep_state from public, anon, authenticated;

-- mail_list (0111_mailbox.sql's, verbatim but for the lines marked 0113)
create or replace function public.mail_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
-- 0113 was:   perform public._mail_sweep();
  -- 0113 {
  -- the global sweep at most once a minute: a poll that finds it due (and not being run) runs it
  perform 1 from public.mail_sweep_state
   where id and (swept_at is null or swept_at <= now() - interval '1 minute') for update skip locked;
  if found then
    update public.mail_sweep_state set swept_at = now() where id;
    perform public._mail_sweep();
  end if;
  -- 0113 }
  return public._mail_json(v_account);
end $$;
