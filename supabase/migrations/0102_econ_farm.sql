-- =========================================================
-- 0102_econ_farm.sql — Kinh tế v2, the farm (spec docs/superpowers/specs/2026-09-30-economy-v2-design.md §5).
-- ADDITIVE and re-runnable. Run after 0101 (it re-creates no function 0101 does, so it also applies right after 0100).
-- Every re-created function is copied verbatim from its newest body, with only the lines marked "econ v2" added or
-- changed.
--   A. Plot caps per account across all rooms (A1): _farm_count counts the plots an account farms in every room it may
--      still act in (_room_open_for: a closed room's plots count for nobody), _owns_land any private plot in such a room;
--      their callers (rent, buy, buy a listing, offer, accept an offer, rent a sublease) keep their signatures, so the
--      limits become 2 farmed plots and 1 private plot in total. Nothing is taken away: an account already over a cap
--      keeps its plots and leases and farms them as before; only a new rent, purchase, sublease or offer is refused
--      until it is under the cap. _field_view gives the client the totals ('mine': farm_total, owns_land) and the fee
--      (p2p_fee_pct).
--   B. The processor (A2): Máy chế biến 10 000 → 50 000 (_machine_price); the recipes pay ≈ 1.15× the field price of
--      their input (processor_recipes.value); the sort bonus +2 / +5 % → +1 / +2 % (_sort_bonus: process_sort_finish
--      reads it, so it is unchanged).
--   C. Player land deals (A3): sale listings and offers in the band 400 000–2 400 000 (the checks and _farm_do_list /
--      _farm_do_offer); _land_sale pays the seller floor(price × (100 − p2p_fee_pct) / 100) — the buyer still pays the
--      price, the rest is burned; subleases at most 50 000 (was 100 000), and _farm_do_rent_sublease pays the owner the
--      same share. Listings, subleases and offers outside the new bounds are withdrawn first (nobody agreed to another
--      price); leases already paid stay.
--   D. crop_harvest (A4): a game event (qty 1, via _game_event) when a plot's crop is in — the sixth rice part cut by
--      hand (_farm_do_harvest_part), the harvester's job paid by the sweep (_field_sweep step J), the last hoa-màu
--      picking (_farm_do_harvest). It unblocks quest n_nghe_1 ("Thu hoạch mùa màng") and the nông dân harvest XP rule.
--   E. Thương lái (A5): sell_critters and _rat_do_sell (sell_rats) pay _npc_sale(account, the catch prices); the answers
--      keep 'sold' (its xu = what was paid) and add 'npc_cut' and 'npc'. _farm_mine carries 'npc' (the day's thương lái
--      totals) for the depot panel.
-- Not changed: tool_sickle stays on sale — a wipe empties the inventory while the newcomer gift is once per account, so a
-- pardoned account could never get a sickle back.
-- =========================================================

-- ---------- A. Plot caps per account (A1) ----------
create or replace function public._farm_count(p_room uuid, p_account uuid, p_now timestamptz) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select count(*)::int from public.field_plots fp
   where (fp.owner_id = p_account                                                             -- econ v2: every room
          or exists (select 1 from public.plot_leases pl                                        -- econ v2
                      where pl.room_id = fp.room_id and pl.plot_no = fp.plot_no and pl.farmer_id = p_account))   -- econ v2
     and public._farmer(fp.room_id, fp.plot_no, p_now) = p_account                              -- econ v2: was this room's
     and public._room_open_for(fp.room_id, p_account)                                          -- econ v2: not a closed room
$$;

create or replace function public._owns_land(p_room uuid, p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.field_plots fp where fp.owner_id = p_account          -- econ v2: every room
                        and public._room_open_for(fp.room_id, p_account)) $$;                    -- econ v2: not a closed room

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
      'farm_total', public._farm_count(p_room, p_viewer, p_now),                                 -- econ v2 (A1): every room
      'owns_land', public._owns_land(p_room, p_viewer),                                          -- econ v2 (A1): every room
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
    'critter_prices', public._critter_prices(p_room, p_now),
    'rats', public._rats_view(p_room, p_now),                                        -- v17 (econ v2: a comma)
    'p2p_fee_pct', coalesce(public._econ_param('p2p_fee_pct'), 5))                  -- econ v2 (A3): the burn on land deals
$$;

-- ---------- B. The processor (A2) ----------
create or replace function public._machine_price(p_machine text) returns integer
language sql immutable parallel safe
as $$ select case p_machine when 'sprinkler' then 6000 when 'harvester' then 15000 when 'processor' then 50000 end $$;   -- econ v2: processor 10 000 → 50 000

-- ≈ 1.15× the field price of the input (was ≈ 1.35–1.50×): 10 kg dry short 7 100, nếp 9 500, thơm 13 500; 10 kg khoai
-- 2 650, bắp 4 600; 5 kg ớt 7 950.
update public.processor_recipes r set value = x.value
  from (values ('gao_trang', 8150), ('banh_tet', 10900), ('gao_thom', 15500),
               ('khoai_say', 3050), ('bot_bap', 5300), ('tuong_ot', 9150)) x(id, value)
 where r.id = x.id and r.value <> x.value;

create or replace function public._sort_bonus(p_score integer) returns integer
language sql immutable parallel safe
as $$ select case when p_score >= 11 then 2 when p_score >= 8 then 1 else 0 end $$;   -- econ v2: was 5 / 2

-- ---------- C. Player land deals (A3) ----------
-- Listings, subleases and offers outside the new bounds are withdrawn: nobody agreed to another price.
update public.field_plots set sale_price = null where sale_price is not null and sale_price not between 400000 and 2400000;
update public.field_plots set sublease_price = null where sublease_price is not null and sublease_price > 50000;
delete from public.land_offers where price not between 400000 and 2400000;
alter table public.field_plots drop constraint if exists field_plots_sale_price_check;
alter table public.field_plots add constraint field_plots_sale_price_check check (sale_price between 400000 and 2400000);
alter table public.field_plots drop constraint if exists field_plots_sublease_price_check;
alter table public.field_plots add constraint field_plots_sublease_price_check check (sublease_price between 1 and 50000);
alter table public.land_offers drop constraint if exists land_offers_price_check;
alter table public.land_offers add constraint land_offers_price_check check (price between 400000 and 2400000);

create or replace function public._farm_do_list(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if p_price is not null then
    if p_price < 400000 or p_price > 2400000 then                                      -- econ v2 (A3): was 1–5 000 000
      raise exception 'invalid price' using errcode = '22023';
    end if;
    if public._has_crop(p_room, p_plot) then
      raise exception 'crop exists' using errcode = '22023';
    end if;
    if public._leased(p_room, p_plot, p_now) then
      raise exception 'leased' using errcode = '22023';
    end if;
  end if;
  update public.field_plots set sale_price = p_price where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_offer(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                 p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_price is null or p_price < 400000 or p_price > 2400000 then                     -- econ v2 (A3): was 1–5 000 000
    raise exception 'invalid price' using errcode = '22023';
  end if;
  if public._owns_land(p_room, p_account) then
    raise exception 'already own land' using errcode = '22023';
  end if;
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (p_room, p_plot, p_account, p_price, p_now)
  on conflict (room_id, plot_no, buyer_id) do update
    set id = gen_random_uuid(), price = excluded.price, created_at = excluded.created_at;
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._land_sale(p_room uuid, p_plot integer, p_buyer uuid, p_price integer, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seller uuid;
        v_fee numeric := coalesce(public._econ_param('p2p_fee_pct'), 5);                -- econ v2 (A3)
begin
  select owner_id into v_seller from public.field_plots where room_id = p_room and plot_no = p_plot;
  perform public._wallet_lock(p_buyer);
  perform public._wallet_lock(v_seller);
  perform public._pay(p_buyer, -p_price, 'land_buy', 'plot ' || p_plot);
  perform public._pay(v_seller, floor(p_price * (100 - v_fee) / 100)::integer, 'land_sell', 'plot ' || p_plot);   -- econ v2: the fee is burned
  update public.field_plots set owner_id = p_buyer, owned_at = p_now, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
  values (p_room, null, 'Hợp tác xã',
          format('[land:%s] 🏡 %s đã mua thửa %s của %s với giá %s xu.', p_plot,
                 (select username from public.accounts where id = p_buyer), p_plot,
                 (select username from public.accounts where id = v_seller),
                 replace(to_char(p_price, 'FM9,999,999'), ',', '.')),
          true, p_buyer);
  delete from public.chat_messages
   where room_id = p_room
     and id not in (select id from public.chat_messages where room_id = p_room order by created_at desc limit 200);
end; $$;

create or replace function public._farm_do_set_sublease(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                        p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if p_price is not null then
    if p_price < 1 or p_price > 50000 then                                             -- econ v2 (A3): was 100 000
      raise exception 'invalid price' using errcode = '22023';
    end if;
    if public._has_crop(p_room, p_plot) then
      raise exception 'crop exists' using errcode = '22023';
    end if;
    if public._leased(p_room, p_plot, p_now) then
      raise exception 'leased' using errcode = '22023';
    end if;
  end if;
  update public.field_plots set sublease_price = p_price where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_rent_sublease(p_room uuid, p_account uuid, p_plot integer, p_expected integer,
                                                         p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
        v_fee numeric := coalesce(public._econ_param('p2p_fee_pct'), 5);                -- econ v2 (A3)
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null or f.sublease_price is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_expected is distinct from f.sublease_price then
    raise exception 'price changed' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'plot taken' using errcode = '22023';
  end if;
  if public._has_crop(p_room, p_plot) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < f.sublease_price then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._wallet_lock(f.owner_id);
  perform public._pay(p_account, -f.sublease_price, 'lease_pay', 'plot ' || p_plot);
  perform public._pay(f.owner_id, floor(f.sublease_price * (100 - v_fee) / 100)::integer, 'lease_income', 'plot ' || p_plot);   -- econ v2: the fee is burned
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (p_room, p_plot, p_account, 'owner', f.sublease_price, p_now, p_now + interval '96 hours');
  update public.field_plots set sublease_price = null, sale_price = null where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- ---------- D. crop_harvest (A4) ----------
create or replace function public._farm_do_harvest_part(p_room uuid, p_account uuid, p_plot integer, p_success boolean,
                                                        p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v public.rice_varieties; f public.field_plots; v_y integer; v_i integer; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind <> 'rice' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  if not coalesce(p_success, false) then
    update public.crops set work = null, work_started_at = null where room_id = p_room and plot_no = p_plot;
    return public._field_view(p_room, p_account, p_now);
  end if;
  if c.work is distinct from 'harvest' or c.work_started_at is null or p_now - c.work_started_at < interval '8 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
  if p_now - c.work_started_at > interval '120 seconds' then
    raise exception 'work expired' using errcode = '22023';
  end if;
  v := public._variety(c.variety);
  perform public._work_check(c, v, 'harvest', p_now);
  f := public._plot_row(p_room, p_plot);
  v_y := (public._crop_yield(c, v, case when f.kind = 'private' then 1.1 else 1.0 end, 1.0, p_now)->>'kg')::int;
  v_i := c.harvested_parts + 1;
  v_kg := public._part_kg(v_i, v_y);
  perform public._rice_add(p_account, c.variety, v_kg, 0);
  if v_i = 6 then
    delete from public.crops where room_id = p_room and plot_no = p_plot;
    delete from public.plot_leases where room_id = p_room and plot_no = p_plot;
    perform public._game_event(p_account, 'crop_harvest', 1,                             -- econ v2 (A4): the plot's crop is in
                               jsonb_build_object('kind', 'rice', 'crop', c.variety, 'kg', c.harvested_kg + v_kg, 'via', 'hand'));   -- econ v2
  else
    update public.crops set harvested_parts = v_i, harvested_kg = harvested_kg + v_kg, work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest_part', jsonb_build_object('variety', c.variety, 'kg', v_kg, 'parts', v_i,
                                                                 'total', c.harvested_kg + v_kg, 'done', v_i = 6));
end; $$;

create or replace function public._farm_do_harvest(p_room uuid, p_account uuid, p_plot integer, p_quality double precision,
                                                   p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; u public.upland_crops; f public.field_plots; v_k integer; v_n integer; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind <> 'upland' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  perform public._work_gate(c, 'harvest', p_now);
  perform public._work_check(c, null, 'harvest', p_now);
  u := public._upland(c.upland);
  f := public._plot_row(p_room, p_plot);
  v_k := public._up_next(c, u, p_now);
  v_n := jsonb_array_length(u.pickings);
  v_kg := (public._up_yield(c, u, case when f.kind = 'private' then 1.1 else 1.0 end, v_k, p_now)->>'kg')::int;
  perform public._produce_add(p_account, c.upland, v_kg);
  if v_k = v_n then
    delete from public.crops where room_id = p_room and plot_no = p_plot;
    delete from public.plot_leases where room_id = p_room and plot_no = p_plot;
    perform public._game_event(p_account, 'crop_harvest', 1,                             -- econ v2 (A4): the last picking
                               jsonb_build_object('kind', 'upland', 'crop', c.upland, 'via', 'hand',   -- econ v2
                                                  'kg', v_kg + coalesce((select sum((x->>'kg')::int)      -- econ v2
                                                                           from jsonb_array_elements(c.harvests) x), 0)));   -- econ v2
  else
    update public.crops
       set harvests = harvests || jsonb_build_array(jsonb_build_object('t', p_now, 'k', v_k, 'kg', v_kg)),
           work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest', jsonb_build_object('upland', c.upland, 'kg', v_kg, 'k', v_k, 'pickings', v_n,
                                                            'done', v_k = v_n));
end; $$;

create or replace function public._field_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots; d public.drying_slots; c public.crops; v_y integer;
begin
  -- 0a. banned accounts leave the land market: an anti-cheat ban (review pending or wiped) or a ban set by hand
  delete from public.land_offers lo
   where lo.room_id = p_room
     and (exists (select 1 from public.accounts a where a.id = lo.buyer_id and a.is_banned)
          or exists (select 1 from public.anticheat_status s where s.account_id = lo.buyer_id and s.ban_state is not null));
  update public.field_plots fp set sale_price = null, sublease_price = null
   where fp.room_id = p_room and (fp.sale_price is not null or fp.sublease_price is not null)
     and (exists (select 1 from public.accounts a where a.id = fp.owner_id and a.is_banned)
          or exists (select 1 from public.anticheat_status s where s.account_id = fp.owner_id and s.ban_state is not null));
  -- 0b. a wipe releases what the account held at the time of the wipe, without refund
  delete from public.plot_leases pl using public.anticheat_status s
   where pl.room_id = p_room and s.account_id = pl.farmer_id and s.wiped_at is not null and pl.starts_at <= s.wiped_at;
  update public.field_plots fp set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
    from public.anticheat_status s
   where fp.room_id = p_room and s.account_id = fp.owner_id and s.wiped_at is not null
     and (fp.owned_at is null or fp.owned_at <= s.wiped_at);
  delete from public.land_offers lo using public.anticheat_status s
   where lo.room_id = p_room and s.account_id = lo.buyer_id and s.wiped_at is not null and lo.created_at <= s.wiped_at;
  delete from public.drying_slots ds using public.anticheat_status s
   where ds.room_id = p_room and s.account_id = ds.account_id and s.wiped_at is not null
     and ds.ready_at <= s.wiped_at + interval '3 hours';
  -- 0c. offers on a plot that has no owner any more (a release above, or a deleted account)
  delete from public.land_offers lo using public.field_plots fp
   where lo.room_id = p_room and fp.room_id = lo.room_id and fp.plot_no = lo.plot_no and fp.owner_id is null;
  -- J. finished harvester jobs: lock the crop row, re-check it, pay the parts still uncut at the job's end, end the lease
  for c in select cr.* from public.crops cr
            where cr.room_id = p_room and cr.harvester_until is not null and cr.harvester_until <= p_now
            order by cr.plot_no for update loop
    if c.farmer_id = public._farmer(p_room, c.plot_no, c.harvester_at) then
      v_y := (public._crop_yield(c, public._variety(c.variety),
                                 case when (select fp.kind from public.field_plots fp
                                             where fp.room_id = p_room and fp.plot_no = c.plot_no) = 'private' then 1.1 else 1.0 end,
                                 1.0, c.harvester_until)->>'kg')::int;
      perform public._rice_add(c.farmer_id, c.variety, v_y - (c.harvested_parts * v_y) / 6, 0);   -- the parts left: R5
      delete from public.plot_leases where room_id = p_room and plot_no = c.plot_no;
      perform public._game_event(c.farmer_id, 'crop_harvest', 1,                           -- econ v2 (A4): the harvester finished it
                                 jsonb_build_object('kind', 'rice', 'crop', c.variety, 'via', 'harvester',   -- econ v2
                                                    'kg', c.harvested_kg + v_y - (c.harvested_parts * v_y) / 6));   -- econ v2
    end if;
    delete from public.crops where room_id = p_room and plot_no = c.plot_no;
  end loop;
  -- 1. leases end (the leaseholder's crop goes in step 4)
  delete from public.plot_leases where room_id = p_room and until <= p_now;
  -- 2. offers expire after 24 h
  delete from public.land_offers where room_id = p_room and created_at <= p_now - interval '24 hours';
  -- 3. reclaim: the owner left the room or has not visited it for 14 days, and the plot is not leased out (§7.6)
  for f in select fp.* from public.field_plots fp
            where fp.room_id = p_room and fp.owner_id is not null
              and not exists (select 1 from public.members m
                               where m.room_id = p_room and m.account_id = fp.owner_id
                                 and coalesce(m.last_seen_at, m.joined_at) > p_now - interval '14 days')
              and not exists (select 1 from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = fp.plot_no)
            order by fp.plot_no loop
    update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
     where room_id = p_room and plot_no = f.plot_no;
    delete from public.land_offers where room_id = p_room and plot_no = f.plot_no;
    perform public._wallet_lock(f.owner_id);
    perform public._pay(f.owner_id, 400000, 'land_refund', 'plot ' || f.plot_no);
  end loop;
  -- 4. a crop belongs to the plot's farmer: a crop left by an ended lease or a reclaim is lost, with its uncut parts and
  --    untaken pickings (R26)
  delete from public.crops cr
   where cr.room_id = p_room and cr.farmer_id is distinct from public._farmer(p_room, cr.plot_no, p_now);
  -- 5. sprouted seed not sown 24 h after sprouting (soak + 26 h) rots: the plot goes back to prepared, or to bare
  delete from public.crops
   where room_id = p_room and sow_at is null and prepared_at is null and p_now >= soak_at + interval '26 hours';
  update public.crops set rotted_at = soak_at + interval '26 hours', soak_at = null, variety = null
   where room_id = p_room and sow_at is null and p_now >= soak_at + interval '26 hours';
  -- 6. rice left 48 h after its ripe window has all fallen (not while a harvester runs: step J pays it first); hoa màu
  --    whose last picking is lost. The lease stays (R26).
  delete from public.crops cr using public.rice_varieties rv
   where cr.room_id = p_room and cr.kind = 'rice' and rv.id = cr.variety and cr.transplant_at is not null
     and cr.harvester_until is null and p_now >= public._plus_h(cr.transplant_at, 48 * rv.scale + 60);
  delete from public.crops cr using public.upland_crops u
   where cr.room_id = p_room and cr.kind = 'upland' and u.id = cr.upland and cr.plant_at is not null
     and public._up_next(cr, u, p_now) = 0;
  -- 7. a drying batch left 24 h after it is ready is collected for its owner
  for d in delete from public.drying_slots where room_id = p_room and ready_at <= p_now - interval '24 hours' returning * loop
    perform public._rice_add(d.account_id, d.variety, 0, d.kg);
  end loop;
end; $$;

-- ---------- E. Thương lái (A5) ----------
create or replace function public.sell_critters(p_session_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_n integer; v_xu integer;
        v_pay integer;                                                                  -- econ v2 (A5)
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  if p_kind is not null and not exists (select 1 from public.critter_kinds where id = p_kind) then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  with sold as (
    delete from public.critters where account_id = v_account and (p_kind is null or kind = p_kind) returning price
  ) select count(*)::int, coalesce(sum(price), 0)::int into v_n, v_xu from sold;
  if v_n = 0 then
    raise exception 'no critters' using errcode = '22023';
  end if;
  v_pay := public._npc_sale(v_account, v_xu);                                             -- econ v2 (A5): the thương lái
  if v_pay > 0 then                                                                        -- econ v2
    perform public._pay(v_account, v_pay, 'critter_sell', coalesce(p_kind, 'all') || ' x' || v_n);   -- econ v2: v_pay (was v_xu)
  end if;                                                                                  -- econ v2
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account),
                            'sold', jsonb_build_object('n', v_n, 'xu', v_pay),            -- econ v2: what was paid
                            'npc_cut', v_xu - v_pay, 'npc', public._npc_quota(v_account));   -- econ v2
end $$;

create or replace function public._rat_do_sell(p_account uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer; v_xu integer;
        v_pay integer;                                                                  -- econ v2 (A5)
begin
  perform public._wallet_lock(p_account);
  with sold as (delete from public.rat_bag where account_id = p_account returning price)
  select count(*)::int, coalesce(sum(price), 0)::int into v_n, v_xu from sold;
  if v_n = 0 then
    raise exception 'nothing to sell' using errcode = '22023';
  end if;
  v_pay := public._npc_sale(p_account, v_xu);                                             -- econ v2 (A5): the thương lái
  if v_pay > 0 then                                                                        -- econ v2
    perform public._pay(p_account, v_pay, 'rat_sell', v_n || ' con');                      -- econ v2: v_pay (was v_xu)
  end if;                                                                                  -- econ v2
  return jsonb_build_object('server_now', p_now, 'mine', public._farm_mine(p_account),
                            'sold', jsonb_build_object('count', v_n, 'xu', v_pay),        -- econ v2: what was paid
                            'npc_cut', v_xu - v_pay, 'npc', public._npc_quota(p_account));   -- econ v2
end $$;

create or replace function public._farm_mine(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty order by i.item_id)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food')), '{}'::jsonb),
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
                                          from public.farm_profiles pr where pr.account_id = p_account), 200) as left_today) d),
    -- v17: the rats in the bag, the caps and the dog
    'rats', (select jsonb_build_object('count', count(*)::int, 'value', coalesce(sum(b.price), 0)::int)
               from public.rat_bag b where b.account_id = p_account),
    'rat_caps', public._rat_caps_view(p_account, now()),
    'dog', public._dog_view(p_account),                                             -- econ v2: a comma
    'npc', public._npc_quota(p_account))                                            -- econ v2 (A5): the thương lái's day
$$;

-- ---------- Privileges (unchanged: the helpers stay private, the RPC stays callable) ----------
revoke all on function public._farm_count(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._owns_land(uuid, uuid) from public, anon, authenticated;
revoke all on function public._field_view(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._machine_price(text) from public, anon, authenticated;
revoke all on function public._sort_bonus(integer) from public, anon, authenticated;
revoke all on function public._farm_do_list(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_offer(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._land_sale(uuid, integer, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_set_sublease(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_rent_sublease(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_harvest_part(uuid, uuid, integer, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_harvest(uuid, uuid, integer, double precision, timestamptz) from public, anon, authenticated;
revoke all on function public._field_sweep(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_do_sell(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
grant execute on function public.sell_critters(text, text) to anon, authenticated;
