-- tests/sql/anticheat-guards.sql — the guard regression (anti-cheat spec §15.1, R23). Self-contained: run it as the
-- superuser on the throwaway PostgreSQL cluster after 0015 and after every later migration (anticheat-smoke.sql ends
-- with it). A new game RPC that does not call _ac_account or _ac_play fails the static check until it is guarded or,
-- when it is not a game action, put on the allowlist below; a new guarded RPC joins the dynamic loop.
\set ON_ERROR_STOP on

-- 1. Static, deny by default: every SECURITY DEFINER function in public that anon may execute is on the allowlist or
--    calls the lock gate.
do $$
declare bad text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname) into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (
       'register', 'login', 'me', 'logout',
       'create_room', 'join_room', 'rename_room', 'kick_member', 'assign_dj', 'transfer_admin', 'set_play_mode',
       'update_room_settings', 'touch_room',
       'add_queue_item', 'add_queue_items', 'advance_queue', 'set_playback', 'seek_playback', 'reorder_item', 'bump_to_top',
       'delete_item', 'approve_queue_item', 'approve_all_pending', 'reject_queue_item',
       'send_chat_message', 'delete_chat_message',
       'submit_feedback', 'list_feedback', 'set_feedback_status', 'delete_feedback',
       'admin_list_rooms', 'admin_delete_room', 'admin_list_accounts', 'admin_set_ban', 'admin_delete_account', 'admin_stats',
       'admin_anticheat_list', 'admin_anticheat_account', 'admin_anticheat_resolve', 'admin_anticheat_set_mode',
       'save_character', 'upsert_video_lyrics', 'update_video_lyric_offset',
       'fishing_state', 'fishing_board', 'field_state')
     and p.prosrc !~ '_ac_(account|play)\(';
  assert bad is null, 'unguarded: ' || bad;
end $$;

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 35 game RPCs, and
--    the four reads still answer.
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
    format('select public.claim_farm_gift(%L)', t)] loop
    n := n + 1;
    e := pg_temp.guard_err(call);
    assert e = 'account locked|anticheat|seconds', format('%s → %s', call, e);
  end loop;
  assert n = 35, format('%s guarded calls', n);
  perform public.fishing_state(t);
  perform public.fishing_board(room, t);
  perform public.field_state(room, t);
  perform public.touch_room(room, t);
end $$;

select 'anticheat guards ok' as result;
