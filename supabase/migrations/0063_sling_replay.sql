-- =========================================================
-- 0063_sling_replay.sql — anti-cheat v2 #10: the slingshot's rat runs a server-rolled path and every shot is replayed
-- (docs/superpowers/plans/2026-09-28-anticheat-v2-part2.md, part D). ADDITIVE and re-runnable. Run after 0062.
--   A. sling_aims.seed / rat_state / last_tick: the aim's seed, the rat's lane state at the last shot's landing tick and
--      that tick (ticks since the sling_start answer).
--   B. The rat of lib/game/farm/sling.ts, integer milli-px: _sling_rat_start, _sling_rat_step, _sling_rat_advance,
--      _sling_power, _sling_mark, _sling_input_error. tests/fixtures/sling-cases.json pins them (Vitest +
--      tests/sql/anticheat-v2-farm-smoke.sql).
--   C. sling_start(room, token, rat, x, y): a claim where I stand, which must be within 96 px of the rat's plot
--      ('too far'); 0019's aim, then its seed (answered in aim.seed). sling_shoot(room, token, rat, press, release, aim,
--      hit): the shot replayed on the rat's path — malformed → hard sling_bad_input, sooner than 0.9 × its landing tick
--      after the aim began → hard sling_too_fast, the client's hit differing → hard sling_mismatch (the aim and the pellet
--      stay; nothing is caught); else 0019's shot with the replayed hit (its 2 s / 60 s gates and the pellet). The old
--      sling_shoot(…, hit) keeps a miss and raises 'outdated' for a hit.
-- =========================================================

-- ---------- A. The aim's run ----------
alter table public.sling_aims add column if not exists seed bigint;
alter table public.sling_aims add column if not exists rat_state bigint[];
alter table public.sling_aims add column if not exists last_tick integer not null default 0;

-- ---------- B. The rat (sling.ts, statement for statement) ----------
-- The rat's state: {xm, dir, moving (0/1), speed (mpx a tick), seg (ticks left), rng}. Its next segment: after a run a
-- stop of 12 + u mod 25 ticks; after a stop a run of 30 + u mod 43 ticks at 1 000 + u mod 834 mpx a tick, turning back
-- when u mod 100 < 35.
create or replace function public._sling_rat_next(r bigint[]) returns bigint[]
language plpgsql immutable parallel safe
as $$
declare a bigint[]; b bigint[]; c bigint[];
begin
  if r[3] = 1 then
    a := public._reel_rand(r[6]);
    return array[r[1], r[2], 0, r[4], 12 + a[1] % 25, a[2]];
  end if;
  a := public._reel_rand(r[6]);
  b := public._reel_rand(a[2]);
  c := public._reel_rand(b[2]);
  return array[r[1], case when c[1] % 100 < 35 then -r[2] else r[2] end, 1, 1000 + b[1] % 834, 30 + a[1] % 43, c[2]];
end $$;

create or replace function public._sling_rat_start(p_seed bigint) returns bigint[]
language sql immutable parallel safe
as $$ select public._sling_rat_next(array[160000, 1, 0, 0, 0, p_seed & 4294967295]) $$;

-- One tick (stepRat): a running rat moves and turns back at the lane's ends (16 000 / 304 000 mpx).
create or replace function public._sling_rat_step(r bigint[]) returns bigint[]
language plpgsql immutable parallel safe
as $$
begin
  if r[3] = 1 then
    r[1] := r[1] + r[2] * r[4];
    if r[1] <= 16000 or r[1] >= 304000 then
      r[1] := least(304000, greatest(16000, r[1]));
      r[2] := -r[2];
    end if;
  end if;
  r[5] := r[5] - 1;
  if r[5] <= 0 then r := public._sling_rat_next(r); end if;
  return r;
end $$;

create or replace function public._sling_rat_advance(r bigint[], p_n integer) returns bigint[]
language plpgsql immutable parallel safe
as $$
begin
  for k in 1 .. greatest(0, p_n) loop
    r := public._sling_rat_step(r);
  end loop;
  return r;
end $$;

-- The draw ‰ let go `held` ticks after the press (slingPower).
create or replace function public._sling_power(p_held integer) returns integer
language sql immutable parallel safe
as $$ select least(1000, (p_held * 1000) / 60) $$;

-- A shot's mark (slingMark), the rat at the landing tick given: short < 600 ‰, over > 850 ‰, else hit within 9 000 mpx.
create or replace function public._sling_mark(p_rat bigint[], p_press integer, p_release integer, p_aim integer) returns text
language sql immutable parallel safe
as $$
  select case when public._sling_power(p_release - p_press) < 600 then 'short'
              when public._sling_power(p_release - p_press) > 850 then 'over'
              when abs(p_rat[1] - p_aim) <= 9000 then 'hit' else 'wide' end
$$;

-- A shot no sling makes (slingInputError; null = fine), and (0063) a landing more than 4 500 ticks past the last one.
create or replace function public._sling_input_error(p_press integer, p_release integer, p_aim integer, p_last integer)
returns text
language sql immutable parallel safe
as $$
  select case when p_press is null or p_release is null or p_aim is null then 'shape'
              when p_press <= p_last or p_press < 1 then 'order'
              when p_release <= p_press or p_release > p_press + 60 then 'draw'
              when p_aim < 16000 or p_aim > 304000 then 'aim'
              when p_release + 18 - p_last > 4500 then 'late' end
$$;
revoke all on function public._sling_rat_next(bigint[]) from public, anon, authenticated;
revoke all on function public._sling_rat_start(bigint) from public, anon, authenticated;
revoke all on function public._sling_rat_step(bigint[]) from public, anon, authenticated;
revoke all on function public._sling_rat_advance(bigint[], integer) from public, anon, authenticated;
revoke all on function public._sling_power(integer) from public, anon, authenticated;
revoke all on function public._sling_mark(bigint[], integer, integer, integer) from public, anon, authenticated;
revoke all on function public._sling_input_error(integer, integer, integer, integer) from public, anon, authenticated;

-- ---------- C. The RPCs ----------
-- The aim at a rat, where I stand (a claim within 96 px of the rat's plot); 0019's checks; then its seed.
create or replace function public.sling_start(p_room_id uuid, p_session_token text, p_rat_id bigint, p_x integer,
                                              p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_ac jsonb; v_plot integer; v_rect integer[];
        v_res jsonb; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  v_ac := public._pos_claim(v_account, 'field', p_x, p_y, 'sling_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  select plot_no into v_plot from public.field_rats where id = p_rat_id and room_id = p_room_id;
  if found then
    v_rect := public._field_plot_rect(v_plot);
    if sqrt(greatest(v_rect[1] - p_x, 0, p_x - (v_rect[1] + v_rect[3]))::numeric ^ 2
            + greatest(v_rect[2] - p_y, 0, p_y - (v_rect[2] + v_rect[4]))::numeric ^ 2) > 96 then
      raise exception 'too far' using errcode = '22023';
    end if;
  end if;
  v_res := public._rat_do_sling_start(p_room_id, v_account, p_rat_id, now());
  update public.sling_aims set seed = v_seed, rat_state = public._sling_rat_start(v_seed), last_tick = 0
   where account_id = v_account;
  return v_res || jsonb_build_object('aim', (v_res->'aim') || jsonb_build_object('seed', v_seed));
end $$;

-- sling_shoot (0019's, verbatim but for the line marked 0063): the client's word is kept for a miss only.
create or replace function public.sling_shoot(p_room_id uuid, p_session_token text, p_rat_id bigint, p_hit boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if coalesce(p_hit, false) then raise exception 'outdated' using errcode = '22023'; end if;   -- 0063: a hit is replayed
  return public._rat_do_sling_shoot(p_room_id, v_account, p_rat_id, p_hit, now());
end $$;

-- The replayed shot.
create or replace function public.sling_shoot(p_room_id uuid, p_session_token text, p_rat_id bigint, p_press integer,
                                              p_release integer, p_aim integer, p_hit boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); a public.sling_aims; v_bad text; v_rat bigint[];
        v_mark text; v_code text; v_ev jsonb; v_ac jsonb;
begin
  perform public._field_open(p_room_id, now());
  perform public._wallet_lock(v_account);
  select * into a from public.sling_aims where account_id = v_account for update;
  if not found or a.room_id is distinct from p_room_id or a.rat_id is distinct from p_rat_id then
    raise exception 'no aim' using errcode = '22023';
  end if;
  if a.seed is null then raise exception 'outdated' using errcode = '22023'; end if;
  v_ev := jsonb_build_object('rat', p_rat_id, 'press', p_press, 'release', p_release, 'aim', p_aim, 'hit', p_hit,
                             'last', a.last_tick);
  v_bad := coalesce(public._sling_input_error(p_press, p_release, p_aim, a.last_tick), case when p_hit is null then 'hit' end);
  if v_bad is not null then
    v_code := 'sling_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif now() < a.started_at + make_interval(secs => 0.9 * (p_release + 18) / 60.0) then
    v_code := 'sling_too_fast';
    v_ev := v_ev || jsonb_build_object('started_at', a.started_at, 'shot_at', now(), 'need_s', round(0.9 * (p_release + 18) / 60.0, 3));
  else
    v_rat := public._sling_rat_advance(a.rat_state, p_release + 18 - a.last_tick);
    v_mark := public._sling_mark(v_rat, p_press, p_release, p_aim);
    if (v_mark = 'hit') <> p_hit then
      v_code := 'sling_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', a.seed, 'mark', v_mark, 'rat_x', v_rat[1]);
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'sling_shoot', v_ev, p_room_id, 'invalid shot');
    return public._field_view(p_room_id, v_account, now()) || v_ac;
  end if;
  update public.sling_aims set rat_state = v_rat, last_tick = p_release + 18 where account_id = v_account;
  return public._rat_do_sling_shoot(p_room_id, v_account, p_rat_id, v_mark = 'hit', now());
end $$;
revoke all on function public.sling_start(uuid, text, bigint, integer, integer) from public;
revoke all on function public.sling_shoot(uuid, text, bigint, boolean) from public;
revoke all on function public.sling_shoot(uuid, text, bigint, integer, integer, integer, boolean) from public;
grant execute on function public.sling_start(uuid, text, bigint, integer, integer) to anon, authenticated;
grant execute on function public.sling_shoot(uuid, text, bigint, boolean) to anon, authenticated;
grant execute on function public.sling_shoot(uuid, text, bigint, integer, integer, integer, boolean) to anon, authenticated;
