-- =========================================================
-- 0114_story_quests.sql — "Chuyện làng Sông Nhạc": the newbie story chain (spec
-- docs/superpowers/specs/2026-09-30-story-quests-design.md). ADDITIVE and re-runnable. Run after 0112 (0113 is another
-- change's; nothing here depends on it).
--   A. story_npcs: the givers, where they stand (the interactable's `use` point, lib/game/story/npcs.ts pins the same
--      numbers) and how near one must be. story_quests: the chain (chapter, giver, the NPC one hands it in to, the
--      objective kind and goal, the reward). story_progress: accepted_at / turned_in_at per account and step; `paid`
--      false = closed by this migration for a veteran (no reward was paid).
--   B. Progress is never written by the client and never by a counter: _story_count reads what the server already
--      recorded since the step was accepted — game_events 'fish_catch' (catch), coin_ledger 'buy' rows of a bait item
--      (buy_bait: buy_item's ref "bait_… xN"), coin_ledger 'sell' rows paid at cô Ba (ref "N con") or at Vựa cá Chợ Lớn
--      (ref "N con (Chợ Lớn)"), the story's own letter read or claimed (mail), farm_profiles.gift_at (farm_gift).
--      'talk' steps are done by reaching the NPC they are handed in to. So no gameplay function is re-created.
--   C. RPCs: story_state(token) (a read), story_accept(token, quest) (guarded; the step must be the next one and no other
--      open; accepting the mailbox step sends the letter), story_turn_in(token, quest, x, y) (guarded; the server's
--      position must be beside the step's turn-in NPC — _pos_claim, then the distance, as 0071's _quest_at_giver; pays
--      _pay 'quest_reward' ref 'story:<id>', an 'xp_grant' event (meta source 'story') and the small item).
--   D. Old players: an account that already handed in bác Ba's first old quest (n_lang_1) or has landed ≥ 10 fish is a
--      veteran: every step is closed for it with paid = false (nothing is re-rewarded, the tracker shows the chain done).
--      The old 'npc' chains of 0071 stay in the quest log unchanged.
-- Lock order: player_pos → story_progress → wallets.
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.story_npcs (
  id text primary key,
  name text not null,
  map text not null,
  x integer not null,
  y integer not null,
  reach integer not null default 72
);
alter table public.story_npcs enable row level security;
revoke all on public.story_npcs from anon, authenticated;

insert into public.story_npcs (id, name, map, x, y, reach) values
  ('bac_ba_lang', 'bác Ba Làng', 'hall',   368, 222, 72),
  ('co_ba',       'cô Ba',       'pond',   570, 140, 72),
  ('chu_tu',      'chú Tư',      'pond',   576, 308, 72),
  ('anh_hai',     'anh Hai',     'field',  630, 344, 72),
  ('chu_hai_ca',  'chú Hai',     'market',  80, 360, 72)
on conflict (id) do update set name = excluded.name, map = excluded.map, x = excluded.x, y = excluded.y, reach = excluded.reach;

create table if not exists public.story_quests (
  id text primary key,
  chapter smallint not null,
  sort smallint not null unique,
  title text not null,
  objective text not null,
  giver text not null references public.story_npcs(id),
  turnin text not null references public.story_npcs(id),
  kind text not null check (kind in ('talk', 'catch', 'buy_bait', 'sell_pond', 'sell_market', 'mail', 'farm_gift')),
  goal integer not null default 1 check (goal between 1 and 100),
  reward_coins integer not null default 0 check (reward_coins between 0 and 200),
  reward_xp integer not null default 0 check (reward_xp between 0 and 200),
  reward_item text null references public.shop_items(id),
  reward_qty integer not null default 0 check (reward_qty between 0 and 10),
  needs text null references public.story_quests(id)
);
alter table public.story_quests enable row level security;
revoke all on public.story_quests from anon, authenticated;

insert into public.story_quests (id, chapter, sort, title, objective, giver, turnin, kind, goal, reward_coins, reward_xp, reward_item, reward_qty, needs) values
  ('s01_chao',  1,  1, 'Chào làng',          'Xuống Ao cá chào cô Ba.',                          'bac_ba_lang', 'co_ba',       'talk',        1, 20, 20, null,           0, null),
  ('s02_can',   2,  2, 'Cần câu đầu tiên',   'Ghé tiệm chú Tư nhận cần gỗ.',                     'co_ba',       'chu_tu',      'talk',        1, 20, 20, null,           0, 's01_chao'),
  ('s03_moi',   2,  3, 'Mua mồi',            'Mua một ít mồi ở tiệm chú Tư.',                    'chu_tu',      'chu_tu',      'buy_bait',    1, 20, 20, 'gb_cam',       2, 's02_can'),
  ('s04_cau',   2,  4, 'Con cá đầu tiên',    'Câu được 1 con cá rồi mang cho cô Ba xem.',        'chu_tu',      'co_ba',       'catch',       1, 30, 30, null,           0, 's03_moi'),
  ('s05_ban',   3,  5, 'Bán cá cho cô Ba',   'Bán cá ở Vựa cá của cô Ba.',                       'co_ba',       'co_ba',       'sell_pond',   1, 30, 30, 'bucket_small', 1, 's04_cau'),
  ('s06_xo',    3,  6, 'Xô đầy cá',          'Câu thêm 3 con cá (xô chứa được nhiều hơn).',      'co_ba',       'co_ba',       'catch',       3, 30, 40, null,           0, 's05_ban'),
  ('s07_thu',   4,  7, 'Lá thư của bác Ba',  'Mở Hòm thư (📬) đọc thư bác Ba gửi.',              'bac_ba_lang', 'bac_ba_lang', 'mail',        1, 30, 30, null,           0, 's06_xo'),
  ('s08_dong',  5,  8, 'Ra đồng',            'Ra Đồng ruộng gặp anh Hai.',                       'bac_ba_lang', 'anh_hai',     'talk',        1, 20, 30, null,           0, 's07_thu'),
  ('s09_qua',   5,  9, 'Quà nhà nông',       'Nhận quà tân nông (giống lúa, phân bón) từ anh Hai.', 'anh_hai',     'anh_hai',     'farm_gift',   1, 30, 40, null,           0, 's08_dong'),
  ('s10_cho',   6, 10, 'Lên Chợ Lớn',        'Bán cá ở Vựa cá Chợ Lớn cho chú Hai.',             'anh_hai',     'chu_hai_ca',  'sell_market', 1, 50, 50, null,           0, 's09_qua'),
  ('s11_ve',    6, 11, 'Người làng thứ thiệt','Về Sảnh báo tin cho bác Ba Làng.',                'chu_hai_ca',  'bac_ba_lang', 'talk',        1, 50, 60, null,           0, 's10_cho')
on conflict (id) do update set chapter = excluded.chapter, sort = excluded.sort, title = excluded.title,
  objective = excluded.objective, giver = excluded.giver, turnin = excluded.turnin, kind = excluded.kind, goal = excluded.goal,
  reward_coins = excluded.reward_coins, reward_xp = excluded.reward_xp, reward_item = excluded.reward_item,
  reward_qty = excluded.reward_qty, needs = excluded.needs;

create table if not exists public.story_progress (
  account_id uuid not null references public.accounts(id) on delete cascade,
  quest_id text not null references public.story_quests(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  turned_in_at timestamptz null,
  paid boolean not null default true,
  primary key (account_id, quest_id)
);
alter table public.story_progress enable row level security;
revoke all on public.story_progress from anon, authenticated;

-- ---------- B. Progress (read from what the server recorded) ----------
create or replace function public._story_count(p_account uuid, p_quest text, p_since timestamptz) returns integer
language plpgsql stable security definer set search_path = public, extensions as $$
declare d public.story_quests;
begin
  select * into d from public.story_quests where id = p_quest;
  if not found or p_since is null then return 0; end if;
  return least(d.goal, case d.kind
    when 'talk' then d.goal
    when 'catch' then (select count(*) from public.game_events e
                        where e.account_id = p_account and e.kind = 'fish_catch' and e.created_at >= p_since)
    when 'buy_bait' then (select count(*) from public.coin_ledger l
                           where l.account_id = p_account and l.reason = 'buy' and l.delta < 0 and l.created_at >= p_since
                             and l.ref like 'bait\_%')
    when 'sell_pond' then (select count(*) from public.coin_ledger l
                            where l.account_id = p_account and l.reason = 'sell' and l.delta > 0 and l.created_at >= p_since
                              and l.ref ~ '^[0-9]+ con$')
    when 'sell_market' then (select count(*) from public.coin_ledger l
                              where l.account_id = p_account and l.reason = 'sell' and l.delta > 0 and l.created_at >= p_since
                                and l.ref ~ '^[0-9]+ con \(Chợ Lớn\)$')
    when 'mail' then (select count(*) from public.mail m
                       where m.account_id = p_account and m.ref = 'story:' || d.id
                         and (m.read_at is not null or m.claimed_at is not null))
    when 'farm_gift' then (select count(*) from public.farm_profiles f where f.account_id = p_account and f.gift_at is not null)
    else 0 end)::integer;
end $$;
revoke all on function public._story_count(uuid, text, timestamptz) from public, anon, authenticated;

-- status: locked (an earlier step first), available (accept it at the giver), active, done (hand it in), claimed.
create or replace function public._story_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare d public.story_quests; p public.story_progress; v_list jsonb := '[]'::jsonb; v_st text; v_n integer;
        v_cur text; v_open boolean := false; v_all boolean := true; v_vet boolean := false;
begin
  v_open := exists (select 1 from public.story_progress where account_id = p_account and turned_in_at is null);
  for d in select * from public.story_quests order by sort loop
    select * into p from public.story_progress where account_id = p_account and quest_id = d.id;
    v_n := case when p.account_id is null then 0 when p.turned_in_at is not null then d.goal
                else public._story_count(p_account, d.id, p.accepted_at) end;
    v_st := case when p.turned_in_at is not null then 'claimed'
                 when p.account_id is not null and v_n >= d.goal then 'done'
                 when p.account_id is not null then 'active'
                 when not v_open and (d.needs is null or exists (select 1 from public.story_progress x where x.account_id = p_account
                                                               and x.quest_id = d.needs and x.turned_in_at is not null)) then 'available'
                 else 'locked' end;
    if v_st <> 'claimed' then v_all := false; end if;
    if v_cur is null and v_st in ('available', 'active', 'done') then v_cur := d.id; end if;
    if p.account_id is not null and not p.paid then v_vet := true; end if;
    v_list := v_list || jsonb_build_object('id', d.id, 'chapter', d.chapter, 'title', d.title, 'objective', d.objective,
      'giver', d.giver, 'turnin', d.turnin, 'kind', d.kind, 'goal', d.goal, 'progress', v_n, 'status', v_st,
      'coins', d.reward_coins, 'xp', d.reward_xp, 'item', d.reward_item, 'item_qty', d.reward_qty);
  end loop;
  return jsonb_build_object('quests', v_list, 'current', v_cur, 'finished', v_all, 'veteran', v_vet,
    'npcs', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'map', n.map, 'x', n.x, 'y', n.y,
                                                          'reach', n.reach) order by n.id), '[]') from public.story_npcs n));
end $$;
revoke all on function public._story_state(uuid) from public, anon, authenticated;

-- ---------- C. RPCs ----------
create or replace function public.story_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public._story_state(public._auth_account(p_session_token));
end $$;
revoke all on function public.story_state(text) from public;
grant execute on function public.story_state(text) to anon, authenticated;

-- Accept the next step (anywhere: the dialogue with the giver is the client's; only the hand-in pays, and it is
-- position-checked). The mailbox step sends its letter (two bags of thính, once: the progress row is the key).
create or replace function public.story_accept(p_session_token text, p_quest text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); d public.story_quests; v_mail bigint;
begin
  select * into d from public.story_quests where id = p_quest;
  if not found then raise exception 'unknown quest' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('story:' || v_account::text));          -- one accept at a time per account
  if exists (select 1 from public.story_progress where account_id = v_account and quest_id = d.id) then
    raise exception 'already accepted' using errcode = '22023';
  end if;
  if exists (select 1 from public.story_progress where account_id = v_account and turned_in_at is null) then
    raise exception 'story busy' using errcode = '22023';
  end if;
  if d.needs is not null and not exists (select 1 from public.story_progress where account_id = v_account
                                           and quest_id = d.needs and turned_in_at is not null) then
    raise exception 'quest locked' using errcode = '22023';
  end if;
  insert into public.story_progress (account_id, quest_id) values (v_account, d.id);
  if d.kind = 'mail' then
    v_mail := public._mail_new(v_account, 'system', null, 'gift', '📜 Thư của bác Ba Làng',
      'Chào cháu! Làng mình vui lắm phải không? Bác gửi cháu hai bao thính cám gạo — rải xuống ao trước khi câu, cá sẽ kéo tới. '
      || 'Hòm thư này còn nhận quà từ làng: khi nào có mã quà (gift code), cháu gõ vào ô "Nhập code" ở đây nhé. — Bác Ba',
      'story:' || d.id, null);
    insert into public.mail_items (mail_id, kind, ref, qty, name) values (v_mail, 'item', 'gb_cam', 2, 'Thính cám gạo');
  end if;
  return public._story_state(v_account);
end $$;
revoke all on function public.story_accept(text, text) from public;
grant execute on function public.story_accept(text, text) to anon, authenticated;

-- Hand a finished step in beside its turn-in NPC (the server position: a refused claim is the anti-cheat envelope).
create or replace function public.story_turn_in(p_session_token text, p_quest text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_account uuid := public._ac_account(p_session_token); d public.story_quests; n public.story_npcs;
        p public.story_progress; v_ac jsonb;
begin
  select * into d from public.story_quests where id = p_quest;
  if not found then raise exception 'unknown quest' using errcode = '22023'; end if;
  select * into n from public.story_npcs where id = d.turnin;
  v_ac := public._pos_claim(v_account, n.map, p_x, p_y, 'story_turn_in');
  if v_ac is not null then return v_ac; end if;
  if p_x is null or p_y is null or sqrt((p_x - n.x) ^ 2 + (p_y - n.y) ^ 2) > n.reach then
    raise exception 'too far' using errcode = '22023';
  end if;
  select * into p from public.story_progress where account_id = v_account and quest_id = d.id for update;
  if not found then raise exception 'not accepted' using errcode = '22023'; end if;
  if p.turned_in_at is not null then raise exception 'already claimed' using errcode = '22023'; end if;
  if public._story_count(v_account, d.id, p.accepted_at) < d.goal then raise exception 'not done' using errcode = '22023'; end if;
  update public.story_progress set turned_in_at = now() where account_id = v_account and quest_id = d.id;
  perform public._wallet_lock(v_account);
  if d.reward_coins > 0 then perform public._pay(v_account, d.reward_coins, 'quest_reward', 'story:' || d.id); end if;
  if d.reward_xp > 0 then
    perform public._game_event(v_account, 'xp_grant', d.reward_xp, jsonb_build_object('source', 'story', 'quest', d.id));
  end if;
  if d.reward_item is not null and d.reward_qty > 0 then
    insert into public.inventory (account_id, item_id, qty) values (v_account, d.reward_item, d.reward_qty)
    on conflict (account_id, item_id) do update set qty = least(99, public.inventory.qty + excluded.qty);
  end if;
  return public._story_state(v_account) || jsonb_build_object('paid', d.reward_coins, 'xp', d.reward_xp,
    'coins', (select coins from public.wallets where account_id = v_account));
end $$;
revoke all on function public.story_turn_in(text, text, integer, integer) from public;
grant execute on function public.story_turn_in(text, text, integer, integer) to anon, authenticated;

-- ---------- D. Veterans: close the chain without paying ----------
insert into public.story_progress (account_id, quest_id, accepted_at, turned_in_at, paid)
select a.id, q.id, now(), now(), false
  from public.accounts a cross join public.story_quests q
 where (exists (select 1 from public.quest_progress x where x.account_id = a.id and x.quest_id = 'n_lang_1' and x.claimed_at is not null)
    or (select count(*) from public.game_events e where e.account_id = a.id and e.kind = 'fish_catch') >= 10)
   and not exists (select 1 from public.story_progress s where s.account_id = a.id)   -- a re-run spares a chain begun
on conflict (account_id, quest_id) do nothing;
