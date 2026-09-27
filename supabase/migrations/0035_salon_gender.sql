-- 0035_salon_gender.sql — anh Ba cuts some styles only for one body type.
--   nam only: buzz, undercut.  nữ only: bob, long, ponytail, twin_braids, bun.  both: short, curly, bangs.
--   A. _hair_gender_ok(hair, gender): the lists above (mirrored by lib/game/types.ts HAIR_STYLES_BY_GENDER).
--   B. salon_style: re-created from 0029 verbatim plus the check — a new style must fit the body; keeping the worn
--      style (a dye-only visit) is always allowed, so a character who already wears a now-other-body style keeps it.
--   C. save_character: re-created from 0029 verbatim except that switching the body resets a style the new body is not
--      offered to that body's default (short / long); an unchanged body never touches hair.

-- ---------- A. Helper ----------
create or replace function public._hair_gender_ok(p_hair text, p_gender text)
returns boolean language sql immutable security definer set search_path = public, extensions
as $$
  select case p_gender
    when 'nam' then p_hair in ('short','buzz','undercut','curly','bangs')
    when 'nu'  then p_hair in ('long','bob','ponytail','twin_braids','bun','bangs','curly','short')
    else false end;
$$;
revoke all on function public._hair_gender_ok(text, text) from public, anon, authenticated;

-- ---------- B. salon_style ----------
create or replace function public.salon_style(p_session_token text, p_hair text, p_hair_color text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid;
  v_row public.characters;
  v_price integer;
  v_coins integer;
  v_new_bal integer;
begin
  v_account := public._auth_account(p_session_token);
  if not public._hair_ok(p_hair, p_hair_color) then
    raise exception 'invalid option' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);

  select * into v_row from public.characters where account_id = v_account for update;
  if not found then
    raise exception 'no character' using errcode = '22023';
  end if;

  -- 0035: a new style must be one anh Ba cuts for this body; the worn style may always be kept.
  if v_row.hair <> p_hair and not public._hair_gender_ok(p_hair, coalesce(v_row.gender, 'nam')) then
    raise exception 'hair not for this gender' using errcode = '22023';
  end if;

  -- cut 300, dye 500, both 700
  v_price := case
    when v_row.hair <> p_hair and v_row.hair_color <> p_hair_color then 700
    when v_row.hair <> p_hair then 300
    when v_row.hair_color <> p_hair_color then 500
    else 0 end;
  if v_price = 0 then
    raise exception 'no change' using errcode = '22023';
  end if;

  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < v_price then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;

  v_new_bal := public._pay(v_account, -v_price, 'salon', 'salon: ' || p_hair || '/' || p_hair_color);
  update public.characters set hair = p_hair, hair_color = p_hair_color, updated_at = now()
  where account_id = v_account;

  return jsonb_build_object('hair', p_hair, 'hair_color', p_hair_color, 'paid', v_price, 'coins', v_new_bal);
end; $$;
grant execute on function public.salon_style(text, text, text) to anon, authenticated;

-- ---------- C. save_character ----------
create or replace function public.save_character(
  p_session_token text, p_skin text, p_hair text, p_hair_color text,
  p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text,
  p_gender text default 'nam', p_outfit text default null,
  p_wrist text default null, p_hairpin text default null
) returns public.characters
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_row public.characters; v_hair text; v_color text;
begin
  v_account := public._auth_account(p_session_token);
  -- p_hair / p_hair_color are ignored: hair only changes through salon_style.
  if p_skin is null or p_skin not in ('light','warm','tan','deep')
     or p_gender is null or p_gender not in ('nam','nu') then
    raise exception 'invalid character option' using errcode = '22023';
  end if;
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
  insert into public.characters as c (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender, outfit, wrist, hairpin, updated_at)
  values (v_account, p_skin, v_hair, v_color, p_hat, p_top, p_bottom, p_shoes, p_neck, p_gender, p_outfit, p_wrist, p_hairpin, now())
  on conflict (account_id) do update set
    skin = excluded.skin,
    hair = case
      when coalesce(c.gender, 'nam') <> excluded.gender and not public._hair_gender_ok(c.hair, excluded.gender)
        then excluded.hair
      else c.hair end,
    hat = excluded.hat, top = excluded.top, bottom = excluded.bottom, shoes = excluded.shoes,
    neck = excluded.neck, gender = excluded.gender, outfit = excluded.outfit,
    wrist = excluded.wrist, hairpin = excluded.hairpin, updated_at = now()
  returning c.* into v_row;
  return v_row;
end; $$;
grant execute on function public.save_character(text,text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
