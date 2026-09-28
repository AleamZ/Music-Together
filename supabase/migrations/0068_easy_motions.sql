-- 0068 — Chiêu không cần phím chéo (owner, 2026-09-29: "bàn phím chỉ có lên xuống qua lại").
-- _fx_motion (0048) re-created verbatim but for the motions, mirroring lib/game/fight/engine.ts motionDone:
--   QCF ↓ then → (was ↓↘→), QCB ↓ then ← (was ↓↙←), DP → then ↓ (was →↓↘; a ↘ after the ↓ still counts and ends it),
--   QCF×2 ↓→↓→ (was ↓↘→↓↘→). The windows (12 / 14 / 24 frames, press within 6) are unchanged; the old inputs with
--   diagonals still work. State layout unchanged (p3 is still recorded, just unused).

create or replace function public._fx_motion(s integer[], b integer, mo integer, pf integer) returns boolean
language plpgsql immutable parallel safe
as $$
declare
  l2 integer := s[b + 23]; l3 integer := s[b + 24]; l4 integer := s[b + 25];
  l6 integer := s[b + 27]; p2 integer := s[b + 31]; p6 integer := s[b + 33]; t integer;
begin
  if mo = 1 then
    if not (l2 < l6 and l6 - l2 <= 12) then return false; end if;
    t := l6;
  elsif mo = 2 then
    if not (l2 < l4 and l4 - l2 <= 12) then return false; end if;
    t := l4;
  elsif mo = 3 then
    if not (l6 < l2 and l2 - l6 <= 14) then return false; end if;
    t := greatest(l2, l3);
  elsif mo = 4 then
    if not (p2 < l2 and l2 - p2 <= 14) then return false; end if;
    t := l2;
  else
    if not (p2 < p6 and p6 < l2 and l2 < l6 and l6 - p2 <= 24) then return false; end if;
    t := l6;
  end if;
  return pf >= t and pf - t <= 6;
end $$;
revoke all on function public._fx_motion(integer[], integer, integer, integer) from public, anon, authenticated;
