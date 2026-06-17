# Music Together v7 — Pixel Cozy Theme + Theme Switcher + Pixel Logo (Design)

**Date:** 2026-06-17
**Builds on:** v6 (merged to `main`). Next.js 16.2.9, React 19, TS 5, Tailwind v4, custom account/session auth.

## 1. Goal

Add a second, user-selectable visual theme — **"Pixel Cozy"** (Stardew-ish cozy pixel: warm pastel palette, pixel heading font, a pixel **radio/boombox** in place of the vinyl turntable, and a new **pixel logo**) — alongside the existing **"Vinyl Salon"** default. Anyone can switch themes; the choice persists per browser. **All app logic (RPCs, realtime, hooks, queue/chat/roles/playback) stays exactly as-is** — this is a presentation-only change.

## 2. Constraints

- **Presentation-only.** No changes to Supabase, RPCs, realtime, auth, or any hook/business logic. No DB/migration.
- **Reuse existing token classes.** Components keep their current Tailwind classes (`bg-burgundy`, `text-cream`, `border-gold`, `font-playfair`, …). Theming works by **remapping the CSS variables those classes already reference**, scoped to `html[data-theme="cozy"]`. Only a few components that need a *structural* variant (logo art, turntable→radio) read the active theme from a small context.
- **Vietnamese stays sharp.** Pixel font is used for **headings/wordmark only**; body text keeps a readable serif. (Pixel fonts have weak Vietnamese diacritic coverage.)
- **No new runtime deps.** Pixel font loaded via `next/font/google` (Pixelify Sans). Pixel logo is hand-authored **SVG** (crisp at any size, theme-colored).
- **No FOUC / no hydration mismatch.** The `data-theme` attribute is applied before first paint via a tiny inline script; React state defaults to "salon" on server + first client render, then syncs.
- **Repo is public; auto-deploys `main`.** Remove the temporary `/themes` preview page as part of this work.

## 3. Architecture

### 3.1 Token remap (the core trick)
Tailwind v4 `@theme` emits the palette as CSS custom properties on `:root`, and every utility (`bg-burgundy`) compiles to `var(--color-burgundy)`. So a theme = **override those same variable names** under a higher-specificity selector:

```css
/* app/globals.css — defaults (salon) stay in @theme as today */
html[data-theme="cozy"] {
  --color-parchment: #f4e4c1;  --color-parchment-200: #ecdab8;  --color-parchment-300: #e0cfa6;
  --color-cream: #fbf3df;
  --color-ink: #5c4033;
  --color-burgundy: #d97c5a;        /* primary: terracotta */
  --color-burgundy-accent: #c2552f; /* hover/danger */
  --color-gold: #7fb069;            /* borders/secondary: green */
  --color-gold-200: #bcd3a0;
  --color-green-vintage: #6db5c9;   /* online/DJ accent: sky */
}
```
Because `html[data-theme="cozy"]` beats `:root` for the same element, every existing utility re-resolves to the cozy value automatically — **no component class changes**.

Also remap the heading/label fonts and the body background (both currently hardcoded), scoped to the theme:
```css
html[data-theme="cozy"] {
  --font-playfair: var(--font-pixel);    /* titles + wordmark → pixel */
  --font-cormorant: var(--font-pixel);   /* section headings + chrome buttons → pixel */
}
html[data-theme="cozy"] body {
  background: #f4e4c1;                    /* flat cozy bg (replaces the salon gradient) */
}
```
Body text keeps `--font-eb-garamond` (readable) — so the VN-heavy content (chat messages, queue titles, usernames, descriptions, which inherit the body font) stays sharp; only the short "chrome" text in `font-playfair`/`font-cormorant` utilities (titles, "Hàng đợi"/"Trò chuyện"/"Thành viên" headings, "+ Thêm"/"Gửi" buttons, wordmark) becomes pixel.

### 3.2 Theme context + persistence (no logic touched)
- `lib/theme.ts` — `export type ThemeName = "salon" | "cozy";` and a pure `parseTheme(v: string | null): ThemeName` (returns `"cozy"` only for the exact string, else `"salon"`). Unit-tested.
- `hooks/useTheme.tsx` — a tiny `ThemeProvider` (client) + `useTheme()` context returning `{ theme, setTheme }`. On mount it reads `localStorage["music-together:theme"]` (via `parseTheme`) and on every change sets `document.documentElement.setAttribute("data-theme", theme)` + persists. Default `"salon"`.
- Mounted in `app/Providers.tsx` (wraps the app, alongside `AuthProvider` + `NotifyOnLoad`).
- **Anti-FOUC inline script** in `app/layout.tsx` `<head>`: a `<script>` that reads the localStorage value and sets `document.documentElement.dataset.theme` synchronously before paint (so a cozy user never flashes salon). It's a 3-line IIFE, no deps.

### 3.3 Structural variants via context
Three brand surfaces need a different *shape* (not just color) in cozy; each reads `useTheme()` and branches presentationally (same props, same logic):
- **Logo** (`components/brand/Logo.tsx`): salon → existing `logo.png` image; cozy → `<PixelLogo>` SVG. Wordmark uses `font-playfair` (auto-pixel under cozy).
- **BrandSpinner** (`components/brand/BrandSpinner.tsx`): salon → pulsing `logo.png`; cozy → pulsing `<PixelLogo>`.
- **Turntable** (`components/room/Turntable.tsx`): salon → existing spinning vinyl disc; cozy → a **pixel radio/boombox** that reflects the same `isPlaying`/`current` state (e.g. an equalizer/“on-air” light animates while playing, still pulls the thumbnail/title). Playback logic and props unchanged — only the rendered art differs.

## 4. Pixel logo

`components/brand/PixelLogo.tsx` — a hand-authored **SVG pixel-art radio/boombox** rendered from a small grid (rows of chars → `<rect>` cells, `shape-rendering="crispEdges"`). Two speakers + a center dial/cassette window + a top handle/antenna. Colors come from theme tokens (terracotta body, brown outline, green/sky accents) via `currentColor` + a few fills, so it harmonizes with whatever theme it's shown under. Props: `{ size?: number }`. Used by `Logo`, `BrandSpinner`, and the Turntable cozy variant; square + scalable so it also works small.

(The favicon stays `logo.png` — a per-user runtime theme can't drive the document favicon cleanly, and the tab icon need not match the in-app theme. Out of scope.)

## 5. Pixel font

Load **Pixelify Sans** via `next/font/google` in `app/layout.tsx`, exposing `--font-pixel`; add its variable to the `<html>` className alongside the existing font vars. Try `subsets: ["latin", "vietnamese"]`; if that font/subset isn't available at build, fall back to `["latin"]` and accept per-glyph fallback for heading diacritics (body text — the bulk of Vietnamese — stays in the readable serif regardless). Only the chrome tokens (`--font-playfair` + `--font-cormorant`) are remapped to pixel under cozy (§3.1); the body token stays readable.

## 6. Theme switcher UI

A compact control `components/brand/ThemeToggle.tsx` — two small buttons "🎩 Salon / 🎮 Pixel" (or a segmented toggle) calling `setTheme(...)`, highlighting the active one. Rendered in:
- `components/lobby/Lobby.tsx` top-bar control cluster (next to Feedback / admin / logout).
- `components/room/Header.tsx` right-hand controls cluster.

The attribute lives on `<html>`, so switching re-themes the entire app (including AuthScreen) regardless of where the toggle is. Persists in localStorage; everyone can use it (pure client preference, no auth/role gating).

## 7. Cleanup
Delete `app/themes/page.tsx` (the temporary preview route added during brainstorming).

## 8. Files
```
app/globals.css                 # MODIFY: html[data-theme="cozy"] token/font/bg overrides
app/layout.tsx                  # MODIFY: load Pixelify Sans (--font-pixel) + add var to <html>; anti-FOUC inline script
app/Providers.tsx               # MODIFY: wrap with ThemeProvider
lib/theme.ts                    # CREATE: ThemeName + parseTheme()
hooks/useTheme.tsx              # CREATE: ThemeProvider + useTheme()
components/brand/PixelLogo.tsx   # CREATE: SVG pixel radio/boombox logo
components/brand/ThemeToggle.tsx # CREATE: Salon/Pixel switcher
components/brand/Logo.tsx        # MODIFY: theme-aware (png vs PixelLogo)
components/brand/BrandSpinner.tsx# MODIFY: theme-aware
components/room/Turntable.tsx     # MODIFY: cozy pixel-radio variant (presentational)
components/lobby/Lobby.tsx        # MODIFY: render ThemeToggle
components/room/Header.tsx        # MODIFY: render ThemeToggle
tests/unit/theme.test.ts          # CREATE: parseTheme()
app/themes/page.tsx               # DELETE: temporary preview
```

## 9. Error handling / edge cases
- localStorage unavailable / blocked → default "salon", no throw (guarded).
- Unknown stored value → `parseTheme` returns "salon".
- SSR: server + first client render use "salon" default; the inline script sets the real attribute pre-paint; `ThemeProvider` syncs state in an effect (no hydration mismatch since DOM attribute ≠ React state, and we don't render theme-dependent *markup* on first paint — Logo/Turntable read context which is "salon" until mount, matching SSR; the inline script only changes the attribute/colors, not the React tree).

> Note on Logo/Turntable structural branch + SSR: to avoid a hydration mismatch (server renders salon art, client may want cozy art), the structural components render the **salon variant on the server and first client render**, then switch to the cozy variant after `useTheme` resolves in an effect (a one-frame swap, acceptable). Colors/fonts (CSS-var based) swap with zero flash via the inline script.

## 10. Testing
- **Unit** (`tests/unit/theme.test.ts`): `parseTheme("cozy")==="cozy"`, `parseTheme("salon")==="salon"`, `parseTheme(null)/"x"/""==="salon"`.
- Visual/theme-swap, pixel logo, pixel radio, font, persistence, FOUC → **manual testing** (browser/CSS).

## 11. Out of scope (YAGNI / future)
- The "Cyber Tím / purple neon" theme (deferred; could be added later as another `data-theme` block).
- Theme-aware favicon and theme-aware OG image.
- Full pixel re-skin of every radius/shadow (cozy keeps existing shapes; pixel feel comes from font + logo + radio + palette).
- A theme picker on the AuthScreen surface (the toggle in Lobby/Header re-themes everything anyway).
- Server-persisted per-account theme (localStorage per-browser is enough).
