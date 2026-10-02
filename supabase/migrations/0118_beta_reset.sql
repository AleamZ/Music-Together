-- =========================================================
-- 0118_beta_reset.sql — "Kết thúc Beta": the two-phase reset of production and the "Kỷ niệm Beta" rewards
-- (spec docs/superpowers/specs/2026-10-01-beta-reset.md). ADDITIVE and re-runnable. Run after 0117.
-- THIS MIGRATION CHANGES NO PLAYER DATA. It only defines tables, catalogue rows, guards and functions; the reset itself
-- runs only when root calls, in order:
--   phase 1  admin_beta_snapshot(token)            — values every account (read-only on player data), stores the
--                                                     snapshot; re-runnable until phase 2 (each run replaces it).
--   phase 2  admin_beta_reset(token, 'RESET BETA')  — ONE transaction: wipes every per-player table (beta_reset_scope),
--                                                     keeps the accounts, grants the rewards. A second call is a no-op.
--            admin_beta_status(token)               — the state, tier counts, the top and every player's preview.
-- Every re-created function is its newest body plus the lines marked "-- 0118" (an added line), "-- 0118 {" … "-- 0118 }"
-- (an added block) or "… -- 0118 was: <old line>" (a changed line).
--   A. Catalogue: item_catalog.exclusive / furniture_catalog.exclusive; the five "Kỷ niệm Beta" fashion items (beta_*,
--      price 0, never in a shop) and the mascot furniture beta_mascot; the title achievement beta_pioneer
--      ("Người khai hoang Beta", stat 'level' goal 1000: never earned in play); characters.beta_tier (the name frame).
--   B. Exclusivity guards (server-side, triggers + sell_fashion_item): an exclusive item can enter account_items /
--      furniture_items only through the reset (mt.beta_grant) or the claim of its own Beta mail; it can never change
--      owner, be put in any other mail, a market listing, an auction, a trade or a fashion gift, or be sold.
--   C. account_boosts: a time-limited per-account modifier ('xp' %, 'npc_quota' %), read by _pg_add_xp (the XP and the
--      day caps × (100 + pct) / 100) and _npc_sale / _npc_quota (the thương lái full-price band × (100 + pct) / 100).
--   D. beta_reset_scope: EVERY public table that references an account, classified wipe / keep / release / reset; the
--      reset refuses to run while any such table is unclassified (a later migration must classify its tables).
--   E. beta_state (the singleton), beta_snapshot, beta_rewards; _beta_net_worth, _beta_tier.
--   F. Root RPCs (_auth_root): admin_beta_snapshot, admin_beta_reset, admin_beta_status. Player read: beta_me(token).
-- =========================================================

-- ---------- A. Catalogue ----------
alter table public.item_catalog add column if not exists exclusive boolean not null default false;
alter table public.furniture_catalog add column if not exists exclusive boolean not null default false;
alter table public.characters add column if not exists beta_tier smallint check (beta_tier between 0 and 5);

insert into public.item_catalog (id, slot, name, price, starter, sort_order, gender, exclusive) values
  ('beta_dep',  'shoes',  'Dép kỷ niệm Beta',    0, false, 960, 'unisex', true),
  ('beta_non',  'hat',    'Nón kỷ niệm Beta',    0, false, 961, 'unisex', true),
  ('beta_quan', 'bottom', 'Quần kỷ niệm Beta',   0, false, 962, 'unisex', true),
  ('beta_ao',   'top',    'Áo kỷ niệm Beta',     0, false, 963, 'unisex', true),
  ('beta_set',  'outfit', 'Set đồ kỷ niệm Beta', 0, false, 964, 'unisex', true)
on conflict (id) do update set slot = excluded.slot, name = excluded.name, price = 0, starter = false,
  sort_order = excluded.sort_order, gender = excluded.gender, exclusive = true;

-- price 1: furniture_catalog_price_check (> 0); never sold (the guard refuses furniture_buy), not counted in net worth
insert into public.furniture_catalog (id, name, kind, style, w, h, price, cap, exclusive) values
  ('beta_mascot', 'Linh vật Kỷ niệm Beta', 'plant', 'hien_dai', 1, 1, 1, 0, true)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, style = excluded.style, w = 1, h = 1,
  price = 1, cap = 0, exclusive = true;

insert into public.achievement_catalog (id, name, descr, stat, goal, reward, title, sort_order) values
  ('beta_pioneer', 'Người khai hoang Beta', 'Dành riêng cho người chơi thời Beta (quà kỷ niệm, không thể đạt được nữa)',
   'level', 1000, 0, 'Người khai hoang Beta', 999)
on conflict (id) do update set name = excluded.name, descr = excluded.descr, stat = 'level', goal = 1000, reward = 0,
  title = excluded.title, sort_order = 999;

create or replace function public._item_exclusive(p_id text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select exclusive from public.item_catalog where id = p_id), false) $$;
revoke all on function public._item_exclusive(text) from public, anon, authenticated;

create or replace function public._furniture_exclusive(p_id text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select exclusive from public.furniture_catalog where id = p_id), false) $$;
revoke all on function public._furniture_exclusive(text) from public, anon, authenticated;

-- ---------- B. Exclusivity guards ----------
-- The reset sets mt.beta_grant = 'on' for its own transaction (set_config(…, true)); nothing else does.
create or replace function public._beta_granting() returns boolean
language sql stable set search_path = public, extensions
as $$ select coalesce(current_setting('mt.beta_grant', true), '') = 'on' $$;
revoke all on function public._beta_granting() from public, anon, authenticated;

create or replace function public._beta_guard_account_items() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public._item_exclusive(new.item_id) then return new; end if;
  if tg_op = 'UPDATE' then
    if new.account_id is distinct from old.account_id or new.item_id is distinct from old.item_id then
      raise exception 'exclusive item' using errcode = '22023';
    end if;
    return new;
  end if;
  -- an insert: the reset, or the claim of this account's own unclaimed Beta mail carrying this item
  if public._beta_granting() or exists (
       select 1 from public.mail m join public.mail_items i on i.mail_id = m.id
        where m.account_id = new.account_id and m.ref = 'beta_reset' and m.sender_kind = 'system'
          and m.claimed_at is null and i.kind = 'fashion' and i.ref = new.item_id) then
    return new;
  end if;
  raise exception 'exclusive item' using errcode = '22023';
end $$;
revoke all on function public._beta_guard_account_items() from public, anon, authenticated;
drop trigger if exists account_items_beta_guard on public.account_items;
create trigger account_items_beta_guard before insert or update on public.account_items
  for each row execute function public._beta_guard_account_items();

create or replace function public._beta_guard_mail_items() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.kind = 'fashion' and public._item_exclusive(new.ref) and not public._beta_granting() then
    raise exception 'exclusive item' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public._beta_guard_mail_items() from public, anon, authenticated;
drop trigger if exists mail_items_beta_guard on public.mail_items;
create trigger mail_items_beta_guard before insert or update on public.mail_items
  for each row execute function public._beta_guard_mail_items();

create or replace function public._beta_guard_listing() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.asset_kind = 'fashion' and public._item_exclusive(new.asset_ref) then
    raise exception 'exclusive item' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public._beta_guard_listing() from public, anon, authenticated;
drop trigger if exists econ_listings_beta_guard on public.econ_listings;
create trigger econ_listings_beta_guard before insert or update on public.econ_listings
  for each row execute function public._beta_guard_listing();
drop trigger if exists econ_auctions_beta_guard on public.econ_auctions;
create trigger econ_auctions_beta_guard before insert or update on public.econ_auctions
  for each row execute function public._beta_guard_listing();

create or replace function public._beta_guard_trade() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if exists (select 1 from jsonb_array_elements(coalesce(new.a_offer->'items', '[]'::jsonb) || coalesce(new.b_offer->'items', '[]'::jsonb)) e
              where e->>'kind' = 'fashion' and public._item_exclusive(e->>'ref')) then
    raise exception 'exclusive item' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public._beta_guard_trade() from public, anon, authenticated;
drop trigger if exists econ_trades_beta_guard on public.econ_trades;
create trigger econ_trades_beta_guard before insert or update on public.econ_trades
  for each row execute function public._beta_guard_trade();

create or replace function public._beta_guard_gift() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if public._item_exclusive(new.item_id) then raise exception 'exclusive item' using errcode = '22023'; end if;
  return new;
end $$;
revoke all on function public._beta_guard_gift() from public, anon, authenticated;
drop trigger if exists fashion_gifts_beta_guard on public.fashion_gifts;
create trigger fashion_gifts_beta_guard before insert on public.fashion_gifts
  for each row execute function public._beta_guard_gift();

create or replace function public._beta_guard_furniture() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public._furniture_exclusive(new.item_id) then return new; end if;
  if tg_op = 'UPDATE' then
    if new.account_id is distinct from old.account_id or new.item_id is distinct from old.item_id then
      raise exception 'exclusive item' using errcode = '22023';
    end if;
    return new;
  end if;
  if not public._beta_granting() then raise exception 'exclusive item' using errcode = '22023'; end if;
  return new;
end $$;
revoke all on function public._beta_guard_furniture() from public, anon, authenticated;
drop trigger if exists furniture_items_beta_guard on public.furniture_items;
create trigger furniture_items_beta_guard before insert or update on public.furniture_items
  for each row execute function public._beta_guard_furniture();

-- sell_fashion_item: 0029's body (v20.2's uniform line) plus the exclusive refusal.
create or replace function public.sell_fashion_item(p_session_token text, p_item_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_account uuid;
  v_item public.item_catalog;
  v_refund integer;
  v_new_bal integer;
begin
  v_account := public._auth_account(p_session_token);
  if p_item_id like 'vp\_%' then raise exception 'uniform' using errcode = '22023'; end if;          -- v20.2
  if public._item_exclusive(p_item_id) then raise exception 'exclusive item' using errcode = '22023'; end if;   -- 0118
  perform public._wallet_lock(v_account);

  if not exists (select 1 from public.account_items where account_id = v_account and item_id = p_item_id) then
    raise exception 'not owned' using errcode = '22023';
  end if;

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found or v_item.starter then
    raise exception 'cannot sell item' using errcode = '22023';
  end if;

  v_refund := greatest(1, (v_item.price * 50) / 100);

  delete from public.account_items where account_id = v_account and item_id = p_item_id;

  -- Revert currently worn item to null or default starter
  update public.characters
  set hat = case when hat = p_item_id then null else hat end,
      neck = case when neck = p_item_id then null else neck end,
      outfit = case when outfit = p_item_id then null else outfit end,
      wrist = case when wrist = p_item_id then null else wrist end,
      hairpin = case when hairpin = p_item_id then null else hairpin end,
      top = case when top = p_item_id then null else top end,
      bottom = case when bottom = p_item_id then null else bottom end,
      shoes = case when shoes = p_item_id then 'shoes_dep_blue' else shoes end,
      updated_at = now()
  where account_id = v_account;

  v_new_bal := public._pay(v_account, v_refund, 'sell', 'fashion: ' || p_item_id);

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'refund', v_refund, 'coins', v_new_bal);
end; $function$;
revoke all on function public.sell_fashion_item(text, text) from public;
grant execute on function public.sell_fashion_item(text, text) to anon, authenticated;

-- ---------- C. account_boosts ----------
create table if not exists public.account_boosts (
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('xp', 'npc_quota')),
  pct integer not null check (pct between 1 and 200),
  starts_at timestamptz not null default now(),
  until timestamptz not null,
  source text not null default 'beta_reset',
  primary key (account_id, kind),
  check (until > starts_at)
);
alter table public.account_boosts enable row level security;
revoke all on public.account_boosts from anon, authenticated;

-- The active boost of p_account of this kind in % (0 when none or expired).
create or replace function public._boost_pct(p_account uuid, p_kind text) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select b.pct from public.account_boosts b
                    where b.account_id = p_account and b.kind = p_kind and b.starts_at <= now() and b.until > now()), 0)
$$;
revoke all on function public._boost_pct(uuid, text) from public, anon, authenticated;

-- _pg_add_xp: 0070's body; the boost scales the XP and the day caps.
create or replace function public._pg_add_xp(p_account uuid, p_bucket text, p_xp integer) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.player_progress; v_used integer; v_add integer; v_new integer; l integer;
        v_boost integer := public._boost_pct(p_account, 'xp');                                    -- 0118
begin
  if p_xp <= 0 then return 0; end if;
  r := public._pg_row(p_account);
  v_used := case p_bucket when 'fish' then r.xp_fish when 'earn' then r.xp_earn when 'fight' then r.xp_fight
                          when 'grant' then r.xp_grant else 0 end;
  v_add := greatest(0, least(p_xp * (100 + v_boost) / 100,                                       -- 0118 was: v_add := greatest(0, least(p_xp, public._pg_cap(p_bucket) - v_used));
                             public._pg_cap(p_bucket) * (100 + v_boost) / 100 - v_used));         -- 0118
  if v_add = 0 then return 0; end if;
  v_new := public._pg_level_for(r.xp + v_add);
  update public.player_progress
     set xp = xp + v_add, level = v_new, updated_at = now(),
         xp_fish = xp_fish + case when p_bucket = 'fish' then v_add else 0 end,
         xp_earn = xp_earn + case when p_bucket = 'earn' then v_add else 0 end,
         xp_fight = xp_fight + case when p_bucket = 'fight' then v_add else 0 end,
         xp_grant = xp_grant + case when p_bucket = 'grant' then v_add else 0 end
   where account_id = p_account;
  if v_new > r.level then
    update public.characters set pg_level = v_new where account_id = p_account;
    for l in r.level + 1 .. v_new loop
      perform public._pg_reward(p_account, public._pg_level_reward(l), 'level_reward', 'lên cấp ' || l);
      perform public._game_event(p_account, 'level_up', l, '{}'::jsonb);
    end loop;
  end if;
  return v_add;
end $$;
revoke all on function public._pg_add_xp(uuid, text, integer) from public, anon, authenticated;

-- _npc_quota / _npc_sale: 0100's bodies; the boost widens the full-price band (and the half band never starts before it).
create or replace function public._npc_quota(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'gross', coalesce((select gross from public.econ_npc_days where account_id = p_account and day = public._vn_today()), 0),
    'full', floor(greatest(0, coalesce(public._econ_param('npc_full'), 20000)) * (100 + public._boost_pct(p_account, 'npc_quota')) / 100)::bigint,   -- 0118 was: 'full', greatest(0, coalesce(public._econ_param('npc_full'), 20000)),
    'half', greatest(floor(greatest(0, coalesce(public._econ_param('npc_full'), 20000)) * (100 + public._boost_pct(p_account, 'npc_quota')) / 100)::bigint,   -- 0118 was: 'half', greatest(0, coalesce(public._econ_param('npc_full'), 20000), coalesce(public._econ_param('npc_half'), 40000)),
                     coalesce(public._econ_param('npc_half'), 40000)),                              -- 0118
    'tail_pct', least(100, greatest(0, coalesce(public._econ_param('npc_tail_pct'), 20))),
    'boost_pct', public._boost_pct(p_account, 'npc_quota'))                                          -- 0118
$$;
revoke all on function public._npc_quota(uuid) from public, anon, authenticated;

create or replace function public._npc_sale(p_account uuid, p_gross integer) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_day date := public._vn_today(); v_before bigint; v_full numeric; v_half numeric; v_tail numeric;
        v_a numeric; v_b numeric; v_c numeric; v_paid integer;
begin
  if coalesce(p_gross, 0) <= 0 then return 0; end if;
  v_full := greatest(0, coalesce(public._econ_param('npc_full'), 20000));
  v_full := floor(v_full * (100 + public._boost_pct(p_account, 'npc_quota')) / 100);              -- 0118
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
revoke all on function public._npc_sale(uuid, integer) from public, anon, authenticated;

-- ---------- D. beta_reset_scope ----------
-- action: wipe (every row deleted, in ord order), keep, release (a world row whose owner columns are cleared),
-- reset (custom: characters back to the default look). Tables with no account column that hold per-player state are
-- listed too (aquarium_*, apt_tv, house_room_rents, leaderboard_cache, econ_deals, groundbait_spots, card_tables).
create table if not exists public.beta_reset_scope (
  tbl text primary key,
  action text not null check (action in ('wipe', 'keep', 'release', 'reset')),
  ord integer not null default 100,
  note text not null default ''
);
alter table public.beta_reset_scope enable row level security;
revoke all on public.beta_reset_scope from anon, authenticated;

insert into public.beta_reset_scope (tbl, action, ord, note) values
  -- KEEP: identity, login, moderation evidence, chat, music, admin records, history
  ('account_auth', 'keep', 0, 'the auth link (email login)'),
  ('account_secrets', 'keep', 0, 'the password hash'),
  ('sessions', 'keep', 0, 'logins stay valid'),
  ('members', 'keep', 0, 'room memberships (not progress)'),
  ('rooms', 'keep', 0, 'rooms (created_by)'),
  ('queue_items', 'keep', 0, 'the music queue'),
  ('video_durations', 'keep', 0, 'music metadata'),
  ('chat_messages', 'keep', 0, 'chat history kept (owner: optional, keep)'),
  ('party_chat', 'keep', 0, 'chat history'),
  ('feedback', 'keep', 0, 'player feedback'),
  ('news_posts', 'keep', 0, 'news (author)'),
  ('news_post_reads', 'keep', 0, 'read markers'),
  ('news_event_reads', 'keep', 0, 'read markers'),
  ('anticheat_status', 'keep', 0, 'ban state, strikes: moderation'),
  ('anticheat_events', 'keep', 0, 'evidence'),
  ('anticheat_wipes', 'keep', 0, 'evidence (holdings snapshots of wiped cheaters)'),
  ('anticheat_config', 'keep', 0, 'config (mode_changed_by)'),
  ('blacklisted_accounts', 'keep', 0, 'blacklist'),
  ('ac_bot', 'keep', 0, 'bot verdicts: evidence'),
  ('fight_conflicts', 'keep', 0, 'fight reports: evidence'),
  ('gift_codes', 'keep', 0, 'admin codes'),
  ('gift_code_redemptions', 'keep', 0, 'kept so an old code cannot be redeemed twice'),
  ('gift_code_attempts', 'keep', 0, 'brute-force window'),
  ('mail_batches', 'keep', 0, 'admin gift records'),
  ('econ_params', 'keep', 0, 'economy knobs (updated_by)'),
  ('coin_ledger', 'keep', 0, 'the ledger is never pruned; the reset writes one ''wipe'' row per non-zero wallet'),
  ('boss_fights', 'keep', 0, 'world boss schedule (killer)'),
  ('field_rats', 'keep', 0, 'world state (caught_by)'),
  ('wild_spawns', 'keep', 0, 'world state (taken_by)'),
  ('world_snow', 'keep', 0, 'world state (started_by)'),
  ('forest_felled', 'keep', 0, 'world state: felled trees regrow on their own clock'),
  ('account_boosts', 'keep', 0, '0118: the post-reset boosts'),
  ('beta_snapshot', 'keep', 0, '0118'),
  ('beta_rewards', 'keep', 0, '0118'),
  ('beta_state', 'keep', 0, '0118'),
  -- RELEASE: world rows back to unowned
  ('apartments', 'release', 0, 'owner, tenure, paint cleared'),
  ('house_lots', 'release', 0, 'owner, house, paint cleared (as _house_free)'),
  ('field_plots', 'release', 0, 'owner and prices cleared'),
  ('econ_stalls', 'release', 0, 'renter cleared'),
  -- RESET
  ('characters', 'reset', 0, 'look back to the default (gender kept), titles cleared; Beta title + frame for the eligible'),
  -- WIPE (ord: children before parents where a foreign key would refuse)
  ('mail', 'wipe', 10, 'old mail and its escrow (mail_items, mail_fish cascade)'),
  ('econ_bids', 'wipe', 10, 'market'), ('econ_auctions', 'wipe', 20, 'market'), ('econ_listings', 'wipe', 20, 'market'),
  ('econ_trades', 'wipe', 20, 'market'), ('econ_deals', 'wipe', 20, 'market history'), ('econ_npc_days', 'wipe', 20, 'thương lái quota'),
  ('estate_listings', 'wipe', 20, 'real estate'), ('estate_sales', 'wipe', 20, 'real estate history'),
  ('estate_cooldowns', 'wipe', 20, 'real estate'), ('land_offers', 'wipe', 20, 'land'), ('plot_leases', 'wipe', 20, 'land'),
  ('crops', 'wipe', 20, 'crops'), ('fashion_gifts', 'wipe', 20, 'gift history (day limit)'),
  ('house_tenancies', 'wipe', 20, 'houses'), ('house_room_rents', 'wipe', 20, 'houses'), ('house_guests', 'wipe', 20, 'houses'),
  ('house_knocks', 'wipe', 20, 'houses'), ('apt_guests', 'wipe', 20, 'apartments'), ('apt_knocks', 'wipe', 20, 'apartments'),
  ('apt_tv', 'wipe', 20, 'apartments'),
  ('aquarium_fish', 'wipe', 30, 'aquariums'), ('aquarium_tanks', 'wipe', 31, 'aquariums'), ('furniture_items', 'wipe', 32, 'furniture'),
  ('fridge_fish', 'wipe', 30, 'fridge'), ('fish', 'wipe', 40, 'fish'), ('casts', 'wipe', 30, 'fishing'),
  ('fishing_profiles', 'wipe', 35, 'fishing'), ('rods', 'wipe', 40, 'rods (rod_parts cascade)'),
  ('fishing_groundbait', 'wipe', 30, 'fishing'), ('groundbait_spots', 'wipe', 30, 'fishing'),
  ('fishing_battle_players', 'wipe', 30, 'fishing'), ('fishing_battles', 'wipe', 31, 'fishing'), ('fish_fighters', 'wipe', 30, 'fishing'),
  ('net_throws', 'wipe', 30, 'fishing'), ('personal_bests', 'wipe', 30, 'fishing'), ('boat_trips', 'wipe', 30, 'boats'),
  ('boats', 'wipe', 31, 'boats'), ('river_rows', 'wipe', 30, 'river'),
  ('pet_battles', 'wipe', 30, 'pets'), ('pet_care_rounds', 'wipe', 30, 'pets'), ('pet_items', 'wipe', 30, 'pets'),
  ('pet_owner', 'wipe', 31, 'pets'), ('pets', 'wipe', 40, 'pets'), ('dogs', 'wipe', 30, 'the dog'),
  ('owned_vehicles', 'wipe', 30, 'vehicles'), ('umbrellas', 'wipe', 30, 'umbrellas'), ('motel_stays', 'wipe', 30, 'motel'),
  ('account_items', 'wipe', 30, 'fashion owned'), ('inventory', 'wipe', 30, 'the bag'), ('item_upgrades', 'wipe', 30, 'upgrades'),
  ('wallets', 'wipe', 50, 'xu (after the ledger rows)'),
  ('rice_stock', 'wipe', 30, 'farm'), ('produce_stock', 'wipe', 30, 'farm'), ('processed_goods', 'wipe', 30, 'farm'),
  ('processor_jobs', 'wipe', 30, 'farm'), ('drying_slots', 'wipe', 30, 'farm'), ('farm_machines', 'wipe', 30, 'farm'),
  ('farm_profiles', 'wipe', 30, 'farm'), ('critters', 'wipe', 30, 'gathering'), ('gather_cooldowns', 'wipe', 30, 'gathering'),
  ('rat_bag', 'wipe', 30, 'rats'), ('sling_aims', 'wipe', 30, 'rats'),
  ('chop_profile', 'wipe', 30, 'forest'), ('chop_progress', 'wipe', 30, 'forest'), ('wood_bag', 'wipe', 30, 'forest'),
  ('cook_profile', 'wipe', 30, 'cooking'), ('cooked_dishes', 'wipe', 30, 'cooking'), ('craft_bag', 'wipe', 30, 'crafting'),
  ('craft_rounds', 'wipe', 30, 'crafting'), ('potion_quality', 'wipe', 30, 'crafting'),
  ('mine_digs', 'wipe', 30, 'mining'), ('mine_tools', 'wipe', 30, 'mining'), ('mining_profiles', 'wipe', 30, 'mining'),
  ('treasure_digs', 'wipe', 30, 'treasure'), ('treasure_maps', 'wipe', 31, 'treasure'),
  ('wild_album', 'wipe', 30, 'wild'), ('wild_bag', 'wipe', 30, 'wild'), ('wild_photos', 'wipe', 30, 'wild'), ('wild_profile', 'wipe', 30, 'wild'),
  ('photo_album', 'wipe', 30, 'photos'), ('photo_save_log', 'wipe', 30, 'photos'),
  ('player_progress', 'wipe', 30, 'level / XP'), ('player_stats', 'wipe', 30, 'stats'), ('player_fishdex', 'wipe', 30, 'collections'),
  ('player_achievements', 'wipe', 30, 'achievements'), ('player_collections', 'wipe', 30, 'collections'),
  ('player_waypoints', 'wipe', 30, 'discovered waypoints'), ('player_skills', 'wipe', 30, 'skills'),
  ('player_professions', 'wipe', 30, 'professions'), ('player_profession_main', 'wipe', 30, 'professions'),
  ('prof_starter_grants', 'wipe', 30, 'professions'), ('prof_tools', 'wipe', 30, 'professions'), ('perk_payouts', 'wipe', 30, 'professions'),
  ('player_buffs', 'wipe', 30, 'buffs'), ('player_stamina', 'wipe', 30, 'vitals'), ('player_pos', 'wipe', 30, 'position'),
  ('vitals', 'wipe', 30, 'vitals'), ('rain_state', 'wipe', 30, 'vitals'), ('heat_state', 'wipe', 30, 'vitals'), ('rest_state', 'wipe', 30, 'vitals'),
  ('quest_progress', 'wipe', 30, 'quests'), ('quest_visits', 'wipe', 30, 'quests'), ('story_progress', 'wipe', 30, 'story'),
  ('company_contrib', 'wipe', 30, 'company quest contributions'), ('login_streaks', 'wipe', 30, 'login rewards'),
  ('game_events', 'wipe', 30, 'event feed'), ('leaderboard_cache', 'wipe', 30, 'boards'),
  ('martial_enrollments', 'wipe', 30, 'dojo'), ('martial_exams', 'wipe', 30, 'dojo'), ('fight_profiles', 'wipe', 30, 'fights'),
  ('fight_logs', 'wipe', 30, 'fights'), ('fight_stamina_short', 'wipe', 30, 'fights'), ('fight_rings', 'wipe', 30, 'fights'),
  ('fight_matches', 'wipe', 31, 'fights'), ('arena_series', 'wipe', 30, 'arena'), ('arena_teams', 'wipe', 31, 'arena'),
  ('ug_queue', 'wipe', 30, 'underground'), ('ug_cup_entries', 'wipe', 30, 'underground'), ('ug_ladder', 'wipe', 30, 'underground'),
  ('ug_profiles', 'wipe', 30, 'underground'), ('boss_hits', 'wipe', 30, 'bosses'),
  ('dungeon_members', 'wipe', 30, 'dungeons'), ('dungeon_runs', 'wipe', 31, 'dungeons'),
  ('party_invites', 'wipe', 30, 'parties'), ('party_members', 'wipe', 30, 'parties'), ('parties', 'wipe', 31, 'parties'),
  ('card_hands', 'wipe', 30, 'cards'), ('card_log', 'wipe', 30, 'cards'), ('card_seats', 'wipe', 30, 'cards (chips)'),
  ('card_tables', 'wipe', 31, 'cards'), ('mg_live', 'wipe', 30, 'minigames'), ('world_mg', 'wipe', 30, 'minigames'),
  ('ac_stat_flags', 'wipe', 30, 'anti-cheat stat flags (not bans)'), ('ac_hours', 'wipe', 30, 'anti-cheat statistics'),
  ('ac_play_stats', 'wipe', 30, 'anti-cheat statistics'), ('ac_rate', 'wipe', 30, 'anti-cheat statistics')
on conflict (tbl) do update set action = excluded.action, ord = excluded.ord, note = excluded.note;

-- The public tables that reference an account (an account_id column or a foreign key to accounts) and are not in
-- beta_reset_scope. The reset refuses while this is not empty.
create or replace function public._beta_unclassified() returns text[]
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname <> 'accounts'
     and (exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.accounts'::regclass)
          or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped))
     and not exists (select 1 from public.beta_reset_scope s where s.tbl = c.relname)
$$;
revoke all on function public._beta_unclassified() from public, anon, authenticated;

-- ---------- E. State, snapshot, rewards ----------
create table if not exists public.beta_state (
  id smallint primary key default 1 check (id = 1),
  snapshot_at timestamptz,
  snapshot_by uuid,
  snapshot_runs integer not null default 0,
  applied_at timestamptz,
  applied_by uuid,
  summary jsonb
);
insert into public.beta_state (id) values (1) on conflict (id) do nothing;
alter table public.beta_state enable row level security;
revoke all on public.beta_state from anon, authenticated;

-- account_id has no foreign key on purpose: the snapshot is the audit record of who had what.
create table if not exists public.beta_snapshot (
  account_id uuid primary key,
  username text not null,
  is_root boolean not null,
  is_banned boolean not null,
  eligible boolean not null,
  net_worth bigint not null,
  breakdown jsonb not null,
  tier smallint not null check (tier between 0 and 5),
  computed_at timestamptz not null default now()
);
alter table public.beta_snapshot enable row level security;
revoke all on public.beta_snapshot from anon, authenticated;

create table if not exists public.beta_rewards (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  tier smallint not null,
  net_worth bigint not null,
  mail_id bigint,
  xu integer not null,
  items jsonb not null,
  rod_id bigint,
  furniture_id bigint,
  title_granted boolean not null default false,
  frame boolean not null default false,
  boost_until timestamptz,
  granted_at timestamptz not null default now()
);
alter table public.beta_rewards enable row level security;
revoke all on public.beta_rewards from anon, authenticated;

create or replace function public._beta_tier(p_nw bigint) returns smallint
language sql immutable parallel safe
as $$ select (case when p_nw >= 500000 then 5 when p_nw >= 200000 then 4 when p_nw >= 100000 then 3
                   when p_nw >= 50000 then 2 when p_nw >= 10000 then 1 else 0 end)::smallint $$;
revoke all on function public._beta_tier(bigint) from public, anon, authenticated;

-- The starter xu by tier (econ v2 scale: a new player's first days are ≈ 1–3 k xu).
create or replace function public._beta_starter_xu(p_tier integer) returns integer
language sql immutable parallel safe
as $$ select (array[2000, 5000, 8000, 12000, 16000, 20000])[least(greatest(p_tier, 0), 5) + 1] $$;
revoke all on function public._beta_starter_xu(integer) from public, anon, authenticated;

-- The fashion rewards by tier (cumulative).
create or replace function public._beta_items(p_tier integer) returns text[]
language sql immutable parallel safe
as $$ select (array['beta_dep', 'beta_non', 'beta_quan', 'beta_ao', 'beta_set'])[1:least(greatest(p_tier, 0), 5)] $$;
revoke all on function public._beta_items(integer) from public, anon, authenticated;

-- Net worth of p_account, by part (all integers, xu):
--   xu         wallet coins
--   items      inventory qty × shop_items.price (bait, parts, seeds, …; a null price counts 0)
--   rods       each rod instance at its shop price + each mounted part at its shop price
--   fish       bucket + fridge fish at their price; aquarium fish (in the account's tanks) at their price
--   fashion    owned item_catalog items at their price (starters, uniforms and exclusives are price 0)
--   furniture  owned furniture at its catalogue price (exclusive excluded)
--   vehicles   vehicle_catalog.price; pets _pet_species_price(species)
--   land       each owned field plot 800 000 (the village price, inside the 400 000–2 400 000 band)
--   houses     each owned lot _house_price('land') + build_cost × _estate_rule('build') / 100 (the appraisal);
--              an owned flat _apt_price('buy') (a rented one 0)
--   produce    produce_stock kg × upland_crops.price_per_kg
create or replace function public._beta_net_worth(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  with p as (
    select
      coalesce((select coins from public.wallets where account_id = p_account), 0)::bigint xu,
      coalesce((select sum(i.qty::bigint * coalesce(s.price, 0)) from public.inventory i join public.shop_items s on s.id = i.item_id
                 where i.account_id = p_account), 0)::bigint items,
      (coalesce((select sum(coalesce(s.price, 0)) from public.rods r join public.shop_items s on s.id = r.item_id where r.account_id = p_account), 0)
       + coalesce((select sum(coalesce(s.price, 0)) from public.rods r join public.rod_parts rp on rp.rod_id = r.id
                    join public.shop_items s on s.id = rp.item_id where r.account_id = p_account), 0))::bigint rods,
      (coalesce((select sum(price) from public.fish where account_id = p_account), 0)
       + coalesce((select sum(price) from public.fridge_fish where account_id = p_account), 0)
       + coalesce((select sum(af.price) from public.aquarium_fish af join public.furniture_items f on f.id = af.tank
                    where f.account_id = p_account), 0))::bigint fish,
      coalesce((select sum(c.price) from public.account_items a join public.item_catalog c on c.id = a.item_id
                 where a.account_id = p_account and not c.exclusive), 0)::bigint fashion,
      coalesce((select sum(c.price) from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
                 where f.account_id = p_account and not c.exclusive), 0)::bigint furniture,
      coalesce((select sum(v.price) from public.owned_vehicles o join public.vehicle_catalog v on v.id = o.vehicle_id
                 where o.account_id = p_account), 0)::bigint vehicles,
      coalesce((select sum(coalesce(public._pet_species_price(species), 0)) from public.pets where account_id = p_account), 0)::bigint pets,
      (select count(*) * 800000 from public.field_plots where owner_id = p_account)::bigint land,
      (coalesce((select sum(public._house_price('land') + build_cost::bigint * public._estate_rule('build') / 100)
                   from public.house_lots where owner_id = p_account), 0)
       + coalesce((select count(*) * public._apt_price('buy') from public.apartments where owner_id = p_account and tenure = 'own'), 0))::bigint houses,
      coalesce((select sum(ps.kg::bigint * u.price_per_kg) from public.produce_stock ps join public.upland_crops u on u.id = ps.upland
                 where ps.account_id = p_account), 0)::bigint produce
  )
  select jsonb_build_object('xu', xu, 'items', items, 'rods', rods, 'fish', fish, 'fashion', fashion, 'furniture', furniture,
                            'vehicles', vehicles, 'pets', pets, 'land', land, 'houses', houses, 'produce', produce,
                            'total', xu + items + rods + fish + fashion + furniture + vehicles + pets + land + houses + produce)
    from p
$$;
revoke all on function public._beta_net_worth(uuid) from public, anon, authenticated;

-- Banned for the rewards: accounts.is_banned, an anti-cheat ban state (pending_wipe / wiped) or the blacklist.
create or replace function public._beta_banned(p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select is_banned from public.accounts where id = p_account), false)
      or exists (select 1 from public.anticheat_status where account_id = p_account and ban_state is not null)
      or exists (select 1 from public.blacklisted_accounts where account_id = p_account)
$$;
revoke all on function public._beta_banned(uuid) from public, anon, authenticated;

-- ---------- F. Root RPCs ----------
-- Phase 1: value every account; replaces the stored snapshot. Read-only on player data. Refused after phase 2.
create or replace function public.admin_beta_snapshot(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); st public.beta_state; v_n integer;
begin
  select * into st from public.beta_state where id = 1 for update;
  if st.applied_at is not null then raise exception 'already applied' using errcode = '53400'; end if;
  delete from public.beta_snapshot;
  insert into public.beta_snapshot (account_id, username, is_root, is_banned, eligible, net_worth, breakdown, tier, computed_at)
  select a.id, a.username, a.is_root, public._beta_banned(a.id),
         not a.is_root and not public._beta_banned(a.id),
         (nw->>'total')::bigint, nw, public._beta_tier((nw->>'total')::bigint), now()
    from public.accounts a cross join lateral (select public._beta_net_worth(a.id) nw) x;
  get diagnostics v_n = row_count;
  update public.beta_state set snapshot_at = now(), snapshot_by = v_root, snapshot_runs = snapshot_runs + 1 where id = 1;
  return public.admin_beta_status(p_session_token) || jsonb_build_object('snapshot_rows', v_n);
end $$;
revoke all on function public.admin_beta_snapshot(text) from public;
grant execute on function public.admin_beta_snapshot(text) to anon, authenticated;

create or replace function public.admin_beta_status(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare st public.beta_state;
begin
  perform public._auth_root(p_session_token);
  select * into st from public.beta_state where id = 1;
  return jsonb_build_object(
    'snapshot_at', st.snapshot_at, 'snapshot_runs', st.snapshot_runs, 'applied_at', st.applied_at, 'summary', st.summary,
    'unclassified', to_jsonb(public._beta_unclassified()),
    'accounts_now', (select count(*) from public.accounts),
    'new_since_snapshot', (select count(*) from public.accounts a where not exists (select 1 from public.beta_snapshot s where s.account_id = a.id)),
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('tier', t, 'eligible', (select count(*) from public.beta_snapshot s where s.tier = t and s.eligible),
                                                            'excluded', (select count(*) from public.beta_snapshot s where s.tier = t and not s.eligible),
                                                            'xu', public._beta_starter_xu(t), 'items', to_jsonb(public._beta_items(t)))
                                         order by t), '[]'::jsonb) from generate_series(0, 5) t),
    'totals', (select jsonb_build_object('accounts', count(*), 'eligible', count(*) filter (where eligible),
                                         'excluded', count(*) filter (where not eligible),
                                         'net_worth', coalesce(sum(net_worth), 0),
                                         'starter_xu', coalesce(sum(public._beta_starter_xu(tier)) filter (where eligible), 0))
                 from public.beta_snapshot),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('username', x.username, 'net_worth', x.net_worth, 'tier', x.tier,
                                                         'eligible', x.eligible) order by x.net_worth desc), '[]'::jsonb)
              from (select * from public.beta_snapshot order by net_worth desc, username limit 20) x),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('username', s.username, 'net_worth', s.net_worth, 'tier', s.tier,
                                                             'eligible', s.eligible, 'is_root', s.is_root, 'is_banned', s.is_banned,
                                                             'breakdown', s.breakdown,
                                                             'xu', case when s.eligible then public._beta_starter_xu(s.tier) else 0 end,
                                                             'items', case when s.eligible then to_jsonb(public._beta_items(s.tier)) else '[]'::jsonb end,
                                                             'granted', exists (select 1 from public.beta_rewards r where r.account_id = s.account_id))
                                          order by s.net_worth desc, s.username), '[]'::jsonb)
                  from (select * from public.beta_snapshot order by net_worth desc, username limit 2000) s));
end $$;
revoke all on function public.admin_beta_status(text) from public;
grant execute on function public.admin_beta_status(text) to anon, authenticated;

-- Phase 2: the reset. ONE transaction; a second call (applied_at set) returns {ok, already: true} and does nothing.
create or replace function public.admin_beta_reset(p_session_token text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); st public.beta_state; r record; v_n integer;
        v_wiped jsonb := '{}'::jsonb; v_unc text[]; v_mail bigint; v_rod bigint; v_furn bigint; v_items text[]; v_xu integer;
        v_until timestamptz := now() + interval '7 days'; v_granted integer := 0; v_ledger integer; v_supply bigint; it text;
begin
  if p_confirm is distinct from 'RESET BETA' then raise exception 'confirm phrase' using errcode = '22023'; end if;
  select * into st from public.beta_state where id = 1 for update;
  if st.applied_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'applied_at', st.applied_at, 'summary', st.summary);
  end if;
  if st.snapshot_at is null or not exists (select 1 from public.beta_snapshot) then
    raise exception 'no snapshot' using errcode = '53400';
  end if;
  v_unc := public._beta_unclassified();
  if cardinality(v_unc) > 0 then raise exception 'unclassified tables: %', array_to_string(v_unc, ', ') using errcode = '53400'; end if;
  perform set_config('mt.beta_grant', 'on', true);

  -- the ledger first: one 'wipe' row per non-zero wallet, so the supply series stays exact
  select coalesce(sum(coins), 0) into v_supply from public.wallets;
  insert into public.coin_ledger (account_id, delta, balance, reason, ref)
  select account_id, -coins, 0, 'wipe', 'beta reset' from public.wallets where coins <> 0;
  get diagnostics v_ledger = row_count;

  -- release the world rows
  update public.apartments set owner_id = null, tenure = null, paid_until = null, visibility = 'private', wall = null,
         floor = null, since = null where owner_id is not null or tenure is not null;
  update public.house_lots set owner_id = null, bought_at = null, paid_until = null, grid = null, rooms = null, roof = 'ngoi',
         wall = null, floor = null, visibility = 'private', build_cost = 0 where owner_id is not null or build_cost <> 0 or grid is not null;
  update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
   where owner_id is not null or sale_price is not null or sublease_price is not null;
  update public.econ_stalls set renter = null, paid_until = null where renter is not null;

  -- wipe
  for r in select * from public.beta_reset_scope where action = 'wipe' order by ord, tbl loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    execute format('delete from public.%I', r.tbl);
    get diagnostics v_n = row_count;
    v_wiped := v_wiped || jsonb_build_object(r.tbl, v_n);
  end loop;

  -- characters back to the default look (the body's gender kept)
  update public.characters
     set skin = 'warm', hair = case when gender = 'nu' then 'long' else 'short' end, hair_color = 'black',
         hat = 'hat_nonla', top = 'top_baba_yellow', bottom = 'bottom_shorts_red', shoes = 'shoes_dep_blue', neck = 'neck_khanran',
         hand = null, pet = null, outfit = null, wrist = null, hairpin = null, belt = null, ug_title = null, pg_level = null,
         pg_title = null, body = null, beta_tier = null, updated_at = now();

  -- the rewards: every eligible account in the snapshot that still exists
  for r in select s.* from public.beta_snapshot s join public.accounts a on a.id = s.account_id
            where s.eligible order by s.net_worth desc, s.username loop
    v_items := public._beta_items(r.tier);
    v_xu := public._beta_starter_xu(r.tier);
    v_mail := public._mail_new(r.account_id, 'system', null, 'gift', 'Quà kỷ niệm Beta',
      'Cảm ơn bạn đã cùng Music Together đi qua thời Beta! Thế giới đã được làm mới, nhưng bạn vẫn được giữ tài khoản. '
      || 'Trong thư: ' || v_xu || ' xu khởi nghiệp, mồi câu và thính'
      || case when cardinality(v_items) > 0 then ', cùng bộ đồ "Kỷ niệm Beta" độc quyền (không bán, không tặng, không giao dịch)' else '' end
      || '. Đã gửi thẳng vào túi: cần tre lắp sẵn lưỡi và dây, linh vật Kỷ niệm Beta, danh hiệu "Người khai hoang Beta", '
      || 'khung tên β và 7 ngày tăng tốc (+50% kinh nghiệm, +25% hạn mức thương lái trả đủ giá). '
      || 'Giá trị tài sản lúc chốt: ' || r.net_worth || ' xu (bậc ' || r.tier || ').',
      'beta_reset', null);
    update public.mail set expires_at = now() + interval '90 days' where id = v_mail;
    perform public._mail_xu(v_mail, v_xu, 'admin_gift');
    insert into public.mail_items (mail_id, kind, ref, qty, name, value) values
      (v_mail, 'item', 'bait_shrimp', 20, (select name from public.shop_items where id = 'bait_shrimp'), 0),
      (v_mail, 'item', 'gb_cam', 5, (select name from public.shop_items where id = 'gb_cam'), 0);
    foreach it in array v_items loop
      insert into public.mail_items (mail_id, kind, ref, qty, name, value)
      values (v_mail, 'fashion', it, 1, (select name from public.item_catalog where id = it), 0);
    end loop;
    -- the rod, assembled: Cần tre + Lưỡi đơn nhỏ + Dây cước 0.2 (its snaps) + Phao lông gà
    insert into public.rods (account_id, item_id, durability, name)
    values (r.account_id, 'rod_bamboo', (select durability from public.shop_items where id = 'rod_bamboo'), 'Cần tre Beta')
    returning id into v_rod;
    insert into public.rod_parts (rod_id, slot, item_id, durability) values
      (v_rod, 'hook', 'hook_small', null),
      (v_rod, 'line', 'line_02', (select durability from public.shop_items where id = 'line_02')),
      (v_rod, 'bobber', 'bobber_feather', null);
    insert into public.furniture_items (account_id, item_id) values (r.account_id, 'beta_mascot') returning id into v_furn;
    -- the title (an achievement, worn) and the frame
    insert into public.player_achievements (account_id, achievement) values (r.account_id, 'beta_pioneer') on conflict do nothing;
    perform public._pg_row(r.account_id);
    update public.player_progress set title = 'beta_pioneer', updated_at = now() where account_id = r.account_id;
    insert into public.characters (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender)
    values (r.account_id, 'warm', 'short', 'black', 'hat_nonla', 'top_baba_yellow', 'bottom_shorts_red', 'shoes_dep_blue', 'neck_khanran', 'nam')
    on conflict (account_id) do nothing;
    update public.characters set pg_title = 'Người khai hoang Beta', pg_level = 1, beta_tier = r.tier where account_id = r.account_id;
    -- the boosts
    insert into public.account_boosts (account_id, kind, pct, starts_at, until, source) values
      (r.account_id, 'xp', 50, now(), v_until, 'beta_reset'), (r.account_id, 'npc_quota', 25, now(), v_until, 'beta_reset')
    on conflict (account_id, kind) do update set pct = excluded.pct, starts_at = excluded.starts_at, until = excluded.until, source = excluded.source;
    insert into public.beta_rewards (account_id, tier, net_worth, mail_id, xu, items, rod_id, furniture_id, title_granted, frame, boost_until)
    values (r.account_id, r.tier, r.net_worth, v_mail, v_xu, to_jsonb(v_items), v_rod, v_furn, true, true, v_until);
    v_granted := v_granted + 1;
  end loop;

  update public.beta_state
     set applied_at = now(), applied_by = v_root,
         summary = jsonb_build_object('wiped', v_wiped, 'ledger_rows', v_ledger, 'supply_burned', v_supply,
                                      'rewarded', v_granted, 'boost_until', v_until,
                                      'accounts', (select count(*) from public.accounts))
   where id = 1;
  perform set_config('mt.beta_grant', '', true);   -- the grant window closes with the reset, not with the transaction
  return jsonb_build_object('ok', true, 'already', false, 'applied_at', now(),
                            'summary', (select summary from public.beta_state where id = 1));
end $$;
revoke all on function public.admin_beta_reset(text, text) from public;
grant execute on function public.admin_beta_reset(text, text) to anon, authenticated;

-- The player's own Beta perks: tier, frame, title, the boosts (for the HUD countdown). A read.
create or replace function public.beta_me(p_session_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); b public.beta_rewards;
begin
  select * into b from public.beta_rewards where account_id = v_account;
  return jsonb_build_object(
    'server_now', now(),
    'beta', b.account_id is not null,
    'tier', b.tier,
    'title', case when b.title_granted then 'Người khai hoang Beta' end,
    'boosts', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'pct', k.pct, 'until', k.until) order by k.kind)
                          from public.account_boosts k where k.account_id = v_account and k.until > now()), '[]'::jsonb));
end $$;
revoke all on function public.beta_me(text) from public;
grant execute on function public.beta_me(text) to anon, authenticated;
