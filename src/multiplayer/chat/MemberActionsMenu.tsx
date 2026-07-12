import { Button, Input } from "@picoframe/frame";
import {
  Ban,
  Fingerprint,
  Gavel,
  MoreVertical,
  Network,
  Shield,
  ShieldOff,
  UserMinus,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import * as mod from "../moderation";

/**
 * A per-member `⋮` menu of channel-operator (ChanServ) and server-moderator
 * actions. Only rendered by callers who've already gated on privilege, so the
 * mere presence of the trigger implies access. Actions that need input (mute/ban
 * duration + reason, server kick reason) expand into an inline form inside the
 * same popover — no separate modal (see the project's drawer/popover preference).
 * Every action is a raw wire line handed to `send` (which the caller wires to
 * `mpSend`).
 */
interface MemberActionsMenuProps {
  nick: string;
  /** Bare channel name (no `#`). */
  channel: string;
  /** Show the ChanServ channel-op actions. */
  channelOps: boolean;
  /** Show the server-moderator actions. */
  serverMod: boolean;
  /** Whether `nick` is currently a channel operator (op vs deop label). */
  targetIsOp: boolean;
  send: (line: string) => void;
}

/** The forms that need extra input before firing. */
type FormKind = "chanMute" | "chanBan" | "modKick" | "modBan";

const FORM_META: Record<
  FormKind,
  { title: string; duration: boolean; defaultDuration: string }
> = {
  chanMute: {
    title: "Mute in channel",
    duration: true,
    defaultDuration: "10m",
  },
  chanBan: { title: "Ban from channel", duration: true, defaultDuration: "1d" },
  modKick: { title: "Kick from server", duration: false, defaultDuration: "" },
  modBan: { title: "Ban from server", duration: true, defaultDuration: "7d" },
};

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${
        destructive ? "text-destructive hover:bg-destructive/10" : ""
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function MemberActionsMenu({
  nick,
  channel,
  channelOps,
  serverMod,
  targetIsOp,
  send,
}: MemberActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormKind | null>(null);
  const [duration, setDuration] = useState("");
  const [reason, setReason] = useState("");

  const reset = () => {
    setForm(null);
    setDuration("");
    setReason("");
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const run = (line: string) => {
    send(line);
    close();
  };
  const openForm = (kind: FormKind) => {
    setDuration(FORM_META[kind].defaultDuration);
    setReason("");
    setForm(kind);
  };
  const submitForm = () => {
    if (!form) return;
    const d = duration.trim() || FORM_META[form].defaultDuration;
    const r = reason.trim();
    if (form === "chanMute") run(mod.chanServMute(channel, nick, d, r));
    else if (form === "chanBan") run(mod.chanServBan(channel, nick, d, r));
    else if (form === "modKick") run(mod.modKick(nick, r));
    else if (form === "modBan") run(mod.modBan(nick, d, r));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Moderation actions for ${nick}`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreVertical className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {form ? (
          <form
            className="flex flex-col gap-2 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              submitForm();
            }}
          >
            <p className="px-1 text-sm font-medium">
              {FORM_META[form].title}: {nick}
            </p>
            {FORM_META[form].duration && (
              <span className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
                Duration
                <Input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="e.g. 10m, 2h, 3d"
                  aria-label="Duration"
                  className="h-8"
                  autoFocus
                />
              </span>
            )}
            <span className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
              Reason {form === "modKick" ? "" : "(optional)"}
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="reason"
                aria-label="Reason"
                className="h-8"
                autoFocus={!FORM_META[form].duration}
              />
            </span>
            <div className="flex justify-end gap-2 px-1 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={reset}
              >
                Back
              </Button>
              <Button type="submit" size="sm" className="h-8">
                Confirm
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col">
            {channelOps && (
              <>
                <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Channel
                </p>
                <MenuItem
                  icon={
                    targetIsOp ? (
                      <ShieldOff className="size-4" />
                    ) : (
                      <Shield className="size-4" />
                    )
                  }
                  label={targetIsOp ? "Remove operator" : "Make operator"}
                  onClick={() =>
                    run(mod.chanServSetOp(channel, nick, !targetIsOp))
                  }
                />
                <MenuItem
                  icon={<Volume2 className="size-4" />}
                  label="Unmute"
                  onClick={() => run(mod.chanServUnmute(channel, nick))}
                />
                <MenuItem
                  icon={<VolumeX className="size-4" />}
                  label="Mute…"
                  onClick={() => openForm("chanMute")}
                />
                <MenuItem
                  icon={<UserMinus className="size-4" />}
                  label="Kick from channel"
                  onClick={() => run(mod.chanServKick(channel, nick))}
                  destructive
                />
                <MenuItem
                  icon={<Ban className="size-4" />}
                  label="Ban from channel…"
                  onClick={() => openForm("chanBan")}
                  destructive
                />
                <MenuItem
                  icon={<Ban className="size-4" />}
                  label="Unban from channel"
                  onClick={() => run(mod.chanServUnban(channel, nick))}
                />
              </>
            )}
            {serverMod && (
              <>
                <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Moderator
                </p>
                <MenuItem
                  icon={<Network className="size-4" />}
                  label="Get IP"
                  onClick={() => run(mod.modGetIp(nick))}
                />
                <MenuItem
                  icon={<Fingerprint className="size-4" />}
                  label="Get user ID"
                  onClick={() => run(mod.modGetUserId(nick))}
                />
                <MenuItem
                  icon={<Gavel className="size-4" />}
                  label="Kick from server…"
                  onClick={() => openForm("modKick")}
                  destructive
                />
                <MenuItem
                  icon={<Ban className="size-4" />}
                  label="Ban from server…"
                  onClick={() => openForm("modBan")}
                  destructive
                />
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
