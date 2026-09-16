import { useCallback, useEffect } from "react";
import type { MapItem } from "@/content/bindings";
import type { Battle, ChatMsg } from "../bindings";
import { ChatPane } from "../chat/ChatPane";
import { type ConversationDescriptor, convId } from "../chat/conversation";
import { useConversation } from "../chat/useConversation";
import { useMultiplayer } from "../store";
import { colorIntToHex } from "./config";
import { MapSuggestionAction } from "./MapSuggestionAction";
import { matchMapSuggestion } from "./mapSuggestion";
import { useMapChangeQueue } from "./useMapChangeQueue";

/**
 * The battle's chat, embedded in the room. Reuses the same `ChatPane` +
 * `useConversation` as the chat hub — bound to the `{kind:"battle"}` descriptor —
 * so autohost replies and player chat land here, tinted by each player's team
 * colour. The grid wrapper gives the embedded pane a bounded height to scroll in.
 *
 * A member who isn't the host can only suggest a map with `!map <name>`
 * (`BattleMapCard`'s "Suggest map" path). Nothing here reads that line on its
 * own. When we can change the map ourselves, every `!map` line gets matched
 * against installed maps and, on a single match, an Accept button that
 * applies it (issue #2795).
 */
export function BattleChatCard({
  battle,
  enginePath,
  dataDir,
  maps,
  canChangeMap,
  onChangeMap,
}: {
  battle: Battle;
  enginePath: string | undefined;
  dataDir: string | undefined;
  maps: MapItem[];
  /** Whether we may change the map directly, the founder or a boss of a
   *  Tachyon lobby (mirrors `BattleMapCard`'s own gate). Only then does a
   *  `!map` line get an Accept button. Everyone else sees the line as before. */
  canChangeMap: boolean;
  onChangeMap: (name: string, maphash: number) => void;
}) {
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

  // Shared with BattleMapCard's own map picker (issue #2795), so an Accept
  // click here waits on the same checksum lookup before applying the change.
  const { pendingMap, requestMapChange } = useMapChangeQueue(
    enginePath,
    dataDir,
    onChangeMap,
  );
  const messageAction = useCallback(
    (m: ChatMsg) => {
      if (!canChangeMap) return null;
      const suggestion = matchMapSuggestion(m.text, maps);
      if (!suggestion) return null;
      return (
        <MapSuggestionAction
          suggestion={suggestion}
          pending={pendingMap != null}
          onAccept={requestMapChange}
        />
      );
    },
    [canChangeMap, maps, pendingMap, requestMapChange],
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
        messageAction={messageAction}
      />
    </div>
  );
}
