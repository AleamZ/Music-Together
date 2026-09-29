-- 0091_dual_mode_fix.sql — the graphics switch of 0090 is lenient at most once per 5 minutes per account.
-- 0090 judged the first claim after a mode change by BOTH models (the more permissive wins). A hacked client alternating
-- pos_report_w / pos_report got that lenient check on every claim. Now:
--   A. player_pos.switch_at: when the account last used the lenient switch check.
--   B. _pos_claim: a mode change is lenient only if switch_at is null or older than 5 minutes (then switch_at = now());
--      otherwise the claim is judged by its new mode only, and a soft anti-cheat event 'pos_mode_switch' is logged
--      (no strike). An account without a stored mode switching to the world for the first time gets the lenient path
--      once, as before.
-- Idempotent. _pos_claim is 0090's, verbatim but for the lines marked 0091.

alter table public.player_pos add column if not exists switch_at timestamptz;   -- 0091

-- _pos_claim (0090_dual_mode.sql's, verbatim but for the lines marked 0091)
create or replace function public._pos_claim(p_account uuid, p_map text, p_x integer, p_y integer, p_rpc text,
                                             p_room uuid default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare pp public.player_pos; v_dt numeric; v_need numeric; v_why text; v_n integer; v_ac jsonb; v_road numeric;
        v_tab text := public._pos_tab(); v_old boolean; v_own jsonb;                     -- 0058
        v_world boolean;                                                                 -- 0090: this claim may use the world
        v_flag boolean := public._app_flag('unified_world');                             -- 0090
        v_mode text; v_prev text; v_switch boolean := false; v_m text; v_nm numeric;     -- 0090
        v_first boolean := true; v_saved text := current_setting('app.pos_world', true);  -- 0090
begin
  select * into pp from public.player_pos where account_id = p_account for update;
  -- 0090 {
  -- the claim's model: the world for pos_report_w, the portal graph for pos_report, else the one its tab last used
  v_prev := public._pos_mode_of(pp.tabs, pp.mode, v_tab);
  -- (an interior claimed by pos_report — the 3D client's too — keeps the mode it came with)
  v_mode := case when not v_flag then '2' when p_rpc = 'pos_report_w' then 'w'
                 when p_rpc = 'pos_report' and exists (select 1 from public._world_zones() z where z.zone = p_map) then '2'
                 else v_prev end;
  -- the first claim after a switch of graphics: judged by both, the more permissive wins
  v_switch := v_flag and pp.account_id is not null and v_prev <> v_mode;
  -- 0091 {
  -- lenient at most once per 5 minutes per account; a faster switch is judged by its new mode and logged (soft)
  if v_switch then
    if pp.switch_at is null or pp.switch_at <= now() - interval '5 minutes' then
      update public.player_pos set switch_at = now() where account_id = p_account;
    else
      v_switch := false;
      perform public._ac_flag(p_account, 'pos_mode_switch', p_rpc,
                jsonb_build_object('from', v_prev, 'to', v_mode, 'last_switch_at', pp.switch_at,
                                   'at', jsonb_build_object('map', left(p_map, 16), 'x', p_x, 'y', p_y)),
                p_room, p_error, false);
    end if;
  end if;
  -- 0091 }
  v_world := v_mode = 'w' or v_switch;
  -- 0090 }
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
     or not exists (select 1 from public._pos_maps() m where m.map = p_map and p_x between 0 and m.w and p_y between 0 and m.h)
     or (p_map = 'wild' and (not v_world                                                  -- 0088: the wild is only a map in the world
         or not exists (select 1 from public._world_to_zone(p_x, p_y) z where z.zone = 'wild'))) then   -- 0088: a zone owns its rect
    v_why := 'off_map';
  elsif pp.account_id is not null and not (p_map = 'hall' and abs(p_x - 612) <= 16 and abs(p_y - 300) <= 16)
        and not (v_world and public._pos_at_waypoint(p_account, p_map, p_x, p_y, pp.map, pp.x, pp.y, pp.at)) then  -- 0088: just travelled there
    v_dt := extract(epoch from now() - pp.at);
    -- 0090 {
    foreach v_m in array case when v_switch then array['w', '2'] else array[v_mode] end loop
      perform set_config('app.pos_world', case when v_m = 'w' then '1' else '0' end, true);
      v_road := public._pos_road_s(p_account, p_map, pp.at, pp.skip_at);
      v_nm := public._pos_need_s(pp.map, pp.x, pp.y, p_map, p_x, p_y, v_road);
      v_need := case when v_first then v_nm else least(v_need, v_nm) end;                -- least: a null (no path) loses
      v_first := false;
    end loop;
    perform set_config('app.pos_world', coalesce(v_saved, ''), true);                  -- back as it was
    -- 0090 }
    if v_need is null then v_why := 'no_path';
    elsif v_need > v_dt + 1 then v_why := 'too_fast';
    end if;
  end if;
  -- 0078 {
  -- a map the account's level has not unlocked (0070's map_levels): refused, not logged or counted (the client's
  -- portal gate normally stops it first); the position stays where it was
  -- 0088: the claimed map is the zone at the new point (map_levels has 'wild' at 1), so this is the zone's gate
  if v_why is null and p_map is distinct from pp.map and not public._map_unlocked(p_account, p_map) then
    return jsonb_build_object('anticheat', jsonb_build_object('code', 'pos_teleport', 'why', 'map_locked', 'strike', 0,
             'error', coalesce(p_error, 'map locked'), 'locked_until', null, 'banned', false, 'server_now', now()));
  end if;
  -- 0078 }
  if v_why is null then
    -- 0058 {
    if v_old then                                                                         -- only that tab's track moves
      update public.player_pos set tabs = public._pos_tabs_m(tabs, v_tab, p_map, p_x, p_y, v_mode)   -- 0090: + its mode
       where account_id = p_account;
      return null;
    end if;
    -- 0058 }
    insert into public.player_pos (account_id, map, x, y, at) values (p_account, p_map, p_x, p_y, now())   -- 0088: wx / wy by player_pos_world
    on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at;
    update public.player_pos set tab = coalesce(v_tab, tab),                                                            -- 0058
           tabs = case when v_tab is null then tabs else public._pos_tabs_m(tabs, v_tab, p_map, p_x, p_y, v_mode) end, -- 0058 (0090: + mode)
           mode = case when v_mode = 'w' then 'w' end                                                                  -- 0090
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
revoke all on function public._pos_claim(uuid, text, integer, integer, text, uuid, text) from public, anon, authenticated;
