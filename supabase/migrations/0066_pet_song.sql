-- =========================================================
-- 0066_pet_song.sql — anti-cheat v2 #12 and #13 (docs/superpowers/plans/2026-09-28-anticheat-v2-part3.md, parts N and
-- S). ADDITIVE and re-runnable. Run after 0065.
--   A. pet_tick(token, room): the lock gate (_ac_account, so the minimum build too); the sóc forages only with a live
--      heartbeat — an accepted position claim or a vitals_tick within 90 s — and a membership of that room; it runs the
--      statistics job lazily (0065's _ac_stats_maybe). The old pet_tick(token) (0036's) is gated and never pays: its
--      answer says 'outdated'.
--   B. queue_items.client_build and video_durations: a trigger stamps the adder's build and keeps each account's claimed
--      duration of a video.
--   C. _song_bonus (0015's): the play time is the server's — the wall clock since item_began_at, capped by the room's
--      timeline (a pause stops it; a seek forward or a forged started_at cannot pass the wall clock). Paid when it is
--      ≥ 60 s and ≥ 0.75 × max(the claim, the other accounts' median claim when ≥ 2 others claimed it). Not paid, with
--      a soft flag on the adder: a claim more than max(15 s, 10 %) off the others' median (song_duration_mismatch), a
--      timeline more than 30 s past the claim (song_duration_short). Not paid under the minimum build (0064).
-- =========================================================

-- ---------- A. The pet's heartbeat ----------
-- The old signature (0036's, verbatim but for the lines marked 0066): a page before 0066 gets its state and no xu.
create or replace function public.pet_tick(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets; o public.pet_owner;   -- 0066 was: declare v_account uuid := public._auth_account(p_session_token); p public.pets; o public.pet_owner;
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_n int := 0; v_done int; v_bal int;
begin
  -- 0066: without its room this heartbeat proves nothing — no forage
  return public._pets_state(v_account) || jsonb_build_object('found', 0, 'outdated', true);   -- 0066
  p := public._pet_following(v_account);
  if p.id is not null and p.species = 'soc' and p.happy > 50 then
    select * into o from public.pet_owner where account_id = v_account for update;
    v_done := case when o.forage_day = v_today then o.forage_today else 0 end;
    if (o.forage_at is null or o.forage_at <= now() - interval '10 minutes') and v_done < 300 then
      v_n := least(300 - v_done, 5 + floor(random() * 26)::int);
      perform public._wallet_lock(v_account);
      v_bal := public._pay(v_account, v_n, 'pet_find', 'soc');
      update public.pet_owner set forage_at = now(), forage_day = v_today, forage_today = v_done + v_n
       where account_id = v_account;
    end if;
  end if;
  return public._pets_state(v_account) || jsonb_build_object('found', v_n)
         || case when v_bal is not null then jsonb_build_object('coins', v_bal) else '{}'::jsonb end;
end $$;

-- The heartbeat with its room.
create or replace function public.pet_tick(p_session_token text, p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets; o public.pet_owner;
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_n int := 0; v_done int; v_bal int;
        v_idle text; v_beat timestamptz;
begin
  -- live: the newest accepted position claim or vitals_tick within 90 s, in a room I belong to
  v_beat := greatest((select at from public.player_pos where account_id = v_account),
                     (select last_seen from public.heat_state where account_id = v_account));
  if p_room_id is null or not exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = v_account) then
    v_idle := 'not_member';
  elsif v_beat is null or v_beat < now() - interval '90 seconds' then
    v_idle := 'no_heartbeat';
  end if;
  p := public._pet_following(v_account);
  if v_idle is null and p.id is not null and p.species = 'soc' and p.happy > 50 then
    select * into o from public.pet_owner where account_id = v_account for update;
    v_done := case when o.forage_day = v_today then o.forage_today else 0 end;
    if (o.forage_at is null or o.forage_at <= now() - interval '10 minutes') and v_done < 300 then
      v_n := least(300 - v_done, 5 + floor(random() * 26)::int);
      perform public._wallet_lock(v_account);
      v_bal := public._pay(v_account, v_n, 'pet_find', 'soc');
      update public.pet_owner set forage_at = now(), forage_day = v_today, forage_today = v_done + v_n
       where account_id = v_account;
    end if;
  end if;
  perform public._ac_stats_maybe();
  return public._pets_state(v_account) || jsonb_build_object('found', v_n)
         || case when v_bal is not null then jsonb_build_object('coins', v_bal) else '{}'::jsonb end
         || case when v_idle is not null then jsonb_build_object('idle', v_idle) else '{}'::jsonb end;
end $$;
revoke all on function public.pet_tick(text) from public;
revoke all on function public.pet_tick(text, uuid) from public;
grant execute on function public.pet_tick(text) to anon, authenticated;
grant execute on function public.pet_tick(text, uuid) to anon, authenticated;

-- ---------- B. The queue's stamp and the claimed durations ----------
alter table public.queue_items add column if not exists client_build bigint;

create table if not exists public.video_durations (
  video_id text not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  duration_s integer not null,
  at timestamptz not null default now(),
  primary key (video_id, account_id)
);
alter table public.video_durations enable row level security;
revoke all on public.video_durations from anon, authenticated;

create or replace function public._queue_stamp() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.added_by_account_id is not null then
    new.client_build := public._client_build();
    if new.duration_seconds between 1 and 86400 then
      insert into public.video_durations (video_id, account_id, duration_s) values (new.youtube_video_id, new.added_by_account_id, new.duration_seconds)
      on conflict (video_id, account_id) do update set duration_s = excluded.duration_s, at = now();
    end if;
  end if;
  return new;
end $$;
revoke all on function public._queue_stamp() from public, anon, authenticated;
drop trigger if exists queue_items_stamp on public.queue_items;
create trigger queue_items_stamp before insert on public.queue_items
  for each row execute function public._queue_stamp();

-- The other accounts' median claim of a video (null with fewer than 2 of them).
create or replace function public._video_peer_s(p_video text, p_account uuid) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select case when count(*) >= 2 then percentile_cont(0.5) within group (order by d.duration_s)::numeric end
    from public.video_durations d where d.video_id = p_video and d.account_id is distinct from p_account
$$;
revoke all on function public._video_peer_s(text, uuid) from public, anon, authenticated;

-- ---------- C. The song bonus (0015's, verbatim but for the lines marked 0066) ----------
create or replace function public._song_bonus() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare q public.queue_items; w public.wallets; v_today date;
        v_wall numeric; v_line numeric; v_played numeric := 0; v_peer numeric; v_why text; v_min bigint;   -- 0066
begin
  begin
    select * into q from public.queue_items where id = old.current_item_id;
    -- 0066 {
    -- the play time is the server's: the wall clock since the song began, capped by the room's timeline position
    if found and q.added_by_account_id is not null and old.item_began_at is not null then
      v_wall := extract(epoch from now() - old.item_began_at);
      v_line := case when old.is_playing and old.started_at is not null then extract(epoch from now() - old.started_at)
                     else coalesce(old.paused_elapsed_ms, 0) / 1000.0 end;
      v_played := least(v_wall, v_line);
      v_peer := public._video_peer_s(q.youtube_video_id, q.added_by_account_id);
      if q.duration_seconds is not null and v_peer is not null and abs(q.duration_seconds - v_peer) > greatest(15, v_peer / 10) then
        v_why := 'song_duration_mismatch';
      elsif q.duration_seconds is not null and v_line > q.duration_seconds + 30 and v_wall > q.duration_seconds + 30 then
        v_why := 'song_duration_short';
      end if;
      if v_why is not null then
        perform public._ac_flag(q.added_by_account_id, v_why, 'song_bonus',
                  jsonb_build_object('video', q.youtube_video_id, 'claimed_s', q.duration_seconds, 'peers_s', v_peer,
                                     'wall_s', round(v_wall, 1), 'timeline_s', round(v_line, 1)), old.id, null, false);
        return null;
      end if;
      v_min := (select min_client_build from public.anticheat_config where id);
      if coalesce(v_min, 0) > 0 and coalesce(q.client_build, 0) < v_min then
        return null;
      end if;
    end if;
    -- 0066 }
    if not found or q.added_by_account_id is null or coalesce(q.duration_seconds, 0) < 60
       or old.item_began_at is null
       or v_played < greatest(60, 0.75 * greatest(q.duration_seconds, coalesce(v_peer, 0)))   -- 0066 was: or extract(epoch from (now() - old.item_began_at)) < 0.75 * q.duration_seconds
       or exists (select 1 from public.accounts a where a.id = q.added_by_account_id and a.is_banned) then
      return null;
    end if;
    v_today := public._vn_today();
    w := public._wallet_lock(q.added_by_account_id);
    if w.bonus_on is distinct from v_today then
      update public.wallets set bonus_on = v_today, bonus_count = 0 where account_id = q.added_by_account_id;
      w.bonus_count := 0;
    end if;
    if w.bonus_count >= 10 then
      return null;
    end if;
    update public.wallets set bonus_count = bonus_count + 1 where account_id = q.added_by_account_id;
    perform public._pay(q.added_by_account_id, 10, 'song', left(q.title, 80));
  exception when others then
    raise warning 'song bonus skipped: %', sqlerrm;
  end;
  return null;
end; $$;
revoke all on function public._song_bonus() from public, anon, authenticated;
