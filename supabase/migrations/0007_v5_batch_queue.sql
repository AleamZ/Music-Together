-- =========================================================
-- 0007_v5_batch_queue.sql — v5: batch add queue items (playlist add). ADDITIVE (no data drop).
-- =========================================================

-- Insert many queue items in one call (member-only). p_items: jsonb array of
-- { video_id, title, thumb }. Skips elements without video_id; caps at 50.
-- Returns the number of rows inserted. Positions continue after the room's current max.
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid; v_name text; v_base double precision; v_idx int := 0; v_count int := 0; v_item jsonb;
begin
  perform public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    if coalesce(v_item->>'video_id', '') = '' then continue; end if;
    v_idx := v_idx + 1;
    insert into public.queue_items
      (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position)
    values (
      p_room_id,
      v_item->>'video_id',
      coalesce(nullif(v_item->>'title', ''), v_item->>'video_id'),
      nullif(v_item->>'thumb', ''),
      null,
      v_account, v_name,
      v_base + v_idx
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.add_queue_items(uuid,text,jsonb) to anon, authenticated;
