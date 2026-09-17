/**
 * Sidebar nav-item badges (issue #273): live notification counts on the Chat and
 * Battle Room items, so activity is visible without opening those pages.
 *
 * The frame calls a nav item's `badge()` inside the sidebar item's render, but only
 * when the sidebar is expanded — a *conditional* call. So `badge` returns one of
 * these components (an element), never calls hooks itself: the hooks then live in a
 * child fiber that mounts/unmounts cleanly as the sidebar collapses, rather than
 * changing the parent item's hook count.
 */
import { useSetting } from "@picoframe/frame";
import { useInBattleKey } from "../battle/useBattleRoomKey";
import { HIGHLIGHT_OWN_KEY, HIGHLIGHT_WORDS_KEY } from "../chat/highlight";
import {
  battleBadgeCount,
  battleLive,
  chatBadgeCount,
} from "../chat/unreadSummary";
import { isIgnored, useIgnored } from "../ignore";
import { useConnection, useMultiplayer } from "../store";

/** Count pill matching the per-conversation badge in `ConversationSidebar`. */
function CountPill({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Chat item badge: unread direct messages plus highlight-word hits across joined
 * channels (see {@link chatBadgeCount}), summed across every live connection
 * (issue #2843) so a mention on a second server still shows here even while
 * the chat page has a different one open. Nothing when there's nothing to flag.
 */
export function ChatNavBadge() {
  const { connections, unreadFor } = useMultiplayer();
  const [words] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [own] = useSetting<boolean>(HIGHLIGHT_OWN_KEY, true);
  const [ignored] = useIgnored();

  let n = 0;
  for (const serverKey of Object.keys(connections)) {
    if (!connections[serverKey].live) continue;
    const state = connections[serverKey].mirror.state;
    if (!state) continue;
    n += chatBadgeCount(
      state,
      (id, count) => unreadFor(id, count, serverKey),
      { words, ownEnabled: own },
      (peer) => isIgnored(ignored, serverKey, peer),
    );
  }
  return <CountPill n={n} />;
}

/**
 * Battle Room item badge: unread battle-chat count, plus an accent status dot when
 * the game is running (host in-game) — an actionable "your game has started" cue
 * shown even at zero unread. Read off the connection the battle is on.
 */
export function BattleNavBadge() {
  const { unreadFor } = useMultiplayer();
  // The battle's own connection, which need not be the focused one (issue
  // #2844). With no battle anywhere there is nothing to count.
  const serverKey = useInBattleKey();
  const state = useConnection(serverKey)?.mirror.state;
  if (!state || !serverKey) return null;

  const n = battleBadgeCount(state, (id, count) =>
    unreadFor(id, count, serverKey),
  );
  const live = battleLive(state);
  if (n <= 0 && !live) return null;

  return (
    <span className="flex items-center gap-1.5">
      {live && (
        <span
          role="img"
          aria-label="Game in progress"
          className="size-2 shrink-0 rounded-full bg-primary"
        />
      )}
      <CountPill n={n} />
    </span>
  );
}
