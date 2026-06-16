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
3. The app is client-rendered; the only server code is the `/api/oembed` proxy (a lightweight, cached function).

### Notes
- Free Supabase projects pause after ~1 week of inactivity; the first request after that is slow.
- Realtime is read-only; all writes are authorized server-side via SECURITY DEFINER RPCs.
- Phase 2 (deferred): chat, emoji reactions, song likes (UI placeholders already present); optional in-app YouTube search (needs a `YOUTUBE_API_KEY`).

## v2: Accounts & Lobby

**One-time DB migration:** open the Supabase SQL Editor and run `supabase/migrations/0004_v2_rebuild.sql`. This drops all v1 tables and functions and rebuilds the account-native schema — room data is wiped, which is acceptable in dev/staging.

**Env vars:** unchanged — `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are the only required variables.

**What's new in v2:**
- Username + password accounts (custom `accounts`/`sessions` tables + bcrypt + a per-account session token — **not** Supabase Auth); role (Admin / DJ) follows the account across devices.
- Lobby page showing all currently-active rooms (via global Realtime Presence) with live participant counts.
- Animated turntable on the room page.
- Copy-code and share buttons for easy room invites.
