# Chuyện làng Sông Nhạc — story-driven newbie chain (0114)

Replaces the browser-only "Hướng dẫn tân thủ" (lib/game/guide, which pointed a newcomer to Chợ Lớn to sell and never
to the bait shop) with a server-tracked story: accept a step from an NPC in a dialogue, do it, go back and hand it in.

## Pieces

| Where | What |
|---|---|
| `supabase/migrations/0114_story_quests.sql` | `story_npcs`, `story_quests`, `story_progress`; `_story_count`, `_story_state`; RPCs `story_state(token)` (read, allowlisted), `story_accept(token, quest)` and `story_turn_in(token, quest, x, y)` (both `_ac_account`) |
| `lib/game/story/npcs.ts` | the givers (map, `use` point, reach, interactable kind), speakers with portrait emoji, route hints between maps |
| `lib/game/story/scripts.ts` | per step: `offer`, `progress`, `turnIn` lines and the tracker hint; per NPC idle chatter |
| `lib/game/story/model.ts` | parse the state, `talkTo(state, npc)` (offer / progress / turnin / idle), `guidance` (arrow + distance or route) |
| `lib/game/story/useStory.ts` | state + polling (8 s while unfinished), the talk flow, chaining a hand-in into the same NPC's next offer |
| `components/game/story/DialogueBox.tsx` | Pokémon-style bottom box: portrait, name, typewriter, "▶ Tiếp"; Space/Enter/click/tap (first press finishes the line), Esc closes, choices on the last line |
| `components/game/story/StoryTracker.tsx`, `StoryLayer.tsx` | the HUD tracker (chapter, objective n/goal, 📍 NPC + arrow/distance or 🧭 route) and the layer GameShell mounts |

GameShell hook-in: `useStory(...)`, one line at the top of `onInteract` (`if (storyTalk(it)) return;`), and
`<StoryLayer>` in place of `<GuideTracker>`. After a hint, chatter, or an offer at a shop, the NPC's own panel opens as
before (bác Ba's quest log does not reopen after a talk).

## Server rules

- Progress is never sent by the client and no counter is added: `_story_count` reads records the server already
  writes, since `accepted_at`:
  - `catch`: `game_events` `fish_catch` (moved fish are not catches since 0078);
  - `buy_bait`: `coin_ledger` reason `buy`, ref `bait_… xN` (buy_item);
  - `sell_pond`: `coin_ledger` `sell` with ref `N con` (sell_fish, cô Ba); `sell_market`: ref `N con (Chợ Lớn)`;
  - `mail`: the step's own letter (`mail.ref = 'story:s07_thu'`) read or claimed;
  - `farm_gift`: `farm_profiles.gift_at` (claim_farm_gift, called by the client when anh Hai hands it over);
  - `talk`: done at once — reaching the turn-in NPC is the task.
- One open step at a time, in order (`needs`). Accept is not position-checked (it pays nothing). Hand-in is: `_pos_claim`
  on the NPC's map, then the distance to the NPC ≤ reach (as 0071's `_quest_at_giver`).
- Reward: `_pay(..., 'quest_reward', 'story:<id>')`, `xp_grant` (meta `source: story`), and a small item. Whole chain
  330 xu + 370 KN + 2 thính cám gạo + Xô nhỏ + the letter's 2 thính (the old bác Ba chain n_lang_* paid 760 xu).
- **Old players**: at migration, an account that handed in `n_lang_1` or has ≥ 10 `fish_catch` events and no story row
  gets every step closed with `paid = false` — no reward, tracker hidden (`veteran`). A re-run of 0114 never touches an
  account that already has story rows. The old `npc` chains in the quest log are unchanged. A wipe does not reset the
  story (its rewards are one-time).

## The chain

| # | Chương | Bước | Nhận ở | Việc | Báo xong ở | Thưởng |
|---|---|---|---|---|---|---|
| 1 | 1 · Về làng | Chào làng | bác Ba Làng (Sảnh) | xuống Ao cá | cô Ba | 20 xu, 20 KN |
| 2 | 2 · Cần câu đầu tiên | Cần câu đầu tiên | cô Ba | ghé tiệm | chú Tư (cần gỗ) | 20 xu, 20 KN |
| 3 | 2 | Mua mồi | chú Tư | mua mồi ở tiệm | chú Tư | 20 xu, 20 KN, 2 thính cám |
| 4 | 2 | Con cá đầu tiên | chú Tư (dạy quăng & kéo) | câu 1 con | cô Ba | 30 xu, 30 KN |
| 5 | 3 · Phiên chợ bên ao | Bán cá cho cô Ba | cô Ba (giải thích thương lái) | bán ở Vựa cá ao | cô Ba | 30 xu, 30 KN, Xô nhỏ |
| 6 | 3 | Xô đầy cá | cô Ba | câu 3 con | cô Ba | 30 xu, 40 KN |
| 7 | 4 · Lá thư | Lá thư của bác Ba | bác Ba Làng | đọc thư trong 📬 (có 2 thính, giới thiệu gift code) | bác Ba | 30 xu, 30 KN |
| 8 | 5 · Ra đồng | Ra đồng | bác Ba Làng | ra Đồng ruộng | anh Hai | 20 xu, 30 KN |
| 9 | 5 | Quà nhà nông | anh Hai | nhận quà tân nông | anh Hai | 30 xu, 40 KN |
| 10 | 6 · Lên Chợ Lớn | Lên Chợ Lớn | anh Hai (Chợ Lớn +10%) | bán cá ở Vựa cá Chợ Lớn | chú Hai | 50 xu, 50 KN |
| 11 | 6 | Người làng thứ thiệt | chú Hai | về Sảnh | bác Ba Làng | 50 xu, 60 KN |

Chị Hoa 🌸 is the guide: she speaks inside the dialogues (how to move, the keys, where things are) but stands nowhere.

## Dialogue samples

> **Chị Hoa** 🌸: A, bạn mới về làng hả? Mình là Hoa, ở làng Sông Nhạc này từ nhỏ. Để mình dẫn bạn đi một vòng nha!
>
> **Bác Ba Làng** 👴: Muốn sống được ở đây thì phải biết câu cá trước. Cháu xuống Ao cá chào cô Ba giùm bác nhé.
>
> **Chú Tư** 🎣: Thấy phao chìm, có dấu ❗ là bấm Space liền! Rồi tới lúc kéo: giữ Space để quay máy, thả ra khi dây căng quá.
>
> **Cô Ba** 👩‍🌾: Có điều thương lái mỗi ngày chỉ gom một số tiền cá nhất định cho mỗi người. Bán quá mức đó thì họ trả rẻ dần — qua ngày mới là lại như cũ.
>
> **Anh Hai** 🧑‍🌾: Em biết Chợ Lớn chưa? Ở đó chú Hai cũng mua cá, mà trả hơn cô Ba chừng 10% lận.

## Tests

- `tests/sql/story-quests-smoke.sql`: the whole chain, order/one-at-a-time, only post-accept records count, cô Ba vs
  Chợ Lớn sales told apart, position check, no double pay, locked account, veterans closed unpaid, re-run safe.
- `tests/sql/anticheat-guards.sql`: `story_state` allowlisted (read); `story_accept`, `story_turn_in` in the loop.
- `tests/unit/story-scripts.test.ts`: scripts ↔ migration (steps, NPC positions ↔ map interactables), speakers exist,
  model `talkTo` / `guidance`. `tests/unit/story-dialogue.test.tsx`: typewriter skip/advance, choices, Esc, key capture;
  the tracker card.

## Left for later

- 3D world: the tracker shows the route and place but no arrow (world px differ from the map's).
- `lib/game/guide` (old client guide) is no longer mounted; delete it with its test once the story has shipped.
