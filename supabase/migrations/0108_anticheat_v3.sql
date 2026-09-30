-- =========================================================
-- 0108_anticheat_v3.sql — anti-cheat v3 (owner's report 2026-09-30: a page edited in the browser to widen the reel's
-- zone). ADDITIVE and re-runnable. Run after 0107.
--   A. The client's word on what it simulated: finish_cast gains a 7-argument form with p_client
--      ({zone_pct, difficulty, min_reel_ms} the reel overlay really used). It is compared with the cast's stored params
--      (0046) before anything else; a difference is the hard client_tamper, and the cast is lost (reel_invalid) even
--      when the reel itself was lost — the replay (0046) already refused the win, this catches the attempt. Without
--      p_client (a page before 0108) the 6-argument form answers as before.
--   B. A per-account call budget in _ac_guard (every _ac_account / _ac_play RPC): calls per minute past
--      anticheat_config.rate_soft_per_min log the soft rate_high (once a minute); at rate_block_per_min the call
--      raises 'rate limited' (53400) until the minute is over. _ac_guard becomes volatile (it writes the counter).
--   C. market_list / auction_create take the wallet lock before the reserved sum: two parallel calls could list the
--      same asset twice (never a duplicate — _econ_move re-checks — but a stale listing and a wasted fee).
--   D. admin_anticheat_config reads the two budget knobs too (patch keys rate_soft_per_min, rate_block_per_min).
-- =========================================================

-- ---------- B. The budget ----------
alter table public.anticheat_config add column if not exists rate_soft_per_min integer not null default 900;
alter table public.anticheat_config add column if not exists rate_block_per_min integer not null default 1200;
alter table public.anticheat_config drop constraint if exists anticheat_config_rate_check;
alter table public.anticheat_config add constraint anticheat_config_rate_check
  check (rate_soft_per_min between 60 and 100000 and rate_block_per_min between rate_soft_per_min and 200000);

create table if not exists public.ac_rate (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  win_at timestamptz not null default now(),        -- the minute being counted started here
  calls integer not null default 0,
  flagged_at timestamptz                            -- the last rate_high / rate_block written
);
alter table public.ac_rate enable row level security;
revoke all on public.ac_rate from anon, authenticated;

create or replace function public._ac_rate(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.ac_rate; c public.anticheat_config;
begin
  if p_account is null then return; end if;
  select * into c from public.anticheat_config where id;
  insert into public.ac_rate as x (account_id, calls) values (p_account, 1)
  on conflict (account_id) do update
    set calls = case when x.win_at <= now() - interval '1 minute' then 1 else x.calls + 1 end,
        win_at = case when x.win_at <= now() - interval '1 minute' then now() else x.win_at end
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
end $$;
revoke all on function public._ac_rate(uuid) from public, anon, authenticated;

-- _ac_guard (0064's, verbatim but for the lines marked 0108; volatile now: it writes the budget)
create or replace function public._ac_guard(p_account uuid) returns void
language plpgsql volatile security definer set search_path = public, extensions  -- 0108 was: language plpgsql stable security definer set search_path = public, extensions
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
  perform public._ac_rate(p_account);                                                     -- 0108
end $$;
revoke all on function public._ac_guard(uuid) from public, anon, authenticated;

-- ---------- A. finish_cast with the client's word ----------
-- The overlay's params against the cast's: {zone_pct, difficulty, min_reel_ms}; null when they agree (or the claim is
-- incomplete), else the differing keys.
create or replace function public._reel_claim_diff(p_params jsonb, p_claim jsonb) returns jsonb
language sql immutable
as $$
  select case
    when p_params is null or p_claim is null or jsonb_typeof(p_claim) <> 'object'
      or not (p_claim ? 'zone_pct' and p_claim ? 'difficulty' and p_claim ? 'min_reel_ms') then null
    else nullif(coalesce((select jsonb_object_agg(k, jsonb_build_object('server', p_params->k, 'client', p_claim->k))
                            from unnest(array['zone_pct', 'difficulty', 'min_reel_ms']) k
                           where jsonb_typeof(p_claim->k) <> 'number'
                              or (p_claim->>k)::numeric is distinct from (p_params->>k)::numeric), '{}'::jsonb), '{}'::jsonb)
  end
$$;
revoke all on function public._reel_claim_diff(jsonb, jsonb) from public, anon, authenticated;

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
revoke all on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer, jsonb) from public;
grant execute on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer, jsonb) to anon, authenticated;

-- ---------- C. One listing per asset ----------
-- market_list / auction_create (0073's, verbatim but for the line marked 0108)
CREATE OR REPLACE FUNCTION public.market_list(p_session_token text, p_kind text, p_ref text, p_qty integer, p_price integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
declare v_account uuid := public._ac_account(p_session_token); v_value integer; v_fee integer; v_id bigint;
begin
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce') then raise exception 'bad kind' using errcode = '22023'; end if;
  perform public._econ_can_list(v_account);
  perform public._wallet_lock(v_account);                                                  -- 0108: before the reserved sum
  v_value := public._econ_value(v_account, p_kind, p_ref, p_qty, public._econ_reserved(v_account, p_kind, p_ref));
  if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
  if not public._econ_in_band(p_price, v_value) then raise exception 'bad price' using errcode = '22023'; end if;
  v_fee := public._econ_list_fee(p_price);
  perform public._wallet_lock(v_account);
  if coalesce((select coins from public.wallets where account_id = v_account), 0) < v_fee then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  insert into public.econ_listings (seller, asset_kind, asset_ref, qty, name, value, price, fee, expires_at)
  values (v_account, p_kind, p_ref, p_qty, public._econ_name(p_kind, p_ref, p_qty), v_value, p_price, v_fee,
          now() + make_interval(hours => public._econ_rule('list_hours')))
  returning id into v_id;
  perform public._pay(v_account, -v_fee, 'market_list', 'market #' || v_id);
  return public._econ_json(v_account);
end $$;
revoke all on function public.market_list(text, text, text, integer, integer) from public;
grant execute on function public.market_list(text, text, text, integer, integer) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.auction_create(p_session_token text, p_kind text, p_ref text, p_qty integer, p_start integer, p_hours integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
declare v_account uuid := public._ac_account(p_session_token); v_value integer;
begin
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce') then raise exception 'bad kind' using errcode = '22023'; end if;
  if p_hours is null or p_hours not in (1, 6, 12, 24) then raise exception 'bad hours' using errcode = '22023'; end if;
  perform public._econ_can_list(v_account);
  perform public._wallet_lock(v_account);                                                  -- 0108: before the reserved sum
  v_value := public._econ_value(v_account, p_kind, p_ref, p_qty, public._econ_reserved(v_account, p_kind, p_ref));
  if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
  if v_value < public._econ_rule('auc_value') then raise exception 'not rare' using errcode = '53400'; end if;
  if not public._econ_in_band(p_start, v_value) then raise exception 'bad price' using errcode = '22023'; end if;
  insert into public.econ_auctions (seller, asset_kind, asset_ref, qty, name, value, start_price, ends_at)
  values (v_account, p_kind, p_ref, p_qty, public._econ_name(p_kind, p_ref, p_qty), v_value, p_start,
          now() + make_interval(hours => p_hours));
  return public._econ_json(v_account);
end $$;
revoke all on function public.auction_create(text, text, text, integer, integer, integer) from public;
grant execute on function public.auction_create(text, text, text, integer, integer, integer) to anon, authenticated;

-- ---------- D. Admin ----------
-- _ac_config_json / admin_anticheat_config (0064's, verbatim but for the lines marked 0108)
create or replace function public._ac_config_json() returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('mode', c.mode, 'min_client_build', c.min_client_build, 'auto_blacklist', c.auto_blacklist,
                            'auto_blacklist_hard', c.auto_blacklist_hard, 'stats_enabled', c.stats_enabled,
                            'stats_every_min', c.stats_every_min, 'server_build', public._client_build(),
                            'rate_soft_per_min', c.rate_soft_per_min, 'rate_block_per_min', c.rate_block_per_min)   -- 0108
    from public.anticheat_config c where c.id
$$;
revoke all on function public._ac_config_json() from public, anon, authenticated;

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
      stats_every_min = coalesce((p->>'stats_every_min')::integer, stats_every_min),
      rate_soft_per_min = coalesce((p->>'rate_soft_per_min')::integer, rate_soft_per_min),                 -- 0108
      rate_block_per_min = coalesce((p->>'rate_block_per_min')::integer, rate_block_per_min)               -- 0108
     where id;
  exception when invalid_text_representation or check_violation or numeric_value_out_of_range then
    raise exception 'invalid config' using errcode = '22023';
  end;
  return public._ac_config_json();
end $$;
revoke all on function public.admin_anticheat_config(text, jsonb) from public;
grant execute on function public.admin_anticheat_config(text, jsonb) to anon, authenticated;
