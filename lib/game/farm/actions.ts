import type { FarmCatalog, FarmItemKind, Variety } from "./catalog";
import {
  cropCare, cropModel, cropPhase, HOUR_MS, overripeAt, ripeAt, rotAt, seedlingsOldAt, sowLateAt, sproutAt,
  transplantReadyAt, waterAt, wantedWater, type CropModel,
} from "./crop";
import { durationText, NO_SEED, PEST_NAME, PEST_REMEDY, WATER_NAME } from "./messages";
import type { FieldAction } from "./rpc";
import type { FarmMine, PlotView } from "./state";

// What can be done on a plot right now (the plot panel's buttons) and what is due on my plots (the HUD task list,
// spec §13.1–13.2). Pure.

/** A button's job: an RPC, or a 2-second work action (begin_work, then transplant / harvest). */
export type PlotRun = FieldAction | { kind: "work"; plot: number; work: "transplant" | "harvest" };

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

/** The buttons of the plot panel for `me` (spec §13.2). Anyone may pick snails; the rest is for the plot's farmer. */
export function plotActions(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): PlotAction[] {
  const out: PlotAction[] = [];
  const crop = p.crop;
  const plot = p.no;
  if (crop?.pests.some((x) => x.kind === "snail" && x.treatedAt === null)) {
    out.push({ key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot }, enabled: true });
  }
  if (p.farmer?.id !== me) return out;
  const owned = (kind: FarmItemKind) => catalog.items.filter((i) => i.kind === kind && (mine.items[i.id] ?? 0) > 0);
  const soaks = (): PlotAction[] => {
    const seeds = owned("seed");
    if (seeds.length === 0) return [{ key: "soak", label: "Ngâm giống", run: { kind: "soak", plot, item: "" }, enabled: false, why: NO_SEED }];
    return seeds.map((i) => ({ key: `soak:${i.id}`, label: `Ngâm ${lower(i.name)}`, run: { kind: "soak", plot, item: i.id }, enabled: true }));
  };
  const prepare: PlotAction = { key: "prepare", label: "Làm đất", run: { kind: "prepare", plot }, enabled: true, hint: "Cày bừa, cho nước vào ngập ruộng." };
  if (!crop) return [...out, prepare, ...soaks()];

  const c = cropModel(crop);
  const ph = cropPhase(c, v, now);
  const w = crop.log ? waterAt(c.water, now) : crop.water;
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
  } else if (ph === "ripening" && v) {
    out.push({ key: "harvest", label: "Gặt lúa", run: { kind: "work", plot, work: "harvest" }, enabled: false, why: `Lúa chưa chín — gặt được sau ${durationText(ripeAt(c, v)! - now)}.` });
  } else if (ph === "ripe" || ph === "overripe") {
    const why = w > 1 ? `Rút nước trước khi gặt (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "harvest", label: "Gặt lúa", run: { kind: "work", plot, work: "harvest" }, enabled: !why, why });
  }
  if (crop.preparedAt !== null) {
    out.push({ key: "water_up", label: w >= 3 ? "Bơm thêm nước (giữ Sâu)" : `Bơm nước (lên ${WATER_NAME[w + 1]})`, run: { kind: "water", plot, delta: 1 }, enabled: true });
    out.push({
      key: "water_down", label: w === 0 ? "Tháo nước" : `Tháo nước (xuống ${WATER_NAME[w - 1]})`, run: { kind: "water", plot, delta: -1 },
      enabled: w > 0, why: w === 0 ? "Ruộng đã khô." : undefined,
    });
    for (const f of owned("fertilizer")) {
      const a = fertAdvice(c, v, f.id, now);
      out.push({ key: `fert:${f.id}`, label: `Bón ${lower(f.name)}`, run: { kind: "fertilize", plot, item: f.id }, enabled: true, ...(a.ok ? { hint: a.text } : { warn: a.text }) });
    }
    for (const s of owned("pesticide")) {
      const target = crop.pests.find((x) => x.treatedAt === null && PEST_REMEDY[x.kind] === s.id);
      out.push({
        key: `spray:${s.id}`, label: `Xịt ${lower(s.name)}`, run: { kind: "spray", plot, item: s.id }, enabled: true,
        ...(target ? { hint: `Trị ${lower(PEST_NAME[target.kind])}.` } : { warn: "Không có sâu bệnh nào trị bằng thuốc này — xịt là phí." }),
      });
    }
  }
  out.push({ key: "abandon", label: "Bỏ vụ", run: { kind: "abandon", plot }, enabled: true, warn: "Bỏ vụ là mất hết lúa trên thửa này." });
  return out;
}

/** The jobs a plot's prompt can name, by action key (before the ":"). */
const PROMPT_JOB: Record<string, string> = {
  pick: "Bắt ốc", prepare: "Làm đất", soak: "Ngâm giống", sow: "Gieo mạ", transplant: "Cấy lúa", harvest: "Gặt lúa",
};

/** A plot's HUD prompt (spec §13.2): my next job there ("Gieo mạ thửa 3"), else whose plot it is ("Xem thửa 5 (của Lan)"). */
export function plotPrompt(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): string {
  if (p.farmer?.id === me) {
    const job = plotActions(p, me, v, catalog, mine, now).map((a) => (a.enabled ? PROMPT_JOB[a.key.split(":")[0]] : undefined)).find(Boolean);
    return job ? `${job} thửa ${p.no}` : `Xem thửa ${p.no}`;
  }
  const who = p.farmer ?? p.owner;
  return `Xem thửa ${p.no} (${who ? `của ${who.name}` : p.kind === "private" ? "đất bán" : "đất trống"})`;
}

/** What is due on the plots I farm (spec §13.1): urgent tasks first, then by plot. */
export function dueTasks(plots: readonly PlotView[], me: string, varieties: readonly Variety[], now: number): FarmTask[] {
  const out: FarmTask[] = [];
  for (const p of plots) {
    if (p.farmer?.id !== me) continue;
    const add = (text: string, urgent: boolean) => out.push({ plot: p.no, text: `Thửa ${p.no} · ${text}`, urgent });
    if (p.lease && p.lease.until - now <= 12 * HOUR_MS) add(`Hết hạn thuê sau ${durationText(p.lease.until - now)}`, p.lease.until - now <= 3 * HOUR_MS);
    const crop = p.crop;
    if (!crop) {
      add("Làm đất, ngâm giống", false);
      continue;
    }
    const v = varieties.find((x) => x.id === crop.variety) ?? null;
    const c = cropModel(crop);
    const ph = cropPhase(c, v, now);
    const w = crop.log ? waterAt(c.water, now) : crop.water;
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
    const want = crop.log ? wantedWater(c, v, now) : null;
    if (want && !want.levels.includes(w)) {
      add(`${w < want.levels[0] ? "Bơm nước" : "Tháo nước"} (đang ${WATER_NAME[w]}, cần ${want.short})`, true);
    }
    for (const x of crop.pests) {
      if (x.treatedAt !== null) continue;
      const remedy = PEST_REMEDY[x.kind];
      add(`${PEST_NAME[x.kind]}! ${remedy ? `Xịt ${REMEDY_LABEL[remedy]}` : "Bắt ốc hoặc tháo cạn nước"}`, true);
    }
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.plot - b.plot);
}
