// The story chain's RPCs (0114_story_quests.sql).
import { supabase } from "@/lib/supabase";
import { parseStoryState, type StoryState } from "./model";

async function call(fn: string, args: Record<string, unknown>): Promise<StoryState> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const s = parseStoryState(data);
  if (!s) throw new Error("too far");                                     // an anti-cheat envelope: a refused position
  return s;
}

export const storyState = (token: string) => call("story_state", { p_session_token: token });
export const storyAccept = (token: string, quest: string) => call("story_accept", { p_session_token: token, p_quest: quest });
export const storyTurnIn = (token: string, quest: string, at: { x: number; y: number }) =>
  call("story_turn_in", { p_session_token: token, p_quest: quest, p_x: Math.round(at.x), p_y: Math.round(at.y) });
