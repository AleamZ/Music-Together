"use client";

import { useEffect } from "react";
import type { Interactable, MapId } from "@/lib/game/maps/types";
import type { StoryApi } from "@/lib/game/story/useStory";
import DialogueBox from "./DialogueBox";
import StoryTracker from "./StoryTracker";

// The story chain's HUD pieces in one place for GameShell: the tracker and the open dialogue.
export default function StoryLayer({ story, mapId, getLocalPos, resume, compact, onExpand }: {
  compact?: boolean;
  onExpand?: () => void;
  story: StoryApi;
  mapId: MapId;
  getLocalPos?: () => { x: number; y: number } | null;
  /** The shell's onInteract: after a talk the NPC's own panel opens. */
  resume: (it: Interactable) => void;
}) {
  const { resumeRef, dialog } = story;
  useEffect(() => { resumeRef.current = resume; }, [resumeRef, resume]);
  return (
    <>
      <StoryTracker state={story.state} mapId={mapId} getLocalPos={getLocalPos} compact={compact} onExpand={onExpand} />
      {dialog && <DialogueBox key={dialog.lines.map((l) => l.text).join("|")} lines={dialog.lines} choices={dialog.choices} onDone={dialog.onDone} />}
    </>
  );
}
