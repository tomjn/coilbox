/**
 * The scenario's skirmish setup, edited in place: its game, its map, its
 * participants and its game options.
 *
 * Not a second launcher. Every control here is the singleplayer page's own
 * component ({@link GameSelectCard}, {@link MapCard}, {@link ParticipantsTable}
 * and {@link GameOptionsPanel}), wired to `scenario.setup` instead of to a
 * draft, so an author with no saved preset can give a scenario a game and a map,
 * and one with a preset can still start from it.
 *
 * One thing here is the scenario's own rather than the launcher's:
 * {@link StartConditions}, the document's `teams` block. It sits with the
 * participants because every field in it is keyed by a participant id.
 *
 * What is different is that a scenario is not just a launch payload. The map is
 * the space every coordinate is measured in, the game is what every unit def
 * resolves against, and a participant id is what actors, groups, prefabs and
 * `teams` entries are keyed on. So each of those three changes is asked about
 * first, and the asking says what it costs. The arithmetic behind it is
 * `setup.ts`.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { AlertTriangle, Bookmark, SlidersHorizontal } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PresetPickerDrawer } from "@/campaign/pages/components/PresetPickerDrawer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBrandingEntry } from "@/content/branding";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncMinimap,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "@/content/config";
import { useFactionLogos } from "@/factions/logos";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import {
  defaultAi,
  effectiveTeams,
  makeAiParticipant,
  type Participant,
  RANDOM_SIDE,
  rgbToHex,
  setParticipantTeam,
  useLastAi,
  usePreferredTarget,
  useSkirmishAis,
} from "@/play/config";
import { mergeGameAi } from "@/play/gameAi";
import { GameOptionsPanel } from "@/play/pages/components/GameOptionsPanel";
import { GameSelectCard } from "@/play/pages/components/GameSelectCard";
import { MapCard } from "@/play/pages/components/MapCard";
import { ParticipantsTable } from "@/play/pages/components/ParticipantsTable";
import { type SkirmishPreset, useSkirmishPresets } from "@/play/presets";
import { getProfile } from "@/profile/profile";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Scenario } from "../../model";
import { defsMissingFrom, unitDefsIn } from "../../validate";
import { EditorPanel } from "./panels";
import { StartConditions } from "./StartConditions";
import {
  applyPresetSetup,
  holdsNothing,
  type MapExtent,
  mapCost,
  mapExtent,
  participantHoldings,
  removeScenarioParticipant,
  scaleScenarioToMap,
  setScenarioGame,
  setScenarioMap,
} from "./setup";
import { startsSummary } from "./teams";
import { useGameUnits } from "./useGameUnits";

/**
 * How long the panel waits for an edit to settle before writing it.
 *
 * Every change to a scenario is a disk write and a step in the undo history, and
 * a colour picker fires as it is dragged, so the noisy controls are driven from
 * local state and the document is written once the author stops.
 */
const COMMIT_DELAY = 300;

/** A change to the setup that has to be asked about before it is made. */
type Pending =
  | { kind: "map"; mapName: string }
  | { kind: "game"; gameName: string }
  | { kind: "participant"; id: string }
  | { kind: "preset"; preset: SkirmishPreset };

/** "1 actor, 2 groups and a base", for saying what something holds. */
function list(parts: string[]): string {
  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** What a document has standing on its map, by kind: "1 zone and 2 actors". */
function placedList(scenario: Scenario): string {
  const kinds: [number, string][] = [
    [scenario.zones.length, "zone"],
    [scenario.actors.length, "actor"],
    [scenario.groups.length, "group"],
    [scenario.prefabs.length, "base"],
  ];
  return list(kinds.filter(([n]) => n > 0).map(([n, one]) => count(n, one)));
}

export function SetupPanel({
  scenario,
  onChange,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
}) {
  const drawer = useDrawer();
  const { presets } = useSkirmishPresets();
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const scan = useUnitsyncScan(enginePath, dataDir);
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);
  const { headers } = useUnitsyncGameHeaders(enginePath, dataDir);

  const { setup } = scenario;
  // Not coilbox's own generated games: the test mutator is written from the
  // scenario being edited, so setting it as that scenario's game would nest it
  // inside itself. One the scenario already names stays, or the setup would
  // call a game that is sitting in `games/` missing.
  const games = withoutGeneratedGames(scan.data?.games ?? [], setup.gameName);
  const maps = scan.data?.maps ?? [];
  // Deliberately not defaulted to the first of either: a scenario with no game
  // is a scenario whose author has not chosen one, and choosing for them would
  // write a game into the document nobody picked.
  const selectedGame = games.find((g) => g.name === setup.gameName) ?? null;
  const selectedMap = maps.find((m) => m.name === setup.mapName) ?? null;
  const gameArchive = selectedGame?.primaryArchive.name;

  const gameInfo = useUnitsyncGameInfo(enginePath, dataDir, gameArchive);
  const { ais } = useSkirmishAis(enginePath, dataDir, gameArchive);
  const [lastAi] = useLastAi();
  const minimap = useUnitsyncMinimap(enginePath, dataDir, selectedMap?.name);
  const sides = gameInfo.info?.sides ?? [];
  const modOptions = gameInfo.info?.options ?? [];
  const factionLogos = useFactionLogos({
    game: selectedGame ?? undefined,
    enginePath,
    dataDir,
    gameArchive,
    sideNames: sides.map((s) => s.name),
  });
  const brandingAi = useBrandingEntry(selectedGame ?? undefined)?.ai;
  const aiConfig = mergeGameAi(getProfile().ai, brandingAi);

  const [pending, setPending] = useState<Pending | null>(null);

  /* ---- The noisy controls, held locally and written once they settle. ---- */

  const [rows, setRows] = useState<Participant[]>(setup.participants);
  const [options, setOptions] = useState(setup.modOptionValues);
  // What was last written, so a change arriving from outside (an undo, a preset,
  // a game swap clearing the options) is told apart from this panel's own edit
  // coming back off disk.
  const written = useRef({
    participants: JSON.stringify(setup.participants),
    options: JSON.stringify(setup.modOptionValues),
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read at the moment the write happens rather than at the last render, so a
  // commit lands on the document as it is by then.
  const latest = useRef(scenario);
  latest.current = scenario;

  useEffect(() => {
    const incoming = JSON.stringify(setup.participants);
    if (incoming !== written.current.participants) {
      written.current.participants = incoming;
      setRows(setup.participants);
    }
  }, [setup.participants]);
  useEffect(() => {
    const incoming = JSON.stringify(setup.modOptionValues);
    if (incoming !== written.current.options) {
      written.current.options = incoming;
      setOptions(setup.modOptionValues);
    }
  }, [setup.modOptionValues]);

  const commit = useCallback(
    (participants: Participant[], modOptionValues: Record<string, string>) => {
      written.current = {
        participants: JSON.stringify(participants),
        options: JSON.stringify(modOptionValues),
      };
      const current = latest.current;
      onChange({
        ...current,
        setup: { ...current.setup, participants, modOptionValues },
      });
    },
    [onChange],
  );

  /** Show an edit now, write it once the author stops. */
  const edit = useCallback(
    (participants: Participant[], modOptionValues: Record<string, string>) => {
      setRows(participants);
      setOptions(modOptionValues);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        commit(participants, modOptionValues);
      }, COMMIT_DELAY);
    },
    [commit],
  );

  // A pending write is flushed rather than dropped when the panel is collapsed
  // or the page is left, so the last edit of a drag is never lost.
  const flush = useRef<(() => void) | null>(null);
  flush.current = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    commit(rows, options);
  };
  useEffect(() => () => flush.current?.(), []);

  /* ---- The three changes that cost something. ---- */

  // The validator's own walk, so the notice and the launch answer the same
  // question. Reading defs off the map alone missed a team's start units, a
  // factory's build queue and every trigger parameter naming a def, which is a
  // notice saying the new game has everything and a launch refused seconds later
  // (issue #940).
  const namedDefs = useMemo(
    () => [...new Set(unitDefsIn(scenario).map((found) => found.def))],
    [scenario],
  );
  const carriesCoordinates =
    scenario.zones.length +
      scenario.actors.length +
      scenario.groups.length +
      scenario.prefabs.length >
    0;

  const askMap = (mapName: string) => {
    if (mapName === setup.mapName) return;
    if (!carriesCoordinates) return onChange(setScenarioMap(scenario, mapName));
    setPending({ kind: "map", mapName });
  };

  const askGame = (gameName: string) => {
    if (gameName === setup.gameName) return;
    const set = Object.keys(setup.modOptionValues).length;
    if (namedDefs.length === 0 && set === 0)
      return onChange(setScenarioGame(scenario, gameName));
    setPending({ kind: "game", gameName });
  };

  const askRemove = (id: string) => {
    if (holdsNothing(participantHoldings(scenario, id)))
      return onChange(removeScenarioParticipant(scenario, id, null));
    setPending({ kind: "participant", id });
  };

  const openPresets = () =>
    drawer.open({
      title: "Set up from preset",
      width: "32rem",
      content: (
        <PresetPickerDrawer
          presets={presets}
          onPick={(preset) => {
            if (!carriesCoordinates && namedDefs.length === 0)
              return onChange(applyPresetSetup(latest.current, preset));
            setPending({ kind: "preset", preset });
          }}
        />
      ),
    });

  /* ---- What the cards need. ---- */

  // Marker colours in team order, so under fixed start positions marker N shows
  // who spawns there. The same computation the launcher's map card gets.
  const markerColors = useMemo(() => {
    const byId = new Map(rows.map((p) => [p.id, p]));
    const { leaderIdByTeam } = effectiveTeams(rows);
    return leaderIdByTeam.flatMap((id) => {
      const p = byId.get(id);
      return p ? rgbToHex(p.color) : [];
    });
  }, [rows]);

  // The starts are named only once something is set, so a shut panel says a
  // scenario has them rather than always saying it has not.
  const summary = [
    setup.gameName || "No game",
    setup.mapName || "No map",
    count(setup.participants.length, "participant"),
    ...(Object.keys(scenario.teams).length ? [startsSummary(scenario)] : []),
  ].join(" · ");

  return (
    <EditorPanel
      title="Setup"
      icon={SlidersHorizontal}
      summary={summary}
      defaultOpen={!setup.gameName || !setup.mapName}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            The game, map and participants this scenario is authored and played
            on.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto shrink-0"
            onClick={openPresets}
          >
            <Bookmark className="size-3.5" /> From preset
          </Button>
        </div>

        {pending?.kind === "map" && (
          <MapChangeNotice
            scenario={scenario}
            mapName={pending.mapName}
            from={mapExtent(selectedMap)}
            to={mapExtent(maps.find((m) => m.name === pending.mapName))}
            onCancel={() => setPending(null)}
            onKeep={() => {
              onChange(setScenarioMap(scenario, pending.mapName));
              setPending(null);
            }}
            onScale={(from, to) => {
              onChange(
                setScenarioMap(
                  scaleScenarioToMap(scenario, from, to),
                  pending.mapName,
                ),
              );
              setPending(null);
            }}
          />
        )}

        {pending?.kind === "game" && (
          <GameChangeNotice
            gameName={pending.gameName}
            oldGameName={setup.gameName}
            defs={namedDefs}
            optionCount={Object.keys(setup.modOptionValues).length}
            onCancel={() => setPending(null)}
            onConfirm={() => {
              onChange(setScenarioGame(scenario, pending.gameName));
              setPending(null);
            }}
          />
        )}

        {pending?.kind === "participant" && (
          <ParticipantRemovalNotice
            scenario={scenario}
            id={pending.id}
            onCancel={() => setPending(null)}
            onRemove={(to) => {
              onChange(removeScenarioParticipant(scenario, pending.id, to));
              setPending(null);
            }}
          />
        )}

        {pending?.kind === "preset" && (
          <PresetNotice
            preset={pending.preset}
            participantCount={setup.participants.length}
            onCancel={() => setPending(null)}
            onConfirm={() => {
              onChange(applyPresetSetup(scenario, pending.preset));
              setPending(null);
            }}
          />
        )}

        {setup.gameName && !selectedGame && !scan.loading && (
          <MissingNote what={setup.gameName} />
        )}
        {setup.mapName && !selectedMap && !scan.loading && (
          <MissingNote what={setup.mapName} />
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <div className="flex flex-col gap-4">
            <ParticipantsTable
              participants={rows}
              sides={sides}
              factionLogos={factionLogos}
              ais={ais}
              aiConfig={aiConfig}
              startPosType={setup.startPosType}
              startPosCount={minimap.startPositions?.length}
              onUpdate={(id, patch) =>
                edit(
                  rows.map((p) => (p.id === id ? { ...p, ...patch } : p)),
                  options,
                )
              }
              onSetTeam={(id, team) =>
                edit(setParticipantTeam(rows, id, team), options)
              }
              onRemove={askRemove}
              onAddAi={() =>
                edit(
                  [
                    ...rows,
                    makeAiParticipant(
                      rows,
                      RANDOM_SIDE,
                      defaultAi(lastAi, ais),
                    ),
                  ],
                  options,
                )
              }
            />
            {/* Keyed by participant id, so it belongs beside the table that
                mints those ids rather than in a panel of its own. */}
            <StartConditions
              scenario={scenario}
              participants={rows}
              onChange={onChange}
            />
            <GameOptionsPanel
              selectedGame={selectedGame}
              startPosType={setup.startPosType}
              onStartPosType={(startPosType) =>
                onChange({ ...scenario, setup: { ...setup, startPosType } })
              }
              options={modOptions}
              optionValues={options}
              onOptionChange={(key, value) =>
                edit(rows, { ...options, [key]: value })
              }
            />
          </div>

          <div className="flex flex-col gap-4">
            <MapCard
              map={selectedMap}
              maps={maps}
              thumbs={thumbs}
              minimapDataUrl={minimap.dataUrl}
              startPositions={minimap.startPositions}
              minimapLoading={minimap.loading}
              markerColors={markerColors}
              env={minimap.env}
              mapsLoading={scan.loading && maps.length === 0}
              onSelectMap={askMap}
            />
            <GameSelectCard
              game={selectedGame}
              games={games}
              headers={headers}
              gamesLoading={scan.loading && games.length === 0}
              onSelectGame={askGame}
            />
          </div>
        </div>
      </div>
    </EditorPanel>
  );
}

/** Something the setup names that this machine does not have. */
function MissingNote({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangle className="size-3.5 shrink-0" /> {what} is not installed
      for the engine coilbox is using, so it cannot be drawn or played.
    </p>
  );
}

/** The shell a change that costs something is asked about in. */
function Ask({
  children,
  actions,
}: {
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Alert className="p-3">
      <AlertDescription className="flex flex-col gap-2 text-sm">
        {children}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Changing the map, and what it costs.
 *
 * Coordinates are in elmos from the map's north-west corner, so they mean
 * something different on a map of a different size: on a smaller one they fall
 * off the edge, where the engine clamps whatever stands there onto the border.
 * Rescaling is offered when both maps' sizes are known, and keeping them is
 * offered either way, with the number that would be off.
 */
function MapChangeNotice({
  scenario,
  mapName,
  from,
  to,
  onKeep,
  onScale,
  onCancel,
}: {
  scenario: Scenario;
  mapName: string;
  from: MapExtent | null;
  to: MapExtent | null;
  onKeep: () => void;
  onScale: (from: MapExtent, to: MapExtent) => void;
  onCancel: () => void;
}) {
  const cost = mapCost(scenario, to);
  const canScale = !!from && !!to && (from.x !== to.x || from.z !== to.z);

  return (
    <Ask
      actions={
        <>
          {canScale && from && to && (
            <Button size="sm" onClick={() => onScale(from, to)}>
              Rescale onto {mapName}
            </Button>
          )}
          <Button
            size="sm"
            variant={canScale ? "outline" : "default"}
            onClick={onKeep}
          >
            Keep the positions
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <span>
        {placedList(scenario)} stand somewhere on the current map, and the same
        position is a different place on {mapName}.{" "}
        {to
          ? cost.offMap > 0
            ? `Kept as they are, ${count(cost.offMap, "coordinate")} would be off ${mapName}, where the engine clamps whatever stands there onto the edge.`
            : `Kept as they are, all of them are still on ${mapName}, though the ground under them is not the ground they were placed on.`
          : `Coilbox does not know ${mapName}'s size, so it cannot say how much of this would still be on it.`}
      </span>
    </Ask>
  );
}

/**
 * Changing the game, and what it costs: the unit defs the new game does not
 * have, read out of the new game itself rather than guessed at.
 */
function GameChangeNotice({
  gameName,
  oldGameName,
  defs,
  optionCount,
  onConfirm,
  onCancel,
}: {
  gameName: string;
  oldGameName: string;
  defs: string[];
  optionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const units = useGameUnits(gameName);
  const missing = useMemo(
    () => defsMissingFrom(defs, units.units),
    [defs, units.units],
  );

  return (
    <Ask
      actions={
        <>
          <Button size="sm" onClick={onConfirm}>
            Change the game
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <span>
        {defs.length === 0
          ? `This scenario names no units, so changing to ${gameName} costs nothing on the map.`
          : units.loading
            ? `Reading ${gameName}'s units…`
            : units.gameMissing
              ? `${gameName} is not installed, so coilbox cannot say which of the ${count(defs.length, "unit type")} this scenario names it has.`
              : missing.length === 0
                ? `${gameName} has all ${count(defs.length, "unit type")} this scenario names.`
                : `${count(missing.length, "unit type")} this scenario names ${missing.length === 1 ? "is" : "are"} not in ${gameName}: ${list(missing)}. They stay in the document until you change them, and the ones standing on the map draw as boxes.`}
        {optionCount > 0 &&
          ` The ${count(optionCount, "mod option")} set for ${oldGameName || "the old game"} ${optionCount === 1 ? "is" : "are"} dropped, because ${gameName} declares its own.`}
      </span>
    </Ask>
  );
}

/**
 * Removing a participant, and what it holds.
 *
 * A participant id is what actors, groups, prefabs and `teams` entries are keyed
 * on, so removing one without saying where its things go is how a document comes
 * to be full of units nobody owns.
 */
function ParticipantRemovalNotice({
  scenario,
  id,
  onRemove,
  onCancel,
}: {
  scenario: Scenario;
  id: string;
  onRemove: (to: string | null) => void;
  onCancel: () => void;
}) {
  const held = participantHoldings(scenario, id);
  const others = scenario.setup.participants.filter((p) => p.id !== id);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const name = scenario.setup.participants.find((p) => p.id === id)?.name ?? id;

  const holds = list(
    [
      held.actors > 0 && count(held.actors, "actor"),
      held.groups > 0 && count(held.groups, "group"),
      held.prefabs > 0 && count(held.prefabs, "base"),
      // Listed rather than only explained below, because a participant whose
      // only holding is a start used to read as owning nothing at all.
      held.team && "a start",
    ].filter((part): part is string => !!part),
  );

  return (
    <Ask
      actions={
        <>
          {others.length > 0 && (
            <>
              <OptionSelect
                size="sm"
                className="w-40"
                value={to}
                onValueChange={setTo}
                options={others.map((p) => ({ value: p.id, label: p.name }))}
              />
              <Button size="sm" onClick={() => onRemove(to)} disabled={!to}>
                Hand them over
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => onRemove(null)}
          >
            Delete them
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <span>
        {name} owns {holds}.
        {held.triggers > 0 &&
          ` ${count(held.triggers, "trigger condition or action")} name${held.triggers === 1 ? "s" : ""} it, and ${held.triggers === 1 ? "is" : "are"} carried over only if you hand its things to somebody.`}
        {held.team &&
          " Its start units, resources and income go either way: they belong to the participant being removed."}
      </span>
    </Ask>
  );
}

/** Setting up from a preset, which replaces the whole setup at once. */
function PresetNotice({
  preset,
  participantCount,
  onConfirm,
  onCancel,
}: {
  preset: SkirmishPreset;
  participantCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Ask
      actions={
        <>
          <Button size="sm" onClick={onConfirm}>
            Use "{preset.name}"
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <span>
        "{preset.name}" replaces the game, the map, the participants and the
        game options with {preset.gameName || "no game"} on{" "}
        {preset.mapName || "no map"}. This scenario's{" "}
        {count(participantCount, "participant")} hand over to the preset's{" "}
        {count(preset.participants.length, "participant")} in list order, and
        every position stays where it is on the new map.
      </span>
    </Ask>
  );
}
