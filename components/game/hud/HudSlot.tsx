"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The HUD's left column has a slot under the toolbar for the situational chips (Túi mỏ, a fish battle, the guide…):
// they stack there in order instead of floating at fixed offsets over the HUD. Outside the game shell (no slot) a chip
// renders where it is.

export const HudSlotContext = createContext<HTMLElement | null>(null);

export function HudSlotted({ children }: { children: ReactNode }) {
  const el = useContext(HudSlotContext);
  return el ? createPortal(children, el) : <>{children}</>;
}
