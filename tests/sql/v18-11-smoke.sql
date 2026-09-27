-- tests/sql/v18-11-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0030 (see the plan),
-- from the repo root: it re-runs 0032 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0032_news.sql
reset client_min_messages;
-- the dev blog is global: start from none (throwaway cluster only)
delete from public.news_posts;

create temp table nw (who text, acct_id uuid, tok text);
insert into nw (who, acct_id, tok)
  select 'root', public._auth_account(token), token from public.register('nwr_' || floor(random() * 1e9)::text, 'pw123456');
insert into nw (who, acct_id, tok)
  select 'pl', public._auth_account(token), token from public.register('nwp_' || floor(random() * 1e9)::text, 'pw123456');
update public.accounts set is_root = true where id = (select acct_id from nw where who = 'root');
create temp table nw_room (room_id uuid);
insert into nw_room select room_id from public.create_room('news room', 'pw', (select tok from nw where who = 'pl'));
do $$ declare r uuid := (select room_id from nw_room);
  c text := (select code from public.rooms where id = (select room_id from nw_room)); begin
  perform public.join_room(c, 'pw', (select tok from nw where who = 'root'));
end $$;

-- 1) grants: readers and admin RPCs granted, helpers private
do $$ begin
  assert has_function_privilege('anon', 'public.news_feed(uuid,text)', 'execute'), 'news_feed granted';
  assert has_function_privilege('anon', 'public.news_mark_read(uuid,text,text)', 'execute'), 'mark_read granted';
  assert has_function_privilege('anon', 'public.news_post_upsert(text,uuid,text,text,text,boolean)', 'execute'), 'upsert granted';
  assert not has_function_privilege('anon', 'public._news_event(uuid,text,text,jsonb)', 'execute'), '_news_event private';
  assert not has_function_privilege('authenticated', 'public._news_event(uuid,text,text,jsonb)', 'execute'), '_news_event private 2';
  assert not has_function_privilege('anon', 'public._card_settle(uuid,text)', 'execute'), '_card_settle private';
end $$;

-- 2) an empty feed
do $$ declare j jsonb := public.news_feed((select room_id from nw_room), (select tok from nw where who = 'pl')); begin
  assert j->'posts' = '[]'::jsonb and j->'events' = '[]'::jsonb and j->'popup' = '[]'::jsonb, 'empty feed';
  assert (j->'unread'->>'posts')::int = 0 and (j->'unread'->>'events')::int = 0, 'nothing unread';
end $$;

-- 3) only root writes posts
do $$ declare ok boolean := false; begin
  begin perform public.news_post_upsert((select tok from nw where who = 'pl'), null, 'x', null, 'y', false);
  exception when others then ok := sqlerrm = 'root role required'; end;
  assert ok, 'player cannot post';
  ok := false;
  begin perform public.news_post_upsert((select tok from nw where who = 'root'), null, '   ', null, 'y', false);
  exception when others then ok := sqlerrm = 'invalid title'; end;
  assert ok, 'blank title refused';
end $$;

-- 4) a post: in the feed, unread, in the popup; an old post is in the feed but never pops up
do $$ declare t text := (select tok from nw where who = 'root'); r uuid := (select room_id from nw_room); j jsonb; p jsonb; begin
  p := public.news_post_upsert(t, null, 'Bản cập nhật cũ', '🛠️', 'cũ', false);
  update public.news_posts set created_at = now() - interval '25 hours' where id = (p->>'id')::uuid;
  p := public.news_post_upsert(t, null, 'Chào làng', null, '# Tin\n**đậm**', false);
  assert p->>'emoji' = '📢', 'default emoji';
  j := public.news_feed(r, (select tok from nw where who = 'pl'));
  assert jsonb_array_length(j->'posts') = 2, 'two posts';
  assert (j->'unread'->>'posts')::int = 2, 'two unread';
  assert jsonb_array_length(j->'popup') = 1 and j->'popup'->0->>'title' = 'Chào làng', 'only the fresh post pops up';
  -- edit + pin
  p := public.news_post_upsert(t, (p->>'id')::uuid, 'Chào làng!', '🎉', 'mới', true);
  assert p->>'pinned' = 'true' and p->>'title' = 'Chào làng!', 'edited';
  j := public.news_feed(r, (select tok from nw where who = 'pl'));
  assert j->'posts'->0->>'title' = 'Chào làng!', 'pinned first';
  assert jsonb_array_length(public.news_admin_list(t)) = 2, 'admin list';
end $$;

-- 5) seen: the marker clears the popup and the unread count, per viewer
do $$ declare r uuid := (select room_id from nw_room); j jsonb; begin
  perform public.news_mark_read(r, (select tok from nw where who = 'pl'), 'posts');
  j := public.news_feed(r, (select tok from nw where who = 'pl'));
  assert j->'popup' = '[]'::jsonb and (j->'unread'->>'posts')::int = 0, 'seen';
  j := public.news_feed(r, (select tok from nw where who = 'root'));
  assert jsonb_array_length(j->'popup') = 1, 'other viewer still unseen';
end $$;

-- 6) the hooks: a car, a legendary catch (not a rare one), a ban, a big card win
do $$ declare a uuid := (select acct_id from nw where who = 'pl'); r uuid := (select room_id from nw_room);
  sp5 text := (select id from public.fish_species where rarity = 5 limit 1);
  sp3 text := (select id from public.fish_species where rarity = 3 limit 1); n int; begin
  update public.members set last_seen_at = now() where account_id = a and room_id = r;
  insert into public.owned_vehicles (account_id, vehicle_id) values (a, 'bike');
  assert (select count(*) from public.news_events where room_id = r) = 0, 'a bike is not news';
  insert into public.owned_vehicles (account_id, vehicle_id) values (a, 'car');
  assert (select count(*) from public.news_events where room_id = r and kind = 'car') = 1, 'car news';
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
  values (r, null, 'Ao cá', format('[catch:%s|%s|%s] 🎣 x', a, sp3, 1200), true, a);
  assert (select count(*) from public.news_events where room_id = r and kind = 'fish_legend') = 0, 'rare is not news';
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
  values (r, null, 'Ao cá', format('[catch:%s|%s|%s] 🎣 x', a, sp5, 5400), true, a);
  assert (select count(*) from public.news_events where room_id = r and kind = 'fish_legend') = 1, 'legend news';
  assert (select text from public.news_events where kind = 'fish_legend' and room_id = r) like '%Huyền thoại%', 'legend text';
  insert into public.anticheat_status (account_id) values (a) on conflict do nothing;
  update public.anticheat_status set ban_state = 'pending_wipe', banned_at = now() where account_id = a;
  assert (select text from public.news_events where room_id = r and kind = 'ban') like 'Cảnh sát tóm được%'
      or (select text from public.news_events where room_id = r and kind = 'ban') like '%Cảnh sát tóm được%', 'ban news';
  update public.anticheat_status set ban_state = null where account_id = a;
  -- card: stake 1000, held 1000, balance 7000 at the settle -> net 6000 >= max(5000, 5000)
  perform public._wallet_lock(a);
  perform public._pay(a, 3000, 'daily', 'seed');
  perform public._card_init(r);
  update public.card_tables set stake = 1000, hand_no = 1 where room_id = r and game = 'cao';
  perform public._pay(a, -1000, 'card_hold', public._card_ref('cao', 1));
  insert into public.card_seats (room_id, game, seat, account_id, chips, escrow, seen_at, sat_at)
  values (r, 'cao', 1, a, 0, 7000, now(), now());
  perform public._card_settle(r, 'cao');
  assert (select count(*) from public.news_events where room_id = r and kind = 'card_win') = 1, 'card news';
  assert (select escrow from public.card_seats where room_id = r and game = 'cao' and seat = 1) = 0, 'still paid out';
  -- a small win is not news
  update public.card_tables set hand_no = 2 where room_id = r and game = 'cao';
  perform public._pay(a, -1000, 'card_hold', public._card_ref('cao', 2));
  update public.card_seats set escrow = 3000 where room_id = r and game = 'cao' and seat = 1;
  perform public._card_settle(r, 'cao');
  assert (select count(*) from public.news_events where room_id = r and kind = 'card_win') = 1, 'small win is not news';
end $$;

-- 7) events unread per room, then read
do $$ declare r uuid := (select room_id from nw_room); t text := (select tok from nw where who = 'pl'); j jsonb; begin
  j := public.news_feed(r, t);
  assert (j->'unread'->>'events')::int = 4, 'four events unread: ' || (j->'unread'->>'events');
  assert jsonb_array_length(j->'events') = 4, 'four events';
  perform public.news_mark_read(r, t, 'events');
  j := public.news_feed(r, t);
  assert (j->'unread'->>'events')::int = 0, 'events read';
  begin perform public.news_mark_read(r, t, 'nope'); assert false, 'bad kind accepted';
  exception when others then assert sqlerrm = 'invalid kind', sqlerrm; end;
end $$;

-- 8) the trim: 300 per room
do $$ declare r uuid := (select room_id from nw_room); i int; begin
  for i in 1..310 loop perform public._news_event(r, 'test', 'tin ' || i, null); end loop;
  assert (select count(*) from public.news_events where room_id = r) = 300, 'trimmed to 300';
  assert (select text from public.news_events where room_id = r order by id desc limit 1) = 'tin 310', 'newest kept';
  perform public._news_event(null, 'test', 'x', null);
end $$;

-- 9) delete
do $$ declare t text := (select tok from nw where who = 'root'); id uuid := (select id from public.news_posts limit 1); ok boolean := false; begin
  perform public.news_post_delete(t, id);
  begin perform public.news_post_delete(t, id); exception when others then ok := sqlerrm = 'post not found'; end;
  assert ok, 'delete twice';
end $$;
\echo v18.11 smoke ok
