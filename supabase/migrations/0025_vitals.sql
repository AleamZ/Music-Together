-- v18.3: hunger and thirst (spec §18.3). Online-only drain: each heartbeat credits at most 120 s since the last one.
-- Mirrors lib/game/vitals.ts.

create table if not exists public.vitals (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  hunger numeric not null default 100 check (hunger between 0 and 100),
  thirst numeric not null default 100 check (thirst between 0 and 100),
  starve_s numeric not null default 0,
  fainted_until timestamptz,
  last_tick timestamptz not null default now()
);
alter table public.vitals enable row level security;

create or replace function public._vitals_apply(p_account uuid) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400;
  tr constant numeric := 100.0 / 57600;
  dt numeric; zh numeric; zt numeric; nh numeric; nt numeric;
begin
  insert into public.vitals(account_id) values (p_account) on conflict do nothing;
  select * into v from public.vitals where account_id = p_account for update;
  if v.fainted_until is not null then
    if v.fainted_until <= now() then
      v.fainted_until := null; v.hunger := 30; v.thirst := 30; v.starve_s := 0;
    end if;
  else
    dt := least(120, greatest(0, extract(epoch from now() - v.last_tick)));
    if dt > 0 then
      nh := greatest(0, v.hunger - dt * hr);
      nt := greatest(0, v.thirst - dt * tr);
      zh := case when v.hunger <= 0 then dt else greatest(0, dt - v.hunger / hr) end;
      zt := case when v.thirst <= 0 then dt else greatest(0, dt - v.thirst / tr) end;
      v.starve_s := case when nh > 0 and nt > 0 then 0 else v.starve_s + greatest(zh, zt) end;
      v.hunger := nh; v.thirst := nt;
      if v.starve_s >= 600 then
        v.fainted_until := now() + interval '10 seconds'; v.starve_s := 0;
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account;
  return v;
end; $$;

create or replace function public._vitals_json(v public.vitals) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'hunger', round(v.hunger, 3), 'thirst', round(v.thirst, 3),
    'fainted_until_ms', case when v.fainted_until is null then null
                             else (extract(epoch from v.fainted_until) * 1000)::bigint end,
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint);
$$;

create or replace function public._vitals_guard(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.vitals;
begin
  v := public._vitals_apply(p_account);
  if v.fainted_until is not null then raise exception 'fainted' using errcode = '53400'; end if;
  if v.hunger <= 0 then raise exception 'too hungry' using errcode = '53400'; end if;
  if v.thirst <= 0 then raise exception 'too thirsty' using errcode = '53400'; end if;
end; $$;

create or replace function public._vitals_restore(p_account uuid, p_hunger numeric, p_thirst numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.vitals;
begin
  v := public._vitals_apply(p_account);
  update public.vitals set hunger = least(100, v.hunger + greatest(0, p_hunger)),
    thirst = least(100, v.thirst + greatest(0, p_thirst)),
    starve_s = case when least(100, v.hunger + greatest(0, p_hunger)) > 0
                     and least(100, v.thirst + greatest(0, p_thirst)) > 0 then 0 else v.starve_s end
    where account_id = p_account returning * into v;
  return public._vitals_json(v);
end; $$;

create or replace function public.vitals_tick(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._vitals_json(public._vitals_apply(public._auth_account(p_session_token)));
end; $$;

revoke all on function public._vitals_apply(uuid) from public, anon, authenticated;
revoke all on function public._vitals_json(public.vitals) from public, anon, authenticated;
revoke all on function public._vitals_guard(uuid) from public, anon, authenticated;
revoke all on function public._vitals_restore(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.vitals_tick(text) from public;
grant execute on function public.vitals_tick(text) to anon, authenticated;

-- start_cast (0015_anticheat.sql, newest) with the vitals guard.
create or replace function public.start_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  -- 1. hourly cap: a new window starts at the first cast after the previous one ended
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
  -- 1b. daily cap: the seconds until the next Vietnam midnight
  if p.day_on = v_today and p.day_casts >= 300 then
    raise exception 'daily cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  -- 2. a new cast abandons the previous one (its bait is already spent)
  delete from public.casts where account_id = v_account;
  -- 3. room for the catch
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  -- 4. one bait: the selected kind, else worms
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  -- 5. roll the fish (v14 spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90))
  returning id into v_id;
  update public.fishing_profiles
     set window_casts = window_casts + 1,
         day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
         day_on = v_today
   where account_id = v_account
  returning day_casts into v_day;
  if v_day = 300 then
    perform public._ac_flag(v_account, 'cast_daily_cap', 'start_cast', jsonb_build_object('day', v_today, 'casts', 300),
                            p_room_id, null, false);
  end if;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'state', public._fishing_state(v_account));
end; $$;

-- begin_work (0015_anticheat.sql, newest) with the vitals guard.
create or replace function public.begin_work(p_room_id uuid, p_session_token text, p_plot integer, p_work text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  perform public._vitals_guard(v_account);
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'begin_work', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_work is null or p_work not in ('transplant', 'harvest') then
    return public._ac_flag(v_account, 'bad_work', 'begin_work', jsonb_build_object('plot', p_plot, 'work', left(p_work, 32)),
                           p_room_id, 'invalid work');
  end if;
  return public._farm_do_begin_work(p_room_id, v_account, p_plot, p_work, now());
end $$;

grant execute on function public.start_cast(uuid, text) to anon, authenticated;
grant execute on function public.begin_work(uuid, text, integer, text) to anon, authenticated;
