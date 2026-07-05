import { Button } from "@picoframe/frame";
import { Lock, LogOut, Play } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { Battle, MemberStatus } from "../bindings";
import type { SyncState } from "./config";
import { SyncStatusPill } from "./SyncStatusPill";

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
 */
export function BattleRoomHeader({
  battle,
  myStatus,
  sync,
  hostIngame,
  allReady,
  onToggleReady,
  onToggleSpectate,
  onLeave,
  onStart,
  selfHost,
  locked,
  onToggleLock,
}: {
  battle: Battle;
  myStatus: MemberStatus | undefined;
  sync: SyncState;
  hostIngame: boolean;
  allReady: boolean;
  onToggleReady: (ready: boolean) => void;
  onToggleSpectate: (spectator: boolean) => void;
  onLeave: () => void;
  onStart: () => void;
  selfHost: boolean;
  locked: boolean;
  onToggleLock: (locked: boolean) => void;
}) {
  const ready = myStatus?.battleStatus.ready ?? false;
  const spectator = myStatus ? !myStatus.battleStatus.mode : false;
  const [confirmClose, setConfirmClose] = useState(false);

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-lg font-semibold">
          {battle.title || `Battle ${battle.id}`}
        </h1>
        <SyncStatusPill state={sync} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
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
        {selfHost ? (
          <Popover open={confirmClose} onOpenChange={setConfirmClose}>
            <PopoverTrigger asChild>
              <Button variant="secondary">
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
          <Button variant="secondary" onClick={onLeave}>
            <LogOut className="size-4" />
            Leave
          </Button>
        )}
        <Button
          onClick={onStart}
          disabled={hostIngame || !allReady}
          title={
            hostIngame
              ? "The match is already running"
              : allReady
                ? "Ask the autohost to start the match"
                : "All players must be ready first"
          }
        >
          <Play className="size-4" />
          {hostIngame ? "In game" : "Start"}
        </Button>
      </div>
    </header>
  );
}
