-- =========================================================
-- 0109_bot_score.sql — anti-cheat v3, part 2: a silent bot score (owner 2026-09-30: nothing a player has to solve, no
-- captcha). ADDITIVE and re-runnable. Run after 0108.
--   A. ac_rate (0108) also tracks the play session (active_since: calls with no gap of 15 minutes) and ac_hours the hours
--      an account was active in (one row per clock hour, 3 days kept).
--   B. _ac_bot_score(account), at most every 10 minutes from _ac_rate: the day's signals —
--        session  ≥ 6 h without a 15-minute break +2, ≥ 10 h +4;
--        hours    active in ≥ 16 of the last 24 clock hours +2, ≥ 20 +4;
--        timing   soft reel_timing / stat_outlier events in 24 h: ≥ 3 +2, ≥ 10 +3;
--        rate     soft rate_high events in 24 h ≥ 3 +1;
--        silent   no chat line in 7 days while active ≥ 8 of the last 24 hours +1.
--      score ≥ bot_soft (6) keeps bot_soft_pct (50 %) of the game's income, ≥ bot_hard (9) keeps bot_hard_pct (20 %);
--      below, 100 %. Nothing is shown to the player; a soft bot_score event (once a day) tells the admin.
--   C. _pay (0012's, verbatim but for the lines marked 0109): a positive delta whose reason is a game faucet
--      (_ac_faucet_reasons: NPC sales, rewards, finds — never a refund, a trade, a stake or a P2P win) is scaled by the
--      account's keep_pct (at least 1 xu). Root accounts and accounts the admin cleared (7 days) are never scaled.
--   D. Admin (root): admin_bot_list (scored accounts, highest first), admin_bot_clear (exempt 7 days);
--      admin_anticheat_config reads / sets bot_enabled, bot_soft, bot_hard, bot_soft_pct, bot_hard_pct.
-- =========================================================

-- ---------- The switches ----------
alter table public.anticheat_config add column if not exists bot_enabled boolean not null default true;
alter table public.anticheat_config add column if not exists bot_soft integer not null default 6;
alter table public.anticheat_config add column if not exists bot_hard integer not null default 9;
alter table public.anticheat_config add column if not exists bot_soft_pct integer not null default 50;
alter table public.anticheat_config add column if not exists bot_hard_pct integer not null default 20;
alter table public.anticheat_config drop constraint if exists anticheat_config_bot_check;
alter table public.anticheat_config add constraint anticheat_config_bot_check
  check (bot_soft between 1 and 100 and bot_hard between bot_soft and 100
         and bot_soft_pct between 1 and 100 and bot_hard_pct between 1 and bot_soft_pct);

-- ---------- A. The session and the hours ----------
alter table public.ac_rate add column if not exists active_since timestamptz;
alter table public.ac_rate add column if not exists last_at timestamptz;
alter table public.ac_rate add column if not exists hour_mark timestamptz;
alter table public.ac_rate add column if not exists scored_at timestamptz;

create table if not exists public.ac_hours (
  account_id uuid not null references public.accounts(id) on delete cascade,
  hour timestamptz not null,
  primary key (account_id, hour)
);
alter table public.ac_hours enable row level security;
revoke all on public.ac_hours from anon, authenticated;

create table if not exists public.ac_bot (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  score integer not null default 0,
  signals jsonb not null default '{}'::jsonb,
  keep_pct integer not null default 100 check (keep_pct between 1 and 100),
  scored_at timestamptz not null default now(),
  evented_at timestamptz,                -- the last soft bot_score written
  exempt_until timestamptz,              -- root cleared it: never scaled until then
  cleared_by uuid
);
alter table public.ac_bot enable row level security;
revoke all on public.ac_bot from anon, authenticated;

-- ---------- B. The score ----------
create or replace function public._ac_bot_score(p_account uuid) returns public.ac_bot
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.anticheat_config; r public.ac_rate; v_s jsonb := '{}'::jsonb; v_score integer := 0; v_keep integer := 100;
        v_h numeric; v_hours integer; v_t integer; v_rate integer; b public.ac_bot; v_root boolean;
begin
  select * into c from public.anticheat_config where id;
  select * into r from public.ac_rate where account_id = p_account;
  select is_root into v_root from public.accounts where id = p_account;
  v_h := coalesce(extract(epoch from (r.last_at - r.active_since)) / 3600.0, 0);
  select count(*) into v_hours from public.ac_hours where account_id = p_account and hour > now() - interval '24 hours';
  select count(*) filter (where code in ('reel_timing', 'stat_outlier')), count(*) filter (where code = 'rate_high')
    into v_t, v_rate
    from public.anticheat_events where account_id = p_account and created_at > now() - interval '24 hours';
  if v_h >= 10 then v_score := v_score + 4; elsif v_h >= 6 then v_score := v_score + 2; end if;
  if v_hours >= 20 then v_score := v_score + 4; elsif v_hours >= 16 then v_score := v_score + 2; end if;
  if v_t >= 10 then v_score := v_score + 3; elsif v_t >= 3 then v_score := v_score + 2; end if;
  if v_rate >= 3 then v_score := v_score + 1; end if;
  if v_hours >= 8 and not exists (select 1 from public.chat_messages m where m.account_id = p_account and not m.system
                                    and m.created_at > now() - interval '7 days') then
    v_score := v_score + 1;
    v_s := v_s || '{"silent": true}';
  end if;
  v_s := v_s || jsonb_build_object('session_h', round(v_h, 1), 'hours_24', v_hours, 'timing', v_t, 'rate', v_rate);
  if coalesce(c.bot_enabled, false) and not coalesce(v_root, false) then
    v_keep := case when v_score >= c.bot_hard then c.bot_hard_pct when v_score >= c.bot_soft then c.bot_soft_pct else 100 end;
  end if;
  insert into public.ac_bot as x (account_id, score, signals, keep_pct, scored_at)
  values (p_account, v_score, v_s, v_keep, now())
  on conflict (account_id) do update set score = excluded.score, signals = excluded.signals, keep_pct = excluded.keep_pct,
                                         scored_at = excluded.scored_at
  returning * into b;
  if b.keep_pct < 100 and (b.exempt_until is null or b.exempt_until < now())
     and (b.evented_at is null or b.evented_at < now() - interval '24 hours') then
    update public.ac_bot set evented_at = now() where account_id = p_account;
    perform public._ac_flag(p_account, 'bot_score', 'bot', v_s || jsonb_build_object('score', v_score, 'keep_pct', v_keep),
              null, null, false);
  end if;
  return b;
end $$;
revoke all on function public._ac_bot_score(uuid) from public, anon, authenticated;

-- _ac_rate (0108's, verbatim but for the lines marked 0109)
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
  -- 0109 {
  -- the session (no gap of 15 minutes), the clock hour, and the score every 10 minutes
  update public.ac_rate
     set active_since = case when last_at is null or last_at < now() - interval '15 minutes' then now() else active_since end,
         last_at = now()
   where account_id = p_account;
  if r.hour_mark is distinct from date_trunc('hour', now()) then
    update public.ac_rate set hour_mark = date_trunc('hour', now()) where account_id = p_account;
    insert into public.ac_hours (account_id, hour) values (p_account, date_trunc('hour', now())) on conflict do nothing;
    delete from public.ac_hours where account_id = p_account and hour < now() - interval '3 days';
  end if;
  if r.scored_at is null or r.scored_at < now() - interval '10 minutes' then
    update public.ac_rate set scored_at = now() where account_id = p_account;
    perform public._ac_bot_score(p_account);
  end if;
  -- 0109 }
end $$;
revoke all on function public._ac_rate(uuid) from public, anon, authenticated;

-- ---------- C. The income ----------
-- The game's faucets: xu the village creates (NPC sales, rewards, finds). Refunds, trades, stakes and P2P wins move xu
-- between players and are never scaled.
create or replace function public._ac_faucet_reasons() returns text[]
language sql immutable parallel safe
as $$ select array['daily', 'song', 'sell', 'rice_sell', 'produce_sell', 'critter_sell', 'rat_sell', 'pet_find',
                    'login_reward', 'level_reward', 'quest_reward', 'achievement_reward', 'collection_reward', 'ore_sell',
                    'gem_sell', 'boss_reward', 'dungeon_reward', 'wild_sell', 'treasure', 'wood_sell', 'dish_sell'] $$;   -- not pet_battle: it carries PvP pots and refunds
revoke all on function public._ac_faucet_reasons() from public, anon, authenticated;

-- The share of a faucet the account keeps (100 unless scored, not cleared and not root).
create or replace function public._ac_keep_pct(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select b.keep_pct from public.ac_bot b
                    where b.account_id = p_account and (b.exempt_until is null or b.exempt_until < now())
                      and b.scored_at > now() - interval '1 day'), 100)
$$;
revoke all on function public._ac_keep_pct(uuid) from public, anon, authenticated;

-- _pay (0012's, verbatim but for the lines marked 0109)
create or replace function public._pay(p_account uuid, p_delta integer, p_reason text, p_ref text) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_balance integer;
        v_keep integer;                                                                   -- 0109
begin
  -- 0109 {
  if p_delta > 1 and p_reason = any (public._ac_faucet_reasons())
     and not (p_reason = 'sell' and (p_ref like 'vehicle:%' or p_ref like 'fashion:%')) then   -- buy-backs are refunds
    v_keep := public._ac_keep_pct(p_account);
    if v_keep < 100 then p_delta := greatest(1, (p_delta * v_keep) / 100); end if;
  end if;
  -- 0109 }
  update public.wallets set coins = coins + p_delta where account_id = p_account returning coins into v_balance;
  insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, p_delta, v_balance, p_reason, p_ref);
  return v_balance;
end; $$;
revoke all on function public._pay(uuid, integer, text, text) from public, anon, authenticated;

-- ---------- D. Admin ----------
create or replace function public.admin_bot_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('account_id', b.account_id, 'username', a.username, 'score', b.score,
                                                       'signals', b.signals, 'keep_pct', b.keep_pct, 'scored_at', b.scored_at,
                                                       'exempt_until', b.exempt_until) order by b.score desc, b.scored_at desc)
                     from (select * from public.ac_bot where score > 0 and scored_at > now() - interval '3 days'
                            order by score desc, scored_at desc limit 100) b
                     join public.accounts a on a.id = b.account_id), '[]'::jsonb);
end $$;
revoke all on function public.admin_bot_list(text) from public;
grant execute on function public.admin_bot_list(text) to anon, authenticated;

create or replace function public.admin_bot_clear(p_session_token text, p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token);
begin
  update public.ac_bot set exempt_until = now() + interval '7 days', cleared_by = v_root where account_id = p_account_id;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  return public.admin_bot_list(p_session_token);
end $$;
revoke all on function public.admin_bot_clear(text, uuid) from public;
grant execute on function public.admin_bot_clear(text, uuid) to anon, authenticated;

-- _ac_config_json / admin_anticheat_config (0108's, verbatim but for the lines marked 0109)
create or replace function public._ac_config_json() returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('mode', c.mode, 'min_client_build', c.min_client_build, 'auto_blacklist', c.auto_blacklist,
                            'auto_blacklist_hard', c.auto_blacklist_hard, 'stats_enabled', c.stats_enabled,
                            'stats_every_min', c.stats_every_min, 'server_build', public._client_build(),
                            'rate_soft_per_min', c.rate_soft_per_min, 'rate_block_per_min', c.rate_block_per_min)   -- 0108
         || jsonb_build_object('bot_enabled', c.bot_enabled, 'bot_soft', c.bot_soft, 'bot_hard', c.bot_hard,       -- 0109
                               'bot_soft_pct', c.bot_soft_pct, 'bot_hard_pct', c.bot_hard_pct)                     -- 0109
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
      rate_block_per_min = coalesce((p->>'rate_block_per_min')::integer, rate_block_per_min),              -- 0109: a comma
      bot_enabled = coalesce((p->>'bot_enabled')::boolean, bot_enabled),                                   -- 0109
      bot_soft = coalesce((p->>'bot_soft')::integer, bot_soft),                                            -- 0109
      bot_hard = coalesce((p->>'bot_hard')::integer, bot_hard),                                            -- 0109
      bot_soft_pct = coalesce((p->>'bot_soft_pct')::integer, bot_soft_pct),                                -- 0109
      bot_hard_pct = coalesce((p->>'bot_hard_pct')::integer, bot_hard_pct)                                 -- 0109
     where id;
  exception when invalid_text_representation or check_violation or numeric_value_out_of_range then
    raise exception 'invalid config' using errcode = '22023';
  end;
  return public._ac_config_json();
end $$;
revoke all on function public.admin_anticheat_config(text, jsonb) from public;
grant execute on function public.admin_anticheat_config(text, jsonb) to anon, authenticated;
