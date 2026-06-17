# Music Together v7 Implementation Plan — Pixel Cozy Theme + Switcher + Pixel Logo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable "Pixel Cozy" theme (warm pastel palette, pixel heading font, pixel radio in place of the vinyl turntable, new pixel logo) alongside the existing "Vinyl Salon" default — switchable, persisted, with zero changes to app logic.

**Architecture:** A `data-theme="cozy"` attribute on `<html>` remaps the existing CSS color/font variables (so current Tailwind token classes auto-recolor); a `ThemeProvider` manages the attribute + localStorage; three brand surfaces (Logo, BrandSpinner, Turntable) read the theme from context for a structural variant; a header toggle switches it. No DB, RPC, realtime, or hook logic changes.

**Tech Stack:** Next.js 16.2.9, React 19, TS 5, Tailwind v4 (`@theme` CSS vars), `next/font/google` (Pixelify Sans), Vitest.

## Global Constraints
- **Presentation-only** — no Supabase/RPC/realtime/auth/hook/logic changes; no DB/migration.
- **Reuse token classes** — theme by remapping CSS vars under `html[data-theme="cozy"]`, not by editing component classes.
- **Vietnamese stays sharp** — pixel font on headings/labels only (`--font-playfair` + `--font-cormorant`); body keeps `--font-eb-garamond`.
- **No new runtime deps** — pixel font via `next/font/google`; pixel logo is hand-authored SVG.
- **No FOUC / no hydration mismatch** — inline script sets `data-theme` pre-paint; React theme state defaults to `"salon"` on server + first client render, then syncs; structural components render the salon variant first, swap after mount.
- **Next 16.2.9** (heed deprecations); Tailwind v4 canonical classes.
- **Branch:** `feat/v7-pixel-theme` (merge to `main` when done; auto-deploys — no Supabase step).
- Cozy palette: bg `#f4e4c1`, cream `#fbf3df`, ink/text `#5c4033`, primary `#d97c5a`, primary-accent `#c2552f`, gold→green `#7fb069`, gold-200 `#bcd3a0`, green-vintage→sky `#6db5c9`.

**Spec:** [docs/superpowers/specs/2026-06-17-music-together-v7-pixel-cozy-theme-design.md](../specs/2026-06-17-music-together-v7-pixel-cozy-theme-design.md).

---

## File map (v7)
```
lib/theme.ts                     # CREATE: ThemeName + parseTheme() (Task 1)
hooks/useTheme.tsx               # CREATE: ThemeProvider + useTheme() (Task 1)
tests/unit/theme.test.ts          # CREATE: parseTheme tests (Task 1)
app/layout.tsx                    # MODIFY: Pixelify font (--font-pixel) + anti-FOUC script (Task 1)
app/Providers.tsx                 # MODIFY: wrap with ThemeProvider (Task 1)
app/globals.css                   # MODIFY: html[data-theme="cozy"] palette/font/bg (Task 2); eq keyframe (Task 5)
components/brand/PixelLogo.tsx     # CREATE: SVG pixel radio/boombox logo (Task 3)
components/brand/Logo.tsx          # MODIFY: theme-aware png vs PixelLogo (Task 3)
components/brand/BrandSpinner.tsx  # MODIFY: theme-aware (Task 3)
components/brand/ThemeToggle.tsx   # CREATE: Salon/Pixel switcher (Task 4)
components/lobby/Lobby.tsx         # MODIFY: render ThemeToggle (Task 4)
components/room/Header.tsx         # MODIFY: render ThemeToggle (Task 4)
components/room/Turntable.tsx      # MODIFY: cozy pixel-radio variant (Task 5)
app/themes/page.tsx               # DELETE: temporary preview (Task 6)
README.md                         # MODIFY: v7 notes (Task 6)
```

---

## Task 1: Theme mechanism — parse + provider + font + FOUC

**Files:** Create `lib/theme.ts`, `hooks/useTheme.tsx`, `tests/unit/theme.test.ts`; Modify `app/layout.tsx`, `app/Providers.tsx`.

**Interfaces:**
- Produces: `type ThemeName = "salon" | "cozy"`, `parseTheme(v: string | null): ThemeName` (lib/theme.ts); `ThemeProvider`, `useTheme(): { theme: ThemeName; setTheme: (t: ThemeName) => void }` (hooks/useTheme.tsx).

- [ ] **Step 1: Write the failing test** `tests/unit/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTheme } from "@/lib/theme";

describe("parseTheme", () => {
  it("returns 'cozy' only for the exact value", () => {
    expect(parseTheme("cozy")).toBe("cozy");
  });
  it("returns 'salon' for 'salon'", () => {
    expect(parseTheme("salon")).toBe("salon");
  });
  it("defaults to 'salon' for null / unknown / empty", () => {
    expect(parseTheme(null)).toBe("salon");
    expect(parseTheme("")).toBe("salon");
    expect(parseTheme("nope")).toBe("salon");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/theme.test.ts` → FAIL (cannot resolve `@/lib/theme`).

- [ ] **Step 3: Create `lib/theme.ts`**:

```ts
export type ThemeName = "salon" | "cozy";

/** Validate a stored/raw theme value; anything other than the known themes → "salon". */
export function parseTheme(v: string | null): ThemeName {
  return v === "cozy" ? "cozy" : "salon";
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- tests/unit/theme.test.ts` → PASS.

- [ ] **Step 5: Create `hooks/useTheme.tsx`**:

```tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { parseTheme, type ThemeName } from "@/lib/theme";

const KEY = "music-together:theme";

const ThemeCtx = createContext<{ theme: ThemeName; setTheme: (t: ThemeName) => void }>({
  theme: "salon", setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("salon");
  const hydrated = useRef(false);

  // Apply to <html> + persist on change. Skip the very first run so we don't
  // clobber the attribute the anti-FOUC inline script already set pre-paint.
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  // Hydrate React state from localStorage after mount (runs after the apply effect above).
  useEffect(() => {
    let v: string | null = null;
    try { v = localStorage.getItem(KEY); } catch { /* ignore */ }
    setThemeState(parseTheme(v));
  }, []);

  const setTheme = useCallback((t: ThemeName) => setThemeState(t), []);
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }
```

- [ ] **Step 6: Wrap the app in `app/Providers.tsx`** — replace its contents with:

```tsx
"use client";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import NotifyOnLoad from "@/components/NotifyOnLoad";
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider><NotifyOnLoad />{children}</AuthProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 7: Load the pixel font + add the anti-FOUC script in `app/layout.tsx`.**

(a) Add the import + font (after the `Playfair_Display` line):
```tsx
import { Cormorant_Garamond, EB_Garamond, Playfair_Display, Pixelify_Sans } from "next/font/google";
```
```tsx
const pixel = Pixelify_Sans({ variable: "--font-pixel", subsets: ["latin"], display: "swap" });
```
(b) Add `${pixel.variable}` to the `<html>` className:
```tsx
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} ${ebGaramond.variable} ${playfair.variable} ${pixel.variable} h-full antialiased`}
```
(c) Make `<body>`'s first child the inline theme script (sets `data-theme` before paint):
```tsx
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('music-together:theme')==='cozy')document.documentElement.setAttribute('data-theme','cozy')}catch(e){}" }} />
        <Providers>{children}</Providers>
      </body>
```

- [ ] **Step 8: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds; Pixelify Sans downloads). Theme has no visual effect yet (CSS is Task 2), but `ThemeProvider` mounts and the script is present.

- [ ] **Step 9: Commit**

```bash
git add lib/theme.ts hooks/useTheme.tsx tests/unit/theme.test.ts app/layout.tsx app/Providers.tsx
git commit -m "feat: theme mechanism — parseTheme, ThemeProvider, pixel font, anti-FOUC script"
```

---

## Task 2: Cozy palette/font/background in `globals.css`

**Files:** Modify `app/globals.css`

**Interfaces:**
- Consumes: `data-theme="cozy"` attribute (Task 1); `--font-pixel` (Task 1).
- Produces: cozy visual styling for all existing token utilities.

- [ ] **Step 1: Append the cozy override block to `app/globals.css`** (at the end of the file, after the scrollbar block):

```css
/* ===== Pixel Cozy theme — remap the salon tokens (components keep their classes) ===== */
html[data-theme="cozy"] {
  --color-parchment: #f4e4c1;
  --color-parchment-200: #ecdab8;
  --color-parchment-300: #e0cfa6;
  --color-cream: #fbf3df;
  --color-ink: #5c4033;
  --color-burgundy: #d97c5a;
  --color-burgundy-accent: #c2552f;
  --color-gold: #7fb069;
  --color-gold-200: #bcd3a0;
  --color-green-vintage: #6db5c9;
  /* pixel font for headings/labels/buttons; body stays --font-eb-garamond (Vietnamese stays sharp) */
  --font-playfair: var(--font-pixel);
  --font-cormorant: var(--font-pixel);
}
html[data-theme="cozy"] body {
  background: #f4e4c1;
}
```

- [ ] **Step 2: Verify** — `npm run build` (succeeds). Manually confirm: in devtools set `<html data-theme="cozy">` → the app recolors to the cozy palette and `font-playfair`/`font-cormorant` headings render in the pixel font; scrollbars (which use `--color-gold`/`--color-parchment`) turn green/cream automatically. Remove the attribute → back to salon.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: Pixel Cozy palette + pixel heading font + cozy background"
```

---

## Task 3: Pixel logo + theme-aware Logo / BrandSpinner

**Files:** Create `components/brand/PixelLogo.tsx`; Modify `components/brand/Logo.tsx`, `components/brand/BrandSpinner.tsx`

**Interfaces:**
- Consumes: `useTheme()` (Task 1).
- Produces: `PixelLogo({ size?: number })` default export.

- [ ] **Step 1: Create `components/brand/PixelLogo.tsx`** (SVG pixel radio/boombox; fills use theme tokens so it matches whatever theme it renders under):

```tsx
const GRID = [
  "....bbbbbbbb....",
  "....b......b....",
  ".bbbbbbbbbbbbbb.",
  ".boooooooooooob.",
  ".bsssoccccosssb.",
  ".bsksoccccosksb.",
  ".bsksoccccosksb.",
  ".bsssoooooosssb.",
  ".boookkkkkkooob.",
  ".boooooooooooob.",
  ".bbbbbbbbbbbbbb.",
];
const FILL: Record<string, string> = {
  b: "var(--color-ink)",
  o: "var(--color-burgundy)",
  s: "var(--color-gold)",
  k: "var(--color-ink)",
  c: "var(--color-green-vintage)",
};
const COLS = 16;
const ROWS = GRID.length;

export default function PixelLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={(size * ROWS) / COLS} viewBox={`0 0 ${COLS} ${ROWS}`}
      shapeRendering="crispEdges" role="img" aria-label="Music Together">
      {GRID.flatMap((row, y) =>
        [...row].map((ch, x) => {
          const f = FILL[ch];
          return f ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={f} /> : null;
        }),
      )}
    </svg>
  );
}
```

- [ ] **Step 2: Replace `components/brand/Logo.tsx`** (theme-aware; renders salon on server + first client render, cozy after mount):

```tsx
"use client";

import Image from "next/image";
import logo from "@/public/logo.png";
import { useTheme } from "@/hooks/useTheme";
import PixelLogo from "./PixelLogo";

export default function Logo({ size = 32, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  const { theme } = useTheme();
  return (
    <span className="inline-flex items-center gap-2">
      {theme === "cozy"
        ? <PixelLogo size={size} />
        : <Image src={logo} alt="Music Together" height={size} width={Math.round((size * 3) / 2)}
            style={{ height: size, width: "auto" }} preload={true} />}
      {withWordmark && <span className="font-playfair text-2xl font-bold text-burgundy">Music Together</span>}
    </span>
  );
}
```

- [ ] **Step 3: Replace `components/brand/BrandSpinner.tsx`** (theme-aware):

```tsx
"use client";

import Image from "next/image";
import logo from "@/public/logo.png";
import { useTheme } from "@/hooks/useTheme";
import PixelLogo from "./PixelLogo";

export default function BrandSpinner({ label = "Đang tải…" }: { label?: string }) {
  const { theme } = useTheme();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <span className="animate-brand-pulse">
        {theme === "cozy"
          ? <PixelLogo size={72} />
          : <Image src={logo} alt="" height={72} width={108} style={{ height: 72, width: "auto" }} preload={true} />}
      </span>
      <p className="font-cormorant text-burgundy">{label}</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds). With `data-theme="cozy"` (set via localStorage in the next task, or devtools + a reload through the provider), Logo/BrandSpinner show the pixel boombox. (Note: making Logo/BrandSpinner client components is fine — every caller — Lobby, Header, AuthScreen, admin, page, RoomClient — is already a client component.)

- [ ] **Step 5: Commit**

```bash
git add components/brand/PixelLogo.tsx components/brand/Logo.tsx components/brand/BrandSpinner.tsx
git commit -m "feat: pixel boombox logo + theme-aware Logo/BrandSpinner"
```

---

## Task 4: Theme switcher in the header

**Files:** Create `components/brand/ThemeToggle.tsx`; Modify `components/lobby/Lobby.tsx`, `components/room/Header.tsx`

**Interfaces:**
- Consumes: `useTheme()` (Task 1).
- Produces: `ThemeToggle()` default export.

- [ ] **Step 1: Create `components/brand/ThemeToggle.tsx`**:

```tsx
"use client";

import { useTheme } from "@/hooks/useTheme";
import type { ThemeName } from "@/lib/theme";

const OPTIONS: { id: ThemeName; label: string }[] = [
  { id: "salon", label: "🎩 Salon" },
  { id: "cozy", label: "🎮 Pixel" },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <span className="inline-flex overflow-hidden rounded-full border border-gold text-xs">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" onClick={() => setTheme(o.id)}
          className={`px-2.5 py-1 ${theme === o.id ? "bg-burgundy text-cream" : "text-burgundy"}`}
          aria-pressed={theme === o.id}>
          {o.label}
        </button>
      ))}
    </span>
  );
}
```

- [ ] **Step 2: Render it in `components/lobby/Lobby.tsx`** — add the import and place it first in the header control cluster.

Add import (after the `Logo` import):
```tsx
import ThemeToggle from "@/components/brand/ThemeToggle";
```
Change the control cluster `<div className="flex items-center gap-2">` opening so its first child is the toggle:
```tsx
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <FeedbackButton />
```

- [ ] **Step 3: Render it in `components/room/Header.tsx`** — add the import and place it in the right-hand controls cluster.

Add import (after the `Logo` import):
```tsx
import ThemeToggle from "@/components/brand/ThemeToggle";
```
Change the right controls `<div className="flex items-center gap-2">` so its first child is the toggle:
```tsx
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="inline-flex overflow-hidden rounded-full border border-gold text-xs">
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build`. End-to-end: in the lobby/room, clicking **🎮 Pixel** recolors the whole app, swaps headings to pixel font + the logo to the boombox, and persists across reload; **🎩 Salon** restores the vinyl look.

- [ ] **Step 5: Commit**

```bash
git add components/brand/ThemeToggle.tsx components/lobby/Lobby.tsx components/room/Header.tsx
git commit -m "feat: theme switcher (Salon/Pixel) in lobby + room header"
```

---

## Task 5: Turntable → pixel radio in cozy theme

**Files:** Modify `components/room/Turntable.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `useTheme()` (Task 1), `PixelLogo` (Task 3), the `eq` keyframe (added here).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the equalizer keyframe to `app/globals.css`** (after the `float-up` block):

```css
/* ===== Pixel radio equalizer ===== */
@keyframes eq { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
```

- [ ] **Step 2: Replace `components/room/Turntable.tsx`** entirely (salon disc unchanged, new cozy radio branch):

```tsx
"use client";

import Image from "next/image";
import logo from "@/public/logo.png";
import { useTheme } from "@/hooks/useTheme";
import PixelLogo from "@/components/brand/PixelLogo";

function Speaker({ spinning }: { spinning: boolean }) {
  return (
    <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 ${spinning ? "animate-brand-pulse" : ""}`}
      style={{ background: "var(--color-gold)", borderColor: "var(--color-ink)" }}>
      <div className="h-9 w-9 rounded-full" style={{ background: "var(--color-ink)" }} />
    </div>
  );
}

function CozyRadio({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-64 w-80 select-none">
      <div className="absolute right-12 top-0 h-6 w-1" style={{ background: "var(--color-ink)" }} />
      <div className="absolute inset-x-4 bottom-6 top-6 rounded-md border-4 p-3"
        style={{ background: "var(--color-burgundy)", borderColor: "var(--color-ink)" }}>
        <div className="flex items-center gap-3">
          <Speaker spinning={spinning} />
          <div className="flex-1 rounded border-2 p-1" style={{ borderColor: "var(--color-ink)", background: "var(--color-cream)" }}>
            {thumbnail
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={thumbnail} alt="" className="h-16 w-full rounded object-cover" />
              : <div className="flex h-16 items-center justify-center"><PixelLogo size={44} /></div>}
            <div className="mt-1 flex h-5 items-end justify-center gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="w-1.5 origin-bottom" style={{
                  height: "100%", background: "var(--color-green-vintage)",
                  transform: spinning ? undefined : "scaleY(0.3)",
                  animation: spinning ? `eq 0.8s ${i * 0.1}s ease-in-out infinite` : "none",
                }} />
              ))}
            </div>
          </div>
          <Speaker spinning={spinning} />
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          {[0, 1, 2].map((i) => <span key={i} className="h-3 w-3 rounded-full" style={{ background: "var(--color-ink)" }} />)}
        </div>
      </div>
    </div>
  );
}

function VinylDisc({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-64 w-80">
      <div
        className={`absolute left-3 top-3.5 h-[230px] w-[230px] rounded-full shadow-2xl ${spinning ? "animate-vinyl" : "animate-vinyl animate-vinyl-paused"}`}
        style={{ background: "repeating-radial-gradient(circle at center,#15110b 0 2px,#241a10 2px 4px)" }}
      >
        <div className="absolute inset-[34%] flex items-center justify-center rounded-full"
          style={{ background: "radial-gradient(circle,#7a1f33,#6e2233 60%,#4d1722)", boxShadow: "0 0 0 2px #b08d57" }}>
          {thumbnail
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={thumbnail} alt="" className="h-full w-full rounded-full object-cover opacity-90" />
            : <Image src={logo} alt="" width={80} height={80} className="h-full w-full rounded-full object-cover opacity-90" />}
        </div>
        <div className="absolute inset-[48.5%] rounded-full bg-[#1a140d]" />
      </div>
      <div className="absolute bottom-[92px] right-[22px] h-3 w-6 rounded-full bg-[#8a6d2f] opacity-40" />
      <div
        className="absolute right-[26px] top-2 h-[150px] w-[18px] origin-[9px_9px] transition-transform duration-[900ms] ease-in-out"
        style={{ transform: spinning ? "rotate(36deg)" : "rotate(0deg)" }}
      >
        <div className="absolute left-0 top-0 h-5 w-5 rounded-full bg-[#8a6d2f] shadow" />
        <div className="absolute left-2 top-[9px] h-[130px] w-1 rounded bg-linear-to-b from-[#c8a86a] to-[#8a6d2f]" />
        <div className="absolute bottom-0 left-px h-4 w-[18px] rounded bg-burgundy" />
      </div>
    </div>
  );
}

export default function Turntable({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  const { theme } = useTheme();
  if (theme === "cozy") return <CozyRadio spinning={spinning} thumbnail={thumbnail} />;
  return <VinylDisc spinning={spinning} thumbnail={thumbnail} />;
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit`, `npm run lint` (0 errors; the two `<img>` keep their existing eslint-disable comments), `npm run build`. In a room under the Pixel theme: the turntable is a pixel boombox — speakers pulse and the equalizer bars animate while playing, freeze when paused; the thumbnail shows in the screen (or the pixel logo when none). Salon theme is unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/room/Turntable.tsx app/globals.css
git commit -m "feat: pixel radio/boombox turntable variant for the cozy theme"
```

---

## Task 6: Remove preview, README, full gate

**Files:** Delete `app/themes/page.tsx`; Modify `README.md`

**Interfaces:** none.

- [ ] **Step 1: Delete the temporary preview route**

```bash
git rm app/themes/page.tsx
```

- [ ] **Step 2: Append a `## v7: Themes (Vinyl Salon + Pixel Cozy)` section to `README.md`** (match the v3–v6 style) noting: **no migration / no config** — purely client UX; a 🎩 Salon / 🎮 Pixel toggle in the lobby + room header switches the whole app's look, persisted per browser (localStorage `music-together:theme`, default Salon), available to everyone; the Pixel Cozy theme uses a warm pastel palette, a pixel heading font (Pixelify Sans; body stays a readable serif so Vietnamese is sharp), a pixel boombox logo, and turns the turntable into a pixel radio; all app logic is unchanged (theming is CSS-variable + presentation only).

- [ ] **Step 3: Full gate** — `npm test` (unit pass incl. `tests/unit/theme.test.ts`; integration suites skip without DB env) + `npm run build` (succeeds; routes no longer include `/themes`). Confirm `npx tsc --noEmit` clean and `npm run lint` 0 errors. Capture summaries.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: v7 theme notes; remove temporary /themes preview"
```

---

## Self-review (completed during planning)
- **Spec coverage:** token-remap mechanism (Task 2) ✓; ThemeProvider + parse + persistence (Task 1) ✓; anti-FOUC script + pixel font load (Task 1) ✓; pixel logo SVG + theme-aware Logo/BrandSpinner (Task 3) ✓; theme switcher in lobby+header, everyone can use, persisted (Task 4) ✓; turntable→pixel radio (Task 5) ✓; VN-readable body + pixel chrome fonts (Task 2) ✓; cleanup /themes + README (Task 6) ✓; parseTheme unit test (Task 1) ✓. No DB/logic changes anywhere ✓.
- **Placeholder scan:** all code complete; the `GRID` rows are each exactly 16 chars; commands have expected outcomes.
- **Type consistency:** `ThemeName`/`parseTheme` (Task 1) used by `useTheme`, `ThemeToggle` (Task 4); `useTheme(): {theme, setTheme}` consumed by Logo/BrandSpinner (Task 3), ThemeToggle (Task 4), Turntable (Task 5); `PixelLogo({size})` (Task 3) used by Logo/BrandSpinner/Turntable; `Turntable({spinning, thumbnail})` props unchanged (RoomShell caller unaffected).
- **SSR/hydration:** `useTheme` initial state is `"salon"` (server + first client render); structural components (Logo/BrandSpinner/Turntable) render the salon variant first then swap after the provider's mount effect — no hydration mismatch; colors/fonts swap with no flash via the inline script + skip-first-apply in the provider.
- **Known/accepted:** favicon stays `logo.png` (per-user runtime theme can't drive the document favicon); Pixelify Sans loaded with `["latin"]` (heading diacritics fall back per-glyph; body Vietnamese stays sharp); cozy keeps existing border radii (pixel feel comes from font + logo + radio + palette); one-frame salon→cozy art swap on load is accepted.
