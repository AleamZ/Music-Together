-- =========================================================
-- 0064_client_build.sql — anti-cheat v2, part 3 (docs/superpowers/plans/2026-09-28-anticheat-v2-part3.md, part M): the
-- minimum client build. ADDITIVE and re-runnable. Run after 0063.
--   A. anticheat_config: min_client_build (0 = off) and the part-3 switches (auto_blacklist on with 8 hard events,
--      the statistics every 15 minutes); anticheat_status.blacklist_cleared_at (the last manual unblacklist).
--   B. _client_build(): the 12 leading digits of the build in X-Client-Info ('music-together/202609281530-abc1234'),
--      0 without one (none, 'dev', a bare commit of a build before part 3).
--   C. _ac_guard (0015's): a game RPC from a build older than the minimum raises 'client outdated' (hint 'build', detail
--      the minimum) — every _ac_account / _ac_play RPC inherits it.
--   D. admin_anticheat_config(token, patch): root reads and sets the switches.
--   E. Grant hygiene: 0021's _xidach_start / _xidach_due were executable by anon (a round with a chosen deck).
-- =========================================================

-- ---------- A. The switches ----------
alter table public.anticheat_config add column if not exists min_client_build bigint not null default 0;
alter table public.anticheat_config add column if not exists auto_blacklist boolean not null default true;
alter table public.anticheat_config add column if not exists auto_blacklist_hard integer not null default 8;
alter table public.anticheat_config add column if not exists stats_enabled boolean not null default true;
alter table public.anticheat_config add column if not exists stats_every_min integer not null default 15;
alter table public.anticheat_config drop constraint if exists anticheat_config_part3_check;
alter table public.anticheat_config add constraint anticheat_config_part3_check
  check (min_client_build between 0 and 999999999999 and auto_blacklist_hard between 3 and 1000
         and stats_every_min between 1 and 1440);
alter table public.anticheat_status add column if not exists blacklist_cleared_at timestamptz;

-- ---------- B. The caller's build ----------
create or replace function public._client_build() returns bigint
language plpgsql stable set search_path = public, extensions
as $$
declare v_h json; v_m text[];
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return 0;
  end;
  v_m := regexp_match(coalesce(v_h->>'x-client-info', ''), '^music-together/([0-9]{12})');
  return coalesce(v_m[1]::bigint, 0);
end $$;
revoke all on function public._client_build() from public, anon, authenticated;

-- ---------- C. The lock gate (0015's, verbatim but for the lines marked 0064) ----------
create or replace function public._ac_guard(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_until timestamptz;
        v_min bigint;                                                                     -- 0064
begin
  select locked_until into v_until from public.anticheat_status where account_id = p_account;
  if v_until > now() then
    raise exception 'account locked' using errcode = '42501', hint = 'anticheat',
      detail = ceil(extract(epoch from (v_until - now())))::int::text;
  end if;
  -- 0064 {
  -- a page older than the minimum build earns nothing: 'Cập nhật trang'
  select min_client_build into v_min from public.anticheat_config where id;
  if coalesce(v_min, 0) > 0 and public._client_build() < v_min then
    raise exception 'client outdated' using errcode = '22023', hint = 'build', detail = v_min::text;
  end if;
  -- 0064 }
end $$;
revoke all on function public._ac_guard(uuid) from public, anon, authenticated;

-- ---------- D. Admin ----------
create or replace function public._ac_config_json() returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('mode', c.mode, 'min_client_build', c.min_client_build, 'auto_blacklist', c.auto_blacklist,
                            'auto_blacklist_hard', c.auto_blacklist_hard, 'stats_enabled', c.stats_enabled,
                            'stats_every_min', c.stats_every_min, 'server_build', public._client_build())
    from public.anticheat_config c where c.id
$$;
revoke all on function public._ac_config_json() from public, anon, authenticated;

-- A patch of the switches (unknown keys are ignored; a wrong value raises 'invalid config').
create or replace function public.admin_anticheat_config(p_session_token text, p_patch jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); p jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  begin
    update public.anticheat_config set
      min_client_build = coalesce((p->>'min_client_build')::bigint, min_client_build),
      auto_blacklist = coalesce((p->>'auto_blacklist')::boolean, auto_blacklist),
      auto_blacklist_hard = coalesce((p->>'auto_blacklist_hard')::integer, auto_blacklist_hard),
      stats_enabled = coalesce((p->>'stats_enabled')::boolean, stats_enabled),
      stats_every_min = coalesce((p->>'stats_every_min')::integer, stats_every_min)
     where id;
  exception when invalid_text_representation or check_violation or numeric_value_out_of_range then
    raise exception 'invalid config' using errcode = '22023';
  end;
  return public._ac_config_json();
end $$;
revoke all on function public.admin_anticheat_config(text, jsonb) from public;
grant execute on function public.admin_anticheat_config(text, jsonb) to anon, authenticated;

-- ---------- E. Grant hygiene ----------
-- 0021 never revoked its two private helpers: anyone could start a xì dách round with a deck of their choosing.
revoke all on function public._xidach_start(uuid, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._xidach_due(uuid, timestamptz, integer[]) from public, anon, authenticated;
