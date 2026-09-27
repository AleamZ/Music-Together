import type { Look } from "@/lib/game/types";

// Pure look constants — no Supabase import, so the game world, the pond NPCs and the tests can use them freely.

export const DEFAULT_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};

/** cô Ba — keeps the fish depot (Vựa cá). */
export const CO_BA_LOOK: Look = {
  skin: "warm", hair: "long", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_pink", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: null, gender: "nu",
};

/** chú Tư — keeps the tackle shop (Tiệm đồ câu). */
export const CHU_TU_LOOK: Look = {
  skin: "tan", hair: "short", hairColor: "black",
  hat: "hat_taibeo_green", top: "top_baba_white", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};

/** chú Tám — the Hợp tác xã, where land is rented, bought and sold (v15). */
export const CHU_TAM_LOOK: Look = {
  skin: "tan", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_white", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: "neck_khanran",
};

/** anh Hai — the farm shop (Tiệm vật tư nông nghiệp). */
export const ANH_HAI_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "darkbrown",
  hat: "hat_taibeo_green", top: "top_tee_blue", bottom: "bottom_jeans", shoes: "shoes_dep_blue", neck: null,
};

/** cô Út — the rice depot (Vựa lúa). */
export const CO_UT_LOOK: Look = {
  skin: "light", hair: "long", hairColor: "black",
  hat: null, top: "top_baba_yellow", bottom: "bottom_pants_black", shoes: "shoes_dep_red", neck: "neck_khanran_red", gender: "nu",
};

/** cô Bếp — cooks at Chợ Lớn's nhà hàng (v18.4). */
export const BEP_LOOK: Look = {
  skin: "warm", hair: "bob", hairColor: "black",
  hat: "hat_bandana_red", top: "top_baba_white", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: "neck_khanran_red", gender: "nu",
};

/** ông Tám xe — sells bicycles, scooters and cars at Chợ Lớn (v18.5). */
export const ONG_TAM_XE_LOOK: Look = {
  skin: "tan", hair: "short", hairColor: "black",
  hat: "hat_taibeo_green", top: "top_tee_blue", bottom: "bottom_jeans", shoes: "shoes_dep_brown", neck: "neck_khanran",
};

/** anh Ba tóc — cuts and colours hair at Chợ Lớn's salon (v18.6). */
export const ANH_BA_TOC_LOOK: Look = {
  skin: "light", hair: "undercut", hairColor: "blue",
  hat: null, top: "top_shirt_denim", bottom: "bottom_jeans_black", shoes: "shoes_sneaker_white", neck: "acc_necklace_silver",
};

/** chú Hai — Vựa cá Chợ Lớn (v18.5). */
export const CHU_HAI_CA_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "black",
  hat: "hat_bandana_red", top: "top_baba_white", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: null,
};

/** cô Tư — Vựa nông sản at Chợ Lớn (v18.5). */
export const CO_TU_LOOK: Look = {
  skin: "light", hair: "long", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_pants_black", shoes: "shoes_dep_red", neck: "neck_khanran_red", gender: "nu",
};

/** cô Chín — sells umbrellas at Chợ Lớn's sạp ô dù (v18.9). */
export const CO_CHIN_LOOK: Look = {
  skin: "warm", hair: "bun", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_white", bottom: "bottom_pants_black", shoes: "shoes_dep_red", neck: "neck_khanran_red", gender: "nu",
};

/** cô Sáu — sells clothes at Chợ Lớn's tiệm quần áo (v18.4). */
export const CO_SAU_LOOK: Look = {
  skin: "light", hair: "long", hairColor: "darkbrown",
  hat: null, top: "top_baba_purple", bottom: "bottom_skirt_black", shoes: "shoes_dep_pink", neck: "neck_scarf_red", gender: "nu",
};
