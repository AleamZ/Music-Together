import { supabase } from "@/lib/supabase";

export type FeedbackCategory = "bug" | "suggestion" | "other";

export async function submitFeedback(token: string, category: FeedbackCategory, message: string): Promise<void> {
  const { error } = await supabase.rpc("submit_feedback", { p_session_token: token, p_category: category, p_message: message });
  if (error) throw error;
}
