import { Button } from "@picoframe/frame";
import { Lock, Users } from "lucide-react";
import type { Battle } from "../bindings";
import { occupancy } from "./battleList";
import { JoinBattlePopover } from "./JoinBattlePopover";

/**
 * One battle in the list: title (with a lock glyph when passworded/locked), map ·
 * game · host, occupancy and spectators, and a join affordance. `joined` highlights
 * the battle the user is in; `canJoin` gates joining (ready, not busy, not already
 * in a battle). Passworded battles join via a password popover; others via a plain
 * button. `onJoin`'s optional `key` carries the popover password.
 */
export function BattleRow({
  battle,
  joined,
  canJoin,
  onJoin,
}: {
  battle: Battle;
  joined: boolean;
  canJoin: boolean;
  onJoin: (b: Battle, key?: string) => void;
}) {
  const players = occupancy(battle);
  const full = players >= battle.maxPlayers;
  const restricted = battle.passworded || battle.locked;
  const disabled = joined || !canJoin || full;
  return (
    <li
      className={`flex items-center gap-4 rounded-md border p-3 ${
        joined ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {restricted && (
            <Lock
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label={battle.passworded ? "Passworded" : "Locked"}
            />
          )}
          <span className="truncate">{battle.title}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {battle.map} · {battle.modname} · host {battle.host}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        <span>
          {players}/{battle.maxPlayers}
        </span>
        {battle.spectatorCount > 0 && (
          <span className="ml-1">+{battle.spectatorCount} spec</span>
        )}
      </div>
      {joined ? (
        <Button className="h-8 shrink-0 px-3" disabled>
          Joined
        </Button>
      ) : battle.passworded ? (
        <JoinBattlePopover
          title={battle.title}
          disabled={disabled}
          onSubmit={(key) => onJoin(battle, key)}
        />
      ) : (
        <Button
          className="h-8 shrink-0 px-3"
          disabled={disabled}
          onClick={() => onJoin(battle)}
        >
          Join
        </Button>
      )}
    </li>
  );
}
