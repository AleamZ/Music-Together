This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# Music-Together

## Deploy (free tier)

1. **Supabase:** create a free project. **For the current (v2) schema, just run `supabase/migrations/0004_v2_rebuild.sql`** in the SQL editor — it builds the full account-native schema in one shot (see the "v2: Accounts & Lobby" section). *(The original v1 files `0001_init.sql`→`0003_realtime.sql` are kept only as history; `0004` drops and supersedes them.)*
2. **Vercel/Cloudflare Pages:** import the repo. Set env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Build command `next build`.
3. The app is client-rendered; the only server code is a handful of lightweight, cached proxy routes — `/api/oembed`, `/api/playlist`, `/api/yt/search`, `/api/yt/suggest` — that relay public YouTube data key-free.

### Notes
- Free Supabase projects pause after ~1 week of inactivity; the first request after that is slow.
- Realtime is read-only; all writes are authorized server-side via SECURITY DEFINER RPCs.
- Song likes are still a UI placeholder. Chat, emoji reactions (v4) and in-app YouTube search (v8, key-free) are done.

## v2: Accounts & Lobby

**One-time DB migration:** open the Supabase SQL Editor and run `supabase/migrations/0004_v2_rebuild.sql`. This drops all v1 tables and functions and rebuilds the account-native schema — room data is wiped, which is acceptable in dev/staging.

**Env vars:** unchanged — `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are the only required variables.

**What's new in v2:**
- Username + password accounts (custom `accounts`/`sessions` tables + bcrypt + a per-account session token — **not** Supabase Auth); role (Admin / DJ) follows the account across devices.
- Lobby page showing all currently-active rooms (via global Realtime Presence) with live participant counts.
- Animated turntable on the room page.
- Copy-code and share buttons for easy room invites.

## v3: Admin & Feedback

### DB migration

`supabase/migrations/0005_v3_admin.sql` is **fully additive** — it uses `add column if not exists`, `create table if not exists`, and `create or replace function`, so **no data is lost**. Two options:

- **Preferred (live DB):** open the Supabase SQL Editor and run `supabase/migrations/0005_v3_admin.sql`. Existing rooms, accounts, and sessions are preserved.
- **Reset (dev/staging):** run `supabase db reset` to replay migrations `0001` → `0005` from scratch (wipes all data).

### Bootstrap the root account

After the migration runs, create the root account by executing the snippet below **once** in the Supabase SQL Editor. Replace `<STRONG_PASSWORD>` with a real, randomly-generated password before running.

> ⚠️ **Do NOT commit this snippet with a real password. Do NOT reuse any password that has ever been shared or leaked.** The GitHub repo is public.

```sql
-- Run ONCE in the Supabase SQL Editor to bootstrap the root account.
-- Replace <STRONG_PASSWORD> with a real strong password before running.
-- ⚠️  Do NOT commit this with a real password. Do NOT reuse a leaked/shared password.
do $$
declare v_id uuid;
begin
  insert into public.accounts (username, is_root)
    values ('root', true)
    on conflict (lower(username)) do update set is_root = true
    returning id into v_id;
  insert into public.account_secrets (account_id, password_hash)
    values (v_id, extensions.crypt('<STRONG_PASSWORD>', extensions.gen_salt('bf')))
    on conflict (account_id) do update set password_hash = excluded.password_hash;
end $$;
```

**Schema notes (verified against migrations):**
- `accounts.id` has `default gen_random_uuid()` — no need to supply the id explicitly.
- The unique constraint on `username` is a **functional unique index** on `lower(username)` (`accounts_username_lower_uniq`), so the conflict target is `(lower(username))`, not `(username)`.
- `account_secrets` PK is `account_id` — the second `on conflict` target is `(account_id)`.
- pgcrypto lives in the `extensions` schema (per `create extension if not exists pgcrypto with schema extensions`). A bare `do $$` block does not inherit `set search_path`, so `crypt` and `gen_salt` must be schema-qualified as `extensions.crypt(...)` / `extensions.gen_salt('bf')`.
- The snippet is idempotent: re-running it sets `is_root = true` and updates the password hash, which is safe.

### What's new in v3

- **Feedback inbox (hòm thư góp ý):** any logged-in user can submit feedback (bug / suggestion / other) via the feedback button in the lobby and room pages. Rate-limited to 10 submissions per hour per account.
- **`/admin` dashboard** (root account only): view and triage the feedback inbox; view all rooms with member counts and delete any room; view all accounts, ban/unban accounts, and delete accounts; live system stats (total rooms, accounts, new/total feedback).
- **Account ban:** banned accounts are rejected at the session-auth layer (`_auth_account`) and all their active sessions are invalidated immediately on ban.
- **Per-account rate limits:** 10 rooms/hour and 10 feedback submissions/hour enforced server-side in SECURITY DEFINER RPCs.
- **Logo branding:** app logo displayed in the header and as an animated spinner on the loading screen.

## v4: Chat, Reactions & Inline Roles

### DB migration

`supabase/migrations/0006_v4_chat_roles.sql` is **fully additive** — it uses `create table if not exists` and `create or replace function` (no table drops or column removals), so **no data is lost**. Two options:

- **Preferred (live DB):** open the Supabase SQL Editor and run `supabase/migrations/0006_v4_chat_roles.sql`. Existing rooms, accounts, sessions, and feedback are preserved.
- **Reset (dev/staging):** run `supabase db reset` to replay migrations `0001` → `0006` from scratch (wipes all data).

> Emoji reactions use Supabase Broadcast (no DB writes) — they need **no migration**. Only the file above is required for v4.

### What's new in v4

- **Persisted room chat:** history loads on entry; updates in real-time via Supabase Realtime. Any member can send a message; the author or any room admin can delete a message. Messages are capped at 500 characters, rate-limited to 10 messages per 15 seconds per person, and only the newest 200 messages per room are retained.
- **Floating emoji reactions:** ephemeral animations powered by Supabase Broadcast (no DB storage). Palette: ❤️ 😂 🔥 👏 🎉.
- **Inline admin role menu:** a ⋯ menu on each member row (visible to admins only) provides quick access to Giao/Thu DJ, Trao Admin, and Kick — no need to open the Settings dialog (which still works too).
- **DJ revoke returns to admin:** revoking the DJ role now hands it back to the room admin instead of clearing it entirely.

## v5: Queue Scroll, Logo Favicon & Playlist Add

### DB migration

`supabase/migrations/0007_v5_batch_queue.sql` is **fully additive** — it uses `create or replace function` only (no table drops or column changes), so **no data is lost**. Two options:

- **Preferred (live DB):** open the Supabase SQL Editor and run `supabase/migrations/0007_v5_batch_queue.sql`.
- **Reset (dev/staging):** run `supabase db reset` to replay migrations `0001` → `0007` from scratch (wipes all data).

> Playlist enumeration and emoji reactions need **no API key** and **no extra config** — only the migration above is required for v5.

### What's new in v5

- **Queue scrolls internally:** the right-hand queue column is height-capped and scrolls inside itself instead of stretching the whole page. Drag-to-reorder, bump, and delete still work across the full list.
- **Logo favicon:** the browser tab uses `public/logo.png` instead of the default icon.
- **Add a whole YouTube playlist:** paste a playlist link (`…/playlist?list=…`) and all of its videos (up to 50) are enqueued in one batch. The list is read key-free from the public playlist page. A normal video link — even one that also carries `&list=` — still adds just that one video; paste the dedicated playlist URL to add the whole list.

## v6: Queue Loading & Chat Notifications

**No migration, no config** — purely client-side UX. New:

- **Queue action loading:** deleting, bumping to top, or drag-reordering a song shows a per-row spinner (and disables that row) while the change is saving, instead of a silent delay.
- **Chat notifications (Zalo-style):** when a new message arrives from someone else while you're *away* (scrolled up in the chat, or the tab is in the background) you get an unread badge on the "Trò chuyện" header, a "↓ N tin mới" pill to jump to the latest, a short "ting" sound, and — once you grant permission — a desktop notification while the tab is backgrounded. Toggle everything with the **🔔 bell** in the chat header (default **on**); your own messages never notify. The chat also no longer yanks you to the bottom while you're reading older messages.

> Desktop popups need a secure context (HTTPS, or `localhost`) and browser permission; without them the in-app badge + sound still work. The sound uses the Web Audio API (no audio file).

## v7: Themes (Vinyl Salon + Pixel Cozy)

**No migration, no config** — purely client-side UX. New:

- **Theme toggle (🎩 Salon / 🎮 Pixel):** a toggle in the lobby header and room header switches the whole app's look instantly. The choice is **persisted per browser** (localStorage key `music-together:theme`, default Salon) and applies to everyone on that device.
- **Pixel Cozy theme:** uses a warm pastel palette, a pixel heading/label font (Pixelify Sans) while body text stays a readable serif so Vietnamese characters stay sharp, a **pixel boombox logo**, and turns the turntable into a **pixel radio**.
- **Vinyl Salon theme:** the original look — unchanged.
- All app logic is unchanged — theming is CSS-variable + presentation only (`data-theme` attribute on `<html>`; no JS logic branches).

## v8: Tìm bài trực tiếp từ YouTube (in-app search)

**No migration, no config, no API key.** The room's "add song" box is now a smart box:

- **Paste a link** (video or playlist) → adds it, exactly as before.
- **Type keywords** → YouTube's own suggestions appear under the box as you type (↑/↓ to pick, Enter to search, Esc to close). Enter — or the **Tìm** button — runs a YouTube *video* search; results (thumb · title · channel · duration) show above the queue with a **+ Thêm** button per row. The panel stays open so you can queue several songs in a row; added rows turn into "✓ Đã thêm".
- Songs added from search carry their **duration** (`duration_seconds`), which pasted links never had.

How it works: two tiny same-origin proxies — `/api/yt/suggest` (YouTube's suggest feed) and `/api/yt/search` (YouTube's InnerTube search with the video-only filter) — called anonymously: no user/session cookies (only YouTube's static consent cookie), no login, no key. Both fail soft (empty list / a friendly message). Language and region are fixed to `vi` / `VN`.

## v9: Quy tắc hàng đợi (giới hạn thời lượng · chờ duyệt · từ khóa cấm)

### DB migration

`supabase/migrations/0008_v9_room_rules.sql` is **fully additive** (`add column if not exists`, `create or replace function`, `create extension if not exists unaccent`) — **no data is lost**; existing queue rows become `approved`. Two options:

- **Preferred (live DB):** open the Supabase SQL Editor and run `supabase/migrations/0008_v9_room_rules.sql`.
- **Reset (dev/staging):** run `supabase db reset` to replay migrations `0001` → `0008` from scratch (wipes all data).

> After the migration every room limits videos to **10 minutes** by default (`0` = unlimited). Pasted links therefore need a duration: the app reads it key-free from the watch page (`/api/yt/video`) and from playlist pages. Live streams have no duration and are rejected while a limit is set.

> If you applied `0008` before this note was added, re-run it (it is idempotent) or run just `alter table public.queue_items replica identity full; alter table public.members replica identity full;` — without it, Realtime DELETE events don't match the room filter and the UI won't update after reject / withdraw / delete / kick until a reload.

### What's new in v9

- **Room rules (Admin + DJ)** in ⚙️ Setting → **Quy tắc hàng đợi**: *Thời lượng tối đa* (minutes, `0` = unlimited, default 10), *Chờ duyệt* toggle, and *Từ khóa cấm* chips (matched against the video **title**, case- and accent-insensitive). The rules are enforced inside the RPCs, so they cannot be bypassed by calling the API directly; the UI checks them first for friendly messages, and search-result rows that break a rule are greyed out with the reason.
- **Trust model:** the rules run inside the RPCs on the title/duration the client submits (read key-free from YouTube by the app). That blocks every path through the UI; a member who deliberately forges those fields with dev tools can still slip a video through — the same latitude the app has always given for song titles. Tamper-proof enforcement would need server-signed metadata (planned as a follow-up).
- **Approval queue:** with *Chờ duyệt* on, songs added by members land in a **⏳ Chờ duyệt** panel above the queue that only Admin/DJ see, with ✓ / ✕ per row and **Duyệt tất cả**. Members see their own pending songs under the add box and can withdraw them. Admin/DJ additions skip approval. Turning the toggle off approves everything still pending.
- **Playlist adds** skip songs that break a rule and report how many were skipped.

## v10: Nghe cùng phòng (listen-along)

**No migration, no config.** Every member's device now plays the current track **in sync** with the room:

- Playback follows the room clock (`started_at` / paused position): a listener who joins mid-song hears it from the right spot; DJ pause/resume/seek/skip propagate to everyone within a second or two (drift is corrected every 5 s).
- **Only the DJ** has ▶/⏸, ⏭ and the seek bar — the playback RPCs still require the DJ role, so listeners cannot change the room's playback even by calling the API. Listeners see "Đang nghe cùng phòng · DJ điều khiển".
- Everyone has a **local** 🔊 volume slider (their own device only).
- **🔈 Bật âm thanh:** browsers refuse to start audio without a user gesture, so a member who opened the room URL directly sees this button once; members who clicked their way in from the lobby usually don't.
- A video that cannot be played on a particular device (embedding disabled, region) shows a small notice on that device only; the room is unaffected.

## v11: Giới hạn số order mỗi người

### DB migration

`supabase/migrations/0009_v11_order_limit.sql` is **additive** (`add column if not exists`, `create or replace function`): run it in the Supabase SQL Editor (or `supabase db reset` on dev/staging). It drops and re-creates `update_room_settings` with one more optional argument — older clients that call it without the argument keep working.

### What's new in v11

- **Room rule (Admin + DJ)** in ⚙️ Setting → **Quy tắc hàng đợi** → *Số order tối đa mỗi người* (default **5**, `0` = unlimited, max 100): how many songs one member may have in the queue at once — pending **and** approved rows count, the song currently playing does not. **Admin and DJ are exempt.**
- Members see a live **`Order: 3/5`** counter next to the add box; at the limit the add box and every search-result **+ Thêm** button refuse with *"Bạn đã đặt đủ 5 bài — chờ bài phát xong rồi đặt tiếp."* The RPCs enforce the same rule (`order limit reached`), so it cannot be bypassed by calling the API directly.
- **Playlists** add as many songs as still fit, then stop: *"Đã thêm 2/10 bài — đạt giới hạn 5 order."* Songs skipped by the other rules do not use a slot.
- A slot frees up when the member's song starts playing, is rejected, or is withdrawn.

## v13: Chế độ game — Sảnh phát nhạc

### DB migration

`supabase/migrations/0011_v13_game_mode.sql` is **additive and re-runnable** (`create table if not exists`, `create or replace function`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor (or `supabase db reset` on dev/staging). It adds `item_catalog` (15 starter items), `characters` (one appearance per account, public read like usernames) and the RPC `save_character`.

### What's new in v13

- **🎮 Chế độ game** (room header) shows the room as a 2D pixel riverside café in the Miền Tây style — stage with a DJ booth, hammock, palms, café tables, river and dock. It is a per-browser choice; **🖥️ Giao diện cũ** switches back. Music never stops on a switch (both views share one player). The game has its own parchment look, so the app theme is switched off while you are in it and comes back when you leave.
- **Your character:** the first visit opens **Tạo nhân vật** — skin, hair style and colour, nón lá / mũ tai bèo, áo bà ba / áo thun, quần, dép, khăn rằn. **👕 Tủ đồ** edits it later; it is saved per account.
- **Moving:** WASD / arrow keys, or click/tap the ground (the character path-finds around tables and the river). Walk to the stage's **Quầy DJ** and press **E** (or tap the prompt) for the queue panel — order, approve, reorder with exactly the same rules as the classic view. **Bảng tin** opens the rankings; **Bến câu cá** is the entrance to the fishing pond coming in v14.
- **Together:** everyone in game view walks around live; members still in the classic view sit at the café tables with 🖥️ (the DJ stands behind the mixer). Chat messages pop up as speech bubbles over their author and reactions float up from the sender.
- **HUD:** now playing with the DJ's ▶/⏸, ⏭ and seek (DJ only), local volume, **🔈 Bật âm thanh**, 📜 Hàng đợi, 🏆 Bảng tin, ⚙️ (Admin/DJ), a chat bar, 💬 full chat and 👥 members. The admin's queue-order toggle (**Thứ tự / Trộn**) and the **💬 Góp ý** feedback button stay in the classic view's header.
- All art is original and drawn in code — there are no image assets.

### Realtime budget (Supabase free plan)

Movement uses a Broadcast channel `game:{roomId}` with tiny event messages: an idle player sends nothing, a walking player about 1–2 messages/s (a client never sends more than 3/s), and every message is delivered to each other player in the world. Example: 10 players walking a quarter of the time ≈ 30 events/s (limit 100/s) ≈ 110 k/hour, so the free 2 M messages/month cover roughly 18 hours of a 10-person session (about 100 hours with 4 people). Entering the world costs a `hello`, the newcomer's own position and one answer from every other player — and every answer reaches every player, so with N players in the world a join costs about N² deliveries (≈ 100 for 10 players), spread over 1.5 s + 0.15 s per player. A client sends a single answer for all the `hello`s that arrive before it goes out, so when several people join at the same moment there is still one answer per client. Movement, joins and every room's classic realtime traffic (queue, chat, playback) share the project's 100 messages/s, which puts the practical ceiling at roughly 8–10 game-mode players per room on the free plan. Presence carries each member's view mode; switching views re-announces it — toggles within 1 s are merged and re-announcements are budgeted to at most 4 per 30 s, keeping the 5th call for a reconnect (Presence allows 5 calls per client per 30 s).

## v14: Ao câu cá — câu cá, xu và cửa hàng

### DB migration

`supabase/migrations/0012_v14_fishing.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop policy/trigger if exists`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor after `0011`. It adds the catalog tables `fish_species` (12 species) and `shop_items` (12 items), which everyone may read; the private per-account tables `wallets`, `coin_ledger` (append-only), `inventory`, `fishing_profiles`, `casts`, `fish` and `personal_bests`, which only the RPCs touch; the RPCs `fishing_state`, `claim_daily`, `dig_worms`, `buy_item`, `set_loadout`, `start_cast`, `finish_cast`, `sell_fish`, `release_fish` and `fishing_board`; and the column `rooms.item_began_at` with two triggers for the song bonus. `tests/sql/v14-smoke.sql` checks all of it on a throwaway PostgreSQL cluster.

> **Deploy order:** apply `0012` to the hosted database **before** the v14 client goes live. Older clients keep working against the new database, but a v14 client against the old one has no fishing: the HUD shows "—". Pre-v14 and v14 clients don't see each other in game mode until they reload, because their game channel topics differ (`game:{roomId}` → `game:{roomId}:{mapId}`).

### What's new in v14

- **🎣 Ao cá:** walk down the hall's dock to **Bến câu cá** and press **E** — the screen fades to a Miền Tây fishing pond with a plank platform, a worm patch, **Vựa cá** (cô Ba) and **Tiệm đồ câu** (chú Tư). **Bến vào** takes you back to the hall. The chip at the top shows **🎵 Sảnh N · 🎣 Ao cá N**; tap it for the names. Music, chat and reactions stay room-wide on both maps.
- **Worms:** press **E** at a mound in **Bãi trùn** for 1–3 **Trùn đất**, once every 45 s. The bait box holds 20 baits (60 with **Hộp mồi**).
- **Fishing:** stand on one of the six spots on the platform and press **E** (or tap the water in front of it). When **❗** shows, hook with **Space**, a click/tap or **❗ Giật cần!** before the bobber's window closes (1.5–2.5 s). Then hold the mouse, a touch or **Space** to keep the fish inside the green zone until the bar fills. **🎣 Thu cần** / **Esc** gives the cast up (the bait is lost). You can cast 40 times per hour.
- **Fish:** 12 species in 5 rarities (Thường, Khá, Hiếm, Quý, Huyền thoại); the price is set by the weight. You hold one fish in your hand — everyone sees it — and a bucket holds 5 (**Xô nhỏ**) or 15 more (**Xô lớn**). Rare+ catches are announced in the room chat.
- **Shops:** cô Ba buys fish (**Bán** / **Bán hết**). Chú Tư sells rods (a bigger zone, heavier fish, more rare fish), bobbers (a longer bite window, faster bites, the rarity shown at the bite), bait (more rare fish), the bait box and buckets. **🎒 Giỏ đồ** lists your fish and gear and switches rod, bobber and bait. **Bảng kỷ lục** shows the room's record per species next to your best, and the room's richest members.
- **Xu:** +20 for the daily check-in (your first game visit of the Vietnam day), +10 when a song of 60 s or more that you queued stays current for at least 75 % of its length (up to 10 a day), and fish sales. With worms and the wooden rod an average cast is worth about 46 xu, so a skilled angler earns about 1 000–1 800 xu an hour: **Cần tre** (300 xu) takes about 20 minutes, **Cần carbon** (1 500 xu) 1–2 hours.
- Also: the camera scrolls the character above the bottom HUD, the now-playing card folds into a one-line chip on phones, the game falls back to the classic view if its frame loop keeps failing, and chat bubbles never cut an emoji in half.

### Trust model

The server decides the species, weight, rarity and bite delay of every cast; all prices, capacities and balances; the hourly cast cap, the dig cooldown, the reel time gate and single-use casts. Three things are **not** verified: whether the minigame was really won (a modified client can report a win, but no faster than the time gate and no more than 40 fish an hour); where the player stands (selling, buying and digging work from anywhere); and the visuals — the fishing state and catch labels over heads come from the clients. Only the chat announcement comes from the server.

### Realtime budget (v14)

Each map has its own Broadcast channel `game:{roomId}:{mapId}`, so a room split across the hall and the pond costs N_hall² + N_pond² deliveries instead of N². A cast sends at most four `fs` messages (cast, bite, reel, end), and selling or releasing a fish adds one. A normal cast cycle takes about 6 s or more, so an angler averages at most about 0.7 messages/s and typically about 0.1. That average is not a hard bound, because giving up and recasting is faster; the hard limits are 40 casts an hour and the send gate's 3 messages/s. A map switch costs one presence track, taken from the same budget as view-mode changes (at most 4 per 30 s), and a rare+ catch costs one chat insert.

## Hotfix: khóa bộ nhớ lời bài hát (lyrics cache lockdown)

### DB migration

`supabase/migrations/0014_lyrics_lockdown.sql` is **additive and re-runnable** (`drop policy/function if exists`, `revoke`, `create or replace`, explicit grants): run it in the Supabase SQL Editor after `0011_v13_video_lyrics.sql`. It does not need `0012` or later.

What it closes — until now anyone holding the public key, even logged out, could overwrite the lyrics, names, offset and "updated by" of any video in the shared `video_lyrics` cache, or fill it with invented ids:

- **Direct writes:** the open `video_lyrics_insert` / `video_lyrics_update` policies are dropped and insert, update and delete are revoked from `anon` and `authenticated`. Reading stays public.
- **The RPCs:** the session-less `upsert_video_lyrics(text,…)` and `update_video_lyric_offset(text,integer,text)` are dropped. The new ones take `(p_room_id, p_session_token, …)` and accept only the room's **DJ** — the same check as play / pause / seek / skip — for an 11-character YouTube id that is the room's current or queued song, within size caps (lyrics ≤ 20 000 characters each, names ≤ 200, timing source `auto` / `custom`, offset within ±10 minutes). A save replaces the row with exactly what the DJ applied (all lyrics fields and the offset, 0 included). "Updated by" is the account's username.
- **The broadcast:** `lyrics:{roomId}` now carries only a hint, `{ trackId, videoId }`, which the DJ sends after the save succeeded; members refetch that row from the database. A broadcast can no longer change anyone's lyrics or offset, nor what their browser remembers.

`tests/sql/lyrics-lockdown-smoke.sql` checks all of it on a throwaway PostgreSQL cluster.

> **Deploy order:** run `0014` in the SQL Editor first, then deploy the client. Until they reload, old clients call the dropped signatures and get `PGRST202`; their fallback direct write is now denied and the error is swallowed, so their lyrics caching just stops (lyrics still show, from the cache or the lyrics search). Old and new clients ignore each other's lyrics broadcasts, so live lyric/offset sync between them waits for the reload.

> Rows written before `0014` may have been forged, and their "updated by" was whatever the client sent. The table is only a cache: if in doubt, `truncate public.video_lyrics;` is safe (DJs refill it as songs play; saved offsets are lost).

**Trust model:** the cache is shared by every room, and any signed-in user is the DJ of a room they create, so they can still write the lyrics of a song they queued there — but only with an account, for songs queued in that room, within the caps, and under their own username.

## v15: Đồng ruộng — ruộng lúa và đất đai

### DB migration

`supabase/migrations/0013_v15_field.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop … if exists`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor after `0012`. It does not depend on `0014_lyrics_lockdown.sql` (the lyrics hotfix below, which may already be applied): the two can run in either order. It adds `rice_varieties` (3 varieties, public read) and 11 farm items in `shop_items` (the `kind` check gains `seed`, `fertilizer`, `pesticide` and `critter_box`); `members.last_seen_at`; the private tables `field_plots` (10 plots per room, made the first time anyone opens the field), `plot_leases`, `land_offers`, `crops`, `drying_slots`, `rice_stock` and `farm_profiles`, which only the RPCs touch; and the RPCs `field_state`, `touch_room`, the land RPCs (`rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot`, `buy_listed_plot`, `offer_plot`, `withdraw_offer`, `decline_offer`, `accept_offer`, `set_sublease`, `rent_sublease`, `abandon_crop`), the farming RPCs (`prepare_plot`, `apply_fertilizer`, `soak_seed`, `sow_seed`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`), `dry_start`, `dry_collect`, `sell_rice`, `buy_farm_item` and `claim_farm_gift`. It also limits `buy_item` to fishing gear, adds `server_now` to the fishing state, prices every catch with the room's fish price index (`finish_cast`; the private table `fish_price_index` keeps one snapshot per room and 3-hour period) and adds the index to `fishing_board`. `tests/sql/v15-smoke.sql` checks all of it on a throwaway PostgreSQL cluster (run `psql` from the repo root: it reads `tests/fixtures/crop-cases.json`).

> **Deploy order:** apply `0013` to the hosted database **before** the v15 client goes live. A v15 client against a database without it shows the field with the banner "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013."; the hall, the pond and fishing keep working. Older clients never see the field (their presence says hall or pond) and ignore its `fp` / `fa` messages. Clients still on v14 list the 11 farm items as bait in their fishing shop until they reload, and buying one there is refused with "item not available" ("Món này không mua được."). A database that ran an earlier build of `0013` (a demo) has its v15 state reset when this one runs: land, leases, offers, crops, drying batches, rice, gifts and farm items bought at the old prices are cleared, and xu stay.

### What's new in v15 (15.1 "Ruộng lúa")

- **🌾 Đồng ruộng:** the hall's **Ra đồng** sign and the pond's **Cầu khỉ ra đồng** lead to one shared field per room: 4 private plots north of the canal, 6 village plots south of it, the **Hợp tác xã** (chú Tám), the **Tiệm vật tư** (anh Hai), the **Vựa lúa** (cô Út) and the drying yard. The chip at the top shows **🌾 Đồng N**.
- **Land:** rent a village plot for 10 000 xu a 4-day season (harvesting ends the lease), or buy one private plot per room for 800 000 xu (+10 % yield, no rent); nobody farms more than 2 plots. Owners list a plot for sale, sublet it for a season, accept or decline purchase offers, or sell it back to the village for 400 000 xu. A plot whose owner leaves the room or stays away 14 days is reclaimed with a 400 000 xu refund. Sales between players are announced in the chat by **Hợp tác xã**.
- **Rice:** a real wet-rice season in 2–3 days, in 3 varieties: prepare the plot, base-fertilize, soak, sow the seedbed, transplant, top-dress twice, dry the field, keep the water right (it drops a level every 12 h), treat golden apple snails, leaf folders, planthoppers and blast, drain, harvest, dry the grain on the yard (3 h) and sell it to cô Út (wet rice pays 70 %). The server rolls the pests secretly and computes the yield; the plot panel shows the next job, why a button is disabled and a yield estimate. **🌾 Việc đồng áng** lists what is due on your plots (a dot counts the urgent tasks) and **📖 Sổ tay nhà nông** explains every step.
- **Newcomers** get a bag of Giống lúa ngắn ngày and a bag of urea from chú Tám on their first visit.
- The fishing prompts now count down on the server's clock.
- **Giá cá:** fish prices follow the room. Every 3 hours (00:00, 03:00, … Vietnam time) the room's multiplier is set from the average wealth of the members seen in the last 14 days (xu plus 800 000 per private plot owned): ×1 up to 20 000 xu, then the square root of wealth ÷ 20 000, at most ×10. A room with fewer than 2 such members stays at ×1. Each species also gets a season factor from ×0.80 to ×1.39. A fish's price is fixed when it is caught. The records panel's **Giá cá** tab shows the multiplier, when it changes and every species' price now.

### Trust model (v15)

The server decides every time and phase, the water levels, the pests (rolled at sowing and hidden until they fire), the yield, all prices, and land ownership, leases and reclaims. A client still sends a transplant and harvest quality, but v15.1 ignores it and uses 1.0 (anti-cheat decision D1) until the v15.2 minigames; transplanting and harvesting stay behind the 2 s work gate. As in v14, where a player stands is not verified, and the plots' look and the farm animations come from each client's own copy of the field state. Like the rest of the members table, the new `members.last_seen_at` is readable with the anon key, so anyone who has the key can see when each member last visited a room, to the hour (it is written at most once an hour, for the 14-day reclaim).

### Realtime budget (v15)

The field has its own channel `game:{roomId}:field`. After a land or farm action the client sends at most two messages, `fa` (a 2.5 s animation) and `fp` (a plot changed); everyone on the field then fetches `field_state` once, 400 ms after the first `fp` of a burst. Farm actions are minutes apart, so that stays well under one RPC a minute per person. `touch_room` is one call per room visit.

## Anti-cheat: chống gian lận

### DB migration

`supabase/migrations/0015_anticheat.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`; the config row is inserted `on conflict do nothing`, so a re-run never switches `enforce` back to `log`): run it in the Supabase SQL Editor last: the production order is `0012` → `0014` → `0013` → `0015` (`0015` does not need `0014`). It adds the private tables `anticheat_config` (the mode), `anticheat_status`, `anticheat_events` and `anticheat_wipes`; `chat_messages.system` and `about_account_id`; the daily cast counters in `fishing_profiles`; the lock guard and the hard checks in the 8 fishing and the 27 farm and land RPCs; and the root-only RPCs `admin_anticheat_list`, `admin_anticheat_account`, `admin_anticheat_resolve` and `admin_anticheat_set_mode`. `tests/sql/anticheat-smoke.sql` checks it on a throwaway PostgreSQL cluster with Supabase's default grants (after `0004`–`0015` in that order, from the repo root). It ends with `tests/sql/anticheat-guards.sql`, which fails for any SECURITY DEFINER function in `public` that anon may call and that is neither on its allowlist nor guarded: every later migration keeps it passing.

> **Before running `0015`**, run the two pre-deploy queries in the spec (`docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md`, §11.4): the names the new rules would refuse (they keep working), and the author-less announcer lines that the backfill marks as system lines.
>
> **Deploy order:** `0015` first, then the anti-cheat client — the client reads `chat_messages.system`, so it must never go live before the migration. The v15.1 client against `0015` only shows the raw `invalid username` / `account banned` on the login screen, and "Có lỗi, thử lại nhé." for the daily cast cap and for the calls only a tampered client makes. `0015` starts in **log** mode.
>
> **Re-running `0013` after `0015`** puts back its unguarded versions of the functions `0015` re-creates (the game RPCs, the sweep, the fishing state and board): run `0015` again right after it. Once an account has been wiped, `0013` cannot be re-run as it is, because its `coin_ledger` reason check lacks `'wipe'`: add `'wipe'` to that list first.

### What is detected

- **Hard signals**, inputs that no shipped client can produce: a reel reported won before the reel time gate; a transplant or harvest quality outside [0.9, 1.1]; a plot outside 1–10 or a drying slot outside 1–4; a water change other than ±1 or a work other than transplanting or harvesting; a quantity no shop sends (bait 1–99, gear 1, farm items 1–99, rice at least 1 kg); a land price outside 1–1 000 000 (a sublease 1–5 000); an offer of this room that belongs to someone else. `tests/unit/anticheat-pins.test.tsx` pins, for each one, the client code that keeps honest players clear of it.
- **Soft signals**, logged for review and never a strike: the 20th catch of a day within 5 % of the reel gate, the 300th cast of a day, and an item bought or used at the wrong counter (the old v14 client lists farm items as bait).
- **Never counted:** the refusals an honest player can cause — double clicks, two tabs, stale state, slow networks, clock drift, a cached client after a deploy.
- **Not detected:** where a player stands, a script that reels exactly at the gate (now held to 300 casts a day), and anything sent over Realtime; the receiving clients filter and rate-limit that instead (below).

### Modes, strikes and the review

- **Chỉ ghi nhận** (log, the default): a flagged call is refused as before and logged; nothing is locked or banned, and log-mode rows never count later.
- **Thi hành** (enforce): the first hard signal is strike 1 — the warning and a 5-minute lock of fishing, farming, the land market and the shops (chat and music keep working; the player card shows 🔒 m:ss). Another one within 30 days is strike 2 — a permanent ban: the sessions end, login answers "🚫 Tài khoản này đã bị khoá…", and the account waits for the owner. Root is never struck.
- **/admin → Chống gian lận:** the mode switch, the cases (pending wipes first) and, per account, the evidence: its events with the client build (`X-Client-Info: music-together/<build>`) and the browser, and what a wipe would remove. **Xoá dữ liệu** wipes a banned account's game data (xu, gear, fish, records, rice; its land goes back to the village at the next field visit, and its catch and land lines leave the chat) and keeps a snapshot. **Ân xá** lifts a lock or a ban and clears the strikes, without restoring wiped data; unbanning an anti-cheat ban in the Accounts tab is the same pardon.
- **Review before enforcing:** after 7 days in log mode, look at the hard `log_only` rows. If any could come from an honest client, stay in log mode and fix the check; otherwise switch to Thi hành.
- The evidence is kept 90 days (strikes and wipe snapshots for good), at most 200 rows per account and Vietnam day besides the strikes. No IP address is stored.

### Also in this release

- **Names:** 2–24 characters, no hidden characters and no reserved names (Ao cá, Hợp tác xã, root…); names that differ only in case, spacing or Unicode form are the same name. A banned account is told so at login, after the right password.
- **Chat:** catch and land announcements are system lines that only the server can post; a look-alike line from a member shows as a normal message.
- **Queue:** 11-character YouTube ids only; the title is cleaned, the thumbnail comes from the id, and an impossible duration counts as unknown.
- **Fishing:** at most 300 casts per Vietnam day ("Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!").
- **Banned accounts** leave the records and the richest list, earn no song bonus, and lose their land-market listings and offers.

### Trust model (updated)

- **v14:** as above, plus the daily cap: a script that reels at the gate lands at most 300 fish a day instead of 960, and a reel reported faster than the gate is a strike.
- **v15:** v15.1 ignores the transplant and harvest quality and uses 1.0 until the v15.2 minigames; a quality outside [0.9, 1.1] is a strike.

### Realtime hardening

The server never sees Broadcast, so each client filters what it receives. `hello`, `bye`, `lk`, `fs`, `fa` and `fp` count only from a member who is in this map's presence in game mode. Each sender has a budget — movement 5/s, `hello` and `bye` 1 per 10 s, `fs` and `fa` 2/s, reactions 4/s (12/s in all) — and the rest is dropped; `fp` refetches start at least 2 s apart, and a look is fetched again at most once per 30 s. A member whose `hello` arrived before their presence still gets everyone's state. Not stopped: a spoofer using the id of a member who is on the map, fake presence, and floods against the project's Realtime quota (spec §14).
