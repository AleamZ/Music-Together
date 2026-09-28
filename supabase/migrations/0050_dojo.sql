-- =========================================================
-- 0050_dojo.sql — v20.2 Võ đường (spec docs/superpowers/specs/2026-09-28-v20-fight-design.md §v20.2, plan
-- docs/superpowers/plans/2026-09-28-v20-2-dojo.md). ADDITIVE and re-runnable. Run right after 0049.
--   A. martial_styles, martial_belts (seeded; lib/game/fight/dojo.ts and styles.ts mirror them, pinned by
--      tests/unit/dojo-sql.test.ts), martial_enrollments, martial_exams (one live exam per account).
--   B. The seven uniforms (vp_*): item_catalog rows in slot 'outfit', unisex, price 0, not starter — granted by
--      dojo_enroll, never sold, given or bought (E).
--   C. The kata (lib/game/fight/kata.ts, statement for statement): _kata_chart(seed, notes, tpb, half),
--      _kata_score(chart, presses) → {points, perfect, good, miss, extra, worst}, _kata_input_error(chart, presses).
--      tests/fixtures/kata-cases.json pins them (Vitest + tests/sql/v20-2-smoke.sql).
--   D. RPCs dojo_state, dojo_enroll (ledger dojo_tuition, 2 000 xu), dojo_exam_start (ledger dojo_exam, the belt's fee),
--      dojo_kata_submit (a pass creates the exam's fight_matches row: the sparring match against the master bot), and
--      _dojo_exam_settle (0049's _fx_settle calls it: a win ties the next belt, a loss sets the cooldown).
--   E. buy_fashion_item (latest 0022), sell_fashion_item and transfer_fashion_item (latest 0029) refuse uniforms
--      with 'uniform' (the marked lines).
--   F. _in_shade (0041's body) plus the dojo gate's awning ('market', 860, 248, 120, 36) (R7).
--   G. The ledger: 0043's 43 reasons plus dojo_tuition and dojo_exam: 45.
-- Anti-cheat: hard kata_bad_input (malformed presses) and kata_too_fast (sooner than 0.95 × the chart's length after
-- the exam started) fail the attempt; soft kata_perfect (every note within ±1 tick, ≥ 24 notes).
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.martial_styles (
  id text primary key,
  name text not null,
  atk integer not null, def integer not null, walk integer not null, jump integer not null, energy integer not null,
  uniform text not null,
  sort smallint not null unique                      -- the engine's style id (1–7)
);
alter table public.martial_styles enable row level security;
revoke all on public.martial_styles from anon, authenticated;

create table if not exists public.martial_belts (
  style text not null references public.martial_styles(id) on delete cascade,
  rank smallint not null check (rank between 0 and 4),
  name text not null,
  color text not null,
  exam_fee integer not null default 0,              -- the exam that reaches this rank
  min_hours integer not null default 0,             -- at the previous rank (rank 1: after enrolling)
  fail_cooldown_min integer not null default 0,
  kata_notes integer not null default 0,
  kata_tpb integer not null default 0,
  kata_pass_pct integer not null default 0,
  bot_level integer not null default 0,
  primary key (style, rank)
);
alter table public.martial_belts enable row level security;
revoke all on public.martial_belts from anon, authenticated;

create table if not exists public.martial_enrollments (
  account_id uuid not null references public.accounts(id) on delete cascade,
  style text not null references public.martial_styles(id) on delete cascade,
  rank smallint not null default 0 check (rank between 0 and 4),
  rank_at timestamptz not null default now(),
  enrolled_at timestamptz not null default now(),
  exam_cooldown_until timestamptz null,
  primary key (account_id, style)
);
alter table public.martial_enrollments enable row level security;
revoke all on public.martial_enrollments from anon, authenticated;

create table if not exists public.martial_exams (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  style text not null references public.martial_styles(id) on delete cascade,
  target_rank smallint not null check (target_rank between 1 and 4),
  fee integer not null,
  kata_seed bigint not null,
  kata_score integer null,
  status text not null default 'kata' check (status in ('kata', 'spar', 'passed', 'failed', 'expired')),
  match_id uuid null references public.fight_matches(id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index if not exists martial_exams_one_live on public.martial_exams (account_id) where status in ('kata', 'spar');
create index if not exists martial_exams_match on public.martial_exams (match_id);
alter table public.martial_exams enable row level security;
revoke all on public.martial_exams from anon, authenticated;

-- ---------- B. Seeds: the styles (moves.ts style rows), the belts (dojo.ts EXAMS and MARTIAL), the uniforms ----------
insert into public.item_catalog (id, slot, name, price, starter, sort_order, gender) values
  ('vp_vovinam',   'outfit', 'Võ phục Vovinam', 0, false, 900, 'unisex'),
  ('vp_muaythai',  'outfit', 'Đồ Muay Thai',    0, false, 901, 'unisex'),
  ('vp_karate',    'outfit', 'Võ phục Karate',  0, false, 902, 'unisex'),
  ('vp_taekwondo', 'outfit', 'Dobok Taekwondo', 0, false, 903, 'unisex'),
  ('vp_boxing',    'outfit', 'Đồ Quyền Anh',    0, false, 904, 'unisex'),
  ('vp_judo',      'outfit', 'Judogi',          0, false, 905, 'unisex'),
  ('vp_vinhxuan',  'outfit', 'Áo Vịnh Xuân',    0, false, 906, 'unisex')
on conflict (id) do update set
  slot = excluded.slot, name = excluded.name, price = excluded.price,
  starter = excluded.starter, sort_order = excluded.sort_order, gender = excluded.gender;

insert into public.martial_styles (id, name, atk, def, walk, jump, energy, uniform, sort) values
  ('vovinam',   'Vovinam',   100, 100, 105, 110, 100, 'vp_vovinam',   1),
  ('muaythai',  'Muay Thai', 110,  95,  95,  95, 100, 'vp_muaythai',  2),
  ('karate',    'Karate',    105, 100, 100, 100, 100, 'vp_karate',    3),
  ('taekwondo', 'Taekwondo', 100,  95, 105, 105, 100, 'vp_taekwondo', 4),
  ('boxing',    'Quyền Anh', 108, 100, 110,  85, 110, 'vp_boxing',    5),
  ('judo',      'Judo',       95, 110,  90,  90, 100, 'vp_judo',      6),
  ('vinhxuan',  'Vịnh Xuân',  95, 105, 100,  95, 115, 'vp_vinhxuan',  7)
on conflict (id) do update set
  name = excluded.name, atk = excluded.atk, def = excluded.def, walk = excluded.walk, jump = excluded.jump,
  energy = excluded.energy, uniform = excluded.uniform, sort = excluded.sort;

insert into public.martial_belts (style, rank, name, color, exam_fee, min_hours, fail_cooldown_min, kata_notes, kata_tpb, kata_pass_pct, bot_level)
select s.id, r.rank, b.name, b.color, r.fee, r.hours, r.cool, r.notes, r.tpb, r.pass, r.bot
  from (values
    ('vovinam',   0, 'Tự vệ',            '#9fd3f0'), ('vovinam',   1, 'Lam đai',       '#2d62c9'), ('vovinam',   2, 'Hoàng đai',        '#e8c43a'),
    ('vovinam',   3, 'Hồng đai',         '#d0342c'), ('vovinam',   4, 'Bạch đai',      '#f6f6f2'),
    ('muaythai',  0, 'Prajioud trắng',   '#f6f6f2'), ('muaythai',  1, 'Prajioud vàng', '#e8c43a'), ('muaythai',  2, 'Prajioud xanh lá', '#3f9b43'),
    ('muaythai',  3, 'Prajioud đỏ',      '#d0342c'), ('muaythai',  4, 'Prajioud đen',  '#1b1b1f'),
    ('karate',    0, 'Đai trắng',        '#f6f6f2'), ('karate',    1, 'Đai vàng',      '#e8c43a'), ('karate',    2, 'Đai xanh lá',      '#3f9b43'),
    ('karate',    3, 'Đai nâu',          '#7a4a26'), ('karate',    4, 'Đai đen',       '#1b1b1f'),
    ('taekwondo', 0, 'Đai trắng',        '#f6f6f2'), ('taekwondo', 1, 'Đai vàng',      '#e8c43a'), ('taekwondo', 2, 'Đai xanh lá',      '#3f9b43'),
    ('taekwondo', 3, 'Đai đỏ',           '#d0342c'), ('taekwondo', 4, 'Đai đen',       '#1b1b1f'),
    ('boxing',    0, 'Tân binh',         '#f6f6f2'), ('boxing',    1, 'Nghiệp dư',     '#2d62c9'), ('boxing',    2, 'Bán chuyên',       '#d0342c'),
    ('boxing',    3, 'Chuyên nghiệp',    '#e8c43a'), ('boxing',    4, 'Nhà vô địch',   '#d9a92a'),
    ('judo',      0, 'Đai trắng',        '#f6f6f2'), ('judo',      1, 'Đai vàng',      '#e8c43a'), ('judo',      2, 'Đai cam',          '#e8862e'),
    ('judo',      3, 'Đai xanh lá',      '#3f9b43'), ('judo',      4, 'Đai đen',       '#1b1b1f'),
    ('vinhxuan',  0, 'Sơ cấp',           '#f6f6f2'), ('vinhxuan',  1, 'Trung cấp',     '#2d62c9'), ('vinhxuan',  2, 'Cao cấp',          '#d0342c'),
    ('vinhxuan',  3, 'Truyền nhân',      '#e8c43a'), ('vinhxuan',  4, 'Sư phụ',        '#1b1b1f')
  ) b(style, rank, name, color)
  join public.martial_styles s on s.id = b.style
  join (values
    (0,     0,  0,    0,  0,  0,  0, 0),
    (1,  1000,  2,   30, 18, 40, 60, 1),
    (2,  2500, 24,  120, 24, 36, 65, 2),
    (3,  5000, 48,  360, 30, 32, 70, 3),
    (4, 10000, 96, 1440, 36, 28, 75, 4)
  ) r(rank, fee, hours, cool, notes, tpb, pass, bot) on r.rank = b.rank
on conflict (style, rank) do update set
  name = excluded.name, color = excluded.color, exam_fee = excluded.exam_fee, min_hours = excluded.min_hours,
  fail_cooldown_min = excluded.fail_cooldown_min, kata_notes = excluded.kata_notes, kata_tpb = excluded.kata_tpb,
  kata_pass_pct = excluded.kata_pass_pct, bot_level = excluded.bot_level;

-- ---------- C. The kata (kata.ts; plan ruling P17) ----------
-- The chart: [tick, lane, …]; the first note at tick 180, then a beat (or, with p_half, a half beat for 20 % of the
-- gaps: one roll before each later note), each lane one roll u % 8, bumped when it would be the third in a row.
create or replace function public._kata_chart(p_seed bigint, p_notes integer, p_tpb integer, p_half boolean) returns integer[]
language plpgsql immutable parallel safe
as $$
declare out_ integer[] := '{}'; st bigint := p_seed & 4294967295; r bigint[]; tick integer := 180; i integer;
        gap integer; lane integer; p1 integer := -1; p2 integer := -1;
begin
  for i in 0..p_notes - 1 loop
    if i > 0 then
      gap := p_tpb;
      if p_half then
        r := public._reel_rand(st);
        st := r[2];
        if r[1] % 100 < 20 then gap := p_tpb / 2; end if;
      end if;
      tick := tick + gap;
    end if;
    r := public._reel_rand(st);
    st := r[2];
    lane := (r[1] % 8)::integer;
    if lane = p1 and lane = p2 then lane := (lane + 1) % 8; end if;
    out_ := out_ || array[tick, lane];
    p2 := p1;
    p1 := lane;
  end loop;
  return out_;
end $$;

-- why presses are malformed (null: fine): shape / count / tick / lane / order / crowd / late (kataInputError)
create or replace function public._kata_input_error(p_chart integer[], p_presses integer[]) returns text
language plpgsql immutable parallel safe
as $$
declare n integer; notes integer := coalesce(cardinality(p_chart), 0) / 2; len integer; i integer; t integer; l integer;
        prev integer := -1; same integer := 0;
begin
  if p_presses is null then return 'shape'; end if;
  n := coalesce(cardinality(p_presses), 0);
  if n = 0 then return null; end if;
  if array_ndims(p_presses) <> 1 or array_lower(p_presses, 1) <> 1 or n % 2 <> 0 then return 'shape'; end if;
  if n / 2 > 3 * notes then return 'count'; end if;
  len := case when notes > 0 then p_chart[2 * notes - 1] else 180 end + 30;
  for i in 1..n by 2 loop
    t := p_presses[i];
    l := p_presses[i + 1];
    if t is null or t < 0 then return 'tick'; end if;
    if l is null or l < 0 or l >= 8 then return 'lane'; end if;
    if t < prev then return 'order'; end if;
    same := case when t = prev then same + 1 else 1 end;
    if same > 2 then return 'crowd'; end if;
    if t > len then return 'late'; end if;
    prev := t;
  end loop;
  return null;
end $$;

-- {points (floored at 0), perfect, good, miss, extra, worst |Δ| (−1: none)}: press by press, the nearest unjudged
-- note of its lane within 9 ticks (the earlier on a tie): ≤ 4 → 2 points, else 1; none → −1 (kataScore)
create or replace function public._kata_score(p_chart integer[], p_presses integer[]) returns integer[]
language plpgsql immutable parallel safe
as $$
declare notes integer := coalesce(cardinality(p_chart), 0) / 2; judged boolean[]; i integer; k integer; t integer;
        l integer; best integer; best_d integer; d integer; points integer := 0; perfect integer := 0; good integer := 0;
        extra integer := 0; worst integer := -1;
begin
  judged := array_fill(false, array[greatest(notes, 1)]);
  for i in 1..coalesce(cardinality(p_presses), 0) by 2 loop
    t := p_presses[i];
    l := p_presses[i + 1];
    best := -1;
    best_d := 10;
    for k in 1..notes loop
      if judged[k] or p_chart[2 * k] <> l then continue; end if;
      d := abs(p_chart[2 * k - 1] - t);
      if d < best_d then best := k; best_d := d; end if;
    end loop;
    if best < 0 then
      points := points - 1;
      extra := extra + 1;
      continue;
    end if;
    judged[best] := true;
    if best_d > worst then worst := best_d; end if;
    if best_d <= 4 then points := points + 2; perfect := perfect + 1;
    else points := points + 1; good := good + 1; end if;
  end loop;
  return array[greatest(0, points), perfect, good, notes - perfect - good, extra, worst];
end $$;

-- ---------- D. The dojo ----------
create or replace function public._dojo_ms(t timestamptz) returns bigint
language sql immutable set search_path = public, extensions
as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- A kata-phase exam past its 20 minutes is expired (a fail: the cooldown applies) — plan ruling P7
create or replace function public._dojo_sweep(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare ex public.martial_exams;
begin
  for ex in select * from public.martial_exams where account_id = p_account and status = 'kata' and expires_at < now() for update loop
    update public.martial_exams set status = 'expired' where id = ex.id;
    update public.martial_enrollments e
       set exam_cooldown_until = now() + make_interval(mins => b.fail_cooldown_min)
      from public.martial_belts b
     where e.account_id = p_account and e.style = ex.style and b.style = ex.style and b.rank = ex.target_rank;
  end loop;
end $$;

-- Everything the dojo panel shows: the server's copy of the styles and belts, my enrollments, my uniforms, the outfit
-- I wear, my live exam (with its match while sparring).
create or replace function public._dojo_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'styles', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'idx', s.sort, 'name', s.name, 'atk', s.atk, 'def', s.def, 'walk', s.walk, 'jump', s.jump,
        'energy', s.energy, 'uniform', s.uniform,
        'belts', (select jsonb_agg(jsonb_build_object('rank', b.rank, 'name', b.name, 'color', b.color, 'exam_fee', b.exam_fee,
                    'min_hours', b.min_hours, 'fail_cooldown_min', b.fail_cooldown_min, 'kata_notes', b.kata_notes,
                    'kata_tpb', b.kata_tpb, 'kata_pass_pct', b.kata_pass_pct, 'bot_level', b.bot_level) order by b.rank)
                    from public.martial_belts b where b.style = s.id)) order by s.sort), '[]'::jsonb)
      from public.martial_styles s),
    'tuition', 2000,
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object(
        'style', e.style, 'rank', e.rank, 'rank_at_ms', public._dojo_ms(e.rank_at), 'enrolled_at_ms', public._dojo_ms(e.enrolled_at),
        'cooldown_until_ms', case when e.exam_cooldown_until > now() then public._dojo_ms(e.exam_cooldown_until) end,
        'next_exam_ms', case when e.rank < 4 then public._dojo_ms(greatest(
            e.rank_at + make_interval(hours => (select b.min_hours from public.martial_belts b where b.style = e.style and b.rank = e.rank + 1)),
            coalesce(e.exam_cooldown_until, e.rank_at))) end) order by e.enrolled_at, e.style), '[]'::jsonb)
      from public.martial_enrollments e where e.account_id = p_account),
    'uniforms', (select coalesce(jsonb_agg(i.item_id order by i.item_id), '[]'::jsonb)
      from public.account_items i where i.account_id = p_account and i.item_id like 'vp\_%'),
    'wearing', (select c.outfit from public.characters c where c.account_id = p_account),
    'prev_outfit', (select f.prev_outfit from public.fight_profiles f where f.account_id = p_account),
    'exam', (select jsonb_build_object('id', x.id, 'style', x.style, 'target_rank', x.target_rank, 'fee', x.fee,
        'kata_seed', x.kata_seed, 'status', x.status, 'started_at_ms', public._dojo_ms(x.started_at),
        'expires_at_ms', public._dojo_ms(x.expires_at),
        'match', (select jsonb_build_object('id', mt.id, 'status', mt.status, 'params', mt.params,
                    'started_at_ms', public._dojo_ms(mt.started_at), 'sim_frame', mt.sim_frame)
                    from public.fight_matches mt where mt.id = x.match_id))
      from public.martial_exams x where x.account_id = p_account and x.status in ('kata', 'spar')),
    'server_now_ms', public._dojo_ms(now()))
$$;

-- 0049's _fx_settle for an exam match: a win ties the next belt, a loss (or a draw) sets the fail cooldown
create or replace function public._dojo_exam_settle(p_match uuid, p_winner smallint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare ex public.martial_exams; v_until timestamptz; v_name text;
begin
  select * into ex from public.martial_exams where match_id = p_match for update;
  if not found or ex.status <> 'spar' then return '{}'::jsonb; end if;
  select name into v_name from public.martial_belts where style = ex.style and rank = ex.target_rank;
  if p_winner = 1 then
    update public.martial_enrollments set rank = ex.target_rank, rank_at = now(), exam_cooldown_until = null
     where account_id = ex.account_id and style = ex.style and rank = ex.target_rank - 1;
    update public.martial_exams set status = 'passed' where id = ex.id;
    return jsonb_build_object('exam', jsonb_build_object('id', ex.id, 'passed', true, 'style', ex.style,
                                                         'rank', ex.target_rank, 'belt', v_name));
  end if;
  select now() + make_interval(mins => fail_cooldown_min) into v_until
    from public.martial_belts where style = ex.style and rank = ex.target_rank;
  update public.martial_enrollments set exam_cooldown_until = v_until where account_id = ex.account_id and style = ex.style;
  update public.martial_exams set status = 'failed' where id = ex.id;
  return jsonb_build_object('exam', jsonb_build_object('id', ex.id, 'passed', false, 'style', ex.style,
                                                       'rank', ex.target_rank - 1, 'cooldown_until_ms', public._dojo_ms(v_until)));
end $$;

create or replace function public.dojo_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._fx_sweep(v_account);
  perform public._dojo_sweep(v_account);
  -- lazy retention: logs 14 days after the match ended, match rows after 90 days
  delete from public.fight_logs where match_id in (select id from public.fight_matches
    where ended_at < now() - interval '14 days' order by ended_at limit 200);
  delete from public.fight_matches where id in (select id from public.fight_matches
    where ended_at < now() - interval '90 days' order by ended_at limit 200);
  return public._dojo_json(v_account);
end $$;

-- Nhập môn: 2 000 xu, rank 0 and the style's uniform
create or replace function public.dojo_enroll(p_session_token text, p_style text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_style public.martial_styles; v_coins integer; v_bal integer;
begin
  select * into v_style from public.martial_styles where id = p_style;
  if not found then raise exception 'unknown style' using errcode = '22023'; end if;
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  if exists (select 1 from public.martial_enrollments where account_id = v_account and style = p_style) then
    raise exception 'already enrolled' using errcode = '22023';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < 2000 then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -2000, 'dojo_tuition', 'dojo: ' || p_style);
  insert into public.martial_enrollments (account_id, style) values (v_account, p_style);
  insert into public.account_items (account_id, item_id) values (v_account, v_style.uniform) on conflict do nothing;
  return public._dojo_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Thi lên đai: the gates, the fee, then the kata phase (the answer carries the chart's seed and shape)
create or replace function public.dojo_exam_start(p_session_token text, p_style text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_style public.martial_styles; e public.martial_enrollments;
        b public.martial_belts; v_coins integer; v_bal integer; v_id uuid; v_seed bigint; v_outfit text;
begin
  perform public._fx_sweep(v_account);
  perform public._dojo_sweep(v_account);
  select * into v_style from public.martial_styles where id = p_style;
  if not found then raise exception 'unknown style' using errcode = '22023'; end if;
  perform public._fx_vitals_ok(v_account);
  perform public._wallet_lock(v_account);
  select * into e from public.martial_enrollments where account_id = v_account and style = p_style for update;
  if not found then raise exception 'not enrolled' using errcode = '22023'; end if;
  if e.rank >= 4 then raise exception 'max rank' using errcode = '22023'; end if;
  select * into b from public.martial_belts where style = p_style and rank = e.rank + 1;
  if exists (select 1 from public.martial_exams where account_id = v_account and status in ('kata', 'spar')) then
    raise exception 'exam in progress' using errcode = '53400';
  end if;
  if now() < e.rank_at + make_interval(hours => b.min_hours) then raise exception 'too soon' using errcode = '53400'; end if;
  if e.exam_cooldown_until > now() then raise exception 'exam cooldown' using errcode = '53400'; end if;
  select outfit into v_outfit from public.characters where account_id = v_account;
  if v_outfit is distinct from v_style.uniform then raise exception 'no uniform' using errcode = '22023'; end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < b.exam_fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -b.exam_fee, 'dojo_exam', 'exam: ' || p_style || ' ' || (e.rank + 1));
  v_seed := floor(random() * 4294967296)::bigint;
  insert into public.martial_exams (account_id, style, target_rank, fee, kata_seed, expires_at)
  values (v_account, p_style, e.rank + 1, b.exam_fee, v_seed, now() + interval '20 minutes')
  returning id into v_id;
  return jsonb_build_object('exam_id', v_id, 'kata_seed', v_seed, 'notes', b.kata_notes, 'ticks_per_beat', b.kata_tpb,
                            'half', e.rank + 1 >= 3, 'pass_pct', b.kata_pass_pct,
                            'expires_at_ms', public._dojo_ms(now() + interval '20 minutes'), 'coins', v_bal,
                            'state', public._dojo_json(v_account), 'server_now_ms', public._dojo_ms(now()));
end $$;

-- The kata's presses [tick, lane, …]. Malformed or too fast fails the attempt with a hard flag; a score under the
-- belt's pass line fails it; a pass creates the sparring match against the master bot (plan rulings P6, P8).
create or replace function public.dojo_kata_submit(p_session_token text, p_exam uuid, p_presses integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); ex public.martial_exams; v_style public.martial_styles;
        b public.martial_belts; e public.martial_enrollments; v_chart integer[]; v_len integer; v_bad text; v_code text;
        v_score integer[]; v_ac jsonb; v_until timestamptz; v_params jsonb; v_match uuid; v_start timestamptz;
        v_outfit text; v_notes integer; v_pass boolean; v_fail jsonb;
begin
  select * into ex from public.martial_exams where id = p_exam and account_id = v_account for update;
  if not found then raise exception 'exam not found' using errcode = '22023'; end if;
  if ex.status <> 'kata' or ex.expires_at < now() then
    perform public._dojo_sweep(v_account);
    return jsonb_build_object('status', (select status from public.martial_exams where id = p_exam),
                              'state', public._dojo_json(v_account), 'server_now_ms', public._dojo_ms(now()));
  end if;
  select * into v_style from public.martial_styles where id = ex.style;
  select * into b from public.martial_belts where style = ex.style and rank = ex.target_rank;
  select * into e from public.martial_enrollments where account_id = v_account and style = ex.style for update;
  -- the uniform is checked first: nothing is consumed without it (plan ruling P8)
  select outfit into v_outfit from public.characters where account_id = v_account;
  if v_outfit is distinct from v_style.uniform then raise exception 'no uniform' using errcode = '22023'; end if;
  v_chart := public._kata_chart(ex.kata_seed, b.kata_notes, b.kata_tpb, ex.target_rank >= 3);
  v_notes := b.kata_notes;
  v_len := v_chart[2 * v_notes - 1] + 30;
  v_bad := public._kata_input_error(v_chart, p_presses);
  if v_bad is not null then v_code := 'kata_bad_input';
  elsif now() < ex.started_at + make_interval(secs => 0.95 * v_len / 60.0) then v_code := 'kata_too_fast';
  end if;
  if v_code is null then v_score := public._kata_score(v_chart, p_presses); end if;
  v_pass := v_code is null and v_score[1] * 100 >= b.kata_pass_pct * 2 * v_notes;
  update public.martial_exams set kata_score = v_score[1] where id = ex.id;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'dojo_kata_submit',
              jsonb_build_object('exam', ex.id, 'style', ex.style, 'target', ex.target_rank, 'error', coalesce(v_bad, 'pace'),
                                 'started_at', ex.started_at, 'submitted_at', now(), 'chart_ticks', v_len,
                                 'presses', coalesce(cardinality(p_presses), 0) / 2, 'head', to_jsonb(p_presses[1:200])));
  elsif v_notes >= 24 and v_score[4] = 0 and v_score[6] <= 1 then
    perform public._ac_flag(v_account, 'kata_perfect', 'dojo_kata_submit',
              jsonb_build_object('exam', ex.id, 'style', ex.style, 'target', ex.target_rank, 'notes', v_notes,
                                 'score', to_jsonb(v_score)), null, null, false);
  end if;
  if not v_pass then
    v_until := now() + make_interval(mins => b.fail_cooldown_min);
    update public.martial_exams set status = 'failed' where id = ex.id;
    update public.martial_enrollments set exam_cooldown_until = v_until where account_id = v_account and style = ex.style;
    v_fail := jsonb_build_object('passed', false, 'score', to_jsonb(v_score), 'max', 2 * v_notes, 'pass_pct', b.kata_pass_pct,
                                 'cooldown_until_ms', public._dojo_ms(v_until), 'state', public._dojo_json(v_account),
                                 'server_now_ms', public._dojo_ms(now()));
    return v_fail || coalesce(v_ac, '{}'::jsonb);
  end if;
  -- the sparring match: me at my rank's unlocks, the master at the target rank's, 3 rounds, frame 0 in 8 s
  v_params := jsonb_build_object('seed', floor(random() * 4294967296)::bigint, 'rounds', 3, 'maxRounds', 5,
    'p1', jsonb_build_object('style', v_style.sort, 'rank', e.rank, 'movesMask', (1 << (e.rank + 1)) - 1, 'hpPct', 100,
                             'bot', 0, 'en0', 0, 'atk', v_style.atk, 'def', v_style.def, 'walk', v_style.walk,
                             'jump', v_style.jump, 'energy', v_style.energy),
    'p2', jsonb_build_object('style', v_style.sort, 'rank', ex.target_rank, 'movesMask', (1 << (ex.target_rank + 1)) - 1,
                             'hpPct', 100, 'bot', b.bot_level, 'en0', 0, 'atk', v_style.atk, 'def', v_style.def,
                             'walk', v_style.walk, 'jump', v_style.jump, 'energy', v_style.energy));
  v_start := now() + interval '8 seconds';
  insert into public.fight_matches (kind, p1, p2, params, ref, started_at, sim)
  values ('exam', v_account, null, v_params, ex.id::text, v_start, public._fx_new(v_params))
  returning id into v_match;
  update public.fight_matches set sim_hash = public._fx_hash(sim) where id = v_match;
  insert into public.fight_logs (match_id, side, account_id) values (v_match, 1, v_account);
  update public.martial_exams set status = 'spar', match_id = v_match where id = ex.id;
  return jsonb_build_object('passed', true, 'score', to_jsonb(v_score), 'max', 2 * v_notes, 'pass_pct', b.kata_pass_pct,
                            'match', jsonb_build_object('id', v_match, 'params', v_params, 'started_at_ms', public._dojo_ms(v_start)),
                            'state', public._dojo_json(v_account), 'server_now_ms', public._dojo_ms(now()));
end $$;

-- ---------- E. Uniforms are never bought, sold or given ----------
-- 0022's buy_fashion_item plus the marked line.
create or replace function public.buy_fashion_item(p_session_token text, p_item_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid;
  v_item public.item_catalog;
  v_coins integer;
  v_new_bal integer;
begin
  v_account := public._auth_account(p_session_token);
  if p_item_id like 'vp\_%' then raise exception 'uniform' using errcode = '22023'; end if;          -- v20.2
  perform public._wallet_lock(v_account);

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found then
    raise exception 'item not found' using errcode = '22023';
  end if;
  if v_item.starter then
    raise exception 'item is free starter' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_items where account_id = v_account and item_id = p_item_id) then
    raise exception 'already owned' using errcode = '22023';
  end if;

  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_item.price then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;

  v_new_bal := public._pay(v_account, -v_item.price, 'buy', 'fashion: ' || p_item_id);
  insert into public.account_items (account_id, item_id, acquired_at)
  values (v_account, p_item_id, now());

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'coins', v_new_bal);
end; $$;

-- 0029's sell_fashion_item plus the marked line.
create or replace function public.sell_fashion_item(p_session_token text, p_item_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid;
  v_item public.item_catalog;
  v_refund integer;
  v_new_bal integer;
begin
  v_account := public._auth_account(p_session_token);
  if p_item_id like 'vp\_%' then raise exception 'uniform' using errcode = '22023'; end if;          -- v20.2
  perform public._wallet_lock(v_account);

  if not exists (select 1 from public.account_items where account_id = v_account and item_id = p_item_id) then
    raise exception 'not owned' using errcode = '22023';
  end if;

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found or v_item.starter then
    raise exception 'cannot sell item' using errcode = '22023';
  end if;

  v_refund := greatest(1, (v_item.price * 50) / 100);

  delete from public.account_items where account_id = v_account and item_id = p_item_id;

  -- Revert currently worn item to null or default starter
  update public.characters
  set hat = case when hat = p_item_id then null else hat end,
      neck = case when neck = p_item_id then null else neck end,
      outfit = case when outfit = p_item_id then null else outfit end,
      wrist = case when wrist = p_item_id then null else wrist end,
      hairpin = case when hairpin = p_item_id then null else hairpin end,
      top = case when top = p_item_id then null else top end,
      bottom = case when bottom = p_item_id then null else bottom end,
      shoes = case when shoes = p_item_id then 'shoes_dep_blue' else shoes end,
      updated_at = now()
  where account_id = v_account;

  v_new_bal := public._pay(v_account, v_refund, 'sell', 'fashion: ' || p_item_id);

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'refund', v_refund, 'coins', v_new_bal);
end; $$;

-- 0029's transfer_fashion_item plus the marked line.
create or replace function public.transfer_fashion_item(
  p_session_token text, p_target_account_id uuid, p_item_id text
) returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_sender uuid;
  v_item public.item_catalog;
begin
  v_sender := public._auth_account(p_session_token);
  if p_item_id like 'vp\_%' then raise exception 'uniform' using errcode = '22023'; end if;          -- v20.2
  if p_target_account_id is null or p_target_account_id = v_sender then
    raise exception 'invalid target account' using errcode = '22023';
  end if;

  if not exists (select 1 from public.accounts where id = p_target_account_id) then
    raise exception 'target account not found' using errcode = '22023';
  end if;

  if not exists (select 1 from public.account_items where account_id = v_sender and item_id = p_item_id) then
    raise exception 'not owned' using errcode = '22023';
  end if;

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found or v_item.starter then
    raise exception 'cannot transfer item' using errcode = '22023';
  end if;

  if exists (select 1 from public.account_items where account_id = p_target_account_id and item_id = p_item_id) then
    raise exception 'recipient already owns item' using errcode = '22023';
  end if;

  -- Revert sender's character look if wearing this item
  update public.characters
  set hat = case when hat = p_item_id then null else hat end,
      neck = case when neck = p_item_id then null else neck end,
      outfit = case when outfit = p_item_id then null else outfit end,
      wrist = case when wrist = p_item_id then null else wrist end,
      hairpin = case when hairpin = p_item_id then null else hairpin end,
      top = case when top = p_item_id then null else top end,
      bottom = case when bottom = p_item_id then null else bottom end,
      shoes = case when shoes = p_item_id then 'shoes_dep_blue' else shoes end,
      updated_at = now()
  where account_id = v_sender;

  -- Atomic transfer
  delete from public.account_items where account_id = v_sender and item_id = p_item_id;
  insert into public.account_items (account_id, item_id, acquired_at)
  values (p_target_account_id, p_item_id, now());

  return jsonb_build_object(
    'ok', true,
    'item_id', p_item_id,
    'sender_id', v_sender,
    'recipient_id', p_target_account_id
  );
end; $$;

-- ---------- F. The shade ----------
-- 0041's _in_shade plus the dojo gate's awning (v20.2, R7).
create or replace function public._in_shade(p_map text, p_x integer, p_y integer) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select p_map is null or p_x is null or p_y is null or p_map not in ('hall', 'pond', 'field', 'market', 'khu_nha')
      or exists (select 1 from (values
           ('pond', 522, 64, 104, 90), ('pond', 522, 228, 104, 94),
           ('field', 588, 288, 84, 70), ('field', 700, 288, 88, 70),
           ('market', 100, 130, 80, 60), ('market', 460, 130, 80, 60), ('market', 244, 108, 152, 82),
           ('market', 640, 130, 80, 60), ('market', 40, 304, 80, 70), ('market', 680, 304, 80, 70),
           ('market', 860, 248, 120, 36)
         ) s(m, sx, sy, sw, sh)
         where s.m = p_map and p_x >= s.sx and p_x < s.sx + s.sw and p_y >= s.sy and p_y < s.sy + s.sh)
$$;
revoke all on function public._in_shade(text, integer, integer) from public, anon, authenticated;

-- ---------- G. The ledger ----------
-- The 43 reasons in force after 0043 (0044–0049 add none) plus the dojo's two: 45.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture',
                    'house_land','house_upkeep','house_build','house_refund','house_rent_pay','house_rent_income',
                    'estate_sale','estate_buy',
                    'dojo_tuition','dojo_exam'));

-- ---------- privileges ----------
revoke all on function public._kata_chart(bigint, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public._kata_input_error(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._kata_score(integer[], integer[]) from public, anon, authenticated;
revoke all on function public._dojo_ms(timestamptz) from public, anon, authenticated;
revoke all on function public._dojo_sweep(uuid) from public, anon, authenticated;
revoke all on function public._dojo_json(uuid) from public, anon, authenticated;
revoke all on function public._dojo_exam_settle(uuid, smallint) from public, anon, authenticated;
revoke all on function public.dojo_state(text) from public;
revoke all on function public.dojo_enroll(text, text) from public;
revoke all on function public.dojo_exam_start(text, text) from public;
revoke all on function public.dojo_kata_submit(text, uuid, integer[]) from public;
grant execute on function public.dojo_state(text) to anon, authenticated;
grant execute on function public.dojo_enroll(text, text) to anon, authenticated;
grant execute on function public.dojo_exam_start(text, text) to anon, authenticated;
grant execute on function public.dojo_kata_submit(text, uuid, integer[]) to anon, authenticated;
grant execute on function public.buy_fashion_item(text, text) to anon, authenticated;
grant execute on function public.sell_fashion_item(text, text) to anon, authenticated;
grant execute on function public.transfer_fashion_item(text, uuid, text) to anon, authenticated;
