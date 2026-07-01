import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncMinimap,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "@/content/config";
import { type LaunchEvent, playLaunch } from "../bindings";
import {
  aiKey,
  defaultAi,
  initialParticipants,
  makeAiParticipant,
  type Participant,
  rgbToHex,
  toBattleConfig,
  useLastAi,
  usePreferredTarget,
  useSkirmishAis,
} from "../config";
import { useSkirmishDraft } from "../drafts";
import { GameOptionsPanel } from "./components/GameOptionsPanel";
import { GameSelectCard } from "./components/GameSelectCard";
import { MapCard } from "./components/MapCard";
import { ParticipantsTable } from "./components/ParticipantsTable";

/** Basic singleplayer (skirmish) launcher: pick a game, map and opponents, then
 * launch the engine. Uses the preferred engine silently (no picker). */
export default function SkirmishPage() {
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const sides = gameInfo.info?.sides ?? [];
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
      });
    }, 400);
    return () => clearTimeout(id);
  }, [
    participants,
    gameName,
    mapName,
    startPosType,
    modOptionValues,
    setDraft,
  ]);

  const activeColors = useMemo(
    () =>
      participants
        .filter((p) => !(p.kind === "you" && p.spectator))
        .map((p) => rgbToHex(p.color)),
    [participants],
  );

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
    setParticipants((ps) =>
      ps.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };
  const removeParticipant = (id: string) =>
    setParticipants((ps) => ps.filter((p) => p.id !== id));
  const addAi = () =>
    setParticipants((ps) => [
      ...ps,
      makeAiParticipant(ps, sides[0]?.name ?? "", defaultAi(lastAi, ais)),
    ]);

  async function onStart() {
    if (!target || !selectedGame || !selectedMap) return;
    setRunning(true);
    setError(null);
    const onEvent = new Channel<LaunchEvent>();
    // The authoritative unfreeze is playLaunch resolving; the channel is unused
    // here beyond keeping the "running" state honest.
    onEvent.onmessage = () => {};
    try {
      // Only send options the user actually changed from their default; the
      // engine applies the rest.
      const overrides: Record<string, string> = {};
      for (const o of modOptions) {
        const v = modOptionValues[o.key];
        if (v !== undefined && v !== (o.default ?? "")) overrides[o.key] = v;
      }
      const config = toBattleConfig({
        participants,
        mapName: selectedMap.name,
        gameType: selectedGame.name,
        startPosType,
        modOptions: overrides,
      });
      const res = await playLaunch({
        config,
        executable: target.executable,
        dataDir: target.dataDir,
        runId: crypto.randomUUID(),
        onEvent,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Singleplayer</h1>
        <Button onClick={onStart} disabled={!canStart}>
          <Play className="size-4" /> {running ? "Game running…" : "Start Game"}
        </Button>
      </header>

      {!target && !scan.loading && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          No engine found. Add a content folder with an engine in{" "}
          <span className="font-medium">Settings → Content Folders</span> first.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {running && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          Game running — settings are frozen until the engine exits.
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-5">
          <ParticipantsTable
            participants={participants}
            sides={sides}
            ais={ais}
            disabled={running}
            onUpdate={updateParticipant}
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
          />
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
