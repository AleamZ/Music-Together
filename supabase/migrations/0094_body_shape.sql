-- 0094_body_shape.sql — body proportions ("Dáng người") on the character.
--   A. characters.body jsonb (nullable): 13 sliders in [-1, 1] (shared: height, head, legs, build, arms, face, eyeSize,
--      eyeSpacing; boys only: shoulders, muscle; girls only: bust, waist, hips), eyeColor (nau, den, hophach, xanh,
--      xanhla, xam, tim) and beard (none, stubble, goatee, full; boys only). null = the default body.
--      Missing keys read as 0 / 'nau' on the client (lib/game/body.ts). Other players read it through the characters
--      select (fetchCharacters), like every other look column.
--   B. save_character: 0035's verbatim but for the lines marked 0094 — a trailing p_body jsonb default null, validated
--      (unknown keys, non-numeric sliders, unknown eye colours / beards are rejected with 'invalid body shape'); numbers
--      are clamped to [-1, 1] and rounded to 2 decimals, missing keys filled, the other body type's sliders (and a
--      girl's beard) reset to neutral (p_gender decides); missing keys take the body type's default (a girl's is
--      FEMALE_DEFAULT_BODY, a boy's all 0); a body equal to its type's default is stored as null.
--      The signature changes, so the old 13-argument overload is dropped first and the grant re-applied.
-- Idempotent.

alter table public.characters add column if not exists body jsonb default null;   -- 0094

-- 0094: validates and normalizes a body for a body type; null in = null out (also for an all-default body).
drop function if exists public._body_normalize(jsonb);   -- 0094 (an earlier draft took no gender)
create or replace function public._body_normalize(p_body jsonb, p_gender text) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare
  v_sliders constant text[] := array['height','head','legs','build','arms','face','eyeSize','eyeSpacing','shoulders','muscle','bust','waist','hips'];
  v_boys constant text[] := array['shoulders','muscle'];
  v_girls constant text[] := array['bust','waist','hips'];
  v_eyes constant text[] := array['nau','den','hophach','xanh','xanhla','xam','tim'];
  v_beards constant text[] := array['none','stubble','goatee','full'];
  -- a girl's default proportions (lib/game/body.ts FEMALE_DEFAULT_BODY); a boy's are all 0
  v_female constant jsonb := '{"height":-1,"head":-1,"legs":0.8,"build":1,"arms":-1,"face":-1,"eyeSize":0,"eyeSpacing":0.8,"bust":1,"waist":1,"hips":1}';
  v_def numeric;
  v_key text; v_out jsonb := '{}'::jsonb; v_num numeric; v_eye text; v_beard text; v_default boolean := true;
begin
  if p_body is null or jsonb_typeof(p_body) = 'null' then return null; end if;
  if jsonb_typeof(p_body) <> 'object' then
    raise exception 'invalid body shape' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_body) loop
    if not (v_key = any(v_sliders)) and v_key not in ('eyeColor', 'beard') then
      raise exception 'invalid body shape' using errcode = '22023';
    end if;
  end loop;
  foreach v_key in array v_sliders loop
    v_def := case when p_gender = 'nu' then coalesce((v_female ->> v_key)::numeric, 0) else 0 end;
    if p_body ? v_key then
      if jsonb_typeof(p_body -> v_key) <> 'number' then
        raise exception 'invalid body shape' using errcode = '22023';
      end if;
      v_num := round(greatest(-1, least(1, (p_body ->> v_key)::numeric)), 2);   -- clamped to [-1, 1]
    else
      v_num := v_def;   -- missing keys take the body type's default
    end if;
    -- the other body type's sliders are ignored
    if (p_gender = 'nu' and v_key = any(v_boys)) or (p_gender <> 'nu' and v_key = any(v_girls)) then v_num := 0; end if;
    if v_num <> v_def then v_default := false; end if;
    v_out := v_out || jsonb_build_object(v_key, v_num);
  end loop;
  if p_body ? 'eyeColor' then
    if jsonb_typeof(p_body -> 'eyeColor') <> 'string' or not ((p_body ->> 'eyeColor') = any(v_eyes)) then
      raise exception 'invalid body shape' using errcode = '22023';
    end if;
    v_eye := p_body ->> 'eyeColor';
  else
    v_eye := 'nau';
  end if;
  if p_body ? 'beard' then
    if jsonb_typeof(p_body -> 'beard') <> 'string' or not ((p_body ->> 'beard') = any(v_beards)) then
      raise exception 'invalid body shape' using errcode = '22023';
    end if;
    v_beard := p_body ->> 'beard';
  else
    v_beard := 'none';
  end if;
  if p_gender = 'nu' then v_beard := 'none'; end if;   -- boys only
  if v_eye <> 'nau' or v_beard <> 'none' then v_default := false; end if;
  if v_default then return null; end if;
  return v_out || jsonb_build_object('eyeColor', v_eye, 'beard', v_beard);
end; $$;
revoke all on function public._body_normalize(jsonb, text) from public, anon, authenticated;   -- 0094

drop function if exists public.save_character(text,text,text,text,text,text,text,text,text,text,text,text,text);   -- 0094

create or replace function public.save_character(
  p_session_token text, p_skin text, p_hair text, p_hair_color text,
  p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text,
  p_gender text default 'nam', p_outfit text default null,
  p_wrist text default null, p_hairpin text default null,
  p_body jsonb default null   -- 0094
) returns public.characters
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_row public.characters; v_hair text; v_color text;
  v_body jsonb;   -- 0094
begin
  v_account := public._auth_account(p_session_token);
  -- p_hair / p_hair_color are ignored: hair only changes through salon_style.
  if p_skin is null or p_skin not in ('light','warm','tan','deep')
     or p_gender is null or p_gender not in ('nam','nu') then
    raise exception 'invalid character option' using errcode = '22023';
  end if;
  v_body := public._body_normalize(p_body, p_gender);   -- 0094: raises 'invalid body shape'
  if not public._item_ok(v_account, p_hat, 'hat', false)
     or not public._item_ok(v_account, p_top, 'top', false)
     or not public._item_ok(v_account, p_bottom, 'bottom', false)
     or not public._item_ok(v_account, p_shoes, 'shoes', true)
     or not public._item_ok(v_account, p_neck, 'neck', false)
     or not public._item_ok(v_account, p_outfit, 'outfit', false)
     or not public._item_ok(v_account, p_wrist, 'wrist', false)
     or not public._item_ok(v_account, p_hairpin, 'hairpin', false) then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if not public._item_gender_ok(p_hat, p_gender)
     or not public._item_gender_ok(p_top, p_gender)
     or not public._item_gender_ok(p_bottom, p_gender)
     or not public._item_gender_ok(p_shoes, p_gender)
     or not public._item_gender_ok(p_neck, p_gender)
     or not public._item_gender_ok(p_outfit, p_gender)
     or not public._item_gender_ok(p_wrist, p_gender)
     or not public._item_gender_ok(p_hairpin, p_gender) then
    raise exception 'item not for this gender' using errcode = '22023';
  end if;
  -- New rows get the gender default; the conflict branch keeps hair unless the body changes to one the style is not
  -- offered for (0035), which falls back to that body's default style (colour kept).
  v_hair := case when p_gender = 'nu' then 'long' else 'short' end;
  v_color := 'black';
  insert into public.characters as c (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender, outfit, wrist, hairpin, body, updated_at)   -- 0094: body
  values (v_account, p_skin, v_hair, v_color, p_hat, p_top, p_bottom, p_shoes, p_neck, p_gender, p_outfit, p_wrist, p_hairpin, v_body, now())   -- 0094: v_body
  on conflict (account_id) do update set
    skin = excluded.skin,
    hair = case
      when coalesce(c.gender, 'nam') <> excluded.gender and not public._hair_gender_ok(c.hair, excluded.gender)
        then excluded.hair
      else c.hair end,
    hat = excluded.hat, top = excluded.top, bottom = excluded.bottom, shoes = excluded.shoes,
    neck = excluded.neck, gender = excluded.gender, outfit = excluded.outfit,
    wrist = excluded.wrist, hairpin = excluded.hairpin,
    body = excluded.body,   -- 0094
    updated_at = now()
  returning c.* into v_row;
  return v_row;
end; $$;
grant execute on function public.save_character(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) to anon, authenticated;   -- 0094
