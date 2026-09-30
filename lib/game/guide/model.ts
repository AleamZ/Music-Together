// Pure: "Hướng dẫn tân thủ", the newcomer's step-by-step guide. A chain of small tasks that walks a new player through
// the loop the village lives on — look at the map, go to the pond, catch a fish, carry it to Chợ Lớn, sell it, eat,
// then pick up the daily quests. Each step is judged from the game state the shell already has (where I am, the fish
// in my bag, my coins, hunger/thirst, the panel open) against a snapshot taken when the step began, so nothing new is
// asked of the server; the step reached is kept per account in the browser. It gives no reward (the real quests do).

import type { MapId } from "@/lib/game/maps/types";

/** What the guide looks at, every render. `null` = not known yet (still loading). */
export interface GuideCtx {
  /** The map I am on (a zone of the world in 3D). */
  map: MapId;
  fish: number | null;
  coins: number | null;
  hunger: number | null;
  thirst: number | null;
  /** The shell's panel open now. */
  panel: string | null;
}

export interface GuideStep {
  id: string;
  title: string;
  /** How to do it, one or two short lines. */
  hint: string;
  /** Where it happens (the HUD shows a 📍), if anywhere in particular. */
  where?: string;
  /** Done now, given the state when the step began (`base`) and now. */
  done: (now: GuideCtx, base: GuideCtx) => boolean;
}

const grew = (now: number | null, base: number | null, by = 1): boolean => now !== null && base !== null && now >= base + by;

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: "map", title: "Xem bản đồ làng",
    hint: "Bấm M (hoặc nút 🌏 Bản đồ) để xem các khu trong làng và chỗ bạn đang đứng.",
    done: (n) => n.panel === "city_map",
  },
  {
    id: "to_pond", title: "Ra Ao cá", where: "Ao cá",
    hint: "Đi theo đường xuống phía nam Sảnh chính tới Ao cá — bản đồ nhỏ ở góc màn hình chỉ đường.",
    done: (n) => n.map === "pond",
  },
  {
    id: "catch", title: "Câu con cá đầu tiên", where: "Ao cá",
    hint: "Đứng ở bờ hoặc bến ao, bấm E để quăng cần. Phao chìm (❗) thì bấm Space, giữ Space để kéo cá lên.",
    done: (n, b) => grew(n.fish, b.fish),
  },
  {
    id: "to_market", title: "Mang cá ra Chợ Lớn", where: "Chợ Lớn",
    hint: "Từ Sảnh chính đi sang phía đông tới Chợ Lớn. Có xe thì bấm R để đi nhanh hơn.",
    done: (n) => n.map === "market",
  },
  {
    id: "sell", title: "Bán cá ở Vựa cá", where: "Chợ Lớn",
    hint: "Tới Vựa cá Chợ Lớn (góc tây nam chợ), bấm E và chọn cá để bán lấy xu.",
    done: (n, b) => n.fish !== null && b.fish !== null && n.fish < b.fish && grew(n.coins, b.coins),
  },
  {
    id: "eat", title: "Ăn uống cho no", where: "Chợ Lớn",
    hint: "Đói, khát thì đi chậm và dễ ngất. Ghé quán ăn ở Chợ Lớn (bấm E) để ăn một món, uống một ly.",
    done: (n, b) => grew(n.hunger, b.hunger, 5) || grew(n.thirst, b.thirst, 5),
  },
  {
    id: "quests", title: "Nhận nhiệm vụ hằng ngày",
    hint: "Bấm 2 (nút 📜) mở Sổ nhiệm vụ: nhận nhiệm vụ ngày, tuần và của bác Ba để có thêm xu và kinh nghiệm.",
    done: (n) => n.panel === "quests",
  },
];

/** The guide's saved progress: the step reached (GUIDE_STEPS.length = finished), or hidden by the player. */
export interface GuideSave { step: number; hidden: boolean }

export const GUIDE_START: GuideSave = { step: 0, hidden: false };

export function parseGuide(raw: string | null | undefined): GuideSave {
  if (!raw) return GUIDE_START;
  try {
    const o = JSON.parse(raw) as Partial<GuideSave>;
    const step = typeof o.step === "number" && Number.isInteger(o.step) ? Math.max(0, Math.min(GUIDE_STEPS.length, o.step)) : 0;
    return { step, hidden: o.hidden === true };
  } catch {
    return GUIDE_START;
  }
}

export const guideKey = (accountId: string): string => `mt.guide.${accountId}`;

export const guideFinished = (s: GuideSave): boolean => s.step >= GUIDE_STEPS.length;

/** Has the current step been done (the state known on both sides)? Steps that judge by a number wait for it. */
export function stepDone(step: number, now: GuideCtx, base: GuideCtx): boolean {
  const s = GUIDE_STEPS[step];
  return !!s && s.done(now, base);
}
