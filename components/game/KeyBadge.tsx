import { hotkeyLabel } from "@/lib/game/hotkeys";

/** The small corner key on a HUD button (the button needs `relative`); hidden on touch screens. */
export default function KeyBadge({ id }: { id: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-1 -right-1 rounded-sm bg-black/70 px-0.5 font-vt text-[10px] leading-none text-white pointer-coarse:hidden"
    >
      {hotkeyLabel(id).split(" ")[0]}
    </span>
  );
}
