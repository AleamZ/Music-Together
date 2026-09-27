-- v18.5: Chợ Lớn's own depots, Vựa cá Chợ Lớn and Vựa nông sản, pay MARKET_DEPOT_PCT = 120 percent of what the pond's
-- and the field's depots pay (the reward for making the trip). The bodies are copied from sell_fish (0015), sell_rice
-- (0015) and sell_produce (0016); only the payout changes: (pay * 120) / 100, integer, rounded down. The ledger reasons
-- stay the old ones ('sell', 'rice_sell', 'produce_sell'), so the coin_ledger reason check is untouched.
-- Mirrors lib/game/market/depots.ts. Also (v18.5, needs 0027): sell_vehicle, ông Tám buying a vehicle back at 50%.

create or replace function public._market_depot_pay(p_xu integer) returns integer
language sql immutable
as $$ select (p_xu * 120) / 100 $$;

create or replace function public.sell_fish_market(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer; v_pay integer;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  with sold as (
    delete from public.fish where account_id = v_account and id = any(coalesce(p_fish_ids, '{}'::uuid[])) returning price
  ) select count(*), coalesce(sum(price), 0) into v_count, v_sum from sold;
  if v_count = 0 then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  v_pay := public._market_depot_pay(v_sum);
  perform public._pay(v_account, v_pay, 'sell', v_count || ' con (Chợ Lớn)');
  return jsonb_build_object('sold', v_count, 'earned', v_pay, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.sell_rice_market(p_session_token text, p_variety text, p_dry boolean, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v public.rice_varieties; rs public.rice_stock; v_pay integer;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  if p_kg is null or p_kg < 1 or p_dry is null then
    return public._ac_flag(v_account, 'bad_qty', 'sell_rice_market',
                           jsonb_build_object('variety', left(p_variety, 32), 'kg', p_kg, 'dry', p_dry), null, 'invalid quantity');
  end if;
  v := public._variety(p_variety);
  if v.id is null then
    raise exception 'invalid variety' using errcode = '22023';
  end if;
  select * into rs from public.rice_stock where account_id = v_account and variety = p_variety for update;
  if not found or (case when p_dry then rs.dry_kg else rs.wet_kg end) < p_kg then
    raise exception 'not enough rice' using errcode = '22023';
  end if;
  v_pay := case when p_dry then p_kg * v.price_per_kg else (p_kg * v.price_per_kg * 7) / 10 end;
  v_pay := public._market_depot_pay(v_pay);
  update public.rice_stock
     set dry_kg = dry_kg - case when p_dry then p_kg else 0 end, wet_kg = wet_kg - case when p_dry then 0 else p_kg end
   where account_id = v_account and variety = p_variety;
  perform public._pay(v_account, v_pay, 'rice_sell',
                      p_variety || case when p_dry then ' dry ' else ' wet ' end || p_kg || ' kg (Chợ Lớn)');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

create or replace function public.sell_produce_market(p_session_token text, p_upland text, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; u public.upland_crops; ps public.produce_stock;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  if p_kg is null or p_kg < 1 then
    return public._ac_flag(v_account, 'bad_qty', 'sell_produce_market', jsonb_build_object('upland', left(p_upland, 32), 'kg', p_kg),
                           null, 'invalid quantity');
  end if;
  u := public._upland(p_upland);
  if u.id is null then
    raise exception 'invalid crop' using errcode = '22023';
  end if;
  select * into ps from public.produce_stock where account_id = v_account and upland = p_upland for update;
  if not found or ps.kg < p_kg then
    raise exception 'not enough crop' using errcode = '22023';
  end if;
  update public.produce_stock set kg = kg - p_kg where account_id = v_account and upland = p_upland;
  perform public._pay(v_account, public._market_depot_pay(p_kg * u.price_per_kg), 'produce_sell',
                      p_upland || ' ' || p_kg || ' kg (Chợ Lớn)');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- ông Tám buys an owned vehicle back at half its catalog price (rounded down). The ledger reason is 'sell' (already in
-- the reason check since 0012), detail 'vehicle: <id>'.
create or replace function public.sell_vehicle(p_session_token text, p_vehicle text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.vehicle_catalog; v_bal int;
begin
  v_account := public._auth_account(p_session_token);
  select * into c from public.vehicle_catalog where id = p_vehicle;
  if not found then raise exception 'unknown vehicle' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  delete from public.owned_vehicles where account_id = v_account and vehicle_id = p_vehicle;
  if not found then raise exception 'not owned' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, (c.price * 50) / 100, 'sell', 'vehicle: ' || p_vehicle);
  return jsonb_build_object('owned', public._owned_vehicles(v_account), 'coins', v_bal);
end; $$;

revoke all on function public.sell_vehicle(text, text) from public;
grant execute on function public.sell_vehicle(text, text) to anon, authenticated;

revoke all on function public._market_depot_pay(integer) from public, anon, authenticated;
revoke all on function public.sell_fish_market(text, uuid[]) from public;
revoke all on function public.sell_rice_market(text, text, boolean, integer) from public;
revoke all on function public.sell_produce_market(text, text, integer) from public;
grant execute on function public.sell_fish_market(text, uuid[]) to anon, authenticated;
grant execute on function public.sell_rice_market(text, text, boolean, integer) to anon, authenticated;
grant execute on function public.sell_produce_market(text, text, integer) to anon, authenticated;
