-- =========================================================
-- 0058_pos_tabs.sql — anti-cheat v2, part 1 follow-up: two game windows of one account (docs/superpowers/plans/
-- 2026-09-28-anticheat-v2-part2.md, part T). ADDITIVE and re-runnable. Run after 0057.
--   A. player_pos.tab: the primary tab (the newest one); player_pos.tabs: each recent tab's own last accepted claim
--      ({tab: {m, x, y, at}}, at most 4, none older than an hour).
--   B. _pos_tab(): the page's tab id, from the X-Tab-Id request header every client request carries (lib/supabase.ts);
--      null for a caller without one (a page before 0058, the SQL smokes), which keeps 0057's rule.
--   C. _pos_claim (0057's): a claim from the primary tab, with no tab or the first ever is judged as before; a tab never
--      seen is the newest one — judged as before, and accepted it becomes the primary; a claim from an older known tab
--      is judged against that tab's own last claim: accepted, only its track moves; refused, the caller gets the
--      refusal envelope with strike 0 and nothing is logged or counted (no pos_teleport, no step to the hard repeat).
-- =========================================================

-- ---------- A. The tabs ----------
alter table public.player_pos add column if not exists tab text;
alter table public.player_pos add column if not exists tabs jsonb not null default '{}'::jsonb;

-- ---------- B. The tab of this request ----------
create or replace function public._pos_tab() returns text
language plpgsql stable
as $$
declare v text;
begin
  begin
    v := left(nullif(trim(nullif(current_setting('request.headers', true), '')::json->>'x-tab-id'), ''), 64);
  exception when others then
    v := null;
  end;
  return v;
end $$;
revoke all on function public._pos_tab() from public, anon, authenticated;

-- The tabs with p_tab's claim (p_map, p_x, p_y) now: the others an hour old or more dropped, the newest 4 kept.
create or replace function public._pos_tabs(p_tabs jsonb, p_tab text, p_map text, p_x integer, p_y integer) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from (select k, v from jsonb_each(coalesce(p_tabs, '{}'::jsonb) - p_tab
                                      || jsonb_build_object(p_tab, jsonb_build_object('m', p_map, 'x', p_x, 'y', p_y, 'at', now()))) e(k, v)
           where (v->>'at')::timestamptz > now() - interval '1 hour'
           order by k = p_tab desc, (v->>'at')::timestamptz desc, k
           limit 4) x
$$;
revoke all on function public._pos_tabs(jsonb, text, text, integer, integer) from public, anon, authenticated;

-- ---------- C. _pos_claim (0057's, verbatim but for the lines marked 0058) ----------
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
revoke all on function public._pos_claim(uuid, text, integer, integer, text, uuid, text) from public, anon, authenticated;
