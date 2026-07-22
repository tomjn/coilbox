import { Button, NavGate } from "@picoframe/frame";
import { Bookmark, Gamepad2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useFactionLogos } from "@/factions/logos";
import { useSkirmishAis } from "@/play/config";
import { SaveAsPresetButton } from "@/play/pages/components/SaveAsPresetButton";
import { AutohostControls } from "../battle/AutohostControls";
import { BattleChatCard } from "../battle/BattleChatCard";
import { BattleGameCard } from "../battle/BattleGameCard";
import { BattleMapCard } from "../battle/BattleMapCard";
import { BattleMembersTable } from "../battle/BattleMembersTable";
import { BattleOptionsDrawer } from "../battle/BattleOptionsDrawer";
import { BattlePresetsDrawer } from "../battle/BattlePresetsDrawer";
import { BattleRoomHeader } from "../battle/BattleRoomHeader";
import { battleOptionTags } from "../battle/battleOptions";
import { useBattlePresets } from "../battle/battlePresets";
import { MissingContentCard } from "../battle/MissingContentCard";
import {
  StartBoxControls,
  useStartBoxAllies,
} from "../battle/StartBoxControls";
import { StartPosOptions } from "../battle/StartPosOptions";
import { battleToSkirmishDraft } from "../battle/toSkirmish";
import { useBattleLaunch } from "../battle/useBattleLaunch";
import { useBattleRoom } from "../battle/useBattleRoom";
import { VotePanel } from "../battle/VotePanel";
import { useNoteActions } from "../notes";
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
  const factionLogos = useFactionLogos({
    game: room.localGame,
    enginePath: room.enginePath,
    dataDir: room.dataDir,
    gameArchive: room.localGame?.primaryArchive.name,
    sideNames: room.sides.map((s) => s.name),
  });
  const launch = useBattleLaunch(room.serverKey, room.target, room.selfHost);
  // Private, client-side per-player notes (issue #341), scoped to this server.
  const { get: getNote, set: setNote } = useNoteActions(room.serverKey);
  const navigate = useNavigate();
  const presets = useBattlePresets();
  const [presetsOpen, setPresetsOpen] = useState(false);
  // The game's skirmish AIs, so saving this battle as a skirmish preset can resolve
  // each bot's `aiDll` to a real AI reference (and convert human opponents to one).
  const { ais: skirmishAis } = useSkirmishAis(
    room.enginePath,
    room.dataDir,
    room.localGame?.primaryArchive.name,
  );
  // Ally state for start-box editing, shared between the minimap's drag editor
  // and the controls under the start-position dropdown.
  const boxAllies = useStartBoxAllies(room.rows, room.battle?.startRects ?? {});

  // Per-game default preset: when we host a game that has a default preset set,
  // apply its options once. Guarded by a ref keyed on the battle + game so it seeds
  // the room a single time and never re-clobbers options the host then tweaks.
  const appliedDefaultRef = useRef<string | null>(null);
  useEffect(() => {
    const b = room.battle;
    if (!b || !room.selfHost || !room.canEditOptions) return;
    const key = `${room.serverKey}::${b.modname}`;
    if (appliedDefaultRef.current === key) return;
    const defId = presets.defaultForGame(b.modname);
    if (!defId) return;
    const preset = presets.presets.find((p) => p.id === defId);
    if (!preset) return;
    appliedDefaultRef.current = key;
    room.applyOptionTags(preset.scriptTags);
    presets.touchPreset(preset.id);
  }, [room, presets]);

  // Auto-launch: for a battle we JOIN, match start is driven by the protocol, not a
  // button — when the host goes in-game, launch the engine as a client. Guard against
  // relaunching within one game; reset once the host leaves in-game. When we host it
  // ourselves we launch via the Start button instead (see `onStart`), so this is
  // skipped — our own in-game flag must not trigger a client launch.
  const launchedRef = useRef(false);
  const canRun = !!room.target && !room.mapMissing && !room.gameMissing;
  const { launch: doLaunch } = launch;
  useEffect(() => {
    if (room.selfHost) return;
    if (!room.hostIngame) {
      launchedRef.current = false;
      return;
    }
    if (launchedRef.current || !canRun) return;
    launchedRef.current = true;
    doLaunch();
  }, [room.selfHost, room.hostIngame, canRun, doLaunch]);

  // Host start: flip our in-game flag (so joiners' clients auto-launch and connect),
  // launch the engine in host mode, then clear the flag once it exits. A joined
  // battle just asks its autohost to start.
  async function onStart() {
    if (!room.selfHost) {
      await room.startGame();
      return;
    }
    room.setIngame(true);
    try {
      await doLaunch();
    } finally {
      room.setIngame(false);
    }
  }

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
    // `leave` reports its own failure via `room.actionError` and never throws;
    // navigate regardless so a failed LEAVE can't strand the user in the room.
    try {
      await room.leave();
    } finally {
      navigate("/battles");
    }
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
        onStart={onStart}
        selfHost={room.selfHost}
        locked={battle.locked}
        onToggleLock={room.setLocked}
      />

      {room.currentVote && (
        <VotePanel
          vote={room.currentVote}
          onVote={(choice) => room.autohostSend(`!vote ${choice}`)}
        />
      )}

      {launch.error && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {launch.error}
        </p>
      )}
      {room.actionError && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {room.actionError}
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
            factionLogos={factionLogos}
            maxSlots={battle.maxPlayers}
            startPosType={room.startPosType}
            selfHost={room.selfHost}
            canAddBot={room.canAddBot}
            hostControls={room.hostControls}
            addableAis={room.addableAis}
            noteFor={(row) => getNote(row.userId, row.name)}
            onSetNote={(row, text) => setNote(row.userId, row.name, text)}
            onAddBot={room.addBot}
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
            mapsLoading={room.mapsLoading}
            localMap={room.localMap}
            mapMissing={room.mapMissing}
            startPosType={room.startPosType}
            selfHost={room.selfHost}
            canEditBoxes={room.canEditBoxes}
            activeAlly={boxAllies.activeAlly}
            onSetBox={room.setStartBox}
            onSuggestMap={room.suggestMap}
            onChangeMap={room.setMap}
            onRescan={room.rescan}
          />
          {/* Save the whole battle as a replayable singleplayer skirmish (other
              humans become AIs). Distinct from the host-only "Option presets" below,
              which stores only mod/map options. */}
          <SaveAsPresetButton
            getDraft={() =>
              battleToSkirmishDraft({
                battle,
                me: room.me,
                sides: room.sides,
                ais: skirmishAis,
              })
            }
            defaultName={battle.title || `Battle ${battle.id}`}
            variant="outline"
            size="sm"
            className="w-full"
            label="Save as skirmish preset"
          />
          <StartPosOptions
            battle={battle}
            canEdit={room.canEditOptions}
            sendOption={room.sendOption}
            note={
              room.startPosType === 0
                ? "Each team spawns at its numbered map position — pick a team in the player list to choose yours."
                : room.startPosType === 2 &&
                    Object.keys(battle.startRects).length === 0
                  ? "The host hasn't set start boxes yet."
                  : undefined
            }
          >
            {room.canEditBoxes && (
              <StartBoxControls
                mapName={battle.map}
                rects={battle.startRects}
                allyList={boxAllies.allyList}
                allyColors={boxAllies.allyColors}
                activeAlly={boxAllies.activeAlly}
                onPickAlly={boxAllies.pickAlly}
                onSetBox={room.setStartBox}
                onClearBox={room.clearStartBox}
              />
            )}
          </StartPosOptions>
          <BattleOptionsDrawer
            battle={battle}
            modOptionsSchema={room.modOptionsSchema}
            mapOptionsSchema={room.mapOptionsSchema}
            canEdit={room.canEditOptions}
            gameMissing={room.gameMissing}
            mapMissing={room.mapMissing}
            sendOption={room.sendOption}
            canEditRestrictions={room.canEditRestrictions}
            onRestrictChange={room.setRestrictions}
          />
          {room.canEditOptions && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setPresetsOpen(true)}
              >
                <Bookmark className="size-4" /> Option presets
              </Button>
              <BattlePresetsDrawer
                open={presetsOpen}
                onOpenChange={setPresetsOpen}
                gameName={battle.modname}
                presets={presets.presetsForGame(battle.modname)}
                defaultId={presets.defaultForGame(battle.modname)}
                optionCount={
                  Object.keys(battleOptionTags(battle.scriptTags)).length
                }
                onSave={(name) =>
                  presets.savePreset(name, battle.modname, battle.scriptTags)
                }
                onLoad={(p) => {
                  room.applyOptionTags(p.scriptTags);
                  presets.touchPreset(p.id);
                }}
                onDelete={(id) => presets.removePreset(id)}
                onSetDefault={(id) =>
                  presets.setDefaultForGame(battle.modname, id)
                }
                disabled={!room.canEditOptions}
              />
            </>
          )}
          {room.gameMissing && (
            <MissingContentCard
              battleId={battle.id}
              gameName={battle.modname}
              onRescan={room.rescan}
            />
          )}
          {/* The `!`-command panel only makes sense with a SPADS autohost; when
              we host the battle ourselves those commands are inert (lock moves to
              the header, map changes go through the map card). */}
          {!room.selfHost && (
            <AutohostControls
              locked={battle.locked}
              onCommand={room.autohostSend}
            />
          )}
          <BattleGameCard
            enginePath={room.enginePath}
            dataDir={room.dataDir}
            game={room.localGame}
            gameName={battle.modname}
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
