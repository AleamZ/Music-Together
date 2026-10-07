-- =========================================================
-- 0124_forest_trade.sql — the forest's goods between players: logs, wild goods, dishes and the forest items (traps,
-- charcoal) can be traded, listed on Chợ người chơi, auctioned, stocked in a stall, and travel by mail like produce.
-- ADDITIVE and re-runnable. Run after 0123. Every re-created function is its newest body (named above it) plus the
-- lines marked "-- 0124" (or "-- 0124 {" … "-- 0124 }").
--   Kinds: 'wood' (ref = the log, e.g. go_soi; only full-price logs — the day's half-price logs stay with their
--   chopper, so the half-price rule cannot be washed through another player), 'wild' (ref = the wild good, e.g.
--   thit_ga_rung), 'dish' (ref = '<dish>:<quality>', e.g. 'com_tam_suon:2'), 'item' (a shop item of kind 'forest':
--   bay_go, bay_sat, than_cui; at most 99 a stack as in the inventory).
--   Value (what the price band, the auction cap, the collusion guard and the Beta net worth read): the NPC price — a log
--   at its tree's price, a wild good at the stall's, a dish at its sale value for its quality, an item at its shop price.
--   Everything else is the existing machinery and applies unchanged: the 2 % listing fee, the 5 % sale fee (the
--   trader perk), the 50–300 % price band, the 3-skewed-deals collusion flag, the trade's item count and xu rules
--   (p2p_fee_pct, trade_daily_in), the mailbox escrow (the mail_items row holds the goods until claimed; an expired
--   trade mail returns them), the anti-cheat wipe (mail and listings go with the account). The Beta exclusivity guards
--   only concern fashion; none of these goods is exclusive.
-- =========================================================

-- ---------- The goods ----------
-- A wild good's name (the client's WILD_ITEMS).
create or replace function public._wild_item_name(p_id text) returns text
language sql immutable parallel safe
as $$
  select n from (values ('thit_tho', 'Thịt thỏ'), ('long_vu', 'Lông vũ'), ('sung_huou', 'Sừng hươu'), ('da_cao', 'Da cáo'),
                        ('da_soi', 'Da sói'), ('vuot_gau', 'Vuốt gấu'), ('dom_dom', 'Hũ đom đóm'),
                        ('thit_chuot_dong', 'Thịt chuột đồng'), ('thit_ga_rung', 'Thịt gà rừng'),
                        ('thit_ran_ri_ca', 'Thịt rắn ri cá')) x(id, n)
   where x.id = p_id
$$;

-- A dish ref '<dish>:<quality>' split (null for anything else).
create or replace function public._dish_ref_ok(p_ref text) returns boolean
language sql immutable parallel safe
as $$ select coalesce(p_ref ~ '^[a-z_]+:[0-3]$', false) $$;

-- The display name of one unit.
create or replace function public._forest_goods_label(p_kind text, p_ref text) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select case p_kind
    when 'wood' then (select 'Gỗ ' || lower(t.name) from public._forest_trees() t where t.log = p_ref)
    when 'wild' then public._wild_item_name(p_ref)
    when 'dish' then case when public._dish_ref_ok(p_ref) then
      (select r.name || ' (' || (array['Hỏng', 'Đạt', 'Ngon', 'Tuyệt phẩm'])[split_part(p_ref, ':', 2)::int + 1] || ')'
         from public._cook_recipes() r where r.id = split_part(p_ref, ':', 1)) end
    when 'item' then (select s.name from public.shop_items s where s.id = p_ref and s.kind = 'forest')
  end
$$;

-- The NPC value of p_qty units (null: not a forest good).
create or replace function public._forest_goods_value(p_kind text, p_ref text, p_qty integer) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when p_qty is null or p_qty < 1 or p_qty > 100000 then null
    when p_kind = 'wood' then (select (t.price::bigint * p_qty)::int from public._forest_trees() t where t.log = p_ref)
    when p_kind = 'wild' then (select (i.price::bigint * p_qty)::int from public._wild_items() i where i.id = p_ref)
    when p_kind = 'dish' then case when public._dish_ref_ok(p_ref) then
      (select ((r.price * public._cook_pct(split_part(p_ref, ':', 2)::int)) / 100 * p_qty::bigint)::int
         from public._cook_recipes() r where r.id = split_part(p_ref, ':', 1)) end
    when p_kind = 'item' then (select (s.price::bigint * p_qty)::int from public.shop_items s
                                where s.id = p_ref and s.kind = 'forest' and s.price > 0 and p_qty <= 99)
  end
$$;

-- What p_owner holds of a good (wood: the full-price logs only).
create or replace function public._forest_goods_have(p_owner uuid, p_kind text, p_ref text) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(case p_kind
    when 'wood' then (select w.qty from public.wood_bag w where w.account_id = p_owner and w.item = p_ref)
    when 'wild' then (select b.qty from public.wild_bag b where b.account_id = p_owner and b.item = p_ref)
    when 'dish' then case when public._dish_ref_ok(p_ref) then
      (select d.qty from public.cooked_dishes d where d.account_id = p_owner and d.dish = split_part(p_ref, ':', 1)
          and d.quality = split_part(p_ref, ':', 2)::int) end
    when 'item' then (select i.qty from public.inventory i join public.shop_items s on s.id = i.item_id
                       where i.account_id = p_owner and i.item_id = p_ref and s.kind = 'forest')
  end, 0)
$$;

-- Take p_qty units from p_from under the row lock ('asset gone' when not held).
create or replace function public._forest_goods_take(p_from uuid, p_kind text, p_ref text, p_qty integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_qty is null or p_qty < 1 or public._forest_goods_value(p_kind, p_ref, p_qty) is null then
    raise exception 'asset gone' using errcode = '53400';
  end if;
  if p_kind = 'wood' then
    update public.wood_bag set qty = qty - p_qty where account_id = p_from and item = p_ref and qty >= p_qty;
  elsif p_kind = 'wild' then
    update public.wild_bag set qty = qty - p_qty where account_id = p_from and item = p_ref and qty >= p_qty;
  elsif p_kind = 'dish' then
    update public.cooked_dishes set qty = qty - p_qty
     where account_id = p_from and dish = split_part(p_ref, ':', 1) and quality = split_part(p_ref, ':', 2)::int and qty >= p_qty;
  elsif p_kind = 'item' then
    update public.inventory set qty = qty - p_qty where account_id = p_from and item_id = p_ref and qty >= p_qty;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if not found then raise exception 'asset gone' using errcode = '53400'; end if;
end $$;

-- Give p_qty units to p_to (a log arrives at full price; an item stack stops at 99: 'bag full').
create or replace function public._forest_goods_give(p_to uuid, p_kind text, p_ref text, p_qty integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_kind = 'wood' then
    insert into public.wood_bag (account_id, item, qty, half) values (p_to, p_ref, p_qty, 0)
    on conflict (account_id, item) do update set qty = public.wood_bag.qty + excluded.qty;
  elsif p_kind = 'wild' then
    insert into public.wild_bag (account_id, item, qty) values (p_to, p_ref, p_qty)
    on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
  elsif p_kind = 'dish' then
    insert into public.cooked_dishes (account_id, dish, quality, qty)
    values (p_to, split_part(p_ref, ':', 1), split_part(p_ref, ':', 2)::int, p_qty)
    on conflict (account_id, dish, quality) do update set qty = public.cooked_dishes.qty + excluded.qty;
  elsif p_kind = 'item' then
    if coalesce((select qty from public.inventory where account_id = p_to and item_id = p_ref), 0) + p_qty > 99 then
      raise exception 'bag full' using errcode = '53400';
    end if;
    insert into public.inventory (account_id, item_id, qty) values (p_to, p_ref, p_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
end $$;

-- Every good an account holds, for _econ_json's asset list (kind, ref, qty, label).
create or replace function public._forest_goods_list(p_account uuid)
returns table (kind text, ref text, qty integer, label text)
language sql stable security definer set search_path = public, extensions
as $$
  select 'wood', w.item, w.qty, public._forest_goods_label('wood', w.item) from public.wood_bag w
   where w.account_id = p_account and w.qty > 0 and public._forest_goods_label('wood', w.item) is not null
  union all
  select 'wild', b.item, b.qty, public._forest_goods_label('wild', b.item) from public.wild_bag b
   where b.account_id = p_account and b.qty > 0 and public._forest_goods_label('wild', b.item) is not null
  union all
  select 'dish', d.dish || ':' || d.quality, d.qty, public._forest_goods_label('dish', d.dish || ':' || d.quality)
    from public.cooked_dishes d where d.account_id = p_account and d.qty > 0
  union all
  select 'item', i.item_id, i.qty, s.name from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and i.qty > 0 and s.kind = 'forest' and s.price > 0
$$;

revoke all on function public._wild_item_name(text) from public, anon, authenticated;
revoke all on function public._dish_ref_ok(text) from public, anon, authenticated;
revoke all on function public._forest_goods_label(text, text) from public, anon, authenticated;
revoke all on function public._forest_goods_value(text, text, integer) from public, anon, authenticated;
revoke all on function public._forest_goods_have(uuid, text, text) from public, anon, authenticated;
revoke all on function public._forest_goods_take(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public._forest_goods_give(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public._forest_goods_list(uuid) from public, anon, authenticated;

-- ---------- The kinds the tables accept ----------
alter table public.econ_listings drop constraint if exists econ_listings_asset_kind_check;
alter table public.econ_listings add constraint econ_listings_asset_kind_check
  check (asset_kind in ('fish', 'fashion', 'produce', 'wood', 'wild', 'dish', 'item'));
alter table public.econ_auctions drop constraint if exists econ_auctions_asset_kind_check;
alter table public.econ_auctions add constraint econ_auctions_asset_kind_check
  check (asset_kind in ('fish', 'fashion', 'produce', 'wood', 'wild', 'dish', 'item'));
alter table public.mail_items drop constraint if exists mail_items_kind_check;
alter table public.mail_items add constraint mail_items_kind_check
  check (kind in ('item', 'fashion', 'fish', 'produce', 'wood', 'wild', 'dish'));

-- ---------- The paths ----------
-- _econ_value (0073_player_economy.sql, verbatim but for the lines marked 0124)
create or replace function public._econ_value(p_owner uuid, p_kind text, p_ref text, p_qty integer, p_extra integer default 0)
returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when p_qty is null or p_qty < 1 then null
    when p_kind = 'fish' then
      (select f.price from public.fish f where f.id = public._econ_uuid(p_ref) and f.account_id = p_owner
          and p_qty = 1 and coalesce(p_extra, 0) = 0)
    when p_kind = 'fashion' then
      (select c.price from public.account_items a join public.item_catalog c on c.id = a.item_id
        where a.account_id = p_owner and a.item_id = p_ref and not c.starter and c.price > 0
          and p_qty = 1 and coalesce(p_extra, 0) = 0)
    when p_kind = 'produce' then
      (select (u.price_per_kg::bigint * p_qty)::int from public.produce_stock s join public.upland_crops u on u.id = s.upland
        where s.account_id = p_owner and s.upland = p_ref and s.kg >= p_qty + coalesce(p_extra, 0) and p_qty <= 100000)
    when p_kind in ('wood', 'wild', 'dish', 'item') then                                                  -- 0124 {
      case when p_qty <= 100000 and public._forest_goods_have(p_owner, p_kind, p_ref) >= p_qty + coalesce(p_extra, 0)
           then public._forest_goods_value(p_kind, p_ref, p_qty) end                                     -- 0124 }
  end
$$;
revoke all on function public._econ_value(uuid, text, text, integer, integer) from public, anon, authenticated;

-- _econ_name (0073_player_economy.sql, verbatim but for the lines marked 0124)
create or replace function public._econ_name(p_kind text, p_ref text, p_qty integer) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select case p_kind
    when 'fish' then (select s.name || ' ' || round(f.weight_g / 1000.0, 2)::text || ' kg'
                        from public.fish f join public.fish_species s on s.id = f.species_id where f.id = public._econ_uuid(p_ref))
    when 'fashion' then (select name from public.item_catalog where id = p_ref)
    when 'produce' then (select name || ' ' || p_qty || ' kg' from public.upland_crops where id = p_ref)
    when 'wood' then public._forest_goods_label(p_kind, p_ref) || ' ×' || p_qty                            -- 0124 {
    when 'wild' then public._forest_goods_label(p_kind, p_ref) || ' ×' || p_qty
    when 'dish' then public._forest_goods_label(p_kind, p_ref) || ' ×' || p_qty
    when 'item' then public._forest_goods_label(p_kind, p_ref) || ' ×' || p_qty                            -- 0124 }
  end
$$;
revoke all on function public._econ_name(text, text, integer) from public, anon, authenticated;

-- _econ_move (0073_player_economy.sql, verbatim but for the lines marked 0124)
create or replace function public._econ_move(p_from uuid, p_to uuid, p_kind text, p_ref text, p_qty integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_fish uuid;
begin
  if p_kind = 'fish' then
    v_fish := public._econ_uuid(p_ref);
    perform 1 from public.fish where id = v_fish and account_id = p_from for update;
    if not found or p_qty <> 1 then raise exception 'asset gone' using errcode = '53400'; end if;
    if (select count(*) from public.fish where account_id = p_to) >= 1 + public._bucket_cap(p_to) then
      raise exception 'bucket full' using errcode = '53400';
    end if;
    update public.fish set account_id = p_to where id = v_fish;                 -- an update: no 'fish_catch' event
  elsif p_kind = 'fashion' then
    if exists (select 1 from public.account_items where account_id = p_to and item_id = p_ref) then
      raise exception 'already owned' using errcode = '53400';
    end if;
    delete from public.account_items where account_id = p_from and item_id = p_ref;
    if not found then raise exception 'asset gone' using errcode = '53400'; end if;
    -- off the giver's back (the required slots fall back to a starter)
    update public.characters
       set hat = nullif(hat, p_ref), neck = nullif(neck, p_ref), hand = nullif(hand, p_ref), pet = nullif(pet, p_ref),
           outfit = nullif(outfit, p_ref), wrist = nullif(wrist, p_ref), hairpin = nullif(hairpin, p_ref),
           top = case when top = p_ref then 'top_baba_yellow' else top end,
           bottom = case when bottom = p_ref then 'bottom_shorts_red' else bottom end,
           shoes = case when shoes = p_ref then 'shoes_dep_blue' else shoes end,
           updated_at = now()
     where account_id = p_from and p_ref in (hat, neck, hand, pet, outfit, wrist, hairpin, top, bottom, shoes);
    insert into public.account_items (account_id, item_id, acquired_at) values (p_to, p_ref, now());
  elsif p_kind = 'produce' then
    update public.produce_stock set kg = kg - p_qty where account_id = p_from and upland = p_ref and kg >= p_qty;
    if not found or p_qty < 1 then raise exception 'asset gone' using errcode = '53400'; end if;
    insert into public.produce_stock (account_id, upland, kg) values (p_to, p_ref, p_qty)
    on conflict (account_id, upland) do update set kg = public.produce_stock.kg + excluded.kg;
  elsif p_kind in ('wood', 'wild', 'dish', 'item') then                                                  -- 0124 {
    perform public._forest_goods_take(p_from, p_kind, p_ref, p_qty);
    perform public._forest_goods_give(p_to, p_kind, p_ref, p_qty);                                       -- 0124 }
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
end $$;
revoke all on function public._econ_move(uuid, uuid, text, text, integer) from public, anon, authenticated;

-- _econ_json (0073_player_economy.sql, verbatim but for the lines marked 0124)
create or replace function public._econ_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'assets', coalesce((
      select jsonb_agg(a.j order by a.k, a.n) from (
        select 'fish' k, f.caught_at::text n,
               public._econ_asset_json('fish', f.id::text, 1, f.price, public._econ_name('fish', f.id::text, 1))
               || jsonb_build_object('reserved', public._econ_reserved(p_account, 'fish', f.id::text)) j
          from public.fish f where f.account_id = p_account
        union all
        select 'fashion', c.name,
               public._econ_asset_json('fashion', c.id, 1, c.price, c.name)
               || jsonb_build_object('reserved', public._econ_reserved(p_account, 'fashion', c.id))
          from public.account_items i join public.item_catalog c on c.id = i.item_id
         where i.account_id = p_account and not c.starter and c.price > 0
        union all
        select 'produce', u.name,
               public._econ_asset_json('produce', u.id, s.kg, u.price_per_kg, u.name)
               || jsonb_build_object('reserved', public._econ_reserved(p_account, 'produce', u.id))
          from public.produce_stock s join public.upland_crops u on u.id = s.upland
         where s.account_id = p_account and s.kg > 0
        union all                                                                                         -- 0124 {
        select g.kind, g.label,
               public._econ_asset_json(g.kind, g.ref, g.qty, public._forest_goods_value(g.kind, g.ref, 1), g.label)
               || jsonb_build_object('reserved', public._econ_reserved(p_account, g.kind, g.ref))
          from public._forest_goods_list(p_account) g) a), '[]'::jsonb),                                -- 0124 }
    'listings', coalesce((select jsonb_agg(public._econ_listing_json(l, p_account) order by l.created_at desc, l.id desc)
                            from public.econ_listings l where l.id in (select id from public.econ_listings where status = 'open' and stall_no is null
                                   order by created_at desc, id desc limit 200)), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(public._econ_listing_json(l, p_account) order by l.created_at desc, l.id desc)
                        from public.econ_listings l where l.id in (select id from public.econ_listings where seller = p_account
                               order by created_at desc, id desc limit 30)), '[]'::jsonb),
    'auctions', coalesce((select jsonb_agg(public._econ_auction_json(x, p_account) order by x.status <> 'open', x.ends_at)
                            from public.econ_auctions x where x.id in (select id from public.econ_auctions
                                   where status = 'open'
                                      or (seller = p_account or top_bidder = p_account) and closed_at > now() - interval '3 days'
                                   order by ends_at limit 100)), '[]'::jsonb),
    'stalls', coalesce((select jsonb_agg(jsonb_build_object(
                 'no', s.no, 'mine', s.renter = p_account,
                 'renter_name', case when s.renter is not null then public._news_name(s.renter) end,
                 'paid_ms', case when s.renter is not null then public._apt_ms(s.paid_until) end,
                 'items', coalesce((select jsonb_agg(public._econ_listing_json(l, p_account) order by l.id)
                                      from public.econ_listings l where l.stall_no = s.no and l.status = 'open'), '[]'::jsonb))
                 order by s.no) from public.econ_stalls s), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._econ_json(uuid) from public, anon, authenticated;

-- _econ_offer (0073_player_economy.sql, verbatim but for the lines marked 0124)
create or replace function public._econ_offer(p_owner uuid, p_offer jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_coins bigint; v_items jsonb := '[]'::jsonb; e jsonb; v_kind text; v_ref text; v_qty integer; v_value integer;
        v_seen text[] := '{}'; v_key text;
begin
  if p_offer is null or jsonb_typeof(p_offer) <> 'object' then raise exception 'bad offer' using errcode = '22023'; end if;
  v_coins := coalesce((p_offer->>'coins')::bigint, 0);
  if v_coins < 0 or v_coins > 100000000 then raise exception 'bad offer' using errcode = '22023'; end if;
  if v_coins > coalesce((select coins from public.wallets where account_id = p_owner), 0) then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_offer->'items', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_offer->'items', '[]'::jsonb)) > public._econ_rule('trade_items') then
    raise exception 'bad offer' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_offer->'items', '[]'::jsonb)) loop
    v_kind := e->>'kind'; v_ref := e->>'ref';
    v_qty := case when v_kind in ('produce', 'wood', 'wild', 'dish', 'item') then (e->>'qty')::integer else 1 end;   -- 0124 was: when v_kind = 'produce'
    v_key := v_kind || ':' || coalesce(v_ref, '');
    if v_kind is null or v_kind not in ('fish','fashion','produce','wood','wild','dish','item') or v_ref is null or v_key = any(v_seen) then   -- 0124 was: not in ('fish','fashion','produce')
      raise exception 'bad offer' using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;
    v_value := public._econ_value(p_owner, v_kind, v_ref, v_qty, public._econ_reserved(p_owner, v_kind, v_ref));
    if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
    v_items := v_items || jsonb_build_array(public._econ_asset_json(v_kind, v_ref, v_qty, v_value, public._econ_name(v_kind, v_ref, v_qty)));
  end loop;
  return jsonb_build_object('coins', v_coins, 'items', v_items);
end $$;
revoke all on function public._econ_offer(uuid, jsonb) from public, anon, authenticated;

-- market_list (0108_anticheat_v3.sql, verbatim but for the line marked 0124)
CREATE OR REPLACE FUNCTION public.market_list(p_session_token text, p_kind text, p_ref text, p_qty integer, p_price integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
declare v_account uuid := public._ac_account(p_session_token); v_value integer; v_fee integer; v_id bigint;
begin
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce','wood','wild','dish','item') then raise exception 'bad kind' using errcode = '22023'; end if;   -- 0124 was: not in ('fish','fashion','produce')
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
-- auction_create (0108_anticheat_v3.sql, verbatim but for the line marked 0124)
CREATE OR REPLACE FUNCTION public.auction_create(p_session_token text, p_kind text, p_ref text, p_qty integer, p_start integer, p_hours integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
declare v_account uuid := public._ac_account(p_session_token); v_value integer;
begin
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce','wood','wild','dish','item') then raise exception 'bad kind' using errcode = '22023'; end if;   -- 0124 was: not in ('fish','fashion','produce')
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
-- shop_stock (0073_player_economy.sql, verbatim but for the line marked 0124)
create or replace function public.shop_stock(p_session_token text, p_kind text, p_ref text, p_qty integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; s public.econ_stalls; v_value integer;
begin
  v_ac := public._pos_claim(v_account, 'market', 560, 360, 'shop_stock', null, 'not at market');
  if v_ac is not null then return v_ac; end if;
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce','wood','wild','dish','item') then raise exception 'bad kind' using errcode = '22023'; end if;   -- 0124 was: not in ('fish','fashion','produce')
  select * into s from public.econ_stalls where renter = v_account and paid_until > now() for update;
  if not found then raise exception 'no stall' using errcode = '53400'; end if;
  if (select count(*) from public.econ_listings where stall_no = s.no and status = 'open') >= public._econ_rule('stall_slots') then
    raise exception 'stall full' using errcode = '53400';
  end if;
  perform public._econ_can_list(v_account);
  v_value := public._econ_value(v_account, p_kind, p_ref, p_qty, public._econ_reserved(v_account, p_kind, p_ref));
  if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
  if not public._econ_in_band(p_price, v_value) then raise exception 'bad price' using errcode = '22023'; end if;
  insert into public.econ_listings (seller, stall_no, asset_kind, asset_ref, qty, name, value, price, fee, expires_at)
  values (v_account, s.no, p_kind, p_ref, p_qty, public._econ_name(p_kind, p_ref, p_qty), v_value, p_price, 0, s.paid_until);
  return public._econ_json(v_account);
end $$;
-- _mail_take (0111_mailbox.sql, verbatim but for the lines marked 0124)
create or replace function public._mail_take(p_mail bigint, p_from uuid, p_kind text, p_ref text, p_qty integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_to uuid; v_fish uuid; f public.fish; v_name text; v_value integer;
begin
  select account_id into v_to from public.mail where id = p_mail and claimed_at is null;
  if not found then raise exception 'no mail' using errcode = '22023'; end if;
  if p_kind = 'fish' then
    v_fish := public._econ_uuid(p_ref);
    select * into f from public.fish where id = v_fish and account_id = p_from for update;
    if not found or p_qty is distinct from 1 then raise exception 'asset gone' using errcode = '53400'; end if;
    v_name := coalesce(public._econ_name('fish', p_ref, 1), 'Cá');
    v_value := f.price;
    delete from public.fish where id = f.id;
    insert into public.mail_fish (id, mail_id, species_id, weight_g, price, caught_at)
    values (f.id, p_mail, f.species_id, f.weight_g, f.price, f.caught_at);
  elsif p_kind = 'fashion' then
    if public._mail_has_fashion(v_to, p_ref) then raise exception 'already owned' using errcode = '53400'; end if;
    delete from public.account_items where account_id = p_from and item_id = p_ref;
    if not found or p_qty is distinct from 1 then raise exception 'asset gone' using errcode = '53400'; end if;
    -- off the giver's back (the required slots fall back to a starter), as 0073's _econ_move
    update public.characters
       set hat = nullif(hat, p_ref), neck = nullif(neck, p_ref), hand = nullif(hand, p_ref), pet = nullif(pet, p_ref),
           outfit = nullif(outfit, p_ref), wrist = nullif(wrist, p_ref), hairpin = nullif(hairpin, p_ref),
           top = case when top = p_ref then 'top_baba_yellow' else top end,
           bottom = case when bottom = p_ref then 'bottom_shorts_red' else bottom end,
           shoes = case when shoes = p_ref then 'shoes_dep_blue' else shoes end,
           updated_at = now()
     where account_id = p_from and p_ref in (hat, neck, hand, pet, outfit, wrist, hairpin, top, bottom, shoes);
    select name, greatest(0, coalesce(price, 0)) into v_name, v_value from public.item_catalog where id = p_ref;
  elsif p_kind = 'produce' then
    if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'asset gone' using errcode = '53400'; end if;
    update public.produce_stock set kg = kg - p_qty where account_id = p_from and upland = p_ref and kg >= p_qty;
    if not found then raise exception 'asset gone' using errcode = '53400'; end if;
    select name || ' ' || p_qty || ' kg', (price_per_kg::bigint * p_qty)::int into v_name, v_value
      from public.upland_crops where id = p_ref;
  elsif p_kind in ('wood', 'wild', 'dish', 'item') then                                                  -- 0124 {
    if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'asset gone' using errcode = '53400'; end if;
    v_value := public._forest_goods_value(p_kind, p_ref, p_qty);
    if v_value is null then raise exception 'bad kind' using errcode = '22023'; end if;
    perform public._forest_goods_take(p_from, p_kind, p_ref, p_qty);
    v_name := public._econ_name(p_kind, p_ref, p_qty);                                                    -- 0124 }
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  insert into public.mail_items (mail_id, kind, ref, qty, name, value)
  values (p_mail, p_kind, p_ref, p_qty, coalesce(v_name, p_ref), coalesce(v_value, 0));
end $$;
revoke all on function public._mail_take(bigint, uuid, text, text, integer) from public, anon, authenticated;

-- _mail_claim_one (0115_rod_builds.sql, verbatim but for the lines marked 0124)
create or replace function public._mail_claim_one(p_account uuid, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.mail; r record; v_n integer; v_bait integer; v_p2p boolean; v_skipped jsonb := '[]'::jsonb;
begin
  select * into m from public.mail where id = p_id and account_id = p_account and deleted_at is null for update;
  if not found then raise exception 'no mail' using errcode = '53400'; end if;
  if m.claimed_at is not null then raise exception 'already claimed' using errcode = '53400'; end if;
  if m.expires_at <= now() then raise exception 'mail expired' using errcode = '53400'; end if;
  perform public._wallet_lock(p_account);
  v_p2p := m.kind in ('trade', 'market', 'return');
  -- room, before anything moves
  select count(*) into v_n from public.mail_fish where mail_id = m.id;
  if v_n > 0 and (select count(*) from public.fish where account_id = p_account) + v_n > 1 + public._bucket_cap(p_account) then
    raise exception 'bucket full' using errcode = '53400';
  end if;
  select coalesce(sum(i.qty), 0) into v_bait from public.mail_items i join public.shop_items s on s.id = i.ref
   where i.mail_id = m.id and i.kind = 'item' and s.kind = 'bait';
  if v_bait > 0 and public._bait_total(p_account) + v_bait > public._bait_cap(p_account) then
    raise exception 'bait full' using errcode = '53400';
  end if;
  if exists (select 1 from public.mail_items i join public.shop_items s on s.id = i.ref
              where i.mail_id = m.id and i.kind = 'item' and s.kind not in ('bait', 'rod')   -- 0115 was: where i.mail_id = m.id and i.kind = 'item' and s.kind <> 'bait'
                and coalesce((select v.qty from public.inventory v where v.account_id = p_account and v.item_id = i.ref), 0) + i.qty > 99) then
    raise exception 'bag full' using errcode = '53400';
  end if;
  -- 0115 {
  if (select count(*) from public.rods where account_id = p_account)
     + coalesce((select sum(i.qty) from public.mail_items i join public.shop_items s on s.id = i.ref
                  where i.mail_id = m.id and i.kind = 'item' and s.kind = 'rod'), 0) > 20 then
    raise exception 'bag full' using errcode = '53400';
  end if;
  -- 0115 }
  if v_p2p and exists (select 1 from public.mail_items i where i.mail_id = m.id and i.kind = 'fashion'
                         and exists (select 1 from public.account_items a where a.account_id = p_account and a.item_id = i.ref)) then
    raise exception 'already owned' using errcode = '53400';
  end if;
  -- the move
  for r in select * from public.mail_items where mail_id = m.id order by id loop
    -- 0115 {
    -- a rod: that many instances in the bag
    if r.kind = 'item' and exists (select 1 from public.shop_items where id = r.ref and kind = 'rod') then
      perform public._rod_add(p_account, r.ref) from generate_series(1, r.qty);
    -- 0115 }
    elsif r.kind = 'item' then   -- 0115 was: if r.kind = 'item' then
      insert into public.inventory (account_id, item_id, qty) values (p_account, r.ref, r.qty)
      on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
    elsif r.kind = 'fashion' then
      insert into public.account_items (account_id, item_id, acquired_at) values (p_account, r.ref, now())
      on conflict (account_id, item_id) do nothing;
      if not found then v_skipped := v_skipped || jsonb_build_array(r.name); end if;   -- a gift already owned
    elsif r.kind = 'fish' then
      -- the same row back (same id, old caught_at): not a catch (mt.catch is not set)
      insert into public.fish (id, account_id, species_id, weight_g, price, caught_at)
      select f.id, p_account, f.species_id, f.weight_g, f.price, f.caught_at from public.mail_fish f
       where f.id = public._econ_uuid(r.ref) and f.mail_id = m.id;
      if not found then raise exception 'asset gone' using errcode = '53400'; end if;
      delete from public.mail_fish where id = public._econ_uuid(r.ref);
    elsif r.kind = 'produce' then
      insert into public.produce_stock (account_id, upland, kg) values (p_account, r.ref, r.qty)
      on conflict (account_id, upland) do update set kg = public.produce_stock.kg + excluded.kg;
    elsif r.kind in ('wood', 'wild', 'dish') then                                                         -- 0124
      perform public._forest_goods_give(p_account, r.kind, r.ref, r.qty);                                  -- 0124
    end if;
  end loop;
  if m.xu > 0 then
    perform public._pay(p_account, m.xu, m.xu_reason, 'mail #' || m.id);
  end if;
  update public.mail set claimed_at = now(), read_at = coalesce(read_at, now()) where id = m.id;
  return jsonb_build_object('id', m.id, 'xu', m.xu, 'items', public._mail_items_json(m.id), 'skipped', v_skipped);
end $$;
revoke all on function public._mail_claim_one(uuid, bigint) from public, anon, authenticated;

