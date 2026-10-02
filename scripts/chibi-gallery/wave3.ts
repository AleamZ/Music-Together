import * as THREE from "three";
import { heldMesh } from "@/lib/game/diorama/character/held3d";
import type { CharAct } from "@/lib/game/diorama/character/pose";
import { EXTRA_ACT_LABEL, type ExtraAct } from "@/lib/game/diorama/character/pose-extra";
import { furnitureModel, FURNITURE3D_DESC } from "@/lib/game/diorama/world/furniture3d";
import { buildRoom, motelRoomSpec } from "@/lib/game/diorama/world/interior3d";
import { ModelMats, Paint, petModel } from "@/lib/game/diorama/world/models";
import { PILLION_BACK, PILLION_LIFT, XE_OM_DRIVER, xeOmModel } from "@/lib/game/diorama/world/xeom";
import { FURNITURE } from "@/lib/game/housing/apartment";
import { SPECIES } from "@/lib/game/pets/catalog";
import type { Look } from "@/lib/game/types";
import type { Sheet, Tile } from "./sheets";

// Wave 3's review sheets: the craft poses, the emotes and the card table, every furniture item, an interior (an
// apartment and the motel room), the xe ôm, and the parrot (vet).

const NAM: Look = { skin: "warm", hair: "short", hairColor: "black", hat: null, top: "top_tee_white", bottom: "bottom_pants_navy", shoes: "shoes_sneaker_white", neck: null, gender: "nam" };
const NU: Look = { skin: "light", hair: "ponytail", hairColor: "brown", hat: null, top: "fm_cardigan", bottom: "bottom_skirt_pleated", shoes: "shoes_sandal_brown", neck: null, gender: "nu" };
const TQ = -0.62;
const mats = new ModelMats();
const SEAT = 0.56 - 0.1;                                                      // the sit pose's hips onto a ~0.45 stool

function act(a: ExtraAct, t: number, look: Look, yaw = TQ, extra?: () => THREE.Object3D): Tile {
  return { look, act: a as CharAct, time: t, yaw, label: `${EXTRA_ACT_LABEL[a]} · t=${t}s`, extra, zoom: 0.85, focusY: 0.9 };
}

/** A stool under a seated chibi (the card tables), and the table in front. */
function cardTable(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(heldMesh("card_table"));
  g.add(mats.creature1(new Paint(0.05).add(new THREE.CylinderGeometry(0.25, 0.25, 0.45, 10), 0x8b5a33, 0, 0.225, 0))!);
  return g;
}

function craftSheet(): Sheet {
  const tiles: Tile[] = [];
  for (const t of [0.1, 0.35, 0.5]) tiles.push(act("hammer", t, NAM, TQ));
  tiles.push(act("hammer", 0.35, NU, -1.2));
  for (const t of [0, 0.3, 0.6]) tiles.push(act("stir", t, NU, TQ));
  tiles.push(act("stir", 0.3, NAM, -1.2));
  for (const t of [0, 0.28, 0.55]) tiles.push(act("sort", t, NAM, TQ));
  tiles.push(act("sort", 0.28, NU, 0));
  return { name: "w3-craft", title: "Wave 3 — mini-game chế tạo: Rèn (búa + đe), Nấu thuốc (khuấy vạc), Phân loại (sàng nia)", cols: 4, tw: 300, th: 340, tiles };
}

function emoteSheet(): Sheet {
  const tiles: Tile[] = [];
  for (const t of [0, 0.25, 0.5, 0.75]) tiles.push(act("dance", t, t < 0.5 ? NU : NAM, 0));
  tiles.push(act("clap", 0.1, NAM, 0), act("clap", 0.25, NU, TQ));
  tiles.push({ look: NU, act: "photo", time: 0.2, yaw: TQ, label: "Chụp ảnh (wave 1: photo + máy ảnh) · t=0.2s", zoom: 0.85, focusY: 0.9, more: [] });
  const seated = (a: ExtraAct, t: number, look: Look): Tile => ({
    look, act: a as CharAct, time: t, yaw: 0, label: `${EXTRA_ACT_LABEL[a]} (bàn bài) · t=${t}s`, noChibi: true,
    more: [{ look, act: a as CharAct, time: t, x: 0, y: SEAT, z: 0, yaw: 0 }], extra: cardTable,
    cam: { eye: [3.8, 2.9, 2.4], at: [0, 0.8, 0.4] },
  });
  tiles.push(seated("card_hold", 0.2, NAM), seated("card_play", 0.5, NU), seated("card_deal", 0.2, NAM), seated("card_win", 0.2, NU));
  return { name: "w3-emotes", title: "Wave 3 — biểu cảm: nhảy (🎉/🔥), vỗ tay (👏), chụp ảnh (cầm máy), bàn bài: cầm / đánh / chia / thắng", cols: 4, tw: 300, th: 340, tiles };
}

function furnitureSheet(): Sheet {
  const tiles: Tile[] = FURNITURE.map((f) => {
    const big = Math.max(f.w, f.h, 1);
    return {
      look: NAM, yaw: 0, noChibi: true, label: `${f.name} [${f.id}] — ${FURNITURE3D_DESC[f.id] ?? "?"}`,
      extra: () => furnitureModel(mats, f.id, 0) ?? new THREE.Group(),
      cam: { eye: [big * 0.9 + 0.8, big * 0.8 + 1.4, big * 1.1 + 1.6], at: [0, 0.5, 0] },
    };
  });
  return { name: "w3-furniture", title: `Wave 3 — nội thất 3D: ${FURNITURE.length} món (mọi id trong FURNITURE)`, cols: 8, tw: 240, th: 220, tiles };
}

function interiorSheet(): Sheet {
  const items = [
    { id: 1, item: "bed_doi", x: 1, y: 2, rot: 0 }, { id: 2, item: "lamp_hoian", x: 4, y: 2, rot: 0 }, { id: 3, item: "cabinet_go", x: 5, y: 2, rot: 0 },
    { id: 4, item: "tv", x: 9, y: 2, rot: 0 }, { id: 5, item: "plant_cau", x: 12, y: 2, rot: 0 }, { id: 6, item: "aquarium", x: 10, y: 6, rot: 1 },
    { id: 7, item: "rug_batu", x: 7, y: 4, rot: 0 }, { id: 8, item: "sofa_go", x: 7, y: 7, rot: 2 }, { id: 9, item: "table_go", x: 8, y: 5, rot: 0 },
    { id: 10, item: "chair_maytre", x: 1, y: 6, rot: 1 }, { id: 11, item: "shelf_go", x: 12, y: 4, rot: 3 }, { id: 12, item: "fridge_big", x: 1, y: 8, rot: 1 },
    { id: 13, item: "painting_sen", x: 2, y: 5, rot: 0 }, { id: 14, item: "plant_mai", x: 13, y: 8, rot: 0 },
  ];
  const room = { cols: 14, rows: 10, wallRows: 2, wall: "wall_xanh", floor: "floor_go", items, door: [6, 7] };
  const motel = motelRoomSpec();
  return {
    name: "w3-interior", title: "Wave 3 — căn hộ 3D (InteriorStage ở chế độ 3D) và phòng nhà nghỉ", cols: 2, tw: 760, th: 560,
    tiles: [
      { look: NU, yaw: 0, label: "Căn hộ: tường xanh, sàn gỗ, 14 món nội thất + 2 người", noChibi: true, extra: () => buildRoom(mats, room),
        more: [{ look: NU, x: 0.5, z: 2.5, yaw: 0.4 }, { look: NAM, act: "clap", time: 0.1, x: -2.5, z: 1, yaw: 0.8 }],
        cam: { eye: [0, 12.5, 13], at: [0, 0.4, 0.6] } },
      { look: NU, yaw: 0, label: "Nhà nghỉ Hoa Sen: phòng riêng (giường, đèn bàn, thảm, ghế mây)", noChibi: true, extra: () => buildRoom(mats, motel),
        more: [{ look: NU, x: 1.5, z: 1.8, yaw: -0.3 }], cam: { eye: [0, 9, 9.5], at: [0, 0.4, 0.4] } },
    ],
  };
}

function xeomSheet(): Sheet {
  const PASS: Look = { ...NU, hat: "hat_nonla" };
  const bike = (): THREE.Object3D => xeOmModel(mats, 0x3a6ab0).root;
  const tile = (yaw: number, label: string, eye: [number, number, number]): Tile => ({
    look: XE_OM_DRIVER, yaw, label, noChibi: true, extra: () => { const g = new THREE.Group(); g.add(bike()); g.rotation.y = yaw; return g; },
    more: [
      { look: XE_OM_DRIVER, act: "ride", time: 0.1, x: 0, y: 0.3, z: 0, yaw },
      { look: PASS, act: "pillion", time: 0.1, x: -Math.sin(yaw) * PILLION_BACK, y: PILLION_LIFT, z: -Math.cos(yaw) * PILLION_BACK, yaw },
    ],
    cam: { eye, at: [0, 1.0, 0] },
  });
  return {
    name: "w3-xeom", title: "Wave 3 — xe ôm: tài xế (mũ bảo hiểm, áo khoác, khăn rằn), yên dài, khách ngồi sau, mũ cho khách treo gương", cols: 3, tw: 360, th: 360,
    tiles: [
      tile(-1.2, "xe ôm · nghiêng", [0.6, 2.2, 6.6]), tile(-0.6, "xe ôm · 3/4", [0.6, 2.2, 6.6]),
      { look: XE_OM_DRIVER, yaw: TQ, label: "tài xế xe ôm (đứng)", zoom: 0.9, focusY: 1.0 },
    ],
  };
}

function vetSheet(): Sheet {
  const variants = SPECIES.vet.variants;
  const tiles: Tile[] = variants.map((v) => ({
    look: NAM, yaw: 0, noChibi: true, label: `Vẹt (vet) · ${v.name}`, extra: () => { const c = petModel(mats, "vet", { variant: v.id }); c.root.rotation.y = -0.5; return c.root; },
    cam: { eye: [0.6, 1.2, 2.2], at: [0, 0.45, 0] },
  }));
  tiles.push({ look: NAM, yaw: 0, label: "Vẹt dạng 2 + nón", noChibi: true, extra: () => { const c = petModel(mats, "vet", { form: 2, head: "vet_tophat" }); c.root.rotation.y = 0.5; return c.root; }, cam: { eye: [0.6, 1.2, 2.2], at: [0, 0.45, 0] } });
  tiles.push({ look: NU, yaw: TQ, label: "chủ + vẹt đi theo", extra: () => { const c = petModel(mats, "vet", { variant: "do" }); c.root.position.set(0.7, 0, 0.3); c.root.rotation.y = -0.6; return c.root; }, zoom: 0.85, focusY: 0.9 });
  return { name: "w3-vet", title: "Wave 3 — vẹt (vet): mô hình 3D (chim, petModel) theo các màu", cols: 5, tw: 260, th: 260, tiles };
}

export function wave3Sheets(): Sheet[] {
  return [craftSheet(), emoteSheet(), furnitureSheet(), interiorSheet(), xeomSheet(), vetSheet()];
}
