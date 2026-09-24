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
- **HUD:** now playing with the DJ's ▶/⏸, ⏭ and seek (DJ only), local volume, **🔈 Bật âm thanh**, 📜 Hàng đợi, 🏆 Bảng tin, ⚙️ (Admin/DJ), a chat bar, 💬 full chat and 👥 members.
- All art is original and drawn in code — there are no image assets.

### Realtime budget (Supabase free plan)

Movement uses a Broadcast channel `game:{roomId}` with tiny event messages: an idle player sends nothing, a walking player about 1–2 messages/s (a client never sends more than 3/s), and every message is delivered to each other player in the world. Example: 10 players walking a quarter of the time ≈ 30 events/s (limit 100/s) ≈ 110 k/hour, so the free 2 M messages/month cover roughly 18 hours of a 10-person session (about 100 hours with 4 people). Entering the world costs one `hello` plus one answer per player (answers spread over 1.5 s). Presence carries each member's view mode; switching views re-announces it — toggles within 1 s are merged and re-announcements are budgeted to at most 4 per 30 s, keeping the 5th call for a reconnect (Presence allows 5 calls per client per 30 s).
