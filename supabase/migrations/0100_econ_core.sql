-- =========================================================
-- 0100_econ_core.sql — Kinh tế v2, the core (spec docs/superpowers/specs/2026-09-30-economy-v2-design.md §3).
-- ADDITIVE and re-runnable. Run after 0099. 0101–0106 (the per-area changes) build on it.
--   A. econ_params: the economy's knobs, which root edits in /admin → Kinh tế without a migration. _econ_param(key).
--   B. The fish price multiplier is one server-wide knob (econ_params 'fish_mult', default 1.00), no longer the room's
--      average wealth: _fish_mult ignores the wealth, so fish, nets, crabs, snails and rats stop inflating with the room
--      (a room at ×10 made every rich room richer, spec §2 D1). fish_price_index keeps its per-room, per-period snapshot
--      (so the season factors and the "Giá cá" tab work as before); its mult may now go below 1.
--   C. Thương lái (the daily NPC buyer): _npc_sale(account, gross) pays full price for the first npc_full xu of grind
--      goods an account sells to NPCs per Vietnam day, 50 % up to npc_half, npc_tail_pct % beyond. The sale functions of
--      0101/0102/0103 call it (fish, crabs & snails, rats, ores, logs, wild goods, dishes); farm harvests are bounded by
--      the plots instead. econ_npc_days keeps each account's day.
--   D. Chợ Lớn pays +10 % instead of +20 % (_market_depot_pay): fish, rice, hoa màu.
--   E. _perk_ledger: perks no longer pay on player-to-player sales (market_sell_pct becomes a fee cut in 0106), and the
--      perk payouts of a day are capped at 1 500 xu (was 3 000).
--   F. Root: admin_econ_params(token), admin_econ_set(token, key, value); admin_economy gains the day's thương lái totals.
-- =========================================================

-- ---------- A. Knobs ----------
create table if not exists public.econ_params (
  key text primary key,
  value numeric not null,
  min_value numeric not null,
  max_value numeric not null,
  note text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.accounts(id) on delete set null,
  check (min_value <= max_value and value between min_value and max_value)
);
alter table public.econ_params enable row level security;
revoke all on public.econ_params from anon, authenticated;

insert into public.econ_params (key, value, min_value, max_value, note) values
  ('fish_mult', 1.00, 0.20, 3.00,
   'Hệ số giá cá toàn server: nhân giá cá (cần, lưới), cua, ốc và chuột lúc bắt được. 1,00 = giá gốc.'),
  ('npc_full', 20000, 0, 10000000,
   'Thương lái: số xu hàng mỗi người bán cho NPC trong một ngày được mua đủ giá (cá, cua ốc, chuột, quặng, gỗ, đồ rừng, món ăn).'),
  ('npc_half', 40000, 0, 10000000,
   'Thương lái: từ mốc đủ giá tới mốc này, NPC chỉ trả 50 %.'),
  ('npc_tail_pct', 20, 0, 100,
   'Thương lái: quá mốc 50 %, NPC trả bao nhiêu % giá.'),
  ('p2p_fee_pct', 5, 0, 50,
   'Phí đốt trên xu chuyển giữa người chơi (giao dịch, bán ruộng, cho thuê ruộng).')
on conflict (key) do nothing;

create or replace function public._econ_param(p_key text) returns numeric
language sql stable security definer set search_path = public, extensions
as $$ select value from public.econ_params where key = p_key $$;

-- ---------- B. The server-wide fish price multiplier ----------
create or replace function public._fish_mult(p_wealth bigint) returns numeric
language sql stable security definer set search_path = public, extensions
as $$ select round(least(10, greatest(0.1, coalesce(public._econ_param('fish_mult'), 1))), 2) $$;

alter table public.fish_price_index drop constraint if exists fish_price_index_mult_check;
alter table public.fish_price_index add constraint fish_price_index_mult_check check (mult between 0.1 and 10);
-- every room's current snapshot takes the knob now (a snapshot is otherwise kept for its 3-hour period)
update public.fish_price_index set mult = public._fish_mult(0) where mult <> public._fish_mult(0);

-- ---------- C. Thương lái ----------
create table if not exists public.econ_npc_days (
  account_id uuid not null references public.accounts(id) on delete cascade,
  day date not null,
  gross bigint not null default 0 check (gross >= 0),
  paid bigint not null default 0 check (paid >= 0),
  primary key (account_id, day)
);
alter table public.econ_npc_days enable row level security;
revoke all on public.econ_npc_days from anon, authenticated;

-- What the NPC pays for p_gross xu of goods (at their catalog / catch price) sold by p_account now, and the day's
-- running totals. The part of [sold today, sold today + p_gross) under npc_full pays 100 %, up to npc_half 50 %, the rest
-- npc_tail_pct %. Callers hold the account's wallet lock (_wallet_lock), so a day's row is updated in order.
create or replace function public._npc_sale(p_account uuid, p_gross integer) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_day date := public._vn_today(); v_before bigint; v_full numeric; v_half numeric; v_tail numeric;
        v_a numeric; v_b numeric; v_c numeric; v_paid integer;
begin
  if coalesce(p_gross, 0) <= 0 then return 0; end if;
  v_full := greatest(0, coalesce(public._econ_param('npc_full'), 20000));
  v_half := greatest(v_full, coalesce(public._econ_param('npc_half'), 40000));
  v_tail := least(100, greatest(0, coalesce(public._econ_param('npc_tail_pct'), 20)));
  insert into public.econ_npc_days (account_id, day) values (p_account, v_day) on conflict do nothing;
  select gross into v_before from public.econ_npc_days where account_id = p_account and day = v_day for update;
  v_a := greatest(0, least(v_before + p_gross, v_full) - v_before);
  v_b := greatest(0, least(v_before + p_gross, v_half) - greatest(v_before, v_full));
  v_c := p_gross - v_a - v_b;
  v_paid := floor(v_a + v_b * 0.5 + v_c * v_tail / 100)::integer;
  update public.econ_npc_days set gross = gross + p_gross, paid = paid + v_paid
   where account_id = p_account and day = v_day;
  return v_paid;
end $$;

-- The account's thương lái day for the client: sold today (at full price), the two marks and the tail percent.
create or replace function public._npc_quota(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'gross', coalesce((select gross from public.econ_npc_days where account_id = p_account and day = public._vn_today()), 0),
    'full', greatest(0, coalesce(public._econ_param('npc_full'), 20000)),
    'half', greatest(0, coalesce(public._econ_param('npc_full'), 20000), coalesce(public._econ_param('npc_half'), 40000)),
    'tail_pct', least(100, greatest(0, coalesce(public._econ_param('npc_tail_pct'), 20))))
$$;

-- ---------- D. Chợ Lớn +10 % ----------
create or replace function public._market_depot_pay(p_xu integer) returns integer
language sql immutable
as $$ select (p_xu * 110) / 100 $$;

-- ---------- E. Perks: no payout on player-to-player sales, 1 500 xu a day ----------
create or replace function public._perk_ledger() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_key text; v_pct numeric; v_amt int; v_day date := public._vn_today(); v_paid int;
begin
  if coalesce(new.ref, '') like 'perk:%' then return new; end if;
  if new.delta < 0 and new.reason in ('meal', 'buff_food') and new.ref like '%: %' then
    perform public._food_buffs(new.account_id, split_part(new.ref, ': ', 2));
  end if;
  if new.delta > 0 then
    v_key := case                                                         -- econ v2: no market_sell_pct payout (0106)
      when new.reason = 'sell' and new.ref like '% con%' then 'fish_sell_pct'
      when new.reason in ('rice_sell', 'produce_sell') then 'farm_sell_pct'
      when new.reason in ('ore_sell', 'gem_sell') then 'ore_sell_pct' end;
  elsif new.delta < 0 then
    v_key := case new.reason
      when 'farm_buy' then 'farm_buy_pct' when 'mine_tool' then 'mine_tool_pct' when 'meal' then 'meal_pct'
      when 'potion' then 'potion_pct' when 'buy' then 'buy_pct' when 'shop_rent' then 'shop_rent_pct'
      when 'market_list' then 'shop_rent_pct' when 'upgrade' then 'upgrade_pct' when 'repair' then 'repair_pct'
      when 'furniture' then 'furniture_pct' when 'house_build' then 'house_pct'
      when 'dojo_tuition' then 'dojo_pct' when 'dojo_exam' then 'dojo_pct' end;
  end if;
  if v_key is null then return new; end if;
  v_pct := least(30, public._perk(new.account_id, v_key));
  if v_pct <= 0 then return new; end if;
  v_amt := floor(abs(new.delta) * v_pct / 100);
  if v_amt <= 0 then return new; end if;
  insert into public.perk_payouts (account_id, day, paid) values (new.account_id, v_day, 0) on conflict do nothing;
  select paid into v_paid from public.perk_payouts where account_id = new.account_id and day = v_day for update;
  v_amt := least(v_amt, 1500 - v_paid);                                   -- econ v2: 1 500 a day (was 3 000)
  if v_amt <= 0 then return new; end if;
  update public.perk_payouts set paid = paid + v_amt where account_id = new.account_id and day = v_day;
  perform set_config('mt.perk_pay', '1', true);
  perform public._pay(new.account_id, v_amt, new.reason, 'perk: ' || v_key);
  perform set_config('mt.perk_pay', '', true);
  return new;
end $$;

-- ---------- F. Root ----------
create or replace function public.admin_econ_params(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'value', p.value, 'min', p.min_value, 'max', p.max_value,
                                                       'note', p.note, 'updated_at', p.updated_at,
                                                       'updated_by', (select a.username from public.accounts a where a.id = p.updated_by))
                                    order by p.key)
                     from public.econ_params p), '[]'::jsonb);
end $$;

create or replace function public.admin_econ_set(p_session_token text, p_key text, p_value numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid; p public.econ_params;
begin
  v_root := public._auth_root(p_session_token);
  select * into p from public.econ_params where key = p_key for update;
  if not found then raise exception 'unknown param' using errcode = '22023'; end if;
  if p_value is null or p_value < p.min_value or p_value > p.max_value then
    raise exception 'out of range' using errcode = '22023';
  end if;
  update public.econ_params set value = p_value, updated_at = now(), updated_by = v_root where key = p_key;
  if p_key = 'fish_mult' then                          -- takes effect at once, not at the next 3-hour period
    update public.fish_price_index set mult = public._fish_mult(0);
  end if;
  return public.admin_econ_params(p_session_token);
end $$;

-- admin_economy (0099) gains today's thương lái: goods sold to NPCs at catalog price, what they paid, and how many
-- accounts went past the full-price mark.
create or replace function public._econ_npc_today() returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'gross', coalesce(sum(d.gross), 0), 'paid', coalesce(sum(d.paid), 0), 'accounts', count(*),
    'over_full', count(*) filter (where d.gross > coalesce(public._econ_param('npc_full'), 20000)))
    from public.econ_npc_days d where d.day = public._vn_today()
$$;

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
                         join public.rooms r on r.id = i.room_id), '[]'::jsonb),
    'npc_today', public._econ_npc_today());                                                     -- 0100
end $$;

revoke all on function public._econ_param(text) from public, anon, authenticated;
revoke all on function public._npc_sale(uuid, integer) from public, anon, authenticated;
revoke all on function public._npc_quota(uuid) from public, anon, authenticated;
revoke all on function public._econ_npc_today() from public, anon, authenticated;
revoke all on function public._fish_mult(bigint) from public, anon, authenticated;
revoke all on function public.admin_econ_params(text) from public;
revoke all on function public.admin_econ_set(text, text, numeric) from public;
revoke all on function public.admin_economy(text) from public;
grant execute on function public.admin_econ_params(text) to anon, authenticated;
grant execute on function public.admin_econ_set(text, text, numeric) to anon, authenticated;
grant execute on function public.admin_economy(text) to anon, authenticated;
