-- =========================================================
-- 0023_character_gender.sql — body type (nam / nữ) for the character look.
-- Additive and re-runnable. Run after 0022 in the Supabase SQL Editor.
--   A. characters.gender text not null default 'nam', check in ('nam','nu') — every existing row reads as 'nam'.
--   B. save_character gains p_gender (default 'nam', so an older client's 9-argument call still works).
--      Body copied from its latest definition (0022_fashion_store.sql), guards unchanged.
-- Reads need nothing new: clients select the characters table directly and save_character returns the row.
-- =========================================================

-- ---------- A. Column ----------
alter table public.characters add column if not exists gender text not null default 'nam';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'characters_gender_check'
                 and conrelid = 'public.characters'::regclass) then
    alter table public.characters add constraint characters_gender_check check (gender in ('nam','nu'));
  end if;
end $$;

-- ---------- B. save_character with gender ----------
-- The 9-argument version would make a 9-argument call ambiguous next to the defaulted 10-argument one: drop it.
drop function if exists public.save_character(text,text,text,text,text,text,text,text,text);

create or replace function public.save_character(
  p_session_token text, p_skin text, p_hair text, p_hair_color text,
  p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text,
  p_gender text default 'nam'
) returns public.characters
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_row public.characters;
begin
  v_account := public._auth_account(p_session_token);
  if p_skin is null or p_skin not in ('light','warm','tan','deep')
     or p_hair is null or p_hair not in ('short','bob','long')
     or p_hair_color is null or p_hair_color not in ('black','darkbrown','brown','pink')
     or p_gender is null or p_gender not in ('nam','nu') then
    raise exception 'invalid character option' using errcode = '22023';
  end if;
  if not public._item_ok(v_account, p_hat, 'hat', false)
     or not public._item_ok(v_account, p_top, 'top', true)
     or not public._item_ok(v_account, p_bottom, 'bottom', true)
     or not public._item_ok(v_account, p_shoes, 'shoes', true)
     or not public._item_ok(v_account, p_neck, 'neck', false) then
    raise exception 'item not available' using errcode = '22023';
  end if;
  insert into public.characters as c (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender, updated_at)
  values (v_account, p_skin, p_hair, p_hair_color, p_hat, p_top, p_bottom, p_shoes, p_neck, p_gender, now())
  on conflict (account_id) do update set
    skin = excluded.skin, hair = excluded.hair, hair_color = excluded.hair_color,
    hat = excluded.hat, top = excluded.top, bottom = excluded.bottom, shoes = excluded.shoes,
    neck = excluded.neck, gender = excluded.gender, updated_at = now()
  returning c.* into v_row;
  return v_row;
end; $$;
grant execute on function public.save_character(text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant select on public.characters to anon, authenticated;
