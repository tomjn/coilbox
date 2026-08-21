/**
 * Put the scenario in front of the engine.
 *
 * Lego's Test in game (`src/lego/pages/components/TestDrawer.tsx`) applied to a
 * mission: one button that writes, lets unitsync find what it wrote, and
 * launches through the same play path the singleplayer screen uses. There are no
 * pickers here because a scenario already names its game, map and participants.
 *
 * Two things are the scenario's own. The route is shown before the launch rather
 * than after, because which game the engine is handed is the difference between
 * testing the mission and testing the mutator. And the launch can be refused:
 * {@link launchScenario} compiles and reads the mission back before starting
 * anything, and a reference that does not resolve stops there, because the
 * engine's answer to a bad id is silence.
 *
 * The Scenarios page opens this same drawer in `play` mode, because a player
 * pressing Play wants exactly the launch an author testing a change wants. The
 * launch is the same and the words are not: the mode picks the reader every
 * sentence is written for, and the parts that are only about coilbox's own
 * plumbing are left out for a player (issue #862). See `wording.ts`.
 */

import { Button } from "@picoframe/frame";
import { Rocket } from "lucide-react";
import { useState } from "react";
import {
  primeScan,
  useUnitsyncHeightmap,
  useUnitsyncScan,
} from "@/content/config";
import { useGameUnits } from "@/content/useGameUnits";
import {
  gameOptionSchema,
  mapOptionSchema,
  usePreferredTarget,
} from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { MUTATOR_FOLDER } from "../../../lib/generatedGames";
import {
  launchScenario,
  missionIssueSummary,
  type ScenarioLaunchResult,
  scenarioLaunchBlocker,
} from "../../launch";
import type { Scenario } from "../../model";
import { mutatorOffer } from "../../offer";
import { ensureBundledScenarioMedia } from "../../storage";
import { describeIssue, type MissionIssue } from "../../validate";
import { missionWarnings, type ScenarioReader } from "../../wording";
import { useScenarioGate } from "./useScenarioGate";

type Launched = Extract<ScenarioLaunchResult, { ok: true }>;

type Phase =
  | { state: "idle" }
  | { state: "writing" }
  | { state: "scanning" }
  | { state: "playing" }
  | { state: "done"; result: Launched }
  | { state: "failed"; message: string; issues: MissionIssue[] };

const BUSY_LABEL: Record<string, string> = {
  writing: "Compiling the mission",
  scanning: "Letting the engine find it",
  playing: "Game running",
};

export function ScenarioTestDrawer({
  scenario,
  /**
   * Who pressed the button. The launch is identical either way. What changes is
   * the wording and how much of the result is worth showing, because a player
   * is not testing anything and the folder the mission was written into is the
   * author's business rather than theirs.
   */
  mode = "test",
}: {
  scenario: Scenario;
  mode?: "test" | "play";
}) {
  const testing = mode === "test";
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // How big the map is, so the validator can say a position is past its far
  // edge as well as before its near one. The same unitsync read the editing
  // surface already makes, and cached with it, so this costs nothing extra. A
  // map that has not answered yet leaves the extent out rather than blocking
  // the launch, which drops the far-edge half of the check for that run.
  const heightmap = useUnitsyncHeightmap(
    target?.enginePath,
    target?.dataDir,
    scenario.setup.mapName,
  );
  const samplesX = heightmap.data?.width;
  const samplesZ = heightmap.data?.height;
  const mapExtent =
    samplesX && samplesZ
      ? // World extent = (samples - 1) x 8 elmos, as `useMissionMapAssets` reports it.
        { width: (samplesX - 1) * 8, height: (samplesZ - 1) * 8 }
      : undefined;
  // The game's own units, so a unit def it does not have is refused rather than
  // spawning nothing in silence. The same cached read the editor's pickers make.
  // A read that has not answered leaves the list empty, which the validator says
  // it could not check rather than passing over.
  const gameUnits = useGameUnits(scenario.setup.gameName);
  const play = usePlay();
  const reader: ScenarioReader = testing ? "author" : "player";
  const { route, reason, available } = useScenarioGate(scenario, reader);
  const [phase, setPhase] = useState<Phase>({ state: "idle" });

  const busy =
    phase.state === "writing" ||
    phase.state === "scanning" ||
    phase.state === "playing";

  // Launching on a scan that has not answered would hand `launchScenario` an
  // empty game list, and it would refuse with "that game is not installed" over
  // a game that is. So the read is waited for rather than blocked on.
  const waiting = targetLoading || (!!target && !scan.data && !scan.error);

  const blocker = scan.error
    ? `The content scan failed: ${scan.error}`
    : scenarioLaunchBlocker({
        scenario,
        hasEngine: targetLoading || !!target,
        games: scan.data?.games ?? null,
        running: play.running && !busy,
        reader,
      });

  // The mutator writes a game folder the author should know about before it
  // appears, and it is the same offer a packaged game's own page makes. Author
  // only: it is about a folder in the player's content root that they did not
  // ask for and cannot act on, and it names coilbox's own plumbing throughout.
  const offer =
    testing && route === "mutator"
      ? mutatorOffer(scenario.setup.gameName, available)
      : null;

  async function run() {
    if (!target) return;
    setPhase({ state: "writing" });
    try {
      // A bundled scenario's dialogue clips have never been written into the
      // media store, and that store is where the compile step copies them from,
      // so they are materialised before anything is compiled. A no-op for every
      // scenario that came from anywhere else.
      await ensureBundledScenarioMedia(scenario.id);
      const result = await launchScenario({
        scenario,
        reader,
        dataDir: target.dataDir,
        games: scan.data?.games ?? [],
        optionSchema: await gameOptionSchema(target, gameUnits.archive),
        mapOptionSchema: await mapOptionSchema(target, scenario.setup.mapName),
        map: mapExtent,
        units: gameUnits.units,
        rescan: async () => {
          setPhase({ state: "scanning" });
          const rescanned = await primeScan(
            target.enginePath,
            target.dataDir,
            true,
          );
          return rescanned.games;
        },
        launch: (config) => {
          setPhase({ state: "playing" });
          return play.launch("skirmish", {
            config,
            executable: target.executable,
            dataDir: target.dataDir,
          });
        },
      });
      if (!result.ok) {
        setPhase({
          state: "failed",
          message: result.message,
          issues: result.issues,
        });
        return;
      }
      setPhase({ state: "done", result });
    } catch (error) {
      setPhase({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
        issues: [],
      });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Why a launch can stop before it starts. Author wording, and only an
          author has anything to do about it: a player is told the same thing
          in their own words if it actually happens. */}
      {testing ? (
        <p className="text-xs text-muted-foreground">
          The scenario is compiled and read back before the engine is started,
          so a reference that does not resolve stops here rather than playing as
          a trigger that never fires.
        </p>
      ) : null}

      {reason ? <p className="text-sm">{reason}</p> : null}

      {offer ? (
        <div className="flex flex-col gap-2 rounded border border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <p>{offer.offer}</p>
          {offer.limit ? <p>{offer.limit}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <Button
          onClick={() => void run()}
          disabled={busy || waiting || !!blocker}
        >
          <Rocket className="size-4" />
          {busy
            ? BUSY_LABEL[phase.state]
            : waiting
              ? "Reading your installed games"
              : testing
                ? "Test in game"
                : "Play"}
        </Button>
      </div>

      {blocker ? <p className="text-xs text-destructive">{blocker}</p> : null}

      {/* Every problem at once, not the first one at a time: an author fixing
          one typo per launch is the failure the read-back validator exists to
          avoid. A refusal with no issue list has nothing to enumerate. */}
      {phase.state === "failed" ? (
        <div className="flex flex-col gap-2 text-xs text-destructive">
          <p>
            {phase.issues.length > 0
              ? missionIssueSummary(reader, phase.issues)
              : phase.message}
          </p>
          {phase.issues.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {phase.issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  {describeIssue(issue)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* What validated as a warning: the mission played, and the player read
          something in it as a bug. Said after the launch because it is not a
          reason to refuse one. */}
      {phase.state === "done" && phase.result.warnings.length > 0 ? (
        <div className="flex flex-col gap-2 text-xs text-amber-300">
          <p>{missionWarnings(reader, phase.result.warnings.length)}</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {phase.result.warnings.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                {describeIssue(issue)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {phase.state === "done" ? (
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p>
            {phase.result.exitCode !== null && phase.result.exitCode !== 0
              ? `The engine exited with code ${phase.result.exitCode}. Its infolog says why.`
              : testing
                ? "The game has closed. Test again to play a change."
                : "The game has closed. Play it again from here."}
          </p>
          {/* Where the mission was written is the author's problem to debug, so
              a player is not shown paths they have no use for. */}
          {testing ? (
            <>
              <p>
                Played as <code>{phase.result.gameType}</code>, from{" "}
                <code className="break-all">{phase.result.mission}</code>.
              </p>
              <p className="break-all">
                <code>{phase.result.dir}</code>
              </p>
              {phase.result.route === "mutator" ? (
                <p>
                  Deleting <code>{MUTATOR_FOLDER}</code> undoes everything this
                  wrote.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
