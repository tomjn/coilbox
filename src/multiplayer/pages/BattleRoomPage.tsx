import { Button, NavGate } from "@picoframe/frame";
import { Gamepad2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { AutohostControls } from "../battle/AutohostControls";
import { BattleChatCard } from "../battle/BattleChatCard";
import { BattleGameCard } from "../battle/BattleGameCard";
import { BattleMapCard } from "../battle/BattleMapCard";
import { BattleMembersTable } from "../battle/BattleMembersTable";
import { BattleOptionsDrawer } from "../battle/BattleOptionsDrawer";
import { BattleRoomHeader } from "../battle/BattleRoomHeader";
import { MissingContentCard } from "../battle/MissingContentCard";
import { StartPosOptions } from "../battle/StartPosOptions";
import { useBattleLaunch } from "../battle/useBattleLaunch";
import { useBattleRoom } from "../battle/useBattleRoom";
import { useMpRevealed } from "../store";

/**
 * The battle room for a joined multiplayer battle. Reads the live battle from the
 * mirror via `useBattleRoom` and lays out a header + two columns: the roster with
 * the battle chat filling the remaining height on the left, and the map/game/
 * start-position/host-command panel on the right. The engine launches itself when
 * the autohost starts the match (host goes in-game) — there's no manual launch.
 */
function BattleRoomPage() {
  const room = useBattleRoom();
  const launch = useBattleLaunch(room.serverKey, room.target);
  const navigate = useNavigate();

  // Auto-launch: the match start is driven by lobby protocol, not a button —
  // when the host (autohost) goes in-game, launch the engine as a client. Guard
  // against relaunching within one game; reset once the host leaves in-game.
  const launchedRef = useRef(false);
  const canRun = !!room.target && !room.mapMissing && !room.gameMissing;
  const { launch: doLaunch } = launch;
  useEffect(() => {
    if (!room.hostIngame) {
      launchedRef.current = false;
      return;
    }
    if (launchedRef.current || !canRun) return;
    launchedRef.current = true;
    doLaunch();
  }, [room.hostIngame, canRun, doLaunch]);

  if (!room.battle) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <Gamepad2 className="size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Not in a battle</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You're not currently in a battle. Browse open battles to join one.
        </p>
        <Button onClick={() => navigate("/battles")}>Browse battles</Button>
      </main>
    );
  }

  const battle = room.battle;

  async function onLeave() {
    await room.leave();
    navigate("/battles");
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <BattleRoomHeader
        battle={battle}
        myStatus={room.myStatus}
        sync={room.sync}
        hostIngame={room.hostIngame}
        allReady={room.allReady}
        onToggleReady={room.setReady}
        onToggleSpectate={room.setSpectator}
        onLeave={onLeave}
        onStart={room.startGame}
      />

      {launch.error && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {launch.error}
        </p>
      )}
      {room.hostIngame && !canRun && (
        <p className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          The match has started, but the map or game isn't installed — install
          it to join.
        </p>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
          <BattleMembersTable
            rows={room.rows}
            sides={room.sides}
            maxSlots={battle.maxPlayers}
            onSide={room.setSide}
            onTeam={room.setTeam}
            onAlly={room.setAlly}
            onColor={room.setColor}
          />
          <BattleChatCard battle={battle} />
        </div>

        <aside className="w-[22rem] shrink-0 space-y-4 overflow-y-auto border-l border-border p-4">
          <BattleMapCard
            key={room.contentNonce}
            battle={battle}
            rows={room.rows}
            enginePath={room.enginePath}
            dataDir={room.dataDir}
            maps={room.maps}
            localMap={room.localMap}
            mapMissing={room.mapMissing}
            startPosType={room.startPosType}
            onSuggestMap={room.suggestMap}
            onRescan={room.rescan}
          />
          <BattleGameCard
            enginePath={room.enginePath}
            dataDir={room.dataDir}
            game={room.localGame}
            gameName={battle.modname}
          />
          <StartPosOptions
            value={room.startPosType}
            note={
              room.startPosType === 2 &&
              Object.keys(battle.startRects).length === 0
                ? "The host hasn't set start boxes yet."
                : undefined
            }
          />
          <BattleOptionsDrawer
            battle={battle}
            modOptionsSchema={room.modOptionsSchema}
            mapOptionsSchema={room.mapOptionsSchema}
            canEdit={room.canEditOptions}
            gameMissing={room.gameMissing}
            mapMissing={room.mapMissing}
            sendOption={room.sendOption}
          />
          {room.gameMissing && (
            <MissingContentCard
              gameName={battle.modname}
              onRescan={room.rescan}
            />
          )}
          <AutohostControls
            locked={battle.locked}
            onCommand={room.autohostSend}
          />
        </aside>
      </div>
    </main>
  );
}

/** Route entry: gated behind having connected at least once this session. */
export default function BattleRoomRoute() {
  return (
    <NavGate use={useMpRevealed} redirectTo="/lobby">
      <BattleRoomPage />
    </NavGate>
  );
}
