import { Button } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Bookmark, History, Play, Swords } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { encodeContainerJson } from "@/container/container";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncMinimap,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "@/content/config";
import { ResolveContentGate } from "@/content/pages/components/ResolveContentDrawer";
import {
  exactGameRequirement,
  exactMapRequirement,
} from "@/content/resolveContent";
import { useFactionLogos } from "@/factions/logos";
import { mostRecentOpen } from "@/lib/recency";
import { useMyTeamColor } from "@/lib/useMyTeamColor";
import { notify } from "@/notify/notify";
import { contentListReplays } from "../../content/bindings";
import { useReplayUserState } from "../../content/replayUserState";
import { useImportParam } from "../../deeplink/useImportParam";
import type { BattleConfig } from "../bindings";
import { playExportPreset, playImportPreset } from "../bindings";
import {
  aiKey,
  applyRestrictions,
  defaultAi,
  effectiveTeams,
  initialParticipants,
  makeAiParticipant,
  type Participant,
  RANDOM_SIDE,
  resolveRandomSides,
  rgbToHex,
  sanitizeColors,
  setParticipantTeam,
  toBattleConfig,
  useLastAi,
  usePreferredTarget,
  useSkirmishAis,
} from "../config";
import { bumpAiHandicap } from "../debrief";
import {
  type BattleRestrictions,
  type SkirmishDraft,
  useSkirmishDraft,
} from "../drafts";
import { effectiveOptions } from "../modOptions";
import { usePlay } from "../PlayProvider";
import {
  PRESET_KIND_VERSION,
  parsePresetJson,
  type SkirmishPreset,
  useSkirmishPresets,
} from "../presets";
import { useSkirmishDebrief } from "../useSkirmishDebrief";
import { DebriefDrawer } from "./components/DebriefDrawer";
import { GameOptionsPanel } from "./components/GameOptionsPanel";
import { GameSelectCard } from "./components/GameSelectCard";
import { MapCard } from "./components/MapCard";
import {
  MapLayerToggle,
  MapOverlayImage,
  useMapOverlayLayer,
} from "./components/MapOverlay";
import { ParticipantsTable } from "./components/ParticipantsTable";
import { PresetsDrawer } from "./components/PresetsDrawer";

/** A human summary of a loaded preset's faithful-replay restrictions, for the
 * banner that makes an otherwise-invisible disabled-unit/perk set visible. */
function restrictionSummary(r: BattleRestrictions): string {
  const parts: string[] = [];
  const units = r.disabledUnits?.length ?? 0;
  if (units > 0) parts.push(`${units} unit${units === 1 ? "" : "s"} disabled`);
  if (r.advantage) parts.push(`+${Math.round(r.advantage * 100)}% advantage`);
  if (r.incomeMultiplier)
    parts.push(`+${Math.round(r.incomeMultiplier * 100)}% income`);
  return parts.length > 0
    ? `Restricted battle — ${parts.join(" · ")}`
    : "Restricted battle";
}

/** Basic singleplayer (skirmish) launcher: pick a game, map and opponents, then
 * launch the engine. Uses the preferred engine silently (no picker). */
export default function SkirmishPage() {
  const navigate = useNavigate();
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const { running, launch } = usePlay();
  const { setProvenance } = useReplayUserState();
  const {
    debrief,
    open: debriefOpen,
    checking: checkingResult,
    setOpen: setDebriefOpen,
    resolve: resolveDebrief,
    markUndetectable,
    reset: resetDebrief,
  } = useSkirmishDebrief();

  const scan = useUnitsyncScan(enginePath, dataDir);
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);
  const { headers: gameHeaders } = useUnitsyncGameHeaders(enginePath, dataDir);

  // Seed from the persisted draft so the setup (game, map, opponents, options)
  // survives navigation and restarts. The debounced effect below writes it back.
  const [draft, setDraft] = useSkirmishDraft();
  const [participants, setParticipants] = useState<Participant[]>(() =>
    draft.participants.length > 0 ? draft.participants : initialParticipants(),
  );
  const [gameName, setGameName] = useState(() => draft.gameName);
  const [mapName, setMapName] = useState(() => draft.mapName);
  const [startPosType, setStartPosType] = useState(() => draft.startPosType);
  const [modOptionValues, setModOptionValues] = useState<
    Record<string, string>
  >(() => draft.modOptionValues);
  // Faithful-replay restrictions carried by a loaded conquest/warpath/MP preset
  // (disabled units + team-0 perks). Undefined for a hand-built skirmish. Held here
  // so `buildConfig` re-applies them on launch and the banner can show/clear them.
  const [restrictions, setRestrictions] = useState<
    BattleRestrictions | undefined
  >(() => draft.restrictions);
  const [error, setError] = useState<string | null>(null);

  const [presetsOpen, setPresetsOpen] = useState(false);
  const { presets, savePreset, touchPreset, removePreset } =
    useSkirmishPresets();

  // The single most recently used preset (issue #374's "continue playing"
  // affordance): a compact header button, mirroring the login panel's
  // "Reconnect as ..." shortcut, that loads it back into the working setup.
  const mostRecentPreset = useMemo(
    () =>
      mostRecentOpen(
        presets,
        () => true,
        (p) => Date.parse(p.lastUsedAt),
      ),
    [presets],
  );

  // The team colour remembered across surfaces (shared with the MP lobby via the
  // same setting key). Empty = never picked.
  const [myColor, setMyColor] = useMyTeamColor();

  // One-shot heal on mount: a stale persisted draft (or older seeding) can leave
  // a participant — usually "you" — as black. Replace any black/invalid colour
  // with the remembered/non-black pick so the setup never opens showing black.
  const sanitized = useRef(false);
  useEffect(() => {
    if (sanitized.current) return;
    sanitized.current = true;
    setParticipants((ps) => sanitizeColors(ps, myColor));
  }, [myColor]);

  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];
  const selectedGame = games.find((g) => g.name === gameName) ?? null;
  // Fall back to the first map so a map is shown the instant maps load, without
  // waiting for the auto-pick effect below to commit `mapName`.
  const selectedMap = maps.find((m) => m.name === mapName) ?? maps[0] ?? null;
  const gameArchive = selectedGame?.primaryArchive.name;
  // Still scanning and nothing to show yet — the map card shows a spinner.
  const mapsLoading = scan.loading && maps.length === 0;
  const gamesLoading = scan.loading && games.length === 0;

  const gameInfo = useUnitsyncGameInfo(enginePath, dataDir, gameArchive);
  const { ais } = useSkirmishAis(enginePath, dataDir, gameArchive);
  const [lastAi, setLastAi] = useLastAi();
  const minimap = useUnitsyncMinimap(enginePath, dataDir, selectedMap?.name);
  const overlay = useMapOverlayLayer(enginePath, dataDir, selectedMap?.name);
  // Overlays only make sense once a map is selected and its minimap resolves.
  const canOverlay = !!selectedMap && !!minimap.dataUrl;
  const sides = gameInfo.info?.sides ?? [];
  const factionLogos = useFactionLogos({
    game: selectedGame ?? undefined,
    enginePath,
    dataDir,
    gameArchive,
    sideNames: sides.map((s) => s.name),
  });
  const modOptions = gameInfo.info?.options ?? [];

  // Default the game/map selections to the first available once a scan lands.
  useEffect(() => {
    if (games.length > 0)
      setGameName((cur) =>
        games.some((g) => g.name === cur) ? cur : games[0].name,
      );
  }, [games]);
  useEffect(() => {
    if (maps.length > 0)
      setMapName((cur) =>
        maps.some((m) => m.name === cur) ? cur : maps[0].name,
      );
  }, [maps]);

  // Mod options are per-game; reset entered values when the user switches game.
  // Guard against the initial undefined -> defined transition as the scan lands,
  // which is hydration (game restored from the draft), not a real switch — that
  // would otherwise wipe the mod options we just restored.
  const prevArchive = useRef(gameArchive);
  useEffect(() => {
    const prev = prevArchive.current;
    prevArchive.current = gameArchive;
    if (prev !== undefined && gameArchive !== undefined && prev !== gameArchive)
      setModOptionValues({});
  }, [gameArchive]);

  // Normalise participant factions to a valid side once the game's sides load.
  useEffect(() => {
    if (sides.length === 0) return;
    const valid = new Set(sides.map((s) => s.name));
    setParticipants((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        // Keep the Random sentinel — it resolves to a real side at launch.
        if (p.side === RANDOM_SIDE) return p;
        if (!valid.has(p.side)) {
          changed = true;
          return { ...p, side: sides[0].name };
        }
        return p;
      });
      return changed ? next : ps;
    });
  }, [sides]);

  // Auto-select the last AI the user picked for any still-empty AI slot (the
  // default opponent, or one added before the AI list had loaded). Restored
  // participants already carry their `ai`, so this only fills genuine blanks.
  useEffect(() => {
    const preset = defaultAi(lastAi, ais);
    if (!preset) return;
    setParticipants((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        if (p.kind === "ai" && !p.ai) {
          changed = true;
          return { ...p, ai: preset };
        }
        return p;
      });
      return changed ? next : ps;
    });
  }, [lastAi, ais]);

  // Persist the working draft (debounced — one write after edits settle, not per
  // keystroke). Transient run state (running/error) is intentionally excluded.
  useEffect(() => {
    const id = setTimeout(() => {
      setDraft({
        participants,
        gameName,
        mapName,
        startPosType,
        modOptionValues,
        restrictions,
      });
    }, 400);
    return () => clearTimeout(id);
  }, [
    participants,
    gameName,
    mapName,
    startPosType,
    modOptionValues,
    restrictions,
    setDraft,
  ]);

  // Minimap marker colours in *team* order (leader colour per team), so under
  // fixed start positions marker N shows who actually spawns at position N.
  const activeColors = useMemo(() => {
    const byId = new Map(participants.map((p) => [p.id, p]));
    const { leaderIdByTeam } = effectiveTeams(participants);
    return leaderIdByTeam.flatMap((id) => {
      const p = byId.get(id);
      return p ? rgbToHex(p.color) : [];
    });
  }, [participants]);

  const you = participants.find((p) => p.kind === "you");
  const activeCount = participants.filter(
    (p) => !(p.kind === "you" && p.spectator),
  ).length;
  const aiRowsReady = participants
    .filter((p) => p.kind === "ai")
    .every((p) => !!p.ai);
  const canStart =
    !!target &&
    !!selectedGame &&
    !!selectedMap &&
    activeCount >= 2 &&
    aiRowsReady &&
    !running;

  const updateParticipant = (id: string, patch: Partial<Participant>) => {
    // Remember an explicit AI pick so later opponents default to it.
    if (patch.ai) setLastAi(aiKey(patch.ai));
    // Mirror MP's setColor: when "you" recolours, remember it so the colour stays
    // in sync across both surfaces. patch.color is play float RGB -> hex core.
    if (patch.color && participants.find((p) => p.id === id)?.kind === "you")
      setMyColor(rgbToHex(patch.color));
    setParticipants((ps) =>
      ps.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };
  const removeParticipant = (id: string) =>
    setParticipants((ps) => ps.filter((p) => p.id !== id));
  const addAi = () =>
    setParticipants((ps) => [
      ...ps,
      makeAiParticipant(ps, RANDOM_SIDE, defaultAi(lastAi, ais)),
    ]);

  // Derive the engine `BattleConfig` from the current setup, or null if a game
  // or map isn't selected yet. Shared by launch and export so they never drift.
  // `parts` defaults to the live participants so callers only need to pass an
  // override when launching a tweaked roster (see "Rematch with a tweak"),
  // where a freshly-computed array must be used instead of stale state.
  function buildConfig(
    parts: Participant[] = participants,
  ): BattleConfig | null {
    if (!selectedGame || !selectedMap) return null;
    // Roll each Random-faction bot to a concrete side here, at the impure launch
    // boundary, so the start script gets a real side and each Random AI rolls
    // independently. The participant model stays free of randomness (issue #332).
    const resolved = resolveRandomSides(parts, sides);
    // Disabled units render into `[RESTRICT]` via `toBattleConfig`; the team-0
    // perk levers are re-applied afterwards. Both no-op for a hand-built setup.
    return applyRestrictions(
      toBattleConfig({
        participants: resolved,
        mapName: selectedMap.name,
        gameType: selectedGame.name,
        startPosType,
        modOptions: effectiveOptions(modOptions, modOptionValues),
        disabledUnits: restrictions?.disabledUnits,
      }),
      restrictions,
    );
  }

  // The current setup as a launchable/saveable `SkirmishDraft` — shared by
  // "Save current setup", the debrief's "Save as preset", and (implicitly)
  // the persisted draft effect above.
  const currentDraft = (): SkirmishDraft => ({
    participants,
    gameName,
    mapName,
    startPosType,
    modOptionValues,
    restrictions,
  });

  // "Host as battle" (issue #373): take a skirmish draft (the current setup, or
  // a saved preset from the drawer) online. A draft's game or map might not be
  // installed locally at all (a preset saved on another machine, or an old one
  // whose content moved). `HostBattlePopover` only ever offers installed
  // games/maps, so hosting one that isn't would silently open a battle for a
  // different game. Gate on the resolve-content flow (#387) first. Only once
  // both are confirmed installed does this navigate to the Battles hub with
  // the draft to seed (`BattlesPage`/`BattleRoomPage` carry it the rest of the
  // way). Not connected yet, or not logged in? `/battles` itself already
  // prompts to connect (same as the content map detail's "Host a battle here"),
  // so nothing extra is needed here.
  const [pendingHost, setPendingHost] = useState<{
    draft: SkirmishDraft;
    title: string;
  } | null>(null);

  function hostAsBattle(draft: SkirmishDraft, title: string) {
    const installed =
      games.some((g) => g.name === draft.gameName) &&
      maps.some((m) => m.name === draft.mapName);
    if (installed) {
      navigate("/battles", { state: { hostDraft: draft, hostTitle: title } });
      return;
    }
    setPendingHost({ draft, title });
  }

  async function onStart(parts: Participant[] = participants) {
    if (!target) return;
    const config = buildConfig(parts);
    if (!config) return;
    setError(null);
    resetDebrief();
    // Snapshot the replays that exist before the engine runs, so any new file
    // afterwards can be tagged as a skirmish (and, on exit, decoded for the
    // debrief's outcome/duration — see `useSkirmishDebrief`). Best-effort: a
    // failure here just disables tagging/detection, never the launch itself.
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    try {
      const res = await launch("skirmish", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
      // Cancelled before the game started: nothing to debrief.
      if (res.exitCode === null) return;
      if (!beforePaths) {
        markUndetectable();
        return;
      }
      await resolveDebrief({
        target,
        beforePaths,
        playerName: config.myPlayerName,
        setProvenance,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const onRematch = () => {
    onStart();
  };

  // "Rematch with a tweak" (#370, keeping #354's richer per-AI control
  // separate): nudge every AI's handicap by a fixed delta, persist it onto the
  // visible setup, and relaunch. The tweaked array is threaded through
  // explicitly rather than read back from `participants` — `setParticipants`
  // hasn't committed by the time `onStart` would otherwise read it.
  const onRematchWithTweak = (deltaPercent: number) => {
    const tweaked = bumpAiHandicap(participants, deltaPercent);
    setParticipants(tweaked);
    onStart(tweaked);
  };

  const saveCurrentPreset = (name: string): SkirmishPreset =>
    savePreset(name, currentDraft());

  // "New preset from replay…" (#368): save straight into the presets library,
  // leaving the current setup on the page untouched.
  const saveFromReplay = (name: string, draft: SkirmishDraft) => {
    savePreset(name, draft);
    notify({
      title: "Saved to Singleplayer presets",
      body: `"${name}" — replay it from Singleplayer → Presets.`,
      level: "success",
    });
  };

  const loadPreset = (p: SkirmishPreset) => {
    // The mod-option reset effect wipes values whenever the game archive changes
    // to a different defined value. Pre-seed `prevArchive` to the incoming game's
    // archive so restoring a preset for a different game doesn't discard the
    // preset's own mod options (mirrors the initial draft-hydration escape).
    prevArchive.current = games.find(
      (g) => g.name === p.gameName,
    )?.primaryArchive.name;
    setParticipants(p.participants);
    setGameName(p.gameName);
    setMapName(p.mapName);
    setStartPosType(p.startPosType);
    setModOptionValues(p.modOptionValues);
    setRestrictions(p.restrictions);
    touchPreset(p.id);
  };

  // Share a preset: serialize it and write to a file the user picks. The write
  // goes through the plugin (no frontend fs plugin), mirroring the start-script
  // export above.
  async function onExportPreset(preset: SkirmishPreset) {
    setError(null);
    try {
      const dest = await save({
        title: "Export preset",
        defaultPath: `${preset.name || "preset"}.json`,
        filters: [{ name: "Coilbox preset", extensions: ["json"] }],
      });
      if (!dest) return;
      await playExportPreset({
        json: encodeContainerJson("preset", PRESET_KIND_VERSION, preset),
        dest,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Import a shared preset file: read it, validate the shape, then — once its
  // game and map are confirmed installed (or downloaded, #387) — add it as a
  // new preset (fresh id/timestamps via savePreset) without touching the
  // current setup.
  const [pendingPreset, setPendingPreset] = useState<
    (SkirmishDraft & { name?: string }) | null
  >(null);

  async function onImportPreset() {
    setError(null);
    try {
      const src = await open({
        title: "Import preset",
        multiple: false,
        filters: [{ name: "Coilbox preset", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      const { json } = await playImportPreset({ src });
      const parsed = parsePresetJson(json);
      if (!parsed) {
        setError("That file isn't a valid coilbox preset.");
        return;
      }
      setPendingPreset(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // A confirmed `coilbox://import` deep link (issue #388) lands here with a
  // preset code in the query string. Decode it with the same validator as a file
  // import, then hand off to the content-resolution gate below.
  const presetImportCode = useImportParam();
  useEffect(() => {
    if (!presetImportCode) return;
    const parsed = parsePresetJson(presetImportCode);
    if (!parsed) {
      setError("That link isn't a valid coilbox preset.");
      return;
    }
    setPendingPreset(parsed);
  }, [presetImportCode]);

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Singleplayer</h1>
        <div className="flex items-center gap-4">
          {you && (
            <label
              htmlFor="spectate-you"
              className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
            >
              <Switch
                id="spectate-you"
                checked={you.spectator}
                disabled={running}
                onCheckedChange={(v) =>
                  updateParticipant(you.id, { spectator: v === true })
                }
              />
              Spectate
            </label>
          )}
          {mostRecentPreset && (
            <Button
              variant="outline"
              onClick={() => loadPreset(mostRecentPreset)}
              disabled={running}
            >
              <History className="size-4" /> Continue: {mostRecentPreset.name}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setPresetsOpen(true)}
            disabled={running}
          >
            <Bookmark className="size-4" /> Presets
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              hostAsBattle(currentDraft(), `${gameName || "Skirmish"} (hosted)`)
            }
            disabled={running || !selectedGame || !selectedMap}
          >
            <Swords className="size-4" /> Host as battle
          </Button>
          <Button onClick={() => onStart()} disabled={!canStart}>
            <Play className="size-4 fill-current" />{" "}
            {running ? "Game running…" : "Start Game"}
          </Button>
        </div>
      </header>

      <PresetsDrawer
        open={presetsOpen}
        onOpenChange={setPresetsOpen}
        presets={presets}
        thumbs={thumbs}
        onLoad={loadPreset}
        onSave={saveCurrentPreset}
        onDelete={removePreset}
        onExportPreset={onExportPreset}
        onImport={onImportPreset}
        onSaveFromReplay={saveFromReplay}
        onHostAsBattle={(p) => hostAsBattle(p, p.name)}
        disabled={running}
      />

      {pendingPreset && (
        <ResolveContentGate
          title="Set up this preset"
          requirements={[
            exactGameRequirement(pendingPreset.gameName),
            exactMapRequirement(pendingPreset.mapName),
          ]}
          target={target ?? undefined}
          onContinue={() => {
            savePreset(
              pendingPreset.name?.trim() || "Imported preset",
              pendingPreset,
            );
            setPendingPreset(null);
          }}
          onCancel={() => setPendingPreset(null)}
        />
      )}

      {pendingHost && (
        <ResolveContentGate
          title="Set up this battle for hosting"
          requirements={[
            exactGameRequirement(pendingHost.draft.gameName),
            exactMapRequirement(pendingHost.draft.mapName),
          ]}
          target={target ?? undefined}
          onContinue={() => {
            navigate("/battles", {
              state: {
                hostDraft: pendingHost.draft,
                hostTitle: pendingHost.title,
              },
            });
            setPendingHost(null);
          }}
          onCancel={() => setPendingHost(null)}
        />
      )}

      <DebriefDrawer
        open={debriefOpen}
        onOpenChange={setDebriefOpen}
        debrief={debrief}
        onRematch={onRematch}
        onRematchWithTweak={onRematchWithTweak}
        getDraft={currentDraft}
        defaultPresetName={
          selectedMap ? `Rematch: ${selectedMap.name}` : "Rematch"
        }
        disabled={!canStart}
      />

      {!target && !scan.loading && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          No engine found. Add a content folder with an engine in{" "}
          <Link
            className="font-medium underline underline-offset-4"
            to="/settings/content-folders"
          >
            Settings → Content Folders
          </Link>{" "}
          first.
        </p>
      )}

      {error && (
        <Alert variant="destructive" className="p-3">
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {running && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          Game running — settings are frozen until the engine exits.
        </p>
      )}

      {checkingResult && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          Checking match result…
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-5">
          {restrictions && (
            <Alert className="p-3">
              <AlertDescription className="flex items-center justify-between gap-3 text-sm">
                <span>{restrictionSummary(restrictions)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={running}
                  onClick={() => setRestrictions(undefined)}
                >
                  Clear
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <ParticipantsTable
            participants={participants}
            sides={sides}
            factionLogos={factionLogos}
            ais={ais}
            disabled={running}
            startPosType={startPosType}
            startPosCount={minimap.startPositions?.length}
            onUpdate={updateParticipant}
            onSetTeam={(id, team) =>
              setParticipants((ps) => setParticipantTeam(ps, id, team))
            }
            onRemove={removeParticipant}
            onAddAi={addAi}
          />
          <GameOptionsPanel
            selectedGame={selectedGame}
            startPosType={startPosType}
            onStartPosType={setStartPosType}
            options={modOptions}
            optionValues={modOptionValues}
            onOptionChange={(key, value) =>
              setModOptionValues((m) => ({ ...m, [key]: value }))
            }
            disabled={running}
          />
        </div>

        <div className="flex flex-col gap-5">
          <MapCard
            map={selectedMap}
            maps={maps}
            thumbs={thumbs}
            minimapDataUrl={minimap.dataUrl}
            startPositions={minimap.startPositions}
            minimapLoading={minimap.loading}
            markerColors={activeColors}
            env={minimap.env}
            mapsLoading={mapsLoading}
            onSelectMap={setMapName}
            disabled={running}
            dimBase={!!overlay.overlayUrl}
            overlay={
              overlay.overlayUrl ? (
                <MapOverlayImage src={overlay.overlayUrl} />
              ) : undefined
            }
          />
          {canOverlay && (
            <MapLayerToggle layer={overlay.layer} onChange={overlay.setLayer} />
          )}
          <GameSelectCard
            game={selectedGame}
            games={games}
            headers={gameHeaders}
            gamesLoading={gamesLoading}
            onSelectGame={setGameName}
            disabled={running}
          />
        </div>
      </div>
    </div>
  );
}
