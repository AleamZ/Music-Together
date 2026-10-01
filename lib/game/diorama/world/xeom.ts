import * as THREE from "three";
import type { Look } from "@/lib/game/types";
import { ModelMats, Paint, vehicleModel, type Vehicle } from "./models";

// Browser only (three): the xe ôm — a motorbike taxi in the 3D world. The v18.13 "Đi nhờ xe" ride (a driver carrying a
// passenger on the back; 2D draws the passenger on the driver's vehicle) shows the moto as a xe ôm: the long
// two-person seat, the passenger's foot pegs and grab rail, a rear rack, the round mirrors with the spare helmet for
// the fare hanging off one, and a little "XE ÔM" plate on the front. The xe ôm driver's classic look (helmet and a
// jacket) is XE_OM_DRIVER (the review sheet; an NPC driver).

/** The xe ôm driver: a helmet, the jacket, dark trousers and sandals. */
export const XE_OM_DRIVER: Look = {
  skin: "tan", hair: "short", hairColor: "black", hat: "hat_helmet", top: "top_jacket_leather", bottom: "bottom_pants_grey",
  shoes: "shoes_dep_brown", neck: "neck_khanran_green", gender: "nam",
};

/** How far behind the driver the passenger sits (units, along the vehicle) and how high (the seat). */
export const PILLION_BACK = 0.5;
export const PILLION_LIFT = 0.34;

/** A moto (or a bike) dressed as a xe ôm. Same parts as vehicleModel (the wheels spin), plus the taxi's extras. */
export function xeOmModel(mats: ModelMats, color: number): Vehicle {
  const v = vehicleModel(mats, "moto", color);
  const p = new Paint(0.04);
  p.box(0.32, 0.12, 1.05, 0x2a2420, 0, 0.84, -0.38)                         // the long two-person seat
    .box(0.36, 0.05, 0.36, 0x3a3a3a, 0, 0.8, -0.98).box(0.04, 0.08, 0.36, 0x3a3a3a, -0.17, 0.85, -0.98).box(0.04, 0.08, 0.36, 0x3a3a3a, 0.17, 0.85, -0.98)
    .box(0.42, 0.04, 0.04, 0x8a8a8a, 0, 0.9, -0.82)                          // the grab rail
    .box(0.62, 0.04, 0.06, 0x8a8a8a, 0, 0.36, -0.42)                         // the passenger's pegs
    .add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), 0x3a3a3a, -0.33, 1.15, 0.6).add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), 0x3a3a3a, 0.33, 1.15, 0.6)
    .add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), 0xc8d8e0, -0.33, 1.3, 0.6, Math.PI / 2)
    .add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), 0xc8d8e0, 0.33, 1.3, 0.6, Math.PI / 2)
    // the spare helmet for the fare, hanging off the left mirror
    .add(new THREE.SphereGeometry(0.15, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0x2e7ad2, -0.4, 1.0, 0.58)
    .box(0.3, 0.02, 0.06, 0x2e7ad2, -0.4, 1.0, 0.7)
    // the "XE ÔM" plate on the front shield (yellow, red letters as two bars)
    .box(0.28, 0.12, 0.02, 0xf6d24a, 0, 0.6, 0.76).box(0.2, 0.025, 0.01, 0xd03a2a, 0, 0.62, 0.775).box(0.12, 0.025, 0.01, 0xd03a2a, 0, 0.58, 0.775);
  const extra = mats.creature1(p);
  if (extra) v.root.add(extra);
  return v;
}
