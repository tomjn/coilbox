import { Button } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Bookmark, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncMinimap,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "@/content/config";
import { useFactionLogos } from "@/factions/logos";
import { useMyTeamColor } from "@/lib/useMyTeamColor";
import type { BattleConfig } from "../bindings";
import { playExportPreset, playImportPreset } from "../bindings";
import {
  aiKey,
  applyRestrictions,
  defaultAi,
  initialParticipants,
  makeAiParticipant,
  type Participant,
  rgbToHex,
  sanitizeColors,
  toBattleConfig,
  useLastAi,
  usePreferredTarget,
  useSkirmishAis,
} from "../config";
import { type BattleRestrictions, useSkirmishDraft } from "../drafts";
import { effectiveOptions } from "../modOptions";
import { usePlay } from "../PlayProvider";
import {
  parsePresetJson,
  type SkirmishPreset,
  useSkirmishPresets,
} from "../presets";
import { GameOptionsPanel } from "./components/GameOptionsPanel";
import { GameSelectCard } from "./components/GameSelectCard";
import { MapCard } from "./components/MapCard";
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
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const { running, launch } = usePlay();

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

  const activeColors = useMemo(
    () =>
      participants
        .filter((p) => !(p.kind === "you" && p.spectator))
        .map((p) => rgbToHex(p.color)),
    [participants],
  );

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
      makeAiParticipant(ps, sides[0]?.name ?? "", defaultAi(lastAi, ais)),
    ]);

  // Derive the engine `BattleConfig` from the current setup, or null if a game
  // or map isn't selected yet. Shared by launch and export so they never drift.
  function buildConfig(): BattleConfig | null {
    if (!selectedGame || !selectedMap) return null;
    // Disabled units render into `[RESTRICT]` via `toBattleConfig`; the team-0
    // perk levers are re-applied afterwards. Both no-op for a hand-built setup.
    return applyRestrictions(
      toBattleConfig({
        participants,
        mapName: selectedMap.name,
        gameType: selectedGame.name,
        startPosType,
        modOptions: effectiveOptions(modOptions, modOptionValues),
        disabledUnits: restrictions?.disabledUnits,
      }),
      restrictions,
    );
  }

  async function onStart() {
    if (!target) return;
    const config = buildConfig();
    if (!config) return;
    setError(null);
    try {
      const res = await launch("skirmish", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const saveCurrentPreset = (name: string): SkirmishPreset =>
    savePreset(name, {
      participants,
      gameName,
      mapName,
      startPosType,
      modOptionValues,
      restrictions,
    });

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
      await playExportPreset({ json: JSON.stringify(preset, null, 2), dest });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Import a shared preset file: read it, validate the shape, then add it as a
  // new preset (fresh id/timestamps via savePreset) without touching the current
  // setup.
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
      savePreset(parsed.name?.trim() || "Imported preset", parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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
          <Button
            variant="outline"
            onClick={() => setPresetsOpen(true)}
            disabled={running}
          >
            <Bookmark className="size-4" /> Presets
          </Button>
          <Button onClick={onStart} disabled={!canStart}>
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
        disabled={running}
      />

      {!target && !scan.loading && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          No engine found. Add a content folder with an engine in{" "}
          <span className="font-medium">Settings → Content Folders</span> first.
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
