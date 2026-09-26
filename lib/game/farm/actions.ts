import {
  HARVEST_PARTS, TEND_MAX, TOOL_SICKLE, WATER_LOG_MAX, WATER_PER_HOUR, type FarmCatalog, type FarmItem, type FarmItemKind, type UplandCare,
  type UplandCrop, type Variety,
} from "./catalog";
import {
  cropCare, cropModel, cropPhase, HOUR_MS, overripeAt, ripeAt, rotAt, seedlingsOldAt, sowLateAt, sproutAt,
  transplantReadyAt, waterAt, wantedWater, type CropModel,
} from "./crop";
import {
  BED_WATER_NAME, bedLevelsText, durationText, NO_SEED, PEST_NAME, PEST_REMEDY, TOO_FAST, WATER_NAME,
} from "./messages";
import type { FieldAction } from "./rpc";
import type { CropView, FarmMine, PlotView } from "./state";
import {
  nurseryOldAt, nurseryReadyAt, rotFromAt, upCare, uplandModel, upLostAt, upNext, upOverAt, upReadyAt, upWantedWater, type UplandModel,
} from "./upland";

// What can be done on a plot right now (the plot panel's buttons) and what is due on my plots (the HUD task list,
// spec §13.1–13.2; v15.2 §13.1, §13.3). Pure.

/** A button's job: an RPC, a 3-second action behind the 2 s gate (begin_work, then transplant / harvest), or a rice
 *  harvest round (HarvestGame, v15.2 §6.2). */
export type PlotRun = FieldAction | { kind: "work"; plot: number; work: "transplant" | "harvest" } | { kind: "round"; plot: number };

export interface PlotAction {
  key: string;
  label: string;
  run: PlotRun;
  enabled: boolean;
  /** Why it is disabled. */
  why?: string;
  /** Asked before doing it: the item would be wasted, or worse. */
  warn?: string;
  /** A good use, said on the button's line. */
  hint?: string;
}

export interface FarmTask { plot: number; text: string; urgent: boolean }

const REMEDY_LABEL: Record<string, string> = { spray_insect: "thuốc trừ sâu", spray_hopper: "thuốc trừ rầy", spray_fungus: "thuốc trừ bệnh" };
const isN = (item: string) => item === "fert_urea" || item === "fert_npk";
/** Lower-cases the first letter only, so a name keeps its capitals ("Phân NPK" → "phân NPK"). */
export const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The hoa-màu crop on a plot's beds, if any. */
export const uplandOf = (crop: CropView | null, catalog: FarmCatalog): UplandCrop | null =>
  crop?.kind === "upland" ? catalog.uplands.find((u) => u.id === crop.upland) ?? null : null;

/** A running harvester on the plot (until the state after its end arrives). */
export const harvesterOn = (crop: CropView | null): boolean => !!crop?.harvester;

/** Would this fertilizer help now? ok = a good use (the hint), otherwise the warning shown before confirming. */
export function fertAdvice(c: CropModel, v: Variety | null, item: string, now: number): { ok: boolean; text: string } {
  const base = item === "fert_manure" || item === "fert_phosphate";
  if (c.transplantAt === null || now < c.transplantAt) {
    if (!base) return { ok: false, text: "Chưa cấy — phân bón thúc bây giờ là phí." };
    return c.fert.some((e) => e.item === item)
      ? { ok: false, text: "Đã bón lót loại này — bón thêm là phí." }
      : { ok: true, text: "Bón lót trước khi cấy." };
  }
  if (base) return { ok: false, text: "Đã cấy — bón lót bây giờ là phí." };
  const s = v?.scale ?? 1;
  const T = (now - c.transplantAt) / HOUR_MS;
  const ph = cropPhase(c, v, now);
  const nIn = (phase: string) => c.fert.filter((e) => isN(e.item) && cropPhase(c, v, e.t) === phase).length;
  if (ph === "tillering") {
    if (isN(item) && nIn("tillering") >= 1) return { ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" };
    if (cropCare(c, v).td1 === 0) return { ok: false, text: "Đã bón thúc đẻ nhánh đủ — bón thêm là phí." };
    if (!isN(item)) return { ok: false, text: "Kali để đón đòng — bây giờ chỉ được nửa công." };
    if (T < 2 * s) return { ok: false, text: `Hơi sớm — chỉ được nửa công (đúng lúc sau ${durationText((2 * s - T) * HOUR_MS)}).` };
    if (T <= 10 * s) return { ok: true, text: "Đúng lúc bón thúc đẻ nhánh." };
    return { ok: false, text: "Trễ rồi — chỉ được nửa công." };
  }
  if (ph === "panicle") {
    if (item === "fert_urea") return { ok: false, text: "Urê lúc làm đòng gây dư đạm!" };
    if (item === "fert_npk" && nIn("panicle") >= 1) return { ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" };
    if (cropCare(c, v).td2 === 0) return { ok: false, text: "Đã bón đón đòng đủ — bón thêm là phí." };
    if (T <= 24 * s) return { ok: true, text: "Đúng lúc bón đón đòng." };
    return { ok: false, text: "Trễ rồi — chỉ được nửa công." };
  }
  if (isN(item)) return { ok: false, text: "Bón đạm lúc này gây dư đạm!" };
  return { ok: false, text: "Quá muộn — phân này sẽ phí." };
}

/** Would this fertilizer help a crop on beds now (v15.2 §13.1)? `name` is the item's name; `u` is null on beds with
 *  nothing planted. */
export function upFertAdvice(c: UplandModel, u: UplandCrop | null, item: string, name: string, now: number): { ok: boolean; text: string } {
  const base = item === "fert_manure" || item === "fert_phosphate";
  if (c.plantAt === null || now < c.plantAt) {
    if (!base) return { ok: false, text: "Chưa trồng — bón thúc bây giờ là phí." };
    return c.fert.some((e) => e.item === item && (c.plantAt === null || e.t < c.plantAt))
      ? { ok: false, text: "Đã bón lót loại này — bón thêm là phí." }
      : { ok: true, text: "Bón lót trước khi trồng." };
  }
  if (base) return { ok: false, text: "Đã trồng — bón lót bây giờ là phí." };
  if (!u) return { ok: false, text: "Lúc này bón là phí." };
  const P = c.plantAt;
  const T = (now - P) / HOUR_MS;
  const takes = (cr: UplandCare, x: string) => cr.items.includes(x) || cr.halfItems.includes(x);
  const region = (h: number, x: string) => u.cares.find((cr) => cr.kind === "fert" && h >= cr.halfFromH && h < cr.halfToH && takes(cr, x));
  const care = region(T, item);
  if (isN(item)) {
    if (!care) return { ok: false, text: "Bón đạm lúc này gây dư đạm!" };
    if (c.fert.some((e) => e.t >= P && e.t <= now && isN(e.item) && region((e.t - P) / HOUR_MS, e.item)?.id === care.id)) {
      return { ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" };
    }
  }
  if (!care || upCare(c, u).scores[u.cares.indexOf(care)] === 0) return { ok: false, text: "Lúc này bón là phí." };
  if (!care.items.includes(item)) return { ok: false, text: `${name} lúc này chỉ được nửa công.` };
  if (T < care.fromH) return { ok: false, text: `Hơi sớm — chỉ được nửa công (đúng lúc sau ${durationText((care.fromH - T) * HOUR_MS)}).` };
  if (T <= care.toH) return { ok: true, text: `Đúng lúc ${lower(care.name)}.` };
  return { ok: false, text: "Trễ rồi — chỉ được nửa công." };
}

/** A hand job on beds now (§13.1): done on time already (the button waits), on time (a hint), or a warning. */
export function tendAdvice(c: UplandModel, care: UplandCare, now: number): { done: boolean; ok: boolean; text: string } {
  const job = lower(care.name);
  const P = c.plantAt ?? now;
  const onTime = (t: number) => (t - P) / HOUR_MS >= care.fromH && (t - P) / HOUR_MS <= care.toH;
  if (c.work.some((e) => e.act === care.id && onTime(e.t))) return { done: true, ok: false, text: `Đã ${job} rồi.` };
  const T = (now - P) / HOUR_MS;
  if (T < care.fromH) return { done: false, ok: false, text: `Chưa tới lúc — ${job} lúc ${Math.ceil(care.fromH)}–${Math.floor(care.toH)} giờ sau trồng.` };
  if (T <= care.toH) return { done: false, ok: true, text: `Đúng lúc ${job}.` };
  if (T < care.halfToH) return { done: false, ok: false, text: "Trễ rồi — chỉ được nửa công." };
  return { done: false, ok: false, text: "Quá muộn — làm bây giờ là phí công." };
}

/** The water buttons (§8.3, §13.1): one level up or down; the server refuses past 60 log entries or 6 in the last hour. */
function waterButtons(p: PlotView, crop: CropView, w: number, beds: boolean, now: number, rotWarn?: string): PlotAction[] {
  const plot = p.no, names = beds ? BED_WATER_NAME : WATER_NAME;
  const log = crop.log?.water ?? [];
  const tooFast = log.length >= WATER_LOG_MAX || log.filter((e) => e.t > now - HOUR_MS).length >= WATER_PER_HOUR;
  const up = beds ? (w >= 3 ? "Tưới thêm (giữ Ngập)" : `Tưới nước (lên ${names[w + 1]})`) : (w >= 3 ? "Bơm thêm nước (giữ Sâu)" : `Bơm nước (lên ${names[w + 1]})`);
  return [
    {
      key: "water_up", label: up, run: { kind: "water", plot, delta: 1 }, enabled: !tooFast, why: tooFast ? TOO_FAST : undefined,
      ...(rotWarn && !tooFast ? { warn: rotWarn } : {}),
    },
    {
      key: "water_down", label: w === 0 ? "Tháo nước" : `Tháo nước (xuống ${names[w - 1]})`, run: { kind: "water", plot, delta: -1 },
      enabled: !tooFast && w > 0, why: tooFast ? TOO_FAST : w === 0 ? (beds ? "Luống đã khô." : "Ruộng đã khô.") : undefined,
    },
  ];
}

/** The spray buttons (§8.5, v15.2 §7): the bottles I hold and the tank's pesticide; a matching tank is used first. */
function sprayButtons(p: PlotView, crop: CropView, catalog: FarmCatalog, mine: FarmMine): PlotAction[] {
  const tank = mine.tank;
  return catalog.items
    .filter((i) => i.kind === "pesticide" && ((mine.items[i.id] ?? 0) > 0 || (tank?.item === i.id && tank.charges > 0)))
    .map((s) => {
      const fromTank = tank?.item === s.id && tank.charges > 0;
      const target = crop.pests.find((x) => x.treatedAt === null && PEST_REMEDY[x.kind] === s.id);
      return {
        key: `spray:${s.id}`, label: `Xịt ${lower(s.name)}${fromTank ? " (bình phun)" : ""}`, run: { kind: "spray", plot: p.no, item: s.id },
        enabled: true,
        ...(target
          ? { hint: `Trị ${lower(PEST_NAME[target.kind])}.${fromTank ? ` Bình còn ${tank!.charges} lần.` : ""}` }
          : { warn: "Không có sâu bệnh nào trị bằng thuốc này — xịt là phí." }),
      };
    });
}

/** The rice seeds I hold (a hoa-màu seed is planted on beds, not soaked). */
const riceSeeds = (catalog: FarmCatalog, mine: FarmMine): FarmItem[] =>
  catalog.items.filter((i) => i.kind === "seed" && i.upland === null && (mine.items[i.id] ?? 0) > 0);

/** The buttons of the plot panel for `me` (spec §13.2, v15.2 §13.1). Anyone may pick snails; the rest is for the plot's
 *  farmer. A running harvester takes every action (R32); a partly cut plot takes only the next round and Bỏ vụ (R8). */
export function plotActions(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): PlotAction[] {
  const out: PlotAction[] = [];
  const crop = p.crop;
  const plot = p.no;
  if (harvesterOn(crop)) return out;
  const cut = crop?.kind === "rice" && crop.parts > 0;
  if (!cut && crop?.pests.some((x) => x.kind === "snail" && x.treatedAt === null)) {
    out.push({ key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot }, enabled: true });
  }
  if (p.farmer?.id !== me) return out;
  const owned = (kind: FarmItemKind) => catalog.items.filter((i) => i.kind === kind && (mine.items[i.id] ?? 0) > 0);
  const soaks = (): PlotAction[] => {
    const seeds = riceSeeds(catalog, mine);
    if (seeds.length === 0) return [{ key: "soak", label: "Ngâm giống", run: { kind: "soak", plot, item: "" }, enabled: false, why: NO_SEED }];
    return seeds.map((i) => ({ key: `soak:${i.id}`, label: `Ngâm ${lower(i.name)}`, run: { kind: "soak", plot, item: i.id }, enabled: true }));
  };
  const prepare: PlotAction = {
    key: "prepare", label: "Làm ruộng lúa", run: { kind: "prepare", plot }, enabled: true, hint: "Cày bừa, cho nước ngập ruộng — để cấy lúa.",
  };
  if (!crop) {
    const beds: PlotAction = {
      key: "prepare_beds", label: "Lên luống trồng màu", run: { kind: "prepare_beds", plot }, enabled: true,
      hint: "Đắp luống cao, đất Ẩm — trồng khoai, bắp, ớt.",
    };
    return [...out, prepare, beds, ...soaks()];
  }
  if (crop.kind === "upland") return [...out, ...bedActions(p, crop, catalog, mine, now)];

  const c = cropModel(crop);
  const ph = cropPhase(c, v, now);
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  const round = (): PlotAction => {
    const label = crop.parts > 0 ? `Gặt tiếp (phần ${crop.parts + 1}/${HARVEST_PARTS})` : "Gặt bằng liềm";
    const why = ph === "ripening" && v ? `Lúa chưa chín — gặt được sau ${durationText(ripeAt(c, v)! - now)}.`
      : w > 1 ? `Rút nước trước khi gặt (đang ${WATER_NAME[w]}).`
      : (mine.items[TOOL_SICKLE] ?? 0) < 1 ? "Chưa có liềm — mua ở tiệm anh Hai." : undefined;
    return { key: "round", label, run: { kind: "round", plot }, enabled: !why, why, ...(why ? {} : { hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần." }) };
  };
  if (cut) {
    return [...out, round(), {
      key: "abandon", label: "Bỏ vụ", run: { kind: "abandon", plot }, enabled: true, warn: "Bỏ vụ là mất phần lúa chưa gặt.",
    }];
  }
  if (crop.preparedAt === null) out.push(prepare);
  if (c.soakAt === null && c.sowAt === null) out.push(...soaks());
  if (ph === "soaking") {
    out.push({ key: "sow", label: "Gieo mạ", run: { kind: "sow", plot }, enabled: false, why: `Hạt đang ngâm — nứt nanh sau ${durationText(sproutAt(c)! - now)}.` });
  } else if (ph === "sprouted") {
    const why = crop.preparedAt === null ? "Làm đất trước đã." : w !== 1 ? `Cần mực nước Ẩm (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "sow", label: "Gieo mạ", run: { kind: "sow", plot }, enabled: !why, why });
  } else if (ph === "seedling" && v) {
    const ready = transplantReadyAt(c, v)!;
    const why = now < ready ? `Mạ chưa đủ tuổi — cấy được sau ${durationText(ready - now)}.` : w !== 2 ? `Cần mực nước Nông (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "transplant", label: "Cấy lúa", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else if ((ph === "ripening" && v) || ph === "ripe" || ph === "overripe") {
    out.push(round());
  }
  if (crop.preparedAt !== null) {
    out.push(...waterButtons(p, crop, w, false, now));
    for (const f of owned("fertilizer")) {
      const a = fertAdvice(c, v, f.id, now);
      out.push({ key: `fert:${f.id}`, label: `Bón ${lower(f.name)}`, run: { kind: "fertilize", plot, item: f.id }, enabled: true, ...(a.ok ? { hint: a.text } : { warn: a.text }) });
    }
    out.push(...sprayButtons(p, crop, catalog, mine));
  }
  out.push({ key: "abandon", label: "Bỏ vụ", run: { kind: "abandon", plot }, enabled: true, warn: "Bỏ vụ là mất hết lúa trên thửa này." });
  return out;
}

/** The buttons on my beds (§8.9, §13.1): plant, transplant the ớt, the hand jobs, water, fertilizer, sprays, the picking. */
function bedActions(p: PlotView, crop: CropView, catalog: FarmCatalog, mine: FarmMine, now: number): PlotAction[] {
  const out: PlotAction[] = [];
  const plot = p.no;
  const u = uplandOf(crop, catalog);
  const c = uplandModel(crop);
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  const moist = w === 1 ? undefined : `Cần đất Ẩm (đang ${BED_WATER_NAME[w]}).`;
  if (!u) {
    const seeds = catalog.items.filter((i) => i.kind === "seed" && i.upland !== null && (mine.items[i.id] ?? 0) > 0
      && catalog.uplands.some((x) => x.id === i.upland));
    if (seeds.length === 0) {
      out.push({ key: "plant", label: "Trồng hoa màu", run: { kind: "plant", plot, item: "" }, enabled: false, why: "Chưa có giống hoa màu — ghé tiệm anh Hai." });
    }
    for (const s of seeds) {
      const x = catalog.uplands.find((y) => y.id === s.upland)!;
      out.push({ key: `plant:${s.id}`, label: x.plantLabel, run: { kind: "plant", plot, item: s.id }, enabled: !moist, why: moist });
    }
  } else if (c.plantAt === null) {
    const ready = nurseryReadyAt(c, u);
    const why = ready !== null && now < ready ? `Cây con chưa đủ tuổi — trồng được sau ${durationText(ready - now)}.` : moist;
    out.push({ key: "set_out", label: u.transplantLabel ?? "Trồng cây con", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else {
    for (const care of u.cares.filter((x) => x.kind === "act")) {
      const a = tendAdvice(c, care, now);
      const full = c.work.length >= TEND_MAX;
      out.push({
        key: `tend:${care.id}`, label: care.name, run: { kind: "tend", plot, act: care.id }, enabled: !a.done && !full,
        ...(a.done ? { why: a.text } : full ? { why: TOO_FAST } : a.ok ? { hint: a.text } : { warn: a.text }),
      });
    }
  }
  const rotFrom = u ? rotFromAt(c, u) : null;
  const rotWarn = u && rotFrom !== null && now >= rotFrom && w + 1 >= 2 ? `Đất ${BED_WATER_NAME[Math.min(3, w + 1)]} làm thối củ ${lower(u.name)}!` : undefined;
  out.push(...waterButtons(p, crop, w, true, now, rotWarn));
  for (const f of catalog.items.filter((i) => i.kind === "fertilizer" && (mine.items[i.id] ?? 0) > 0)) {
    const a = upFertAdvice(c, u, f.id, f.name, now);
    out.push({ key: `fert:${f.id}`, label: `Bón ${lower(f.name)}`, run: { kind: "fertilize", plot, item: f.id }, enabled: true, ...(a.ok ? { hint: a.text } : { warn: a.text }) });
  }
  out.push(...sprayButtons(p, crop, catalog, mine));
  if (u && c.plantAt !== null) {
    const k = upNext(c, u, now), n = u.pickings.length;
    if (k > 0) {
      const ready = upReadyAt(c, u, k)!;
      const job = lower(u.harvestLabel);
      const why = now < ready ? `Chưa chín — ${job} được sau ${durationText(ready - now)}.`
        : w > 1 ? `Tháo bớt nước trước khi ${job} (đang ${BED_WATER_NAME[w]}).` : undefined;
      out.push({
        key: "picking", label: `${u.harvestLabel}${n > 1 ? ` (lứa ${k}/${n})` : ""}`, run: { kind: "work", plot, work: "harvest" },
        enabled: !why, why,
      });
    }
  }
  out.push({ key: "abandon", label: "Bỏ vụ", run: { kind: "abandon", plot }, enabled: true, warn: "Bỏ vụ là mất hết hoa màu trên thửa này." });
  return out;
}

/** The jobs a plot's prompt can name, by action key (before the ":"); the v15.2 jobs are named by their button. */
const PROMPT_JOB: Record<string, string | null> = {
  pick: "Bắt ốc", prepare: "Làm đất", prepare_beds: "Làm đất", soak: "Ngâm giống", sow: "Gieo mạ", transplant: "Cấy lúa",
  round: null, plant: null, set_out: null, picking: null,
};

/** A plot's HUD prompt (spec §13.2, v15.2 §13.6): my next job there ("Gieo mạ thửa 3", "Gặt tiếp thửa 3", "Hái ớt thửa 6"),
 *  else whose plot it is ("Xem thửa 5 (của Lan)"). */
export function plotPrompt(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): string {
  if (p.farmer?.id === me) {
    const job = plotActions(p, me, v, catalog, mine, now).map((a) => {
      const key = a.key.split(":")[0];
      if (!a.enabled || !(key in PROMPT_JOB)) return undefined;
      return PROMPT_JOB[key] ?? a.label.replace(/ \(.*\)$/, "");
    }).find(Boolean);
    return job ? `${job} thửa ${p.no}` : `Xem thửa ${p.no}`;
  }
  const who = p.farmer ?? p.owner;
  return `Xem thửa ${p.no} (${who ? `của ${who.name}` : p.kind === "private" ? "đất bán" : "đất trống"})`;
}

/** What is due on the plots I farm (spec §13.1, v15.2 §13.3): urgent tasks first, then by plot. */
export function dueTasks(plots: readonly PlotView[], me: string, catalog: FarmCatalog, mine: FarmMine, now: number): FarmTask[] {
  const out: FarmTask[] = [];
  for (const p of plots) {
    if (p.farmer?.id !== me) continue;
    const add = (text: string, urgent: boolean) => out.push({ plot: p.no, text: `Thửa ${p.no} · ${text}`, urgent });
    if (p.lease && p.lease.until - now <= 12 * HOUR_MS) add(`Hết hạn thuê sau ${durationText(p.lease.until - now)}`, p.lease.until - now <= 3 * HOUR_MS);
    const crop = p.crop;
    if (!crop) {
      add("Làm đất (ruộng lúa hoặc lên luống)", false);
      continue;
    }
    if (crop.harvester) {
      add(`Máy gặt đang gặt — còn ${Math.max(0, Math.ceil((crop.harvester.endsAt - now) / 1000))} giây`, false);
      continue;
    }
    if (crop.kind === "upland") {
      bedTasks(crop, catalog, now, add);
      continue;
    }
    const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
    const c = cropModel(crop);
    const ph = cropPhase(c, v, now);
    const w = crop.log ? waterAt(c.water, now) : crop.water;
    if (crop.parts > 0) {
      add(`Gặt tiếp — đã gặt ${crop.parts}/${HARVEST_PARTS} phần`, ph === "overripe");
      continue;
    }
    if (crop.preparedAt === null) add("Làm đất", false);
    if (c.transplantAt === null && crop.preparedAt !== null) {
      const care = cropCare(c, v);
      if (!care.manure || !care.phosphate) add("Bón lót (phân chuồng, phân lân)", false);
    }
    const T = c.transplantAt === null ? 0 : (now - c.transplantAt) / HOUR_MS;
    const s = v?.scale ?? 1;
    switch (ph) {
      case "prepared":
        if (c.soakAt === null) add("Ngâm giống", false);
        break;
      case "soaking":
        add(`Chờ hạt nứt nanh — còn ${durationText(sproutAt(c)! - now)}`, false);
        break;
      case "sprouted":
        add(`Gieo mạ — còn ${durationText(rotAt(c)! - now)}`, now >= sowLateAt(c)!);
        break;
      case "seedling":
        if (!v) break;
        if (now < transplantReadyAt(c, v)!) add(`Mạ đang lớn — cấy được sau ${durationText(transplantReadyAt(c, v)! - now)}`, false);
        else add("Cấy lúa", now >= seedlingsOldAt(c, v)!);
        break;
      case "tillering":
        if (cropCare(c, v).td1 !== 0 && T >= 2 * s && T <= 10 * s) add(`Bón thúc đẻ nhánh — còn ${durationText((10 * s - T) * HOUR_MS)}`, true);
        if (T >= 14 * s && w > 1) add("Phơi ruộng: tháo cạn nước", false);
        break;
      case "panicle":
        if (cropCare(c, v).td2 !== 0 && T <= 24 * s) add(`Bón đón đòng — còn ${durationText((24 * s - T) * HOUR_MS)}`, true);
        break;
      case "ripe":
        if (v) add(`Gặt — còn ${durationText(overripeAt(c, v)! - now)}`, overripeAt(c, v)! - now <= 3 * HOUR_MS);
        break;
      case "overripe":
        add("Gặt ngay — lúa đang rụng!", true);
        break;
    }
    if (["heading", "ripening", "ripe", "overripe"].includes(ph) && (mine.items[TOOL_SICKLE] ?? 0) < 1) {
      add("Chưa có liềm — mua ở tiệm anh Hai hoặc thuê máy gặt", ph === "ripe" || ph === "overripe");
    }
    const want = crop.log ? wantedWater(c, v, now) : null;
    if (want && !want.levels.includes(w)) {
      add(`${w < want.levels[0] ? "Bơm nước" : "Tháo nước"} (đang ${WATER_NAME[w]}, cần ${want.short})`, true);
    }
    pestTasks(crop, add);
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.plot - b.plot);
}

/** One line per untreated pest kind: bắp's two armyworm waves are one job. */
function pestTasks(crop: CropView, add: (text: string, urgent: boolean) => void): void {
  for (const kind of new Set(crop.pests.filter((x) => x.treatedAt === null).map((x) => x.kind))) {
    const remedy = PEST_REMEDY[kind];
    add(`${PEST_NAME[kind]}! ${remedy ? `Xịt ${REMEDY_LABEL[remedy]}` : "Bắt ốc hoặc tháo cạn nước"}`, true);
  }
}

/** What is due on my beds (§13.3). */
function bedTasks(crop: CropView, catalog: FarmCatalog, now: number, add: (text: string, urgent: boolean) => void): void {
  const u = uplandOf(crop, catalog);
  const c = uplandModel(crop);
  if (!u) {
    // bón lót goes on before planting, as on a paddy (with nothing planted, every bag so far is before P)
    const base = (item: string) => c.fert.some((e) => e.item === item);
    if (!base("fert_manure") || !base("fert_phosphate")) add("Bón lót (phân chuồng, phân lân)", false);
    add("Trồng hoa màu", false);
    return;
  }
  if (c.plantAt === null) {
    const care = upCare(c, u);
    if (!care.manure || !care.phosphate) add("Bón lót (phân chuồng, phân lân)", false);
    const ready = nurseryReadyAt(c, u), old = nurseryOldAt(c, u);
    if (ready !== null && now < ready) add(`Cây ớt con đang lớn — trồng được sau ${durationText(ready - now)}`, false);
    else add(u.transplantLabel ?? "Trồng cây con", old !== null && now >= old);
  } else {
    const T = (now - c.plantAt) / HOUR_MS;
    const scores = upCare(c, u).scores;
    u.cares.forEach((care, i) => {
      if (scores[i] !== 0 && T >= care.fromH && T <= care.toH) add(`${care.name} — còn ${durationText((care.toH - T) * HOUR_MS)}`, true);
    });
    const k = upNext(c, u, now);
    if (k > 0) {
      const ready = upReadyAt(c, u, k)!, over = upOverAt(c, u, k)!, lost = upLostAt(c, u, k)!;
      const job = u.harvestLabel;
      if (now >= over && now < lost) add(`${job} ngay — đang hư!`, true);
      else if (now >= ready) add(`${job} — còn ${durationText(over - now)}`, over - now <= 3 * HOUR_MS);
      else if (k > 1) add(`${job} lứa ${k} — chín sau ${durationText(ready - now)}`, false);
    }
  }
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  const want = crop.log ? upWantedWater(c, u, now) : null;
  const rotFrom = rotFromAt(c, u);
  if (rotFrom !== null && now >= rotFrom && w >= 2) add(`Tháo nước ngay — ${lower(u.name)} đang thối củ!`, true);
  else if (want && !want.includes(w)) {
    add(`${w < Math.min(...want) ? "Tưới nước" : "Tháo nước"} (đang ${BED_WATER_NAME[w]}, cần ${bedLevelsText(want)})`, true);
  }
  pestTasks(crop, add);
}
