import { Button } from "@picoframe/frame";
import {
  ChevronDown,
  ChevronRight,
  Hash,
  MessageSquare,
  Plus,
  Swords,
} from "lucide-react";
import { type ReactNode, useState } from "react";
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
  open,
  onToggle,
  action,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1 text-left text-sm font-semibold hover:text-foreground/80"
        >
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          {title}
        </button>
        {action}
      </div>
      {open && children}
    </div>
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
  const { mirror, unreadFor } = useMultiplayer();
  const state = mirror.state;
  // Battle chat lives in a synthetic `__battle__<id>` channel; surface it in its
  // own section rather than among joined channels.
  const channels = state
    ? Object.keys(state.channels)
        .filter((n) => !isBattleChannel(n))
        .sort()
    : [];
  const peers = state ? Object.keys(state.dms ?? {}).sort() : [];
  const currentBattle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  const battleChannel = currentBattle?.channel ?? null;
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const [battleOpen, setBattleOpen] = useState(true);

  const activeId = active ? convId(active) : null;

  function rowClass(id: string): string {
    return `flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
      id === activeId ? "bg-muted font-medium" : "hover:bg-muted"
    }`;
  }

  return (
    <nav className="flex w-60 shrink-0 flex-col overflow-auto border-r border-border">
      {currentBattle && battleChannel && (
        <Section
          title="Battle"
          open={battleOpen}
          onToggle={() => setBattleOpen((v) => !v)}
        >
          <ul className="flex flex-col gap-0.5 px-2">
            {(() => {
              const desc: ConversationDescriptor = {
                kind: "battle",
                id: currentBattle.id,
                channel: battleChannel,
              };
              const id = convId(desc);
              const count =
                state?.channels[battleChannel]?.messages.length ?? 0;
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
                    <Badge n={unreadFor(id, count)} />
                  </button>
                </li>
              );
            })()}
          </ul>
        </Section>
      )}

      <Section
        title="Channels"
        open={channelsOpen}
        onToggle={() => setChannelsOpen((v) => !v)}
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
            const count = state?.channels[name].messages.length ?? 0;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={rowClass(id)}
                  onClick={() => onSelect({ kind: "channel", name })}
                >
                  <Hash className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                  <Badge n={unreadFor(id, count)} />
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
        open={dmsOpen}
        onToggle={() => setDmsOpen((v) => !v)}
        action={<DmPicker onPick={(peer) => onSelect({ kind: "dm", peer })} />}
      >
        <ul className="flex flex-col gap-0.5 px-2">
          {peers.map((peer) => {
            const id = `dm:${peer}`;
            const count = state?.dms[peer].length ?? 0;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={rowClass(id)}
                  onClick={() => onSelect({ kind: "dm", peer })}
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{peer}</span>
                  <Badge n={unreadFor(id, count)} />
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
