"use client";

// v21 "world" (0075): the world panel — Thế giới (day/night, snow, the schedule), Săn bắt (bag, album, the stall),
// Tổ đội (party, invites, chat), Boss (fights, ranking, the raid summon) and Hầm ngục (the party instance).
import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import {
  BOSS_DEFS, BOSS_PAID_PER_DAY, DUNGEON_BASE, DUNGEON_FEE, DUNGEON_PAID_PER_DAY, DUNGEON_POT, DUNGEON_ROOMS, MAX_COMBO, PARTY_MAX,
  RAID_ARENA, WILD_ITEMS, WILD_SPECIES, beat, inArena, sellPrice, type WildItemId,
} from "@/lib/game/realm/model";
import type { WorldState } from "@/lib/game/realm/rpc";
import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import type { World } from "./useWorld";

export type WorldTab = "world" | "wild" | "party" | "boss" | "dungeon";
const TABS: ReadonlyArray<[WorldTab, string]> = [
  ["world", "🌍 Thế giới"], ["wild", "🏹 Săn bắt"], ["party", "👥 Tổ đội"], ["boss", "⚔️ Boss"], ["dungeon", "🕳️ Hầm ngục"],
];
const MAP_NAME: Partial<Record<MapId, string>> = { hall: "Sảnh", pond: "Ao câu", field: "Đồng lúa", market: "Chợ Lớn", khu_nha: "Khu nhà", bai_dat: "Bãi đất trống", ham_ngam: "Hầm đấu" };

export default function WorldPanel(p: {
  tab: WorldTab; onTab: (t: WorldTab) => void; onClose: () => void; world: World; state: WorldState; now: number;
  mapId: MapId; pos: Vec | null; isOwner: boolean; accountId: string; atStall: boolean; atGate: boolean;
  vnTime: (ms: number) => string; clock: (ms: number) => string;
}) {
  const { tab, world: w, state: s, now } = p;
  return (
    <ParchmentModal title="🌍 Thế giới" onClose={p.onClose} className="sm:max-w-[640px]">
      <div className="mb-2 flex flex-wrap gap-1 font-vt">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} className={`pch-btn px-2 py-0.5 text-base ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => p.onTab(id)}>
            {label}{id === "party" && s.invites.length > 0 ? " ✉️" : ""}
          </button>
        ))}
      </div>
      <div className="font-vt text-base leading-snug">
        {tab === "world" && <WorldTabView {...p} />}
        {tab === "wild" && <WildTab w={w} s={s} atStall={p.atStall} />}
        {tab === "party" && <PartyTab w={w} s={s} me={p.accountId} />}
        {tab === "boss" && <BossTab w={w} s={s} now={now} mapId={p.mapId} pos={p.pos} clock={p.clock} vnTime={p.vnTime} />}
        {tab === "dungeon" && <DungeonTab w={w} s={s} now={now} atGate={p.atGate} clock={p.clock} />}
      </div>
    </ParchmentModal>
  );
}

function WorldTabView(p: { world: World; state: WorldState; now: number; isOwner: boolean; vnTime: (ms: number) => string; clock: (ms: number) => string }) {
  const { world: w, state: s, now } = p;
  return (
    <div className="flex flex-col gap-2">
      <p>{s.night ? "🌙 Đang là ban đêm (18:00–06:00): cáo, sói, gấu và đom đóm ra đồng; chợ đêm mua đồ săn giá +30 %; Sói Ma lúc 22:00." : "☀️ Đang là ban ngày: chim sẻ và hươu sao ra đồng; sạp thợ săn mở ở Bãi đất trống."}</p>
      <p>Giờ Việt Nam: <b>{p.vnTime(now)}</b></p>
      <div className="pch p-2">
        <p className="font-bold">❄️ Tuyết</p>
        {s.snowUntilMs ? <p>Tuyết đang rơi — còn {p.clock(s.snowUntilMs - now)}. Cá cắn chậm hơn, cá lớn nhiều hơn, xe chạy chậm, Người Tuyết có thể xuất hiện ở ao.</p>
          : <p>Việt Nam hiếm khi có tuyết: chủ phòng có thể gọi một trận tuyết (6 giờ một lần). Mã tuyết thật từ Open-Meteo cũng thành tuyết.</p>}
        {p.isOwner && (
          <div className="mt-1 flex flex-wrap gap-1">
            {!s.snowUntilMs && [15, 30, 60].map((m) => (
              <button key={m} type="button" className="pch-btn px-2 py-0.5" disabled={w.busy} onClick={() => w.snow.start(m)}>Gọi tuyết {m} phút</button>
            ))}
            {s.snowUntilMs && <button type="button" className="pch-btn px-2 py-0.5" disabled={w.busy} onClick={() => w.snow.stop()}>Dừng tuyết</button>}
          </div>
        )}
      </div>
      <div className="pch p-2">
        <p className="font-bold">📅 Lịch boss</p>
        {s.next.length === 0 ? <p>—</p> : s.next.map((n) => <p key={`${n.boss}${n.atMs}`}>{p.vnTime(n.atMs)} · {n.name} (Bãi đất trống)</p>)}
        <p className="text-sm opacity-80">Mưa/giông: Thủy Quái ở ao. Tuyết: Người Tuyết ở ao. Tổ đội ≥ 3 người gọi được Vua Heo Rừng.</p>
      </div>
    </div>
  );
}

function WildTab({ w, s, atStall }: { w: World; s: WorldState; atStall: boolean }) {
  const bag = s.wild?.bag ?? {};
  const items = (Object.keys(WILD_ITEMS) as WildItemId[]).filter((k) => (bag[k] ?? 0) > 0);
  return (
    <div className="flex flex-col gap-2">
      <p>Thú hoang sống ở Đồng lúa, Ao câu và Bãi đất trống. Lại gần để <b>săn</b>, <b>đặt bẫy</b> hoặc <b>chụp ảnh</b>. Ban đêm sói và gấu nguy hiểm: săn trượt sẽ bị hất văng, có thể ngất.</p>
      <div className="pch p-2">
        <p className="font-bold">🎒 Túi đồ săn {s.night ? "· 🏮 Chợ đêm +30 %" : ""}</p>
        {items.length === 0 && <p>Chưa có gì.</p>}
        {items.map((k) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <span>{WILD_ITEMS[k].icon} {WILD_ITEMS[k].name} × {bag[k]}</span>
            <span className="flex gap-1">
              <button type="button" className="pch-btn px-2 py-0.5" disabled={!atStall || w.busy} onClick={() => w.sell(k, 1)}>Bán 1 ({sellPrice(k, 1, s.night)} xu)</button>
              <button type="button" className="pch-btn px-2 py-0.5" disabled={!atStall || w.busy} onClick={() => w.sell(k, bag[k] ?? 0)}>Bán hết ({sellPrice(k, bag[k] ?? 0, s.night)} xu)</button>
            </span>
          </div>
        ))}
        {!atStall && items.length > 0 && <p className="text-sm opacity-80">Mang đến sạp thợ săn (Bãi đất trống, gần cầu) để bán.</p>}
        <p className="text-sm opacity-80">Hôm nay đã săn: {s.wild?.killsToday ?? 0}/60</p>
      </div>
      <div className="pch p-2">
        <p className="font-bold">📷 Album</p>
        <div className="grid grid-cols-2 gap-x-3">
          {WILD_SPECIES.map((sp) => (
            <span key={sp.id}>{(s.wild?.album[sp.id] ?? 0) > 0 ? "✅" : "▫️"} {sp.name} · {sp.active === "day" ? "ngày" : sp.active === "night" ? "đêm" : "cả ngày"} ({s.wild?.album[sp.id] ?? 0})</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PartyTab({ w, s, me }: { w: World; s: WorldState; me: string }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const party = s.party;
  const lead = party?.leader === me;
  return (
    <div className="flex flex-col gap-2">
      {s.invites.map((i) => (
        <div key={i.partyId} className="pch flex items-center justify-between gap-2 p-2">
          <span>✉️ {i.from} mời bạn vào tổ đội</span>
          <span className="flex gap-1">
            <button type="button" className="pch-btn pch-btn-primary px-2 py-0.5" disabled={w.busy} onClick={() => w.party.accept(i.partyId)}>Vào</button>
            <button type="button" className="pch-btn px-2 py-0.5" disabled={w.busy} onClick={() => w.party.decline(i.partyId)}>Từ chối</button>
          </span>
        </div>
      ))}
      {!party ? (
        <div className="flex flex-col gap-1">
          <p>Lập tổ đội (tối đa {PARTY_MAX} người) để đánh boss tổ đội, vào hầm ngục và thấy nhau trên bản đồ nhỏ.</p>
          <button type="button" className="pch-btn pch-btn-primary self-start px-2 py-0.5" disabled={w.busy} onClick={() => w.party.create()}>Lập tổ đội</button>
        </div>
      ) : (
        <>
          <div className="pch p-2">
            <p className="font-bold">👥 Tổ đội ({party.members.length}/{PARTY_MAX})</p>
            {party.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <span>{m.id === party.leader ? "👑 " : ""}{m.name}{m.id === me ? " (bạn)" : ""} · {m.map ? MAP_NAME[m.map] : "vắng mặt"}</span>
                {lead && m.id !== me && <button type="button" className="pch-btn px-2 py-0.5 text-sm" disabled={w.busy} onClick={() => w.party.kick(m.id)}>Mời ra</button>}
              </div>
            ))}
            <div className="mt-1 flex flex-wrap gap-1">
              {lead && party.members.length < PARTY_MAX && (
                <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { w.party.invite(name.trim()); setName(""); } }}>
                  <input className="rounded-sm border-2 border-ink bg-parchment w-36 px-1" placeholder="Tên người chơi" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
                  <button type="submit" className="pch-btn px-2 py-0.5" disabled={w.busy}>Mời</button>
                </form>
              )}
              <button type="button" className="pch-btn px-2 py-0.5" disabled={w.busy} onClick={() => w.party.leave()}>Rời đội</button>
            </div>
          </div>
          <div className="pch p-2">
            <p className="font-bold">💬 Chat tổ đội</p>
            <div className="max-h-40 overflow-y-auto">
              {party.chat.length === 0 && <p className="opacity-70">Chưa có tin nhắn.</p>}
              {party.chat.map((c) => <p key={c.id}><b>{c.name}:</b> {c.body}</p>)}
            </div>
            <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) { w.party.say(msg.trim()); setMsg(""); } }}>
              <input className="rounded-sm border-2 border-ink bg-parchment min-w-0 flex-1 px-1" placeholder="Nhắn cả đội…" value={msg} maxLength={120} onChange={(e) => setMsg(e.target.value)} />
              <button type="submit" className="pch-btn px-2 py-0.5" disabled={w.busy}>Gửi</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function BossTab({ w, s, now, mapId, pos, clock, vnTime }: { w: World; s: WorldState; now: number; mapId: MapId; pos: Vec | null; clock: (ms: number) => string; vnTime: (ms: number) => string }) {
  const raidDef = BOSS_DEFS.find((b) => b.id === "heo_rung");
  const inRaid = inArena(mapId, pos, RAID_ARENA);
  return (
    <div className="flex flex-col gap-2">
      <p>Sát thương do máy chủ tính: đánh đúng nhịp (0,9–2 giây sau cú trước) để tăng combo (tối đa {MAX_COMBO}, +15 % mỗi bậc). Mỗi người chỉ góp tối đa một phần máu boss — cần nhiều người mới hạ được. Thưởng chia theo công sức (≥ 1 % máu).</p>
      {s.fights.length === 0 && <p>Hiện chưa có boss nào. Boss thế giới: {s.next.map((n) => `${n.name} ${vnTime(n.atMs)}`).join(", ") || "—"}.</p>}
      {s.fights.map((f) => (
        <div key={f.id} className="pch p-2">
          <p className="font-bold">{f.name} · {f.map === "pond" ? "Ao câu cá (bờ đông)" : "Bãi đất trống (giữa bãi)"}</p>
          <p className="tabular-nums">
            {f.status === "dead" ? `🏆 Đã bị hạ${f.killer ? ` — đòn kết liễu: ${f.killer}` : ""}` : f.status === "gone" ? "Đã bỏ đi."
              : now < f.startsMs ? `Xuất hiện sau ${clock(f.startsMs - now)}` : `❤️ ${f.hp}/${f.maxHp} · giai đoạn ${f.phase}/3 · còn ${clock(f.endsMs - now)}`}
          </p>
          <p className="text-sm">Bạn góp: {f.myDmg}/{f.cap} · {f.fighters} người tham chiến</p>
          {f.top.length > 0 && <p className="text-sm">🏅 {f.top.map((t) => `${t.name} ${t.dmg}`).join(" · ")}</p>}
        </div>
      ))}
      {raidDef && (
        <div className="pch p-2">
          <p className="font-bold">🐗 Boss tổ đội: {raidDef.name}</p>
          <p className="text-sm">
            Cần tổ đội có ≥ 3 thành viên cùng đứng trong đấu trường giữa Bãi đất trống. Mỗi người chỉ góp vào 1 lần gọi mỗi giờ
            (lập lại đội cũng vậy). Mỗi ngày chỉ {BOSS_PAID_PER_DAY} trận boss tổ đội và {BOSS_PAID_PER_DAY} trận boss mưa/tuyết có xu,
            sau đó chỉ có kinh nghiệm.
          </p>
          <button type="button" className="pch-btn pch-btn-primary mt-1 px-2 py-0.5" disabled={w.busy || !s.party || !inRaid} onClick={() => w.summon()}>
            Gọi {raidDef.name}
          </button>
          {!inRaid && <span className="ml-2 text-sm opacity-80">(hãy vào đấu trường)</span>}
        </div>
      )}
    </div>
  );
}

function DungeonTab({ w, s, now, atGate, clock }: { w: World; s: WorldState; now: number; atGate: boolean; clock: (ms: number) => string }) {
  const run = s.dungeon;
  const room = run ? DUNGEON_ROOMS.find((r) => r.room === run.room) : null;
  const since = w.lastHit ? w.here.now - w.lastHit.at : Infinity;
  const b = beat(since);
  return (
    <div className="flex flex-col gap-2">
      <p>
        Hầm ngục (một mình hoặc cả tổ đội): 4 phòng quái, phòng cuối là <b>Dơi Chúa</b>. Vé vào {DUNGEON_FEE} xu/người. Dọn xong, mỗi
        người có góp sức nhận {DUNGEON_BASE} xu cộng phần của quỹ {DUNGEON_POT} xu × số người, chia theo
        công sức ({DUNGEON_PAID_PER_DAY} lượt có thưởng mỗi ngày). Đứng ở cổng hầm (Bãi đất trống, phía tây) trong suốt trận.
      </p>
      {!atGate && <p className="text-sm opacity-80">Bạn chưa đứng ở cổng hầm ngục.</p>}
      {!run || run.status !== "open" ? (
        <>
          {run?.status === "cleared" && <p>🏆 Tổ đội vừa dọn sạch hầm ngục!</p>}
          {run?.status === "failed" && <p>⌛ Hết giờ — lượt trước thất bại.</p>}
          <button type="button" className="pch-btn pch-btn-primary self-start px-2 py-0.5" disabled={w.busy || !atGate || !s.party} onClick={() => w.dgStart()}>
            Vào hầm ({DUNGEON_FEE} xu)
          </button>
          {!s.party && <p className="text-sm">Cần có tổ đội (lập một mình cũng được).</p>}
          <p className="text-sm opacity-80">Lượt đã dọn hôm nay: {s.clearsToday}/{DUNGEON_PAID_PER_DAY}</p>
        </>
      ) : (
        <div className="pch p-2">
          <p className="font-bold">Phòng {run.room}/4 · {room?.name} · còn {clock(run.expiresMs - now)}</p>
          <div className="my-1 flex flex-wrap gap-1">
            {run.mobs.map((hp, i) => (
              <button key={i} type="button" className="pch-btn px-2 py-1 tabular-nums" disabled={!run.joined || hp <= 0 || w.busy || b === "wait" || !atGate}
                onClick={() => w.dgAttack(run.id, i + 1)}>
                {run.room === 4 ? "🦇👑" : run.room === 3 ? "🕷️" : run.room === 2 ? "🐍" : "🦇"} {hp > 0 ? `${hp}/${run.mobMax[i] ?? hp}` : "💀"}
              </button>
            ))}
          </div>
          {!run.joined && <button type="button" className="pch-btn pch-btn-primary px-2 py-0.5" disabled={w.busy || !atGate} onClick={() => w.dgJoin(run.id)}>Vào cùng đội ({DUNGEON_FEE} xu)</button>}
          {w.lastHit && since < 1500 && <p className="text-red-700">−{w.lastHit.dmg}{w.lastHit.combo > 0 ? ` (combo ×${w.lastHit.combo})` : ""}</p>}
          <p className="text-sm">{run.members.map((m) => `${m.name} ${m.dmg}`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
