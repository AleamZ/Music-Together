-- tests/sql/anticheat-guards.sql — the guard regression (anti-cheat spec §15.1, R23). Self-contained: run it as the
-- superuser on the throwaway PostgreSQL cluster after the full chain (0004 … newest; refreshed for anti-cheat v2 part 3,
-- 0064–0067). A new game RPC that does not call _ac_account or _ac_play fails the static check until it is guarded or,
-- when it is not a game action (or is unguarded on purpose), put on the allowlist below by its signature; a new guarded
-- RPC joins the dynamic loops.
\set ON_ERROR_STOP on

-- 1. Static, deny by default: every SECURITY DEFINER function in public that anon may execute is on the allowlist or
--    calls the lock gate. The allowlist names signatures (oid::regprocedure), so a new overload of an allowed name is
--    not allowed by that name. A private helper (_name) is never on it: it must be revoked from anon.
create or replace function pg_temp.unguarded() returns text language sql as $$
  select string_agg(f.sig, ', ' order by f.sig)
    from (select regexp_replace(p.oid::regprocedure::text, '^public\.', '') as sig
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
             and p.prosrc !~ '_ac_(account|play)\(') f
   where f.sig not in (
     -- accounts, rooms, the music, chat and feedback: not game actions
     'register(text,text)', 'login(text,text)', 'me(text)', 'logout(text)',
     'create_room(text,text,text)', 'join_room(text,text,text)', 'rename_room(uuid,text,text)', 'kick_member(uuid,text,uuid)',
     'assign_dj(uuid,text,uuid)', 'transfer_admin(uuid,text,uuid)', 'set_play_mode(uuid,text,text)',
     'update_room_settings(uuid,text,integer,boolean,text[],integer,boolean)', 'touch_room(uuid,text)',
     'add_queue_item(uuid,text,text,text,text,integer)', 'add_queue_items(uuid,text,jsonb)', 'advance_queue(uuid,text)',
     'set_playback(uuid,text,boolean,timestamp with time zone,integer)', 'seek_playback(uuid,text,integer)',
     'reorder_item(uuid,text,uuid,double precision)', 'bump_to_top(uuid,text,uuid)', 'delete_item(uuid,text,uuid)',
     'approve_queue_item(uuid,text,uuid)', 'approve_all_pending(uuid,text)', 'reject_queue_item(uuid,text,uuid)',
     'send_chat_message(text,uuid,text)', 'delete_chat_message(text,uuid,uuid)',
     'submit_feedback(text,text,text)', 'list_feedback(text)', 'set_feedback_status(text,uuid,text)', 'delete_feedback(text,uuid)',
     'upsert_video_lyrics(uuid,text,text,text,text,text,text,integer,text)', 'update_video_lyric_offset(uuid,text,text,integer)',
     'tv_add(text,uuid,integer,text,text,integer)', 'tv_next(text,uuid,integer,text)', 'tv_skip(text,uuid,integer)',
     'tv_state(text,uuid,integer)',
     'set_room_weather(uuid,text,integer,boolean,timestamp with time zone,timestamp with time zone,numeric,numeric,numeric)',
     'room_weather_state(uuid,text)',
     -- root's (each checks _auth_root)
     'admin_list_rooms(text)', 'admin_delete_room(text,uuid)', 'admin_list_accounts(text)', 'admin_set_ban(text,uuid,boolean)',
     'admin_delete_account(text,uuid)', 'admin_stats(text)',
     'admin_anticheat_list(text)', 'admin_anticheat_account(text,uuid)', 'admin_anticheat_resolve(text,uuid,text)',
     'admin_anticheat_set_mode(text,text)', 'admin_anticheat_config(text,jsonb)', 'admin_anticheat_stats(text)',
     'admin_anticheat_stats_run(text)', 'admin_blacklist_set(text,uuid,boolean,text)', 'admin_stat_review(text,uuid)',
     'admin_estate_flags(text)', 'admin_fight_config(text,jsonb)', 'admin_fight_list(text)', 'admin_fight_log(text,uuid)',
     'news_admin_list(text)', 'news_post_delete(text,uuid)', 'news_post_upsert(text,uuid,text,text,text,boolean)',
     -- reads
     'fishing_state(text)', 'fishing_board(uuid,text)', 'field_state(uuid,text)', 'dog_state(text)',
     'card_lobby(uuid,text)', 'card_state(uuid,text,text)', 'card_hand(uuid,text,text)', 'card_tick(uuid,text,text)',
     'card_leave(uuid,text,text)', 'get_my_wardrobe(text)', 'pets_state(text)', 'rain_state(text)', 'heat_state(uuid,text)',
     'fridge_state(text)', 'motel_state(text)', 'vehicles_state(text)', 'apt_list(text)', 'house_list(text)',
     'estate_state(text)', 'news_feed(uuid,text)', 'news_mark_read(uuid,text,text)', 'dojo_state(text)', 'ring_board(uuid,text)',
     'ring_state(uuid,text)', 'fight_state(text,uuid)', 'ug_board(uuid,text)', 'ug_status(uuid,text)', 'ug_cup_state(uuid,text)',
     'dojo_kata_notes(text,uuid)',
     'progress_state(text)', 'progress_leaderboard(text,text)',   -- v21 progression (0070)
     'quest_state(text)', 'login_state(text)', 'arena_state(text)', 'photo_list(text)', 'photo_get(text,bigint)',
     'photo_delete(text,bigint)',                                 -- v21 quests (0071): reads, and deleting one's own photo
     'profession_state(text)',                                    -- v21 professions (0077): a read
     'fb_state(uuid,text)', 'fishing_extras_state(text)',         -- v21 fishing (0076): reads (fb_state settles lazily)
     -- the position and the heartbeat: they run during a lock by design (0057), and judge every claim themselves
     'pos_report(text,text,integer,integer)', 'vitals_tick(text,uuid,text,integer,integer)',
    'pos_report_w(text,integer,integer)',                         -- 0088: the claim in world px
    'pos_report_w(text,integer,integer,text)',                    -- 0089: … and what I ride
    'app_flags()',                                                -- 0088: a read of the switches
     'jump_in(uuid,text,integer,integer)', 'rescue_swimmer(uuid,text,uuid,integer,integer)', 'leave_water(uuid,text)',
     'warm_up_start(uuid,text,integer,integer)', 'warm_up_finish(uuid,text)', 'skip_trip(text)',
     -- the character, the wardrobe and the home: spending or moving one's own things, no income
     'save_character(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb)', 'salon_style(text,text,text)',
     'buy_fashion_item(text,text)', 'sell_fashion_item(text,text)', 'transfer_fashion_item(text,uuid,text)',
     'fight_wear_uniform(text,text)', 'fight_unwear_uniform(text)',
     'buy_vehicle(text,text)', 'sell_vehicle(text,text)', 'umbrella_buy(text,text)', 'umbrella_hold(text,bigint)',
     'eat_meal(text,text,uuid)', 'fish_move_to_bag(text,uuid)', 'fish_move_to_fridge(text,uuid)',
     'motel_rent(text,text)', 'motel_sleep(text)', 'home_sleep(text,text,integer)',
     'apt_admit(text,uuid,boolean)', 'apt_buy(text,integer)', 'apt_enter(text,uuid,integer)', 'apt_knock(text,uuid,integer)',
     'apt_move_out(text)', 'apt_rent(text,integer)', 'apt_set_surface(text,text,text)', 'apt_set_visibility(text,text)',
     'furniture_buy(text,text)', 'furniture_pickup(text,bigint)', 'furniture_place(text,bigint,integer,integer,integer)',
     'house_build(text,text,text)', 'house_enter(text,uuid,integer)', 'house_pickup(text,integer,bigint)',
     'house_place(text,integer,bigint,integer,integer,integer)', 'house_room_leave(text)', 'house_room_price(text,integer,integer)',
     'house_room_rent(text,integer,integer)', 'house_set_surface(text,text,text)', 'house_set_visibility(text,text)',
     'lot_buy(text,integer)', 'lot_sell(text)', 'lot_upkeep(text)',
     'estate_buy(text,bigint,integer)', 'estate_cancel(text)', 'estate_list(text,text,integer,boolean)',
     'pet_buy(text,text,text,text)', 'pet_buy_item(text,text,integer)', 'pet_equip(text,bigint,text,text)',
     'pet_feed(text,bigint)', 'pet_play(text,bigint)', 'pet_rename(text,bigint,text)', 'pet_set_active(text,bigint)',
     -- the fights: a match in progress must not break on a lock (fight_push); entering spends; the prizes are settled
     -- by the server's replay
     'dojo_enroll(text,text)', 'fight_push(text,uuid,integer,integer[],integer,integer[],integer,bigint,integer)',
     'fight_claim(text,uuid)', 'fight_forfeit(text,uuid)', 'ring_leave(uuid,text,integer)',
     'ug_enter(uuid,text)', 'ug_ladder_start(uuid,text,integer)', 'ug_queue_join(uuid,text,integer)', 'ug_queue_leave(uuid,text)',
     'ug_cup_join(uuid,text,integer)', 'ug_cup_leave(uuid,text)', 'ug_ready(uuid,text,uuid,integer)')
$$;

do $$
begin
  assert pg_temp.unguarded() is null, 'unguarded: ' || pg_temp.unguarded();
  -- no private helper is anon's (0064 revoked 0021's _xidach_start / _xidach_due)
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_%'
                       and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
    'a private helper is executable by anon';
end $$;

-- The check itself: an unguarded overload of an allowed name is caught (and rolled back).
begin;
create function public.login(p_username text, p_password text, p_code integer) returns void
language plpgsql security definer set search_path = public, extensions as $$ begin end $$;
grant execute on function public.login(text, text, integer) to anon;
do $$
begin
  assert pg_temp.unguarded() = 'login(text,text,integer)', format('an overload of login: %s', pg_temp.unguarded());
end $$;
rollback;

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from every guarded game RPC,
--    and the reads still answer. 3. Unlocked but from a page older than the minimum build (0064): 'client outdated'
--    (hint 'build', the minimum) from every one of them.
create temp table guards (k text primary key, v text);
insert into guards select 't', token from public.register('guard_' || floor(random() * 1e9)::text, 'pw123456');
insert into guards select 'room', room_id::text from public.create_room('Guards', 'pw', (select v from guards where k = 't'));

create or replace function pg_temp.guard_err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || '|' || coalesce(v_hint, '') || '|' || case when v_detail ~ '^[0-9]+$' and v_msg = 'account locked' then 'seconds' else coalesce(v_detail, '') end;
end $$;

-- every guarded game RPC, one call each
create or replace function pg_temp.guarded_calls() returns text[] language plpgsql as $$
declare t text := (select v from guards where k = 't'); room uuid := (select v from guards where k = 'room')::uuid;
        o uuid := gen_random_uuid();
begin
  return array[
    -- fishing
    format('select public.claim_daily(%L)', t),
    format('select public.dig_worms(%L)', t),
    format('select public.buy_item(%L, %L, 1)', t, 'bait_shrimp'),
    format('select public.set_loadout(%L, %L, %L, %L)', t, 'rod_wood', 'bobber_feather', 'bait_worm'),
    format('select public.start_cast(%L, %L)', room, t),
    format('select public.hook_cast(%L, %L)', t, o),
    format('select public.finish_cast(%L, %L, true)', t, o),
    format('select public.start_net(%L, %L, 1, 1, %L)', room, t, 'net_small'),
    format('select public.net_haul(%L, %L, 1, %L)', t, o, '{0}'),
    format('select public.net_haul(%L, %L, 1, 2, 3, 4, 5)', t, o),
    format('select public.finish_net(%L, %L, 0)', t, o),
    format('select public.finish_net(%L, %L, %L, 1, 0)', t, o, '{}'),
    format('select public.sell_fish(%L, %L)', t, array[o]),
    format('select public.sell_fish_market(%L, %L)', t, array[o]),
    format('select public.release_fish(%L, %L)', t, o),
    format('select public.repair_rod(%L, %L)', t, 'rod_wood'),
    -- farm and land
    format('select public.rent_plot(%L, %L, 5)', room, t),
    format('select public.buy_plot(%L, %L, 1)', room, t),
    format('select public.sell_plot_to_village(%L, %L, 1)', room, t),
    format('select public.list_plot(%L, %L, 1, 9000)', room, t),
    format('select public.buy_listed_plot(%L, %L, 1, 9000)', room, t),
    format('select public.offer_plot(%L, %L, 1, 5000)', room, t),
    format('select public.withdraw_offer(%L, %L, %L)', room, t, o),
    format('select public.decline_offer(%L, %L, %L)', room, t, o),
    format('select public.accept_offer(%L, %L, %L)', room, t, o),
    format('select public.set_sublease(%L, %L, 1, 300)', room, t),
    format('select public.rent_sublease(%L, %L, 1, 300)', room, t),
    format('select public.abandon_crop(%L, %L, 5)', room, t),
    format('select public.prepare_plot(%L, %L, 5)', room, t),
    format('select public.apply_fertilizer(%L, %L, 5, %L)', room, t, 'fert_urea'),
    format('select public.soak_seed(%L, %L, 5, %L)', room, t, 'seed_short'),
    format('select public.sow_seed(%L, %L, 5)', room, t),
    format('select public.begin_work(%L, %L, 5, %L)', room, t, 'transplant'),
    format('select public.transplant(%L, %L, 5, 1)', room, t),
    format('select public.water(%L, %L, 5, 1)', room, t),
    format('select public.spray(%L, %L, 5, %L)', room, t, 'spray_insect'),
    format('select public.pick_snails(%L, %L, 5)', room, t),
    format('select public.harvest(%L, %L, 5, 1)', room, t),
    format('select public.dry_start(%L, %L, %L, 10)', room, t, 'short'),
    format('select public.dry_collect(%L, %L, 1)', room, t),
    format('select public.sell_rice(%L, %L, true, 1)', t, 'short'),
    format('select public.sell_rice_market(%L, %L, true, 1)', t, 'short'),
    format('select public.buy_farm_item(%L, %L, 1)', t, 'fert_urea'),
    format('select public.claim_farm_gift(%L)', t),
    format('select public.harvest_part(%L, %L, 5, true)', room, t),
    format('select public.harvest_part(%L, %L, 5, %L, 10, true)', room, t, '{}'),
    format('select public.rent_harvester(%L, %L, 5)', room, t),
    format('select public.load_sprayer(%L, %L)', t, 'spray_insect'),
    format('select public.sell_produce(%L, %L, 1)', t, 'khoai'),
    format('select public.sell_produce_market(%L, %L, 1)', t, 'khoai'),
    format('select public.prepare_beds(%L, %L, 5)', room, t),
    format('select public.plant_crop(%L, %L, 5, %L)', room, t, 'seed_bap'),
    format('select public.tend_crop(%L, %L, 5, %L)', room, t, 'vun_goc'),
    -- the card tables
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, t, 'tienlen'),
    format('select public.tl_play(%L, %L, 0, array[0])', room, t),
    format('select public.tl_pass(%L, %L, 0)', room, t),
    format('select public.cao_deal(%L, %L, 0)', room, t),
    format('select public.pk_act(%L, %L, 0, %L, null)', room, t, 'fold'),
    format('select public.pk_topup(%L, %L, 1000)', room, t),
    format('select public.xidach_deal(%L, %L, 0)', room, t),
    format('select public.xidach_hit(%L, %L, 0)', room, t),
    format('select public.xidach_stand(%L, %L, 0)', room, t),
    format('select public.xidach_ready(%L, %L, 0)', room, t),
    format('select public.xidach_inspect(%L, %L, 0, 1)', room, t),
    -- crabs, snails, rats and the dog
    format('select public.crab_start(%L, %L, 1)', room, t),
    format('select public.crab_finish(%L, %L, %L, 1)', room, t, o),
    format('select public.crab_finish(%L, %L, %L, %L, 10, 0)', room, t, o, '{}'),
    format('select public.pick_snail_bed(%L, %L, 1)', room, t),
    format('select public.sell_critters(%L, null)', t),
    format('select public.sling_start(%L, %L, 1)', room, t),
    format('select public.sling_start(%L, %L, 1, 100, 100)', room, t),
    format('select public.sling_shoot(%L, %L, 1, true)', room, t),
    format('select public.sling_shoot(%L, %L, 1, 1, 40, 100000, false)', room, t),
    format('select public.dog_hunt(%L, %L, 1)', room, t),
    format('select public.adopt_dog(%L, %L, %L)', t, 'Ki', 'vang'),
    format('select public.rename_dog(%L, %L)', t, 'Ki'),
    format('select public.feed_dog(%L)', t),
    format('select public.sell_rats(%L)', t),
    -- the dojo and the ring
    format('select public.dojo_exam_start(%L, %L)', t, 'vovinam'),
    format('select public.dojo_kata_submit(%L, %L, %L)', t, o, '{}'),
    format('select public.ring_take(%L, %L, 1, %L)', room, t, 'red'),
    format('select public.ring_offer(%L, %L, 1, 100, 0)', room, t),
    format('select public.ring_accept(%L, %L, 1, 100, 0)', room, t),
    -- the pet's heartbeat (0066)
    format('select public.pet_tick(%L)', t),
    format('select public.pet_tick(%L, %L)', t, room)];
end $$;

insert into public.anticheat_status (account_id, locked_until)
values (public._auth_account((select v from guards where k = 't')), now() + interval '5 minutes')
on conflict (account_id) do update set locked_until = excluded.locked_until;

do $$
declare t text := (select v from guards where k = 't'); room uuid := (select v from guards where k = 'room')::uuid;
        call text; e text; n int := 0;
begin
  foreach call in array pg_temp.guarded_calls() loop
    n := n + 1;
    e := pg_temp.guard_err(call);
    assert e = 'account locked|anticheat|seconds', format('%s → %s', call, e);
  end loop;
  assert n = 85, format('%s guarded calls', n);
  perform public.fishing_state(t);
  perform public.fishing_board(room, t);
  perform public.field_state(room, t);
  perform public.touch_room(room, t);
  perform public.card_lobby(room, t);
  perform public.card_state(room, t, 'tienlen');
  perform public.card_hand(room, t, 'tienlen');
  perform public.card_tick(room, t, 'tienlen');
  perform public.dog_state(t);
  perform public.pets_state(t);
end $$;

-- 3. the minimum build
update public.anticheat_status set locked_until = null where account_id = public._auth_account((select v from guards where k = 't'));
update public.anticheat_config set min_client_build = 202609280000;
select set_config('request.headers', '{"x-client-info": "music-together/202609271200-old0000"}', false);
do $$
declare call text; e text;
begin
  foreach call in array pg_temp.guarded_calls() loop
    e := pg_temp.guard_err(call);
    assert e = 'client outdated|build|202609280000', format('%s → %s', call, e);
  end loop;
  perform public.fishing_state((select v from guards where k = 't'));
end $$;
update public.anticheat_config set min_client_build = 0;
select set_config('request.headers', '', false);

select 'anticheat guards ok' as result;
