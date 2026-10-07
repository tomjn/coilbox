import { Button, Input } from "@picoframe/frame";
import {
  Ban,
  Fingerprint,
  Footprints,
  Gavel,
  MoreVertical,
  Network,
  Search,
  Shield,
  ShieldOff,
  StickyNote,
  UserCheck,
  UserMinus,
  UserX,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DaysField } from "../DaysField";
import * as mod from "../moderation";
import { NoteForm } from "../NoteButton";

/**
 * A per-member `⋮` menu. Everybody gets the personal actions the caller hands
 * in, a private note and ignore (issue #3695). Under those sit the
 * channel-operator (ChanServ) and server-moderator actions, which the caller
 * gates on privilege with `channelOps` and `serverMod`. Actions that need input
 * (the note, mute/ban duration + reason, server kick reason) expand into an
 * inline form inside the same popover — no separate modal (see the project's
 * drawer/popover preference).
 * Every action is a raw wire line handed to `send` (which the caller wires to
 * `mpSend`), except "Look up in Server admin" (issue #2777), which calls
 * `onLookUp` to open that page's player lookup section for `nick` instead.
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
  /** Open the Server admin page's player lookup section for `nick`
   * (issue #2777). Only offered alongside the other moderator actions. */
  onLookUp: () => void;
  /** The private note about `nick` ("" for none) and how to save it. A saved
   * note marks the trigger, so it can be noticed without opening the menu. */
  note?: {
    text: string;
    onSave: (text: string) => void;
    statsSummary?: string | null;
  };
  /** Whether `nick` is ignored, and the toggle. */
  ignore?: { ignored: boolean; onToggle: () => void };
  /** Whether `nick` is being followed, and the toggle (issue #3696). Only
   * handed in for a friend, since only a friend can be followed. */
  follow?: { following: boolean; onToggle: () => void };
}

/** The forms that need extra input before firing. */
type FormKind = "chanMute" | "chanBan" | "modKick" | "modBan";

const FORM_META: Record<
  FormKind,
  {
    title: string;
    duration: boolean;
    defaultDuration: string;
    durationLabel: string;
    durationPlaceholder: string;
  }
> = {
  chanMute: {
    title: "Mute in channel",
    duration: true,
    defaultDuration: "10m",
    durationLabel: "Duration",
    durationPlaceholder: "e.g. 10m, 2h, 3d",
  },
  chanBan: {
    title: "Ban from channel",
    duration: true,
    defaultDuration: "1d",
    durationLabel: "Duration",
    durationPlaceholder: "e.g. 10m, 2h, 3d",
  },
  modKick: {
    title: "Kick from server",
    duration: false,
    defaultDuration: "",
    durationLabel: "Duration",
    durationPlaceholder: "",
  },
  modBan: {
    // Server-wide BAN takes a plain number of days (decimals allowed), not a
    // ChanServ-style span. See src/multiplayer/moderation.ts:modBan. The days
    // input itself is `DaysField`, shared with the Server admin bans form
    // (issue #2778) rather than the generic duration `Input` below.
    title: "Ban from server",
    duration: true,
    defaultDuration: "1",
    durationLabel: "Days",
    durationPlaceholder: "e.g. 0.5, 1, 7",
  },
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
  onLookUp,
  note,
  ignore,
  follow,
}: MemberActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormKind | null>(null);
  const [noting, setNoting] = useState(false);
  const hasNote = (note?.text.trim().length ?? 0) > 0;
  const [duration, setDuration] = useState("");
  const [reason, setReason] = useState("");

  const reset = () => {
    setForm(null);
    setNoting(false);
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
  const lookUp = () => {
    close();
    onLookUp();
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
    // uberserver's BAN has no default reason and refuses the command
    // without one, so the form must not send it empty.
    if (form === "modBan" && !r) return;
    if (form === "chanMute") run(mod.chanServMute(channel, nick, d, r));
    else if (form === "chanBan") run(mod.chanServBan(channel, nick, d, r));
    else if (form === "modKick") run(mod.modKick(nick, r));
    else if (form === "modBan") run(mod.modBan(nick, d, r));
  };
  const reasonMissing = form === "modBan" && reason.trim() === "";

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
          aria-label={
            hasNote
              ? `Actions for ${nick}, who has a note`
              : `Actions for ${nick}`
          }
          title={hasNote ? note?.text : undefined}
          className="relative inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreVertical className="size-4" />
          {hasNote && (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-2 rounded-full bg-amber-500"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={noting ? "w-64 p-2" : "w-52 p-1"}>
        {noting && note ? (
          <NoteForm
            name={nick}
            note={note.text}
            statsSummary={note.statsSummary}
            onSave={note.onSave}
            onDone={close}
          />
        ) : form ? (
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
            {form === "modBan" ? (
              <DaysField
                value={duration}
                onChange={setDuration}
                className="px-1"
                autoFocus
              />
            ) : (
              FORM_META[form].duration && (
                <span className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
                  {FORM_META[form].durationLabel}
                  <Input
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder={FORM_META[form].durationPlaceholder}
                    aria-label={FORM_META[form].durationLabel}
                    className="h-8"
                    autoFocus
                  />
                </span>
              )
            )}
            <span className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
              Reason{" "}
              {form === "modKick" || form === "modBan" ? "" : "(optional)"}
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
              <Button
                type="submit"
                size="sm"
                className="h-8"
                disabled={reasonMissing}
              >
                Confirm
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col">
            {follow && (
              <MenuItem
                icon={<Footprints className="size-4" />}
                label={follow.following ? "Unfollow" : "Follow"}
                onClick={() => {
                  follow.onToggle();
                  close();
                }}
              />
            )}
            {note && (
              <MenuItem
                icon={
                  <StickyNote
                    className="size-4"
                    fill={hasNote ? "currentColor" : "none"}
                  />
                }
                label={hasNote ? "Edit private note" : "Add private note"}
                onClick={() => setNoting(true)}
              />
            )}
            {ignore && (
              <MenuItem
                icon={
                  ignore.ignored ? (
                    <UserCheck className="size-4" />
                  ) : (
                    <UserX className="size-4" />
                  )
                }
                label={ignore.ignored ? "Unignore" : "Ignore"}
                onClick={() => {
                  ignore.onToggle();
                  close();
                }}
              />
            )}
            {(follow || note || ignore) && (channelOps || serverMod) && (
              <hr className="my-1 border-border" />
            )}
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
                  icon={<Search className="size-4" />}
                  label="Look up in Server admin"
                  onClick={lookUp}
                />
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
