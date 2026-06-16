"use client";

import type { RoomView } from "@/hooks/useRoom";
import Header from "./Header";
import MemberList from "./MemberList";
import ChatPanel from "./ChatPanel";
import NowPlaying from "./NowPlaying";
import Reactions from "./Reactions";
import AddSong from "./AddSong";
import Queue from "./Queue";
import { useDjController } from "@/hooks/useDjController";

export default function RoomShell({ view }: { view: RoomView }) {
  const { state, role, onlineIds, token, myMemberId } = view;
  const room = state.room!;
  const current = state.queue.find((q) => q.id === room.current_item_id) ?? null;
  // onlineIds are ACCOUNT ids (presence is keyed by account id); dj_member_id is a MEMBER id,
  // so map it to its account id before checking presence.
  const djAccountId = state.members.find((m) => m.id === room.dj_member_id)?.account_id ?? null;
  const djOnline = !!djAccountId && onlineIds.includes(djAccountId);

  // DJ-only playback engine (no-op for non-DJ). Returns transport handlers + duration/volume.
  const dj = useDjController({ room, current, isDj: role.isDj, queueLen: state.queue.length, roomId: room.id, token });

  return (
    <main className="mx-auto max-w-6xl p-3">
      <Header room={room} members={state.members} isAdmin={role.isAdmin} roomId={room.id} token={token} myMemberId={myMemberId} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22%_1fr_33%]">
        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <MemberList members={state.members} room={room} onlineIds={onlineIds} />
          <ChatPanel />
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <NowPlaying
            room={room} current={current} canControl={role.canControlPlayback}
            durationMs={dj.durationMs} volume={dj.volume} djOnline={djOnline}
            onPlayPause={dj.togglePlay} onSkip={dj.skip} onSeekMs={dj.seekMs} onVolume={dj.setVolume}
          />
          <Reactions />
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <AddSong roomId={room.id} token={token} />
          <p className="mb-2 text-[11px] text-ink/60">🔎 Ô tìm kiếm trong app: bật khi cấu hình API key (Phase 2)</p>
          <Queue queue={state.queue} currentId={room.current_item_id} canManage={role.canManageQueue} roomId={room.id} token={token} />
        </section>
      </div>
    </main>
  );
}
