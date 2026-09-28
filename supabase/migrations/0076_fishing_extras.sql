-- =========================================================
-- 0076_fishing_extras.sql — v21 group "fishing" (owner 2026-09-29): #37 fishing battle, #78 the boat and the deep water,
-- #73 treasure maps, #79 farming machines. ADDITIVE and re-runnable. Run after 0069 (the v21 foundation).
--   A. The deep water (#78): fish_species.water ('pond' | 'deep') and six deep species (rarity 3–5 only, so the nets'
--      rarity (1, 2) pick never sees them). A boat ('boat' ledger reason, 4 000 xu) moored at Cầu ao; board_boat claims
--      the boat's deck on the pond (server position), start_boat_cast is start_cast's twin from the deck (spot 'boat',
--      the deep species table) and the cast goes on through the SAME hook_cast / finish_cast (untouched): the reel is
--      replayed and verified exactly as a dock cast. leave_boat claims the pier.
--      A BEFORE INSERT trigger on casts (casts_zz_water, after 0072/0077's luck triggers) keeps a pond cast to the pond's
--      species and a boat cast of rarity 3+ to the deep water's (start_cast is not re-created).
--   B. Fishing battles (#37): fb_create / fb_join / fb_leave / fb_start / fb_state / fb_settle. The entry fee is held
--      ('fishing_battle_entry'); the score is the price of every fish landed during the window — counted by an AFTER
--      INSERT trigger on public.fish (every row there is a server-verified catch: finish_cast, net_haul/finish_net; a fish
--      taken back from the fridge/aquarium keeps its old caught_at and is NOT counted). The pot less a 10 % burn goes to
--      the top score ('fishing_battle_prize', ties split); a battle with no catch or cancelled refunds
--      ('fishing_battle_refund').
--   C. Treasure maps (#73): a 2 % drop on a verified catch (5 % from the boat), 3 % on a worm dig (a trigger on
--      fishing_profiles.last_dig_at, set only by dig_worms). The target spot stays on the server; the client gets the map,
--      a landmark and a quarter of the map (a 4 × 3 grid cell). dig_treasure claims the spot (server position) and pays
--      'treasure' within 16 px, else answers hot/warm/cold; one dig per 4 s.
--   D. Farming machines (#79), bought with 'machine': Máy tưới (sprinkler) sets a plot's water to the level asked in one
--      step (the same caps as watering: 60 entries a crop, 6 an hour — no position needed: that is the machine);
--      Máy gặt riêng runs the co-op harvester's job on my own plot for free (the sweep's step J pays the parts as for a
--      rental: the harvest replay is untouched); Máy chế biến turns dry rice / hoa màu into goods worth more
--      (a timed job; sell_goods pays 'produce_sell').
--   E. The wipe: an AFTER INSERT trigger on anticheat_wipes clears these rows (so _ac_wipe is not re-created).
-- Events emitted (public._game_event): 'fishing_battle_win' (qty = prize, meta battle), 'treasure_found' (qty = coins,
-- meta map/spot), 'crop_processed' (qty = batches, meta recipe), 'xp_grant' (qty = xp, meta {"source":"fishing"}).
-- Events consumed: none (the catch is read from public.fish, see B).
-- =========================================================

-- ---------- A. The deep water ----------
alter table public.fish_species add column if not exists water text not null default 'pond';
alter table public.fish_species drop constraint if exists fish_species_water_check;
alter table public.fish_species add constraint fish_species_water_check check (water in ('pond', 'deep'));

insert into public.fish_species (id, name, rarity, min_g, max_g, price_per_kg, difficulty, sort_order, water) values
  ('ca_leo',        'Cá leo',         3,  1000,   8000, 110, 60, 200, 'deep'),
  ('ca_bong_tuong', 'Cá bống tượng',  3,   300,   2500, 260, 58, 205, 'deep'),
  ('ca_chien',      'Cá chiên',       4,  2000,  15000, 160, 78, 210, 'deep'),
  ('ca_duoi_song',  'Cá đuối sông',   4,  3000,  20000, 130, 80, 215, 'deep'),
  ('ca_tra_dau',    'Cá tra dầu',     5, 30000, 150000, 120, 94, 220, 'deep'),
  ('rua_mai_vang',  'Rùa mai vàng',   5,  5000,  30000, 500, 96, 225, 'deep')
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, min_g = excluded.min_g, max_g = excluded.max_g,
  price_per_kg = excluded.price_per_kg, difficulty = excluded.difficulty, sort_order = excluded.sort_order,
  water = excluded.water;

-- The boat's geometry (lib/game/fishing/boat.ts mirrors it; tests/unit/v21-fishing.test.ts pins them equal).
create or replace function public._boat_geo() returns jsonb
language sql immutable parallel safe
as $$ select '{"pier_x": 378, "pier_y": 206, "deck_x": 356, "deck_y": 116, "price": 4000}'::jsonb $$;
revoke all on function public._boat_geo() from public, anon, authenticated;

create table if not exists public.boats (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  bought_at timestamptz not null default now()
);
create table if not exists public.boat_trips (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  boarded_at timestamptz not null default now()
);
alter table public.boats enable row level security;
alter table public.boat_trips enable row level security;
revoke all on public.boats, public.boat_trips from anon, authenticated;

-- Am I aboard? The trip, boarded within 2 h, and my last accepted position still on the deck (walking off ends it).
create or replace function public._boat_aboard(p_account uuid) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.boat_trips; pp public.player_pos; g jsonb := public._boat_geo();
begin
  select * into t from public.boat_trips where account_id = p_account;
  if not found then return false; end if;
  select * into pp from public.player_pos where account_id = p_account;
  if t.boarded_at < now() - interval '2 hours' or pp.account_id is null or pp.map <> 'pond'
     or abs(pp.x - (g->>'deck_x')::int) > 24 or abs(pp.y - (g->>'deck_y')::int) > 24 then
    delete from public.boat_trips where account_id = p_account;
    return false;
  end if;
  return true;
end $$;
revoke all on function public._boat_aboard(uuid) from public, anon, authenticated;

create or replace function public.buy_boat(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; g jsonb := public._boat_geo(); v_ac jsonb;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_account, 'pond', (g->>'pier_x')::int, (g->>'pier_y')::int, 'buy_boat', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  w := public._wallet_lock(v_account);
  if exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'already owned' using errcode = '22023';
  end if;
  if coalesce(w.coins, 0) < (g->>'price')::int then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(v_account, -(g->>'price')::int, 'boat', 'ghe');
  insert into public.boats (account_id) values (v_account);
  return public._fx_extras_state(v_account);
end $$;

create or replace function public.board_boat(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; g jsonb := public._boat_geo(); v_ac jsonb;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  v_ac := public._pos_claim(v_account, 'pond', (g->>'deck_x')::int, (g->>'deck_y')::int, 'board_boat', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  insert into public.boat_trips (account_id, room_id, boarded_at) values (v_account, p_room_id, now())
  on conflict (account_id) do update set room_id = excluded.room_id, boarded_at = excluded.boarded_at;
  return public._fx_extras_state(v_account);
end $$;

create or replace function public.leave_boat(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; g jsonb := public._boat_geo(); v_ac jsonb;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  delete from public.boat_trips where account_id = v_account;
  v_ac := public._pos_claim(v_account, 'pond', (g->>'pier_x')::int, (g->>'pier_y')::int, 'leave_boat', p_room_id, 'too far');
  return public._fx_extras_state(v_account) || coalesce(v_ac, '{}'::jsonb);
end $$;

-- start_boat_cast: 0059's start_cast from the boat's deck — the same bait, bucket, rod, weather, vitals and reel params;
-- spot 'boat', the deep roll (a rarity under 3 becomes 3 one time in five; 3–5 pick a deep species, else a pond one).
create or replace function public.start_boat_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);
        v_boost real;
        v_seed bigint := floor(random() * 4294967296)::bigint;
        v_vitals jsonb; v_ac jsonb; v_abandoned jsonb; g jsonb := public._boat_geo();
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  if not public._boat_aboard(v_account) then raise exception 'not aboard' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_account, 'pond', (g->>'deck_x')::int, (g->>'deck_y')::int, 'start_boat_cast', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then
    raise exception 'rod broken' using errcode = '22023';
  end if;
  delete from public.casts where account_id = v_account;
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,
                                  not (public._room_weather(p_room_id)).is_day);
  if v_rarity < 3 and random() < 0.2 then v_rarity := 3; end if;                       -- the deep water
  select * into sp from public.fish_species
   where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);
  v_bite := greatest(1000, round(v_bite * v_boost)::int);
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod, reel_seed, reel_params)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          'boat', not (public._rain_cold(v_account) and random() < 0.3),
          sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),
                                     'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
  returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', 'boat', 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

-- The water of a cast (a BEFORE INSERT trigger named to fire after 0072's casts_luck and 0077's casts_prof, which may lift
-- a cast's species one rarity from the whole table): a cast off the boat keeps to the pond's species, a boat cast of
-- rarity 3+ to the deep water's — the same rarity, the weight at the same place in the new range. As with those
-- triggers only the species and the weight change; the reel's seed and params stay. start_cast is NOT re-created.
create or replace function public._cast_water() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare cur public.fish_species; sp public.fish_species; v_want text; v_frac numeric;
begin
  select * into cur from public.fish_species where id = new.species_id;
  if not found then return new; end if;
  v_want := case when new.spot = 'boat' and cur.rarity >= 3 then 'deep' else 'pond' end;
  if cur.water = v_want then return new; end if;
  select * into sp from public.fish_species where rarity = cur.rarity and water = v_want order by random() limit 1;
  if not found then return new; end if;
  v_frac := greatest(0, least(1, (new.weight_g - cur.min_g)::numeric / greatest(1, cur.max_g - cur.min_g)));
  new.species_id := sp.id;
  new.weight_g := sp.min_g + round(v_frac * (sp.max_g - sp.min_g))::int;
  return new;
end $$;
revoke all on function public._cast_water() from public, anon, authenticated;
drop trigger if exists casts_zz_water on public.casts;
create trigger casts_zz_water before insert on public.casts for each row execute function public._cast_water();

-- ---------- B. Fishing battles ----------
create table if not exists public.fishing_battles (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  host uuid not null references public.accounts(id) on delete cascade,
  fee integer not null check (fee between 100 and 10000),
  duration_s integer not null check (duration_s in (180, 300, 600)),
  status text not null default 'open' check (status in ('open', 'live', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  starts_at timestamptz,
  ends_at timestamptz,
  pot integer not null default 0,
  burned integer not null default 0,
  winners uuid[] not null default '{}',
  prize integer not null default 0,
  settled_at timestamptz
);
create index if not exists idx_fishing_battles_room on public.fishing_battles (room_id, status, created_at);
create table if not exists public.fishing_battle_players (
  battle_id uuid not null references public.fishing_battles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  score integer not null default 0,
  catches integer not null default 0,
  best_species text,
  joined_at timestamptz not null default now(),
  primary key (battle_id, account_id)
);
create index if not exists idx_fishing_battle_players_acc on public.fishing_battle_players (account_id);
alter table public.fishing_battles enable row level security;
alter table public.fishing_battle_players enable row level security;
revoke all on public.fishing_battles, public.fishing_battle_players from anon, authenticated;

-- Must stand on the pond (the server's position, claimed within the last 10 minutes).
create or replace function public._fb_at_pond(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.player_pos where account_id = p_account and map = 'pond' and at > now() - interval '10 minutes') then
    raise exception 'not at pond' using errcode = '22023';
  end if;
end $$;
revoke all on function public._fb_at_pond(uuid) from public, anon, authenticated;

-- My battle still open or live (at most one).
create or replace function public._fb_mine(p_account uuid) returns public.fishing_battles
language sql stable security definer set search_path = public, extensions
as $$
  select b.* from public.fishing_battles b join public.fishing_battle_players p on p.battle_id = b.id
   where p.account_id = p_account and b.status in ('open', 'live') order by b.created_at desc limit 1
$$;
revoke all on function public._fb_mine(uuid) from public, anon, authenticated;

-- Refund every player's fee and cancel. The caller holds the battle row.
create or replace function public._fb_cancel(p_battle uuid, p_why text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.fishing_battles; r record;
begin
  select * into b from public.fishing_battles where id = p_battle for update;
  if b.status not in ('open', 'live') then return; end if;
  for r in select account_id from public.fishing_battle_players where battle_id = p_battle order by account_id loop
    perform public._wallet_lock(r.account_id);
    perform public._pay(r.account_id, b.fee, 'fishing_battle_refund', 'battle ' || p_battle || ' ' || p_why);
  end loop;
  update public.fishing_battles set status = 'cancelled', settled_at = now(), pot = 0 where id = p_battle;
end $$;
revoke all on function public._fb_cancel(uuid, text) from public, anon, authenticated;

-- Settle a live battle whose window is over: the top score (> 0) takes the pot less 10 % (ties split, the remainder
-- burned too); nobody caught anything = a refund.
create or replace function public._fb_settle(p_battle uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.fishing_battles; v_top integer; v_win uuid[]; v_burn integer; v_each integer; r record; a uuid;
begin
  select * into b from public.fishing_battles where id = p_battle for update;
  if b.status <> 'live' or now() < b.ends_at then return; end if;
  select max(score) into v_top from public.fishing_battle_players where battle_id = p_battle;
  if coalesce(v_top, 0) <= 0 then
    perform public._fb_cancel(p_battle, 'no catch');
    return;
  end if;
  select array_agg(account_id order by account_id) into v_win
    from public.fishing_battle_players where battle_id = p_battle and score = v_top;
  v_burn := b.pot / 10;
  v_each := (b.pot - v_burn) / cardinality(v_win);
  v_burn := b.pot - v_each * cardinality(v_win);
  foreach a in array v_win loop
    perform public._wallet_lock(a);
    perform public._pay(a, v_each, 'fishing_battle_prize', 'battle ' || p_battle);
    perform public._game_event(a, 'fishing_battle_win', v_each, jsonb_build_object('battle', p_battle, 'score', v_top));
    perform public._game_event(a, 'xp_grant', 80, '{"source":"fishing"}'::jsonb);
  end loop;
  for r in select account_id from public.fishing_battle_players where battle_id = p_battle and not (account_id = any (v_win)) loop
    perform public._game_event(r.account_id, 'xp_grant', 20, '{"source":"fishing"}'::jsonb);
  end loop;
  update public.fishing_battles set status = 'done', winners = v_win, prize = v_each, burned = v_burn, settled_at = now()
   where id = p_battle;
end $$;
revoke all on function public._fb_settle(uuid) from public, anon, authenticated;

-- The room's lazy clock: live battles past their end settle, open ones older than 15 min are cancelled.
create or replace function public._fb_sweep(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;
begin
  for r in select id, status from public.fishing_battles
            where room_id = p_room and ((status = 'live' and ends_at <= now())
                                        or (status = 'open' and created_at < now() - interval '15 minutes'))
            order by created_at loop
    if r.status = 'live' then perform public._fb_settle(r.id); else perform public._fb_cancel(r.id, 'timeout'); end if;
  end loop;
end $$;
revoke all on function public._fb_sweep(uuid) from public, anon, authenticated;

create or replace function public._fb_json(b public.fishing_battles) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('id', b.id, 'host', b.host, 'fee', b.fee, 'duration_s', b.duration_s, 'status', b.status,
    'created_at', b.created_at, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'pot', b.pot, 'burned', b.burned,
    'winners', to_jsonb(b.winners), 'prize', b.prize,
    'players', coalesce((select jsonb_agg(jsonb_build_object('account_id', p.account_id, 'username', a.username,
                                         'score', p.score, 'catches', p.catches, 'best', p.best_species)
                                         order by p.score desc, p.joined_at)
                           from public.fishing_battle_players p join public.accounts a on a.id = p.account_id
                          where p.battle_id = b.id), '[]'::jsonb))
$$;
revoke all on function public._fb_json(public.fishing_battles) from public, anon, authenticated;

create or replace function public.fb_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  perform public._fb_sweep(p_room_id);
  return jsonb_build_object('server_now', now(), 'me', v_account,
    'battles', coalesce((select jsonb_agg(public._fb_json(b) order by b.created_at desc)
                           from (select * from public.fishing_battles
                                  where room_id = p_room_id
                                    and (status in ('open', 'live') or settled_at > now() - interval '30 minutes')
                                  order by created_at desc limit 8) b), '[]'::jsonb));
end $$;

create or replace function public.fb_create(p_room_id uuid, p_session_token text, p_fee integer, p_duration_s integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; v_id uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_fee is null or p_fee not between 100 and 10000 or p_duration_s is null or p_duration_s not in (180, 300, 600) then
    return public._ac_flag(v_account, 'bad_qty', 'fb_create', jsonb_build_object('fee', p_fee, 'duration', p_duration_s),
                           p_room_id, 'invalid quantity');
  end if;
  perform public._fb_sweep(p_room_id);
  perform public._fb_at_pond(v_account);
  w := public._wallet_lock(v_account);
  if (public._fb_mine(v_account)).id is not null then raise exception 'in battle' using errcode = '22023'; end if;
  if (select count(*) from public.fishing_battles where room_id = p_room_id and status = 'open') >= 3 then
    raise exception 'too many battles' using errcode = '22023';
  end if;
  if coalesce(w.coins, 0) < p_fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  insert into public.fishing_battles (room_id, host, fee, duration_s, pot) values (p_room_id, v_account, p_fee, p_duration_s, p_fee)
  returning id into v_id;
  insert into public.fishing_battle_players (battle_id, account_id) values (v_id, v_account);
  perform public._pay(v_account, -p_fee, 'fishing_battle_entry', 'battle ' || v_id);
  return public.fb_state(p_room_id, p_session_token);
end $$;

create or replace function public.fb_join(p_room_id uuid, p_session_token text, p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; b public.fishing_battles;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  perform public._fb_sweep(p_room_id);
  perform public._fb_at_pond(v_account);
  w := public._wallet_lock(v_account);
  select * into b from public.fishing_battles where id = p_battle and room_id = p_room_id for update;
  if not found or b.status <> 'open' then raise exception 'battle closed' using errcode = '22023'; end if;
  if (public._fb_mine(v_account)).id is not null then raise exception 'in battle' using errcode = '22023'; end if;
  if (select count(*) from public.fishing_battle_players where battle_id = p_battle) >= 8 then
    raise exception 'battle full' using errcode = '22023';
  end if;
  if coalesce(w.coins, 0) < b.fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  insert into public.fishing_battle_players (battle_id, account_id) values (p_battle, v_account);
  update public.fishing_battles set pot = pot + b.fee where id = p_battle;
  perform public._pay(v_account, -b.fee, 'fishing_battle_entry', 'battle ' || p_battle);
  return public.fb_state(p_room_id, p_session_token);
end $$;

-- Before the start only: a player gets the fee back; the host leaving cancels the battle for everyone.
create or replace function public.fb_leave(p_room_id uuid, p_session_token text, p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; b public.fishing_battles;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select * into b from public.fishing_battles where id = p_battle and room_id = p_room_id for update;
  if not found or b.status <> 'open'
     or not exists (select 1 from public.fishing_battle_players where battle_id = p_battle and account_id = v_account) then
    raise exception 'battle closed' using errcode = '22023';
  end if;
  if b.host = v_account then
    perform public._fb_cancel(p_battle, 'host left');
  else
    delete from public.fishing_battle_players where battle_id = p_battle and account_id = v_account;
    update public.fishing_battles set pot = pot - b.fee where id = p_battle;
    perform public._pay(v_account, b.fee, 'fishing_battle_refund', 'battle ' || p_battle || ' left');
  end if;
  return public.fb_state(p_room_id, p_session_token);
end $$;

create or replace function public.fb_start(p_room_id uuid, p_session_token text, p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; b public.fishing_battles;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  select * into b from public.fishing_battles where id = p_battle and room_id = p_room_id for update;
  if not found or b.status <> 'open' then raise exception 'battle closed' using errcode = '22023'; end if;
  if b.host <> v_account then raise exception 'not host' using errcode = '22023'; end if;
  if (select count(*) from public.fishing_battle_players where battle_id = p_battle) < 2 then
    raise exception 'need players' using errcode = '22023';
  end if;
  update public.fishing_battles set status = 'live', starts_at = now() + interval '5 seconds',
         ends_at = now() + interval '5 seconds' + make_interval(secs => b.duration_s)
   where id = p_battle;
  return public.fb_state(p_room_id, p_session_token);
end $$;

-- ---------- B2 / C1. A verified catch: the battle score and the treasure-map drop ----------
create table if not exists public.treasure_spots (
  id smallint primary key,
  map text not null,
  x integer not null,
  y integer not null,
  landmark text not null
);
alter table public.treasure_spots enable row level security;
revoke all on public.treasure_spots from anon, authenticated;
-- lib/game/fishing/treasure.ts TREASURE_SPOTS mirrors these (pinned by tests/unit/v21-fishing.test.ts; each is walkable).
insert into public.treasure_spots (id, map, x, y, landmark) values
  (1, 'pond', 120, 60, 'Bụi tre phía bắc ao'),
  (2, 'pond', 470, 112, 'Sau lưng vựa cá cô Ba'),
  (3, 'pond', 132, 250, 'Mé tây ao, gần bãi trùn'),
  (4, 'pond', 440, 350, 'Bụi chuối phía đông nam'),
  (5, 'pond', 80, 384, 'Gốc dừa góc tây nam'),
  (6, 'field', 300, 445, 'Bờ ruộng phía nam'),
  (7, 'field', 360, 316, 'Bờ đê giữa ruộng làng'),
  (8, 'field', 500, 158, 'Bờ thửa tư, cạnh mương'),
  (9, 'field', 640, 466, 'Mép sân phơi lúa'),
  (10, 'field', 150, 470, 'Góc ruộng tây nam')
on conflict (id) do update set map = excluded.map, x = excluded.x, y = excluded.y, landmark = excluded.landmark;
delete from public.treasure_spots where id > 10;

create table if not exists public.treasure_maps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  spot smallint not null references public.treasure_spots(id),
  source text not null check (source in ('fishing', 'boat', 'dig')),
  created_at timestamptz not null default now(),
  last_dig_at timestamptz,
  digs integer not null default 0,
  found_at timestamptz,
  loot integer
);
create index if not exists idx_treasure_maps_acc on public.treasure_maps (account_id, found_at);
alter table public.treasure_maps enable row level security;
revoke all on public.treasure_maps from anon, authenticated;

-- Up to 3 unfound maps at a time.
create or replace function public._treasure_drop(p_account uuid, p_source text, p_chance double precision) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if random() >= p_chance then return; end if;
  if (select count(*) from public.treasure_maps where account_id = p_account and found_at is null) >= 3 then return; end if;
  insert into public.treasure_maps (account_id, spot, source)
  values (p_account, (select id from public.treasure_spots order by random() limit 1), p_source);
end $$;
revoke all on function public._treasure_drop(uuid, text, double precision) from public, anon, authenticated;

create or replace function public._fx_on_fish() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_boat boolean;
begin
  -- a fish taken back from the fridge or the aquarium keeps its old caught_at: not a catch
  if new.caught_at < now() - interval '5 seconds' then return new; end if;
  update public.fishing_battle_players p
     set score = p.score + new.price, catches = p.catches + 1,
         best_species = case when p.best_species is null
                                  or (select rarity from public.fish_species where id = new.species_id)
                                     > (select rarity from public.fish_species where id = p.best_species)
                             then new.species_id else p.best_species end
    from public.fishing_battles b
   where b.id = p.battle_id and p.account_id = new.account_id and b.status = 'live'
     and now() >= b.starts_at and now() < b.ends_at;
  v_boat := exists (select 1 from public.fish_species where id = new.species_id and water = 'deep');
  perform public._treasure_drop(new.account_id, case when v_boat then 'boat' else 'fishing' end,
                                case when v_boat then 0.05 else 0.02 end);
  return new;
end $$;
revoke all on function public._fx_on_fish() from public, anon, authenticated;
drop trigger if exists fish_fx_extras on public.fish;
create trigger fish_fx_extras after insert on public.fish for each row execute function public._fx_on_fish();

-- a worm dig (dig_worms is the only writer of last_dig_at)
create or replace function public._fx_on_dig() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.last_dig_at is distinct from old.last_dig_at and new.last_dig_at is not null then
    perform public._treasure_drop(new.account_id, 'dig', 0.03);
  end if;
  return new;
end $$;
revoke all on function public._fx_on_dig() from public, anon, authenticated;
drop trigger if exists fishing_profiles_fx_dig on public.fishing_profiles;
create trigger fishing_profiles_fx_dig after update of last_dig_at on public.fishing_profiles
  for each row execute function public._fx_on_dig();

-- ---------- C. Treasure maps ----------
-- The hint: the map, the landmark, and the quarter of the map (a 4 × 3 grid cell) the spot is in. Never x/y.
create or replace function public._treasure_json(t public.treasure_maps) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('id', t.id, 'map', s.map, 'landmark', s.landmark, 'source', t.source,
    'cell', jsonb_build_object('col', floor(s.x * 4.0 / m.w)::int, 'row', floor(s.y * 3.0 / m.h)::int),
    'created_at', t.created_at, 'digs', t.digs)
    from public.treasure_spots s join public._pos_maps() m on m.map = s.map where s.id = t.spot
$$;
revoke all on function public._treasure_json(public.treasure_maps) from public, anon, authenticated;

create or replace function public.dig_treasure(p_room_id uuid, p_session_token text, p_map_id uuid, p_map text,
                                               p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.treasure_maps; s public.treasure_spots; v_ac jsonb; v_d numeric; v_loot integer;
        v_heat text;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  select * into t from public.treasure_maps where id = p_map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if t.last_dig_at is not null and t.last_dig_at > now() - interval '4 seconds' then
    raise exception 'dig cooldown' using errcode = '22023', detail = '4';
  end if;
  v_ac := public._pos_claim(v_account, p_map, p_x, p_y, 'dig_treasure', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  update public.treasure_maps set last_dig_at = now(), digs = digs + 1 where id = t.id;
  perform public._fishing_effort(v_account, 0.6, 0.8);
  select * into s from public.treasure_spots where id = t.spot;
  if s.map <> p_map then
    return jsonb_build_object('result', 'miss', 'heat', 'wrong_map', 'map', public._treasure_json(t));
  end if;
  v_d := sqrt((s.x - p_x) ^ 2 + (s.y - p_y) ^ 2);
  if v_d > 16 then
    v_heat := case when v_d <= 48 then 'hot' when v_d <= 120 then 'warm' else 'cold' end;
    return jsonb_build_object('result', 'miss', 'heat', v_heat, 'map', public._treasure_json(t));
  end if;
  -- found: 400–2 500 xu, one chest in twenty a jackpot of 8 000
  v_loot := case when random() < 0.05 then 8000 else 400 + floor(random() * 2101)::int end;
  update public.treasure_maps set found_at = now(), loot = v_loot where id = t.id;
  perform public._pay(v_account, v_loot, 'treasure', 'map ' || t.id);
  perform public._game_event(v_account, 'treasure_found', v_loot, jsonb_build_object('map', s.map, 'spot', s.id));
  perform public._game_event(v_account, 'xp_grant', 50, '{"source":"fishing"}'::jsonb);
  return jsonb_build_object('result', 'found', 'loot', v_loot, 'jackpot', v_loot = 8000,
                            'coins', (select coins from public.wallets where account_id = v_account));
end $$;

-- ---------- D. Farming machines ----------
create table if not exists public.farm_machines (
  account_id uuid not null references public.accounts(id) on delete cascade,
  machine text not null check (machine in ('sprinkler', 'harvester', 'processor')),
  bought_at timestamptz not null default now(),
  primary key (account_id, machine)
);
create table if not exists public.processor_recipes (
  id text primary key,
  name text not null,
  input_kind text not null check (input_kind in ('rice', 'upland')),
  input_id text not null,
  input_kg integer not null check (input_kg > 0),
  value integer not null check (value > 0),       -- xu per batch
  minutes integer not null check (minutes > 0),   -- per batch
  sort_order integer not null default 0
);
-- value ≈ 1.4–1.5 × the input's own price (rice dry price_per_kg; hoa màu price_per_kg)
insert into public.processor_recipes (id, name, input_kind, input_id, input_kg, value, minutes, sort_order) values
  ('gao_trang',   'Gạo trắng đóng bao', 'rice',   'short', 10,  9600, 4, 10),
  ('banh_tet',    'Bánh tét nếp',       'rice',   'nep',   10, 14200, 6, 20),
  ('gao_thom',    'Gạo thơm đặc sản',   'rice',   'thom',  10, 19600, 6, 30),
  ('khoai_say',   'Khoai lang sấy',     'upland', 'khoai', 10,  3950, 3, 40),
  ('bot_bap',     'Bột bắp',            'upland', 'bap',   10,  6700, 4, 50),
  ('tuong_ot',    'Tương ớt',           'upland', 'ot',     5, 11900, 5, 60)
on conflict (id) do update set name = excluded.name, input_kind = excluded.input_kind, input_id = excluded.input_id,
  input_kg = excluded.input_kg, value = excluded.value, minutes = excluded.minutes, sort_order = excluded.sort_order;
create table if not exists public.processor_jobs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  recipe text not null references public.processor_recipes(id),
  batches integer not null check (batches between 1 and 5),
  started_at timestamptz not null default now(),
  ready_at timestamptz not null
);
create table if not exists public.processed_goods (
  account_id uuid not null references public.accounts(id) on delete cascade,
  recipe text not null references public.processor_recipes(id),
  qty integer not null default 0 check (qty >= 0),
  primary key (account_id, recipe)
);
alter table public.farm_machines enable row level security;
alter table public.processor_recipes enable row level security;
alter table public.processor_jobs enable row level security;
alter table public.processed_goods enable row level security;
revoke all on public.farm_machines, public.processor_recipes, public.processor_jobs, public.processed_goods
  from anon, authenticated;

-- lib/game/farm/machines.ts MACHINES mirrors the prices.
create or replace function public._machine_price(p_machine text) returns integer
language sql immutable parallel safe
as $$ select case p_machine when 'sprinkler' then 6000 when 'harvester' then 15000 when 'processor' then 10000 end $$;
revoke all on function public._machine_price(text) from public, anon, authenticated;

create or replace function public.buy_machine(p_session_token text, p_machine text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; v_price integer := public._machine_price(p_machine);
begin
  v_account := public._ac_account(p_session_token);
  if v_price is null then raise exception 'item not available' using errcode = '22023'; end if;
  if not exists (select 1 from public.player_pos where account_id = v_account and map = 'field' and at > now() - interval '10 minutes') then
    raise exception 'not at field' using errcode = '22023';
  end if;
  w := public._wallet_lock(v_account);
  if exists (select 1 from public.farm_machines where account_id = v_account and machine = p_machine) then
    raise exception 'already owned' using errcode = '22023';
  end if;
  if coalesce(w.coins, 0) < v_price then raise exception 'not enough coins' using errcode = '22023'; end if;
  perform public._pay(v_account, -v_price, 'machine', p_machine);
  insert into public.farm_machines (account_id, machine) values (v_account, p_machine);
  return public._fx_extras_state(v_account);
end $$;

create or replace function public._owns_machine(p_account uuid, p_machine text) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.farm_machines where account_id = p_account and machine = p_machine) then
    raise exception 'no machine' using errcode = '22023';
  end if;
end $$;
revoke all on function public._owns_machine(uuid, text) from public, anon, authenticated;

-- Máy tưới: straight to p_level (0 Khô … 3 Sâu) on a plot I farm — watering's checks and caps, one log entry.
create or replace function public.machine_water(p_room_id uuid, p_session_token text, p_plot integer, p_level integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); c public.crops; v_now timestamptz := now();
begin
  if p_plot is null or p_plot not between 1 and 10 or p_level is null or p_level not between 0 and 3 then
    return public._ac_flag(v_account, 'bad_plot', 'machine_water', jsonb_build_object('plot', p_plot, 'level', p_level),
                           p_room_id, 'invalid plot');
  end if;
  perform public._owns_machine(v_account, 'sprinkler');
  perform public._field_open(p_room_id, v_now);
  perform public._wallet_lock(v_account);
  c := public._care_crop(p_room_id, p_plot, v_account, v_now);
  if c.prepared_at is null then raise exception 'not prepared' using errcode = '22023'; end if;
  if public._water_at(c.water_log, v_now) = p_level then
    return public._field_view(p_room_id, v_account, v_now);
  end if;
  if jsonb_array_length(c.water_log) >= 60
     or (select count(*) from jsonb_array_elements(c.water_log) x where (x->>'t')::timestamptz > v_now - interval '1 hour') >= 6 then
    raise exception 'too fast' using errcode = '22023';
  end if;
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', v_now, 'l', p_level))
   where room_id = p_room_id and plot_no = p_plot;
  return public._field_view(p_room_id, v_account, v_now);
end $$;

-- Máy gặt riêng: 0016's _farm_do_rent_harvester without the charge (my own machine); the sweep's step J pays the parts.
create or replace function public.machine_harvest(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); c public.crops; v_now timestamptz := now();
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'machine_harvest', jsonb_build_object('plot', p_plot), p_room_id,
                           'invalid plot');
  end if;
  perform public._owns_machine(v_account, 'harvester');
  perform public._field_open(p_room_id, v_now);
  perform public._wallet_lock(v_account);
  c := public._farm_crop(p_room_id, p_plot, v_account, v_now);
  if c.kind <> 'rice' then raise exception 'wrong crop' using errcode = '22023'; end if;
  if c.harvested_parts >= 6 or public._crop_phase(c, public._variety(c.variety), v_now) not in ('ripe', 'overripe') then
    raise exception 'wrong phase' using errcode = '22023';
  end if;
  if public._water_at(c.water_log, v_now) > 1 then raise exception 'need water' using errcode = '22023'; end if;
  if exists (select 1 from public.plot_leases pl
              where pl.room_id = p_room_id and pl.plot_no = p_plot and pl.until < v_now + interval '30 seconds') then
    raise exception 'lease ends' using errcode = '22023';
  end if;
  update public.crops
     set harvester_at = v_now, harvester_until = v_now + interval '30 seconds', work = null, work_started_at = null
   where room_id = p_room_id and plot_no = p_plot;
  return public._field_view(p_room_id, v_account, v_now);
end $$;

create or replace function public.process_start(p_session_token text, p_recipe text, p_batches integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); r public.processor_recipes; v_need integer; v_have integer;
begin
  if p_batches is null or p_batches not between 1 and 5 then
    return public._ac_flag(v_account, 'bad_qty', 'process_start', jsonb_build_object('recipe', left(p_recipe, 32), 'batches', p_batches),
                           null, 'invalid quantity');
  end if;
  perform public._owns_machine(v_account, 'processor');
  perform public._wallet_lock(v_account);
  select * into r from public.processor_recipes where id = p_recipe;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  if exists (select 1 from public.processor_jobs where account_id = v_account) then
    raise exception 'machine busy' using errcode = '22023';
  end if;
  v_need := r.input_kg * p_batches;
  if r.input_kind = 'rice' then
    select dry_kg into v_have from public.rice_stock where account_id = v_account and variety = r.input_id for update;
    if coalesce(v_have, 0) < v_need then raise exception 'not enough crop' using errcode = '22023'; end if;
    update public.rice_stock set dry_kg = dry_kg - v_need where account_id = v_account and variety = r.input_id;
  else
    select kg into v_have from public.produce_stock where account_id = v_account and upland = r.input_id for update;
    if coalesce(v_have, 0) < v_need then raise exception 'not enough crop' using errcode = '22023'; end if;
    update public.produce_stock set kg = kg - v_need where account_id = v_account and upland = r.input_id;
  end if;
  insert into public.processor_jobs (account_id, recipe, batches, ready_at)
  values (v_account, r.id, p_batches, now() + make_interval(mins => r.minutes * p_batches));
  return public._fx_extras_state(v_account);
end $$;

create or replace function public.process_collect(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); j public.processor_jobs;
begin
  perform public._wallet_lock(v_account);
  select * into j from public.processor_jobs where account_id = v_account for update;
  if not found then raise exception 'no job' using errcode = '22023'; end if;
  if now() < j.ready_at then raise exception 'not ready' using errcode = '22023'; end if;
  delete from public.processor_jobs where account_id = v_account;
  insert into public.processed_goods (account_id, recipe, qty) values (v_account, j.recipe, j.batches)
  on conflict (account_id, recipe) do update set qty = public.processed_goods.qty + excluded.qty;
  perform public._game_event(v_account, 'crop_processed', j.batches, jsonb_build_object('recipe', j.recipe));
  perform public._game_event(v_account, 'xp_grant', 10 * j.batches, '{"source":"fishing"}'::jsonb);
  return public._fx_extras_state(v_account);
end $$;

-- Sold at the field or Chợ Lớn (the server's position): value × qty, ledger produce_sell.
create or replace function public.sell_goods(p_session_token text, p_recipe text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); r public.processor_recipes; v_have integer;
begin
  if p_qty is null or p_qty < 1 then
    return public._ac_flag(v_account, 'bad_qty', 'sell_goods', jsonb_build_object('recipe', left(p_recipe, 32), 'qty', p_qty),
                           null, 'invalid quantity');
  end if;
  if not exists (select 1 from public.player_pos where account_id = v_account and map in ('field', 'market')
                                                  and at > now() - interval '10 minutes') then
    raise exception 'not at field' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);
  select * into r from public.processor_recipes where id = p_recipe;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  select qty into v_have from public.processed_goods where account_id = v_account and recipe = p_recipe for update;
  if coalesce(v_have, 0) < p_qty then raise exception 'not enough crop' using errcode = '22023'; end if;
  update public.processed_goods set qty = qty - p_qty where account_id = v_account and recipe = p_recipe;
  perform public._pay(v_account, r.value * p_qty, 'produce_sell', p_recipe || ' x' || p_qty);
  return public._fx_extras_state(v_account);
end $$;

-- ---------- The state of all four ----------
create or replace function public._fx_extras_state(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return jsonb_build_object(
    'server_now', now(),
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'boat', jsonb_build_object('owned', exists (select 1 from public.boats where account_id = p_account),
                               'aboard', public._boat_aboard(p_account), 'price', (public._boat_geo()->>'price')::int),
    'maps', coalesce((select jsonb_agg(public._treasure_json(t) order by t.created_at)
                        from public.treasure_maps t where t.account_id = p_account and t.found_at is null), '[]'::jsonb),
    'found', (select count(*) from public.treasure_maps where account_id = p_account and found_at is not null),
    'machines', coalesce((select jsonb_agg(machine order by machine) from public.farm_machines where account_id = p_account),
                         '[]'::jsonb),
    'job', (select jsonb_build_object('recipe', recipe, 'batches', batches, 'started_at', started_at, 'ready_at', ready_at)
              from public.processor_jobs where account_id = p_account),
    'goods', coalesce((select jsonb_object_agg(recipe, qty) from public.processed_goods where account_id = p_account and qty > 0),
                      '{}'::jsonb),
    'recipes', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'input_kind', input_kind, 'input_id', input_id,
                                                    'input_kg', input_kg, 'value', value, 'minutes', minutes) order by sort_order)
                  from public.processor_recipes));
end $$;
revoke all on function public._fx_extras_state(uuid) from public, anon, authenticated;

create or replace function public.fishing_extras_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._fx_extras_state(public._auth_account(p_session_token));
end $$;

-- ---------- E. The wipe ----------
create or replace function public._fx_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.boats where account_id = new.account_id;
  delete from public.boat_trips where account_id = new.account_id;
  delete from public.treasure_maps where account_id = new.account_id;
  delete from public.farm_machines where account_id = new.account_id;
  delete from public.processor_jobs where account_id = new.account_id;
  delete from public.processed_goods where account_id = new.account_id;
  delete from public.fishing_battle_players p using public.fishing_battles b
   where b.id = p.battle_id and b.status = 'open' and p.account_id = new.account_id and b.host <> new.account_id;
  return new;
end $$;
revoke all on function public._fx_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_fx_extras on public.anticheat_wipes;
create trigger anticheat_wipes_fx_extras after insert on public.anticheat_wipes for each row execute function public._fx_on_wipe();

-- ---------- Grants ----------
revoke all on function public.buy_boat(uuid, text) from public;
revoke all on function public.board_boat(uuid, text) from public;
revoke all on function public.leave_boat(uuid, text) from public;
revoke all on function public.start_boat_cast(uuid, text) from public;
revoke all on function public.fb_state(uuid, text) from public;
revoke all on function public.fb_create(uuid, text, integer, integer) from public;
revoke all on function public.fb_join(uuid, text, uuid) from public;
revoke all on function public.fb_leave(uuid, text, uuid) from public;
revoke all on function public.fb_start(uuid, text, uuid) from public;
revoke all on function public.dig_treasure(uuid, text, uuid, text, integer, integer) from public;
revoke all on function public.buy_machine(text, text) from public;
revoke all on function public.machine_water(uuid, text, integer, integer) from public;
revoke all on function public.machine_harvest(uuid, text, integer) from public;
revoke all on function public.process_start(text, text, integer) from public;
revoke all on function public.process_collect(text) from public;
revoke all on function public.sell_goods(text, text, integer) from public;
revoke all on function public.fishing_extras_state(text) from public;
grant execute on function public.buy_boat(uuid, text) to anon, authenticated;
grant execute on function public.board_boat(uuid, text) to anon, authenticated;
grant execute on function public.leave_boat(uuid, text) to anon, authenticated;
grant execute on function public.start_boat_cast(uuid, text) to anon, authenticated;
grant execute on function public.fb_state(uuid, text) to anon, authenticated;
grant execute on function public.fb_create(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.fb_join(uuid, text, uuid) to anon, authenticated;
grant execute on function public.fb_leave(uuid, text, uuid) to anon, authenticated;
grant execute on function public.fb_start(uuid, text, uuid) to anon, authenticated;
grant execute on function public.dig_treasure(uuid, text, uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.buy_machine(text, text) to anon, authenticated;
grant execute on function public.machine_water(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.machine_harvest(uuid, text, integer) to anon, authenticated;
grant execute on function public.process_start(text, text, integer) to anon, authenticated;
grant execute on function public.process_collect(text) to anon, authenticated;
grant execute on function public.sell_goods(text, text, integer) to anon, authenticated;
grant execute on function public.fishing_extras_state(text) to anon, authenticated;
