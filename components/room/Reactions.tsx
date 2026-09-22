"use client";

import { useReactions } from "@/hooks/useReactions";
import { REACTION_EMOJIS } from "@/lib/reactions";

export default function Reactions({
  roomId,
  username,
}: {
  roomId: string;
  username?: string;
}) {
  const { emotes, react } = useReactions(roomId, username);

  return (
    <div className="relative mt-3">
      {/* Floating emotes container */}
      <div className="pointer-events-none absolute inset-x-0 bottom-12 h-52 overflow-hidden">
        {emotes.map((e) => {
          const name = e.username?.trim();
          const displayName = name || "Bạn bè";
          const initial = name ? name.charAt(0).toUpperCase() : "👤";
          return (
            <div
              key={e.id}
              className="animate-float-up absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-gold-200 bg-cream/95 px-2.5 py-1 shadow-md backdrop-blur-xs"
              style={{ marginLeft: e.x }}
            >
              {/* User initial avatar */}
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-burgundy text-[10px] font-bold text-cream shadow-xs"
                title={displayName}
              >
                {initial}
              </span>

              {/* Reaction Emoji */}
              <span className="text-xl leading-none">{e.emoji}</span>

              {/* Username text */}
              <span className="max-w-[85px] truncate font-serif text-xs font-semibold text-burgundy">
                {displayName}
              </span>
            </div>
          );
        })}
      </div>

      {/* Emoji reaction trigger buttons */}
      <div className="flex items-center justify-center gap-2">
        {REACTION_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => react(e)}
            className="rounded-full border border-gold-200 bg-cream px-2.5 py-1 text-lg shadow-xs transition-all hover:scale-115 hover:border-gold hover:bg-gold-200/30 active:scale-95"
            title={`Thả ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
