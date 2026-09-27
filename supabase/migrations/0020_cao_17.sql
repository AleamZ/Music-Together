-- =========================================================
-- 0020_cao_17.sql — Chiếu Cào 17 người chơi (docs/superpowers/specs/2026-09-25-music-together-v16-cards-design.md)
-- Nâng số ghế tối đa của Chiếu Cào từ 6 lên 17 người (51/52 lá bài).
-- ADDITIVE và an toàn khi chạy lại nhiều lần (re-runnable).
-- =========================================================

-- 1. Nới rộng check constraint cho số ghế (seat) trên bảng card_seats lên tối đa 17
alter table public.card_seats drop constraint if exists card_seats_seat_check;
alter table public.card_seats add constraint card_seats_seat_check check (seat between 1 and 17);

-- 2. Cập nhật hàm _card_max: Chiếu Cào nhận tối đa 17 người
create or replace function public._card_max(p_game text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_game when 'tienlen' then 4 when 'cao' then 17 when 'poker' then 6 when 'xidach' then 8 end $$;

-- 3. Cập nhật card_lobby để trả về max mới
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
grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
