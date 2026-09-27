import type { Look } from "@/lib/game/types";

/** cô Hồng — keeps the Nhà nghỉ Hoa Sen's front desk at Chợ Lớn (v19.1). */
export const CO_HONG_LOOK: Look = {
  skin: "light", hair: "bun", hairColor: "darkbrown",
  hat: null, top: "top_baba_white", bottom: "bottom_pants_black", shoes: "shoes_dep_red", neck: "neck_scarf_red", gender: "nu",
};

/** cô Năm — sells furniture at "Nội thất cô Năm", Chợ Lớn (v19.2). */
export const CO_NAM_LOOK: Look = {
  skin: "warm", hair: "long", hairColor: "darkbrown",
  hat: null, top: "top_baba_pink", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: null, gender: "nu",
};

/** anh Tư môi giới — the broker at the Sàn bất động sản office, Khu nhà (v19.4). */
export const ANH_TU_LOOK: Look = {
  skin: "light", hair: "short", hairColor: "black",
  hat: null, top: "top_tee_white", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: null,
};

/** chú Sáu bảo vệ — keeps the lobby of Chung cư Phú Mỹ, Khu nhà (v19.2). */
export const BAO_VE_LOOK: Look = {
  skin: "tan", hair: "short", hairColor: "black",
  hat: "hat_taibeo_green", top: "top_tee_blue", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: null,
};
