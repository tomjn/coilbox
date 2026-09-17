import { Button } from "@picoframe/frame";
import { Link as LinkIcon, Lock, LogOut, Play } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyDeepLink } from "@/deeplink/copyLink";
import {
  battleRouteLabel,
  joinedBattleRouteLabel,
  useChosenHostingRoute,
} from "@/direct/hostingRoute";
import { inviteLink } from "@/direct/invite";
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
 * Lock toggle, and Leave becomes "Close" (leaving tears the battle down
 * for everyone, so it confirms first). In a LAN room of our own it takes the
 * room down too, and says so, because the room and the battle in it were started
 * together and are read as one thing (issue #2057).
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
  closesRoom,
  locked,
  onToggleLock,
  serverKey,
  directRoom,
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
  /** Whether closing this battle takes down the LAN room it is in as well, which
   * is what the confirmation has to promise (issue #2057). */
  closesRoom: boolean;
  locked: boolean;
  onToggleLock: (locked: boolean) => void;
  /** This room's connection key (issue #498), for a "Copy invite link"
   * action. `null` hides the action rather than building a broken link. */
  serverKey: string | null;
  /** Whether that connection is a room somebody is hosting rather than a
   * server, which decides what kind of link there is to give (issue #1617). */
  directRoom: boolean;
}) {
  const ready = myStatus?.battleStatus.ready ?? false;
  // The route the battle hosted on this room's connection took. Read here
  // rather than handed down from the page, because the check that it belongs to
  // the battle on screen is right below and the two should not be able to drift
  // apart.
  const hostingRoute = useChosenHostingRoute(serverKey);
  const spectator = myStatus ? !myStatus.battleStatus.mode : false;
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  // Somebody in the room cannot play this battle. Not a reason to refuse the
  // start: with no server there is nobody to kick them with, and a room can
  // want to play without whoever is still downloading. So Start asks first and
  // names them, rather than either going ahead in silence or seizing up.
  const startWarning = startAnywayWarning(unsynced);
  // A room and a server are passed on differently, and a connection with nothing
  // worth handing out shows no button at all.
  const invite = serverKey
    ? inviteLink(serverAddressFromKey(serverKey), directRoom, String(battle.id))
    : null;
  // How this battle is connected, for the host who wants to know why the pings
  // in it look the way they do (issue #2022).
  //
  // `selfHost` is doing the work of "this record is about the battle you are
  // looking at". The record holds a route and no battle id, and it outlives the
  // battle it describes, so something has to vouch for it. `selfHost` is true
  // only while this client is the founder that runs the battle now on screen,
  // and this header is rendered only once there is a battle at all. Every way
  // of becoming that founder goes through one of the two hosting forms, and
  // both drop the record before they try and set it once the battle is open, so
  // the route a `selfHost` reader sees was recorded for this battle and no
  // earlier one. Founding a Zero-K room is not that, because the server runs
  // the match rather than the founder, so a route left behind by a battle on
  // another server cannot surface in a room that never recorded one.
  //
  // The record is kept per connection, and this room's `serverKey` is the
  // connection its battle is on (issue #2844), so a battle hosted on another
  // server never lends this one its route.
  //
  // A joiner is told only whether the battle is relayed, which is the one route
  // the lobby names. A relayed battle is advertised at the relay's own address
  // with `natType` 0, exactly like a direct one (issue #2017), so the lobby says
  // it separately, with `BATTLEISRELAYED`, to clients that asked for relay
  // support (issue #2133). `joinedBattleRouteLabel` says why nothing else gets a
  // word.
  const routeLabel = selfHost
    ? battleRouteLabel(hostingRoute, { lanRoom: directRoom })
    : joinedBattleRouteLabel(battle.relayed);
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
        {invite && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="Copy an invite link for this battle"
            title="Copy invite link"
            onClick={() => copyDeepLink(invite)}
          >
            <LinkIcon className="size-4" />
          </Button>
        )}
        {routeLabel && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  asChild
                  variant="outline"
                  className="h-6 shrink-0 text-muted-foreground"
                >
                  {/* The word alone is meaningless read out of the bar it
                      sits in, so the label says what it is a word about. It
                      still contains the visible word, so somebody speaking to
                      the screen asks for the thing they can see. */}
                  <button
                    type="button"
                    className="cursor-help"
                    aria-label={`How this battle is connected: ${routeLabel.word}`}
                  >
                    {routeLabel.word}
                  </button>
                </Badge>
              </TooltipTrigger>
              {/* Pretty rather than the tooltip's balanced wrap, which evens the
                  lines out and leaves the box wider than the words in it. */}
              <TooltipContent className="max-w-xs text-left leading-snug text-pretty">
                {routeLabel.detail}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
                  Close
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3">
                <p className="text-sm">
                  {closesRoom
                    ? "Close this battle? Everyone will be removed, and the room it is in will stop hosting and give its port back."
                    : "Close this battle? Everyone will be removed and it will disappear from the battle list."}
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
