"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawPet } from "@/lib/game/art/pets";
import { formatXu, type FishSpecies } from "@/lib/game/fishing/catalog";
import type { FishRow } from "@/lib/game/fishing/state";
import { isPetSpecies, SPECIES } from "@/lib/game/pets/catalog";
import type { PetLook } from "@/lib/game/pets/model";
import { lookOf, type Pet, type PetsState } from "@/lib/game/pets/rpc";
import {
  battleAccept, battleAct, battleChallenge, battleDecline, battleForfeit, battleStartPve, battleState, DAY_XP, errText, evolveNeeds,
  fighterLearn, fighterTrain, FISH_FIGHTER_RARITY, fishFighterRelease, fishToFighter, FORM_NAMES, GACHA_PITY, GACHA_POOLS, GACHA_PRICE,
  gachaRoll, logText, MAX_FISH_FIGHTERS, MAX_PETS_V2, MAX_STAKE, NPCS, PVE_PAID_WINS, PVE_PER_DAY, petEvolve, petPat, petRelease, PVP_CUT,
  RARITIES, rarityOf, SKILL_NOTE, skillOf, SKILLS, trainCap, trainCost, type Battle, type BattleState, type Fighter, type FishFighter,
  type Stats,
} from "@/lib/game/pets/v2";
import ItemIcon from "../ItemIcon";
import { ParchmentModal } from "../Parchment";

type Tab = "egg" | "raise" | "battle" | "fish";
const TABS: ReadonlyArray<[Tab, string]> = [["egg", "🥚 Máy trứng"], ["raise", "💖 Nuôi dạy"], ["battle", "⚔️ Đấu thú"], ["fish", "🐟 Cá chiến"]];
const STAT_NAME: Record<keyof Stats, string> = { hp: "Máu", atk: "Công", def: "Thủ", spd: "Tốc" };
const STATS: ReadonlyArray<keyof Stats> = ["hp", "atk", "def", "spd"];
const POLL_MS = 2500;

function Sprite({ look, scale = 3, flip = false }: { look: PetLook | null; scale?: number; flip?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 22 * scale, 26 * scale);
    if (!look) return;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    drawPet(c, look, flip ? "left" : "right", 0, 11, 24, 0, true);
  }, [look, scale, flip]);
  return <canvas ref={ref} width={22 * scale} height={26 * scale} className="[image-rendering:pixelated]" aria-hidden="true" />;
}

const lookOfFighter = (f: Fighter | null): PetLook | null =>
  f && f.kind !== "fish" && isPetSpecies(f.species) ? { species: f.species, variant: f.variant, head: null, neck: null, body: null, happy: true, form: f.form } : null;

function RarityBadge({ tier }: { tier: number }) {
  const r = rarityOf(tier);
  return <span className="rounded px-1 text-base font-bold text-white" style={{ background: r.color }}>{"★".repeat(r.tier)} {r.name}</span>;
}

const bar = (v: number, max: number, color: string, w = "w-24") => (
  <span className={`inline-block h-2 ${w} overflow-hidden rounded-sm border border-gold-300 bg-parchment align-middle`}>
    <span className={`block h-full ${color}`} style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%` }} />
  </span>
);

interface Props {
  token: string;
  roomId: string;
  pets: PetsState | null;
  onPets: (s: PetsState) => void;
  coins: number | null;
  /** A balance changed on the server: reload the wallet. */
  onCoins: () => void;
  bag: readonly FishRow[];
  species: readonly FishSpecies[];
  onBagChanged: () => void;
  onClose: () => void;
}

/** 🐾 Trại thú (v21, 0074): the egg machine (server RNG, pity), raising (pat, levels, affection, evolution, training,
 *  skills), turn-based battles for pets and battle fish (PvE vs wild/trainer NPCs, PvP challenges in the room) and the
 *  battle fish kept from the bag. The client only sends intents; every roll, turn and payout is the server's. */
export default function PetCenterModal({ token, roomId, pets: petsState, onPets, coins, onCoins, bag, species, onBagChanged, onClose }: Props) {
  const pets = petsState?.pets ?? [];
  const [tab, setTab] = useState<Tab>(pets.length > 0 ? "raise" : "egg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bs, setBs] = useState<BattleState | null>(null);
  const [sel, setSel] = useState<number | null>(petsState?.active ?? pets[0]?.id ?? null);
  const [rolled, setRolled] = useState<{ rarity: number; species: string; variant: string } | null>(null);
  const [fighter, setFighter] = useState<string>("");       // "pet:12" | "fish:3"
  const [target, setTarget] = useState<string>("");
  const [stake, setStake] = useState("0");
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null);
  const pet = pets.find((p) => p.id === sel) ?? pets[0] ?? null;
  const nowMs = petsState?.serverNowMs ?? 0;
  const speciesName = (id: string) => species.find((s) => s.id === id)?.name ?? id;
  const speciesRarity = (id: string) => species.find((s) => s.id === id)?.rarity ?? 0;

  const loadBattle = useCallback(async () => {
    try { setBs(await battleState(token, roomId)); } catch { /* before 0074 */ }
  }, [token, roomId]);
  useEffect(() => {
    const first = setTimeout(() => void loadBattle(), 0);
    return () => clearTimeout(first);
  }, [loadBattle]);
  // a running PvP battle or open challenges: poll so the other side's pick and new challenges show up
  const live = bs?.battle?.mode === "pvp" || (bs?.incoming.length ?? 0) > 0 || bs?.outgoing != null;
  useEffect(() => {
    if (!live || tab !== "battle") return;
    const id = setInterval(() => void loadBattle(), POLL_MS);
    return () => clearInterval(id);
  }, [live, tab, loadBattle]);

  const run = async <T,>(f: () => Promise<T>, after?: (v: T) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const v = await f();
      after?.(v);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const withPets = (s: PetsState) => { onPets(s); if (s.coins !== undefined) onCoins(); };
  const withBattle = (s: BattleState) => { setBs(s); if (s.coins !== undefined) onCoins(); };

  const fighters: Array<{ key: string; label: string }> = [
    ...pets.map((p) => ({ key: `pet:${p.id}`, label: `${SPECIES[p.species].icon} ${p.name} · Lv${p.level}${p.sulking ? " (đói)" : ""}` })),
    ...(bs?.fish ?? []).map((f) => ({ key: `fish:${f.id}`, label: `🐟 ${f.name} · Lv${f.level}` })),
  ];
  const chosen = fighter || fighters[0]?.key || "";
  const [fk, fidStr] = chosen.split(":");
  const fkind = fk === "fish" ? "fish" : "pet";
  const fid = Number(fidStr);

  // ------------------------------------------------------------------ tabs

  const eggTab = (
    <section className="flex flex-col gap-2" data-testid="pet-egg">
      <p>“Bỏ {formatXu(GACHA_PRICE)} vào máy, quay một quả trứng! Trứng nào cũng nở ra một bé — bé hiếm thì mạnh hơn.”</p>
      <ul className="flex flex-wrap gap-2 text-base">
        {RARITIES.map((r) => (
          <li key={r.tier} className="flex items-center gap-1"><RarityBadge tier={r.tier} /> {(r.odds * 100).toLocaleString("vi-VN")}%
            <span className="opacity-70">({GACHA_POOLS[r.tier].map((s) => SPECIES[s].icon).join("")})</span></li>
        ))}
      </ul>
      <p className="text-base">Bảo hiểm: {petsState?.pity ?? 0}/{GACHA_PITY} — quả thứ {GACHA_PITY} chưa ra Huyền thoại thì chắc chắn ra Huyền thoại trở lên.
        Nuôi tối đa {MAX_PETS_V2} bé ({pets.length} hiện có).</p>
      <div>
        <button type="button" className="pch-btn pch-btn-primary text-xl" disabled={busy || pets.length >= MAX_PETS_V2 || (coins !== null && coins < GACHA_PRICE)}
          onClick={() => void run(() => gachaRoll(token), (s) => { setRolled(s.rolled ?? null); withPets(s); if (s.pets.length) setSel(s.pets[s.pets.length - 1].id); })}>
          🥚 Quay trứng · {formatXu(GACHA_PRICE)}
        </button>
      </div>
      {rolled && isPetSpecies(rolled.species) && (
        <div className="flex items-center gap-3 rounded-sm border-2 p-2 motion-safe:animate-[pulse_1s_ease-in-out_2]" style={{ borderColor: rarityOf(rolled.rarity).color }} data-testid="egg-result">
          <Sprite look={{ species: rolled.species, variant: rolled.variant, head: null, neck: null, body: null, happy: true }} scale={4} />
          <div className="flex flex-col gap-1">
            <span className="text-xl font-bold text-burgundy">Nở ra {SPECIES[rolled.species].icon} {SPECIES[rolled.species].name}!</span>
            <RarityBadge tier={rolled.rarity} />
          </div>
        </div>
      )}
    </section>
  );

  const petRaise = (p: Pet) => {
    const need = evolveNeeds(p.form);
    const canEvolve = need !== null && p.level >= need.level && p.affection >= need.affection;
    const patWait = p.patReadyMs !== null && p.patReadyMs > nowMs;
    const learnable = SKILLS.filter((s) => s.who !== "fish" && !p.skills.includes(s.id));
    return (
      <div className="flex flex-col gap-2 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid={`raise-${p.id}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Sprite look={lookOf(p)} scale={4} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xl font-bold text-burgundy">{SPECIES[p.species].icon} {p.name} <RarityBadge tier={p.rarity} /></span>
            <span>Cấp {p.level} {bar(p.xp, p.xpNeed, "bg-sky-500")} <span className="text-base opacity-80">{p.xp}/{p.xpNeed} XP</span></span>
            <span>Thân thiết {bar(p.affection, 100, "bg-pink-500")} <span className="text-base opacity-80">{p.affection}/100</span></span>
            <span className="text-base">Dạng: <b>{FORM_NAMES[p.form]}</b> · XP chăm sóc hôm nay {petsState?.xpToday ?? 0}/{DAY_XP}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className="pch-btn" disabled={busy || patWait || p.sulking} onClick={() => void run(() => petPat(token, p.id), withPets)}>
            {patWait ? "Vừa vuốt ve" : "🤲 Vuốt ve"}</button>
          {need && (
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy || !canEvolve}
              title={`Cần cấp ${need.level} và thân thiết ${need.affection}`} onClick={() => void run(() => petEvolve(token, p.id), withPets)}>
              ✨ Tiến hóa ({FORM_NAMES[p.form + 1]}: cấp {need.level}, thân {need.affection})</button>
          )}
        </div>
        <p className="text-base leading-tight">Bé lên cấp khi được vuốt ve, cho ăn, chơi, tập luyện, đánh nhau — và khi đi theo bạn lúc bạn câu cá, làm ruộng, đào mỏ…</p>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {STATS.map((k) => {
            const pts = p.trn[k];
            return (
              <div key={k} className="flex flex-col items-center rounded-sm border border-gold-200 bg-parchment p-1 text-base">
                <span><b>{STAT_NAME[k]}</b> {p.stats[k]}</span>
                <span className="opacity-70">tập {pts}/{trainCap(p.level)}</span>
                <button type="button" className="pch-btn px-1 py-0 text-sm" disabled={busy || pts >= trainCap(p.level) || p.sulking}
                  onClick={() => void run(() => fighterTrain(token, "pet", p.id, k), (r) => { withPets(r.pets); withBattle(r.battle); })}>
                  Tập · {formatXu(trainCost(pts))}</button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-base">Chiêu đã biết: {p.skills.map((s) => skillOf(s)?.name ?? s).join(", ")}</p>
          <div className="flex flex-wrap gap-1">
            {learnable.map((s) => (
              <button key={s.id} type="button" className="pch-btn px-1.5 py-0.5 text-sm" title={`${SKILL_NOTE[s.kind]}${s.power ? ` · lực ${s.power}, chính xác ${s.acc}%` : ""}`}
                disabled={busy || p.level < s.minLevel || p.form < s.minForm}
                onClick={() => void run(() => fighterLearn(token, "pet", p.id, s.id), (r) => { withPets(r.pets); withBattle(r.battle); })}>
                Học {s.name} · {formatXu(s.price)} {p.level < s.minLevel ? `(cấp ${s.minLevel})` : p.form < s.minForm ? "(cần tiến hóa)" : ""}
              </button>
            ))}
          </div>
        </div>
        <div>
          {confirmRelease === `pet:${p.id}` ? (
            <span className="flex flex-wrap items-center gap-2 text-base">Thả {p.name} đi luôn? Không lấy lại được.
              <button type="button" className="pch-btn" disabled={busy} onClick={() => { setConfirmRelease(null); void run(() => petRelease(token, p.id), (s) => { withPets(s); setSel(s.pets[0]?.id ?? null); }); }}>Thả</button>
              <button type="button" className="pch-btn" onClick={() => setConfirmRelease(null)}>Thôi</button>
            </span>
          ) : (
            <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setConfirmRelease(`pet:${p.id}`)}>Thả bé đi</button>
          )}
        </div>
      </div>
    );
  };

  const raiseTab = pets.length === 0 ? <p>Chưa có bé nào — mua ở tiệm hoặc quay trứng nhé.</p> : (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {pets.map((p) => (
          <button key={p.id} type="button" className={`pch-btn px-1.5 py-0.5 text-base ${pet?.id === p.id ? "pch-btn-primary" : ""}`}
            onClick={() => setSel(p.id)}>{SPECIES[p.species].icon} {p.name} · Lv{p.level}</button>
        ))}
      </div>
      {pet && petRaise(pet)}
    </section>
  );

  const battleView = (b: Battle) => {
    const me = b.side === 1 ? b.f1 : b.f2, foe = b.side === 1 ? b.f2 : b.f1;
    const myHp = b.side === 1 ? b.hp1 : b.hp2, foeHp = b.side === 1 ? b.hp2 : b.hp1;
    const names: [string, string] = [b.f1?.name ?? "?", b.f2?.name ?? "?"];
    const done = b.status === "done";
    const iWon = done && b.winner === b.side;
    const fighterBox = (f: Fighter | null, hp: number, mine: boolean) => (
      <div className="flex flex-col items-center gap-1">
        {f?.kind === "fish" ? <ItemIcon id={f.species} scale={4} /> : <Sprite look={lookOfFighter(f)} scale={4} flip={!mine} />}
        <span className="font-bold text-burgundy">{f?.name} · Lv{f?.level}</span>
        <span className="text-base">{bar(hp, f?.hp ?? 1, hp / Math.max(1, f?.hp ?? 1) > 0.35 ? "bg-emerald-500" : "bg-rose-500", "w-28")} {hp}/{f?.hp}</span>
      </div>
    );
    return (
      <div className="flex flex-col gap-2 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid="battle-view">
        <p className="text-center">{b.mode === "pve" ? "Đấu với NPC" : `Đấu với ${b.side === 1 ? b.p2Name : b.p1Name}`} · Lượt {Math.min(b.turn, 30)}
          {b.stake > 0 && <> · cược {formatXu(b.stake)}</>}</p>
        <div className="flex items-end justify-around gap-2">{fighterBox(me, myHp, true)}<span className="text-2xl">⚔️</span>{fighterBox(foe, foeHp, false)}</div>
        <ul className="min-h-12 text-base" aria-live="polite">
          {b.log.map((l, i) => <li key={i} className={l.who === b.side ? "text-emerald-800" : "text-rose-800"}>{logText(l, names)}</li>)}
        </ul>
        {done ? (
          <p className="text-center text-xl font-bold" role="status">
            {b.winner === 0 ? "Hòa!" : iWon ? "🏆 Thắng rồi!" : "Thua mất rồi…"}
            {iWon && b.reward > 0 && <> +{formatXu(b.reward)}</>}
          </p>
        ) : b.acted ? (
          <p className="text-center">Đã chọn chiêu — chờ đối thủ…</p>
        ) : (
          <div className="flex flex-wrap justify-center gap-1">
            {(me?.skills ?? []).map((s) => {
              const k = skillOf(s);
              return (
                <button key={s} type="button" className="pch-btn pch-btn-primary" disabled={busy}
                  title={k ? `${SKILL_NOTE[k.kind]}${k.power ? ` · lực ${k.power}, chính xác ${k.acc}%` : ""}` : s}
                  onClick={() => void run(() => battleAct(token, b.id, s), withBattle)}>{k?.name ?? s}</button>
              );
            })}
            <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => battleForfeit(token, b.id), withBattle)}>🏳️ Bỏ cuộc</button>
          </div>
        )}
        {!done && b.mode === "pvp" && <p className="text-center text-sm opacity-80">Mỗi lượt có 2 phút; ai không chọn chiêu thì xử thua.</p>}
      </div>
    );
  };

  const battleTab = (
    <section className="flex flex-col gap-2" data-testid="pet-battle">
      {bs?.battle ? battleView(bs.battle) : (
        <>
          {bs?.last && battleView(bs.last)}
          {fighters.length === 0 ? <p>Cần một bé hoặc một cá chiến để đấu.</p> : (
            <>
              <label className="flex flex-wrap items-center gap-2">Ra trận:
                <select className="rounded border border-gold-300 bg-cream px-1" value={chosen} onChange={(e) => setFighter(e.target.value)}>
                  {fighters.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
              <p className="text-base">Đánh với thú hoang và huấn luyện viên (mỗi trận bé mất chút no; {bs?.battlesToday ?? 0}/{PVE_PER_DAY} trận hôm nay,
                {" "}{PVE_PAID_WINS} trận thắng đầu có thưởng — đã thắng {bs?.winsToday ?? 0}).</p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {NPCS.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2 rounded-sm border border-gold-200 bg-cream px-1.5 py-0.5">
                    <span className="flex items-center gap-1">
                      <Sprite look={{ species: n.species, variant: n.variant, head: null, neck: null, body: null, happy: true }} scale={2} flip />
                      <span>{n.kind === "trainer" ? "🧑‍🏫" : "🌿"} {n.name} · Lv{n.level} <span className="opacity-70">· {formatXu(n.reward)}</span></span>
                    </span>
                    <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy}
                      onClick={() => void run(() => battleStartPve(token, fkind, fid, n.id), withBattle)}>Đấu</button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-300 bg-parchment p-2">
                <p className="font-bold text-burgundy">🤝 Thách đấu người cùng phòng</p>
                {(bs?.rivals.length ?? 0) === 0 ? <p className="text-base">Chưa ai trong phòng có thú để đấu.</p> : (
                  <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    const t = target || bs!.rivals[0].id;
                    const n = Math.max(0, Math.min(MAX_STAKE, Math.floor(Number(stake) || 0)));
                    void run(() => battleChallenge(token, roomId, t, fkind, fid, n), withBattle);
                  }}>
                    <select className="rounded border border-gold-300 bg-cream px-1" aria-label="Đối thủ" value={target || bs!.rivals[0].id} onChange={(e) => setTarget(e.target.value)}>
                      {bs!.rivals.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <label className="flex items-center gap-1">Cược
                      <input className="w-20 rounded border border-gold-300 bg-cream px-1" inputMode="numeric" value={stake} onChange={(e) => setStake(e.target.value)} />
                    </label>
                    <button type="submit" className="pch-btn pch-btn-primary" disabled={busy || bs?.outgoing != null}>Thách đấu</button>
                  </form>
                )}
                <p className="text-sm opacity-80">Cược 0–{formatXu(MAX_STAKE)}, giữ khi đối thủ nhận; người thắng lấy cả hai phần trừ {PVP_CUT * 100}% phí sân.</p>
                {bs?.outgoing && (
                  <p className="flex flex-wrap items-center gap-2 text-base">Đang chờ {bs.outgoing.to} nhận lời ({formatXu(bs.outgoing.stake)})…
                    <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy} onClick={() => void run(() => battleDecline(token, bs.outgoing!.id), withBattle)}>Rút lại</button>
                  </p>
                )}
                {bs?.incoming.map((c) => (
                  <p key={c.id} className="flex flex-wrap items-center gap-2" data-testid="pet-incoming">
                    <span>⚔️ <b>{c.from}</b> thách đấu{c.stake > 0 ? ` (cược ${formatXu(c.stake)})` : ""}</span>
                    <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void run(() => battleAccept(token, c.id, fkind, fid), withBattle)}>Nhận ({fighters.find((f) => f.key === chosen)?.label})</button>
                    <button type="button" className="pch-btn" disabled={busy} onClick={() => void run(() => battleDecline(token, c.id), withBattle)}>Từ chối</button>
                  </p>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );

  const fishCard = (f: FishFighter) => (
    <li key={f.id} className="flex flex-col gap-1 rounded-sm border-2 border-sky-300 bg-sky-50 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={f.speciesId} scale={3} />
        <div className="flex flex-col">
          <span className="font-bold text-burgundy">{f.name} · {"★".repeat(Math.max(1, f.stats.rarity))}</span>
          <span className="text-base">Cấp {f.level} {bar(f.xp, f.xpNeed, "bg-sky-500")} · {(f.weightG / 1000).toLocaleString("vi-VN")} kg</span>
          <span className="text-base">Chiêu: {f.skills.map((s) => skillOf(s)?.name ?? s).join(", ")}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {STATS.map((k) => (
          <button key={k} type="button" className="pch-btn px-1 py-0 text-sm" disabled={busy || f.trn[k] >= trainCap(f.level)}
            onClick={() => void run(() => fighterTrain(token, "fish", f.id, k), (r) => withBattle(r.battle))}>
            {STAT_NAME[k]} {f.stats[k]} · tập {formatXu(trainCost(f.trn[k]))}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {SKILLS.filter((s) => s.who !== "pet" && !f.skills.includes(s.id)).map((s) => (
          <button key={s.id} type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy || f.level < s.minLevel}
            onClick={() => void run(() => fighterLearn(token, "fish", f.id, s.id), (r) => withBattle(r.battle))}>
            Học {s.name} · {formatXu(s.price)}{f.level < s.minLevel ? ` (cấp ${s.minLevel})` : ""}</button>
        ))}
        {confirmRelease === `fish:${f.id}` ? (
          <>
            <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy} onClick={() => { setConfirmRelease(null); void run(() => fishFighterRelease(token, f.id), withBattle); }}>Thả về sông thật à? Thả</button>
            <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setConfirmRelease(null)}>Thôi</button>
          </>
        ) : <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setConfirmRelease(`fish:${f.id}`)}>Thả về sông</button>}
      </div>
    </li>
  );

  const rareBag = bag.filter((f) => speciesRarity(f.speciesId) >= FISH_FIGHTER_RARITY);
  const fishTab = (
    <section className="flex flex-col gap-2" data-testid="pet-fish">
      <p>Cá hiếm (từ ★{FISH_FIGHTER_RARITY}) câu được có thể giữ lại làm cá chiến: tập luyện, học chiêu và ra trận như thú cưng. Tối đa {MAX_FISH_FIGHTERS} con.</p>
      {rareBag.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rareBag.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-sm border border-gold-200 bg-cream px-1.5 py-0.5">
              <span className="flex items-center gap-1"><ItemIcon id={f.speciesId} scale={2} /> {speciesName(f.speciesId)} · {(f.weightG / 1000).toLocaleString("vi-VN")} kg</span>
              <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" disabled={busy || (bs?.fish.length ?? 0) >= MAX_FISH_FIGHTERS}
                onClick={() => void run(() => fishToFighter(token, f.id), (s) => { withBattle(s); onBagChanged(); })}>Giữ làm cá chiến</button>
            </li>
          ))}
        </ul>
      )}
      {rareBag.length === 0 && <p className="text-base opacity-80">Trong giỏ chưa có cá hiếm.</p>}
      <ul className="grid gap-2 sm:grid-cols-2">{(bs?.fish ?? []).map(fishCard)}</ul>
    </section>
  );

  return (
    <ParchmentModal title="🐾 Trại thú" onClose={onClose} className="sm:max-w-[820px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto font-vt text-lg leading-tight">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn relative ${tab === id ? "pch-btn-primary" : ""}`}
              onClick={() => { setTab(id); setError(null); if (id === "battle" || id === "fish") void loadBattle(); }}>
              {label}
              {id === "battle" && ((bs?.incoming.length ?? 0) > 0 || bs?.battle) && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />}
            </button>
          ))}
        </div>
        {tab === "egg" && eggTab}
        {tab === "raise" && raiseTab}
        {tab === "battle" && battleTab}
        {tab === "fish" && fishTab}
        {coins !== null && <p className="text-base opacity-80">Trong túi: {formatXu(coins)}</p>}
        {error && <div className="rounded border border-rose-400 bg-rose-100 p-2 text-base text-burgundy-accent" role="alert">{error}</div>}
        <div className="flex justify-end border-t-2 border-gold-200 pt-2">
          <button type="button" className="pch-btn" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </ParchmentModal>
  );
}
