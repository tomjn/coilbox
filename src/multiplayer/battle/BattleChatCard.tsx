import { useCallback, useEffect } from "react";
import type { MapItem } from "@/content/bindings";
import { autohostHearsChat } from "../../direct/room";
import type { Battle, ChatMsg } from "../bindings";
import { ChatPane } from "../chat/ChatPane";
import { type ConversationDescriptor, convId } from "../chat/conversation";
import { useConversation } from "../chat/useConversation";
import { useMultiplayer } from "../store";
import { colorIntToHex, type MemberRow } from "./config";
import { applyLayoutDirectly, balanceLayoutForRows } from "./gameTypePresets";
import { HostSuggestionAction } from "./HostSuggestionAction";
import {
  type HostSuggestionKind,
  hostSuggestionActionLabel,
  matchHostSuggestion,
} from "./hostSuggestion";
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
 *
 * A direct room runs no autohost, so `!balance`/`!lock`/`!unlock` are read
 * the same way (issue #2871): the founder alone (`selfHost`) gets a
 * `messageAction` of Accept/Reject, drawn under the plain command line
 * rather than instead of it, so the line itself stays exactly what was
 * sent. Selecting or copying it, alone or as part of a drag across several
 * lines of chat, still yields the literal command a real autohost would
 * read, and a real autohost battle is unaffected either way. Accept reuses
 * the founder-direct paths `GameTypePresetsControls` and the battle room
 * header already have. Reject is an ordinary chat message, which is how the
 * joiner sees they were answered without teaching the room server anything
 * new.
 */
export function BattleChatCard({
  battle,
  enginePath,
  dataDir,
  maps,
  canChangeMap,
  onChangeMap,
  selfHost,
  directRoom,
  rows,
  hostControls,
  onSetBattleStatusBatch,
  onSetLocked,
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
  /** This client is the battle's founder, running the game themselves. Only
   *  the founder of a direct room gets Accept/Reject on a host suggestion,
   *  mirroring the header's Lock toggle and the Balance button's own gate. */
  selfHost: boolean;
  /** The live connection is a room somebody hosts rather than a lobby
   *  server, so there is no autohost behind it able to read a `!` command. */
  directRoom: boolean;
  rows: MemberRow[];
  hostControls: {
    forceTeam: (user: string, team: number) => void;
    forceAlly: (user: string, ally: number) => void;
  };
  onSetBattleStatusBatch: (patch: { ally?: number; teamId?: number }) => void;
  onSetLocked: (locked: boolean) => void;
}) {
  const { mirror, activeKey, markSeen } = useMultiplayer();
  const me = mirror.state?.myUsername ?? null;
  const channel = battle.channel;
  const desc: ConversationDescriptor | null = channel
    ? { kind: "battle", id: battle.id, channel }
    : null;
  // Bound to the app's active connection, same as every other battle-room
  // surface today. Picking the battle's own connection when several are open
  // is issue #2844's job, not this card's.
  const conv = useConversation(desc, activeKey);

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

  // Only the founder of a direct room can honour a `!balance`/`!lock`
  // request by hand (issue #2871). This is the same fact the header's Lock
  // toggle and the Balance button's self-host branch already gate on.
  const canHonourHostSuggestion = selfHost && !autohostHearsChat(directRoom);
  const acceptHostSuggestion = useCallback(
    (kind: HostSuggestionKind) => {
      if (kind === "balance") {
        applyLayoutDirectly(
          balanceLayoutForRows(rows),
          me,
          hostControls.forceAlly,
          hostControls.forceTeam,
          onSetBattleStatusBatch,
        );
        return;
      }
      onSetLocked(kind === "lock");
    },
    [rows, me, hostControls, onSetBattleStatusBatch, onSetLocked],
  );
  const rejectHostSuggestion = useCallback(
    (kind: HostSuggestionKind) => {
      conv.send(`Declined: ${hostSuggestionActionLabel(kind)}`);
    },
    [conv],
  );

  const messageAction = useCallback(
    (m: ChatMsg) => {
      if (canChangeMap) {
        const mapMatch = matchMapSuggestion(m.text, maps);
        if (mapMatch) {
          return (
            <MapSuggestionAction
              suggestion={mapMatch}
              pending={pendingMap != null}
              onAccept={requestMapChange}
            />
          );
        }
      }
      if (canHonourHostSuggestion) {
        const suggestion = matchHostSuggestion(m.text);
        if (suggestion) {
          return (
            <HostSuggestionAction
              suggestion={suggestion}
              onAccept={() => acceptHostSuggestion(suggestion.kind)}
              onReject={() => rejectHostSuggestion(suggestion.kind)}
            />
          );
        }
      }
      return null;
    },
    [
      canChangeMap,
      maps,
      pendingMap,
      requestMapChange,
      canHonourHostSuggestion,
      acceptHostSuggestion,
      rejectHostSuggestion,
    ],
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
