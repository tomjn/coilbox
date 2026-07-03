import { Button } from "@picoframe/frame";
import { LogOut, Play } from "lucide-react";
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
}) {
  const ready = myStatus?.battleStatus.ready ?? false;
  const spectator = myStatus ? !myStatus.battleStatus.mode : false;

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
        <Button variant="secondary" onClick={onLeave}>
          <LogOut className="size-4" />
          Leave
        </Button>
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
