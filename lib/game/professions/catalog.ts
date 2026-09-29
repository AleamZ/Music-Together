// Nghề nghiệp (v21, supabase/migrations/0077_professions.sql is authoritative): the catalog the panel shows.
// tests/unit/professions.test.ts pins every row equal to the SQL seed.

export type ProfId = "ngu_dan" | "nong_dan" | "tho_mo" | "dau_bep" | "thuong_nhan" | "tho_ren" | "tho_moc" | "vo_si"
  | "tho_san" | "tieu_phu";

export interface Profession { id: ProfId; name: string; icon: string; blurb: string }

export const PROFESSIONS: readonly Profession[] = [
  { id: "ngu_dan", name: "Ngư dân", icon: "🎣", blurb: "Lên cấp khi câu cá, kéo lưới, đào kho báu." },
  { id: "nong_dan", name: "Nông dân", icon: "🌾", blurb: "Lên cấp khi thu hoạch, bán lúa, nông sản, hái thảo dược." },
  { id: "tho_mo", name: "Thợ mỏ", icon: "⛏️", blurb: "Lên cấp khi đào quặng, bán quặng và đá quý." },
  { id: "dau_bep", name: "Đầu bếp", icon: "🍳", blurb: "Lên cấp khi nấu nướng, pha thuốc, chế biến, ăn uống." },
  { id: "thuong_nhan", name: "Thương nhân", icon: "💰", blurb: "Lên cấp khi bán hàng ở chợ, sạp, đấu giá." },
  { id: "tho_ren", name: "Thợ rèn", icon: "⚒️", blurb: "Lên cấp khi nâng cấp, sửa và rèn đồ nghề." },
  { id: "tho_moc", name: "Thợ mộc", icon: "🪚", blurb: "Lên cấp khi mua sắm nội thất, dựng nhà, đóng đồ gỗ." },
  { id: "vo_si", name: "Võ sĩ", icon: "🥋", blurb: "Lên cấp khi đấu võ, học và thi ở võ đường." },
  // 0096
  { id: "tho_san", name: "Thợ săn", icon: "🏹", blurb: "Săn, bẫy thú trong rừng tràm: dễ trúng hơn, hay được thêm chiến lợi phẩm." },
  { id: "tieu_phu", name: "Tiều phu", icon: "🪓", blurb: "Đốn cây trong rừng tràm lấy gỗ, bán gỗ ở Sạp thợ săn." },
];

export type PerkKey =
  | "fish_effort_pct" | "fish_sell_pct" | "fish_stamina_pct" | "rare_fish_pct"
  | "farm_sell_pct" | "farm_buy_pct" | "stamina_regen_pct" | "stamina_max"
  | "mine_stamina_pct" | "ore_sell_pct" | "mine_tool_pct"
  | "buff_time_pct" | "buff_power_pct" | "meal_pct" | "potion_pct"
  | "market_sell_pct" | "buy_pct" | "shop_rent_pct"
  | "upgrade_pct" | "repair_pct" | "furniture_pct" | "house_pct"
  | "fight_stamina_pct" | "dojo_pct"
  // 0096
  | "hunt_chance_pct" | "hunt_stamina_pct" | "hunt_drop_pct" | "hunt_night_pct" | "hunt_big"
  | "chop_miss_bonus" | "chop_window_ms" | "chop_stamina_pct" | "axe_save_pct" | "wood_extra_pct" | "wood_sell_pct";

/** What a perk does, for the panel: `{v}` is the node's value. */
export const PERK_TEXT: Readonly<Record<PerkKey, string>> = {
  fish_effort_pct: "Câu cá, kéo lưới, đào mỏ tốn ít đói/khát hơn {v}%",
  fish_sell_pct: "Bán cá được thêm {v}%",
  fish_stamina_pct: "Câu cá tốn ít thể lực hơn {v}%",
  rare_fish_pct: "+{v}% cơ hội cá lên một bậc hiếm",
  farm_sell_pct: "Bán lúa, nông sản được thêm {v}%",
  farm_buy_pct: "Hoàn {v}% tiền mua đồ nhà nông",
  stamina_regen_pct: "Thể lực hồi nhanh hơn {v}%",
  stamina_max: "+{v} thể lực tối đa",
  mine_stamina_pct: "Đào mỏ tốn ít thể lực hơn {v}%",
  ore_sell_pct: "Bán quặng, đá quý được thêm {v}%",
  mine_tool_pct: "Hoàn {v}% tiền mua cuốc",
  buff_time_pct: "Buff đồ ăn kéo dài thêm {v}%",
  buff_power_pct: "Buff đồ ăn mạnh hơn {v}%",
  meal_pct: "Hoàn {v}% tiền ăn uống",
  potion_pct: "Hoàn {v}% tiền pha thuốc",
  market_sell_pct: "Bán ở chợ, sạp, đấu giá được thêm {v}%",
  buy_pct: "Hoàn {v}% tiền mua ở cửa hàng",
  shop_rent_pct: "Hoàn {v}% tiền thuê sạp, phí đăng bán",
  upgrade_pct: "Hoàn {v}% tiền nâng cấp",
  repair_pct: "Hoàn {v}% tiền sửa đồ",
  furniture_pct: "Hoàn {v}% tiền nội thất",
  house_pct: "Hoàn {v}% tiền xây nhà",
  fight_stamina_pct: "Đấu võ tốn ít thể lực hơn {v}%",
  dojo_pct: "Hoàn {v}% học phí, lệ phí thi võ đường",
  hunt_chance_pct: "+{v} điểm % săn, bẫy thành công",
  hunt_stamina_pct: "Săn, bẫy tốn ít thể lực hơn {v}%",
  hunt_drop_pct: "+{v} điểm % được thêm 1 chiến lợi phẩm (nghề chính)",
  hunt_night_pct: "+{v} điểm % săn, bẫy thành công ban đêm",
  hunt_big: "Săn được sói, gấu: thêm {v} chiến lợi phẩm",
  chop_miss_bonus: "Lượt chặt có nhịp trượt: thêm {v} nhát",
  chop_window_ms: "Cửa sổ nhịp chặt rộng thêm {v} ms",
  chop_stamina_pct: "Chặt cây tốn ít thể lực hơn {v}%",
  axe_save_pct: "{v}% lượt chặt không mòn rìu",
  wood_extra_pct: "{v}% cây đổ rơi thêm 1 khúc gỗ",
  wood_sell_pct: "Bán gỗ được thêm {v}%",
};

export interface SkillNode { id: string; prof: ProfId; name: string; perk: PerkKey; value: number; cost: number; req: string | null }

export const SKILL_NODES: readonly SkillNode[] = [
  { id: "f_hand", prof: "ngu_dan", name: "Tay quen", perk: "fish_effort_pct", value: 15, cost: 1, req: null },
  { id: "f_sell", prof: "ngu_dan", name: "Mối quen", perk: "fish_sell_pct", value: 5, cost: 1, req: null },
  { id: "f_stam", prof: "ngu_dan", name: "Dẻo dai", perk: "fish_stamina_pct", value: 25, cost: 2, req: "f_hand" },
  { id: "f_sell2", prof: "ngu_dan", name: "Chợ cá", perk: "fish_sell_pct", value: 5, cost: 2, req: "f_sell" },
  { id: "f_eye", prof: "ngu_dan", name: "Mắt tinh", perk: "rare_fish_pct", value: 4, cost: 2, req: "f_hand" },
  { id: "f_old", prof: "ngu_dan", name: "Lão ngư", perk: "rare_fish_pct", value: 6, cost: 3, req: "f_eye" },
  { id: "a_sell", prof: "nong_dan", name: "Hàng ngon", perk: "farm_sell_pct", value: 5, cost: 1, req: null },
  { id: "a_breath", prof: "nong_dan", name: "Hít thở", perk: "stamina_regen_pct", value: 15, cost: 1, req: null },
  { id: "a_sell2", prof: "nong_dan", name: "Được mùa", perk: "farm_sell_pct", value: 5, cost: 2, req: "a_sell" },
  { id: "a_seed", prof: "nong_dan", name: "Giống rẻ", perk: "farm_buy_pct", value: 10, cost: 2, req: "a_sell" },
  { id: "a_body", prof: "nong_dan", name: "Khỏe như trâu", perk: "stamina_max", value: 15, cost: 2, req: "a_breath" },
  { id: "a_sell3", prof: "nong_dan", name: "Bội thu", perk: "farm_sell_pct", value: 5, cost: 3, req: "a_sell2" },
  { id: "m_arm", prof: "tho_mo", name: "Tay búa", perk: "mine_stamina_pct", value: 20, cost: 1, req: null },
  { id: "m_sell", prof: "tho_mo", name: "Biết quặng", perk: "ore_sell_pct", value: 5, cost: 1, req: null },
  { id: "m_sell2", prof: "tho_mo", name: "Mối lái đá", perk: "ore_sell_pct", value: 5, cost: 2, req: "m_sell" },
  { id: "m_body", prof: "tho_mo", name: "Lưng sắt", perk: "stamina_max", value: 20, cost: 2, req: "m_arm" },
  { id: "m_tool", prof: "tho_mo", name: "Giữ đồ nghề", perk: "mine_tool_pct", value: 10, cost: 2, req: "m_arm" },
  { id: "m_gem", prof: "tho_mo", name: "Mắt ngọc", perk: "ore_sell_pct", value: 5, cost: 3, req: "m_sell2" },
  { id: "c_long", prof: "dau_bep", name: "Nấu kỹ", perk: "buff_time_pct", value: 25, cost: 1, req: null },
  { id: "c_cheap", prof: "dau_bep", name: "Đi chợ khéo", perk: "meal_pct", value: 10, cost: 1, req: null },
  { id: "c_long2", prof: "dau_bep", name: "Hầm lâu", perk: "buff_time_pct", value: 25, cost: 2, req: "c_long" },
  { id: "c_spice", prof: "dau_bep", name: "Gia vị bí truyền", perk: "buff_power_pct", value: 20, cost: 2, req: "c_long" },
  { id: "c_cheap2", prof: "dau_bep", name: "Khách quen", perk: "meal_pct", value: 10, cost: 2, req: "c_cheap" },
  { id: "c_brew", prof: "dau_bep", name: "Pha chế", perk: "potion_pct", value: 10, cost: 2, req: "c_cheap" },
  { id: "t_sell", prof: "thuong_nhan", name: "Mồm mép", perk: "market_sell_pct", value: 3, cost: 1, req: null },
  { id: "t_buy", prof: "thuong_nhan", name: "Trả giá", perk: "buy_pct", value: 5, cost: 1, req: null },
  { id: "t_sell2", prof: "thuong_nhan", name: "Buôn có bạn", perk: "market_sell_pct", value: 3, cost: 2, req: "t_sell" },
  { id: "t_buy2", prof: "thuong_nhan", name: "Mua sỉ", perk: "buy_pct", value: 5, cost: 2, req: "t_buy" },
  { id: "t_fish", prof: "thuong_nhan", name: "Buôn cá", perk: "fish_sell_pct", value: 3, cost: 2, req: "t_sell" },
  { id: "t_rent", prof: "thuong_nhan", name: "Chỗ quen", perk: "shop_rent_pct", value: 15, cost: 3, req: "t_sell2" },
  { id: "s_up", prof: "tho_ren", name: "Tay nghề", perk: "upgrade_pct", value: 10, cost: 1, req: null },
  { id: "s_fix", prof: "tho_ren", name: "Sửa khéo", perk: "repair_pct", value: 20, cost: 1, req: null },
  { id: "s_up2", prof: "tho_ren", name: "Lò rèn riêng", perk: "upgrade_pct", value: 10, cost: 2, req: "s_up" },
  { id: "s_tool", prof: "tho_ren", name: "Tự rèn cuốc", perk: "mine_tool_pct", value: 10, cost: 2, req: "s_up" },
  { id: "s_fix2", prof: "tho_ren", name: "Như mới", perk: "repair_pct", value: 20, cost: 2, req: "s_fix" },
  { id: "s_body", prof: "tho_ren", name: "Vai rộng", perk: "stamina_max", value: 15, cost: 2, req: "s_up" },
  { id: "w_arm", prof: "tho_moc", name: "Tay chai", perk: "stamina_regen_pct", value: 10, cost: 1, req: null },
  { id: "w_furn", prof: "tho_moc", name: "Đồ gỗ", perk: "furniture_pct", value: 10, cost: 1, req: null },
  { id: "w_house", prof: "tho_moc", name: "Dựng nhà", perk: "house_pct", value: 5, cost: 2, req: "w_furn" },
  { id: "w_furn2", prof: "tho_moc", name: "Chạm trổ", perk: "furniture_pct", value: 10, cost: 2, req: "w_furn" },
  { id: "w_body", prof: "tho_moc", name: "Gân guốc", perk: "stamina_max", value: 15, cost: 2, req: "w_arm" },
  { id: "w_rest", prof: "tho_moc", name: "Nghỉ tay", perk: "stamina_regen_pct", value: 20, cost: 2, req: "w_arm" },
  { id: "v_wind", prof: "vo_si", name: "Hơi dài", perk: "fight_stamina_pct", value: 25, cost: 1, req: null },
  { id: "v_dojo", prof: "vo_si", name: "Môn sinh", perk: "dojo_pct", value: 10, cost: 1, req: null },
  { id: "v_body", prof: "vo_si", name: "Thân thép", perk: "stamina_max", value: 20, cost: 2, req: "v_wind" },
  { id: "v_rest", prof: "vo_si", name: "Điều tức", perk: "stamina_regen_pct", value: 25, cost: 2, req: "v_wind" },
  { id: "v_dojo2", prof: "vo_si", name: "Đệ tử ruột", perk: "dojo_pct", value: 10, cost: 2, req: "v_dojo" },
  { id: "v_iron", prof: "vo_si", name: "Mình đồng", perk: "fight_stamina_pct", value: 25, cost: 3, req: "v_wind" },
  // 0096
  { id: "h_track", prof: "tho_san", name: "Dấu vết rõ ràng", perk: "hunt_chance_pct", value: 5, cost: 1, req: null },
  { id: "h_quiet", prof: "tho_san", name: "Bước chân êm", perk: "hunt_stamina_pct", value: 50, cost: 1, req: null },
  { id: "h_loot", prof: "tho_san", name: "Thu nhặt khéo", perk: "hunt_drop_pct", value: 10, cost: 2, req: "h_track" },
  { id: "h_night", prof: "tho_san", name: "Thợ săn ban đêm", perk: "hunt_night_pct", value: 10, cost: 2, req: "h_track" },
  { id: "h_body", prof: "tho_san", name: "Học từ rừng", perk: "stamina_max", value: 15, cost: 2, req: "h_quiet" },
  { id: "h_big", prof: "tho_san", name: "Đối đầu thú lớn", perk: "hunt_big", value: 1, cost: 3, req: "h_loot" },
  { id: "l_steady", prof: "tieu_phu", name: "Chặt đều tay", perk: "chop_miss_bonus", value: 1, cost: 1, req: null },
  { id: "l_grain", prof: "tieu_phu", name: "Mắt nhìn thớ gỗ", perk: "chop_window_ms", value: 40, cost: 1, req: null },
  { id: "l_breath", prof: "tieu_phu", name: "Giữ lực", perk: "chop_stamina_pct", value: 20, cost: 2, req: "l_steady" },
  { id: "l_edge", prof: "tieu_phu", name: "Giữ lưỡi rìu", perk: "axe_save_pct", value: 25, cost: 2, req: "l_grain" },
  { id: "l_gather", prof: "tieu_phu", name: "Gom gỗ khéo", perk: "wood_extra_pct", value: 10, cost: 2, req: "l_steady" },
  { id: "l_deep", prof: "tieu_phu", name: "Người rừng sâu", perk: "wood_sell_pct", value: 10, cost: 3, req: "l_gather" },
];

export type BuffKey = "speed" | "rare_fish" | "strength" | "stamina_regen" | "luck" | "miner" | "hunt_chance";

export const BUFF_TEXT: Readonly<Record<BuffKey, { icon: string; name: string; unit: string }>> = {
  speed: { icon: "💨", name: "Nhanh nhẹn", unit: "% tốc độ đi" },
  rare_fish: { icon: "🍀", name: "Hên cá", unit: "% cá hiếm" },
  strength: { icon: "💪", name: "Sức mạnh", unit: "% bớt tốn thể lực (đào, đấu)" },
  stamina_regen: { icon: "🔋", name: "Sung sức", unit: "% hồi thể lực" },
  luck: { icon: "✨", name: "May mắn (thuốc)", unit: " bậc" },
  miner: { icon: "⛏️", name: "Thợ mỏ (thuốc)", unit: " quặng" },
  hunt_chance: { icon: "🏹", name: "Tay săn (món rừng)", unit: " điểm % săn" },   // 0097
};

/** meal_catalog id → its timed buffs (0077 meal_buffs). */
export const MEAL_BUFFS: readonly { meal: string; key: BuffKey; value: number; minutes: number }[] = [
  { meal: "com_tam", key: "strength", value: 15, minutes: 30 },
  { meal: "pho_bo", key: "stamina_regen", value: 50, minutes: 30 },
  { meal: "banh_mi", key: "speed", value: 5, minutes: 15 },
  { meal: "bun_bo", key: "strength", value: 20, minutes: 30 },
  { meal: "ca_kho_to", key: "rare_fish", value: 10, minutes: 30 },
  { meal: "canh_chua", key: "rare_fish", value: 15, minutes: 30 },
  { meal: "ca_chien", key: "rare_fish", value: 12, minutes: 20 },
  { meal: "tra_da", key: "stamina_regen", value: 20, minutes: 15 },
  { meal: "nuoc_mia", key: "speed", value: 8, minutes: 15 },
  { meal: "cafe_sua", key: "speed", value: 10, minutes: 20 },
  { meal: "cafe_sua", key: "stamina_regen", value: 30, minutes: 20 },
  { meal: "nuoc_dua", key: "stamina_regen", value: 40, minutes: 20 },
  { meal: "sinh_to", key: "rare_fish", value: 5, minutes: 20 },
];

export const SWITCH_FEE = 500;
export const RESET_FEE = 300;
export const SWITCH_COOLDOWN_H = 24;
export const MAX_LEVEL = 20;
/** Stamina (0077): the base max, the regen (per second), the sprint cost (per second) and speed factor. */
export const STAMINA_BASE = 100;
export const STAMINA_REGEN_PER_S = 100 / 600;
export const SPRINT_COST_PER_S = 1;
export const SPRINT_SPEED = 1.5;
/** The speed buff's cap (%), as 0077's _buff_cap. */
export const SPEED_BUFF_CAP = 10;
