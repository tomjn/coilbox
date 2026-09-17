import { Button, cn, NavGate, useSetting } from "@picoframe/frame";
import { Gamepad2, LogOut, Star, UserCheck, Users, UserX } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { notify } from "@/notify/notify";
import { leaveBattle } from "../battle/leaveBattle";
import { type ChatMsg, mpLeaveChannel, mpSend } from "../bindings";
import { ChannelBrowser } from "../chat/ChannelBrowser";
import { ChannelTopicMenu } from "../chat/ChannelTopicMenu";
import { ChatPane } from "../chat/ChatPane";
import { ConversationSidebar } from "../chat/ConversationSidebar";
import {
  type ActiveConversation,
  type ConversationDescriptor,
  convId,
  isBattleChannel,
  resolveConversationRequest,
} from "../chat/conversation";
import {
  HIGHLIGHT_OWN_KEY,
  HIGHLIGHT_WORDS_KEY,
  matchesHighlight,
} from "../chat/highlight";
import { MemberActionsMenu } from "../chat/MemberActionsMenu";
import { MemberList } from "../chat/MemberList";
import { userPresence } from "../chat/presence";
import { useConversation } from "../chat/useConversation";
import { useConversationParam } from "../chat/useConversationParam";
import {
  addFavourite,
  isFavourite,
  removeFavourite,
  useFavourites,
} from "../friends";
import { useIgnoreActions } from "../ignore";
import { canChannelModerate, chanServInfo } from "../moderation";
import { useMpRevealed } from "../navPredicates";
import { useNoteActions } from "../notes";
import { protocolForKey } from "../protocol";
import { useStatsRelations } from "../statsRelation";
import { relationSummary } from "../statsRelationSummary";
import { useConnection, useMultiplayer, useProtocolServers } from "../store";

/**
 * Wrap an icon-only header button with a hover/focus tooltip so its purpose is
 * discoverable without clicking. `label` duplicates the button's `aria-label`.
 * Radix renders it from the trigger, so screen readers aren't double-announced.
 */
function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The chat hub: sidebar of channels + DMs, a reusable ChatPane for the active
 * conversation, a toggleable member panel, and the channel-browser drawer.
 * Connection lives on the Login page. When disconnected this shows a prompt.
 * Reachable only once the user has connected this session (see the `NavGate`
 * wrapper below). Before that, the route redirects to Login.
 *
 * The active conversation now carries its own `serverKey` (issue #2843):
 * `#main` on one connection and `#main` on another are different rooms, so
 * every read and every action below is scoped to the open conversation's own
 * connection, never the app's globally focused one. That focused connection
 * (`focusKey`) is still used, the same way `activeKey` was before this issue,
 * for the disconnected prompt, for an old `?channel=`/`?dm=` link with no
 * `?server=`, and to seed the sidebar's initial selection.
 */
function ChatPage() {
  const {
    connections,
    activeKey: focusKey,
    markSeen,
    forgetChannel,
    openLoginPopover,
  } = useMultiplayer();
  const servers = useProtocolServers();
  const [favourites, setFavourites] = useFavourites();
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveConversation | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [browserFor, setBrowserFor] = useState<string | null>(null);

  const desc = active?.desc ?? null;
  const activeServerKey = active?.serverKey ?? null;
  const conv = useConversation(desc, activeServerKey);
  const connection = useConnection(activeServerKey);
  const state = connection?.mirror.state ?? null;
  const me = state?.myUsername ?? null;

  // Named channels, and with them every ChanServ and moderator command below, exist
  // only on TASServer. On Tachyon the chat surface is direct messages plus battle
  // chat, and the sidebar says so. See `docs/tachyon-protocol.md`. Read off the open
  // conversation's own connection, not the app's globally focused one, so a channel
  // on one server never picks up another connection's protocol.
  const activeProtocol = protocolForKey(activeServerKey, servers);
  const hasChannels = activeProtocol !== "tachyon";

  // Ignore actions, scoped to the conversation's own connection. Toggling
  // hides/shows a user's messages (see `useConversation`) and syncs with the
  // server's ignore list where supported. The member panel and DM header
  // expose it.
  const { has: ignoredNow, toggle: toggleIgnore } =
    useIgnoreActions(activeServerKey);

  // Private, client-side per-player notes (issue #341), never sent to the
  // server, keyed on account id with a name fallback. The member panel exposes
  // add/edit/clear. The tooltip surfaces an existing note.
  const { get: getNote, set: setNote } = useNoteActions(activeServerKey);

  // "N games with this player…" line for the note popover, from the local
  // replay-stats database (#375), purely a read with no server involvement.
  const relationFor = useStatsRelations(me);

  // In a battle, tint messages by each player's team colour. The `teamColor` int
  // is `0xBBGGRR` (red is the low byte), matching the protocol's team_color_rgb.
  const battle =
    desc?.kind === "battle" ? state?.battles[String(desc.id)] : undefined;
  const senderColor = useCallback(
    (from: string): string | undefined => {
      const c = battle?.members[from]?.teamColor;
      if (c == null) return undefined;
      const r = c & 0xff;
      const g = (c >> 8) & 0xff;
      const b = (c >> 16) & 0xff;
      return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    },
    [battle],
  );
  const users = state?.users;
  const isBot = useCallback(
    (from: string): boolean => users?.[from]?.status.bot ?? false,
    [users],
  );

  // Moderation privileges. The server `access` bit marks a server moderator (may
  // run moderator verbs and ChanServ channel-ops anywhere). For a plain user, the
  // channel-op controls appear only when we're that channel's founder/operator,
  // learned from ChanServ `:info` (auto-queried on open below).
  const iAmServerMod = !!(me && state?.users[me]?.status.access);
  const activeChannel =
    desc?.kind === "channel" ? state?.channels[desc.name] : undefined;
  const iAmChannelOp = canChannelModerate(activeChannel, me, iAmServerMod);

  // Auto-query ChanServ `:info` once per channel per session when opened, to learn
  // its founder/operators (used to gate the controls). The reply is parsed and
  // suppressed in the protocol reducer, so this adds no visible chat noise. Sent as
  // a raw line via mpSend so our own query isn't recorded as a ChanServ DM.
  const infoAsked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!hasChannels) return;
    if (!activeServerKey || desc?.kind !== "channel") return;
    const name = desc.name;
    if (infoAsked.current.has(name)) return;
    infoAsked.current.add(name);
    mpSend({ serverKey: activeServerKey, line: chanServInfo(name) }).catch(
      () => {},
    );
  }, [activeServerKey, desc, hasChannels]);

  // A per-member `⋮` moderation menu, shown only in a channel where we hold
  // privileges (server mod, or this channel's founder/op) and never on our own row.
  const renderMemberActions = useCallback(
    (username: string) => {
      if (!hasChannels) return null;
      if (desc?.kind !== "channel" || !activeServerKey) return null;
      if (!iAmChannelOp && !iAmServerMod) return null;
      if (username === me) return null;
      return (
        <MemberActionsMenu
          nick={username}
          channel={desc.name}
          channelOps={iAmChannelOp}
          serverMod={iAmServerMod}
          targetIsOp={activeChannel?.operators.includes(username) ?? false}
          send={(line) => {
            void mpSend({ serverKey: activeServerKey, line }).catch(() => {});
          }}
        />
      );
    },
    [
      desc,
      activeServerKey,
      hasChannels,
      iAmChannelOp,
      iAmServerMod,
      me,
      activeChannel,
    ],
  );

  // Flag messages that mention a highlight word or our own username (issue #193).
  // Our own messages never flag us, even if we type our own name.
  const [hlWords] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [hlOwn] = useSetting<boolean>(HIGHLIGHT_OWN_KEY, true);
  const isHighlighted = useCallback(
    (m: ChatMsg): boolean =>
      m.from !== me && matchesHighlight(m.text, hlWords, me, hlOwn),
    [me, hlWords, hlOwn],
  );

  // Coarse presence for a username: offline when absent from the roster, else
  // in-game/in-battle/away/online (see `userPresence`). Used by the DM header
  // and the member panel so both speak the same vocabulary.
  const presenceFor = useCallback(
    (name: string) => (state ? userPresence(state, name) : "offline"),
    [state],
  );

  // Tab-completion candidates for the composer: channel/battle member nicks, or
  // the peer in a DM. Our own nick is excluded (you don't ping yourself).
  const completions = useMemo(() => {
    const names = conv.members.map((u) => u.name);
    if (desc?.kind === "dm") names.push(desc.peer);
    return me ? names.filter((n) => n !== me) : names;
  }, [conv.members, desc, me]);

  // For a DM header, mark the peer as a bot and show their richer presence.
  const dmPeer = desc?.kind === "dm" ? desc.peer : null;
  const titleIsBot = dmPeer != null && isBot(dmPeer);
  const titlePresence = dmPeer == null ? undefined : presenceFor(dmPeer);

  // Client-local favourite toggle for the open DM peer (see friends.ts / #185).
  const dmIsFavourite =
    dmPeer != null && activeServerKey != null
      ? isFavourite(favourites, activeServerKey, dmPeer)
      : false;
  function toggleDmFavourite() {
    if (dmPeer == null || activeServerKey == null) return;
    setFavourites(
      isFavourite(favourites, activeServerKey, dmPeer)
        ? removeFavourite(favourites, activeServerKey, dmPeer)
        : addFavourite(favourites, activeServerKey, dmPeer),
    );
  }

  // Mark the open conversation read as its message count changes. Marked with
  // the conversation's own total rather than the length of the rendered list,
  // which is shorter than the unread counters measure against. Always against
  // the conversation's own connection, not whichever one is globally focused.
  useEffect(() => {
    if (desc && activeServerKey) {
      markSeen(convId(desc), conv.total, activeServerKey);
    }
  }, [desc, activeServerKey, conv.total, markSeen]);

  // Open on the conversation a `?channel=`/`?dm=`/`?server=` address named
  // (issue #2406, extended by #2843), e.g. the match-result drawer's link to a
  // debriefing channel. Resolved against live state rather than trusted
  // outright: a channel not in the snapshot is one this session never joined,
  // and the query is an intent, not permission to join it on the reader's
  // behalf, so that fails with a toast instead of an autojoin. A link with no
  // `?server=` (an old link, or one built while only one connection was open)
  // falls back to the focused connection. A `?server=` naming a connection
  // that isn't live any more falls back the same way, rather than waiting
  // forever on a snapshot that will never arrive. `requestSettled` gates the
  // first-joined-channel fallback below, so a rejected request still lands
  // somewhere rather than leaving the page on nothing selected.
  const requestedConversation = useConversationParam();
  const requestAppliedRef = useRef<ConversationDescriptor | null>(null);
  const [requestSettled, setRequestSettled] = useState(false);
  useEffect(() => {
    if (!requestedConversation) return;
    if (requestAppliedRef.current === requestedConversation.descriptor) return;
    const requestedKey = requestedConversation.serverKey;
    const targetKey =
      requestedKey != null && connections[requestedKey]?.live
        ? requestedKey
        : focusKey;
    if (!targetKey) return; // nothing connected yet to resolve against
    const targetState = connections[targetKey]?.mirror.state;
    const result = resolveConversationRequest(
      requestedConversation.descriptor,
      targetState,
    );
    if (result == null) return; // mirror hasn't loaded enough to judge yet
    requestAppliedRef.current = requestedConversation.descriptor;
    setRequestSettled(true);
    if (result.ok) setActive({ serverKey: targetKey, desc: result.descriptor });
    else void notify({ title: result.reason, level: "error" });
  }, [requestedConversation, connections, focusKey]);

  // Open on the focused connection's first joined channel when nothing is
  // selected yet (initial entry, and once autojoined channels arrive after
  // connect). Battle chat is excluded, since it's contextual rather than a
  // standing channel. Depends on the first name (a primitive) so it re-fires
  // only when that value changes, not on every render.
  const focusState = useConnection(focusKey)?.mirror.state ?? null;
  const firstChannel =
    (focusState
      ? Object.keys(focusState.channels)
          .filter((n) => !isBattleChannel(n))
          .sort()[0]
      : undefined) ?? null;
  useEffect(() => {
    if (
      active == null &&
      firstChannel &&
      focusKey &&
      (!requestedConversation || requestSettled)
    ) {
      setActive({
        serverKey: focusKey,
        desc: { kind: "channel", name: firstChannel },
      });
    }
  }, [active, firstChannel, focusKey, requestedConversation, requestSettled]);

  // Leave a channel: stop the server membership, forget it (no auto-rejoin), and
  // deselect it if it was the open conversation.
  async function leaveChannel(name: string) {
    if (!activeServerKey) return;
    try {
      await mpLeaveChannel({ serverKey: activeServerKey, channel: name });
    } catch {
      // Forget it regardless. Leaving is best-effort.
    }
    forgetChannel(name, activeServerKey);
    setActive((cur) =>
      cur?.desc.kind === "channel" && cur.desc.name === name ? null : cur,
    );
  }

  // Leave the current battle. Battle chat isn't a leavable channel of its own, so
  // the header's leave action drops the whole battle (SAYBATTLE ends with it).
  async function leaveCurrentBattle() {
    if (!activeServerKey) return;
    try {
      await leaveBattle(activeServerKey);
    } catch {
      // Best-effort. Deselect regardless.
    }
    setActive((cur) => (cur?.desc.kind === "battle" ? null : cur));
  }

  const liveKeys = Object.keys(connections).filter((k) => connections[k].live);
  // Whether any live connection can browse channels, so the drawer only stays
  // mounted (offscreen) when it could ever be opened, matching the single-
  // connection page's old `hasChannels` gate exactly when there's one.
  const hasChannelsSomewhere = liveKeys.some(
    (k) => protocolForKey(k, servers) !== "tachyon",
  );

  if (liveKeys.length === 0) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="text-lg font-semibold">Chat</h1>
        <p className="text-sm text-muted-foreground">
          You are not connected to a lobby server.
        </p>
        <Button onClick={openLoginPopover}>Connect…</Button>
      </main>
    );
  }

  return (
    <main className="relative flex h-full min-h-0 overflow-hidden">
      <ConversationSidebar
        active={active}
        onSelect={(serverKey, d) => setActive({ serverKey, desc: d })}
        onBrowse={(serverKey) => setBrowserFor(serverKey)}
      />

      {desc ? (
        <ChatPane
          key={`${activeServerKey}:${convId(desc)}`}
          variant="full"
          title={conv.title}
          subtitle={conv.subtitle}
          titleIsBot={titleIsBot}
          titlePresence={titlePresence}
          messages={conv.messages}
          currentUser={me}
          senderColor={senderColor}
          isBot={isBot}
          isHighlighted={isHighlighted}
          completions={completions}
          maxChars={conv.maxChars}
          onSend={conv.send}
          headerActions={
            desc.kind === "dm" ? (
              <TooltipProvider delayDuration={150}>
                <IconTip
                  label={
                    dmIsFavourite
                      ? `Remove ${desc.peer} from friends`
                      : `Add ${desc.peer} to friends`
                  }
                >
                  <Button
                    variant="secondary"
                    className="h-7 px-2"
                    onClick={toggleDmFavourite}
                    aria-label={
                      dmIsFavourite
                        ? `Remove ${desc.peer} from friends`
                        : `Add ${desc.peer} to friends`
                    }
                    aria-pressed={dmIsFavourite}
                  >
                    <Star
                      className={cn(
                        "size-4",
                        dmIsFavourite && "fill-current text-amber-400",
                      )}
                    />
                  </Button>
                </IconTip>
                <IconTip
                  label={
                    ignoredNow(desc.peer)
                      ? `Unignore ${desc.peer}`
                      : `Ignore ${desc.peer}`
                  }
                >
                  <Button
                    variant="secondary"
                    className="h-7 px-2"
                    onClick={() => toggleIgnore(desc.peer)}
                    aria-label={
                      ignoredNow(desc.peer)
                        ? `Unignore ${desc.peer}`
                        : `Ignore ${desc.peer}`
                    }
                    aria-pressed={ignoredNow(desc.peer)}
                  >
                    {ignoredNow(desc.peer) ? (
                      <UserCheck className="size-4" />
                    ) : (
                      <UserX className="size-4" />
                    )}
                  </Button>
                </IconTip>
              </TooltipProvider>
            ) : desc.kind === "channel" || desc.kind === "battle" ? (
              <TooltipProvider delayDuration={150}>
                <IconTip label="Toggle members">
                  <Button
                    variant="secondary"
                    className="h-7 px-2"
                    onClick={() => setShowMembers((v) => !v)}
                    aria-label="Toggle members"
                    aria-pressed={showMembers}
                  >
                    <Users className="size-4" />
                  </Button>
                </IconTip>
                {desc.kind === "channel" ? (
                  <>
                    {hasChannels && iAmChannelOp && (
                      <ChannelTopicMenu
                        channel={desc.name}
                        currentTopic={conv.subtitle}
                        send={(line) => {
                          if (activeServerKey)
                            void mpSend({
                              serverKey: activeServerKey,
                              line,
                            }).catch(() => {});
                        }}
                      />
                    )}
                    <IconTip label="Leave channel">
                      <Button
                        className="h-7 px-2"
                        onClick={() => leaveChannel(desc.name)}
                        aria-label="Leave channel"
                      >
                        <LogOut className="size-4" />
                      </Button>
                    </IconTip>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      className="h-7 gap-1.5 px-2"
                      onClick={() => navigate("/battle")}
                    >
                      <Gamepad2 className="size-4" />
                      Go to battle
                    </Button>
                    <Button
                      className="h-7 gap-1.5 px-2"
                      onClick={leaveCurrentBattle}
                    >
                      <LogOut className="size-4" />
                      Leave
                    </Button>
                  </>
                )}
              </TooltipProvider>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {hasChannels
            ? "Select a conversation, or browse channels to join one."
            : "Select a conversation."}
        </div>
      )}

      {(desc?.kind === "channel" || desc?.kind === "battle") && showMembers && (
        <MemberList
          members={conv.members}
          onSelect={(username) => {
            if (activeServerKey)
              setActive({
                serverKey: activeServerKey,
                desc: { kind: "dm", peer: username },
              });
          }}
          colorFor={senderColor}
          presenceFor={presenceFor}
          isIgnored={ignoredNow}
          onToggleIgnore={toggleIgnore}
          noteFor={(u) => getNote(u.userId, u.name)}
          onSetNote={(u, text) => setNote(u.userId, u.name, text)}
          statsSummaryFor={(u) => relationSummary(relationFor(u.name))}
          renderActions={renderMemberActions}
        />
      )}

      {hasChannelsSomewhere && (
        <ChannelBrowser
          serverKey={browserFor ?? focusKey ?? ""}
          open={browserFor != null}
          onClose={() => setBrowserFor(null)}
          onJoined={(name) => {
            if (browserFor)
              setActive({
                serverKey: browserFor,
                desc: { kind: "channel", name },
              });
          }}
        />
      )}
    </main>
  );
}

/** Route entry: gated behind having connected at least once this session. */
export default function ChatRoute() {
  return (
    <NavGate use={useMpRevealed} redirectTo="/lobby">
      <ChatPage />
    </NavGate>
  );
}
