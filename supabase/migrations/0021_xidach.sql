-- =========================================================
-- 0021_xidach.sql — Sòng Xì Dách Việt Nam (Đầy đủ logic chia bài)
-- =========================================================

-- 1. Check constraint cho card_tables
alter table public.card_tables drop constraint if exists card_tables_game_check;
alter table public.card_tables add constraint card_tables_game_check
  check (game in ('tienlen', 'cao', 'poker', 'xidach'));

-- 2. Số người tối đa
create or replace function public._card_max(p_game text) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case p_game
    when 'tienlen' then 4
    when 'cao' then 17
    when 'poker' then 6
    when 'xidach' then 8
  end
$$;

-- 3. Cho phép xidach qua _card_game
create or replace function public._card_game(p_game text) returns text
language plpgsql immutable set search_path = public, extensions
as $$
begin
  if p_game is null or p_game not in ('tienlen', 'cao', 'poker', 'xidach') then
    raise exception 'invalid game' using errcode = '22023';
  end if;
  return p_game;
end $$;

-- 4. Khởi tạo hàng xidach trong card_tables
create or replace function public._card_init(p_room uuid) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.card_tables (room_id, game) select p_room, g from unnest(array['tienlen', 'cao', 'poker', 'xidach']) g
  on conflict (room_id, game) do nothing
$$;

insert into public.card_tables (room_id, game)
select id, 'xidach' from public.rooms
on conflict (room_id, game) do nothing;

-- 5. card_lobby trả về bàn xidach
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
      from unnest(array['tienlen', 'cao', 'poker', 'xidach']) with ordinality g(game, n)
      left join public.card_tables t on t.room_id = p_room_id and t.game = g.game));
end $$;
grant execute on function public.card_lobby(uuid, text) to anon, authenticated;

-- 6. card_sit
create or replace function public.card_sit(p_room_id uuid, p_session_token text, p_game text, p_seat integer, p_stake integer,
                                           p_buyin integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_game is null or p_game not in ('tienlen', 'cao', 'poker', 'xidach') then
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

-- 7. _card_sit
create or replace function public._card_sit(p_room uuid, p_account uuid, p_game text, p_seat integer, p_stake integer,
                                            p_buyin integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; w public.wallets; r record;
begin
  perform public._card_open(p_room, p_game);
  for r in select a from (select account_id as a from public.card_seats where room_id = p_room and game = p_game
                          union select p_account) x order by a loop
    perform public._wallet_lock(r.a);
  end loop;
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
  if w.coins < (case p_game when 'tienlen' then 10 * p_stake when 'cao' then p_stake when 'xidach' then 2 * p_stake else p_buyin end) then
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

-- 8. Logic chia bài và vòng chơi Xì Dách
create or replace function public._xidach_start(p_room uuid, p_now timestamptz, p_deck integer[] default null) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  t public.card_tables;
  v_players integer[];
  n integer;
  v_dealer integer;
  v_deck integer[];
  v_hand integer;
  i integer;
  v_cards integer[];
  v_con_order integer[];
  v_pub_players jsonb := '{}'::jsonb;
  r record;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  -- the wallets first (§11.6), then whoever cannot cover a player's hold (2 × stake) stands up, as at Cào
  perform public._card_lock_wallets(p_room, 'xidach');
  for r in select cs.seat from public.card_seats cs left join public.wallets w on w.account_id = cs.account_id
            where cs.room_id = p_room and cs.game = 'xidach' and not cs.leaving and coalesce(w.coins, 0) < 2 * t.stake
            order by cs.seat loop
    perform public._card_leave_seat(p_room, 'xidach', r.seat, 'idle', p_now);
  end loop;
  v_players := array(select seat from public.card_seats where room_id = p_room and game = 'xidach' and not leaving order by seat);
  n := cardinality(v_players);
  if n < 2 then
    update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
     where room_id = p_room and game = 'xidach';
    return;
  end if;

  -- the dealer holds (n − 1) × 2 × stake: the last dealer if they still can, else the first seat that can
  v_dealer := (select cs.seat from public.card_seats cs join public.wallets w on w.account_id = cs.account_id
                where cs.room_id = p_room and cs.game = 'xidach' and cs.seat = any(v_players)
                  and w.coins >= (n - 1) * 2 * t.stake
                order by (cs.seat is distinct from (t.pub->>'dealer')::int)::int, cs.seat
                limit 1);
  if v_dealer is null then
    -- nobody can bank this many players: the poorest seat stands up and the deal is tried again
    perform public._card_leave_seat(p_room, 'xidach',
      (select cs.seat from public.card_seats cs left join public.wallets w on w.account_id = cs.account_id
        where cs.room_id = p_room and cs.game = 'xidach' and cs.seat = any(v_players)
        order by coalesce(w.coins, 0), cs.seat desc limit 1), 'idle', p_now);
    perform public._xidach_start(p_room, p_now, p_deck);
    return;
  end if;

  v_con_order := array(select s from unnest(v_players) s where s <> v_dealer order by s);
  v_deck := coalesce(p_deck, public._card_shuffle());
  v_hand := t.hand_no + 1;
  delete from public.card_hands where room_id = p_room and game = 'xidach';
  delete from public.card_secrets where room_id = p_room and game = 'xidach';

  for i in 1..n loop
    v_cards := array(select c from unnest(v_deck[2 * i - 1 : 2 * i]) c order by c);
    insert into public.card_hands (room_id, game, hand_no, seat, account_id, dealt, cards)
    select p_room, 'xidach', v_hand, v_players[i], account_id, v_cards, v_cards
      from public.card_seats where room_id = p_room and game = 'xidach' and seat = v_players[i];
    
    v_pub_players := v_pub_players || jsonb_build_object(
      v_players[i]::text, jsonb_build_object(
        'id', (select account_id from public.card_seats where room_id = p_room and game = 'xidach' and seat = v_players[i]),
        'n', 2,
        'standing', false,
        'busted', false,
        'inspected', false
      )
    );
  end loop;

  insert into public.card_secrets (room_id, game, hand_no, board)
  values (p_room, 'xidach', v_hand, v_deck[2 * n + 1 : 52]);

  for r in select seat, account_id from public.card_seats where room_id = p_room and game = 'xidach' and seat = any(v_players) loop
    perform public._pay(r.account_id, -(case when r.seat = v_dealer then (n - 1) * 2 else 2 end) * t.stake, 'card_hold',
                        public._card_ref('xidach', v_hand));
    update public.card_seats set escrow = (case when r.seat = v_dealer then (n - 1) * 2 else 2 end) * t.stake
     where room_id = p_room and game = 'xidach' and seat = r.seat;
  end loop;

  update public.card_tables
     set hand_no = v_hand, phase = 'playing',
         turn = coalesce(v_con_order[1], v_dealer),
         deadline = p_now + interval '30 seconds',
         pub = jsonb_build_object(
           'dealer', v_dealer,
           'order', to_jsonb(v_con_order || array[v_dealer]),
           'left', '[]'::jsonb,
           'deck_count', 52 - 2 * n,
           'players', v_pub_players
         )
   where room_id = p_room and game = 'xidach';

  perform public._card_log(p_room, 'xidach', v_hand, null, v_dealer, 'deal',
    jsonb_build_object('hands', (select jsonb_object_agg(seat::text, to_jsonb(dealt)) from public.card_hands
                                  where room_id = p_room and game = 'xidach')), p_now);
end $$;

-- 8b. Luật điểm (mirror lib/game/cards/xidach.ts). Lá c: hạng r = c / 4 (0 = '3' … 7 = '10', 8 J, 9 Q, 10 K, 11 A, 12 '2').
-- Điểm tốt nhất ≤ 21 (Át tính 1, 10 hoặc 11), hoặc nhỏ nhất khi đã quá 21.
create or replace function public._xd_points(p_cards integer[]) returns integer
language plpgsql immutable set search_path = public, extensions
as $$
declare c integer; r integer; v_base integer := 0; v_aces integer := 0; v_tot integer[] := array[0]; i integer;
begin
  if coalesce(cardinality(p_cards), 0) = 0 then
    return 0;
  end if;
  foreach c in array p_cards loop
    r := c / 4;
    if r = 11 then
      v_aces := v_aces + 1;
      v_base := v_base + 1;
    elsif r = 12 then
      v_base := v_base + 2;
    elsif r >= 7 then
      v_base := v_base + 10;
    else
      v_base := v_base + r + 3;
    end if;
  end loop;
  v_tot := array[v_base];
  for i in 1..v_aces loop
    v_tot := array(select distinct x from (select unnest(v_tot) x union all select unnest(v_tot) + 9
                                           union all select unnest(v_tot) + 10) u);
  end loop;
  return coalesce((select max(x) from unnest(v_tot) x where x <= 21), (select min(x) from unnest(v_tot) x));
end $$;

create or replace function public._xd_kind(p_cards integer[]) returns text
language plpgsql immutable set search_path = public, extensions
as $$
declare n integer := coalesce(cardinality(p_cards), 0); p integer;
begin
  if n = 0 then
    return 'quac';
  end if;
  if n = 2 then
    if p_cards[1] / 4 = 11 and p_cards[2] / 4 = 11 then
      return 'xi_bang';
    end if;
    if (p_cards[1] / 4 = 11 and p_cards[2] / 4 between 7 and 10) or (p_cards[2] / 4 = 11 and p_cards[1] / 4 between 7 and 10) then
      return 'xi_dach';
    end if;
  end if;
  p := public._xd_points(p_cards);
  if n = 5 and p <= 21 then
    return 'ngu_linh';
  end if;
  if p > 21 then
    return 'quac';
  end if;
  return 'du_tuoi';
end $$;

-- 1: nhà con thắng, -1: cái thắng, 0: hoà (cùng Quắc cũng hoà; cùng Ngũ Linh thì ít điểm hơn thắng)
create or replace function public._xd_cmp(p_player integer[], p_dealer integer[]) returns integer
language plpgsql immutable set search_path = public, extensions
as $$
declare pk text := public._xd_kind(p_player); dk text := public._xd_kind(p_dealer); pw integer; dw integer;
        pp integer := public._xd_points(p_player); dp integer := public._xd_points(p_dealer);
begin
  pw := case pk when 'xi_bang' then 5 when 'xi_dach' then 4 when 'ngu_linh' then 3 when 'du_tuoi' then 2 else 1 end;
  dw := case dk when 'xi_bang' then 5 when 'xi_dach' then 4 when 'ngu_linh' then 3 when 'du_tuoi' then 2 else 1 end;
  if pw <> dw then
    return sign(pw - dw)::int;
  end if;
  if pk = 'ngu_linh' then
    return sign(dp - pp)::int;
  end if;
  if pk = 'du_tuoi' then
    return sign(pp - dp)::int;
  end if;
  return 0;
end $$;

-- Một dòng tiền giữa nhà con p_seat và cái: {from, to, xu, why}, hoặc null khi hoà. Xì Bàng, Ngũ Linh ăn gấp đôi.
create or replace function public._xd_line(p_seat integer, p_dealer integer, p_stake integer, p_player integer[],
                                           p_dealer_cards integer[]) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare v_cmp integer := public._xd_cmp(p_player, p_dealer_cards); k text;
begin
  if v_cmp = 0 then
    return null;
  end if;
  k := public._xd_kind(case when v_cmp > 0 then p_player else p_dealer_cards end);
  return jsonb_build_object(
    'from', case when v_cmp > 0 then p_dealer else p_seat end,
    'to', case when v_cmp > 0 then p_seat else p_dealer end,
    'xu', p_stake * case when k in ('xi_bang', 'ngu_linh') then 2 else 1 end,
    'why', case when k in ('xi_bang', 'ngu_linh') then k else 'win' end);
end $$;

-- Áp một dòng tiền vào tiền giữ (escrow) của hai ghế; showdown trả escrow qua _card_settle.
create or replace function public._xd_apply(p_room uuid, p_line jsonb) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_line is null then
    return;
  end if;
  update public.card_seats set escrow = escrow - (p_line->>'xu')::int
   where room_id = p_room and game = 'xidach' and seat = (p_line->>'from')::int;
  update public.card_seats set escrow = escrow + (p_line->>'xu')::int
   where room_id = p_room and game = 'xidach' and seat = (p_line->>'to')::int;
end $$;

revoke all on function public._xd_apply(uuid, jsonb) from public, anon, authenticated;

-- 9. Hành động Rút bài (Hit): tới lượt, chưa dằn, dưới 5 lá, không phải Xì Bàng / Xì Dách. Quá 21 vẫn được rút tiếp
-- tới 5 lá, và không ai biết (bài úp tới lúc ngã ngũ); đủ 5 lá thì nhà con tự chuyển lượt.
create or replace function public._xidach_do_hit(p_room uuid, p_seat integer, p_now timestamptz) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  t public.card_tables;
  v_secrets public.card_secrets;
  v_card integer;
  v_rest integer[];
  v_hand integer[];
  v_n integer;
  v_kind text;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  if t.phase <> 'playing' or t.turn is distinct from p_seat then
    return 'not your turn';
  end if;
  if coalesce((t.pub->'players'->(p_seat::text)->>'standing')::boolean, false) then
    return 'already standing';
  end if;
  select * into v_secrets from public.card_secrets where room_id = p_room and game = 'xidach' and hand_no = t.hand_no;
  if coalesce(cardinality(v_secrets.board), 0) = 0 then
    return 'deck empty';
  end if;

  select cards into v_hand from public.card_hands where room_id = p_room and game = 'xidach' and seat = p_seat and hand_no = t.hand_no;
  if cardinality(v_hand) >= 5 then
    return 'max cards reached';
  end if;
  if public._xd_kind(v_hand) in ('xi_bang', 'xi_dach') then
    return 'cannot hit';
  end if;

  v_card := v_secrets.board[1];
  v_rest := v_secrets.board[2 : cardinality(v_secrets.board)];
  update public.card_secrets set board = v_rest where room_id = p_room and game = 'xidach' and hand_no = t.hand_no;

  v_hand := v_hand || array[v_card];
  update public.card_hands set cards = v_hand where room_id = p_room and game = 'xidach' and seat = p_seat and hand_no = t.hand_no;

  v_n := cardinality(v_hand);
  v_kind := public._xd_kind(v_hand);
  update public.card_tables
     set deadline = p_now + interval '30 seconds',
         pub = jsonb_set(jsonb_set(pub,
                 array['players', p_seat::text, 'n'], to_jsonb(v_n)),
                 array['deck_count'], to_jsonb(cardinality(v_rest)))
   where room_id = p_room and game = 'xidach';

  -- a player with five cards is done: the turn moves on (a busted hand stays secret)
  if p_seat <> (t.pub->>'dealer')::int and v_n = 5 then
    perform public._xidach_advance(p_room, p_seat, p_now);
  end if;
  return null;
end $$;

-- 10. Showdown, khi cái dằn (cái rút xong mới ngã ngũ). Các dòng tiền:
--   - quá 28 điểm (không phải Xì Bàng / Xì Dách) thì "đền làng": trả 1 cược cho mỗi người khác còn trong ván;
--   - nhà con chưa bị xét, không ai quá 28, so với cái (Xì Bàng, Ngũ Linh ăn gấp đôi);
--   - người rời bàn giữa ván mất 1 cược cho cái; cái rời bàn thì ván huỷ.
-- Các dòng lúc xét bài (pub.lines) cộng vào. Mỗi ghế nhận escrow + net; thiếu thì ví bị trừ thành âm (mt.allow_debt).
create or replace function public._xd_over(p_cards integer[]) returns boolean
language sql immutable set search_path = public, extensions
as $$ select public._xd_kind(p_cards) not in ('xi_bang', 'xi_dach') and public._xd_points(p_cards) > 28 $$;

-- Đền làng: p_seat trả 1 cược cho từng ghế trong p_others.
create or replace function public._xd_den_lang(p_seat integer, p_others integer[], p_stake integer) returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object('from', p_seat, 'to', o, 'xu', p_stake, 'why', 'den_lang') order by o), '[]'::jsonb)
    from unnest(p_others) o where o <> p_seat
$$;

create or replace function public._xidach_showdown(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  t public.card_tables;
  v_dealer integer;
  v_order integer[];
  v_left integer[];
  v_in integer[];
  v_lines jsonb;
  v_line jsonb;
  v_cancel boolean;
  v_cards jsonb := '{}'::jsonb;
  v_net jsonb;
  s integer;
  r record;
  v_amt integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  v_dealer := (t.pub->>'dealer')::int;
  v_order := public._card_ints(t.pub->'order');
  v_left := public._card_ints(coalesce(t.pub->'left', '[]'::jsonb));
  v_in := array(select x from unnest(v_order) x where not (x = any(v_left)));
  v_lines := coalesce(t.pub->'lines', '[]'::jsonb);
  v_cancel := v_dealer = any(v_left);
  for r in select seat, cards from public.card_hands where room_id = p_room and game = 'xidach' and hand_no = t.hand_no loop
    v_cards := v_cards || jsonb_build_object(r.seat::text, to_jsonb(r.cards));
  end loop;

  if v_cancel then
    v_lines := '[]'::jsonb;
  else
    foreach s in array v_order loop
      continue when s <> v_dealer and coalesce((t.pub->'players'->(s::text)->>'inspected')::boolean, false);
      if s = any(v_left) then
        if s <> v_dealer then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('from', s, 'to', v_dealer, 'xu', t.stake, 'why', 'left'));
        end if;
      elsif public._xd_over(public._card_ints(v_cards->(s::text))) then
        v_lines := v_lines || public._xd_den_lang(s, v_in, t.stake);
      elsif s <> v_dealer and not public._xd_over(public._card_ints(v_cards->(v_dealer::text))) then
        v_line := public._xd_line(s, v_dealer, t.stake, public._card_ints(v_cards->(s::text)),
                                  public._card_ints(v_cards->(v_dealer::text)));
        if v_line is not null then
          v_lines := v_lines || jsonb_build_array(v_line);
        end if;
      end if;
    end loop;
  end if;

  v_net := (select coalesce(jsonb_object_agg(x::text,
                     coalesce((select sum((l->>'xu')::int) from jsonb_array_elements(v_lines) l where (l->>'to')::int = x), 0)
                   - coalesce((select sum((l->>'xu')::int) from jsonb_array_elements(v_lines) l where (l->>'from')::int = x), 0)),
                   '{}'::jsonb)
              from unnest(v_order) x);

  update public.card_tables
     set phase = 'result', turn = null, deadline = p_now + interval '10 seconds',
         last = jsonb_build_object(
           'hand_no', t.hand_no,
           'dealer', v_dealer,
           'cancelled', v_cancel,
           'hands', (select jsonb_object_agg(h.seat::text, jsonb_build_object(
                             'cards', to_jsonb(h.cards), 'kind', public._xd_kind(h.cards), 'points', public._xd_points(h.cards)))
                       from public.card_hands h where h.room_id = p_room and h.game = 'xidach' and h.hand_no = t.hand_no),
           'lines', v_lines,
           'net', v_net)
   where room_id = p_room and game = 'xidach';

  -- the payout: escrow + net for every seat, the wallets in account-id order; a loss beyond the wallet leaves it negative
  perform set_config('mt.allow_debt', 'on', true);
  for r in select account_id from public.card_seats where room_id = p_room and game = 'xidach' order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  for r in select seat, account_id, escrow from public.card_seats where room_id = p_room and game = 'xidach' order by seat loop
    v_amt := r.escrow + coalesce((v_net->>(r.seat::text))::int, 0);
    update public.card_seats set escrow = 0 where room_id = p_room and game = 'xidach' and seat = r.seat;
    if v_amt <> 0 then
      perform public._pay(r.account_id, v_amt, 'card_settle', public._card_ref('xidach', t.hand_no));
    end if;
  end loop;
  perform set_config('mt.allow_debt', 'off', true);
  perform public._card_log(p_room, 'xidach', t.hand_no, null, v_dealer, 'showdown', jsonb_build_object('lines', v_lines), p_now);
end $$;

-- 11. Chuyển lượt sau khi một ghế dằn (hoặc Quắc, đủ 5 lá, hết giờ): ghế kế tiếp chưa rời bàn; cái dằn thì kết thúc ván.
create or replace function public._xidach_advance(p_room uuid, p_seat integer, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  t public.card_tables;
  v_order integer[];
  v_left integer[];
  v_idx integer;
  v_next integer;
  v_dealer integer;
  i integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  v_dealer := (t.pub->>'dealer')::int;
  v_order := public._card_ints(t.pub->'order');
  v_left := public._card_ints(coalesce(t.pub->'left', '[]'::jsonb));
  update public.card_tables
     set pub = jsonb_set(pub, array['players', p_seat::text, 'standing'], 'true'::jsonb)
   where room_id = p_room and game = 'xidach';
  if p_seat = v_dealer then
    perform public._xidach_showdown(p_room, p_now);
    return;
  end if;
  for i in 1..cardinality(v_order) loop
    if v_order[i] = p_seat then
      v_idx := i;
      exit;
    end if;
  end loop;
  v_next := null;
  for i in coalesce(v_idx, 0) + 1..cardinality(v_order) loop
    if not (v_order[i] = any(v_left)) then
      v_next := v_order[i];
      exit;
    end if;
  end loop;
  update public.card_tables set turn = coalesce(v_next, v_dealer), deadline = p_now + interval '30 seconds'
   where room_id = p_room and game = 'xidach';
end $$;

-- 11a. Dằn bài: nhà con cần từ 16 điểm, cái từ 15 (Xì Bàng, Xì Dách, Ngũ Linh, Quắc luôn dằn được). Hết giờ thì dằn ép.
drop function if exists public._xidach_do_stand(uuid, integer, timestamptz);
create or replace function public._xidach_do_stand(p_room uuid, p_seat integer, p_now timestamptz, p_force boolean default false)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_hand integer[]; v_kind text;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  if t.phase <> 'playing' or t.turn is distinct from p_seat then
    return 'not your turn';
  end if;
  if not p_force then
    select cards into v_hand from public.card_hands where room_id = p_room and game = 'xidach' and seat = p_seat and hand_no = t.hand_no;
    v_kind := public._xd_kind(v_hand);
    if v_kind = 'du_tuoi'
       and public._xd_points(v_hand) < (case when p_seat = (t.pub->>'dealer')::int then 15 else 16 end) then
      return 'too few points';
    end if;
  end if;
  perform public._xidach_advance(p_room, p_seat, p_now);
  return null;
end $$;

-- 11c. Xét bài: tới lượt cái, cái từ 15 điểm (hoặc Quắc), xét một nhà con chưa xét, chưa rời bàn: so ngay, tiền đi luôn.
create or replace function public._xidach_do_inspect(p_room uuid, p_seat integer, p_target integer, p_now timestamptz) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_dealer integer; v_dcards integer[]; v_tcards integer[]; v_line jsonb; v_lines jsonb;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  v_dealer := (t.pub->>'dealer')::int;
  if t.phase <> 'playing' or t.turn is distinct from p_seat or p_seat <> v_dealer then
    return 'not your turn';
  end if;
  if p_target is null or p_target = v_dealer or not (p_target = any(public._card_ints(t.pub->'order')))
     or p_target = any(public._card_ints(coalesce(t.pub->'left', '[]'::jsonb)))
     or coalesce((t.pub->'players'->(p_target::text)->>'inspected')::boolean, false) then
    return 'invalid seat';
  end if;
  select cards into v_dcards from public.card_hands where room_id = p_room and game = 'xidach' and hand_no = t.hand_no and seat = v_dealer;
  if public._xd_kind(v_dcards) = 'du_tuoi' and public._xd_points(v_dcards) < 15 then
    return 'too few points';
  end if;
  -- a dealer past 28 pays the whole table at the showdown: no inspecting then
  if public._xd_over(v_dcards) then
    return 'over 28';
  end if;
  select cards into v_tcards from public.card_hands where room_id = p_room and game = 'xidach' and hand_no = t.hand_no and seat = p_target;
  if public._xd_over(v_tcards) then
    -- the inspected player is past 28: they pay everyone still in the hand (đền làng)
    v_lines := public._xd_den_lang(p_target,
                 array(select x from unnest(public._card_ints(t.pub->'order')) x
                        where not (x = any(public._card_ints(coalesce(t.pub->'left', '[]'::jsonb))))), t.stake);
  else
    v_line := public._xd_line(p_target, v_dealer, t.stake, v_tcards, v_dcards);
    v_lines := coalesce(jsonb_build_array(v_line), '[]'::jsonb);
  end if;
  -- the money moves at the showdown (escrow + net); the lines are recorded now
  update public.card_tables
     set pub = jsonb_set(jsonb_set(pub, array['players', p_target::text, 'inspected'], 'true'::jsonb),
                         '{lines}', coalesce(pub->'lines', '[]'::jsonb) || v_lines),
         deadline = p_now + interval '30 seconds'
   where room_id = p_room and game = 'xidach';
  -- every player inspected: the hand ends
  if not exists (select 1 from unnest(public._card_ints(t.pub->'order')) x
                  where x <> v_dealer and x <> p_target
                    and not (x = any(public._card_ints(coalesce(t.pub->'left', '[]'::jsonb))))
                    and not coalesce((t.pub->'players'->(x::text)->>'inspected')::boolean, false)) then
    perform public._xidach_showdown(p_room, p_now);
  end if;
  return null;
end $$;

revoke all on function public._xidach_advance(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._xidach_do_stand(uuid, integer, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public._xidach_do_inspect(uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._xidach_showdown(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._xidach_do_hit(uuid, integer, timestamptz) from public, anon, authenticated;

-- 11b. Rời bàn giữa ván (§6.3): ghế được đánh dấu leaving, vào pub.left và coi như đã dằn; cái rời hoặc không còn nhà con
-- nào thì ván kết thúc ngay; đang tới lượt người rời thì lượt chuyển sang người kế tiếp. Tiền giữ được trả ở showdown.
create or replace function public._xidach_leave(p_room uuid, p_seats integer[], p_how text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  t public.card_tables;
  v_pub jsonb;
  s integer;
  v_dealer integer;
  v_order integer[];
  v_left integer[];
  v_idx integer;
  v_next integer;
  i integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  v_pub := t.pub;
  v_dealer := (v_pub->>'dealer')::int;
  foreach s in array p_seats loop
    update public.card_seats set leaving = true where room_id = p_room and game = 'xidach' and seat = s;
    v_pub := jsonb_set(v_pub, '{left}', coalesce(v_pub->'left', '[]'::jsonb) || to_jsonb(s));
    if v_pub->'players' ? s::text then
      v_pub := jsonb_set(v_pub, array['players', s::text, 'standing'], 'true'::jsonb);
    end if;
    perform public._card_log(p_room, 'xidach', t.hand_no,
                             (select account_id from public.card_seats where room_id = p_room and game = 'xidach' and seat = s),
                             s, 'leave', jsonb_build_object('how', p_how), p_now);
  end loop;
  update public.card_tables set pub = v_pub where room_id = p_room and game = 'xidach';

  v_order := public._card_ints(v_pub->'order');
  v_left := public._card_ints(v_pub->'left');
  if v_dealer = any(p_seats)
     or not exists (select 1 from unnest(v_order) x where x <> v_dealer and not (x = any(v_left))) then
    perform public._xidach_showdown(p_room, p_now);
    return;
  end if;

  if t.turn = any(p_seats) then
    for i in 1..cardinality(v_order) loop
      if v_order[i] = t.turn then
        v_idx := i;
        exit;
      end if;
    end loop;
    for i in v_idx + 1..cardinality(v_order) loop
      if not (v_order[i] = any(v_left)) then
        v_next := v_order[i];
        exit;
      end if;
    end loop;
    update public.card_tables set turn = coalesce(v_next, v_dealer), deadline = p_now + interval '30 seconds'
     where room_id = p_room and game = 'xidach';
  end if;
end $$;
revoke all on function public._xidach_leave(uuid, integer[], text, timestamptz) from public, anon, authenticated;

create or replace function public._card_leave_live(p_room uuid, p_game text, p_seats integer[], p_how text, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._card_lock_wallets(p_room, p_game);
  if p_game = 'tienlen' then
    perform public._tl_leave(p_room, p_seats, p_how, p_now);
  elsif p_game = 'cao' then
    perform public._cao_leave(p_room, p_seats, p_how, p_now);
  elsif p_game = 'poker' then
    perform public._pk_leave(p_room, p_seats, p_how, p_now);
  elsif p_game = 'xidach' then
    perform public._xidach_leave(p_room, p_seats, p_how, p_now);
  end if;
end $$;

-- 12. Hook vào _card_action và _card_due
create or replace function public._card_due(p_room uuid, p_game text, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_game = 'tienlen' then
    return public._tl_due(p_room, p_now, p_deck);
  elsif p_game = 'cao' then
    return public._cao_due(p_room, p_now, p_deck);
  elsif p_game = 'poker' then
    return public._pk_due(p_room, p_now, p_deck);
  elsif p_game = 'xidach' then
    return public._xidach_due(p_room, p_now, p_deck);
  end if;
  return false;
end $$;

create or replace function public._xidach_due(p_room uuid, p_now timestamptz, p_deck integer[] default null) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  if t.phase = 'countdown' then
    perform public._xidach_start(p_room, p_now, p_deck);
    return true;
  elsif t.phase = 'playing' then
    -- the turn ran out: the seat stands as it is
    perform public._xidach_do_stand(p_room, t.turn, p_now, true);
    return true;
  elsif t.phase = 'result' then
    delete from public.card_seats where room_id = p_room and game = 'xidach' and leaving;
    update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
     where room_id = p_room and game = 'xidach';
    perform public._card_ready(p_room, 'xidach', p_now);
    return true;
  end if;
  return false;
end $$;

-- Cập nhật _card_action nhận xidach
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
  -- readiness is not a move in the hand: it never fails as stale when someone else readied first
  if p_kind <> 'xidach_ready' and p_seq is distinct from (select seq from public.card_tables where room_id = p_room and game = p_game) then
    raise exception 'stale' using errcode = '22023';
  end if;
  if p_kind = 'tl_play' then
    v_err := public._tl_do_play(p_room, v_seat, public._card_ints(p_args->'cards'), p_now);
  elsif p_kind = 'tl_pass' then
    v_err := public._tl_do_pass(p_room, v_seat, p_now);
  elsif p_kind = 'cao_deal' then
    v_err := public._cao_do_deal(p_room, v_seat, p_now, p_deck);
  elsif p_kind = 'pk_act' then
    v_err := public._pk_do_act(p_room, v_seat, p_args->>'action', (p_args->>'amount')::int, p_now);
  elsif p_kind = 'xidach_hit' then
    v_err := public._xidach_do_hit(p_room, v_seat, p_now);
  elsif p_kind = 'xidach_stand' then
    v_err := public._xidach_do_stand(p_room, v_seat, p_now);
  elsif p_kind = 'xidach_ready' then
    v_err := public._xidach_do_ready(p_room, v_seat, p_now);
  elsif p_kind = 'xidach_inspect' then
    v_err := public._xidach_do_inspect(p_room, v_seat, (p_args->>'seat')::int, p_now);
  elsif p_kind = 'xidach_deal' then
    -- the deal is automatic after the countdown; a deal button only counts before it
    v_err := case when (select phase from public.card_tables where room_id = p_room and game = p_game) = 'countdown'
                  then null else 'not dealer' end;
    if v_err is null then
      perform public._xidach_start(p_room, p_now, p_deck);
    end if;
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

-- 13. Sẵn sàng: bàn Xì Dách không tự bắt đầu. Mỗi người ngồi bấm Sẵn sàng (pub.ready); đủ ít nhất 2 người và tất cả
-- đều sẵn sàng thì đếm ngược 3 giây rồi chia. Ai bỏ sẵn sàng, hoặc có người mới ngồi, thì quay về chờ. Hết ván thì mọi
-- người phải sẵn sàng lại. Các bàn khác giữ nguyên như 0017.
create or replace function public._card_ready(p_room uuid, p_game text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; n integer; v_all boolean; v_ready jsonb;
begin
  select * into t from public.card_tables where room_id = p_room and game = p_game;
  n := (select count(*) from public.card_seats where room_id = p_room and game = p_game and not leaving);
  if p_game = 'xidach' then
    if t.phase not in ('idle', 'countdown') then
      return;
    end if;
    -- only the seats still there count as ready
    v_ready := coalesce((select jsonb_agg(x order by x) from jsonb_array_elements(coalesce(t.pub->'ready', '[]'::jsonb)) e(x)
                          where exists (select 1 from public.card_seats s where s.room_id = p_room and s.game = 'xidach'
                                          and not s.leaving and s.seat = x::int)), '[]'::jsonb);
    v_all := n >= 2 and jsonb_array_length(v_ready) = n;
    if t.phase = 'idle' and v_all then
      update public.card_tables set phase = 'countdown', turn = null, deadline = p_now + interval '3 seconds',
                                    pub = jsonb_build_object('ready', v_ready)
       where room_id = p_room and game = p_game;
    elsif t.phase = 'countdown' and not v_all then
      update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = jsonb_build_object('ready', v_ready)
       where room_id = p_room and game = p_game;
    elsif t.pub->'ready' is distinct from v_ready then
      update public.card_tables set pub = jsonb_set(coalesce(pub, '{}'::jsonb), '{ready}', v_ready)
       where room_id = p_room and game = p_game;
    end if;
    return;
  end if;
  if t.phase = 'idle' and n >= 2 and p_game = 'cao' then
    perform public._cao_start(p_room, p_now);
  elsif t.phase = 'idle' and n >= 2 then
    update public.card_tables
       set phase = 'countdown', turn = null, pub = '{}'::jsonb,
           deadline = p_now + case p_game when 'tienlen' then interval '8 seconds' else interval '5 seconds' end
     where room_id = p_room and game = p_game;
  elsif t.phase in ('countdown', 'deal_wait') and n < 2 then
    update public.card_tables set phase = 'idle', deadline = null, turn = null, pub = '{}'::jsonb
     where room_id = p_room and game = p_game;
  elsif t.phase = 'deal_wait'
        and not exists (select 1 from public.card_seats where room_id = p_room and game = p_game and not leaving
                         and seat = (t.pub->>'dealer')::int) then
    perform public._cao_start(p_room, p_now);
  end if;
end $$;

-- Bấm Sẵn sàng / Bỏ sẵn sàng (chỉ khi bàn đang chờ hoặc đếm ngược).
create or replace function public._xidach_do_ready(p_room uuid, p_seat integer, p_now timestamptz) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_ready jsonb;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  if t.phase not in ('idle', 'countdown') then
    return 'hand running';
  end if;
  v_ready := coalesce(t.pub->'ready', '[]'::jsonb);
  if v_ready @> to_jsonb(p_seat) then
    v_ready := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_ready) e(x) where x::int <> p_seat), '[]'::jsonb);
  else
    v_ready := v_ready || to_jsonb(p_seat);
  end if;
  update public.card_tables set pub = jsonb_set(coalesce(pub, '{}'::jsonb), '{ready}', v_ready)
   where room_id = p_room and game = 'xidach';
  perform public._card_ready(p_room, 'xidach', p_now);
  return null;
end $$;
revoke all on function public._xidach_do_ready(uuid, integer, timestamptz) from public, anon, authenticated;

create or replace function public.xidach_ready(p_room_id uuid, p_session_token text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  -- readiness is not a move in the hand: it never fails as stale when someone else readied first
  return public._card_action(p_room_id, v_account, 'xidach', 'xidach_ready', p_seq, '{}'::jsonb, now());
end $$;
grant execute on function public.xidach_ready(uuid, text, integer) to anon, authenticated;

-- 14. Nợ xu: đền làng có thể trừ ví xuống âm. Ràng buộc coins >= 0 được thay bằng trigger chặn mọi lần làm ví âm
-- thêm (cùng mã lỗi 23514 như trước), trừ khi showdown Xì Dách bật mt.allow_debt trong giao dịch của nó. Ví đang âm
-- vẫn được cộng tiền (nhận xu, bán cá…), chỉ không trừ thêm được; không đủ 2 cược thì không ngồi được bàn.
alter table public.wallets drop constraint if exists wallets_coins_check;
create or replace function public._wallet_no_overdraft() returns trigger
language plpgsql set search_path = public, extensions
as $$
begin
  if new.coins < 0 and (tg_op = 'INSERT' or new.coins < old.coins)
     and coalesce(current_setting('mt.allow_debt', true), '') <> 'on' then
    raise exception 'new row for relation "wallets" violates check constraint "wallets_coins_check"' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public._wallet_no_overdraft() from public, anon, authenticated;
drop trigger if exists wallets_no_overdraft on public.wallets;
create trigger wallets_no_overdraft before insert or update of coins on public.wallets
  for each row execute function public._wallet_no_overdraft();

-- Reset ngay bàn xidach hiện tại về idle để bắt đầu ván mới chuẩn chia bài
update public.card_tables
   set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
 where game = 'xidach';
delete from public.card_hands where game = 'xidach';
delete from public.card_secrets where game = 'xidach';

-- RPC ngoài
create or replace function public.xidach_deal(p_room_id uuid, p_session_token text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._card_action(p_room_id, v_account, 'xidach', 'xidach_deal', p_seq, '{}'::jsonb, now());
end $$;
grant execute on function public.xidach_deal(uuid, text, integer) to anon, authenticated;

create or replace function public.xidach_hit(p_room_id uuid, p_session_token text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._card_action(p_room_id, v_account, 'xidach', 'xidach_hit', p_seq, '{}'::jsonb, now());
end $$;
grant execute on function public.xidach_hit(uuid, text, integer) to anon, authenticated;

create or replace function public.xidach_stand(p_room_id uuid, p_session_token text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._card_action(p_room_id, v_account, 'xidach', 'xidach_stand', p_seq, '{}'::jsonb, now());
end $$;
grant execute on function public.xidach_stand(uuid, text, integer) to anon, authenticated;

create or replace function public.xidach_inspect(p_room_id uuid, p_session_token text, p_seq integer, p_seat integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._card_action(p_room_id, v_account, 'xidach', 'xidach_inspect', p_seq, jsonb_build_object('seat', p_seat), now());
end $$;
grant execute on function public.xidach_inspect(uuid, text, integer, integer) to anon, authenticated;
