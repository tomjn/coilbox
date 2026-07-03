import { Button } from "@picoframe/frame";
import { LogOut, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { mpLeaveChannel } from "../bindings";
import { ChannelBrowser } from "../chat/ChannelBrowser";
import { ChatPane } from "../chat/ChatPane";
import { ConversationSidebar } from "../chat/ConversationSidebar";
import { type ConversationDescriptor, convId } from "../chat/conversation";
import { MemberList } from "../chat/MemberList";
import { useConversation } from "../chat/useConversation";
import { useMultiplayer } from "../store";

/**
 * The chat hub: sidebar of channels + DMs, a reusable ChatPane for the active
 * conversation, a toggleable member panel, and the channel-browser drawer.
 * Connection lives on the Lobby page; when disconnected this shows a prompt.
 */
export default function ChatPage() {
  const { mirror, activeKey, markSeen, forgetChannel, openLoginPopover } =
    useMultiplayer();
  const [active, setActive] = useState<ConversationDescriptor | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const conv = useConversation(active);
  const me = mirror.state?.myUsername ?? null;

  // Mark the open conversation read as its message count changes.
  useEffect(() => {
    if (active) markSeen(convId(active), conv.messages.length);
  }, [active, conv.messages.length, markSeen]);

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
          messages={conv.messages}
          currentUser={me}
          onSend={conv.send}
          placeholder={`Message ${conv.title}`}
          headerActions={
            active.kind === "channel" ? (
              <>
                <Button
                  className="h-7 px-2"
                  onClick={() => setShowMembers((v) => !v)}
                  aria-label="Toggle members"
                  aria-pressed={showMembers}
                >
                  <Users className="size-4" />
                </Button>
                <Button
                  className="h-7 px-2"
                  onClick={() => leaveChannel(active.name)}
                  aria-label="Leave channel"
                >
                  <LogOut className="size-4" />
                </Button>
              </>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a conversation, or browse channels to join one.
        </div>
      )}

      {active?.kind === "channel" && showMembers && (
        <MemberList
          members={conv.members}
          onSelect={(username) => setActive({ kind: "dm", peer: username })}
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
