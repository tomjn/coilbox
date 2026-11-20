import { useEffect } from "react";

/**
 * The conversations on screen right now, so a mention in one of them can skip
 * its toast (issue #5285). The message is already in front of the player with
 * its outline, and a toast over the chat they are reading only gets in the way.
 *
 * Keyed by `serverKey` and `convId`. Counted rather than a set, because the
 * chat page and the battle room can both show the same battle's chat.
 */
const open = new Map<string, number>();

const keyOf = (serverKey: string, id: string) => `${serverKey}\n${id}`;

/** Mark a conversation as on screen while the calling component is mounted. */
export function useOpenConversation(
  serverKey: string | null,
  id: string | null,
): void {
  useEffect(() => {
    if (!serverKey || !id) return;
    const key = keyOf(serverKey, id);
    open.set(key, (open.get(key) ?? 0) + 1);
    return () => {
      const n = (open.get(key) ?? 1) - 1;
      if (n > 0) open.set(key, n);
      else open.delete(key);
    };
  }, [serverKey, id]);
}

/** Whether a conversation is on screen. */
export function isConversationOpen(serverKey: string, id: string): boolean {
  return open.has(keyOf(serverKey, id));
}
