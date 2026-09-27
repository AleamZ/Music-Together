-- =========================================================
-- 0039_motel.sql — v19.1 Nhà nghỉ + giấc ngủ (docs/superpowers/plans/2026-09-27-v19-1-motel.md,
-- spec docs/superpowers/specs/2026-09-27-v19-housing-design.md §19.1).
-- ADDITIVE and re-runnable. Run after 0038 (the ledger reasons).
--   A. Rules: _motel_price, _motel_len (lib/game/housing/motel.ts mirrors them; tests/unit/motel.test.ts pins them).
--   B. motel_stays (one rental per account: the plan and when it ends), rest_state (the last sleep's Vietnam day and
--      when the "Ngủ ngon" buff ends).
--   C. _rest_factor(uuid): 0.7 while the buff runs, else 1 (0040's vitals_tick multiplies the hunger and thirst drain).
--   D. RPCs motel_state, motel_rent (ledger 'motel'), motel_sleep.
--   E. The ledger: the 31 reasons of 0038 plus 'motel': 32.
-- Walking +7 % is applied by the client from rest.buff_until_ms (movement is client-side everywhere).
-- =========================================================

-- ---------- A. Rules ----------
-- Price (xu) of a plan: a night 100, a month 2000 (null: no such plan).
create or replace function public._motel_price(p_plan text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_plan when 'night' then 100 when 'month' then 2000 end $$;

-- How long a plan rents the room: a night is 24 h, a month 30 days.
create or replace function public._motel_len(p_plan text) returns interval
language sql immutable set search_path = public, extensions
as $$ select case p_plan when 'night' then interval '24 hours' when 'month' then interval '30 days' end $$;
revoke all on function public._motel_price(text) from public, anon, authenticated;
revoke all on function public._motel_len(text) from public, anon, authenticated;

-- ---------- B. Tables ----------
create table if not exists public.motel_stays (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  plan text not null check (plan in ('night','month')),   -- the last plan paid
  until timestamptz not null,                              -- the room is mine until then
  updated_at timestamptz not null default now()
);
alter table public.motel_stays enable row level security;
revoke all on public.motel_stays from anon, authenticated;

create table if not exists public.rest_state (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  slept_day date,                 -- the Vietnam day of the last sleep (one sleep per day)
  slept_at timestamptz,
  buff_until timestamptz          -- "Ngủ ngon" runs until then
);
alter table public.rest_state enable row level security;
revoke all on public.rest_state from anon, authenticated;

-- ---------- C. The buff ----------
create or replace function public._rest_factor(p_account uuid) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select case when coalesce((select buff_until > now() from public.rest_state where account_id = p_account), false)
              then 0.7 else 1 end
$$;
revoke all on function public._rest_factor(uuid) from public, anon, authenticated;

create or replace function public._motel_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'stay', (select jsonb_build_object('plan', s.plan, 'until_ms', (extract(epoch from s.until) * 1000)::bigint)
               from public.motel_stays s where s.account_id = p_account and s.until > now()),
    'rest', jsonb_build_object(
      'buff_until_ms', (select case when r.buff_until > now() then (extract(epoch from r.buff_until) * 1000)::bigint end
                          from public.rest_state r where r.account_id = p_account),
      'slept_today', coalesce((select r.slept_day = (now() at time zone 'Asia/Ho_Chi_Minh')::date
                                 from public.rest_state r where r.account_id = p_account), false)),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint)
$$;
revoke all on function public._motel_json(uuid) from public, anon, authenticated;

-- ---------- E. The ledger ----------
-- The 31 reasons in force after 0038 plus 'motel': 32.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel'));

-- ---------- D. RPCs ----------
create or replace function public.motel_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._motel_json(public._auth_account(p_session_token));
end $$;

-- Rent (or extend) my room: the plan's time is added after my current stay's end (from now when none), prepaid at
-- most 60 days ahead.
create or replace function public.motel_rent(p_session_token text, p_plan text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_price int := public._motel_price(p_plan);
        v_coins int; v_bal int; v_from timestamptz; v_until timestamptz;
begin
  if v_price is null then raise exception 'unknown plan' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  select until into v_from from public.motel_stays where account_id = v_account for update;
  v_from := greatest(now(), coalesce(v_from, now()));
  v_until := v_from + public._motel_len(p_plan);
  if v_until > now() + interval '60 days' then raise exception 'too far ahead' using errcode = '53400'; end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -v_price, 'motel', 'motel: ' || p_plan);
  insert into public.motel_stays (account_id, plan, until, updated_at) values (v_account, p_plan, v_until, now())
  on conflict (account_id) do update set plan = excluded.plan, until = excluded.until, updated_at = now();
  return public._motel_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Sleep in my rented room: once per Vietnam day, not while fainted. "Ngủ ngon" then runs 24 h.
create or replace function public.motel_sleep(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; r public.rest_state;
begin
  if not exists (select 1 from public.motel_stays where account_id = v_account and until > now()) then
    raise exception 'no room' using errcode = '53400';
  end if;
  if coalesce((select fainted_until > now() from public.vitals where account_id = v_account), false) then
    raise exception 'fainted' using errcode = '53400';
  end if;
  insert into public.rest_state (account_id) values (v_account) on conflict do nothing;
  select * into r from public.rest_state where account_id = v_account for update;
  if r.slept_day = v_today then raise exception 'already slept' using errcode = '53400'; end if;
  update public.rest_state set slept_day = v_today, slept_at = now(), buff_until = now() + interval '24 hours'
   where account_id = v_account;
  return public._motel_json(v_account);
end $$;

revoke all on function public.motel_state(text) from public;
revoke all on function public.motel_rent(text, text) from public;
revoke all on function public.motel_sleep(text) from public;
grant execute on function public.motel_state(text) to anon, authenticated;
grant execute on function public.motel_rent(text, text) to anon, authenticated;
grant execute on function public.motel_sleep(text) to anon, authenticated;
