"use client";

import { useEffect, useState } from "react";
import { swatchOf } from "@/lib/game/art/items";
import { HAIR_COLOR, HAIR_COLOR_LABEL, HAIR_STYLE_LABEL, SKIN, SKIN_LABEL } from "@/lib/game/art/palettes";
import {
  characterErrorMessage, fetchCatalog, saveCharacter, validateLook, type CatalogItem, type LookProblem,
} from "@/lib/game/character";
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type ItemSlot, type Look } from "@/lib/game/types";
import { ParchmentModal } from "./Parchment";
import SpritePreview from "./SpritePreview";

type ItemField = "hat" | "top" | "bottom" | "shoes" | "neck";
const ITEM_ROWS: Array<{ field: ItemField; slot: ItemSlot; label: string; optional: boolean }> = [
  { field: "hat", slot: "hat", label: "Mũ", optional: true },
  { field: "top", slot: "top", label: "Áo", optional: false },
  { field: "bottom", slot: "bottom", label: "Quần", optional: false },
  { field: "shoes", slot: "shoes", label: "Dép", optional: false },
  { field: "neck", slot: "neck", label: "Khăn", optional: true },
];

const PROBLEM_TEXT: Record<LookProblem, string> = {
  option: "Lựa chọn ngoại hình không hợp lệ.",
  slot: "Món đồ này chưa dùng được.",
  missing: "Hãy chọn áo, quần và dép.",
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

/** Create (first entry) or edit ("👕 Tủ đồ") my character. */
export default function CharacterEditor({ mode, initial, token, onSaved, onClose, onBackToClassic }: {
  mode: "create" | "edit";
  initial: Look;
  token: string;
  onSaved: (look: Look) => void;
  onClose: () => void;
  onBackToClassic: () => void;
}) {
  const [draft, setDraft] = useState<Look>(initial);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchCatalog()
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch(() => {
        if (active) setError("Không tải được danh sách đồ — thử lại sau.");
      });
    return () => {
      active = false;
    };
  }, []);

  const set = <K extends keyof Look>(key: K, value: Look[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!catalog || saving) return;
    const problem = validateLook(draft, catalog);
    if (problem) {
      setError(PROBLEM_TEXT[problem]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveCharacter(token, draft));
    } catch (e) {
      setError(characterErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const itemsFor = (slot: ItemSlot) => (catalog ?? []).filter((c) => c.slot === slot && c.starter);

  return (
    <ParchmentModal title={mode === "create" ? "Tạo nhân vật" : "Tủ đồ"} onClose={mode === "edit" ? onClose : undefined} className="max-w-2xl">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
          <div className="rounded-sm border-2 border-gold-200 bg-parchment p-2">
            <SpritePreview look={draft} mode="walk" scale={3} />
          </div>
          {mode === "create" && <p className="max-w-40 text-center font-vt text-lg leading-tight">Chọn dáng cho nhân vật của bạn nhé!</p>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 font-vt text-lg">
          <div>
            <p className="leading-none">Da</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {SKIN_TONES.map((s) => (
                <Swatch key={s} color={SKIN[s].s} label={SKIN_LABEL[s]} selected={draft.skin === s} onClick={() => set("skin", s)} />
              ))}
            </div>
          </div>
          <div>
            <p className="leading-none">Kiểu tóc</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {HAIR_STYLES.map((h) => (
                <Swatch key={h} color={null} label={HAIR_STYLE_LABEL[h]} selected={draft.hair === h} onClick={() => set("hair", h)} />
              ))}
            </div>
          </div>
          <div>
            <p className="leading-none">Màu tóc</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {HAIR_COLORS.map((c) => (
                <Swatch key={c} color={HAIR_COLOR[c].h} label={HAIR_COLOR_LABEL[c]} selected={draft.hairColor === c} onClick={() => set("hairColor", c)} />
              ))}
            </div>
          </div>
          {ITEM_ROWS.map((row) => (
            <div key={row.field}>
              <p className="leading-none">{row.label}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {row.optional && (
                  <Swatch color={null} label="Không" selected={draft[row.field] === null} onClick={() => set(row.field, null)} />
                )}
                {itemsFor(row.slot).map((it) => (
                  <Swatch key={it.id} color={swatchOf(it.id)} label={it.name} selected={draft[row.field] === it.id} onClick={() => set(row.field, it.id)} />
                ))}
                {!catalog && !error && <span className="text-base opacity-70">Đang tải…</span>}
              </div>
            </div>
          ))}
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
