import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, cn, NavGate } from "@picoframe/frame";
import { Bookmark, Gamepad2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useBrandingEntry } from "@/content/branding";
import { useHostedRoom } from "@/direct/hostedRoom";
import { PendingJoinsPanel, usePendingJoins } from "@/direct/PendingJoins";
import { RoomMovedPanel } from "@/direct/RoomMoved";
import { closeEndsTheRoom, hostedRoomKey } from "@/direct/room";
import { stopHostedRoom } from "@/direct/stopRoom";
import { useFactionLogos } from "@/factions/logos";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import { useSkirmishAis } from "@/play/config";
import type { SkirmishDraft } from "@/play/drafts";
import { mergeGameAi } from "@/play/gameAi";
import type { PresetFitFacts } from "@/play/presetFit";
import { PresetImportGate, usePresetImport } from "@/play/presetImport";
import {
  PART_LABELS,
  type PresetPart,
  type PresetSelection,
} from "@/play/presetParts";
import { type SkirmishPreset, useSkirmishPresets } from "@/play/presets";
import { getProfile } from "@/profile/profile";
import { startPosNote } from "@/startbox/mode";
import {
  StartBoxControls,
  useStartBoxAllies,
} from "@/startbox/StartBoxControls";
import { useRoomWidgets } from "@/widgets/useRoomWidgets";
import { ApplySkirmishPresetDrawer } from "../battle/ApplySkirmishPresetDrawer";
import { AutohostControls } from "../battle/AutohostControls";
import { addHostSeedBots } from "../battle/applyHostSeed";
import { BattleChatCard } from "../battle/BattleChatCard";
import { BattleEngineCard } from "../battle/BattleEngineCard";
import { BattleGameCard } from "../battle/BattleGameCard";
import { BattleMapCard } from "../battle/BattleMapCard";
import { BattleMembersTable } from "../battle/BattleMembersTable";
import { BattleMovedPanel } from "../battle/BattleMovedPanel";
import { BattleOptionsDrawer } from "../battle/BattleOptionsDrawer";
import { BattleRoomHeader } from "../battle/BattleRoomHeader";
import { filterOptionTags } from "../battle/battleOptions";
import { CompatBattleCard } from "../battle/CompatBattleCard";
import { CompatHostExport } from "../battle/CompatHostExport";
import { alliesFromRows } from "../battle/config";
import { launchBlock, startedWithoutYou } from "../battle/contentBlock";
import { draftToHostSeed, hostSeedAiNotice } from "../battle/fromSkirmish";
import { GameTypePresetsControls } from "../battle/GameTypePresetsControls";
import { type HostSteps, teamShape } from "../battle/hostSteps";
import { MissingContentCard } from "../battle/MissingContentCard";
import { launchesOnItsOwn, matchAction } from "../battle/matchAction";
import { matchStartAction } from "../battle/matchStart";
import {
  applyRoomSteps,
  type NotTakenWhat,
  notTakenMessage,
  refusedOptions,
} from "../battle/presetOutcome";
import { RoomSplitHandle, useRoomSplit } from "../battle/RoomSplit";
import { RoomWidgetsWarning } from "../battle/RoomWidgetsWarning";
import { StartPosOptions } from "../battle/StartPosOptions";
import { unsyncedPlayers } from "../battle/startBlockers";
import { battleToSkirmishDraft } from "../battle/toSkirmish";
import { useBattleLaunch } from "../battle/useBattleLaunch";
import { useOaHostLaunch } from "../battle/useOaHostLaunch";
import { useBattleRoom } from "../battle/useBattleRoom";
import { useBattleRoomKey } from "../battle/useBattleRoomKey";
import { useRejoinRequest } from "../battle/useRejoinRequest";
import { VotePanel } from "../battle/VotePanel";
import { otherEngineName } from "../battles/battleFilters";
import { useMpRevealed } from "../navPredicates";
import { useNoteActions } from "../notes";
import { useStatsRelations } from "../statsRelation";
import { relationSummary } from "../statsRelationSummary";
import {
  connectionLabelIfSeveral,
  useMultiplayer,
  useProtocolServers,
} from "../store";
import { useNameMark } from "../useNameMark";

/** The sentence for bots a host seed or preset could not add. */
function botFailure(failed: number, total: number, names: string): string {
  return plural(total, {
    one: `${failed} of # bot couldn't be added. ${names}`,
    other: `${failed} of # bots couldn't be added. ${names}`,
  });
}

/**
 * The battle room for a joined multiplayer battle. Reads the live battle from the
 * mirror of the connection its `?server=` names (issue #2844) via
 * `useBattleRoom` and lays out a header + two columns: the roster with
 * the battle chat filling the remaining height on the left, and the map/game/
 * start-position/host-command panel on the right. The engine launches itself when
 * the autohost starts the match (host goes in-game) for anybody who was in the
 * room at the time. The header's main button is the manual way in: back into a
 * match our engine dropped out of, or in to watch one we walked in on.
 */
function BattleRoomPage() {
  const { t, i18n } = useLingui();
  const room = useBattleRoom(useBattleRoomKey());
  const split = useRoomSplit();
  const { disconnect, connections } = useMultiplayer();
  const servers = useProtocolServers();
  // The room's own connection, which is the one a battle in our own LAN room
  // is on, rather than whichever connection is focused.
  const disconnectRoom = () => disconnect(room.serverKey ?? undefined);
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
  const engine = room.engine;
  // A battle this client hosts on Open Annihilation (issue #4946). Its Start
  // runs OA, which has no use for a Recoil engine, game or map, so the
  // checks below that ask for one do not apply.
  const oaHost =
    room.selfHost && !!room.battle && otherEngineName(room.battle) !== null;
  const block = oaHost
    ? null
    : launchBlock({
        hasTarget: !!room.target,
        targetLoading: room.targetLoading,
        engineMissing: engine.verdict === "mismatch" ? engine.hostLabel : null,
        engineUnreadable: room.engineUnreadable,
        unreadable: room.contentUnreadable,
        unreadableReason: room.contentUnreadableReason,
        contentKnown: room.contentKnown,
        mapMissing: room.mapMissing,
        gameMissing: room.gameMissing,
        dependencyBlock: room.dependencyBlock,
        compat: room.compat,
        mapName: room.battle?.map ?? "",
        gameName: room.requiredGame ?? room.battle?.modname ?? "",
      });
  const blockReason = block?.reason ?? null;
  // The player's own widgets, for the strip that says which of them this
  // room's options turn off (issue #1292).
  const playerWidgets = useRoomWidgets(
    room.enginePath,
    room.dataDir,
    room.localGame,
  );
  const launch = useBattleLaunch(
    room.serverKey,
    room.target,
    room.selfHost,
    blockReason,
  );
  const oaRun = useOaHostLaunch({
    battleId: room.battle?.id ?? null,
    battleMap: room.battle?.map ?? "",
    maxPlayers: room.battle?.maxPlayers ?? 0,
    username: room.me,
    setIngame: room.setIngame,
  });
  // People waiting to be let into a room we are hosting ourselves, with approval
  // switched on. Read off the shared room source, which holds nothing at all
  // unless this client is hosting, so a battle on a real server asks nothing.
  const joins = usePendingJoins();
  // Private, client-side per-player notes (issue #341), scoped to this server.
  const { get: getNote, set: setNote } = useNoteActions(room.serverKey);
  const markFor = useNameMark(room.serverKey);
  // "N games with this player…" line for the note popover, from the local
  // replay-stats database (#375) — purely a read, no server involvement.
  const relationFor = useStatsRelations(room.me);
  const navigate = useNavigate();
  // The game's skirmish AIs, so saving this battle as a skirmish preset can resolve
  // each bot's `aiDll` to a real AI reference (and convert human opponents to one).
  const { ais: skirmishAis } = useSkirmishAis(
    room.enginePath,
    room.dataDir,
    room.localGame?.primaryArchive.name,
  );
  // Ally state for start-box editing, shared between the minimap's drag editor
  // and the controls under the start-position dropdown.
  const boxAllies = useStartBoxAllies(
    alliesFromRows(room.rows),
    room.battle?.startRects ?? {},
  );

  // The preset library (issue #373). Used both to host a preset's own bots
  // once a room we opened from it comes up, and to apply one to this room.
  const skirmishPresets = useSkirmishPresets();
  const [hostSeedError, setHostSeedError] = useState<string | null>(null);
  const [applyPresetOpen, setApplyPresetOpen] = useState(false);
  // Importing a shared preset file, the same flow the Singleplayer sheet runs.
  const presetImport = usePresetImport(setHostSeedError);

  // "Host as battle" (from a skirmish preset or the current Singleplayer setup)
  // navigates here with the draft to seed once the room we just opened is ready.
  const location = useLocation();
  const hostDraft = (location.state as { hostDraft?: SkirmishDraft } | null)
    ?.hostDraft;

  useRejoinRequest(room.battle?.id ?? null, room.askForMatch);

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
      notify({
        title: t`Preset AI adjusted`,
        body: hostNotice,
        level: "info",
      });
    }
    room.setBattleStatusBatch({
      side: seed.self.side,
      ally: seed.self.ally,
      teamId: seed.self.teamId,
      colorHex: seed.self.colorHex,
      spectator: seed.self.spectator,
    });
    room.applyOptionTags(seed.scriptTags);
    // The draft carries the boxes the setup was actually holding, so hosting it
    // opens the room on the layout you were looking at. This used to reach for
    // whatever was last saved against the map, which is a different layout
    // whenever you had drawn something and not saved it.
    if (hostDraft.startPosType === 2 && hostDraft.startRects) {
      for (const [ally, rect] of Object.entries(hostDraft.startRects))
        room.setStartBox(Number(ally), rect);
    }
    if (seed.bots.length === 0 || !room.serverKey) return;
    const serverKey = room.serverKey;
    addHostSeedBots(serverKey, seed.bots, Object.keys(b.bots)).then(
      (failures) => {
        if (failures.length > 0) {
          setHostSeedError(
            botFailure(failures.length, seed.bots.length, failures.join(", ")),
          );
        }
      },
    );
  }, [hostDraft, room, t]);

  // Apply a saved skirmish preset to the current room in place (issue #373).
  // Reachable on any room whose options we may write: one we host ourselves,
  // and one an autohost bot runs, where each step goes out as a command and the
  // bot decides whether we were allowed to ask.
  function applySkirmishPresetInPlace(
    preset: SkirmishPreset,
    maphash: number,
    selection: PresetSelection,
    fit?: PresetFitFacts,
  ) {
    if (!room.battle) return;
    const take = (part: PresetPart) => selection.parts.includes(part);
    // Don't reconcile the preset's bot AIs until the game's real addable-AI list
    // has loaded (issue #531), so an early click can't remap against the
    // engine-natives fallback. Only the roster needs that list, so taking the
    // options alone is not made to wait on it.
    if (take("teams") && !room.addableAisReady) {
      setHostSeedError(t`Still loading this game's AI list. Try again.`);
      return;
    }
    setHostSeedError(null);
    const seed = draftToHostSeed({
      draft: preset,
      sides: room.sides,
      ais: room.addableAis,
    });
    const presetName = preset.name;
    const labelFor = (what: NotTakenWhat) =>
      what === "map"
        ? t`Map`
        : what === "teamSize"
          ? t`Team size`
          : what === "nbTeams"
            ? t`Team count`
            : i18n._(PART_LABELS[what]);
    const tags = filterOptionTags(seed.scriptTags, selection);
    // Before the first command of any kind, so a preset holding an option that
    // cannot be sent leaves the room as it was.
    const refused = notTakenMessage(refusedOptions(tags), labelFor);
    if (refused) {
      notify({
        title: t`"${presetName}" was not applied`,
        body: refused,
        level: "warning",
      });
      return;
    }
    // Changing the map is `UPDATEBATTLEINFO` when we run the game ourselves and
    // `!map` when a bot does. The second needs no checksum, which is why the
    // panel only waits on unitsync for the first. With an autohost the command
    // goes out below, where the room's answer is checked.
    const mapChange = take("map") && preset.mapName !== room.battle.map;
    if (mapChange && room.selfHost) room.setMap(preset.mapName, maphash);
    else if (mapChange && !room.autohost) room.suggestMap(preset.mapName);
    // A preset holds participants, not a team size, so the room's size and count
    // come from them. Only an autohost has them to set.
    const shape =
      take("teams") && room.autohost ? teamShape(preset.participants) : null;
    const hostSteps: HostSteps = {
      ...(mapChange && room.autohost ? { map: preset.mapName } : {}),
      ...(shape ?? {}),
    };
    if (take("teams")) {
      const applyNotice = hostSeedAiNotice(seed);
      if (applyNotice) {
        notify({
          title: t`Preset AI adjusted`,
          body: applyNotice,
          level: "info",
        });
      }
      room.setBattleStatusBatch({
        side: seed.self.side,
        ally: seed.self.ally,
        teamId: seed.self.teamId,
        colorHex: seed.self.colorHex,
        spectator: seed.self.spectator,
      });
    }
    // A map that is changing is not the one the room's schema describes, so the
    // panel's read of the preset's map stands in for it.
    const rects =
      take("startPositions") && preset.startPosType === 2 && preset.startRects
        ? Object.entries(preset.startRects)
        : [];
    void applyRoomSteps({
      hostSteps,
      tags,
      schemas: {
        mod: fit?.modOptions.current,
        map: mapChange ? fit?.mapOptions.preset : fit?.mapOptions.current,
      },
      mapName: preset.mapName,
      runHostSteps: room.runHostSteps,
      applyOptionTags: room.applyOptionTags,
      // The preset's own boxes, the ones saved with it, rather than whatever was
      // last saved against the map.
      afterOptions: () => {
        for (const [ally, rect] of rects) room.setStartBox(Number(ally), rect);
      },
    }).then((entries) => {
      const message = notTakenMessage(entries, labelFor);
      if (message)
        notify({
          title: t`Some of "${presetName}" did not take`,
          body: message,
          level: "warning",
        });
    });
    skirmishPresets.touchPreset(preset.id);
    if (!take("teams") || seed.bots.length === 0 || !room.serverKey) return;
    const serverKey = room.serverKey;
    addHostSeedBots(serverKey, seed.bots, Object.keys(room.battle.bots)).then(
      (failures) => {
        if (failures.length > 0) {
          setHostSeedError(
            botFailure(failures.length, seed.bots.length, failures.join(", ")),
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
  //
  // Only for a match we were in the room for. Walking into a room that is
  // already running launches nothing, and the header offers to watch instead.
  const launchedRef = useRef(false);
  const canRun =
    !!room.target &&
    !room.contentUnreadable &&
    !room.mapMissing &&
    !room.gameMissing &&
    !room.dependencyBlock;
  const { launch: doLaunch } = launch;
  // A launch of ours is on its way or has an engine up. Once it is over and the
  // host is still in-game we have dropped out of a running match, which is what
  // the header's Rejoin offers to undo (issue #453).
  const [launching, setLaunching] = useState(false);
  const runLaunch = useCallback(async () => {
    setLaunching(true);
    try {
      await doLaunch();
    } finally {
      setLaunching(false);
    }
  }, [doLaunch]);
  useEffect(() => {
    if (!room.hostIngame) launchedRef.current = false;
    const go = launchesOnItsOwn({
      selfHost: room.selfHost,
      hostIngame: room.hostIngame,
      presentAtStart: room.presentAtStart,
      launched: launchedRef.current,
      canRun,
      serverSendsMatch: room.serverSendsMatch,
    });
    if (!go) return;
    launchedRef.current = true;
    void runLaunch();
  }, [
    room.selfHost,
    room.hostIngame,
    room.presentAtStart,
    room.serverSendsMatch,
    canRun,
    runLaunch,
  ]);

  // A Tachyon lobby has no host to go in-game. The server picks an autohost and
  // sends every player its address, which the connection answers and reports by
  // advancing `battleStartSeq`, so that is the launch signal here. Zero-K's
  // `ConnectSpring` advances it the same way.
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
          title: t`The match has started`,
          body: t`${blockReason} Coilbox will join as soon as it is there.`,
          level: "error",
        });
      }
      return;
    }
    startedRef.current = battleStartSeq;
    void runLaunch();
  }, [battleStartSeq, blockReason, canRun, runLaunch, t]);

  // What the header's main button does. Getting into a running match is never
  // automatic past the first launch: an engine that exited may have exited on
  // purpose, so going back has to be a deliberate click.
  const action = oaRun.running
    ? "ingame"
    : matchAction({
        selfHost: room.selfHost,
        hostIngame: room.hostIngame,
        presentAtStart: room.presentAtStart,
        launching,
        running: launch.running,
      });

  // Host start: flip our in-game flag (so joiners' clients auto-launch and connect),
  // launch the engine in host mode, then clear the flag once it exits. A joined
  // battle just asks its autohost to start.
  async function onStart() {
    if (oaHost) {
      await oaRun.start();
      return;
    }
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
        <h1 className="text-lg font-semibold">
          <Trans>Not in a battle</Trans>
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          <Trans>
            You're not currently in a battle. Browse open battles to join one.
          </Trans>
        </p>
        <Button onClick={() => navigate("/battles")}>
          <Trans>Browse battles</Trans>
        </Button>
      </main>
    );
  }

  const battle = room.battle;
  // Whether "Close battle" ends the room as well as the battle in it, which
  // decides both what the button does and what its confirmation promises.
  const endsTheRoom = closeEndsTheRoom({
    selfHost: room.selfHost,
    serverKey: room.serverKey,
    roomKey: hostedRoomKey(hostedRoom),
  });

  async function onLeave() {
    oaRun.cancel();
    // A battle in this client's own LAN room is the room, so the button that
    // closes one closes both (issue #2057). Not a leave followed by a stop: the
    // room's own "Stop room" drops this client first on purpose, and the two
    // buttons now do the same thing in the same order.
    if (endsTheRoom) {
      try {
        await stopHostedRoom(hostedRoom?.host ?? "", disconnectRoom);
      } catch (e) {
        // Said out here rather than in the room's own line, which is on the page
        // this is about to leave for and describes a room that is still up. The
        // "Stop room" button beside it is the way out.
        const reason = describeError(e);
        void notify({
          title: t`The room is still running`,
          body: t`Coilbox could not close it: ${reason}. Stop it from the Battles page.`,
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
        action={action}
        // Readiness is for the engine's own room. OA's has its own.
        allReady={oaHost || room.allReady}
        onToggleReady={room.setReady}
        onToggleSpectate={room.setSpectator}
        onLeave={onLeave}
        onStart={onStart}
        // Zero-K has to be asked where a running match is, and its answer
        // launches through `battleStartSeq` above.
        onJoinMatch={room.askForMatch ?? runLaunch}
        selfHost={room.selfHost}
        canStartDirectly={room.isFounder || room.iAmBoss}
        closesRoom={endsTheRoom}
        locked={battle.locked}
        onToggleLock={room.setLocked}
        // Same as the battle row on the Battles page: a room of our own is
        // reached over loopback and has no link to give from here (issue
        // #1615), somebody else's is passed on as the address we dialled it on
        // (issue #1617), and a server is passed on as a battle to join.
        serverKey={room.serverKey}
        directRoom={room.directRoom}
        // The addresses to hand out, from the moment the room is up. Only in
        // the battle inside our own room, which is the one `endsTheRoom` names.
        sharedRoom={endsTheRoom ? hostedRoom : null}
        connectionLabel={connectionLabelIfSeveral(
          room.serverKey,
          connections,
          servers,
        )}
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

      {(launch.error ?? oaRun.error) && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {launch.error ?? oaRun.error}
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
      {/* Named the moment we know, not at launch. Once a match we were here for
          has started the same fact is reworded, because by then it is running
          without us and sitting still needs explaining. Our own in-game flag is
          not that, so a self-hosted room never says it, and neither does a room
          we walked into mid-match, where nothing was ever going to launch. */}
      {block && (
        <p className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          {room.presentAtStart && !room.selfHost
            ? startedWithoutYou(block)
            : block.reason}
        </p>
      )}
      {/* After the missing-content strip, which stops the match. This one only
          costs the player some widgets (issue #1292). */}
      <RoomWidgetsWarning
        widgets={playerWidgets}
        scriptTags={battle.scriptTags}
        spectating={room.myStatus ? !room.myStatus.battleStatus.mode : false}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={split.columnRef}
          className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
        >
          <div
            ref={split.tableRef}
            id={split.tableId}
            style={split.tableStyle}
            className={cn(
              "flex min-h-24 flex-col [&>*]:grow",
              split.tableClass,
            )}
          >
            <BattleMembersTable
              serverKey={room.serverKey}
              markFor={markFor}
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
          </div>
          <RoomSplitHandle {...split.handle} />
          <BattleChatCard
            serverKey={room.serverKey}
            markFor={markFor}
            battle={battle}
            enginePath={room.enginePath}
            dataDir={room.dataDir}
            maps={room.maps}
            canChangeMap={room.canChangeMap}
            onChangeMap={room.setMap}
            selfHost={room.selfHost}
            directRoom={room.directRoom}
            rows={room.rows}
            hostControls={room.hostControls}
            onSetBattleStatusBatch={room.setBattleStatusBatch}
            onSetLocked={room.setLocked}
          />
        </div>

        <aside className="w-[var(--battle-sidebar-width)] shrink-0 space-y-4 overflow-y-auto border-l border-border p-4">
          <BattleMapCard
            key={room.contentNonce}
            battle={battle}
            rows={room.rows}
            enginePath={room.enginePath}
            dataDir={room.dataDir}
            game={room.localGame}
            maps={room.maps}
            mapsLoading={room.mapsLoading}
            localMap={room.localMap}
            mapMissing={room.mapMissing}
            startPosType={room.startPosType}
            canChangeMap={room.canChangeMap}
            canEditBoxes={room.canEditBoxes}
            activeAlly={boxAllies.activeAlly}
            onSetBox={room.setStartBox}
            onClearBox={room.clearStartBox}
            onSuggestMap={room.suggestMap}
            onChangeMap={room.setMap}
            onRescan={room.rescan}
          />
          {/* One door to the preset library, the same sheet Singleplayer opens.
              Saving this battle as a replayable skirmish (other humans become
              AIs) lives inside it, along with importing and the hub, rather than
              as separate buttons out here. Distinct from the host-only "Option
              presets" below, which stores only mod/map options. */}
          {room.canEditOptions && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setApplyPresetOpen(true)}
              >
                <Bookmark className="size-4" /> <Trans>Presets</Trans>
              </Button>
              <ApplySkirmishPresetDrawer
                open={applyPresetOpen}
                onOpenChange={setApplyPresetOpen}
                // Every preset, not just this game's. The panel blocks the
                // game-keyed parts itself, and an exact game-name match (version
                // and all) showed an empty list far more often than it helped.
                presets={skirmishPresets.presets}
                gameName={battle.modname}
                enginePath={room.enginePath}
                dataDir={room.dataDir}
                archive={room.localGame?.primaryArchive.name}
                scanFailure={room.contentUnreadableReason}
                canEditRestrictions={room.canEditRestrictions}
                modOptionsSchema={room.modOptionsSchema}
                // Through the same route every other option takes, so a
                // bot-hosted room gets the paced !bSet run rather than a
                // second copy of it.
                onApplyTweaks={(slots) => {
                  const tags: Record<string, string> = {};
                  for (const [key, value] of Object.entries(slots))
                    tags[`game/modoptions/${key}`] = value;
                  void room.applyOptionTags(tags);
                }}
                selfHost={room.selfHost}
                delivery={room.presetDelivery}
                currentMapName={battle.map}
                currentStartPosType={room.startPosType}
                scriptTags={battle.scriptTags}
                onApply={applySkirmishPresetInPlace}
                saveLabel={t`Save this battle`}
                onSave={(name) => {
                  const draft = battleToSkirmishDraft({
                    battle,
                    me: room.me,
                    sides: room.sides,
                    ais: skirmishAis,
                  });
                  if (!draft) {
                    notify({
                      title: t`Couldn't save preset`,
                      body: t`This battle can't be captured yet.`,
                      level: "error",
                    });
                    return;
                  }
                  skirmishPresets.savePreset(name, draft);
                  notify({
                    title: t`Saved to Singleplayer presets`,
                    body: t`"${name}" — replay it from Singleplayer → Presets.`,
                    level: "success",
                  });
                }}
                onImport={presetImport.importFromFile}
                onSaveFromReplay={(name, draft) => {
                  skirmishPresets.savePreset(name, draft);
                  notify({
                    title: t`Saved to Singleplayer presets`,
                    body: t`"${name}" — replay it from Singleplayer → Presets.`,
                    level: "success",
                  });
                }}
                onBrowseHub={() => {
                  setApplyPresetOpen(false);
                  navigate("/hub?kind=preset");
                }}
              />
              {/* An imported preset names a game and a map this machine may not
                  have, so it waits behind the same content check Singleplayer
                  puts it behind. */}
              <PresetImportGate
                pending={presetImport.pending}
                target={room.target ?? undefined}
                targetLoading={room.targetLoading}
                onCancel={() => presetImport.setPending(null)}
                onContinue={(p) => {
                  skirmishPresets.savePreset(
                    p.name?.trim() || t`Imported preset`,
                    p,
                  );
                  presetImport.setPending(null);
                }}
              />
            </>
          )}
          {!room.startPositionsUnavailable && (
            <StartPosOptions
              battle={battle}
              canEdit={room.canEditOptions}
              sendOption={room.sendOption}
              note={startPosNote({
                startPosType: room.startPosType,
                hasBoxes: Object.keys(battle.startRects).length > 0,
                canEditBoxes: room.canEditBoxes,
              })}
            >
              {room.canEditBoxes && (
                <StartBoxControls
                  mapName={battle.map}
                  rects={battle.startRects}
                  allyList={boxAllies.allyList}
                  activeAlly={boxAllies.activeAlly}
                  onPickAlly={boxAllies.pickAlly}
                  onSetBox={room.setStartBox}
                  onClearBox={room.clearStartBox}
                />
              )}
            </StartPosOptions>
          )}
          <BattleOptionsDrawer
            battle={battle}
            modOptionsSchema={room.modOptionsSchema}
            mapOptionsSchema={room.mapOptionsSchema}
            canEdit={room.canEditOptions}
            gameMissing={room.gameMissing}
            mapMissing={room.mapMissing}
            sendOption={room.sendOption}
            sendOptions={room.sendOptions}
            sendOptionsPaced={!room.isFounder}
            delivery={room.presetDelivery}
            canEditRestrictions={room.canEditRestrictions}
            restrictionsUnavailable={room.restrictionsUnavailable}
            startPositionsUnavailable={room.startPositionsUnavailable}
            onRestrictChange={room.setRestrictions}
          />
          {room.gameMissing && (
            <MissingContentCard
              battleId={battle.id}
              gameName={room.requiredGame ?? battle.modname}
              onRescan={room.rescan}
            />
          )}
          <CompatBattleCard state={room.compat} onRetry={room.retryCompat} />
          {room.isFounder &&
            room.compat.status === "idle" &&
            room.compatBaseArchive &&
            room.enginePath &&
            room.dataDir && (
              <CompatHostExport
                enginePath={room.enginePath}
                dataDir={room.dataDir}
                baseArchive={room.compatBaseArchive}
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
            directRoom={room.directRoom}
            hostControls={room.hostControls}
            onSetBattleStatusBatch={room.setBattleStatusBatch}
            onAutohostSend={room.autohostSend}
          />
          {/* The `!`-command panel is mostly for somebody who isn't hosting
              the battle themselves: self-hosted, those commands are inert
              (lock moves to the header, map changes go through the map card)
              and only Ring unready is left, which the founder's own client
              answers. A direct room runs no SPADS, so here it reads as
              requests the founder answers in the battle chat rather than
              commands a bot answers (issue #2871, replacing #2738's outright
              hiding of this panel there). */}
          <AutohostControls
            locked={battle.locked}
            directRoom={room.directRoom}
            selfHost={room.selfHost}
            onCommand={room.autohostSend}
            onRing={() => room.hostControls.ring()}
          />
          {!oaHost && (
            <>
              <BattleGameCard
                enginePath={room.enginePath}
                dataDir={room.dataDir}
                game={room.localGame}
                gameName={battle.modname}
              />
              <BattleEngineCard
                battleId={battle.id}
                match={engine}
                version={battle.version}
                target={room.target}
                onInstalled={room.refreshTarget}
                unreadable={room.engineUnreadable}
              />
            </>
          )}
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
