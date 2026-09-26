"use client";

import { useEffect, useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { dogNameRefusal, dogStatus, feedRefusal, type DogView } from "@/lib/game/dog";
import { serverNow } from "@/lib/game/farm/clock";
import {
  DOG_FEED_REFUSAL, DOG_NAME_HINT, DOG_NAME_PROBLEM, dogCatchesLine, dogCoatLine, dogFeedButton, dogFoodLine, dogHuntLine,
} from "@/lib/game/farm/messages";

/** The rename form: the name, "Lưu" (while dogNameRefusal finds nothing) and "Huỷ". */
function Rename({ current, busy, onSave, onCancel }: {
  current: string;
  busy: boolean;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current);
  const problem = dogNameRefusal(name);
  return (
    <form className="flex flex-col gap-1" onSubmit={(e) => {
      e.preventDefault();
      if (!problem) void onSave(name).then((ok) => { if (ok) onCancel(); });
    }}>
      <label className="flex items-center gap-2">
        Tên
        <input className="flex-1 rounded-sm border border-ink/40 bg-parchment px-1" value={name} maxLength={32}
          onChange={(e) => setName(e.target.value)} />
      </label>
      <span className={`text-base ${problem ? "text-burgundy" : "opacity-80"}`}>{problem ? DOG_NAME_PROBLEM[problem] : DOG_NAME_HINT}</span>
      <div className="flex gap-1">
        <button type="submit" className="pch-btn pch-btn-primary" disabled={busy || problem !== null}>Lưu</button>
        <button type="button" className="pch-btn" onClick={onCancel}>Huỷ</button>
      </div>
    </form>
  );
}

/** DogPanel (v17 §12.3): my dog's coat and day, food, hunting and catches; "Cho ăn", "Đổi tên" and "Vuốt ve". */
export default function DogPanel({ dog, food, busy, onFeed, onRename, onPet, onClose }: {
  dog: DogView;
  food: number;
  busy: boolean;
  onFeed: () => void;
  onRename: (name: string) => Promise<boolean>;
  onPet: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  // the countdowns tick on the server's clock
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = dogStatus(dog, now);
  const refusal = feedRefusal(dog, food, now);
  return (
    <ParchmentModal title={`🐕 ${dog.name}`} onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <p>{dogCoatLine(dog.coat, dog.adoptedAt)}</p>
        <p>{dogFoodLine(s)}</p>
        <p>{dogHuntLine(s)}</p>
        <p>{dogCatchesLine(dog.catches)}</p>
        <div className="flex flex-col items-start gap-1">
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || refusal !== null} onClick={onFeed}>
            {dogFeedButton(food)}
          </button>
          {refusal && <span className="text-base opacity-80">{DOG_FEED_REFUSAL[refusal]}</span>}
        </div>
        {renaming ? (
          <Rename current={dog.name} busy={busy} onSave={onRename} onCancel={() => setRenaming(false)} />
        ) : (
          <div className="flex flex-wrap gap-1">
            <button type="button" className="pch-btn" onClick={() => setRenaming(true)}>{"\u270f\ufe0f Đổi tên"}</button>
            <button type="button" className="pch-btn" onClick={onPet}>🤚 Vuốt ve</button>
          </div>
        )}
      </div>
    </ParchmentModal>
  );
}
