"use client";

import { useReactions } from "@/hooks/useReactions";
import { REACTION_EMOJIS } from "@/lib/reactions";

export default function Reactions({ roomId }: { roomId: string }) {
  const { emotes, react } = useReactions(roomId);
  return (
    <div className="relative mt-3">
      <div className="pointer-events-none absolute inset-x-0 bottom-12 h-40 overflow-hidden">
        {emotes.map((e) => (
          <span key={e.id} className="animate-float-up absolute bottom-0 left-1/2 text-2xl" style={{ marginLeft: e.x }}>
            {e.emoji}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2">
        {REACTION_EMOJIS.map((e) => (
          <button key={e} type="button" onClick={() => react(e)}
            className="rounded-full border border-gold-200 bg-cream px-2 py-1 text-lg transition hover:scale-110">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
