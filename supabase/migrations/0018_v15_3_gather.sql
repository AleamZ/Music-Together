-- =========================================================
-- 0018_v15_3_gather.sql — v15.3 "Đồng vui" (docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md): crab holes
-- and snail beds by the canal, the critters they give (sold to cô Út at the room's fish multiplier), the containers that
-- carry them, and the transplant round's gates.
-- ADDITIVE (no data drop) and re-runnable. Requires 0015, 0016 and 0017 (it re-creates functions they last defined and
-- keeps their parts, anti-cheat spec §11.3 rules 1 and 3); does not depend on 0014. Every function relies on
-- `set search_path = public, extensions`. Time rules live in private functions that take p_now; the public RPCs pass
-- now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Config and catalog ----------
-- The critters (§7.1): a name and a base price each; the odds, the gates and the limits are constants below.
create table if not exists public.critter_kinds (
  id text primary key,
  name text not null,
  grp text not null check (grp in ('crab', 'snail')),
  base_price integer not null check (base_price > 0),
  sort_order integer not null default 0
);
alter table public.critter_kinds enable row level security;
drop policy if exists critter_kinds_select on public.critter_kinds;
create policy critter_kinds_select on public.critter_kinds for select to anon using (true);
grant select on public.critter_kinds to anon, authenticated;

insert into public.critter_kinds (id, name, grp, base_price, sort_order) values
  ('cua_dong',     'Cua đồng',     'crab',  12, 10),
  ('cua_gach',     'Cua gạch',     'crab',  45, 20),
  ('oc_dong',      'Ốc đồng',      'snail',  8, 30),
  ('oc_buou_vang', 'Ốc bươu vàng', 'snail',  2, 40)
on conflict (id) do update set
  name = excluded.name, grp = excluded.grp, base_price = excluded.base_price, sort_order = excluded.sort_order;

-- The config table is read-only for the API roles (Supabase's default privileges give them every right on a new table).
revoke insert, update, delete, truncate on public.critter_kinds from anon, authenticated;

-- The two containers (§9): the kind critter_box has been in the catalog's check since 0013.
insert into public.shop_items (id, kind, name, price, starter, sort_order, capacity) values
  ('box_bucket', 'critter_box', 'Xô nhựa', 1500, false, 10, 15),
  ('box_basket', 'critter_box', 'Giỏ tre', 6000, false, 20, 30)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, capacity = excluded.capacity;

-- The reasons in force after 0017 (0015's, then 0016's harvester and produce_sell, then 0017's card reasons) plus the
-- critter sale (§11.2): 21 reasons. Anti-cheat §11.3 rule 4 keeps 'wipe'.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell'));

-- ---------- B. Tables (private: RLS on, no policies — only the RPCs touch them) ----------
-- One row per critter held (at most 33 an account), priced at the catch (R4).
create table if not exists public.critters (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null references public.critter_kinds(id),
  price integer not null check (price >= 1),
  caught_at timestamptz not null
);
create index if not exists idx_critters_account on public.critters (account_id, kind);

-- A spot's cooldown per account, across rooms (R1); an open crab visit rides on its hole's row (R6).
create table if not exists public.gather_cooldowns (
  account_id uuid not null references public.accounts(id) on delete cascade,
  spot text not null check (spot ~ '^(crab[1-6]|bed[1-4])$'),
  ready_at timestamptz not null,
  visit_id uuid,
  visit_at timestamptz,
  visit_room uuid,
  primary key (account_id, spot),
  check ((visit_id is null) = (visit_at is null) and (visit_id is null) = (visit_room is null))
);
alter table public.critters enable row level security;
alter table public.gather_cooldowns enable row level security;
revoke all on public.critters, public.gather_cooldowns from anon, authenticated;

-- The daily limit (§7.5): the Vietnam day of the last visit and the visits that day.
alter table public.farm_profiles add column if not exists gather_on date;
alter table public.farm_profiles add column if not exists gather_count smallint not null default 0;
alter table public.farm_profiles drop constraint if exists farm_profiles_gather_count_check;
alter table public.farm_profiles add constraint farm_profiles_gather_count_check check (gather_count >= 0);

-- ---------- C. Helpers and views (§7.1, §7.5, §11.3, §11.7) ----------
-- The price of a critter at multiplier M: floor(base × M), at least 1 (R4). lib/game/farm/gather.ts mirrors it.
create or replace function public._critter_price(p_base integer, p_mult numeric) returns integer
language sql immutable set search_path = public, extensions
as $$ select greatest(1, floor(p_base * p_mult))::int $$;

-- The multiplier the field shows (R12): the room's fish price index while its period is current, else a preview of the
-- next snapshot. A read: it never writes the index.
create or replace function public._critter_prices(p_room uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(
    (select jsonb_build_object('mult', r.mult, 'ends_at', to_timestamp((r.period + 1) * 10800 - 25200))
       from public.fish_price_index r where r.room_id = p_room and r.period >= public._fish_period(p_now)),
    jsonb_build_object('mult', public._fish_mult(public._room_wealth(p_room, p_now)),
                       'ends_at', to_timestamp((public._fish_period(p_now) + 1) * 10800 - 25200)))
$$;

-- How many critters the account can hold (R5): 3 by hand plus its largest container.
create or replace function public._critter_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select 3 + coalesce(max(s.capacity), 0) from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and i.qty >= 1 and s.kind = 'critter_box'
$$;

-- Critters into the account's hands and container (R4, R5): as many of p_kinds as fit, in order, each at the room's M
-- taken now (_fish_index may write the snapshot: the caller holds the wallet lock, R12); the rest escape.
create or replace function public._critter_add(p_account uuid, p_room uuid, p_kinds text[], p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_all integer := coalesce(cardinality(p_kinds), 0); v_fit integer; v_mult numeric; v_caught jsonb := '[]'::jsonb;
        k integer; v_price integer;
begin
  v_fit := least(v_all, greatest(0, public._critter_cap(p_account)
                                    - (select count(*)::int from public.critters where account_id = p_account)));
  if v_fit > 0 then
    v_mult := (public._fish_index(p_room, p_now)).mult;
    for k in 1 .. v_fit loop
      v_price := public._critter_price((select base_price from public.critter_kinds where id = p_kinds[k]), v_mult);
      insert into public.critters (account_id, kind, price, caught_at) values (p_account, p_kinds[k], v_price, p_now);
      v_caught := v_caught || jsonb_build_array(jsonb_build_object('kind', p_kinds[k], 'price', v_price));
    end loop;
  end if;
  return jsonb_build_object('caught', v_caught, 'escaped', v_all - v_fit);
end $$;

-- The daily limit's check (§7.5), first in both visit RPCs: 200 visits a Vietnam day; details = the seconds until the
-- next Vietnam midnight. It makes the account's farm profile if there is none.
create or replace function public._gather_check(p_account uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_day date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date; pr public.farm_profiles;
begin
  insert into public.farm_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into pr from public.farm_profiles where account_id = p_account;
  if pr.gather_on = v_day and pr.gather_count >= 200 then
    raise exception 'gather daily limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - p_now)))::int::text;
  end if;
end $$;

-- Counts a visit once its checks have passed (§7.5); the 200th of a day logs the soft gather_daily_cap.
create or replace function public._gather_count(p_account uuid, p_room uuid, p_rpc text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_day date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date; v_n integer;
begin
  update public.farm_profiles
     set gather_count = case when gather_on = v_day then gather_count + 1 else 1 end, gather_on = v_day
   where account_id = p_account
  returning gather_count into v_n;
  if v_n = 200 then
    perform public._ac_flag(p_account, 'gather_daily_cap', p_rpc, jsonb_build_object('day', v_day, 'visits', 200), p_room,
                            null, false);
  end if;
end $$;

-- The account's farm belongings (0016's body): also the critters held (count and what cô Út pays, per kind), the capacity
-- and the gathering (§11.7) — the spots still cooling for me in any room, the visits left today and, at 0 left, when the
-- day resets. Like _fishing_state, it reads the day and the cooldowns on now().
create or replace function public._farm_mine(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty order by i.item_id)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('seed','fertilizer','pesticide','critter_box','tool')), '{}'::jsonb),
    'rice', coalesce((select jsonb_object_agg(rs.variety, jsonb_build_object('wet', rs.wet_kg, 'dry', rs.dry_kg) order by rs.variety)
                        from public.rice_stock rs where rs.account_id = p_account and (rs.wet_kg > 0 or rs.dry_kg > 0)),
                     '{}'::jsonb),
    'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0),
    'gift_claimed', exists (select 1 from public.farm_profiles pr where pr.account_id = p_account and pr.gift_at is not null),
    'produce', coalesce((select jsonb_object_agg(ps.upland, ps.kg order by ps.upland)
                           from public.produce_stock ps where ps.account_id = p_account and ps.kg > 0), '{}'::jsonb),
    'tank', case when public._owns(p_account, 'tool_sprayer')
                 then coalesce((select jsonb_build_object('item', pr.tank_item, 'charges', pr.tank_charges)
                                  from public.farm_profiles pr where pr.account_id = p_account),
                               jsonb_build_object('item', null, 'charges', 0)) end,
    'critters', coalesce((select jsonb_object_agg(k.kind, jsonb_build_object('n', k.n, 'xu', k.xu) order by k.kind)
                            from (select cr.kind, count(*)::int as n, sum(cr.price)::int as xu
                                    from public.critters cr where cr.account_id = p_account group by cr.kind) k), '{}'::jsonb),
    'critter_cap', public._critter_cap(p_account),
    'gather', (select jsonb_build_object(
                 'ready_at', coalesce((select jsonb_object_agg(g.spot, g.ready_at order by g.spot) from public.gather_cooldowns g
                                        where g.account_id = p_account and g.ready_at > now()), '{}'::jsonb),
                 'left_today', d.left_today,
                 'day_resets_at', case when d.left_today = 0
                                       then (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end)
                 from (select coalesce((select case when pr.gather_on = public._vn_today() then greatest(0, 200 - pr.gather_count)
                                                    else 200 end
                                          from public.farm_profiles pr where pr.account_id = p_account), 200) as left_today) d))
$$;

-- The whole field_state answer (0013's body), plus the critter prices the field shows (R12).
create or replace function public._field_view(p_room uuid, p_viewer uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now,
    'plots', (select jsonb_agg(public._plot_view(p_room, fp.plot_no, p_viewer, p_now) order by fp.plot_no)
                from public.field_plots fp where fp.room_id = p_room),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('slot', ds.slot, 'owner', public._who(ds.account_id),
                                                            'variety', ds.variety, 'kg', ds.kg, 'ready_at', ds.ready_at)
                                         order by ds.slot)
                          from public.drying_slots ds where ds.room_id = p_room), '[]'::jsonb),
    'mine', public._farm_mine(p_viewer) || jsonb_build_object(
      'owned_plot', (select fp.plot_no from public.field_plots fp where fp.room_id = p_room and fp.owner_id = p_viewer
                      order by fp.plot_no limit 1),
      'farming', coalesce((select jsonb_agg(fp.plot_no order by fp.plot_no) from public.field_plots fp
                            where fp.room_id = p_room and public._farmer(p_room, fp.plot_no, p_now) = p_viewer), '[]'::jsonb),
      'my_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no, 'price', lo.price,
                                                               'expires_at', lo.created_at + interval '24 hours')
                                              order by lo.created_at, lo.id)
                              from public.land_offers lo where lo.room_id = p_room and lo.buyer_id = p_viewer), '[]'::jsonb),
      'incoming_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no,
                                                                     'buyer', public._who(lo.buyer_id), 'price', lo.price,
                                                                     'expires_at', lo.created_at + interval '24 hours')
                                                    order by lo.plot_no, lo.price desc, lo.id)
                                    from public.land_offers lo
                                    join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
                                   where lo.room_id = p_room and fp.owner_id = p_viewer), '[]'::jsonb)),
    'critter_prices', public._critter_prices(p_room, p_now))
$$;

revoke all on function public._critter_price(integer, numeric) from public, anon, authenticated;
revoke all on function public._critter_prices(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._critter_cap(uuid) from public, anon, authenticated;
revoke all on function public._critter_add(uuid, uuid, text[], timestamptz) from public, anon, authenticated;
revoke all on function public._gather_check(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._gather_count(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
revoke all on function public._field_view(uuid, uuid, timestamptz) from public, anon, authenticated;
