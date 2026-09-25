-- =========================================================
-- 0017_v16_cards.sql — v16 "Góc đánh bài" (docs/superpowers/specs/2026-09-25-music-together-v16-cards-design.md): three
-- card tables per room in the hall — Tiến lên miền Nam, Cào (ba cây, cào cái) and Texas Hold'em no-limit — played for
-- the players' own xu, zero-sum, with no house cut. The server shuffles with a crypto RNG, deals, keeps every hand
-- private, validates every move, runs the lazy turn timers and settles.
-- ADDITIVE (no data drop) and re-runnable. Requires 0013, 0015 and 0016: it keeps 0016's ledger reasons and re-creates
-- 0016's _ac_holdings and _ac_wipe. Every function relies on `set search_path = public, extensions`. Time and randomness are
-- injectable: the engines take p_now and every deal takes p_deck (null = shuffle); the public RPCs pass now() and null.
-- A card is an integer c in 0–51: rank r = c / 4 (0–12 = 3 4 5 6 7 8 9 10 J Q K A 2), suit s = c % 4 (0 ♠, 1 ♣, 2 ♦, 3 ♥).
-- =========================================================

-- ---------- A. Tables (§11.1): private — RLS on, no policies, no grants; only the SECURITY DEFINER functions touch them ----------
create table if not exists public.card_tables (                      -- one row per room and game, created lazily
  room_id uuid not null references public.rooms(id) on delete cascade,
  game text not null check (game in ('tienlen', 'cao', 'poker')),
  stake integer check (stake in (100, 1000, 10000)),                 -- S; null while the table is empty
  v bigint not null default 0,                                        -- bumped by every visible change
  seq integer not null default 0,                                     -- bumped by every game action (R24)
  hand_no integer not null default 0,
  phase text not null default 'idle'
    check (phase in ('idle', 'countdown', 'deal_wait', 'playing', 'peek', 'result')),
  turn integer,
  deadline timestamptz,                                               -- the turn's or the phase's (§10)
  pos integer,                                                        -- poker: the button; Cào: the last dealer
  lead_id uuid,                                                       -- Tiến lên: the last game's nhất
  first_game boolean not null default true,
  pub jsonb not null default '{}'::jsonb,                             -- the game's public state (§11.4)
  last jsonb,                                                         -- the last hand's result
  primary key (room_id, game)
);

create table if not exists public.card_seats (
  room_id uuid not null,
  game text not null,
  seat integer not null check (seat between 1 and 6),
  account_id uuid not null references public.accounts(id) on delete cascade,
  chips integer not null default 0 check (chips >= 0),                -- poker: the stack on the table
  escrow integer not null default 0 check (escrow >= 0),              -- Tiến lên, Cào: the seat's balance in the hand
  leaving boolean not null default false,                             -- left a live hand: kept until the hand ends (R2)
  missed smallint not null default 0,                                 -- consecutive timeouts
  seen_at timestamptz not null default now(),                         -- the owner's last card call (R28)
  sat_at timestamptz not null default now(),
  primary key (room_id, game, seat),
  constraint card_seats_one_per_room unique (room_id, account_id),   -- leaving rows included (R2)
  foreign key (room_id, game) references public.card_tables (room_id, game) on delete cascade
);

create table if not exists public.card_hands (                       -- every dealt hand; card_hand shows only its owner's
  room_id uuid not null,
  game text not null,
  hand_no integer not null,
  seat integer not null,
  account_id uuid not null,                                           -- no FK: the row goes at the table's next deal
  dealt integer[] not null,
  cards integer[] not null,                                           -- the cards still held
  primary key (room_id, game, hand_no, seat),
  foreign key (room_id, game) references public.card_tables (room_id, game) on delete cascade
);

create table if not exists public.card_secrets (                     -- the poker board, dealt at the start
  room_id uuid not null,
  game text not null,
  hand_no integer not null,
  board integer[] not null,
  primary key (room_id, game, hand_no),
  foreign key (room_id, game) references public.card_tables (room_id, game) on delete cascade
);

create table if not exists public.card_log (                         -- evidence for disputes, kept 14 days (R34); no FK
  id bigint generated always as identity primary key,
  room_id uuid not null,
  game text not null,
  hand_no integer,
  account_id uuid,
  seat integer,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists idx_card_log_at on public.card_log (at);

alter table public.card_tables enable row level security;
alter table public.card_seats enable row level security;
alter table public.card_hands enable row level security;
alter table public.card_secrets enable row level security;
alter table public.card_log enable row level security;
revoke all on public.card_tables, public.card_seats, public.card_hands, public.card_secrets, public.card_log
  from anon, authenticated;

-- The reasons in force after 0015 and 0016, plus the five card moves (R33).
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund'));

-- ---------- B. Pure helpers (§6.4, §7): cards and Tiến lên; lib/game/cards/*.ts mirrors them (tests/fixtures/card-cases.json) ----------
-- Seats per table: Tiến lên 4, Cào 6, poker 6.
create or replace function public._card_max(p_game text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_game when 'tienlen' then 4 when 'cao' then 6 when 'poker' then 6 end $$;

-- An integer array from a JSON array (in its order); anything else is empty.
create or replace function public._card_ints(p jsonb) returns integer[]
language sql immutable set search_path = public, extensions
as $$
  select coalesce(array_agg(x::int order by n), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality e(x, n)
$$;

-- The seats of p_order after p_seat in turn order (ascending, wrapping round), p_seat itself left out.
create or replace function public._card_after(p_order integer[], p_seat integer) returns integer[]
language sql immutable set search_path = public, extensions
as $$ select coalesce(array_agg(s order by s <= p_seat, s), '{}') from unnest(p_order) s where s <> p_seat $$;

-- A uniform integer in 0 … p_n − 1 from 4 random bytes, without modulo bias (values ≥ 2³² − 2³² mod n are drawn again).
create or replace function public._card_rand(p_n integer) returns integer
language plpgsql volatile set search_path = public, extensions
as $$
declare b bytea; v bigint; lim bigint := 4294967296 - (4294967296 % p_n);
begin
  loop
    b := extensions.gen_random_bytes(4);
    v := get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3);
    exit when v < lim;
  end loop;
  return (v % p_n)::int;
end $$;

-- A shuffled deck (Fisher–Yates); no seed is kept.
create or replace function public._card_shuffle() returns integer[]
language plpgsql volatile set search_path = public, extensions
as $$
declare d integer[] := array(select generate_series(0, 51)); i integer; j integer; t integer;
begin
  for i in reverse 52..2 loop
    j := 1 + public._card_rand(i);
    t := d[i]; d[i] := d[j]; d[j] := t;
  end loop;
  return d;
end $$;

-- A Tiến lên combination (§7.1): {type, len, key, cards} or null. key = the highest card; len = cards for a sảnh, pairs
-- for đôi thông, else the card count; cards sorted.
create or replace function public._tl_combo(p_cards integer[]) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare c integer[] := array(select x from unnest(p_cards) x order by x); n integer := coalesce(cardinality(p_cards), 0);
        r integer[]; t text; ln integer;
begin
  if n = 0 or exists (select 1 from unnest(c) x where x is null or x not between 0 and 51)
     or (select count(distinct x) from unnest(c) x) <> n then
    return null;
  end if;
  r := array(select x / 4 from unnest(c) with ordinality u(x, k) order by k);
  if r[1] = r[n] and n <= 4 then
    t := case n when 1 then 'single' when 2 then 'pair' when 3 then 'triple' else 'quad' end;
    ln := n;
  elsif n >= 3 and r[n] < 12 and (select bool_and(r[k] = r[1] + k - 1) from generate_series(1, n) k) then
    t := 'straight';
    ln := n;
  elsif n >= 6 and n % 2 = 0 and r[n] < 12
        and (select bool_and(r[2 * k - 1] = r[1] + k - 1 and r[2 * k] = r[1] + k - 1) from generate_series(1, n / 2) k) then
    t := 'pairs';
    ln := n / 2;
  end if;
  if t is null then
    return null;
  end if;
  return jsonb_build_object('type', t, 'len', ln, 'key', c[n], 'cards', to_jsonb(c));
end $$;

-- Does x beat top (§7.2)? The same type (and length for sảnh and đôi thông) with a higher key, or a bomb: 3 đôi thông over
-- a single 2; tứ quý over a single 2, a pair of 2s or any 3 đôi thông; 4 đôi thông over those and any tứ quý.
create or replace function public._tl_beats(p_top jsonb, p_x jsonb) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select coalesce(
    (p_x->>'type' = p_top->>'type' and (p_x->>'type' not in ('straight', 'pairs') or p_x->'len' = p_top->'len')
     and (p_x->>'key')::int > (p_top->>'key')::int)
    or (p_top->>'type' = 'single' and (p_top->>'key')::int / 4 = 12
        and (p_x->>'type' = 'quad' or (p_x->>'type' = 'pairs' and (p_x->>'len')::int in (3, 4))))
    or (p_top->>'type' = 'pair' and (p_top->>'key')::int / 4 = 12
        and (p_x->>'type' = 'quad' or (p_x->>'type' = 'pairs' and (p_x->>'len')::int = 4)))
    or (p_top->>'type' = 'pairs' and (p_top->>'len')::int = 3
        and (p_x->>'type' = 'quad' or (p_x->>'type' = 'pairs' and (p_x->>'len')::int = 4)))
    or (p_top->>'type' = 'quad' and p_x->>'type' = 'pairs' and (p_x->>'len')::int = 4),
    false)
$$;

-- What cutting a combination is worth, in half-stakes (§7.2): 2♠/2♣ 1, 2♦/2♥ 2, a pair of 2s the sum, 3 đôi thông 3,
-- tứ quý 4, 4 đôi thông 6; anything else 0.
create or replace function public._tl_value(p_combo jsonb) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case
    when p_combo->>'type' in ('single', 'pair') and (p_combo->>'key')::int / 4 = 12 then
      (select coalesce(sum(case when x::int % 4 >= 2 then 2 else 1 end), 0)::int
         from jsonb_array_elements_text(p_combo->'cards') x)
    when p_combo->>'type' = 'pairs' and (p_combo->>'len')::int = 3 then 3
    when p_combo->>'type' = 'quad' then 4
    when p_combo->>'type' = 'pairs' and (p_combo->>'len')::int >= 4 then 6
    else 0 end
$$;

-- Thối (§7.4, R12) in half-stakes: each 2 (black 1, red 2), each tứ quý below 2 (4), then over the other ranks below 2
-- each maximal run of ≥ 3 consecutive ranks holding ≥ 2 cards (3 ranks 3, 4 or more 6).
create or replace function public._tl_thoi(p_cards integer[]) returns integer
language plpgsql immutable set search_path = public, extensions
as $$
declare n integer[] := array_fill(0, array[13]); x integer; h integer := 0; run integer := 0; r integer;
begin
  foreach x in array coalesce(p_cards, '{}') loop
    n[x / 4 + 1] := n[x / 4 + 1] + 1;
    if x / 4 = 12 then
      h := h + case when x % 4 >= 2 then 2 else 1 end;
    end if;
  end loop;
  for r in 1..12 loop
    if n[r] = 4 then
      h := h + 4;
      n[r] := 0;
    end if;
  end loop;
  for r in 1..13 loop
    if r <= 12 and n[r] >= 2 then
      run := run + 1;
    else
      h := h + case when run = 3 then 3 when run >= 4 then 6 else 0 end;
      run := 0;
    end if;
  end loop;
  return h;
end $$;

-- Tới trắng (§7.4, R10): the best pattern of a dealt hand, or null — sảnh rồng (3 → A), 5 đôi thông (no 2),
-- tứ quý heo, 6 đôi (a tứ quý counts as 2 pairs).
create or replace function public._tl_trang(p_cards integer[]) returns text
language plpgsql immutable set search_path = public, extensions
as $$
declare n integer[] := array_fill(0, array[13]); x integer; r integer;
begin
  foreach x in array coalesce(p_cards, '{}') loop
    n[x / 4 + 1] := n[x / 4 + 1] + 1;
  end loop;
  if (select bool_and(n[k] >= 1) from generate_series(1, 12) k) then
    return 'sanh_rong';
  end if;
  for r in 1..8 loop
    if n[r] >= 2 and n[r + 1] >= 2 and n[r + 2] >= 2 and n[r + 3] >= 2 and n[r + 4] >= 2 then
      return 'nam_doi_thong';
    end if;
  end loop;
  if n[13] = 4 then
    return 'tu_quy_heo';
  end if;
  if (select sum(n[k] / 2) from generate_series(1, 13) k) >= 6 then
    return 'sau_doi';
  end if;
  return null;
end $$;

-- The strength of a tới trắng pattern: the highest wins (R10).
create or replace function public._tl_trang_rank(p_pattern text) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case p_pattern when 'sanh_rong' then 4 when 'nam_doi_thong' then 3 when 'tu_quy_heo' then 2 when 'sau_doi' then 1
         else 0 end
$$;

-- One line of a Tiến lên game in half-stakes (§6.2, §7.5, R14): from → to, at most what is left of the payer's 10 S
-- (20 h). A line from or to a settled seat, or to a seat of p_gone (seats leaving together), is dropped; so is a line
-- that pays 0. The line lands in pub.lines as {from, to, h, paid, why}; the payer's players.paid grows by what it paid.
create or replace function public._tl_pay(p_pub jsonb, p_from integer, p_to integer, p_h integer, p_why text,
                                          p_gone integer[] default '{}') returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare f text := p_from::text; x integer;
begin
  if p_h is null or p_h <= 0 or p_from is null or p_to is null or p_from = p_to or p_to = any(p_gone)
     or coalesce((p_pub->'players'->f->>'settled')::boolean, true)
     or coalesce((p_pub->'players'->(p_to::text)->>'settled')::boolean, true) then
    return p_pub;
  end if;
  x := least(p_h, 20 - coalesce((p_pub->'players'->f->>'paid')::int, 0));
  if x <= 0 then
    return p_pub;
  end if;
  return jsonb_set(
    jsonb_set(p_pub, array['players', f, 'paid'], to_jsonb(coalesce((p_pub->'players'->f->>'paid')::int, 0) + x)),
    '{lines}', coalesce(p_pub->'lines', '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('from', p_from, 'to', p_to, 'h', p_h, 'paid', x, 'why', p_why)));
end $$;

-- The money of a Tiến lên game (§7.3–§7.5), one event at a time: the next pub. p_hands holds the cards each seat holds
-- now ({seat: [c…]}), for thối. Events:
--   {k: "cut", seat, top}      seat cuts top ({seat, cards, done}): the chain grows by the value of top
--   {k: "close"}               the round closes: the chain's victim pays its cutter, unless the chain is void
--   {k: "out", seat}           seat goes out; at the first go-out every active player who has played nothing is cóng and
--                              pays nhất 2 S + thối at once (R11)
--   {k: "forfeit", seats}      those seats leave together (R13): an open chain as victim is paid, as cutter dropped; 1 S to
--                              each other active player in turn order; thối to the next of them
--   {k: "leave", seat}         a seat already out leaves: lines to or from it are dropped from now on
--   {k: "trang", seat}         tới trắng: every other player pays 2 S (R10)
--   {k: "end"}                 a pending chain, the places (cóng at the bottom in reverse turn order from nhất), the place
--                              payments (skipped for a cóng payer) and the thối of the last holder to the player just above
create or replace function public._tl_money(p_pub jsonb, p_ev jsonb, p_hands jsonb) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare pub jsonb := p_pub; ord integer[] := public._card_ints(p_pub->'order'); k text := p_ev->>'k'; ch jsonb;
        s integer; p integer; f integer[]; r integer[]; placed integer; holder integer; nhat integer; pl integer[];
        m integer;
begin
  ch := pub->'chain';
  if k = 'cut' then
    pub := jsonb_set(pub, '{chain}', jsonb_build_object(
      'h', coalesce((ch->>'h')::int, 0) + public._tl_value(p_ev->'top'),
      'victim', (p_ev->'top'->>'seat')::int, 'cutter', (p_ev->>'seat')::int,
      'void', coalesce((p_ev->'top'->>'done')::boolean, false)));
  elsif k = 'close' then
    if jsonb_typeof(ch) = 'object' and not coalesce((ch->>'void')::boolean, false) then
      pub := public._tl_pay(pub, (ch->>'victim')::int, (ch->>'cutter')::int, (ch->>'h')::int, 'chat');
    end if;
    pub := jsonb_set(pub, '{chain}', 'null');
  elsif k = 'out' then
    s := (p_ev->>'seat')::int;
    placed := (select count(*) from jsonb_each(pub->'players') e where e.value->>'place' is not null);
    pub := jsonb_set(jsonb_set(pub, array['players', s::text, 'out'], '"done"'),
                     array['players', s::text, 'place'], to_jsonb(placed + 1));
    if placed = 0 then
      foreach p in array public._card_after(ord, s) loop
        if pub->'players'->(p::text)->>'out' is null
           and not coalesce((pub->'players'->(p::text)->>'played')::boolean, false) then
          pub := jsonb_set(pub, array['players', p::text, 'out'], '"cong"');
          pub := public._tl_pay(pub, p, s, 4 + public._tl_thoi(public._card_ints(p_hands->(p::text))), 'cong');
        end if;
      end loop;
    end if;
  elsif k = 'forfeit' then
    f := array(select x from unnest(public._card_ints(p_ev->'seats')) x order by x);
    foreach s in array f loop
      pub := jsonb_set(pub, array['players', s::text, 'out'], '"forfeit"');
    end loop;
    foreach s in array f loop
      ch := pub->'chain';
      if jsonb_typeof(ch) = 'object' and (ch->>'victim')::int = s then
        if not coalesce((ch->>'void')::boolean, false) then
          pub := public._tl_pay(pub, s, (ch->>'cutter')::int, (ch->>'h')::int, 'chat', f);
        end if;
        pub := jsonb_set(pub, '{chain}', 'null');
      elsif jsonb_typeof(ch) = 'object' and (ch->>'cutter')::int = s then
        pub := jsonb_set(pub, '{chain}', 'null');
      end if;
      r := array(select q from unnest(public._card_after(ord, s)) with ordinality u(q, n)
                  where pub->'players'->(q::text)->>'out' is null order by n);
      foreach p in array r loop
        pub := public._tl_pay(pub, s, p, 2, 'forfeit', f);
      end loop;
      if cardinality(r) > 0 then
        pub := public._tl_pay(pub, s, r[1], public._tl_thoi(public._card_ints(p_hands->(s::text))), 'thoi', f);
      end if;
    end loop;
    foreach s in array f loop
      pub := jsonb_set(pub, array['players', s::text, 'settled'], 'true');
    end loop;
  elsif k = 'leave' then
    pub := jsonb_set(pub, array['players', p_ev->>'seat', 'settled'], 'true');
  elsif k = 'trang' then
    s := (p_ev->>'seat')::int;
    foreach p in array public._card_after(ord, s) loop
      pub := public._tl_pay(pub, p, s, 4, 'trang');
    end loop;
  elsif k = 'end' then
    if jsonb_typeof(ch) = 'object' and not coalesce((ch->>'void')::boolean, false) then
      pub := public._tl_pay(pub, (ch->>'victim')::int, (ch->>'cutter')::int, (ch->>'h')::int, 'chat');
    end if;
    pub := jsonb_set(pub, '{chain}', 'null');
    placed := (select count(*) from jsonb_each(pub->'players') e where e.value->>'place' is not null);
    holder := (select min(q) from unnest(ord) q where pub->'players'->(q::text)->>'out' is null);
    if holder is not null then
      placed := placed + 1;
      pub := jsonb_set(pub, array['players', holder::text, 'place'], to_jsonb(placed));
    end if;
    nhat := (select q from unnest(ord) q where (pub->'players'->(q::text)->>'place')::int = 1);
    foreach p in array coalesce(array(select q from unnest(public._card_after(ord, nhat)) with ordinality u(q, n)
                                       where pub->'players'->(q::text)->>'out' = 'cong' order by n), '{}') loop
      placed := placed + 1;
      pub := jsonb_set(pub, array['players', p::text, 'place'], to_jsonb(placed));
    end loop;
    pl := array(select q from unnest(ord) q where pub->'players'->(q::text)->>'place' is not null
                 order by (pub->'players'->(q::text)->>'place')::int);
    m := cardinality(pl);
    if m = 4 then
      if pub->'players'->(pl[4]::text)->>'out' is distinct from 'cong' then
        pub := public._tl_pay(pub, pl[4], pl[1], 2, 'bet');
      end if;
      if pub->'players'->(pl[3]::text)->>'out' is distinct from 'cong' then
        pub := public._tl_pay(pub, pl[3], pl[2], 1, 'ba');
      end if;
    elsif m >= 2 and pub->'players'->(pl[m]::text)->>'out' is distinct from 'cong' then
      pub := public._tl_pay(pub, pl[m], pl[1], 2, 'bet');
    end if;
    if holder is not null and (pub->'players'->(holder::text)->>'place')::int > 1 then
      pub := public._tl_pay(pub, holder, pl[(pub->'players'->(holder::text)->>'place')::int - 1],
                            public._tl_thoi(public._card_ints(p_hands->(holder::text))), 'thoi');
    end if;
  end if;
  return pub;
end $$;

revoke all on function public._card_max(text) from public, anon, authenticated;
revoke all on function public._card_ints(jsonb) from public, anon, authenticated;
revoke all on function public._card_after(integer[], integer) from public, anon, authenticated;
revoke all on function public._card_rand(integer) from public, anon, authenticated;
revoke all on function public._card_shuffle() from public, anon, authenticated;
revoke all on function public._tl_combo(integer[]) from public, anon, authenticated;
revoke all on function public._tl_beats(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tl_value(jsonb) from public, anon, authenticated;
revoke all on function public._tl_thoi(integer[]) from public, anon, authenticated;
revoke all on function public._tl_trang(integer[]) from public, anon, authenticated;
revoke all on function public._tl_trang_rank(text) from public, anon, authenticated;
revoke all on function public._tl_pay(jsonb, integer, integer, integer, text, integer[]) from public, anon, authenticated;
revoke all on function public._tl_money(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ---------- B (cont.). Pure helpers: Cào and poker (§8.1, §8.3, §9.1, §9.2) ----------
-- A card's Cào key (§8.1): cao_rank × 4 + cao_suit, with A = 1, 2–10 their number, J 11, Q 12, K 13 and ♠ 0, ♣ 1, ♥ 2, ♦ 3.
create or replace function public._cao_key(p_card integer) returns integer
language sql immutable set search_path = public, extensions
as $$
  select (case p_card / 4 when 11 then 1 when 12 then 2 else p_card / 4 + 3 end) * 4
         + case p_card % 4 when 2 then 3 when 3 then 2 else p_card % 4 end
$$;

-- A Cào hand (§8.1, R18): {kind: "sap" | "ba_tay" | "nut", points (the nút), rank (a sáp's rank: A 1 … K 13), top (the
-- highest card's Cào key)}.
create or replace function public._cao_eval(p_cards integer[]) returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'kind', case when count(distinct c / 4) = 1 then 'sap' when bool_and(c / 4 between 8 and 10) then 'ba_tay' else 'nut' end,
    'points', sum(least(public._cao_key(c) / 4, 10)) % 10,
    'rank', case when count(distinct c / 4) = 1 then min(public._cao_key(c) / 4) end,
    'top', max(public._cao_key(c)))
  from unnest(p_cards) c
$$;

-- Compare two Cào hands (R18, R19): 1 when a wins, −1 when b wins. Sáp > ba tây > nút; two sáp by rank; ba tây, and equal
-- nút, by the top card (rank, then ♦ > ♥ > ♣ > ♠). Two hands never share a card, so it is never 0.
create or replace function public._cao_cmp(a jsonb, b jsonb) returns integer
language sql immutable set search_path = public, extensions
as $$
  with x as (select case a->>'kind' when 'sap' then 2 when 'ba_tay' then 1 else 0 end ca,
                    case b->>'kind' when 'sap' then 2 when 'ba_tay' then 1 else 0 end cb)
  select case
    when ca <> cb then sign(ca - cb)::int
    when ca = 2 then sign((a->>'rank')::int - (b->>'rank')::int)::int
    when ca = 0 and (a->>'points')::int <> (b->>'points')::int then sign((a->>'points')::int - (b->>'points')::int)::int
    else sign((a->>'top')::int - (b->>'top')::int)::int end
  from x
$$;

-- A Cào hand's money (§8.3, R17), in units of S: each player still in the hand wins or loses 1 against the dealer, and a
-- player who left lost 1 to the dealer. p = {dealer, order (the dealt seats), left, hands: {seat: [c…]}}; the answer is
-- {lines: [{from, to, why: "cao" | "left"}], net: {seat: units}}.
create or replace function public._cao_settle(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare d integer := (p->>'dealer')::int; s integer; lines jsonb := '[]'; dh jsonb;
begin
  dh := public._cao_eval(public._card_ints(p->'hands'->(d::text)));
  foreach s in array public._card_ints(p->'order') loop
    continue when s = d;
    if s = any(public._card_ints(p->'left')) then
      lines := lines || jsonb_build_array(jsonb_build_object('from', s, 'to', d, 'why', 'left'));
    elsif public._cao_cmp(public._cao_eval(public._card_ints(p->'hands'->(s::text))), dh) > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('from', d, 'to', s, 'why', 'cao'));
    else
      lines := lines || jsonb_build_array(jsonb_build_object('from', s, 'to', d, 'why', 'cao'));
    end if;
  end loop;
  return jsonb_build_object('lines', lines, 'net', (
    select jsonb_object_agg(q::text, coalesce((select sum(case when (l->>'to')::int = q then 1 else -1 end)
                                                 from jsonb_array_elements(lines) l
                                                where q in ((l->>'from')::int, (l->>'to')::int)), 0))
      from unnest(public._card_ints(p->'order')) q));
end $$;

-- A card's poker rank: 2 … 14 (A = 14).
create or replace function public._pk_rank(p_card integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select case when p_card / 4 = 12 then 2 else p_card / 4 + 3 end $$;

-- The top of the best straight among poker ranks (the ace also plays low: A-2-3-4-5 tops at 5), or null.
create or replace function public._pk_straight(p_ranks integer[]) returns integer
language sql immutable set search_path = public, extensions
as $$
  select max(t) from generate_series(5, 14) t
   where (select count(distinct x) from unnest(p_ranks || case when 14 = any(p_ranks) then array[1] else '{}'::int[] end) x
           where x between t - 4 and t) = 5
$$;

-- The best poker hand in up to 7 cards (§9.1), as a key compared lexicographically: [8, top] straight flush ·
-- [7, quad, kicker] · [6, trips, pair] · [5, the flush suit's top five] · [4, top] straight · [3, trips, k1, k2] ·
-- [2, high, low, kicker] · [1, pair, k1, k2, k3] · [0, the top five]. Suits never break ties.
create or replace function public._pk_eval(p_cards integer[]) returns integer[]
language plpgsql immutable set search_path = public, extensions
as $$
declare rs integer[]; fs integer; fr integer[]; t integer; q integer; tr integer[]; pr integer[];
begin
  rs := array(select public._pk_rank(c) from unnest(p_cards) c order by 1 desc);
  select c % 4 into fs from unnest(p_cards) c group by c % 4 having count(*) >= 5;
  if fs is not null then
    fr := array(select public._pk_rank(c) from unnest(p_cards) c where c % 4 = fs order by 1 desc);
    t := public._pk_straight(fr);
    if t is not null then
      return array[8, t];
    end if;
  end if;
  q := (select r from unnest(rs) r group by r having count(*) = 4);
  if q is not null then
    return array[7, q] || array(select r from unnest(rs) r where r <> q order by r desc limit 1);
  end if;
  tr := array(select r from unnest(rs) r group by r having count(*) = 3 order by r desc);
  pr := array(select r from unnest(rs) r group by r having count(*) = 2 order by r desc);
  if cardinality(tr) >= 2 then
    return array[6, tr[1], tr[2]];
  end if;
  if cardinality(tr) = 1 and cardinality(pr) >= 1 then
    return array[6, tr[1], pr[1]];
  end if;
  if fs is not null then
    return array[5] || fr[1:5];
  end if;
  t := public._pk_straight(rs);
  if t is not null then
    return array[4, t];
  end if;
  if cardinality(tr) = 1 then
    return array[3, tr[1]] || array(select r from unnest(rs) r where r <> tr[1] order by r desc limit 2);
  end if;
  if cardinality(pr) >= 2 then
    return array[2, pr[1], pr[2]] || array(select r from unnest(rs) r where r not in (pr[1], pr[2]) order by r desc limit 1);
  end if;
  if cardinality(pr) = 1 then
    return array[1, pr[1]] || array(select r from unnest(rs) r where r <> pr[1] order by r desc limit 3);
  end if;
  return array[0] || rs[1:5];
end $$;

-- The pots of a hand (§9.2): a level at each live all-in total and at the highest live total; each pot goes to the live
-- seats that reach its level, and the top pot also takes every folded chip above the highest live total. With the live
-- hands' keys (or a single eligible seat) each pot gets its winners, and its odd xu go one at a time to the winners in
-- seat order starting left of the button (TDA 20). p = {players: {seat: {put, fold, allin}}, keys: {seat: key}, button};
-- the answer is [{xu, seats, winners, shares: {seat: xu}}] (winners and shares only when they are known).
create or replace function public._pk_pots(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare pl jsonb := coalesce(p->'players', '{}'); btn integer := (p->>'button')::int; top integer; lv integer[];
        lvl integer; prev integer := 0; amt integer; el integer[]; pots jsonb := '[]'; res jsonb := '[]'; pot jsonb;
        w integer[]; best integer[]; q integer; r integer;
begin
  top := (select max((v->>'put')::int) from jsonb_each(pl) e(k, v) where not coalesce((v->>'fold')::boolean, false));
  if top is null or top <= 0 then
    return '[]';
  end if;
  lv := array(select distinct x from (select (v->>'put')::int x from jsonb_each(pl) e(k, v)
                                       where not coalesce((v->>'fold')::boolean, false)
                                         and coalesce((v->>'allin')::boolean, false)
                                      union all select top) u
               where x > 0 order by x);
  foreach lvl in array lv loop
    amt := (select coalesce(sum(least((v->>'put')::int, lvl) - least((v->>'put')::int, prev)), 0) from jsonb_each(pl) e(k, v));
    el := array(select k::int from jsonb_each(pl) e(k, v)
                 where not coalesce((v->>'fold')::boolean, false) and (v->>'put')::int >= lvl order by k::int);
    if amt > 0 then
      if jsonb_array_length(pots) > 0 and pots->-1->'seats' = to_jsonb(el) then
        pots := jsonb_set(pots, array[(jsonb_array_length(pots) - 1)::text, 'xu'], to_jsonb((pots->-1->>'xu')::int + amt));
      else
        pots := pots || jsonb_build_array(jsonb_build_object('xu', amt, 'seats', to_jsonb(el)));
      end if;
    end if;
    prev := lvl;
  end loop;
  amt := (select coalesce(sum(greatest((v->>'put')::int - top, 0)), 0) from jsonb_each(pl) e(k, v));
  if amt > 0 then
    pots := jsonb_set(pots, array[(jsonb_array_length(pots) - 1)::text, 'xu'], to_jsonb((pots->-1->>'xu')::int + amt));
  end if;
  for pot in select value from jsonb_array_elements(pots) loop
    el := public._card_ints(pot->'seats');
    w := null;
    if cardinality(el) = 1 then
      w := el;
    elsif jsonb_typeof(p->'keys') = 'object' then
      best := (select max(public._card_ints(p->'keys'->(s::text))) from unnest(el) s);
      w := array(select s from unnest(el) s where public._card_ints(p->'keys'->(s::text)) = best order by s);
    end if;
    if w is not null then
      q := (pot->>'xu')::int / cardinality(w);
      r := (pot->>'xu')::int % cardinality(w);
      pot := pot || jsonb_build_object('winners', to_jsonb(w), 'shares', (
        select jsonb_object_agg(s::text, q + case when n <= r then 1 else 0 end)
          from (select s, row_number() over (order by case when btn is null then s else (s - btn + 5) % 6 end) n
                  from unnest(w) s) z));
    end if;
    res := res || jsonb_build_array(pot);
  end loop;
  return res;
end $$;

revoke all on function public._cao_key(integer) from public, anon, authenticated;
revoke all on function public._cao_eval(integer[]) from public, anon, authenticated;
revoke all on function public._cao_cmp(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._cao_settle(jsonb) from public, anon, authenticated;
revoke all on function public._pk_rank(integer) from public, anon, authenticated;
revoke all on function public._pk_straight(integer[]) from public, anon, authenticated;
revoke all on function public._pk_eval(integer[]) from public, anon, authenticated;
revoke all on function public._pk_pots(jsonb) from public, anon, authenticated;

-- ---------- C. Table machinery (§6, §10, §11.2, §11.6) ----------
-- The room's three tables, created by the first card tick or write; a read shows a missing row as idle and empty.
create or replace function public._card_init(p_room uuid) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.card_tables (room_id, game) select p_room, g from unnest(array['tienlen', 'cao', 'poker']) g
  on conflict (room_id, game) do nothing
$$;

-- A tick or a write takes the table row first (§11.6): one call per table at a time, before any wallet.
create or replace function public._card_open(p_room uuid, p_game text) returns public.card_tables
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables;
begin
  perform public._card_init(p_room);
  select * into t from public.card_tables where room_id = p_room and game = p_game for update;
  return t;
end $$;

-- The game a read, a tick or a leave names; anything else is refused and never flagged (§11.5).
create or replace function public._card_game(p_game text) returns text
language plpgsql immutable set search_path = public, extensions
as $$
begin
  if p_game is null or p_game not in ('tienlen', 'cao', 'poker') then
    raise exception 'invalid game' using errcode = '22023';
  end if;
  return p_game;
end $$;

-- v counts every visible change, seq every game action (R24).
create or replace function public._card_bump(p_room uuid, p_game text, p_action boolean) returns void
language sql security definer set search_path = public, extensions
as $$
  update public.card_tables set v = v + 1, seq = seq + case when p_action then 1 else 0 end
   where room_id = p_room and game = p_game
$$;

-- One row of the evidence log (R34).
create or replace function public._card_log(p_room uuid, p_game text, p_hand integer, p_account uuid, p_seat integer,
                                            p_action text, p_detail jsonb, p_at timestamptz) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.card_log (room_id, game, hand_no, account_id, seat, action, detail, at)
  values (p_room, p_game, p_hand, p_account, p_seat, p_action, coalesce(p_detail, '{}'::jsonb), p_at)
$$;

-- A hand's ledger ref (§6.2): tl#41, cao#7, pk#12.
create or replace function public._card_ref(p_game text, p_hand integer) returns text
language sql immutable set search_path = public, extensions
as $$ select case p_game when 'tienlen' then 'tl#' when 'cao' then 'cao#' else 'pk#' end || p_hand $$;

-- The owner of a card call was seen (R28): at most one write per 10 s.
create or replace function public._card_touch(p_room uuid, p_account uuid, p_now timestamptz) returns void
language sql security definer set search_path = public, extensions
as $$
  update public.card_seats set seen_at = p_now
   where room_id = p_room and account_id = p_account and seen_at < p_now - interval '10 seconds'
$$;

-- A table's public state (§11.4), the same for every viewer (R25), built in one statement: one snapshot, no writes.
create or replace function public._card_view(p_room uuid, p_game text, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now, 'game', g.game, 'stake', t.stake, 'max', public._card_max(g.game),
    'v', coalesce(t.v, 0), 'seq', coalesce(t.seq, 0), 'hand_no', coalesce(t.hand_no, 0), 'phase', coalesce(t.phase, 'idle'),
    'turn', t.turn, 'deadline', t.deadline,
    'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'id', s.account_id, 'name', a.username,
                                                           'chips', s.chips, 'escrow', s.escrow, 'leaving', s.leaving)
                                        order by s.seat)
                         from public.card_seats s join public.accounts a on a.id = s.account_id
                        where s.room_id = p_room and s.game = g.game), '[]'::jsonb),
    'pub', coalesce(t.pub, '{}'::jsonb), 'last', t.last)
  from (select p_game as game) g
  left join public.card_tables t on t.room_id = p_room and t.game = g.game
$$;

-- The caller's cards (§11.3): the hand dealt to this account in the table's current hand, or none.
create or replace function public._card_hand(p_room uuid, p_game text, p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now, 'game', p_game, 'hand_no', coalesce(t.hand_no, 0),
    'seat', (select s.seat from public.card_seats s where s.room_id = p_room and s.game = p_game and s.account_id = p_account),
    'cards', coalesce((select to_jsonb(h.cards) from public.card_hands h
                        where h.room_id = p_room and h.game = p_game and h.hand_no = t.hand_no and h.account_id = p_account),
                      '[]'::jsonb))
  from (select 1) x
  left join public.card_tables t on t.room_id = p_room and t.game = p_game
$$;

-- The answer of every write (§11.3): the state, the caller's hand and the caller's coins.
create or replace function public._card_answer(p_room uuid, p_game text, p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('changed', true, 'state', public._card_view(p_room, p_game, p_now),
                            'hand', public._card_hand(p_room, p_game, p_account, p_now),
                            'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0))
$$;

-- Lock the wallets of every seat at a table in account-id order (§11.6), before a hand's money moves.
create or replace function public._card_lock_wallets(p_room uuid, p_game text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;
begin
  for r in select account_id from public.card_seats where room_id = p_room and game = p_game order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
end $$;

-- Pay one seat out (§6.2): its balance (Tiến lên, Cào) or its stack (poker) goes to its wallet with p_reason, and the seat
-- keeps 0. No ledger row when it is 0. Returns the amount.
create or replace function public._card_payout(p_room uuid, p_game text, p_seat integer, p_reason text) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.card_seats; v_amt integer; v_hand integer;
begin
  select * into s from public.card_seats where room_id = p_room and game = p_game and seat = p_seat for update;
  if not found then
    return 0;
  end if;
  v_amt := s.chips + s.escrow;
  update public.card_seats set chips = 0, escrow = 0 where room_id = p_room and game = p_game and seat = p_seat;
  if v_amt > 0 then
    select hand_no into v_hand from public.card_tables where room_id = p_room and game = p_game;
    perform public._wallet_lock(s.account_id);
    perform public._pay(s.account_id, v_amt, p_reason, public._card_ref(p_game, v_hand));
  end if;
  return v_amt;
end $$;

-- Pay every seat its balance at a hand's end (§6.2), the wallets locked in account-id order first (§11.6).
create or replace function public._card_settle(p_room uuid, p_game text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;
begin
  for r in select account_id from public.card_seats where room_id = p_room and game = p_game and escrow > 0
            order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  for r in select seat from public.card_seats where room_id = p_room and game = p_game and escrow > 0 order by seat loop
    perform public._card_payout(p_room, p_game, r.seat, 'card_settle');
  end loop;
end $$;

-- The empty-table reset (R36): a new group never inherits a winner, a dealer, a button or a stake. hand_no keeps counting.
create or replace function public._card_reset_if_empty(p_room uuid, p_game text) returns void
language sql security definer set search_path = public, extensions
as $$
  update public.card_tables
     set first_game = true, lead_id = null, pos = null, turn = null, deadline = null, pub = '{}'::jsonb, last = null,
         stake = null, phase = 'idle', v = v + 1, seq = seq + 1
   where room_id = p_room and game = p_game
     and not exists (select 1 from public.card_seats s where s.room_id = p_room and s.game = p_game)
$$;

-- Is this seat in the live hand: dealt into the current hand, by the account that sits there, while it is played?
create or replace function public._card_live(p_room uuid, p_game text, p_seat integer) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.card_tables t
      join public.card_hands h on h.room_id = t.room_id and h.game = t.game and h.hand_no = t.hand_no and h.seat = p_seat
      join public.card_seats s on s.room_id = t.room_id and s.game = t.game and s.seat = p_seat and s.account_id = h.account_id
     where t.room_id = p_room and t.game = p_game and t.phase in ('playing', 'peek'))
$$;

-- The leave operation for seats in the live hand (§6.3), the table's wallets locked first: each game's own rules.
create or replace function public._card_leave_live(p_room uuid, p_game text, p_seats integer[], p_how text, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._card_lock_wallets(p_room, p_game);
  if p_game = 'tienlen' then
    perform public._tl_leave(p_room, p_seats, p_how, p_now);
  end if;
end $$;

-- The step that is due at a table (§10), by game: true when it changed anything.
create or replace function public._card_due(p_room uuid, p_game text, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_game = 'tienlen' then
    return public._tl_due(p_room, p_now, p_deck);
  end if;
  return false;
end $$;

-- The leave operation (§6.3), for one seat: a seat in the live hand leaves by its game's rules (_card_leave_live); any
-- other seat is paid out (a poker stack is cashed out) and goes at once, and the last seat to go resets the table.
-- p_how: leave, timeout, sweep, idle (stood up at a deal, R28) or forfeit_all.
create or replace function public._card_leave_seat(p_room uuid, p_game text, p_seat integer, p_how text, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.card_seats; v_hand integer;
begin
  select * into s from public.card_seats where room_id = p_room and game = p_game and seat = p_seat for update;
  if not found then
    return;
  end if;
  if public._card_live(p_room, p_game, p_seat) then
    perform public._card_leave_live(p_room, p_game, array[p_seat], p_how, p_now);
    return;
  end if;
  select hand_no into v_hand from public.card_tables where room_id = p_room and game = p_game;
  perform public._card_payout(p_room, p_game, p_seat, case when p_game = 'poker' then 'card_cashout' else 'card_settle' end);
  delete from public.card_seats where room_id = p_room and game = p_game and seat = p_seat;
  perform public._card_log(p_room, p_game, v_hand, s.account_id, p_seat, 'leave', jsonb_build_object('how', p_how), p_now);
  perform public._card_reset_if_empty(p_room, p_game);
end $$;

-- Several seats leave together, as one sweep removes them (§6.3, R13): the table's wallets are locked in account-id
-- order first; the seats in the live hand leave in one go, then the others.
create or replace function public._card_leave_seats(p_room uuid, p_game text, p_seats integer[], p_how text, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_live integer[]; v_seat integer;
begin
  perform public._card_lock_wallets(p_room, p_game);
  v_live := array(select x from unnest(p_seats) x where public._card_live(p_room, p_game, x) order by x);
  if cardinality(v_live) > 0 then
    perform public._card_leave_live(p_room, p_game, v_live, p_how, p_now);
  end if;
  foreach v_seat in array p_seats loop
    if not (v_seat = any(v_live)) then
      perform public._card_leave_seat(p_room, p_game, v_seat, p_how, p_now);
    end if;
  end loop;
end $$;

-- Two seats start a table (§6.1): the countdown (Tiến lên 8 s, poker 5 s) or the dealer's wait (Cào, 15 s). Before the
-- deal, fewer than two seats send it back to idle.
create or replace function public._card_ready(p_room uuid, p_game text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; n integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = p_game;
  n := (select count(*) from public.card_seats where room_id = p_room and game = p_game and not leaving);
  if t.phase = 'idle' and n >= 2 then
    update public.card_tables
       set phase = case p_game when 'cao' then 'deal_wait' else 'countdown' end, turn = null, pub = '{}'::jsonb,
           deadline = p_now + case p_game when 'tienlen' then interval '8 seconds' when 'cao' then interval '15 seconds'
                                          else interval '5 seconds' end
     where room_id = p_room and game = p_game;
  elsif t.phase in ('countdown', 'deal_wait') and n < 2 then
    update public.card_tables set phase = 'idle', deadline = null, turn = null, pub = '{}'::jsonb
     where room_id = p_room and game = p_game;
  end if;
end $$;

-- The lazy clock of a table (§6.3, §10), under its lock: the seats of non-members and banned accounts leave together
-- (R13, anti-cheat R10), then the one step that is due. True when it changed anything.
create or replace function public._card_sweep(p_room uuid, p_game text, p_now timestamptz, p_deck integer[] default null)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare f integer[]; v_changed boolean := false;
begin
  f := array(select s.seat from public.card_seats s join public.accounts a on a.id = s.account_id
              where s.room_id = p_room and s.game = p_game and not s.leaving
                and (a.is_banned or not exists (select 1 from public.members m
                                                 where m.room_id = p_room and m.account_id = s.account_id))
              order by s.seat);
  if cardinality(f) > 0 then
    perform public._card_leave_seats(p_room, p_game, f, 'sweep', p_now);
    v_changed := true;
  end if;
  if (select deadline from public.card_tables where room_id = p_room and game = p_game) <= p_now then
    if public._card_due(p_room, p_game, p_now, p_deck) then
      v_changed := true;
    end if;
  end if;
  if v_changed then
    perform public._card_ready(p_room, p_game, p_now);
    perform public._card_bump(p_room, p_game, true);
  end if;
  return v_changed;
end $$;

-- Sit (§11.3): the refusals in their order, then the stake, the requirement (§6.1) and the poker buy-in.
create or replace function public._card_sit(p_room uuid, p_account uuid, p_game text, p_seat integer, p_stake integer,
                                            p_buyin integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; w public.wallets;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_touch(p_room, p_account, p_now);
  perform public._card_sweep(p_room, p_game, p_now);
  select * into t from public.card_tables where room_id = p_room and game = p_game;
  if exists (select 1 from public.card_seats where room_id = p_room and account_id = p_account and leaving) then
    raise exception 'still leaving' using errcode = '22023';
  end if;
  if exists (select 1 from public.card_seats where room_id = p_room and account_id = p_account) then
    raise exception 'already seated' using errcode = '22023';
  end if;
  if (select count(*) from public.card_seats where room_id = p_room and game = p_game) >= public._card_max(p_game) then
    raise exception 'table full' using errcode = '22023';
  end if;
  if exists (select 1 from public.card_seats where room_id = p_room and game = p_game and seat = p_seat) then
    raise exception 'seat taken' using errcode = '22023';
  end if;
  if exists (select 1 from public.card_seats where room_id = p_room and game = p_game) and t.stake is distinct from p_stake then
    raise exception 'stake changed' using errcode = '22023';
  end if;
  w := public._wallet_lock(p_account);
  if w.coins < (case p_game when 'tienlen' then 10 * p_stake when 'cao' then p_stake else p_buyin end) then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  update public.card_tables set stake = p_stake where room_id = p_room and game = p_game;
  insert into public.card_seats (room_id, game, seat, account_id, chips, seen_at, sat_at)
  values (p_room, p_game, p_seat, p_account, case when p_game = 'poker' then p_buyin else 0 end, p_now, p_now);
  if p_game = 'poker' then
    perform public._pay(p_account, -p_buyin, 'card_buyin', public._card_ref(p_game, t.hand_no));
  end if;
  perform public._card_log(p_room, p_game, t.hand_no, p_account, p_seat, 'sit',
                           jsonb_build_object('stake', p_stake, 'buyin', p_buyin), p_now);
  perform public._card_ready(p_room, p_game, p_now);
  perform public._card_bump(p_room, p_game, false);
  return public._card_answer(p_room, p_game, p_account, p_now);
end $$;

-- Stand up (§6.3): the leave operation on the caller's seat.
create or replace function public._card_leave(p_room uuid, p_account uuid, p_game text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seat integer; v_live boolean;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_sweep(p_room, p_game, p_now);
  select seat into v_seat from public.card_seats
   where room_id = p_room and game = p_game and account_id = p_account and not leaving;
  if v_seat is null then
    raise exception 'not seated' using errcode = '22023';
  end if;
  v_live := public._card_live(p_room, p_game, v_seat);
  perform public._card_leave_seat(p_room, p_game, v_seat, 'leave', p_now);
  perform public._card_ready(p_room, p_game, p_now);
  perform public._card_bump(p_room, p_game, v_live);
  return public._card_answer(p_room, p_game, p_account, p_now);
end $$;

-- A tick (§10): the lock, the sweep, the state.
create or replace function public._card_tick(p_room uuid, p_account uuid, p_game text, p_now timestamptz,
                                             p_deck integer[] default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_changed boolean;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_touch(p_room, p_account, p_now);
  v_changed := public._card_sweep(p_room, p_game, p_now, p_deck);
  return jsonb_build_object('changed', v_changed, 'state', public._card_view(p_room, p_game, p_now));
end $$;

-- A game action (§11.3): the lock, the sweep, the caller's seat and the seq (R24), then the move. A move the state refuses
-- is a soft bad_move (R30): logged and answered with the envelope, and nothing moves. A real action resets the misses.
create or replace function public._card_action(p_room uuid, p_account uuid, p_game text, p_kind text, p_seq integer,
                                               p_args jsonb, p_now timestamptz, p_deck integer[] default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seat integer; v_err text;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_touch(p_room, p_account, p_now);
  perform public._card_sweep(p_room, p_game, p_now, p_deck);
  select seat into v_seat from public.card_seats
   where room_id = p_room and game = p_game and account_id = p_account and not leaving;
  if v_seat is null then
    raise exception 'not seated' using errcode = '22023';
  end if;
  if p_seq is distinct from (select seq from public.card_tables where room_id = p_room and game = p_game) then
    raise exception 'stale' using errcode = '22023';
  end if;
  if p_kind = 'tl_play' then
    v_err := public._tl_do_play(p_room, v_seat, public._card_ints(p_args->'cards'), p_now);
  elsif p_kind = 'tl_pass' then
    v_err := public._tl_do_pass(p_room, v_seat, p_now);
  end if;
  if v_err is not null then
    return public._ac_flag(p_account, 'bad_move', p_kind,
                           jsonb_build_object('game', p_game, 'seat', v_seat, 'seq', p_seq) || coalesce(p_args, '{}'::jsonb),
                           p_room, v_err, false);
  end if;
  update public.card_seats set missed = 0
   where room_id = p_room and game = p_game and seat = v_seat and account_id = p_account;
  perform public._card_bump(p_room, p_game, true);
  return public._card_answer(p_room, p_game, p_account, p_now);
end $$;

revoke all on function public._card_init(uuid) from public, anon, authenticated;
revoke all on function public._card_open(uuid, text) from public, anon, authenticated;
revoke all on function public._card_game(text) from public, anon, authenticated;
revoke all on function public._card_bump(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public._card_log(uuid, text, integer, uuid, integer, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._card_ref(text, integer) from public, anon, authenticated;
revoke all on function public._card_touch(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_view(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_hand(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_answer(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_lock_wallets(uuid, text) from public, anon, authenticated;
revoke all on function public._card_payout(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public._card_settle(uuid, text) from public, anon, authenticated;
revoke all on function public._card_reset_if_empty(uuid, text) from public, anon, authenticated;
revoke all on function public._card_live(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._card_leave_live(uuid, text, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_due(uuid, text, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._card_leave_seat(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_leave_seats(uuid, text, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_ready(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_sweep(uuid, text, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._card_sit(uuid, uuid, text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._card_leave(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_tick(uuid, uuid, text, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._card_action(uuid, uuid, text, text, integer, jsonb, timestamptz, integer[])
  from public, anon, authenticated;

-- ---------- D. The engines (§7.3, §8.2, §9.2): each step takes p_now, each deal p_deck ----------
-- Tiến lên (§7). The cards each seat of the current hand holds now ({seat: [c…]}), for thối.
create or replace function public._tl_hands(p_room uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(h.seat::text, to_jsonb(h.cards)), '{}'::jsonb)
    from public.card_hands h
    join public.card_tables t on t.room_id = h.room_id and t.game = h.game and t.hand_no = h.hand_no
   where h.room_id = p_room and h.game = 'tienlen'
$$;

-- The active seats (§7.3): dealt, still holding cards, neither out, cóng nor forfeited; in turn order.
create or replace function public._tl_active(p_pub jsonb) returns integer[]
language sql immutable set search_path = public, extensions
as $$
  select coalesce(array_agg(s order by s), '{}') from unnest(public._card_ints(p_pub->'order')) s
   where p_pub->'players'->(s::text)->>'out' is null
$$;

-- One money event (§7.5) on the table's pub: _tl_money gives the next pub, and its new lines move their paid amounts
-- (half-stakes × S / 2) between the seats' balances at once (§6.2). Returns the stored pub.
create or replace function public._tl_event(p_room uuid, p_ev jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; l jsonb; x integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  v_pub := public._tl_money(t.pub, p_ev, public._tl_hands(p_room));
  for l in select e.value from jsonb_array_elements(v_pub->'lines') with ordinality e(value, n)
            where e.n > coalesce(jsonb_array_length(t.pub->'lines'), 0) loop
    x := (l->>'paid')::int * t.stake / 2;
    update public.card_seats set escrow = escrow - x
     where room_id = p_room and game = 'tienlen' and seat = (l->>'from')::int
       and account_id = (v_pub->'players'->(l->>'from')->>'id')::uuid;
    update public.card_seats set escrow = escrow + x
     where room_id = p_room and game = 'tienlen' and seat = (l->>'to')::int
       and account_id = (v_pub->'players'->(l->>'to')->>'id')::uuid;
  end loop;
  update public.card_tables set pub = v_pub where room_id = p_room and game = 'tienlen';
  return v_pub;
end $$;

-- A game's result (§11.4): the places, the outs, the cards still held (the tới trắng hand alone), the lines and nets in xu.
create or replace function public._tl_last(p_room uuid, p_trang jsonb) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'hand_no', t.hand_no, 'trang', p_trang,
    'places', coalesce((select jsonb_agg(p.key::int order by (p.value->>'place')::int) from jsonb_each(t.pub->'players') p
                         where p.value->>'place' is not null), '[]'::jsonb),
    'out', coalesce((select jsonb_object_agg(p.key, p.value->'out') from jsonb_each(t.pub->'players') p
                      where p.value->>'out' is not null), '{}'::jsonb),
    'hands', case when p_trang is not null then jsonb_build_object(p_trang->>'seat', p_trang->'cards')
             else coalesce((select jsonb_object_agg(h.seat::text, to_jsonb(h.cards)) from public.card_hands h
                             where h.room_id = p_room and h.game = 'tienlen' and h.hand_no = t.hand_no
                               and cardinality(h.cards) > 0), '{}'::jsonb) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('from', l->'from', 'to', l->'to', 'xu', (l->>'h')::int * t.stake / 2,
                                                           'paid', (l->>'paid')::int * t.stake / 2, 'why', l->'why') order by n)
                         from jsonb_array_elements(t.pub->'lines') with ordinality e(l, n)), '[]'::jsonb),
    'net', (select jsonb_object_agg(q, coalesce((select sum(case when l->>'to' = q then (l->>'paid')::int else -(l->>'paid')::int end)
                                                   from jsonb_array_elements(t.pub->'lines') l
                                                  where q in (l->>'from', l->>'to')), 0) * t.stake / 2)
              from jsonb_array_elements_text(t.pub->'order') q))
  from public.card_tables t where t.room_id = p_room and t.game = 'tienlen'
$$;

-- The deal (§7.3, §7.6): the table's wallets locked in account-id order, then the unseen (R28) and those short of 10 S
-- stand up; fewer than two players → idle. 10 S held from each; 13 cards each in seat order; the leader (R15); tới trắng.
create or replace function public._tl_deal(p_room uuid, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; r record; v_seats integer[]; v_deck integer[]; v_hand integer; i integer; v_cards integer[];
        v_first boolean; v_low integer; v_leader integer; v_best integer; v_rank integer := 0; v_r integer; s integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  perform public._card_lock_wallets(p_room, 'tienlen');
  for r in select cs.seat from public.card_seats cs left join public.wallets w on w.account_id = cs.account_id
            where cs.room_id = p_room and cs.game = 'tienlen' and not cs.leaving
              and (cs.seen_at < p_now - interval '60 seconds' or coalesce(w.coins, 0) < 10 * t.stake)
            order by cs.seat loop
    perform public._card_leave_seat(p_room, 'tienlen', r.seat, 'idle', p_now);
  end loop;
  v_seats := array(select seat from public.card_seats where room_id = p_room and game = 'tienlen' and not leaving order by seat);
  if cardinality(v_seats) < 2 then
    update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
     where room_id = p_room and game = 'tienlen';
    return true;
  end if;
  v_deck := coalesce(p_deck, public._card_shuffle());
  v_hand := t.hand_no + 1;
  delete from public.card_hands where room_id = p_room and game = 'tienlen';
  delete from public.card_secrets where room_id = p_room and game = 'tienlen';
  for i in 1..cardinality(v_seats) loop
    v_cards := array(select c from unnest(v_deck[13 * i - 12 : 13 * i]) c order by c);
    insert into public.card_hands (room_id, game, hand_no, seat, account_id, dealt, cards)
    select p_room, 'tienlen', v_hand, v_seats[i], account_id, v_cards, v_cards
      from public.card_seats where room_id = p_room and game = 'tienlen' and seat = v_seats[i];
  end loop;
  for r in select seat, account_id from public.card_seats where room_id = p_room and game = 'tienlen' and seat = any(v_seats)
            order by seat loop
    perform public._pay(r.account_id, -10 * t.stake, 'card_hold', public._card_ref('tienlen', v_hand));
    update public.card_seats set escrow = 10 * t.stake where room_id = p_room and game = 'tienlen' and seat = r.seat;
  end loop;
  -- the first game, a game after tới trắng, or one the last nhất is not dealt into: the lowest dealt card leads (R15)
  v_first := t.first_game or not exists (select 1 from public.card_seats where room_id = p_room and game = 'tienlen'
                                            and account_id = t.lead_id and seat = any(v_seats));
  v_low := (select min(c) from public.card_hands h, unnest(h.cards) c where h.room_id = p_room and h.game = 'tienlen');
  v_leader := case when v_first
                then (select seat from public.card_hands where room_id = p_room and game = 'tienlen' and v_low = any(cards))
                else (select seat from public.card_seats where room_id = p_room and game = 'tienlen' and account_id = t.lead_id) end;
  update public.card_tables
     set hand_no = v_hand, phase = 'playing', turn = v_leader, deadline = p_now + interval '20 seconds',
         pub = jsonb_build_object(
           'first', v_first, 'must', case when v_first then v_low end, 'order', to_jsonb(v_seats),
           'players', (select jsonb_object_agg(cs.seat::text, jsonb_build_object('id', cs.account_id, 'n', 13, 'played', false,
                                                 'out', null, 'place', null, 'paid', 0, 'settled', false))
                         from public.card_seats cs where cs.room_id = p_room and cs.game = 'tienlen' and cs.seat = any(v_seats)),
           'top', null, 'passed', '[]'::jsonb, 'pile', '[]'::jsonb, 'chain', null, 'lines', '[]'::jsonb)
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', v_hand, null, null, 'deal',
    jsonb_build_object('hands', (select jsonb_object_agg(seat::text, to_jsonb(dealt)) from public.card_hands
                                  where room_id = p_room and game = 'tienlen'), 'leader', v_leader, 'first', v_first), p_now);
  delete from public.card_log where id in (select id from public.card_log where at < p_now - interval '14 days' order by at limit 500);
  -- tới trắng (§7.4): the best pattern wins; the same pattern goes to the first in turn order from the leader
  foreach s in array array[v_leader] || public._card_after(v_seats, v_leader) loop
    v_r := public._tl_trang_rank(public._tl_trang((select cards from public.card_hands
                                                     where room_id = p_room and game = 'tienlen' and seat = s)));
    if v_r > v_rank then
      v_rank := v_r;
      v_best := s;
    end if;
  end loop;
  if v_best is not null then
    perform public._tl_do_trang(p_room, v_best, p_now);
  end if;
  return true;
end $$;

-- Tới trắng (§7.3 trang()): every other player pays 2 S, every seat is paid out, and the next deal is a first game (R15).
create or replace function public._tl_do_trang(p_room uuid, p_seat integer, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_cards integer[]; v_hand integer;
begin
  select cards, hand_no into v_cards, v_hand from public.card_hands where room_id = p_room and game = 'tienlen' and seat = p_seat;
  perform public._tl_event(p_room, jsonb_build_object('k', 'trang', 'seat', p_seat));
  update public.card_tables
     set last = public._tl_last(p_room, jsonb_build_object('seat', p_seat, 'pattern', public._tl_trang(v_cards),
                                                           'cards', to_jsonb(v_cards)))
   where room_id = p_room and game = 'tienlen';
  perform public._card_settle(p_room, 'tienlen');
  update public.card_tables
     set first_game = true, lead_id = null, phase = 'result', turn = null, deadline = p_now + interval '8 seconds'
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', v_hand, null, p_seat, 'trang',
                           jsonb_build_object('pattern', public._tl_trang(v_cards)), p_now);
end $$;

-- The next turn (§7.3 advance): the first seat after p_from that is active, does not own the top and has not passed;
-- nobody left closes the round.
create or replace function public._tl_advance(p_room uuid, p_from integer, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pub jsonb; v_cand integer[]; v_turn integer;
begin
  select pub into v_pub from public.card_tables where room_id = p_room and game = 'tienlen';
  v_cand := array(select s from unnest(public._tl_active(v_pub)) s
                   where s is distinct from (v_pub->'top'->>'seat')::int and not (s = any(public._card_ints(v_pub->'passed'))));
  if cardinality(v_cand) = 0 then
    perform public._tl_close(p_room, p_now);
    return;
  end if;
  v_turn := (select s from unnest(public._card_after(public._card_ints(v_pub->'order'), p_from)) with ordinality u(s, n)
              where s = any(v_cand) order by n limit 1);
  update public.card_tables set turn = v_turn, deadline = p_now + interval '20 seconds'
   where room_id = p_room and game = 'tienlen';
end $$;

-- The round closes (§7.3 close_round): the chain is paid, and the top's owner leads — or, when it went out, the next
-- active seat after it ("hưởng sái").
create or replace function public._tl_close(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pub jsonb; v_top integer; v_turn integer;
begin
  v_pub := public._tl_event(p_room, '{"k": "close"}'::jsonb);
  v_top := (v_pub->'top'->>'seat')::int;
  v_turn := case when v_pub->'players'->(v_top::text)->>'out' is null then v_top
                 else (select s from unnest(public._card_after(public._card_ints(v_pub->'order'), v_top)) with ordinality u(s, n)
                        where v_pub->'players'->(s::text)->>'out' is null order by n limit 1) end;
  update public.card_tables
     set pub = v_pub || jsonb_build_object('top', null, 'passed', '[]'::jsonb, 'pile', '[]'::jsonb),
         turn = v_turn, deadline = p_now + interval '20 seconds'
   where room_id = p_room and game = 'tienlen';
end $$;

-- A play (§7.3 play): the refusal of a move that is not legal (a bad_move, §11.5), else null. In turn: any combination to
-- lead (a first game's lead includes `must`), or one that beats the top. Out of turn: only a 4 đôi thông that beats the
-- top (R9). A bomb over a heo combination or another bomb cuts (§7.2).
create or replace function public._tl_do_play(p_room uuid, p_seat integer, p_cards integer[], p_now timestamptz) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; v_acc uuid; v_hand integer[]; x jsonb; v_top jsonb; v_left integer[];
        s text := p_seat::text;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  if t.phase <> 'playing' then
    return 'wrong phase';
  end if;
  v_pub := t.pub;
  select account_id into v_acc from public.card_seats where room_id = p_room and game = 'tienlen' and seat = p_seat;
  if v_pub->'players'->s->>'out' is not null or (v_pub->'players'->s->>'id')::uuid is distinct from v_acc then
    return 'not your turn';
  end if;
  select cards into v_hand from public.card_hands
   where room_id = p_room and game = 'tienlen' and hand_no = t.hand_no and seat = p_seat;
  x := public._tl_combo(p_cards);
  if x is null or not coalesce(v_hand @> p_cards, false) then
    return 'invalid play';
  end if;
  v_top := case when jsonb_typeof(v_pub->'top') = 'object' then v_pub->'top' end;
  if t.turn = p_seat then
    if v_top is null then
      if jsonb_typeof(v_pub->'must') = 'number' and not ((v_pub->>'must')::int = any(p_cards)) then
        return 'must include';
      end if;
    elsif not public._tl_beats(v_top, x) then
      return 'cannot beat';
    end if;
  else
    if x->>'type' <> 'pairs' or (x->>'len')::int <> 4 or v_top is null or (v_top->>'seat')::int = p_seat then
      return 'not your turn';
    end if;
    if not public._tl_beats(v_top, x) then
      return 'cannot beat';
    end if;
  end if;
  if v_top is not null and x->>'type' in ('quad', 'pairs')
     and (v_top->>'type' in ('quad', 'pairs') or (v_top->>'type' in ('single', 'pair') and (v_top->>'key')::int / 4 = 12)) then
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'cut', 'seat', p_seat, 'top', v_top));
  end if;
  v_left := array(select c from unnest(v_hand) c where not (c = any(p_cards)) order by c);
  update public.card_hands set cards = v_left
   where room_id = p_room and game = 'tienlen' and hand_no = t.hand_no and seat = p_seat;
  v_pub := jsonb_set(jsonb_set(v_pub, array['players', s, 'played'], 'true'), array['players', s, 'n'], to_jsonb(cardinality(v_left)))
    || jsonb_build_object(
         'must', null,
         'passed', coalesce((select jsonb_agg(q) from jsonb_array_elements(v_pub->'passed') q where q::int <> p_seat), '[]'::jsonb),
         'top', x || jsonb_build_object('seat', p_seat, 'done', cardinality(v_left) = 0),
         'pile', (select coalesce(jsonb_agg(z.e order by z.n), '[]'::jsonb)
                    from (select e, n from jsonb_array_elements(coalesce(v_pub->'pile', '[]'::jsonb)
                                         || jsonb_build_array(jsonb_build_object('seat', p_seat, 'cards', x->'cards')))
                                         with ordinality w(e, n) order by n desc limit 8) z));
  update public.card_tables set pub = v_pub where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', t.hand_no, v_acc, p_seat, 'play', jsonb_build_object('cards', x->'cards'), p_now);
  if cardinality(v_left) = 0 then
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'out', 'seat', p_seat));
  end if;
  if cardinality(public._tl_active(v_pub)) <= 1 then
    perform public._tl_end(p_room, p_now);
  else
    perform public._tl_advance(p_room, p_seat, p_now);
  end if;
  return null;
end $$;

-- A pass (§7.3 pass): only in turn, and never while leading.
create or replace function public._tl_do_pass(p_room uuid, p_seat integer, p_now timestamptz) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  if t.phase <> 'playing' then
    return 'wrong phase';
  end if;
  if t.turn is distinct from p_seat then
    return 'not your turn';
  end if;
  if coalesce(jsonb_typeof(t.pub->'top'), 'null') <> 'object' then
    return 'must play';
  end if;
  update public.card_tables set pub = jsonb_set(pub, '{passed}', coalesce(pub->'passed', '[]'::jsonb) || to_jsonb(p_seat))
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', t.hand_no,
                           (select account_id from public.card_seats where room_id = p_room and game = 'tienlen' and seat = p_seat),
                           p_seat, 'pass', '{}'::jsonb, p_now);
  perform public._tl_advance(p_room, p_seat, p_now);
  return null;
end $$;

-- A turn that ran out (§10): the lowest card when leading, else a pass; the second miss in a row leaves the game as
-- card_leave would (R28).
create or replace function public._tl_timeout(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_missed integer; v_acc uuid; v_low integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  update public.card_seats set missed = missed + 1 where room_id = p_room and game = 'tienlen' and seat = t.turn
  returning missed, account_id into v_missed, v_acc;
  perform public._card_log(p_room, 'tienlen', t.hand_no, v_acc, t.turn, 'timeout', jsonb_build_object('missed', v_missed), p_now);
  if v_missed >= 2 then
    perform public._card_leave_seat(p_room, 'tienlen', t.turn, 'timeout', p_now);
  elsif coalesce(jsonb_typeof(t.pub->'top'), 'null') <> 'object' then
    select min(c) into v_low from public.card_hands h, unnest(h.cards) c
     where h.room_id = p_room and h.game = 'tienlen' and h.hand_no = t.hand_no and h.seat = t.turn;
    perform public._tl_do_play(p_room, t.turn, array[v_low], p_now);
  else
    perform public._tl_do_pass(p_room, t.turn, p_now);
  end if;
end $$;

-- The leave operation in a live game (§6.3), with the table's wallets locked: seats still holding cards forfeit together
-- (R13) and are paid out at once; seats already out or cóng are paid out and receive nothing more. The rows stay
-- `leaving` until the game ends; the others play on as a smaller game.
create or replace function public._tl_leave(p_room uuid, p_seats integer[], p_how text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; v_hold integer[]; v_done integer[]; s integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  v_pub := t.pub;
  v_hold := array(select x from unnest(p_seats) x where v_pub->'players'->(x::text)->>'out' is null
                   and not coalesce((v_pub->'players'->(x::text)->>'settled')::boolean, true) order by x);
  v_done := array(select x from unnest(p_seats) x where v_pub->'players'->(x::text)->>'out' is not null
                   and not coalesce((v_pub->'players'->(x::text)->>'settled')::boolean, true) order by x);
  if cardinality(v_hold) > 0 then
    -- a first lead's `must` goes with the forfeiter who holds it
    if jsonb_typeof(v_pub->'must') = 'number'
       and exists (select 1 from public.card_hands where room_id = p_room and game = 'tienlen' and hand_no = t.hand_no
                      and seat = any(v_hold) and (v_pub->>'must')::int = any(cards)) then
      update public.card_tables set pub = jsonb_set(pub, '{must}', 'null') where room_id = p_room and game = 'tienlen';
    end if;
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'forfeit', 'seats', to_jsonb(v_hold)));
  end if;
  foreach s in array v_done loop
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'leave', 'seat', s));
  end loop;
  perform public._card_lock_wallets(p_room, 'tienlen');
  foreach s in array v_hold || v_done loop
    perform public._card_payout(p_room, 'tienlen', s, 'card_settle');
    update public.card_seats set leaving = true where room_id = p_room and game = 'tienlen' and seat = s;
    perform public._card_log(p_room, 'tienlen', t.hand_no, (v_pub->'players'->(s::text)->>'id')::uuid, s, 'leave',
                             jsonb_build_object('how', p_how, 'forfeit', s = any(v_hold)), p_now);
  end loop;
  if cardinality(v_hold) > 0 then
    if cardinality(public._tl_active(v_pub)) <= 1 then
      perform public._tl_end(p_room, p_now);
    elsif t.turn = any(v_hold) then
      perform public._tl_advance(p_room, t.turn, p_now);
    end if;
  end if;
end $$;

-- The end of a game (§7.3 end_game): the end lines, the result, every balance paid, the leaving rows gone; nhất leads the
-- next game (R15).
create or replace function public._tl_end(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pub jsonb; v_hand integer; v_nhat text;
begin
  v_pub := public._tl_event(p_room, '{"k": "end"}'::jsonb);
  v_nhat := (select key from jsonb_each(v_pub->'players') where (value->>'place')::int = 1);
  update public.card_tables set last = public._tl_last(p_room, null) where room_id = p_room and game = 'tienlen'
  returning hand_no into v_hand;
  perform public._card_settle(p_room, 'tienlen');
  delete from public.card_seats where room_id = p_room and game = 'tienlen' and leaving;
  update public.card_tables
     set lead_id = (v_pub->'players'->v_nhat->>'id')::uuid, first_game = false, phase = 'result', turn = null,
         deadline = p_now + interval '8 seconds'
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', v_hand, null, null, 'end',
                           (select jsonb_build_object('places', last->'places', 'net', last->'net') from public.card_tables
                             where room_id = p_room and game = 'tienlen'), p_now);
  perform public._card_reset_if_empty(p_room, 'tienlen');
end $$;

-- What is due at a Tiến lên table (§10): the deal after the countdown or the result, or the turn's timeout.
create or replace function public._tl_due(p_room uuid, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_phase text;
begin
  select phase into v_phase from public.card_tables where room_id = p_room and game = 'tienlen';
  if v_phase in ('countdown', 'result') then
    return public._tl_deal(p_room, p_now, p_deck);
  elsif v_phase = 'playing' then
    perform public._tl_timeout(p_room, p_now);
    return true;
  end if;
  return false;
end $$;

revoke all on function public._tl_hands(uuid) from public, anon, authenticated;
revoke all on function public._tl_active(jsonb) from public, anon, authenticated;
revoke all on function public._tl_event(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._tl_last(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._tl_deal(uuid, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._tl_do_trang(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_advance(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_close(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_do_play(uuid, integer, integer[], timestamptz) from public, anon, authenticated;
revoke all on function public._tl_do_pass(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_timeout(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_leave(uuid, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_end(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_due(uuid, timestamptz, integer[]) from public, anon, authenticated;

-- ---------- E. Public RPCs (§11.3): membership first (R38); reads are snapshots (R37); ticks and writes lock and sweep ----------
-- The hall's table labels (R27): every table's stake, phase and seats; no touch, no lock.
create or replace function public.card_lobby(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  return jsonb_build_object('server_now', now(), 'tables', (
    select jsonb_agg(jsonb_build_object(
             'game', g.game, 'stake', t.stake, 'phase', coalesce(t.phase, 'idle'), 'max', public._card_max(g.game),
             'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'id', s.account_id, 'name', a.username)
                                                 order by s.seat)
                                  from public.card_seats s join public.accounts a on a.id = s.account_id
                                 where s.room_id = p_room_id and s.game = g.game), '[]'::jsonb)) order by g.n)
      from unnest(array['tienlen', 'cao', 'poker']) with ordinality g(game, n)
      left join public.card_tables t on t.room_id = p_room_id and t.game = g.game));
end $$;

-- A table's public state (§11.4); the caller's seen_at is touched in a separate statement.
create or replace function public.card_state(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := (select account_id from public.members where id = public._auth(p_room_id, p_session_token, 'any'));
        v jsonb;
begin
  v := public._card_view(p_room_id, public._card_game(p_game), now());
  perform public._card_touch(p_room_id, v_account, now());
  return v;
end $$;

-- The caller's own cards, and nobody else's (§6.4).
create or replace function public.card_hand(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := (select account_id from public.members where id = public._auth(p_room_id, p_session_token, 'any'));
        v jsonb;
begin
  v := public._card_hand(p_room_id, public._card_game(p_game), v_account, now());
  perform public._card_touch(p_room_id, v_account, now());
  return v;
end $$;

-- Apply what is due (§10). Allowlisted (R31): it applies only what is due.
create or replace function public.card_tick(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  return public._card_tick(p_room_id, v_account, public._card_game(p_game), now(), null);
end $$;

-- Stand up. Allowlisted (R31): leaving never helps a cheater.
create or replace function public.card_leave(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  return public._card_leave(p_room_id, v_account, public._card_game(p_game), now());
end $$;

-- Sit down (§11.3). Guarded; the hard checks (§11.5) come before any lock.
create or replace function public.card_sit(p_room_id uuid, p_session_token text, p_game text, p_seat integer, p_stake integer,
                                           p_buyin integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_game is null or p_game not in ('tienlen', 'cao', 'poker') then
    return public._ac_flag(v_account, 'bad_game', 'card_sit', jsonb_build_object('game', p_game), p_room_id, 'invalid game');
  end if;
  if p_seat is null or p_seat not between 1 and public._card_max(p_game) then
    return public._ac_flag(v_account, 'bad_seat', 'card_sit', jsonb_build_object('game', p_game, 'seat', p_seat), p_room_id,
                           'invalid seat');
  end if;
  if p_stake is null or p_stake not in (100, 1000, 10000) then
    return public._ac_flag(v_account, 'bad_stake', 'card_sit', jsonb_build_object('game', p_game, 'stake', p_stake), p_room_id,
                           'invalid stake');
  end if;
  if (p_game = 'poker' and (p_buyin is null or p_buyin not between 50 * p_stake and 200 * p_stake))
     or (p_game <> 'poker' and p_buyin is not null) then
    return public._ac_flag(v_account, 'bad_qty', 'card_sit',
                           jsonb_build_object('game', p_game, 'stake', p_stake, 'buyin', p_buyin), p_room_id, 'invalid quantity');
  end if;
  return public._card_sit(p_room_id, v_account, p_game, p_seat, p_stake, p_buyin, now());
end $$;

-- Play cards (§7.3). Guarded; bad_cards (§11.5) comes before any lock.
create or replace function public.tl_play(p_room_id uuid, p_session_token text, p_seq integer, p_cards integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_cards is null or coalesce(cardinality(p_cards), 0) = 0 or cardinality(p_cards) > 13 or array_ndims(p_cards) <> 1
     or exists (select 1 from unnest(p_cards) c where c is null or c not between 0 and 51)
     or (select count(distinct c) from unnest(p_cards) c) <> cardinality(p_cards) then
    return public._ac_flag(v_account, 'bad_cards', 'tl_play', jsonb_build_object('seq', p_seq, 'cards', to_jsonb(p_cards)),
                           p_room_id, 'invalid cards');
  end if;
  return public._card_action(p_room_id, v_account, 'tienlen', 'tl_play', p_seq, jsonb_build_object('cards', to_jsonb(p_cards)),
                             now());
end $$;

-- Pass (§7.3). Guarded.
create or replace function public.tl_pass(p_room_id uuid, p_session_token text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._card_action(p_room_id, v_account, 'tienlen', 'tl_pass', p_seq, '{}'::jsonb, now());
end $$;

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
grant execute on function public.card_state(uuid, text, text) to anon, authenticated;
grant execute on function public.card_hand(uuid, text, text) to anon, authenticated;
grant execute on function public.card_tick(uuid, text, text) to anon, authenticated;
grant execute on function public.card_leave(uuid, text, text) to anon, authenticated;
grant execute on function public.card_sit(uuid, text, text, integer, integer, integer) to anon, authenticated;
grant execute on function public.tl_play(uuid, text, integer, integer[]) to anon, authenticated;
grant execute on function public.tl_pass(uuid, text, integer) to anon, authenticated;
