-- =========================================================
-- 0078_v21_fixes.sql — v21 integration fixes (the code reviews of 0070–0077, .superpowers/v21-fixlist.md). ADDITIVE and
-- re-runnable. Run after 0077. Every re-created function is its NEWEST definition verbatim but for the lines marked 0078
-- (the source migration is named above each one); create or replace keeps their grants.
--   A. Only a verified catch is a catch. public.fish rows are also inserted by non-catch paths (fish_move_to_bag: the
--      fridge; aquarium_take), and 0069's _ev_fish turned every row into a 'fish_catch' event (XP, quests, achievements,
--      the Fishdex, professions, the company quest) and 0076's _fx_on_fish into battle score + a treasure-map roll. Now
--      the catch paths — finish_cast (0065) and finish_net (0056), the only ones — set the transaction-local GUC
--      mt.catch = '1' around their insert (and clear it after); both triggers fire only while it is set
--      (_fish_is_catch). A client cannot set it: set_config is not an exposed RPC.
--   B. Progression: _pg_on_event takes the wallet lock before the progression rows (wallet → progress on every path);
--      progress_leaderboard ranks from the metric tables (indexed ORDER BY … LIMIT) and serializes a cache refresh;
--      _pos_claim (0058's) refuses a claim on a map the account's level has not unlocked ('map_locked', not counted).
--   C. Quests: the company quest caps each account's contribution per Vietnam day (a tenth of the goal); a wipe clears
--      the quest rows (trigger anticheat_wipes_quests); arena team membership is unique across both columns (a trigger
--      under a per-account advisory lock); arena_challenge locks both teams; a bout must be a ring match; arena_accept
--      voids a changed roster without rolling the refund back; bounded sweeps/lists/claims; photo_save's rate limit
--      counts a non-deletable save log.
--   D. Crafting: mine_start drops the old dig before locking the node (dig → node, as mine_finish); mine_finish needs a
--      pickaxe with durability left and judges the strikes' timing (soft 'mine_timing', the 5th in 24 h is the hard
--      'mine_timing_repeat' and the dig is lost — like 0065's harvest_timing) and records ac_play_stats 'mine';
--      brew_potion / upgrade_item abort when an ingredient is gone at the take.
--   E. Economy: listing limits and reservations are serialized per seller (_econ_can_list's advisory lock, held to the
--      insert); _econ_sweep is bounded; shop_rent locks the stall's listings before the wallet (listing → wallet).
--   F. Pets: a PvP battle rewards XP only when contested (≥ 2 resolved turns, not a forfeit before), ≤ 10 rewarded a day
--      per account and 3 per pair; bounded sweep and lists; house_admit needs an unexpired knock.
--   G. Fishing battles: battle row before wallet everywhere (+ a room advisory lock for the 3-open cap); a bounded
--      sweep; the wipe cancels the account's hosted battles and removes it (and its fee from the pot) from the others.
--   H. World: boss_attack needs membership of a weather boss's room; dungeon_attack needs current party membership;
--      snow_event_start and party_say serialize their cooldown checks; the album is a per-species counter
--      (wild_album) and old spawns / photos are cleaned globally in bounded batches.
--   I. Professions: a fight's stamina is recorded per side (fight_stamina_short when the side could not pay);
--      _prof_on_event gives no nghề XP for such a fight ('fight_done'/'fight_win' now carry meta.match, 0069's
--      _ev_fight); stamina_tick's hammock rest claims the hammock (server position).
-- Lock order (unchanged elsewhere): battle/listing/series rows → wallets (account order) → progression rows.
-- =========================================================

-- ---------- A. Only a verified catch is a catch ----------
create or replace function public._fish_is_catch() returns boolean
language sql stable set search_path = public, extensions
as $$ select coalesce(current_setting('mt.catch', true), '') = '1' $$;
revoke all on function public._fish_is_catch() from public, anon, authenticated;

-- _ev_fish (0069's, verbatim but for the line marked 0078)
create or replace function public._ev_fish() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public._fish_is_catch() then return new; end if;                           -- 0078: a moved fish is no catch
  perform public._game_event(new.account_id, 'fish_catch', 1,
    jsonb_build_object('species', new.species_id, 'weight_g', new.weight_g, 'price', new.price));
  return new;
end $$;

-- finish_cast (0065_ac_stats.sql's, verbatim but for the lines marked 0078)
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
  -- 0065 {
  -- a hooked reel is a round: won when caught, exact when never out of the zone (the replay's fewest ticks)
  if v_hooked and c.bites then
    perform public._ac_stat(v_account, 'reel', 1, case when v_why is null then 1 else 0 end,
                            case when v_why is null and p_ticks <= ceil(c.min_reel_ms * 0.06) + 2 then 1 else 0 end);
  end if;
  -- 0065 }
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
  perform set_config('mt.catch', '1', true);                                        -- 0078: a verified catch
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  perform set_config('mt.catch', '', true);                                         -- 0078
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

-- finish_net (0056_net_replay.sql's, verbatim but for the lines marked 0078)
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
    perform set_config('mt.catch', '1', true);                                      -- 0078: a verified catch
    insert into public.fish (account_id, species_id, weight_g, price)
    values (v_account, f->>'species_id', (f->>'weight_g')::int, (f->>'price')::int) returning id into v_id;
    perform set_config('mt.catch', '', true);                                       -- 0078
    v_fish := v_fish || jsonb_build_array(f || jsonb_build_object('id', v_id));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('result', 'caught', 'count', v_n, 'fish', v_fish,
    'escaped', jsonb_array_length(t.haul) - jsonb_array_length(v_keep),
    'state', public._fishing_state(v_account));
end; $$;

-- _fx_on_fish (0076_fishing_extras.sql's, verbatim but for the lines marked 0078)
create or replace function public._fx_on_fish() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_boat boolean;
begin
  -- a fish taken back from the fridge or the aquarium keeps its old caught_at: not a catch
  if new.caught_at < now() - interval '5 seconds' then return new; end if;
  if not public._fish_is_catch() then return new; end if;                           -- 0078: only finish_cast / finish_net
  update public.fishing_battle_players p
     set score = p.score + new.price, catches = p.catches + 1,
         best_species = case when p.best_species is null
                                  or (select rarity from public.fish_species where id = new.species_id)
                                     > (select rarity from public.fish_species where id = p.best_species)
                             then new.species_id else p.best_species end
    from public.fishing_battles b
   where b.id = p.battle_id and p.account_id = new.account_id and b.status = 'live'
     and now() >= b.starts_at and now() < b.ends_at;
  v_boat := exists (select 1 from public.fish_species where id = new.species_id and water = 'deep');
  perform public._treasure_drop(new.account_id, case when v_boat then 'boat' else 'fishing' end,
                                case when v_boat then 0.05 else 0.02 end);
  return new;
end $$;

-- ---------- B. Progression ----------

-- _pg_on_event (0070_progression.sql's, verbatim but for the lines marked 0078)
create or replace function public._pg_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_species text; v_w integer; v_rarity integer; v_reason text; v_new_species boolean := false; v_kind text;
begin
  if new.kind not in ('fish_catch', 'earn', 'fight_win', 'fight_done', 'xp_grant') then return new; end if;
  begin
    perform public._wallet_lock(new.account_id);   -- 0078: wallet → progress rows (a reward may pay), as the earn path
    insert into public.player_stats (account_id) values (new.account_id) on conflict (account_id) do nothing;
    if new.kind = 'fish_catch' then
      v_species := left(coalesce(new.meta->>'species', ''), 40);
      v_w := greatest(0, coalesce((new.meta->>'weight_g')::integer, 0));
      select rarity into v_rarity from public.fish_species where id = v_species;
      update public.player_stats
         set fish_total = fish_total + 1,
             biggest_species = case when v_w > biggest_g then v_species else biggest_species end,
             biggest_g = greatest(biggest_g, v_w)
       where account_id = new.account_id;
      if v_species <> '' then
        insert into public.player_fishdex (account_id, species, caught, best_g) values (new.account_id, v_species, 1, v_w)
        on conflict (account_id, species) do update set caught = player_fishdex.caught + 1,
                                                        best_g = greatest(player_fishdex.best_g, excluded.best_g)
        returning (xmax = 0) into v_new_species;
      end if;
      perform public._pg_add_xp(new.account_id, 'fish', 4 * coalesce(v_rarity, 1) + least(10, v_w / 500));
      if v_new_species then perform public._pg_check_collections(new.account_id); end if;
    elsif new.kind = 'earn' then
      v_reason := new.meta->>'reason';
      if not public._pg_work_reason(v_reason) then return new; end if;
      update public.player_stats
         set earned_total = earned_total + new.qty,
             farm_earned = farm_earned + case when v_reason in ('rice_sell', 'produce_sell') then new.qty else 0 end
       where account_id = new.account_id;
      perform public._pg_add_xp(new.account_id, 'earn', least(50, new.qty / 20));
    elsif new.kind = 'fight_win' then
      v_kind := coalesce(new.meta->>'kind', '');
      update public.player_stats set fight_wins = fight_wins + 1 where account_id = new.account_id;
      perform public._pg_add_xp(new.account_id, 'fight', case when v_kind = 'pvp' then 40 when v_kind = 'exam' then 25 else 30 end);
    elsif new.kind = 'fight_done' then
      perform public._pg_add_xp(new.account_id, 'fight', 5);
    elsif new.kind = 'xp_grant' then
      perform public._pg_add_xp(new.account_id, 'grant', least(500, greatest(0, new.qty)));
    end if;
    perform public._pg_check_achievements(new.account_id);
  exception when others then
    raise warning 'progression: % (%)', sqlerrm, new.kind;
  end;
  return new;
end $$;

-- progress_leaderboard (0070_progression.sql's, verbatim but for the lines marked 0078)
create or replace function public.progress_leaderboard(p_session_token text, p_board text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); c public.leaderboard_cache; v_rows jsonb;
begin
  if p_board not in ('level', 'rich', 'fish', 'biggest', 'farmer', 'fights') then
    raise exception 'bad board' using errcode = '22023';
  end if;
  select * into c from public.leaderboard_cache where board = p_board;
  if c.board is not null and c.at > now() - interval '60 seconds' then
    return jsonb_build_object('board', p_board, 'rows', c.rows, 'at', c.at, 'me', v_account);
  end if;
  -- 0078 {
  -- one refresh at a time per board; a caller that waited reads the fresh cache
  perform pg_advisory_xact_lock(hashtext('leaderboard'), hashtext(p_board));
  select * into c from public.leaderboard_cache where board = p_board;
  if c.board is not null and c.at > now() - interval '60 seconds' then
    return jsonb_build_object('board', p_board, 'rows', c.rows, 'at', c.at, 'me', v_account);
  end if;
  -- the top of the metric table (indexed ORDER BY … LIMIT), then the unbanned among them
  -- (each branch is gated by a one-time filter on p_board: only the board's own runs)
  with top as (
    (select account_id as id, xp::bigint as v from public.player_progress
      where p_board = 'level' and xp > 0 order by xp desc limit 100)
    union all
    (select account_id, coins::bigint from public.wallets
      where p_board = 'rich' and coins > 0 order by coins desc limit 100)
    union all
    (select account_id, fish_total::bigint from public.player_stats
      where p_board = 'fish' and fish_total > 0 order by fish_total desc limit 100)
    union all
    (select account_id, biggest_g::bigint from public.player_stats
      where p_board = 'biggest' and biggest_g > 0 order by biggest_g desc limit 100)
    union all
    (select account_id, farm_earned::bigint from public.player_stats
      where p_board = 'farmer' and farm_earned > 0 order by farm_earned desc limit 100)
    union all
    (select account_id, fight_wins::bigint from public.player_stats
      where p_board = 'fights' and fight_wins > 0 order by fight_wins desc limit 100)
  ), ranked as (
    select a.id, a.username, t.v from top t join public.accounts a on a.id = t.id where not a.is_banned
  )
  -- 0078 }
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.username, 'value', t.v,
           'level', coalesce(p.level, 1),
           'extra', case when p_board = 'biggest' then (select s.biggest_species from public.player_stats s where s.account_id = t.id) end)
           order by t.v desc, t.username), '[]'::jsonb)
    into v_rows
    from (select * from ranked where v > 0 order by v desc, username limit 20) t
    left join public.player_progress p on p.account_id = t.id;
  insert into public.leaderboard_cache (board, rows, at) values (p_board, v_rows, now())
  on conflict (board) do update set rows = excluded.rows, at = excluded.at;
  return jsonb_build_object('board', p_board, 'rows', v_rows, 'at', now(), 'me', v_account);
end $$;

-- _pos_claim (0058_pos_tabs.sql's, verbatim but for the lines marked 0078)
create or replace function public._pos_claim(p_account uuid, p_map text, p_x integer, p_y integer, p_rpc text,
                                             p_room uuid default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare pp public.player_pos; v_dt numeric; v_need numeric; v_why text; v_n integer; v_ac jsonb; v_road numeric;
        v_tab text := public._pos_tab(); v_old boolean; v_own jsonb;                     -- 0058
begin
  select * into pp from public.player_pos where account_id = p_account for update;
  -- 0058 {
  -- an older tab of the account: judged against its own last claim
  v_old := v_tab is not null and pp.account_id is not null and pp.tab is not null and v_tab <> pp.tab and pp.tabs ? v_tab;
  if v_old then
    v_own := pp.tabs -> v_tab;
    pp.map := v_own->>'m';
    pp.x := (v_own->>'x')::integer;
    pp.y := (v_own->>'y')::integer;
    pp.at := (v_own->>'at')::timestamptz;
  end if;
  -- 0058 }
  if p_map is null or p_x is null or p_y is null
     or not exists (select 1 from public._pos_maps() m where m.map = p_map and p_x between 0 and m.w and p_y between 0 and m.h) then
    v_why := 'off_map';
  elsif pp.account_id is not null and not (p_map = 'hall' and abs(p_x - 612) <= 16 and abs(p_y - 300) <= 16) then
    v_dt := extract(epoch from now() - pp.at);
    v_road := public._pos_road_s(p_account, p_map, pp.at, pp.skip_at);
    v_need := public._pos_need_s(pp.map, pp.x, pp.y, p_map, p_x, p_y, v_road);
    if v_need is null then v_why := 'no_path';
    elsif v_need > v_dt + 1 then v_why := 'too_fast';
    end if;
  end if;
  -- 0078 {
  -- a map the account's level has not unlocked (0070's map_levels): refused, not logged or counted (the client's
  -- portal gate normally stops it first); the position stays where it was
  if v_why is null and p_map is distinct from pp.map and not public._map_unlocked(p_account, p_map) then
    return jsonb_build_object('anticheat', jsonb_build_object('code', 'pos_teleport', 'why', 'map_locked', 'strike', 0,
             'error', coalesce(p_error, 'map locked'), 'locked_until', null, 'banned', false, 'server_now', now()));
  end if;
  -- 0078 }
  if v_why is null then
    -- 0058 {
    if v_old then                                                                         -- only that tab's track moves
      update public.player_pos set tabs = public._pos_tabs(tabs, v_tab, p_map, p_x, p_y) where account_id = p_account;
      return null;
    end if;
    -- 0058 }
    insert into public.player_pos (account_id, map, x, y, at) values (p_account, p_map, p_x, p_y, now())
    on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at;
    update public.player_pos set tab = coalesce(v_tab, tab),                                                            -- 0058
           tabs = case when v_tab is null then tabs else public._pos_tabs(tabs, v_tab, p_map, p_x, p_y) end            -- 0058
     where account_id = p_account;                                                                                    -- 0058
    return null;
  end if;
  -- 0058 {
  if v_old then                                                                           -- refused, not logged or counted
    return jsonb_build_object('anticheat', jsonb_build_object('code', 'pos_teleport', 'strike', 0, 'error', p_error,
             'locked_until', null, 'banned', false, 'server_now', now()));
  end if;
  -- 0058 }
  update public.player_pos
     set bad_count = case when bad_since is null or bad_since < now() - interval '1 hour' then 1 else bad_count + 1 end,
         bad_since = case when bad_since is null or bad_since < now() - interval '1 hour' then now() else bad_since end
   where account_id = p_account
  returning bad_count into v_n;
  v_ac := public._ac_flag(p_account, 'pos_teleport', p_rpc,
            jsonb_build_object('why', v_why, 'to', jsonb_build_object('map', left(p_map, 16), 'x', p_x, 'y', p_y),
                               'from', case when pp.account_id is not null then jsonb_build_object('map', pp.map, 'x', pp.x,
                                                                                    'y', pp.y, 'at', pp.at) end,
                               'dt', round(v_dt, 2), 'need', round(v_need, 2), 'count', v_n),
            p_room, p_error, false);
  if v_n = 30 then
    v_ac := public._ac_flag(p_account, 'pos_teleport_repeat', p_rpc,
              jsonb_build_object('count', v_n, 'since', (select bad_since from public.player_pos where account_id = p_account),
                                 'last', jsonb_build_object('map', left(p_map, 16), 'x', p_x, 'y', p_y)),
              p_room, p_error, true);
  end if;
  return v_ac;
end $$;

-- the leaderboard's ORDER BY … LIMIT
create index if not exists idx_player_progress_xp on public.player_progress (xp desc);
create index if not exists idx_wallets_coins on public.wallets (coins desc);
create index if not exists idx_player_stats_fish on public.player_stats (fish_total desc);
create index if not exists idx_player_stats_biggest on public.player_stats (biggest_g desc);
create index if not exists idx_player_stats_farm on public.player_stats (farm_earned desc);
create index if not exists idx_player_stats_fights on public.player_stats (fight_wins desc);

-- ---------- C. Quests ----------
alter table public.company_contrib add column if not exists day date;                   -- the Vietnam day of day_qty
alter table public.company_contrib add column if not exists day_qty integer not null default 0;

-- photo_save's rate window: a log the album's deletes do not shorten
create table if not exists public.photo_save_log (
  account_id uuid not null references public.accounts(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists photo_save_log_account on public.photo_save_log (account_id, at);
alter table public.photo_save_log enable row level security;
revoke all on public.photo_save_log from anon, authenticated;

create index if not exists arena_series_team_a on public.arena_series (team_a, created_at desc);
create index if not exists arena_series_team_b on public.arena_series (team_b, created_at desc);

-- An account is on at most one team, across both columns (0071's separate unique constraints on a and b allowed a
-- leader of one team to join another). Checked under a per-account advisory lock, so concurrent create/join serialize.
create or replace function public._arena_team_member_check() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v uuid;
begin
  foreach v in array array_remove(array[new.a, new.b], null) loop
    perform pg_advisory_xact_lock(hashtext('arena_member'), hashtext(v::text));
    if exists (select 1 from public.arena_teams t where t.id <> new.id and (t.a = v or t.b = v)) then
      raise exception 'already in a team' using errcode = '22023';
    end if;
  end loop;
  if new.b is not null and new.a = new.b then raise exception 'already in a team' using errcode = '22023'; end if;
  return new;
end $$;
revoke all on function public._arena_team_member_check() from public, anon, authenticated;
drop trigger if exists arena_teams_member on public.arena_teams;
create trigger arena_teams_member before insert or update of a, b on public.arena_teams
  for each row execute function public._arena_team_member_check();

-- The wipe (0071 had none): the account's quest rows go; its team's open/live series are voided (the stakes back — the
-- wiped account's own refund is then taken by _ac_wipe's wallet delete) and it leaves its team.
create or replace function public._quest_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.arena_teams; r record;
begin
  delete from public.quest_progress where account_id = new.account_id;
  delete from public.quest_visits where account_id = new.account_id;
  delete from public.login_streaks where account_id = new.account_id;
  delete from public.company_contrib where account_id = new.account_id and claimed_at is null;
  delete from public.photo_save_log where account_id = new.account_id;
  select * into t from public.arena_teams where a = new.account_id or b = new.account_id for update;
  if found then
    for r in select id from public.arena_series where (team_a = t.id or team_b = t.id) and status in ('open', 'live') order by id loop
      perform public._arena_void(r.id, 'wipe');
    end loop;
    if t.b is null then
      delete from public.arena_teams where id = t.id;
    elsif t.a = new.account_id then
      update public.arena_teams set a = b, b = null, code = upper(substr(md5(gen_random_uuid()::text), 1, 6)) where id = t.id;
    else
      update public.arena_teams set b = null where id = t.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public._quest_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_quests on public.anticheat_wipes;
create trigger anticheat_wipes_quests after insert on public.anticheat_wipes for each row execute function public._quest_on_wipe();

-- _quest_on_event (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public._quest_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare d record; v_q integer; v_day date := public._vn_today(); v_per text; c public.company_quests;
        v_used integer;                                                                  -- 0078
begin
  begin
    for d in select q.* from public.quest_defs q where q.kind = new.kind and q.active and new.meta @> q.filter loop
      v_q := case when d.use_qty then greatest(new.qty, 0) else 1 end;
      continue when v_q = 0;
      if d.cat in ('daily', 'weekly') then
        continue when d.id not in (select public._quest_offer(d.cat, v_day));
      end if;
      v_per := public._quest_period(d.cat, v_day);
      if d.cat = 'npc' then
        update public.quest_progress
           set progress = least(d.goal, progress + v_q),
               done_at = case when progress + v_q >= d.goal then now() end
         where account_id = new.account_id and quest_id = d.id and period = '' and done_at is null;
      else
        insert into public.quest_progress as p (account_id, quest_id, period, progress, done_at)
        values (new.account_id, d.id, v_per, least(d.goal, v_q), case when v_q >= d.goal then now() end)
        on conflict (account_id, quest_id, period) do update
          set progress = least(d.goal, p.progress + v_q),
              done_at = coalesce(p.done_at, case when p.progress + v_q >= d.goal then now() end);
      end if;
    end loop;

    select * into c from public.company_quests
     where status = 'open' and kind = new.kind and new.meta @> filter for update;
    if found then
      v_q := case when c.use_qty then greatest(new.qty, 0) else 1 end;
      -- 0078 {
      -- one account adds at most a tenth of the goal per Vietnam day
      insert into public.company_contrib (quest_id, account_id, qty, day, day_qty) values (c.id, new.account_id, 0, v_day, 0)
      on conflict (quest_id, account_id) do nothing;
      select case when k.day = v_day then k.day_qty else 0 end into v_used
        from public.company_contrib k where k.quest_id = c.id and k.account_id = new.account_id for update;
      v_q := least(v_q, greatest(0, greatest(1, c.goal / 10) - coalesce(v_used, 0)));
      -- 0078 }
      if v_q > 0 then
        insert into public.company_contrib as k (quest_id, account_id, qty) values (c.id, new.account_id, v_q)
        on conflict (quest_id, account_id) do update set qty = k.qty + v_q,
          day = v_day, day_qty = case when k.day = v_day then k.day_qty else 0 end + v_q;              -- 0078
        update public.company_quests set progress = least(goal, progress + v_q),
               status = case when progress + v_q >= goal then 'done' else 'open' end,
               done_at = case when progress + v_q >= goal then now() end
         where id = c.id;
        if c.progress + v_q >= c.goal then perform public._company_next(c.seq); end if;
      end if;
    end if;
  exception when others then
    -- a quest must never break the gameplay RPC that emitted the event
    raise warning '_quest_on_event: % (%)', sqlerrm, new.kind;
  end;
  return new;
end $$;

-- quest_company_claim (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public.quest_company_claim(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); r record; v_paid integer := 0; v_xp integer := 0;
begin
  perform public._wallet_lock(v_account);
  for r in select q.id, q.reward_coins, q.reward_xp from public.company_quests q
             join public.company_contrib x on x.quest_id = q.id
            where q.status = 'done' and x.account_id = v_account and x.qty > 0 and x.claimed_at is null
            order by q.id limit 20                                                      -- 0078: a bounded claim
            for update of x loop
    update public.company_contrib set claimed_at = now() where quest_id = r.id and account_id = v_account;
    if r.reward_coins > 0 then perform public._pay(v_account, r.reward_coins, 'quest_reward', 'company:' || r.id); end if;
    if r.reward_xp > 0 then
      perform public._game_event(v_account, 'xp_grant', r.reward_xp, jsonb_build_object('source', 'quest', 'company', r.id));
    end if;
    perform public._game_event(v_account, 'quest_done', 1, jsonb_build_object('cat', 'company', 'quest', r.id::text));
    v_paid := v_paid + r.reward_coins; v_xp := v_xp + r.reward_xp;
  end loop;
  if v_paid = 0 and v_xp = 0 then raise exception 'nothing to claim' using errcode = '22023'; end if;
  return public._quest_state(v_account) || jsonb_build_object('paid', v_paid, 'xp', v_xp,
    'coins', (select coins from public.wallets where account_id = v_account));
end $$;

-- photo_save (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public.photo_save(p_session_token text, p_data text, p_w integer, p_h integer, p_map text,
                                             p_caption text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  if p_data is null or length(p_data) > 150000
     or p_data !~ '^data:image/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'bad photo' using errcode = '22023';
  end if;
  if p_w is null or p_h is null or p_w not between 16 and 1280 or p_h not between 16 and 1280 then
    raise exception 'bad photo' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);        -- one account's saves run one after another
  if (select count(*) from public.photo_album where account_id = v_account) >= 24 then
    raise exception 'album full' using errcode = '22023';
  end if;
  if (select count(*) from public.photo_save_log where account_id = v_account and at > now() - interval '10 minutes') >= 12 then   -- 0078
    raise exception 'too many photos' using errcode = '53400';
  end if;
  delete from public.photo_save_log where account_id = v_account and at <= now() - interval '10 minutes';                    -- 0078
  insert into public.photo_save_log (account_id) values (v_account);                                                         -- 0078
  insert into public.photo_album (account_id, data, w, h, map, caption)
  values (v_account, p_data, p_w, p_h, left(p_map, 16), left(coalesce(p_caption, ''), 60));
  perform public._game_event(v_account, 'photo_taken', 1, jsonb_build_object('map', left(p_map, 16)));
  return public._photo_list(v_account);
end $$;

-- _arena_sweep (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public._arena_sweep() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  for r in select id, status from public.arena_series
            where (status = 'open' and created_at < now() - interval '30 minutes')
               or (status = 'live' and accepted_at < now() - interval '2 hours')
            order by created_at limit 20 loop                                          -- 0078: a bounded batch
    perform public._arena_void(r.id, case when r.status = 'open' then 'expired' else 'timeout' end);
  end loop;
end $$;

-- _arena_state (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public._arena_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare t public.arena_teams;
begin
  t := public._arena_team_of(p_account);
  return jsonb_build_object(
    'team', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name,
       'code', case when t.a = p_account then t.code end, 'rating', t.rating, 'wins', t.wins, 'losses', t.losses,
       'a', (select username from public.accounts where id = t.a), 'b', (select username from public.accounts where id = t.b),
       'leader', t.a = p_account) end,
    'series', coalesce((select jsonb_agg(public._arena_series_json(s) order by s.created_at desc)
                          from public.arena_series s
                         where s.id in (select x.id from public.arena_series x                            -- 0078: the last 20
                                         where t.id is not null and (x.team_a = t.id or x.team_b = t.id)
                                           and (x.status in ('open', 'live') or x.ended_at > now() - interval '1 day')
                                         order by x.created_at desc limit 20)), '[]'),
    'ranking', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'rating', x.rating, 'wins', x.wins,
                          'losses', x.losses, 'full', x.b is not null,
                          'a', (select username from public.accounts where id = x.a),
                          'b', (select username from public.accounts where id = x.b)) order by x.rating desc, x.wins desc)
                          from (select * from public.arena_teams order by rating desc, wins desc limit 20) x), '[]'));
end $$;

-- arena_challenge (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public.arena_challenge(p_session_token text, p_team uuid, p_stake integer) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); me public.arena_teams; them public.arena_teams;
        w public.wallets;
begin
  perform public._arena_sweep();
  me := public._arena_team_of(v_account);
  if me.id is null or me.b is null then raise exception 'team not full' using errcode = '22023'; end if;
  select * into them from public.arena_teams where id = p_team;
  if not found or them.b is null then raise exception 'team not full' using errcode = '22023'; end if;
  if them.id = me.id then raise exception 'same team' using errcode = '22023'; end if;
  if p_stake is null or p_stake not between 0 and 500 then raise exception 'bad stake' using errcode = '22023'; end if;
  -- 0078 {
  -- both teams locked (id order) before the busy check: concurrent challenges on either team run one after the other
  perform 1 from public.arena_teams where id in (me.id, them.id) order by id for update;
  select * into me from public.arena_teams where id = me.id;
  select * into them from public.arena_teams where id = them.id;
  if me.id is null or me.b is null or them.id is null or them.b is null
     or v_account not in (me.a, me.b) then
    raise exception 'team not full' using errcode = '22023';
  end if;
  -- 0078 }
  if exists (select 1 from public.arena_series where status in ('open', 'live')
              and (team_a in (me.id, them.id) or team_b in (me.id, them.id))) then
    raise exception 'team busy' using errcode = '22023';
  end if;
  if p_stake > 0 and (select count(*) from public.arena_series
                       where stake > 0 and created_at >= public._vn_day_start()
                         and ((team_a = me.id and team_b = them.id) or (team_a = them.id and team_b = me.id))) >= 3 then
    raise exception 'pair cap' using errcode = '22023';
  end if;
  w := public._wallet_lock(v_account);
  if w.coins < p_stake then raise exception 'insufficient funds' using errcode = '22023'; end if;
  insert into public.arena_series (team_a, team_b, stake, payer_a, a1, a2, b1, b2)
  values (me.id, them.id, p_stake, v_account, me.a, me.b, them.a, them.b);
  if p_stake > 0 then perform public._pay(v_account, -p_stake, 'arena_team_stake', them.id::text); end if;
  return public._arena_state(v_account);
end $$;

-- arena_accept (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public.arena_accept(p_session_token text, p_series uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); s public.arena_series; me public.arena_teams;
        w public.wallets;
begin
  perform public._arena_sweep();
  me := public._arena_team_of(v_account);
  select * into s from public.arena_series where id = p_series for update;
  if not found or s.status <> 'open' then raise exception 'series gone' using errcode = '22023'; end if;
  if me.id is distinct from s.team_b then raise exception 'not your challenge' using errcode = '42501'; end if;
  if me.a <> s.b1 or me.b is distinct from s.b2 then
    perform public._arena_void(s.id, 'roster');
    -- 0078: answered, not raised (a raise rolled the void and its refund back)
    return public._arena_state(v_account) || jsonb_build_object('voided', 'roster');
  end if;
  w := public._wallet_lock(v_account);
  if w.coins < s.stake then raise exception 'insufficient funds' using errcode = '22023'; end if;
  if s.stake > 0 then perform public._pay(v_account, -s.stake, 'arena_team_stake', s.id::text); end if;
  update public.arena_series set status = 'live', payer_b = v_account, accepted_at = now() where id = s.id;
  return public._arena_state(v_account);
end $$;

-- _arena_on_fight (0071_quests.sql's, verbatim but for the lines marked 0078)
create or replace function public._arena_on_fight() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare s public.arena_series; v_pair uuid[]; v_win uuid; v_a boolean; v_each integer; ta public.arena_teams;
        tb public.arena_teams; v_d integer;
begin
  if new.status <> 'done' or old.status is not distinct from 'done' or new.kind <> 'pvp' or new.p2 is null
     or new.winner is null or new.winner = 0
     or new.ring is null then                                                    -- 0078: a bout is a ring match
    return new;
  end if;
  begin
    for s in select * from public.arena_series
              where status = 'live' and accepted_at <= new.created_at
                and new.p1 in (a1, a2, b1, b2) and new.p2 in (a1, a2, b1, b2)
              for update loop
      v_pair := public._arena_pair(s, s.bout);
      continue when not (new.p1 = any(v_pair) and new.p2 = any(v_pair));
      v_win := case when new.winner = 1 then new.p1 else new.p2 end;
      v_a := v_win in (s.a1, s.a2);
      s.score_a := s.score_a + case when v_a then 1 else 0 end;
      s.score_b := s.score_b + case when v_a then 0 else 1 end;
      update public.arena_series
         set score_a = s.score_a, score_b = s.score_b, bout = s.bout + 1,
             bouts = bouts || jsonb_build_array(jsonb_build_object('bout', s.bout, 'match', new.id,
                                                                   'side', case when v_a then 'a' else 'b' end))
       where id = s.id;
      if s.score_a >= 2 or s.score_b >= 2 then
        update public.arena_series set status = 'done', ended_at = now(),
               winner = case when s.score_a >= 2 then s.team_a else s.team_b end where id = s.id;
        select * into ta from public.arena_teams where id = s.team_a for update;
        select * into tb from public.arena_teams where id = s.team_b for update;
        -- Elo, K 32
        v_d := round(32 * ((case when s.score_a >= 2 then 1 else 0 end)
                           - 1.0 / (1 + power(10, (coalesce(tb.rating, 1000) - coalesce(ta.rating, 1000)) / 400.0))));
        update public.arena_teams set rating = rating + v_d, wins = wins + case when s.score_a >= 2 then 1 else 0 end,
               losses = losses + case when s.score_a >= 2 then 0 else 1 end where id = s.team_a;
        update public.arena_teams set rating = rating - v_d, wins = wins + case when s.score_b >= 2 then 1 else 0 end,
               losses = losses + case when s.score_b >= 2 then 0 else 1 end where id = s.team_b;
        v_each := floor(s.stake * 0.95);
        for v_win in select unnest(case when s.score_a >= 2 then array[s.a1, s.a2] else array[s.b1, s.b2] end) order by 1 loop
          if v_each > 0 then
            perform public._wallet_lock(v_win);
            perform public._pay(v_win, v_each, 'arena_team_win', s.id::text);
          end if;
          perform public._game_event(v_win, 'arena_team_win', 1, jsonb_build_object('series', s.id));
        end loop;
      end if;
      exit;
    end loop;
  exception when others then
    raise warning '_arena_on_fight: %', sqlerrm;
  end;
  return new;
end $$;

-- ---------- D. Crafting ----------
-- The dig of _mine_replay (0072), strike for strike, counting the exact hits: a hit within half a tick's travel of the
-- centre (1 000 / period ‰ — the marker's best tick; a hand lands there about 1 time in 8).
create or replace function public._mine_timing(p_seed bigint, p_need integer, p_win integer, p_strikes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := public._mine_round(p_seed, p_need); hits integer := 0; used integer := 0; s integer;
        d integer; v_exact integer := 0; v_tol integer := ceil(1000.0 / rd[1])::int;
begin
  foreach s in array coalesce(p_strikes, '{}'::integer[]) loop
    used := used + 1;
    d := abs(public._mine_pos(rd[1], s) - rd[hits + 2]);
    if d <= p_win then
      if d <= v_tol then v_exact := v_exact + 1; end if;
      hits := hits + 1;
    end if;
    exit when hits >= p_need or used >= p_need + 3;
  end loop;
  return jsonb_build_object('hits', hits, 'used', used, 'exact', v_exact, 'tol', v_tol);
end $$;
revoke all on function public._mine_timing(bigint, integer, integer, integer[]) from public, anon, authenticated;

-- mine_start (0072_mining_crafting.sql's, verbatim but for the lines marked 0078)
create or replace function public.mine_start(p_room_id uuid, p_session_token text, p_node integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_use integer[]; v_ac jsonb; mp public.mining_profiles;
        n public.mine_nodes; it public.craft_items; v_tool text; v_tier integer; v_level integer; v_win integer;
        v_seed bigint := floor(random() * 4294967296)::bigint; v_today date := public._vn_today();
begin
  if p_node is null or p_node not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_spot', 'mine_start', jsonb_build_object('node', p_node), p_room_id, 'invalid spot');
  end if;
  v_use := public._mine_node_use(p_node);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'mine_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  perform public._vitals_guard(v_account);
  mp := public._mining_profile(v_account);
  if mp.day_on = v_today and mp.day_digs >= 400 then
    raise exception 'daily dig limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  delete from public.mine_digs where account_id = v_account;   -- 0078: the dig before the node, as mine_finish
  n := public._mine_node(p_room_id, p_node);
  if n.ready_at > now() then raise exception 'node empty' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = n.item_id;
  select t.tool_id, k.tier into v_tool, v_tier
    from public.mine_tools t join public.pickaxe_kinds k on k.id = t.tool_id
   where t.account_id = v_account and t.durability > 0 and k.tier >= it.min_tier
   order by k.tier desc limit 1;
  if v_tool is null then
    if exists (select 1 from public.mine_tools where account_id = v_account and durability > 0) then
      raise exception 'pickaxe too weak' using errcode = '22023';
    end if;
    raise exception 'no pickaxe' using errcode = '22023';
  end if;
  v_level := public._upgrade_level(v_account, v_tool);
  v_win := public._mine_win(v_tier, v_level);
  insert into public.mine_digs (account_id, room_id, node_no, item_id, tool_id, seed, need, win)
  values (v_account, p_room_id, p_node, it.id, v_tool, v_seed, it.hardness, v_win);
  update public.mining_profiles
     set day_digs = case when day_on = v_today then day_digs + 1 else 1 end, day_on = v_today
   where account_id = v_account;
  return jsonb_build_object('dig', jsonb_build_object('node', p_node, 'item', it.id, 'tool', v_tool, 'seed', v_seed,
                                                      'need', it.hardness, 'win', v_win, 'started_at', now()),
                            'state', public._mine_state(p_room_id, v_account));
end $$;

-- mine_finish (0072_mining_crafting.sql's, verbatim but for the lines marked 0078)
create or replace function public.mine_finish(p_room_id uuid, p_session_token text, p_strikes integer[], p_ticks integer,
                                              p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); d public.mine_digs; v_use integer[]; v_ac jsonb;
        v_bad text; v_rep jsonb; v_code text; v_ev jsonb; n public.mine_nodes; it public.craft_items; v_qty integer;
        v_perfect boolean; v_buff integer; v_dur integer; v_vit jsonb; v_n integer := coalesce(cardinality(p_strikes), 0);
        v_tm jsonb; v_exact boolean;                                                           -- 0078
begin
  perform 1 from public.player_pos where account_id = v_account for update;   -- 0078: pos → dig → node, as mine_start
  delete from public.mine_digs where account_id = v_account and room_id = p_room_id returning * into d;
  if not found then raise exception 'dig not found' using errcode = '22023'; end if;
  v_use := public._mine_node_use(d.node_no);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'mine_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  -- the wear of any finished dig
  update public.mine_tools set durability = greatest(0, durability - 1)
   where account_id = v_account and tool_id = d.tool_id
     and durability > 0                                                               -- 0078
  returning durability into v_dur;
  -- 0078 {
  -- the pickaxe the dig started with must still be there, with durability left
  if not found then
    return jsonb_build_object('result', 'lost', 'why', 'no_pickaxe', 'tool_broke', true,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  -- 0078 }
  if now() > d.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  v_ev := jsonb_build_object('node', d.node_no, 'pass', p_pass, 'ticks', p_ticks, 'n', v_n, 'strikes', to_jsonb(p_strikes[1:12]));
  v_bad := coalesce(public._mine_input_error(p_strikes, p_ticks), case when p_pass is null then 'pass' end);
  if v_bad is not null then
    v_code := 'mine_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif p_pass then
    v_rep := public._mine_replay(d.seed, d.need, d.win, p_strikes);
    if v_rep->>'outcome' <> 'pass' or (v_rep->>'ticks')::int <> p_ticks or (v_rep->>'used')::int <> v_n then
      v_code := 'mine_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', d.seed, 'need', d.need, 'win', d.win, 'replay', v_rep);
    elsif now() < d.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'mine_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', d.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  -- 0078 {
  -- the dig's timing (0065's harvest_timing): every strike a hit on the marker's best tick, over ≥ 3 hits, is soft; the
  -- 5th such dig in 24 h is hard and mines nothing
  if v_code is null and v_rep is not null then
    v_tm := public._mine_timing(d.seed, d.need, d.win, p_strikes);
    v_exact := d.need >= 3 and (v_tm->>'used')::int = d.need and (v_tm->>'exact')::int = d.need;
    perform public._ac_stat(v_account, 'mine', 1, 1, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'mine_timing', 'mine_finish', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'mine_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'mine_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  elsif v_code is null and p_pass is false then
    perform public._ac_stat(v_account, 'mine', 1, 0, 0);
  end if;
  -- 0078 }
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'mine_finish', v_ev, p_room_id, 'invalid dig');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account)) || v_ac;
  end if;
  if not p_pass then
    return jsonb_build_object('result', 'lost', 'why', 'gave_up', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  n := public._mine_node(p_room_id, d.node_no);
  if n.ready_at > now() or n.item_id <> d.item_id then
    return jsonb_build_object('result', 'lost', 'why', 'taken', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  select * into it from public.craft_items where id = d.item_id;
  v_perfect := (v_rep->>'used')::int = d.need;
  v_buff := public._buff_power(v_account, 'miner');
  v_qty := 1 + case when v_perfect then 1 else 0 end + case when v_buff > 0 then 1 else 0 end;
  update public.mine_nodes set item_id = public._mine_roll(d.node_no, random()),
                               ready_at = now() + make_interval(secs => it.respawn_s)
   where room_id = p_room_id and node_no = d.node_no;
  perform public._bag_add(v_account, it.id, v_qty);
  v_vit := public._fishing_effort(v_account, 1.5, 2.0);
  perform public._game_event(v_account, 'ore_mined', v_qty,
    jsonb_build_object('item', it.id, 'rarity', it.rarity, 'node', d.node_no, 'perfect', v_perfect));
  perform public._game_event(v_account, 'xp_grant', it.xp * v_qty, '{"source":"mining"}'::jsonb);
  return jsonb_build_object('result', 'mined', 'item', it.id, 'qty', v_qty, 'perfect', v_perfect, 'buff', v_buff > 0,
                            'xp', it.xp * v_qty, 'tool_broke', coalesce(v_dur, 0) = 0, 'vitals', v_vit,
                            'state', public._mine_state(p_room_id, v_account));
end $$;

-- brew_potion (0072_mining_crafting.sql's, verbatim but for the lines marked 0078)
create or replace function public.brew_potion(p_session_token text, p_recipe text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('cauldron');
        r public.potion_recipes; it public.craft_items; w public.wallets; mp public.mining_profiles; e record;
        v_need integer; v_fee integer;
        v_rows integer;                                                                            -- 0078
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'brew_potion', null, 'not at the cauldron');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  select * into r from public.potion_recipes where id = p_recipe;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = r.id;
  if p_qty is null or p_qty < 1 or p_qty > 5 then
    return public._ac_flag(v_account, 'bad_qty', 'brew_potion', jsonb_build_object('recipe', p_recipe, 'qty', p_qty), null,
                           'invalid quantity', false);
  end if;
  w := public._wallet_lock(v_account);
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  v_fee := r.fee * p_qty;
  if w.coins < v_fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  -- check everything first, then take
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * p_qty;
    if e.key = 'fish' then
      if (select count(*) from public.fish where account_id = v_account) < v_need then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    elsif coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < v_need then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * p_qty;
    if e.key = 'fish' then
      delete from public.fish where id in (select id from public.fish where account_id = v_account
                                            order by price, caught_at limit v_need);
      get diagnostics v_rows = row_count;                                                         -- 0078
      if v_rows < v_need then raise exception 'not enough items' using errcode = '22023'; end if; -- 0078
    else
      if not public._bag_take(v_account, e.key, v_need) then                                      -- 0078: gone meanwhile
        raise exception 'not enough items' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_fee > 0 then perform public._pay(v_account, -v_fee, 'potion', r.id || ' x' || p_qty); end if;
  perform public._bag_add(v_account, r.id, p_qty);
  perform public._game_event(v_account, 'potion_brewed', p_qty, jsonb_build_object('potion', r.id, 'rarity', it.rarity));
  perform public._game_event(v_account, 'xp_grant', 3 * it.rarity * p_qty, '{"source":"alchemy"}'::jsonb);
  return jsonb_build_object('brewed', jsonb_build_object('potion', r.id, 'qty', p_qty), 'state', public._mine_state(null, v_account));
end $$;

-- upgrade_item (0072_mining_crafting.sql's, verbatim but for the lines marked 0078)
create or replace function public.upgrade_item(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('anvil');
        w public.wallets; v_kind text; v_price integer; v_base integer; v_level integer; v_cost integer; v_mats jsonb;
        e record; v_ok boolean;
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'upgrade_item', null, 'not at the anvil');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  w := public._wallet_lock(v_account);
  if exists (select 1 from public.mine_tools where account_id = v_account and tool_id = p_item) then
    select 'pickaxe', price, durability into v_kind, v_price, v_base from public.pickaxe_kinds where id = p_item;
  elsif exists (select 1 from public.shop_items where id = p_item and kind in ('rod', 'net')) and public._owns(v_account, p_item) then
    select kind, price, durability into v_kind, v_price, v_base from public.shop_items where id = p_item;
  else
    raise exception 'item not available' using errcode = '22023';
  end if;
  v_level := public._upgrade_level(v_account, p_item);
  if v_level >= 5 then raise exception 'max level' using errcode = '22023'; end if;
  v_cost := public._upgrade_coins(v_price, v_level);
  v_mats := public._upgrade_mats(v_level);
  if w.coins < v_cost then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(v_mats) loop
    if coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < e.q then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  for e in select key, value::int as q from jsonb_each_text(v_mats) loop
    if not public._bag_take(v_account, e.key, e.q) then                                          -- 0078: gone meanwhile
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  perform public._pay(v_account, -v_cost, 'upgrade', p_item || ' +' || (v_level + 1));
  v_ok := floor(random() * 1000) < public._upgrade_chance(v_level);
  if v_ok then
    insert into public.item_upgrades (account_id, item_id, level) values (v_account, p_item, v_level + 1)
    on conflict (account_id, item_id) do update set level = excluded.level;
    if v_kind = 'pickaxe' then
      update public.mine_tools set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and tool_id = p_item;
    elsif v_base is not null then
      update public.inventory set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and item_id = p_item and durability is not null;
    end if;
    perform public._game_event(v_account, 'xp_grant', 5 * (v_level + 1), '{"source":"upgrade"}'::jsonb);
  end if;
  perform public._game_event(v_account, 'item_upgraded', case when v_ok then v_level + 1 else v_level end,
                             jsonb_build_object('item', p_item, 'ok', v_ok, 'from', v_level));
  return jsonb_build_object('upgrade', jsonb_build_object('item', p_item, 'ok', v_ok,
                                                          'level', case when v_ok then v_level + 1 else v_level end,
                                                          'cost', v_cost, 'chance', public._upgrade_chance(v_level)),
                            'state', public._mine_state(null, v_account));
end $$;

-- ---------- E. Economy ----------
alter table public.econ_listings add column if not exists checked_at timestamptz;   -- the sweep's last stale check
create index if not exists econ_listings_checked on public.econ_listings (checked_at nulls first, id) where status = 'open';
create index if not exists econ_listings_expiry on public.econ_listings (expires_at) where status = 'open';
create index if not exists econ_trades_idle on public.econ_trades (updated_at) where status = 'open';

-- _econ_can_list (0073_player_economy.sql's, verbatim but for the lines marked 0078)
create or replace function public._econ_can_list(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  -- 0078: one listing/auction/stall stock of a seller at a time, held to the caller's insert — the limits below and the
  -- caller's reservation check (_econ_reserved) then see every earlier one
  perform pg_advisory_xact_lock(hashtext('econ_list'), hashtext(p_account::text));
  if (select count(*) from public.econ_listings where seller = p_account and status = 'open')
     + (select count(*) from public.econ_auctions where seller = p_account and status = 'open') >= public._econ_rule('max_open') then
    raise exception 'too many listings' using errcode = '53400';
  end if;
  if (select count(*) from public.econ_listings where seller = p_account and created_at > now() - interval '1 hour')
     + (select count(*) from public.econ_auctions where seller = p_account and created_at > now() - interval '1 hour')
     >= public._econ_rule('max_hour') then
    raise exception 'slow down' using errcode = '53400';
  end if;
end $$;

-- _econ_sweep (0073_player_economy.sql's, verbatim but for the lines marked 0078)
create or replace function public._econ_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare x public.econ_listings; v_id bigint; s public.econ_stalls;
begin
  -- lapsed stall rents: the stall frees, its stock expires
  for s in select * from public.econ_stalls where renter is not null and paid_until <= now()
            order by no limit 20 for update skip locked loop                                   -- 0078: bounded
    update public.econ_listings set status = 'expired', closed_at = now() where stall_no = s.no and status = 'open';
    update public.econ_stalls set renter = null, paid_until = null where no = s.no;
  end loop;
  -- expired board listings: half the listing fee back
  for x in select * from public.econ_listings where status = 'open' and expires_at <= now()
            order by expires_at limit 100 for update skip locked loop                          -- 0078: bounded
    update public.econ_listings set status = 'expired', closed_at = now() where id = x.id;
    if x.stall_no is null and x.fee / 2 > 0 then
      perform public._wallet_lock(x.seller);
      perform public._pay(x.seller, x.fee / 2, 'market_refund', 'market #' || x.id || ': expired');
    end if;
  end loop;
  -- stale: the seller no longer holds what is listed
  -- 0078 {: the 50 least recently checked open listings a call (a sale re-verifies under its lock anyway)
  update public.econ_listings l
     set checked_at = now(),
         status = case when public._econ_value(l.seller, l.asset_kind, l.asset_ref, l.qty) is null then 'void' else l.status end,
         closed_at = case when public._econ_value(l.seller, l.asset_kind, l.asset_ref, l.qty) is null then now() else l.closed_at end
   where l.id in (select k.id from public.econ_listings k where k.status = 'open'
                   order by k.checked_at nulls first, k.id limit 50 for update skip locked);
  -- 0078 }
  -- ended auctions
  for v_id in select id from public.econ_auctions where status = 'open' and ends_at <= now() order by ends_at limit 50 loop
    perform public._econ_settle(v_id);
  end loop;
  -- idle trade windows
  update public.econ_trades set status = 'cancelled', updated_at = now()
   where id in (select t.id from public.econ_trades t                                            -- 0078: bounded
                 where t.status = 'open' and t.updated_at < now() - make_interval(mins => public._econ_rule('trade_idle_min'))
                 order by t.updated_at limit 100 for update skip locked);
end $$;

-- shop_rent (0073_player_economy.sql's, verbatim but for the lines marked 0078)
create or replace function public.shop_rent(p_session_token text, p_stall integer, p_days integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; s public.econ_stalls; v_cost integer;
        v_until timestamptz; v_bal integer;
begin
  v_ac := public._pos_claim(v_account, 'market', 560, 360, 'shop_rent', null, 'not at market');
  if v_ac is not null then return v_ac; end if;
  perform public._econ_sweep();
  if p_days is null or p_days < 1 or p_days > public._econ_rule('stall_days') then raise exception 'bad days' using errcode = '22023'; end if;
  select * into s from public.econ_stalls where no = p_stall for update;
  if not found then raise exception 'no stall' using errcode = '22023'; end if;
  if s.renter is not null and s.renter <> v_account then raise exception 'stall taken' using errcode = '53400'; end if;
  if s.renter is null and exists (select 1 from public.econ_stalls where renter = v_account) then
    raise exception 'already renting' using errcode = '53400';
  end if;
  v_until := greatest(coalesce(s.paid_until, now()), now()) + make_interval(days => p_days);
  if v_until > now() + make_interval(days => public._econ_rule('stall_days')) + interval '1 minute' then
    raise exception 'bad days' using errcode = '22023';
  end if;
  v_cost := public._econ_rule('stall_day') * p_days;
  -- 0078: the stall's stock rows before the wallet (listing → wallet, as a purchase)
  perform 1 from public.econ_listings where stall_no = p_stall and status = 'open' order by id for update;
  perform public._wallet_lock(v_account);
  if coalesce((select coins from public.wallets where account_id = v_account), 0) < v_cost then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  v_bal := public._pay(v_account, -v_cost, 'shop_rent', 'stall #' || p_stall || ': ' || p_days || ' d');
  update public.econ_stalls set renter = v_account, paid_until = v_until where no = p_stall;
  update public.econ_listings set expires_at = v_until where stall_no = p_stall and status = 'open';
  return public._econ_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- ---------- F. Pets ----------
alter table public.pet_battles add column if not exists rewarded boolean not null default false;   -- XP/events paid
update public.pet_battles set rewarded = true where status = 'done' and not rewarded and (mode = 'pve' or turn >= 3);
create index if not exists pet_battles_pending on public.pet_battles (created_at) where status = 'pending';
create index if not exists pet_battles_pvp_done on public.pet_battles (finished_at) where mode = 'pvp' and status = 'done';

-- _battle_finish (0074_pets_aquarium.sql's, verbatim but for the lines marked 0078)
create or replace function public._battle_finish(p_id bigint, p_winner smallint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.pet_battles; s int; v_acc uuid; v_f jsonb; v_won boolean; v_reason text; v_xp int; v_npc public.pet_npc_catalog;
        o public.pet_owner; v_today date := public._vn_today(); v_reward int := 0; v_wins int;
        v_rewarded boolean := true;                                                          -- 0078
begin
  select * into b from public.pet_battles where id = p_id for update;
  if not found or b.status = 'done' then return; end if;
  if b.npc is not null then select * into v_npc from public.pet_npc_catalog where id = b.npc; end if;
  -- 0078 {
  -- PvP XP only for a contested battle (two turns resolved: turn ≥ 3), at most 3 a day for the pair and 10 a day for
  -- each side (the stakes still settle); a quick forfeit between friends earns nothing
  if b.mode = 'pvp' then
    v_rewarded := b.turn >= 3
      and (select count(*) from public.pet_battles x
            where x.mode = 'pvp' and x.status = 'done' and x.rewarded and x.finished_at >= public._vn_day_start()
              and ((x.p1 = b.p1 and x.p2 = b.p2) or (x.p1 = b.p2 and x.p2 = b.p1))) < 3
      and (select count(*) from public.pet_battles x
            where x.mode = 'pvp' and x.status = 'done' and x.rewarded and x.finished_at >= public._vn_day_start()
              and (x.p1 = b.p1 or x.p2 = b.p1)) < 10
      and (select count(*) from public.pet_battles x
            where x.mode = 'pvp' and x.status = 'done' and x.rewarded and x.finished_at >= public._vn_day_start()
              and (x.p1 = b.p2 or x.p2 = b.p2)) < 10;
  end if;
  -- 0078 }
  for s in 1..2 loop
    v_acc := case s when 1 then b.p1 else b.p2 end;
    v_f := case s when 1 then b.f1 else b.f2 end;
    continue when v_acc is null or v_f is null or v_f->>'kind' not in ('pet','fish');
    v_won := p_winner = s;
    v_reason := case v_f->>'kind' when 'pet' then 'pet_battle' else 'fish_battle' end;
    v_xp := case when b.mode = 'pve' then case when v_won then 10 + v_npc.level else 4 end
                 else case when v_won then 30 else 10 end end;
    if v_rewarded then perform public._fighter_gain_xp(v_f->>'kind', (v_f->>'id')::bigint, v_xp); end if;   -- 0078
    if b.mode = 'pve' and v_won then
      perform public._wallet_lock(v_acc);
      o := public._pet_owner_row(v_acc);
      v_wins := case when o.battle_day = v_today then o.wins_today else 0 end;
      if v_wins < public._pv2('pve_paid') then
        v_reward := v_npc.reward;
        perform public._pay(v_acc, v_reward, v_reason, 'pve ' || b.npc || ' #' || b.id);
      end if;
      update public.pet_owner set battle_day = v_today, wins_today = v_wins + 1,
        battles_today = case when o.battle_day = v_today then o.battles_today else 0 end
       where account_id = v_acc;
    elsif b.mode = 'pvp' and b.stake > 0 then
      if p_winner = 0 then
        perform public._wallet_lock(v_acc);
        perform public._pay(v_acc, b.stake, v_reason, 'pvp refund #' || b.id);
      elsif v_won then
        v_reward := 2 * b.stake - (2 * b.stake) / 10;
        perform public._wallet_lock(v_acc);
        perform public._pay(v_acc, v_reward, v_reason, 'pvp win #' || b.id);
      end if;
    end if;
    if v_won and v_rewarded then                                                                            -- 0078
      perform public._game_event(v_acc, case v_f->>'kind' when 'pet' then 'pet_battle_win' else 'fish_battle_win' end, 1,
                                 jsonb_build_object('mode', b.mode, 'npc', b.npc));
      perform public._game_event(v_acc, 'xp_grant', case b.mode when 'pve' then 15 else 25 end, '{"source":"pet"}'::jsonb);
    end if;
    if v_rewarded then                                                                                      -- 0078
      perform public._game_event(v_acc, 'pet_battle_done', 1, jsonb_build_object('mode', b.mode, 'won', v_won, 'kind', v_f->>'kind'));
    end if;                                                                                                 -- 0078
  end loop;
  update public.pet_battles set status = 'done', winner = p_winner, reward = v_reward, a1 = null, a2 = null,
    finished_at = now(), rewarded = v_rewarded where id = p_id;                                              -- 0078
end $$;

-- _battle_sweep (0074_pets_aquarium.sql's, verbatim but for the lines marked 0078)
create or replace function public._battle_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.pet_battles;
begin
  delete from public.pet_battles where id in (select id from public.pet_battles                         -- 0078: bounded
                                               where status = 'pending' and created_at < now() - interval '5 minutes'
                                               order by created_at limit 100 for update skip locked);
  for b in select * from public.pet_battles where status = 'active' and acted_at < now() - interval '120 seconds'
            order by id limit 20 for update skip locked loop
    perform public._battle_finish(b.id, (case when b.mode = 'pve' then 2
                                              when b.a1 is not null and b.a2 is null then 1
                                              when b.a2 is not null and b.a1 is null then 2 else 0 end)::smallint);
  end loop;
end $$;

-- _battle_state (0074_pets_aquarium.sql's, verbatim but for the lines marked 0078)
create or replace function public._battle_state(p_account uuid, p_room uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'battle', (select public._battle_json(b, p_account) from public.pet_battles b
                where b.status = 'active' and (b.p1 = p_account or b.p2 = p_account) order by b.id desc limit 1),
    'last', (select public._battle_json(b, p_account) from public.pet_battles b
              where b.status = 'done' and (b.p1 = p_account or b.p2 = p_account) and b.finished_at > now() - interval '10 minutes'
              order by b.finished_at desc limit 1),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'from', a.username, 'stake', b.stake, 'fighter', b.f1) order by b.id)
                            from (select * from public.pet_battles x where x.status = 'pending' and x.p2 = p_account
                                   order by x.id desc limit 20) b                                           -- 0078: the last 20
                            join public.accounts a on a.id = b.p1), '[]'::jsonb),
    'outgoing', (select jsonb_build_object('id', b.id, 'to', a.username, 'stake', b.stake) from public.pet_battles b
                   join public.accounts a on a.id = b.p2 where b.status = 'pending' and b.p1 = p_account order by b.id desc limit 1),
    'fish', coalesce((select jsonb_agg(public._fish_fighter_json(f) order by f.id) from public.fish_fighters f
                       where f.account_id = p_account), '[]'::jsonb),
    'npcs', (select jsonb_agg(public._npc_snap(n) || jsonb_build_object('reward', n.reward, 'npc_kind', n.kind) order by n.sort_order)
               from public.pet_npc_catalog n),
    'wins_today', coalesce((select case when o.battle_day = public._vn_today() then o.wins_today else 0 end
                              from public.pet_owner o where o.account_id = p_account), 0),
    'battles_today', coalesce((select case when o.battle_day = public._vn_today() then o.battles_today else 0 end
                                 from public.pet_owner o where o.account_id = p_account), 0),
    'rivals', case when p_room is null then '[]'::jsonb else coalesce((
                select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.username) order by r.username)
                  from (select a.id, a.username                                                          -- 0078: 50 at most
                  from public.members m join public.accounts a on a.id = m.account_id
                 where m.room_id = p_room and m.account_id <> p_account
                   and exists (select 1 from public.members me where me.room_id = p_room and me.account_id = p_account)
                   and (exists (select 1 from public.pets pp where pp.account_id = a.id)
                        or exists (select 1 from public.fish_fighters ff where ff.account_id = a.id))
                 order by a.username limit 50) r), '[]'::jsonb) end,                                   -- 0078
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;

-- house_admit (0074_pets_aquarium.sql's, verbatim but for the lines marked 0078)
create or replace function public.house_admit(p_session_token text, p_account uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_lot smallint;
        v_knock timestamptz;                                                                    -- 0078
begin
  select no into v_lot from public.house_lots where owner_id = v_account;
  if v_lot is null then raise exception 'no home' using errcode = '53400'; end if;
  delete from public.house_knocks where lot_no = v_lot and account_id = p_account
  returning at into v_knock;                                                                    -- 0078
  if coalesce(p_accept, false) and p_account <> v_account then
    -- 0078: a pass answers a knock of the last 10 minutes (as the owner's list shows them)
    if v_knock is null or v_knock <= now() - interval '10 minutes' then
      raise exception 'no knock' using errcode = '53400';
    end if;
    insert into public.house_guests (lot_no, account_id, until) values (v_lot, p_account, now() + interval '3 hours')
    on conflict (lot_no, account_id) do update set until = excluded.until;
  else
    delete from public.house_guests where lot_no = v_lot and account_id = p_account;
  end if;
  return public._house_knocks_json(v_account);
end $$;

-- ---------- G. Fishing ----------

-- _fb_sweep (0076_fishing_extras.sql's, verbatim but for the lines marked 0078)
create or replace function public._fb_sweep(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;
begin
  for r in select id, status from public.fishing_battles
            where room_id = p_room and ((status = 'live' and ends_at <= now())
                                        or (status = 'open' and created_at < now() - interval '15 minutes'))
            order by created_at limit 10 loop                                                  -- 0078: a bounded batch
    if r.status = 'live' then perform public._fb_settle(r.id); else perform public._fb_cancel(r.id, 'timeout'); end if;
  end loop;
end $$;

-- fb_create (0076_fishing_extras.sql's, verbatim but for the lines marked 0078)
create or replace function public.fb_create(p_room_id uuid, p_session_token text, p_fee integer, p_duration_s integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; v_id uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_fee is null or p_fee not between 100 and 10000 or p_duration_s is null or p_duration_s not in (180, 300, 600) then
    return public._ac_flag(v_account, 'bad_qty', 'fb_create', jsonb_build_object('fee', p_fee, 'duration', p_duration_s),
                           p_room_id, 'invalid quantity');
  end if;
  perform public._fb_sweep(p_room_id);
  perform public._fb_at_pond(v_account);
  perform pg_advisory_xact_lock(hashtext('fishing_battles'), hashtext(p_room_id::text));   -- 0078: the room's cap, serialized
  w := public._wallet_lock(v_account);
  if (public._fb_mine(v_account)).id is not null then raise exception 'in battle' using errcode = '22023'; end if;
  if (select count(*) from public.fishing_battles where room_id = p_room_id and status = 'open') >= 3 then
    raise exception 'too many battles' using errcode = '22023';
  end if;
  if coalesce(w.coins, 0) < p_fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  insert into public.fishing_battles (room_id, host, fee, duration_s, pot) values (p_room_id, v_account, p_fee, p_duration_s, p_fee)
  returning id into v_id;
  insert into public.fishing_battle_players (battle_id, account_id) values (v_id, v_account);
  perform public._pay(v_account, -p_fee, 'fishing_battle_entry', 'battle ' || v_id);
  return public.fb_state(p_room_id, p_session_token);
end $$;

-- fb_join (0076_fishing_extras.sql's, verbatim but for the lines marked 0078)
create or replace function public.fb_join(p_room_id uuid, p_session_token text, p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; b public.fishing_battles;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  perform public._fb_sweep(p_room_id);
  perform public._fb_at_pond(v_account);
  select * into b from public.fishing_battles where id = p_battle and room_id = p_room_id for update;   -- 0078: battle →
  w := public._wallet_lock(v_account);                                                                -- 0078: → wallet
  if b.id is null or b.status <> 'open' then raise exception 'battle closed' using errcode = '22023'; end if;   -- 0078
  if (public._fb_mine(v_account)).id is not null then raise exception 'in battle' using errcode = '22023'; end if;
  if (select count(*) from public.fishing_battle_players where battle_id = p_battle) >= 8 then
    raise exception 'battle full' using errcode = '22023';
  end if;
  if coalesce(w.coins, 0) < b.fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  insert into public.fishing_battle_players (battle_id, account_id) values (p_battle, v_account);
  update public.fishing_battles set pot = pot + b.fee where id = p_battle;
  perform public._pay(v_account, -b.fee, 'fishing_battle_entry', 'battle ' || p_battle);
  return public.fb_state(p_room_id, p_session_token);
end $$;

-- fb_leave (0076_fishing_extras.sql's, verbatim but for the lines marked 0078)
create or replace function public.fb_leave(p_room_id uuid, p_session_token text, p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; b public.fishing_battles;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  select * into b from public.fishing_battles where id = p_battle and room_id = p_room_id for update;   -- 0078: battle →
  perform public._wallet_lock(v_account);                                                             -- 0078: → wallet
  if b.id is null or b.status <> 'open'                                                               -- 0078: perform set FOUND
     or not exists (select 1 from public.fishing_battle_players where battle_id = p_battle and account_id = v_account) then
    raise exception 'battle closed' using errcode = '22023';
  end if;
  if b.host = v_account then
    perform public._fb_cancel(p_battle, 'host left');
  else
    delete from public.fishing_battle_players where battle_id = p_battle and account_id = v_account;
    update public.fishing_battles set pot = pot - b.fee where id = p_battle;
    perform public._pay(v_account, b.fee, 'fishing_battle_refund', 'battle ' || p_battle || ' left');
  end if;
  return public.fb_state(p_room_id, p_session_token);
end $$;

-- _fx_on_wipe (0076_fishing_extras.sql's, verbatim but for the lines marked 0078)
create or replace function public._fx_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;                                                                          -- 0078
begin
  delete from public.boats where account_id = new.account_id;
  delete from public.boat_trips where account_id = new.account_id;
  delete from public.treasure_maps where account_id = new.account_id;
  delete from public.farm_machines where account_id = new.account_id;
  delete from public.processor_jobs where account_id = new.account_id;
  delete from public.processed_goods where account_id = new.account_id;
  -- 0078 {
  -- hosted battles still open are cancelled (every fee back; the wiped host's refund goes with _ac_wipe's wallet delete);
  -- elsewhere the account leaves: an open battle's pot gives its fee back to nobody (the fee is burned with the wipe), a
  -- live battle loses its score (the fee stays in the pot)
  for r in select b.id from public.fishing_battles b
            where b.host = new.account_id and b.status = 'open' order by b.id loop
    perform public._fb_cancel(r.id, 'wipe');
  end loop;
  for r in select b.id, b.fee, b.status from public.fishing_battles b
             join public.fishing_battle_players p on p.battle_id = b.id and p.account_id = new.account_id
            where b.status in ('open', 'live') order by b.id loop
    perform 1 from public.fishing_battles where id = r.id for update;
    delete from public.fishing_battle_players where battle_id = r.id and account_id = new.account_id;
    if r.status = 'open' then
      update public.fishing_battles set pot = greatest(0, pot - r.fee) where id = r.id;
    end if;
  end loop;
  -- 0078 }
  return new;
end $$;

-- ---------- H. World ----------
-- The album as a counter per species (0075 aggregated every photo ever taken on each poll); wild_photos now only has
-- to remember the live spawns (was this one photographed?) and is cleaned after a day.
create table if not exists public.wild_album (
  account_id uuid not null references public.accounts(id) on delete cascade,
  species text not null,
  n integer not null default 0,
  primary key (account_id, species)
);
alter table public.wild_album enable row level security;
revoke all on public.wild_album from anon, authenticated;
insert into public.wild_album (account_id, species, n)
select account_id, species, count(*) from public.wild_photos group by account_id, species
on conflict do nothing;
create or replace function public._wild_album_add() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.wild_album as w (account_id, species, n) values (new.account_id, new.species, 1)
  on conflict (account_id, species) do update set n = w.n + 1;
  return new;
end $$;
revoke all on function public._wild_album_add() from public, anon, authenticated;
drop trigger if exists wild_photos_album on public.wild_photos;
create trigger wild_photos_album after insert on public.wild_photos for each row execute function public._wild_album_add();
create index if not exists wild_photos_at on public.wild_photos (at);
create index if not exists wild_spawns_expires on public.wild_spawns (expires_at);
create index if not exists party_chat_account on public.party_chat (account_id, created_at);

-- snow_event_start (0075_world_bosses.sql's, verbatim but for the lines marked 0078)
create or replace function public.snow_event_start(p_room_id uuid, p_session_token text, p_minutes integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_member uuid; v_root boolean;
begin
  v_acc := public._ac_account(p_session_token);
  v_member := public._auth(p_room_id, p_session_token, 'any');
  select coalesce(is_root, false) into v_root from public.accounts where id = v_acc;
  if (select r.admin_member_id from public.rooms r where r.id = p_room_id) is distinct from v_member and not v_root then
    raise exception 'not owner' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 10 and 120 then
    raise exception 'invalid minutes' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('world_snow'), hashtext(p_room_id::text));   -- 0078: the cooldown check, serialized
  if not v_root and exists (select 1 from public.world_snow s where s.room_id = p_room_id and s.started_at > now() - interval '6 hours') then
    raise exception 'too soon' using errcode = '53400';
  end if;
  insert into public.world_snow (room_id, started_at, until, started_by)
  values (p_room_id, now(), now() + make_interval(mins => p_minutes), v_acc)
  on conflict (room_id) do update set started_at = excluded.started_at, until = excluded.until, started_by = excluded.started_by;
  return public._weather_json(public._room_weather(p_room_id));
end $$;

-- _wild_fill (0075_world_bosses.sql's, verbatim but for the lines marked 0078)
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
     where p_map = any(s.maps) and (s.active = 'any' or (s.active = 'night') = v_night)
     order by -ln(1 - random()) / s.weight limit 1;                     -- a weighted draw
    exit when v_sp is null;
    select * into a from public._wild_areas() ar where ar.map = p_map order by random() limit 1;
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

-- _wild_json (0075_world_bosses.sql's, verbatim but for the lines marked 0078)
create or replace function public._wild_json(p_account uuid, p_map text) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'animals', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'species', w.species, 'hx', w.hx, 'hy', w.hy, 'seed', w.seed,
                                                             'born_ms', (extract(epoch from w.born_at) * 1000)::bigint,
                                                             'expires_ms', (extract(epoch from w.expires_at) * 1000)::bigint,
                                                             'photographed', exists (select 1 from public.wild_photos ph
                                                                                      where ph.account_id = p_account and ph.spawn_id = w.id))
                                          order by w.id)
                           from public.wild_spawns w
                          where w.map = p_map and w.taken_at is null and w.expires_at > now()), '[]'::jsonb),
    'bag', coalesce((select jsonb_object_agg(b.item, b.qty) from public.wild_bag b where b.account_id = p_account and b.qty > 0), '{}'::jsonb),
    'album', coalesce((select jsonb_object_agg(x.species, x.n) from public.wild_album x                  -- 0078: the counter
                        where x.account_id = p_account and x.n > 0), '{}'::jsonb),
    'kills_today', coalesce((select case when p.day = public._vn_today() then p.kills else 0 end from public.wild_profile p
                              where p.account_id = p_account), 0))
$$;

-- party_say (0075_world_bosses.sql's, verbatim but for the lines marked 0078)
create or replace function public.party_say(p_session_token text, p_body text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_party bigint; v_body text := trim(coalesce(p_body, ''));
begin
  v_acc := public._ac_account(p_session_token);
  v_party := public._party_of(v_acc);
  if v_party is null then raise exception 'no party' using errcode = '22023'; end if;
  if char_length(v_body) = 0 or char_length(v_body) > 120 then raise exception 'invalid message' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('party_say'), hashtext(v_acc::text));   -- 0078: one message of mine at a time
  if exists (select 1 from public.party_chat where account_id = v_acc and created_at > now() - interval '1 second') then
    raise exception 'too fast' using errcode = '53400';
  end if;
  insert into public.party_chat (party_id, account_id, body) values (v_party, v_acc, v_body);
  delete from public.party_chat where party_id = v_party
     and id < (select min(id) from (select id from public.party_chat where party_id = v_party order by id desc limit 50) k);
  return public._party_json(v_acc);
end $$;

-- boss_attack (0075_world_bosses.sql's, verbatim but for the lines marked 0078)
create or replace function public.boss_attack(p_session_token text, p_fight bigint, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; f public.boss_fights; d record; h public.boss_hits;
        v_gap double precision; v_combo integer; v_cap integer; v_dmg integer; v_slam boolean := false;
begin
  v_acc := public._ac_account(p_session_token);
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'boss_attack', null, 'not in arena');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  select * into f from public.boss_fights where id = p_fight for update;
  if not found then raise exception 'no boss' using errcode = '22023'; end if;
  select * into d from public._boss_defs() where id = f.boss;
  if f.status <> 'up' or now() < f.starts_at or now() >= f.ends_at then raise exception 'boss not up' using errcode = '53400'; end if;
  -- 0078: a weather boss belongs to its room — only the room's members hit it
  if f.room_key <> '00000000-0000-0000-0000-000000000000'::uuid
     and not exists (select 1 from public.members m where m.room_id = f.room_key and m.account_id = v_acc) then
    raise exception 'not in room' using errcode = '42501';
  end if;
  if pp.map is distinct from d.map or pp.x not between d.ax - 16 and d.ax + d.aw + 16 or pp.y not between d.ay - 16 and d.ay + d.ah + 16 then
    raise exception 'not in arena' using errcode = '22023';
  end if;
  insert into public.boss_hits (fight_id, account_id) values (f.id, v_acc) on conflict do nothing;
  select * into h from public.boss_hits where fight_id = f.id and account_id = v_acc for update;
  v_gap := coalesce(extract(epoch from now() - h.last_at), 99);
  if v_gap < 0.3 then
    return public._ac_flag(v_acc, 'boss_spam', 'boss_attack', jsonb_build_object('gap', round(v_gap::numeric, 3)), null, 'cooldown', false);
  end if;
  if v_gap < 0.9 then raise exception 'cooldown' using errcode = '53400'; end if;
  v_cap := (f.max_hp * d.cap_pct) / 100;
  if h.dmg >= v_cap then raise exception 'damage cap' using errcode = '53400'; end if;
  v_combo := case when v_gap <= 2.0 then least(h.combo + 1, 5) else 0 end;   -- the rhythm: strike again 0.9–2 s later
  v_dmg := ((40 + floor(random() * 21)::int) * (100 + 15 * v_combo)) / 100;
  if f.phase = 3 then v_dmg := (v_dmg * 4) / 5; end if;                      -- enraged: thicker hide
  v_dmg := greatest(1, least(v_dmg, v_cap - h.dmg, f.hp));
  update public.boss_hits set dmg = dmg + v_dmg, hits = hits + 1, combo = v_combo, last_at = now()
   where fight_id = f.id and account_id = v_acc;
  f.hp := f.hp - v_dmg;
  f.phase := case when f.hp * 3 > f.max_hp * 2 then 1 when f.hp * 3 > f.max_hp then 2 else 3 end;
  if random() < (case f.phase when 1 then 0.10 when 2 then 0.18 else 0.28 end) then          -- the boss strikes back
    v_slam := true;
    update public.vitals set hunger = greatest(1, hunger - 3), thirst = greatest(1, thirst - 3) where account_id = v_acc;
  end if;
  perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', f.boss, 'fight', f.id, 'combo', v_combo));
  if f.hp <= 0 then
    update public.boss_fights set hp = 0, phase = 3, status = 'dead', killed_at = now(), killer = v_acc where id = f.id;
    perform public._boss_payout(f.id);
  else
    update public.boss_fights set hp = f.hp, phase = f.phase where id = f.id;
  end if;
  return jsonb_build_object('dmg', v_dmg, 'combo', v_combo, 'slam', v_slam, 'hp', greatest(0, f.hp), 'phase', f.phase,
                            'killed', f.hp <= 0, 'my_dmg', h.dmg + v_dmg, 'cap', v_cap);
end $$;

-- dungeon_attack (0075_world_bosses.sql's, verbatim but for the lines marked 0078)
create or replace function public.dungeon_attack(p_session_token text, p_run bigint, p_target integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; r public.dungeon_runs; m public.dungeon_members; v_gap double precision; v_combo integer;
        v_dmg integer; v_t integer; v_hit boolean := false; v_cleared boolean := false; v_mobs integer[];
begin
  v_acc := public._ac_account(p_session_token);
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 60, 120, 'dungeon_attack', null, 'not at gate');
  if v_ac is not null then return v_ac; end if;
  select * into r from public.dungeon_runs where id = p_run for update;
  if not found or r.status <> 'open' then raise exception 'run over' using errcode = '22023'; end if;
  if r.expires_at <= now() then
    update public.dungeon_runs set status = 'failed', ended_at = now() where id = r.id;
    return jsonb_build_object('expired', true) || public._dg_json(v_acc);
  end if;
  select * into m from public.dungeon_members where run_id = r.id and account_id = v_acc for update;
  if not found then raise exception 'not joined' using errcode = '42501'; end if;
  -- 0078: still in the run's party (a member who left or was kicked stops fighting)
  if public._party_of(v_acc) is distinct from r.party_id then raise exception 'not in party' using errcode = '42501'; end if;
  v_gap := coalesce(extract(epoch from now() - m.last_at), 99);
  if v_gap < 0.3 then
    return public._ac_flag(v_acc, 'dungeon_spam', 'dungeon_attack', jsonb_build_object('gap', round(v_gap::numeric, 3)), null, 'cooldown', false);
  end if;
  if v_gap < 0.9 then raise exception 'cooldown' using errcode = '53400'; end if;
  v_mobs := r.mobs;
  v_t := case when p_target between 1 and coalesce(array_length(v_mobs, 1), 0) and v_mobs[p_target] > 0 then p_target
              else (select min(i) from generate_subscripts(v_mobs, 1) i where v_mobs[i] > 0) end;
  v_combo := case when v_gap <= 2.0 then least(m.combo + 1, 5) else 0 end;
  v_dmg := ((40 + floor(random() * 21)::int) * (100 + 15 * v_combo)) / 100;
  v_dmg := greatest(1, least(v_dmg, v_mobs[v_t]));
  v_mobs[v_t] := v_mobs[v_t] - v_dmg;
  update public.dungeon_members set dmg = dmg + v_dmg, hits = hits + 1, combo = v_combo, last_at = now()
   where run_id = r.id and account_id = v_acc;
  if r.room = 4 then
    perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', 'doi_chua', 'dungeon', true, 'combo', v_combo));
  end if;
  if random() < (case when r.room = 4 then 0.25 else 0.15 end) then                   -- a monster bites back
    v_hit := true;
    update public.vitals set hunger = greatest(1, hunger - 3), thirst = greatest(1, thirst - 3) where account_id = v_acc;
  end if;
  if not exists (select 1 from unnest(v_mobs) x where x > 0) then
    if r.room >= 4 then
      update public.dungeon_runs set mobs = v_mobs, status = 'cleared', ended_at = now() where id = r.id;
      perform public._dg_payout(r.id);
      v_cleared := true;
    else
      update public.dungeon_runs set room = r.room + 1, mobs = public._dg_mobs(r.room + 1, r.scale) where id = r.id;
    end if;
  else
    update public.dungeon_runs set mobs = v_mobs where id = r.id;
  end if;
  return jsonb_build_object('dmg', v_dmg, 'target', v_t, 'combo', v_combo, 'bitten', v_hit, 'cleared', v_cleared) || public._dg_json(v_acc);
end $$;

-- ---------- I. Professions ----------
create table if not exists public.fight_stamina_short (
  match_id uuid not null references public.fight_matches(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (match_id, account_id)
);
alter table public.fight_stamina_short enable row level security;
revoke all on public.fight_stamina_short from anon, authenticated;

-- _ev_fight (0069_v21_events.sql's, verbatim but for the lines marked 0078)
create or replace function public._ev_fight() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform public._game_event(new.p1, 'fight_done', 1, jsonb_build_object('kind', new.kind, 'match', new.id));        -- 0078: + match
    if new.p2 is not null then
      perform public._game_event(new.p2, 'fight_done', 1, jsonb_build_object('kind', new.kind, 'match', new.id));      -- 0078
    end if;
    if new.winner = 1 then
      perform public._game_event(new.p1, 'fight_win', 1, jsonb_build_object('kind', new.kind, 'match', new.id));       -- 0078
    elsif new.winner = 2 and new.p2 is not null then
      perform public._game_event(new.p2, 'fight_win', 1, jsonb_build_object('kind', new.kind, 'match', new.id));       -- 0078
    end if;
  end if;
  return new;
end $$;

-- _prof_on_event (0077_professions.sql's, verbatim but for the lines marked 0078)
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

-- _prof_on_fight (0077_professions.sql's, verbatim but for the lines marked 0078)
create or replace function public._prof_on_fight() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  -- 0078 {: a side that cannot pay the fight's stamina is recorded (its nghề XP for this match is withheld)
  if (public._stamina_settle(new.p1)).value < public._stamina_cost(new.p1, 8, 'fight') then
    insert into public.fight_stamina_short (match_id, account_id) values (new.id, new.p1) on conflict do nothing;
  end if;
  if new.p2 is not null and (public._stamina_settle(new.p2)).value < public._stamina_cost(new.p2, 8, 'fight') then
    insert into public.fight_stamina_short (match_id, account_id) values (new.id, new.p2) on conflict do nothing;
  end if;
  -- 0078 }
  perform public._stamina_drain(new.p1, 8, 'fight');
  if new.p2 is not null then perform public._stamina_drain(new.p2, 8, 'fight'); end if;
  return new;
end $$;

-- stamina_tick (0077_professions.sql's, verbatim but for the lines marked 0078)
create or replace function public.stamina_tick(p_session_token text, p_run_ms integer default 0,
                                               p_resting boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); s public.player_stamina; v_run numeric;
        v_rest boolean := false;                                                                -- 0078
begin
  -- 0078: resting is lying in the hammock — claimed there (server position) before the stamina row is locked
  if p_resting then
    v_rest := public._pos_claim(v_account, 'hall', 128, 212, 'stamina_tick', null, 'not at the hammock') is null;
  end if;
  s := public._stamina_settle(v_account);
  v_run := least(greatest(0, coalesce(p_run_ms, 0)) / 1000.0, 60,
                 coalesce(extract(epoch from (now() - s.tick_at)), 30));
  update public.player_stamina set tick_at = now() where account_id = v_account;
  if v_run > 0 then perform public._stamina_drain(v_account, v_run, 'run'); end if;
  if p_resting and v_rest then                                                                  -- 0078
    update public.player_stamina set rest_until = now() + interval '40 seconds' where account_id = v_account;
  elsif not p_resting then
    update public.player_stamina set rest_until = null where account_id = v_account;
  end if;
  return public._stamina_json(v_account);
end $$;
