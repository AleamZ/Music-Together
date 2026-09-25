-- tests/sql/anticheat-guards.sql — the guard regression (anti-cheat spec §15.1, R23). Self-contained: run it as the
-- superuser on the throwaway PostgreSQL cluster after 0015 and after every later migration (anticheat-smoke.sql ends
-- with it). A new game RPC that does not call _ac_account or _ac_play fails the static check until it is guarded or,
-- when it is not a game action, put on the allowlist below by its signature; a new guarded RPC joins the dynamic loop.
\set ON_ERROR_STOP on

-- 1. Static, deny by default: every SECURITY DEFINER function in public that anon may execute is on the allowlist or
--    calls the lock gate. The allowlist names signatures (oid::regprocedure), so a new overload of an allowed name is
--    not allowed by that name. The lyrics RPCs are allowed in their 0011 and their 0014 form (0015 does not need 0014).
create or replace function pg_temp.unguarded() returns text language sql as $$
  select string_agg(f.sig, ', ' order by f.sig)
    from (select regexp_replace(p.oid::regprocedure::text, '^public\.', '') as sig
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
             and p.prosrc !~ '_ac_(account|play)\(') f
   where f.sig not in (
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
     'admin_list_rooms(text)', 'admin_delete_room(text,uuid)', 'admin_list_accounts(text)', 'admin_set_ban(text,uuid,boolean)',
     'admin_delete_account(text,uuid)', 'admin_stats(text)',
     'admin_anticheat_list(text)', 'admin_anticheat_account(text,uuid)', 'admin_anticheat_resolve(text,uuid,text)',
     'admin_anticheat_set_mode(text,text)',
     'save_character(text,text,text,text,text,text,text,text,text)',
     'upsert_video_lyrics(uuid,text,text,text,text,text,text,integer,text)', 'update_video_lyric_offset(uuid,text,text,integer)',
     'upsert_video_lyrics(text,text,text,text,text,integer,text,text)', 'update_video_lyric_offset(text,integer,text)',
     'fishing_state(text)', 'fishing_board(uuid,text)', 'field_state(uuid,text)',
     'card_lobby(uuid,text)', 'card_state(uuid,text,text)', 'card_hand(uuid,text,text)', 'card_tick(uuid,text,text)',
     'card_leave(uuid,text,text)')
$$;

do $$
begin
  assert pg_temp.unguarded() is null, 'unguarded: ' || pg_temp.unguarded();
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
--    and the reads still answer.
create temp table guards (k text primary key, v text);
insert into guards select 't', token from public.register('guard_' || floor(random() * 1e9)::text, 'pw123456');
insert into guards select 'room', room_id::text from public.create_room('Guards', 'pw', (select v from guards where k = 't'));
insert into public.anticheat_status (account_id, locked_until)
values (public._auth_account((select v from guards where k = 't')), now() + interval '5 minutes')
on conflict (account_id) do update set locked_until = excluded.locked_until;

create or replace function pg_temp.guard_err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || '|' || coalesce(v_hint, '') || '|' || case when v_detail ~ '^[0-9]+$' then 'seconds' else coalesce(v_detail, '') end;
end $$;

do $$
declare t text := (select v from guards where k = 't'); room uuid := (select v from guards where k = 'room')::uuid;
        o uuid := gen_random_uuid(); call text; e text; n int := 0;
begin
  foreach call in array array[
    -- fishing (8)
    format('select public.claim_daily(%L)', t),
    format('select public.dig_worms(%L)', t),
    format('select public.buy_item(%L, %L, 1)', t, 'bait_shrimp'),
    format('select public.set_loadout(%L, %L, %L, %L)', t, 'rod_wood', 'bobber_feather', 'bait_worm'),
    format('select public.start_cast(%L, %L)', room, t),
    format('select public.finish_cast(%L, %L, true)', t, o),
    format('select public.sell_fish(%L, %L)', t, array[o]),
    format('select public.release_fish(%L, %L)', t, o),
    -- farm and land: the 24 room actions
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
    -- and the account-only three
    format('select public.sell_rice(%L, %L, true, 1)', t, 'short'),
    format('select public.buy_farm_item(%L, %L, 1)', t, 'fert_urea'),
    format('select public.claim_farm_gift(%L)', t),
    -- v15.2 (0016)
    format('select public.harvest_part(%L, %L, 5, true)', room, t),
    format('select public.rent_harvester(%L, %L, 5)', room, t),
    format('select public.load_sprayer(%L, %L)', t, 'spray_insect'),
    format('select public.sell_produce(%L, %L, 1)', t, 'khoai'),
    format('select public.prepare_beds(%L, %L, 5)', room, t),
    format('select public.plant_crop(%L, %L, 5, %L)', room, t, 'seed_bap'),
    format('select public.tend_crop(%L, %L, 5, %L)', room, t, 'vun_goc'),
    -- the card tables (v16)
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, t, 'tienlen'),
    format('select public.tl_play(%L, %L, 0, array[0])', room, t),
    format('select public.tl_pass(%L, %L, 0)', room, t),
    format('select public.cao_deal(%L, %L, 0)', room, t)] loop
    n := n + 1;
    e := pg_temp.guard_err(call);
    assert e = 'account locked|anticheat|seconds', format('%s → %s', call, e);
  end loop;
  assert n = 46, format('%s guarded calls', n);
  perform public.fishing_state(t);
  perform public.fishing_board(room, t);
  perform public.field_state(room, t);
  perform public.touch_room(room, t);
  perform public.card_lobby(room, t);
  perform public.card_state(room, t, 'tienlen');
  perform public.card_hand(room, t, 'tienlen');
  perform public.card_tick(room, t, 'tienlen');
end $$;

select 'anticheat guards ok' as result;
