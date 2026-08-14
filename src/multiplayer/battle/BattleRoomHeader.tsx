import { Button } from "@picoframe/frame";
import { Link as LinkIcon, Lock, LogOut, Play } from "lucide-react";
import { useState } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { buildJoinLink } from "@/deeplink/build";
import { copyDeepLink } from "@/deeplink/copyLink";
import type { Battle, MemberStatus } from "../bindings";
import { serverAddressFromKey } from "../store";
import type { SyncState } from "./config";
import { SyncStatusPill } from "./SyncStatusPill";
import { startAnywayWarning } from "./startBlockers";

/**
 * The battle room's top bar: the battle name (replacing the singleplayer
 * "Singleplayer" heading), the sync pill, our own spectate/ready toggles, and the
 * Leave + Start actions. Start asks the autohost to begin (`!start`) — it never
 * launches the engine directly; that happens automatically once the host goes
 * in-game (driven by lobby protocol, not this button).
 *
 * When we host the battle ourselves (`selfHost`), the bar also carries a native
 * Lock toggle, and Leave becomes "Close battle" (leaving tears the battle down
 * for everyone, so it confirms first).
 *
 * Start confirms too when somebody in the room says they cannot play it
 * (issue #1605), because in a room coilbox hosts itself there is no server
 * between that button and the engine.
 */
export function BattleRoomHeader({
  battle,
  myStatus,
  sync,
  blockShort,
  blockReason,
  unsynced,
  hostIngame,
  allReady,
  onToggleReady,
  onToggleSpectate,
  onLeave,
  onStart,
  selfHost,
  locked,
  onToggleLock,
  serverKey,
}: {
  battle: Battle;
  myStatus: MemberStatus | undefined;
  sync: SyncState;
  /** What the local install is missing, in a few words, for the sync pill. */
  blockShort: string | null;
  /** The same thing said in full, for the disabled Start button's tooltip. */
  blockReason: string | null;
  /** Other people in the room whose own sync bit says they cannot play this
   * battle (issue #1605). Start asks before leaving them behind. */
  unsynced: string[];
  hostIngame: boolean;
  allReady: boolean;
  onToggleReady: (ready: boolean) => void;
  onToggleSpectate: (spectator: boolean) => void;
  onLeave: () => void;
  onStart: () => void;
  selfHost: boolean;
  locked: boolean;
  onToggleLock: (locked: boolean) => void;
  /** This room's connection key (issue #498), for a "Copy invite link"
   * action. `null` hides the action rather than building a broken link. */
  serverKey: string | null;
}) {
  const ready = myStatus?.battleStatus.ready ?? false;
  const spectator = myStatus ? !myStatus.battleStatus.mode : false;
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  // Somebody in the room cannot play this battle. Not a reason to refuse the
  // start: with no server there is nobody to kick them with, and a room can
  // want to play without whoever is still downloading. So Start asks first and
  // names them, rather than either going ahead in silence or seizing up.
  const startWarning = startAnywayWarning(unsynced);
  const startDisabled = hostIngame || !allReady || !!blockReason;
  const startButton = (
    <Button
      onClick={startWarning ? undefined : onStart}
      disabled={startDisabled}
      title={
        blockReason
          ? blockReason
          : hostIngame
            ? "The match is already running"
            : !allReady
              ? "All players must be ready first"
              : (startWarning ?? "Ask the autohost to start the match")
      }
    >
      <Play className="size-4 fill-current" />
      {hostIngame ? "In game" : "Start"}
    </Button>
  );

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="break-words text-lg font-semibold">
          {battle.title || `Battle ${battle.id}`}
        </h1>
        {/* "Out of sync" on its own leaves the player hunting. Name the thing,
            but never on a green pill, where the label collapses into a tooltip
            and would read as a problem on a room that has none. */}
        <SyncStatusPill
          state={sync}
          detail={sync === "synced" ? undefined : (blockShort ?? undefined)}
        />
        {serverKey && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="Copy an invite link for this battle"
            title="Copy invite link"
            onClick={() =>
              copyDeepLink(
                buildJoinLink(
                  serverAddressFromKey(serverKey),
                  String(battle.id),
                ),
              )
            }
          >
            <LinkIcon className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <label
          htmlFor="battle-spectate"
          className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
        >
          <Switch
            id="battle-spectate"
            checked={spectator}
            disabled={!myStatus}
            onCheckedChange={(v) => onToggleSpectate(v === true)}
          />
          Spectate
        </label>
        {!spectator && (
          <label
            htmlFor="battle-ready"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Switch
              id="battle-ready"
              checked={ready}
              disabled={!myStatus}
              onCheckedChange={(v) => onToggleReady(v === true)}
            />
            Ready
          </label>
        )}
        {selfHost && (
          <label
            htmlFor="battle-lock"
            className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
          >
            <Switch
              id="battle-lock"
              checked={locked}
              onCheckedChange={(v) => onToggleLock(v === true)}
            />
            <Lock className="size-3.5" />
            Locked
          </label>
        )}
        <ButtonGroup>
          {selfHost ? (
            <Popover open={confirmClose} onOpenChange={setConfirmClose}>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <LogOut className="size-4" />
                  Close battle
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3">
                <p className="text-sm">
                  Close this battle? Everyone will be removed and it will
                  disappear from the battle list.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmClose(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setConfirmClose(false);
                      onLeave();
                    }}
                  >
                    Close battle
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Button variant="outline" onClick={onLeave}>
              <LogOut className="size-4" />
              Leave
            </Button>
          )}
          {startWarning && !startDisabled ? (
            <Popover open={confirmStart} onOpenChange={setConfirmStart}>
              <PopoverTrigger asChild>{startButton}</PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3">
                <p className="text-sm">{startWarning}</p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmStart(false)}
                  >
                    Wait for them
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirmStart(false);
                      onStart();
                    }}
                  >
                    Start anyway
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            startButton
          )}
        </ButtonGroup>
      </div>
    </header>
  );
}
