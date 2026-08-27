import { useCallback, useEffect } from "react";
import type { Battle } from "../bindings";
import { ChatPane } from "../chat/ChatPane";
import { type ConversationDescriptor, convId } from "../chat/conversation";
import { useConversation } from "../chat/useConversation";
import { useMultiplayer } from "../store";
import { colorIntToHex } from "./config";

/**
 * The battle's chat, embedded in the room. Reuses the same `ChatPane` +
 * `useConversation` as the chat hub — bound to the `{kind:"battle"}` descriptor —
 * so autohost replies and player chat land here, tinted by each player's team
 * colour. The grid wrapper gives the embedded pane a bounded height to scroll in.
 */
export function BattleChatCard({ battle }: { battle: Battle }) {
  const { mirror, markSeen } = useMultiplayer();
  const me = mirror.state?.myUsername ?? null;
  const channel = battle.channel;
  const desc: ConversationDescriptor | null = channel
    ? { kind: "battle", id: battle.id, channel }
    : null;
  const conv = useConversation(desc);

  // Reading the room is reading its chat, so being here marks it seen. Without
  // this the Battle Room nav badge counted every line while you sat in front of
  // it. Only the chat hub ever marked anything read, and it cannot mark a room
  // it was never opened for.
  const seenId = desc ? convId(desc) : null;
  const seen = conv.total;
  useEffect(() => {
    if (seenId) markSeen(seenId, seen);
  }, [seenId, seen, markSeen]);

  const senderColor = useCallback(
    (from: string): string | undefined => {
      const c = battle.members[from]?.teamColor;
      return c == null ? undefined : colorIntToHex(c);
    },
    [battle],
  );
  const users = mirror.state?.users;
  const isBot = useCallback(
    (from: string): boolean => users?.[from]?.status.bot ?? false,
    [users],
  );

  if (!channel) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        Battle chat isn't available yet.
      </div>
    );
  }

  // `grid` + `min-h-0 flex-1` stretches the embedded pane to fill the remaining
  // column height so the chat is anchored to the bottom and scrolls internally
  // (the page itself never scrolls).
  return (
    <div className="grid min-h-0 flex-1">
      <ChatPane
        variant="embedded"
        title="Battle chat"
        messages={conv.messages}
        currentUser={me}
        senderColor={senderColor}
        isBot={isBot}
        maxChars={conv.maxChars}
        onSend={conv.send}
      />
    </div>
  );
}
