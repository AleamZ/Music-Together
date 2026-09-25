-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0015, from the repo
-- root (the crop fixtures are read with \copy, and the last section re-runs 0013 with \i). Every check is an ASSERT; the
-- first failure stops psql (ON_ERROR_STOP). A refusal the anti-cheat reads as tampering comes back as an envelope
-- (0015): its `error` is checked instead.
\set ON_ERROR_STOP on

-- The tampered calls below are only recorded: log mode locks nobody.
update public.anticheat_config set mode = 'log';

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
  assert public.buy_item(t1, 'seed_short', 1)->'anticheat'->>'error' = 'item not available', 'seeds are not fishing gear';
  assert public.buy_item(t1, 'fert_urea')->'anticheat'->>'error' = 'item not available', 'nor fertilizer';
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
  perform pg_temp.set_coins(a1, 2000000);
  perform pg_temp.set_coins(a2, 50000);
  perform pg_temp.set_coins(a3, 2000000);
  s := public._farm_do_rent(room, a2, 5, t);
  assert pg_temp.coins(a2) = 40000, 'rent is 10 000';
  assert pg_temp.plot(s, 5)->'lease'->>'source' = 'village' and pg_temp.plot(s, 5)->'farmer'->>'id' = a2::text
     and (pg_temp.plot(s, 5)->'lease'->>'until')::timestamptz = t + interval '96 hours', 'a village lease for 96 h';
  assert s->'mine'->'farming' = '[5]', 'farming plot 5';
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'rent' and delta = -10000), 'rent ledger';
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 5, %L)', room, a3, t)) = 'plot taken', 'taken';
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 1, %L)', room, a3, t)) = 'invalid plot', 'private plots are not rented';
  perform public._farm_do_rent(room, a2, 6, t);
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 7, %L)', room, a2, t)) = 'farm limit', 'two plots at most';
  perform pg_temp.set_coins(a3, 100);
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 7, %L)', room, a3, t)) = 'not enough coins', 'coins';
  perform pg_temp.set_coins(a3, 2000000);
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
  assert pg_temp.coins(a1) = 1200000 and pg_temp.plot(s, 1)->'owner'->>'id' = a1::text
     and s->'mine'->'owned_plot' = '1', 'bought plot 1';
  assert s->'mine'->'farming' = '[1]', 'an unleased own plot is farmed';
  assert exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'land_buy' and delta = -800000), 'ledger';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 2, %L)', room, a1, t)) = 'already own land', 'one per room';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', room, a3, t)) = 'not for sale', 'owned';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 5, %L)', room, a3, t)) = 'not for sale', 'village land';
  perform public._farm_do_rent(room, a2, 5, t);
  perform public._farm_do_rent(room, a2, 6, t);
  perform pg_temp.set_coins(a2, 1000000);
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
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 5000001, %L)', room, a1, t)) = 'invalid price', 'up to 5 000 000';
  assert pg_temp.err(format('update public.field_plots set sale_price = 5000001 where room_id = %L and plot_no = 1', room))
    = 'new row for relation "field_plots" violates check constraint "field_plots_sale_price_check"', 'the sale price check';
  s := public._farm_do_list(room, a1, 1, 5000000, t);
  assert pg_temp.plot(s, 1)->'sale_price' = '5000000', 'listed at 5 000 000';
  s := public._farm_do_list(room, a1, 1, 9000, t);
  assert pg_temp.plot(s, 1)->'sale_price' = '9000', 'listed';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 8000, %L)', room, a3, t)) = 'price changed', 'exact price';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 9000, %L)', room, a1, t)) = 'invalid plot', 'not your own';
  s := public._farm_do_buy_listed(room, a3, 1, 9000, t);
  assert pg_temp.plot(s, 1)->'owner'->>'id' = a3::text and pg_temp.plot(s, 1)->'sale_price' = 'null', 'sold to a3';
  assert pg_temp.coins(a3) = 1991000 and pg_temp.coins(a1) = 1209000, 'paid 9 000';
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
  assert pg_temp.plot(s, 1)->'owner'->>'id' = a1::text and pg_temp.coins(a1) = 1203500 and pg_temp.coins(a3) = 1996500, 'sold for 5 500';
  assert not exists (select 1 from public.land_offers where room_id = room), 'offers cleared';
  -- withdraw, refusals, expiry
  perform public._farm_do_offer(room, a3, 1, 7000, t);
  select id into o from public.land_offers where room_id = room and buyer_id = a3;
  perform public._farm_do_withdraw_offer(room, a3, o, t);
  assert pg_temp.err(format('select public._farm_do_withdraw_offer(%L, %L, %L, %L)', room, a3, o, t)) = 'offer not found', 'gone';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 2, 100, %L)', room, a3, t)) = 'not for sale', 'no owner';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 1, 100, %L)', room, a1, t)) = 'invalid plot', 'your own';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 1, 0, %L)', room, a3, t)) = 'invalid price', 'price range';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 1, 5000001, %L)', room, a3, t)) = 'invalid price', 'up to 5 000 000';
  assert pg_temp.err(format('insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (%L, 1, %L, 5000001, %L)',
                            room, a3, t))
    = 'new row for relation "land_offers" violates check constraint "land_offers_price_check"', 'the offer price check';
  perform public._farm_do_offer(room, a3, 1, 4000, t);
  perform public._field_open(room, t + interval '24 hours');
  assert not exists (select 1 from public.land_offers where room_id = room), 'offers expire after 24 h';

  -- sublease: the renter pays the owner; the owner's land offers are frozen while it is leased
  t := t + interval '25 hours';
  s := public._farm_do_set_sublease(room, a1, 1, 100000, t);
  assert pg_temp.plot(s, 1)->'sublease_price' = '100000', 'offered at 100 000';
  s := public._farm_do_set_sublease(room, a1, 1, 300, t);
  assert pg_temp.plot(s, 1)->'sublease_price' = '300', 'sublease offered';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 100001, %L)', room, a1, t)) = 'invalid price', 'range';
  assert pg_temp.err(format('update public.field_plots set sublease_price = 100001 where room_id = %L and plot_no = 1', room))
    = 'new row for relation "field_plots" violates check constraint "field_plots_sublease_price_check"', 'the sublease price check';
  assert pg_temp.err(format('select public._farm_do_rent_sublease(%L, %L, 1, 250, %L)', room, a3, t)) = 'price changed', 'exact';
  assert pg_temp.err(format('select public._farm_do_rent_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'invalid plot', 'own';
  s := public._farm_do_rent_sublease(room, a3, 1, 300, t);
  assert pg_temp.plot(s, 1)->'lease'->>'source' = 'owner' and pg_temp.plot(s, 1)->'farmer'->>'id' = a3::text
     and pg_temp.plot(s, 1)->'sublease_price' = 'null', 'a3 farms plot 1';
  assert pg_temp.coins(a1) = 1203800 and pg_temp.coins(a3) = 1996200, 'paid the owner';
  assert exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'lease_income' and delta = 300)
     and exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'lease_pay' and delta = -300), 'ledger';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'leased', 'leased';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 5000, %L)', room, a1, t)) = 'leased', 'leased';
  -- sell back to the village while leased: paid now, the village takes the plot when the lease ends
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 1, a3, t);
  s := public._farm_do_sell_to_village(room, a1, 1, t);
  assert pg_temp.plot(s, 1)->'owner' = 'null' and pg_temp.plot(s, 1)->'farmer'->>'id' = a3::text, 'the lease goes on';
  assert pg_temp.coins(a1) = 1603800, 'paid 400 000';
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
  -- reclaim after 14 days away: the owner is refunded 400 000 (§7.6)
  perform public._farm_do_buy_plot(room, a3, 2, t);
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 2, a3, t);
  update public.members set joined_at = t - interval '20 days', last_seen_at = t - interval '15 days'
   where room_id = room and account_id = a3;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 2) is null
     and not exists (select 1 from public.crops where room_id = room and plot_no = 2), 'reclaimed with its crop';
  assert pg_temp.coins(a3) = 1596200 and exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'land_refund'),
    'refunded';
  update public.members set last_seen_at = t where room_id = room and account_id = a3;
  -- reclaim when the owner leaves the room
  perform public._farm_do_buy_plot(room, a2, 3, t);
  delete from public.members where room_id = room and account_id = a2;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 3) is null and pg_temp.coins(a2) = 600000,
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
     and pg_temp.coins(a3) = 796200 + 100 + 400000, 'reclaimed after the lease';
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

-- ---------- farming (§8, §9): a whole season with the clock moved by hand, drying, selling, the gift ----------
insert into smoke select 'room2', room_id::text from public.create_room('Ruộng test', 'pw', (select v from smoke where k = 't2'));
insert into smoke select 'code2', code from public.rooms where id = (select v from smoke where k = 'room2')::uuid;
select public.join_room((select v from smoke where k = 'code2'), 'pw', (select v from smoke where k = 't3'));

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid; r jsonb;
begin
  -- chú Tám's gift, once per account
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'true' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1}' and r->>'server_now' is not null, 'gift';
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'false' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1}' and r->'mine'->'gift_claimed' = 'true',
    'only once';
  -- the farm shop at anh Hai
  perform pg_temp.set_coins(a2, 5000);
  r := public.buy_farm_item(t2, 'fert_manure', 2);
  assert r->'mine'->'coins' = '4200' and r->'mine'->'items'->'fert_manure' = '2', 'bought 2 manure';
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'farm_buy' and delta = -800), 'ledger';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 98)', t2, 'fert_manure')) = 'invalid quantity', '99 at most held';
  assert public.buy_farm_item(t2, 'fert_manure', 0)->'anticheat'->>'error' = 'invalid quantity', 'qty 1-99';
  assert public.buy_farm_item(t2, 'rod_bamboo', 1)->'anticheat'->>'error' = 'item not available', 'no fishing gear';
  perform pg_temp.set_coins(a2, 10);
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t2, 'seed_thom')) = 'not enough coins', 'coins';
  perform pg_temp.set_coins(a2, 50000);
  perform public.buy_farm_item(t2, 'fert_phosphate', 1);
  perform public.buy_farm_item(t2, 'fert_potash', 1);
  perform public.buy_farm_item(t2, 'spray_insect', 1);
  perform public.buy_farm_item(t2, 'spray_hopper', 1);
end $$;

do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        tp timestamptz; s jsonb; c public.crops; v_kg integer;
begin
  perform public._farm_do_rent(room, a2, 8, t);
  assert pg_temp.err(format('select public._farm_do_prepare(%L, %L, 8, %L)', room, a3, t)) = 'not your plot', 'farmer only';
  s := public._farm_do_prepare(room, a2, 8, t);
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'prepared' and pg_temp.plot(s, 8)->'crop'->'water' = '3', 'prepared, flooded';
  assert pg_temp.err(format('select public._farm_do_prepare(%L, %L, 8, %L)', room, a2, t)) = 'crop exists', 'once';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 8, %L)', room, a2, t)) = 'wrong phase', 'soak first';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 8, %L, %L)', room, a2, 'fert_urea', t)) = 'invalid item', 'seed';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 8, %L, %L)', room, a2, 'seed_nep', t)) = 'no item', 'no nep';
  s := public._farm_do_soak(room, a2, 8, 'seed_short', t);
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'soaking' and pg_temp.plot(s, 8)->'crop'->>'variety' = 'short'
     and s->'mine'->'items'->'seed_short' is null, 'soaking; the seed is used';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 8, %L, %L)', room, a2, 'seed_short', t)) = 'crop exists', 'once';
  perform public._farm_do_fertilize(room, a2, 8, 'fert_manure', t + interval '15 minutes');
  perform public._farm_do_fertilize(room, a2, 8, 'fert_phosphate', t + interval '15 minutes');
  assert pg_temp.err(format('select public._farm_do_fertilize(%L, %L, 8, %L, %L)', room, a2, 'seed_nep', t)) = 'invalid item', 'fert';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 8, %L)', room, a2, t + interval '1 hour')) = 'wrong phase',
    'still soaking';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 8, %L)', room, a2, t + interval '2 hours')) = 'need water',
    'sow on a moist bed';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 8, 2, %L)', room, a2, t)) = 'invalid quantity', '+1 or -1';
  perform public._farm_do_water(room, a2, 8, -1, t + interval '2 hours');
  s := public._farm_do_water(room, a2, 8, -1, t + interval '2 hours');
  assert pg_temp.plot(s, 8)->'crop'->'water' = '1'
     and (pg_temp.plot(s, 8)->'crop'->>'water_set_at')::timestamptz = t + interval '2 hours', 'drained to Ẩm';
  s := public._farm_do_sow(room, a2, 8, t + interval '2 hours 30 minutes');
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'seedling', 'sown';
  assert (select jsonb_array_length(pest_rolls) from public.crops where room_id = room and plot_no = 8) = 3, 'three secret rolls';
  assert pg_temp.plot(s, 8)->'crop'->'log' is not null and pg_temp.plot(s, 8)::text not like '%u_hit%', 'rolls stay secret';
  assert pg_temp.plot(public._field_view(room, a3, t + interval '3 hours'), 8)->'crop'->'log' is null, 'logs for the farmer only';

  -- transplant: seedlings ≥ 7.2 h (short) in shallow water, after a 2 s action
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'transplant', t + interval '9 hours'))
    = 'wrong phase', 'too young';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'transplant', t + interval '10 hours'))
    = 'need water', 'needs Nông';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'dig', t)) = 'invalid work', 'work';
  perform public._farm_do_water(room, a2, 8, 1, t + interval '10 hours');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 8, 1, %L)', room, a2, t + interval '10 hours'))
    = 'too fast', 'begin first';
  perform public._farm_do_begin_work(room, a2, 8, 'transplant', t + interval '10 hours');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 8, 1, %L)', room, a2, t + interval '10 hours 1 second'))
    = 'too fast', 'the 2 s gate';
  tp := t + interval '10 hours 3 seconds';
  s := public._farm_do_transplant(room, a2, 8, 5.0, tp);
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'tillering'
     and (select q_transplant from public.crops where room_id = room and plot_no = 8) = 1.0, 'transplanted, quality ignored (D1)';

  -- pests: a snail at T = 3.6 h (water 2 → hit) and a leaf folder at T = 5.4 h
  update public.crops set pest_rolls = '[{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.1},
                                         {"slot": 2, "u_time": 0, "u_kind": 0.9, "u_hit": 0.1},
                                         {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}]'
   where room_id = room and plot_no = 8;
  s := public._field_view(room, a2, tp + interval '3 hours 30 minutes');
  assert pg_temp.plot(s, 8)->'crop'->'pests' = '[]', 'not yet due';
  s := public._field_view(room, a2, tp + interval '4 hours');
  assert pg_temp.plot(s, 8)->'crop'->'pests'->0->>'kind' = 'snail'
     and pg_temp.plot(s, 8)->'crop'->'pests'->0->'treated_at' = 'null', 'golden snails';
  s := public._farm_do_pick_snails(room, a3, 8, tp + interval '4 hours');
  assert pg_temp.plot(s, 8)->'crop'->'pests'->0->'treated_at' <> 'null', 'anyone may pick them';
  assert pg_temp.err(format('select public._farm_do_pick_snails(%L, %L, 8, %L)', room, a3, tp + interval '4 hours'))
    = 'no snails', 'picked already';
  perform public._farm_do_fertilize(room, a2, 8, 'fert_urea', tp + interval '4 hours');
  perform public._farm_do_spray(room, a2, 8, 'spray_hopper', tp + interval '5 hours 30 minutes');
  s := public._field_view(room, a2, tp + interval '5 hours 30 minutes');
  assert pg_temp.plot(s, 8)->'crop'->'pests'->1->>'kind' = 'leaf_folder'
     and pg_temp.plot(s, 8)->'crop'->'pests'->1->'treated_at' = 'null', 'the wrong spray does nothing';
  s := public._farm_do_spray(room, a2, 8, 'spray_insect', tp + interval '5 hours 45 minutes');
  assert (pg_temp.plot(s, 8)->'crop'->'pests'->1->>'treated_at')::timestamptz = tp + interval '5 hours 45 minutes', 'treated';
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 8, %L, %L)', room, a2, 'fert_urea', tp)) = 'invalid item', 'spray';
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 8, %L, %L)', room, a2, 'spray_fungus', tp)) = 'no item', 'none';
  perform public._farm_do_fertilize(room, a2, 8, 'fert_potash', tp + interval '18 hours');

  -- harvest: ripe at T = 43.2 h (short), in a drained plot, after a 2 s action; the lease ends with it
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '40 hours'))
    = 'wrong phase', 'not ripe';
  perform public._farm_do_water(room, a2, 8, 1, tp + interval '44 hours');
  perform public._farm_do_water(room, a2, 8, 1, tp + interval '44 hours');
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '44 hours'))
    = 'need water', 'drain first';
  perform public._farm_do_water(room, a2, 8, -1, tp + interval '44 hours');
  perform public._farm_do_begin_work(room, a2, 8, 'harvest', tp + interval '44 hours');
  select * into c from public.crops where room_id = room and plot_no = 8;
  v_kg := (public._crop_yield(c, public._variety('short'), 1.0, 1.0, tp + interval '44 hours 2 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a2, 8, 5.0, tp + interval '44 hours 2 seconds');
  assert s->'harvest' = jsonb_build_object('variety', 'short', 'kg', v_kg) and s->'mine'->'rice'->'short'->'wet' = to_jsonb(v_kg),
    format('harvested %s kg wet, quality ignored (D1)', v_kg);
  assert pg_temp.plot(s, 8)->'crop' = 'null' and pg_temp.plot(s, 8)->'lease' = 'null' and s->'mine'->'farming' = '[]',
    'bare, and the lease ended';
  insert into smoke values ('kg', v_kg::text);
end $$;

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '60 hours';
        v_kg integer := (select v from smoke where k = 'kg')::int; s jsonb; r jsonb; v_coins integer;
begin
  -- drying: 3 h per batch, 4 slots, collected automatically 24 h after it is ready
  assert pg_temp.err(format('select public._farm_do_dry_start(%L, %L, %L, 0, %L)', room, a2, 'short', t)) = 'invalid quantity', 'kg';
  assert pg_temp.err(format('select public._farm_do_dry_start(%L, %L, %L, 999, %L)', room, a2, 'short', t)) = 'not enough rice', 'kg';
  s := public._farm_do_dry_start(room, a2, 'short', 10, t);
  assert s->'drying'->0->'slot' = '1' and s->'drying'->0->'owner'->>'id' = a2::text and s->'drying'->0->'kg' = '10'
     and (s->'drying'->0->>'ready_at')::timestamptz = t + interval '3 hours' and s->'mine'->'rice'->'short'->'wet' = to_jsonb(v_kg - 10),
    'drying';
  assert pg_temp.err(format('select public._farm_do_dry_collect(%L, %L, 1, %L)', room, a2, t + interval '2 hours')) = 'not ready', 'ready';
  assert pg_temp.err(format('select public._farm_do_dry_collect(%L, %L, 1, %L)', room, a3, t + interval '3 hours')) = 'invalid slot',
    'yours only';
  s := public._farm_do_dry_collect(room, a2, 1, t + interval '3 hours');
  assert s->'drying' = '[]' and s->'mine'->'rice'->'short'->'dry' = '10', 'dry rice';
  -- an account dries at most 2 batches at a time in a room, so two accounts fill the 4 slots
  perform public._farm_do_dry_start(room, a2, 'short', 1, t);
  perform public._farm_do_dry_start(room, a2, 'short', 1, t);
  assert pg_temp.err(format('select public._farm_do_dry_start(%L, %L, %L, 1, %L)', room, a2, 'short', t)) = 'drying limit',
    'two batches each';
  perform public._rice_add(a3, 'nep', 5, 0);
  perform public._farm_do_dry_start(room, a3, 'nep', 2, t);
  perform public._farm_do_dry_start(room, a3, 'nep', 3, t);
  assert pg_temp.err(format('select public._farm_do_dry_start(%L, %L, %L, 1, %L)', room, a2, 'short', t)) = 'drying full', 'full';
  perform public._field_open(room, t + interval '27 hours');
  assert not exists (select 1 from public.drying_slots where room_id = room)
     and (select dry_kg from public.rice_stock where account_id = a2 and variety = 'short') = 12
     and (select dry_kg from public.rice_stock where account_id = a3 and variety = 'nep') = 5, 'collected automatically';

  -- selling at cô Út: dry at 710 xu/kg, wet at 70 %
  v_coins := pg_temp.coins(a2);
  r := public.sell_rice(t2, 'short', true, 10);
  assert r->'mine'->'coins' = to_jsonb(v_coins + 7100) and r->'mine'->'rice'->'short'->'dry' = '2', 'dry: 10 × 710';
  r := public.sell_rice(t2, 'short', false, 5);
  assert r->'mine'->'coins' = to_jsonb(v_coins + 7100 + 2485), 'wet: floor(5 × 710 × 0.7)';
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'rice_sell' and delta = 2485), 'ledger';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 999)', t2, 'short')) = 'not enough rice', 'stock';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 1)', t2, 'bogus')) = 'invalid variety', 'variety';
  assert public.sell_rice(t2, 'short', null, 1)->'anticheat'->>'error' = 'invalid quantity', 'dry or wet';
  assert public.sell_rice(t2, 'short', true, 0)->'anticheat'->>'error' = 'invalid quantity', 'kg';
end $$;

do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '100 hours'; s jsonb;
begin
  insert into public.inventory (account_id, item_id, qty) values (a3, 'seed_nep', 2)
  on conflict (account_id, item_id) do update set qty = 2;
  perform pg_temp.set_coins(a3, 50000);
  -- sprouted seed rots 24 h after sprouting: back to a prepared plot
  perform public._farm_do_rent(room, a3, 9, t);
  perform public._farm_do_prepare(room, a3, 9, t);
  perform public._farm_do_soak(room, a3, 9, 'seed_nep', t);
  s := public._field_view(room, a3, t + interval '25 hours 59 minutes');
  assert pg_temp.plot(s, 9)->'crop'->>'phase' = 'sprouted', 'still sprouted';
  perform public._field_open(room, t + interval '26 hours');
  s := public._field_view(room, a3, t + interval '26 hours');
  assert pg_temp.plot(s, 9)->'crop'->>'phase' = 'prepared' and pg_temp.plot(s, 9)->'crop'->'variety' = 'null'
     and (pg_temp.plot(s, 9)->'crop'->>'rotted_at')::timestamptz = t + interval '26 hours', 'rotted';
  -- soaking before làm đất: sowing and water need a prepared plot; unprepared rotten seed leaves the plot bare
  perform public._farm_do_rent(room, a3, 10, t);
  perform public._farm_do_soak(room, a3, 10, 'seed_nep', t);
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 10, %L)', room, a3, t + interval '3 hours')) = 'not prepared', 'sow';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 10, -1, %L)', room, a3, t)) = 'not prepared', 'water';
  perform public._field_open(room, t + interval '26 hours');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 10), 'bare again';
  -- rice left 48 h past its ripe window is lost
  update public.crops set variety = 'nep', soak_at = t - interval '200 hours', sow_at = t - interval '190 hours',
                          transplant_at = t - interval '108 hours', rotted_at = null
   where room_id = room and plot_no = 9;
  perform public._field_open(room, t - interval '1 second');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 9), 'not yet';
  perform public._field_open(room, t);
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 9), 'the grain has fallen';
end $$;

do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '130 hours'; i integer;
begin
  -- the water log is capped, because the harvest's cost grows with it: 6 changes in any hour and 60 entries per crop,
  -- both refused as 'too fast'. Làm đất's entry counts too.
  perform public._farm_do_prepare(room, a3, 10, t);
  for i in 1..5 loop
    perform public._farm_do_water(room, a3, 10, -1, t + make_interval(mins => i));
  end loop;
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 10, 1, %L)', room, a3, t + interval '59 minutes')) = 'too fast',
    'six changes in the last hour';
  perform public._farm_do_water(room, a3, 10, 1, t + interval '1 hour 1 minute');
  assert jsonb_array_length((select water_log from public.crops where room_id = room and plot_no = 10)) = 7, 'a rolling hour';
  -- 59 entries long ago, then the 60th is the last one
  update public.crops
     set water_log = (select jsonb_agg(jsonb_build_object('t', t - make_interval(hours => 60 - g), 'l', 2) order by g)
                        from generate_series(1, 59) g)
   where room_id = room and plot_no = 10;
  perform public._farm_do_water(room, a3, 10, 1, t + interval '3 hours');
  assert jsonb_array_length((select water_log from public.crops where room_id = room and plot_no = 10)) = 60, 'the 60th entry';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 10, -1, %L)', room, a3, t + interval '5 hours')) = 'too fast',
    'sixty entries per crop';
end $$;

do $$
declare f text;
begin
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like '\_%' and has_function_privilege('anon', p.oid, 'execute')),
    'private helpers are not callable';
  foreach f in array array['touch_room(uuid,text)', 'field_state(uuid,text)', 'rent_plot(uuid,text,integer)',
    'buy_plot(uuid,text,integer)', 'sell_plot_to_village(uuid,text,integer)', 'list_plot(uuid,text,integer,integer)',
    'buy_listed_plot(uuid,text,integer,integer)', 'offer_plot(uuid,text,integer,integer)', 'withdraw_offer(uuid,text,uuid)',
    'decline_offer(uuid,text,uuid)', 'accept_offer(uuid,text,uuid)', 'set_sublease(uuid,text,integer,integer)',
    'rent_sublease(uuid,text,integer,integer)', 'abandon_crop(uuid,text,integer)', 'prepare_plot(uuid,text,integer)',
    'apply_fertilizer(uuid,text,integer,text)', 'soak_seed(uuid,text,integer,text)', 'sow_seed(uuid,text,integer)',
    'begin_work(uuid,text,integer,text)', 'transplant(uuid,text,integer,double precision)', 'water(uuid,text,integer,integer)',
    'spray(uuid,text,integer,text)', 'pick_snails(uuid,text,integer)', 'harvest(uuid,text,integer,double precision)',
    'dry_start(uuid,text,text,integer)', 'dry_collect(uuid,text,integer)', 'sell_rice(text,text,boolean,integer)',
    'buy_farm_item(text,text,integer)', 'claim_farm_gift(text)'] loop
    assert has_function_privilege('anon', 'public.' || f, 'execute'), f;
  end loop;
  foreach f in array array['field_plots', 'plot_leases', 'land_offers', 'crops', 'drying_slots', 'rice_stock', 'farm_profiles'] loop
    assert not has_table_privilege('anon', 'public.' || f, 'select'), f;
  end loop;
  assert has_table_privilege('anon', 'public.rice_varieties', 'select'), 'varieties are public config';
  foreach f in array array['rice_varieties', 'shop_items', 'fish_species'] loop
    assert has_table_privilege('anon', 'public.' || f, 'select') and has_table_privilege('authenticated', 'public.' || f, 'select')
       and not has_table_privilege('anon', 'public.' || f, 'insert, update, delete, truncate')
       and not has_table_privilege('authenticated', 'public.' || f, 'insert, update, delete, truncate'), f || ' is read-only';
  end loop;
end $$;

select 'v15 farm smoke ok' as result;

-- ---------- the fish price index (economy spec §5) ----------
insert into smoke select 'froom', room_id::text from public.create_room('Ao giá', 'pw', (select v from smoke where k = 't2'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'froom')::uuid), 'pw',
                        (select v from smoke where k = 't1'));
insert into smoke select 'solo', room_id::text from public.create_room('Ao một mình', 'pw', (select v from smoke where k = 't3'));

do $$
declare room uuid := (select v from smoke where k = 'froom')::uuid; solo uuid := (select v from smoke where k = 'solo')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid;
        p1 bigint; p2 bigint; w bigint; r public.fish_price_index; cid uuid; res jsonb; b jsonb;
begin
  -- the law (§5.3) and the 3-hour Vietnam periods (§5.4)
  assert public._fish_mult(0) = 1 and public._fish_mult(20000) = 1 and public._fish_mult(100000) = 2.24
     and public._fish_mult(500000) = 5 and public._fish_mult(1000000) = 7.07 and public._fish_mult(2000000) = 10
     and public._fish_mult(90000000) = 10, 'the multiplier law';
  assert public._fish_period('2026-01-01 03:00:00+07') = public._fish_period('2026-01-01 00:00:00+07') + 1
     and public._fish_period('2026-01-01 02:59:59+07') = public._fish_period('2026-01-01 00:00:00+07'), '3-hour periods, VN time';
  -- the wealth (§5.2): the average of xu + 800 000 per private plot owned, over the members seen in the last 14 days;
  -- 0 while fewer than 2 of them are active, so a room of one keeps ×1
  insert into public.wallets (account_id, coins) values (a1, 150000), (a2, 50000)
  on conflict (account_id) do update set coins = excluded.coins;
  p1 := (select count(*) from public.field_plots where owner_id = a1);
  p2 := (select count(*) from public.field_plots where owner_id = a2);
  w := ((150000 + 800000 * p1) + (50000 + 800000 * p2)) / 2;
  assert public._room_wealth(room, now()) = w, 'the average assets of the active members';
  update public.members set last_seen_at = now() - interval '15 days', joined_at = now() - interval '20 days'
   where room_id = room and account_id = a1;
  assert public._room_wealth(room, now()) = 0, 'a member away 14 days does not count: one active member left';
  update public.members set last_seen_at = now() where room_id = room and account_id = a1;
  perform pg_temp.set_coins(a3, 90000000);
  assert public._room_wealth(solo, now()) = 0 and (public._fish_index(solo, now())).mult = 1,
    'a room with a single active member keeps ×1, however rich';
  -- the snapshot (§5.5)
  r := public._fish_index(room, now());
  assert r.period = public._fish_period(now()) and r.wealth = w and r.mult = public._fish_mult(w), 'the snapshot';
  -- the season factors (§5.6): deterministic, in [0.80, 1.39]
  assert (select min(public._fish_factor(room, s.id, g)) >= 0.80 and max(public._fish_factor(room, s.id, g)) <= 1.39
            from public.fish_species s, generate_series(0, 200) g), 'factors in range';
  assert public._fish_factor(room, 'ca_ro', 7) = public._fish_factor(room, 'ca_ro', 7), 'factors are deterministic';
  -- a catch (§5.7): base × kg × M × S of the room's snapshot, stored with the fish
  delete from public.fish where account_id = a1;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (a1, room, 'ca_ro', 200, 2000, now() - interval '10 seconds', now() + interval '60 seconds')
  on conflict (account_id) do update set id = gen_random_uuid(), room_id = excluded.room_id, species_id = excluded.species_id,
    weight_g = excluded.weight_g, min_reel_ms = excluded.min_reel_ms, bite_at = excluded.bite_at, expires_at = excluded.expires_at
  returning id into cid;
  res := public.finish_cast((select v from smoke where k = 't1'), cid, true);
  assert res->>'result' = 'caught'
     and (res->'fish'->>'price')::int
         = greatest(1, round(45 * 200 / 1000.0 * r.mult * public._fish_factor(room, 'ca_ro', r.period))::int)
     and (select price from public.fish where id = (res->'fish'->>'id')::uuid) = (res->'fish'->>'price')::int,
    'the catch is priced by the index';
  -- the board (§5.7)
  b := public.fishing_board(room, (select v from smoke where k = 't1'))->'prices';
  assert (b->>'mult')::numeric = r.mult and (b->>'wealth')::bigint = w
     and (b->>'ends_at')::timestamptz = to_timestamp((r.period + 1) * 10800 - 25200)
     and (select count(*) from jsonb_object_keys(b->'factors')) = (select count(*) from public.fish_species)
     and (b->'factors'->>'ca_ro')::numeric = public._fish_factor(room, 'ca_ro', r.period), 'the board shows the index';
  -- inside its period the snapshot holds; the next period recomputes it
  update public.wallets set coins = coins + 100000000 where account_id = a1;
  assert (public._fish_index(room, now())).mult = r.mult, 'stable inside its period';
  assert (public._fish_index(room, now() + interval '3 hours')).mult = 10, 'recomputed in the next period';
  assert not has_table_privilege('anon', 'public.fish_price_index', 'select'), 'the index is private';
end $$;

select 'v15 fish price smoke ok' as result;

-- ---------- re-running 0013 over an earlier build of it (economy spec §3): the v15 state starts over ----------
-- The earlier builds sold seed_short at 60 xu. That price is the fingerprint: land, rice and farm items bought and grown
-- at the old prices are cleared before the new prices go in. Everything else stays.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
begin
  update public.shop_items set price = 60 where id = 'seed_short';
  perform public._field_init(room);
  update public.field_plots set owner_id = a1, owned_at = now(), sale_price = null, sublease_price = null
   where room_id = room and plot_no = 2;
  insert into public.inventory (account_id, item_id, qty) values (a1, 'seed_short', 3), (a1, 'fert_urea', 1), (a1, 'rod_bamboo', 1)
  on conflict (account_id, item_id) do update set qty = excluded.qty;
  assert exists (select 1 from public.field_plots where owner_id = a1) and exists (select 1 from public.rice_stock)
     and exists (select 1 from public.farm_profiles), 'the old build''s state is there';
end $$;
-- 0016 (v15.2) sells tools, a kind 0013's item check does not know: take them out first (the v15.2 smoke runs 0016 again).
delete from public.inventory i using public.shop_items s where s.id = i.item_id and s.kind = 'tool';
delete from public.shop_items where kind = 'tool';
-- Supabase's default privileges give the API roles every right on a new table (TRUNCATE ignores RLS); this cluster has
-- none, so grant them here: the re-run must take the writes on the config tables back.
grant insert, update, delete, truncate on public.rice_varieties, public.shop_items, public.fish_species to anon, authenticated;
set client_min_messages = warning;
\i supabase/migrations/0013_v15_field.sql
reset client_min_messages;
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid;
begin
  assert not exists (select 1 from public.field_plots) and not exists (select 1 from public.plot_leases)
     and not exists (select 1 from public.land_offers) and not exists (select 1 from public.crops)
     and not exists (select 1 from public.drying_slots) and not exists (select 1 from public.rice_stock)
     and not exists (select 1 from public.farm_profiles), 'the v15 state starts over';
  assert (select price from public.shop_items where id = 'seed_short') = 600, 'seed_short costs 600 again';
  assert not exists (select 1 from public.inventory i join public.shop_items s on s.id = i.item_id
                      where s.kind in ('seed', 'fertilizer', 'pesticide', 'critter_box')), 'no farm items left';
  assert exists (select 1 from public.inventory where account_id = a1 and item_id = 'rod_bamboo'), 'fishing gear stays';
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['public.rice_varieties', 'public.shop_items', 'public.fish_species']) tb
                      where has_table_privilege(r, tb, 'insert, update, delete, truncate'))
     and has_table_privilege('anon', 'public.shop_items', 'select'), 'the config tables are read-only again';
end $$;

-- a normal re-run (seed_short at 600) keeps the v15 state
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
begin
  insert into public.field_plots (room_id, plot_no, kind, owner_id, owned_at) values (room, 1, 'private', a1, now());
  insert into public.inventory (account_id, item_id, qty) values (a1, 'seed_nep', 2);
end $$;
set client_min_messages = warning;
\i supabase/migrations/0013_v15_field.sql
reset client_min_messages;
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
begin
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 1) = a1, 'the plot stays';
  assert (select qty from public.inventory where account_id = a1 and item_id = 'seed_nep') = 2, 'the farm items stay';
end $$;

select 'v15 upgrade reset smoke ok' as result;
