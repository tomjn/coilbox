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
import {
  type ChatMsg,
  mpLeaveBattle,
  mpLeaveChannel,
  mpSend,
} from "../bindings";
import { ChannelBrowser } from "../chat/ChannelBrowser";
import { ChannelTopicMenu } from "../chat/ChannelTopicMenu";
import { ChatPane } from "../chat/ChatPane";
import { ConversationSidebar } from "../chat/ConversationSidebar";
import {
  type ConversationDescriptor,
  convId,
  isBattleChannel,
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
import {
  addFavourite,
  isFavourite,
  removeFavourite,
  useFavourites,
} from "../friends";
import { useIgnoreActions } from "../ignore";
import { canChannelModerate, chanServInfo } from "../moderation";
import { useMpRevealed, useMultiplayer } from "../store";

/**
 * Wrap an icon-only header button with a hover/focus tooltip so its purpose is
 * discoverable without clicking. `label` duplicates the button's `aria-label`;
 * radix renders it from the trigger, so screen readers aren't double-announced.
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
 * Connection lives on the Login page; when disconnected this shows a prompt.
 * Reachable only once the user has connected this session (see the `NavGate`
 * wrapper below); before that, the route redirects to Login.
 */
function ChatPage() {
  const { mirror, activeKey, markSeen, forgetChannel, openLoginPopover } =
    useMultiplayer();
  const [favourites, setFavourites] = useFavourites();
  const navigate = useNavigate();
  const [active, setActive] = useState<ConversationDescriptor | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const conv = useConversation(active);
  const me = mirror.state?.myUsername ?? null;

  // Ignore actions, scoped to the connected account. Toggling hides/shows a user's
  // messages (see `useConversation`) and syncs with the server's ignore list where
  // supported; the member panel and DM header expose it.
  const { has: ignoredNow, toggle: toggleIgnore } = useIgnoreActions(activeKey);

  // In a battle, tint messages by each player's team colour. The `teamColor` int
  // is `0xBBGGRR` (red is the low byte), matching the protocol's team_color_rgb.
  const battle =
    active?.kind === "battle"
      ? mirror.state?.battles[String(active.id)]
      : undefined;
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
  const state = mirror.state;
  const users = state?.users;
  const isBot = useCallback(
    (from: string): boolean => users?.[from]?.status.bot ?? false,
    [users],
  );
  const countryFor = useCallback(
    (from: string): string | undefined => users?.[from]?.country,
    [users],
  );

  // Moderation privileges. The server `access` bit marks a server moderator (may
  // run moderator verbs and ChanServ channel-ops anywhere). For a plain user, the
  // channel-op controls appear only when we're that channel's founder/operator,
  // learned from ChanServ `:info` (auto-queried on open below).
  const iAmServerMod = !!(me && state?.users[me]?.status.access);
  const activeChannel =
    active?.kind === "channel" ? state?.channels[active.name] : undefined;
  const iAmChannelOp = canChannelModerate(activeChannel, me, iAmServerMod);

  // Auto-query ChanServ `:info` once per channel per session when opened, to learn
  // its founder/operators (used to gate the controls). The reply is parsed and
  // suppressed in the protocol reducer, so this adds no visible chat noise; sent as
  // a raw line via mpSend so our own query isn't recorded as a ChanServ DM.
  const infoAsked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeKey || active?.kind !== "channel") return;
    const name = active.name;
    if (infoAsked.current.has(name)) return;
    infoAsked.current.add(name);
    mpSend({ serverKey: activeKey, line: chanServInfo(name) }).catch(() => {});
  }, [activeKey, active]);

  // A per-member `⋮` moderation menu, shown only in a channel where we hold
  // privileges (server mod, or this channel's founder/op) and never on our own row.
  const renderMemberActions = useCallback(
    (username: string) => {
      if (active?.kind !== "channel" || !activeKey) return null;
      if (!iAmChannelOp && !iAmServerMod) return null;
      if (username === me) return null;
      return (
        <MemberActionsMenu
          nick={username}
          channel={active.name}
          channelOps={iAmChannelOp}
          serverMod={iAmServerMod}
          targetIsOp={activeChannel?.operators.includes(username) ?? false}
          send={(line) => {
            void mpSend({ serverKey: activeKey, line }).catch(() => {});
          }}
        />
      );
    },
    [active, activeKey, iAmChannelOp, iAmServerMod, me, activeChannel],
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
    if (active?.kind === "dm") names.push(active.peer);
    return me ? names.filter((n) => n !== me) : names;
  }, [conv.members, active, me]);

  // For a DM header, mark the peer as a bot and show their richer presence.
  const dmPeer = active?.kind === "dm" ? active.peer : null;
  const titleIsBot = dmPeer != null && isBot(dmPeer);
  const titlePresence = dmPeer == null ? undefined : presenceFor(dmPeer);

  // Client-local favourite toggle for the open DM peer (see friends.ts / #185).
  const dmIsFavourite =
    dmPeer != null && activeKey != null
      ? isFavourite(favourites, activeKey, dmPeer)
      : false;
  function toggleDmFavourite() {
    if (dmPeer == null || activeKey == null) return;
    setFavourites(
      isFavourite(favourites, activeKey, dmPeer)
        ? removeFavourite(favourites, activeKey, dmPeer)
        : addFavourite(favourites, activeKey, dmPeer),
    );
  }

  // Mark the open conversation read as its message count changes.
  useEffect(() => {
    if (active) markSeen(convId(active), conv.messages.length);
  }, [active, conv.messages.length, markSeen]);

  // Open on the first joined channel when nothing is selected (initial entry, and
  // once autojoined channels arrive after connect). Battle chat is excluded — it's
  // contextual, not a standing channel. Depends on the first name (a primitive) so
  // it re-fires only when that value changes, not on every render.
  const firstChannel =
    (state
      ? Object.keys(state.channels)
          .filter((n) => !isBattleChannel(n))
          .sort()[0]
      : undefined) ?? null;
  useEffect(() => {
    if (active == null && firstChannel) {
      setActive({ kind: "channel", name: firstChannel });
    }
  }, [active, firstChannel]);

  // Leave a channel: stop the server membership, forget it (no auto-rejoin), and
  // deselect it if it was the open conversation.
  async function leaveChannel(name: string) {
    if (!activeKey) return;
    try {
      await mpLeaveChannel({ serverKey: activeKey, channel: name });
    } catch {
      // Forget it regardless; leaving is best-effort.
    }
    forgetChannel(name);
    setActive((cur) =>
      cur?.kind === "channel" && cur.name === name ? null : cur,
    );
  }

  // Leave the current battle. Battle chat isn't a leavable channel of its own, so
  // the header's leave action drops the whole battle (SAYBATTLE ends with it).
  async function leaveBattle() {
    if (!activeKey) return;
    try {
      await mpLeaveBattle({ serverKey: activeKey });
    } catch {
      // Best-effort; deselect regardless.
    }
    setActive((cur) => (cur?.kind === "battle" ? null : cur));
  }

  if (!activeKey) {
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
        onSelect={setActive}
        onBrowse={() => setBrowserOpen(true)}
      />

      {active ? (
        <ChatPane
          key={convId(active)}
          variant="full"
          title={conv.title}
          subtitle={conv.subtitle}
          titleIsBot={titleIsBot}
          titlePresence={titlePresence}
          messages={conv.messages}
          currentUser={me}
          senderColor={senderColor}
          isBot={isBot}
          countryFor={countryFor}
          isHighlighted={isHighlighted}
          completions={completions}
          onSend={conv.send}
          headerActions={
            active.kind === "dm" ? (
              <TooltipProvider delayDuration={150}>
                <IconTip
                  label={
                    dmIsFavourite
                      ? `Remove ${active.peer} from friends`
                      : `Add ${active.peer} to friends`
                  }
                >
                  <Button
                    variant="secondary"
                    className="h-7 px-2"
                    onClick={toggleDmFavourite}
                    aria-label={
                      dmIsFavourite
                        ? `Remove ${active.peer} from friends`
                        : `Add ${active.peer} to friends`
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
                    ignoredNow(active.peer)
                      ? `Unignore ${active.peer}`
                      : `Ignore ${active.peer}`
                  }
                >
                  <Button
                    variant="secondary"
                    className="h-7 px-2"
                    onClick={() => toggleIgnore(active.peer)}
                    aria-label={
                      ignoredNow(active.peer)
                        ? `Unignore ${active.peer}`
                        : `Ignore ${active.peer}`
                    }
                    aria-pressed={ignoredNow(active.peer)}
                  >
                    {ignoredNow(active.peer) ? (
                      <UserCheck className="size-4" />
                    ) : (
                      <UserX className="size-4" />
                    )}
                  </Button>
                </IconTip>
              </TooltipProvider>
            ) : active.kind === "channel" || active.kind === "battle" ? (
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
                {active.kind === "channel" ? (
                  <>
                    {iAmChannelOp && (
                      <ChannelTopicMenu
                        channel={active.name}
                        currentTopic={conv.subtitle}
                        send={(line) => {
                          if (activeKey)
                            void mpSend({ serverKey: activeKey, line }).catch(
                              () => {},
                            );
                        }}
                      />
                    )}
                    <IconTip label="Leave channel">
                      <Button
                        className="h-7 px-2"
                        onClick={() => leaveChannel(active.name)}
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
                    <Button className="h-7 gap-1.5 px-2" onClick={leaveBattle}>
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
          Select a conversation, or browse channels to join one.
        </div>
      )}

      {(active?.kind === "channel" || active?.kind === "battle") &&
        showMembers && (
          <MemberList
            members={conv.members}
            onSelect={(username) => setActive({ kind: "dm", peer: username })}
            colorFor={senderColor}
            presenceFor={presenceFor}
            isIgnored={ignoredNow}
            onToggleIgnore={toggleIgnore}
            renderActions={renderMemberActions}
          />
        )}

      <ChannelBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onJoined={(name) => setActive({ kind: "channel", name })}
      />
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
