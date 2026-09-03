import { Button } from "@picoframe/frame";
import { Link as LinkIcon, Lock, LogOut, Users } from "lucide-react";
import { memo, useState } from "react";
import { copyDeepLink } from "../../deeplink/copyLink";
import { inviteLink } from "../../direct/invite";
import type { Battle } from "../bindings";
import { BattleRowMapThumb } from "./BattleRowMapThumb";
import { battleRowAction, occupancy } from "./battleFilters";
import { JoinBattlePopover } from "./JoinBattlePopover";

/**
 * One battle in the list: a minimap thumbnail, title (with a lock glyph when
 * passworded/locked), map · game · host, occupancy and spectators, and a join
 * affordance. When actionable, the title area is itself a button that triggers
 * the action (a second path to the action button). A running battle (host
 * in-game) offers "Watch live" instead of "Join": `onJoin` is reused, joining as a
 * spectator to watch the running game. `joined` highlights the battle the user is
 * in. `canJoin` gates the action (ready, not busy, not already in a battle).
 * Passworded battles act via a password popover. Others act via a plain button.
 * `onJoin`'s optional `key` carries the popover password.
 *
 * The minimap renders from the LOCAL unitsync copy only (`enginePath`/`dataDir`
 * come from the selected scan target), in `BattleRowMapThumb`. Maps the user
 * hasn't installed fall through to a blank result there, which doubles as the
 * "you don't have this" signal and becomes a download button in its own right
 * (issue #2373), so it sits outside the title's join button rather than inside
 * it: a button cannot nest inside another button.
 */
function BattleRowInner({
  battle,
  joined,
  canJoin,
  inProgress = false,
  onJoin,
  onLeave,
  enginePath,
  dataDir,
  serverAddress,
  directRoom = false,
}: {
  battle: Battle;
  joined: boolean;
  canJoin: boolean;
  /** The battle is already running (host in-game): the row offers "Watch live",
   * joining as a spectator, rather than "Join". */
  inProgress?: boolean;
  onJoin: (b: Battle, key?: string) => void;
  onLeave: () => void;
  enginePath?: string;
  dataDir?: string;
  /** This connection's `host:port` (issue #498), for a "Copy invite link"
   * action. `undefined` hides the action rather than building a broken link. */
  serverAddress?: string;
  /** Whether that connection is a room somebody is hosting rather than a
   * server, which is passed on as an address to dial rather than as a battle on
   * a server nobody else is on (issue #1617). */
  directRoom?: boolean;
}) {
  const players = occupancy(battle);
  const restricted = battle.passworded || battle.locked;
  // Join an open battle, or watch a running one live as a spectator. The joined
  // row shows Leave instead and ignores this action.
  const action = battleRowAction(battle, { canJoin, inProgress });
  const disabled = joined || action.disabled;
  const [pwOpen, setPwOpen] = useState(false);
  // Built rather than assumed: a connection that has no link worth giving out
  // shows no button, instead of one that copies something nobody can act on.
  const invite = inviteLink(serverAddress, directRoom, String(battle.id));

  // Clicking the title is a second path to the same action as the button:
  // passworded battles open the password popover, others act directly (join, or
  // watch a running battle). Only reachable when actionable (the region is a plain
  // div otherwise).
  const activate = () => {
    if (battle.passworded) setPwOpen(true);
    else onJoin(battle);
  };

  const details = (
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-2 truncate text-sm font-medium">
        {restricted && (
          <Lock
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-label={battle.passworded ? "Passworded" : "Locked"}
          />
        )}
        <span className="truncate transition-colors group-hover/row:text-primary">
          {battle.title}
        </span>
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {battle.map} · {battle.modname}
        {/* Tachyon's lobby list names no founder, so there is no host to name. */}
        {battle.host && ` · host ${battle.host}`}
      </p>
    </div>
  );

  return (
    <li
      className={`flex items-center gap-4 rounded-md border p-3 ${
        joined ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <BattleRowMapThumb
        battle={battle}
        enginePath={enginePath}
        dataDir={dataDir}
      />
      {disabled ? (
        <div className="flex min-w-0 flex-1 items-center">{details}</div>
      ) : (
        <button
          type="button"
          onClick={activate}
          aria-label={`${action.label} ${battle.title}`}
          className="group/row flex min-w-0 flex-1 cursor-pointer items-center rounded-md text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {details}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        <span>
          {players}/{battle.maxPlayers}
        </span>
        {battle.spectatorCount > 0 && (
          <span className="ml-1">+{battle.spectatorCount} spec</span>
        )}
      </div>
      {invite && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`Copy an invite link for ${battle.title}`}
          title="Copy invite link"
          onClick={() => copyDeepLink(invite)}
        >
          <LinkIcon className="size-4" />
        </Button>
      )}
      {joined ? (
        <Button
          className="h-8 shrink-0 gap-1 px-3"
          onClick={onLeave}
          aria-label="Leave battle"
        >
          <LogOut className="size-4" />
          Leave
        </Button>
      ) : battle.passworded ? (
        <JoinBattlePopover
          title={battle.title}
          disabled={disabled}
          onSubmit={(key) => onJoin(battle, key)}
          open={pwOpen}
          onOpenChange={setPwOpen}
        />
      ) : (
        <Button
          className="h-8 shrink-0 px-3"
          disabled={disabled}
          onClick={() => onJoin(battle)}
        >
          {action.label}
        </Button>
      )}
    </li>
  );
}

/**
 * Memoised, because the store replaces the whole state mirror on every server
 * event and a busy server sends them constantly. Without this, one player
 * changing status re-renders every row on screen. The battle objects come from
 * that mirror, so a row only re-renders when its own battle is replaced.
 *
 * This only holds while the callbacks and the strings around them keep their
 * identity between renders, which is what `BattleList`'s memoised `rowProps` and
 * the page's `useCallback`s are for.
 */
export const BattleRow = memo(BattleRowInner);
