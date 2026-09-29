-- =========================================================
-- 0085_pet_minigames.sql — v22 group "pets": the care minigames and the battle's power press. ADDITIVE and
-- re-runnable. Run after 0074 (pets v2) and 0077 (stamina).
--   A. The care rounds (lib/game/pets/minigames.ts, statement for statement; tests/fixtures/pet-care-cases.json pins
--      both): FEED "hứng đồ ăn" (_pcare_feed), PAT "gãi đúng chỗ" (_pcare_rub), PLAY "ném bóng" (_pcare_fetch), the
--      input rule (_pcare_input_error) and the gain (_pcare_gain: base × (0.4 + 0.6 × score‰)).
--   B. pet_care_start / pet_care_finish: the server's seed; the client sends only its packed inputs (+ the score it
--      saw); the replay decides. Hard pet_care_bad_input / pet_care_mismatch / pet_care_too_fast (a lost round); soft
--      pet_care_timing (perfect and machine-quick), the 5th in 24 h hard pet_care_timing_repeat. The score only scales
--      0074's affection / XP (feed 3 / 5, pat 2 / 3, play 5 / 10 at a full score) inside the 300 XP daily cap; the
--      food, the cooldowns (pat 60 s, play 10 min, set at the start) and fullness / happiness are 0074's.
--      PLAY spends 1 stamina (0077). The old instant buttons pet_pat / pet_feed / pet_play refuse with 'outdated'.
--   C. The power press: pet_battles gains a per-side seed (rolled by a trigger each turn), the press' power ‰ and an
--      exact-press count. battle_act_press(skill, press tick, ticks) replaces battle_act (now 'outdated'): the meter is
--      replayed (_ppress_power: 850–1150 ‰, no press 850), hard battle_press_bad_input / battle_press_too_fast, the 6th
--      press within 3 ‰ of the sweet spot in a battle is a soft battle_press_timing. The NPC / opponent side keeps its
--      server roll (its power stays 1000 ‰ unless that player pressed).
--      Re-created from 0074 (verbatim but for the lines marked 0085): _battle_turn (× the side's power ‰, 'power' in the
--      log), _battle_json ('press_seed' of the viewer's own side only).
--   D. A wipe (anticheat_wipes insert) drops the pending care rounds (own trigger).
-- game_events emitted: 'pet_care' (qty 1, meta {kind, score, permille}); 0074's pet_levelup / xp_grant via
--   _pet_care_xp; the battle events are unchanged.
-- Ledger reasons: none.
-- =========================================================

-- ---------- A. The rounds ----------
create or replace function public._pcare_ticks(p_kind text) returns integer
language sql immutable parallel safe
as $$ select case p_kind when 'feed' then 551 when 'pat' then 530 when 'play' then 820 end $$;

create or replace function public._pcare_gain(p_base integer, p_permille integer) returns integer
language sql immutable parallel safe
as $$ select ((p_base * (400000 + 600 * greatest(0, least(1000, p_permille))) + 500000) / 1000000)::integer $$;

-- The i-th treat's lane (0–4), for 12 treats.
create or replace function public._pcare_feed_lanes(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[] := '{}';
begin
  for i in 1 .. 12 loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || (r[1] % 5)::integer;
  end loop;
  return o;
end $$;

create or replace function public._pcare_rub_likes(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[] := '{}'; x integer;
begin
  for i in 1 .. 5 loop
    r := public._reel_rand(st);
    st := r[2];
    x := (r[1] % 5)::integer;
    if i > 1 and x = o[i - 1] then x := (x + 1) % 5; end if;
    o := o || x;
  end loop;
  return o;
end $$;

create or replace function public._pcare_fetch_flights(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[] := '{}';
begin
  for i in 1 .. 8 loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || (45 + r[1] % 41)::integer;
  end loop;
  return o;
end $$;

-- FEED: the bowl starts in lane 2; a move (tick × 8 + lane) counts from its tick; a treat is caught when the bowl is in
-- its lane on its landing tick (30 + 40 i + 80).
create or replace function public._pcare_feed(p_seed bigint, p_inputs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare lanes integer[] := public._pcare_feed_lanes(p_seed); n integer := coalesce(cardinality(p_inputs), 0);
        bowl integer := 2; j integer := 1; caught integer := 0; quick integer := 0; land integer; t integer; since integer;
begin
  for i in 0 .. 11 loop
    land := 30 + i * 40 + 80;
    while j <= n and p_inputs[j] / 8 <= land loop
      bowl := p_inputs[j] % 8;
      j := j + 1;
    end loop;
    if bowl = lanes[i + 1] then caught := caught + 1; end if;
  end loop;
  for k in 1 .. n loop
    t := p_inputs[k] / 8;
    if t >= 30 then
      since := (t - 30) % 40;
      if since < 4 and t - since < 30 + 12 * 40 then quick := quick + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('score', caught, 'permille', (caught * 1000) / 12, 'quick', quick,
                            'suspicious', caught = 12 and n >= 6 and quick * 10 >= n * 8);
end $$;

-- PAT: the zone (tick × 8 + zone; 0 lifted, 1–5 a spot) held on each tick from 30 on; good ticks are on the liked spot
-- of the tick's 100-tick segment; 400 good ticks are a full score.
create or replace function public._pcare_rub(p_seed bigint, p_inputs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare likes integer[] := public._pcare_rub_likes(p_seed); n integer := coalesce(cardinality(p_inputs), 0);
        zone integer := 0; j integer := 1; good integer := 0; quick integer := 0; s integer; hit boolean;
begin
  for t in 0 .. 529 loop
    while j <= n and p_inputs[j] / 8 <= t loop
      zone := p_inputs[j] % 8;
      j := j + 1;
    end loop;
    if t >= 30 and zone = likes[(t - 30) / 100 + 1] + 1 then good := good + 1; end if;
  end loop;
  for k in 0 .. 4 loop
    s := 30 + k * 100;
    hit := false;
    for m in 1 .. n loop
      if p_inputs[m] / 8 between s and s + 3 and p_inputs[m] % 8 = likes[k + 1] + 1 then hit := true; end if;
    end loop;
    if hit then quick := quick + 1; end if;
  end loop;
  return jsonb_build_object('score', good, 'permille', least(1000, (good * 1000) / 400), 'quick', quick, 'suspicious', quick >= 4);
end $$;

-- PLAY: throw i flies from 20 + 100 i for 45–85 ticks; the first press in its 100 ticks scores 2 within 6 ticks of the
-- landing, 1 within 13.
create or replace function public._pcare_fetch(p_seed bigint, p_inputs integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare fl integer[] := public._pcare_fetch_flights(p_seed); n integer := coalesce(cardinality(p_inputs), 0);
        pts integer := 0; exact integer := 0; s integer; p integer; d integer;
begin
  for i in 0 .. 7 loop
    s := 20 + i * 100;
    p := null;
    for m in 1 .. n loop
      if p_inputs[m] >= s and p_inputs[m] < s + 100 then p := p_inputs[m]; exit; end if;
    end loop;
    continue when p is null;
    d := abs(p - (s + fl[i + 1]));
    pts := pts + case when d <= 6 then 2 when d <= 13 then 1 else 0 end;
    if d = 0 then exact := exact + 1; end if;
  end loop;
  return jsonb_build_object('score', pts, 'permille', (pts * 1000) / 16, 'quick', exact, 'suspicious', exact >= 8);
end $$;

create or replace function public._pcare_replay(p_kind text, p_seed bigint, p_inputs integer[]) returns jsonb
language sql immutable parallel safe
as $$
  select case p_kind when 'feed' then public._pcare_feed(p_seed, p_inputs) when 'pat' then public._pcare_rub(p_seed, p_inputs)
                     else public._pcare_fetch(p_seed, p_inputs) end
$$;

-- careInputError: the fixed length; PLAY a press list (24, 4 in 60 ticks); FEED / PAT packed values (lane ≤ 4 /
-- zone ≤ 5) whose ticks follow the toggle rule (60 / 10 and 80 / 12).
create or replace function public._pcare_input_error(p_kind text, p_inputs integer[], p_ticks integer) returns text
language plpgsql immutable parallel safe
as $$
declare n integer := coalesce(cardinality(p_inputs), 0); at integer[] := '{}'; hi integer;
begin
  if p_ticks is null or p_ticks is distinct from public._pcare_ticks(p_kind) then return 'ticks'; end if;
  if p_kind = 'play' then return public._toggles_error(p_inputs, p_ticks, 820, 24, 4); end if;
  if n > 0 and (array_ndims(p_inputs) <> 1 or array_lower(p_inputs, 1) <> 1) then return 'shape'; end if;
  hi := case p_kind when 'feed' then 4 else 5 end;
  for i in 1 .. n loop
    if p_inputs[i] is null or p_inputs[i] < 0 then return 'range'; end if;
    if p_inputs[i] % 8 > hi then return 'value'; end if;
    at := at || (p_inputs[i] / 8);
  end loop;
  return case p_kind when 'feed' then public._toggles_error(at, p_ticks, p_ticks, 60, 10)
                     else public._toggles_error(at, p_ticks, p_ticks, 80, 12) end;
end $$;

-- The power meter: [period 60–100, centre 200–800 ‰]; a press' power ‰ = 1150 − 300 × min(off, 400) / 400; none 850.
create or replace function public._ppress_round(p_seed bigint) returns integer[]
language plpgsql immutable parallel safe
as $$
declare r1 bigint[] := public._reel_rand(coalesce(p_seed, 0) & 4294967295); r2 bigint[];
begin
  r2 := public._reel_rand(r1[2]);
  return array[(60 + r1[1] % 41)::integer, (200 + r2[1] % 601)::integer];
end $$;

create or replace function public._ppress_off(p_seed bigint, p_press integer) returns integer
language plpgsql immutable parallel safe
as $$
declare rd integer[] := public._ppress_round(p_seed);
begin
  return abs(public._mine_pos(rd[1], p_press) - rd[2]);
end $$;

create or replace function public._ppress_power(p_seed bigint, p_press integer) returns integer
language sql immutable parallel safe
as $$ select case when p_press is null then 850 else 1150 - (300 * least(public._ppress_off(p_seed, p_press), 400)) / 400 end $$;

create or replace function public._ppress_input_error(p_press integer, p_ticks integer) returns text
language sql immutable parallel safe
as $$ select case when p_ticks is null or p_ticks < 1 or p_ticks > 300 then 'ticks'
                  when p_press is not null and (p_press < 0 or p_press >= p_ticks) then 'range' end $$;

revoke all on function public._pcare_ticks(text) from public, anon, authenticated;
revoke all on function public._pcare_gain(integer, integer) from public, anon, authenticated;
revoke all on function public._pcare_feed_lanes(bigint) from public, anon, authenticated;
revoke all on function public._pcare_rub_likes(bigint) from public, anon, authenticated;
revoke all on function public._pcare_fetch_flights(bigint) from public, anon, authenticated;
revoke all on function public._pcare_feed(bigint, integer[]) from public, anon, authenticated;
revoke all on function public._pcare_rub(bigint, integer[]) from public, anon, authenticated;
revoke all on function public._pcare_fetch(bigint, integer[]) from public, anon, authenticated;
revoke all on function public._pcare_replay(text, bigint, integer[]) from public, anon, authenticated;
revoke all on function public._pcare_input_error(text, integer[], integer) from public, anon, authenticated;
revoke all on function public._ppress_round(bigint) from public, anon, authenticated;
revoke all on function public._ppress_off(bigint, integer) from public, anon, authenticated;
revoke all on function public._ppress_power(bigint, integer) from public, anon, authenticated;
revoke all on function public._ppress_input_error(integer, integer) from public, anon, authenticated;

-- ---------- B. Care RPCs ----------
create table if not exists public.pet_care_rounds (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  pet_id bigint not null references public.pets(id) on delete cascade,
  kind text not null check (kind in ('feed','pat','play')),
  seed bigint not null,
  started_at timestamptz not null default now()
);
alter table public.pet_care_rounds enable row level security;
revoke all on public.pet_care_rounds from anon, authenticated;

-- Start a care round with my pet: FEED needs its food (eaten at the end), PAT and PLAY 0074's gates and cooldowns (set
-- now), PLAY a toy and 1 stamina. One round at a time (a new one replaces it), at most one start a second.
create or replace function public.pet_care_start(p_session_token text, p_pet bigint, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); p public.pets; v_seed bigint := floor(random() * 4294967296)::bigint;
begin
  if p_kind is null or p_kind not in ('feed','pat','play') then raise exception 'bad kind' using errcode = '22023'; end if;
  if exists (select 1 from public.pet_care_rounds where account_id = v_account and started_at > now() - interval '1 second') then
    raise exception 'too soon' using errcode = '53400';
  end if;
  p := public._pet_mine(v_account, p_pet);
  if p_kind = 'feed' then
    if not exists (select 1 from public.pet_items where account_id = v_account and item_id = 'food_' || p.species and qty > 0) then
      raise exception 'no food' using errcode = '53400';
    end if;
  elsif p_kind = 'pat' then
    if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
    if p.pat_at > now() - interval '60 seconds' then raise exception 'too soon' using errcode = '53400'; end if;
    update public.pets set pat_at = now() where id = p.id;
  else
    if p.fullness <= 0 then raise exception 'sulking' using errcode = '53400'; end if;
    if not exists (select 1 from public.pet_items i join public.pet_item_catalog c on c.id = i.item_id
                    where i.account_id = v_account and i.qty > 0 and c.kind = 'toy' and c.species = p.species) then
      raise exception 'no toy' using errcode = '53400';
    end if;
    if p.played_at > now() - interval '10 minutes' then raise exception 'too soon' using errcode = '53400'; end if;
    perform public._stamina_spend(v_account, 1, null);
    update public.pets set played_at = now() where id = p.id;
  end if;
  insert into public.pet_care_rounds (account_id, pet_id, kind, seed, started_at)
  values (v_account, p.id, p_kind, v_seed, now())
  on conflict (account_id) do update set pet_id = excluded.pet_id, kind = excluded.kind, seed = excluded.seed,
                                         started_at = excluded.started_at;
  return public._pets_state(v_account)
         || jsonb_build_object('round', jsonb_build_object('pet', p.id, 'kind', p_kind, 'seed', v_seed,
                                                           'ticks', public._pcare_ticks(p_kind)));
end $$;

-- The end of a care round (single use, 2 minutes at most). The inputs are replayed from the round's seed.
create or replace function public.pet_care_finish(p_session_token text, p_inputs integer[], p_ticks integer, p_score integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); r public.pet_care_rounds; p public.pets; v_bad text;
        v_rep jsonb; v_code text; v_ev jsonb; v_ac jsonb; v_pm integer; v_aff integer; v_xp integer; v_got integer;
        v_base_aff integer; v_base_xp integer;
begin
  delete from public.pet_care_rounds where account_id = v_account returning * into r;
  if not found then raise exception 'no round' using errcode = '22023'; end if;
  if now() > r.started_at + interval '120 seconds' then
    return public._pets_state(v_account) || jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  v_ev := jsonb_build_object('kind', r.kind, 'pet', r.pet_id, 'ticks', p_ticks, 'score', p_score,
                             'n', coalesce(cardinality(p_inputs), 0), 'inputs', to_jsonb(p_inputs[1:80]));
  v_bad := coalesce(public._pcare_input_error(r.kind, p_inputs, p_ticks), case when p_score is null then 'score' end);
  if v_bad is not null then
    v_code := 'pet_care_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._pcare_replay(r.kind, r.seed, p_inputs);
    if (v_rep->>'score')::int <> p_score then
      v_code := 'pet_care_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', r.seed, 'replay', v_rep);
    elsif now() < r.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'pet_care_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', r.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    elsif (v_rep->>'suspicious')::boolean then
      perform public._ac_flag(v_account, 'pet_care_timing', 'pet_care_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'pet_care_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'pet_care_timing_repeat';
        v_ev := v_ev || jsonb_build_object('replay', v_rep, 'pattern', '5 in 24 h');
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'pet_care_finish', v_ev, null, 'invalid round');
    return public._pets_state(v_account) || jsonb_build_object('result', 'lost', 'why', 'refused') || v_ac;
  end if;
  select * into p from public.pets where id = r.pet_id and account_id = v_account for update;
  if not found then raise exception 'not your pet' using errcode = '22023'; end if;
  p := public._pet_now(p);
  v_pm := (v_rep->>'permille')::int;
  v_base_aff := case r.kind when 'feed' then 3 when 'pat' then 2 else 5 end;
  v_base_xp := case r.kind when 'feed' then 5 when 'pat' then 3 else 10 end;
  v_aff := public._pcare_gain(v_base_aff, v_pm);
  v_xp := public._pcare_gain(v_base_xp, v_pm);
  if r.kind = 'feed' then
    update public.pet_items set qty = qty - 1
     where account_id = v_account and item_id = 'food_' || p.species and qty > 0;
    if not found then raise exception 'no food' using errcode = '53400'; end if;
    update public.pets set fullness = least(100, p.fullness + 40), happy = least(100, p.happy + 5), stats_at = now(),
      affection = least(100, p.affection + v_aff) where id = p.id;
  elsif r.kind = 'pat' then
    update public.pets set affection = least(100, p.affection + v_aff) where id = p.id;
  else
    update public.pets set fullness = p.fullness, happy = least(100, p.happy + 25), stats_at = now(),
      affection = least(100, p.affection + v_aff) where id = p.id;
  end if;
  v_got := public._pet_care_xp(v_account, p.id, v_xp);
  perform public._game_event(v_account, 'pet_care', 1, jsonb_build_object('kind', r.kind, 'score', p_score, 'permille', v_pm));
  return public._pets_state(v_account)
         || jsonb_build_object('result', 'done', 'kind', r.kind, 'score', p_score, 'permille', v_pm,
                               'affection', v_aff, 'xp', v_got);
end $$;

-- The old instant buttons refuse (the pages that still call them are older than the minigames).
create or replace function public.pet_pat(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;
create or replace function public.pet_feed(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;
create or replace function public.pet_play(p_session_token text, p_pet bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;

-- ---------- C. The power press ----------
alter table public.pet_battles add column if not exists ps1 bigint;
alter table public.pet_battles add column if not exists ps2 bigint;
alter table public.pet_battles add column if not exists pw1 smallint not null default 1000;
alter table public.pet_battles add column if not exists pw2 smallint not null default 1000;
alter table public.pet_battles add column if not exists px1 smallint not null default 0;
alter table public.pet_battles add column if not exists px2 smallint not null default 0;

-- A fresh meter for both sides whenever a battle becomes active or a turn resolves.
create or replace function public._pet_battle_press_seed() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active' or new.turn is distinct from old.turn
                                or new.ps1 is null) then
    new.ps1 := floor(random() * 4294967296)::bigint;
    new.ps2 := floor(random() * 4294967296)::bigint;
    new.pw1 := 1000;
    new.pw2 := 1000;
  end if;
  return new;
end $$;
revoke all on function public._pet_battle_press_seed() from public, anon, authenticated;
drop trigger if exists pet_battles_press_seed on public.pet_battles;
create trigger pet_battles_press_seed before insert or update on public.pet_battles
  for each row execute function public._pet_battle_press_seed();
update public.pet_battles set ps1 = null where status = 'active' and ps1 is null;   -- the trigger seeds running battles

-- _battle_turn (0074_pets_aquarium.sql's, verbatim but for the lines marked 0085)
create or replace function public._battle_turn(p_id bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.pet_battles; f jsonb[]; hp int[]; mx int[]; heals int[]; act text[]; grd boolean[]; ord int[];
        me int; foe int; s public.pet_skill_catalog; lg jsonb := '[]'::jsonb; v_dmg int; v_crit boolean; v_heal int;
        v_win smallint;
        pw int[];                                                                                        -- 0085
begin
  select * into b from public.pet_battles where id = p_id for update;
  if b.status <> 'active' or b.a1 is null or b.a2 is null then return; end if;
  f := array[b.f1, b.f2];
  hp := array[b.hp1, b.hp2];
  mx := array[(b.f1->>'hp')::int, (b.f2->>'hp')::int];
  heals := array[b.heals1::int, b.heals2::int];
  act := array[b.a1, b.a2];
  grd := array[b.a1 = 'guard', b.a2 = 'guard'];
  pw := array[coalesce(b.pw1, 1000)::int, coalesce(b.pw2, 1000)::int];                                -- 0085
  if (f[1]->>'spd')::int > (f[2]->>'spd')::int or ((f[1]->>'spd')::int = (f[2]->>'spd')::int and random() < 0.5) then
    ord := array[1, 2];
  else
    ord := array[2, 1];
  end if;
  foreach me in array ord loop
    foe := 3 - me;
    continue when hp[me] <= 0 or hp[foe] <= 0;
    select * into s from public.pet_skill_catalog where id = act[me];
    if s.kind = 'guard' then
      lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'guard', true);
    elsif s.kind = 'heal' then
      if heals[me] < 2 then
        v_heal := least(mx[me] - hp[me], round(mx[me] * 0.25)::int);
        hp[me] := hp[me] + v_heal; heals[me] := heals[me] + 1;
        lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'heal', v_heal);
      else
        lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'fail', true);
      end if;
    elsif random() * 100 >= s.acc then
      lg := lg || jsonb_build_object('who', me, 'skill', s.id, 'miss', true);
    else
      v_crit := random() < 0.08;
      v_dmg := public._battle_dmg(s.power, (f[me]->>'atk')::int, (f[foe]->>'def')::int, random()::numeric, v_crit, grd[foe]);
      v_dmg := greatest(1, round(v_dmg * pw[me] / 1000.0))::int;                                       -- 0085
      hp[foe] := greatest(0, hp[foe] - v_dmg);
      lg := lg || (jsonb_build_object('who', me, 'skill', s.id, 'dmg', v_dmg, 'crit', v_crit, 'guarded', grd[foe])
                   || jsonb_build_object('power', pw[me]));                                              -- 0085
    end if;
  end loop;
  update public.pet_battles set hp1 = hp[1], hp2 = hp[2], heals1 = heals[1], heals2 = heals[2], a1 = null, a2 = null,
    turn = b.turn + 1, log = lg, acted_at = now() where id = p_id;
  if hp[1] <= 0 or hp[2] <= 0 or b.turn >= public._pv2('max_turns') then
    v_win := case when hp[2] <= 0 and hp[1] > 0 then 1 when hp[1] <= 0 and hp[2] > 0 then 2
                  when hp[1]::numeric / mx[1] > hp[2]::numeric / mx[2] then 1
                  when hp[1]::numeric / mx[1] < hp[2]::numeric / mx[2] then 2 else 0 end;
    perform public._battle_finish(p_id, v_win);
  end if;
end $$;
revoke all on function public._battle_turn(bigint) from public, anon, authenticated;

-- _battle_json (0074_pets_aquarium.sql's, verbatim but for the lines marked 0085)
create or replace function public._battle_json(b public.pet_battles, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('id', b.id, 'mode', b.mode, 'status', b.status, 'side', case when b.p1 = p_viewer then 1 else 2 end,
    'npc', b.npc, 'turn', b.turn, 'f1', b.f1, 'f2', b.f2, 'hp1', b.hp1, 'hp2', b.hp2, 'log', b.log, 'stake', b.stake,
    'winner', b.winner, 'reward', b.reward,
    'p1_name', (select username from public.accounts where id = b.p1),
    'p2_name', (select username from public.accounts where id = b.p2),
    'acted', case when b.p1 = p_viewer then b.a1 is not null else b.a2 is not null end,
    'foe_acted', case when b.p1 = p_viewer then b.a2 is not null else b.a1 is not null end,
    'deadline_ms', (extract(epoch from b.acted_at + interval '120 seconds') * 1000)::bigint)
    || jsonb_build_object('press_seed', case when b.status <> 'active' then null                        -- 0085
                                             when b.p1 = p_viewer then b.ps1 else b.ps2 end)             -- 0085
$$;
revoke all on function public._battle_json(public.pet_battles, uuid) from public, anon, authenticated;

-- Pick this turn's skill with a power press (0074's battle_act plus the meter). The press tick is replayed on my side's
-- seed; its power ‰ scales my hits this turn. PvE: the NPC picks at once and the turn resolves; PvP: when both picked.
create or replace function public.battle_act_press(p_session_token text, p_battle bigint, p_skill text, p_press integer,
                                                   p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); b public.pet_battles; v_side int; v_bad text; v_code text;
        v_ev jsonb; v_ac jsonb; v_seed bigint; v_pw int; v_exact int;
begin
  perform public._battle_sweep();
  select * into b from public.pet_battles where id = p_battle for update;
  if not found or b.status <> 'active' or (b.p1 <> v_account and b.p2 is distinct from v_account) then
    raise exception 'no battle' using errcode = '22023';
  end if;
  v_side := case when b.p1 = v_account then 1 else 2 end;
  if not ((case v_side when 1 then b.f1 else b.f2 end)->'skills' ? p_skill) then
    raise exception 'unknown skill' using errcode = '22023';
  end if;
  if (case v_side when 1 then b.a1 else b.a2 end) is not null then raise exception 'already acted' using errcode = '53400'; end if;
  if b.mode = 'pve' and b.acted_at > now() - interval '300 milliseconds' then raise exception 'too soon' using errcode = '53400'; end if;
  v_ev := jsonb_build_object('battle', b.id, 'turn', b.turn, 'press', p_press, 'ticks', p_ticks);
  v_bad := public._ppress_input_error(p_press, p_ticks);
  if v_bad is not null then
    v_code := 'battle_press_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif now() < b.acted_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
    v_code := 'battle_press_too_fast';
    v_ev := v_ev || jsonb_build_object('acted_at', b.acted_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'battle_act_press', v_ev, null, 'invalid press');
    return public._battle_state(v_account, null) || v_ac;
  end if;
  v_seed := case v_side when 1 then b.ps1 else b.ps2 end;
  v_pw := public._ppress_power(v_seed, p_press);
  v_exact := case when p_press is not null and public._ppress_off(v_seed, p_press) <= 3 then 1 else 0 end;
  if v_side = 1 then
    update public.pet_battles set a1 = p_skill, pw1 = v_pw, px1 = px1 + v_exact,
      a2 = case when b.mode = 'pve' then public._battle_ai(b.f2, b.hp2, b.heals2) else a2 end where id = b.id;
  else
    update public.pet_battles set a2 = p_skill, pw2 = v_pw, px2 = px2 + v_exact where id = b.id;
  end if;
  if v_exact = 1 and (case v_side when 1 then b.px1 else b.px2 end) + 1 = 6 then
    perform public._ac_flag(v_account, 'battle_press_timing', 'battle_act_press',
                            v_ev || jsonb_build_object('exact', 6, 'seed', v_seed), null, null, false);
  end if;
  perform public._battle_turn(b.id);
  return public._battle_state(v_account, null)
         || jsonb_build_object('battle_now', (select public._battle_json(x, v_account) from public.pet_battles x where x.id = b.id),
                               'power', v_pw);
end $$;

-- The old pick without a press refuses.
create or replace function public.battle_act(p_session_token text, p_battle bigint, p_skill text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._ac_account(p_session_token);
  raise exception 'outdated' using errcode = '22023';
end $$;

-- ---------- D. A wipe ----------
create or replace function public._pet_care_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.pet_care_rounds where account_id = new.account_id;
  return null;
end $$;
revoke all on function public._pet_care_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_pet_care on public.anticheat_wipes;
create trigger anticheat_wipes_pet_care after insert on public.anticheat_wipes for each row execute function public._pet_care_wipe();

-- ---------- Grants ----------
revoke all on function public.pet_care_start(text, bigint, text) from public;
revoke all on function public.pet_care_finish(text, integer[], integer, integer) from public;
revoke all on function public.battle_act_press(text, bigint, text, integer, integer) from public;
revoke all on function public.pet_pat(text, bigint) from public;
revoke all on function public.pet_feed(text, bigint) from public;
revoke all on function public.pet_play(text, bigint) from public;
revoke all on function public.battle_act(text, bigint, text) from public;
grant execute on function public.pet_care_start(text, bigint, text) to anon, authenticated;
grant execute on function public.pet_care_finish(text, integer[], integer, integer) to anon, authenticated;
grant execute on function public.battle_act_press(text, bigint, text, integer, integer) to anon, authenticated;
grant execute on function public.pet_pat(text, bigint) to anon, authenticated;
grant execute on function public.pet_feed(text, bigint) to anon, authenticated;
grant execute on function public.pet_play(text, bigint) to anon, authenticated;
grant execute on function public.battle_act(text, bigint, text) to anon, authenticated;
