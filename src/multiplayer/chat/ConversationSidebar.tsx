import { Button } from "@picoframe/frame";
import { ChevronRight, Hash, MessageSquare, Plus, Swords } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ChatMsg } from "../bindings";
import { isIgnored, useIgnored } from "../ignore";
import { useMultiplayer } from "../store";
import {
  type ConversationDescriptor,
  convId,
  isBattleChannel,
} from "./conversation";
import { DmPicker } from "./DmPicker";

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
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
  const { mirror, unreadFor, activeKey } = useMultiplayer();
  const [ignored] = useIgnored();
  const state = mirror.state;
  const me = state?.myUsername ?? null;

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
    <nav className="flex w-60 shrink-0 flex-col overflow-auto border-r border-border">
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
            return (
              <li key={id}>
                <button
                  type="button"
                  className={rowClass(id)}
                  onClick={() => onSelect({ kind: "channel", name })}
                >
                  <Hash className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
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

      <Section
        title="Direct messages"
        action={<DmPicker onPick={(peer) => onSelect({ kind: "dm", peer })} />}
      >
        <ul className="flex flex-col gap-0.5 px-2">
          {peers.map((peer) => {
            const id = `dm:${peer}`;
            const msgs = state?.dms[peer] ?? [];
            return (
              <li key={id}>
                <button
                  type="button"
                  className={rowClass(id)}
                  onClick={() => onSelect({ kind: "dm", peer })}
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{peer}</span>
                  <Badge n={unreadBadge(id, msgs)} />
                </button>
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
    </nav>
  );
}
