"use client";

import { useEffect, type RefObject } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import type { Stall } from "@/lib/game/economy/model";
import type { MapId } from "@/lib/game/maps/types";
import { encodePet } from "@/lib/game/pets/model";
import type { WildSpeciesId } from "@/lib/game/realm/model";
import type { BossFight, WildAnimal, WorldState } from "@/lib/game/realm/rpc";

// Dev only (/dev/world-game): a made-up game state handed to GameCanvas through the SAME calls the real shell makes
// (setLiveInputs with econ_state's stalls and world_state's realm, setHouses, setRingLabels, setPet, setFishing) — so
// the 3D world's live things come through the real feed path (lib/game/diorama/world/live-feed.ts), not a demo setLive.

const stall = (no: number, renterName: string | null, items: number): Stall =>
  ({ no, mine: no === 2, renterName, paidMs: null, items: Array.from({ length: items }, () => ({}) as Stall["items"][number]) });

function fakeRealm(zone: MapId, now: number): WorldState {
  const kinds: WildSpeciesId[] = ["deer", "rabbit", "fox", "bird", "chuot_dong", "ga_rung", "ran_ri_ca", "cay_huong", "co_trang", "rua_hop_lung_den"]; // + 0097: the forest's six
  const animals: WildAnimal[] = kinds.map((species, i) => ({
    id: i + 1, species, hx: 260 + (i % 4) * 110, hy: 150 + Math.floor(i / 4) * 150, seed: i * 13 + 5,
    bornMs: now - 60_000, expiresMs: now + 3_600_000, photographed: false,
  }));
  const boss: BossFight = {
    id: 7, boss: "trau_tinh", name: "Trâu Tinh", kind: "world", map: "bai_dat", arena: { x: 316, y: 60, w: 168, h: 316 },
    hp: 620, maxHp: 1000, phase: 2, status: "up", cap: 0, startsMs: now - 30_000, endsMs: now + 3_600_000,
    killer: null, myDmg: 0, myCombo: 0, fighters: 2, top: [],
  };
  return {
    serverNowMs: now, night: false, snowUntilMs: null, wild: { animals, bag: {}, album: {}, killsToday: 0 },
    fights: [boss], next: [], party: null, invites: [], dungeon: null, clearsToday: 0,
  };
}

/** Feed the fake state once the canvas is up, again on each zone change (the realm's animals are the zone's). */
export function useDevLive(canvasRef: RefObject<GameCanvasHandle | null>, zone: MapId): void {
  useEffect(() => {
    const t = window.setTimeout(() => {
      const c = canvasRef.current;
      if (!c) return;
      c.setLiveInputs?.({
        stalls: [stall(1, "Bé Na", 7), stall(2, "Bạn (dev)", 3), stall(3, null, 0), stall(4, "Anh Tú", 5), stall(5, "Cô Lan", 1), stall(6, null, 0)],
        realm: { state: fakeRealm(zone, Date.now()), zone, offsetMs: 0 },
      });
      c.setHouses([1, 2, 3, 4, 5, 6, 7, 8].map((lot) => ({
        lot, owned: lot !== 4, grid: lot % 3 === 0 || lot === 4 ? null : "dev", roof: (["ngoi", "tole", "la", "bang"] as const)[lot % 4],
        ownerName: lot === 4 ? null : ["Bé Na", "Anh Tú", "Cô Lan", "", "Chú Tư", "Bạn (dev)", "Bà Sáu", "Út"][lot - 1], mine: lot === 6,
      })));
      c.setRingLabels(["⚔️ Hiệp 2 · 1–0", "Góc Đỏ: Lan · chờ đối thủ", null, null]);
      c.setPet(encodePet({ species: "cho", variant: "vang", head: null, neck: null, body: null, happy: true }), 1);
    }, 400);
    return () => window.clearTimeout(t);
  }, [canvasRef, zone]);
}
