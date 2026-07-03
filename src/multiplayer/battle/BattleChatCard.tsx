import { useCallback } from "react";
import type { Battle } from "../bindings";
import { ChatPane } from "../chat/ChatPane";
import type { ConversationDescriptor } from "../chat/conversation";
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
  const { mirror } = useMultiplayer();
  const me = mirror.state?.myUsername ?? null;
  const channel = battle.channel;
  const desc: ConversationDescriptor | null = channel
    ? { kind: "battle", id: battle.id, channel }
    : null;
  const conv = useConversation(desc);

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
        onSend={conv.send}
      />
    </div>
  );
}
