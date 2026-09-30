-- =========================================================
-- 0099_economy_watch.sql — Kinh tế (admin): measure the xu flows before and after tuning them. READ-ONLY for the game
-- (one index, two private helpers, one root RPC; no table, no price, no rule changes). ADDITIVE and re-runnable.
-- Run after 0098. Safe on production at any time.
--   A. idx_coin_ledger_created: the flow report reads the ledger by time, not by account.
--   B. _econ_flows(since): the ledger by reason since a moment (xu in, xu out, rows, accounts).
--      _econ_daily(days): one row per Vietnam day (xu in, xu out, net, active accounts, the money supply at the day's end).
--   C. admin_economy(token): the money supply now (total, frozen on banned accounts, holders, percentiles over the
--      accounts active in 30 days, the 10 richest), active accounts over 1 / 7 / 30 days, the flows by reason over
--      1 / 7 / 30 days, 30 Vietnam days of series, and the 10 highest fish price multipliers (rooms).
-- Every xu that moves goes through _pay and leaves a coin_ledger row, and the ledger is never pruned: the supply at
-- the end of a past day is today's supply minus the net flow since then.
-- =========================================================

-- ---------- A. Index ----------
create index if not exists idx_coin_ledger_created on public.coin_ledger (created_at);

-- ---------- B. Helpers ----------
create or replace function public._econ_flows(p_since timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object('reason', f.reason, 'in', f.xin, 'out', f.xout, 'n', f.n,
                                               'accounts', f.accs) order by abs(f.xin + f.xout) desc, f.reason), '[]'::jsonb)
    from (select l.reason, coalesce(sum(greatest(l.delta, 0)), 0)::bigint xin, coalesce(sum(least(l.delta, 0)), 0)::bigint xout,
                 count(*) n, count(distinct l.account_id) accs
            from public.coin_ledger l
           where l.created_at >= p_since
           group by l.reason) f
$$;

create or replace function public._econ_daily(p_days integer) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  with bounds as (
    select (now() at time zone 'Asia/Ho_Chi_Minh')::date today, greatest(1, least(p_days, 90)) n
  ), d as (
    select (l.created_at at time zone 'Asia/Ho_Chi_Minh')::date vn_day,
           sum(greatest(l.delta, 0))::bigint xin, sum(least(l.delta, 0))::bigint xout, count(distinct l.account_id) accs
      from public.coin_ledger l, bounds b
     where l.created_at >= ((b.today - (b.n - 1))::timestamp at time zone 'Asia/Ho_Chi_Minh')
     group by 1
  ), s as (
    select g.vn_day::date vn_day, coalesce(d.xin, 0) xin, coalesce(d.xout, 0) xout, coalesce(d.accs, 0) accs
      from bounds b
      cross join generate_series(b.today - (b.n - 1), b.today, interval '1 day') g(vn_day)
      left join d on d.vn_day = g.vn_day::date
  ), t as (
    select s.*, (select coalesce(sum(w.coins), 0)::bigint from public.wallets w)
                - coalesce(sum(s.xin + s.xout) over (order by s.vn_day desc rows between unbounded preceding and 1 preceding), 0)
                  ::bigint supply
      from s
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', t.vn_day, 'in', t.xin, 'out', t.xout, 'net', t.xin + t.xout,
                                               'accounts', t.accs, 'supply', t.supply) order by t.vn_day), '[]'::jsonb)
    from t
$$;

-- ---------- C. admin_economy ----------
create or replace function public.admin_economy(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_now timestamptz := now();
begin
  perform public._auth_root(p_session_token);
  return jsonb_build_object(
    'server_now', v_now,
    'supply', (select jsonb_build_object(
                 'total',   coalesce(sum(w.coins) filter (where not a.is_banned), 0)::bigint,
                 'frozen',  coalesce(sum(w.coins) filter (where a.is_banned), 0)::bigint,
                 'wallets', count(*) filter (where not a.is_banned),
                 'holders', count(*) filter (where not a.is_banned and w.coins > 0))
                 from public.wallets w join public.accounts a on a.id = w.account_id),
    'dist', (select jsonb_build_object(
               'n', count(*),
               'p50', coalesce(percentile_disc(0.5) within group (order by w.coins), 0),
               'p90', coalesce(percentile_disc(0.9) within group (order by w.coins), 0),
               'p99', coalesce(percentile_disc(0.99) within group (order by w.coins), 0),
               'max', coalesce(max(w.coins), 0),
               'top10_share', case when coalesce(sum(w.coins), 0) = 0 then 0
                                   else round((select coalesce(sum(x.coins), 0) from (
                                                 select w2.coins from public.wallets w2
                                                   join public.accounts a2 on a2.id = w2.account_id and not a2.is_banned
                                                  where exists (select 1 from public.coin_ledger l2 where l2.account_id = w2.account_id
                                                                   and l2.created_at > v_now - interval '30 days')
                                                  order by w2.coins desc limit 10) x) * 100.0 / sum(w.coins), 1) end)
               from public.wallets w
               join public.accounts a on a.id = w.account_id and not a.is_banned
              where exists (select 1 from public.coin_ledger l where l.account_id = w.account_id
                               and l.created_at > v_now - interval '30 days')),
    'top', coalesce((select jsonb_agg(jsonb_build_object('username', x.username, 'is_root', x.is_root, 'coins', x.coins)
                                      order by x.coins desc)
                       from (select a.username, a.is_root, w.coins from public.wallets w
                               join public.accounts a on a.id = w.account_id and not a.is_banned
                              order by w.coins desc limit 10) x), '[]'::jsonb),
    'active', jsonb_build_object(
                'd1',  (select count(distinct l.account_id) from public.coin_ledger l where l.created_at > v_now - interval '1 day'),
                'd7',  (select count(distinct l.account_id) from public.coin_ledger l where l.created_at > v_now - interval '7 days'),
                'd30', (select count(distinct l.account_id) from public.coin_ledger l where l.created_at > v_now - interval '30 days')),
    'flows', jsonb_build_object(
               'd1',  public._econ_flows(v_now - interval '1 day'),
               'd7',  public._econ_flows(v_now - interval '7 days'),
               'd30', public._econ_flows(v_now - interval '30 days')),
    'daily', public._econ_daily(30),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'mult', i.mult, 'wealth', i.wealth,
                                                           'computed_at', i.computed_at) order by i.mult desc, i.wealth desc)
                         from (select * from public.fish_price_index order by mult desc, wealth desc limit 10) i
                         join public.rooms r on r.id = i.room_id), '[]'::jsonb));
end $$;

revoke all on function public._econ_flows(timestamptz) from public, anon, authenticated;
revoke all on function public._econ_daily(integer) from public, anon, authenticated;
revoke all on function public.admin_economy(text) from public;
grant execute on function public.admin_economy(text) to anon, authenticated;
