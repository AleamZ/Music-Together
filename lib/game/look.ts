import type { Look } from "@/lib/game/types";

// Pure look constants — no Supabase import, so the game world, the pond NPCs and the tests can use them freely.

export const DEFAULT_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};

/** cô Ba — keeps the fish depot (Vựa cá). */
export const CO_BA_LOOK: Look = {
  skin: "warm", hair: "long", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_pink", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: null,
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
  hat: null, top: "top_baba_yellow", bottom: "bottom_pants_black", shoes: "shoes_dep_red", neck: "neck_khanran_red",
};
