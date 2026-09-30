-- =========================================================
-- 0111_mailbox.sql — Hòm thư (the mailbox) and gift codes (owner 2026-09-30: "giao dịch tiền, vật phẩm thì cho về hòm
-- thư, admin phát quà thì về hòm thư luôn. Cho chỗ nhập code nữa."). ADDITIVE and re-runnable. Run after 0109.
--   A. Tables: mail (one message to one account: sender system / admin / player, kind trade | gift | admin | code |
--      market | return, title, body, xu, the ledger reason those xu are paid with, read / claimed / expires / deleted),
--      mail_items (its attachments: 'item' = shop_items × qty, 'fashion' = an item_catalog id, 'fish' = a fish held in
--      mail_fish, 'produce' = kg of an upland crop), mail_fish (THE ESCROW: a fish in a mail is not a public.fish row —
--      like 0041's fridge_fish — so nothing can sell, list, eat, battle or count it; claiming puts the same row back,
--      same id and caught_at, which is no catch: 0078's mt.catch is not set), mail_batches (every admin gift: who, to
--      whom, what — the faucet's record), gift_codes, gift_code_redemptions, gift_code_attempts.
--   B. Expiry: a mail lives 30 days. An unclaimed 'trade' mail is RETURNED once to the player who gave it (a new
--      'return' mail, 30 days; the xu burned by the trade stay burned); every other unclaimed mail (market, admin, code,
--      return) is DROPPED at expiry: its escrow is deleted, its xu were never paid (nothing is minted). _mail_sweep runs
--      from mail_list, bounded (50 a call, skip locked). Claimed or soft-deleted mail is purged after 30 days.
--   C. Player RPCs (all start with _ac_account): mail_list, mail_read, mail_claim (the mail row FOR UPDATE: one claim;
--      room is checked before anything moves — 'bucket full', 'bait full', 'bag full', 'already owned' — and the mail
--      stays), mail_claim_all (each mail in its own subtransaction; refusals are listed), mail_delete (soft; only a
--      claimed or empty mail), redeem_code.
--   D. Delivery through the mailbox (re-created from their NEWEST bodies, 0106's, changed lines marked 0111):
--      trade_confirm — each side's received assets and xu go into a 'trade' mail to it (0106's rules kept: the 5 % burn,
--      the receiver ≥ 3 days old at level ≥ 5, trade_daily_in); the payer still pays at once. _econ_trade_left counts
--      the trade mails sent today (claimed or not) instead of the claims. _econ_buy (board and stalls) — the buyer pays
--      at once, the goods go into a 'market' mail to the buyer, the seller's share into a 'market' mail to the seller.
--      _econ_settle (auctions) — the goods to the winner's mail, the share to the seller's. A fashion item the receiver
--      owns (or has waiting in the mailbox) is still refused at the deal ('already owned'); the bucket is checked at
--      the claim now, not at the deal.
--   E. Admin (root, _auth_root): admin_mail_send (target {all: true} or {usernames: [...]}: one mail per account),
--      admin_code_create, admin_code_list, admin_code_disable. Gifts and codes carry xu (≤ 1 000 000) and up to 8 items:
--      stackable shop items (bait, seed, fertilizer, pesticide, ammo, pet food; 1–99) and fashion items.
--   F. Gift codes: redeem_code(code) → a 'code' mail (never a direct grant). One per account, at most max_uses in all
--      (the code row FOR UPDATE), between starts_at and expires_at, while enabled. Brute force: 10 failed attempts in an
--      hour lock the box for the rest of that hour ('too many attempts'); the 10th logs the soft 'code_bruteforce'.
--      A refusal is an answer {ok: false, error}, not an exception, so the attempt is recorded.
--   G. Ledger: xu enter a wallet only at the claim, through _pay with the mail's reason and ref 'mail #<id>': 'trade',
--      'market_sell', 'shop_sell', 'auction_sell' (as before — the thương nhân XP and the economy watch keep working),
--      'admin_gift' (NEW: an admin's gift, a faucet) and 'gift_code' (NEW: a code's xu, a faucet). coin_ledger_reason_check
--      is re-created with 0096's full list plus those two. Neither is a _ac_faucet_reasons() entry (0109): never scaled.
--   H. The wipe: an AFTER UPDATE trigger on anticheat_status (ban_state → 'wiped') drops the account's unclaimed mail.
-- Lock order: listing / auction / trade / mail row → wallets (account order) → asset rows. A claim locks its mail row,
-- then the wallet, then the asset rows. New tables are private (RLS on, revoked); every helper is revoked from anon.
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.mail_batches (
  id bigserial primary key,
  sent_by uuid references public.accounts(id) on delete set null,
  target jsonb not null,
  title text not null,
  xu integer not null default 0,
  items jsonb not null default '[]'::jsonb,
  recipients integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.mail_batches enable row level security;
revoke all on public.mail_batches from anon, authenticated;

create table if not exists public.mail (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('system', 'admin', 'player')),
  sender_id uuid references public.accounts(id) on delete set null,
  kind text not null check (kind in ('trade', 'gift', 'admin', 'code', 'market', 'return')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  xu integer not null default 0 check (xu between 0 and 100000000),
  xu_reason text check (xu_reason in ('trade', 'market_sell', 'shop_sell', 'auction_sell', 'admin_gift', 'gift_code')),
  ref text,
  return_to uuid references public.accounts(id) on delete set null,   -- a 'trade' mail unclaimed at expiry goes back here
  batch_id bigint references public.mail_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  read_at timestamptz,
  claimed_at timestamptz,
  deleted_at timestamptz,
  check (xu = 0 or xu_reason is not null)
);
create index if not exists mail_box on public.mail (account_id, created_at desc) where deleted_at is null;
create index if not exists mail_due on public.mail (expires_at) where claimed_at is null;
create index if not exists mail_kind_day on public.mail (account_id, kind, created_at);
alter table public.mail enable row level security;
revoke all on public.mail from anon, authenticated;

create table if not exists public.mail_items (
  id bigserial primary key,
  mail_id bigint not null references public.mail(id) on delete cascade,
  kind text not null check (kind in ('item', 'fashion', 'fish', 'produce')),
  ref text not null,
  qty integer not null check (qty between 1 and 100000),
  name text not null,
  value integer not null default 0
);
create index if not exists mail_items_mail on public.mail_items (mail_id);
alter table public.mail_items enable row level security;
revoke all on public.mail_items from anon, authenticated;

-- the escrow: a fish in a mail (0041's fridge_fish shape)
create table if not exists public.mail_fish (
  id uuid primary key,
  mail_id bigint not null references public.mail(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null check (weight_g > 0),
  price integer not null check (price > 0),
  caught_at timestamptz not null,
  stored_at timestamptz not null default now()
);
create index if not exists mail_fish_mail on public.mail_fish (mail_id);
alter table public.mail_fish enable row level security;
revoke all on public.mail_fish from anon, authenticated;

create table if not exists public.gift_codes (
  id bigserial primary key,
  code text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  title text not null check (char_length(title) between 1 and 120),
  xu integer not null default 0 check (xu between 0 and 1000000),
  items jsonb not null default '[]'::jsonb,
  max_uses integer not null check (max_uses between 1 and 1000000),
  uses integer not null default 0 check (uses >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  enabled boolean not null default true,
  created_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at),
  check (uses <= max_uses)
);
create unique index if not exists gift_codes_code on public.gift_codes (lower(code));
alter table public.gift_codes enable row level security;
revoke all on public.gift_codes from anon, authenticated;

create table if not exists public.gift_code_redemptions (
  code_id bigint not null references public.gift_codes(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  mail_id bigint references public.mail(id) on delete set null,
  at timestamptz not null default now(),
  primary key (code_id, account_id)
);
alter table public.gift_code_redemptions enable row level security;
revoke all on public.gift_code_redemptions from anon, authenticated;

create table if not exists public.gift_code_attempts (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  code text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists gift_code_attempts_acc on public.gift_code_attempts (account_id, at);
alter table public.gift_code_attempts enable row level security;
revoke all on public.gift_code_attempts from anon, authenticated;

-- ---------- G. The ledger: 0096's list plus admin_gift and gift_code ----------
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture',
                    'house_land','house_upkeep','house_build','house_refund','house_rent_pay','house_rent_income',
                    'estate_sale','estate_buy',
                    'dojo_tuition','dojo_exam',
                    'fight_stake','fight_win','fight_refund',
                    'ug_entry','ug_prize','ug_refund',
                    -- v21
                    'login_reward','level_reward','quest_reward','achievement_reward','collection_reward',
                    'ore_sell','mine_tool','potion','upgrade','gem_sell',
                    'trade','market_list','market_sell','market_buy','market_refund','auction_bid','auction_refund',
                    'auction_sell','shop_rent','shop_sell','shop_buy',
                    'pet_gacha','pet_train','pet_battle','aquarium','fish_battle',
                    'boss_reward','dungeon_entry','dungeon_reward','wild_sell',
                    'fishing_battle_entry','fishing_battle_prize','fishing_battle_refund','boat','treasure','machine',
                    'profession','skill_reset','buff_food',
                    'teleport','photo','arena_team_stake','arena_team_win','arena_team_refund',
                    -- 0096
                    'wood_sell','tool_buy','cook_fee','dish_sell',
                    -- 0111: the mailbox's faucets (paid at the claim)
                    'admin_gift','gift_code'));

-- ---------- Helpers ----------
-- The shop kinds a gift or a code may carry (stackable, no durability, no "owned once").
create or replace function public._mail_gift_kinds() returns text[]
language sql immutable parallel safe
as $$ select array['bait', 'seed', 'fertilizer', 'pesticide', 'ammo', 'pet_food'] $$;
revoke all on function public._mail_gift_kinds() from public, anon, authenticated;

-- A new mail to p_to (no attachment yet); returns its id.
create or replace function public._mail_new(p_to uuid, p_sender_kind text, p_sender uuid, p_kind text, p_title text,
                                            p_body text, p_ref text, p_return_to uuid) returns bigint
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id bigint;
begin
  if p_to is null then raise exception 'no recipient' using errcode = '22023'; end if;
  insert into public.mail (account_id, sender_kind, sender_id, kind, title, body, ref, return_to)
  values (p_to, p_sender_kind, p_sender, p_kind, left(coalesce(nullif(btrim(p_title), ''), '✉️'), 120),
          left(coalesce(p_body, ''), 2000), p_ref, p_return_to)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public._mail_new(uuid, text, uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Put p_xu (paid at the claim with p_reason) into a mail. Nothing when p_xu ≤ 0.
create or replace function public._mail_xu(p_mail bigint, p_xu bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if coalesce(p_xu, 0) <= 0 then return; end if;
  if p_mail is null then raise exception 'no mail' using errcode = '22023'; end if;
  update public.mail set xu = xu + p_xu::integer, xu_reason = p_reason where id = p_mail and claimed_at is null;
  if not found then raise exception 'no mail' using errcode = '22023'; end if;
end $$;
revoke all on function public._mail_xu(bigint, bigint, text) from public, anon, authenticated;

-- Does p_account own fashion item p_ref, or have it waiting in an unclaimed mail?
create or replace function public._mail_has_fashion(p_account uuid, p_ref text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (select 1 from public.account_items where account_id = p_account and item_id = p_ref)
      or exists (select 1 from public.mail_items i join public.mail m on m.id = i.mail_id
                  where m.account_id = p_account and m.claimed_at is null and i.kind = 'fashion' and i.ref = p_ref)
$$;
revoke all on function public._mail_has_fashion(uuid, text) from public, anon, authenticated;

-- Take an asset from p_from into mail p_mail's escrow, checked under its row lock (as 0073's _econ_move): 'asset gone'
-- when p_from no longer holds it; 'already owned' for a fashion item the mail's receiver has (or has in the mailbox).
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
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  insert into public.mail_items (mail_id, kind, ref, qty, name, value)
  values (p_mail, p_kind, p_ref, p_qty, coalesce(v_name, p_ref), coalesce(v_value, 0));
end $$;
revoke all on function public._mail_take(bigint, uuid, text, text, integer) from public, anon, authenticated;

-- Validate and normalise the items of an admin gift or a code: [{kind: 'item'|'fashion', ref, qty}] → with names.
-- At most 8, no duplicate; 'item' = a stackable shop item (_mail_gift_kinds), 1–99; 'fashion' = a non-starter
-- catalogue item, qty 1.
create or replace function public._mail_gift_items(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare e jsonb; v_out jsonb := '[]'::jsonb; v_kind text; v_ref text; v_qty integer; v_name text; v_seen text[] := '{}';
begin
  if p_items is null or p_items = 'null'::jsonb then return v_out; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 8 then raise exception 'bad items' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'bad items' using errcode = '22023'; end if;
    v_kind := e->>'kind'; v_ref := e->>'ref';
    begin
      v_qty := coalesce((e->>'qty')::integer, 1);
    exception when others then
      raise exception 'bad items' using errcode = '22023';
    end;
    if v_ref is null or (v_kind || ':' || v_ref) = any(v_seen) then raise exception 'bad items' using errcode = '22023'; end if;
    v_seen := v_seen || (v_kind || ':' || v_ref);
    if v_kind = 'item' then
      select name into v_name from public.shop_items where id = v_ref and kind = any(public._mail_gift_kinds());
      if not found or v_qty < 1 or v_qty > 99 then raise exception 'bad items' using errcode = '22023'; end if;
    elsif v_kind = 'fashion' then
      select name into v_name from public.item_catalog where id = v_ref and not starter and id not like 'vp\_%';
      if not found or v_qty <> 1 then raise exception 'bad items' using errcode = '22023'; end if;
    else
      raise exception 'bad items' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'ref', v_ref, 'qty', v_qty, 'name', v_name));
  end loop;
  return v_out;
end $$;
revoke all on function public._mail_gift_items(jsonb) from public, anon, authenticated;

-- A mail's attachments as json.
create or replace function public._mail_items_json(p_mail bigint) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', i.kind, 'ref', i.ref, 'qty', i.qty, 'name', i.name, 'value', i.value,
           'species', case when i.kind = 'fish' then (select species_id from public.mail_fish where id = public._econ_uuid(i.ref)) end,
           'rarity', case when i.kind = 'fish' then (select s.rarity from public.mail_fish f join public.fish_species s on s.id = f.species_id
                                                      where f.id = public._econ_uuid(i.ref)) end)
         order by i.id), '[]'::jsonb)
    from public.mail_items i where i.mail_id = p_mail
$$;
revoke all on function public._mail_items_json(bigint) from public, anon, authenticated;

-- The mailbox of p_account: unread / claimable counts and the 100 newest mails.
create or replace function public._mail_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.mail where account_id = p_account and deleted_at is null and read_at is null
                 and expires_at > now()),
    'claimable', (select count(*) from public.mail m where m.account_id = p_account and m.deleted_at is null
                    and m.claimed_at is null and m.expires_at > now()
                    and (m.xu > 0 or exists (select 1 from public.mail_items i where i.mail_id = m.id))),
    'mails', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'sender_kind', m.sender_kind,
        'sender_name', case when m.sender_kind = 'player' and m.sender_id is not null then public._news_name(m.sender_id) end,
        'title', m.title, 'body', m.body, 'xu', m.xu, 'items', public._mail_items_json(m.id),
        'read', m.read_at is not null, 'claimed', m.claimed_at is not null,
        'created_ms', public._apt_ms(m.created_at), 'expires_ms', public._apt_ms(m.expires_at))
        order by m.created_at desc, m.id desc)
      from (select * from public.mail where account_id = p_account and deleted_at is null and expires_at > now()
             order by created_at desc, id desc limit 100) m), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._mail_json(uuid) from public, anon, authenticated;

-- ---------- B. Expiry ----------
-- Bounded: 50 due mails a call (skip locked). An unclaimed 'trade' mail goes back to its giver once (a 'return'
-- mail); every other one is dropped with its escrow. Old claimed / deleted mail is purged.
create or replace function public._mail_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.mail; v_new bigint;
begin
  for m in select * from public.mail where claimed_at is null and expires_at <= now()
            order by expires_at limit 50 for update skip locked loop
    if m.kind = 'trade' and m.return_to is not null and m.return_to <> m.account_id
       and (m.xu > 0 or exists (select 1 from public.mail_items where mail_id = m.id)) then
      v_new := public._mail_new(m.return_to, 'system', m.account_id, 'return', '↩️ Hoàn trả: ' || m.title,
                                'Người nhận không nhận thư trong 30 ngày nên đồ được trả lại cho bạn.', m.ref, null);
      update public.mail set xu = m.xu, xu_reason = m.xu_reason where id = v_new;
      update public.mail_items set mail_id = v_new where mail_id = m.id;
      update public.mail_fish set mail_id = v_new where mail_id = m.id;
    end if;
    delete from public.mail where id = m.id;
  end loop;
  delete from public.mail where id in (select id from public.mail
                                        where (claimed_at is not null or deleted_at is not null)
                                          and created_at < now() - interval '30 days' limit 200);
end $$;
revoke all on function public._mail_sweep() from public, anon, authenticated;

-- ---------- C. The claim ----------
-- Claim mail p_id of p_account: {id, xu, items, skipped}. Everything is checked before anything moves; a refusal
-- raises and the mail stays.
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
              where i.mail_id = m.id and i.kind = 'item' and s.kind <> 'bait'
                and coalesce((select v.qty from public.inventory v where v.account_id = p_account and v.item_id = i.ref), 0) + i.qty > 99) then
    raise exception 'bag full' using errcode = '53400';
  end if;
  if v_p2p and exists (select 1 from public.mail_items i where i.mail_id = m.id and i.kind = 'fashion'
                         and exists (select 1 from public.account_items a where a.account_id = p_account and a.item_id = i.ref)) then
    raise exception 'already owned' using errcode = '53400';
  end if;
  -- the move
  for r in select * from public.mail_items where mail_id = m.id order by id loop
    if r.kind = 'item' then
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
    end if;
  end loop;
  if m.xu > 0 then
    perform public._pay(p_account, m.xu, m.xu_reason, 'mail #' || m.id);
  end if;
  update public.mail set claimed_at = now(), read_at = coalesce(read_at, now()) where id = m.id;
  return jsonb_build_object('id', m.id, 'xu', m.xu, 'items', public._mail_items_json(m.id), 'skipped', v_skipped);
end $$;
revoke all on function public._mail_claim_one(uuid, bigint) from public, anon, authenticated;

-- ---------- C. Player RPCs ----------
create or replace function public.mail_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  perform public._mail_sweep();
  return public._mail_json(v_account);
end $$;

create or replace function public.mail_read(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  update public.mail set read_at = now() where id = p_id and account_id = v_account and read_at is null and deleted_at is null;
  return public._mail_json(v_account);
end $$;

create or replace function public.mail_claim(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_got jsonb;
begin
  v_got := public._mail_claim_one(v_account, p_id);
  return public._mail_json(v_account) || jsonb_build_object('claimed', v_got,
    'coins', coalesce((select coins from public.wallets where account_id = v_account), 0));
end $$;

-- Claim every claimable mail (oldest first, at most 50): each one alone; a refusal leaves that mail and is listed.
create or replace function public.mail_claim_all(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_id bigint; v_got jsonb; v_n integer := 0; v_xu bigint := 0;
        v_failed jsonb := '[]'::jsonb;
begin
  for v_id in select m.id from public.mail m
               where m.account_id = v_account and m.deleted_at is null and m.claimed_at is null and m.expires_at > now()
                 and (m.xu > 0 or exists (select 1 from public.mail_items i where i.mail_id = m.id))
               order by m.created_at, m.id limit 50 loop
    begin
      v_got := public._mail_claim_one(v_account, v_id);
      v_n := v_n + 1;
      v_xu := v_xu + (v_got->>'xu')::bigint;
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('id', v_id, 'error', sqlerrm));
    end;
  end loop;
  return public._mail_json(v_account) || jsonb_build_object('claimed_all', jsonb_build_object('n', v_n, 'xu', v_xu, 'failed', v_failed),
    'coins', coalesce((select coins from public.wallets where account_id = v_account), 0));
end $$;

-- Delete (hide) a mail: only a claimed one or one with nothing in it.
create or replace function public.mail_delete(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); m public.mail;
begin
  select * into m from public.mail where id = p_id and account_id = v_account and deleted_at is null for update;
  if not found then raise exception 'no mail' using errcode = '53400'; end if;
  if m.claimed_at is null and (m.xu > 0 or exists (select 1 from public.mail_items where mail_id = m.id)) then
    raise exception 'not claimed' using errcode = '53400';
  end if;
  update public.mail set deleted_at = now(), read_at = coalesce(read_at, now()) where id = m.id;
  return public._mail_json(v_account);
end $$;

-- ---------- F. Gift codes ----------
create or replace function public._code_rule(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what
  when 'fails' then 10           -- failed attempts per account …
  when 'window_min' then 60      -- … in this many minutes lock the box until the oldest of them is this old
end $$;
revoke all on function public._code_rule(text) from public, anon, authenticated;

-- Redeem a gift code: a 'code' mail. Answers {ok: true, mail_id, title, …the mailbox} or {ok: false, error, left}.
create or replace function public.redeem_code(p_session_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_code text; c public.gift_codes; v_fails integer;
        v_err text; v_mail bigint; e jsonb; v_retry integer;
begin
  -- one attempt at a time per account (the count below cannot be raced)
  perform pg_advisory_xact_lock(hashtext('gift_code'), hashtext(v_account::text));
  delete from public.gift_code_attempts where account_id = v_account and at < now() - interval '1 day';
  select count(*) into v_fails from public.gift_code_attempts
   where account_id = v_account and not ok and at > now() - make_interval(mins => public._code_rule('window_min'));
  if v_fails >= public._code_rule('fails') then
    select ceil(extract(epoch from (min(at) + make_interval(mins => public._code_rule('window_min')) - now())))::int into v_retry
      from (select at from public.gift_code_attempts
             where account_id = v_account and not ok and at > now() - make_interval(mins => public._code_rule('window_min'))
             order by at desc limit public._code_rule('fails')) x;
    return jsonb_build_object('ok', false, 'error', 'too many attempts', 'left', 0, 'retry_s', greatest(1, coalesce(v_retry, 60)));
  end if;
  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code !~ '^[A-Z0-9_-]{3,32}$' then
    v_err := 'invalid code';
  else
    select * into c from public.gift_codes where lower(code) = lower(v_code) for update;
    if not found or not c.enabled then v_err := 'invalid code';
    elsif now() < c.starts_at then v_err := 'code not started';
    elsif now() >= c.expires_at then v_err := 'code expired';
    elsif exists (select 1 from public.gift_code_redemptions where code_id = c.id and account_id = v_account) then
      return jsonb_build_object('ok', false, 'error', 'already redeemed', 'left', public._code_rule('fails') - v_fails);
    elsif c.uses >= c.max_uses then v_err := 'code used up';
    end if;
  end if;
  if v_err is not null then
    insert into public.gift_code_attempts (account_id, code, ok) values (v_account, left(v_code, 40), false);
    if v_fails + 1 = public._code_rule('fails') then
      perform public._ac_flag(v_account, 'code_bruteforce', 'redeem_code',
                              jsonb_build_object('fails', v_fails + 1, 'window_min', public._code_rule('window_min'),
                                                 'last', left(v_code, 40)), null, null, false);
    end if;
    return jsonb_build_object('ok', false, 'error', v_err, 'left', greatest(0, public._code_rule('fails') - v_fails - 1));
  end if;
  update public.gift_codes set uses = uses + 1 where id = c.id;
  v_mail := public._mail_new(v_account, 'system', null, 'code', '🎁 ' || c.title, 'Quà từ code ' || c.code || '.',
                             'code #' || c.id, null);
  perform public._mail_xu(v_mail, c.xu, 'gift_code');
  for e in select * from jsonb_array_elements(c.items) loop
    insert into public.mail_items (mail_id, kind, ref, qty, name) values (v_mail, e->>'kind', e->>'ref', (e->>'qty')::int, e->>'name');
  end loop;
  insert into public.gift_code_redemptions (code_id, account_id, mail_id) values (c.id, v_account, v_mail);
  insert into public.gift_code_attempts (account_id, code, ok) values (v_account, left(v_code, 40), true);
  return public._mail_json(v_account) || jsonb_build_object('ok', true, 'mail_id', v_mail, 'title', '🎁 ' || c.title);
end $$;

-- ---------- E. Admin ----------
-- Send a gift to {all: true} (every account not banned) or {usernames: [...]} (≤ 500): one mail each, the same xu and
-- items. Answers {sent, missing: [usernames not found], batch}.
create or replace function public.admin_mail_send(p_session_token text, p_target jsonb, p_title text, p_body text,
                                                  p_xu integer, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); v_items jsonb; v_all boolean; v_names text[]; v_ids uuid[];
        v_missing text[]; v_batch bigint; v_n integer; v_title text := btrim(coalesce(p_title, ''));
begin
  if char_length(v_title) < 1 or char_length(v_title) > 120 or char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'bad title' using errcode = '22023';
  end if;
  if p_xu is null or p_xu < 0 or p_xu > 1000000 then raise exception 'bad xu' using errcode = '22023'; end if;
  v_items := public._mail_gift_items(p_items);
  if p_target is null or jsonb_typeof(p_target) <> 'object' then raise exception 'bad target' using errcode = '22023'; end if;
  v_all := coalesce((p_target->>'all')::boolean, false);
  if v_all then
    v_ids := array(select id from public.accounts where not is_banned order by id);
    v_missing := '{}';
  else
    if jsonb_typeof(p_target->'usernames') <> 'array' or jsonb_array_length(p_target->'usernames') < 1
       or jsonb_array_length(p_target->'usernames') > 500 then
      raise exception 'bad target' using errcode = '22023';
    end if;
    v_names := array(select distinct lower(btrim(x)) from jsonb_array_elements_text(p_target->'usernames') x where btrim(x) <> '');
    if cardinality(v_names) = 0 then raise exception 'bad target' using errcode = '22023'; end if;
    v_ids := array(select id from public.accounts where lower(username) = any(v_names) order by id);
    v_missing := array(select n from unnest(v_names) n
                        where not exists (select 1 from public.accounts a where lower(a.username) = n) order by n);
  end if;
  v_n := coalesce(cardinality(v_ids), 0);
  insert into public.mail_batches (sent_by, target, title, xu, items, recipients)
  values (v_root, case when v_all then '{"all": true}'::jsonb else jsonb_build_object('usernames', to_jsonb(v_names)) end,
          v_title, p_xu, v_items, v_n)
  returning id into v_batch;
  with m as (
    insert into public.mail (account_id, sender_kind, sender_id, kind, title, body, xu, xu_reason, ref, batch_id)
    select a, 'admin', v_root, 'admin', v_title, coalesce(p_body, ''), p_xu, case when p_xu > 0 then 'admin_gift' end,
           'gift #' || v_batch, v_batch
      from unnest(v_ids) a
    returning id)
  insert into public.mail_items (mail_id, kind, ref, qty, name)
  select m.id, i->>'kind', i->>'ref', (i->>'qty')::int, i->>'name' from m cross join jsonb_array_elements(v_items) i;
  return jsonb_build_object('sent', v_n, 'missing', to_jsonb(coalesce(v_missing, '{}')), 'batch', v_batch);
end $$;

create or replace function public.admin_code_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token);
begin
  return jsonb_build_object(
    'codes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', c.code, 'title', c.title, 'xu', c.xu, 'items', c.items, 'max_uses', c.max_uses, 'uses', c.uses,
        'starts_at', c.starts_at, 'expires_at', c.expires_at, 'enabled', c.enabled, 'created_at', c.created_at,
        'created_by', (select username from public.accounts where id = c.created_by)) order by c.created_at desc, c.id desc)
      from (select * from public.gift_codes order by created_at desc, id desc limit 200) c), '[]'::jsonb),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'title', b.title, 'xu', b.xu, 'items', b.items, 'target', b.target, 'recipients', b.recipients,
        'created_at', b.created_at, 'sent_by', (select username from public.accounts where id = b.sent_by),
        'claimed', (select count(*) from public.mail m where m.batch_id = b.id and m.claimed_at is not null))
        order by b.created_at desc, b.id desc)
      from (select * from public.mail_batches order by created_at desc, id desc limit 30) b), '[]'::jsonb));
end $$;

create or replace function public.admin_code_create(p_session_token text, p_code text, p_title text, p_xu integer,
                                                    p_items jsonb, p_max_uses integer, p_starts_at timestamptz,
                                                    p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); v_items jsonb; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_code !~ '^[A-Z0-9_-]{3,32}$' then raise exception 'bad code' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'bad title' using errcode = '22023'; end if;
  if p_xu is null or p_xu < 0 or p_xu > 1000000 then raise exception 'bad xu' using errcode = '22023'; end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000000 then raise exception 'bad uses' using errcode = '22023'; end if;
  if p_expires_at is null or p_expires_at <= coalesce(p_starts_at, now()) or p_expires_at <= now() then
    raise exception 'bad dates' using errcode = '22023';
  end if;
  v_items := public._mail_gift_items(p_items);
  if p_xu = 0 and jsonb_array_length(v_items) = 0 then raise exception 'empty gift' using errcode = '22023'; end if;
  if exists (select 1 from public.gift_codes where lower(code) = lower(v_code)) then
    raise exception 'code exists' using errcode = '23505';
  end if;
  insert into public.gift_codes (code, title, xu, items, max_uses, starts_at, expires_at, created_by)
  values (v_code, btrim(p_title), p_xu, v_items, p_max_uses, coalesce(p_starts_at, now()), p_expires_at, v_root);
  return public.admin_code_list(p_session_token);
end $$;

create or replace function public.admin_code_disable(p_session_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token);
begin
  update public.gift_codes set enabled = false where id = p_id;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  return public.admin_code_list(p_session_token);
end $$;

-- ---------- D. Delivery through the mailbox ----------
-- 0106's _econ_trade_left plus the lines marked 0111: the trade mails sent today count, claimed or not
create or replace function public._econ_trade_left(p_account uuid) returns bigint
language sql stable security definer set search_path = public, extensions
as $$
  select greatest(0, greatest(0, coalesce(public._econ_param('trade_daily_in'), 50000))::bigint
                     - coalesce((select sum(l.delta) from public.coin_ledger l
                                  where l.account_id = p_account and l.reason = 'trade' and l.delta > 0
                                    and coalesce(l.ref, '') not like 'mail #%'                                -- 0111: a claim was counted when sent
                                    and l.created_at >= public._vn_day_start()), 0)   -- 0111 was: and l.created_at >= public._vn_day_start()), 0))
                     -- 0111 {: … and the xu of the trade mails sent to it today
                     - coalesce((select sum(m.xu) from public.mail m
                                  where m.account_id = p_account and m.kind = 'trade' and m.created_at >= public._vn_day_start()), 0))
                     -- 0111 }
$$;
revoke all on function public._econ_trade_left(uuid) from public, anon, authenticated;

-- 0106's trade_confirm plus the lines marked 0111: what each side receives goes into a 'trade' mail to it
create or replace function public.trade_confirm(p_session_token text, p_trade bigint, p_rev integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); t public.econ_trades; e jsonb; a_off jsonb; b_off jsonb;
        v_a bigint; v_b bigint; v_net bigint;
        v_to uuid; v_got bigint;                                                                 -- econ v2
        v_mail_a bigint; v_mail_b bigint;                                                        -- 0111: the mail to a, to b
begin
  select * into t from public.econ_trades where id = p_trade for update;
  if not found or t.status <> 'open' or v_account not in (t.a, t.b) then raise exception 'no trade' using errcode = '53400'; end if;
  if p_rev is distinct from t.rev then raise exception 'offer changed' using errcode = '53400'; end if;
  if t.a = v_account then t.a_ok := true; else t.b_ok := true; end if;
  update public.econ_trades set a_ok = t.a_ok, b_ok = t.b_ok, updated_at = now() where id = t.id;
  if not (t.a_ok and t.b_ok) then return public._econ_trade_json(v_account); end if;
  -- the swap
  if not public._econ_near(t.a, t.b) then raise exception 'too far' using errcode = '53400'; end if;
  if coalesce((t.a_offer->>'coins')::bigint, 0) = 0 and jsonb_array_length(t.a_offer->'items') = 0
     and coalesce((t.b_offer->>'coins')::bigint, 0) = 0 and jsonb_array_length(t.b_offer->'items') = 0 then
    raise exception 'empty trade' using errcode = '53400';
  end if;
  perform public._econ_lock2(t.a, t.b);
  -- the offers again, as they are now (a changed holding raises; nothing moves)
  a_off := public._econ_offer(t.a, t.a_offer);
  b_off := public._econ_offer(t.b, t.b_offer);
  -- 0111 {: one 'trade' mail to each side that receives something (items, or xu left after the burn); unclaimed in 30
  -- days it goes back to the giver
  v_net := (b_off->>'coins')::bigint - (a_off->>'coins')::bigint;
  if jsonb_array_length(b_off->'items') > 0 or (v_net > 0 and public._econ_trade_got(v_net) > 0) then
    v_mail_a := public._mail_new(t.a, 'player', t.b, 'trade', '🤝 Giao dịch với ' || public._news_name(t.b),
                                 'Đồ và xu nhận được từ giao dịch #' || t.id || '.', 'trade #' || t.id, t.b);
  end if;
  if jsonb_array_length(a_off->'items') > 0 or (v_net < 0 and public._econ_trade_got(-v_net) > 0) then
    v_mail_b := public._mail_new(t.b, 'player', t.a, 'trade', '🤝 Giao dịch với ' || public._news_name(t.a),
                                 'Đồ và xu nhận được từ giao dịch #' || t.id || '.', 'trade #' || t.id, t.a);
  end if;
  -- 0111 }
  for e in select * from jsonb_array_elements(a_off->'items') loop
    perform public._mail_take(v_mail_b, t.a, e->>'kind', e->>'ref', (e->>'qty')::integer);   -- 0111 was: perform public._econ_move(t.a, t.b, e->>'kind', e->>'ref', (e->>'qty')::integer);
  end loop;
  for e in select * from jsonb_array_elements(b_off->'items') loop
    perform public._mail_take(v_mail_a, t.b, e->>'kind', e->>'ref', (e->>'qty')::integer);   -- 0111 was: perform public._econ_move(t.b, t.a, e->>'kind', e->>'ref', (e->>'qty')::integer);
  end loop;
  v_net := (b_off->>'coins')::bigint - (a_off->>'coins')::bigint;          -- what a gains
  -- econ v2 {: the xu leg: its receiver must be ≥ recv_days old at level ≥ recv_level and under trade_daily_in today;
  -- it gets the net less the p2p_fee_pct burn (floor). A refusal raises, so nothing above moves either.
  if v_net <> 0 then
    v_to := case when v_net > 0 then t.a else t.b end;
    v_got := public._econ_trade_got(abs(v_net));
    if not public._econ_recv_ok(v_to) then raise exception 'cannot receive xu' using errcode = '53400'; end if;
    if v_got > public._econ_trade_left(v_to) then raise exception 'receive limit' using errcode = '53400'; end if;
  end if;
  -- econ v2 }
  if v_net <> 0 then
    perform public._pay(case when v_net > 0 then t.b else t.a end, (-abs(v_net))::integer, 'trade', 'trade #' || t.id);   -- 0111 was: perform public._pay(t.a, (case when v_net > 0 then v_got else v_net end)::integer, 'trade', 'trade #' || t.id);   -- econ v2 was: perform public._pay(t.a, v_net::integer, 'trade', 'trade #' || t.id);
    perform public._mail_xu(case when v_net > 0 then v_mail_a else v_mail_b end, v_got, 'trade');   -- 0111 was: perform public._pay(t.b, (case when v_net > 0 then -v_net else v_got end)::integer, 'trade', 'trade #' || t.id);  -- econ v2 was: perform public._pay(t.b, (-v_net)::integer, 'trade', 'trade #' || t.id);
  end if;
  update public.econ_trades set status = 'done', a_offer = a_off, b_offer = b_off, updated_at = now() where id = t.id;
  perform public._game_event(t.a, 'trade_done', 1, jsonb_build_object('trade', t.id, 'partner', t.b));
  perform public._game_event(t.b, 'trade_done', 1, jsonb_build_object('trade', t.id, 'partner', t.a));
  v_a := public._econ_offer_value(a_off);
  v_b := public._econ_offer_value(b_off);
  -- the collusion guard: "seller" = the side giving more
  perform public._econ_deal(case when v_a >= v_b then t.a else t.b end, case when v_a >= v_b then t.b else t.a end,
    'trade', t.id, least(greatest(v_a, v_b), 2000000000)::integer, least(least(v_a, v_b), 2000000000)::integer,
    greatest(v_a, v_b) >= public._econ_rule('skew_floor')
      and greatest(v_a, v_b) >= least(v_a, v_b) * public._econ_rule('skew_trade'));
  return public._econ_trade_json(v_account);
end $$;
revoke all on function public.trade_confirm(text, bigint, integer) from public;
grant execute on function public.trade_confirm(text, bigint, integer) to anon, authenticated;

-- 0106's _econ_buy plus the lines marked 0111: the goods to the buyer's mailbox, the share to the seller's
create or replace function public._econ_buy(p_account uuid, p_listing bigint, p_price integer, p_shop boolean) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare l public.econ_listings; v_share integer; v_bal integer;
        v_mail bigint;                                                                           -- 0111: the buyer's mail
begin
  select * into l from public.econ_listings where id = p_listing for update;
  if not found or l.status <> 'open' or l.expires_at <= now() then raise exception 'no listing' using errcode = '53400'; end if;
  if (l.stall_no is not null) <> p_shop then raise exception 'no listing' using errcode = '53400'; end if;
  if l.seller = p_account then raise exception 'own listing' using errcode = '53400'; end if;
  if p_price is distinct from l.price then raise exception 'price changed' using errcode = '53400'; end if;
  perform public._econ_lock2(p_account, l.seller);
  if coalesce((select coins from public.wallets where account_id = p_account), 0) < l.price then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  -- 0111 {
  v_mail := public._mail_new(p_account, 'system', l.seller, 'market', '🛒 Đã mua: ' || l.name,
                             'Mua ở ' || case when p_shop then 'sạp ' || l.stall_no else 'Chợ người chơi' end
                             || ' giá ' || l.price || ' xu, người bán ' || public._news_name(l.seller) || '.',
                             case when p_shop then 'stall #' || l.stall_no else 'market' end || ' #' || l.id, null);
  -- 0111 }
  perform public._mail_take(v_mail, l.seller, l.asset_kind, l.asset_ref, l.qty);   -- 0111 was: perform public._econ_move(l.seller, p_account, l.asset_kind, l.asset_ref, l.qty);
  v_share := floor(l.price::numeric * (100 - public._econ_fee_pct(l.seller)) / 100)::int;   -- econ v2 was: v_share := (l.price::bigint * (100 - public._econ_rule('fee')) / 100)::int;
  v_bal := public._pay(p_account, -l.price, case when p_shop then 'shop_buy' else 'market_buy' end,
                       case when p_shop then 'stall #' || l.stall_no else 'market' end || ' #' || l.id);
  perform public._mail_xu(public._mail_new(l.seller, 'system', p_account, 'market', '💰 Đã bán: ' || l.name, 'Người mua: ' || public._news_name(p_account) || ', giá ' || l.price || ' xu (đã trừ phí chợ).', case when p_shop then 'stall #' || l.stall_no else 'market' end || ' #' || l.id, null),   -- 0111 was: perform public._pay(l.seller, v_share, case when p_shop then 'shop_sell' else 'market_sell' end,
                      v_share, case when p_shop then 'shop_sell' else 'market_sell' end);   -- 0111 was: case when p_shop then 'stall #' || l.stall_no else 'market' end || ' #' || l.id);
  update public.econ_listings set status = 'sold', buyer = p_account, closed_at = now() where id = l.id;
  perform public._game_event(l.seller, 'market_sold', l.price,
    jsonb_build_object('listing', l.id, 'kind', l.asset_kind, 'ref', l.asset_ref, 'via', case when p_shop then 'shop' else 'market' end));
  perform public._econ_deal(l.seller, p_account, case when p_shop then 'shop' else 'market' end, l.id, l.value, l.price,
                            public._econ_skewed(l.value, l.price));
  return v_bal;
end $$;
revoke all on function public._econ_buy(uuid, bigint, integer, boolean) from public, anon, authenticated;

-- 0106's _econ_settle plus the lines marked 0111: the goods to the winner's mailbox, the share to the seller's
create or replace function public._econ_settle(p_id bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare x public.econ_auctions; v_share integer; v_ok boolean := true;
        v_mail bigint;                                                                           -- 0111: the winner's mail
begin
  select * into x from public.econ_auctions where id = p_id and status = 'open' and ends_at <= now() for update skip locked;
  if not found then return; end if;
  if x.top_bidder is null then
    update public.econ_auctions set status = 'expired', closed_at = now() where id = x.id;
    return;
  end if;
  perform public._econ_lock2(x.seller, x.top_bidder);
  begin
    v_mail := public._mail_new(x.top_bidder, 'system', x.seller, 'market', '🏆 Thắng đấu giá: ' || x.name, 'Giá cuối ' || x.top_bid || ' xu.', 'auction #' || x.id, null);   -- 0111
    perform public._mail_take(v_mail, x.seller, x.asset_kind, x.asset_ref, x.qty);   -- 0111 was: perform public._econ_move(x.seller, x.top_bidder, x.asset_kind, x.asset_ref, x.qty);
  exception when others then
    v_ok := false;
  end;
  if not v_ok then                                   -- the asset is gone or cannot be received: the bid goes back
    perform public._pay(x.top_bidder, x.top_bid, 'auction_refund', 'auction #' || x.id || ': void');
    update public.econ_auctions set status = 'void', closed_at = now() where id = x.id;
    return;
  end if;
  v_share := floor(x.top_bid::numeric * (100 - public._econ_fee_pct(x.seller)) / 100)::int;   -- econ v2 was: v_share := (x.top_bid::bigint * (100 - public._econ_rule('fee')) / 100)::int;
  perform public._mail_xu(public._mail_new(x.seller, 'system', x.top_bidder, 'market', '💰 Đấu giá xong: ' || x.name, 'Giá cuối ' || x.top_bid || ' xu (đã trừ phí chợ).', 'auction #' || x.id, null), v_share, 'auction_sell');   -- 0111 was: perform public._pay(x.seller, v_share, 'auction_sell', 'auction #' || x.id);
  update public.econ_auctions set status = 'sold', closed_at = now() where id = x.id;
  perform public._game_event(x.top_bidder, 'auction_won', x.top_bid,
    jsonb_build_object('auction', x.id, 'kind', x.asset_kind, 'ref', x.asset_ref));
  perform public._econ_deal(x.seller, x.top_bidder, 'auction', x.id, x.value, x.top_bid,
                            public._econ_skewed(x.value, x.top_bid));
end $$;
revoke all on function public._econ_settle(bigint) from public, anon, authenticated;

-- ---------- H. The wipe ----------
create or replace function public._mail_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.ban_state = 'wiped' and old.ban_state is distinct from 'wiped' then
    delete from public.mail where account_id = new.account_id and claimed_at is null;
  end if;
  return new;
end $$;
revoke all on function public._mail_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_status_mail_wipe on public.anticheat_status;
create trigger anticheat_status_mail_wipe after update of ban_state on public.anticheat_status
  for each row execute function public._mail_on_wipe();

-- ---------- grants ----------
do $$
declare s text;
begin
  foreach s in array array[
    'mail_list(text)', 'mail_read(text, bigint)', 'mail_claim(text, bigint)', 'mail_claim_all(text)',
    'mail_delete(text, bigint)', 'redeem_code(text, text)',
    'admin_mail_send(text, jsonb, text, text, integer, jsonb)', 'admin_code_list(text)',
    'admin_code_create(text, text, text, integer, jsonb, integer, timestamptz, timestamptz)',
    'admin_code_disable(text, bigint)'] loop
    execute format('revoke all on function public.%s from public', s);
    execute format('grant execute on function public.%s to anon, authenticated', s);
  end loop;
end $$;
