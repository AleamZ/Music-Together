"use client";

import { useEffect, useState } from "react";
import { HAIR_COLOR, HAIR_COLOR_LABEL, HAIR_STYLE_LABEL, SKIN, SKIN_LABEL } from "@/lib/game/art/palettes";
import {
  DEFAULT_HAIR, characterErrorMessage, hairForBody, fetchCatalog, itemFitsGender, rowHeading, saveCharacter, validateLook,
  type CatalogItem, type CatalogSlot, type LookProblem,
} from "@/lib/game/character";
import { GENDERS, SKIN_TONES, type Gender, type Look } from "@/lib/game/types";
import { fetchMyWardrobe } from "@/lib/game/store";
import ItemIcon from "./ItemIcon";
import { ParchmentModal } from "./Parchment";
import SpritePreview from "./SpritePreview";

type ItemField = "hat" | "top" | "bottom" | "shoes" | "neck" | "wrist" | "hairpin" | "outfit";
const ITEM_ROWS: Array<{ field: ItemField; slot: CatalogSlot; label: string; optional: boolean }> = [
  { field: "hat", slot: "hat", label: "Mũ", optional: true },
  { field: "top", slot: "top", label: "Áo", optional: true },
  { field: "bottom", slot: "bottom", label: "Quần", optional: true },
  { field: "shoes", slot: "shoes", label: "Dép", optional: false },
  { field: "neck", slot: "neck", label: "Cổ", optional: true },
  { field: "wrist", slot: "wrist", label: "Vòng tay", optional: true },
  { field: "hairpin", slot: "hairpin", label: "Kẹp tóc", optional: true },
  { field: "outfit", slot: "outfit", label: "Bộ đồ", optional: true },
];

const GENDER_LABEL: Record<Gender, string> = { nam: "♂ Nam", nu: "♀ Nữ" };

const PROBLEM_TEXT: Record<LookProblem, string> = {
  option: "Lựa chọn ngoại hình không hợp lệ.",
  slot: "Món đồ này chưa dùng được.",
  missing: "Hãy chọn dép.",
  gender: "Có món đồ không hợp với giới tính đã chọn.",
};

function Swatch({ color, label, selected, onClick }: { color: string | null; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={`flex h-9 min-w-9 items-center justify-center rounded-sm border-2 px-1 font-vt text-base leading-none ${selected ? "border-burgundy ring-2 ring-gold" : "border-gold-200"}`}
      style={color ? { background: color } : undefined}
    >
      {color ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}

/** Top and bottom may be left empty (underwear shows); their empty tile reads "Không mặc". */
const EMPTY_LABEL: Partial<Record<ItemField, string>> = { top: "Không mặc", bottom: "Không mặc" };

/** A 56 px wardrobe tile with the item's pixel icon; `id` null is the "Không" tile, which shows its label. */
function ItemTile({ id, label, selected, onClick }: { id: string | null; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`flex h-14 w-14 items-center justify-center rounded-sm border-2 bg-cream font-vt text-base leading-none ${selected ? "border-burgundy ring-2 ring-gold" : "border-gold-200"}`}
    >
      {id ? <ItemIcon id={id} scale={3} /> : label}
    </button>
  );
}

/** Create (first entry) or edit ("👕 Tủ đồ") my character. */
export default function CharacterEditor({ mode, initial, token, onSaved, onClose, onBackToClassic, onOpenStore }: {
  mode: "create" | "edit";
  initial: Look;
  token: string;
  onSaved: (look: Look) => void;
  onClose: () => void;
  onBackToClassic: () => void;
  onOpenStore?: () => void;
}) {
  const [draft, setDraft] = useState<Look>(initial);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCatalog(),
      fetchMyWardrobe(token).catch(() => ({ coins: 0, items: [] })),
    ])
      .then(([items, wardrobe]) => {
        if (active) {
          setCatalog(items);
          setOwnedIds(new Set(wardrobe.items));
        }
      })
      .catch(() => {
        if (active) setError("Không tải được danh sách đồ — thử lại sau.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  const set = <K extends keyof Look>(key: K, value: Look[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const gender: Gender = draft.gender === "nu" ? "nu" : "nam";
  // Hair is chosen only at the salon: a new character gets its body's default hair (the server inserts the same).
  const look: Look = mode === "create" ? { ...draft, ...DEFAULT_HAIR[gender] } : draft;

  const save = async () => {
    if (!catalog || saving) return;
    const problem = validateLook(look, catalog, ownedIds);
    if (problem) {
      setError(PROBLEM_TEXT[problem]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveCharacter(token, look));
    } catch (e) {
      setError(characterErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const pickGender = (g: Gender) => setDraft((d) => {
    // Hair is judged against the saved look (as 0035 save_character does against the stored row): a style the new body
    // is not offered falls back to its default; switching back restores the worn style.
    const from: Gender = initial.gender === "nu" ? "nu" : "nam";
    const next: Look = { ...d, gender: g, hair: hairForBody(initial.hair, from, g) };
    // Take off whatever the new body cannot wear: optional slots empty, required ones fall back to a fitting starter.
    for (const row of ITEM_ROWS) {
      const id = next[row.field];
      const it = id ? catalog?.find((c) => c.id === id) : undefined;
      if (!it || itemFitsGender(it, g)) continue;
      if (row.optional) (next as Record<ItemField, string | null>)[row.field] = null;
      else {
        const fallback = catalog?.find((c) => c.slot === row.slot && c.starter && itemFitsGender(c, g));
        if (fallback) (next as Record<ItemField, string | null>)[row.field] = fallback.id;
      }
    }
    return next;
  });

  // Only the items this body can wear (starter or owned); the one currently worn stays visible so nothing is hidden.
  const itemsFor = (slot: CatalogSlot, field: ItemField) => (catalog ?? []).filter((c) => c.slot === slot
    && (c.starter || ownedIds.has(c.id)) && (itemFitsGender(c, gender) || draft[field] === c.id));

  return (
    <ParchmentModal title={mode === "create" ? "Tạo nhân vật" : "Tủ đồ"} onClose={mode === "edit" ? onClose : undefined} className="sm:max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
          <div className="rounded-sm border-2 border-gold-200 bg-parchment p-2">
            <SpritePreview look={look} mode="walk" scale={3} />
          </div>
          {mode === "create" && <p className="max-w-40 text-center font-vt text-lg leading-tight">Chọn dáng cho nhân vật của bạn nhé!</p>}
          {mode === "edit" && onOpenStore && (
            <button
              type="button"
              className="pch-btn text-sm w-full mt-1"
              onClick={onOpenStore}
            >
              🛍️ Tiệm thời trang
            </button>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 font-vt text-lg">
          <div>
            <p className="leading-none">Giới tính</p>
            <div className="mt-1 grid grid-cols-2 gap-2" role="group" aria-label="Giới tính">
              {GENDERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={gender === g}
                  onClick={() => pickGender(g)}
                  className={`rounded-sm border-2 px-3 py-1 font-vt text-xl leading-none ${gender === g ? "border-burgundy bg-gold-200 font-bold text-burgundy ring-2 ring-gold" : "border-gold-200 bg-cream text-ink"}`}
                >
                  {GENDER_LABEL[g]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="leading-none">Da</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {SKIN_TONES.map((s) => (
                <Swatch key={s} color={SKIN[s].s} label={SKIN_LABEL[s]} selected={draft.skin === s} onClick={() => set("skin", s)} />
              ))}
            </div>
          </div>
          <div>
            <p className="leading-none">
              Tóc: <span className="opacity-80">{HAIR_STYLE_LABEL[look.hair]} · {HAIR_COLOR_LABEL[look.hairColor]}</span>
              <span aria-hidden className="ml-2 inline-block h-3 w-3 rounded-sm border border-gold-200 align-middle" style={{ background: HAIR_COLOR[look.hairColor].h }} />
            </p>
            <p className="mt-1 text-base leading-tight opacity-80">Đổi kiểu tóc tại Salon ở Chợ Lớn</p>
          </div>
          {ITEM_ROWS.map((row) => {
            const heading = rowHeading(row.label, draft[row.field] ?? null, catalog);
            return (
              <div key={row.field}>
                <p className="leading-none">
                  {heading.prefix}
                  {heading.name !== null && <span className="opacity-80">{heading.name}</span>}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.optional && (
                    <ItemTile id={null} label={EMPTY_LABEL[row.field] ?? "Không"} selected={(draft[row.field] ?? null) === null} onClick={() => set(row.field, null)} />
                  )}
                  {itemsFor(row.slot, row.field).map((it) => (
                    <ItemTile key={it.id} id={it.id} label={it.name} selected={draft[row.field] === it.id} onClick={() => set(row.field, it.id)} />
                  ))}
                  {!catalog && !error && <span className="text-base opacity-70">Đang tải…</span>}
                </div>
              </div>
            );
          })}
          {error && <p className="text-base text-burgundy-accent" role="alert">{error}</p>}
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            {mode === "create" ? (
              <button type="button" className="pch-btn" onClick={onBackToClassic}>
                🖥️ Về giao diện cũ
              </button>
            ) : (
              <button type="button" className="pch-btn" onClick={onClose}>
                Huỷ
              </button>
            )}
            <button type="button" className="pch-btn pch-btn-primary" disabled={!catalog || saving} onClick={() => void save()}>
              {saving ? "Đang lưu…" : "Lưu"}
            </button>
          </div>
        </div>
      </div>
    </ParchmentModal>
  );
}
