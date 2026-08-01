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
 */

import { Button } from "@picoframe/frame";
import { Rocket } from "lucide-react";
import { useState } from "react";
import { primeScan, useUnitsyncScan } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import {
  launchScenario,
  missionIssueSummary,
  type ScenarioLaunchResult,
  scenarioLaunchBlocker,
} from "../../launch";
import type { Scenario } from "../../model";
import { MUTATOR_FOLDER } from "../../mutator";
import { mutatorOffer } from "../../offer";
import { describeIssue, type MissionIssue } from "../../validate";
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

export function ScenarioTestDrawer({ scenario }: { scenario: Scenario }) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const play = usePlay();
  const { route, reason, available } = useScenarioGate(scenario);
  const [phase, setPhase] = useState<Phase>({ state: "idle" });

  const busy =
    phase.state === "writing" ||
    phase.state === "scanning" ||
    phase.state === "playing";

  const blocker = scan.error
    ? `The content scan failed: ${scan.error}`
    : scenarioLaunchBlocker({
        scenario,
        hasEngine: targetLoading || !!target,
        games: scan.data?.games ?? null,
        running: play.running && !busy,
      });

  // The mutator writes a game folder the author should know about before it
  // appears, and it is the same offer a packaged game's own page makes.
  const offer =
    route === "mutator"
      ? mutatorOffer(scenario.setup.gameName, available)
      : null;

  async function run() {
    if (!target) return;
    setPhase({ state: "writing" });
    try {
      const result = await launchScenario({
        scenario,
        dataDir: target.dataDir,
        games: scan.data?.games ?? [],
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
      <p className="text-xs text-muted-foreground">
        The scenario is compiled and read back before the engine is started, so
        a reference that does not resolve stops here rather than playing as a
        trigger that never fires.
      </p>

      {reason ? <p className="text-sm">{reason}</p> : null}

      {offer ? (
        <div className="flex flex-col gap-2 rounded border border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <p>{offer.offer}</p>
          {offer.limit ? <p>{offer.limit}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <Button onClick={() => void run()} disabled={busy || !!blocker}>
          <Rocket className="size-4" />
          {busy ? BUSY_LABEL[phase.state] : "Test in game"}
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
              ? missionIssueSummary(phase.issues)
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

      {phase.state === "done" ? (
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p>
            {phase.result.exitCode !== null && phase.result.exitCode !== 0
              ? `The engine exited with code ${phase.result.exitCode}. Its infolog says why.`
              : "The game has closed. Test again to play a change."}
          </p>
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
        </div>
      ) : null}
    </div>
  );
}
