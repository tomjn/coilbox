/**
 * Play the open project on your own machine (issue #1278).
 *
 * The community's tools all assume a hosted lobby, because a base64 mod
 * option typed into a browser tab has nowhere else to go. Coilbox does not
 * have that constraint: a compiled project is already the shape of a
 * mutator archive (`compile.ts`'s own doc comment), so it can be written
 * into a generated game under the content root and launched as an ordinary
 * skirmish, the same move the lego builder's and the scenario editor's own
 * test drawers make. That route works for every game.
 *
 * A game that declares a bare `tweakdefs` mod option (a convention Beyond
 * All Reason's `modoptions.lua` popularized, but the mod option itself
 * predates it) gets a second, cheaper route on top: a skirmish launch writes
 * its own `[modoptions]`, so the compiled Lua can go straight into that slot
 * with no generated game and no rescan needed (`localTweakSlot.ts`). Offered
 * only when the open game declares that slot, and preferred by default when
 * it does, since it is the cheaper path.
 */
import { t as coreT, msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Drawer, useSetting } from "@picoframe/frame";
import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { CheckField } from "@/components/Field";
import { useCompatSettings } from "@/content/compatSettings";
import {
  primeScan,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "@/content/config";
import { resolveMutatorDataDir } from "@/downloads/config";
import { describeError } from "@/i18n/uiError";
import {
  isWorkshopMutatorArchive,
  WORKSHOP_MUTATOR_FOLDER,
} from "@/lib/generatedGames";
import { resolveCompatTarget } from "@/play/compatTarget";
import {
  initialParticipants,
  toBattleConfig,
  usePreferredTarget,
} from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { MapPickerDrawer } from "@/play/pages/components/MapPickerDrawer";
import { useCompiledProject, workshopCompile } from "../../compile";
import {
  settledSummary,
  settleTypedValues,
  settleTypedValuesTweaks,
} from "../../loadsAs";
import {
  localTweakModOptions,
  localTweakSlotAvailable,
} from "../../localTweakSlot";
import { workshopTestMutator } from "../../mutator";
import { workshopPreflight } from "../../preflight";
import type { ModProject } from "../../project";
import {
  buildTestGameModInfo,
  buildTestScenario,
  canPlaceBaseCopy,
  type TestUnit,
  testMissionModOptions,
  writeStartWithUnit,
} from "../../testMission";

/** Random start position: a test needs a spawn, not a chosen one. */
const START_POS_RANDOM = 1;

type Route = "tweak-slot" | "mutator";

type Phase =
  | { state: "idle" }
  | { state: "settling" }
  | { state: "writing" }
  | { state: "scanning" }
  | { state: "playing" }
  | { state: "done"; route: Route; dir: string | null }
  | { state: "failed"; message: string };

const BUSY_LABEL = {
  settling: msg`Checking typed values against the game`,
  writing: msg`Writing the test game`,
  scanning: msg`Letting the engine find it`,
  playing: msg`Game running`,
} as const;

/**
 * Two installed archives can carry the same map name. A start script names
 * one, so the second is the same choice offered twice.
 */
function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

/** Rescan, then find the test game the engine now knows about. */
async function findGeneratedGame(target: {
  enginePath: string;
  dataDir: string;
}) {
  const rescanned = await primeScan(
    target.enginePath,
    target.dataDir,
    true,
  ).catch((error) => {
    const reason = describeError(error);
    throw new Error(coreT`The content scan failed: ${reason}`);
  });
  return rescanned.games.find((g) =>
    isWorkshopMutatorArchive(g.primaryArchive.name),
  );
}

export function PlayLocallyButton({
  project,
  unit,
  requestOpen,
}: {
  project: ModProject;
  /** The unit open on the page. With one, the drawer offers to start the game
   *  with it on the map (issue #3178). */
  unit?: TestUnit;
  /** Bumped to open the drawer from outside the button itself, such as the
   *  command palette's Test action (issue #3118). Every value opens it,
   *  including the first, so a caller need not track whether this is the
   *  drawer's first open before it bumps this. */
  requestOpen?: number;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (requestOpen !== undefined) setOpen(true);
  }, [requestOpen]);
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();
  const [compatSettings] = useCompatSettings();
  const compiled = useCompiledProject(project, open);

  const games = scan.data?.games ?? [];
  const game = games.find((g) => g.name === project.gameName);
  const gameName = project.gameName;
  const projectName = project.name;
  const gameDisplayName = game?.name;
  const scanError = scan.error;
  const unitLabel = unit?.label;
  const unitKey = unit?.key;
  const installedName = game?.name;
  const maps = uniqueByName(scan.data?.maps ?? []);
  const [mapName, setMapName] = useSetting<string>("workshop.testMap", "");
  const map = maps.find((m) => m.name === mapName) ?? maps[0];
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [startWithUnitSetting, setStartWithUnit] = useSetting<boolean>(
    "workshop.testStartWithUnit",
    false,
  );
  const startWithUnit = !!unit && startWithUnitSetting;
  // Only rendered while the drawer is open, for the reason `gameInfo` is.
  const { thumbs } = useUnitsyncThumbnails(
    open ? target?.enginePath : undefined,
    open ? target?.dataDir : undefined,
  );

  // The mod options a bare tweakdefs slot needs the game to declare, read
  // only while the drawer is open for the reason `useCompiledProject` is.
  const { info: gameInfo } = useUnitsyncGameInfo(
    open ? target?.enginePath : undefined,
    open ? target?.dataDir : undefined,
    open ? game?.primaryArchive.name : undefined,
  );

  const tweakAvailable = localTweakSlotAvailable(
    gameInfo?.options ?? [],
    compiled.compiled,
  );
  const mutatorAvailable = (compiled.compiled?.files.length ?? 0) > 0;
  const routes: {
    route: Route;
    label: string;
    available: boolean;
    detail: string;
  }[] = [
    {
      route: "tweak-slot",
      label: t`Local tweak-slot mod option`,
      available: tweakAvailable,
      detail: tweakAvailable
        ? startWithUnit
          ? t`The launch carries the edits itself. Placing the unit adds a generated game, ${WORKSHOP_MUTATOR_FOLDER}, and a rescan.`
          : t`No generated game and no rescan: the launch carries the edits itself.`
        : t`${gameName} does not declare a tweakdefs mod option, so this route is not on offer.`,
    },
    {
      route: "mutator",
      label: t`Generated test game`,
      available: mutatorAvailable,
      detail: t`Works for every game. Coilbox writes ${WORKSHOP_MUTATOR_FOLDER} and rewrites it on every test.`,
    },
  ];
  const [routeChoice, setRouteChoice] = useState<Route | null>(null);
  const selectedRoute: Route =
    routeChoice && routes.find((r) => r.route === routeChoice)?.available
      ? routeChoice
      : tweakAvailable
        ? "tweak-slot"
        : "mutator";

  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  // What the route did about typed values the game's own Lua would change
  // (issues #3059 and #3092), for the run under way or the last one.
  const [typedNote, setTypedNote] = useState<string | null>(null);
  const busy =
    phase.state === "settling" ||
    phase.state === "writing" ||
    phase.state === "scanning" ||
    phase.state === "playing";
  const waiting = targetLoading || (!!target && !scan.data && scan.loading);

  const blocker =
    !targetLoading && !target
      ? t`No engine is installed. Add one from Content before playing locally.`
      : scan.error
        ? t`The content scan failed: ${scanError}`
        : scan.data && !game
          ? t`${gameName} is not installed here.`
          : scan.data && maps.length === 0
            ? t`No map is installed. Download one from Content first.`
            : running && !busy
              ? t`A game is already running.`
              : null;

  const nothingToTest =
    !compiled.loading && !mutatorAvailable && !tweakAvailable;

  async function run() {
    if (!target || !game || !map) return;
    const route = selectedRoute;
    setTypedNote(null);
    setPhase({ state: "writing" });
    try {
      // Nothing reaches the engine unchecked (issue #1276). A blocker is
      // something that would reach the game broken, so it stops the launch
      // here rather than being found out mid-game with the cause buried in
      // an infolog.
      const preflight = await workshopPreflight({ project });
      if (preflight.blockers.length > 0) {
        const [first, ...rest] = preflight.blockers;
        const blockerCount = preflight.blockers.length;
        const summary = plural(blockerCount, {
          one: `# blocker would reach the game broken: ${first}`,
          other: `# blockers would reach the game broken: ${first}`,
        });
        setPhase({
          state: "failed",
          message:
            rest.length > 0
              ? `${summary} ${plural(rest.length, { one: "(and # more)", other: "(and # more)" })}`
              : summary,
        });
        return;
      }

      // With the game's compatibility switch on, everything below is built
      // over its mutator in place of the game (issue #4562). Off, this is the
      // game itself and nothing about the mutator is read.
      const compat = await resolveCompatTarget({
        target,
        game,
        settings: compatSettings,
      });
      if (compat.kind === "blocked") {
        setPhase({ state: "failed", message: compat.message });
        return;
      }
      const baseGame = compat.kind === "use" ? compat.gameType : game.name;
      let gameType = baseGame;
      let modOptions: Record<string, string> = {};
      let dir: string | null = null;
      // The game's own version goes on the map beside the edited unit, so it is
      // compiled in under another name (issue #3177). Left out entirely when
      // the option is off, which keeps that launch what it always was.
      const baseCopies =
        startWithUnit && unit && canPlaceBaseCopy(unit)
          ? [unit.key]
          : undefined;
      const copyArg = baseCopies ? { baseCopies } : {};
      const participants = initialParticipants();

      if (route === "tweak-slot") {
        // The same for the bare tweakdefs slot, checked by loading the game
        // with that slot set the way this launch sets it (issue #3092).
        setPhase({ state: "settling" });
        const settled = await settleTypedValuesTweaks({
          enginePath: target.enginePath,
          dataDir: target.dataDir,
          archive: game.primaryArchive.name,
          project,
          route: "bare",
        });
        setTypedNote(
          settled.ok ? settledSummary(settled.settled) : settled.message,
        );
        const tweaks =
          settled.ok || baseCopies
            ? await workshopCompile({
                project,
                written: settled.ok ? settled.settled.written : undefined,
                ...copyArg,
              })
            : compiled.compiled;
        modOptions = localTweakModOptions(tweaks);
        if (startWithUnit && unit) {
          // The edits stay in the slot. The game it depends on is the only
          // thing written, so the game's own `unitdefs_post.lua` still reads
          // `tweakdefs`, and this route now needs the rescan it skipped.
          setPhase({ state: "writing" });
          const generated = await writeStartWithUnit({
            dataDir: target.dataDir,
            game,
            scenario: buildTestScenario({
              unit,
              gameName: game.name,
              mapName: map.name,
              participants,
            }),
            modinfo: buildTestGameModInfo(baseGame, unit.label),
          });
          dir = generated.dir;
          modOptions = { ...modOptions, ...testMissionModOptions() };
          const found = await findGeneratedGame(target);
          if (!found) {
            setPhase({
              state: "failed",
              message: t`The engine did not pick up ${WORKSHOP_MUTATOR_FOLDER}. Check that ${installedName} is still installed.`,
            });
            return;
          }
          gameType = found.name;
        }
      } else {
        // A value the game's own Lua would turn into something else is
        // written as one it turns into the typed number, checked by loading
        // the game with these very files (issue #3059).
        setPhase({ state: "settling" });
        const settled = await settleTypedValues({
          enginePath: target.enginePath,
          dataDir: target.dataDir,
          archive: game.primaryArchive.name,
          project,
        });
        setTypedNote(
          settled.ok ? settledSummary(settled.settled) : settled.message,
        );
        setPhase({ state: "writing" });
        const written = await workshopTestMutator({
          dataDir: await resolveMutatorDataDir(target.dataDir),
          project: { ...project, gameName: baseGame },
          written: settled.ok ? settled.settled.written : undefined,
          ...copyArg,
        });
        dir = written.dir;
        if (startWithUnit && unit) {
          await writeStartWithUnit({
            dataDir: target.dataDir,
            game,
            scenario: buildTestScenario({
              unit,
              gameName: game.name,
              mapName: map.name,
              participants,
            }),
          });
          modOptions = { ...modOptions, ...testMissionModOptions() };
        }
        setPhase({ state: "scanning" });
        const found = await findGeneratedGame(target);
        if (!found) {
          setPhase({
            state: "failed",
            message: t`The engine did not pick up ${WORKSHOP_MUTATOR_FOLDER}. Check that ${installedName} is still installed.`,
          });
          return;
        }
        gameType = found.name;
      }

      setPhase({ state: "playing" });
      const result = await launch("skirmish", {
        config: toBattleConfig({
          participants,
          mapName: map.name,
          gameType,
          startPosType: START_POS_RANDOM,
          compatBase: compat.kind === "use" ? compat.baseName : undefined,
          modOptions,
        }),
        executable: target.executable,
        dataDir: target.dataDir,
      });
      const exitCode = result.exitCode;
      if (exitCode !== null && exitCode !== 0) {
        setPhase({
          state: "failed",
          message: t`The engine exited with code ${exitCode}. Its infolog says why.`,
        });
        return;
      }
      setPhase({ state: "done", route, dir });
    } catch (error) {
      setPhase({
        state: "failed",
        message: describeError(error),
      });
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title={t`Play this project on your own machine`}
      >
        <Rocket className="mr-1 size-3.5" />
        <Trans>Test</Trans>
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={t`Play locally`}
        description={t`Test ${projectName} in ${gameName} on this machine. Nothing is uploaded and nothing is shared.`}
        width="28rem"
      >
        <div className="flex flex-col gap-5">
          {routes.some((r) => r.route === "tweak-slot" && r.available) && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                <Trans>Route</Trans>
              </span>
              <div className="flex flex-col gap-2">
                {routes.map((r) => (
                  <label
                    key={r.route}
                    className="flex items-start gap-2 rounded border border-border/60 px-3 py-2 text-sm has-[:disabled]:opacity-50"
                  >
                    <input
                      type="radio"
                      name="workshop-play-route"
                      className="mt-0.5"
                      checked={selectedRoute === r.route}
                      disabled={!r.available || busy}
                      onChange={() => setRouteChoice(r.route)}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{r.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.detail}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {unit ? (
            <CheckField
              label={t`Start with ${unitLabel} on the map`}
              hint={
                unit.inGame && !canPlaceBaseCopy(unit)
                  ? t`Places the edited ${unitLabel} when the game starts, so there is nothing to build first. The game's own version is not placed beside it, because a unit's internal name can only hold lowercase letters, digits and underscores and ${unitKey} does not. Coilbox writes ${WORKSHOP_MUTATOR_FOLDER} to do it, and it is never packaged.`
                  : unit.inGame
                    ? t`Places the edited ${unitLabel} and the game's own beside it when the game starts, so there is nothing to build first. Coilbox writes ${WORKSHOP_MUTATOR_FOLDER} to do it, and it is never packaged.`
                    : gameDisplayName
                      ? t`Places the edited ${unitLabel} when the game starts, so there is nothing to build first. ${gameDisplayName} has no version of its own to put beside it. Coilbox writes ${WORKSHOP_MUTATOR_FOLDER} to do it, and it is never packaged.`
                      : t`Places the edited ${unitLabel} when the game starts, so there is nothing to build first. The game has no version of its own to put beside it. Coilbox writes ${WORKSHOP_MUTATOR_FOLDER} to do it, and it is never packaged.`
              }
              checked={startWithUnit}
              onChange={setStartWithUnit}
            />
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              <Trans>Map</Trans>
            </span>
            <Button
              variant="outline"
              className="justify-start font-normal"
              onClick={() => setMapPickerOpen(true)}
              disabled={busy || maps.length === 0}
            >
              {map?.name ??
                (waiting
                  ? t`Reading maps`
                  : scan.error
                    ? t`Maps could not be read`
                    : t`No map installed`)}
            </Button>
          </div>
          <MapPickerDrawer
            open={mapPickerOpen}
            onOpenChange={setMapPickerOpen}
            maps={maps}
            thumbs={thumbs}
            selectedName={map?.name ?? ""}
            onSelect={setMapName}
            mapsLoading={waiting}
          />

          <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <Button
              onClick={() => void run()}
              disabled={busy || waiting || !!blocker || !map || nothingToTest}
            >
              <Rocket className="size-4" />
              {busy
                ? t(BUSY_LABEL[phase.state])
                : nothingToTest
                  ? t`Nothing to test yet`
                  : t`Play`}
            </Button>
          </div>

          {blocker ? (
            <p className="text-xs text-destructive">{blocker}</p>
          ) : null}
          {!blocker && nothingToTest ? (
            <p className="text-xs text-muted-foreground">
              <Trans>
                This project has no edits yet, so there is nothing to launch.
              </Trans>
            </p>
          ) : null}

          {phase.state === "failed" ? (
            <p className="text-xs text-destructive">{phase.message}</p>
          ) : null}

          {typedNote ? (
            <p className="text-xs text-muted-foreground">{typedNote}</p>
          ) : null}

          {phase.state === "done" ? (
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <p>
                <Trans>
                  The game has closed. Play it again to test another change.
                </Trans>
              </p>
              {phase.dir ? (
                <>
                  <p className="break-all">
                    <code>{phase.dir}</code>
                  </p>
                  <p>
                    <Trans>
                      Deleting <code>{WORKSHOP_MUTATOR_FOLDER}</code> undoes
                      everything this wrote.
                    </Trans>
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
