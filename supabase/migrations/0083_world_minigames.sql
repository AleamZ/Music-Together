-- =========================================================
-- 0083_world_minigames.sql — v22 "world": the wild animals and the boss / dungeon strikes become short skill minigames
-- (.superpowers/v22-common.md). ADDITIVE and re-runnable. Run after 0082.
--   A. The sims (lib/game/realm/minigames.ts, statement for statement; tests/fixtures/world-mg-cases.json pins both):
--      _wg_tri, _wg_draws, _wg_speed, _wg_chance, _wg_hunt (aim and release at a moving animal, lead it, the wind;
--      a dangerous animal at night charges at a seeded tick — dodge it), _wg_trap (pull the cord when the animal steps on
--      the trap; birds and fireflies: a wider net, faster), _wg_photo (frame, zoom, snap the best pose), _wg_combo (six
--      rhythm arrows + a telegraphed slam to dodge), _wg_input_error / _wg_combo_error (the inputs' shape).
--   B. world_mg: one open round per account (a new start replaces it; an abandoned wolf/bear hunt is a charge taken).
--   C. RPCs: wild_start / wild_finish (replace wild_act) and combo_start / combo_finish (replace boss_attack and
--      dungeon_attack). The client sends only its input ticks; the server replays, flags malformed input (hard
--      wild_bad_input / combo_bad_input), a replay mismatch (hard wild_mismatch), a finish sooner than 0.9 × the ticks
--      (hard wild_too_fast / combo_too_fast); an exact hunt shot is a soft 'wild_timing'; a combo with every arrow on
--      its exact beat is a soft 'combo_timing' and the 5th in 24 h the hard 'combo_timing_repeat' (the round deals
--      nothing). The score only moves the outcome WITHIN the old bounds: a hunt/trap's success chance is the species'
--      base ± 20 (a miss catches nothing); a photo is kept from 250 and earns at most the old photo XP; a combo arrow
--      deals the old strike's damage (40–60 server RNG × the streak's +15 %, max ×1.75; a "good" arrow 75 %) and the
--      round spans ≥ 6 × 0.9 s (the old cooldown), under the same per-account caps, armour and pool.
--      A failed dodge: a wolf/bear hunt → the old knock-back (hunger/thirst −8, the faint chance); a boss/dungeon slam
--      → the old strike-back (hunger/thirst −3) and a 3 s stun (no new round).
--      Stamina (0077): a hunt or trap 1, a photo 0.5, a combo round 2 ('fight').
--   D. wild_act, boss_attack, dungeon_attack now refuse with 'outdated' (the page before 0083).
-- Events (unchanged kinds): wild_hunt, wild_trap, wild_photo, boss_hit, boss_kill, dungeon_clear, xp_grant (source
-- wild | boss | dungeon) — via 0075's _boss_payout / _dg_payout.
-- NOTE: tests/sql/v21-world-smoke.sql and v21-fixes-smoke.sql re-apply 0075 / 0078 (the old strike bodies): re-apply
-- 0083 after them.
-- =========================================================

-- ---------- A. The sims ----------
create or replace function public._wg_tri(p_period integer, p_t integer) returns integer
language sql immutable parallel safe
as $$ select case when ((p_t % p_period) * 2000) / p_period <= 1000 then ((p_t % p_period) * 2000) / p_period
                  else 2000 - ((p_t % p_period) * 2000) / p_period end $$;

create or replace function public._wg_draws(p_seed bigint, p_n integer) returns bigint[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o bigint[] := '{}';
begin
  for i in 1 .. p_n loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || r[1];
  end loop;
  return o;
end $$;

create or replace function public._wg_speed(p_species text) returns integer
language sql immutable parallel safe
as $$ select case when p_species in ('bird', 'firefly') then 150 when p_species in ('deer', 'fox') then 130 else 100 end $$;

create or replace function public._wg_chance(p_base integer, p_score integer, p_caught boolean) returns integer
language sql immutable parallel safe
as $$ select case when p_caught then least(95, greatest(5, p_base - 20 + (p_score * 40) / 1000)) else 0 end $$;

-- The hunt: {outcome hit|miss|charged|open, ticks, score, used, dodged}.
create or replace function public._wg_hunt(p_seed bigint, p_species text, p_danger boolean, p_shots integer[], p_dodges integer[])
returns jsonb
language plpgsql immutable parallel safe
as $$
declare u bigint[] := public._wg_draws(p_seed, 5); per integer; ph integer; wind integer; ret integer; chg integer;
        v_dodged boolean; cend integer; used integer := 0; s integer; land integer; err integer;
begin
  per := ((150 + u[1] % 91) * 100) / public._wg_speed(p_species);
  ph := u[2] % per;
  wind := (u[3] % 121) - 60;
  ret := 100 + u[4] % 41;
  chg := 150 + u[5] % 151;
  v_dodged := not p_danger or exists (select 1 from unnest(coalesce(p_dodges, '{}'::integer[])) d where d between chg - 24 and chg);
  cend := case when v_dodged then null else chg end;
  foreach s in array coalesce(p_shots, '{}'::integer[]) loop
    exit when cend is not null and s >= cend;
    used := used + 1;
    land := s + 20;
    exit when cend is not null and land > cend;
    err := abs(public._wg_tri(ret, s) + wind - (100 + (public._wg_tri(per, land + ph) * 8) / 10));
    if err <= 70 then
      return jsonb_build_object('outcome', 'hit', 'ticks', land + 1, 'score', 1000 - (err * 600) / 70, 'used', used,
                                'dodged', p_danger and v_dodged);
    end if;
    if used >= 3 then
      return jsonb_build_object('outcome', 'miss', 'ticks', land + 1, 'score', 0, 'used', used, 'dodged', p_danger and v_dodged);
    end if;
  end loop;
  if cend is not null then
    return jsonb_build_object('outcome', 'charged', 'ticks', cend + 1, 'score', 0, 'used', used, 'dodged', false);
  end if;
  return jsonb_build_object('outcome', 'open', 'ticks', null, 'score', 0, 'used', used, 'dodged', p_danger);
end $$;

-- The trap: {outcome caught|miss|escaped|open, ticks, score, used, dodged false}.
create or replace function public._wg_trap(p_seed bigint, p_species text, p_pulls integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare mul integer := case when public._wg_speed(p_species) >= 150 then 3 else 2 end; u bigint[] := public._wg_draws(p_seed, 16);
        tv integer[] := array[-3, 0, 0, 4, 5, 6, 7, 8]; lens integer[] := '{}'; vs integer[] := '{}'; zone integer; tail integer;
        x integer := 0; seg integer := 1; v_left integer; v integer; esc integer; at_pull integer; pull integer; d integer;
begin
  zone := case when mul = 3 then 60 else 40 end;
  tail := 3 * mul;
  for i in 0 .. 7 loop
    lens := lens || (30 + u[2 * i + 1] % 41)::integer;
    vs := vs || ((tv[(u[2 * i + 2] % 8)::integer + 1] * mul) / 2);
  end loop;
  pull := case when coalesce(cardinality(p_pulls), 0) > 0 then p_pulls[1] end;
  if pull = 0 then at_pull := 0; end if;
  v_left := lens[1];
  for t in 1 .. 900 loop
    while seg <= 8 and v_left <= 0 loop
      seg := seg + 1;
      v_left := case when seg <= 8 then lens[seg] else 0 end;
    end loop;
    v := case when seg <= 8 then vs[seg] else tail end;
    v_left := v_left - 1;
    x := least(1000, greatest(0, x + v));
    if t = pull then at_pull := x; end if;
    if x = 1000 and esc is null then esc := t; end if;
    exit when esc is not null and (pull is null or t >= pull);
  end loop;
  if pull is not null and (esc is null or pull < esc) then
    d := abs(at_pull - 500);
    if d <= zone then
      return jsonb_build_object('outcome', 'caught', 'ticks', pull + 1, 'score', 1000 - (d * 600) / zone, 'used', 1, 'dodged', false);
    end if;
    return jsonb_build_object('outcome', 'miss', 'ticks', pull + 1, 'score', 0, 'used', 1, 'dodged', false);
  end if;
  if esc is not null then
    return jsonb_build_object('outcome', 'escaped', 'ticks', esc + 1, 'score', 0, 'used', 0, 'dodged', false);
  end if;
  return jsonb_build_object('outcome', 'open', 'ticks', null, 'score', 0, 'used', 0, 'dodged', false);
end $$;

-- The photo: {outcome done|open, ticks, score (the best snap), used, dodged false}.
create or replace function public._wg_photo(p_seed bigint, p_species text, p_snaps integer[], p_zooms integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare u bigint[] := public._wg_draws(p_seed, 4); per integer; ph integer; pose integer; pat integer; s integer;
        used integer := 0; best integer := 0; zoom boolean; tol integer; c integer; sc integer;
begin
  per := ((180 + u[1] % 121) * 100) / public._wg_speed(p_species);
  ph := u[2] % per;
  pose := 150 + u[3] % 91;
  pat := u[4] % pose;
  foreach s in array coalesce(p_snaps, '{}'::integer[]) loop
    used := used + 1;
    zoom := (select count(*) from unnest(coalesce(p_zooms, '{}'::integer[])) z where z <= s) % 2 = 1;
    tol := case when zoom then 180 else 360 end;
    c := abs(public._wg_tri(per, s + ph) - 500);
    sc := 0;
    if c <= tol then
      sc := ((600 - (c * 600) / tol) * case when zoom then 100 else 70 end) / 100
          + case when (s + pat) % pose < 30 then case when zoom then 400 else 280 end else 0 end;
    end if;
    best := greatest(best, sc);
    if used >= 3 then
      return jsonb_build_object('outcome', 'done', 'ticks', s + 1, 'score', best, 'used', used, 'dodged', false);
    end if;
  end loop;
  return jsonb_build_object('outcome', 'open', 'ticks', null, 'score', best, 'used', used, 'dodged', false);
end $$;

create or replace function public._wg_input_error(p_game text, p_a integer[], p_b integer[], p_ticks integer) returns text
language plpgsql immutable parallel safe
as $$
declare e text;
begin
  e := public._toggles_error(p_a, p_ticks, 900, case when p_game = 'trap' then 1 else 3 end, 1);
  if e is not null then return e; end if;
  if p_game = 'trap' then return case when coalesce(cardinality(p_b), 0) > 0 then 'too_many' end; end if;
  if p_game = 'hunt' then return public._toggles_error(p_b, p_ticks, 900, 3, 1); end if;
  return public._toggles_error(p_b, p_ticks, 900, 6, 2);
end $$;

-- The combo: {judges (perfect|good|miss × 6), streaks, perfect, good, best, dodged, exact, slam, end}.
create or replace function public._wg_combo(p_seed bigint, p_keys integer[], p_dodges integer[], p_ticks integer) returns jsonb
language plpgsql immutable parallel safe
as $$
declare u bigint[] := public._wg_draws(p_seed, 13); beats integer[] := '{}'; dirs integer[] := '{}'; b integer; k integer;
        slam integer; v_end integer; judges text[] := array_fill('miss'::text, array[6]); done boolean[] := array_fill(false, array[6]);
        streaks integer[] := array_fill(0, array[6]); streak integer := 0; best integer := 0; perfect integer := 0; good integer := 0;
        exact integer := 0; key integer; t integer; dir integer; i integer; dt integer; v_dodged boolean;
begin
  b := 90 + (u[1] % 31)::integer;
  for j in 0 .. 5 loop
    if j > 0 then b := b + 54 + (u[2 * j + 1] % 19)::integer; end if;
    beats := beats || b;
    dirs := dirs || (u[2 * j + 2] % 4)::integer;
  end loop;
  k := 1 + (u[13] % 3)::integer;
  slam := beats[k + 1] + 27;
  v_end := beats[6] + 11;
  foreach key in array coalesce(p_keys, '{}'::integer[]) loop
    t := key / 4;
    dir := key % 4;
    exit when t >= p_ticks;
    i := null;
    for j in 1 .. 6 loop
      if not done[j] and abs(t - beats[j]) <= 10 then i := j; exit; end if;
    end loop;
    if i is null then streak := 0; continue; end if;
    done[i] := true;
    dt := abs(t - beats[i]);
    if dir <> dirs[i] then streak := 0; continue; end if;
    if dt <= 1 then exact := exact + 1; end if;
    if dt <= 3 then judges[i] := 'perfect'; perfect := perfect + 1; else judges[i] := 'good'; good := good + 1; end if;
    streak := streak + 1;
    streaks[i] := streak;
    best := greatest(best, streak);
  end loop;
  v_dodged := slam >= p_ticks or exists (select 1 from unnest(coalesce(p_dodges, '{}'::integer[])) d
                                          where d between slam - 20 and slam and d < p_ticks);
  return jsonb_build_object('judges', to_jsonb(judges), 'streaks', to_jsonb(streaks), 'perfect', perfect, 'good', good,
                            'best', best, 'dodged', v_dodged, 'exact', exact, 'slam', slam, 'end', v_end);
end $$;

create or replace function public._wg_combo_error(p_keys integer[], p_dodges integer[], p_ticks integer) returns text
language plpgsql immutable parallel safe
as $$
declare tl integer[];
begin
  if coalesce(cardinality(p_keys), 0) > 0 then
    if array_ndims(p_keys) <> 1 or array_lower(p_keys, 1) <> 1 then return 'shape'; end if;
    if exists (select 1 from unnest(p_keys) k where k is null or k < 0) then return 'range'; end if;
    select array_agg(k / 4 order by o) into tl from unnest(p_keys) with ordinality as x(k, o);
  end if;
  return coalesce(public._toggles_error(tl, p_ticks, 900, 12, 2), public._toggles_error(p_dodges, p_ticks, 900, 3, 1));
end $$;
revoke all on function public._wg_tri(integer, integer) from public, anon, authenticated;
revoke all on function public._wg_draws(bigint, integer) from public, anon, authenticated;
revoke all on function public._wg_speed(text) from public, anon, authenticated;
revoke all on function public._wg_chance(integer, integer, boolean) from public, anon, authenticated;
revoke all on function public._wg_hunt(bigint, text, boolean, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._wg_trap(bigint, text, integer[]) from public, anon, authenticated;
revoke all on function public._wg_photo(bigint, text, integer[], integer[]) from public, anon, authenticated;
revoke all on function public._wg_input_error(text, integer[], integer[], integer) from public, anon, authenticated;
revoke all on function public._wg_combo(bigint, integer[], integer[], integer) from public, anon, authenticated;
revoke all on function public._wg_combo_error(integer[], integer[], integer) from public, anon, authenticated;

-- ---------- B. The round ----------
create table if not exists public.world_mg (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('hunt', 'trap', 'photo', 'boss', 'dungeon')),
  ref bigint not null,                 -- the spawn, the fight or the run
  target integer not null default 0,   -- the dungeon's mob
  species text,
  danger boolean not null default false,
  seed bigint not null,
  started_at timestamptz not null default now(),
  open boolean not null default true,
  last_start timestamptz,
  stun_until timestamptz
);
alter table public.world_mg enable row level security;
revoke all on public.world_mg from anon, authenticated;

-- An open wolf/bear hunt given up (replaced, expired): the charge is taken — the old miss penalty.
create or replace function public._wg_charge(p_account uuid, p_species text) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_len interval; v_danger integer;
begin
  select s.danger into v_danger from public._wild_species() s where s.id = p_species;
  update public.vitals set hunger = greatest(1, hunger - 8), thirst = greatest(1, thirst - 8) where account_id = p_account;
  if random() * 100 < coalesce(v_danger, 0) then
    v_len := public._faint(p_account);
    update public.vitals set fainted_until = now() + v_len, starve_s = 0 where account_id = p_account;
    return true;
  end if;
  return false;
end $$;
revoke all on function public._wg_charge(uuid, text) from public, anon, authenticated;

-- Lock (create) my round row and settle an abandoned dangerous hunt.
create or replace function public._wg_row(p_account uuid) returns public.world_mg
language plpgsql security definer set search_path = public, extensions
as $$
declare g public.world_mg;
begin
  select * into g from public.world_mg where account_id = p_account for update;
  if found and g.open and g.kind = 'hunt' and g.danger then
    perform public._wg_charge(p_account, g.species);
    update public.world_mg set open = false where account_id = p_account;
    g.open := false;
  end if;
  return g;
end $$;
revoke all on function public._wg_row(uuid) from public, anon, authenticated;

-- ---------- C. The wild ----------
create or replace function public.wild_start(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; sp public.wild_spawns; s record; p public.wild_profile; g public.world_mg;
        v_ax double precision; v_ay double precision; v_seed bigint := floor(random() * 4294967296)::bigint; v_danger boolean;
begin
  v_acc := public._ac_account(p_session_token);
  if p_action is null or p_action not in ('hunt', 'trap', 'photo') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'wild_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  g := public._wg_row(v_acc);
  if g.stun_until > now() then raise exception 'stunned' using errcode = '53400'; end if;
  select * into sp from public.wild_spawns where id = p_spawn for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    raise exception 'gone' using errcode = '22023';
  end if;
  select * into s from public._wild_species() ws where ws.id = sp.species;
  select q.x, q.y into v_ax, v_ay from public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, extract(epoch from now() - sp.born_at)) q;
  if pp.map is distinct from sp.map
     or sqrt((pp.x - v_ax) ^ 2 + (pp.y - v_ay) ^ 2) > (case when p_action = 'photo' then 140 else 64 end) then
    raise exception 'too far' using errcode = '22023';
  end if;
  insert into public.wild_profile (account_id) values (v_acc) on conflict do nothing;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;
  if p_action = 'photo' then
    if p.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
    if exists (select 1 from public.wild_photos where account_id = v_acc and spawn_id = sp.id) then
      raise exception 'already photographed' using errcode = '22023';
    end if;
  else
    if (p_action = 'hunt' and s.hunt = 0) or (p_action = 'trap' and s.trap = 0) then
      raise exception 'cannot' using errcode = '22023';
    end if;
    if (p_action = 'hunt' and p.last_at > now() - interval '4 seconds')
       or (p_action = 'trap' and p.trap_at > now() - interval '20 seconds') then
      raise exception 'cooldown' using errcode = '53400';
    end if;
    if p.kills >= 60 then raise exception 'daily cap' using errcode = '53400'; end if;
  end if;
  perform public._stamina_spend(v_acc, case when p_action = 'photo' then 0.5 else 1 end, null);
  update public.wild_profile
     set last_at = case when p_action in ('hunt', 'photo') then now() else last_at end,
         trap_at = case when p_action = 'trap' then now() else trap_at end,
         day = p.day, kills = p.kills
   where account_id = v_acc;
  v_danger := p_action = 'hunt' and s.danger > 0 and public._world_night();
  insert into public.world_mg as w (account_id, kind, ref, target, species, danger, seed, started_at, open, last_start)
  values (v_acc, p_action, sp.id, 0, sp.species, v_danger, v_seed, now(), true, now())
  on conflict (account_id) do update
    set kind = excluded.kind, ref = excluded.ref, target = 0, species = excluded.species, danger = excluded.danger,
        seed = excluded.seed, started_at = excluded.started_at, open = true, last_start = excluded.last_start;
  return jsonb_build_object('round', jsonb_build_object('game', p_action, 'spawn', sp.id, 'species', sp.species,
                                                        'danger', v_danger, 'seed', v_seed, 'started_at', now()));
end $$;

-- The end of a wild round (single use): the inputs are replayed from the round's seed.
create or replace function public.wild_finish(p_session_token text, p_a integer[], p_b integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; sp public.wild_spawns; s record; p public.wild_profile; v_bad text; v_rep jsonb;
        v_code text; v_ev jsonb; v_ac jsonb; v_out text; v_rt integer; v_score integer := 0; v_chance integer := 0;
        v_ok boolean := false; v_qty integer := 0; v_knock boolean := false; v_faint boolean := false; v_saved boolean := false;
        v_xp integer := 0; v_gave_up boolean := false; v_n integer := coalesce(cardinality(p_a), 0);
begin
  v_acc := public._ac_account(p_session_token);
  select * into g from public.world_mg where account_id = v_acc for update;
  if not found or not g.open or g.kind not in ('hunt', 'trap', 'photo') then
    raise exception 'round not found' using errcode = '22023';
  end if;
  update public.world_mg set open = false where account_id = v_acc;
  if now() > g.started_at + interval '60 seconds' then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  v_ev := jsonb_build_object('game', g.kind, 'species', g.species, 'ticks', p_ticks, 'a', to_jsonb(p_a[1:6]), 'b', to_jsonb(p_b[1:6]));
  v_bad := public._wg_input_error(g.kind, p_a, p_b, p_ticks);
  if v_bad is not null then
    v_code := 'wild_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := case g.kind when 'hunt' then public._wg_hunt(g.seed, g.species, g.danger, p_a, p_b)
                         when 'trap' then public._wg_trap(g.seed, g.species, p_a)
                         else public._wg_photo(g.seed, g.species, p_a, p_b) end;
    v_out := v_rep->>'outcome';
    v_rt := (v_rep->>'ticks')::int;
    if v_out = 'open' or p_ticks < v_rt then
      v_gave_up := g.kind <> 'photo';
      if g.kind = 'photo' then v_score := coalesce((v_rep->>'score')::int, 0); end if;
    elsif p_ticks <> v_rt or (v_rep->>'used')::int <> v_n then
      v_code := 'wild_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', g.seed, 'replay', v_rep);
    else
      v_score := (v_rep->>'score')::int;
    end if;
    if v_code is null and now() < g.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'wild_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', g.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  if v_code is not null then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    v_ac := public._ac_flag(v_acc, v_code, 'wild_finish', v_ev, null, 'invalid round');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'knocked', v_knock, 'fainted', v_faint) || v_ac;
  end if;
  if g.kind = 'hunt' and v_out = 'hit' and v_score >= 992 and not v_gave_up then
    perform public._ac_flag(v_acc, 'wild_timing', 'wild_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
  end if;

  select * into s from public._wild_species() ws where ws.id = g.species;
  -- the charge of a wolf / bear: taken unless the hunt hit first or the dodge was on time
  if g.danger and not (not v_gave_up and v_out = 'hit') and not (not v_gave_up and coalesce((v_rep->>'dodged')::boolean, false)) then
    v_knock := true;
    v_faint := public._wg_charge(v_acc, g.species);
  end if;

  select * into sp from public.wild_spawns where id = g.ref for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    return jsonb_build_object('result', 'lost', 'why', 'gone', 'outcome', v_out, 'score', v_score, 'knocked', v_knock,
                              'fainted', v_faint, 'wild', public._wild_json(v_acc, coalesce(sp.map, 'field')));
  end if;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;

  if g.kind = 'photo' then
    if v_score >= 250 then
      insert into public.wild_photos (account_id, spawn_id, species) values (v_acc, sp.id, sp.species) on conflict do nothing;
      v_saved := found;
    end if;
    if v_saved then
      v_xp := greatest(1, case when v_score >= 700 then s.xp / 2 else s.xp / 4 end);
      perform public._game_event(v_acc, 'wild_photo', 1, jsonb_build_object('species', sp.species, 'score', v_score));
      perform public._game_event(v_acc, 'xp_grant', v_xp, jsonb_build_object('source', 'wild'));
    end if;
    return jsonb_build_object('result', case when v_saved then 'ok' else 'fail' end, 'action', 'photo', 'species', sp.species,
                              'score', v_score, 'saved', v_saved, 'xp', v_xp, 'outcome', v_out,
                              'wild', public._wild_json(v_acc, sp.map));
  end if;

  v_chance := public._wg_chance(case when g.kind = 'hunt' then s.hunt else s.trap end, v_score,
                                not v_gave_up and v_out in ('hit', 'caught'));
  v_ok := p.kills < 60 and random() * 100 < v_chance;
  if v_ok then
    update public.wild_spawns set taken_by = v_acc, taken_at = now() where id = sp.id;
    v_qty := s.drop_min + floor(random() * (s.drop_max - s.drop_min + 1))::int;
    insert into public.wild_bag (account_id, item, qty) values (v_acc, s.drop_item, v_qty)
    on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
    p.kills := p.kills + 1;
    v_xp := s.xp;
    perform public._game_event(v_acc, case when g.kind = 'hunt' then 'wild_hunt' else 'wild_trap' end, v_qty,
                               jsonb_build_object('species', sp.species, 'item', s.drop_item, 'score', v_score));
    perform public._game_event(v_acc, 'xp_grant', s.xp, jsonb_build_object('source', 'wild'));
  elsif g.kind = 'hunt' and random() < 0.5 then
    update public.wild_spawns set expires_at = now() where id = sp.id;     -- it bolts
  end if;
  update public.wild_profile set day = p.day, kills = p.kills where account_id = v_acc;
  return jsonb_build_object('result', case when v_ok then 'ok' else 'fail' end, 'action', g.kind, 'species', sp.species,
                            'outcome', case when v_gave_up then 'gave_up' else v_out end, 'score', v_score, 'chance', v_chance,
                            'item', case when v_ok then s.drop_item end, 'qty', v_qty, 'xp', v_xp,
                            'knocked', v_knock, 'fainted', v_faint, 'wild', public._wild_json(v_acc, sp.map));
end $$;
revoke all on function public.wild_start(text, bigint, text, text, integer, integer) from public;
revoke all on function public.wild_finish(text, integer[], integer[], integer) from public;
grant execute on function public.wild_start(text, bigint, text, text, integer, integer) to anon, authenticated;
grant execute on function public.wild_finish(text, integer[], integer[], integer) to anon, authenticated;

-- ---------- C. The combo strike ----------
create or replace function public.combo_start(p_session_token text, p_kind text, p_ref bigint, p_target integer, p_map text,
                                              p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; g public.world_mg; f public.boss_fights; d record; r public.dungeon_runs;
        v_mine integer; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  v_acc := public._ac_account(p_session_token);
  if p_kind is null or p_kind not in ('boss', 'dungeon') then raise exception 'bad kind' using errcode = '22023'; end if;
  perform public._vitals_guard(v_acc);
  if p_kind = 'boss' then
    v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'combo_start', null, 'not in arena');
  else
    v_ac := public._pos_claim(v_acc, 'bai_dat', 60, 120, 'combo_start', null, 'not at gate');
  end if;
  if v_ac is not null then return v_ac; end if;
  g := public._wg_row(v_acc);
  if g.stun_until > now() then raise exception 'stunned' using errcode = '53400'; end if;
  if g.last_start > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  if p_kind = 'boss' then
    select * into pp from public.player_pos where account_id = v_acc;
    select * into f from public.boss_fights where id = p_ref;
    if not found then raise exception 'no boss' using errcode = '22023'; end if;
    select * into d from public._boss_defs() where id = f.boss;
    if f.status <> 'up' or now() < f.starts_at or now() >= f.ends_at then raise exception 'boss not up' using errcode = '53400'; end if;
    if f.room_key <> '00000000-0000-0000-0000-000000000000'::uuid
       and not exists (select 1 from public.members m where m.room_id = f.room_key and m.account_id = v_acc) then
      raise exception 'not in room' using errcode = '42501';
    end if;
    if pp.map is distinct from d.map or pp.x not between d.ax - 16 and d.ax + d.aw + 16 or pp.y not between d.ay - 16 and d.ay + d.ah + 16 then
      raise exception 'not in arena' using errcode = '22023';
    end if;
    select h.dmg into v_mine from public.boss_hits h where h.fight_id = f.id and h.account_id = v_acc;
    if coalesce(v_mine, 0) >= (f.max_hp * d.cap_pct) / 100 then raise exception 'damage cap' using errcode = '53400'; end if;
  else
    select * into r from public.dungeon_runs where id = p_ref;
    if not found or r.status <> 'open' or r.expires_at <= now() then raise exception 'run over' using errcode = '22023'; end if;
    if not exists (select 1 from public.dungeon_members where run_id = r.id and account_id = v_acc) then
      raise exception 'not joined' using errcode = '42501';
    end if;
    if public._party_of(v_acc) is distinct from r.party_id then raise exception 'not in party' using errcode = '42501'; end if;
  end if;
  perform public._stamina_spend(v_acc, 2, 'fight');
  insert into public.world_mg as w (account_id, kind, ref, target, species, danger, seed, started_at, open, last_start)
  values (v_acc, p_kind, p_ref, coalesce(p_target, 0), null, false, v_seed, now(), true, now())
  on conflict (account_id) do update
    set kind = excluded.kind, ref = excluded.ref, target = excluded.target, species = null, danger = false,
        seed = excluded.seed, started_at = excluded.started_at, open = true, last_start = excluded.last_start;
  return jsonb_build_object('round', jsonb_build_object('kind', p_kind, 'ref', p_ref, 'target', coalesce(p_target, 0),
                                                        'seed', v_seed, 'started_at', now()));
end $$;

create or replace function public.combo_finish(p_session_token text, p_keys integer[], p_dodges integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_ac jsonb; v_dmg integer := 0;
        v_stun boolean := false; f public.boss_fights; d record; h public.boss_hits; v_cap integer; v_hits integer := 0;
        r public.dungeon_runs; m public.dungeon_members; v_mobs integer[]; v_t integer; v_cleared boolean := false;
        v_judge text; v_streak integer;
begin
  v_acc := public._ac_account(p_session_token);
  select * into g from public.world_mg where account_id = v_acc for update;
  if not found or not g.open or g.kind not in ('boss', 'dungeon') then
    raise exception 'round not found' using errcode = '22023';
  end if;
  update public.world_mg set open = false where account_id = v_acc;
  if now() > g.started_at + interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  v_ev := jsonb_build_object('kind', g.kind, 'ref', g.ref, 'ticks', p_ticks, 'keys', to_jsonb(p_keys[1:12]), 'dodges', to_jsonb(p_dodges[1:3]));
  v_bad := public._wg_combo_error(p_keys, p_dodges, p_ticks);
  if v_bad is null then
    v_rep := public._wg_combo(g.seed, p_keys, p_dodges, p_ticks);
    if p_ticks > (v_rep->>'end')::int then v_bad := 'ticks'; end if;
  end if;
  if v_bad is not null then
    v_code := 'combo_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif now() < g.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
    v_code := 'combo_too_fast';
    v_ev := v_ev || jsonb_build_object('started_at', g.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
  elsif (v_rep->>'exact')::int >= 6 then
    perform public._ac_flag(v_acc, 'combo_timing', 'combo_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
    if (select count(*) from public.anticheat_events e
         where e.account_id = v_acc and e.code = 'combo_timing' and e.created_at > now() - interval '24 hours') >= 5 then
      v_code := 'combo_timing_repeat';
      v_ev := v_ev || jsonb_build_object('pattern', '5 in 24 h');
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_acc, v_code, 'combo_finish', v_ev, null, 'invalid round');
    return jsonb_build_object('result', 'lost', 'why', 'refused') || v_ac;
  end if;
  -- the slam: not dodged → the old strike-back and a 3 s stun
  if not (v_rep->>'dodged')::boolean then
    v_stun := true;
    update public.world_mg set stun_until = now() + interval '3 seconds' where account_id = v_acc;
    update public.vitals set hunger = greatest(1, hunger - 3), thirst = greatest(1, thirst - 3) where account_id = v_acc;
  end if;
  -- the arrows' damage: the old strike (40–60 × the streak's +15 %, ×1.75 max), a "good" arrow 75 %
  for i in 1 .. 6 loop
    v_judge := v_rep->'judges'->>(i - 1);
    continue when v_judge = 'miss';
    v_streak := (v_rep->'streaks'->>(i - 1))::int;
    v_hits := v_hits + 1;
    v_dmg := v_dmg + ((((40 + floor(random() * 21)::int) * (100 + 15 * least(v_streak - 1, 5))) / 100)
                      * case when v_judge = 'perfect' then 100 else 75 end) / 100;
  end loop;

  if g.kind = 'boss' then
    select * into f from public.boss_fights where id = g.ref for update;
    select * into d from public._boss_defs() where id = f.boss;
    if f.status <> 'up' or now() >= f.ends_at then
      return jsonb_build_object('result', 'lost', 'why', 'boss not up', 'judges', v_rep->'judges', 'stunned', v_stun);
    end if;
    insert into public.boss_hits (fight_id, account_id) values (f.id, v_acc) on conflict do nothing;
    select * into h from public.boss_hits where fight_id = f.id and account_id = v_acc for update;
    v_cap := (f.max_hp * d.cap_pct) / 100;
    if f.phase = 3 then v_dmg := (v_dmg * 4) / 5; end if;                       -- enraged: thicker hide
    v_dmg := greatest(0, least(v_dmg, v_cap - h.dmg, f.hp));
    if v_dmg > 0 then
      update public.boss_hits set dmg = dmg + v_dmg, hits = hits + v_hits, combo = (v_rep->>'best')::int, last_at = now()
       where fight_id = f.id and account_id = v_acc;
      f.hp := f.hp - v_dmg;
      f.phase := case when f.hp * 3 > f.max_hp * 2 then 1 when f.hp * 3 > f.max_hp then 2 else 3 end;
      perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', f.boss, 'fight', f.id, 'combo', (v_rep->>'best')::int));
      if f.hp <= 0 then
        update public.boss_fights set hp = 0, phase = 3, status = 'dead', killed_at = now(), killer = v_acc where id = f.id;
        perform public._boss_payout(f.id);
      else
        update public.boss_fights set hp = f.hp, phase = f.phase where id = f.id;
      end if;
    end if;
    return jsonb_build_object('result', 'ok', 'dmg', v_dmg, 'judges', v_rep->'judges', 'best', (v_rep->>'best')::int,
                              'dodged', not v_stun, 'stunned', v_stun, 'hp', greatest(0, f.hp), 'phase', f.phase,
                              'killed', f.hp <= 0, 'my_dmg', h.dmg + v_dmg, 'cap', v_cap);
  end if;

  select * into r from public.dungeon_runs where id = g.ref for update;
  if not found or r.status <> 'open' or r.expires_at <= now() then
    return jsonb_build_object('result', 'lost', 'why', 'run over', 'judges', v_rep->'judges', 'stunned', v_stun) || public._dg_json(v_acc);
  end if;
  select * into m from public.dungeon_members where run_id = r.id and account_id = v_acc for update;
  if not found or public._party_of(v_acc) is distinct from r.party_id then raise exception 'not in party' using errcode = '42501'; end if;
  v_mobs := r.mobs;
  v_t := case when g.target between 1 and coalesce(array_length(v_mobs, 1), 0) and v_mobs[g.target] > 0 then g.target
              else (select min(i) from generate_subscripts(v_mobs, 1) i where v_mobs[i] > 0) end;
  v_dmg := greatest(0, least(v_dmg, v_mobs[v_t]));
  if v_dmg > 0 then
    v_mobs[v_t] := v_mobs[v_t] - v_dmg;
    update public.dungeon_members set dmg = dmg + v_dmg, hits = hits + v_hits, combo = (v_rep->>'best')::int, last_at = now()
     where run_id = r.id and account_id = v_acc;
    if r.room = 4 then
      perform public._game_event(v_acc, 'boss_hit', v_dmg, jsonb_build_object('boss', 'doi_chua', 'dungeon', true, 'combo', (v_rep->>'best')::int));
    end if;
    if not exists (select 1 from unnest(v_mobs) x where x > 0) then
      if r.room >= 4 then
        update public.dungeon_runs set mobs = v_mobs, status = 'cleared', ended_at = now() where id = r.id;
        perform public._dg_payout(r.id);
        v_cleared := true;
      else
        update public.dungeon_runs set room = r.room + 1, mobs = public._dg_mobs(r.room + 1, r.scale) where id = r.id;
      end if;
    else
      update public.dungeon_runs set mobs = v_mobs where id = r.id;
    end if;
  end if;
  return jsonb_build_object('result', 'ok', 'dmg', v_dmg, 'target', v_t, 'judges', v_rep->'judges', 'best', (v_rep->>'best')::int,
                            'dodged', not v_stun, 'stunned', v_stun, 'bitten', v_stun, 'cleared', v_cleared) || public._dg_json(v_acc);
end $$;
revoke all on function public.combo_start(text, text, bigint, integer, text, integer, integer) from public;
revoke all on function public.combo_finish(text, integer[], integer[], integer) from public;
grant execute on function public.combo_start(text, text, bigint, integer, text, integer, integer) to anon, authenticated;
grant execute on function public.combo_finish(text, integer[], integer[], integer) to anon, authenticated;

-- ---------- D. The instant actions refuse (the page before 0083) ----------
-- wild_act / boss_attack / dungeon_attack (0075's, re-created by 0078): same signatures, the body now only refuses.
create or replace function public.wild_act(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;
create or replace function public.boss_attack(p_session_token text, p_fight bigint, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;
create or replace function public.dungeon_attack(p_session_token text, p_run bigint, p_target integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;
