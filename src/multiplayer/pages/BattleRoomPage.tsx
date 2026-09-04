import { Button, NavGate } from "@picoframe/frame";
import { Bookmark, Gamepad2, LogIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useBrandingEntry } from "@/content/branding";
import { useHostedRoom } from "@/direct/hostedRoom";
import { PendingJoinsPanel, usePendingJoins } from "@/direct/PendingJoins";
import { RoomMovedPanel } from "@/direct/RoomMoved";
import { closeEndsTheRoom } from "@/direct/room";
import { stopHostedRoom } from "@/direct/stopRoom";
import { useFactionLogos } from "@/factions/logos";
import { notify } from "@/notify/notify";
import { useSkirmishAis } from "@/play/config";
import type { SkirmishDraft } from "@/play/drafts";
import { mergeGameAi } from "@/play/gameAi";
import { SaveAsPresetButton } from "@/play/pages/components/SaveAsPresetButton";
import { type SkirmishPreset, useSkirmishPresets } from "@/play/presets";
import { getProfile } from "@/profile/profile";
import { ApplySkirmishPresetPopover } from "../battle/ApplySkirmishPresetPopover";
import { AutohostControls } from "../battle/AutohostControls";
import { addHostSeedBots } from "../battle/applyHostSeed";
import { BattleChatCard } from "../battle/BattleChatCard";
import { BattleGameCard } from "../battle/BattleGameCard";
import { BattleMapCard } from "../battle/BattleMapCard";
import { BattleMembersTable } from "../battle/BattleMembersTable";
import { BattleMovedPanel } from "../battle/BattleMovedPanel";
import { BattleOptionsDrawer } from "../battle/BattleOptionsDrawer";
import { BattlePresetsDrawer } from "../battle/BattlePresetsDrawer";
import { BattleRoomHeader } from "../battle/BattleRoomHeader";
import { battleOptionTags } from "../battle/battleOptions";
import { useBattlePresets } from "../battle/battlePresets";
import { launchBlock, startedWithoutYou } from "../battle/contentBlock";
import { draftToHostSeed, hostSeedAiNotice } from "../battle/fromSkirmish";
import { GameTypePresetsControls } from "../battle/GameTypePresetsControls";
import { MissingContentCard } from "../battle/MissingContentCard";
import { matchStartAction } from "../battle/matchStart";
import { canRejoinMatch } from "../battle/rejoin";
import {
  StartBoxControls,
  useStartBoxAllies,
} from "../battle/StartBoxControls";
import { StartPosOptions } from "../battle/StartPosOptions";
import { unsyncedPlayers } from "../battle/startBlockers";
import { useSavedStartBoxes } from "../battle/startBoxSaved";
import { battleToSkirmishDraft } from "../battle/toSkirmish";
import { useBattleLaunch } from "../battle/useBattleLaunch";
import { useBattleRoom } from "../battle/useBattleRoom";
import { VotePanel } from "../battle/VotePanel";
import { useNoteActions } from "../notes";
import { useStatsRelations } from "../statsRelation";
import { relationSummary } from "../statsRelationSummary";
import { useMpRevealed, useMultiplayer } from "../store";

/**
 * The battle room for a joined multiplayer battle. Reads the live battle from the
 * mirror via `useBattleRoom` and lays out a header + two columns: the roster with
 * the battle chat filling the remaining height on the left, and the map/game/
 * start-position/host-command panel on the right. The engine launches itself when
 * the autohost starts the match (host goes in-game), so the only manual launch is
 * the Rejoin button shown after our engine exits mid-match.
 */
function BattleRoomPage() {
  const room = useBattleRoom();
  const { disconnect } = useMultiplayer();
  // The room this client hosts, if it hosts one. Read here because the battle on
  // screen may be the one inside it, and then closing the battle is closing the
  // room (issue #2057).
  const hostedRoom = useHostedRoom();
  const factionLogos = useFactionLogos({
    game: room.localGame,
    enginePath: room.enginePath,
    dataDir: room.dataDir,
    gameArchive: room.localGame?.primaryArchive.name,
    sideNames: room.sides.map((s) => s.name),
  });
  // The game's AI catalogue, for the AI picker's difficulty pips.
  const brandingAi = useBrandingEntry(room.localGame)?.ai;
  const aiConfig = mergeGameAi(getProfile().ai, brandingAi);
  // Why this install cannot play this battle, named, from the moment we walk in.
  // A joiner who only finds out at match start has already given the room ten
  // minutes, and a direct room has no server to fetch the content from and no
  // hashes in the LAN beacon to warn before the join (issue #1572). The battle
  // itself carries the map and game names, so the room can say it straight away.
  const block = launchBlock({
    hasTarget: !!room.target,
    targetLoading: room.targetLoading,
    contentKnown: room.contentKnown,
    mapMissing: room.mapMissing,
    gameMissing: room.gameMissing,
    mapName: room.battle?.map ?? "",
    gameName: room.battle?.modname ?? "",
  });
  const blockReason = block?.reason ?? null;
  const launch = useBattleLaunch(
    room.serverKey,
    room.target,
    room.selfHost,
    blockReason,
  );
  // People waiting to be let into a room we are hosting ourselves, with approval
  // switched on. Read off the shared room source, which holds nothing at all
  // unless this client is hosting, so a battle on a real server asks nothing.
  const joins = usePendingJoins();
  // Private, client-side per-player notes (issue #341), scoped to this server.
  const { get: getNote, set: setNote } = useNoteActions(room.serverKey);
  // "N games with this player…" line for the note popover, from the local
  // replay-stats database (#375) — purely a read, no server involvement.
  const relationFor = useStatsRelations(room.me);
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

  // Skirmish presets (issue #373): the singleplayer preset store, distinct
  // from `useBattlePresets` above (options-only snapshots). Used both to host
  // a preset's own bots once a room WE opened from it comes up, and to let a
  // self-hosted room apply one in place.
  const skirmishPresets = useSkirmishPresets();
  const [savedBoxes] = useSavedStartBoxes();
  const [hostSeedError, setHostSeedError] = useState<string | null>(null);

  // "Host as battle" (from a skirmish preset or the current Singleplayer setup)
  // navigates here with the draft to seed once the room we just opened is ready.
  const location = useLocation();
  const hostDraft = (location.state as { hostDraft?: SkirmishDraft } | null)
    ?.hostDraft;

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

  // Apply a "Host as battle" seed once, the first time this battle is ready:
  // the draft's own seat, its mod/map options, start-pos type and unit
  // restrictions, its saved-for-this-map start boxes (if it uses choose-in-map),
  // and its bots. Guarded by a ref keyed on the battle id, set only once the
  // seeding actually runs, so a re-render (or the host later tweaking options)
  // never re-seeds. `contentKnown`'s "some content is known" shortcut can
  // briefly report a just-installed game/map as missing while the room's own
  // scan is still catching up (live-verified: locking here on that transient
  // read produced a false "not installed" banner for a game that WAS
  // installed). So a missing verdict is never locked in or reported here: the
  // effect just waits and re-checks on the next render: if the game or map is
  // genuinely missing, it never seeds, and the room's own `MissingContentCard`
  // (rendered elsewhere below) already tells the host that.
  const appliedHostSeedRef = useRef<number | null>(null);
  useEffect(() => {
    const b = room.battle;
    if (!hostDraft || !b || !room.selfHost) return;
    if (appliedHostSeedRef.current === b.id) return;
    if (!room.contentKnown || room.gameMissing || room.mapMissing) return;
    // Wait for the game's own addable-AI list to load before reconciling the
    // preset's bots against it (issue #531). Reconciling early ran against the
    // engine-natives fallback and remapped a valid preset AI (e.g. SimpleAI) to
    // a native (e.g. BARb) the game doesn't offer.
    if (!room.addableAisReady) return;
    appliedHostSeedRef.current = b.id;

    const seed = draftToHostSeed({
      draft: hostDraft,
      sides: room.sides,
      ais: room.addableAis,
    });
    // Surface any AI the hosted game doesn't offer (issue #501): the preset
    // may have been authored against a different game or an older version, so
    // its bots were remapped to valid defaults rather than added blind.
    const hostNotice = hostSeedAiNotice(seed);
    if (hostNotice) {
      notify({ title: "Preset AI adjusted", body: hostNotice, level: "info" });
    }
    room.setBattleStatusBatch({
      side: seed.self.side,
      ally: seed.self.ally,
      teamId: seed.self.teamId,
      colorHex: seed.self.colorHex,
      spectator: seed.self.spectator,
    });
    room.applyOptionTags(seed.scriptTags);
    if (hostDraft.startPosType === 2) {
      const boxes = savedBoxes[hostDraft.mapName];
      if (boxes) {
        for (const [ally, rect] of Object.entries(boxes))
          room.setStartBox(Number(ally), rect);
      }
    }
    if (seed.bots.length === 0 || !room.serverKey) return;
    const serverKey = room.serverKey;
    addHostSeedBots(serverKey, seed.bots, Object.keys(b.bots)).then(
      (failures) => {
        if (failures.length > 0) {
          setHostSeedError(
            `${failures.length} of ${seed.bots.length} bot(s) couldn't be added. ${failures.join(", ")}`,
          );
        }
      },
    );
  }, [hostDraft, room, savedBoxes]);

  // Apply a saved skirmish preset to the current room in place (issue #373).
  // Only ever reachable while self-hosting (see the button below), so this
  // never runs against a battle we merely joined.
  function applySkirmishPresetInPlace(preset: SkirmishPreset, maphash: number) {
    if (!room.battle) return;
    // Don't reconcile the preset's bot AIs until the game's real addable-AI list
    // has loaded (issue #531), so an early click can't remap against the
    // engine-natives fallback.
    if (!room.addableAisReady) {
      setHostSeedError("Still loading this game's AI list. Try again.");
      return;
    }
    setHostSeedError(null);
    if (preset.mapName !== room.battle.map)
      room.setMap(preset.mapName, maphash);
    const seed = draftToHostSeed({
      draft: preset,
      sides: room.sides,
      ais: room.addableAis,
    });
    const applyNotice = hostSeedAiNotice(seed);
    if (applyNotice) {
      notify({ title: "Preset AI adjusted", body: applyNotice, level: "info" });
    }
    room.setBattleStatusBatch({
      side: seed.self.side,
      ally: seed.self.ally,
      teamId: seed.self.teamId,
      colorHex: seed.self.colorHex,
      spectator: seed.self.spectator,
    });
    room.applyOptionTags(seed.scriptTags);
    if (preset.startPosType === 2) {
      const boxes = savedBoxes[preset.mapName];
      if (boxes) {
        for (const [ally, rect] of Object.entries(boxes))
          room.setStartBox(Number(ally), rect);
      }
    }
    skirmishPresets.touchPreset(preset.id);
    if (seed.bots.length === 0 || !room.serverKey) return;
    const serverKey = room.serverKey;
    addHostSeedBots(serverKey, seed.bots, Object.keys(room.battle.bots)).then(
      (failures) => {
        if (failures.length > 0) {
          setHostSeedError(
            `${failures.length} of ${seed.bots.length} bot(s) couldn't be added. ${failures.join(", ")}`,
          );
        }
      },
    );
  }

  // Auto-launch: for a battle we JOIN, match start is driven by the protocol, not a
  // button — when the host goes in-game, launch the engine as a client. Guard against
  // relaunching within one game; reset once the host leaves in-game. When we host it
  // ourselves we launch via the Start button instead (see `onStart`), so this is
  // skipped — our own in-game flag must not trigger a client launch.
  const launchedRef = useRef(false);
  const canRun = !!room.target && !room.mapMissing && !room.gameMissing;
  const { launch: doLaunch } = launch;
  // Our launch for this match has finished, so the engine is no longer ours to
  // be in. With the host still in-game that means we dropped out of a running
  // match, which is what the manual Rejoin button offers to undo (issue #453).
  const [launchSettled, setLaunchSettled] = useState(false);
  useEffect(() => {
    if (room.selfHost) return;
    if (!room.hostIngame) {
      launchedRef.current = false;
      setLaunchSettled(false);
      return;
    }
    if (launchedRef.current || !canRun) return;
    launchedRef.current = true;
    doLaunch().finally(() => setLaunchSettled(true));
  }, [room.selfHost, room.hostIngame, canRun, doLaunch]);

  // A Tachyon lobby has no host to go in-game. The server picks an autohost and
  // sends every player its address, which the connection answers and reports by
  // advancing `battleStartSeq`, so that is the launch signal here.
  //
  // Missing content holds the launch rather than dropping it: `canRun` is a
  // dependency, so a map or game that arrives later starts the engine then. The
  // server has already been told we are coming, because it closes the connection
  // if the answer waits on a download.
  const startedRef = useRef(room.battleStartSeq);
  const startNoticeRef = useRef(room.battleStartSeq);
  const { battleStartSeq } = room;
  useEffect(() => {
    const action = matchStartAction({
      seq: battleStartSeq,
      actedOn: startedRef.current,
      canRun,
    });
    if (action === "ignore") {
      startedRef.current = battleStartSeq;
      startNoticeRef.current = battleStartSeq;
      return;
    }
    if (action === "wait") {
      // Say so once. A room that sits still while its match runs without us
      // needs explaining, and the missing-content cards below say what to get.
      if (blockReason && startNoticeRef.current !== battleStartSeq) {
        startNoticeRef.current = battleStartSeq;
        void notify({
          title: "The match has started",
          body: `${blockReason} Coilbox will join as soon as it is there.`,
          level: "error",
        });
      }
      return;
    }
    startedRef.current = battleStartSeq;
    setLaunchSettled(false);
    doLaunch().finally(() => setLaunchSettled(true));
  }, [battleStartSeq, blockReason, canRun, doLaunch]);

  // Never automatic: an engine that exited may have exited on purpose, so
  // getting back in has to be a deliberate click.
  const rejoinable = canRejoinMatch({
    selfHost: room.selfHost,
    hostIngame: room.hostIngame,
    launchSettled,
    running: launch.running,
    canRun,
  });

  async function onRejoin() {
    setLaunchSettled(false);
    try {
      await doLaunch();
    } finally {
      setLaunchSettled(true);
    }
  }

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
  // Whether "Close battle" ends the room as well as the battle in it, which
  // decides both what the button does and what its confirmation promises.
  const endsTheRoom = closeEndsTheRoom({
    selfHost: room.selfHost,
    directRoom: room.directRoom,
    hosting: !!hostedRoom,
  });

  async function onLeave() {
    // A battle in this client's own LAN room is the room, so the button that
    // closes one closes both (issue #2057). Not a leave followed by a stop: the
    // room's own "Stop room" drops this client first on purpose, and the two
    // buttons now do the same thing in the same order.
    if (endsTheRoom) {
      try {
        await stopHostedRoom(hostedRoom?.host ?? "", disconnect);
      } catch (e) {
        // Said out here rather than in the room's own line, which is on the page
        // this is about to leave for and describes a room that is still up. The
        // "Stop room" button beside it is the way out.
        void notify({
          title: "The room is still running",
          body: `Coilbox could not close it: ${e instanceof Error ? e.message : String(e)}. Stop it from the Battles page.`,
          level: "error",
        });
      } finally {
        navigate("/battles");
      }
      return;
    }
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
        blockShort={block?.short ?? null}
        blockReason={blockReason}
        unsynced={unsyncedPlayers(room.rows)}
        hostIngame={room.hostIngame}
        allReady={room.allReady}
        onToggleReady={room.setReady}
        onToggleSpectate={room.setSpectator}
        onLeave={onLeave}
        onStart={onStart}
        selfHost={room.selfHost}
        closesRoom={endsTheRoom}
        locked={battle.locked}
        onToggleLock={room.setLocked}
        // Same as the battle row on the Battles page: a room of our own is
        // reached over loopback and has no link to give from here (issue
        // #1615), somebody else's is passed on as the address we dialled it on
        // (issue #1617), and a server is passed on as a battle to join.
        serverKey={room.serverKey}
        directRoom={room.directRoom}
      />

      {/* Above everything else on the page: somebody is sitting on a spinner
          until this is answered, and nothing below is blocking anyone. */}
      <PendingJoinsPanel pending={joins.pending} onAnswer={joins.answer} />

      {/* Below the joins, because nobody is waiting on this one. Above the rest,
          because it is a fact about the room the host is running rather than
          about something they just pressed (issue #2122). */}
      <RoomMovedPanel />

      {/* The same news for everybody who is not running the battle, which the
          strip above never reaches (issue #2073). Below it because a host who
          somehow saw both should read their own room's first. */}
      <BattleMovedPanel battleId={battle.id} selfHost={room.selfHost} />

      {room.currentVote && (
        <VotePanel vote={room.currentVote} onVote={room.castVote} />
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
      {hostSeedError && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {hostSeedError}
        </p>
      )}
      {rejoinable && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          <span>
            The match is still running and you've left it. Rejoin to return to
            your slot.
          </span>
          <Button size="sm" onClick={onRejoin}>
            <LogIn className="size-4" /> Rejoin
          </Button>
        </div>
      )}
      {/* Named the moment we know, not at launch. Once the host is in-game the
          same fact is reworded, because by then the match is running without us
          and sitting still needs explaining. Our own in-game flag is not that,
          so a self-hosted room never says it. */}
      {block && (
        <p className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          {room.hostIngame && !room.selfHost
            ? startedWithoutYou(block)
            : block.reason}
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
            serverAssignsSeat={room.serverAssignsSeat}
            canKick={room.canKick}
            canBoss={room.canBoss}
            canAddBot={room.canAddBot}
            botsRefused={room.botsRefused}
            canSetBotAlly={room.canSetBotAlly}
            hostControls={room.hostControls}
            addableAis={room.addableAis}
            addableAisReady={room.addableAisReady}
            aiConfig={aiConfig}
            noteFor={(row) => getNote(row.userId, row.name)}
            onSetNote={(row, text) => setNote(row.userId, row.name, text)}
            statsSummaryFor={(row) => relationSummary(relationFor(row.name))}
            // Only an autohost battle has anything to send this to: there is
            // no founder-direct equivalent of SPADS's `!force ... bonus`.
            onSetBonus={!room.selfHost ? room.setBonus : undefined}
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
            canChangeMap={room.canChangeMap}
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
          {/* Apply a saved skirmish preset to this room in place (issue #373):
              its map, options, start boxes and bots, without touching any real
              seated player. Self-host only, mirroring the host-seed apply above. */}
          {room.selfHost && (
            <ApplySkirmishPresetPopover
              presets={skirmishPresets.presets.filter(
                (p) => p.gameName === battle.modname,
              )}
              enginePath={room.enginePath}
              dataDir={room.dataDir}
              onApply={applySkirmishPresetInPlace}
            />
          )}
          <StartPosOptions
            battle={battle}
            canEdit={room.canEditOptions}
            // Zero-K carries no start position mode, so the card says so rather
            // than showing a default nobody chose (issue #1979).
            unavailable={room.startPositionsUnavailable}
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
            restrictionsUnavailable={room.restrictionsUnavailable}
            startPositionsUnavailable={room.startPositionsUnavailable}
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
          {/* Game-type presets + Balance (issue #344): unlike AutohostControls
              this works self-hosted too (founder-direct force calls), so it
              renders regardless of `selfHost` and only hides itself where the
              server assigns seats (Zero-K, Tachyon — see the component doc). */}
          <GameTypePresetsControls
            rows={room.rows}
            me={room.me}
            selfHost={room.selfHost}
            serverAssignsSeat={room.serverAssignsSeat}
            hostControls={room.hostControls}
            onSetBattleStatusBatch={room.setBattleStatusBatch}
            onAutohostSend={room.autohostSend}
          />
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
