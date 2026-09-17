import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AdminShape } from "../bindings";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";
import { ToolGroup, ToolHeader } from "./ToolHeader";

type Kind = "broadcast" | "broadcastex" | "adminBroadcast";

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "broadcast", label: "Broadcast" },
  { value: "broadcastex", label: "Broadcast (dialog)" },
  { value: "adminBroadcast", label: "Admin broadcast" },
];

/** How each kind looks to the player it reaches, read out beside the picker
 * (issue #2788). */
const KIND_DESCRIPTION: Record<Kind, string> = {
  broadcast: "Every player sees it as a Staff announcement toast.",
  broadcastex: "Every player sees it as a dialog box they must dismiss.",
  adminBroadcast:
    "Only online admins, including you, see it as a server message.",
};

const KIND_COMMAND: Record<Kind, string> = {
  broadcast: "BROADCAST",
  broadcastex: "BROADCASTEX",
  adminBroadcast: "ADMINBROADCAST",
};

const KIND_SHAPE: Record<Kind, AdminShape> = {
  broadcast: "noReply",
  broadcastex: "noReply",
  adminBroadcast: "adminBroadcast",
};

/** `BROADCAST` and `BROADCASTEX` reach every player on the server, so both
 * are confirmed first. `ADMINBROADCAST` reaches only online admins, so it
 * sends straight away. */
function needsConfirm(kind: Kind): boolean {
  return kind !== "adminBroadcast";
}

/** Where the last send got to, worded for the kind it was sent as (issue
 * #2788). `BROADCAST` and `BROADCASTEX` never reply, so silence is the
 * answer and the tool says the message was sent rather than waiting to say
 * it arrived. `ADMINBROADCAST` answers with its own echo, shown as
 * confirmation rather than a generic "Done." */
function AnnouncementStatus({
  kind,
  request,
}: {
  kind: Kind;
  request: ReturnType<typeof useAdminRequest>;
}) {
  return (
    <AdminRequestStatus
      state={request.state}
      unanswered={
        kind === "adminBroadcast"
          ? "The server did not answer."
          : "Sent. Nothing replies to confirm a player saw it."
      }
    >
      {(reply) =>
        reply.shape === "adminBroadcast" ? (
          <span>Sent. The server echoed back: {reply.message}</span>
        ) : (
          <span>Sent.</span>
        )
      }
    </AdminRequestStatus>
  );
}

/**
 * The Announcements tool of the Server admin page (issue #2788): uberserver's
 * three ways to message everyone at once, all in `restricted['admin']`, so
 * the tool is admin-only.
 *
 * `BROADCAST` and `BROADCASTEX` reach every player and are never answered,
 * not even to the sender (PR 2891 already shows `BROADCAST` as a "Staff
 * announcement" toast, and `BROADCASTEX` arrives as `SERVERMSGBOX`, which
 * coilbox shows as a dialog), so both are confirmed in a popover before
 * sending, and `AdminRequestStatus`'s "unanswered" wording says the message
 * was sent rather than waiting to say it arrived.
 *
 * `ADMINBROADCAST` answers the sender directly with its own `SERVERMSG`
 * (`AdminShape.adminBroadcast`, claimed by its own reply shape rather than
 * `noReply` so the echo cannot sit the queue open or leak out as a generic
 * toast), so it needs no confirm step, and the tool shows the echoed line
 * as its own answer.
 */
export function AnnouncementsSection({ serverKey }: { serverKey: string }) {
  const [kind, setKind] = useState<Kind>("broadcast");
  const [sentKind, setSentKind] = useState<Kind>("broadcast");
  const [message, setMessage] = useState("");
  const request = useAdminRequest(serverKey);
  const canSubmit = message.trim() !== "";

  const send = () => {
    if (!canSubmit) return;
    setSentKind(kind);
    void request.send(KIND_COMMAND[kind], [message.trim()], KIND_SHAPE[kind]);
  };

  return (
    <section className="flex flex-col gap-6">
      <ToolHeader
        title="Announcements"
        description="Message every player, or every online admin, at once."
      />
      <ToolGroup title="Announcement">
        <span className="flex max-w-xs flex-col gap-1 text-xs text-muted-foreground">
          Kind
          <OptionSelect
            value={kind}
            onValueChange={(value) => setKind(value as Kind)}
            options={KIND_OPTIONS}
            ariaLabel="Announcement kind"
            size="sm"
          />
        </span>
        <p className="text-xs text-muted-foreground">
          {KIND_DESCRIPTION[kind]}
        </p>
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          Message
          <Input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            aria-label="Announcement message"
            className="h-8"
          />
        </span>
        {needsConfirm(kind) ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-8 self-start"
                disabled={!canSubmit}
              >
                Send…
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-80 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">Send to every player?</h3>
                <p className="text-xs text-muted-foreground">
                  uberserver relays it immediately, with no way to unsend it.
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-8"
                  disabled={!canSubmit || request.state.status === "sending"}
                  onClick={send}
                >
                  Send
                </Button>
              </div>
              <AnnouncementStatus kind={sentKind} request={request} />
            </PopoverContent>
          </Popover>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 self-start"
              disabled={!canSubmit || request.state.status === "sending"}
              onClick={send}
            >
              Send
            </Button>
            <AnnouncementStatus kind={sentKind} request={request} />
          </>
        )}
      </ToolGroup>
    </section>
  );
}
