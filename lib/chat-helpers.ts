/**
 * Helpers for parsing, formatting, and rendering chat messages
 * supporting replies and @mentions within the 500-char message constraint.
 */

export interface ParsedChatBody {
  replyToId: string | null;
  replyToUsername: string | null;
  text: string;
}

const REPLY_REGEX = /^\[reply:([a-f0-9-]+)\|([^\]]+)\]\s*([\s\S]*)$/i;

/**
 * Parses raw chat message body to extract reply metadata and main text.
 */
export function parseChatMessageBody(body: string): ParsedChatBody {
  const match = body.match(REPLY_REGEX);
  if (match) {
    return {
      replyToId: match[1],
      replyToUsername: match[2],
      text: match[3],
    };
  }
  return {
    replyToId: null,
    replyToUsername: null,
    text: body,
  };
}

/**
 * Formats message body with optional reply prefix, strictly clamped to 500 characters.
 */
export function formatChatMessageBody(
  text: string,
  replyTo?: { id: string; username: string } | null,
): string {
  const trimmed = text.trim();
  if (!replyTo) {
    return trimmed.slice(0, 500);
  }
  const cleanUsername = replyTo.username.replace(/[|\]]/g, "").trim().slice(0, 30);
  const prefix = `[reply:${replyTo.id}|${cleanUsername}] `;
  const maxTextLen = Math.max(0, 500 - prefix.length);
  return `${prefix}${trimmed.slice(0, maxTextLen)}`;
}

/**
 * Cleans the message body for display in desktop notifications or titles.
 */
export function cleanNotificationText(body: string): string {
  const parsed = parseChatMessageBody(body);
  if (parsed.replyToUsername) {
    return `[Trả lời @${parsed.replyToUsername}] ${parsed.text}`;
  }
  return parsed.text;
}

/**
 * Matches @username tokens where username can contain alphanumeric chars and Vietnamese diacritics.
 */
export const MENTION_REGEX = /@([a-zA-Z0-9_\u00C0-\u1EF9]+)/g;

/**
 * Extracts list of @mentions from text.
 */
export function extractMentions(text: string): string[] {
  const matches = text.matchAll(MENTION_REGEX);
  const mentions: string[] = [];
  for (const m of matches) {
    if (m[1]) mentions.push(m[1]);
  }
  return mentions;
}
