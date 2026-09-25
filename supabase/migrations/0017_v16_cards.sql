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
