-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0013, from the repo
-- root (the crop fixtures are read with \copy). Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on

create temp table smoke (k text primary key, v text);
insert into smoke select 't1', token from public.register('smoke15_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('smoke15_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('smoke15_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Đồng test', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'code', code from public.rooms where id = (select v from smoke where k = 'room')::uuid;
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't2'));
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't3'));

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---------- the crop model against the shared fixtures ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/crop-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;

create function pg_temp.fx_at(t0 timestamptz, h jsonb) returns timestamptz language sql
as $$ select t0 + make_interval(secs => (h #>> '{}')::double precision * 3600) $$;

create function pg_temp.fx_log(t0 timestamptz, a jsonb, k text) returns jsonb language sql
as $$ select coalesce(jsonb_agg(case when k = 't' then jsonb_build_object('t', pg_temp.fx_at(t0, e))
                                     else jsonb_build_object('t', pg_temp.fx_at(t0, e->0), k, e->1) end order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

create function pg_temp.fx_crop(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'variety', k->>'variety', 'prepared_at', t0,
  'soak_at', pg_temp.fx_at(t0, k->'soak'), 'sow_at', pg_temp.fx_at(t0, k->'sow'),
  'transplant_at', pg_temp.fx_at(t0, k->'transplant'), 'q_transplant', k->'q_transplant',
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'), 'picks', pg_temp.fx_log(t0, k->'picks', 't'),
  'pest_rolls', k->'pest_rolls')) $$;

do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        v public.rice_varieties; h timestamptz; y jsonb; got jsonb; want jsonb; f text;
begin
  for k in select x from jsonb_array_elements(j->'cases') x loop
    c := pg_temp.fx_crop(t0, k);
    v := public._variety(k->>'variety');
    h := pg_temp.fx_at(t0, k->'harvest');
    y := public._crop_yield(c, v, (k->>'land')::double precision, (k->>'q_harvest')::double precision, h);
    assert (y->>'kg')::int = (k->'expect'->>'kg')::int, format('%s: kg %s, want %s', k->>'name', y->>'kg', k->'expect'->>'kg');
    foreach f in array array['mcare', 'mseed', 'mwater', 'mpest', 'mlate'] loop
      assert abs((y->>f)::double precision - (k->'expect'->>f)::double precision) < 1e-12,
        format('%s: %s %s, want %s', k->>'name', f, y->>f, k->'expect'->>f);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('kind', p->>'kind',
                                                 'since_s', extract(epoch from (p->>'since')::timestamptz - t0)::int,
                                                 'treated_s', extract(epoch from (p->>'treated_at')::timestamptz - t0)::int)
                              order by (p->>'slot')::int), '[]'::jsonb)
      into got from jsonb_array_elements(public._crop_pests(c, v, h)) p;
    want := k->'expect'->'pests';
    assert got = want, format('%s: pests %s, want %s', k->>'name', got, want);
  end loop;
end $$;

do $$
declare t timestamptz := '2026-03-01 00:00:00+00'; nep public.rice_varieties := public._variety('nep');
        short public.rice_varieties := public._variety('short'); c public.crops;
begin
  -- water: the last level set, one level lower per full 12 h, never below 0; the later of two same-time entries wins
  assert public._water_at('[]'::jsonb, t) = 0, 'no log = dry';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '11 hours 59 minutes') = 3, 'no drop before 12 h';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '12 hours') = 2, 'drop at 12 h';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '100 hours') = 0, 'never below 0';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 1), jsonb_build_object('t', t, 'l', 2)), t) = 2,
    'same-time entries: the last one';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 2)), t - interval '1 second') = 0, 'before the log';

  -- phases (§8.2)
  c := jsonb_populate_record(null::public.crops, jsonb_build_object('prepared_at', t));
  assert public._crop_phase(c, null, t) = 'prepared', 'prepared';
  c.soak_at := t;
  assert public._crop_phase(c, nep, t + interval '1 hour 59 minutes') = 'soaking', 'soaking';
  assert public._crop_phase(c, nep, t + interval '2 hours') = 'sprouted', 'sprouted';
  c.sow_at := t + interval '3 hours';
  assert public._crop_phase(c, nep, t + interval '3 hours') = 'seedling', 'seedling';
  c.transplant_at := t + interval '12 hours';
  assert public._crop_phase(c, nep, t + interval '12 hours') = 'tillering', 'tillering';
  assert public._crop_phase(c, nep, t + interval '29 hours 59 minutes') = 'tillering', 'tillering until 18·s';
  assert public._crop_phase(c, nep, t + interval '30 hours') = 'panicle', 'panicle at 18·s';
  assert public._crop_phase(c, nep, t + interval '42 hours') = 'heading', 'heading at 30·s';
  assert public._crop_phase(c, nep, t + interval '52 hours') = 'ripening', 'ripening at 40·s';
  assert public._crop_phase(c, nep, t + interval '60 hours') = 'ripe', 'ripe at 48·s';
  assert public._crop_phase(c, nep, t + interval '72 hours') = 'overripe', 'overripe after 12 h ripe';
  assert public._crop_phase(c, short, t + interval '55 hours 12 minutes') = 'ripe', 'short: ripe at 43.2 h';
  assert public._crop_phase(c, short, t + interval '55 hours 11 minutes') = 'ripening', 'short: ripening before';
end $$;

-- ---------- v14 changes: the fishing shop sells fishing gear only; the fishing state lists fishing gear only ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); a1 uuid := (select v from smoke where k = 'a1')::uuid; s jsonb;
begin
  insert into public.wallets (account_id, coins) values (a1, 1000) on conflict (account_id) do update set coins = 1000;
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', t1, 'seed_short')) = 'item not available', 'seeds are not fishing gear';
  assert pg_temp.err(format('select public.buy_item(%L, %L)', t1, 'fert_urea')) = 'item not available', 'nor fertilizer';
  insert into public.inventory (account_id, item_id, qty) values (a1, 'seed_nep', 2), (a1, 'rod_bamboo', 1)
  on conflict (account_id, item_id) do update set qty = excluded.qty;
  s := public.fishing_state(t1);
  assert s->'owned' = '["rod_bamboo"]'::jsonb, format('owned lists fishing gear only: %s', s->'owned');
  assert (s->>'server_now')::timestamptz between now() - interval '1 minute' and now() + interval '1 minute', 'server_now';
  delete from public.inventory where account_id = a1;
  update public.wallets set coins = 0 where account_id = a1;
end $$;

select 'v15 crop smoke ok' as result;

-- ---------- land (§7): the private cores, with the clock moved by hand ----------
insert into smoke select 'now', date_trunc('minute', now())::text;
create function pg_temp.coins(a uuid) returns integer language sql as $$ select coins from public.wallets where account_id = a $$;
create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.plot(s jsonb, n integer) returns jsonb language sql as $$ select s->'plots'->(n - 1) $$;

do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; s jsonb;
begin
  -- the first field_state creates the plots
  s := public.field_state(room, t1);
  assert jsonb_array_length(s->'plots') = 10, 'ten plots';
  assert pg_temp.plot(s, 1)->>'kind' = 'private' and pg_temp.plot(s, 4)->>'kind' = 'private'
     and pg_temp.plot(s, 5)->>'kind' = 'village' and pg_temp.plot(s, 10)->>'kind' = 'village', 'plots 1-4 private, 5-10 village';
  assert s->'mine'->'owned_plot' = 'null' and s->'mine'->'farming' = '[]' and s->'drying' = '[]', 'nothing yet';
  assert s->'mine'->'gift_claimed' = 'false' and (s->>'server_now')::timestamptz = now(), 'gift flag and server_now';

  -- visits: touch_room and every field call record them, at most once an hour
  update public.members set last_seen_at = null where room_id = room and account_id = a2;
  perform public.touch_room(room, t2);
  assert (select last_seen_at from public.members where room_id = room and account_id = a2) = now(), 'touch records the visit';
  update public.members set last_seen_at = now() - interval '30 minutes' where room_id = room and account_id = a2;
  perform public.touch_room(room, t2);
  assert (select last_seen_at from public.members where room_id = room and account_id = a2) = now() - interval '30 minutes',
    'at most once an hour';
  update public.members set last_seen_at = now() - interval '2 hours' where room_id = room and account_id = a2;
  perform public.field_state(room, t2);
  assert (select last_seen_at from public.members where room_id = room and account_id = a2) = now(), 'field calls too';
  assert pg_temp.err(format('select public.touch_room(%L, %L)', gen_random_uuid(), t2)) = 'account is not a member of this room',
    'members only';

  -- rent a village plot (§7.2)
  perform pg_temp.set_coins(a1, 20000);
  perform pg_temp.set_coins(a2, 1000);
  perform pg_temp.set_coins(a3, 20000);
  s := public._farm_do_rent(room, a2, 5, t);
  assert pg_temp.coins(a2) = 750, 'rent is 250';
  assert pg_temp.plot(s, 5)->'lease'->>'source' = 'village' and pg_temp.plot(s, 5)->'farmer'->>'id' = a2::text
     and (pg_temp.plot(s, 5)->'lease'->>'until')::timestamptz = t + interval '96 hours', 'a village lease for 96 h';
  assert s->'mine'->'farming' = '[5]', 'farming plot 5';
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'rent' and delta = -250), 'rent ledger';
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 5, %L)', room, a3, t)) = 'plot taken', 'taken';
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 1, %L)', room, a3, t)) = 'invalid plot', 'private plots are not rented';
  perform public._farm_do_rent(room, a2, 6, t);
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 7, %L)', room, a2, t)) = 'farm limit', 'two plots at most';
  perform pg_temp.set_coins(a3, 100);
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 7, %L)', room, a3, t)) = 'not enough coins', 'coins';
  perform pg_temp.set_coins(a3, 20000);
  -- the lease ends after 96 h and takes the leaseholder's crop with it
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 5, a2, t);
  perform public._field_open(room, t + interval '96 hours');
  assert not exists (select 1 from public.plot_leases where room_id = room), 'leases ended';
  assert not exists (select 1 from public.crops where room_id = room), 'the crop went with the lease';
end $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '100 hours'; s jsonb; o uuid; o2 uuid;
begin
  -- buy from the village (§7.3)
  s := public._farm_do_buy_plot(room, a1, 1, t);
  assert pg_temp.coins(a1) = 16000 and pg_temp.plot(s, 1)->'owner'->>'id' = a1::text
     and s->'mine'->'owned_plot' = '1', 'bought plot 1';
  assert s->'mine'->'farming' = '[1]', 'an unleased own plot is farmed';
  assert exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'land_buy' and delta = -4000), 'ledger';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 2, %L)', room, a1, t)) = 'already own land', 'one per room';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', room, a3, t)) = 'not for sale', 'owned';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 5, %L)', room, a3, t)) = 'not for sale', 'village land';
  perform public._farm_do_rent(room, a2, 5, t);
  perform public._farm_do_rent(room, a2, 6, t);
  perform pg_temp.set_coins(a2, 10000);
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 2, %L)', room, a2, t)) = 'farm limit', 'land counts too';

  -- the owner's own crop blocks selling, listing and subleasing
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 1, a1, t);
  assert pg_temp.err(format('select public._farm_do_sell_to_village(%L, %L, 1, %L)', room, a1, t)) = 'crop exists', 'sell';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 9000, %L)', room, a1, t)) = 'crop exists', 'list';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'crop exists', 'sublease';
  delete from public.crops where room_id = room;

  -- list, and buy a listed plot at exactly its price
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 9000, %L)', room, a2, t)) = 'not your plot', 'owner lists';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 0, %L)', room, a1, t)) = 'invalid price', 'price range';
  s := public._farm_do_list(room, a1, 1, 9000, t);
  assert pg_temp.plot(s, 1)->'sale_price' = '9000', 'listed';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 8000, %L)', room, a3, t)) = 'price changed', 'exact price';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 9000, %L)', room, a1, t)) = 'invalid plot', 'not your own';
  s := public._farm_do_buy_listed(room, a3, 1, 9000, t);
  assert pg_temp.plot(s, 1)->'owner'->>'id' = a3::text and pg_temp.plot(s, 1)->'sale_price' = 'null', 'sold to a3';
  assert pg_temp.coins(a3) = 11000 and pg_temp.coins(a1) = 25000, 'paid 9 000';
  assert exists (select 1 from public.chat_messages where room_id = room and account_id is null and username = 'Hợp tác xã'
                   and body like '[land:1] 🏡 % đã mua thửa 1 của % với giá 9.000 xu.'), 'announced in chat';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 9000, %L)', room, a2, t)) = 'not for sale', 'sold once';

  -- offers: the owner sees them best first, checks the buyer on acceptance, and a re-offer gets a new id
  perform public._farm_do_offer(room, a1, 1, 5000, t);
  s := public._farm_do_offer(room, a2, 1, 6000, t);
  assert pg_temp.plot(s, 1)->'offers' = '2' and jsonb_array_length(s->'mine'->'my_offers') = 1, 'two offers';
  s := public._field_view(room, a3, t);
  assert jsonb_array_length(s->'mine'->'incoming_offers') = 2 and s->'mine'->'incoming_offers'->0->'price' = '6000'
     and (s->'mine'->'incoming_offers'->0->>'expires_at')::timestamptz = t + interval '24 hours', 'the owner sees them';
  select id into o from public.land_offers where room_id = room and buyer_id = a2;
  assert pg_temp.err(format('select public._farm_do_accept_offer(%L, %L, %L, %L)', room, a3, o, t)) = 'buyer cannot buy',
    'a2 farms two plots already';
  assert pg_temp.err(format('select public._farm_do_accept_offer(%L, %L, %L, %L)', room, a1, o, t)) = 'not your plot', 'owner';
  assert pg_temp.err(format('select public._farm_do_decline_offer(%L, %L, %L, %L)', room, a1, o, t)) = 'offer not found', 'owner';
  perform public._farm_do_decline_offer(room, a3, o, t);
  select id into o from public.land_offers where room_id = room and buyer_id = a1;
  perform public._farm_do_offer(room, a1, 1, 5500, t);
  select id into o2 from public.land_offers where room_id = room and buyer_id = a1;
  assert o2 <> o and (select count(*) from public.land_offers where room_id = room) = 1, 'the new offer replaced the old one';
  assert pg_temp.err(format('select public._farm_do_accept_offer(%L, %L, %L, %L)', room, a3, o, t)) = 'offer expired', 'old id';
  s := public._farm_do_accept_offer(room, a3, o2, t);
  assert pg_temp.plot(s, 1)->'owner'->>'id' = a1::text and pg_temp.coins(a1) = 19500 and pg_temp.coins(a3) = 16500, 'sold for 5 500';
  assert not exists (select 1 from public.land_offers where room_id = room), 'offers cleared';
  -- withdraw, refusals, expiry
  perform public._farm_do_offer(room, a3, 1, 7000, t);
  select id into o from public.land_offers where room_id = room and buyer_id = a3;
  perform public._farm_do_withdraw_offer(room, a3, o, t);
  assert pg_temp.err(format('select public._farm_do_withdraw_offer(%L, %L, %L, %L)', room, a3, o, t)) = 'offer not found', 'gone';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 2, 100, %L)', room, a3, t)) = 'not for sale', 'no owner';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 1, 100, %L)', room, a1, t)) = 'invalid plot', 'your own';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 1, 0, %L)', room, a3, t)) = 'invalid price', 'price range';
  perform public._farm_do_offer(room, a3, 1, 4000, t);
  perform public._field_open(room, t + interval '24 hours');
  assert not exists (select 1 from public.land_offers where room_id = room), 'offers expire after 24 h';

  -- sublease: the renter pays the owner; the owner's land offers are frozen while it is leased
  t := t + interval '25 hours';
  s := public._farm_do_set_sublease(room, a1, 1, 300, t);
  assert pg_temp.plot(s, 1)->'sublease_price' = '300', 'sublease offered';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 6000, %L)', room, a1, t)) = 'invalid price', 'range';
  assert pg_temp.err(format('select public._farm_do_rent_sublease(%L, %L, 1, 250, %L)', room, a3, t)) = 'price changed', 'exact';
  assert pg_temp.err(format('select public._farm_do_rent_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'invalid plot', 'own';
  s := public._farm_do_rent_sublease(room, a3, 1, 300, t);
  assert pg_temp.plot(s, 1)->'lease'->>'source' = 'owner' and pg_temp.plot(s, 1)->'farmer'->>'id' = a3::text
     and pg_temp.plot(s, 1)->'sublease_price' = 'null', 'a3 farms plot 1';
  assert pg_temp.coins(a1) = 19800 and pg_temp.coins(a3) = 16200, 'paid the owner';
  assert exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'lease_income' and delta = 300)
     and exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'lease_pay' and delta = -300), 'ledger';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'leased', 'leased';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 5000, %L)', room, a1, t)) = 'leased', 'leased';
  -- sell back to the village while leased: paid now, the village takes the plot when the lease ends
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 1, a3, t);
  s := public._farm_do_sell_to_village(room, a1, 1, t);
  assert pg_temp.plot(s, 1)->'owner' = 'null' and pg_temp.plot(s, 1)->'farmer'->>'id' = a3::text, 'the lease goes on';
  assert pg_temp.coins(a1) = 21800, 'paid 2 000';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', room, a2, t)) = 'leased', 'not until the lease ends';
  perform public._field_open(room, t + interval '96 hours');
  assert not exists (select 1 from public.plot_leases where room_id = room and plot_no = 1)
     and not exists (select 1 from public.crops where room_id = room and plot_no = 1), 'the lease and its crop ended';
end $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '250 hours';
begin
  -- reclaim after 14 days away: the owner is refunded 2 000 (§7.6)
  perform public._farm_do_buy_plot(room, a3, 2, t);
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 2, a3, t);
  update public.members set joined_at = t - interval '20 days', last_seen_at = t - interval '15 days'
   where room_id = room and account_id = a3;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 2) is null
     and not exists (select 1 from public.crops where room_id = room and plot_no = 2), 'reclaimed with its crop';
  assert pg_temp.coins(a3) = 14200 and exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'land_refund'),
    'refunded';
  update public.members set last_seen_at = t where room_id = room and account_id = a3;
  -- reclaim when the owner leaves the room
  perform public._farm_do_buy_plot(room, a2, 3, t);
  delete from public.members where room_id = room and account_id = a2;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 3) is null and pg_temp.coins(a2) = 8000,
    'reclaimed from a leaver';
  -- a plot leased out is reclaimed only when the lease ends
  perform public._farm_do_buy_plot(room, a3, 4, t);
  perform public._farm_do_set_sublease(room, a3, 4, 100, t);
  perform public._farm_do_rent_sublease(room, a1, 4, 100, t);
  update public.members set last_seen_at = t - interval '15 days' where room_id = room and account_id = a3;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 4) = a3, 'waits for the lease';
  perform public._field_open(room, t + interval '97 hours');
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 4) is null
     and pg_temp.coins(a3) = 10200 + 100 + 2000, 'reclaimed after the lease';
  update public.members set last_seen_at = null where room_id = room and account_id = a3;
  -- abandon: the farmer clears the crop, the lease goes on
  t := t + interval '98 hours';
  perform public._farm_do_rent(room, a1, 7, t);
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 7, a1, t);
  assert pg_temp.err(format('select public._farm_do_abandon(%L, %L, 7, %L)', room, a3, t)) = 'not your plot', 'farmer only';
  perform public._farm_do_abandon(room, a1, 7, t);
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 7)
     and exists (select 1 from public.plot_leases where room_id = room and plot_no = 7), 'bare, still leased';
  assert pg_temp.err(format('select public._farm_do_abandon(%L, %L, 7, %L)', room, a1, t)) = 'no crop', 'nothing to abandon';
end $$;
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't2'));

select 'v15 land smoke ok' as result;
