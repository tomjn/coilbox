import { Button, cn } from "@picoframe/frame";
import {
  Bot,
  Check,
  ChevronRight,
  Hash,
  History,
  MessageSquare,
  Plus,
  Star,
  Swords,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  type ChatMsg,
  mpAcceptFriendRequest,
  mpDeclineFriendRequest,
  mpFriendRequest,
  mpUnfriend,
} from "../bindings";
import {
  addFavourite,
  favouritesFor,
  isFavourite,
  removeFavourite,
  useFavourites,
} from "../friends";
import { isIgnored, useIgnored } from "../ignore";
import { useMultiplayer } from "../store";
import {
  type ConversationDescriptor,
  convId,
  isBattleChannel,
} from "./conversation";
import { DmPicker } from "./DmPicker";
import { PRESENCE_META, userPresence } from "./presence";

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * A star toggle that marks a DM peer as a client-local favourite. Filled when
 * favourited. It is absolutely positioned over the right of its row rather than
 * nested inside the row's button (nesting buttons is invalid), so its wrapping
 * `<li>` must be `relative`; rows carry right padding so it can't overlap text.
 * The 24px hit area (glyph stays small) meets the WCAG target size, and an
 * unfavourited star only appears on row hover / keyboard focus to avoid clutter.
 */
function FavStar({
  name,
  active,
  onToggle,
}: {
  name: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={
        active ? `Remove ${name} from friends` : `Add ${name} to friends`
      }
      aria-pressed={active}
      className={cn(
        "absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <Star className={cn("size-4", active && "fill-current text-amber-400")} />
    </button>
  );
}

/**
 * A hover-revealed row action sitting just left of the {@link FavStar} (so the two
 * don't overlap; friend rows carry extra right padding for both). Used to send a
 * server friend request (local-only favourites) or to unfriend (server friends).
 */
function FriendAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="absolute right-8 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      {icon}
    </button>
  );
}

/** A collapsible sidebar section with a chevron toggle and an optional header action. */
function Section({
  title,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <div className="flex items-center gap-1 px-3 py-2">
        <CollapsibleTrigger className="group flex flex-1 items-center gap-1 text-left text-sm font-semibold hover:text-foreground/80">
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          {title}
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The left rail: collapsible Channels and Direct messages sections with unread
 * badges. New DMs are started either from the "+" picker here (search online
 * users) or by selecting a user from a channel's member list.
 */
export function ConversationSidebar({
  active,
  onSelect,
  onBrowse,
}: {
  active: ConversationDescriptor | null;
  onSelect: (d: ConversationDescriptor) => void;
  onBrowse: () => void;
}) {
  const { mirror, unreadFor, activeKey, protocol } = useMultiplayer();
  // Tachyon can only address a player, a party or a lobby, so there are no named
  // channels to list or browse. Upstream means this, so the section is replaced by
  // a standing note rather than left empty. See `docs/tachyon-protocol.md`.
  const hasChannels = protocol !== "tachyon";
  const navigate = useNavigate();
  const [ignored] = useIgnored();
  const [favourites, setFavourites] = useFavourites();
  const state = mirror.state;
  const me = state?.myUsername ?? null;

  // Client-local favourites for the connected server. Starring a peer here (or
  // from the DM header) toggles it; offline favourites still show so you can jump
  // to a past conversation. Purely local — no friend protocol behind it (#187).
  const favPeers = activeKey ? favouritesFor(favourites, activeKey) : [];
  function toggleFavourite(name: string) {
    if (!activeKey) return;
    setFavourites(
      isFavourite(favourites, activeKey, name)
        ? removeFavourite(favourites, activeKey, name)
        : addFavourite(favourites, activeKey, name),
    );
  }

  // Server-side friends (#187) merged with the local favourites above: the Friends
  // section shows their UNION, with server friends distinguished by a check badge
  // and offering unfriend, while local-only favourites offer "add friend" (send a
  // request). Incoming requests get Accept/Decline. All friend commands no-op on
  // servers without support, so failures are swallowed and never disrupt the UI.
  const serverFriends = state?.friends ?? [];
  const serverFriendSet = new Set(serverFriends);
  const friendRequests = state?.friendRequests ?? [];
  const friendNames = [...new Set([...favPeers, ...serverFriends])].sort();
  function sendFriendRequest(name: string) {
    if (activeKey)
      mpFriendRequest({ serverKey: activeKey, username: name }).catch(() => {});
  }
  function unfriend(name: string) {
    if (activeKey)
      mpUnfriend({ serverKey: activeKey, username: name }).catch(() => {});
  }
  function acceptRequest(name: string) {
    if (activeKey)
      mpAcceptFriendRequest({ serverKey: activeKey, username: name }).catch(
        () => {},
      );
  }
  function declineRequest(name: string) {
    if (activeKey)
      mpDeclineFriendRequest({ serverKey: activeKey, username: name }).catch(
        () => {},
      );
  }

  // Unread count worth badging: messages arrived since last seen, minus the
  // user's own lines. That excludes both messages they sent and the server's
  // echo of their own JOIN (a Join msg with `from === me`), neither of which is
  // a "new message" to them. Seen index is recovered from `unreadFor` so this
  // reuses the store's read bookkeeping rather than duplicating it.
  function unreadBadge(id: string, msgs: ChatMsg[]): number {
    const total = msgs.length;
    const seen = total - unreadFor(id, total);
    let n = 0;
    for (let i = seen; i < total; i++) {
      if (msgs[i].from !== me) n++;
    }
    return n;
  }
  // Battle chat lives in a synthetic `__battle__<id>` channel; surface it in its
  // own section rather than among joined channels.
  const channels = state
    ? Object.keys(state.channels)
        .filter((n) => !isBattleChannel(n))
        .sort()
    : [];
  // Ignored peers are dropped from the DM list so they don't clutter it; their
  // messages are already hidden in the conversation.
  const peers = state
    ? Object.keys(state.dms ?? {})
        .filter((p) => !activeKey || !isIgnored(ignored, activeKey, p))
        .sort()
    : [];
  const currentBattle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  const battleChannel = currentBattle?.channel ?? null;

  const activeId = active ? convId(active) : null;

  function rowClass(id: string): string {
    return `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
      id === activeId ? "bg-muted font-medium" : "hover:bg-muted"
    }`;
  }

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {currentBattle && battleChannel && (
          <Section title="Battle">
            <ul className="flex flex-col gap-0.5 px-2">
              {(() => {
                const desc: ConversationDescriptor = {
                  kind: "battle",
                  id: currentBattle.id,
                  channel: battleChannel,
                };
                const id = convId(desc);
                const msgs = state?.channels[battleChannel]?.messages ?? [];
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={rowClass(id)}
                      onClick={() => onSelect(desc)}
                    >
                      <Swords className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {currentBattle.title || `Battle ${currentBattle.id}`}
                      </span>
                      <Badge n={unreadBadge(id, msgs)} />
                    </button>
                  </li>
                );
              })()}
            </ul>
          </Section>
        )}

        {!hasChannels && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            This server has direct messages and battle chat, but no channels.
          </p>
        )}

        {hasChannels && (
          <Section
            title="Channels"
            action={
              <Button
                variant="secondary"
                onClick={onBrowse}
                aria-label="Browse channels"
                className="h-7 px-2"
              >
                <Plus className="size-4" />
              </Button>
            }
          >
            <ul className="flex flex-col gap-0.5 px-2">
              {channels.map((name) => {
                const id = `channel:${name}`;
                const msgs = state?.channels[name].messages ?? [];
                const topic = state?.channels[name].topic;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={rowClass(id)}
                      onClick={() => onSelect({ kind: "channel", name })}
                    >
                      <Hash className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{name}</span>
                        {topic && (
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            {topic}
                          </span>
                        )}
                      </span>
                      <Badge n={unreadBadge(id, msgs)} />
                    </button>
                  </li>
                );
              })}
              {channels.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  No channels joined. Browse to join one.
                </li>
              )}
            </ul>
          </Section>
        )}

        {(friendNames.length > 0 || friendRequests.length > 0) && (
          <Section title="Friends">
            {friendRequests.length > 0 && (
              <ul className="flex flex-col gap-1 px-2 pb-1">
                {friendRequests.map((name) => (
                  <li
                    key={`req:${name}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  >
                    <UserPlus className="size-4 shrink-0 text-muted-foreground" />
                    <span
                      className="truncate"
                      title={`${name} wants to be friends`}
                    >
                      {name}
                    </span>
                    <div className="ml-auto flex gap-1">
                      <Button
                        variant="secondary"
                        onClick={() => acceptRequest(name)}
                        aria-label={`Accept friend request from ${name}`}
                        className="h-6 px-2"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => declineRequest(name)}
                        aria-label={`Decline friend request from ${name}`}
                        className="h-6 px-2"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ul className="flex flex-col gap-0.5 px-2">
              {friendNames.map((peer) => {
                const id = `dm:${peer}`;
                const msgs = state?.dms?.[peer] ?? [];
                const presence = state ? userPresence(state, peer) : "offline";
                const meta = PRESENCE_META[presence];
                const isServerFriend = serverFriendSet.has(peer);
                return (
                  <li key={id} className="group relative">
                    <button
                      type="button"
                      className={cn(rowClass(id), "pr-16")}
                      onClick={() => onSelect({ kind: "dm", peer })}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          meta.dotClass,
                        )}
                        title={meta.label}
                      />
                      <span
                        className={cn(
                          "truncate",
                          presence === "offline" && "text-muted-foreground",
                        )}
                      >
                        {peer}
                      </span>
                      {isServerFriend && (
                        <UserCheck
                          className="size-3.5 shrink-0 text-sky-500"
                          aria-label="Server friend"
                        />
                      )}
                      <Badge n={unreadBadge(id, msgs)} />
                    </button>
                    {isServerFriend ? (
                      <FriendAction
                        icon={<UserX className="size-4" />}
                        label={`Remove ${peer} from friends`}
                        onClick={() => unfriend(peer)}
                      />
                    ) : (
                      <FriendAction
                        icon={<UserPlus className="size-4" />}
                        label={`Send ${peer} a friend request`}
                        onClick={() => sendFriendRequest(peer)}
                      />
                    )}
                    <FavStar
                      name={peer}
                      active={
                        activeKey
                          ? isFavourite(favourites, activeKey, peer)
                          : false
                      }
                      onToggle={() => toggleFavourite(peer)}
                    />
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <Section
          title="Direct messages"
          action={
            <DmPicker onPick={(peer) => onSelect({ kind: "dm", peer })} />
          }
        >
          <ul className="flex flex-col gap-0.5 px-2">
            {peers.map((peer) => {
              const id = `dm:${peer}`;
              const msgs = state?.dms[peer] ?? [];
              // Autohosts (SPADS bots) are DM'd to configure them; a bot glyph
              // marks them apart from human conversations at a glance.
              const bot = state?.users[peer]?.status.bot ?? false;
              return (
                <li key={id} className="group relative">
                  <button
                    type="button"
                    className={cn(rowClass(id), "pr-9")}
                    onClick={() => onSelect({ kind: "dm", peer })}
                  >
                    {bot ? (
                      <Bot
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label="Bot"
                      />
                    ) : (
                      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{peer}</span>
                    <Badge n={unreadBadge(id, msgs)} />
                  </button>
                  <FavStar
                    name={peer}
                    active={
                      activeKey
                        ? isFavourite(favourites, activeKey, peer)
                        : false
                    }
                    onToggle={() => toggleFavourite(peer)}
                  />
                </li>
              );
            })}
            {peers.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                No direct messages. Use + to message an online user.
              </li>
            )}
          </ul>
        </Section>
      </div>

      <div className="border-t border-border p-2">
        <Button
          variant="secondary"
          className="h-8 w-full justify-start gap-2"
          onClick={() => navigate("/chatlogs")}
        >
          <History className="size-4" />
          Chat logs
        </Button>
      </div>
    </nav>
  );
}
