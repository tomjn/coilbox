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
 * Beyond All Reason gets a second, cheaper route on top: a skirmish launch
 * writes its own `[modoptions]`, so the compiled Lua can go straight into
 * the bare `tweakdefs` slot with no generated game and no rescan needed
 * (`localBar.ts`). Offered only when the open game declares that slot, and
 * preferred by default when it does, since it is the cheaper path.
 */
import { Button, Drawer, useSetting } from "@picoframe/frame";
import { Rocket } from "lucide-react";
import { useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  primeScan,
  useUnitsyncGameInfo,
  useUnitsyncScan,
} from "@/content/config";
import {
  isWorkshopMutatorArchive,
  WORKSHOP_MUTATOR_FOLDER,
} from "@/lib/generatedGames";
import {
  gameOptionSchema,
  initialParticipants,
  mapOptionSchema,
  toBattleConfig,
  usePreferredTarget,
} from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { useCompiledProject } from "../../compile";
import { barRouteAvailable, barTweakModOptions } from "../../localBar";
import { workshopTestMutator } from "../../mutator";
import { workshopPreflight } from "../../preflight";
import type { ModProject } from "../../project";

/** Random start position: a test needs a spawn, not a chosen one. */
const START_POS_RANDOM = 1;

type Route = "bar-tweak" | "mutator";

type Phase =
  | { state: "idle" }
  | { state: "writing" }
  | { state: "scanning" }
  | { state: "playing" }
  | { state: "done"; route: Route; dir: string | null }
  | { state: "failed"; message: string };

const BUSY_LABEL: Record<string, string> = {
  writing: "Writing the test game",
  scanning: "Letting the engine find it",
  playing: "Game running",
};

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

export function PlayLocallyButton({ project }: { project: ModProject }) {
  const [open, setOpen] = useState(false);
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();
  const compiled = useCompiledProject(project, open);

  const games = scan.data?.games ?? [];
  const game = games.find((g) => g.name === project.gameName);
  const maps = uniqueByName(scan.data?.maps ?? []);
  const [mapName, setMapName] = useSetting<string>("workshop.testMap", "");
  const map = maps.find((m) => m.name === mapName) ?? maps[0];

  // The mod options a bare tweakdefs slot needs the game to declare, read
  // only while the drawer is open for the reason `useCompiledProject` is.
  const { info: gameInfo } = useUnitsyncGameInfo(
    open ? target?.enginePath : undefined,
    open ? target?.dataDir : undefined,
    open ? game?.primaryArchive.name : undefined,
  );

  const barAvailable = barRouteAvailable(
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
      route: "bar-tweak",
      label: "Beyond All Reason mod options",
      available: barAvailable,
      detail: barAvailable
        ? "No generated game and no rescan: the launch carries the edits itself."
        : `${project.gameName} does not declare a tweakdefs mod option, so this route is not on offer.`,
    },
    {
      route: "mutator",
      label: "Generated test game",
      available: mutatorAvailable,
      detail: `Works for every game. Coilbox writes ${WORKSHOP_MUTATOR_FOLDER} and rewrites it on every test.`,
    },
  ];
  const [routeChoice, setRouteChoice] = useState<Route | null>(null);
  const selectedRoute: Route =
    routeChoice && routes.find((r) => r.route === routeChoice)?.available
      ? routeChoice
      : barAvailable
        ? "bar-tweak"
        : "mutator";

  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const busy =
    phase.state === "writing" ||
    phase.state === "scanning" ||
    phase.state === "playing";
  const waiting = targetLoading || (!!target && !scan.data && scan.loading);

  const blocker =
    !targetLoading && !target
      ? "No engine is installed. Add one from Content before playing locally."
      : scan.error
        ? `The content scan failed: ${scan.error}`
        : scan.data && !game
          ? `${project.gameName} is not installed here.`
          : scan.data && maps.length === 0
            ? "No map is installed. Download one from Content first."
            : running && !busy
              ? "A game is already running."
              : null;

  const nothingToTest = !compiled.loading && !mutatorAvailable && !barAvailable;

  async function run() {
    if (!target || !game || !map) return;
    const route = selectedRoute;
    setPhase({ state: "writing" });
    try {
      // Nothing reaches the engine unchecked (issue #1276). A blocker is
      // something that would reach the game broken, so it stops the launch
      // here rather than being found out mid-game with the cause buried in
      // an infolog.
      const preflight = await workshopPreflight({ project });
      if (preflight.blockers.length > 0) {
        const [first, ...rest] = preflight.blockers;
        setPhase({
          state: "failed",
          message: `${preflight.blockers.length} blocker${preflight.blockers.length === 1 ? "" : "s"} would reach the game broken: ${first}${rest.length > 0 ? ` (and ${rest.length} more)` : ""}`,
        });
        return;
      }

      let gameType = game.name;
      let modOptions: Record<string, string> = {};
      let dir: string | null = null;

      if (route === "bar-tweak") {
        modOptions = barTweakModOptions(compiled.compiled);
      } else {
        const written = await workshopTestMutator({
          dataDir: target.dataDir,
          project,
        });
        dir = written.dir;
        setPhase({ state: "scanning" });
        const rescanned = await primeScan(
          target.enginePath,
          target.dataDir,
          true,
        );
        const found = rescanned.games.find((g) =>
          isWorkshopMutatorArchive(g.primaryArchive.name),
        );
        if (!found) {
          setPhase({
            state: "failed",
            message: `The engine did not pick up ${WORKSHOP_MUTATOR_FOLDER}. Check that ${game.name} is still installed.`,
          });
          return;
        }
        gameType = found.name;
      }

      setPhase({ state: "playing" });
      const result = await launch("skirmish", {
        config: toBattleConfig({
          participants: initialParticipants(),
          mapName: map.name,
          gameType,
          startPosType: START_POS_RANDOM,
          modOptions,
          optionSchema: await gameOptionSchema(
            target,
            game.primaryArchive.name,
          ),
          mapOptionSchema: await mapOptionSchema(target, map.name),
        }),
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (result.exitCode !== null && result.exitCode !== 0) {
        setPhase({
          state: "failed",
          message: `The engine exited with code ${result.exitCode}. Its infolog says why.`,
        });
        return;
      }
      setPhase({ state: "done", route, dir });
    } catch (error) {
      setPhase({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Play this project on your own machine"
      >
        <Rocket className="mr-1 size-3.5" />
        Test
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Play locally"
        description={`Test ${project.name} in ${project.gameName} on this machine. Nothing is uploaded and nothing is shared.`}
        width="28rem"
      >
        <div className="flex flex-col gap-5">
          {routes.some((r) => r.route === "bar-tweak" && r.available) && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Route</span>
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

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Map</span>
            <OptionSelect
              value={map?.name ?? ""}
              onValueChange={setMapName}
              options={maps.map((m) => ({ value: m.name, label: m.name }))}
              placeholder={waiting ? "Reading maps" : "No map installed"}
              disabled={busy || maps.length === 0}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <Button
              onClick={() => void run()}
              disabled={busy || waiting || !!blocker || !map || nothingToTest}
            >
              <Rocket className="size-4" />
              {busy
                ? BUSY_LABEL[phase.state]
                : nothingToTest
                  ? "Nothing to test yet"
                  : "Play"}
            </Button>
          </div>

          {blocker ? (
            <p className="text-xs text-destructive">{blocker}</p>
          ) : null}
          {!blocker && nothingToTest ? (
            <p className="text-xs text-muted-foreground">
              This project has no edits yet, so there is nothing to launch.
            </p>
          ) : null}

          {phase.state === "failed" ? (
            <p className="text-xs text-destructive">{phase.message}</p>
          ) : null}

          {phase.state === "done" ? (
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <p>The game has closed. Play it again to test another change.</p>
              {phase.route === "mutator" && phase.dir ? (
                <>
                  <p className="break-all">
                    <code>{phase.dir}</code>
                  </p>
                  <p>
                    Deleting <code>{WORKSHOP_MUTATOR_FOLDER}</code> undoes
                    everything this wrote.
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
